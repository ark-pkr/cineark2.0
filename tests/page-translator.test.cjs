const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const modulePromise = import('../scripts/page-translator.mjs');
const chapter = '11111111-1111-4111-8111-111111111111', user = '22222222-2222-4222-8222-222222222222';
const path = chapter + '/page.jpg';
const value = { language: 'English', note: '', blocks: [{ original: 'Hello', translation: 'Olá' }] };
function req(body = {}, headers = {}) {
    return new Request('https://cine-ark.example/api/translate-page', { method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid.jwt.token', ...headers },
        body: JSON.stringify({ chapterId: chapter, pageIndex: 0, direction: 'rtl', ...body }) });
}
async function setup(options = {}) {
    const { createPageTranslator } = await modulePromise; const calls = [];
    const handler = createPageTranslator({ supabaseUrl: 'https://project.supabase.co', anonKey: 'public-key', apiKey: 'test-server-key',
        fetcher: async (url, init) => {
            const target = String(url); calls.push({ target, init });
            if (options.fetcher) { const result = await options.fetcher(target, init); if (result) return result; }
            if (target.endsWith('/auth/v1/user')) return Response.json({ id: user });
            if (target.includes('/rest/v1/')) return Response.json([{ storage_path: path }]);
            if (target.includes('/object/sign/') && init.method === 'POST') return Response.json({ signedURL: '/object/sign/ark-pages/' + path + '?token=example' });
            if (target.includes('/object/sign/')) return new Response('image-bytes', { headers: { 'Content-Type': 'image/jpeg' } });
            if (target.startsWith('https://generativelanguage.googleapis.com/')) return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(value) }] } }] });
            throw new Error('Unexpected host');
        }, ...options.config });
    return { handler, calls };
}

test('translation rejects unauthenticated, arbitrary URL, oversized and cross-origin requests before external access', async () => {
    const { handler, calls } = await setup();
    assert.equal((await handler(req({}, { Authorization: '' }))).status, 401);
    assert.equal((await handler(req({ url: 'http://127.0.0.1/private' }))).status, 400);
    assert.equal((await handler(req({ chapterId: 'invalid' }))).status, 400);
    assert.equal((await handler(req({ direction: 'rtl', extra: 'x'.repeat(3000) }))).status, 413);
    assert.equal((await handler(req({}, { Origin: 'https://attacker.example' }))).status, 403);
    assert.equal(calls.length, 0);
});

test('translation authenticates and uses reader RLS before sending an image to Gemini, never forwarding the JWT', async () => {
    const { handler, calls } = await setup();
    const response = await handler(req()); assert.equal(response.status, 200);
    assert.equal((await response.json()).blocks[0].translation, 'Olá');
    assert.equal(calls[1].init.headers.Authorization, 'Bearer valid.jwt.token');
    const google = calls.find(call => call.target.includes('googleapis.com'));
    assert.equal(google.init.headers.Authorization, undefined);
    assert.equal(google.init.headers['x-goog-api-key'], 'test-server-key');
    assert.ok(!google.init.body.includes('valid.jwt.token'));
    assert.equal(JSON.parse(google.init.body).contents[0].parts[1].inlineData.mimeType, 'image/jpeg');
    assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('a page hidden by RLS cannot cause an image fetch or paid call', async () => {
    const { handler, calls } = await setup({ fetcher: target => target.includes('/rest/v1/') ? Response.json([]) : null });
    assert.equal((await handler(req())).status, 404);
    assert.equal(calls.length, 2);
});

test('missing key reports setup without invoking Gemini', async () => {
    const { handler, calls } = await setup({ config: { apiKey: '' } });
    assert.equal((await handler(req())).status, 503);
    assert.ok(!calls.some(call => call.target.includes('googleapis.com')));
});

test('signed image response cannot redirect the server to an arbitrary host', async () => {
    const { handler, calls } = await setup({ fetcher: (target, init) => target.includes('/object/sign/') && init.method === 'POST'
        ? Response.json({ signedURL: 'https://attacker.example/picture.jpg' }) : null });
    assert.equal((await handler(req())).status, 502);
    assert.ok(calls.every(call => !call.target.includes('attacker.example')));
});

test('successful translations are reused but every request still checks access', async () => {
    const { handler, calls } = await setup();
    await handler(req()); const second = await handler(req());
    assert.equal((await second.json()).cached, true);
    assert.equal(calls.filter(call => call.target.includes('googleapis.com')).length, 1);
    assert.equal(calls.filter(call => call.target.endsWith('/auth/v1/user')).length, 2);
});

test('Gemini quota failure does not expose provider body or cache a failed result', async () => {
    const { handler } = await setup({ fetcher: target => target.includes('googleapis.com') ? Response.json({ secret: 'provider-secret' }, { status: 429 }) : null });
    const response = await handler(req()); assert.equal(response.status, 429);
    assert.ok(!(await response.text()).includes('provider-secret'));
});

test('truncated model output is rejected', async () => {
    const { handler } = await setup({ fetcher: target => target.includes('googleapis.com') ? Response.json({ candidates: [{ finishReason: 'MAX_TOKENS' }] }) : null });
    assert.equal((await handler(req())).status, 502);
});

test('local Live Server CORS preflight permits only the required headers', async () => {
    const { handler, calls } = await setup();
    const response = await handler(new Request('http://127.0.0.1:8787/api/translate-page', { method: 'OPTIONS', headers: { Origin: 'http://127.0.0.1:5500' } }));
    assert.equal(response.status, 204); assert.equal(response.headers.get('access-control-allow-origin'), 'http://127.0.0.1:5500');
    assert.equal(calls.length, 0);
});

test('identical concurrent requests are grouped into a single paid call', async () => {
    let release;
    const { handler, calls } = await setup({ fetcher: target => target.includes('googleapis.com') ? new Promise(resolve => {
        release = () => resolve(Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(value) }] } }] }));
    }) : null });
    const first = handler(req());
    while (!release) await Promise.resolve();
    const second = handler(req());
    // Let the second request authenticate and join the in-flight request.
    for (let i = 0; i < 60; i++) await Promise.resolve();
    release(); const results = await Promise.all([first, second]);
    assert.ok(results.every(response => response.status === 200));
    assert.equal(calls.filter(call => call.target.includes('googleapis.com')).length, 1);
});

test('per-reader quota blocks additional uncached pages', async () => {
    const { handler, calls } = await setup({ fetcher: (target, init) => {
        const url = new URL(target);
        if (target.includes('/rest/v1/')) return Response.json([{ storage_path: chapter + '/page' + url.searchParams.get('page_index').slice(3) + '.jpg' }]);
        if (target.includes('/object/sign/') && init.method === 'POST') return Response.json({ signedURL: url.pathname.replace('/storage/v1', '') + '?token=example' });
        return null;
    } });
    for (let i = 0; i < 20; i++) assert.equal((await handler(req({ pageIndex: i }))).status, 200);
    assert.equal((await handler(req({ pageIndex: 20 }))).status, 429);
    assert.equal((await handler(req({ pageIndex: 0 }))).status, 200);
    assert.equal(calls.filter(call => call.target.includes('googleapis.com')).length, 20);
});

function browser(fetcher) {
    const storage = new Map();
    const context = { window: { location: { hostname: 'cine-ark.example' } }, AbortController, setTimeout: () => 0, clearTimeout() {},
        _supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'jwt', user: { id: user } } } }) } }, fetch: fetcher,
        localStorage: { getItem: key => storage.get(key), setItem: (key, data) => storage.set(key, data) } };
    vm.createContext(context); vm.runInContext(fs.readFileSync('page-translation.js', 'utf8'), context);
    const app = { ...context.window.pageTranslationMixin.data(), ...context.window.pageTranslationMixin.methods,
        userSession: { user: { id: user } }, activeChapter: { id: chapter, source: 'remote' }, readerPage: 3, readingDirection: 'rtl' };
    return { app, storage };
}

test('reader sends identifiers only and reuses account-specific saved translation', async () => {
    let calls = 0;
    const { app, storage } = browser(async (url, options) => {
        calls++; assert.equal(url, '/api/translate-page');
        assert.deepEqual(JSON.parse(options.body), { chapterId: chapter, pageIndex: 3, direction: 'rtl' });
        return Response.json(value);
    });
    await app.translateReaderPage(); await app.translateReaderPage();
    assert.equal(calls, 1); assert.equal(app.pageTranslation.blocks[0].translation, 'Olá');
    assert.ok(storage.has('ark-page-translations:' + user));
});

test('switching chapter or account discards a pending translation', async () => {
    let release; const { app, storage } = browser(() => new Promise(resolve => { release = resolve; }));
    const pending = app.translateReaderPage();
    while (!release) await Promise.resolve();
    app.cancelPageTranslation(); app.userSession = { user: { id: 'other' } };
    release(Response.json(value)); await pending;
    assert.equal(app.pageTranslation, null); assert.equal(storage.size, 0);
});
