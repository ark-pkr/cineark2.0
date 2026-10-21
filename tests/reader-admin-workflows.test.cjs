const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function setup(backend={}){
 const storage=new Map(),listeners={},revoked=[];
 const context={window:{confirm:()=>true,addEventListener:(name,fn)=>listeners[name]=fn,removeEventListener:name=>delete listeners[name]},navigator:{onLine:true},localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},URL:{revokeObjectURL:url=>revoked.push(url)},crypto:require('node:crypto').webcrypto,_supabase:backend};
 vm.createContext(context);for(const file of ['chapter-editor.js','reader-experience.js','discovery.js','reader-moments.js'])vm.runInContext(fs.readFileSync('public/assets/js/'+file,'utf8'),context);
 const app={userSession:{user:{id:'admin'}},isAdmin:true,readerBusy:false,readingWork:{id:'work',title:'Obra'},chapterFiles:['a','b','c'],chapters:[],chapterHistory:{},chapterReadVersions:{},historyKey:(source,id)=>source+':'+id,chapterWasRead(chapter){return !!(this.chapterHistory[this.historyKey(chapter.source,chapter.id)] || this.chapterReadVersions[this.historyKey(chapter.source,chapter.id)]);},loadChapters:async()=>{}};
 for(const mixin of [context.window.chapterEditorMixin,context.window.readerExperienceMixin,context.window.readerMomentsMixin]){Object.assign(app,mixin.data(),mixin.methods);for(const [key,get]of Object.entries(mixin.computed || {}))Object.defineProperty(app,key,{get:()=>get.call(app)});}
 return {app,context,storage,listeners,revoked};
}
test('drag sorting preserves file identities and rejects unrelated drag payloads and non-admin changes',()=>{
 const {app,context}=setup();app.reorderChapterPage('upload',2,0);assert.deepEqual([...app.chapterFiles],['c','a','b']);
 app.dropChapterPage('upload',1,{dataTransfer:{getData:()=>'{"kind":"editor","index":0}'}});assert.deepEqual([...app.chapterFiles],['c','a','b']);
 app.isAdmin=false;app.reorderChapterPage('upload',0,1);assert.equal(app.chapterFiles[0],'c');
 app.uploadReviewed=true;context.window.chapterEditorMixin.watch.chapterFiles.call(app);assert.equal(app.uploadReviewed,false);
});
test('editor saves the same chapter with its expected revision and ordered image metadata',async()=>{
 let payload;const {app}=setup({rpc:async(name,args)=>{assert.equal(name,'ark_edit_chapter');payload=args;return{};}});
 app.editorChapter={id:'chapter',contentRevision:4};app.editorNumber=2;app.editorTitle=' Correção ';app.editorPages=[{storage_path:'chapter/b.jpg',width:10,height:20},{storage_path:'chapter/a.jpg',width:10,height:20}];
 await app.saveChapterCorrections();assert.equal(payload.p_chapter,'chapter');assert.equal(payload.p_revision,4);assert.equal(payload.p_title,'Correção');assert.equal(payload.p_pages[0].storage_path,'chapter/b.jpg');assert.equal(app.editorBusy,false);
});
test('lost save response never removes a replacement already referenced by the published chapter',async()=>{
 let path,removed=false;const {app}=setup({storage:{from:()=>({upload:async p=>{path=p;return{};},remove:async()=>{removed=true;return{};}})},rpc:async()=>({error:Error('Response lost')})});
 app.editorChapter={id:'chapter',contentRevision:4};app.editorNumber=2;app.editorPages=[{storage_path:'chapter/old.jpg',width:10,height:20,file:{type:'image/png'}}];app.cloudAPI=()=>({pages:async()=>[{storage_path:path}]});
 await app.saveChapterCorrections();assert.equal(removed,false);assert.match(app.editorMessage,/Response lost/);
});
test('account switch during correction upload prevents committing under the next account',async()=>{
 let finish,committed=false;const {app,context}=setup({storage:{from:()=>({upload:()=>new Promise(resolve=>finish=resolve)})},rpc:async()=>{committed=true;return{};}});
 app.editorChapter={id:'chapter',contentRevision:1};app.editorPages=[{width:10,height:20,file:{type:'image/png'}}];const pending=app.saveChapterCorrections();const old=app.userSession;app.userSession={user:{id:'other'}};context.window.chapterEditorMixin.watch.userSession.call(app,app.userSession,old);finish({});await pending;assert.equal(committed,false);assert.equal(app.editorChapter,null);
});
test('restoring a chapter uses the archive RPC and refreshes its work',async()=>{
 let restored=false,loaded=false;const {app}=setup({rpc:async(name,args)=>{assert.equal(name,'ark_archive_chapter');assert.equal(args.p_restore,true);restored=true;return{};}});app.archivedChapters=[{id:'chapter'}];app.loadChapters=async id=>{assert.equal(id,'work');loaded=true;};await app.restoreArchivedChapter({id:'chapter'});assert.ok(restored&&loaded);assert.equal(app.archivedChapters.length,0);
});
test('guest can mark a chapter read then unread without any account request',async()=>{
 const {app,storage}=setup({from:()=>{throw Error('No guest request allowed');}});app.userSession=null;const chapter={id:'chapter',source:'remote',number:1,contentRevision:3};await app.toggleChapterRead(chapter);assert.equal(app.chapterReadVersions['remote:chapter'],3);assert.ok(storage.get('ark-read-versions:guest'));await app.toggleChapterRead(chapter);assert.equal(app.chapterWasRead(chapter),false);
});
test('failed history save keeps the prior read state',async()=>{
 const {app}=setup({from:()=>({upsert:async()=>({error:Error('offline')})})});await app.toggleChapterRead({id:'chapter',source:'remote',number:1});assert.equal(Object.keys(app.chapterHistory).length,0);assert.match(app.historyActionMessage,/possível/);
});
test('forgetting reading removes both source progress only after atomic server acknowledgement',async()=>{
 let called=false;const {app}=setup({rpc:async(name,args)=>{assert.equal(name,'ark_forget_reading');assert.equal(args.p_work,'work');called=true;return{};}});app.readingProgress={work:{page:2},'mangadex:work':{page:3},other:{page:4}};app.flushReadingProgress=async()=>{};app.persistReadingProgress=()=>{};await app.forgetWorkReading(app.readingWork);assert.ok(called);assert.equal(app.readingProgress.work,undefined);assert.equal(app.readingProgress['mangadex:work'],undefined);assert.equal(app.readingProgress.other.page,4);
});
test('moment search ignores accents and report groups count reports by chapter',()=>{
 const {app}=setup();app.catalog=[{id:'work',title:'Ação e magia'}];app.moments=[{id:'a',work_id:'work',label:'Cena final'},{id:'b',work_id:'other',label:'Começo'}];app.momentSearch='acao';assert.equal(app.filteredMoments.length,1);app.momentSearch='FINAL';assert.equal(app.filteredMoments[0].id,'a');app.adminReports=[{work_id:'work',chapter_id:'a',chapter_number:1,source:'remote'},{work_id:'work',chapter_id:'a',chapter_number:1,source:'remote'},{work_id:'work',chapter_id:'b',chapter_number:2,source:'remote'}];assert.equal(app.groupedProblemReports.length,2);assert.equal(app.groupedProblemReports[0].reports.length,2);
});
test('network notices respond to events and remove their listeners on teardown',()=>{
 const {app,context,listeners}=setup();context.window.readerExperienceMixin.mounted.call(app);context.navigator.onLine=false;listeners.offline();assert.equal(app.networkOnline,false);assert.equal(app.showNetworkNotice,true);context.navigator.onLine=true;listeners.online();assert.equal(app.networkOnline,true);context.window.readerExperienceMixin.beforeUnmount.call(app);assert.deepEqual(Object.keys(listeners),[]);
});
