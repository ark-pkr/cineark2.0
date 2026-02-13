const CACHE_NAME = 'cine-ark-v2'; // Incrementado para forçar atualização
const ASSETS = [
  './index.html',
  './manifest.json',
  'https://cdn.tailwindcss.com',
  'https://unpkg.com/vue@3/dist/vue.global.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css'
  // Adicione seus arquivos locais de som/imagem aqui se os tiver baixado
];

// Instalação: Cacheia arquivos essenciais
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting(); 
});

// Ativação: Limpa caches antigos
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)));
    })
  );
});

// Estratégia: Stale-While-Revalidate + Cache de Imagens
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Cache especial para posters de animes (Imagens externas)
  if (e.request.destination === 'image') {
    e.respondWith(
      caches.open('cine-ark-images').then((cache) => {
        return cache.match(e.request).then((response) => {
          return response || fetch(e.request).then((networkResponse) => {
            cache.put(e.request, networkResponse.clone());
            return networkResponse;
          });
        });
      })
    );
    return;
  }

  // Padrão para o resto: Tenta rede, se falhar ou demorar, usa cache
  e.respondWith(
    caches.match(e.request).then((cachedResponse) => {
      const fetchPromise = fetch(e.request).then((networkResponse) => {
        caches.open(CACHE_NAME).then((cache) => cache.put(e.request, networkResponse.clone()));
        return networkResponse;
      });
      return cachedResponse || fetchPromise;
    })
  );
});