// Account-owned shelves and completed chapters; catalog data remains shared.
window.personalLibraryMixin = {
    data() { return { personalLibrary: {}, chapterHistory: {}, personalBusy: false, personalLoading: false,
        personalError: '', showProfile: false, profileName: '', profileMessage: '', chapterSearch: '', chapterOrder: 'asc', catalogLimit: 24, workChapterLimit:100,
        languageOptions: [{code:'pt-br',label:'Português (Brasil)'},{code:'pt',label:'Português (Portugal)'},{code:'en',label:'Inglês'},
            {code:'es',label:'Espanhol'},{code:'es-la',label:'Espanhol (América Latina)'},{code:'fr',label:'Francês'},
            {code:'de',label:'Alemão'},{code:'it',label:'Italiano'},{code:'ja',label:'Japonês'},{code:'ko',label:'Coreano'},
            {code:'zh',label:'Chinês simplificado'},{code:'zh-hk',label:'Chinês tradicional'}] }; },
    computed: {
        visibleCatalog() { return this.filteredCatalog.slice(0, this.catalogLimit); },
        profileHistory() { return Object.values(this.chapterHistory).sort((a,b) => Date.parse(b.read_at)-Date.parse(a.read_at)); },
        personalStats() { return { favorites: Object.values(this.personalLibrary).filter(row=>row.favorite).length,
            reading: Object.values(this.personalLibrary).filter(row=>row.status==='lendo').length, completed: Object.values(this.personalLibrary).filter(row=>row.status==='lido').length,
            chapters: Object.keys(this.chapterHistory).length }; },
        filteredLibraryChapters() { return this.filterWorkChapters(this.chapters); },
        filteredDexChapters() { return this.filterWorkChapters(this.dexChapters); }
    },
    watch: {
        currentFilter() { this.catalogLimit=24; }, localSearch() { this.catalogLimit=24; },
        readingWork() { this.chapterSearch=''; this.chapterOrder='asc'; this.workChapterLimit=100; },
        chapterSearch() { this.dexVisibleLimit=100; this.workChapterLimit=100; }, chapterOrder() { this.dexVisibleLimit=100; this.workChapterLimit=100; }
    },
    methods: {
        languageLabel(code) { return this.languageOptions.find(row=>row.code===code)?.label || code || 'Não informado'; },
        historyKey(source, chapterId, workId=this.readingWork?.id) { return workId+':'+source+':'+chapterId; },
        chapterWasRead(chapter) { return !!this.chapterHistory[this.historyKey(chapter.source || 'remote',chapter.id)]; },
        filterWorkChapters(chapters) { const q=this.chapterSearch.trim().toLocaleLowerCase('pt-BR'); return [...chapters].filter(row=>!q || [row.number,row.title,row.group].some(v=>String(v||'').toLocaleLowerCase('pt-BR').includes(q))).sort((a,b)=>(Number(a.number)-Number(b.number))*(this.chapterOrder==='desc'?-1:1)); },
        resetPersonalAccount() {
            this._personalEpoch=(this._personalEpoch||0)+1; this.personalLibrary={}; this.chapterHistory={}; this.personalError=''; this.personalBusy=false; this.personalLoading=false; this.showProfile=false;
            this._historyPending=new Set(); clearTimeout(this._personalTimer);
            if(this.userSession) this._personalTimer=setTimeout(()=>this.loadPersonalData(),0);
        },
        async loadPersonalData() {
            const userId=this.userSession?.user?.id, epoch=this._personalEpoch;
            if(!userId || this.personalLoading) return;
            this.personalLoading=true; this.personalError='';
            const beforeLibrary={...this.personalLibrary}, beforeHistory={...this.chapterHistory};
            const current=()=>this.userSession?.user?.id===userId && this._personalEpoch===epoch;
            try {
                const read=async(table)=>{ const rows=[]; for(let offset=0;;offset+=500) { let query=_supabase.from(table).select('*').eq('user_id',userId).order('work_id'); if(table==='ark_read_history') query=query.order('source').order('chapter_id'); const {data,error}=await query.range(offset,offset+499); if(error) throw error; if(!current()) return []; rows.push(...data); if(data.length<500) return rows; } };
                const [library,history]=await Promise.all([read('ark_user_library'),read('ark_read_history')]);
                if(!current()) return;
                // Keep successful writes that occurred while this read was in flight.
                const changed=(rows,before)=>Object.fromEntries(Object.entries(rows).filter(([key,row])=>row!==before[key]));
                this.personalLibrary={...Object.fromEntries(library.map(row=>[row.work_id,row])),...changed(this.personalLibrary,beforeLibrary)};
                this.chapterHistory={...Object.fromEntries(history.map(row=>[this.historyKey(row.source,row.chapter_id,row.work_id),row])),...changed(this.chapterHistory,beforeHistory)};
            } catch(_) { if(current()) this.personalError='Não foi possível sincronizar sua biblioteca pessoal. Tente novamente.'; }
            finally { if(current()) this.personalLoading=false; }
        },
        async updatePersonalWork(work, changes) {
            if(!this.userSession) { this.openAuth('login'); return; }
            if(this.personalBusy) return;
            const userId=this.userSession.user.id, epoch=this._personalEpoch, existing=this.personalLibrary[work.id]||{};
            const status=changes.status ?? existing.status ?? 'pretendo';
            if(!['lendo','lido','pretendo'].includes(status)) return;
            this.personalBusy=true; this.personalError='';
            try {
                const {data,error}=await _supabase.from('ark_user_library').upsert({user_id:userId,work_id:work.id,status,favorite:changes.favorite ?? existing.favorite ?? false},{onConflict:'user_id,work_id'}).select().single();
                if(error) throw error;
                if(userId===this.userSession?.user?.id && epoch===this._personalEpoch) this.personalLibrary[work.id]=data;
            } catch(_) { if(userId===this.userSession?.user?.id && epoch===this._personalEpoch) this.personalError='Não foi possível salvar. Sua seleção anterior foi mantida.'; }
            finally { if(userId===this.userSession?.user?.id && epoch===this._personalEpoch) this.personalBusy=false; }
        },
        async changePersonalStatus(work,event) {
            const select=event.target;
            await this.updatePersonalWork(work,{status:select.value});
            select.value=this.personalLibrary[work.id]?.status || '';
        },
        async markChapterRead() {
            const chapter=this.activeChapter, work=this.readingWork, userId=this.userSession?.user?.id, epoch=this._personalEpoch;
            if(!userId || !work || !chapter || !['remote','mangadex'].includes(chapter.source) || !this.pageURLs.length || this.readerPage!==this.pageURLs.length-1 || this.readerLoading) return;
            const key=this.historyKey(chapter.source,chapter.id);
            this._historyPending ||= new Set(); if(this.chapterHistory[key] || this._historyPending.has(key)) return;
            const pending=this._historyPending; pending.add(key);
            try {
                const {data,error}=await _supabase.from('ark_read_history').upsert({user_id:userId,work_id:work.id,source:chapter.source,chapter_id:String(chapter.id),chapter_number:String(chapter.number??'')},{onConflict:'user_id,work_id,source,chapter_id',ignoreDuplicates:true}).select();
                if(error) throw error;
                if(userId===this.userSession?.user?.id && epoch===this._personalEpoch) this.chapterHistory[key]=data?.[0] || {user_id:userId,work_id:work.id,source:chapter.source,chapter_id:String(chapter.id),chapter_number:String(chapter.number??''),read_at:new Date().toISOString()};
            } catch(_) { if(userId===this.userSession?.user?.id && epoch===this._personalEpoch) this.personalError='O histórico não sincronizou. Seu ponto de leitura continua salvo.'; }
            finally { pending.delete(key); }
        },
        openReaderProfile() { if(!this.userSession) return this.openAuth('login'); this.profileName=this.userSession.user.user_metadata?.display_name||this.userSession.user.user_metadata?.full_name||''; this.profileMessage=''; this.showProfile=true; },
        async saveProfileName() {
            if(this.personalBusy || !this.profileName.trim() || !this.userSession) return;
            const userId=this.userSession.user.id; this.personalBusy=true; this.profileMessage='';
            try { const {data,error}=await _supabase.auth.updateUser({data:{display_name:this.profileName.trim().slice(0,80)}}); if(error) throw error; if(this.userSession?.user?.id===userId) { this.userSession={...this.userSession,user:data.user}; this.profileMessage='Nome atualizado.'; } }
            catch(_) { if(this.userSession?.user?.id===userId) this.profileMessage='Não foi possível atualizar o nome.'; }
            finally { if(this.userSession?.user?.id===userId) this.personalBusy=false; }
        },
        historyWork(row) { return this.catalog.find(work=>work.id===row.work_id); }
    },
    beforeUnmount() { clearTimeout(this._personalTimer); }
};
