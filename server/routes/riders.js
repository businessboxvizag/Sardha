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
      io.to("rider:" + req.params.id).emit("rider:location", { riderId: req.params.id, lat, lng });
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to update rider location" });
  }
});

module.exports = router;
