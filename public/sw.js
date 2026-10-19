// Service worker : précharge toute l'application à l'installation pour jouer
// sans connexion. Les photos ne passent jamais par ici (elles sont dans IndexedDB),
// et une mise à jour ne touche qu'au Cache Storage, jamais à IndexedDB.
//
// La liste des fichiers et la version sont injectées à la compilation (vite.config.ts).
const PRECACHE = self.__PRECACHE__ || [];
const CACHE = 'guesswhere-' + (self.__VERSION__ || 'dev');

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(PRECACHE.map((p) => new Request(p, { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('guesswhere-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // Navigation : la page de l'app, quelle que soit l'URL (ex. ?partie=…).
    if (req.mode === 'navigate') {
      return (await cache.match('./', { ignoreSearch: true })) || fetch(req);
    }
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  })());
});
