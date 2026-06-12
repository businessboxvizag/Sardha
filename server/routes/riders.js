const express = require("express");
const { db } = require("../config/firebase");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();
const toRider = (doc) => ({ id: doc.id, ...doc.data() });

/* ── GET /api/riders ────────────────────────────────────────── */
router.get("/", requireAuth, async (req, res) => {
  try {
    const snap = await db.collection("riders").get();
    res.json(snap.docs.map(toRider));
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch riders" });
  }
});

/* ── GET /api/riders/:id ────────────────────────────────────── */
router.get("/:id", requireAuth, async (req, res) => {
  try {
    const doc = await db.collection("riders").doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: "Rider not found" });
    res.json(toRider(doc));
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch rider" });
  }
});

/* ── PATCH /api/riders/:id/status (admin only) ─────────────── */
router.patch("/:id/status", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ["available", "on_delivery", "offline"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    const ref = db.collection("riders").doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: "Rider not found" });

    await ref.update({ status });
    const updated = await ref.get();
    const rider = toRider(updated);

    // Emit to admin room
    const io = req.app.get("io");
    if (io) io.to("admin").emit("rider:updated", rider);

    res.json(rider);
  } catch (err) {
    res.status(500).json({ error: "Failed to update rider status" });
  }
});

/* ── PATCH /api/riders/:id/location ────────────────────────── */
// Called by the rider's own app to broadcast GPS position
router.patch("/:id/location", requireAuth, async (req, res) => {
  try {
    const { lat, lng } = req.body;
    if (lat === undefined || lng === undefined) {
      return res.status(400).json({ error: "lat and lng required" });
    }

    const ref = db.collection("riders").doc(req.params.id);
    await ref.update({ lat: Number(lat), lng: Number(lng) });

    const io = req.app.get("io");
    if (io) {
      io.to("admin").emit("rider:location", { riderId: req.params.id, lat, lng });
      // Also emit to any customer tracking an order this rider is on
      io.to(`rider:${req.params.id}`).emit("rider:location", { riderId: req.params.id, lat, lng });
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to update rider location" });
  }
});

module.exports = router;
