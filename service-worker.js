// A versão e o build vêm de changelog.js (único arquivo a editar a cada entrega).
importScripts('./changelog.js');
const CL = self.LEDGERLY_CHANGELOG || { version: '0.0.0', build: 0, entries: [] };
const CACHE_NAME = 'ledgerly-pwa-v' + CL.build;

const CORE_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./changelog.js",
  "./src/js/app.js",
  "./src/js/portfolio/sectors-data.js",
  "./src/js/portfolio/sectors.js",
  "./src/js/portfolio/calculations.js",
  "./src/js/notes/pdf-reader.js",
  "./src/js/notes/note-parser.js",
  "./src/js/security/encryption.js",
  "./src/js/reports/excel-export.js",
  "./src/js/core/theme-init.js",
  "./src/js/core/state.js",
  "./src/js/core/events.js",
  "./src/js/core/utils.js",
  "./src/js/core/backup-restore.js",
  "./src/js/core/refresh.js",
  "./src/js/ui/navigation.js",
  "./src/js/ui/actions.js",
  "./src/js/ui/calculator.js",
  "./src/js/core/database.js",
  "./src/js/security/lock-screen.js",
  "./src/js/portfolio/positions.js",
  "./src/js/portfolio/brapi.js",
  "./src/js/portfolio/position-import.js",
  "./src/js/portfolio/audit.js",
  "./src/js/portfolio/audit-view.js",
  "./src/js/notes/notes-manager.js",
  "./src/js/reports/reports-view.js",
  "./src/js/dividends/calendar.js",
  "./src/js/dividends/proventos.js",
  "./src/js/sync/google-drive.js",
  "./src/js/pwa/updates-and-sw.js",
  "./src/js/core/bootstrap.js",
  "./assets/tailwind.css",
  "./assets/fonts.css",
  "./vendor/chart.umd.js",
  "./vendor/lucide.min.js",
  "./vendor/pdf.min.js",
  "./vendor/pdf.worker.min.js",
  "./vendor/sql-wasm.js",
  "./vendor/sql-wasm.wasm"
];

const OPTIONAL_ASSETS = [
  "./assets/fonts/inter-latin-400-normal.woff2",
  "./assets/fonts/inter-latin-500-normal.woff2",
  "./assets/fonts/inter-latin-600-normal.woff2",
  "./assets/fonts/inter-latin-700-normal.woff2",
  "./assets/fonts/inter-latin-800-normal.woff2",
  "./assets/fonts/jetbrains-mono-latin-400-normal.woff2",
  "./assets/fonts/jetbrains-mono-latin-600-normal.woff2",
  "./assets/fonts/jetbrains-mono-latin-700-normal.woff2",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-192-maskable.png",
  "./icons/icon-512-maskable.png",
  "./icons/apple-touch-icon-180.png"
];

async function cacheOne(cache, url) {
  const response = await fetch(new Request(url, { cache: 'reload' }));
  if (!response || !response.ok) {
    throw new Error(`HTTP ${response ? response.status : 'erro'} ao baixar ${url}`);
  }
  await cache.put(url, response);
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    const coreResults = await Promise.allSettled(CORE_SHELL.map(url => cacheOne(cache, url)));
    const coreFailures = coreResults
      .map((r, i) => (r.status === 'rejected' ? `${CORE_SHELL[i]} (${r.reason?.message || r.reason})` : null))
      .filter(Boolean);
    if (coreFailures.length) {
      console.error('[SW] Falha ao cachear arquivos essenciais:', coreFailures);
      throw new Error('Falha no precache essencial: ' + coreFailures.join(', '));
    }
    const optResults = await Promise.allSettled(OPTIONAL_ASSETS.map(url => cacheOne(cache, url)));
    optResults.forEach((r, i) => {
      if (r.status === 'rejected') console.warn('[SW] Asset opcional não cacheado:', OPTIONAL_ASSETS[i], r.reason);
    });
  })());
});

self.addEventListener('message', event => {
  const m = event.data;
  if (!m) return;
  if (m.type === 'SKIP_WAITING') self.skipWaiting();
  // O app aberto pergunta quais são as novidades da versão que está aguardando para ser instalada
  if (m.type === 'GET_INFO' && event.source) {
    event.source.postMessage({ type: 'INFO', version: CL.version, build: CL.build, entries: CL.entries });
  }
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter(k => (k.startsWith('investsql-pwa-') || k.startsWith('ledgerly-pwa-')) && k !== CACHE_NAME)
        .map(k => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  // Não intercepta APIs (brapi) nem outros domínios; dados pessoais ficam só no navegador.
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  // Navegação: Cache-First atômico no mesmo CACHE_NAME dos scripts (evita HTML novo com JS antigo).
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = (await cache.match('./index.html')) || (await cache.match('./'));
      if (cached) return cached;
      try {
        const response = await fetch(request);
        if (response && response.ok) await cache.put('./index.html', response.clone());
        return response;
      } catch (_) {
        return new Response('Aplicativo offline.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      }
    })());
    return;
  }

  // Network First para dividendos.json (sempre busca proventos atualizados; usa cache se offline)
  if (url.pathname.endsWith('/dividendos.json')) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const response = await fetch(request, { cache: 'no-cache' });
        if (response && response.ok) await cache.put('./dividendos.json', response.clone());
        return response;
      } catch (_) {
        const cached = (await cache.match('./dividendos.json')) || (await cache.match(request));
        if (cached) return cached;
        return new Response('{"status":"offline","acoes":{}}', { headers: { 'Content-Type': 'application/json' } });
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response && response.ok) await cache.put(request, response.clone());
    return response;
  })());
});
