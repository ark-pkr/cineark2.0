const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),zlib=require('node:zlib');
function setup(){const c={window:{},TextDecoder,Uint8Array,Uint32Array,DataView,DecompressionStream,File,URL,createImageBitmap:async()=>({width:10,height:20,close(){}})};vm.createContext(c);vm.runInContext(fs.readFileSync('public/assets/js/zip-chapters.js','utf8'),c);return {c,zip:c.window.ArkChapterZip};}
function archive(items,{password=false,method=8}={}){
 const {zip}=setup(),locals=[],central=[];let offset=0;
 for(const [name,text]of items){const filename=Buffer.from(name),data=Buffer.from(text),compressed=method===8?zlib.deflateRawSync(data):data,crc=zip.crc32(data),header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50);header.writeUInt16LE(password?1:0,6);header.writeUInt16LE(method,8);header.writeUInt32LE(crc,14);header.writeUInt32LE(compressed.length,18);header.writeUInt32LE(data.length,22);header.writeUInt16LE(filename.length,26);locals.push(header,filename,compressed);
  const directory=Buffer.alloc(46);directory.writeUInt32LE(0x02014b50);directory.writeUInt16LE(password?1:0,8);directory.writeUInt16LE(method,10);directory.writeUInt32LE(crc,16);directory.writeUInt32LE(compressed.length,20);directory.writeUInt32LE(data.length,24);directory.writeUInt16LE(filename.length,28);directory.writeUInt32LE(offset,42);central.push(directory,filename);offset+=header.length+filename.length+compressed.length;
 }
 const index=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(items.length,8);end.writeUInt16LE(items.length,10);end.writeUInt32LE(index.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...locals,index,end]);
}
test('ZIP finds nested chapter folders, ignores other files and sorts chapters and pages numerically',async()=>{
 const {zip}=setup(),data=archive([['Obra/Obra_Capitulo_10/Obra/Capitulo_10/010.jpg','ten'],['Obra/Obra_Capitulo_02/Obra/Capitulo_02/10.webp','ten'],['Obra/Obra_Capitulo_02/Obra/Capitulo_02/2.webp','two'],['Obra/readme.txt','ignored']]);
 const rows=zip.group(await zip.entries(new File([data],'work.zip')));assert.equal(rows.length,2);assert.equal(rows[0].number,2);assert.match(rows[0].pages[0].name,/2\.webp$/);assert.equal(rows[1].number,10);
});
test('stored and deflated pages extract with exact bytes and MIME type',async()=>{
 const {zip}=setup();for(const method of [0,8]){const file=new File([archive([['Capitulo_1/001.png','page data']],{method})],'work.zip'),[entry]=await zip.entries(file),page=await zip.extract(file,entry);assert.equal(await page.text(),'page data');assert.equal(page.type,'image/png');}
});
test('corrupt CRC, encrypted archives and truncated ZIP are rejected',async()=>{
 const {zip}=setup(),file=new File([archive([['Capitulo_1/a.jpg','page']])],'test.zip'),[entry]=await zip.entries(file);await assert.rejects(zip.extract(file,{...entry,crc:0}),/corrompida/);
 await assert.rejects(zip.entries(new File([archive([['Capitulo_1/a.jpg','page']],{password:true})],'test.zip')),/senha/);
 await assert.rejects(zip.entries(new File([Buffer.from('broken')],'test.zip')),/ZIP válido/);
});
test('declared image size is enforced during inflation, before creating a page File',async()=>{
 const {zip}=setup(),file=new File([archive([['Capitulo_1/a.jpg','x'.repeat(5000)]])],'test.zip'),[entry]=await zip.entries(file);await assert.rejects(zip.extract(file,{...entry,size:1}),/tamanho declarado/);
});
test('ZIP scanner reads only the index and tail instead of the entire archive',async()=>{
 const {zip}=setup(),data=archive([['Capitulo_1/a.jpg','data']]),base=new File([data],'test.zip');let reads=0;const source={size:base.size+1024*1024,slice(start,end){reads+=end-start;return start===source.size-65557?new Blob([new Uint8Array(65557-data.length),data]):base.slice(start,end);}};
 // Offset shifted by one MiB, as with a self-extracting prefix.
 const shifted=Buffer.from(data);shifted.writeUInt32LE(shifted.readUInt32LE(shifted.length-6)+1024*1024,shifted.length-6);const blob=new Blob([new Uint8Array(1024*1024),shifted]);source.slice=(start,end)=>{reads+=end-start;return blob.slice(start,end);};
 await zip.entries(source);assert.ok(reads<70000);
});
function appSetup(){const {c,zip}=setup(),m=c.window.zipChaptersMixin;const app={...m.data(),...m.methods,isAdmin:true,userSession:{user:{id:'admin'}},readingWork:{id:'work'},readerBusy:false,chapters:[]};for(const [name,get]of Object.entries(m.computed))Object.defineProperty(app,name,{get:()=>get.call(app)});app._zipEpoch=1;app._zipFile={};app.zipReviewed=true;const make=(number)=>({key:String(number),folder:'Capitulo_'+number,number,title:'',pages:[{name:'1.jpg'}],selected:true,status:'pending',message:''});return {app,c,zip,make};}
test('batch blocks existing and archived chapter numbers and never overwrites them',async()=>{
 const {app,make}=appSetup();app.zipRows=[make(1),make(2),make(3)];let calls=0;app.cloudAPI=()=>({chapters:async(_,archived)=>archived?[{number:2}]:[{number:1}],upload:async args=>{calls++;return {number:args.number,id:'new'};}});await app.publishChapterZip();assert.equal(calls,1);assert.equal(app.zipRows[0].status,'blocked');assert.equal(app.zipRows[1].status,'blocked');assert.equal(app.zipRows[2].status,'published');assert.equal(app.readerBusy,false);
});
test('failed chapters can be retried without resending successful chapters',async()=>{
 const {app,make}=appSetup();app.zipRows=[make(1),make(2)];const calls=[];let fail=true;app.cloudAPI=()=>({chapters:async()=>[],upload:async args=>{calls.push(args.number);if(args.number===1&&fail)throw Error('offline');return {number:args.number,id:String(args.number)};}});await app.publishChapterZip();assert.equal(app.zipRows[0].status,'error');assert.equal(app.zipRows[1].status,'published');fail=false;await app.publishChapterZip(true);assert.deepEqual(calls,[1,2,1]);assert.equal(app.zipPublishedCount,2);
});
test('pause waits for the current chapter and account change prevents the remaining batch',async()=>{
 const {app,c,make}=appSetup();app.zipRows=[make(1),make(2)];let finish,calls=0;app.cloudAPI=()=>({chapters:async()=>[],upload:async()=>{calls++;await new Promise(resolve=>finish=resolve);return {number:1,id:'one'};}});const pending=app.publishChapterZip();while(!finish)await new Promise(resolve=>setImmediate(resolve));app.zipStop=true;finish();await pending;assert.equal(calls,1);assert.equal(app.zipRows[1].status,'pending');
 app.zipRows=[make(3),make(4)];app.zipReviewed=true;finish=null;const next=app.publishChapterZip();while(!finish)await new Promise(resolve=>setImmediate(resolve));const old=app.userSession;app.userSession={user:{id:'other'}};c.window.zipChaptersMixin.watch.userSession.call(app,app.userSession,old);finish();await next;assert.equal(calls,2);assert.equal(app.zipRows.length,0);
});
test('batch refuses missing review, non-admin access, duplicate numbers and missing chapter number',async()=>{
 const {app,make}=appSetup();let writes=0;app.cloudAPI=()=>{writes++;throw Error('not allowed');};app.zipRows=[make(1)];app.zipReviewed=false;await app.publishChapterZip();app.zipReviewed=true;app.isAdmin=false;await app.publishChapterZip();app.isAdmin=true;app.zipRows.push(make(1));await app.publishChapterZip();assert.match(app.zipRowIssue(app.zipRows[0]),/repetido/);app.zipRows=[make(null)];await app.publishChapterZip();assert.match(app.zipRowIssue(app.zipRows[0]),/número/);assert.equal(writes,0);
});
