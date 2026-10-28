// Gokski — Service Worker: აპი და ხმა ინახება მოწყობილობაზე, რომ ინტერნეტის გარეშეც იმუშაოს.
const SHELL = 'gokski-shell-v4';
const AUDIO = 'gokski-audio-v1';
const ASSETS = ['/', '/js/features.js', '/content/talk.js', '/content/listen.js',
  '/units/a1.js', '/units/a2.js', '/units/b1.js', '/units/b2.js', '/manifest.webmanifest', '/icon.svg'];
const MAX_AUDIO = 2500;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== SHELL && k !== AUDIO).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // ხმა: ჯერ მოწყობილობიდან, მერე ინტერნეტიდან
  if (url.origin === location.origin && url.pathname === '/api/tts') { e.respondWith(audio(req)); return; }
  if (url.origin === location.origin && url.pathname.startsWith('/api/')) return;

  // შრიფტები და Telegram-ის სკრიპტი: ქეშიდან, ფონზე განახლებით
  if (/fonts\.(googleapis|gstatic)\.com$|(^|\.)telegram\.org$/.test(url.hostname)) { e.respondWith(stale(req)); return; }
  if (url.origin !== location.origin) return;

  // აპის ფაილები: ჯერ ინტერნეტიდან (რომ განახლება მოვიდეს), კავშირის გარეშე — ქეშიდან
  e.respondWith(fresh(req, req.mode === 'navigate'));
});

async function fresh(req, isPage) {
  const cache = await caches.open(SHELL);
  try {
    const res = await timeout(fetch(req), 4000);
    if (res.ok && !res.redirected) cache.put(isPage ? '/' : req, res.clone());
    return res;
  } catch (err) {
    const hit = isPage ? await cache.match('/') : await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    throw err;
  }
}
async function stale(req) {
  const cache = await caches.open(SHELL);
  const hit = await cache.match(req);
  const net = fetch(req).then(res => { if (res.ok || res.type === 'opaque') cache.put(req, res.clone()); return res; }).catch(() => null);
  return hit || (await net) || Response.error();
}
async function audio(req) {
  const cache = await caches.open(AUDIO);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) {
    await cache.put(req, res.clone());
    const keys = await cache.keys();
    if (keys.length > MAX_AUDIO) await Promise.all(keys.slice(0, keys.length - MAX_AUDIO).map(k => cache.delete(k)));
  }
  return res;
}
function timeout(p, ms) { return new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('timeout')), ms); p.then(v => { clearTimeout(t); res(v); }, e => { clearTimeout(t); rej(e); }); }); }
