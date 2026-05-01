/*
 * Pica service worker.
 *
 * Two strategies:
 *   - cache-first   for fingerprintable static assets (CSS, JS, icon, manifest)
 *     so the app shell loads instantly from cache.
 *   - network-first with cache fallback for HTML pages + same-origin GET API
 *     calls, so signed-in users still see /punch and friends offline.
 *
 * The cache name is versioned (PICA_CACHE_<n>). Bumping the version on any
 * deploy invalidates the cache wholesale, avoiding the classic "users stuck
 * on old build" problem. Old caches are deleted in the activate event.
 *
 * What this service worker DOES NOT do:
 *   - It does not handle the offline punch queue. That's owned by the punch
 *     page in localStorage + drained on page load / `online` events. Doing
 *     it in the SW would require Background Sync API which iOS Safari
 *     doesn't support.
 *   - It does not cache cross-origin requests (e.g. OpenStreetMap tiles).
 *     Those go to network and fail naturally when offline; the punch page
 *     handles map absence gracefully.
 */

const CACHE_VERSION = 'pica-cache-v8';
const PRECACHE_URLS = [
  '/',
  '/punch',
  '/leaves',
  '/leaves/calendar',
  '/preferences',
  '/app.css',
  '/app.js',
  '/topbar.css',
  '/topbar.js',
  '/punch.css',
  '/punch.js',
  '/index.css',
  '/index.js',
  '/icon.svg',
  '/manifest.json',
  '/i18n.js',
  '/locales/en-US.js',
  '/locales/pt-PT.js',
];

// On install: pre-fetch the app shell. `addAll` is atomic — if any single
// fetch fails the whole install fails. We don't want install to fail if a
// page returns 302 (e.g. /punch redirects to /login when unauth'd), so we
// fetch them one at a time and cache only successful 2xx responses.
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    await Promise.all(PRECACHE_URLS.map(async (url) => {
      try {
        const res = await fetch(url, { credentials: 'same-origin' });
        if (res.ok) await cache.put(url, res);
      } catch { /* network may be down at install time — that's OK */ }
    }));
    await self.skipWaiting();
  })());
});

// On activate: clean up old cache versions.
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

// On fetch: route requests to the right strategy.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;            // POSTs go straight to network
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // cross-origin → bypass

  // Static assets: cache-first.
  if (/\.(css|js|svg|png|jpg|webp|woff2?|ico)$/i.test(url.pathname) ||
      url.pathname === '/manifest.json' ||
      url.pathname === '/icon.svg') {
    event.respondWith(cacheFirst(req));
    return;
  }

  // Everything else (HTML pages + API GETs): network-first, fall back to cache.
  event.respondWith(networkFirst(req));
});

async function cacheFirst(req) {
  const cache = await caches.open(CACHE_VERSION);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    // Last-ditch fallback: empty 504 so the browser shows its offline UI.
    return new Response('', { status: 504, statusText: 'Offline' });
  }
}

async function networkFirst(req) {
  const cache = await caches.open(CACHE_VERSION);
  try {
    const res = await fetch(req);
    // Only cache successful HTML / JSON responses.
    if (res.ok && (req.headers.get('accept') || '').match(/text\/html|application\/json/)) {
      cache.put(req, res.clone());
    }
    return res;
  } catch (err) {
    const hit = await cache.match(req);
    if (hit) return hit;
    return new Response('', { status: 504, statusText: 'Offline' });
  }
}
