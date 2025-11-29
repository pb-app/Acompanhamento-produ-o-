// MUDANÇA 1: Alteramos para v2 para forçar atualização
const CACHE_NAME = 'producao-app-v5';

const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './Massa.html',
  './css/global.css',
  './css/massa.css',
  './js/index.js',
  './js/massa.js',
  './js/config/firebase.js',
  './js/utils/helpers.js',
  './manifest.json',
  // './icons/icon-180x180.png' 
];

// Instalação
self.addEventListener('install', (event) => {
  console.log('[Service Worker] Instalando v2...');
  
  // MUDANÇA 2: Força o novo SW a assumir imediatamente, sem esperar
  self.skipWaiting();

  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
});

// Ativação
self.addEventListener('activate', (event) => {
  console.log('[Service Worker] Ativando v2...');
  event.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(keyList.map((key) => {
        if (key !== CACHE_NAME) {
          console.log('[Service Worker] Removendo cache antigo:', key);
          return caches.delete(key);
        }
      }));
    }).then(() => {
      // MUDANÇA 3: Assume o controle de todas as abas/apps abertos agora
      return self.clients.claim();
    })
  );
});

// Interceptação (Offline)
self.addEventListener('fetch', (event) => {
  if (event.request.url.includes('firestore') || event.request.url.includes('googleapis')) {
    return; 
  }

  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});
