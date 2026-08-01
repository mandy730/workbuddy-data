const CACHE = 'mama-hub-v3';
const FILES = ['./icon.svg', './manifest.json'];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).catch(() => {}));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // 同步接口 & SSE：绝不缓存，永远走网络
  if (url.pathname.startsWith('/api/')) return;

  // 页面与脚本：网络优先且禁用 HTTP 缓存，保证手机端拿到最新版本
  const isShell = req.mode === 'navigate' ||
    /\.(html|js|css)$/.test(url.pathname) ||
    url.pathname === '/' || url.pathname === '';

  if (isShell) {
    e.respondWith(
      fetch(req, { cache: 'no-store' })
        .then(r => {
          const cp = r.clone();
          caches.open(CACHE).then(c => c.put(req, cp)).catch(() => {});
          return r;
        })
        .catch(() => caches.match(req).then(r => r || caches.match('./index.html')))
    );
    return;
  }

  // 其他静态资源：缓存优先
  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(r => {
      const cp = r.clone();
      caches.open(CACHE).then(c => c.put(req, cp)).catch(() => {});
      return r;
    }))
  );
});
