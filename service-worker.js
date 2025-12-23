const cacheName = 'calendar-app-v1';
const filesToCache = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(cacheName).then(cache => cache.addAll(filesToCache))
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // 외부 API는 service worker에서 건드리지 않음
  if (url.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then(
      res => res || fetch(event.request)
    )
  );
});
;
