/* Sardha — Service Worker
 * Provides offline shell for all 4 apps.
 * Strategy: Cache-first for static assets, network-first for API calls.
 */
const CACHE = "sardha-v2";
const SHELL = [
  "/assets/css/styles.css",
  "/assets/js/api.js",
  "/assets/js/auth-ui.js",
  "/assets/js/util.js",
  "/customer/index.html",
  "/customer/customer.js",
  "/merchant/index.html",
  "/merchant/merchant.js",
  "/rider/index.html",
  "/rider/rider.js",
  "/admin/index.html",
  "/admin/admin.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {})
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
  const url = new URL(e.request.url);
  // Always network-first for API and socket calls
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/socket.io/")) return;
  // Cache-first for everything else
  e.respondWith(
    caches.match(e.request).then((cached) =>
      cached || fetch(e.request).then((res) => {
        if (res.ok && e.request.method === "GET") {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, clone));
        }
        return res;
      })
    )
  );
});
