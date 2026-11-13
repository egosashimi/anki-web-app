// Offline support: precache the app shell, then serve cache-first.
// __BUILD__ is replaced with the commit hash at deploy time, so every deploy
// installs a fresh cache.
const VERSION = '__BUILD__';
const CACHE = `flashcards-${VERSION}`;
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/app.js',
  'js/apkg.js',
  'js/col.js',
  'js/db.js',
  'js/io.js',
  'js/media.js',
  'js/queue.js',
  'js/render.js',
  'js/sched.js',
  'js/template.js',
  'js/textio.js',
  'js/ui.js',
  'js/util.js',
  'js/views/browse.js',
  'js/views/deckoptions.js',
  'js/views/decks.js',
  'js/views/editor.js',
  'js/views/importexport.js',
  'js/views/notetypes.js',
  'js/views/settings.js',
  'js/views/stats.js',
  'js/views/study.js',
  'vendor/fflate.js',
  'vendor/fzstd.js',
  'vendor/sql-wasm.js',
  'vendor/sql-wasm.wasm',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('flashcards-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      // navigations always get the app shell
      if (req.mode === 'navigate') {
        const shell = await cache.match('index.html');
        if (shell) return shell;
      }
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res.ok && res.type === 'basic') cache.put(req, res.clone());
        return res;
      } catch (e) {
        const fallback = req.mode === 'navigate' ? await cache.match('./') : null;
        if (fallback) return fallback;
        throw e;
      }
    })()
  );
});
