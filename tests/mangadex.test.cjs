const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const shared = import('../supabase/functions/_shared/mangadex-proxy.mjs');
const mangaId = '11111111-1111-4111-8111-111111111111';
const chapterId = '22222222-2222-4222-8222-222222222222';
const url = query => 'http://127.0.0.1:8787/mangadex?' + query;
const ok = data => Response.json({ result: 'ok', ...data });

test('proxy restricts routes, UUIDs, methods and browser origins before making upstream requests', async () => {
    const { createMangaDexProxy } = await shared; let calls = 0;
    const handler = createMangaDexProxy({ spacing: 0, fetcher: async () => { calls++; throw new Error('Must not fetch'); } });
    for (const query of ['op=unknown&url=http://127.0.0.1', 'op=pages&id=invalid', 'op=image&id=' + chapterId + '&page=-1', 'op=feed&id=' + mangaId + '&language=invalid']) {
        const response = await handler(new Request(url(query))); assert.equal(response.status, 400);
    }
    assert.equal((await handler(new Request(url('op=search&q=test'), { headers: { Origin: 'https://unknown.example' } }))).status, 403);
    assert.equal((await handler(new Request(url('op=search&q=test'), { method: 'POST' }))).status, 405);
    assert.equal(calls, 0);
});

test('image allowlist rejects loopback, credentials, deceptive hosts and non-HTTPS URLs', async () => {
    const { safeImageHost } = await shared;
    for (const host of ['http://uploads.mangadex.org', 'https://127.0.0.1', 'https://uploads.mangadex.org.evil.example', 'https://name:password@uploads.mangadex.org', 'https://uploads.mangadex.org:8443'])
        assert.throws(() => safeImageHost(host));
    assert.equal(safeImageHost('https://uploads.mangadex.org').hostname, 'uploads.mangadex.org');
});

test('search is cached and never forwards reader credentials, cookies or Via headers', async () => {
    const { createMangaDexProxy } = await shared; let calls = 0;
    const handler = createMangaDexProxy({ spacing: 0, fetcher: async (target, options) => {
        calls++; assert.ok(target.startsWith('https://api.mangadex.org/manga?'));
        assert.equal(options.headers.Authorization, undefined); assert.equal(options.headers.Cookie, undefined); assert.equal(options.headers.Via, undefined);
        assert.equal(options.redirect, 'error'); assert.ok(options.headers['User-Agent'].startsWith('CINE-ARK'));
        return ok({ data: [{ id: mangaId, attributes: { title: { en: 'A Manga' }, altTitles: [{ 'pt-br': 'Um Mangá' }] } }] });
    } });
    const request = () => new Request(url('op=search&q=manga'), { headers: { Origin: 'http://127.0.0.1:5500', Authorization: 'Bearer private-token', Cookie: 'secret=value' } });
    const first = await handler(request()); const data = await first.json();
    assert.equal(first.headers.get('access-control-allow-origin'), 'http://127.0.0.1:5500');
    assert.equal(data.data[0].title, 'A Manga'); await handler(request()); assert.equal(calls, 1);
});

test('chapter feed filters PT-BR upstream and skips external, empty and unavailable chapters', async () => {
    const { createMangaDexProxy } = await shared;
    const handler = createMangaDexProxy({ spacing: 0, fetcher: async target => {
        const request = new URL(target); assert.equal(request.searchParams.get('translatedLanguage[]'), 'pt-br');
        return ok({ total: 150, data: [
            { id: chapterId, attributes: { chapter: '1.5', pages: 3, translatedLanguage: 'pt-br' }, relationships: [] },
            { id: 'external', attributes: { pages: 3, externalUrl: 'https://example.com' } },
            { id: 'empty', attributes: { pages: 0 } },
            { id: 'unavailable', attributes: { pages: 3, isUnavailable: true } }
        ] });
    } });
    const response = await handler(new Request(url('op=feed&id=' + mangaId + '&language=pt-br')));
    const data = await response.json(); assert.equal(data.data.length, 1); assert.equal(data.data[0].source, 'mangadex');
    assert.equal(data.data[0].number, '1.5'); assert.equal(data.nextOffset, 4); assert.equal(data.hasMore, true);
});

test('manifest and image routes reuse at-home metadata and stream through trusted image hosts', async () => {
    const { createMangaDexProxy } = await shared; const calls = [];
    const handler = createMangaDexProxy({ spacing: 0, fetcher: async target => {
        calls.push(target);
        if (target.includes('/at-home/')) return ok({ baseUrl: 'https://uploads.mangadex.org', chapter: { hash: 'abcdef1234', data: ['original.jpg'], dataSaver: ['small.jpg'] } });
        assert.equal(target, 'https://uploads.mangadex.org/data-saver/abcdef1234/small.jpg');
        return new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/jpeg' } });
    } });
    const manifest = await (await handler(new Request(url('op=pages&id=' + chapterId)))).json();
    assert.equal(manifest.pageCount, 1); assert.equal(manifest.baseUrl, undefined);
    const image = await handler(new Request(url('op=image&id=' + chapterId + '&page=0')));
    assert.equal(image.status, 200); assert.equal(image.headers.get('content-type'), 'image/jpeg');
    assert.equal((await image.arrayBuffer()).byteLength, 3); assert.equal(calls.filter(p => p.includes('/at-home/')).length, 1);
});

test('untrusted at-home hosts are rejected instead of fetching arbitrary image URLs', async () => {
    const { createMangaDexProxy } = await shared; let calls = 0;
    const handler = createMangaDexProxy({ spacing: 0, fetcher: async () => { calls++; return ok({ baseUrl: 'https://127.0.0.1', chapter: { hash: 'abc', data: ['page.jpg'] } }); } });
    const response = await handler(new Request(url('op=image&id=' + chapterId)));
    assert.equal(response.status, 502); assert.equal(calls, 1);
});

test('rate-limited upstream requests trigger a cooldown rather than automatic retries', async () => {
    const { createMangaDexProxy } = await shared; let calls = 0;
    const handler = createMangaDexProxy({ spacing: 0, fetcher: async () => { calls++; return new Response('', { status: 429 }); } });
    assert.equal((await handler(new Request(url('op=search&q=test')))).status, 429);
    assert.equal((await handler(new Request(url('op=search&q=another')))).status, 429); assert.equal(calls, 1);
});

function browser(fetcher = async () => { throw new Error('Unexpected request'); }) {
    const storage = new Map();
    const context = { window: { location: { hostname: '127.0.0.1' }, CINE_ARK_CONFIG: { supabaseUrl: 'https://project.supabase.co' } },
        URL, AbortController, DOMException, fetch: fetcher, setTimeout: () => 0, clearTimeout() {}, indexedDB: { open: () => ({}) },
        localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) }, document: { body: { style: {} } } };
    vm.createContext(context);
    for (const file of ['reader.js', 'mangadex.js']) vm.runInContext(fs.readFileSync('public/assets/js/' + file, 'utf8'), context);
    const app = { ...context.window.readerMixin.data(), ...context.window.mangadexMixin.data(),
        ...context.window.readerMixin.methods, ...context.window.mangadexMixin.methods,
        userSession: { user: { id: 'reader-a' } }, readingWork: { id: 'work' } };
    return { app, storage, API: context.window.ArkMangaDex };
}

test('browser obtains page URLs from its proxy and never calls MangaDex directly', async () => {
    const { API } = browser(async (target, options) => {
        assert.ok(target.startsWith('http://127.0.0.1:8787/mangadex?'));
        assert.equal(options.credentials, 'omit'); assert.equal(options.headers.Authorization, undefined);
        return { ok: true, json: async () => ({ pageCount: 2, quality: 'economy' }) };
    });
    const pages = await new API().pages(chapterId, 'economy');
    assert.equal(pages.length, 2); assert.equal(new URL(pages[1]).searchParams.get('page'), '1');
    assert.equal(new URL(pages[1]).searchParams.get('op'), 'image');
});

test('MangaDex progress stays separate from cloud progress and its database foreign keys', async () => {
    const { app, storage } = browser();
    app.readingProgress.work = { chapterId: 'uploaded-chapter', page: 7, remote: true, syncPending: false };
    app.activeChapter = { id: chapterId, source: 'mangadex', mangaId, number: '2', language: 'pt-br' }; app.readerPage = 3;
    app._cloudAPI = { saveProgress() { throw new Error('External progress must not be written to uploaded chapter tables'); } };
    app.saveReadingProgress(); await app.flushReadingProgress();
    assert.equal(app.readingProgress.work.page, 7);
    assert.equal(app.readingProgress['mangadex:work'].page, 3);
    assert.equal(app.readingProgress['mangadex:work'].remote, false);
    assert.equal(JSON.parse(storage.get('ark-reading:reader-a'))['mangadex:work'].chapterId, chapterId);
});

test('stale MangaDex search cannot update another work or another account', async () => {
    const { app } = browser(); let release;
    app._mangaDexAPI = { search: () => new Promise(resolve => { release = resolve; }) }; app.dexQuery = 'First work';
    const pending = app.searchMangaDex(); app.userSession = { user: { id: 'reader-b' } }; app.resetMangaDex({ title: 'Another work' });
    release({ data: [{ id: mangaId, title: 'First work' }] }); await pending;
    assert.equal(app.dexResults.length, 0); assert.equal(app.dexQuery, 'Another work'); assert.equal(app.dexLoading, false);
});

test('chapter pagination deduplicates editions by chapter ID without replacing prior pages', async () => {
    const { app } = browser(); app.dexSelected = { id: mangaId, title: 'A' };
    app.dexChapters = [{ id: 'first' }]; app.dexNextOffset = 100;
    app._mangaDexAPI = { feed: async (id, language, offset) => {
        assert.equal(offset, 100); assert.equal(language, 'pt-br');
        return { data: [{ id: 'first' }, { id: 'second' }], nextOffset: 200, hasMore: true };
    } };
    await app.loadDexChapters(true);
    assert.equal(app.dexChapters.length, 2); assert.equal(app.dexNextOffset, 200); assert.equal(app.dexHasMore, true);
});
