self.addEventListener("install", event => {
  console.log("Service Worker instalado.");
  event.waitUntil(
    caches.open("app-cache-v2").then(cache => {
      return cache.addAll([
        "./",
        "./index.html",
        "./manifest.json",
        "./icons/icon-192x192.png",
        "./icons/icon-512x512.png"
      ]);
    })
  );
});

self.addEventListener("fetch", event => {
  event.respondWith(
    caches.match(event.request).then(response => {
      return response || fetch(event.request);
    })
  );
});
