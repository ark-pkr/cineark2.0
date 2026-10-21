window.readerControlsMixin = {
    data() {
        let saved = {};
        try { saved = JSON.parse(localStorage.getItem('ark-reader-preferences') || '{}') || {}; } catch (_) {}
        return { readerDrawerOpen: false, readerChapterSearch: '', readerChapterLimit: 80, readerFocus: false, readerNavigating: false,
            readerControlsHidden:false, readerAutoHide:saved.autoHide!==false, readerTheme:['black','gray','sepia'].includes(saved.theme)?saved.theme:'black',
            readerHint:false, readerEndReached:false,readerCompletionConfirmed:false, readerFailedPages:{}, readerLoadedPages:{}, readerRetries:{},readerRetryingPages:{},readerRetryAllBusy:false,
            readerMarathon:saved.marathon===true,readerMarathonRemaining:0,readerMarathonCancelled:false,
            readerWidth: ['680', '900', '1100', 'full'].includes(saved.width) ? saved.width : '900',
            readerBrightness: Math.max(50,Math.min(100,Number(saved.brightness)||100)),
            readerSpacing: [0,8,16,24].includes(saved.spacing) ? saved.spacing : 0,
            readingMode: ['vertical','paged'].includes(saved.mode) ? saved.mode : 'vertical',
            readingDirection: saved.direction === 'rtl' ? 'rtl' : 'ltr' };
    },
    watch: {
        readerPage() { this._readerPageOffset=0;this.preloadReaderPages(); if(this.readingMode==='paged'){this.readerEndReached=this.readerPage===this.pageURLs.length-1 && !!this.readerLoadedPages[this.readerPage];if(this.readerEndReached)this.readerCompletionConfirmed=true;}else if(this.readerPage<this.pageURLs.length-1) this.readerEndReached=false; },
        activeChapter(chapter) { if(chapter) this.prepareImmersiveReader(); },
        readerEndReached(value) {if(value)this.startReaderMarathon();else this.cancelReaderMarathon(false);},
        readerCompletionConfirmed(value) {if(value)this.markChapterRead?.();},
        readerLoading(value) {if(!value && this.readerCompletionConfirmed)this.markChapterRead?.();},
        readerMarathon(value) {this.cancelReaderMarathon(false);this.readerMarathonCancelled=false;if(value && this.readerEndReached)this.startReaderMarathon();}
    },
    computed: {
        readerFailedCount() {return Object.values(this.readerFailedPages).filter(Boolean).length;},
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
        runReaderAction(action) {
            const menu=this.$refs.readerActions;if(menu){menu.open=false;menu.querySelector('summary')?.focus({preventScroll:true});}
            if(action==='moments')this.openReaderMoments();
            else if(action==='report')this.openReaderProblem();
            else if(action==='focus'){this.readerFocus=true;this.readerDrawerOpen=false;}
            else if(action==='fullscreen')this.readerFullscreen();
            else if(action==='hide')this.readerControlsHidden=true;
        },
        readerEagerPage(index) {const economy=typeof navigator!=='undefined' && navigator.connection?.saveData;return economy?index===this.readerPage:index>=this.readerPage-1 && index<=this.readerPage+2;},
        async locateCurrentReaderChapter() {
            this.readerChapterSearch='';const index=this.readingChapters.findIndex(chapter=>chapter.id===this.activeChapter?.id);
            this.readerChapterLimit=Math.max(80,index+1);await this.$nextTick();
            const button=document.querySelector('.ark-reader-chapter-list [aria-current="true"]');button?.scrollIntoView({block:'center'});button?.focus({preventScroll:true});
        },
        checkReaderCompletion(root=this.$refs.readerScroll) {
            const last=this.pageURLs.length-1;
            if(!root || last<0 || !this.readerLoadedPages[last] || this.readerFailedPages[last])return;
            if(this.readingMode==='paged'){if(this.readerPage===last){this.readerEndReached=true;this.readerCompletionConfirmed=true;}return;}
            const page=root.querySelector(`[data-page="${last}"]`);
            if(page && page.getBoundingClientRect().bottom<=root.getBoundingClientRect().bottom-40){this.readerEndReached=true;this.readerCompletionConfirmed=true;this.readerControlsHidden=false;}
        },
        async revealChapterReactions() {
            this.cancelReaderMarathon();this.readerEndReached=true;this.readerControlsHidden=false;
            await this.$nextTick();this.$refs.readerScroll?.querySelector('.ark-chapter-reactions')?.scrollIntoView({block:'center'});
        },
        readerPointerMoved(event) {
            if(event.pointerType!=='mouse' || !this.activeChapter) return;
            clearTimeout(this._readerIdleTimer);
            const rect=event.currentTarget.getBoundingClientRect(),y=event.clientY-rect.top;
            if(y<60 || y>rect.height-80) {this.readerControlsHidden=false;return;}
            if(!this.readerAutoHide || this.readerFocus || this.readerEndReached)return;
            const chapterId=this.activeChapter.id;
            this._readerIdleTimer=setTimeout(()=>{
                if(this.activeChapter?.id!==chapterId || !this.readerAutoHide || this.readerDrawerOpen || this.pageTranslationOpen || this.readerEndReached || this.$refs.readerPreferences?.open || this.$refs.readerActions?.open)return;
                if(typeof document!=='undefined' && document.activeElement?.closest?.('.ark-reader-header,.ark-reader-navigation'))return;
                this.readerControlsHidden=true;
            },2500);
        },
        cancelReaderMarathon(permanent=true) {clearTimeout(this._marathonTimer);this.readerMarathonRemaining=0;if(permanent)this.readerMarathonCancelled=true;},
        startReaderMarathon(manual=false) {
            if(!this.readerMarathon || !this.readerCanNext || !this.readerEndReached || this.readerMarathonCancelled || this.readerMarathonRemaining || (!manual && !this._marathonReachedBottom) || (typeof document!=='undefined' && document.visibilityState==='hidden'))return;
            this._marathonChapter=this.activeChapter?.id;this._marathonUser=this.userSession?.user?.id;this.readerMarathonRemaining=8;
            this._marathonTimer=setTimeout(()=>this.tickReaderMarathon(),1000);
        },
        async tickReaderMarathon() {
            if(!this.readerMarathon || !this.readerEndReached || !this.readerMarathonRemaining || this.readerMarathonCancelled || this._marathonChapter!==this.activeChapter?.id || this._marathonUser!==this.userSession?.user?.id || (typeof document!=='undefined' && document.visibilityState==='hidden')){this.cancelReaderMarathon();return;}
            this.readerMarathonRemaining--;
            if(this.readerMarathonRemaining<=0){this.readerMarathonCancelled=true;try{await this.navigateReaderChapter(1);}catch(_){this.readerError='Não foi possível abrir o próximo capítulo.';}return;}
            this._marathonTimer=setTimeout(()=>this.tickReaderMarathon(),1000);
        },
        prepareImmersiveReader() {
            this.cancelReaderMarathon(false);this.readerMarathonCancelled=false;this._marathonReachedBottom=false;
            this.readerControlsHidden=false;this.readerEndReached=false;this.readerCompletionConfirmed=false;this.readerFailedPages={};this.readerLoadedPages={};this.readerRetries={};this.readerRetryingPages={};this.readerRetryAllBusy=false;this._readerLastScroll=0;
            this._readerPreloads=new Map();
            let preferences={};
            try { const global=JSON.parse(localStorage.getItem('ark-reader-preferences') || '{}') || {};const scoped=localStorage.getItem('ark-reader-work:'+(this.userSession?.user?.id || 'guest')+':'+this.readingWork.id);preferences={width:global.width,theme:global.theme,brightness:global.brightness,...JSON.parse(scoped || localStorage.getItem('ark-reader-work:'+this.readingWork.id) || '{}')};this.readerHint=!localStorage.getItem('ark-reader-hint-seen'); }catch(_){}
            this.readingMode=['vertical','paged'].includes(preferences.mode)?preferences.mode:'vertical';
            this.readingDirection=preferences.direction==='rtl'?'rtl':'ltr';
            this.readerSpacing=[0,8,16,24].includes(preferences.spacing)?preferences.spacing:0;this.readerWidth=['680','900','1100','full'].includes(preferences.width)?preferences.width:'900';this.readerTheme=['black','gray','sepia'].includes(preferences.theme)?preferences.theme:'black';this.readerBrightness=Math.max(50,Math.min(100,Number(preferences.brightness)||100));
            this.$nextTick(()=>this.preloadReaderPages());
        },
        dismissReaderHint() { this.readerHint=false;try{localStorage.setItem('ark-reader-hint-seen','1');}catch(_){} },
        readerCanvasClick(event) {
            if(this.$refs.readerActions?.open){this.$refs.readerActions.open=false;return;}
            if(event.target.closest?.('button,a,input,select,summary') || this.readerDrawerOpen) return;
            if(typeof window.getSelection==='function' && window.getSelection()?.toString()) return;
            const rect=event.currentTarget.getBoundingClientRect(),x=(event.clientX-rect.left)/rect.width;
            if(x<.25 || x>.75) return;
            this.readerControlsHidden=!this.readerControlsHidden;
            this.dismissReaderHint();
        },
        readerScrolled(event) {
            const root=event.target,delta=root.scrollTop-(this._readerLastScroll || 0);
            if(Math.abs(delta)>12) {
                if(delta<0 && this.readerMarathonRemaining)this.cancelReaderMarathon();
                if(this.readerAutoHide && !this.readerDrawerOpen && !this.pageTranslationOpen && !this.$refs.readerPreferences?.open && !this.$refs.readerActions?.open) this.readerControlsHidden=delta>0 && root.scrollTop>100;
                this._readerLastScroll=root.scrollTop;
            }
            const last=this.pageURLs.length-1;
            this.checkReaderCompletion(root);
            if(root.scrollTop+root.clientHeight>=root.scrollHeight-60 && this.readerLoadedPages[last]) {this.readerEndReached=true;this.readerControlsHidden=false;this._marathonReachedBottom=true;this.startReaderMarathon();}
            // Store an offset within the current page, rather than a brittle total scrollTop.
            const page=root.querySelector(`[data-page="${this.readerPage}"]`);
            if(page && !this.readerLoading) {
                this._readerPageOffset=Math.max(0,Math.min(1,(root.getBoundingClientRect().top-page.getBoundingClientRect().top)/Math.max(1,page.clientHeight)));
                clearTimeout(this._readerOffsetTimer);this._readerOffsetTimer=setTimeout(()=>this.saveReadingProgress(),250);
            }
        },
        preloadReaderPages() {
            if(typeof Image==='undefined' || !this.pageURLs.length) return;
            if(typeof navigator!=='undefined' && navigator.connection?.saveData)return;
            this._readerPreloads ||= new Map();
            const start=this.readerPage,end=Math.min(start+2,this.pageURLs.length-1);
            for(const [index,image] of this._readerPreloads) if(index<start || index>end) {image.src='';this._readerPreloads.delete(index);}
            for(let index=start+1;index<=end;index++) if(!this._readerPreloads.has(index)) {
                const image=new Image(),chapter=this.activeChapter;
                image.onload=()=>{if(this.activeChapter===chapter && chapter?.source==='mangadex' && image.naturalWidth && image.naturalHeight) chapter.dimensions[index]={width:image.naturalWidth,height:image.naturalHeight};};
                image.src=this.pageURLs[index];this._readerPreloads.set(index,image);
            }
        },
        readerPageFailed(index) { this.readerFailedPages[index]=true;delete this.readerLoadedPages[index]; },
        async retryFailedReaderPages() {
            if(this.readerRetryAllBusy || this.readerBusy)return;
            const chapter=this.activeChapter,uid=this.userSession?.user?.id;
            const queue=Object.keys(this.readerFailedPages).filter(key=>this.readerFailedPages[key]).map(Number);
            this.readerRetryAllBusy=true;
            const current=()=>this.activeChapter===chapter && this.userSession?.user?.id===uid;
            const worker=async()=>{while(queue.length && current()){const index=queue.shift();await this.retryReaderPage(index);}};
            try{await Promise.all([worker(),worker()]);}finally{if(current())this.readerRetryAllBusy=false;}
        },
        async retryReaderPage(index) {
            if(!Number.isInteger(index) || index<0 || index>=this.pageURLs.length || this.readerBusy || this.readerRetryingPages[index]) return;
            this.readerRetryingPages[index]=true;
            const retryChapter=this.activeChapter;
            try {
            delete this.readerFailedPages[index];this.readerRetries[index]=(this.readerRetries[index]||0)+1;
            const chapter=this.activeChapter,userId=this.userSession?.user?.id;
            if(chapter?.source==='remote') {
                try {
                    const urls=await this.cloudAPI().signedURLs([chapter.storagePages[index]]);
                    if(this.activeChapter===chapter && userId===this.userSession?.user?.id) this.pageURLs[index]=urls[0];
                }catch(_) {if(this.activeChapter===chapter) this.readerFailedPages[index]=true;}
            }
            }finally{if(this.activeChapter===retryChapter)delete this.readerRetryingPages[index];}
        },
        async readerPageReady(event,index) {
            if(event.target.dataset?.chapter && event.target.dataset.chapter!==this.activeChapter?.id) return;
            const chapter=this.activeChapter,root=this.$refs.readerScroll;
            if(!Object.values(this.readerLoadedPages).some(Boolean))window.ArkUX?.chapterPainted();
            const anchor=root?.querySelector(`[data-page="${this.readerPage}"]`),anchorTop=anchor?.getBoundingClientRect().top;
            this.readerImageLoaded(event,index);this.readerLoadedPages[index]=true;delete this.readerFailedPages[index];
            if(this.readingMode==='paged' && index===this.pageURLs.length-1) this.readerEndReached=true;
            await this.$nextTick();
            if(this.activeChapter!==chapter) return;
            const pending=this._readerRestore;
            if(pending && pending.chapterId===this.activeChapter?.id && pending.page===index) {
                const page=root?.querySelector(`[data-page="${index}"]`);
                if(root && page) {root.scrollTop+=page.getBoundingClientRect().top-root.getBoundingClientRect().top+page.clientHeight*pending.offset;this._readerLastScroll=root.scrollTop;this._readerPageOffset=pending.offset;this._readerRestore=null;}
            } else if(this.readingMode==='vertical' && index<this.readerPage && anchor && Number.isFinite(anchorTop)) {
                root.scrollTop+=anchor.getBoundingClientRect().top-anchorTop;
            }
            this.checkReaderCompletion(root);
        },
        async jumpReaderPage(index) {
            if (!this.activeChapter || !this.pageURLs.length || !Number.isFinite(index)) return;
            this._readerPageOffset=0;this._readerRestore=null;
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
        async toggleReaderDrawer() {
            this.readerDrawerOpen = !this.readerDrawerOpen;
            this.readerChapterSearch = ''; this.readerChapterLimit = 80;
            if(this.readerDrawerOpen)await this.locateCurrentReaderChapter();
        },
        resetReaderControls() {clearTimeout(this._readerIdleTimer);this.cancelReaderMarathon(); this.readerDrawerOpen = false; this.readerFocus = false; this.readerChapterSearch = '';this.readerControlsHidden=false;clearTimeout(this._readerOffsetTimer);for(const image of this._readerPreloads?.values() || []) image.src='';this._readerPreloads?.clear(); },
        saveReaderPreferences(reobserve=true) {
            try { localStorage.setItem('ark-reader-preferences', JSON.stringify({ width: this.readerWidth, brightness:this.readerBrightness,
                spacing:this.readerSpacing, mode:this.readingMode, direction:this.readingDirection,theme:this.readerTheme,autoHide:this.readerAutoHide,marathon:this.readerMarathon }));
                if(this.readingWork) localStorage.setItem('ark-reader-work:'+(this.userSession?.user?.id || 'guest')+':'+this.readingWork.id,JSON.stringify({mode:this.readingMode,direction:this.readingDirection,spacing:this.readerSpacing,width:this.readerWidth,theme:this.readerTheme,brightness:this.readerBrightness}));
            } catch (_) {}
            if(!this.readerAutoHide) this.readerControlsHidden=false;
            if(reobserve!==false)this.changeReadingMode();
        }
    },
    mounted() {this._marathonVisibility=()=>{if(document.visibilityState==='hidden')this.cancelReaderMarathon();};document.addEventListener('visibilitychange',this._marathonVisibility);},
    beforeUnmount() {this.resetReaderControls();document.removeEventListener('visibilitychange',this._marathonVisibility);}
};
