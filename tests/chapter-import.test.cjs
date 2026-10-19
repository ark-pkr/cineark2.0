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
