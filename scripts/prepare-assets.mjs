import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {compile,optimize} from '@tailwindcss/node';
import {Scanner} from '@tailwindcss/oxide';
import {FONT_FILES,ICON_FILES,VENDOR_FILES} from './vendor-assets.mjs';
const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
const write=async(file,contents)=>{const path=resolve(root,'public',file);await mkdir(dirname(path),{recursive:true});await writeFile(path,contents);};
const copy=async(source,dest)=>{const path=resolve(root,'public',dest);await mkdir(dirname(path),{recursive:true});await copyFile(resolve(root,'node_modules',source),path);};
await Promise.all([
    copy('vue/dist/vue.global.prod.js','assets/vendor/vue/vue.global.prod.js'),
    copy('@supabase/supabase-js/dist/umd/supabase.js','assets/vendor/supabase/supabase.js'),
    copy('@fortawesome/fontawesome-free/css/all.min.css','assets/vendor/fontawesome/css/all.min.css'),
    ...ICON_FILES.map(file=>copy('@fortawesome/fontawesome-free/webfonts/'+file,'assets/vendor/fontawesome/webfonts/'+file))
]);
const fontSpecs=[['poppins','Poppins',[400,600,700,900],'latin'],['bangers','Bangers',[400],'latin'],['metal-mania','Metal Mania',[400],'latin'],['noto-sans-runic','Noto Sans Runic',[400],'runic']];
const faces=[];
for(const [pkg,family,weights,subset]of fontSpecs)for(const weight of weights){
    const name=`${pkg}-${subset}-${weight}-normal.woff2`;
    if(!FONT_FILES.includes(name))throw Error('Font not allowlisted.');
    await copy(`@fontsource/${pkg}/files/${name}`,'assets/vendor/fonts/'+name);
    faces.push(`@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};font-display:swap;src:url('./${name}') format('woff2')}`);
}
await write('assets/vendor/fonts/fonts.css',faces.join('\n'));
const licenses=[];
for(const [pkg,file]of [['vue','LICENSE'],['@supabase/supabase-js','LICENSE'],['tailwindcss','LICENSE'],['@fortawesome/fontawesome-free','LICENSE.txt'],...fontSpecs.map(([name])=>['@fontsource/'+name,'LICENSE'])]){
    const meta=JSON.parse(await readFile(resolve(root,'node_modules',pkg,'package.json'),'utf8'));
    licenses.push(`${pkg} ${meta.version}\n${await readFile(resolve(root,'node_modules',pkg,file),'utf8')}`);
}
await write('assets/vendor/THIRD-PARTY-LICENSES.txt',licenses.join('\n\n====================\n\n'));
const source=await readFile(resolve(root,'scripts/styles/utilities.css'),'utf8');
const compiler=await compile(source,{base:root,onDependency(){}});
const scanner=new Scanner({sources:[{base:resolve(root,'public'),pattern:'index.html',negated:false},{base:resolve(root,'public/assets/js'),pattern:'*.js',negated:false}]});
const css=compiler.build(scanner.scan());
await write('assets/css/utilities.css',optimize(css,{minify:true}).code);
const swPath=resolve(root,'public/sw.js');
const sw=await readFile(swPath,'utf8');
const cached=JSON.stringify(['assets/css/utilities.css',...VENDOR_FILES].map(file=>'./'+file));
await writeFile(swPath,sw.replace(/\/\* local-assets:start \*\/[\s\S]*?\/\* local-assets:end \*\//,'/* local-assets:start */'+cached+'/* local-assets:end */'));
console.log('Prepared local production libraries, fonts, icons and utility CSS.');
