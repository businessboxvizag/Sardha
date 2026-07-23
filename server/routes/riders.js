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

    const io = req.app.get("io");
    if (io) io.to("admin").emit("rider:updated", rider);

    res.json(rider);
  } catch (err) {
    res.status(500).json({ error: "Failed to update rider status" });
  }
});

/* ── PATCH /api/riders/:id/availability ─────────────────────── */
/* Rider toggles own online/offline status. Admin can also use this. */
router.patch("/:id/availability", requireAuth, async (req, res) => {
  if (req.user.role !== "admin" && req.user.uid !== req.params.id) {
    return res.status(403).json({ error: "Forbidden" });
  }
  const { status } = req.body;
  if (!["available", "offline"].includes(status)) {
    return res.status(400).json({ error: "status must be available or offline" });
  }
  try {
    const ref = db.collection("riders").doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: "Rider not found" });
    if (doc.data().status === "on_delivery" && status === "offline") {
      return res.status(400).json({ error: "Complete your delivery before going offline" });
    }
    await ref.update({ status });
    const updated = await ref.get();
    const rider = toRider(updated);
    const io = req.app.get("io");
    if (io) {
      io.to("admin").emit("rider:updated", rider);
      io.to("rider:" + req.params.id).emit("rider:updated", rider);
    }
    res.json(rider);
  } catch (err) {
    res.status(500).json({ error: "Failed to update availability" });
  }
});

/* ── PATCH /api/riders/:id/location ────────────────────────── */
/* Rider updates own location; admin can update any. (#6) */
router.patch("/:id/location", requireAuth, async (req, res) => {
  // Ownership: rider can only update their own location
  if (req.user.role !== "admin" && req.user.uid !== req.params.id) {
    return res.status(403).json({ error: "You can only update your own location" });
  }

  try {
    const lat = Number(req.body.lat);
    const lng = Number(req.body.lng);

    // Validate coordinates
    if (isNaN(lat) || isNaN(lng) || !isFinite(lat) || !isFinite(lng)) {
      return res.status(400).json({ error: "lat and lng must be valid numbers" });
    }
    if (lat < -90 || lat > 90)   return res.status(400).json({ error: "lat must be between -90 and 90" });
    if (lng < -180 || lng > 180) return res.status(400).json({ error: "lng must be between -180 and 180" });

    const ref = db.collection("riders").doc(req.params.id);
    await ref.update({ lat, lng });

    const io = req.app.get("io");
    if (io) {
      io.to("admin").emit("rider:location", { riderId: req.params.id, lat, lng });
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to update rider location" });
  }
});

module.exports = router;
