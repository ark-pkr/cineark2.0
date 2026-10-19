const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function setup(fetcher, timers = {}) {
    const context = { window: { ArkTranslation: { toPortuguese: async text => text } }, URL, AbortController, DOMException, fetch: fetcher, setTimeout: () => 0, clearTimeout() {}, ...timers };
    context.crypto=require('node:crypto').webcrypto;
    vm.createContext(context); vm.runInContext(fs.readFileSync('public/assets/js/discovery.js', 'utf8'), context); vm.runInContext(fs.readFileSync('public/assets/js/metadata.js', 'utf8'), context);
    const mixin = context.window.metadataMixin;
    return { api: context.window.ArkMetadata, context,
        app: { ...mixin.data(), ...mixin.methods, isAdmin: true, showModal: true, newItem: { title: 'Berserk' } } };
}
const result = { title: 'Berserk', mal_id: 2, chapters: null, type: 'Manga', synopsis: 'A story.', images: { jpg: { large_image_url: 'https://example.com/cover.jpg' } } };
const aniResult = { id: 77, idMal: 2, title: { english: 'Berserk' }, description: 'A story.', coverImage: { large: 'https://example.com/cover.jpg' }, countryOfOrigin: 'JP', chapters: null };
const response = rows => ({ ok: true, json: async () => ({ data: { Page: { media: rows } } }) });

test('Portuguese regressed duke title resolves to the verified international title',async()=>{
    const {api}=setup(async(url,options)=>{
        assert.equal(JSON.parse(options.body).variables.search,'The Reborn Young Lord is an Assassin');
        return response([aniResult]);
    });
    assert.equal((await api.search('O Filho Regressado do Duque é um Assassino')).length,1);
});
test('another metadata source can return a Portuguese name absent from AniList and Jikan',async()=>{
    const {api,context}=setup(async url=>url.includes('jikan')?{ok:true,json:async()=>({data:[]})}:response([]));
    context.window.ArkMangaDex=class {
        search=async()=>({data:[{id:'a',title:'Título localizado',description:'Sinopse portuguesa',descriptionLanguage:'pt-br',hasCover:true,originalLanguage:'ko',alternateTitles:['Original title']}]});
        cover=()=> 'https://example.com/cover.jpg';
    };
    const rows=await api.search('Título localizado');
    assert.equal(rows[0].provider,'MangaDex');assert.equal(rows[0].synopsisLanguage,'pt-br');
    assert.equal(api.fields(rows[0]).type,'Manhwa');
});
test('a confirmed Portuguese alias is reused without translating or guessing again',async()=>{
    const {api}=setup(async(url,options)=>{
        assert.equal(JSON.parse(options.body).variables.search,'Original confirmed title');return response([aniResult]);
    });
    api.rememberTitle('Meu título em português',{title:'Original confirmed title'});
    assert.equal((await api.search('Meu título em português')).length,1);
});
test('any unmatched title can use keyword searches without a predefined alias and results remain suggestions',async()=>{
    const queried=[];
    const {api}=setup(async(url,options)=>{
        if(url.includes('mymemory')) return {ok:true,json:async()=>({responseStatus:200,responseData:{translatedText:'The Legend of the Northern Blade'}})};
        if(url.includes('jikan')) return {ok:true,json:async()=>({data:[]})};
        const q=JSON.parse(options.body).variables.search;queried.push(q);
        return response(q==='northern blade'?[{...aniResult,title:{english:'The Legend of the Northern Blade'}}]:[]);
    });
    const rows=await api.search('A Lenda da Lâmina do Norte');
    assert.ok(queried.includes('northern blade'));assert.ok(queried.includes('legend northern'));
    assert.equal(rows[0].title,'The Legend of the Northern Blade');assert.equal(rows[0].approximate,true);
});

test('Portuguese alias resolves punctuation and preserves the entered title on selection', async () => {
    const { api, app } = setup(async (url, options) => {
        assert.equal(JSON.parse(options.body).variables.search, 'Catastrophic Necromancer');
        return response([aniResult]);
    });
    const rows = await api.search('Necromante: Rei dos Mortos');
    app.newItem.title = 'Necromante: Rei dos Mortos';
    app.selectResult(rows[0]);
    assert.equal(app.newItem.title, 'Necromante: Rei dos Mortos');
});

test('unknown Portuguese title retries providers with a translated query without selecting it', async () => {
    const calls = [];
    const { api } = setup(async (url, options) => {
        calls.push(url);
        if (url.includes('mymemory')) return { ok:true, json:async()=>({responseStatus:200,responseData:{translatedText:'The Hidden Kingdom'}}) };
        if (url.includes('jikan')) return {ok:true,json:async()=>({data:[]})};
        return response(JSON.parse(options.body).variables.search === 'The Hidden Kingdom' ? [aniResult] : []);
    });
    const rows = await api.search('O Reino Escondido');
    assert.equal(rows.length, 1);
    assert.equal(calls.length, 4);
    assert.ok(calls[2].includes('langpair=pt%7Cen'));
});
test('selection fills cover and synopsis without requiring WebP or chapter count', () => {
    const { app } = setup(); app.selectResult(result);
    assert.equal(app.newItem.poster, 'https://example.com/cover.jpg');
    assert.equal(app.newItem.synopsis, 'A story.'); assert.equal(app.newItem.totalcount, 0);
    assert.equal(app.newItem.type, 'Mangá'); assert.equal(app.newItem.mal_id, 2); assert.equal(app.metadataSelected, true);
});

test('automatic translation cannot overwrite a synopsis manually edited while waiting', async () => {
    let finish;
    const { app } = setup();
    app.newItem.synopsis = 'Original';
    // Reuse the method with a service that resolves only after manual editing.
    const context = { window: { ArkTranslation: { toPortuguese: () => new Promise(resolve => { finish = resolve; }) } }, AbortController };
    vm.createContext(context); vm.runInContext(fs.readFileSync('public/assets/js/metadata.js', 'utf8'), context);
    const pending = context.window.metadataMixin.methods.translateSynopsis.call(app);
    app.newItem.synopsis = 'Minha sinopse'; app.cancelSynopsisTranslation();
    finish('Texto traduzido'); await pending;
    assert.equal(app.newItem.synopsis, 'Minha sinopse'); assert.equal(app.synopsisTranslating, false);
});

test('failed translation keeps the full original synopsis and reports the failure', async () => {
    const { app } = setup(); app.newItem.synopsis = 'Original complete synopsis.';
    const context = { window: { ArkTranslation: { toPortuguese: async () => { throw new Error('Quota exceeded'); } } }, AbortController };
    vm.createContext(context); vm.runInContext(fs.readFileSync('public/assets/js/metadata.js', 'utf8'), context);
    await context.window.metadataMixin.methods.translateSynopsis.call(app);
    assert.equal(app.newItem.synopsis, 'Original complete synopsis.');
    assert.match(app.translationError, /original foi mantida/); assert.equal(app.synopsisTranslating, false);
});
test('missing metadata remains editable and unsafe image schemes are rejected', () => {
    const { api } = setup();
    const fields = api.fields({ title: 'A', type: 'Manhwa', images: { webp: { large_image_url: 'javascript:alert(1)' } } });
    assert.equal(fields.poster, ''); assert.equal(fields.synopsis, ''); assert.equal(fields.type, 'Manhwa');
    assert.equal(api.imageURL('file:///private'), '');
});
test('repeated searches use cache and encode query parameters', async () => {
    let calls = 0;
    const { api } = setup(async (url, options) => { calls++; assert.equal(url, 'https://graphql.anilist.co'); assert.equal(JSON.parse(options.body).variables.search, 'A&B'); return response([aniResult]); });
    await api.search('A&B'); await api.search('A&B'); assert.equal(calls, 1);
});
test('rate limit reports a retry message without caching the failure', async () => {
    let calls = 0;
    const { api } = setup(async () => { calls++; return { ok: false, status: 429 }; });
    await assert.rejects(api.search('Berserk'), /limite/); await assert.rejects(api.search('Berserk'), /limite/); assert.equal(calls, 4);
});
test('old search response cannot overwrite a new title', async () => {
    let release;
    const { app } = setup(() => new Promise(resolve => { release = resolve; }));
    const pending = app.searchCatalogMetadata(); app.newItem.title = 'Another'; app.debounceBusca();
    release(response([aniResult])); await pending;
    assert.equal(app.searchResults.length, 0); assert.equal(app.newItem.title, 'Another');
});
test('closing editor prevents late search results from returning', async () => {
    let release;
    const { app } = setup(() => new Promise(resolve => { release = resolve; }));
    const pending = app.searchCatalogMetadata(); app.showModal = false; app.cancelMetadataSearch();
    release(response([aniResult])); await pending;
    assert.equal(app.searchResults.length, 0); assert.equal(app.metadataLoading, false);
});
test('refresh uses the source ID instead of guessing a title match', async () => {
    const { app } = setup(async (url, options) => {
        assert.equal(url, 'https://graphql.anilist.co'); const payload = JSON.parse(options.body);
        assert.ok(payload.query.includes('idMal:')); assert.equal(payload.variables.id, 2);
        return { ok: true, json: async () => ({ data: { Media: aniResult } }) };
    });
    app.newItem.mal_id = 2; await app.searchCatalogMetadata();
    assert.equal(app.newItem.synopsis, 'A story.'); assert.equal(app.metadataLoading, false);
});

test('Solo Leveling is normalized to Manhwa with a plain text synopsis', async () => {
    const { api } = setup(async () => response([{ ...aniResult, id: 100, idMal: 121496, countryOfOrigin: 'KR',
        title: { english: 'Solo Leveling' }, description: 'A &amp; B<br><b>Story</b> &#39;test&#39;' }]));
    const rows = await api.search('solo leveling'); const fields = api.fields(rows[0]);
    assert.equal(fields.title, 'Solo Leveling'); assert.equal(fields.type, 'Manhwa');
    assert.equal(fields.synopsis, "A & B\nStory 'test'"); assert.equal(fields.mal_id, 121496);
});

test('unavailable primary source falls back to Jikan and caches the successful result', async () => {
    const calls = [];
    const { api } = setup(async url => {
        calls.push(url); if (url.includes('anilist')) throw new TypeError('network error');
        return { ok: true, json: async () => ({ data: [result] }) };
    });
    const rows = await api.search('Berserk'); assert.equal(rows[0].provider, 'Jikan');
    assert.equal(calls.length, 2); await api.search('Berserk'); assert.equal(calls.length, 2);
});

test('per-source timeout switches to fallback without waiting for the global deadline', async () => {
    let expire, calls = 0;
    const { api } = setup((url, options) => {
        calls++;
        if (url.includes('anilist')) return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Timed out', 'AbortError'))));
        return Promise.resolve({ ok: true, json: async () => ({ data: [result] }) });
    }, { setTimeout: fn => { expire = fn; return 1; } });
    const pending = api.search('Berserk'); expire(); const rows = await pending;
    assert.equal(rows[0].provider, 'Jikan'); assert.equal(calls, 2);
});

test('user cancellation aborts the request without triggering the fallback', async () => {
    let calls = 0; const controller = new AbortController();
    const { api } = setup((url, options) => {
        calls++; return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Canceled', 'AbortError'))));
    });
    const pending = api.search('Berserk', controller.signal); controller.abort();
    await assert.rejects(pending, { name: 'AbortError' }); assert.equal(calls, 1);
});

test('GraphQL errors in HTTP 200 responses also trigger the fallback', async () => {
    const { api } = setup(async url => url.includes('anilist')
        ? { ok: true, json: async () => ({ errors: [{ message: 'unavailable' }] }) }
        : { ok: true, json: async () => ({ data: [result] }) });
    const rows = await api.search('Berserk'); assert.equal(rows[0].provider, 'Jikan');
});

test('missing database columns keep the Portuguese synopsis and show inline setup instructions', async () => {
    const html = fs.readFileSync('public/index.html', 'utf8');
    const start = html.indexOf('createApp({') + 'createApp('.length;
    const end = html.indexOf("}).mount('#app')", start) + 1;
    const context = { window: { readerMixin: {}, authMixin: {}, metadataMixin: {}, ArkMetadata: { imageURL: url => url } },
        alert() { throw new Error('Database errors must not use blocking alerts'); },
        _supabase: { from: () => ({ insert: () => ({ select: () => ({ single: async () => ({ data: null, error: { code: 'PGRST204' } }) }) }) }) } };
    context.crypto=require('node:crypto').webcrypto;
    vm.createContext(context);vm.runInContext(fs.readFileSync('public/assets/js/discovery.js','utf8'),context);
    const options = vm.runInContext('(' + html.slice(start, end) + ')', context);
    const app = { ...options.data(), ...options.methods, isAdmin: true, synopsisTranslating: false,
        userSession: { user: { id: 'admin' } }, cancelMetadataSearch() {} };
    app.newItem.title = 'Solo Leveling'; app.newItem.synopsis = 'Caçadores protegem a humanidade.';
    await app.saveEntry();
    assert.equal(app.catalogSchemaMissing, true); assert.match(app.catalogSaveError, /campos de sinopse/);
    assert.equal(app.catalogSaving, false); assert.equal(app.newItem.synopsis, 'Caçadores protegem a humanidade.');
});
