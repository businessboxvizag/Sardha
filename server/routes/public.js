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

module.exports = router;
