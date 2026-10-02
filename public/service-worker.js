// CertBench service worker — enables installing the app and loading it
// instantly (even offline) by caching the static app shell. API requests
// (/api/*) are always fetched fresh from the network; they're never cached,
// since exam data, auth, and payments must always be live and correct.

const CACHE_NAME = 'certbench-shell-v3';
const SHELL_FILES = [
  '/',
  '/index.html',
  '/app.js',
  '/styles.css',
  '/manifest.json',
  '/favicon.png',
  '/favicon.svg',
  '/logo-mark.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Never cache API calls — always go straight to the network for live data.
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // Only handle same-origin GET requests for the shell.
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  // NETWORK FIRST: when online you always get the latest files, so updates to
  // the app show up on a normal refresh. The cache is only a fallback for when
  // the network is unavailable (that's what makes the app open offline).
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() =>
        caches.match(event.request).then((cached) => {
          if (cached) return cached;
          if (event.request.mode === 'navigate') return caches.match('/index.html');
          return Response.error();
        })
      )
  );
});
