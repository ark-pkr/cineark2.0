const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
function setup(client={}) {
 const c={window:{},_supabase:client,setTimeout:()=>0,clearTimeout(){}};vm.createContext(c);
 vm.runInContext(fs.readFileSync('personal-library.js','utf8'),c);
 const mixin=c.window.personalLibraryMixin;
 const app={...mixin.data(),...mixin.methods,userSession:{user:{id:'a'}},readingWork:{id:'w'},pageURLs:[],openAuth(view){this.opened=view;}};
 for(const [key,fn] of Object.entries(mixin.computed))Object.defineProperty(app,key,{get:()=>fn.call(app)});
 return app;
}
test('visitors are asked to sign in without attempting a library write',async()=>{
 const app=setup({from(){throw Error('must not write');}});app.userSession=null;
 await app.updatePersonalWork({id:'w'},{favorite:true});assert.equal(app.opened,'login');
});
test('favorite writes preserve personal status and ignore shared admin status',async()=>{
 let payload;const app=setup({from:()=>({upsert(p){payload=p;return{select:()=>({single:async()=>({data:p})})};}})});
 app.personalLibrary.w={status:'lido',favorite:false};await app.updatePersonalWork({id:'w',status:'lendo'},{favorite:true});
 assert.equal(payload.user_id,'a');assert.equal(payload.status,'lido');assert.equal(app.personalLibrary.w.favorite,true);
});
test('account switch discards a previous account library write',async()=>{
 let finish;const app=setup({from:()=>({upsert:()=>({select:()=>({single:()=>new Promise(r=>finish=r)})})})});
 const pending=app.updatePersonalWork({id:'w'},{favorite:true});app.userSession={user:{id:'b'}};app.resetPersonalAccount();
 finish({data:{work_id:'w',favorite:true}});await pending;assert.equal(Object.keys(app.personalLibrary).length,0);
});
test('failed personal write keeps previously saved favorite and status',async()=>{
 const app=setup({from:()=>({upsert:()=>({select:()=>({single:async()=>({error:{code:'offline'}})})})})});
 app.personalLibrary.w={favorite:false,status:'pretendo'};await app.updatePersonalWork({id:'w'},{favorite:true});
 assert.equal(app.personalLibrary.w.favorite,false);assert.match(app.personalError,/mantida/);
});
test('chapter history is written once at the last page and stays separate per work',async()=>{
 let writes=0;const app=setup({from:()=>({upsert:p=>({select:async()=>{writes++;return{data:[{...p,read_at:new Date().toISOString()}]};}})})});
 app.pageURLs=['a','b'];app.activeChapter={id:'chapter',source:'mangadex',number:3};app.readerPage=0;
 await app.markChapterRead();assert.equal(writes,0);app.readerPage=1;await app.markChapterRead();await app.markChapterRead();
 assert.equal(writes,1);assert.equal(app.chapterWasRead(app.activeChapter),true);app.readingWork={id:'other'};assert.equal(app.chapterWasRead(app.activeChapter),false);
});
test('chapter search supports decimal numbers, groups and reverse order without mutating source',()=>{
 const app=setup();const chapters=[{number:1,title:'Inicio'},{number:2.5,group:'Equipe Azul'},{number:3,group:'Equipe Azul'}];
 app.chapterSearch='azul';app.chapterOrder='desc';const result=app.filterWorkChapters(chapters);
 assert.equal(result[0].number,3);assert.equal(result[1].number,2.5);assert.equal(chapters[0].number,1);
});
test('reader comfort settings restore and persist together',()=>{
 const storage=new Map([['ark-reader-preferences',JSON.stringify({width:'1100',brightness:70,spacing:16,mode:'paged',direction:'rtl'})]]);
 const c={window:{},localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)}};vm.createContext(c);vm.runInContext(fs.readFileSync('reader-controls.js','utf8'),c);
 const app={...c.window.readerControlsMixin.data(),...c.window.readerControlsMixin.methods,changeReadingMode(){}};
 assert.equal(app.readerBrightness,70);assert.equal(app.readingMode,'paged');app.readerSpacing=24;app.saveReaderPreferences();
 assert.equal(JSON.parse(storage.get('ark-reader-preferences')).spacing,24);
});
test('password recovery requests an email without requiring a password',async()=>{
 let sent;const c={window:{location:{href:'https://cineark.com.br/'}},URL,_supabase:{auth:{resetPasswordForEmail:async(email,options)=>{sent={email,options};return{};}}}};
 vm.createContext(c);vm.runInContext(fs.readFileSync('auth.js','utf8'),c);const app={...c.window.authMixin.data(),...c.window.authMixin.methods};
 app.authView='forgot';app.authEmail='reader@example.com';await app.submitAuth();assert.equal(sent.email,'reader@example.com');assert.equal(sent.options.redirectTo,'https://cineark.com.br/');assert.equal(app.authError,'');
});
test('password reset validates confirmation before calling the auth API',async()=>{
 const c={window:{},_supabase:{auth:{updateUser(){throw Error('must not call');}}}};vm.createContext(c);vm.runInContext(fs.readFileSync('auth.js','utf8'),c);
 const app={...c.window.authMixin.data(),...c.window.authMixin.methods,userSession:{user:{id:'a'}}};app.authView='reset';app.authPassword='long-password';app.authConfirm='different';await app.submitAuth();assert.match(app.authError,/confirme/);
});
test('refresh accepts newer server shelves instead of keeping stale cached status',async()=>{
 const app=setup({from:table=>({select(){return this;},eq(){return this;},order(){return this;},range:async()=>({data:table==='ark_user_library'?[{work_id:'w',status:'lido',favorite:true}]:[]})})});
 app.personalLibrary.w={status:'lendo',favorite:false};await app.loadPersonalData();
 assert.equal(app.personalLibrary.w.status,'lido');assert.equal(app.personalLibrary.w.favorite,true);
});
test('late personal library response cannot populate a different signed-in account',async()=>{
 const finish=[];const app=setup({from:()=>({select(){return this;},eq(){return this;},order(){return this;},range:()=>new Promise(resolve=>finish.push(resolve))})});
 const pending=app.loadPersonalData();app.userSession={user:{id:'b'}};app.resetPersonalAccount();
 for(const resolve of finish)resolve({data:[{work_id:'w',status:'lido'}]});await pending;
 assert.equal(Object.keys(app.personalLibrary).length,0);assert.equal(Object.keys(app.chapterHistory).length,0);
});
test('Google login uses OAuth and returns to the current site without sending a password',async()=>{
 let request;const c={window:{CINE_ARK_CONFIG:{supabaseUrl:'https://example.supabase.co',supabaseAnonKey:'public'},location:{href:'https://cineark.com.br/#catalogo'}},URL,
 fetch:async()=>({ok:true,json:async()=>({external:{google:true}})}),_supabase:{auth:{signInWithOAuth:async args=>{request=args;return{};}}}};
 vm.createContext(c);vm.runInContext(fs.readFileSync('auth.js','utf8'),c);
 const app={...c.window.authMixin.data(),...c.window.authMixin.methods,authReady:true};await app.signInWithGoogle();
 assert.equal(request.provider,'google');assert.equal(request.options.redirectTo,'https://cineark.com.br/');assert.equal('password' in request,false);assert.equal(app.authBusy,false);
});
test('disabled Google provider reports configuration failure without navigating away',async()=>{
 const c={window:{CINE_ARK_CONFIG:{supabaseUrl:'https://example.supabase.co',supabaseAnonKey:'public'}},URL,
 fetch:async()=>({ok:true,json:async()=>({external:{google:false}})}),_supabase:{auth:{signInWithOAuth(){throw Error('must not redirect');}}}};
 vm.createContext(c);vm.runInContext(fs.readFileSync('auth.js','utf8'),c);const app={...c.window.authMixin.data(),...c.window.authMixin.methods,authReady:true};
 await app.signInWithGoogle();assert.match(app.authError,/habilitado/);assert.equal(app.authBusy,false);
});
test('splash appears once per tab and stays hidden after authentication returns',()=>{
 const storage=new Map();const load=href=>{const c={window:{location:{href}},URL,URLSearchParams,sessionStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)}};vm.createContext(c);vm.runInContext(fs.readFileSync('auth.js','utf8'),c);return c.window.ArkSplash;};
 const first=load('https://cineark.com.br/');assert.equal(first.shouldShow(),true);first.dismiss();assert.equal(load('https://cineark.com.br/').shouldShow(),false);
 storage.clear();assert.equal(load('https://cineark.com.br/#access_token=example&type=signup').shouldShow(),false);
 assert.equal(load('https://cineark.com.br/?code=example').shouldShow(),false);
 assert.equal(load('https://cineark.com.br/#type=recovery').shouldShow(),false);
});
