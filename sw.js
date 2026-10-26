// Service Worker (PWA) — network-first so updates reach the phone
// immediately; the cache is only a fallback for offline use.
const CACHE = 'nowa-cmr-pwa-v6';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => Promise.allSettled(ASSETS.map(a => cache.add(a))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.map(k => (k === CACHE) ? null : caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Requests with a query string are never stored: update probes
// (index.html?u=…, layout.json?v=…, sw.js?v=…) carry unique timestamps
// and would otherwise pile up as separate cache entries. Cross-origin
// CDN libraries (html2canvas, jsPDF, pdf.js) arrive as opaque responses
// and are still cached so PDF export keeps working offline.
function isCacheable(request, response) {
  if (!response) return false;
  const url = new URL(request.url);
  if (url.search) return false;
  if (url.origin === self.location.origin) return response.ok;
  return response.ok || response.type === 'opaque';
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request)
      .then(res => {
        if (isCacheable(event.request, res)) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(event.request, copy)).catch(() => {});
        }
        return res;
      })
      // offline: serve the cached copy; ignoreSearch lets a versioned URL
      // (e.g. index.html?u=…) fall back to the plain cached asset
      .catch(() => caches.match(event.request, { ignoreSearch: true })
        .then(hit => hit || (event.request.mode === 'navigate' ? caches.match('./index.html') : undefined)))
  );
});
