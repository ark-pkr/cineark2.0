/* Legacy local chapters are kept for reading and explicit publication by administrators. */
const readerDB = new Promise((resolve, reject) => {
    const request = indexedDB.open('cine-ark-reader', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('chapters', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
});
readerDB.catch(() => {});
async function chapterStore(mode, action) {
    const db = await readerDB;
    return new Promise((resolve, reject) => {
        const tx = db.transaction('chapters', mode);
        const request = action(tx.objectStore('chapters'));
        tx.oncomplete = () => resolve(request.result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('Operação cancelada'));
    });
}
window.readerMixin = {
    data() {
        let progress = {};
        try { progress = JSON.parse(localStorage.getItem('ark-reading') || '{}'); } catch (_) {}
        if (!progress || Array.isArray(progress) || typeof progress !== 'object') progress = {};
        return { readingWork: null, chapters: [], activeChapter: null, pageURLs: [], readerPage: 0,
            readingMode: 'vertical', readingDirection: 'ltr', readingProgress: progress || {},
            chapterNumber: 1, chapterTitle: '', chapterFiles: [], readerBusy: false, readerError: '',
            chapterObserver: null, readerLoading: false, localChapters: [], uploadStatus: '', progressSync: '', progressLoading: false };
    },
    computed: {
        readingChapters() { return this.activeChapter?.source === 'mangadex' || !this.activeChapter && this.chapterSource === 'mangadex' ? this.dexChapters : this.chapters.filter(c => c.published); },
        chapterIndex() { return (this.readerChapterSequence || this.readingChapters).findIndex(c => c.id === this.activeChapter?.id); }
    },
    methods: {
        cloudAPI() {
            if (!this._cloudAPI) this._cloudAPI = new window.ArkCloudReader(_supabase, window.CINE_ARK_CONFIG?.pagesBucket || 'ark-pages');
            return this._cloudAPI;
        },
        async loadChapters(workId) {
            if (this.readerBusy) return;
            const userId = this.userSession?.user?.id, request = this._workRequest;
            this.readerBusy = true; this.readerError = '';
            try {
                const chapters = await this.cloudAPI().chapters(workId);
                if (String(this.readingWork?.id) !== String(workId) || userId !== this.userSession?.user?.id || request !== this._workRequest) return;
                this.chapters = chapters;
                this.chapterNumber = (chapters.at(-1)?.number || 0) + 1;
            } catch (_) { if (userId === this.userSession?.user?.id) this.readerError = 'Não foi possível atualizar os capítulos.'; }
            finally { if (userId === this.userSession?.user?.id && request === this._workRequest) this.readerBusy = false; }
        },
        async openWork(item) {
            if (!this.userSession) {
                this.readingWork=item;this.chapters=[];this.localChapters=[];this.readerError='';this.resetMangaDex?.(item);
                return;
            }
            if (this.readerBusy) return;
            const request = this._workRequest = (this._workRequest || 0) + 1;
            const userId = this.userSession.user.id;
            this.readingWork = item; this.readerError = ''; this.chapters = []; this.localChapters = []; this.readerBusy = true;
            this.resetMangaDex?.(item);
            this.chapterFiles = []; this.chapterTitle = ''; this.uploadStatus = '';
            try {
                const chapters = await this.cloudAPI().chapters(item.id);
                if (request !== this._workRequest || userId !== this.userSession?.user?.id || String(this.readingWork?.id) !== String(item.id)) return;
                this.chapters = chapters;
                this.chapterNumber = (this.chapters.at(-1)?.number || 0) + 1;
            } catch (_) {
                if (request === this._workRequest) this.readerError = 'Não foi possível carregar os capítulos online. Confira a conexão e tente novamente.';
            } finally {
                if (request === this._workRequest) this.readerBusy = false;
            }
            if (this.isAdmin) {
                try {
                    const all = await chapterStore('readonly', store => store.getAll());
                    if (request !== this._workRequest || userId !== this.userSession?.user?.id || !this.readingWork) return;
                    this.localChapters = all.filter(c => c.workId === String(item.id)).sort((a, b) => a.number - b.number)
                        .map(c => ({ ...c, source: 'local', pageCount: c.pages.length }));
                } catch (_) { /* Local database is optional for the online reader. */ }
            }
            if (!this._progressLoadingPromise) this.loadReadingProgress();
        },
        chooseChapterFiles(event) {
            this.chapterFiles = Array.from(event.target.files).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
        },
        async addChapter() {
            if (!this.isAdmin || this.readerBusy) return;
            return this.publishChapterFiles(this.chapterFiles, Number(this.chapterNumber), this.chapterTitle.trim());
        },
        async publishLocalChapter(chapter) {
            if (!this.isAdmin || this.readerBusy) return;
            return this.publishChapterFiles(chapter.pages, chapter.number, chapter.title, chapter.id);
        },
        async publishChapterFiles(files, number, title, localId = null) {
            if (!this.isAdmin || this.readerBusy || !this.readingWork) return;
            this.readerError = '';
            if (!Number.isFinite(number) || number <= 0 || number >= 1000000 || !files.length) {
                this.readerError = 'Informe um número positivo e selecione as imagens das páginas.'; return;
            }
            if (this.chapters.some(c => c.number === number)) { this.readerError = 'Já existe um capítulo com esse número.'; return; }
            if (files.some(f => !['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif'].includes(f.type))) {
                this.readerError = 'Use apenas imagens JPG, PNG, WebP, AVIF ou GIF.'; return;
            }
            if (files.some(f => f.size > 15 * 1024 * 1024)) { this.readerError = 'Cada página pode ter no máximo 15 MiB.'; return; }
            const workId = this.readingWork.id, userId = this.userSession.user.id, request = this._workRequest;
            const stillCurrent = () => userId === this.userSession?.user?.id && this.isAdmin;
            const stillViewing = () => stillCurrent() && String(this.readingWork?.id) === String(workId) && request === this._workRequest;
            files = Array.from(files);
            this.readerBusy = true;
            this.uploadStatus = 'Verificando imagens…';
            try {
                const dimensions = [];
                for (const file of files) {
                    const bitmap = await createImageBitmap(file);
                    dimensions.push({ width: bitmap.width, height: bitmap.height });
                    bitmap.close();
                }
                const chapter = await this.cloudAPI().upload({ workId, number, title, files, dimensions, isCurrent: stillCurrent,
                    onProgress: (done, total) => { if (stillViewing()) this.uploadStatus = `Enviando páginas: ${done}/${total}`; } });
                if (!stillViewing()) return;
                this.chapters = [...this.chapters, chapter].sort((a, b) => a.number - b.number);
                this.chapterNumber = number + 1; this.chapterTitle = ''; this.chapterFiles = [];
                if (this.$refs.chapterUpload) this.$refs.chapterUpload.value = '';
                this.uploadStatus = 'Capítulo publicado para os leitores.';
                if (localId && this.readingProgress[workId]?.chapterId === localId) {
                    this.readingProgress[workId] = { ...this.readingProgress[workId], chapterId: chapter.id,
                        remote: true, syncPending: true, updatedAt: new Date().toISOString() };
                    this.persistReadingProgress(); this.flushReadingProgress();
                }
            } catch (error) {
                if (stillViewing()) { this.readerError = error.message || 'Não foi possível publicar o capítulo.'; this.uploadStatus = ''; }
            } finally {
                if (userId === this.userSession?.user?.id && request === this._workRequest) this.readerBusy = false;
            }
        },
        async deleteChapter(chapter) {
            if (chapter.source === 'mangadex') return;
            if (!this.isAdmin || this.readerBusy) return;
            const local = chapter.source === 'local';
            if (!confirm(local ? `Excluir a cópia local do capítulo ${chapter.number}?` : `Excluir o capítulo ${chapter.number} e suas páginas online para todos os leitores?`)) return;
            const workId = this.readingWork.id, userId = this.userSession.user.id;
            this.readerBusy = true;
            try {
                if (local) await chapterStore('readwrite', store => store.delete(chapter.id));
                else await this.cloudAPI().deleteChapter(chapter.id, () => userId === this.userSession?.user?.id && this.isAdmin);
                if (userId !== this.userSession?.user?.id || String(this.readingWork?.id) !== String(workId)) return;
                this.chapters = this.chapters.filter(c => c.id !== chapter.id);
                this.localChapters = this.localChapters.filter(c => c.id !== chapter.id);
                if (this.readingProgress[workId]?.chapterId === chapter.id) {
                    delete this.readingProgress[workId]; this.persistReadingProgress();
                }
            } catch (_) {
                if (userId === this.userSession?.user?.id) this.readerError = 'A exclusão não terminou. O capítulo pode ter ficado como rascunho. Atualize a lista e tente novamente.';
            } finally { if (userId === this.userSession?.user?.id) this.readerBusy = false; }
        },
        async continueReading() {
            if (this.progressLoading) await this._progressLoadingPromise;
            if (!this.readingWork) return;
            const saved = this.readingProgress[this.readingWork.id];
            const available = this.chapters.filter(c => c.published);
            const chapter = available.find(c => c.id === saved?.chapterId) || available[0];
            if (chapter) this.openChapter(chapter, saved?.chapterId === chapter.id ? saved.page : 0);
        },
        async openChapter(chapter, page = 0) {
            if (!this.userSession) { this.openAuth('login'); return; }
            if (this.readerBusy || !chapter || chapter.source === 'remote' && !chapter.published) return;
            const request = this._chapterRequest = (this._chapterRequest || 0) + 1;
            const userId = this.userSession.user.id, workId = this.readingWork?.id;
            this.readerBusy = true; this.readerError = '';
            try {
                let urls, pages;
                if (chapter.source === 'remote') {
                    pages = await this.cloudAPI().pages(chapter.id);
                    if (!pages.length) throw new Error('Este capítulo ainda não possui páginas.');
                    urls = await this.cloudAPI().signedURLs(pages);
                } else if (chapter.source === 'mangadex') urls = await this.mangaDexAPI().pages(chapter.id, this.dexQuality);
                else urls = chapter.pages.map(file => URL.createObjectURL(file));
                if (request !== this._chapterRequest || userId !== this.userSession?.user?.id || workId !== this.readingWork?.id) {
                    if (chapter.source !== 'remote' && chapter.source !== 'mangadex') urls.forEach(url => URL.revokeObjectURL(url)); return;
                }
                if (this.activeChapter) this.saveReadingProgress();
                this.cancelPageTranslation?.();
                this.releasePages(); this.readerLoading = true;
                this.activeChapter = { ...chapter, dimensions: pages ? pages.map(p => ({ width: p.width, height: p.height })) : chapter.source === 'mangadex' ? urls.map(() => ({ width: 2, height: 3 })) : chapter.dimensions,
                    storagePages: pages, externalQuality: chapter.source === 'mangadex' ? this.dexQuality : null };
                this.pageURLs = urls;
                this.readerPage = Math.max(0, Math.min(Number(page) || 0, urls.length - 1));
                document.body.style.overflow = 'hidden'; this.saveReadingProgress();
                await this.$nextTick();
                if (request !== this._chapterRequest || this.activeChapter?.id !== chapter.id) return;
                this.observePages(); this.readerLoading = false;
                if (pages) this._signedRefreshTimer = setTimeout(() => this.refreshSignedPages(), 50 * 60 * 1000);
            } catch (error) {
                if (request === this._chapterRequest && userId === this.userSession?.user?.id) this.readerError = error.message || 'Não foi possível abrir as páginas.';
            } finally { if (request === this._chapterRequest) { this.readerBusy = false; this.readerLoading = false; } }
        },
        async refreshSignedPages() {
            const chapter = this.activeChapter, userId = this.userSession?.user?.id;
            if ((!chapter?.storagePages && chapter?.source !== 'mangadex') || this._refreshingPages) return;
            this._refreshingPages = true;
            try {
                const urls = chapter.source === 'mangadex' ? await this.mangaDexAPI().pages(chapter.id, chapter.externalQuality) : await this.cloudAPI().signedURLs(chapter.storagePages);
                if (this.activeChapter !== chapter || this.userSession?.user?.id !== userId) return;
                this.pageURLs = urls; this.readerPage = Math.min(this.readerPage, urls.length - 1);
                await this.$nextTick();
                if (this.activeChapter !== chapter || this.userSession?.user?.id !== userId) return;
                this.observePages();
                clearTimeout(this._signedRefreshTimer);
                if (chapter.source !== 'mangadex') this._signedRefreshTimer = setTimeout(() => this.refreshSignedPages(), 50 * 60 * 1000);
            } catch (_) { if (this.activeChapter === chapter) this.readerError = 'Não foi possível renovar as páginas. Confira a conexão e reabra o capítulo.'; }
            finally { this._refreshingPages = false; }
        },
        observePages() {
            this.chapterObserver?.disconnect();
            if (this.readingMode !== 'vertical') return;
            const root = this.$refs.readerScroll;
            if (!root) return;
            const chapter = this.activeChapter;
            this.chapterObserver = new IntersectionObserver(entries => {
                if (this.readerLoading || this.activeChapter !== chapter || this.readingMode !== 'vertical') return;
                const visible = entries.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
                if (visible.length) { this.readerPage = Number(visible[0].target.dataset.page); this.saveReadingProgress(); }
            }, { root, rootMargin: '0px 0px -55% 0px', threshold: 0 });
            root.querySelectorAll('[data-page]').forEach(el => this.chapterObserver.observe(el));
            root.querySelector(`[data-page="${this.readerPage}"]`)?.scrollIntoView({ block: 'start' });
        },
        saveReadingProgress() {
            if (!this.activeChapter || !this.readingWork) return;
            const remote = this.activeChapter.source === 'remote';
            const external = this.activeChapter.source === 'mangadex';
            const key = external ? 'mangadex:' + this.readingWork.id : this.readingWork.id;
            this.readingProgress[key] = { chapterId: this.activeChapter.id, page: this.readerPage,
                remote, updatedAt: new Date().toISOString(), syncPending: remote || external,
                ...(external ? { source: 'mangadex', mangaId: this.activeChapter.mangaId, number: this.activeChapter.number, language: this.activeChapter.language } : {}) };
            this.persistReadingProgress();
            this.markChapterRead?.();
            if (external && this.userSession) {
                this.dexProgressSync = 'pending'; clearTimeout(this._dexProgressTimer);
                this._dexProgressTimer = setTimeout(() => this.flushDexProgress(), 700);
            }
            if (remote && this.userSession) {
                this.progressSync = 'pending'; clearTimeout(this._progressTimer);
                this._progressTimer = setTimeout(() => this.flushReadingProgress(), 700);
            }
        },
        persistReadingProgress() {
            try { localStorage.setItem(this.progressStorageKey(), JSON.stringify(this.readingProgress)); }
            catch (_) { this.readerError = 'O navegador não permitiu salvar o progresso.'; }
        },
        loadReadingProgress() { return Promise.all([this.loadLibraryReadingProgress(), this.loadDexProgress?.()]); },
        loadLibraryReadingProgress() {
            const userId = this.userSession?.user?.id;
            if (!userId) return Promise.resolve();
            const request = this._progressLoadRequest = (this._progressLoadRequest || 0) + 1;
            this.progressLoading = true;
            this._progressLoadingPromise = (async () => {
                try {
                    const remote = await this.cloudAPI().progress(userId);
                    if (userId !== this.userSession?.user?.id || request !== this._progressLoadRequest) return;
                    for (const row of remote) {
                        const local = this.readingProgress[row.work_id];
                        if (local?.syncPending && Date.parse(local.updatedAt) >= Date.parse(row.updated_at)) continue;
                        this.readingProgress[row.work_id] = { chapterId: row.chapter_id, page: row.page_index,
                            remote: true, updatedAt: row.updated_at, syncPending: false };
                    }
                    this.persistReadingProgress();
                    await this.flushReadingProgress();
                } catch (_) {
                    if (userId === this.userSession?.user?.id) this.progressSync = 'pending';
                } finally {
                    if (request === this._progressLoadRequest) { this.progressLoading = false; this._progressLoadingPromise = null; }
                }
            })();
            return this._progressLoadingPromise;
        },
        flushReadingProgress() { return Promise.all([this.flushLibraryProgress(), this.flushDexProgress?.()]); },
        async flushLibraryProgress() {
            clearTimeout(this._progressTimer);
            const userId = this.userSession?.user?.id;
            if (!userId) return;
            // A single ordered worker per account prevents older page writes finishing after newer ones.
            if (this._progressWorker?.userId === userId) return this._progressWorker.promise;
            const worker = { userId };
            this._progressWorker = worker;
            worker.promise = (async () => {
                try {
                    while (userId === this.userSession?.user?.id) {
                        const next = Object.entries(this.readingProgress).find(([, value]) => value.remote && value.syncPending);
                        if (!next) { this.progressSync = 'saved'; return; }
                        const [workId, value] = next, snapshot = { ...value };
                        this.progressSync = 'saving';
                        await this.cloudAPI().saveProgress({ user_id: userId, work_id: workId, chapter_id: snapshot.chapterId,
                            page_index: snapshot.page, updated_at: snapshot.updatedAt });
                        if (userId !== this.userSession?.user?.id) return;
                        const current = this.readingProgress[workId];
                        if (current === value) { current.syncPending = false; this.persistReadingProgress(); }
                    }
                } catch (_) { if (userId === this.userSession?.user?.id) this.progressSync = 'pending'; }
                finally { if (this._progressWorker === worker) this._progressWorker = null; }
            })();
            return worker.promise;
        },
        async changeReadingMode() { await this.$nextTick(); this.observePages(); },
        turnPage(amount) {
            this.readerPage = Math.max(0, Math.min(this.pageURLs.length - 1, this.readerPage + amount));
            this.saveReadingProgress();
        },
        progressStorageKey() { return this.userSession?.user?.id ? 'ark-reading:' + this.userSession.user.id : 'ark-reading'; },
        readerKey(event) {
            if (!this.activeChapter || ['INPUT', 'SELECT', 'TEXTAREA'].includes(event.target.tagName)) return;
            if (event.key === 'Escape') {
                if (this.readerFocus) { this.readerFocus = false; return; }
                if (this.readerDrawerOpen) { this.readerDrawerOpen = false; return; }
                this.closeReader();
            }
            if (this.jumpReaderPage && ['Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) {
                event.preventDefault();
                this.jumpReaderPage(event.key === 'Home' ? 0 : event.key === 'End' ? this.pageURLs.length - 1 : this.readerPage + (event.key === 'PageDown' ? 1 : -1));
            }
            if (this.readingMode === 'paged' && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
                event.preventDefault();
                this.turnPage((event.key === 'ArrowRight' ? 1 : -1) * (this.readingDirection === 'rtl' ? -1 : 1));
            }
        },
        async readerFullscreen() {
            try {
                if (document.fullscreenElement) await document.exitFullscreen();
                else await this.$refs.readerShell.requestFullscreen();
            } catch (_) { this.readerError = 'Tela cheia indisponível neste navegador.'; }
        },
        releasePages() {
            clearTimeout(this._signedRefreshTimer);
            this.chapterObserver?.disconnect(); this.pageURLs.filter(url => url.startsWith('blob:')).forEach(url => URL.revokeObjectURL(url)); this.pageURLs = [];
        },
        closeReader() {
            this.resetReaderControls?.();
            this.cancelPageTranslation?.();
            this._chapterRequest = (this._chapterRequest || 0) + 1;
            this.saveReadingProgress(); this.flushReadingProgress(); this.releasePages(); this.activeChapter = null;
            this.readerBusy = false; document.body.style.overflow = '';
            if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
        }
    },
    mounted() {
        this._readerKeyHandler = e => this.readerKey(e);
        this._readerOnlineHandler = () => this.loadReadingProgress();
        this._readerVisibilityHandler = () => { if (document.visibilityState === 'hidden') this.flushReadingProgress(); };
        window.addEventListener('keydown', this._readerKeyHandler);
        window.addEventListener('online', this._readerOnlineHandler);
        document.addEventListener('visibilitychange', this._readerVisibilityHandler);
    },
    beforeUnmount() {
        clearTimeout(this._progressTimer); clearTimeout(this._progressLoadTimer);
        this._workRequest++; this._chapterRequest++; this._progressLoadRequest++;
        this.flushReadingProgress(); this.releasePages();
        window.removeEventListener('keydown', this._readerKeyHandler); window.removeEventListener('online', this._readerOnlineHandler);
        document.removeEventListener('visibilitychange', this._readerVisibilityHandler); document.body.style.overflow = '';
    }
};
