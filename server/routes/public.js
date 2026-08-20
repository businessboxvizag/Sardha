const express = require("express");
const { db } = require("../config/firebase");

const router = express.Router();

/**
 * GET /api/public/vendors/:id
 * Returns basic vendor info with NO auth required.
 * Used by the scan landing page before the customer has a JWT.
 */
/**
 * GET /api/public/vendors
 * Public list of active stores (non-sensitive fields) — powers the single-QR
 * "pick your store" screen on the scan landing page.
 */
router.get("/vendors", async (req, res) => {
  try {
    const snap = await db.collection("vendors").get();
    const list = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((v) => v.active !== false && v.status !== "inactive" && v.status !== "pending_setup")
      .map((v) => ({ id: v.id, name: v.name, category: v.category, area: v.area, img: v.img, lat: v.lat ?? null, lng: v.lng ?? null }))
      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
    res.json(list);
  } catch (err) {
    console.error("GET /public/vendors:", err);
    res.status(500).json({ error: "Failed to fetch stores" });
  }
});

router.get("/vendors/:id", async (req, res) => {
  try {
    const doc = await db.collection("vendors").doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: "Vendor not found" });
    const { id, name, category, area, img, active } = { id: doc.id, ...doc.data() };
    if (!active) return res.status(404).json({ error: "Vendor not found" });
    // Only expose non-sensitive fields
    res.json({ id, name, category, area, img });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch vendor" });
  }
});

/**
 * POST /api/public/metric  { type: "install" | "open", app? }
 * Lightweight, no-auth PWA analytics: the apps report when they're installed
 * (Add to Home Screen) and when they're launched in standalone mode. Aggregated
 * into a single metrics/global doc with all-time totals and per-day buckets.
 * Clients de-duplicate (install once/device, open once/session) so counts are sane.
 */
router.post("/metric", async (req, res) => {
  try {
    const type = req.body && req.body.type;
    if (type !== "install" && type !== "open") return res.status(400).json({ error: "bad type" });
    const app = String((req.body && req.body.app) || "other").slice(0, 16);
    const day = new Date().toISOString().slice(0, 10);   // YYYY-MM-DD (UTC)
    const ref = db.collection("metrics").doc("global");
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const d = snap.exists ? snap.data() : {};
      const daily = d.daily || {};
      const bucket = daily[day] || { installs: 0, opens: 0 };
      const byApp = d.byApp || {};
      const appRec = byApp[app] || { installs: 0, opens: 0 };
      if (type === "install") { d.installs = Number(d.installs || 0) + 1; bucket.installs++; appRec.installs++; d.lastInstallAt = new Date().toISOString(); }
      else { d.opens = Number(d.opens || 0) + 1; bucket.opens++; appRec.opens++; }
      daily[day] = bucket; byApp[app] = appRec;
      // Keep only the last ~120 days of buckets so the doc never grows unbounded.
      const keys = Object.keys(daily).sort();
      while (keys.length > 120) delete daily[keys.shift()];
      d.daily = daily; d.byApp = byApp; d.updatedAt = new Date().toISOString();
      if (snap.exists) tx.update(ref, d); else tx.set(ref, d);
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "metric failed" });
  }
});

module.exports = router;
