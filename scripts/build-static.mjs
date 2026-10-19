import { mkdir, copyFile, lstat, rm } from 'node:fs/promises';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PUBLIC_FILES } from './public-assets.mjs';
const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
const output=resolve(root,'dist');
// Only regenerate this project's named build directory; never follow a symlink.
if(dirname(output)!==root || relative(root,output)!=='dist')throw Error('Unsafe build directory.');
try {if((await lstat(output)).isSymbolicLink())throw Error('Build directory must not be a symlink.');}catch(error){if(error.code!=='ENOENT')throw error;}
await rm(output,{recursive:true,force:true});
await mkdir(output,{recursive:true});
await Promise.all(PUBLIC_FILES.map(async file=>{
    const destination=resolve(output,file);
    if(relative(output,destination).startsWith('..'))throw Error('Unsafe public asset path.');
    await mkdir(dirname(destination),{recursive:true});
    await copyFile(resolve(root,'public',file),destination);
}));
console.log(`Prepared ${PUBLIC_FILES.length} public files for Netlify.`);
