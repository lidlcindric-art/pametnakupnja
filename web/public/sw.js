/* PametnaKupnja service worker — offline rad PWA-e.
 * Verziju (__BUILD__) upisuje scripts/stamp-sw.mjs pri svakom buildu. */
const V = "pk-__BUILD__";
const SHELL = `${V}-shell`;
const DATA = `${V}-data`;
const IMG = "pk-img";
const PRECACHE = ["/", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(PRECACHE)));
});
self.addEventListener("message", (e) => { if (e.data === "skipWaiting") self.skipWaiting(); });
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("pk-") && k !== IMG && !k.startsWith(V)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function networkFirst(req, cacheName, fallback) {
  const c = await caches.open(cacheName);
  try {
    const r = await fetch(req);
    if (r.ok) c.put(req, r.clone());
    return r;
  } catch {
    return (await c.match(req)) || (fallback && (await c.match(fallback))) || Response.error();
  }
}
async function staleWhileRevalidate(req, cacheName) {
  const c = await caches.open(cacheName);
  const hit = await c.match(req);
  const net = fetch(req).then((r) => { if (r.ok) c.put(req, r.clone()); return r; }).catch(() => hit);
  return hit || net;
}
async function cacheFirst(req, cacheName) {
  const c = await caches.open(cacheName);
  const hit = await c.match(req);
  if (hit) return hit;
  const r = await fetch(req);
  if (r.ok || r.type === "opaque") c.put(req, r.clone());
  return r;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return; // POST /api/basket: zadnji rezultat čuva aplikacija (localStorage)
  const url = new URL(req.url);

  if (url.origin === location.origin) {
    if (req.mode === "navigate") return e.respondWith(networkFirst(req, SHELL, "/"));
    if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/"))
      return e.respondWith(cacheFirst(req, SHELL)); // hashirane datoteke
    if (url.pathname === "/api/items" || url.pathname === "/api/meta" || url.pathname.startsWith("/api/recipes"))
      return e.respondWith(staleWhileRevalidate(req, DATA));
    if (url.pathname.startsWith("/api/stores")) return e.respondWith(networkFirst(req, DATA));
    return;
  }
  // slike recepata (Coolinarika CDN)
  if (req.destination === "image") e.respondWith(cacheFirst(req, IMG).catch(() => Response.error()));
});
