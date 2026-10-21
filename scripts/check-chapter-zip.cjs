/* Read-only local ZIP check. Does not upload or extract files to disk. */
const fs=require('node:fs'),vm=require('node:vm');
async function main(){
 const path=process.argv[2];if(!path)throw Error('Uso: node scripts/check-chapter-zip.cjs caminho.zip');
 const handle=await fs.promises.open(path,'r');
 try{
  const stat=await handle.stat();
  const source={size:stat.size,slice(start,end){
   const read=async()=>{
    const buffer=Buffer.alloc(end-start);let offset=0;
    while(offset<buffer.length){const {bytesRead}=await handle.read(buffer,offset,buffer.length-offset,start+offset);if(!bytesRead)throw Error('Arquivo incompleto');offset+=bytesRead;}
    return buffer;
   };
   return {
    arrayBuffer:async()=>{const b=await read();return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);},
    stream(){return new ReadableStream({async start(controller){try{controller.enqueue(new Uint8Array(await read()));controller.close();}catch(error){controller.error(error);}}});}
   };
  }};
  const context={window:{},TextDecoder,Uint8Array,Uint32Array,DataView,DecompressionStream,File};vm.createContext(context);vm.runInContext(fs.readFileSync('public/assets/js/zip-chapters.js','utf8'),context);
  const zip=context.window.ArkChapterZip,entries=await zip.entries(source),chapters=zip.group(entries),samples=[];
  for(const entry of [entries[0],entries.at(-1)]){const file=await zip.extract(source,entry);samples.push({name:file.name,bytes:file.size});}
  console.log(JSON.stringify({chapters:chapters.length,images:entries.length,first:chapters[0].number,last:chapters.at(-1).number,unidentified:chapters.filter(row=>row.number===null).length,samples},null,2));
 }finally{await handle.close();}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
