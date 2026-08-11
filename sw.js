/* Saardha — Service Worker
 * - App code (HTML/JS/CSS) is served NETWORK-FIRST so a new deploy shows up
 *   immediately; it falls back to cache only when offline.
 * - Other static assets (images/fonts) are cache-first for speed.
 * - Web Push: shows a notification (with vibration) even when the app is closed.
 */
const CACHE = "sardha-v6";
const SHELL = [
  "/assets/css/styles.css",
  "/assets/js/api.js",
  "/assets/js/auth-ui.js",
  "/assets/js/util.js",
  "/assets/js/alert-buzzer.js",
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
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
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

function cachePut(req, res) {
  if (res && res.ok && new URL(req.url).origin === self.location.origin) {
    const copy = res.clone();
    caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
  }
  return res;
}

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  // API and sockets: always straight to the network, never cached.
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/socket.io/")) return;

  const isAppCode = e.request.mode === "navigate" || /\.(js|css|html)$/i.test(url.pathname);
  if (isAppCode) {
    // Network-first: newest deploy wins; cache is only the offline fallback.
    e.respondWith(
      fetch(e.request).then((res) => cachePut(e.request, res)).catch(() => caches.match(e.request))
    );
    return;
  }
  // Everything else (images/fonts): cache-first for speed.
  e.respondWith(
    caches.match(e.request).then((cached) =>
      cached || fetch(e.request).then((res) => cachePut(e.request, res)).catch(() => cached)
    )
  );
});

/* ── Web Push ────────────────────────────────────────────────────────── */
self.addEventListener("push", (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch (err) { data = { title: "Saardha", body: e.data ? e.data.text() : "" }; }
  const options = {
    body: data.body || "",
    icon: "/assets/img/icon.png",
    badge: "/assets/img/icon.png",
    tag: data.tag || "saardha",
    renotify: true,
    requireInteraction: true,
    vibrate: [400, 150, 400, 150, 400, 150, 400],
    data: { url: data.url || "/" },
  };
  e.waitUntil(self.registration.showNotification(data.title || "Saardha", options));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || "/";
  e.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) { if (c.url.includes(target) && "focus" in c) return c.focus(); }
      if (clients.openWindow) return clients.openWindow(target);
    })
  );
});
