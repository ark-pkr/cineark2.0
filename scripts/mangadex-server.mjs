import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { createMangaDexProxy } from '../supabase/functions/_shared/mangadex-proxy.mjs';
import { createPageTranslator } from './page-translator.mjs';
import { createWorkPageHandler } from './work-page.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
try { process.loadEnvFile(resolve(root, '.env.local')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const publicConfig = { window: {} };
vm.runInNewContext(await readFile(resolve(root, 'config.js'), 'utf8'), publicConfig);
const settings = publicConfig.window.CINE_ARK_CONFIG;
const translatePage = createPageTranslator({ supabaseUrl: settings.supabaseUrl, anonKey: settings.supabaseAnonKey,
    bucket: settings.pagesBucket, apiKey: process.env.GEMINI_API_KEY, model: process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite' });
const handler = createMangaDexProxy();
const workPage = createWorkPageHandler({settings,loadTemplate:()=>readFile(resolve(root,'index.html'),'utf8')});
const port = Number(process.env.PORT || process.env.ARK_MANGADEX_PORT || 8787);
const host = process.env.PORT ? '0.0.0.0' : '127.0.0.1';
const publicOrigin = process.env.RENDER_EXTERNAL_URL ? new URL(process.env.RENDER_EXTERNAL_URL).origin : null;
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Porta inválida.');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.png': 'image/png' };
const publicFiles = new Set(['index.html', 'reader.js', 'reader-controls.js', 'personal-library.js','discovery.js', 'cloud-reader.js', 'external-progress.js', 'continue-reading.js', 'page-translation.js', 'mangadex.js', 'auth.js', 'metadata.js', 'translation.js', 'config.js', 'reader.css', 'theme.css', 'manifest.json', 'sw.js', 'icone.png','robots.txt']);
export const server = http.createServer(async (incoming, outgoing) => {
    try {
        const url = new URL(incoming.url, publicOrigin || `http://127.0.0.1:${port}`);
        if (url.pathname.startsWith('/obra/') || url.pathname==='/sitemap.xml') {
            const response=await workPage(new Request(url,{method:incoming.method}));
            outgoing.writeHead(response.status,Object.fromEntries(response.headers));outgoing.end(await response.text());return;
        }
        if (url.pathname === '/api/translate-page') {
            const parts = []; let size = 0;
            if (Number(incoming.headers['content-length']) > 2048) { outgoing.writeHead(413).end(); incoming.resume(); return; }
            for await (const chunk of incoming.iterator({ destroyOnReturn: false })) {
                size += chunk.length;
                if (size > 2048) { outgoing.writeHead(413).end(); incoming.resume(); return; }
                parts.push(chunk);
            }
            const response = await translatePage(new Request(url, { method: incoming.method, headers: incoming.headers,
                ...(!['GET', 'HEAD'].includes(incoming.method) ? { body: Buffer.concat(parts) } : {}) }));
            outgoing.writeHead(response.status, Object.fromEntries(response.headers)); outgoing.end(await response.text()); return;
        }
        if (url.pathname === '/healthz' && incoming.method === 'GET') {
            outgoing.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
            outgoing.end(JSON.stringify({ status: 'ok' })); return;
        }
        if (url.pathname === '/mangadex') {
            const response = await handler(new Request(url, { method: incoming.method, headers: incoming.headers }));
            outgoing.writeHead(response.status, Object.fromEntries(response.headers));
            if (response.body) for await (const chunk of response.body) {
                if (outgoing.destroyed) break;
                if (!outgoing.write(chunk)) await new Promise(resolve => outgoing.once('drain', resolve));
            }
            outgoing.end(); return;
        }
        if (incoming.method !== 'GET' && incoming.method !== 'HEAD') { outgoing.writeHead(405).end(); return; }
        const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
        if (!publicFiles.has(file)) { outgoing.writeHead(404).end('Not found'); return; }
        const data = await readFile(resolve(root, file));
        const extension = file.slice(file.lastIndexOf('.'));
        outgoing.writeHead(200, { 'Content-Type': types[extension] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        outgoing.end(incoming.method === 'HEAD' ? undefined : data);
    } catch (_) { if (!outgoing.headersSent) outgoing.writeHead(502); outgoing.end('Servidor indisponível'); }
});
server.listen(port, host, () => console.log(`CINE ARK + MangaDex: ${publicOrigin || `http://${host}:${port}`}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
