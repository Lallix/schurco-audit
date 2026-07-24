const CACHE = 'schurco-audit-v39';
const ASSETS = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png', './xlsx.bundle.js', './supabase.bundle.js', './admin.html'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Never intercept external API calls — let them fail naturally offline
  // so the app receives a proper network error, not an HTML fallback
  if (url.hostname !== self.location.hostname) return;

  // For same-origin requests: serve from cache, fall back to network,
  // and only return index.html for page navigation (not sub-resources)
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).catch(() => {
        if (e.request.mode === 'navigate') return caches.match('./index.html');
      });
    })
  );
});
