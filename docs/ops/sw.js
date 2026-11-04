// 입금 확인 앱 — 푸시 알림만 받는다(페이지를 저장해 두지 않음: 늘 새 화면)
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { d = { body: event.data ? event.data.text() : '' }; }
  const jobs = [self.registration.showNotification(d.title || '입금 확인', {
    body: d.body || '확인할 입금이 있어요.',
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    data: { at: Date.now() }
  })];
  const nav = self.navigator;
  if (typeof d.badge === 'number' && nav && nav.setAppBadge) jobs.push((d.badge > 0 ? nav.setAppBadge(d.badge) : nav.clearAppBadge()).catch(() => {}));
  jobs.push(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => list.forEach((c) => c.postMessage('refresh'))));
  event.waitUntil(Promise.all(jobs));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) { c.postMessage('refresh'); if ('focus' in c) return c.focus(); }
    return self.clients.openWindow('./');
  }));
});
