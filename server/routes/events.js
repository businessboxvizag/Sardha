/**
 * Behavioral event tracking (Bucket-1 analytics).
 * POST /api/events        { type, props }  — logged-in customers log an interaction
 * GET  /api/events        — admin pulls recent events (for the Behavior dashboard)
 *
 * We store only first-party behavioral signals (searches, views, cart actions,
 * orders). No device fingerprinting, no ad IDs, no third-party sharing.
 */
const express = require("express");
const { db } = require("../config/firebase");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

const ALLOWED_TYPES = [
  "search", "view_store", "view_product",
  "add_to_cart", "remove_from_cart", "cart_abandoned",
  "order_placed", "app_open",
];

/* ── POST /api/events ─────────────────────────────────────────── */
router.post("/", requireAuth, async (req, res) => {
  try {
    const type = String(req.body.type || "").slice(0, 40);
    if (!ALLOWED_TYPES.includes(type)) return res.status(400).json({ error: "unknown event type" });

    // Keep props small and string-y; never store anything sensitive here.
    const rawProps = req.body.props && typeof req.body.props === "object" ? req.body.props : {};
    const props = {};
    Object.keys(rawProps).slice(0, 12).forEach((k) => {
      const v = rawProps[k];
      props[String(k).slice(0, 40)] = (typeof v === "number") ? v : String(v == null ? "" : v).slice(0, 120);
    });

    await db.collection("events").add({
      userId: req.user.uid,
      email: req.user.email || null,
      type,
      props,
      at: new Date().toISOString(),
      ua: (req.headers["user-agent"] || "").slice(0, 200),
    });
    res.json({ ok: true });
  } catch (err) {
    // Analytics must never break the app — swallow errors.
    res.json({ ok: false });
  }
});

/* ── GET /api/events  (admin) ─────────────────────────────────── */
router.get("/", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const limit = Math.min(2000, Number(req.query.limit) || 1000);
    const snap = await db.collection("events").orderBy("at", "desc").limit(limit).get();
    res.json(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  } catch (err) {
    // Missing composite index or empty collection — return empty, not an error.
    res.json([]);
  }
});

module.exports = router;
