'use strict';

// Service worker do Canton Fair Buyer.
// - Telas do app (HTML/JS/CSS/ícones): abre do cache na hora e atualiza em segundo plano.
// - Fotos (/uploads/<id>): o id muda a cada foto nova, então ficam no cache.
// - Dados (/api/...): sempre busca na rede; sem conexão (comum na feira), mostra a última
//   versão salva. O cache de dados e fotos é apagado ao sair da conta.

const VERSION = 'v3';
const SHELL = `shell-${VERSION}`;
const DATA = 'api-v1';
const IMAGES = 'img-v1';
const SHELL_FILES = ['/', '/app.js', '/styles.css', '/manifest.webmanifest',
  '/brand/logo.png', '/brand/icon-192.png', '/brand/favicon.png'];
const MAX_IMAGES = 400;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('shell-') && key !== SHELL) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'logout') event.waitUntil(Promise.all([caches.delete(DATA), caches.delete(IMAGES)]));
});

async function trimImages() {
  const cache = await caches.open(IMAGES);
  const keys = await cache.keys();
  for (const req of keys.slice(0, Math.max(0, keys.length - MAX_IMAGES))) await cache.delete(req);
}

async function networkFirst(request) {
  const cache = await caches.open(DATA);
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch {
    const cached = await cache.match(request);
    if (cached) {
      const headers = new Headers(cached.headers);
      headers.set('X-Offline', '1');
      return new Response(await cached.blob(), { status: cached.status, headers });
    }
    return new Response(JSON.stringify({ error: 'Sem conexão com a internet.' }), {
      status: 503, headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Offline': '1' },
    });
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(IMAGES);
  const cached = await cache.match(request);
  if (cached) return cached;
  const res = await fetch(request);
  if (res.ok) { await cache.put(request, res.clone()); trimImages(); }
  return res;
}

async function staleWhileRevalidate(event, request) {
  const cache = await caches.open(SHELL);
  const cached = await cache.match(request, { ignoreSearch: true });
  const update = fetch(request).then((res) => {
    if (res.ok) cache.put(request, res.clone());
    return res;
  });
  if (cached) {
    event.waitUntil(update.catch(() => {}));
    return cached;
  }
  return update;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/api/')) {
    // Downloads e diagnóstico não passam pelo cache.
    if (url.pathname.endsWith('/file') || url.pathname === '/api/health') return;
    event.respondWith(networkFirst(request));
  } else if (url.pathname.startsWith('/uploads/')) {
    event.respondWith(cacheFirst(request));
  } else if (request.mode === 'navigate') {
    // Rotas do app usam "#/..."; toda navegação abre o index.
    event.respondWith(staleWhileRevalidate(event, new Request('/')));
  } else {
    event.respondWith(staleWhileRevalidate(event, request));
  }
});
