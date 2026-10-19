const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function setup() {
    const storage = new Map();
    const context = { window: {}, indexedDB: { open: () => ({}) }, setTimeout: () => 0, clearTimeout() {},
        localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) } };
    vm.createContext(context);
    for (const file of ['reader.js', 'external-progress.js', 'mangadex.js']) vm.runInContext(fs.readFileSync('public/assets/js/' + file, 'utf8'), context);
    const app = { ...context.window.readerMixin.data(), ...context.window.externalProgressMixin.data(), ...context.window.mangadexMixin.data(),
        ...context.window.readerMixin.methods, ...context.window.externalProgressMixin.methods, ...context.window.mangadexMixin.methods,
        readingWork: { id: 'work', title: 'Book' }, userSession: { user: { id: 'a' } },
        activeChapter: { id: 'chapter', source: 'mangadex', mangaId: 'manga', number: '3', language: 'pt-br' } };
    return { app, storage };
}
const row = (page = 4, updated = '2026-10-18T12:00:00Z') => ({ user_id: 'a', work_id: 'work', chapter_id: 'chapter',
    manga_id: 'manga', chapter_number: '3', language: 'pt-br', page_index: page, updated_at: updated });

test('MangaDex writes only the external table and preserves uploaded progress', async () => {
    const { app, storage } = setup(); const writes = [];
    app.readingProgress.work = { chapterId: 'uploaded', page: 7, remote: true, syncPending: false };
    app._cloudAPI = { saveDexProgress: async value => { writes.push(value); return value; }, saveProgress: () => assert.fail('wrong table') };
    app.readerPage = 8; app.saveReadingProgress(); await app.flushReadingProgress();
    assert.equal(writes[0].work_id, 'work'); assert.equal(writes[0].page_index, 8);
    assert.equal(app.readingProgress.work.page, 7);
    assert.equal(JSON.parse(storage.get('ark-reading:a'))['mangadex:work'].syncPending, false);
});

test('another device restores chapter, language, page and edition', async () => {
    const { app } = setup(); app.activeChapter = null;
    app._cloudAPI = { dexProgress: async () => [row()] };
    await app.loadDexProgress();
    app.loadDexChapters = async () => {};
    await app.setChapterSource('mangadex');
    assert.equal(app.dexSelected.id, 'manga'); assert.equal(app.dexLanguage, 'pt-br');
    let opened; app.openChapter = async (chapter, page) => { opened = { chapter, page }; };
    await app.continueMangaDex();
    assert.equal(opened.chapter.id, 'chapter'); assert.equal(opened.page, 4);
});

test('newer offline progress is migrated once and older remote progress cannot replace it', async () => {
    const { app } = setup(); let writes = 0;
    app.readingProgress['mangadex:work'] = { chapterId: 'chapter', mangaId: 'manga', source: 'mangadex', page: 9,
        number: '3', language: 'pt-br', syncPending: false, updatedAt: '2026-10-18T13:00:00Z' };
    app._cloudAPI = { dexProgress: async () => [row()], saveDexProgress: async value => { writes++; return value; } };
    await app.loadDexProgress(); await app.loadDexProgress();
    assert.equal(writes, 1); assert.equal(app.readingProgress['mangadex:work'].page, 9);
});

test('offline device accepts newer server winner returned by atomic upsert', async () => {
    const { app } = setup();
    app._cloudAPI = { saveDexProgress: async () => row(12, '2099-01-01T00:00:00Z') };
    app.readerPage = 3; app.saveReadingProgress(); await app.flushDexProgress();
    assert.equal(app.readingProgress['mangadex:work'].page, 12);
    assert.equal(app.readingProgress['mangadex:work'].syncPending, false);
});

test('missing table preserves local progress and retries after setup', async () => {
    const { app, storage } = setup();
    app._cloudAPI = { saveDexProgress: async () => { throw { code: 'PGRST205' }; } };
    app.readerPage = 5; app.saveReadingProgress(); await app.flushDexProgress();
    assert.match(app.dexProgressError, /mangadex-progress.sql/);
    assert.equal(JSON.parse(storage.get('ark-reading:a'))['mangadex:work'].syncPending, true);
    app._cloudAPI.saveDexProgress = async value => value;
    await app.flushDexProgress(); assert.equal(app.dexProgressSync, 'saved'); assert.equal(app.dexProgressError, '');
});

test('in-flight writes are ordered and cannot clear a newer page', async () => {
    const { app } = setup(); const writes = []; let release;
    app._cloudAPI = { saveDexProgress: value => {
        writes.push(value.page_index);
        return writes.length === 1 ? new Promise(resolve => { release = () => resolve(value); }) : Promise.resolve(value);
    } };
    app.readerPage = 2; app.saveReadingProgress(); const pending = app.flushDexProgress();
    app.readerPage = 6; app.saveReadingProgress(); release(); await pending;
    assert.deepEqual(writes, [2, 6]); assert.equal(app.readingProgress['mangadex:work'].page, 6);
});

test('a response for another account cannot populate or acknowledge progress', async () => {
    const { app } = setup(); let release;
    app._cloudAPI = { dexProgress: () => new Promise(resolve => { release = resolve; }) };
    const pending = app.loadDexProgress(); app.userSession = { user: { id: 'b' } }; app.readingProgress = {};
    release([row()]); await pending;
    assert.equal(Object.keys(app.readingProgress).length, 0);
});
