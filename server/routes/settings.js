const express = require("express");
const { db } = require("../config/firebase");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();
const SETTINGS_DOC = "global";

/* ── GET /api/settings ─── public read ── */
router.get("/", async (req, res) => {
  try {
    const doc = await db.collection("settings").doc(SETTINGS_DOC).get();
    const data = doc.exists ? doc.data() : {};
    res.json({ deliveryFee: data.deliveryFee ?? 15, ...data });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch settings" });
  }
});

/* ── PUT /api/settings ─── admin only ── */
router.put("/", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const allowed = ["deliveryFee"];
    const updates = {};
    allowed.forEach((k) => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
    if (updates.deliveryFee !== undefined) updates.deliveryFee = Number(updates.deliveryFee);
    await db.collection("settings").doc(SETTINGS_DOC).set(updates, { merge: true });
    const doc = await db.collection("settings").doc(SETTINGS_DOC).get();
    res.json(doc.data());
  } catch (err) {
    res.status(500).json({ error: "Failed to update settings" });
  }
});

module.exports = router;
