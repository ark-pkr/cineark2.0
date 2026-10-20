const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function setup(){
 const listeners={},state={dialogs:[],time:0},doc={body:{},activeElement:null,addEventListener:(key,fn)=>listeners[key]=fn,querySelectorAll:selector=>selector.startsWith('[role')?state.dialogs:[]};
 const node=()=>({isConnected:true,style:{},getClientRects:()=>[{}],closest:()=>null,parentElement:null,tabIndex:0,matches:()=>false,focus(){doc.activeElement=this;}});
 const context={window:{},document:doc,performance:{now:()=>state.time,getEntriesByType:()=>[{domContentLoadedEventEnd:100,loadEventEnd:120}]},getComputedStyle:node=>({zIndex:node.z || 'auto',position:'static'}),MutationObserver:class{constructor(fn){state.sync=fn;}observe(){}}};
 vm.createContext(context);vm.runInContext(fs.readFileSync('public/assets/js/ux.js','utf8'),context);
 return {api:context.window.ArkUX,state,listeners,doc,node};
}
test('dialog focus is contained, Escape closes and focus returns to the opening button',()=>{
 const {state,listeners,doc,node}=setup();const trigger=node(),first=node(),last=node();doc.activeElement=trigger;
 const dialog=node();dialog.z='12000';dialog.classList={contains:()=>false};dialog.contains=target=>[first,last,dialog].includes(target);dialog.querySelectorAll=()=>[first,last];dialog.querySelector=()=>({click(){state.dialogs=[];state.sync();}});
 state.dialogs=[dialog];listeners.DOMContentLoaded();assert.equal(doc.activeElement,first);
 let prevented=false;listeners.keydown({key:'Tab',shiftKey:true,preventDefault(){prevented=true;}});assert.equal(prevented,true);assert.equal(doc.activeElement,last);
 listeners.keydown({key:'Escape',preventDefault(){},stopImmediatePropagation(){}});assert.equal(doc.activeElement,trigger);
});
test('tab wrapping does not override normal movement between controls',()=>{
 const {api}=setup(),a={},b={},c={};assert.equal(api.tabTarget([a,b,c],b,false),null);assert.equal(api.tabTarget([a,b,c],c,false),a);assert.equal(api.tabTarget([a,b,c],a,true),c);assert.equal(api.tabTarget([],a,false),null);
});
test('performance diagnostics record durations locally without chapter identities',()=>{
 const {api,state}=setup();const token=api.chapterStarted();state.time=35;api.chapterOpened(token);state.time=80;api.chapterPainted();state.time=100;api.chapterPainted();
 const metrics=api.performance();assert.equal(metrics.chapterOpenMs,35);assert.equal(metrics.chapterFirstImageMs,80);assert.equal(metrics.loadMs,120);assert.equal(metrics.chapterId,undefined);
 api.chapterStarted();state.time=150;api.chapterOpened(token);assert.equal(api.performance().chapterOpenMs,null);
});

test('failed cover keeps its layout, shows the title and recovers on a later load',()=>{
 const {listeners,doc,node}=setup();let fallback;
 doc.createElement=()=>({style:{},remove(){this.removed=true;}});
 listeners.DOMContentLoaded();
 const img=node();Object.assign(img,{tagName:'IMG',dataset:{coverTitle:'Solo Leveling'},hasAttribute:()=>true,parentElement:node(),offsetLeft:5,offsetTop:6,offsetWidth:120,offsetHeight:180,after(element){fallback=element;}});
 listeners.error({target:img});assert.equal(img.style.visibility,'hidden');assert.equal(fallback.textContent,'Solo Leveling');assert.equal(fallback.style.height,'180px');assert.notEqual(img.hidden,true);
 listeners.load({target:img});assert.equal(img.style.visibility,'');assert.equal(fallback.removed,true);
});
