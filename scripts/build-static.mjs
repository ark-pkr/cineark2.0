import { mkdir, copyFile, lstat, rm, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { PUBLIC_FILES } from './public-assets.mjs';
import { securityHeaders } from './security-headers.mjs';
import './prepare-assets.mjs';
const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const output = resolve(root, 'dist');
// Only regenerate this project's named build directory; never follow a symlink.
if (dirname(output) !== root || relative(root, output) !== 'dist') throw Error('Unsafe build directory.');
try {
    if ((await lstat(output)).isSymbolicLink()) throw Error('Build directory must not be a symlink.');
} catch (error) {
    if (error.code !== 'ENOENT') throw error;
}
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await Promise.all(
    PUBLIC_FILES.map(async file => {
        const destination = resolve(output, file);
        if (relative(output, destination).startsWith('..')) throw Error('Unsafe public asset path.');
        await mkdir(dirname(destination), { recursive: true });
        await copyFile(resolve(root, 'public', file), destination);
    })
);
// Netlify applies _headers to static files; the policy hashes the inline scripts of the built index.html.
const context = { window: {} };
vm.runInNewContext(await readFile(resolve(root, 'public/assets/js/config.js'), 'utf8'), context);
const policy = securityHeaders(await readFile(resolve(output, 'index.html'), 'utf8'), context.window.CINE_ARK_CONFIG);
const headerLines = Object.entries(policy).map(([name, value]) => `  ${name}: ${value}`);
await writeFile(
    resolve(output, '_headers'),
    ['/', '/index.html'].map(path => [path, ...headerLines].join('\n')).join('\n') + '\n'
);
console.log(`Prepared ${PUBLIC_FILES.length} public files for Netlify.`);
