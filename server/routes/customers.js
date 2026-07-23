const express = require("express");
const { db } = require("../config/firebase");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

/* ── GET /api/customers ─────────────────────────────────────── */
router.get("/", requireAuth, requireRole("merchant", "admin"), async (req, res) => {
  try {
    const snap = await db.collection("customers").get();
    const customers = snap.docs.map((d) => {
      const data = d.data();
      delete data.userId; // don't expose internal uid link
      return { id: d.id, ...data };
    });
    res.json(customers);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch customers" });
  }
});

/* ── GET /api/customers/me ───────────────────────────────────── */
router.get("/me", requireAuth, requireRole("customer"), async (req, res) => {
  try {
    const snap = await db
      .collection("customers")
      .where("userId", "==", req.user.uid)
      .limit(1)
      .get();
    if (snap.empty) return res.status(404).json({ error: "Customer profile not found" });
    const doc = snap.docs[0];
    res.json({ id: doc.id, ...doc.data() });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch customer profile" });
  }
});

/* ── PUT /api/customers/me ───────────────────────────────────── */
router.put("/me", requireAuth, requireRole("customer"), async (req, res) => {
  try {
    const snap = await db
      .collection("customers")
      .where("userId", "==", req.user.uid)
      .limit(1)
      .get();
    if (snap.empty) return res.status(404).json({ error: "Customer profile not found" });

    const ref = snap.docs[0].ref;
    const allowed = ["address", "lat", "lng", "name"];
    const updates = {};
    allowed.forEach((k) => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });

    await ref.update(updates);
    const updated = await ref.get();
    res.json({ id: updated.id, ...updated.data() });
  } catch (err) {
    res.status(500).json({ error: "Failed to update profile" });
  }
});

/* ── GET /api/customers/me/favorites ────────────────────────── */
router.get("/me/favorites", requireAuth, requireRole("customer"), async (req, res) => {
  try {
    const custSnap = await db
      .collection("customers")
      .where("userId", "==", req.user.uid)
      .limit(1)
      .get();
    if (custSnap.empty) return res.json([]);
    const custId = custSnap.docs[0].id;

    const doc = await db.collection("favorites").doc(custId).get();
    res.json(doc.exists ? (doc.data().vendorIds || []) : []);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch favorites" });
  }
});

/* ── POST /api/customers/me/favorites/toggle ────────────────── */
router.post("/me/favorites/toggle", requireAuth, requireRole("customer"), async (req, res) => {
  try {
    const { vendorId } = req.body;
    if (!vendorId) return res.status(400).json({ error: "vendorId required" });

    const custSnap = await db
      .collection("customers")
      .where("userId", "==", req.user.uid)
      .limit(1)
      .get();
    if (custSnap.empty) return res.status(404).json({ error: "Profile not found" });
    const custId = custSnap.docs[0].id;

    const ref = db.collection("favorites").doc(custId);
    const doc = await ref.get();
    let vendorIds = doc.exists ? (doc.data().vendorIds || []) : [];

    if (vendorIds.includes(vendorId)) {
      vendorIds = vendorIds.filter((v) => v !== vendorId);
    } else {
      vendorIds.push(vendorId);
    }

    await ref.set({ vendorIds }, { merge: true });
    res.json(vendorIds);
  } catch (err) {
    res.status(500).json({ error: "Failed to toggle favorite" });
  }
});

module.exports = router;
