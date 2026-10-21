/* ZIP directory is read separately; image bytes are inflated one page at a time. */
window.ArkChapterZip=(()=>{
 const LIMIT=15*1024*1024,TYPES={jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',avif:'image/avif',gif:'image/gif'};
 const fail=message=>{throw Error(message);};
 const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
 function crc32(bytes){let crc=0xffffffff;for(const value of bytes)crc=crcTable[(crc^value)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}
 async function view(file,start,length){if(start<0 || start+length>file.size)fail('ZIP incompleto ou inválido.');return new DataView(await file.slice(start,start+length).arrayBuffer());}
 async function entries(file){
  const tailStart=Math.max(0,file.size-65557),tail=await view(file,tailStart,file.size-tailStart);let end=-1;
  for(let i=tail.byteLength-22;i>=0;i--)if(tail.getUint32(i,true)===0x06054b50 && i+22+tail.getUint16(i+20,true)===tail.byteLength){end=i;break;}
  if(end<0)fail('Este arquivo não é um ZIP válido.');
  const count=tail.getUint16(end+10,true),size=tail.getUint32(end+12,true),offset=tail.getUint32(end+16,true);
  if(tail.getUint16(end+4,true) || tail.getUint16(end+6,true) || tail.getUint16(end+8,true)!==count)fail('ZIP dividido em várias partes não é suportado.');
  if(count===65535 || size===0xffffffff || offset===0xffffffff)fail('Este ZIP usa ZIP64. Divida-o em arquivos ZIP menores ou use as pastas.');
  if(size>32*1024*1024 || offset+size>tailStart+end)fail('O índice do ZIP é inválido ou grande demais.');
  const directory=await view(file,offset,size),rows=[],names=new Set();let cursor=0;
  for(let i=0;i<count;i++){
   if(cursor+46>size || directory.getUint32(cursor,true)!==0x02014b50)fail('O índice do ZIP está danificado.');
   const flags=directory.getUint16(cursor+8,true),method=directory.getUint16(cursor+10,true),crc=directory.getUint32(cursor+16,true),compressed=directory.getUint32(cursor+20,true),bytes=directory.getUint32(cursor+24,true),nameLength=directory.getUint16(cursor+28,true),extra=directory.getUint16(cursor+30,true),comment=directory.getUint16(cursor+32,true),local=directory.getUint32(cursor+42,true);
   if(cursor+46+nameLength+extra+comment>size)fail('O índice do ZIP está incompleto.');
   const name=new TextDecoder().decode(new Uint8Array(directory.buffer,cursor+46,nameLength)).replace(/\\/g,'/');cursor+=46+nameLength+extra+comment;
   if(name.endsWith('/') || name.split('/').some(part=>part.startsWith('.') || part==='__MACOSX'))continue;
   if(name.startsWith('/') || /^[A-Za-z]:/.test(name) || name.includes('\0'))fail('O ZIP contém um caminho inválido.');
   const type=TYPES[name.split('.').pop().toLowerCase()];if(!type)continue;
   if(names.has(name))fail('O ZIP contém imagens com o mesmo caminho: '+name);names.add(name);
   if(flags&1)fail('ZIP com senha não é suportado.');
   if(![0,8].includes(method))fail('Use um ZIP com compressão padrão (Deflate) ou sem compressão.');
   if(bytes===0xffffffff || compressed===0xffffffff || local===0xffffffff)fail('Uma imagem usa ZIP64. Recrie um ZIP menor.');
   if(!bytes || bytes>LIMIT || compressed>LIMIT+65536)fail('Cada imagem deve ter até 15 MiB: '+name);
   if(local+30+compressed>offset)fail('Uma imagem aponta para fora do ZIP.');
   rows.push({name,type,size:bytes,compressed,offset:local,method,crc,directoryOffset:offset});
  }
  if(!rows.length)fail('Nenhuma imagem JPG, PNG, WebP, AVIF ou GIF encontrada no ZIP.');return rows;
 }
 function group(rows){
  const folders=new Map();for(const row of rows){const folder=row.name.split('/').slice(0,-1).join('/');if(!folders.has(folder))folders.set(folder,[]);folders.get(folder).push(row);}
  return [...folders].map(([folder,pages],index)=>{
   let number=null;for(const part of folder.split('/').reverse()){
    const normalized=part.normalize('NFD').replace(/[\u0300-\u036f]/g,'');
    const match=normalized.match(/(?:capitulo|cap|chapter|ch)[\s_.-]*(\d+(?:[.,]\d+)?)(?!\d)/i) || normalized.match(/^(\d+(?:[.,]\d+)?)$/);
    if(match){number=Number(match[1].replace(',','.'));break;}
   }
   pages.sort((a,b)=>a.name.localeCompare(b.name,'pt-BR',{numeric:true}));
   return {key:'zip-'+index,folder:folder || '(raiz do ZIP)',number,title:'',pages,selected:true,status:'pending',message:''};
  }).sort((a,b)=>(a.number??Infinity)-(b.number??Infinity) || a.folder.localeCompare(b.folder));
 }
 async function extract(file,entry,current=()=>true){
  if(!current())fail('Importação interrompida.');
  const header=await view(file,entry.offset,30);if(header.getUint32(0,true)!==0x04034b50 || header.getUint16(8,true)!==entry.method || header.getUint16(6,true)&1)fail('Cabeçalho de imagem inválido.');
  const start=entry.offset+30+header.getUint16(26,true)+header.getUint16(28,true);
  if(start+entry.compressed>entry.directoryOffset)fail('Imagem fora dos limites do ZIP.');
  let stream=file.slice(start,start+entry.compressed).stream();
  if(entry.method===8){try{stream=stream.pipeThrough(new DecompressionStream('deflate-raw'));}catch(_){fail('Seu navegador não abre este ZIP. Atualize o Chrome/Edge ou selecione uma pasta.');}}
  const reader=stream.getReader(),chunks=[];let size=0;
  try{while(true){if(!current())fail('Importação interrompida.');const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>LIMIT || size>entry.size)fail('A imagem excede o tamanho declarado no ZIP.');chunks.push(value);}}
  catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
  if(size!==entry.size)fail('Imagem incompleta: '+entry.name);
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  if(crc32(bytes)!==entry.crc)fail('Imagem corrompida no ZIP: '+entry.name);
  return new File([bytes],entry.name.split('/').pop(),{type:entry.type});
 }
 return {entries,group,extract,crc32};
})();

window.zipChaptersMixin={
 data(){return {zipRows:[],zipName:'',zipBusy:false,zipScanning:false,zipReviewed:false,zipMessage:'',zipPreviewRow:null,zipPreviewIndex:0,zipPreviewURL:'',zipPreviewBusy:false,zipPageDone:0,zipPageTotal:0,zipStop:false};},
 computed:{zipSelected(){return this.zipRows.filter(row=>row.selected && row.status!=='published');},zipPublishedCount(){return this.zipRows.filter(row=>row.status==='published').length;}},
 watch:{
  userSession(next,previous){if(next?.user?.id!==previous?.user?.id)this.resetZipImport();},
  readingWork(next,previous){if(next?.id!==previous?.id)this.resetZipImport();}
 },
 methods:{
  resetZipImport(){this._zipEpoch=(this._zipEpoch || 0)+1;this._zipFile=null;this.zipRows=[];this.zipName='';this.zipBusy=false;this.zipScanning=false;this.zipReviewed=false;this.zipMessage='';this.zipStop=false;this.closeZipPreview();},
  async chooseChapterZip(event){
   const file=event.target.files?.[0];event.target.value='';if(!file || !this.isAdmin || this.readerBusy || this.zipScanning)return;
   this.resetZipImport();const epoch=this._zipEpoch,uid=this.userSession?.user?.id,work=this.readingWork;this.zipScanning=true;
   try{const rows=window.ArkChapterZip.group(await window.ArkChapterZip.entries(file));if(epoch!==this._zipEpoch || uid!==this.userSession?.user?.id || work!==this.readingWork)return;
    this._zipFile=file;this.zipName=file.name;this.zipRows=rows;this.zipMessage=rows.length+' capítulos identificados. Confira os números, selecione os capítulos e revise antes de publicar.';
   }catch(error){if(epoch===this._zipEpoch)this.zipMessage=error.message || 'Não foi possível abrir o ZIP.';}
   finally{if(epoch===this._zipEpoch)this.zipScanning=false;}
  },
  zipRowIssue(row){
   const number=Number(row.number);if(row.number===null || row.number==='' || !Number.isFinite(number) || number<=0 || number>=1000000)return 'Informe o número do capítulo.';
   if(row.pages.length>1000)return 'Divida este capítulo: o limite é de 1.000 imagens.';
   if(this.zipRows.some(other=>other!==row && other.selected && Number(other.number)===number))return 'Número repetido no lote.';
   return '';
  },
  moveZipPage(row,index,delta){if(this.zipBusy || this.zipPreviewBusy || !this.isAdmin || row.status==='published')return;const target=index+delta;if(target<0 || target>=row.pages.length)return;const pages=[...row.pages],[page]=pages.splice(index,1);pages.splice(target,0,page);row.pages=pages;this.zipReviewed=false;},
  closeZipPreview(){this._zipPreviewEpoch=(this._zipPreviewEpoch || 0)+1;if(this.zipPreviewURL)URL.revokeObjectURL(this.zipPreviewURL);this.zipPreviewURL='';this.zipPreviewRow=null;this.zipPreviewBusy=false;},
  async previewZipPage(row,index=0){
   if(!this.isAdmin || this.zipBusy || this.zipPreviewBusy || !this._zipFile || index<0 || index>=row.pages.length)return;
   if(this.zipPreviewURL)URL.revokeObjectURL(this.zipPreviewURL);this.zipPreviewURL='';this.zipPreviewRow=row;this.zipPreviewIndex=index;this.zipPreviewBusy=true;
   const epoch=this._zipEpoch,preview=this._zipPreviewEpoch=(this._zipPreviewEpoch || 0)+1,current=()=>epoch===this._zipEpoch && preview===this._zipPreviewEpoch && this.isAdmin;
   try{const file=await window.ArkChapterZip.extract(this._zipFile,row.pages[index],current);if(current())this.zipPreviewURL=URL.createObjectURL(file);}
   catch(error){if(current())this.zipMessage=error.message;}
   finally{if(current())this.zipPreviewBusy=false;}
  },
  async publishChapterZip(onlyFailed=false){
   if(!this.isAdmin || this.readerBusy || this.zipBusy || this.zipScanning || !this.zipReviewed || !this._zipFile || !this.readingWork)return;
   const candidates=this.zipSelected.filter(row=>!onlyFailed || row.status==='error');if(!candidates.length)return;
   if(candidates.some(row=>this.zipRowIssue(row))){this.zipMessage='Corrija os números repetidos ou inválidos antes de publicar.';return;}
   const uid=this.userSession?.user?.id,workId=this.readingWork.id,epoch=this._zipEpoch,file=this._zipFile;
   const current=()=>this.isAdmin && uid===this.userSession?.user?.id && epoch===this._zipEpoch && workId===this.readingWork?.id;
   const jobs=candidates.map(row=>({row,number:Number(row.number),title:row.title.trim(),pages:[...row.pages]}));
   this.zipBusy=true;this.readerBusy=true;this.zipStop=false;this.zipMessage='Conferindo capítulos existentes...';
   try{
    const existing=[...await this.cloudAPI().chapters(workId),...await this.cloudAPI().chapters(workId,true)];if(!current())return;
    const numbers=new Set(existing.map(row=>Number(row.number)));
    for(const job of jobs){
     if(!current() || this.zipStop)break;const row=job.row;
     if(numbers.has(job.number)){row.status='blocked';row.message='Este número já existe, inclusive em rascunhos ou na lixeira. Não foi substituído.';continue;}
     row.status='uploading';row.message='Verificando e enviando imagens...';this.zipPageDone=0;this.zipPageTotal=job.pages.length;this.zipMessage='Publicando capítulo '+job.number+'...';
     try{
      const chapter=await this.cloudAPI().upload({workId,number:job.number,title:job.title,files:job.pages,isCurrent:current,
       readPage:async entry=>{const image=await window.ArkChapterZip.extract(file,entry,current);if(!current())throw Error('Importação interrompida.');const bitmap=await createImageBitmap(image);try{if(!bitmap.width || !bitmap.height || bitmap.width>50000 || bitmap.height>50000)throw Error('Dimensões de imagem inválidas.');return {file:image,dimensions:{width:bitmap.width,height:bitmap.height}};}finally{bitmap.close();}},
       onProgress:(done,total)=>{if(current()){this.zipPageDone=done;this.zipPageTotal=total;}}
      });if(!current())return;
      numbers.add(job.number);row.status='published';row.message='Publicado';this.chapters=[...this.chapters,chapter].sort((a,b)=>a.number-b.number);
     }catch(error){if(!current())return;row.status='error';row.message=error.message || 'Falha no envio. Tente novamente.';}
    }
    if(current())this.zipMessage=(this.zipStop?'Lote pausado. ':'Lote concluído. ')+this.zipPublishedCount+' capítulos publicados. Capítulos com falha podem ser reenviados; os publicados serão preservados.';
   }catch(error){if(current())this.zipMessage=error.message || 'Não foi possível consultar os capítulos existentes. Nenhum envio foi iniciado.';}
   finally{if(current()){this.zipBusy=false;this.readerBusy=false;}}
  }
 },
 beforeUnmount(){this.resetZipImport();}
};
