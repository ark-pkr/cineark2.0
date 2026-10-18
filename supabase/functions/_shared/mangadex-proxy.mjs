const API = 'https://api.mangadex.org';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const LOCAL_ORIGINS = ['http://127.0.0.1:5500', 'http://localhost:5500', 'http://127.0.0.1:8080', 'http://localhost:8080', 'http://127.0.0.1:8787', 'http://localhost:8787'];
class ProxyError extends Error { constructor(message, status = 502) { super(message); this.status = status; } }
function id(value) { if (!UUID.test(value || '')) throw new ProxyError('Identificador MangaDex inválido.', 400); return value; }
function integer(value, max) { if (!/^\d+$/.test(value || '0')) throw new ProxyError('Página inválida.', 400); const n = Number(value || 0); if (n > max) throw new ProxyError('Página fora do limite.', 400); return n; }
export function safeImageHost(value) {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port && url.port !== '443' ||
        !(url.hostname === 'uploads.mangadex.org' || url.hostname.endsWith('.mangadex.network'))) throw new ProxyError('Servidor de imagens não autorizado.');
    return url;
}
export function createMangaDexProxy({ fetcher = fetch, allowedOrigins = LOCAL_ORIGINS, spacing = 300 } = {}) {
    const cache = new Map(), pending = new Map(), imageWaiters = []; let nextCall = 0, cooldown = 0, activeImages = 0;
    async function api(path, ttl = 60000) {
        const cached = cache.get(path);
        if (cached && cached.until > Date.now()) return cached.data;
        if (pending.has(path)) return pending.get(path);
        const promise = (async () => {
            if (Date.now() < cooldown) throw new ProxyError('MangaDex pediu uma pausa. Aguarde um minuto antes de tentar novamente.', 429);
            if (nextCall > Date.now() + 15000) throw new ProxyError('Há muitas consultas em andamento. Tente novamente em alguns segundos.', 429);
            const wait = Math.max(0, nextCall - Date.now()); nextCall = Math.max(Date.now(), nextCall) + spacing;
            if (wait) await new Promise(resolve => setTimeout(resolve, wait));
            if (Date.now() < cooldown) throw new ProxyError('Aguarde antes de consultar o MangaDex novamente.', 429);
            const response = await fetcher(API + path, { headers: { 'User-Agent': 'CINE-ARK/1.0 (manga reader)', Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(12000) });
            if (response.status === 429) { cooldown = Date.now() + 60000; throw new ProxyError('MangaDex limitou as consultas. Aguarde um minuto.', 429); }
            if (response.status === 401 || response.status === 403) throw new ProxyError('MangaDex restringiu este acesso. Abra a obra na fonte original; não é possível carregá-la por esta integração.', response.status);
            if (response.status === 404) throw new ProxyError('Obra ou capítulo não encontrado no MangaDex.', 404);
            if (!response.ok) throw new ProxyError('MangaDex está indisponível. Tente novamente mais tarde.');
            const text = await response.text();
            if (text.length > 2 * 1024 * 1024) throw new ProxyError('Resposta MangaDex maior que o limite.');
            const data = JSON.parse(text);
            if (data.result !== 'ok') throw new ProxyError('MangaDex não retornou dados válidos.');
            if (cache.size >= 128) cache.delete(cache.keys().next().value);
            cache.set(path, { data, until: Date.now() + ttl }); return data;
        })();
        pending.set(path, promise);
        try { return await promise; } finally { pending.delete(path); }
    }
    async function image(url) {
        const target = safeImageHost(url);
        if (activeImages >= 3) {
            if (imageWaiters.length >= 24) throw new ProxyError('Muitas imagens em andamento. Aguarde e reabra o capítulo.', 429);
            await new Promise(resolve => imageWaiters.push(resolve));
        } else activeImages++;
        try {
        const response = await fetcher(target.href, { headers: { 'User-Agent': 'CINE-ARK/1.0 (manga reader)', Accept: 'image/*' }, redirect: 'error', signal: AbortSignal.timeout(20000) });
        if (response.status === 429) throw new ProxyError('O servidor de imagens pediu uma pausa. Tente novamente mais tarde.', 429);
        if (!response.ok) throw new ProxyError('Não foi possível carregar esta imagem. Reabra o capítulo para tentar novamente.');
        const type = (response.headers.get('content-type') || '').split(';')[0];
        if (!['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif'].includes(type)) throw new ProxyError('A fonte não retornou uma imagem válida.');
        const reader = response.body.getReader(); let size = 0; const buffers = [];
        try {
            while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength;
                if (size > 20 * 1024 * 1024) throw new ProxyError('Imagem maior que o limite permitido.'); buffers.push(value); }
        } finally { await reader.cancel().catch(() => {}); }
        return new Response(new Blob(buffers, { type }), { headers: { 'Content-Type': type, 'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff' } });
        } finally { const next = imageWaiters.shift(); if (next) next(); else activeImages--; }
    }
    function title(row) { const t = row.attributes?.title || {}; return t['pt-br'] || t.pt || t.en || Object.values(t)[0] || 'Sem título'; }
    function normalizeManga(row) {
        const a = row.attributes || {};
        return { id: row.id, title: title(row), alternateTitles: (a.altTitles || []).flatMap(t => Object.values(t)).slice(0, 8),
            description: a.description?.['pt-br'] || a.description?.pt || a.description?.en || '', year: a.year || null,
            originalLanguage: a.originalLanguage, status: a.status, hasCover: (row.relationships || []).some(r => r.type === 'cover_art') };
    }
    async function manifest(chapterId) {
        const result = await api('/at-home/server/' + chapterId);
        safeImageHost(result.baseUrl);
        const chapter = result.chapter;
        if (!/^[a-f0-9]+$/i.test(chapter?.hash || '') || !Array.isArray(chapter.data) || !chapter.data.length) throw new ProxyError('Este capítulo não possui páginas disponíveis para leitura aqui.', 404);
        return result;
    }
    return async function handle(request) {
        const url = new URL(request.url), origin = request.headers.get('origin');
        const allowed = !origin || origin === url.origin || allowedOrigins.includes(origin);
        const cors = { Vary: 'Origin', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'X-Content-Type-Options': 'nosniff' };
        if (allowed && origin) cors['Access-Control-Allow-Origin'] = origin;
        const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
        if (!allowed) return json({ error: 'Origem não autorizada para este servidor MangaDex.' }, 403);
        if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
        if (request.method !== 'GET') return json({ error: 'Método não permitido.' }, 405);
        try {
            const op = url.searchParams.get('op'), value = url.searchParams.get('id');
            if (op === 'search') {
                const query = (url.searchParams.get('q') || '').trim();
                if (query.length < 3 || query.length > 150) throw new ProxyError('Digite entre 3 e 150 caracteres para buscar.', 400);
                const params = new URLSearchParams({ title: query, limit: '8', 'includes[]': 'cover_art', 'order[relevance]': 'desc' });
                const result = await api('/manga?' + params, 300000);
                return json({ data: result.data.map(normalizeManga) });
            }
            if (op === 'manga') {
                const result = await api('/manga/' + id(value) + '?includes[]=cover_art', 300000);
                return json({ data: normalizeManga(result.data) });
            }
            if (op === 'feed') {
                const mangaId = id(value), language = url.searchParams.get('language') || 'pt-br';
                if (!['pt-br', 'pt', 'en'].includes(language)) throw new ProxyError('Idioma não suportado.', 400);
                const offset = integer(url.searchParams.get('offset'), 9900);
                const params = new URLSearchParams({ limit: '100', offset: String(offset), 'translatedLanguage[]': language,
                    'order[volume]': 'asc', 'order[chapter]': 'asc', 'includes[]': 'scanlation_group', includeEmptyPages: '0', includeExternalUrl: '0', includeFutureUpdates: '0' });
                const result = await api('/manga/' + mangaId + '/feed?' + params);
                const data = result.data.filter(c => c.attributes?.pages > 0 && !c.attributes.externalUrl && !c.attributes.isUnavailable).map(c => ({
                    id: c.id, source: 'mangadex', mangaId, number: c.attributes.chapter || 'Especial', title: c.attributes.title || '',
                    language: c.attributes.translatedLanguage, pageCount: c.attributes.pages, published: true,
                    group: c.relationships?.find(r => r.type === 'scanlation_group')?.attributes?.name || '' }));
                return json({ data, offset, nextOffset: offset + result.data.length, total: result.total, hasMore: offset + result.data.length < Math.min(result.total, 10000) && result.data.length > 0 });
            }
            if (op === 'pages') {
                const chapterId = id(value), result = await manifest(chapterId);
                const quality = url.searchParams.get('quality') === 'original' ? 'original' : 'economy';
                const files = quality === 'economy' && result.chapter.dataSaver?.length ? result.chapter.dataSaver : result.chapter.data;
                return json({ pageCount: files.length, quality });
            }
            if (op === 'image') {
                const chapterId = id(value), page = integer(url.searchParams.get('page'), 1000), result = await manifest(chapterId);
                const saver = url.searchParams.get('quality') !== 'original' && result.chapter.dataSaver?.length;
                const files = saver ? result.chapter.dataSaver : result.chapter.data, file = files[page];
                if (!file || !/^[a-z0-9_.-]+$/i.test(file) || file.includes('..')) throw new ProxyError('Página indisponível.', 404);
                const response = await image(`${result.baseUrl}/${saver ? 'data-saver' : 'data'}/${result.chapter.hash}/${file}`);
                for (const [key, value] of Object.entries(cors)) response.headers.set(key, value);
                return response;
            }
            if (op === 'cover') {
                const mangaId = id(value), result = await api('/manga/' + mangaId + '?includes[]=cover_art', 300000);
                const file = result.data.relationships?.find(r => r.type === 'cover_art')?.attributes?.fileName;
                if (!file || !/^[a-z0-9_.-]+$/i.test(file) || file.includes('..')) throw new ProxyError('Capa indisponível.', 404);
                const response = await image(`https://uploads.mangadex.org/covers/${mangaId}/${file}.256.jpg`);
                for (const [key, value] of Object.entries(cors)) response.headers.set(key, value);
                return response;
            }
            throw new ProxyError('Operação não permitida.', 400);
        } catch (error) {
            return json({ error: error instanceof ProxyError ? error.message : 'Não foi possível consultar o MangaDex. Confira a conexão do servidor e tente novamente.' }, error.status || 502);
        }
    };
}
