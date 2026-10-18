const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');

test('production server binds PORT, serves readiness and does not expose private files', async () => {
    const oldPort = process.env.PORT, oldOrigin = process.env.RENDER_EXTERNAL_URL;
    process.env.PORT = '18787'; process.env.RENDER_EXTERNAL_URL = 'https://cine-ark.example';
    const { server } = await import('../scripts/mangadex-server.mjs');
    try {
        if (!server.listening) await once(server, 'listening');
        const base = 'http://127.0.0.1:18787';
        assert.equal((await fetch(base + '/healthz')).status, 200);
        assert.match(await (await fetch(base)).text(), /mangadex.js/);
        assert.equal((await fetch(base + '/page-translation.js')).status, 200);
        assert.equal((await fetch(base + '/api/translate-page', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401);
        assert.equal((await fetch(base + '/api/translate-page', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'x'.repeat(3000) })).status, 413);
        for (const path of ['/.env', '/.env.local', '/.git/config', '/supabase/config.toml', '/package.json']) {
            assert.equal((await fetch(base + path)).status, 404);
        }
        // A same-origin HTTPS browser request must pass CORS behind Render's TLS proxy.
        const response = await fetch(base + '/mangadex?op=unknown', { headers: { Origin: 'https://cine-ark.example' } });
        assert.equal(response.status, 400);
        assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://cine-ark.example');
    } finally {
        await new Promise(resolve => server.close(resolve));
        if (oldPort === undefined) delete process.env.PORT; else process.env.PORT = oldPort;
        if (oldOrigin === undefined) delete process.env.RENDER_EXTERNAL_URL; else process.env.RENDER_EXTERNAL_URL = oldOrigin;
    }
});
