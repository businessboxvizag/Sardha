/* Saardha — Service Worker
 * - Offline shell for all apps (cache-first for static, network-first for API).
 * - Web Push: shows a notification (with vibration) even when the app is closed,
 *   so merchants and riders are alerted to new orders/tasks.
 */
const CACHE = "sardha-v5";
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

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // Never cache API or socket traffic — always go to the network.
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/socket.io/")) return;
  if (e.request.method !== "GET") return;
  // Cache-first for the app shell / static assets.
  e.respondWith(
    caches.match(e.request).then((cached) =>
      cached ||
      fetch(e.request)
        .then((res) => {
          if (res && res.ok && (e.request.url.startsWith("http"))) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached)
    )
  );
});

/* ── Web Push ──────────────────────────────────────────────────────────
 * Payload: { title, body, tag, url }. requireInteraction keeps it on screen,
 * and a vibration pattern makes the phone buzz like an alarm.               */
self.addEventListener("push", (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch (err) { data = { title: "Saardha", body: e.data ? e.data.text() : "" }; }
  const title = data.title || "Saardha";
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
  e.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || "/";
  e.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (c.url.includes(target) && "focus" in c) return c.focus();
      }
      if (clients.openWindow) return clients.openWindow(target);
    })
  );
});
