const express = require("express");
const { db } = require("../config/firebase");

const router = express.Router();

/**
 * GET /api/public/vendors/:id
 * Returns basic vendor info with NO auth required.
 * Used by the scan landing page before the customer has a JWT.
 */
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
