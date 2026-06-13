/* Business Wheels — Service Worker
 * Minimal SW for PWA installability.
 * Caches the scan page and core assets for offline resilience.
 */

const CACHE = "bw-v1";
const PRECACHE = [
  "/scan/",
  "/customer/",
  "/assets/css/styles.css",
  "/assets/js/api.js",
  "/assets/js/auth-ui.js",
  "/assets/js/util.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(PRECACHE).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  // Only handle GET requests for same-origin or CDN assets
  if (e.request.method !== "GET") return;

  // For API calls — always go network first, no caching
  if (e.request.url.includes("railway.app")) return;

  e.respondWith(
    caches.match(e.request).then((cached) => {
      const network = fetch(e.request).then((res) => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, clone));
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
