// ─── May — Service Worker ────────────────────────────────────────────────────
const CACHE = 'may-v1';

self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(clients.claim());
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
