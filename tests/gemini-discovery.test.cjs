const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const modulePromise=import('../scripts/gemini-discovery.mjs');
const work={id:'11111111-1111-4111-8111-111111111111',title:'Necromante',type:'Manhwa',genres:['Ação','Fantasia'],synopsis:'Um estrategista aprende necromancia e enfrenta monstros.'};
const answer={matches:[{id:work.id,fit:'partial',reason:'A sinopse menciona estratégia e necromancia.',uncertainty:'Não há dados sobre a quantidade de romance.',evidence:[{field:'synopsis',quote:'aprende necromancia'}]}]};
const request=(query='Quero fantasia com necromancia',extra={})=>new Request('https://cineark.example/api/discover',{method:'POST',headers:{'Content-Type':'application/json',...(extra.headers||{})},body:JSON.stringify({query,...(extra.body||{})})});
async function setup(options={}){
 const {createGeminiDiscovery}=await modulePromise,calls=[];
 const handler=createGeminiDiscovery({supabaseUrl:'https://project.supabase.co',anonKey:'public-key',apiKey:'private-test-key',fetcher:async(url,init)=>{
  calls.push({url:String(url),init});if(options.fetcher){const r=await options.fetcher(url,init);if(r)return r;}
  if(String(url).includes('/rest/v1/itens_catalogo'))return Response.json(options.catalog || [work]);
  return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(options.answer || answer)}]}}]});
 },...(options.config||{})});return {handler,calls};
}
test('intent search accepts guests and sends only the prompt and public catalog to Gemini',async()=>{
 const {handler,calls}=await setup();const response=await handler(request()),result=await response.json();assert.equal(response.status,200);assert.equal(result.matches[0].id,work.id);assert.equal(result.matches[0].evidence[0].quote,'aprende necromancia');
 const provider=calls.find(call=>call.url.includes('googleapis.com'));assert.equal(provider.init.headers['x-goog-api-key'],'private-test-key');assert.ok(!provider.url.includes('private-test-key'));const sent=JSON.parse(provider.init.body);assert.equal(sent.generationConfig.responseMimeType,'application/json');const input=JSON.parse(sent.contents[0].parts[0].text);assert.equal(input.catalog[0].id,work.id);assert.deepEqual(Object.keys(input).sort(),['catalog','request']);assert.ok(!JSON.stringify(result).includes('private-test-key'));
});
test('invalid and cross-origin queries never reach either external service',async()=>{
 const {handler,calls}=await setup();assert.equal((await handler(request('curto'))).status,400);assert.equal((await handler(request('x'.repeat(501)))).status,400);assert.equal((await handler(request(undefined,{body:{catalog:[work]}}))).status,400);assert.equal((await handler(request(undefined,{headers:{Origin:'https://other.example'}}))).status,403);assert.equal(calls.length,0);
});
test('missing Gemini key reports unavailable without pretending local matching is AI',async()=>{
 const {handler,calls}=await setup({config:{apiKey:''}});const response=await handler(request());assert.equal(response.status,503);assert.match((await response.json()).error,/ainda não foi ativada/);assert.equal(calls.length,0);
});
test('invented work IDs or unsupported quotes fail instead of becoming recommendations',async()=>{
 for(const bad of [{...answer.matches[0],id:'invented'},{...answer.matches[0],evidence:[{field:'synopsis',quote:'There is no romance'}]}]){
  const {handler}=await setup({answer:{matches:[bad]}});const response=await handler(request());assert.equal(response.status,502);assert.equal((await response.json()).matches,undefined);
 }
});
test('identical successful searches reuse cached results while new requests obey limits',async()=>{
 const {handler,calls}=await setup({config:{dailyLimit:1}});await handler(request());const cached=await handler(request());assert.equal(cached.status,200);assert.equal((await cached.json()).cached,true);const next=await handler(request('Quero aventura com magia'));assert.equal(next.status,429);assert.equal(calls.filter(call=>call.url.includes('googleapis.com')).length,1);
});
test('quota failure has a useful message and never automatically retries Gemini',async()=>{
 const {handler,calls}=await setup({fetcher:async url=>String(url).includes('googleapis.com')?Response.json({error:{message:'internal private detail'}},{status:429}):null});const response=await handler(request());assert.equal(response.status,429);const text=await response.text();assert.match(text,/cota do Gemini/);assert.ok(!text.includes('private detail'));assert.equal(calls.filter(call=>call.url.includes('googleapis.com')).length,1);
});

test('provider diagnostics identify configuration failures without echoing provider details or keys',async()=>{
 const {geminiFailure}=await modulePromise;
 for(const [status,error,code] of [[400,{details:[{reason:'API_KEY_INVALID'}],message:'private-key-detail'},'GEMINI_KEY_INVALID'],[403,{details:[{reason:'API_KEY_SERVICE_BLOCKED'}]},'GEMINI_KEY_RESTRICTED'],[400,{message:'User location is not supported for the API use.'},'GEMINI_REGION'],[404,{message:'models/unavailable not found'},'GEMINI_MODEL'],[403,{},'GEMINI_ACCESS']]){
  const result=geminiFailure(status,{error});assert.equal(result.code,code);assert.ok(!result.message.includes('private-key-detail'));
 }
 const {handler}=await setup({fetcher:async url=>String(url).includes('googleapis.com')?Response.json({error:{details:[{reason:'API_KEY_INVALID'}],message:'secret-provider-detail'}},{status:400}):null});const response=await handler(request());assert.equal(response.status,503);const value=await response.json();assert.equal(value.code,'GEMINI_KEY_INVALID');assert.ok(!JSON.stringify(value).includes('secret-provider-detail'));
});

test('hosting keys tolerate surrounding quotes and an accidentally pasted environment assignment',async()=>{
 const {handler,calls}=await setup({config:{apiKey:' GEMINI_API_KEY="private-test-key"\n'}});assert.equal((await handler(request())).status,200);assert.equal(calls.at(-1).init.headers['x-goog-api-key'],'private-test-key');
});
test('empty supported results are valid and incomplete model output is rejected',async()=>{
 const empty=await setup({answer:{matches:[]}});assert.deepEqual((await (await empty.handler(request())).json()).matches,[]);
 const incomplete=await setup({fetcher:async url=>String(url).includes('googleapis.com')?Response.json({candidates:[{finishReason:'MAX_TOKENS'}]}):null});assert.equal((await incomplete.handler(request())).status,502);
});
test('large catalogs are preselected and expose the number actually analyzed',async()=>{
 const catalog=Array.from({length:90},(_,i)=>({...work,id:'id-'+i,title:'Work '+i,genres:['Cotidiano'],synopsis:'Um estudante vive novas amizades na escola.'}));catalog[89]={...work};const {handler,calls}=await setup({catalog});const result=await (await handler(request())).json();assert.equal(result.searched,80);assert.equal(result.catalogCount,90);const body=JSON.parse(calls.at(-1).init.body);assert.equal(JSON.parse(body.contents[0].parts[0].text).catalog.length,80);
});
function uiSetup(fetcher){const c={window:{location:{hostname:'cineark.com.br'}},AbortController,setTimeout:()=>0,clearTimeout(){},fetch:fetcher};vm.createContext(c);vm.runInContext(fs.readFileSync('public/assets/js/ai-discovery.js','utf8'),c);const mixin=c.window.aiDiscoveryMixin,app={...mixin.data(),...mixin.methods,catalog:[work]};for(const [name,get]of Object.entries(mixin.computed))Object.defineProperty(app,name,{get:()=>get.call(app)});app.intentQuery='Quero fantasia com necromancia';return {app,c,mixin};}
test('UI sends no reader data and maps suggestions only to works currently in the catalog',async()=>{
 let sent;const {app}=uiSetup(async(url,init)=>{sent={url,init};return Response.json({...answer,searched:1,catalogCount:1});});await app.searchReadingIntent();assert.equal(sent.url,'/api/discover');assert.equal(sent.init.credentials,'omit');assert.deepEqual(Object.keys(JSON.parse(sent.init.body)),['query']);assert.equal(app.intentMatches[0].work.title,'Necromante');app.catalog=[];assert.equal(app.intentMatches.length,0);
});
test('late response cannot restore cleared or previous-account search results',async()=>{
 let finish;const {app,mixin}=uiSetup(()=>new Promise(resolve=>finish=resolve));const pending=app.searchReadingIntent();mixin.watch.userSession.call(app,{user:{id:'b'}},{user:{id:'a'}});finish(Response.json(answer));await pending;assert.equal(app.intentResult,null);assert.equal(app.intentBusy,false);assert.equal(app.intentQuery,'');
});
test('UI preserves the query after errors and permits retry, while Live Server uses the local backend',async()=>{
 let calls=0;const {app,c}=uiSetup(async url=>{assert.equal(url,'http://127.0.0.1:8787/api/discover');calls++;return calls===1?Response.json({error:'Cota atingida'},{status:429}):Response.json(answer);});c.window.location.hostname='127.0.0.1';await app.searchReadingIntent();assert.equal(app.intentError,'Cota atingida');assert.ok(app.intentQuery);await app.searchReadingIntent();assert.equal(app.intentMatches.length,1);assert.equal(app.intentError,'');
});

test('network failure displays a Portuguese message and keeps the prompt for retry',async()=>{
 const {app}=uiSetup(async()=>{throw new TypeError('Failed to fetch');});await app.searchReadingIntent();assert.match(app.intentError,/Não foi possível conectar/);assert.ok(!app.intentError.includes('Failed to fetch'));assert.equal(app.intentBusy,false);assert.ok(app.intentQuery);
});

test('local setup errors distinguish missing backend from a server without its Gemini key',async()=>{
 const missing=uiSetup(async()=>{throw new TypeError('Failed to fetch');});missing.c.window.location.hostname='127.0.0.1';await missing.app.searchReadingIntent();assert.match(missing.app.intentError,/Execute npm start/);
 const unconfigured=uiSetup(async()=>Response.json({code:'AI_NOT_CONFIGURED',error:'unavailable'},{status:503}));unconfigured.c.window.location.hostname='127.0.0.1';await unconfigured.app.searchReadingIntent();assert.match(unconfigured.app.intentError,/GEMINI_API_KEY/);assert.match(unconfigured.app.intentError,/hospedagem/);
});
