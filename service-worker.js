// 배포할 때마다 버전을 올리면 이전 캐시를 정리한다.
const CACHE_NAME = 'calendar-app-v6';

// GitHub Pages 하위 경로(/calendar-app/)에서도 동작하도록 상대 경로를 쓴다.
const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './core.js',
  './script.js',
  './manifest.json',
  './icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 네트워크 우선: 온라인이면 항상 최신 파일, 오프라인이면 캐시로 동작한다.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  // 외부 API(공휴일)는 서비스 워커에서 건드리지 않는다. 앱이 localStorage에 캐시한다.
  if (new URL(req.url).origin !== self.location.origin) return;

  event.respondWith(
    // no-cache: HTTP 캐시가 있어도 서버에 재검증해 배포 직후 최신 파일을 받는다.
    fetch(req, { cache: 'no-cache' })
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          event.waitUntil(
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {})
          );
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((res) => {
        if (res) return res;
        // 내비게이션 요청만 앱 셸로 대체한다. 스크립트/스타일에 HTML을 돌려주면 안 된다.
        if (req.mode === 'navigate') return caches.match('./index.html');
        return Response.error();
      }))
  );
});

// 알림을 누르면 열린 창으로 이동하거나 새로 연다.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      if (wins.length > 0) return wins[0].focus();
      return self.clients.openWindow('./');
    })
  );
});
