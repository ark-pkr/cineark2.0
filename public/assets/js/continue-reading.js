window.continueReadingMixin = {
    data() { return { resumeBusy: false }; },
    computed: {
        recentReadings() {
            if (!this.userSession) return [];
            const latest = new Map();
            for (const [key, progress] of Object.entries(this.readingProgress)) {
                if (!progress?.chapterId || (!progress.remote && progress.source !== 'mangadex')) continue;
                const external = progress.source === 'mangadex';
                const workId = external ? key.slice(9) : key;
                const work = this.catalog.find(item => String(item.id) === workId && item.type !== 'Anime');
                if (!work) continue;
                const time = Date.parse(progress.updatedAt) || 0;
                if (!latest.has(workId) || time > latest.get(workId).time)
                    latest.set(workId, { work, progress, time, key });
            }
            return [...latest.values()].sort((a, b) => b.time - a.time).slice(0, 6);
        }
    },
    methods: {
        resumeChapterLabel(progress,chapters=[]) {
            const chapter=chapters.find(row=>row.id===progress?.chapterId);
            const history=Object.values(this.chapterHistory || {}).find(row=>row.chapter_id===progress?.chapterId);
            const number=progress?.number ?? chapter?.number ?? history?.chapter_number;
            return number!=null && String(number).trim()!==''?'Continuar capítulo '+number:'Continuar capítulo';
        },
        async resumeReading(entry) {
            if (this.resumeBusy || this.readerBusy || !this.userSession) return;
            const userId = this.userSession.user.id, work = entry.work;
            this.resumeBusy = true;
            try {
                const opening = this.openWork(work), request = this._workRequest;
                const current = () => userId === this.userSession?.user?.id && this.readingWork?.id === work.id && request === this._workRequest;
                await opening;
                if (!current()) return;
                await this.loadReadingProgress();
                if (!current()) return;
                const saved = [this.readingProgress[work.id], this.readingProgress['mangadex:' + work.id]]
                    .filter(value => value?.chapterId && (value.remote || value.source === 'mangadex'))
                    .sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0))[0];
                if (!saved) { this.readerError = 'Não foi possível encontrar o ponto salvo desta leitura.'; return; }
                if (saved.source === 'mangadex') {
                    this.chapterSource = 'mangadex';
                    this.dexSelected = { id: saved.mangaId, title: work.title };
                    this.dexLanguage = saved.language || 'pt-br';
                    await this.loadDexChapters();
                    if (!current()) return;
                    // The saved chapter can be outside the first feed page.
                    const chapter = this.dexChapters.find(item => item.id === saved.chapterId) || {
                        id: saved.chapterId, number: saved.number, mangaId: saved.mangaId,
                        language: saved.language, source: 'mangadex', published: true
                    };
                    await this.openChapter(chapter, saved.page);
                } else {
                    const chapter = this.chapters.find(item => item.id === saved.chapterId && item.published);
                    if (!chapter) { this.readerError = 'O capítulo salvo não está mais disponível. Escolha outro capítulo desta obra.'; return; }
                    await this.openChapter(chapter, saved.page);
                }
            } catch (_) {
                if (userId === this.userSession?.user?.id && this.readingWork?.id === work.id)
                    this.readerError = 'Não foi possível retomar a leitura. Confira a conexão e tente novamente.';
            } finally { this.resumeBusy = false; }
        }
    }
};
