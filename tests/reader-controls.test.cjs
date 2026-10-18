const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function setup() {
    const storage = new Map();
    const context = { window: {}, indexedDB: { open: () => ({}) }, AbortController, setTimeout: () => 0, clearTimeout() {},
        localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) } };
    vm.createContext(context);
    for (const file of ['reader.js', 'mangadex.js', 'reader-controls.js']) vm.runInContext(fs.readFileSync(file, 'utf8'), context);
    const mixins = [context.window.readerMixin, context.window.mangadexMixin, context.window.readerControlsMixin];
    const app = { userSession: { user: { id: 'a' } }, readingWork: { id: 'work' }, $nextTick: async () => {} };
    for (const mixin of mixins) Object.assign(app, mixin.data(), mixin.methods);
    for (const mixin of mixins) for (const [name, getter] of Object.entries(mixin.computed || {})) Object.defineProperty(app, name, { get: () => getter.call(app) });
    app.readingWork = { id: 'work' }; app.dexSelected = { id: 'manga', title: 'Title' }; app.chapterSource = 'mangadex';
    return app;
}
const dex = (id, number, group = 'A') => ({ id, number, group, volume: '1', source: 'mangadex', published: true, mangaId: 'manga', language: 'pt-br' });

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
