const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
function setup(backend={}) {
    const storage=new Map();const c={window:{ArkDiscovery:{normalize:s=>String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')}},crypto:require('node:crypto').webcrypto,localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},setTimeout:()=>0,clearTimeout(){},_supabase:backend};
    vm.createContext(c);vm.runInContext(fs.readFileSync('public/assets/js/grimoire.js','utf8'),c);
    const mixin=c.window.grimoireMixin,app={...mixin.data(),...mixin.methods,userSession:null,catalog:[{id:'work',title:'Test'}],readingWork:{id:'work'},activeChapter:{id:'chapter',source:'remote'},_grimoireEpoch:1};
    for(const [key,getter]of Object.entries(mixin.computed))Object.defineProperty(app,key,{get:()=>getter.call(app)});
    return {app,storage};
}
test('guest collections persist with membership and do not cross account boundaries',async()=>{
    const {app,storage}=setup();app.grimoireName='Para maratonar';await app.createCollection();
    assert.equal(app.grimoires.length,1);await app.toggleCollectionWork(app.grimoires[0],{id:'work'});
    assert.equal(app.collectionWorks(app.grimoires[0]).length,1);assert.ok(storage.has('ark-grimoire:guest'));
    app.userSession={user:{id:'other'}};app.resetGrimoireAccount();assert.equal(app.grimoires.length,0);
    app.userSession=null;app.resetGrimoireAccount();assert.equal(app.grimoires.length,1);assert.equal(app.grimoires[0].work_ids[0],'work');
});
test('reaction toggle allows only one reaction per chapter and keeps editions separate',async()=>{
    const {app}=setup();await app.reactToChapter('epico');assert.equal(app.activeReaction,'epico');
    await app.reactToChapter('emocionante');assert.equal(app.activeReaction,'emocionante');
    app.activeChapter={id:'chapter',source:'mangadex'};assert.equal(app.activeReaction,'');
    await app.reactToChapter('surpreendente');await app.reactToChapter('surpreendente');assert.equal(app.activeReaction,'');
    assert.equal(Object.keys(app.chapterReactions).length,1);
});
test('reaction feedback belongs to the current chapter and survives reloading guest state',async()=>{
    const {app}=setup();await app.reactToChapter('epico');assert.match(app.activeReactionMessage,/salva/);
    app.activeChapter={id:'another',source:'remote'};assert.equal(app.activeReactionMessage,'');
    app.resetGrimoireAccount();app.activeChapter={id:'chapter',source:'remote'};assert.equal(app.activeReaction,'epico');
});
test('late account write cannot populate the newly selected account',async()=>{
    let finish;const {app}=setup({from:()=>({upsert:()=>new Promise(resolve=>{finish=resolve;})})});
    app.userSession={user:{id:'a'}};
    const pending=app.saveCollection({id:'collection',name:'Private',work_ids:[]});
    app.userSession={user:{id:'b'}};app.resetGrimoireAccount();finish({error:null});await pending;
    assert.equal(app.grimoires.length,0);assert.equal(app.communityBusy,false);
});
test('failed cloud write retains the previous collection contents',async()=>{
    const {app}=setup({from:()=>({upsert:async()=>({error:new Error('offline')})})});app.userSession={user:{id:'a'}};
    app.grimoires=[{id:'collection',name:'Original',work_ids:[]}];await app.toggleCollectionWork(app.grimoires[0],{id:'work'});
    assert.equal(app.grimoires[0].work_ids.length,0);assert.match(app.communityMessage,/Não foi possível/);
});

test('genre profiles use matching emotions and preserve a previous reaction',async()=>{
    const {app}=setup();
    app.readingWork.genres=['Romance'];assert.equal(app.reactionOptions[0].id,'fofo');
    await app.reactToChapter('fofo');app.readingWork.genres=['Terror'];
    assert.equal(app.reactionOptions[0].id,'tenso');assert.ok(app.reactionOptions.some(r=>r.id==='fofo'));
    await app.reactToChapter('fofo');assert.equal(app.activeReaction,'');
    app.readingWork.genres=['Comédia'];assert.equal(app.reactionOptions[0].id,'engracado');
});

test('work overrides keep semantic IDs and persist new guest reactions',async()=>{
    const {app}=setup();app.readingWork.reaction_config={profile:'romance',labels:{fofo:'Meu casal!'}};
    assert.equal(app.reactionOptions[0].label,'Meu casal!');await app.reactToChapter('fofo');
    app.resetGrimoireAccount();assert.equal(app.activeReaction,'fofo');
    app.readingWork.reaction_config={profile:'unknown',labels:{epico:{bad:true}}};
    assert.equal(app.reactionOptions[0].id,'epico');assert.equal(typeof app.reactionOptions[0].label,'string');
});

test('community counts keep chapters separate and reject a late response',async()=>{
    const pending=[];const {app}=setup({from:()=>({select:()=>({eq(){return this;},then(resolve){pending.push(resolve);}})})});
    const first=app.loadReactionCounts();await Promise.resolve();
    app.activeChapter={id:'other',source:'remote'};const second=app.loadReactionCounts();await Promise.resolve();
    pending[1]({data:[{reaction:'epico',total:7}]});await second;
    pending[0]({data:[{reaction:'epico',total:99}]});await first;
    assert.equal(app.reactionCounts.epico,7);assert.equal(app.reactionCountsState,'ready');
});

test('unavailable counts never become fabricated zeroes',async()=>{
    const {app}=setup({from:()=>({select:()=>({eq(){return this;},then(resolve){resolve({error:new Error('offline')});}})})});
    await app.loadReactionCounts();assert.equal(app.reactionCountsState,'error');
    app.activeChapter.source='local';await app.loadReactionCounts();assert.equal(app.reactionCountsState,'local');
});
