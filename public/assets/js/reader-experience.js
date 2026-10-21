window.readerExperienceMixin={
 data(){return {historyActionBusy:false,historyActionMessage:'',networkOnline:typeof navigator==='undefined' || navigator.onLine!==false,showNetworkNotice:false};},
 watch:{userSession(next,previous){if(next?.user?.id!==previous?.user?.id){this._experienceEpoch=(this._experienceEpoch || 0)+1;this.historyActionBusy=false;this.historyActionMessage='';this._forgettingWorkId=null;}}},
 methods:{
  async toggleChapterRead(chapter){
   if(this.historyActionBusy || this.readerBusy || !this.readingWork)return;
   const work=this.readingWork,uid=this.userSession?.user?.id,epoch=this._experienceEpoch,key=this.historyKey(chapter.source || 'remote',chapter.id),remove=this.chapterWasRead(chapter);
   if(this._historyPending?.has(key)){this.historyActionMessage='Aguarde a gravação do histórico e tente novamente.';return;}
   const row={user_id:uid,work_id:work.id,source:chapter.source || 'remote',chapter_id:String(chapter.id),chapter_number:String(chapter.number??''),chapter_revision:Number(chapter.contentRevision || 1),read_at:new Date().toISOString()};
   this.historyActionBusy=true;this.historyActionMessage='';
   try{
    if(uid){const result=remove?await _supabase.from('ark_read_history').delete().eq('user_id',uid).eq('work_id',work.id).eq('source',row.source).eq('chapter_id',row.chapter_id):await _supabase.from('ark_read_history').upsert(row,{onConflict:'user_id,work_id,source,chapter_id'});if(result.error)throw result.error;}
    if(uid!==this.userSession?.user?.id || epoch!==this._experienceEpoch)return;
    if(remove){delete this.chapterHistory[key];delete this.chapterReadVersions[key];if(this.activeChapter?.id===chapter.id)this.readerCompletionConfirmed=false;}
    else if(uid)this.chapterHistory[key]=row;else this.chapterReadVersions[key]=row.chapter_revision;
    let cached=true;if(!uid)try{localStorage.setItem('ark-read-versions:guest',JSON.stringify(this.chapterReadVersions));}catch(_){cached=false;}
    this.historyActionMessage=cached?(remove?'Capítulo marcado como não lido.':'Capítulo marcado como lido.'):'Histórico alterado nesta sessão; o navegador não permitiu salvar.';
   }catch(_){if(uid===this.userSession?.user?.id && epoch===this._experienceEpoch)this.historyActionMessage='Não foi possível alterar o histórico. Tente novamente.';}
   finally{if(uid===this.userSession?.user?.id && epoch===this._experienceEpoch)this.historyActionBusy=false;}
  },
  async forgetWorkReading(work){
   if(this.historyActionBusy || this.readerBusy || this.activeChapter || !work)return;
   if(!window.confirm('Remover o ponto de leitura salvo de '+work.title+'? Os capítulos lidos e momentos favoritos serão mantidos.'))return;
   const uid=this.userSession?.user?.id,epoch=this._experienceEpoch;this.historyActionBusy=true;this.readerBusy=true;this._forgettingWorkId=work.id;
   const current=()=>uid===this.userSession?.user?.id && epoch===this._experienceEpoch;
   try{
    await Promise.all([this._progressLoadingPromise,this._dexProgressLoad?.promise]);await this.flushReadingProgress();if(!current())return;
    if(uid){const {error}=await _supabase.rpc('ark_forget_reading',{p_work:work.id});if(error)throw error;if(!current())return;}
    this._progressLoadRequest=(this._progressLoadRequest || 0)+1;this._progressLoadingPromise=null;this._dexProgressLoad=null;this.progressLoading=false;
    delete this.readingProgress[work.id];delete this.readingProgress['mangadex:'+work.id];this.persistReadingProgress();this.historyActionMessage='Ponto removido da continuação da leitura.';
   }catch(_){if(current())this.historyActionMessage='Não foi possível concluir a remoção. Tente novamente.';}
   finally{if(current()){this._forgettingWorkId=null;this.historyActionBusy=false;this.readerBusy=false;}}
  },
  async showNotificationsPanel(){this.showNotifications=true;await this.$nextTick();document.querySelector('#ark-notifications')?.scrollIntoView({block:'start'});if(this.favoriteWorks.length && !this.updateBusy)this.checkFavoriteUpdates();}
 },
 mounted(){
  this._networkChanged=()=>{this.networkOnline=navigator.onLine!==false;this.showNetworkNotice=true;};
  window.addEventListener('online',this._networkChanged);window.addEventListener('offline',this._networkChanged);if(!this.networkOnline)this.showNetworkNotice=true;
 },
 beforeUnmount(){window.removeEventListener('online',this._networkChanged);window.removeEventListener('offline',this._networkChanged);this._experienceEpoch=(this._experienceEpoch || 0)+1;}
};
