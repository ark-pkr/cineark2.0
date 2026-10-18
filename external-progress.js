// External chapter IDs deliberately use a separate table from uploaded chapter IDs.
window.externalProgressMixin = {
    data() { return { dexProgressSync: '', dexProgressError: '' }; },
    methods: {
        dexProgressValue(row) {
            return { chapterId: row.chapter_id, page: row.page_index, source: 'mangadex', remote: false,
                mangaId: row.manga_id, number: row.chapter_number, language: row.language,
                updatedAt: row.updated_at, cloudSynced: true, syncPending: false };
        },
        dexProgressFailure(error) {
            this.dexProgressSync = 'pending';
            this.dexProgressError = ['PGRST205', '42P01'].includes(error?.code)
                ? 'A sincronização precisa ser ativada no banco. Execute supabase/mangadex-progress.sql no SQL Editor.'
                : 'Progresso salvo neste dispositivo. A sincronização será tentada ao reconectar ou reabrir a obra.';
        },
        loadDexProgress() {
            const userId = this.userSession?.user?.id;
            if (!userId) return Promise.resolve();
            if (this._dexProgressLoad?.userId === userId) return this._dexProgressLoad.promise;
            const request = { userId }; this._dexProgressLoad = request;
            // Older versions saved MangaDex progress only locally. Upload it once after merging.
            for (const value of Object.values(this.readingProgress)) {
                if (value.source === 'mangadex' && !value.cloudSynced) value.syncPending = true;
            }
            this.persistReadingProgress();
            request.promise = (async () => {
                try {
                    const rows = await this.cloudAPI().dexProgress(userId);
                    if (userId !== this.userSession?.user?.id || this._dexProgressLoad !== request) return;
                    for (const row of rows) {
                        const key = 'mangadex:' + row.work_id, local = this.readingProgress[key];
                        if (local && Date.parse(local.updatedAt) >= Date.parse(row.updated_at)) continue;
                        this.readingProgress[key] = this.dexProgressValue(row);
                    }
                    this.persistReadingProgress(); this.dexProgressError = '';
                    await this.flushDexProgress();
                } catch (error) {
                    if (userId === this.userSession?.user?.id && this._dexProgressLoad === request) this.dexProgressFailure(error);
                } finally { if (this._dexProgressLoad === request) this._dexProgressLoad = null; }
            })();
            return request.promise;
        },
        flushDexProgress() {
            clearTimeout(this._dexProgressTimer);
            const userId = this.userSession?.user?.id;
            if (!userId) return Promise.resolve();
            if (this._dexProgressWorker?.userId === userId) return this._dexProgressWorker.promise;
            const worker = { userId }; this._dexProgressWorker = worker;
            worker.promise = (async () => {
                try {
                    while (userId === this.userSession?.user?.id) {
                        const next = Object.entries(this.readingProgress).find(([, value]) => value.source === 'mangadex' && value.syncPending);
                        if (!next) { this.dexProgressSync = 'saved'; this.dexProgressError = ''; return; }
                        const [key, value] = next;
                        this.dexProgressSync = 'saving';
                        const row = await this.cloudAPI().saveDexProgress({ user_id: userId, work_id: key.slice(9),
                            manga_id: value.mangaId, chapter_id: value.chapterId, chapter_number: String(value.number ?? ''),
                            language: value.language || 'pt-br', page_index: value.page, updated_at: value.updatedAt });
                        if (userId !== this.userSession?.user?.id) return;
                        if (this.readingProgress[key] === value) {
                            this.readingProgress[key] = this.dexProgressValue(row); this.persistReadingProgress();
                        }
                    }
                } catch (error) { if (userId === this.userSession?.user?.id) this.dexProgressFailure(error); }
                finally { if (this._dexProgressWorker === worker) this._dexProgressWorker = null; }
            })();
            return worker.promise;
        }
    },
    beforeUnmount() { clearTimeout(this._dexProgressTimer); }
};
