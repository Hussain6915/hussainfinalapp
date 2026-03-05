const CACHE = "hussain-dashboard-v3"; // 👈 bump this whenever you deploy
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png"
];

self.addEventListener("install", (e) => {
  self.skipWaiting(); // take control immediately
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    // delete old caches
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim(); // control pages right away
  })());
});

// Network-first for html/css/js so updates actually reach the phone
self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);

  const isAppAsset =
    url.origin === location.origin &&
    (url.pathname.endsWith("/") ||
     url.pathname.endsWith("/index.html") ||
     url.pathname.endsWith("/app.js") ||
     url.pathname.endsWith("/styles.css") ||
     url.pathname.endsWith("/manifest.webmanifest"));

  if (isAppAsset) {
    e.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE);
        cache.put(req, fresh.clone());
        return fresh;
      } catch {
        return (await caches.match(req)) || Response.error();
      }
    })());
    return;
  }

  // For everything else: cache-first fallback
  e.respondWith(caches.match(req).then((cached) => cached || fetch(req)));
});
