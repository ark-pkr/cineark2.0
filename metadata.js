// AniList is primary; Jikan is a fallback. Both return the same editable metadata shape.
window.ArkMetadata = (() => {
    const cache = new Map();
    const imageURL = value => {
        try { const url = new URL(value); return url.protocol === 'https:' ? url.href : ''; } catch (_) { return ''; }
    };
    const mediaFields = 'id idMal title { english romaji native } description(asHtml: false) coverImage { extraLarge large } countryOfOrigin chapters genres staff(perPage: 8) { edges { role node { name { full } } } }';
    function plainText(value) {
        return String(value || '').replace(/<br\s*\/?\s*>/gi, '\n').replace(/<\/p\s*>/gi, '\n\n')
            .replace(/<[^>]*>/g, '').replace(/&(amp|lt|gt|quot|apos|nbsp);/gi, (_, name) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' })[name.toLowerCase()])
            .replace(/&#(x[0-9a-f]+|\d+);/gi, (entity, code) => {
                const n = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code);
                return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : entity;
            }).trim();
    }
    async function json(url, options, signal) {
        if (signal?.aborted) throw new DOMException('Cancelado', 'AbortError');
        const controller = new AbortController(), abort = () => controller.abort();
        signal?.addEventListener('abort', abort, { once: true });
        const timeout = setTimeout(abort, 4000);
        try {
            const response = await fetch(url, { ...options, signal: controller.signal });
            if (!response.ok) throw new Error(response.status === 429 ? 'A API atingiu o limite de consultas. Aguarde alguns segundos.' : 'A fonte de dados não respondeu corretamente.');
            return await response.json();
        } finally { clearTimeout(timeout); signal?.removeEventListener('abort', abort); }
    }
    function fromAniList(row) {
        return { title: row.title?.english || row.title?.romaji || row.title?.native || '', mal_id: row.idMal,
            synopsis: plainText(row.description), chapters: row.chapters, genres: (row.genres || []).map(name=>({name})),
            authors: (row.staff?.edges || []).filter(edge=>/story|art|original/i.test(edge.role)).map(edge=>({name:edge.node?.name?.full})),
            type: row.countryOfOrigin === 'KR' ? 'Manhwa' : row.countryOfOrigin === 'CN' || row.countryOfOrigin === 'TW' ? 'Manhua' : 'Manga',
            images: { jpg: { large_image_url: row.coverImage?.extraLarge || row.coverImage?.large } },
            provider: 'AniList', result_key: 'anilist:' + row.id };
    }
    async function aniList(kind, value, signal) {
        const query = kind === 'search'
            ? `query ($search: String!) { Page(page: 1, perPage: 8) { media(search: $search, type: MANGA) { ${mediaFields} } } }`
            : `query ($id: Int!) { Media(idMal: $id, type: MANGA) { ${mediaFields} } }`;
        const body = await json('https://graphql.anilist.co', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ query, variables: kind === 'search' ? { search: value } : { id: Number(value) } }) }, signal);
        if (body.errors?.length) throw new Error('A AniList não conseguiu consultar esta obra.');
        const data = kind === 'search' ? body.data?.Page?.media : body.data?.Media;
        if (kind === 'search' && Array.isArray(data)) return data.filter(Boolean).map(fromAniList);
        if (kind === 'get' && data?.title) return fromAniList(data);
        throw new Error('A AniList retornou dados inválidos.');
    }
    async function jikan(kind, value, signal) {
        const path = kind === 'search' ? 'manga?q=' + encodeURIComponent(value) + '&limit=8' : 'manga/' + Number(value);
        const body = await json('https://api.jikan.moe/v4/' + path, {}, signal);
        if (kind === 'search' && Array.isArray(body.data)) return body.data.map(row => ({ ...row, provider: 'Jikan', result_key: 'jikan:' + row.mal_id }));
        if (kind === 'get' && body.data?.title) return { ...body.data, provider: 'Jikan' };
        throw new Error('A Jikan retornou dados inválidos.');
    }
    async function request(kind, value, signal) {
        if (signal?.aborted) throw new DOMException('Cancelado', 'AbortError');
        const key = kind + ':' + value;
        const cached = cache.get(key);
        if (cached && Date.now() - cached.time < 10 * 60 * 1000) return cached.data;
        let data, empty = false, firstError;
        try { data = await aniList(kind, value, signal); empty = Array.isArray(data) && !data.length; }
        catch (error) { firstError = error; }
        if (signal?.aborted) throw new DOMException('Cancelado', 'AbortError');
        if (firstError || empty) {
            try { data = await jikan(kind, value, signal); }
            catch (error) {
                if (signal?.aborted) throw new DOMException('Cancelado', 'AbortError');
                if (!empty) throw new Error('Não foi possível consultar as fontes de mangás. ' + error.message + ' Tente novamente ou preencha os dados manualmente.');
            }
        }
        if (signal?.aborted) throw new DOMException('Cancelado', 'AbortError');
        if (cache.size >= 40) cache.delete(cache.keys().next().value);
        cache.set(key, { time: Date.now(), data });
        return data;
    }
    return {
        imageURL,
        search: (title, signal) => request('search', title.trim(), signal),
        get: (id, signal) => {
            if (!Number.isInteger(Number(id)) || Number(id) <= 0) return Promise.reject(new Error('Selecione uma obra válida.'));
            return request('get', Number(id), signal);
        },
        fields(result) {
            if (!result || typeof result.title !== 'string' || !result.title.trim()) throw new Error('A API retornou uma obra inválida.');
            const poster = imageURL(result.images?.webp?.large_image_url) || imageURL(result.images?.jpg?.large_image_url)
                || imageURL(result.images?.jpg?.image_url);
            return { title: result.title || '', poster, synopsis: typeof result.synopsis === 'string' ? result.synopsis : '',
                author: [...new Set((result.authors||[]).map(row=>row.name).filter(name=>typeof name==='string'))].join(', ').slice(0,500),
                genres: (result.genres||[]).map(row=>row.name).filter(name=>typeof name==='string').slice(0,20).map(name=>({Action:'Ação',Adventure:'Aventura',Fantasy:'Fantasia',Drama:'Drama',Supernatural:'Sobrenatural',Romance:'Romance',Comedy:'Comédia',Horror:'Terror',Mystery:'Mistério',Sports:'Esportes',Thriller:'Suspense','Sci-Fi':'Ficção científica','Slice of Life':'Cotidiano'}[name]||name)),
                mal_id: Number.isInteger(result.mal_id) && result.mal_id > 0 ? result.mal_id : null,
                totalcount: Number.isInteger(result.chapters) && result.chapters > 0 ? result.chapters : 0,
                type: result.type === 'Manhwa' ? 'Manhwa' : result.type === 'Manhua' ? 'Manhua' : 'Mangá' };
        }
    };
})();

window.metadataMixin = {
    data() { return { searchResults: [], metadataLoading: false, metadataError: '', metadataSearched: false, metadataSelected: false,
        synopsisTranslating: false, translationError: '', translationStatus: '', catalogSaveError: '', catalogSchemaMissing: false,
        catalogMetadataSQL: "alter table public.itens_catalogo add column if not exists synopsis text not null default '';\nalter table public.itens_catalogo add column if not exists mal_id integer;\nnotify pgrst, 'reload schema';" }; },
    computed: {
        catalogSQLEditor() {
            try { return 'https://supabase.com/dashboard/project/' + encodeURIComponent(new URL(window.CINE_ARK_CONFIG.supabaseUrl).hostname.split('.')[0]) + '/sql/new'; }
            catch (_) { return 'https://supabase.com/dashboard'; }
        }
    },
    methods: {
        cancelSynopsisTranslation() {
            this._translationController?.abort(); this._translationRequest = (this._translationRequest || 0) + 1;
            this.synopsisTranslating = false; this.translationError = ''; this.translationStatus = '';
        },
        async translateSynopsis() {
            if (!this.isAdmin || !this.showModal || !this.newItem.synopsis?.trim()) return;
            this.cancelSynopsisTranslation();
            const request = this._translationRequest, original = this.newItem.synopsis;
            const controller = this._translationController = new AbortController();
            this.synopsisTranslating = true; this.translationStatus = 'Traduzindo sinopse para português…';
            try {
                const translated = await window.ArkTranslation.toPortuguese(original, controller.signal, (done, total) => {
                    if (request === this._translationRequest) this.translationStatus = `Traduzindo sinopse: ${done}/${total}`;
                });
                if (request !== this._translationRequest || !this.showModal || !this.isAdmin || this.newItem.synopsis !== original) return;
                this.newItem.synopsis = translated; this.translationStatus = 'Sinopse traduzida para português. Revise antes de salvar.';
            } catch (error) {
                if (request === this._translationRequest && this.showModal) {
                    this.translationStatus = ''; this.translationError = 'A sinopse original foi mantida. ' + (error.name === 'AbortError' ? 'A tradução demorou demais; tente novamente.' : error.message);
                }
            } finally { if (request === this._translationRequest) this.synopsisTranslating = false; }
        },
        cancelMetadataSearch() {
            this.cancelSynopsisTranslation();
            clearTimeout(this._metadataTimer); this._metadataController?.abort();
            this._metadataRequest = (this._metadataRequest || 0) + 1;
            this.searchResults = []; this.metadataLoading = false; this.metadataError = ''; this.metadataSearched = false;
        },
        debounceBusca() {
            this.cancelMetadataSearch(); this.metadataSelected = false;
            // Changing the title detaches the old source identifier without discarding editable text.
            this.newItem.mal_id = null;
            if (this.newItem.title.trim().length < 3) return;
            this._metadataTimer = setTimeout(() => this.searchCatalogMetadata(), 700);
        },
        async searchCatalogMetadata() {
            if (!this.isAdmin || !this.showModal) return;
            const title = this.newItem.title.trim(), id = this.newItem.mal_id;
            this.cancelMetadataSearch();
            if (!id && title.length < 3) { this.metadataError = 'Digite pelo menos 3 caracteres para buscar.'; return; }
            const request = this._metadataRequest;
            const controller = this._metadataController = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 12000);
            this.metadataLoading = true;
            try {
                const data = id ? await window.ArkMetadata.get(id, controller.signal) : await window.ArkMetadata.search(title, controller.signal);
                if (request !== this._metadataRequest || !this.showModal || !this.isAdmin) return;
                if (id) this.selectResult(data);
                else {
                    if (!Array.isArray(data)) throw new Error('A API retornou uma lista inválida.');
                    this.searchResults = data.filter(row => row && typeof row.title === 'string'); this.metadataSearched = true;
                }
            } catch (error) {
                if (request === this._metadataRequest && this.showModal) this.metadataError = error.name === 'AbortError'
                    ? 'A busca demorou demais. Tente novamente.' : error.message || 'Não foi possível buscar os dados.';
            } finally { clearTimeout(timeout); if (request === this._metadataRequest) this.metadataLoading = false; }
        },
        selectResult(result) {
            if (!this.isAdmin) return;
            const fields = window.ArkMetadata.fields(result);
            this.cancelMetadataSearch(); Object.assign(this.newItem, fields); this.metadataSelected = true;
            if (fields.synopsis) this.translateSynopsis();
        },
        metadataCover(result) { return window.ArkMetadata.fields(result).poster; }
    },
    beforeUnmount() { this.cancelMetadataSearch(); }
};
