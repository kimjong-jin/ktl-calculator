/* KTL 계산기 Service Worker — 웹 푸시 알람(화면 꺼져도 OS 알림) */
self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(self.clients.claim()); });

self.addEventListener('push', (event) => {
  let data = { title: '측정 완료', body: '타이머가 완료되었습니다.' };
  try { if (event.data) data = { ...data, ...event.data.json() }; } catch {}
  const options = {
    body: data.body,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    vibrate: [250, 150, 250, 150, 250],
    requireInteraction: true,   // 사용자가 닫을 때까지 유지
    tag: data.tag || 'ktl-timer',
    renotify: true,
    data: { url: '/' },
  };
  event.waitUntil(self.registration.showNotification(data.title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) { if ('focus' in c) return c.focus(); }
      if (self.clients.openWindow) return self.clients.openWindow('/');
    })
  );
});
