const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function setup() {
    const context = { window: {} }; vm.createContext(context);
    vm.runInContext(fs.readFileSync('continue-reading.js', 'utf8'), context);
    const mixin = context.window.continueReadingMixin;
    const app = { ...mixin.data(), ...mixin.methods, userSession: { user: { id: 'a' } },
        catalog: [{ id: 'work', title: 'Book', type: 'Mangá' }], readingProgress: {}, chapters: [], dexChapters: [] };
    Object.defineProperty(app, 'recentReadings', { get: () => mixin.computed.recentReadings.call(app) });
    app.openWork = async work => { app.readingWork = work; app._workRequest = (app._workRequest || 0) + 1; };
    app.loadReadingProgress = async () => {};
    return app;
}
const uploaded = { chapterId: 'uploaded', remote: true, page: 7, updatedAt: '2026-10-18T10:00:00Z' };
const external = { chapterId: 'dex', source: 'mangadex', mangaId: 'edition', number: '3', language: 'pt-br', page: 11, updatedAt: '2026-10-18T11:00:00Z' };

test('home shows latest source per work, orders recent reads and excludes deleted works and other account state', () => {
    const app = setup();
    app.readingProgress = { work: uploaded, 'mangadex:work': external, deleted: uploaded };
    assert.equal(app.recentReadings.length, 1); assert.equal(app.recentReadings[0].progress.chapterId, 'dex');
    app.catalog.push({ id: 'second', type: 'Manhwa', title: 'Second' });
    app.readingProgress.second = { ...uploaded, updatedAt: '2026-10-18T12:00:00Z' };
    assert.equal(app.recentReadings[0].work.id, 'second');
    app.userSession = null; assert.equal(app.recentReadings.length, 0);
});

test('resume opens an uploaded chapter at its saved page', async () => {
    const app = setup(); app.readingProgress.work = uploaded;
    app.chapters = [{ id: 'uploaded', published: true }]; let opened;
    app.openChapter = async (chapter, page) => { opened = { chapter, page }; };
    await app.resumeReading(app.recentReadings[0]);
    assert.equal(opened.chapter.id, 'uploaded'); assert.equal(opened.page, 7); assert.equal(app.resumeBusy, false);
});

test('resume restores MangaDex edition and language and opens saved chapter outside feed page', async () => {
    const app = setup(); app.readingProgress['mangadex:work'] = external; let opened;
    app.loadDexChapters = async () => { assert.equal(app.dexSelected.id, 'edition'); assert.equal(app.dexLanguage, 'pt-br'); };
    app.openChapter = async (chapter, page) => { opened = { chapter, page }; };
    await app.resumeReading(app.recentReadings[0]);
    assert.equal(opened.chapter.id, 'dex'); assert.equal(opened.chapter.source, 'mangadex'); assert.equal(opened.page, 11);
});

test('removed uploaded chapter reports unavailability instead of starting a different chapter', async () => {
    const app = setup(); app.readingProgress.work = uploaded;
    app.chapters = [{ id: 'another', published: true }]; app.openChapter = () => assert.fail('wrong chapter');
    await app.resumeReading(app.recentReadings[0]); assert.match(app.readerError, /não está mais disponível/);
});

test('account change while opening cannot resume the previous account reading', async () => {
    const app = setup(); app.readingProgress.work = uploaded; let release;
    app.openWork = work => { app.readingWork = work; app._workRequest = 1; return new Promise(resolve => { release = resolve; }); };
    app.openChapter = () => assert.fail('stale reading');
    const pending = app.resumeReading(app.recentReadings[0]);
    app.userSession = { user: { id: 'b' } }; release(); await pending;
    assert.equal(app.resumeBusy, false);
});
