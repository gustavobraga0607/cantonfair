'use strict';

// Service worker do Missão China.
// - Telas do app (HTML/JS/CSS/ícones): abre do cache na hora e atualiza em segundo plano.
// - Fotos (/uploads/<id>): o id muda a cada foto nova, então ficam no cache.
// - Dados (/api/...): listas e detalhes abrem na hora com a última versão salva e são
//   atualizados em seguida (o app redesenha a tela se algo mudou). Os demais buscam na rede;
//   com sinal fraco, depois de 4 s mostra a versão salva. Sem conexão, mostra a última versão.
//   O cache de dados e fotos é apagado ao sair da conta.

const VERSION = 'v57';
const SHELL = `shell-${VERSION}`;
const DATA = 'api-v1';
const IMAGES = 'img-v1';
const SHELL_FILES = ['/', '/app.js', '/provinces.js', '/tourism.js', '/styles.css', '/manifest.webmanifest',
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

// Respostas da API guardadas para uso offline: mantém só as mais recentes.
const MAX_DATA = 300;
let dataPuts = 0;
async function trimData(cache) {
  const keys = await cache.keys();
  for (const req of keys.slice(0, Math.max(0, keys.length - MAX_DATA))) await cache.delete(req);
}

// Última gravação feita pelo app (POST/PUT/DELETE): cópia salva antes dela está desatualizada.
let lastWrite = 0;
const NET_TIMEOUT = 4000;
const offlineResponse = () => new Response(JSON.stringify({ error: 'Sem conexão com a internet.' }), {
  status: 503, headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Offline': '1' },
});
const marked = async (cached, header) => {
  const headers = new Headers(cached.headers);
  headers.set(header, '1');
  return new Response(await cached.blob(), { status: cached.status, headers });
};
async function notify(message) {
  for (const c of await self.clients.matchAll({ type: 'window' })) c.postMessage(message);
}
// Busca na rede e guarda a cópia. Se a cópia salva já tinha sido mostrada e mudou, avisa o app.
async function fetchAndStore(request, cache, shownCopy) {
  const res = await fetch(request);
  if (res.status === 401 && shownCopy) {
    // Sessão expirou enquanto o app mostrava dados salvos.
    await caches.delete(DATA);
    notify({ type: 'session-expired' });
    return res;
  }
  if (res.ok) {
    const copy = res.clone();
    const headers = new Headers(copy.headers);
    headers.set('X-Cached-At', String(Date.now()));
    const body = await copy.text();
    // Regrava no fim da lista (as mais usadas ficam) e confere o limite a cada 20 gravações.
    await cache.delete(request);
    await cache.put(request, new Response(body, { status: copy.status, headers }));
    if (++dataPuts % 20 === 0) trimData(cache);
    if (shownCopy && shownCopy !== body) {
      const u = new URL(request.url);
      notify({ type: 'api-updated', url: u.pathname + u.search });
    }
  }
  return res;
}
const usable = (cached) => cached && Number(cached.headers.get('X-Cached-At') || 0) > lastWrite;

// Listas e detalhes: mostra a cópia salva na hora e atualiza em segundo plano.
async function staleThenUpdate(event, request) {
  const cache = await caches.open(DATA);
  const cached = await cache.match(request);
  if (usable(cached)) {
    const shown = await cached.clone().text();
    event.waitUntil(fetchAndStore(request, cache, shown).catch(() => {}));
    return marked(cached, 'X-Stale');
  }
  return networkFirst(event, request, cache, cached);
}

// Rede primeiro; sinal fraco (4 s sem resposta) ou sem conexão: mostra a cópia salva.
async function networkFirst(event, request, cache, cached) {
  cache ??= await caches.open(DATA);
  cached ??= await cache.match(request);
  const shown = cached ? await cached.clone().text() : null;
  let timer;
  const net = fetchAndStore(request, cache, null);
  const slow = cached
    ? new Promise((resolve) => { timer = setTimeout(() => resolve('slow'), NET_TIMEOUT); })
    : new Promise(() => {});
  try {
    const first = await Promise.race([net, slow]);
    if (first !== 'slow') return first;
    // Mostra a cópia salva e deixa a busca terminar: se chegar algo novo, o app redesenha.
    event.waitUntil(net.then(async (res) => {
      if (!res.ok) return;
      const body = await res.clone().text().catch(() => null);
      if (body != null && body !== shown) {
        const u = new URL(request.url);
        notify({ type: 'api-updated', url: u.pathname + u.search });
      }
    }).catch(() => {}));
    return marked(cached, 'X-Stale');
  } catch {
    return cached ? marked(cached, 'X-Offline') : offlineResponse();
  } finally {
    clearTimeout(timer);
  }
}

// Telas cujos dados podem aparecer na hora (e ser atualizados logo depois).
const QUICK = /^\/api\/(me|suppliers|products|ranking|expenses|itineraries)(\/\d+)?$/;

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
  if (url.origin !== self.location.origin) return;
  if (request.method !== 'GET') {
    if (url.pathname.startsWith('/api/')) lastWrite = Date.now();
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    // Downloads e diagnóstico não passam pelo cache.
    if (url.pathname.endsWith('/file') || url.pathname.endsWith('/import-template') || url.pathname === '/api/health') return;
    // "fresh": o app precisa do dado atual (base de uma gravação): rede, sem cópia rápida.
    if (request.headers.get('X-Fresh')) {
      event.respondWith(caches.open(DATA).then((cache) => fetchAndStore(request, cache, null)).catch(() => offlineResponse()));
      return;
    }
    const quick = QUICK.test(url.pathname) && !request.headers.get('X-Net-First');
    event.respondWith(quick ? staleThenUpdate(event, request) : networkFirst(event, request));
  } else if (url.pathname.startsWith('/uploads/') || url.pathname.startsWith('/tourism/')) {
    event.respondWith(cacheFirst(request));
  } else if (request.mode === 'navigate') {
    // Rotas do app usam "#/..."; toda navegação abre o index.
    event.respondWith(staleWhileRevalidate(event, new Request('/')));
  } else {
    event.respondWith(staleWhileRevalidate(event, request));
  }
});
