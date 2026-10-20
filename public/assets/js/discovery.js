window.ArkDiscovery = (() => {
    const normalize = value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
    const slug = value=>normalize(value).replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,140);
    const read = (key,fallback)=>{try {return JSON.parse(localStorage.getItem(key)) || fallback;}catch(_){return fallback;}};
    const related = (work,catalog)=>{
        const genres=new Set((work?.genres||[]).map(normalize));
        return catalog.filter(item=>item.id!==work?.id && item.type!=='Anime').map(item=>({item,score:(item.genres||[]).filter(genre=>genres.has(normalize(genre))).length}))
            .filter(row=>row.score>0).sort((a,b)=>b.score-a.score || a.item.title.localeCompare(b.item.title,'pt-BR')).slice(0,8).map(row=>row.item);
    };
    const nearWord=(a,b)=>{
        if(a===b)return true;
        if(a.length<5 || a.length>40 || b.length>40 || Math.abs(a.length-b.length)>1)return false;
        if(a.length===b.length){const different=[];for(let i=0;i<a.length;i++)if(a[i]!==b[i])different.push(i);return different.length===1 || different.length===2 && different[1]===different[0]+1 && a[different[0]]===b[different[1]] && a[different[1]]===b[different[0]];}
        const short=a.length<b.length?a:b,long=a.length<b.length?b:a;let i=0,j=0,skipped=false;
        while(i<short.length && j<long.length){if(short[i]===long[j]){i++;j++;}else{if(skipped)return false;skipped=true;j++;}}return true;
    };
    const matchesSearch=(query,searchable,title)=>{
        const words=normalize(title).split(/[^a-z0-9]+/).filter(Boolean);
        return normalize(query).split(/\s+/).filter(Boolean).every(token=>normalize(searchable).includes(token) || words.some(word=>nearWord(token,word)));
    };
    return {normalize,slug,read,related,matchesSearch};
})();
window.discoveryMixin = {
    data() {
        const settings=window.ArkDiscovery.read('ark-atmosphere',{});
        return { discoveryType:'', discoveryGenre:'', discoveryLanguage:'', ambientLevel:['off','subtle','medium','vivid'].includes(settings.level)?settings.level:'vivid',
            ambientMotion:settings.motion!==false, showAtmosphere:false, shareMessage:'', routeMessage:'', updates:{}, updateBusy:false, updateMessage:'', favoriteBatchOffset:0,
            healthFilter:'', healthResults:{}, healthBusy:false, healthMessage:'', failedCovers:{} };
    },
    computed: {
        catalogNavigationSignature(){return JSON.stringify([this.localSearch,this.currentFilter,this.catalogSort,this.catalogView,this.discoveryType,this.discoveryGenre,this.discoveryLanguage,this.catalogLimit]);},
        availableGenres() { return [...new Set(this.catalog.flatMap(item=>item.genres||[]))].sort((a,b)=>a.localeCompare(b,'pt-BR')); },
        availableTypes() { return [...new Set(this.catalog.map(item=>item.type))].filter(Boolean).sort(); },
        ambientOpacity() { return ({off:0,subtle:.25,medium:.55,vivid:1}[this.ambientLevel] ?? 1)*(this.activeChapter?(this.readerFocus?0:.25):this.readingWork?.id ? .45:1); },
        relatedWorks() { return window.ArkDiscovery.related(this.readingWork,this.catalog); },
        favoriteWorks() { return this.catalog.filter(item=>this.personalLibrary[item.id]?.favorite); },
        updateEntries() { return this.favoriteWorks.map(work=>({work,...this.updates[work.id]})).filter(row=>row.checkedAt); },
        qualityCounts() { return {missingCover:this.catalog.filter(item=>!item.poster).length, missingSynopsis:this.catalog.filter(item=>!item.synopsis?.trim()).length,
            coverError:this.catalog.filter(item=>this.failedCovers[item.id] || ['error','timeout'].includes(this.healthResults[item.id]?.cover)).length,
            noChapters:this.catalog.filter(item=>this.healthResults[item.id]?.count===0).length}; }
    },
    watch: {
        catalogNavigationSignature(){if(!this.readingWork && !this._restoringCatalogView)this.rememberCatalogView();},
        catalogLoading(value){if(!value && !this.currentWorkSlug())this.restoreCatalogView();},
        discoveryType() {this.catalogLimit=24;}, discoveryGenre() {this.catalogLimit=24;}, discoveryLanguage() {this.catalogLimit=24;},
        readingWork(work,previous) {
            this.shareMessage='';
            if(!work && previous && !this._routing)this.$nextTick(()=>this.restoreCatalogView());
            if(this._routing) return;
            if(work?.slug) {
                const path=this.workRoute(work);
                if(window.location.pathname+window.location.hash!==path) window.history.pushState({arkWork:work.slug},'',path);
                document.title=work.title+' | CINE ARK';
            } else if(!work && this.currentWorkSlug()) {
                window.history.pushState({},'',this.homeRoute()); document.title='CINE ARK | Mangás e manhwas';
            }
        }
    },
    methods: {
        catalogViewStorageKey(){return 'ark-catalog-view:'+(this.userSession?.user?.id || 'guest');},
        rememberCatalogView(){
            if(this.readingWork || this._restoringCatalogView || this.currentWorkSlug())return;
            const snapshot={query:this.localSearch || '',filter:this.currentFilter || 'Todos',sort:this.catalogSort || 'recent',view:this.catalogView || 'grid',type:this.discoveryType,genre:this.discoveryGenre,language:this.discoveryLanguage,limit:this.catalogLimit,scrollY:Number(window.scrollY)||0};
            try{sessionStorage.setItem(this.catalogViewStorageKey(),JSON.stringify(snapshot));}catch(_){}
        },
        async restoreCatalogView(){
            const uid=this.userSession?.user?.id,key=this.catalogViewStorageKey();let saved;
            try{saved=JSON.parse(sessionStorage.getItem(key) || 'null');}catch(_){return;}
            if(!saved || typeof saved!=='object' || this.readingWork || this.currentWorkSlug())return;
            const request=this._catalogViewRequest=(this._catalogViewRequest || 0)+1;this._restoringCatalogView=true;
            const text=value=>typeof value==='string'?value.slice(0,200):'';
            try{
                this.localSearch=text(saved.query);this.currentFilter=uid && ['Todos','lendo','lido','pretendo','favoritos'].includes(saved.filter)?saved.filter:'Todos';
                this.catalogSort=['recent','title'].includes(saved.sort)?saved.sort:'recent';this.catalogView=saved.view==='list'?'list':'grid';
                this.discoveryType=text(saved.type);this.discoveryGenre=text(saved.genre);this.discoveryLanguage=text(saved.language);
                await this.$nextTick();if(uid!==this.userSession?.user?.id || request!==this._catalogViewRequest)return;
                this.catalogLimit=Math.max(24,Math.min(10000,Number(saved.limit)||24));await this.$nextTick();
                if(uid!==this.userSession?.user?.id || this.readingWork || this.currentWorkSlug() || request!==this._catalogViewRequest)return;
                window.scrollTo?.(0,Math.max(0,Number(saved.scrollY)||0));
            }finally{if(request===this._catalogViewRequest)this._restoringCatalogView=false;}
        },
        matchesDiscovery(item) {
            const norm=window.ArkDiscovery.normalize, query=norm(this.localSearch);
            const searchable=norm([item.title,item.author,item.type,this.languageLabel(item.reading_language),...(item.genres||[])].join(' '));
            return (!query || window.ArkDiscovery.matchesSearch(query,searchable,item.title)) &&
                (!this.discoveryType || item.type===this.discoveryType) && (!this.discoveryGenre || item.genres?.includes(this.discoveryGenre)) &&
                (!this.discoveryLanguage || item.reading_language===this.discoveryLanguage);
        },
        clearDiscoveryFilters() { this.discoveryType='';this.discoveryGenre='';this.discoveryLanguage='';this.localSearch='';this.currentFilter='Todos'; },
        saveAtmosphere() { try {localStorage.setItem('ark-atmosphere',JSON.stringify({level:this.ambientLevel,motion:this.ambientMotion}));} catch(_){} },
        currentWorkSlug() {
            const path=window.location.hash.startsWith('#/obra/')?window.location.hash.slice(1):window.location.pathname;
            const match=path.match(/^\/obra\/([a-z0-9-]{1,180})\/?$/); return match?.[1] || '';
        },
        homeRoute() {
            if(['localhost','127.0.0.1'].includes(window.location.hostname) && !window.location.pathname.startsWith('/obra/'))
                return new URL('.',window.location.href || 'http://localhost'+window.location.pathname).pathname;
            return '/';
        },
        workRoute(work) { return (['localhost','127.0.0.1'].includes(window.location.hostname)?this.homeRoute()+'#':'')+'/obra/'+encodeURIComponent(work.slug || work.id); },
        async restoreWorkRoute() {
            if(this._routing)return;
            let slug=this.currentWorkSlug();
            if(!slug && this.userSession) {try {slug=sessionStorage.getItem('ark-return-work')||'';}catch(_){} }
            if(!slug) {document.querySelector('#ark-route-preview')?.remove();return;}
            const work=this.catalog.find(item=>item.slug===slug) || (window.CINE_ARK_INITIAL_WORK?.slug===slug?window.CINE_ARK_INITIAL_WORK:null);
            if(!work) {if(this.catalog.length)this.routeMessage='Esta obra não foi encontrada. Explore os títulos disponíveis abaixo.';return;}
            this._routing=true;
            try {
                if(this.readingWork?.id!==work.id || this.userSession && !this._routeAuthenticated) await this.openWork(work);
                this._routeAuthenticated=!!this.userSession;
                window.history.replaceState({arkWork:slug},'',this.workRoute(work)); document.title=work.title+' | CINE ARK';
                document.querySelector('#ark-route-preview')?.remove();
                await this.restoreReaderLocation?.(work);
                if(this.userSession) {try {sessionStorage.removeItem('ark-return-work');}catch(_){} }
            } finally {this._routing=false;}
        },
        async handleWorkPopstate() {
            if(this.currentWorkSlug()) return this.restoreWorkRoute();
            this._routing=true;
            try {if(this.activeChapter)this.closeReader();this._workRequest=(this._workRequest||0)+1;this._chapterRequest=(this._chapterRequest||0)+1;this.cancelMangaDex?.();this.readerBusy=false;this.readingWork=null;document.title='CINE ARK | Mangás e manhwas';}
            finally {this._routing=false;await this.restoreCatalogView();}
        },
        async shareWork() {
            if(!this.readingWork?.slug)return;
            const origin=['localhost','127.0.0.1'].includes(window.location.hostname)?'https://cineark.com.br':window.location.origin;
            const url=new URL('/obra/'+this.readingWork.slug,origin).href;
            try {await navigator.clipboard.writeText(url);this.shareMessage='Link copiado!';}catch(_){this.shareMessage=url;}
        },
        async openRelatedWork(work) {await this.openWork(work);await this.$nextTick();document.querySelector('.ark-work-overlay')?.scrollTo({top:0});},
        resetDiscoveryAccount() {
            this._catalogViewRequest=(this._catalogViewRequest || 0)+1;this._restoringCatalogView=false;
            if(!this.currentWorkSlug()){const viewRequest=this._catalogViewRequest,uid=this.userSession?.user?.id;this._restoringCatalogView=true;setTimeout(async()=>{if(viewRequest!==this._catalogViewRequest || uid!==this.userSession?.user?.id)return;this.localSearch='';this.currentFilter='Todos';this.catalogSort='recent';this.catalogView='grid';this.discoveryType='';this.discoveryGenre='';this.discoveryLanguage='';this.catalogLimit=24;await this.$nextTick();this._restoringCatalogView=false;await this.restoreCatalogView();},0);}
            this._updatesEpoch=(this._updatesEpoch||0)+1;this._updatesController?.abort();this.updateBusy=false;this.updateMessage='';this.favoriteBatchOffset=0;this.updates={};
            this.healthResults={};this.healthBusy=false;this.healthMessage='';this._routeAuthenticated=false;
            if(this.userSession) {
                const saved=window.ArkDiscovery.read('ark-updates:'+this.userSession.user.id,{});
                if(saved && typeof saved==='object' && !Array.isArray(saved))this.updates=saved;
            }
        },
        acknowledgeUpdates(workId) {if(this.updates[workId]){this.updates[workId]={...this.updates[workId],newCount:0};this.persistUpdates();}},
        persistUpdates() {if(this.userSession){try{localStorage.setItem('ark-updates:'+this.userSession.user.id,JSON.stringify(this.updates));}catch(_){this.updateMessage='O navegador não permitiu guardar a comparação desta consulta.';}}},
        async checkFavoriteUpdates() {
            if(this.updateBusy || !this.userSession)return;
            const userId=this.userSession.user.id, epoch=this._updatesEpoch;
            const current=()=>this.userSession?.user?.id===userId && this._updatesEpoch===epoch;
            const controller=this._updatesController=new AbortController();this.updateBusy=true;this.updateMessage='';
            const works=this.favoriteWorks.slice(this.favoriteBatchOffset,this.favoriteBatchOffset+10);
            let links=window.ArkDiscovery.read('ark-mangadex-links:'+userId,{}),checked=0;
            try {
                for(const work of works) {
                    if(!current())return;
                    const previous=this.updates[work.id]||{}, snapshots={...(previous.snapshots||{})};let added=0,error='',sourceNote='Biblioteca';
                    const compare=(key,rows)=>{const ids=[...new Set(rows.map(row=>String(row.id)))];const old=snapshots[key];if(Array.isArray(old))added+=ids.filter(id=>!old.includes(id)).length;snapshots[key]=ids;};
                    try {const rows=await this.cloudAPI().chapters(work.id);if(!current())return;compare('library',rows.filter(row=>row.published));}
                    catch(_){error='Não foi possível consultar a biblioteca.';}
                    const saved=this.readingProgress['mangadex:'+work.id],link=links[work.id] || (saved?.mangaId?{id:saved.mangaId,language:saved.language}:null);
                    if(link?.id) {
                        const language=link.language||work.reading_language||'pt-br';sourceNote+=' + MangaDex ('+this.languageLabel(language)+', últimas 20 versões)';
                        try {const result=await this.mangaDexAPI().request('feed',{id:link.id,language,offset:0,recent:1},controller.signal);if(!current())return;compare('mangadex:'+link.id+':'+language,result.data);}
                        catch(_){if(!current())return;error+=(error?' ':'')+'MangaDex indisponível nesta consulta.';}
                    } else sourceNote+=' · Escolha uma edição do MangaDex na obra para acompanhá-la.';
                    if(!current())return;
                    this.updates[work.id]={snapshots,newCount:Math.max(0,Number(previous.newCount)||0)+added,checkedAt:new Date().toISOString(),error,sourceNote};checked++;this.persistUpdates();
                }
                this.favoriteBatchOffset+=checked;
                const more=this.favoriteBatchOffset<this.favoriteWorks.length;
                this.updateMessage=checked+' favoritos consultados. '+(more?'Clique novamente para verificar os próximos.':'A primeira consulta estabelece a referência para as próximas verificações.');
                if(!more)this.favoriteBatchOffset=0;
            } finally {if(current())this.updateBusy=false;}
        },
        reportCoverFailure(id) {this.failedCovers[id]=true;},
        matchesHealthFilter(item) {
            if(this.healthFilter==='synopsis')return !item.synopsis?.trim();
            if(this.healthFilter==='cover')return !item.poster || this.failedCovers[item.id] || ['error','timeout'].includes(this.healthResults[item.id]?.cover);
            if(this.healthFilter==='chapters')return this.healthResults[item.id]?.count===0;
            if(this.healthFilter==='source')return !!this.healthResults[item.id]?.error;
            return true;
        },
        checkCover(url) {
            if(!url)return Promise.resolve('missing');
            try {if(new URL(url).protocol!=='https:')return Promise.resolve('error');}catch(_){return Promise.resolve('error');}
            return new Promise(resolve=>{const image=new Image();const done=result=>{clearTimeout(timer);image.onload=null;image.onerror=null;resolve(result);};const timer=setTimeout(()=>done('timeout'),6000);image.onload=()=>done('ok');image.onerror=()=>done('error');image.referrerPolicy='strict-origin-when-cross-origin';image.src=url;});
        },
        async verifyCatalogQuality() {
            if(!this.isAdmin || this.healthBusy)return;
            const userId=this.userSession.user.id,epoch=this._updatesEpoch;this.healthBusy=true;this.healthMessage='';
            const current=()=>this.isAdmin && userId===this.userSession?.user?.id && epoch===this._updatesEpoch;
            const remaining=this.catalog.filter(work=>!this.healthResults[work.id]);const batch=(remaining.length?remaining:this.catalog).slice(0,20);
            const links=window.ArkDiscovery.read('ark-mangadex-links:'+userId,{});
            try {
                for(const work of batch) {
                    const cover=await this.checkCover(work.poster);if(!current())return;
                    let count=null,error='';try{count=(await this.cloudAPI().chapters(work.id)).filter(row=>row.published).length;}catch(_){error='Falha ao consultar capítulos da biblioteca.';}
                    const saved=this.readingProgress['mangadex:'+work.id],link=links[work.id] || (saved?.mangaId?{id:saved.mangaId,language:saved.language}:null);
                    if(link?.id && current()) {try{await this.mangaDexAPI().request('feed',{id:link.id,language:link.language||work.reading_language||'pt-br',offset:0,recent:1});}catch(_){error+=(error?' ':'')+'Falha ao consultar a edição conhecida do MangaDex.';}}
                    if(!current())return;
                    this.healthResults[work.id]={cover,count,error,checkedAt:new Date().toISOString()};
                    this.healthMessage='Verificadas '+Object.keys(this.healthResults).length+' de '+this.catalog.length+' obras.';
                    if(cover==='ok')delete this.failedCovers[work.id];
                }
                this.healthMessage=batch.length+' obras verificadas nesta rodada. '+(remaining.length>20?'Clique novamente para continuar.':'Capítulos externos dependem da edição e do idioma selecionados pelo leitor.');
            }finally{if(current())this.healthBusy=false;}
        }
    },
    mounted() {this._catalogScroll=()=>{clearTimeout(this._catalogScrollTimer);this._catalogScrollTimer=setTimeout(()=>this.rememberCatalogView(),180);};this._catalogPageHide=()=>this.rememberCatalogView();window.addEventListener('scroll',this._catalogScroll,{passive:true});window.addEventListener('pagehide',this._catalogPageHide);this._routePop=()=>this.handleWorkPopstate();window.addEventListener('popstate',this._routePop);window.addEventListener('hashchange',this._routePop);},
    beforeUnmount() {clearTimeout(this._catalogScrollTimer);window.removeEventListener('scroll',this._catalogScroll);window.removeEventListener('pagehide',this._catalogPageHide);this._updatesController?.abort();window.removeEventListener('popstate',this._routePop);window.removeEventListener('hashchange',this._routePop);}
};
