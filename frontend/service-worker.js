// ─── Service Worker — May PWA ─────────────────────────────────────────────────
const CACHE_NAME = 'may-v5';

// Rotas HTML que NUNCA devem ser cacheadas (precisam sempre ir à rede)
const NEVER_CACHE = ['/', '/app', '/index.html', '/auth.html', '/landing.html'];

const CACHE_STATIC = [
  '/css/main.css',
  '/css/app.css',
  '/css/auth.css',
  '/js/api.js',
  '/js/markdown.js',
  '/js/app.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
];

// ─── Install: pré-cacheia recursos estáticos ──────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(CACHE_STATIC))
  );
  self.skipWaiting();
});

// ─── Activate: limpa caches antigos ──────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ─── Fetch: cache-first para estáticos, network-only para API e HTML ─────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Rotas de API: sempre rede (nunca cachear)
  if (url.pathname.startsWith('/api/')) return;

  // SSE (streaming): nunca cachear
  if (url.pathname.includes('/stream')) return;

  // Páginas HTML principais: sempre rede (nunca cachear — evita servir página errada)
  if (NEVER_CACHE.includes(url.pathname)) return;

  // Estáticos (CSS/JS): rede primeiro, cache só como fallback offline.
  // Cache-first aqui fazia o usuário continuar rodando um app.js/app.css antigos
  // depois de cada deploy, até o CACHE_NAME mudar.
  event.respondWith(
    fetch(event.request).then(res => {
      if (!res || res.status !== 200 || res.type === 'opaque') return res;
      const clone = res.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
      return res;
    }).catch(() => caches.match(event.request))
  );
});

// ─── Push recebido ────────────────────────────────────────────────────────────
self.addEventListener('push', e => {
  if (!e.data) return;
  let payload;
  try { payload = e.data.json(); } catch { payload = { title: 'May', body: e.data.text() }; }

  const title   = payload.title || 'May';
  const options = {
    body:    payload.body  || '',
    icon:    payload.icon  || '/assets/icon-192.png',
    badge:   '/assets/icon-192.png',
    tag:     payload.tag   || 'may-notif',
    data:    { url: payload.url || '/app' },
    actions: payload.actions || [{ action: 'abrir', title: 'Abrir May' }],
    requireInteraction: false,
    silent: false,
  };

  e.waitUntil(self.registration.showNotification(title, options));
});

// ─── Clique na notificação ────────────────────────────────────────────────────
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data?.url || '/app';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const mayTab = list.find(c => c.url.includes(self.location.origin));
      if (mayTab) { mayTab.focus(); mayTab.navigate(url); }
      else clients.openWindow(url);
    })
  );
});
