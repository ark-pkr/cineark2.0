window.grimoireMixin = {
    data() { return { showGrimoire:false, grimoires:[], grimoireName:'', grimoireSearch:'', communityBusy:false, communityLoading:false, communityMessage:'', chapterReactions:{}, reactionOptions:[{id:'epico',label:'Épico',icon:'fa-fire'},{id:'surpreendente',label:'Surpreendente',icon:'fa-bolt'},{id:'emocionante',label:'Emocionante',icon:'fa-heart'}] }; },
    computed: {
        grimoireCatalog() { const q=window.ArkDiscovery.normalize(this.grimoireSearch);return this.catalog.filter(work=>window.ArkDiscovery.normalize(work.title).includes(q)).slice(0,80); },
        activeReactionKey() { return this.activeChapter && this.readingWork ? [this.readingWork.id,this.activeChapter.source,this.activeChapter.id].join(':') : ''; },
        activeReaction() { return this.chapterReactions[this.activeReactionKey] || ''; }
    },
    watch: {
        userSession(next,previous) { if(next?.user?.id!==previous?.user?.id) this.resetGrimoireAccount(); }
    },
    methods: {
        communityStorageKey() { return 'ark-grimoire:'+ (this.userSession?.user?.id || 'guest'); },
        persistGrimoire() {
            try {localStorage.setItem(this.communityStorageKey(),JSON.stringify({collections:this.grimoires,reactions:this.chapterReactions}));}
            catch(_) {this.communityMessage='Não foi possível guardar os dados neste navegador.';}
        },
        resetGrimoireAccount() {
            this._grimoireEpoch=(this._grimoireEpoch || 0)+1;this.grimoires=[];this.chapterReactions={};this.grimoireName='';this.grimoireSearch='';this.communityBusy=false;this.communityLoading=false;this.communityMessage='';this.showGrimoire=false;
            try {
                const saved=JSON.parse(localStorage.getItem(this.communityStorageKey()) || '{}');
                this.grimoires=Array.isArray(saved.collections)?saved.collections.filter(c=>typeof c.id==='string' && typeof c.name==='string' && Array.isArray(c.work_ids)).slice(0,100):[];
                this.chapterReactions=saved.reactions && typeof saved.reactions==='object' && !Array.isArray(saved.reactions)?Object.fromEntries(Object.entries(saved.reactions).filter(([,v])=>['epico','surpreendente','emocionante'].includes(v))):{};
            }catch(_){}
            clearTimeout(this._grimoireLoadTimer);
            if(this.userSession) this._grimoireLoadTimer=setTimeout(()=>this.loadGrimoire(),0);
        },
        async loadGrimoire() {
            const uid=this.userSession?.user?.id,epoch=this._grimoireEpoch;
            if(!uid || this.communityBusy || this.communityLoading) return;
            this.communityLoading=true;
            const current=()=>uid===this.userSession?.user?.id && epoch===this._grimoireEpoch;
            try {
                const read=async(table,order)=>{const rows=[];for(let offset=0;;offset+=500){let query=_supabase.from(table).select('*').eq('user_id',uid);for(const column of order) query=query.order(column);const {data,error}=await query.range(offset,offset+499);if(error) throw error;if(!current()) return [];rows.push(...data);if(data.length<500)return rows;}};
                const [collections,reactions]=await Promise.all([read('ark_grimoires',['id']),read('ark_chapter_reactions',['work_id','source','chapter_id'])]);
                if(!current()) return;
                this.grimoires=collections;this.chapterReactions=Object.fromEntries(reactions.map(row=>[[row.work_id,row.source,row.chapter_id].join(':'),row.reaction]));this.persistGrimoire();this.communityMessage='Grimório sincronizado.';
            }catch(_){if(current())this.communityMessage='A sincronização falhou. Os dados já guardados neste navegador foram mantidos.';}
            finally{if(current())this.communityLoading=false;}
        },
        openGrimoire() {this.showGrimoire=true;this.grimoireSearch='';},
        collectionWorks(collection) {const ids=new Set(collection.work_ids);return this.catalog.filter(work=>ids.has(work.id));},
        async saveCollection(collection,remove=false) {
            if(this.communityBusy || this.communityLoading) return false;
            const uid=this.userSession?.user?.id,epoch=this._grimoireEpoch;
            this.communityBusy=true;this.communityMessage='';
            try {
                if(uid){
                    const result=remove?await _supabase.from('ark_grimoires').delete().eq('user_id',uid).eq('id',collection.id):await _supabase.from('ark_grimoires').upsert({id:collection.id,user_id:uid,name:collection.name,work_ids:collection.work_ids},{onConflict:'user_id,id'});
                    if(result.error)throw result.error;
                }
                if(uid!==this.userSession?.user?.id || epoch!==this._grimoireEpoch)return false;
                if(remove)this.grimoires=this.grimoires.filter(c=>c.id!==collection.id);
                else if(this.grimoires.some(c=>c.id===collection.id))this.grimoires=this.grimoires.map(c=>c.id===collection.id?collection:c);
                else this.grimoires.push(collection);
                this.persistGrimoire();this.communityMessage=remove?'Coleção removida.':'Coleção salva.';return true;
            }catch(_){if(uid===this.userSession?.user?.id && epoch===this._grimoireEpoch)this.communityMessage='Não foi possível salvar a coleção. Tente novamente.';return false;}
            finally{if(uid===this.userSession?.user?.id && epoch===this._grimoireEpoch)this.communityBusy=false;}
        },
        async createCollection() {
            const name=this.grimoireName.trim().slice(0,60);
            if(!name)return;
            if(this.grimoires.length>=100){this.communityMessage='Você atingiu o limite de 100 coleções.';return;}
            if(this.grimoires.some(c=>window.ArkDiscovery.normalize(c.name)===window.ArkDiscovery.normalize(name))){this.communityMessage='Já existe uma coleção com esse nome.';return;}
            if(await this.saveCollection({id:crypto.randomUUID(),name,work_ids:[]}))this.grimoireName='';
        },
        toggleCollectionWork(collection,work) {
            const ids=new Set(collection.work_ids);
            if(ids.has(work.id))ids.delete(work.id);else ids.add(work.id);
            if(ids.size>200){this.communityMessage='Cada coleção pode ter até 200 obras.';return;}
            return this.saveCollection({...collection,work_ids:[...ids]});
        },
        deleteCollection(collection) {if(window.confirm('Remover a coleção "'+collection.name+'"? As obras continuam no catálogo.'))return this.saveCollection(collection,true);},
        async reactToChapter(reaction) {
            if(this.communityBusy || this.communityLoading || !this.activeReactionKey || !this.reactionOptions.some(r=>r.id===reaction))return;
            const key=this.activeReactionKey,chapter=this.activeChapter,work=this.readingWork,uid=this.userSession?.user?.id,epoch=this._grimoireEpoch;
            const remove=this.chapterReactions[key]===reaction;
            this.communityBusy=true;this.communityMessage='';
            try {
                if(uid){const row={user_id:uid,work_id:work.id,source:chapter.source,chapter_id:String(chapter.id),reaction};
                    if(!['remote','mangadex'].includes(row.source))throw new Error('Cópia local');
                    const result=remove?await _supabase.from('ark_chapter_reactions').delete().eq('user_id',uid).eq('work_id',work.id).eq('source',row.source).eq('chapter_id',row.chapter_id):await _supabase.from('ark_chapter_reactions').upsert(row,{onConflict:'user_id,work_id,source,chapter_id'});
                    if(result.error)throw result.error;
                }
                if(uid!==this.userSession?.user?.id || epoch!==this._grimoireEpoch)return;
                if(remove)delete this.chapterReactions[key];else this.chapterReactions[key]=reaction;
                this.persistGrimoire();this.communityMessage=remove?'Reação removida.':'Sua reação foi salva.';
            }catch(_){if(uid===this.userSession?.user?.id && epoch===this._grimoireEpoch)this.communityMessage='Não foi possível salvar sua reação. Tente novamente.';}
            finally{if(uid===this.userSession?.user?.id && epoch===this._grimoireEpoch)this.communityBusy=false;}
        }
    },
    mounted(){this.resetGrimoireAccount();},
    beforeUnmount(){clearTimeout(this._grimoireLoadTimer);}
};
