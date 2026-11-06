// Altere CACHE_NAME a cada deploy para disparar a atualização do app.
const CACHE_NAME = 'ledgerly-pwa-v15';
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./assets/tailwind.css",
  "./assets/fonts.css",
  "./assets/fonts/inter-latin-400-normal.woff2",
  "./assets/fonts/inter-latin-500-normal.woff2",
  "./assets/fonts/inter-latin-600-normal.woff2",
  "./assets/fonts/inter-latin-700-normal.woff2",
  "./assets/fonts/inter-latin-800-normal.woff2",
  "./assets/fonts/jetbrains-mono-latin-400-normal.woff2",
  "./assets/fonts/jetbrains-mono-latin-600-normal.woff2",
  "./assets/fonts/jetbrains-mono-latin-700-normal.woff2",
  "./vendor/chart.umd.js",
  "./vendor/lucide.min.js",
  "./vendor/pdf.min.js",
  "./vendor/pdf.worker.min.js",
  "./vendor/sql-wasm.js",
  "./vendor/sql-wasm.wasm",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-192-maskable.png",
  "./icons/icon-512-maskable.png",
  "./icons/apple-touch-icon-180.png"
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => (k.startsWith('investsql-pwa-') || k.startsWith('ledgerly-pwa-')) && k !== CACHE_NAME).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  // Não intercepta APIs (brapi) nem outros domínios; dados pessoais ficam só no navegador.
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response && response.ok) (await caches.open(CACHE_NAME)).put('./index.html', response.clone());
        return response;
      } catch (_) {
        return (await caches.match('./index.html')) || (await caches.match('./'));
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response && response.ok) (await caches.open(CACHE_NAME)).put(request, response.clone());
    return response;
  })());
});
