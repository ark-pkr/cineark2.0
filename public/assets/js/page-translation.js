window.pageTranslationMixin = {
    data() { return { pageTranslation: null, pageTranslationError: '', pageTranslationBusy: false,
        pageTranslationOpen: false, pageTranslationIndex: 0 }; },
    methods: {
        cancelPageTranslation() {
            this._pageTranslationRequest = (this._pageTranslationRequest || 0) + 1;
            this._pageTranslationController?.abort();
            this.pageTranslationBusy = false; this.pageTranslationOpen = false;
            this.pageTranslation = null; this.pageTranslationError = '';
        },
        async translateReaderPage() {
            const chapter = this.activeChapter, userId = this.userSession?.user?.id;
            if (!userId || chapter?.source !== 'remote' || this.pageTranslationBusy) return;
            const page = this.readerPage, direction = this.readingDirection;
            this.cancelPageTranslation(); this.pageTranslationOpen = true; this.pageTranslationIndex = page;
            const request = this._pageTranslationRequest;
            const current = () => request === this._pageTranslationRequest && userId === this.userSession?.user?.id && this.activeChapter?.id === chapter.id;
            const key = chapter.id + ':' + page + ':' + direction, storageKey = 'ark-page-translations:' + userId;
            let cache = {};
            try { cache = JSON.parse(localStorage.getItem(storageKey) || '{}'); if (!cache || Array.isArray(cache) || typeof cache !== 'object') cache = {}; } catch (_) {}
            const valid = value => value && Array.isArray(value.blocks) && value.blocks.length <= 150 &&
                value.blocks.every(block => typeof block.original === 'string' && typeof block.translation === 'string');
            if (valid(cache[key])) { this.pageTranslation = cache[key]; return; }
            this.pageTranslationBusy = true;
            const controller = this._pageTranslationController = new AbortController();
            const timer = setTimeout(() => controller.abort(), 120000);
            try {
                const { data, error } = await _supabase.auth.getSession();
                if (!current()) return;
                if (error || !data.session?.access_token || data.session.user.id !== userId) throw new Error('Entre novamente para traduzir.');
                const local = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
                const endpoint = local ? 'http://127.0.0.1:8787/api/translate-page' : '/api/translate-page';
                const response = await fetch(endpoint, { method: 'POST', signal: controller.signal, credentials: 'omit',
                    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + data.session.access_token },
                    body: JSON.stringify({ chapterId: chapter.id, pageIndex: page, direction }) });
                let result;
                try { result = await response.json(); } catch (_) { throw new Error('O servidor de tradução está indisponível.'); }
                if (!response.ok) throw new Error(result.error || 'Não foi possível traduzir.');
                if (!valid(result)) throw new Error('A tradução recebida está incompleta. Tente novamente.');
                if (!current()) return;
                this.pageTranslation = result;
                cache[key] = result;
                while (Object.keys(cache).length > 20) delete cache[Object.keys(cache)[0]];
                try { localStorage.setItem(storageKey, JSON.stringify(cache)); } catch (_) { /* Translation remains visible if browser storage is full. */ }
            } catch (error) {
                if (current()) this.pageTranslationError = error.name === 'AbortError' ? 'A tradução demorou demais. Tente novamente.' : error.message || 'Não foi possível traduzir.';
            } finally { clearTimeout(timer); if (current()) this.pageTranslationBusy = false; }
        }
    },
    beforeUnmount() { this.cancelPageTranslation(); }
};
