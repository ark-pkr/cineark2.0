const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
function setup() {
 const storage=new Map();const context={window:{location:{hostname:'cineark.com.br',origin:'https://cineark.com.br',pathname:'/',hash:''}},URL,AbortController,
  localStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)},setTimeout,clearTimeout,document:{querySelector:()=>null},navigator:{}};
 vm.createContext(context);vm.runInContext(fs.readFileSync('public/assets/js/discovery.js','utf8'),context);
 const mixin=context.window.discoveryMixin;
 const app={...mixin.data(),...mixin.methods,catalog:[],personalLibrary:{},readingProgress:{},userSession:{user:{id:'a'}},localSearch:'',
  languageLabel:code=>code==='pt-br'?'Português Brasil':code,activeChapter:null};
 for(const [name,fn] of Object.entries(mixin.computed))Object.defineProperty(app,name,{get:()=>fn.call(app)});
 return {app,context,storage,helper:context.window.ArkDiscovery};
}
test('discovery combines accent-insensitive search, type, genre and preferred language',()=>{
 const {app}=setup();app.localSearch='fantasia portugues';app.discoveryType='Manhwa';app.discoveryGenre='Fantasia';app.discoveryLanguage='pt-br';
 const row={title:'Jornada',type:'Manhwa',genres:['Fantasia'],reading_language:'pt-br'};
 assert.equal(app.matchesDiscovery(row),true);assert.equal(app.matchesDiscovery({...row,reading_language:'en'}),false);
 app.clearDiscoveryFilters();assert.equal(app.currentFilter,'Todos');assert.equal(app.localSearch,'');
});
test('related works use actual genre overlap and never recommend the current work',()=>{
 const {helper}=setup();const current={id:'a',genres:['Ação','Fantasia']};
 const rows=[current,{id:'b',title:'B',genres:['Ação']},{id:'c',title:'C',genres:['Fantasia','Ação']},{id:'d',title:'D',genres:['Romance']}];
 const result=helper.related(current,rows);assert.equal(result.length,2);assert.equal(result[0].id,'c');assert.equal(result.some(row=>row.id==='a'),false);
 assert.equal(helper.related({id:'x',genres:[]},rows).length,0);
});
test('ambient settings persist and become dimmer in reading and invisible in focus mode',()=>{
 const {app,storage}=setup();app.ambientLevel='medium';app.ambientMotion=false;app.saveAtmosphere();
 assert.equal(JSON.parse(storage.get('ark-atmosphere')).motion,false);assert.equal(app.ambientOpacity,.55);
 app.activeChapter={};assert.equal(app.ambientOpacity,.1375);app.readerFocus=true;assert.equal(app.ambientOpacity,0);
});
test('favorite checks establish a baseline before reporting new chapter IDs',async()=>{
 const {app}=setup();app.catalog=[{id:'w',title:'Work'}];app.personalLibrary.w={favorite:true};let rows=[{id:'one',published:true}];
 app.cloudAPI=()=>({chapters:async()=>rows});await app.checkFavoriteUpdates();assert.equal(app.updates.w.newCount,0);
 rows=[...rows,{id:'two',published:true}];await app.checkFavoriteUpdates();assert.equal(app.updates.w.newCount,1);
 await app.checkFavoriteUpdates();assert.equal(app.updates.w.newCount,1);app.acknowledgeUpdates('w');assert.equal(app.updates.w.newCount,0);
});
test('MangaDex update checks use a remembered edition and recent metadata only',async()=>{
 const {app,storage}=setup();app.catalog=[{id:'w',title:'Work'}];app.personalLibrary.w={favorite:true};
 storage.set('ark-mangadex-links:a',JSON.stringify({w:{id:'edition',language:'pt-br'}}));
 app.cloudAPI=()=>({chapters:async()=>[]});let request;
 app.mangaDexAPI=()=>({request:async(op,args)=>{request={op,args};return{data:[{id:'chapter'}]};}});
 await app.checkFavoriteUpdates();assert.equal(request.op,'feed');assert.equal(request.args.recent,1);assert.equal(request.args.language,'pt-br');assert.equal(app.updates.w.newCount,0);
});
test('late update checks cannot populate another account or its storage',async()=>{
 const {app,storage}=setup();app.catalog=[{id:'w'}];app.personalLibrary.w={favorite:true};let finish;
 app.cloudAPI=()=>({chapters:()=>new Promise(resolve=>finish=resolve)});
 const pending=app.checkFavoriteUpdates();app.userSession={user:{id:'b'}};app.resetDiscoveryAccount();finish([{id:'private',published:true}]);await pending;
 assert.equal(Object.keys(app.updates).length,0);assert.equal(storage.has('ark-updates:b'),false);
});
test('unverified chapter counts are not treated as missing chapters',()=>{
 const {app}=setup();app.catalog=[{id:'w',poster:'https://example.com/a.jpg',synopsis:'Story'}];
 assert.equal(app.qualityCounts.noChapters,0);app.healthResults.w={count:0,cover:'ok'};assert.equal(app.qualityCounts.noChapters,1);
 app.healthFilter='chapters';assert.equal(app.matchesHealthFilter(app.catalog[0]),true);
});
test('local work links use a hash while public links use permanent routes',()=>{
 const {app,context}=setup();assert.equal(app.workRoute({slug:'solo-leveling'}),'/obra/solo-leveling');
 context.window.location.hostname='127.0.0.1';assert.equal(app.workRoute({slug:'solo-leveling'}),'/#/obra/solo-leveling');
 context.window.location.hash='#/obra/solo-leveling';assert.equal(app.currentWorkSlug(),'solo-leveling');
 context.window.location.pathname='/public/index.html';context.window.location.href='http://127.0.0.1:5500/public/index.html';
 assert.equal(app.workRoute({slug:'solo-leveling'}),'/public/#/obra/solo-leveling');assert.equal(app.homeRoute(),'/public/');
});
test('public work pages render share metadata and escape untrusted catalog fields',async()=>{
 const {renderWorkPage}=await import('../scripts/work-page.mjs');
 const html=renderWorkPage('<html><head><title>Old</title><script src="reader.js"></script></head><body><div id="app"></div></body></html>',
  {title:'Test <script>alert(1)</script>',slug:'test',synopsis:'A story',author:'"quoted"',genres:['Ação'],poster:'https://example.com/cover.jpg'},'https://cineark.com.br');
 assert.match(html,/og:title/);assert.match(html,/https:\/\/cineark.com.br\/obra\/test/);assert.match(html,/<base href="\/">/);
 assert.equal(html.includes('<script>alert(1)</script>'),false);assert.match(html,/\\u003cscript>/);assert.match(html,/id="ark-route-preview"/);
 assert.ok(html.indexOf('<base href="/">')<html.indexOf('<script src="reader.js">'));
});
test('work page handler fetches public metadata without forwarding auth and returns real 404s',async()=>{
 const {createWorkPageHandler}=await import('../scripts/work-page.mjs');let options,calls=0;
 const handler=createWorkPageHandler({settings:{supabaseUrl:'https://example.supabase.co',supabaseAnonKey:'public'},loadTemplate:async()=>'<head><title>Old</title></head><div id="app"></div>',
  fetcher:async(url,args)=>{options=args;calls++;assert.equal(url.searchParams.get('slug'),'eq.test');return Response.json([]);}});
 const response=await handler(new Request('https://cineark.com.br/obra/test',{headers:{Authorization:'Bearer private',Cookie:'private'}}));
 assert.equal(response.status,404);assert.equal(options.headers.Authorization,undefined);assert.equal(options.headers.Cookie,undefined);
 assert.equal((await handler(new Request('https://cineark.com.br/obra/invalid%3Ctag'))).status,404);assert.equal(calls,1);
});
test('work page provider failures return retryable errors rather than false not-found pages',async()=>{
 const {createWorkPageHandler}=await import('../scripts/work-page.mjs');const handler=createWorkPageHandler({settings:{supabaseUrl:'https://example.supabase.co'},loadTemplate:async()=>'',fetcher:async()=>{throw Error('offline');}});
 const result=await handler(new Request('https://cineark.com.br/obra/test'));assert.equal(result.status,503);assert.equal(result.headers.get('Retry-After'),'30');
});
test('sitemap includes public work routes and no personal data or authenticated requests',async()=>{
 const {createWorkPageHandler}=await import('../scripts/work-page.mjs');
 const handler=createWorkPageHandler({settings:{supabaseUrl:'https://example.supabase.co',supabaseAnonKey:'public'},fetcher:async(url,options)=>{
  assert.equal(url.searchParams.get('select'),'slug');assert.equal(options.headers.Authorization,undefined);return Response.json([{slug:'solo-leveling'},{slug:'naruto'}]);
 }});
 const response=await handler(new Request('https://cineark.com.br/sitemap.xml'));const body=await response.text();
 assert.equal(response.status,200);assert.match(body,/https:\/\/cineark.com.br\/obra\/solo-leveling/);assert.equal((body.match(/<loc>/g)||[]).length,3);
});
test('direct work route opens public details and refreshes them after signing in',async()=>{
 const {app,context}=setup();let calls=0;context.window.location.pathname='/obra/test';context.window.history={replaceState(){}};
 app.catalog=[{id:'w',slug:'test',title:'Work'}];app.userSession=null;app.openWork=async work=>{calls++;app.readingWork=work;};
 await app.restoreWorkRoute();assert.equal(app.readingWork.id,'w');assert.equal(calls,1);
 app.userSession={user:{id:'a'}};await app.restoreWorkRoute();assert.equal(calls,2);assert.equal(app._routeAuthenticated,true);
});
