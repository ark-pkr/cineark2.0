import { mkdir, copyFile } from 'node:fs/promises';
const files = ['index.html','reader.js','reader-controls.js','personal-library.js','discovery.js','cloud-reader.js','external-progress.js',
    'continue-reading.js','page-translation.js','mangadex.js','auth.js','metadata.js','translation.js','config.js',
    'reader.css','theme.css','manifest.json','sw.js','icone.png','robots.txt'];
const output = new URL('../dist/',import.meta.url);
await mkdir(output,{recursive:true});
await Promise.all(files.map(file=>copyFile(new URL('../'+file,import.meta.url),new URL(file,output))));
console.log(`Prepared ${files.length} public files for Netlify.`);
