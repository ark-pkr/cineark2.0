window.ArkMangaDex = class {
    constructor(base) {
        const configured = base || window.CINE_ARK_CONFIG?.mangadexProxyUrl;
        const local = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
        this.base = configured || (local ? 'http://127.0.0.1:8787/mangadex' : new URL('/mangadex', window.location.href).href);
        const url = new URL(this.base);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Configure um endereço válido para o servidor MangaDex.');
        this.cache = new Map();
    }
    url(op, values = {}) {
        const url = new URL(this.base); url.searchParams.set('op', op);
        for (const [key, value] of Object.entries(values)) url.searchParams.set(key, String(value));
        return url.href;
    }
    async request(op, values, signal) {
        if (signal?.aborted) throw new DOMException('Cancelado', 'AbortError');
        const url = this.url(op, values), cached = this.cache.get(url);
        if (cached && cached.until > Date.now()) return cached.data;
        const controller = new AbortController(), abort = () => controller.abort();
        signal?.addEventListener('abort', abort, { once: true }); const timeout = setTimeout(abort, 30000);
        try {
            const response = await fetch(url, { signal: controller.signal, credentials: 'omit', headers: { Accept: 'application/json' } });
            let body;
            try { body = await response.json(); } catch (_) { throw new Error('O servidor MangaDex não está configurado corretamente.'); }
            if (!response.ok || body.error) throw new Error(body.error || 'Não foi possível consultar o MangaDex.');
            if (this.cache.size >= 40) this.cache.delete(this.cache.keys().next().value);
            this.cache.set(url, { data: body, until: Date.now() + 60000 }); return body;
        } catch (error) {
            if (signal?.aborted) throw new DOMException('Cancelado', 'AbortError');
            if (error instanceof TypeError) throw new Error('O servidor MangaDex está indisponível. Verifique se a integração foi iniciada.');
            if (error.name === 'AbortError') throw new Error('MangaDex demorou para responder. Tente novamente mais tarde.');
            throw error;
        } finally { clearTimeout(timeout); signal?.removeEventListener('abort', abort); }
    }
    search(q, signal) { return this.request('search', { q }, signal); }
    feed(id, language, offset, signal) { return this.request('feed', { id, language, offset }, signal); }
    cover(id) { return this.url('cover', { id }); }
    async pages(id, quality) {
        const manifest = await this.request('pages', { id, quality });
        if (!Number.isInteger(manifest.pageCount) || manifest.pageCount < 1 || manifest.pageCount > 1001) throw new Error('Este capítulo não possui páginas disponíveis.');
        return Array.from({ length: manifest.pageCount }, (_, page) => this.url('image', { id, page, quality: manifest.quality }));
    }
};

window.mangadexMixin = {
    data() { return { chapterSource: 'library', dexQuery: '', dexResults: [], dexChapters: [], dexSelected: null,
        dexLoading: false, dexLoadingAll: false, dexError: '', dexSearched: false, dexLanguage: 'pt-br', dexQuality: 'economy', dexHasMore: false, dexNextOffset: 0,
        dexTotal: 0, dexLimited: false, dexVisibleLimit: 100 }; },
    computed: {
        dexVisibleChapters() { return (this.filteredDexChapters || this.dexChapters).slice(0, this.dexVisibleLimit); }
    },
    methods: {
        mangaDexAPI() { if (!this._mangaDexAPI) this._mangaDexAPI = new window.ArkMangaDex(); return this._mangaDexAPI; },
        cancelMangaDex() { this._dexController?.abort(); this._dexRequest = (this._dexRequest || 0) + 1; this.dexLoading = false; this.dexLoadingAll = false; },
        resetMangaDex(item) {
            this.cancelMangaDex(); this.chapterSource = 'library'; this.dexQuery = item?.title || '';
            this.dexResults = []; this.dexChapters = []; this.dexSelected = null; this.dexError = ''; this.dexSearched = false;
            this.dexLanguage = item?.reading_language || 'pt-br'; this.dexHasMore = false; this.dexNextOffset = 0;
            this.dexTotal = 0; this.dexLimited = false; this.dexVisibleLimit = 100;
        },
        async queryMangaDex(loader, apply) {
            if (!this.userSession || !this.readingWork) return null;
            this.cancelMangaDex(); const request = this._dexRequest, workId = this.readingWork.id, userId = this.userSession.user.id;
            const current = () => request === this._dexRequest && this.readingWork?.id === workId && this.userSession?.user?.id === userId;
            const controller = this._dexController = new AbortController(); this.dexLoading = true; this.dexError = '';
            try { const data = await loader(controller.signal); if (!current()) return null; apply(data); return data; }
            catch (error) { if (current()) this.dexError = error.message || 'Não foi possível consultar o MangaDex.'; return null; }
            finally { if (current()) this.dexLoading = false; }
        },
        async setChapterSource(source) {
            this.cancelMangaDex(); this.chapterSource = source;
            if (source !== 'mangadex' || !this.readingWork) return;
            const userId = this.userSession?.user?.id, workId = this.readingWork.id;
            await this.loadDexProgress?.();
            if (userId !== this.userSession?.user?.id || workId !== this.readingWork?.id || this.chapterSource !== source) return;
            if (this.dexSelected && this.dexChapters.length) return this.dexHasMore ? this.loadDexChapters(true, true) : undefined;
            if (!this.dexSelected) {
                try {
                    const links = JSON.parse(localStorage.getItem('ark-mangadex-links:' + this.userSession.user.id) || '{}');
                    const saved = links[this.readingWork.id];
                    if (saved && /^[0-9a-f-]{36}$/i.test(saved.id)) { this.dexSelected = saved; this.dexLanguage = saved.language || 'pt-br'; }
                } catch (_) {}
                if (!this.dexSelected) {
                    const saved = this.readingProgress['mangadex:' + workId];
                    if (saved?.mangaId) { this.dexSelected = { id: saved.mangaId, title: this.readingWork.title }; this.dexLanguage = saved.language || 'pt-br'; }
                }
            }
            if (this.dexSelected) return this.loadDexChapters();
            return this.searchMangaDex();
        },
        async searchMangaDex() {
            if (this.dexQuery.trim().length < 3) { this.dexError = 'Digite pelo menos 3 caracteres.'; return; }
            this.dexSelected = null; this.dexChapters = []; this.dexResults = []; this.dexHasMore = false; this.dexSearched = false;
            return this.queryMangaDex(signal => this.mangaDexAPI().search(this.dexQuery.trim(), signal), result => {
                if (!Array.isArray(result.data)) throw new Error('Resposta de busca inválida.');
                this.dexResults = result.data; this.dexSearched = true;
            });
        },
        async selectDexManga(manga) {
            this.cancelMangaDex(); this.dexSelected = manga; this.dexResults = []; this.dexSearched = false;
            this.rememberDexManga(); return this.loadDexChapters();
        },
        rememberDexManga() {
            if (!this.dexSelected || !this.readingWork || !this.userSession) return;
            try {
                const key = 'ark-mangadex-links:' + this.userSession.user.id;
                const links = JSON.parse(localStorage.getItem(key) || '{}');
                links[this.readingWork.id] = { id: this.dexSelected.id, title: this.dexSelected.title, language: this.dexLanguage };
                localStorage.setItem(key, JSON.stringify(links));
            } catch (_) {}
        },
        loadDexChapters(append = false, all = !append) {
            if (!this.dexSelected || !this.userSession || !this.readingWork) return Promise.resolve();
            this.cancelMangaDex();
            const id = this.dexSelected.id, language = this.dexLanguage, workId = this.readingWork.id, userId = this.userSession.user.id;
            const request = this._dexRequest, controller = this._dexController = new AbortController();
            const current = () => !controller.signal.aborted && request === this._dexRequest && userId === this.userSession?.user?.id &&
                workId === this.readingWork?.id && id === this.dexSelected?.id && language === this.dexLanguage;
            if (!append) { this.dexChapters = []; this.dexHasMore = false; this.dexNextOffset = 0; this.dexTotal = 0; this.dexLimited = false; this.dexVisibleLimit = 100; }
            this.dexLoading = true; this.dexLoadingAll = all; this.dexError = '';
            this.rememberDexManga();
            const task = Promise.resolve().then(async () => {
                try {
                    do {
                        const offset = this.dexNextOffset;
                        const result = await this.mangaDexAPI().feed(id, language, offset, controller.signal);
                        if (!current()) return;
                        if (!Array.isArray(result.data) || !Number.isInteger(result.nextOffset) || result.nextOffset < offset ||
                            result.nextOffset > 10000 || result.hasMore && result.nextOffset <= offset) throw new Error('A fonte retornou uma paginação inválida. Tente atualizar a lista.');
                        this.dexChapters = [...new Map([...this.dexChapters, ...result.data].map(chapter => [chapter.id, chapter])).values()];
                        this.dexHasMore = !!result.hasMore; this.dexNextOffset = result.nextOffset;
                        this.dexTotal = Number.isFinite(result.total) ? result.total : this.dexChapters.length;
                        this.dexLimited = !!result.limited;
                    } while (all && this.dexHasMore && current());
                } catch (error) {
                    if (current()) this.dexError = error.message || 'Não foi possível completar a lista. Os capítulos encontrados foram mantidos.';
                } finally {
                    if (request === this._dexRequest) { this.dexLoading = false; this.dexLoadingAll = false; }
                    if (this._dexFeedPromise === task) this._dexFeedPromise = null;
                }
            });
            this._dexFeedPromise = task;
            return task;
        },
        async continueMangaDex() {
            const userId = this.userSession?.user?.id, workId = this.readingWork?.id;
            if (this._dexProgressLoad) await this._dexProgressLoad.promise;
            if (!workId || workId !== this.readingWork?.id || userId !== this.userSession?.user?.id) return;
            const saved = this.readingProgress['mangadex:' + this.readingWork.id];
            let chapter = this.dexChapters.find(c => c.id === saved?.chapterId);
            // Do not fetch an entire series just to resume an older chapter.
            if (!chapter && saved?.source === 'mangadex' && saved.mangaId === this.dexSelected?.id && saved.language === this.dexLanguage)
                chapter = { id: saved.chapterId, number: saved.number, mangaId: saved.mangaId, source: 'mangadex', published: true, language: saved.language };
            chapter ||= this.dexChapters[0];
            if (chapter) await this.openChapter(chapter, saved?.chapterId === chapter.id ? saved.page : 0);
        },
        async navigateReaderChapter(direction) {
            if (this.readerBusy || this.readerNavigating || ![-1, 1].includes(direction)) return;
            const activeId = this.activeChapter?.id, userId = this.userSession?.user?.id;
            this.readerNavigating = true;
            try {
            let sequence = this.readerChapterSequence || this.readingChapters;
            let index = sequence.findIndex(chapter => chapter.id === activeId);
            if (this.activeChapter?.source === 'mangadex' && (index < 0 || direction === 1 && index === sequence.length - 1) && this.dexHasMore) {
                if (this._dexFeedPromise) await this._dexFeedPromise;
                else await this.loadDexChapters(true, true);
            }
            if (activeId !== this.activeChapter?.id || userId !== this.userSession?.user?.id) return;
            sequence = this.readerChapterSequence || this.readingChapters;
            index = sequence.findIndex(chapter => chapter.id === activeId);
            const chapter = index >= 0 ? sequence[index + direction] : null;
            if (!chapter && this.dexError) this.readerError = this.dexError;
            if (chapter) await this.openChapter(chapter);
            } finally { this.readerNavigating = false; }
        },
        readerImageLoaded(event, index) {
            if (this.activeChapter?.source !== 'mangadex') return;
            const image = event.target;
            if (image.dataset?.chapter && image.dataset.chapter !== this.activeChapter.id) return;
            if (image.naturalWidth && image.naturalHeight) this.activeChapter.dimensions[index] = { width: image.naturalWidth, height: image.naturalHeight };
        }
    },
    beforeUnmount() { this.cancelMangaDex(); }
};
