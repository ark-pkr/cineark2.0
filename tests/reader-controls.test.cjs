const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function setup(extraContext={}) {
    const storage = new Map();
    const context = { window: {}, indexedDB: { open: () => ({}) }, AbortController, setTimeout: () => 0, clearTimeout() {},
        localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },...extraContext };
    vm.createContext(context);
    for (const file of ['reader.js', 'mangadex.js', 'reader-controls.js']) vm.runInContext(fs.readFileSync('public/assets/js/' + file, 'utf8'), context);
    const mixins = [context.window.readerMixin, context.window.mangadexMixin, context.window.readerControlsMixin];
    const app = { userSession: { user: { id: 'a' } }, readingWork: { id: 'work' }, $nextTick: async () => {} };
    for (const mixin of mixins) Object.assign(app, mixin.data(), mixin.methods);
    for (const mixin of mixins) for (const [name, getter] of Object.entries(mixin.computed || {})) Object.defineProperty(app, name, { get: () => getter.call(app) });
    app.readingWork = { id: 'work' }; app.dexSelected = { id: 'manga', title: 'Title' }; app.chapterSource = 'mangadex';
    return app;
}
const dex = (id, number, group = 'A') => ({ id, number, group, volume: '1', source: 'mangadex', published: true, mangaId: 'manga', language: 'pt-br' });

test('reader overflow actions close the menu before opening a panel and keep focus recoverable',()=>{
 const app=setup();let focused=false,opened=false;
 app.$refs={readerActions:{open:true,querySelector:()=>({focus(){focused=true;}})}};
 app.openReaderMoments=()=>{assert.equal(app.$refs.readerActions.open,false);opened=true;};
 app.runReaderAction('moments');assert.equal(opened,true);assert.equal(focused,true);
 app.readerDrawerOpen=true;app.runReaderAction('focus');assert.equal(app.readerFocus,true);assert.equal(app.readerDrawerOpen,false);
});

test('the open overflow menu prevents desktop idle from hiding its controls',()=>{
 let idle;const app=setup({setTimeout:fn=>{idle=fn;return 1;}});app.activeChapter=dex('one','1');app.$refs={readerActions:{open:true}};
 app.readerPointerMoved({pointerType:'mouse',clientY:400,currentTarget:{getBoundingClientRect:()=>({top:0,height:900})}});idle();assert.equal(app.readerControlsHidden,false);
});

test('opening the chapter directory expands to the active chapter beyond the first eighty',async()=>{
 let focused=false;const app=setup({document:{querySelector:()=>({scrollIntoView(){},focus(){focused=true;}})}});
 app.chapterSource='library';app.activeChapter={id:'150',source:'remote'};app.chapters=Array.from({length:180},(_,i)=>({id:String(i),published:true,source:'remote'}));
 await app.toggleReaderDrawer();assert.equal(app.readerDrawerOpen,true);assert.equal(app.readerChapterLimit,151);assert.equal(focused,true);
});

test('batch recovery renews no more than two pages at a time',async()=>{
    const app=setup();app.activeChapter={id:'chapter',source:'remote',storagePages:[0,1,2,3]};app.pageURLs=['a','b','c','d'];app.readerFailedPages={0:true,1:true,2:true,3:true};
    let active=0,peak=0,calls=0;
    app.cloudAPI=()=>({signedURLs:async pages=>{calls++;active++;peak=Math.max(peak,active);await new Promise(resolve=>setImmediate(resolve));active--;return ['new-'+pages[0]];}});
    await app.retryFailedReaderPages();assert.equal(calls,4);assert.equal(peak,2);assert.equal(app.readerFailedCount,0);assert.equal(app.pageURLs[3],'new-3');assert.equal(app.readerRetryAllBusy,false);
});

test('batch recovery stops when the reader changes chapters and ignores late URLs',async()=>{
    const app=setup();app.activeChapter={id:'chapter',source:'remote',storagePages:[0,1,2]};app.pageURLs=['a','b','c'];app.readerFailedPages={0:true,1:true,2:true};
    const resolvers=[];app.cloudAPI=()=>({signedURLs:()=>new Promise(resolve=>resolvers.push(resolve))});
    const pending=app.retryFailedReaderPages();assert.equal(resolvers.length,2);
    app.activeChapter={id:'other',source:'remote'};app.pageURLs=['other'];app.readerFailedPages={};app.readerRetryAllBusy=false;
    resolvers.forEach(resolve=>resolve(['stale']));await pending;
    assert.equal(app.pageURLs[0],'other');assert.equal(resolvers.length,2);
});

test('economy mode avoids speculative image requests',()=>{
    let requests=0;const app=setup({navigator:{connection:{saveData:true}},Image:class{constructor(){requests++;}}});
    app.pageURLs=['a','b','c'];app.preloadReaderPages();assert.equal(requests,0);assert.equal(app.readerEagerPage(0),true);assert.equal(app.readerEagerPage(1),false);
});

test('a short chapter reveals reactions after its final image loads without any scroll event',async()=>{
    const app=setup();app.activeChapter={id:'short',source:'remote'};app.pageURLs=['page'];app.readerPage=0;
    const page={clientHeight:400,getBoundingClientRect:()=>({top:130,bottom:530})};
    app.$refs={readerScroll:{querySelector:()=>page,getBoundingClientRect:()=>({top:0,bottom:800})}};
    app.checkReaderCompletion();assert.equal(app.readerEndReached,false);
    await app.readerPageReady({target:{dataset:{chapter:'short'}}},0);
    assert.equal(app.readerEndReached,true);assert.equal(app.readerCompletionConfirmed,true);assert.equal(app.readerControlsHidden,false);
});
test('the reaction shortcut reveals the panel and cancels marathon countdown',async()=>{
    const app=setup();let scrolled=false;app.readerMarathonRemaining=6;
    app.$refs={readerScroll:{querySelector:()=>({scrollIntoView(){scrolled=true;}})}};
    await app.revealChapterReactions();assert.equal(app.readerEndReached,true);assert.equal(scrolled,true);assert.equal(app.readerMarathonRemaining,0);
    assert.equal(app.readerCompletionConfirmed,false);
});

test('desktop idle collapses bars and moving to the top edge restores them',()=>{
    let idle;const app=setup({setTimeout:fn=>{idle=fn;return 1;}});app.activeChapter=dex('one','1');app.$refs={};
    const target={getBoundingClientRect:()=>({top:0,height:900})};
    app.readerPointerMoved({pointerType:'mouse',clientY:400,currentTarget:target});idle();assert.equal(app.readerControlsHidden,true);
    app.readerPointerMoved({pointerType:'mouse',clientY:20,currentTarget:target});assert.equal(app.readerControlsHidden,false);
    app.readerDrawerOpen=true;app.readerPointerMoved({pointerType:'mouse',clientY:400,currentTarget:target});idle();assert.equal(app.readerControlsHidden,false);
});
test('H toggles reader bars without intercepting text fields',()=>{
    const app=setup();app.activeChapter=dex('one','1');let prevented=false;
    app.readerKey({key:'h',target:{tagName:'DIV'},preventDefault(){prevented=true;}});assert.equal(app.readerControlsHidden,true);assert.equal(prevented,true);
    app.readerKey({key:'h',target:{tagName:'INPUT'},preventDefault(){assert.fail();}});assert.equal(app.readerControlsHidden,true);
});

test('marathon is optional, waits eight ticks, and cancel prevents automatic navigation',async()=>{
    const app=setup();app.activeChapter=dex('one','1');app.dexChapters=[dex('one','1'),dex('two','2')];app.readerEndReached=true;app._marathonReachedBottom=true;
    let opened=0;app.navigateReaderChapter=async()=>{opened++;};
    app.startReaderMarathon();assert.equal(app.readerMarathonRemaining,0);
    app.readerMarathon=true;app.startReaderMarathon();assert.equal(app.readerMarathonRemaining,8);
    app.cancelReaderMarathon();await app.tickReaderMarathon();assert.equal(opened,0);
    app.readerMarathonCancelled=false;app.startReaderMarathon();for(let i=0;i<7;i++)await app.tickReaderMarathon();assert.equal(opened,0);
    await app.tickReaderMarathon();assert.equal(opened,1);
});
test('marathon never starts on a hidden tab or without reaching the chapter end',()=>{
    const app=setup({document:{visibilityState:'hidden'}});app.readerMarathon=true;app.activeChapter=dex('one','1');app.dexChapters=[dex('one','1'),dex('two','2')];app.readerEndReached=true;app._marathonReachedBottom=true;
    app.startReaderMarathon();assert.equal(app.readerMarathonRemaining,0);
});

test('preloading stays bounded to the next two pages and releases old image references',()=>{
    const app=setup({Image:class {set src(value){this.url=value;}}});
    app.pageURLs=['zero','one','two','three','four'];app.readerPage=0;app.preloadReaderPages();
    assert.deepEqual(Array.from(app._readerPreloads.keys()),[1,2]);
    const old=app._readerPreloads.get(1);app.readerPage=2;app.preloadReaderPages();
    assert.equal(old.url,'');assert.equal(app._readerPreloads.get(3).url,'three');assert.equal(app._readerPreloads.get(4).url,'four');
    app.resetReaderControls();assert.equal(app._readerPreloads.size,0);
});
test('restoring a saved page applies its local fractional offset after image layout',async()=>{
    const app=setup();app.activeChapter={id:'chapter',source:'remote'};app.pageURLs=['page'];app.readerPage=0;
    const page={clientHeight:800,getBoundingClientRect:()=>({top:60})};
    const root={scrollTop:300,querySelector:()=>page,getBoundingClientRect:()=>({top:100})};app.$refs={readerScroll:root};
    app._readerRestore={chapterId:'chapter',page:0,offset:.25};
    await app.readerPageReady({target:{dataset:{chapter:'chapter'}}},0);
    assert.equal(root.scrollTop,460);assert.equal(app._readerRestore,null);
});

test('immersive scroll hides downward, restores upward and leaves open preferences visible',()=>{
    const app=setup();app.$refs={readerPreferences:{open:false}};app.pageURLs=['one','two'];app.readerPage=0;
    const root={scrollTop:200,clientHeight:400,scrollHeight:2000,querySelector:()=>null};
    app.readerScrolled({target:root});assert.equal(app.readerControlsHidden,true);
    root.scrollTop=150;app.readerScrolled({target:root});assert.equal(app.readerControlsHidden,false);
    app.$refs.readerPreferences.open=true;root.scrollTop=300;app.readerScrolled({target:root});assert.equal(app.readerControlsHidden,false);
});
test('work preferences stay independent and ending a chapter never navigates automatically',()=>{
    const app=setup();app.readingMode='paged';app.readingDirection='rtl';app.readerSpacing=8;app.changeReadingMode=()=>{};
    app.saveReaderPreferences();app.readingWork={id:'other',type:'Manhwa'};app.prepareImmersiveReader();assert.equal(app.readingMode,'vertical');assert.equal(app.readerSpacing,0);
    app.readingWork={id:'work'};app.prepareImmersiveReader();assert.equal(app.readingMode,'paged');assert.equal(app.readingDirection,'rtl');assert.equal(app.readerSpacing,8);
    let navigation=0;app.navigateReaderChapter=()=>navigation++;app.pageURLs=['one'];app.readerLoadedPages={0:true};app.readerPage=0;app.$refs={};
    app.readerScrolled({target:{scrollTop:600,clientHeight:400,scrollHeight:1000,querySelector:()=>null}});
    assert.equal(app.readerEndReached,true);assert.equal(navigation,0);
});

test('work comfort settings restore width theme and brightness per work and account',()=>{
 const app=setup();app.changeReadingMode=()=>{};
 Object.assign(app,{readerWidth:'680',readerTheme:'sepia',readerBrightness:75});app.saveReaderPreferences();
 app.readingWork={id:'other'};Object.assign(app,{readerWidth:'1100',readerTheme:'gray',readerBrightness:90});app.saveReaderPreferences();
 app.readingWork={id:'work'};app.prepareImmersiveReader();assert.equal(app.readerWidth,'680');assert.equal(app.readerTheme,'sepia');assert.equal(app.readerBrightness,75);
 app.userSession={user:{id:'b'}};app.prepareImmersiveReader();assert.equal(app.readerWidth,'1100');assert.equal(app.readerTheme,'gray');
 app.userSession={user:{id:'a'}};app.prepareImmersiveReader();assert.equal(app.readerWidth,'680');
});
test('retry renews only the failed page and stale load events cannot mark the next chapter ready',async()=>{
    const app=setup();const page={storage_path:'two.jpg'};app.activeChapter={id:'a',source:'remote',storagePages:[{},page]};app.pageURLs=['one','two'];app.readerFailedPages={1:true};
    app.cloudAPI=()=>({signedURLs:async pages=>{assert.equal(pages.length,1);assert.equal(pages[0],page);return ['renewed'];}});
    await app.retryReaderPage(1);assert.equal(app.pageURLs[0],'one');assert.equal(app.pageURLs[1],'renewed');assert.equal(app.readerRetries[1],1);
    app.readerPageReady({target:{dataset:{chapter:'old'}}},0);assert.equal(app.readerLoadedPages[0],undefined);
});

test('start from beginning ignores display order and opens the first chapter at page zero', async () => {
    const app=setup();app.dexChapters=[dex('three','3'),dex('one','1'),dex('two','2')];
    app.readingProgress={'mangadex:work':{chapterId:'three',page:8}};
    let opened;app.openChapter=async(chapter,page)=>{opened={id:chapter.id,page};};
    await app.startWorkReading();assert.deepEqual(opened,{id:'one',page:0});
    assert.equal(app.currentWorkProgress.page,8);
});

test('guest can search editions and load chapter feeds without authentication', async () => {
    const app = setup();app.userSession=null;app.dexQuery='Berserk';
    app._mangaDexAPI={search:async()=>({data:[{id:'manga',title:'Berserk'}]}),feed:async()=>({data:[dex('one','1')],nextOffset:1,hasMore:false,total:1})};
    await app.searchMangaDex();assert.equal(app.dexResults.length,1);
    await app.selectDexManga(app.dexResults[0]);assert.equal(app.dexChapters.length,1);
    assert.equal(app.dexError,'');
});

test('full chapter search follows every page, deduplicates IDs and never downloads chapter images', async () => {
    const app = setup(); const offsets = [];
    app._mangaDexAPI = { feed: async (id, lang, offset) => {
        offsets.push(offset); assert.equal(lang, 'pt-br');
        return offset === 0 ? { data: [dex('one', '1')], nextOffset: 100, total: 201, hasMore: true }
            : offset === 100 ? { data: [dex('one', '1'), dex('two', '2')], nextOffset: 200, total: 201, hasMore: true }
            : { data: [dex('three', '3')], nextOffset: 201, total: 201, hasMore: false };
    }, pages: () => assert.fail('Do not preload images') };
    await app.loadDexChapters();
    assert.deepEqual(offsets, [0, 100, 200]); assert.equal(app.dexChapters.length, 3);
    assert.equal(app.dexHasMore, false); assert.equal(app.dexLoadingAll, false);
});

test('partial search survives a connection failure and resumes at the failed offset', async () => {
    const app = setup(); let offline = true; const offsets = [];
    app._mangaDexAPI = { feed: async (id, lang, offset) => {
        offsets.push(offset);
        if (offset && offline) throw new Error('offline');
        return offset ? { data: [dex('two', '2')], nextOffset: 101, hasMore: false }
            : { data: [dex('one', '1')], nextOffset: 100, hasMore: true };
    } };
    await app.loadDexChapters(); assert.equal(app.dexChapters.length, 1); assert.equal(app.dexHasMore, true);
    offline = false; await app.loadDexChapters(true, true);
    assert.deepEqual(offsets, [0, 100, 100]); assert.equal(app.dexChapters.length, 2); assert.equal(app.dexError, '');
});

test('cancelled full search cannot append a late response to another work', async () => {
    const app = setup(); let release;
    app._mangaDexAPI = { feed: () => new Promise(resolve => { release = resolve; }) };
    const pending = app.loadDexChapters(); while (!release) await Promise.resolve();
    app.cancelMangaDex(); app.readingWork = { id: 'other' }; app.dexChapters = [];
    release({ data: [dex('old', '1')], nextOffset: 100, hasMore: true }); await pending;
    assert.equal(app.dexChapters.length, 0); assert.equal(app.dexLoading, false);
});

test('nonadvancing pagination stops without repeatedly hitting the provider', async () => {
    const app = setup(); let calls = 0;
    app._mangaDexAPI = { feed: async () => { calls++; return { data: [], nextOffset: 0, hasMore: true }; } };
    await app.loadDexChapters(); assert.equal(calls, 1); assert.match(app.dexError, /paginação inválida/);
});

test('next chapter skips alternate group versions while keeping the current version selected', async () => {
    const app = setup();
    app.dexChapters = [dex('one-A', '1'), dex('one-B', '1', 'B'), dex('two-A', '2'), dex('two-B', '2', 'B')];
    app.activeChapter = app.dexChapters[1]; let opened;
    app.openChapter = async chapter => { opened = chapter; };
    assert.equal(app.chapterIndex, 0); assert.equal(app.readerChapterSequence.length, 2);
    await app.navigateReaderChapter(1); assert.equal(opened.id, 'two-B');
});

test('navigation waits for an already running feed rather than creating a competing request', async () => {
    const app = setup(); app.dexChapters = [dex('one', '1')]; app.activeChapter = app.dexChapters[0]; app.dexHasMore = true;
    let finish, opened;
    app._dexFeedPromise = new Promise(resolve => { finish = () => { app.dexChapters.push(dex('two', '2')); app.dexHasMore = false; resolve(); }; });
    app.loadDexChapters = () => assert.fail('Must reuse existing request');
    app.openChapter = async chapter => { opened = chapter; };
    const pending = app.navigateReaderChapter(1); finish(); await pending;
    assert.equal(opened.id, 'two'); assert.equal(app.readerNavigating, false);
});

test('jump to a page clamps bounds, saves progress and scrolls to that exact page in vertical mode', async () => {
    const app = setup(); app.activeChapter = { id: 'local', source: 'local' }; app.pageURLs = ['a', 'b', 'c'];
    let selector, scrolled = false, saved = false;
    app.saveReadingProgress = () => { saved = true; };
    app.$refs = { readerScroll: { querySelector: value => { selector = value; return { scrollIntoView: () => { scrolled = true; } }; } } };
    await app.jumpReaderPage(99);
    assert.equal(app.readerPage, 2); assert.equal(selector, '[data-page="2"]'); assert.equal(saved, true); assert.equal(scrolled, true);
});

test('chapter search includes group and decimal chapter numbers and switching to the current chapter preserves its page', async () => {
    const app = setup(); app.dexChapters = [dex('one', '10.5', 'Team'), dex('two', '11', 'Other')];
    app.readerChapterSearch = '10.5'; assert.equal(app.visibleReaderChapters.length, 1);
    app.readerChapterSearch = 'team'; assert.equal(app.visibleReaderChapters[0].id, 'one');
    app.activeChapter = app.dexChapters[0]; app.readerPage = 6; app.readerDrawerOpen = true;
    app.openChapter = () => assert.fail('Do not reopen current chapter');
    await app.chooseReaderChapter(app.activeChapter); assert.equal(app.readerPage, 6); assert.equal(app.readerDrawerOpen, false);
});
