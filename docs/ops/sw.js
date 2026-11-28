// 입금 확인 앱 — 푸시 알림만 받는다(페이지를 저장해 두지 않음: 늘 새 화면)
// 알림을 누르면: 서버가 보낸 url 의 # 뒤(예: 운영자 메시지 확인 '/ops/#msgs' → #msgs)로 그 화면을 연다(2026-11-28 · ops.js v=11).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// '/ops/#msgs' → '#msgs'(이 앱 안 화면 이름만 쓴다 — 다른 주소로는 열지 않음)
const hashOf = (url) => { const m = /#([a-z]{1,12})$/.exec(String(url || '')); return m ? '#' + m[1] : ''; };

self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { d = { body: event.data ? event.data.text() : '' }; }
  const jobs = [self.registration.showNotification(d.title || '입금 확인', {
    body: d.body || '확인할 입금이 있어요.',
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    data: { at: Date.now(), hash: hashOf(d.url) }
  })];
  const nav = self.navigator;
  if (typeof d.badge === 'number' && nav && nav.setAppBadge) jobs.push((d.badge > 0 ? nav.setAppBadge(d.badge) : nav.clearAppBadge()).catch(() => {}));
  jobs.push(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => list.forEach((c) => c.postMessage('refresh'))));
  event.waitUntil(Promise.all(jobs));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const hash = (event.notification.data && event.notification.data.hash) || '';
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) {
      c.postMessage(hash ? { open: hash } : 'refresh');
      if ('focus' in c) return c.focus();
    }
    return self.clients.openWindow(new URL('./' + hash, self.registration.scope).href);
  }));
});
