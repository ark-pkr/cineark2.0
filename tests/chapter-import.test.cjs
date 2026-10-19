const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
function setup(){
    const c={window:{},indexedDB:{open:()=>({})}};
    vm.createContext(c);vm.runInContext(fs.readFileSync('public/assets/js/reader.js','utf8'),c);
    return {isAdmin:true,readerBusy:false,chapterFiles:[],...c.window.readerMixin.methods};
}
const image=(name,size=100)=>({name,type:'image/png',size,lastModified:1});
test('folder import filters nonimages, deduplicates and sorts pages numerically',()=>{
    const app=setup();const first=image('2.png');
    app.collectChapterFiles([image('10.png'),first,{name:'notes.txt',type:'text/plain'}]);
    app.collectChapterFiles([first,image('1.png')]);
    assert.deepEqual(Array.from(app.chapterFiles,x=>x.name),['1.png','2.png','10.png']);
});
test('oversize batch preserves existing selection and busy imports cannot change it',()=>{
    const app=setup();app.collectChapterFiles([image('1.png')]);
    app.collectChapterFiles([image('2.png',16*1024*1024)]);
    assert.equal(app.chapterFiles.length,1);assert.match(app.readerError,/15 MiB/);
    app.readerBusy=true;app.collectChapterFiles([image('3.png')]);assert.equal(app.chapterFiles.length,1);
});
test('paste accepts clipboard image files and reports unavailable clipboard files',()=>{
    const app=setup();let prevented=false;
    app.pasteChapterFiles({clipboardData:{files:[image('1.png')]},preventDefault(){prevented=true;}});
    assert.equal(prevented,true);assert.equal(app.chapterFiles.length,1);
    app.pasteChapterFiles({clipboardData:{files:[]}});assert.match(app.readerError,/Nenhuma imagem/);
});
test('page review reorders and removes files without changing selection while publishing',()=>{
    const app=setup();app.collectChapterFiles([image('1.png'),image('2.png'),image('3.png')]);
    app.moveChapterPage(2,-1);
    assert.deepEqual(Array.from(app.chapterFiles,x=>x.name),['1.png','3.png','2.png']);
    app.removeChapterPage(0);
    assert.deepEqual(Array.from(app.chapterFiles,x=>x.name),['3.png','2.png']);
    app.moveChapterPage(0,-1);assert.equal(app.chapterFiles[0].name,'3.png');
    app.readerBusy=true;app.moveChapterPage(0,1);app.removeChapterPage(0);
    assert.equal(app.chapterFiles.length,2);assert.equal(app.chapterFiles[0].name,'3.png');
});
test('preview URLs survive reordering and are revoked when removed or unmounted',()=>{
    const created=[],revoked=[];const c={window:{},indexedDB:{open:()=>({})},URL:{createObjectURL:file=>{const url='blob:'+file.name;created.push(url);return url;},revokeObjectURL:url=>revoked.push(url)}};
    vm.createContext(c);vm.runInContext(fs.readFileSync('public/assets/js/reader.js','utf8'),c);
    const app={};const update=c.window.readerMixin.watch.chapterFiles;
    const a=image('1.png'),b=image('2.png');update.call(app,[a,b]);update.call(app,[b,a]);
    assert.equal(created.length,2);assert.equal(revoked.length,0);
    update.call(app,[b]);assert.deepEqual(revoked,['blob:1.png']);assert.equal(app.chapterPreviews[0].url,'blob:2.png');
    update.call(app,[]);assert.deepEqual(revoked,['blob:1.png','blob:2.png']);
});
