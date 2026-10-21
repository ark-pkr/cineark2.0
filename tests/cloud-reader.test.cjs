const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');

function backend({ query = () => ({}), storage = {} } = {}) {
    const calls = [];
    class Query {
        constructor(table) { this.table = table; this.operation = 'select'; this.filters = []; }
        select(columns) { this.columns = columns; return this; }
        insert(value) { this.operation = 'insert'; this.value = value; return this; }
        update(value) { this.operation = 'update'; this.value = value; return this; }
        upsert(value, options) { this.operation = 'upsert'; this.value = value; this.options = options; return this; }
        delete() { this.operation = 'delete'; return this; }
        eq(...args) { this.filters.push(args); return this; }
        order(value) { this.sort = value; return this; }
        range(from, to) { this.from = from; this.to = to; return this; }
        single() { this.one = true; return this; }
        then(resolve, reject) {
            calls.push({ type: 'query', ...this });
            return Promise.resolve().then(() => query(this)).then(value => ({ data: this.one ? { id: 'chapter' } : [], error: null, ...value })).then(resolve, reject);
        }
    }
    const bucket = {};
    for (const method of ['upload', 'remove', 'list', 'createSignedUrls']) bucket[method] = async (...args) => {
        calls.push({ type: method, args });
        if (storage[method]) return storage[method](...args);
        return { data: [], error: null };
    };
    const client = { from: table => new Query(table), storage: { from: () => bucket } };
    const context = { window: {}, crypto };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync('public/assets/js/cloud-reader.js', 'utf8'), context);
    return { api: new context.window.ArkCloudReader(client), calls };
}
const upload = () => ({ workId: 'work', number: 1, title: 'First',
    files: [{ type: 'image/png' }, { type: 'image/jpeg' }], dimensions: [{ width: 100, height: 200 }, { width: 150, height: 250 }] });

test('lazy ZIP page decoding waits for the prior image upload and stores its dimensions',async()=>{
 let decoded=0,uploaded=0;
 const {api,calls}=backend({storage:{upload:async()=>{assert.equal(decoded,uploaded+1);uploaded++;return{};}}});
 await api.upload({...upload(),files:[{},{}],dimensions:undefined,readPage:async()=>{assert.equal(decoded,uploaded);decoded++;return {file:{type:'image/webp'},dimensions:{width:77,height:88}};}});
 assert.equal(uploaded,2);const pages=calls.find(call=>call.table==='ark_chapter_pages'&&call.operation==='insert');assert.equal(pages.value[0].width,77);assert.match(pages.value[0].storage_path,/\.webp$/);
});

test('chapter is published only after every file and page record is stored', async () => {
    const { api, calls } = backend();
    const chapter = await api.upload(upload());
    const publication = calls.findIndex(c => c.operation === 'update' && c.value.published);
    const pageInsert = calls.findIndex(c => c.table === 'ark_chapter_pages' && c.operation === 'insert');
    const files = calls.filter(c => c.type === 'upload');
    assert.equal(files.length, 2);
    assert.equal(files[0].args[2].upsert, false);
    assert.ok(publication > pageInsert);
    assert.ok(pageInsert > calls.lastIndexOf(files[1]));
    assert.equal(chapter.source, 'remote');
    assert.equal(chapter.pageCount, 2);
    assert.deepEqual(Array.from(calls[pageInsert].value, p => p.page_index), [0, 1]);
});

test('failed upload unpublishes and cleans attempted files without publishing partial chapter', async () => {
    let uploaded = 0;
    const { api, calls } = backend({ storage: { upload: async () => ({ error: ++uploaded === 2 ? new Error('connection lost') : null }) } });
    await assert.rejects(api.upload(upload()), /connection lost/);
    assert.equal(calls.some(c => c.operation === 'update' && c.value.published), false);
    assert.equal(calls.find(c => c.type === 'remove').args[0].length, 2);
    assert.ok(calls.some(c => c.operation === 'delete' && c.table === 'ark_chapters'));
});

test('failed cleanup keeps chapter metadata available for a later retry', async () => {
    const { api, calls } = backend({ storage: {
        upload: async () => ({ error: new Error('upload failed') }), remove: async () => ({ error: new Error('offline') })
    } });
    await assert.rejects(api.upload(upload()), /rascunho/);
    assert.equal(calls.some(c => c.operation === 'delete'), false);
});

test('account change aborts upload and does not clean using the new account', async () => {
    let current = true;
    const { api, calls } = backend({ storage: { upload: async () => { current = false; return { error: null }; } } });
    await assert.rejects(api.upload({ ...upload(), isCurrent: () => current }), /conta mudou/);
    assert.equal(calls.filter(c => c.type === 'upload').length, 1);
    assert.equal(calls.some(c => c.type === 'remove'), false);
    assert.equal(calls.some(c => c.operation === 'update'), false);
});

test('lost publication response does not remove files when hiding the chapter also fails', async () => {
    const { api, calls } = backend({ query: q => q.operation === 'update' ? { error: new Error('offline') } : {} });
    await assert.rejects(api.upload(upload()), /Confira a lista/);
    assert.equal(calls.some(c => c.type === 'remove'), false);
    assert.equal(calls.some(c => c.operation === 'delete'), false);
});

test('signed pages preserve reading order even if service returns another order', async () => {
    const { api } = backend({ storage: { createSignedUrls: async paths => ({ data: Array.from(paths).reverse().map(path => ({ path, signedUrl: 'signed:' + path })), error: null }) } });
    assert.deepEqual(Array.from(await api.signedURLs([{ storage_path: 'a' }, { storage_path: 'b' }])), ['signed:a', 'signed:b']);
});

test('missing signed URL fails instead of rendering an empty page', async () => {
    const { api } = backend({ storage: { createSignedUrls: async () => ({ data: [{ path: 'a', error: 'denied' }], error: null }) } });
    await assert.rejects(api.signedURLs([{ storage_path: 'a' }]), /autorizar/);
});

test('pagination loads chapters beyond the first server page', async () => {
    const { api, calls } = backend({ query: q => ({ data: q.from === 0 ? Array.from({ length: 500 }, (_, i) => ({ id: String(i), work_id: 'w', number: i, ark_chapter_pages: [{ count: 4 }] })) : [{ id: 'last', work_id: 'w', number: 501 }] }) });
    const chapters = await api.chapters('w');
    assert.equal(chapters.length, 501);
    assert.equal(chapters[0].pageCount, 4);
    assert.equal(calls[1].from, 500);
});

test('deletion keeps draft metadata when a file could not be removed', async () => {
    const { api, calls } = backend({ storage: {
        list: async () => ({ data: [{ name: 'page.png' }], error: null }),
        remove: async () => ({ error: new Error('offline') })
    } });
    await assert.rejects(api.deleteChapter('chapter'), /offline/);
    assert.equal(calls[0].value.published, false);
    assert.equal(calls.some(c => c.operation === 'delete'), false);
});

function readerSetup() {
    const storage = new Map();
    const context = { window: {}, indexedDB: { open: () => ({}) },
        localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
        setTimeout: () => 0, clearTimeout() {}, document: { body: { style: {} } } };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync('public/assets/js/reader.js', 'utf8'), context);
    const app = { ...context.window.readerMixin.data(), ...context.window.readerMixin.methods,
        userSession: { user: { id: 'reader-a' } }, readingWork: { id: 'work' }, activeChapter: { id: 'chapter', source: 'remote' } };
    return { app, storage };
}

test('progress written while another save is in flight is sent in order', async () => {
    const { app, storage } = readerSetup();
    const writes = []; let release;
    app._cloudAPI = { saveProgress: row => {
        writes.push(row);
        return writes.length === 1 ? new Promise(resolve => { release = resolve; }) : Promise.resolve();
    } };
    app.readerPage = 2; app.saveReadingProgress();
    const pending = app.flushReadingProgress();
    app.readerPage = 7; app.saveReadingProgress();
    release(); await pending;
    assert.deepEqual(writes.map(row => row.page_index), [2, 7]);
    assert.equal(app.progressSync, 'saved');
    assert.equal(JSON.parse(storage.get('ark-reading:reader-a')).work.syncPending, false);
});

test('failed progress sync remains durable locally and can be retried', async () => {
    const { app, storage } = readerSetup();
    app._cloudAPI = { saveProgress: async () => { throw new Error('offline'); } };
    app.readerPage = 4; app.saveReadingProgress(); await app.flushReadingProgress();
    assert.equal(app.progressSync, 'pending');
    assert.equal(JSON.parse(storage.get('ark-reading:reader-a')).work.syncPending, true);
    app._cloudAPI.saveProgress = async () => {};
    await app.flushReadingProgress();
    assert.equal(app.readingProgress.work.syncPending, false);
});

test('remote progress restores another device and preserves a newer unsynced local page', async () => {
    const { app } = readerSetup();
    app.readingProgress.local = { chapterId: 'new', page: 9, remote: true, syncPending: true, updatedAt: '2026-10-18T12:00:00Z' };
    const writes = [];
    app._cloudAPI = { progress: async () => [
        { work_id: 'work', chapter_id: 'remote', page_index: 6, updated_at: '2026-10-18T11:00:00Z' },
        { work_id: 'local', chapter_id: 'old', page_index: 2, updated_at: '2026-10-18T11:00:00Z' }
    ], saveProgress: async row => { writes.push(row); } };
    await app.loadReadingProgress();
    assert.equal(app.readingProgress.work.page, 6);
    assert.equal(app.readingProgress.local.page, 9);
    assert.equal(writes[0].chapter_id, 'new');
});

test('progress response arriving after an account switch is discarded', async () => {
    const { app } = readerSetup(); let release;
    app._cloudAPI = { progress: () => new Promise(resolve => { release = resolve; }) };
    const pending = app.loadReadingProgress();
    app.userSession = { user: { id: 'reader-b' } }; app.readingProgress = {};
    release([{ work_id: 'private', chapter_id: 'a', page_index: 10 }]);
    await pending;
    assert.deepEqual(app.readingProgress, {});
});

test('chapter response arriving after an account switch cannot open the previous account pages', async () => {
    const { app } = readerSetup(); let release;
    app.activeChapter = null;
    app._cloudAPI = {
        pages: () => new Promise(resolve => { release = resolve; }),
        signedURLs: async () => ['signed:private']
    };
    const pending = app.openChapter({ id: 'private', source: 'remote', published: true });
    app.userSession = { user: { id: 'reader-b' } }; app.readingWork = null;
    release([{ storage_path: 'private/page.png' }]); await pending;
    assert.equal(app.activeChapter, null);
    assert.equal(app.pageURLs.length, 0);
});
