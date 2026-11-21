const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');

const hash = source => `'sha256-${crypto.createHash('sha256').update(source, 'utf8').digest('base64')}'`;
const settings = { supabaseUrl: 'https://example.supabase.co', supabaseAnonKey: 'public' };

test('CSP allows every inline script and handler of index.html by hash, never by unsafe-inline', async () => {
    const { contentSecurityPolicy } = await import('../scripts/security-headers.mjs');
    const html = fs.readFileSync('public/index.html', 'utf8');
    const policy = contentSecurityPolicy(html, settings);
    const scriptSrc = policy.split('; ').find(d => d.startsWith('script-src '));
    assert.doesNotMatch(scriptSrc, /'unsafe-inline'/);
    for (const [, body] of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) assert.ok(scriptSrc.includes(hash(body)));
    for (const [, handler] of html.matchAll(/\son[a-z]+="([^"]*)"/g)) assert.ok(scriptSrc.includes(hash(handler)));
    assert.match(policy, /connect-src [^;]*https:\/\/example\.supabase\.co [^;]*wss:\/\/example\.supabase\.co/);
    assert.match(policy, /frame-ancestors 'none'/);
    assert.match(policy, /object-src 'none'/);
});

test('work pages send a CSP that covers their per-work inline data script', async () => {
    const { createWorkPageHandler } = await import('../scripts/work-page.mjs');
    const { CSP_HEADER } = await import('../scripts/security-headers.mjs');
    const handler = createWorkPageHandler({
        settings,
        loadTemplate: async () => '<head><title>Old</title></head><div id="app"></div>',
        fetcher: async () => Response.json([{ slug: 'test', title: 'Obra', type: 'Manga', genres: [] }])
    });
    const response = await handler(new Request('https://cineark.com.br/obra/test'));
    assert.equal(response.status, 200);
    const html = await response.text();
    const [, inline] = html.match(/<script>([\s\S]*?)<\/script>/);
    assert.ok(response.headers.get(CSP_HEADER).includes(hash(inline)));
});
