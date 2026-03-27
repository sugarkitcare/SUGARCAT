const CACHE_NAME = 'caremaster-v0.3.74';
const STATIC_ASSETS = ['/'];

self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  // HTML 파일은 항상 네트워크에서 최신 버전 가져오기
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).catch(() => caches.match('/'))
    );
    return;
  }
  // 나머지는 캐시 우선, 없으면 네트워크
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
