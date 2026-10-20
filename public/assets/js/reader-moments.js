window.readerMomentsMixin={
    data(){return {showMoments:false,removedMoment:null,moments:[],momentLabel:'',momentContext:null,momentBusy:false,momentLoading:false,momentMessage:'',showProblemReport:false,problemContext:null,problemCategory:'missing',problemDetails:'',problemBusy:false,problemMessage:'',problemSent:false,adminReports:[],reportsLoading:false,reportsBusy:false,reportsMessage:'',reportFilter:'open',reportsLimit:50,reportWorkFilter:'',reportCategoryFilter:'',reportChapterSearch:''};},
    computed:{
        currentMoment(){const c=this.momentContext;return c?this.moments.find(row=>row.work_id===c.work_id && row.source===c.source && row.chapter_id===c.chapter_id && row.page_index===c.page_index):null;}
    },
    watch:{
        userSession(next,previous){if(next?.user?.id!==previous?.user?.id)this.resetReaderMoments();},
        showAdmin(value){if(value && this.isAdmin)this.loadProblemReports();}
    },
    methods:{
        searchProblemReports(){this.reportsLimit=50;return this.loadProblemReports();},
        clearProblemReportFilters(){this.reportWorkFilter='';this.reportCategoryFilter='';this.reportChapterSearch='';return this.searchProblemReports();},
        async undoRemoveReaderMoment(){
            if(!this.removedMoment || this.momentBusy || this.momentLoading)return;
            const row={...this.removedMoment},uid=this.userSession?.user?.id,epoch=this._momentEpoch;
            if(this.moments.some(item=>item.work_id===row.work_id && item.source===row.source && item.chapter_id===row.chapter_id && item.page_index===row.page_index)){this.momentMessage='Este momento já está na lista.';return;}
            if(this.moments.length>=200){this.momentMessage='Remova outro momento antes de restaurar este.';return;}
            this.momentBusy=true;
            try{if(uid){const {error}=await _supabase.from('ark_reader_moments').insert({...row,user_id:uid});if(error)throw error;}
                if(uid!==this.userSession?.user?.id || epoch!==this._momentEpoch)return;
                this.moments.push(row);this.moments.sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));this.removedMoment=null;
                const cached=this.persistReaderMoments();this.momentMessage=uid || cached?'Momento restaurado.':'Restaurado nesta sessão; o navegador não permitiu salvar.';
            }catch(_){if(uid===this.userSession?.user?.id && epoch===this._momentEpoch)this.momentMessage='Não foi possível restaurar. Você pode tentar novamente.';}
            finally{if(uid===this.userSession?.user?.id && epoch===this._momentEpoch)this.momentBusy=false;}
        },
        momentStorageKey(){return 'ark-reader-moments:'+(this.userSession?.user?.id || 'guest');},
        readerMomentWork(row){return this.catalog.find(work=>work.id===row.work_id);},
        captureReaderPoint(){
            const c=this.activeChapter,w=this.readingWork;
            if(!c || !w || !['remote','mangadex'].includes(c.source))return null;
            return {work_id:w.id,source:c.source,chapter_id:String(c.id),chapter_number:String(c.number??'').slice(0,40),page_index:this.readerPage,page_offset:this.currentReaderOffset(),manga_id:c.mangaId || null,language:c.language || null};
        },
        persistReaderMoments(){try{localStorage.setItem(this.momentStorageKey(),JSON.stringify(this.moments));return true;}catch(_){return false;}},
        resetReaderMoments(){
            this._momentEpoch=(this._momentEpoch || 0)+1;this.moments=[];this.removedMoment=null;this.reportWorkFilter='';this.reportCategoryFilter='';this.reportChapterSearch='';this.showMoments=false;this.showProblemReport=false;this.momentContext=null;this.problemContext=null;this.momentMessage='';this.problemMessage='';this.momentBusy=false;this.momentLoading=false;this.problemBusy=false;this.problemSent=false;this.adminReports=[];this.reportsLoading=false;this.reportsBusy=false;this.reportsMessage='';this._reportsRequest=(this._reportsRequest || 0)+1;
            try{const rows=JSON.parse(localStorage.getItem(this.momentStorageKey()) || '[]');if(Array.isArray(rows))this.moments=rows.filter(row=>row && typeof row.id==='string' && typeof row.work_id==='string' && typeof row.chapter_id==='string' && typeof row.label==='string' && ['remote','mangadex'].includes(row.source) && Number.isInteger(row.page_index) && row.page_index>=0).slice(0,200);}catch(_){}
            clearTimeout(this._momentsTimer);if(this.userSession)this._momentsTimer=setTimeout(()=>this.loadReaderMoments(),0);
        },
        async loadReaderMoments(){
            const uid=this.userSession?.user?.id,epoch=this._momentEpoch;if(!uid || this.momentBusy || this.momentLoading)return;
            const current=()=>uid===this.userSession?.user?.id && epoch===this._momentEpoch;this.momentLoading=true;
            try{const {data,error}=await _supabase.from('ark_reader_moments').select('*').eq('user_id',uid).order('created_at',{ascending:false}).order('id').limit(200);if(error)throw error;if(current()){this.moments=data;this.persistReaderMoments();this.momentMessage='Momentos sincronizados.';}}
            catch(_){if(current())this.momentMessage='Não foi possível sincronizar. Os momentos deste navegador foram mantidos.';}
            finally{if(current())this.momentLoading=false;}
        },
        openReaderMoments(){this.cancelReaderMarathon?.();this.momentContext=this.captureReaderPoint();this.momentLabel='';this.momentMessage='';this.showMoments=true;},
        async saveReaderMoment(){
            if(this.momentBusy || this.momentLoading || !this.momentContext)return;
            if(this.currentMoment){this.momentMessage='Este momento já está salvo.';return;}
            if(this.moments.length>=200){this.momentMessage='Você já tem 200 momentos. Remova um para salvar outro.';return;}
            const uid=this.userSession?.user?.id,epoch=this._momentEpoch;
            const row={...this.momentContext,id:crypto.randomUUID(),label:(this.momentLabel.trim() || 'Momento do capítulo '+this.momentContext.chapter_number).slice(0,80),created_at:new Date().toISOString()};
            this.momentBusy=true;
            try{
                if(uid){const {error}=await _supabase.from('ark_reader_moments').insert({...row,user_id:uid});if(error)throw error;}
                if(uid!==this.userSession?.user?.id || epoch!==this._momentEpoch)return;
                this.moments.unshift(row);const cached=this.persistReaderMoments();this.momentMessage=uid?'Momento salvo na conta.':cached?'Momento salvo neste navegador.':'Momento disponível só enquanto esta página estiver aberta: o navegador não permitiu salvá-lo.';this.momentLabel='';
            }catch(_){if(uid===this.userSession?.user?.id && epoch===this._momentEpoch)this.momentMessage='Não foi possível salvar o momento. Tente novamente.';}
            finally{if(uid===this.userSession?.user?.id && epoch===this._momentEpoch)this.momentBusy=false;}
        },
        async removeReaderMoment(row){
            if(this.momentBusy || this.momentLoading)return;
            const uid=this.userSession?.user?.id,epoch=this._momentEpoch;this.momentBusy=true;
            try{if(uid){const {error}=await _supabase.from('ark_reader_moments').delete().eq('user_id',uid).eq('id',row.id);if(error)throw error;}
                if(uid!==this.userSession?.user?.id || epoch!==this._momentEpoch)return;
                this.removedMoment={...row};this.moments=this.moments.filter(item=>item.id!==row.id);const cached=this.persistReaderMoments();this.momentMessage=uid || cached?'Momento removido.':'Removido nesta sessão; o navegador não permitiu atualizar o armazenamento.';
            }catch(_){if(uid===this.userSession?.user?.id && epoch===this._momentEpoch)this.momentMessage='Não foi possível remover. Tente novamente.';}
            finally{if(uid===this.userSession?.user?.id && epoch===this._momentEpoch)this.momentBusy=false;}
        },
        async openReaderMoment(row){
            if(this.readerBusy || this.momentBusy)return;
            const work=this.readerMomentWork(row),uid=this.userSession?.user?.id,epoch=this._momentEpoch;
            if(!work){this.momentMessage='Esta obra não está mais disponível no catálogo.';return;}
            this.momentBusy=true;let request;
            const current=()=>uid===this.userSession?.user?.id && epoch===this._momentEpoch && this.readingWork?.id===work.id && request===this._workRequest;
            try{
                if(this.activeChapter)this.closeReader();const opening=this.openWork(work);request=this._workRequest;await opening;if(!current())return;
                let chapter;
                if(row.source==='mangadex'){
                    this.chapterSource='mangadex';this.dexSelected={id:row.manga_id,title:work.title};this.dexLanguage=row.language || 'pt-br';await this.loadDexChapters();if(!current())return;
                    chapter=this.dexChapters.find(item=>item.id===row.chapter_id) || {id:row.chapter_id,source:'mangadex',number:row.chapter_number,mangaId:row.manga_id,language:row.language,published:true};
                }else{this.chapterSource='library';chapter=this.chapters.find(item=>item.id===row.chapter_id && item.published);}
                if(!chapter)throw Error('unavailable');
                if(this._progressLoadingPromise)await this._progressLoadingPromise;if(!current())return;
                const key=(row.source==='mangadex'?'mangadex:':'')+work.id;
                this.readingProgress[key]={...this.readingProgress[key],chapterId:row.chapter_id,page:row.page_index,offset:row.page_offset};this._skipReaderRestore=false;
                await this.openChapter(chapter,row.page_index);
                if(current()){if(this.activeChapter?.id===row.chapter_id)this.showMoments=false;else throw Error('open');}
            }catch(_){if(current())this.momentMessage='Não foi possível abrir este momento. Confira a conexão e se o capítulo continua disponível.';}
            finally{if(uid===this.userSession?.user?.id && epoch===this._momentEpoch)this.momentBusy=false;}
        },
        openReaderProblem(page){this.cancelReaderMarathon?.();this.problemContext=this.captureReaderPoint();if(!this.problemContext)return;if(Number.isInteger(page) && page>=0 && page<this.pageURLs.length)this.problemContext.page_index=page;this.problemCategory='missing';this.problemDetails='';this.problemMessage='';this.problemSent=false;this.showProblemReport=true;},
        async submitReaderProblem(){
            if(this.problemBusy || this.problemSent || !this.problemContext || !['missing','order','wrong','other'].includes(this.problemCategory))return;
            const c=this.problemContext,epoch=this._momentEpoch;
            const row={work_id:c.work_id,source:c.source,chapter_id:c.chapter_id,chapter_number:c.chapter_number,page_index:c.page_index,category:this.problemCategory,details:this.problemDetails.trim().slice(0,500)};
            this.problemBusy=true;
            try{const {error}=await _supabase.from('ark_reader_reports').insert(row);if(error)throw error;if(epoch===this._momentEpoch){this.problemSent=true;this.problemMessage='Relato enviado. Obrigado por ajudar a melhorar a leitura!';}}
            catch(_){if(epoch===this._momentEpoch)this.problemMessage='Não foi possível enviar. Seu texto foi mantido para tentar novamente.';}
            finally{if(epoch===this._momentEpoch)this.problemBusy=false;}
        },
        reportCategoryLabel(category){return {missing:'Página ausente / falha na imagem',order:'Páginas fora de ordem',wrong:'Capítulo incorreto',other:'Outro problema'}[category] || category;},
        async loadProblemReports(){
            if(!this.isAdmin || this.reportsBusy)return;
            const uid=this.userSession?.user?.id,request=this._reportsRequest=(this._reportsRequest || 0)+1;
            this.reportsLoading=true;this.reportsMessage='';
            this.adminReports=[];
            try{
                const rows=[],status=this.reportFilter,limit=this.reportsLimit,workId=this.reportWorkFilter,category=this.reportCategoryFilter,chapter=this.reportChapterSearch.trim().replace(',','.');
                for(let offset=0;offset<limit;offset+=500){
                    const end=Math.min(offset+499,limit-1);
                    let query=_supabase.from('ark_reader_reports').select('*').eq('status',status);
                    if(workId)query=query.eq('work_id',workId);if(category)query=query.eq('category',category);if(chapter)query=query.eq('chapter_number',chapter);
                    const {data,error}=await query.order('created_at',{ascending:false}).order('id').range(offset,end);
                    if(error)throw error;if(request!==this._reportsRequest || !this.isAdmin || uid!==this.userSession?.user?.id)return;
                    rows.push(...data);if(data.length<end-offset+1)break;
                }
                this.adminReports=rows;
            }
            catch(_){if(request===this._reportsRequest)this.reportsMessage='Não foi possível carregar os relatos.';}
            finally{if(request===this._reportsRequest)this.reportsLoading=false;}
        },
        async resolveReaderReport(row){
            if(!this.isAdmin || this.reportsBusy || this.reportsLoading)return;
            const uid=this.userSession?.user?.id,epoch=this._momentEpoch;this.reportsBusy=true;
            try{const {error}=await _supabase.from('ark_reader_reports').update({status:row.status==='open'?'resolved':'open'}).eq('id',row.id).select('id').single();if(error)throw error;if(epoch===this._momentEpoch && uid===this.userSession?.user?.id){this.adminReports=this.adminReports.filter(item=>item.id!==row.id);this.reportsMessage='Status atualizado.';}}
            catch(_){if(epoch===this._momentEpoch)this.reportsMessage='Não foi possível atualizar o status.';}
            finally{if(epoch===this._momentEpoch)this.reportsBusy=false;}
        }
    },
    mounted(){this.resetReaderMoments();},
    beforeUnmount(){clearTimeout(this._momentsTimer);this._momentEpoch=(this._momentEpoch || 0)+1;this._reportsRequest=(this._reportsRequest || 0)+1;}
};
