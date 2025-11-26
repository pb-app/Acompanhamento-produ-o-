const CACHE_NAME = 'producao-app-v2';

// Lista de arquivos para salvar no celular (Cache)
// IMPORTANTE: Os nomes aqui devem ser IDÊNTICOS aos arquivos do GitHub
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
  // Adicione aqui o caminho do seu ícone se ele existir na pasta icons
  // './icons/icon-180x180.png' 
];

// 1. Instalação do Service Worker
self.addEventListener('install', (event) => {
  console.log('[Service Worker] Instalando...');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Caching arquivos do app');
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
});

// 2. Ativação (Limpeza de caches antigos)
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(keyList.map((key) => {
        if (key !== CACHE_NAME) {
          console.log('[Service Worker] Removendo cache antigo', key);
          return caches.delete(key);
        }
      }));
    })
  );
});

// 3. Interceptação de Requisições (Funcionar Offline)
self.addEventListener('fetch', (event) => {
  // Não cacheia chamadas para o banco de dados (Firestore/Google APIs)
  if (event.request.url.includes('firestore') || event.request.url.includes('googleapis')) {
    return; 
  }

  event.respondWith(
    caches.match(event.request).then((response) => {
      // Retorna do cache se existir, senão busca na internet
      return response || fetch(event.request);
    })
  );
});
