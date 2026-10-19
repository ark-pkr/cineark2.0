window.readerControlsMixin = {
    data() {
        let saved = {};
        try { saved = JSON.parse(localStorage.getItem('ark-reader-preferences') || '{}') || {}; } catch (_) {}
        return { readerDrawerOpen: false, readerChapterSearch: '', readerChapterLimit: 80, readerFocus: false, readerNavigating: false,
            readerWidth: ['680', '900', '1100', 'full'].includes(saved.width) ? saved.width : '900',
            readerBrightness: Math.max(50,Math.min(100,Number(saved.brightness)||100)),
            readerSpacing: [0,8,16,24].includes(saved.spacing) ? saved.spacing : 0,
            readingMode: ['vertical','paged'].includes(saved.mode) ? saved.mode : 'vertical',
            readingDirection: saved.direction === 'rtl' ? 'rtl' : 'ltr' };
    },
    computed: {
        readerImageWidth() { return this.readerWidth === 'full' ? '100%' : this.readerWidth + 'px'; },
        readerPercentage() { return this.pageURLs.length ? Math.round((this.readerPage + 1) / this.pageURLs.length * 100) : 0; },
        readerChapterSequence() {
            if (this.activeChapter?.source !== 'mangadex') return this.readingChapters;
            const versions = new Map(), active = this.activeChapter;
            for (const chapter of this.readingChapters) {
                const numeric = /^\d+(\.\d+)?$/.test(String(chapter.number));
                const key = numeric ? (chapter.volume || '') + ':' + Number(chapter.number) : chapter.id;
                const previous = versions.get(key);
                if (!previous || chapter.id === active.id || previous.id !== active.id && chapter.group && chapter.group === active.group)
                    versions.set(key, chapter);
            }
            return [...versions.values()];
        },
        filteredReaderChapters() {
            const query = this.readerChapterSearch.trim().toLocaleLowerCase('pt-BR');
            return this.readingChapters.filter(chapter => !query || [chapter.number, chapter.title, chapter.group, chapter.volume]
                .some(value => String(value || '').toLocaleLowerCase('pt-BR').includes(query)));
        },
        visibleReaderChapters() { return this.filteredReaderChapters.slice(0, this.readerChapterLimit); },
        readerCanPrevious() { return this.chapterIndex > 0; },
        readerCanNext() {
            return this.chapterIndex >= 0 && this.chapterIndex < this.readerChapterSequence.length - 1 ||
                this.activeChapter?.source === 'mangadex' && this.dexHasMore;
        }
    },
    methods: {
        async jumpReaderPage(index) {
            if (!this.activeChapter || !this.pageURLs.length || !Number.isFinite(index)) return;
            this.readerPage = Math.max(0, Math.min(this.pageURLs.length - 1, Math.floor(index)));
            this.saveReadingProgress();
            await this.$nextTick();
            if (this.readingMode === 'vertical') this.$refs.readerScroll?.querySelector(`[data-page="${this.readerPage}"]`)?.scrollIntoView({ block: 'start' });
        },
        async chooseReaderChapter(chapter) {
            if (this.readerBusy) return;
            if (chapter.id !== this.activeChapter?.id) await this.openChapter(chapter);
            if (chapter.id === this.activeChapter?.id) this.readerDrawerOpen = false;
        },
        toggleReaderDrawer() {
            this.readerDrawerOpen = !this.readerDrawerOpen;
            this.readerChapterSearch = ''; this.readerChapterLimit = 80;
        },
        resetReaderControls() { this.readerDrawerOpen = false; this.readerFocus = false; this.readerChapterSearch = ''; },
        saveReaderPreferences() {
            try { localStorage.setItem('ark-reader-preferences', JSON.stringify({ width: this.readerWidth, brightness:this.readerBrightness,
                spacing:this.readerSpacing, mode:this.readingMode, direction:this.readingDirection })); } catch (_) {}
            this.changeReadingMode();
        }
    }
};
