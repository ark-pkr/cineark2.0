const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function setup(backend={}){
 const storage=new Map(),c={window:{},localStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)},crypto:require('node:crypto').webcrypto,setTimeout:()=>0,clearTimeout(){},_supabase:backend};
 vm.createContext(c);vm.runInContext(fs.readFileSync('public/assets/js/reader-moments.js','utf8'),c);const mixin=c.window.readerMomentsMixin;
 const work={id:'work',title:'Test'};const app={...mixin.data(),...mixin.methods,userSession:null,catalog:[work],readingWork:work,activeChapter:{id:'chapter',source:'remote',number:12},readerPage:7,currentReaderOffset:()=>.45,_momentEpoch:1};
 for(const [name,getter]of Object.entries(mixin.computed))Object.defineProperty(app,name,{get:()=>getter.call(app)});
 return {app,storage};
}
test('guest bookmarks retain an exact point, avoid duplicate pages, and survive reload without crossing accounts',async()=>{
 const {app}=setup();app.openReaderMoments();app.momentLabel='  Minha cena  ';await app.saveReaderMoment();
 assert.equal(app.moments.length,1);assert.equal(app.moments[0].label,'Minha cena');assert.equal(app.moments[0].page_index,7);assert.equal(app.moments[0].page_offset,.45);
 await app.saveReaderMoment();assert.equal(app.moments.length,1);app.resetReaderMoments();assert.equal(app.moments.length,1);
 app.userSession={user:{id:'a'}};app.resetReaderMoments();assert.equal(app.moments.length,0);
 app.userSession=null;app.resetReaderMoments();await app.removeReaderMoment(app.moments[0]);assert.equal(app.moments.length,0);
});
test('cloud save failure never produces a falsely saved bookmark',async()=>{
 const {app}=setup({from:()=>({insert:async()=>({error:Error('offline')})})});app.userSession={user:{id:'a'}};
 app.openReaderMoments();await app.saveReaderMoment();assert.equal(app.moments.length,0);assert.match(app.momentMessage,/possível salvar/);
});
test('late bookmark save cannot populate another account',async()=>{
 let finish;const {app}=setup({from:()=>({insert:()=>new Promise(resolve=>finish=resolve)})});app.userSession={user:{id:'a'}};
 app.openReaderMoments();const pending=app.saveReaderMoment();app.userSession={user:{id:'b'}};app.resetReaderMoments();finish({error:null});await pending;assert.equal(app.moments.length,0);
});
test('opening a saved moment restores its chapter and offset rather than the latest reading position',async()=>{
 const {app}=setup();app.openReaderMoments();await app.saveReaderMoment();const moment=app.moments[0];
 app.closeReader=()=>app.activeChapter=null;app.openWork=async work=>{app.readingWork=work;app._workRequest=1;app.chapters=[{id:'chapter',source:'remote',published:true}];};app.readingProgress={work:{chapterId:'later',page:20}};
 let opened;app.openChapter=async(chapter,page)=>{opened={chapter,page,offset:app.readingProgress.work.offset};app.activeChapter=chapter;};
 await app.openReaderMoment(moment);assert.equal(opened.chapter.id,'chapter');assert.equal(opened.page,7);assert.equal(opened.offset,.45);assert.equal(app.showMoments,false);
});
test('anonymous problem report uses the captured chapter and includes no identity or signed image URL',async()=>{
 let row,writes=0;const {app}=setup({from:table=>{assert.equal(table,'ark_reader_reports');return{insert:async payload=>{row=payload;writes++;return{};}};}});
 app.openReaderProblem();app.problemDetails='Imagem em branco';app.activeChapter={id:'other',number:99};await app.submitReaderProblem();await app.submitReaderProblem();
 assert.equal(writes,1);assert.equal(row.chapter_id,'chapter');assert.equal(row.page_index,7);assert.equal(row.user_id,undefined);assert.equal(row.url,undefined);assert.equal(app.problemSent,true);
});
test('failed report retains details and allows retry',async()=>{
 const {app}=setup({from:()=>({insert:async()=>({error:Error('offline')})})});app.openReaderProblem();app.problemDetails='Ordem incorreta';await app.submitReaderProblem();
 assert.equal(app.problemDetails,'Ordem incorreta');assert.equal(app.problemSent,false);assert.match(app.problemMessage,/texto foi mantido/);
});
test('ordinary readers never fetch or resolve the admin queue',async()=>{
 const {app}=setup({from(){assert.fail('must not query admin reports');}});app.isAdmin=false;
 await app.loadProblemReports();await app.resolveReaderReport({id:'report'});
});

test('reporting an individual failed image captures that image instead of the current page',()=>{
 const {app}=setup();app.pageURLs=Array.from({length:12},()=>'/image');app.openReaderProblem(9);assert.equal(app.problemContext.page_index,9);assert.equal(app.readerPage,7);
});

test('undo restores the deleted moment and cannot cross an account switch',async()=>{
 const {app}=setup();app.openReaderMoments();await app.saveReaderMoment();const original=app.moments[0];
 await app.removeReaderMoment(original);assert.equal(app.moments.length,0);assert.equal(app.removedMoment.id,original.id);
 await app.undoRemoveReaderMoment();assert.equal(app.moments[0].id,original.id);assert.equal(app.moments[0].page_offset,.45);assert.equal(app.removedMoment,null);
 await app.removeReaderMoment(original);app.userSession={user:{id:'other'}};app.resetReaderMoments();await app.undoRemoveReaderMoment();assert.equal(app.moments.length,0);
});

test('admin report search applies work, category and decimal chapter filters on the server',async()=>{
 const filters=[];const query={select(){return this;},eq(...args){filters.push(args);return this;},order(){return this;},range:async()=>({data:[]})};
 const {app}=setup({from:()=>query});app.isAdmin=true;app.userSession={user:{id:'admin'}};app.reportWorkFilter='work';app.reportCategoryFilter='order';app.reportChapterSearch='12,5';app.reportsLimit=100;
 await app.searchProblemReports();assert.equal(app.reportsLimit,50);assert.ok(filters.some(([key,value])=>key==='work_id' && value==='work'));assert.ok(filters.some(([key,value])=>key==='category' && value==='order'));assert.ok(filters.some(([key,value])=>key==='chapter_number' && value==='12.5'));
});
