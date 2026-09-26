// Service worker: guarda la app en el dispositivo para que abra sin conexión.
// Al publicar cambios en index.html, subí el número de versión.
const CACHE = 'go-v7';
const ASSETS = ['./', './index.html', './manifest.webmanifest', './icon-180.png', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Con conexión trae siempre la versión nueva (espera hasta 4 s); sin conexión usa la guardada.
// Las llamadas a Apps Script (otro dominio) no pasan por acá.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(caches.open(CACHE).then(async c => {
    const cached = () => c.match(e.request, { ignoreSearch: true })
      .then(r => r || (e.request.mode === 'navigate' ? c.match('./index.html') : null));
    const net = fetch(e.request, { cache: 'no-cache' }).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; });
    const timeout = new Promise(res => setTimeout(res, 4000, null));
    const r = await Promise.race([net.catch(() => null), timeout]);
    return r || await cached() || await net.catch(() => new Response('Sin conexión', { status: 503 }));
  }));
});
