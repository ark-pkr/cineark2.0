window.chapterEditorMixin={
 data(){return {editorChapter:null,editorPages:[],editorNumber:1,editorTitle:'',editorBusy:false,editorMessage:'',adminPreview:'',uploadReviewed:false,archivedChapters:[],archiveBusy:false,archiveMessage:''};},
 computed:{adminPreviewImages(){return this.adminPreview==='editor'?this.editorPages.map(row=>row.previewUrl):this.chapterPreviews.map(row=>row.url);}},
 watch:{readingWork(){this.archivedChapters=[];this.archiveMessage='';},chapterFiles(){this.uploadReviewed=false;},userSession(next,previous){if(next?.user?.id!==previous?.user?.id){this._editorEpoch=(this._editorEpoch || 0)+1;this.clearEditorURLs();this.editorChapter=null;this.editorPages=[];this.adminPreview='';this.editorBusy=false;this.archivedChapters=[];this.archiveBusy=false;this.archiveMessage='';}}},
 methods:{
  clearEditorURLs(){for(const url of this._editorURLs || [])URL.revokeObjectURL(url);this._editorURLs=new Set();},
  closeChapterEditor(){if(this.editorBusy)return;this.clearEditorURLs();this.editorChapter=null;this.editorPages=[];this.editorMessage='';this.adminPreview='';},
  startPageDrag(kind,index,event){if(!this.isAdmin || this.readerBusy || this.editorBusy)return;event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('application/x-cineark-page',JSON.stringify({kind,index}));},
  dropChapterPage(kind,target,event){
   if(!this.isAdmin || this.readerBusy || this.editorBusy)return;let data;try{data=JSON.parse(event.dataTransfer.getData('application/x-cineark-page'));}catch(_){return;}
   if(data.kind!==kind || !Number.isInteger(data.index))return;this.reorderChapterPage(kind,data.index,target);
  },
  reorderChapterPage(kind,from,to){
   if(!this.isAdmin || this.readerBusy || this.editorBusy || !['upload','editor'].includes(kind))return;
   const key=kind==='upload'?'chapterFiles':'editorPages',rows=[...this[key]];
   if(!Number.isInteger(from) || !Number.isInteger(to) || from<0 || to<0 || from>=rows.length || to>=rows.length || from===to)return;
   const [row]=rows.splice(from,1);rows.splice(to,0,row);this[key]=rows;if(kind==='upload')this._chapterOrderEdited=true;
  },
  async openChapterEditor(chapter){
   if(!this.isAdmin || this.readerBusy || this.editorBusy || chapter.source!=='remote')return;
   this.clearEditorURLs();this.editorChapter={...chapter};this.editorPages=[];this.editorMessage='';this.editorBusy=true;
   const uid=this.userSession?.user?.id,epoch=this._editorEpoch=(this._editorEpoch || 0)+1;
   const current=()=>uid===this.userSession?.user?.id && this.isAdmin && epoch===this._editorEpoch;
   try{
    const {data,error}=await _supabase.from('ark_chapters').select('id,number,title,content_revision,published,archived_at').eq('id',chapter.id).single();if(error)throw error;if(data.archived_at)throw Error('Restaure o capítulo da lixeira antes de editar.');
    const pages=await this.cloudAPI().pages(chapter.id),urls=await this.cloudAPI().signedURLs(pages);if(!current())return;
    this.editorChapter={...chapter,contentRevision:Number(data.content_revision),published:data.published};this.editorNumber=Number(data.number);this.editorTitle=data.title;
    this.editorPages=pages.map((page,index)=>({...page,key:crypto.randomUUID(),previewUrl:urls[index],file:null}));
   }catch(error){if(current())this.editorMessage=error.message || 'Não foi possível abrir o editor.';}
   finally{if(current())this.editorBusy=false;}
  },
  async replaceEditorImage(index,event){
   const file=event.target.files?.[0];event.target.value='';if(!file || !this.isAdmin || this.editorBusy || !this.editorPages[index])return;
   if(!['image/jpeg','image/png','image/webp','image/avif','image/gif'].includes(file.type) || file.size>15*1024*1024){this.editorMessage='Use uma imagem JPG, PNG, WebP, AVIF ou GIF de até 15 MiB.';return;}
   const epoch=this._editorEpoch,uid=this.userSession?.user?.id;this.editorBusy=true;let bitmap;
   try{bitmap=await createImageBitmap(file);if(epoch!==this._editorEpoch || uid!==this.userSession?.user?.id)return;
    const old=this.editorPages[index],url=URL.createObjectURL(file);this._editorURLs ||= new Set();this._editorURLs.add(url);
    this.editorPages=this.editorPages.map((row,i)=>i===index?{...row,file,width:bitmap.width,height:bitmap.height,previewUrl:url}:row);
    if(this._editorURLs.has(old.previewUrl)){URL.revokeObjectURL(old.previewUrl);this._editorURLs.delete(old.previewUrl);}this.editorMessage='Imagem substituída na prévia. Salve as correções para publicar.';
   }catch(_){if(epoch===this._editorEpoch)this.editorMessage='Não foi possível ler essa imagem. A anterior foi mantida.';}
   finally{bitmap?.close();if(epoch===this._editorEpoch)this.editorBusy=false;}
  },
  removeEditorImage(index){if(!this.isAdmin || this.editorBusy || this.editorPages.length<=1)return;const row=this.editorPages[index];if(this._editorURLs?.has(row?.previewUrl)){URL.revokeObjectURL(row.previewUrl);this._editorURLs.delete(row.previewUrl);}this.editorPages=this.editorPages.filter((_,i)=>i!==index);},
  async saveChapterCorrections(){
   if(!this.isAdmin || this.editorBusy || !this.editorChapter || !this.editorPages.length)return;
   const chapter={...this.editorChapter},uid=this.userSession?.user?.id,epoch=this._editorEpoch,workId=this.readingWork?.id,rows=[...this.editorPages],uploaded=[];
   const current=()=>uid===this.userSession?.user?.id && this.isAdmin && epoch===this._editorEpoch;
   this.editorBusy=true;this.editorMessage='Enviando correções...';
   try{
    const records=[];for(const row of rows){if(!current())throw Error('A conta mudou.');let path=row.storage_path;
     if(row.file){const ext={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/avif':'avif','image/gif':'gif'}[row.file.type];path=chapter.id+'/'+crypto.randomUUID()+'.'+ext;uploaded.push(path);const result=await _supabase.storage.from('ark-pages').upload(path,row.file,{contentType:row.file.type,upsert:false});if(result.error)throw result.error;}
     records.push({storage_path:path,width:row.width,height:row.height});
    }
    if(!current())return;
    const {error}=await _supabase.rpc('ark_edit_chapter',{p_chapter:chapter.id,p_revision:chapter.contentRevision,p_number:Number(this.editorNumber),p_title:this.editorTitle.trim(),p_pages:records});if(error)throw error;
    if(!current())return;this.editorMessage='Correções publicadas. O capítulo e o histórico foram preservados.';
    if(this.readingWork?.id===workId)await this.loadChapters(workId);
    if(current()){const updated=this.chapters.find(row=>row.id===chapter.id);if(updated)this.editorChapter={...updated};this.editorPages=this.editorPages.map((row,index)=>({...row,storage_path:records[index].storage_path,file:null}));}
   }catch(error){
    if(current()){
     // A lost response can follow a successful commit. Never remove referenced files.
     try{const active=await this.cloudAPI().pages(chapter.id),kept=new Set(active.map(row=>row.storage_path)),unused=uploaded.filter(path=>!kept.has(path));if(current() && unused.length)await _supabase.storage.from('ark-pages').remove(unused);}catch(_){}
     if(current())this.editorMessage=(error.message || 'Não foi possível confirmar as correções.')+' Reabra o editor para conferir a versão atual antes de reenviar.';
    }
   }finally{if(current())this.editorBusy=false;}
  },
  async loadArchivedChapters(){
   if(!this.isAdmin || !this.readingWork || this.archiveBusy)return;const uid=this.userSession?.user?.id,work=this.readingWork;this.archiveBusy=true;this.archiveMessage='';
   try{const rows=await this.cloudAPI().chapters(work.id,true);if(uid===this.userSession?.user?.id && this.readingWork===work)this.archivedChapters=rows;}
   catch(_){if(uid===this.userSession?.user?.id)this.archiveMessage='Não foi possível carregar a lixeira.';}
   finally{if(uid===this.userSession?.user?.id)this.archiveBusy=false;}
  },
  async restoreArchivedChapter(chapter){
   if(!this.isAdmin || this.archiveBusy || this.readerBusy)return;const uid=this.userSession?.user?.id,work=this.readingWork;this.archiveBusy=true;
   try{const {error}=await _supabase.rpc('ark_archive_chapter',{p_chapter:chapter.id,p_restore:true});if(error)throw error;if(uid!==this.userSession?.user?.id || this.readingWork!==work)return;this.archivedChapters=this.archivedChapters.filter(row=>row.id!==chapter.id);await this.loadChapters(work.id);this.archiveMessage='Capítulo restaurado com suas páginas.';}
   catch(error){if(uid===this.userSession?.user?.id)this.archiveMessage=error.message || 'Não foi possível restaurar.';}
   finally{if(uid===this.userSession?.user?.id)this.archiveBusy=false;}
  }
 },
 beforeUnmount(){this._editorEpoch=(this._editorEpoch || 0)+1;this.clearEditorURLs();}
};
