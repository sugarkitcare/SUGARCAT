const CACHE_NAME = 'caremaster-v0.5.40';

self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  // 모든 요청을 항상 네트워크에서 가져오기 (캐시 완전 비활성화)
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request, {cache: 'no-cache'}).catch(() => caches.match('/'))
    );
    return;
  }
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});
