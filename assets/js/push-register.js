/* =====================================================================
 * Saardha — Web Push registration
 * Subscribes the current device to push notifications so new orders/tasks
 * alert the merchant/rider even when the app is closed. No-op if the server
 * hasn't configured VAPID keys, or the browser/user declines.
 * Call SaardhaPush.enable() after login (config must be loaded first).
 * ===================================================================== */
(function (global) {
  "use strict";

  function urlB64ToUint8Array(base64) {
    const padding = "=".repeat((4 - (base64.length % 4)) % 4);
    const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(b64);
    const arr = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    return arr;
  }

  async function enable() {
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in global)) return;
      const cfg = (global.BW && BW.config && BW.config()) || {};
      const key = cfg.vapidPublicKey;
      if (!key) return;                         // push not configured on the server
      if (!("Notification" in global)) return;
      if (Notification.permission === "denied") return;
      if (Notification.permission === "default") {
        const perm = await Notification.requestPermission();
        if (perm !== "granted") return;
      }
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      // If the device subscribed earlier with a DIFFERENT/placeholder VAPID key, that
      // subscription is dead — drop it and re-subscribe with the current key.
      let savedKey = null;
      try { savedKey = localStorage.getItem("bw_push_key"); } catch (e) {}
      if (sub && savedKey && savedKey !== key) {
        try { await sub.unsubscribe(); } catch (e) {}
        sub = null;
      }
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlB64ToUint8Array(key),
        });
      }
      try { localStorage.setItem("bw_push_key", key); } catch (e) {}
      if (global.BW && BW.savePushSubscription) {
        await BW.savePushSubscription(sub.toJSON ? sub.toJSON() : sub);
      }
    } catch (e) { /* best-effort; ignore */ }
  }

  global.SaardhaPush = { enable: enable };
})(window);
