const CACHE_NAME = 'cine-ark-v30-discovery';
const IMAGE_CACHE = 'cine-ark-images-v2';
const IMAGE_LIMIT = 80;
const ASSETS = ['./index.html','./reader.js','./reader-controls.js','./personal-library.js','./discovery.js','./external-progress.js',
    './continue-reading.js','./page-translation.js','./mangadex.js','./cloud-reader.js','./auth.js','./metadata.js',
    './translation.js','./config.js','./reader.css','./theme.css','./manifest.json'];
self.addEventListener('install', event => {
    event.waitUntil(caches.open(CACHE_NAME).then(cache => Promise.allSettled(ASSETS.map(asset=>cache.add(asset)))));
    self.skipWaiting();
});
self.addEventListener('activate', event => {
    event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('cine-ark-') && ![CACHE_NAME,IMAGE_CACHE].includes(key)).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch', event => {
    const url=new URL(event.request.url);
    if(event.request.method!=='GET' || url.pathname.endsWith('/mangadex') || url.pathname.startsWith('/api/') ||
        url.hostname.endsWith('supabase.co') || url.hostname==='api.mangadex.org' || url.hostname==='uploads.mangadex.org' ||
        url.hostname.endsWith('.mangadex.network') || url.hostname==='api.jikan.moe') return;
    if(event.request.destination==='image') {
        event.respondWith((async()=>{
            const cache=await caches.open(IMAGE_CACHE), cached=await cache.match(event.request);
            if(cached) return cached;
            const response=await fetch(event.request);
            if(response.ok || response.type==='opaque') {
                try {
                    await cache.put(event.request,response.clone());
                    const keys=await cache.keys();
                    await Promise.all(keys.slice(0,Math.max(0,keys.length-IMAGE_LIMIT)).map(key=>cache.delete(key)));
                } catch(_) { /* Storage pressure must not break a successful image request. */ }
            }
            return response;
        })()); return;
    }
    if(url.origin!==self.location.origin) return;
    event.respondWith((async()=>{
        const cache=await caches.open(CACHE_NAME);
        try { const response=await fetch(event.request); if(response.ok && (event.request.mode==='navigate' || ASSETS.some(asset=>new URL(asset,self.location.href).pathname===url.pathname))) { try { await cache.put(event.request,response.clone()); } catch(_) {} } return response; }
        catch(_) { return await cache.match(event.request) || (event.request.mode==='navigate' ? await cache.match('./index.html') : null) || Response.error(); }
    })());
});
