const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');

function setup(storage=new Map(),local=false) {
    const listeners={},work={id:'work',slug:'test',title:'Test'};
    const sessionStorage={getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)};
    const context={window:{location:{hostname:local?'127.0.0.1':'cineark.com.br',pathname:local?'/':'/obra/test',hash:local?'#/obra/test':'',href:local?'http://127.0.0.1:5500/':'https://cineark.com.br/obra/test'},history:{replaceState(){}},addEventListener:(name,fn)=>listeners[name]=fn,removeEventListener(){}},sessionStorage,
        indexedDB:{open:()=>({})},localStorage:{getItem:()=>null,setItem(){}},setTimeout:()=>0,clearTimeout(){},URL,AbortController,
        document:{body:{style:{}},querySelector:()=>null,addEventListener(){},removeEventListener(){}}};
    vm.createContext(context);
    for(const name of ['reader','discovery'])vm.runInContext(fs.readFileSync('public/assets/js/'+name+'.js','utf8'),context);
    const reader=context.window.readerMixin,discovery=context.window.discoveryMixin;
    const app={...reader.data(),...discovery.data(),...reader.methods,...discovery.methods,userSession:null,catalog:[work],$nextTick:async()=>{},dexChapters:[],
        persistReadingProgress(){},flushReadingProgress(){},observePages(){},cloudAPI:()=>({pages:async()=>Array.from({length:8},()=>({width:800,height:1200})),signedURLs:async()=>Array.from({length:8},(_,i)=>'https://example.com/'+i)}),
        async openWork(item){this.readingWork=item;this.chapters=[{id:'chapter',source:'remote',published:true,number:3}];this._workRequest=1;}};
    return {app,context,storage,listeners,reader,work};
}

test('refresh reopens the exact guest chapter and offset on public and Live Server work routes',async()=>{
    for(const local of [false,true]) {
        const first=setup(new Map(),local);first.app.readingWork=first.work;first.app.activeChapter={id:'chapter',source:'remote',number:3};first.app.readerPage=5;first.app._readerPageOffset=.42;
        first.app.saveReadingProgress();
        const reload=setup(first.storage,local);await reload.app.restoreWorkRoute();
        assert.equal(reload.app.activeChapter.id,'chapter');assert.equal(reload.app.readerPage,5);assert.equal(reload.app._readerRestore.offset,.42);
    }
});

test('explicitly leaving the reader keeps the work page after the next refresh',async()=>{
    const {app,storage,work}=setup();await app.openWork(work);await app.openChapter(app.chapters[0],2);
    assert.ok(storage.has('ark-reader-location:guest'));app.closeReader();
    const reload=setup(storage);await reload.app.restoreWorkRoute();assert.equal(reload.app.activeChapter,null);
});

test('reader restoration is isolated by account and work',async()=>{
    const {app,storage,work}=setup();await app.openWork(work);await app.openChapter(app.chapters[0],2);
    const other=setup(storage);other.app.userSession={user:{id:'another'}};await other.app.restoreWorkRoute();assert.equal(other.app.activeChapter,null);
    const different=setup(storage);await different.app.openWork({...work,id:'different'});await different.app.restoreReaderLocation(different.app.readingWork);assert.equal(different.app.activeChapter,null);
});

test('external chapter beyond the initial feed reopens its saved edition without switching chapters',async()=>{
    const {app,storage,work}=setup();
    storage.set('ark-reader-location:guest',JSON.stringify({workId:'work',chapterId:'old-chapter',source:'mangadex',mangaId:'edition',number:42,language:'pt-br',page:3}));
    app.loadDexChapters=async()=>{app.dexChapters=[];};app.mangaDexAPI=()=>({pages:async id=>{assert.equal(id,'old-chapter');return ['a','b','c','d'];}});
    await app.openWork(work);await app.restoreReaderLocation(work);
    assert.equal(app.activeChapter.id,'old-chapter');assert.equal(app.activeChapter.mangaId,'edition');assert.equal(app.readerPage,3);
});

test('a removed chapter reports unavailability instead of opening a different chapter',async()=>{
    const {app,storage,work}=setup();storage.set('ark-reader-location:guest',JSON.stringify({workId:'work',chapterId:'removed',source:'remote',page:2}));
    await app.openWork(work);await app.restoreReaderLocation(work);assert.equal(app.activeChapter,null);assert.match(app.readerError,/disponível/);
});

test('progress synchronization cannot overwrite the saved tab offset during restoration',async()=>{
    const {app,storage,work}=setup();storage.set('ark-reader-location:guest',JSON.stringify({workId:'work',chapterId:'chapter',source:'remote',page:4,offset:.7}));
    await app.openWork(work);app._progressLoadingPromise=Promise.resolve().then(()=>{app.readingProgress.work={chapterId:'chapter',page:0};});
    await app.restoreReaderLocation(work);assert.equal(app.readerPage,4);assert.equal(app._readerRestore.offset,.7);
});

test('pagehide records the current position without closing the reader',async()=>{
    const {app,work,reader,listeners,storage}=setup();await app.openWork(work);await app.openChapter(app.chapters[0],1);
    reader.mounted.call(app);app.readerPage=6;app._readerPageOffset=.3;listeners.pagehide();
    assert.equal(JSON.parse(storage.get('ark-reader-location:guest')).page,6);assert.equal(app.activeChapter.id,'chapter');
});

test('another refresh before images load preserves the pending offset',async()=>{
    const {app,work,storage}=setup();await app.openWork(work);await app.openChapter(app.chapters[0],5);
    app._readerRestore={chapterId:'chapter',page:5,offset:.65};app._readerPageOffset=0;app.saveReadingProgress();
    assert.equal(JSON.parse(storage.get('ark-reader-location:guest')).offset,.65);
    const reload=setup(storage);await reload.app.restoreWorkRoute();assert.equal(reload.app._readerRestore.offset,.65);
});
