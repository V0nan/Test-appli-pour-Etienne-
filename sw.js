// Cache hors ligne : l'appli s'ouvre même sans réseau (sur le chantier).
// Changer VERSION à chaque mise en ligne d'une nouvelle version.
const VERSION = 'v4';
const FILES = ['./', 'index.html', 'src/app.js', 'src/style.css', 'vendor/htm-preact-3.1.1.umd.js', 'manifest.webmanifest', 'icon.svg', 'icon-180.png'];
const DELAI_RESEAU = 3000; // au-delà, on sert la version en cache (réseau faible sur chantier)

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// Réseau d'abord (pour avoir la dernière version), cache si hors ligne ou trop lent.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const memeOrigine = new URL(e.request.url).origin === location.origin;
  const reseau = fetch(e.request).then((res) => {
    if (res.ok && memeOrigine) {
      const copy = res.clone();
      e.waitUntil(caches.open(VERSION).then((c) => c.put(e.request, copy)));
    }
    return res;
  });
  const depuisCache = () => caches.match(e.request).then((r) => r || (e.request.mode === 'navigate' ? caches.match('index.html') : undefined));
  const lent = new Promise((ok) => setTimeout(ok, DELAI_RESEAU)).then(depuisCache);
  e.respondWith(
    Promise.race([reseau.catch(depuisCache), lent.then((r) => r || reseau)])
      .then((r) => r || reseau)
      .catch(() => depuisCache().then((r) => r || Response.error()))
  );
});
