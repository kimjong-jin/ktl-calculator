/* KTL 계산기 Service Worker — 웹 푸시 알람(화면 꺼져도 OS 알림). iOS PWA 호환 우선. */
self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(self.clients.claim()); });

self.addEventListener('push', (event) => {
  // payload 파싱 — 실패해도 기본 알림은 반드시 표시(iOS는 매 푸시마다 알림 표시 요구)
  let title = '측정 완료';
  let body = '타이머가 완료되었습니다.';
  try {
    if (event.data) {
      const d = event.data.json();
      if (d && d.title) title = String(d.title);
      if (d && d.body) body = String(d.body);
    }
  } catch (_) {
    try { if (event.data) body = event.data.text() || body; } catch (_) {}
  }
  // iOS 미지원 옵션(vibrate·requireInteraction·renotify 등) 제거 — 최소 옵션만
  event.waitUntil(
    self.registration.showNotification(title, {
      body: body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: 'ktl-timer-' + Date.now(),   // 고유 tag → 반복 발송마다 개별 알림·진동(놓침 방지)
      data: { url: '/' },
    }).catch(() => self.registration.showNotification(title, { body: body }))
  );
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
