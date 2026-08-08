/**
 * push.js — Web Push (VAPID) so merchants and riders get a notification even when
 * the app is closed. Uses the standard `web-push` library and VAPID keys from env.
 *
 * Generate keys once:  node -e "console.log(require('web-push').generateVAPIDKeys())"
 * Then set in the environment:
 *   VAPID_PUBLIC_KEY   VAPID_PRIVATE_KEY   VAPID_SUBJECT (e.g. mailto:ops@saardha.com)
 *
 * Subscriptions are stored per user in the `push_subscriptions` collection
 * (doc id = uid, field `subs` = array of subscription objects). Dead subscriptions
 * (410/404) are pruned automatically.
 */
let webpush = null;
try { webpush = require("web-push"); } catch (e) { /* dependency not installed yet */ }

const { db } = require("../config/firebase");

const PUBLIC = process.env.VAPID_PUBLIC_KEY || "";
const PRIVATE = process.env.VAPID_PRIVATE_KEY || "";
const SUBJECT = process.env.VAPID_SUBJECT || "mailto:support@saardha.com";
const enabled = !!(webpush && PUBLIC && PRIVATE);

if (enabled) {
  try { webpush.setVapidDetails(SUBJECT, PUBLIC, PRIVATE); }
  catch (e) { console.error("web-push VAPID setup failed:", e.message); }
}

const isEnabled = () => enabled;
const publicKey = () => PUBLIC;

async function saveSubscription(uid, subscription) {
  if (!uid || !subscription || !subscription.endpoint) return;
  const ref = db.collection("push_subscriptions").doc(uid);
  const doc = await ref.get();
  const subs = doc.exists && Array.isArray(doc.data().subs) ? doc.data().subs : [];
  if (!subs.some((s) => s.endpoint === subscription.endpoint)) subs.push(subscription);
  await ref.set({ uid, subs }, { merge: true });
}

async function removeSubscription(uid, endpoint) {
  const ref = db.collection("push_subscriptions").doc(uid);
  const doc = await ref.get();
  if (!doc.exists) return;
  const subs = (doc.data().subs || []).filter((s) => s.endpoint !== endpoint);
  await ref.set({ uid, subs }, { merge: true });
}

/**
 * Send a push to every device registered for a user. Payload becomes the notification.
 * Safe no-op when push isn't configured. Prunes subscriptions the browser has dropped.
 */
async function sendToUser(uid, payload) {
  if (!enabled || !uid) return;
  const ref = db.collection("push_subscriptions").doc(uid);
  const doc = await ref.get();
  if (!doc.exists) return;
  const subs = doc.data().subs || [];
  if (!subs.length) return;
  const body = JSON.stringify(payload || {});
  const alive = [];
  await Promise.all(subs.map(async (sub) => {
    try {
      await webpush.sendNotification(sub, body, { TTL: 120, urgency: "high" });
      alive.push(sub);
    } catch (err) {
      const code = err && err.statusCode;
      if (code === 404 || code === 410) return; // gone — drop it
      alive.push(sub); // transient error — keep for next time
    }
  }));
  if (alive.length !== subs.length) await ref.set({ uid, subs: alive }, { merge: true });
}

module.exports = { isEnabled, publicKey, saveSubscription, removeSubscription, sendToUser };
