const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function setup(fetcher) {
    const saved = new Map();
    const context = { window: {}, URLSearchParams, AbortController, DOMException, TextEncoder, fetch: fetcher,
        setTimeout: () => 0, clearTimeout() {}, localStorage: { getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value) } };
    vm.createContext(context); vm.runInContext(fs.readFileSync('translation.js', 'utf8'), context);
    return { api: context.window.ArkTranslation, saved };
}
test('UTF-8 chunks stay below provider byte limit and preserve the entire original', () => {
    const { api } = setup();
    const source = ('Caçadores 🐉 fight monsters.\n\n' + 'A'.repeat(700)).repeat(3);
    const parts = api.chunks(source);
    assert.equal(Array.from(parts).join(''), source);
    for (const part of parts) assert.ok(Buffer.byteLength(part, 'utf8') <= 480);
});
test('translation uses Brazilian Portuguese and reuses successful translations', async () => {
    let calls = 0;
    const { api } = setup(async url => {
        calls++; const parsed = new URL(url); assert.equal(parsed.searchParams.get('langpair'), 'en|pt-BR');
        return { ok: true, json: async () => ({ responseStatus: 200, responseData: { translatedText: 'Caçadores lutam.' } }) };
    });
    assert.equal(await api.toPortuguese('Hunters fight.'), 'Caçadores lutam.');
    assert.equal(await api.toPortuguese('Hunters fight.'), 'Caçadores lutam.'); assert.equal(calls, 1);
});
test('quota exhaustion fails without returning a partially translated synopsis', async () => {
    let calls = 0;
    const { api } = setup(async () => ({ ok: true, json: async () => ++calls === 1
        ? { responseStatus: 200, responseData: { translatedText: 'Primeiro trecho.' } }
        : { responseStatus: 429, quotaFinished: true, responseData: { translatedText: 'LIMIT REACHED' } } }));
    await assert.rejects(api.toPortuguese('Words and sentences. '.repeat(50)), /limite/);
    assert.equal(calls, 2);
});
test('cancelled translation never submits text to the provider', async () => {
    const { api } = setup(() => { throw new Error('Must not fetch'); });
    const controller = new AbortController(); controller.abort();
    await assert.rejects(api.toPortuguese('Original', controller.signal), { name: 'AbortError' });
});
