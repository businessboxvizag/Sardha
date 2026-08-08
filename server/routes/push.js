/**
 * push.js — Web Push subscription management.
 *   POST /api/push/subscribe    { subscription }   save this device for the signed-in user
 *   POST /api/push/unsubscribe  { endpoint }       remove it
 */
const express = require("express");
const { requireAuth } = require("../middleware/auth");
const push = require("../lib/push");

const router = express.Router();

router.post("/subscribe", requireAuth, async (req, res) => {
  try {
    if (!push.isEnabled()) return res.status(200).json({ ok: false, reason: "push_disabled" });
    const sub = req.body.subscription;
    if (!sub || !sub.endpoint) return res.status(400).json({ error: "subscription required" });
    await push.saveSubscription(req.user.uid, sub);
    res.json({ ok: true });
  } catch (err) {
    console.error("POST /push/subscribe:", err);
    res.status(500).json({ error: "Failed to subscribe" });
  }
});

router.post("/unsubscribe", requireAuth, async (req, res) => {
  try {
    if (req.body.endpoint) await push.removeSubscription(req.user.uid, req.body.endpoint);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to unsubscribe" });
  }
});

module.exports = router;
