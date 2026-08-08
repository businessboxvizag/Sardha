const express = require("express");
const { db } = require("../config/firebase");
const { requireAuth, requireRole } = require("../middleware/auth");
const razorpay = require("../config/razorpay");

const router = express.Router();
const toRider = (doc) => ({ id: doc.id, ...doc.data() });

async function getCodLimit() {
  try { const s = await db.collection("settings").doc("global").get(); const d = s.exists ? s.data() : {}; return Number(d.codCashLimit) || 2000; }
  catch (e) { return 2000; }
}
// A rider is auto-suspended once cash-in-hand has sat over the limit for >24h.
function isCashSuspended(rd, limit) {
  if (!rd || (rd.cashInHand || 0) < limit || !rd.cashOverLimitSince) return false;
  return (Date.now() - new Date(rd.cashOverLimitSince).getTime()) > 24 * 3600 * 1000;
}

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
    const rd = doc.data();
    if (rd.status === "on_delivery" && status === "offline") {
      return res.status(400).json({ error: "Complete your delivery before going offline" });
    }
    // Auto-suspension: can't go online while cash-in-hand is overdue past the limit.
    if (status === "available") {
      const limit = await getCodLimit();
      if (isCashSuspended(rd, limit)) {
        return res.status(403).json({ error: "Duty suspended — settle your cash-in-hand (₹" + (rd.cashInHand || 0) + ") to go back online." });
      }
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
      const payload = { riderId: req.params.id, lat, lng };
      io.to("admin").emit("rider:location", payload);
      // Stream to the customer watching this delivery (rider sends its active orderId).
      const orderId = req.body.orderId;
      if (orderId) io.to("order:" + orderId).emit("rider:location", payload);
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to update rider location" });
  }
});

/* ── PATCH /api/riders/:id/documents ── rider submits KYC docs + accepts policy ──
 * Delivery-partner onboarding: driving licence, Aadhaar, and one family member's ID
 * (name + relation + ID image), plus explicit acceptance of the cash-settlement policy.
 * Files are uploaded client-side to Cloudinary; we store the resulting URLs.        */
router.patch("/:id/documents", requireAuth, async (req, res) => {
  if (req.user.role !== "admin" && req.user.uid !== req.params.id) {
    return res.status(403).json({ error: "You can only submit your own documents" });
  }
  try {
    const ref = db.collection("riders").doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: "Rider not found" });

    const b = req.body || {};
    const str = (v, n) => (v == null ? undefined : String(v).slice(0, n));
    const docs = {
      dlUrl:            str(b.dlUrl, 500),
      dlNumber:         str(b.dlNumber, 40),
      aadhaarUrl:       str(b.aadhaarUrl, 500),
      bikePhotoUrl:     str(b.bikePhotoUrl, 500),
      riderPhone:       str(b.riderPhone, 20),
      riderAddress:     str(b.riderAddress, 300),
      // Nominee (guarantor) — name, relation, contact, address, and their Aadhaar/ID.
      familyName:       str(b.familyName, 120),
      familyRelation:   str(b.familyRelation, 60),
      familyPhone:      str(b.familyPhone, 20),
      familyAddress:    str(b.familyAddress, 300),
      familyIdUrl:      str(b.familyIdUrl, 500),
    };
    Object.keys(docs).forEach((k) => docs[k] === undefined && delete docs[k]);

    const updates = { documents: { ...(doc.data().documents || {}), ...docs } };
    if (b.cashPolicyAck === true) updates.cashPolicyAckAt = new Date().toISOString();

    // Mark KYC "submitted" once the core documents are present; admin verifies later.
    const merged = updates.documents;
    if (merged.dlUrl && merged.aadhaarUrl && merged.bikePhotoUrl && merged.familyIdUrl) {
      updates.kycStatus = doc.data().kycStatus === "verified" ? "verified" : "submitted";
    }

    // Only an admin may set a verification decision.
    if (req.user.role === "admin" && ["submitted", "verified", "rejected"].includes(b.kycStatus)) {
      updates.kycStatus = b.kycStatus;
    }

    await ref.update(updates);
    const updated = toRider(await ref.get());
    const io = req.app.get("io");
    if (io) io.to("admin").emit("rider:updated", updated);
    res.json(updated);
  } catch (err) {
    console.error("PATCH /riders/:id/documents:", err);
    res.status(500).json({ error: "Failed to save documents" });
  }
});

/* ── POST /api/riders/:id/settle ── rider deposits collected cash via Razorpay UPI ── */
router.post("/:id/settle", requireAuth, async (req, res) => {
  if (req.user.uid !== req.params.id) return res.status(403).json({ error: "Forbidden" });
  try {
    if (!razorpay.instance) return res.status(503).json({ error: "Online settlement is not configured" });
    const doc = await db.collection("riders").doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: "Rider not found" });
    const cash = Math.round(Number(doc.data().cashInHand || 0));
    let amount = Math.round(Number(req.body.amount) || cash);
    amount = Math.min(Math.max(1, amount), cash);
    if (amount < 1) return res.status(400).json({ error: "You have no cash to settle." });
    const rzp = await razorpay.instance.orders.create({
      amount: amount * 100, currency: "INR", receipt: "settle_" + Date.now(),
      notes: { type: "rider_settlement", riderId: req.params.id },
    });
    res.json({ razorpayOrderId: rzp.id, amount: rzp.amount, currency: rzp.currency, keyId: razorpay.keyId });
  } catch (err) {
    console.error("settle create:", err);
    res.status(500).json({ error: "Failed to start settlement" });
  }
});

/* ── POST /api/riders/:id/settle/verify ── confirm the deposit + clear cash ── */
router.post("/:id/settle/verify", requireAuth, async (req, res) => {
  if (req.user.uid !== req.params.id) return res.status(403).json({ error: "Forbidden" });
  try {
    const { razorpay_payment_id, razorpay_order_id, razorpay_signature, amount } = req.body;
    if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
      return res.status(400).json({ error: "Missing payment confirmation" });
    }
    if (razorpay.verifySignature && !razorpay.verifySignature(razorpay_order_id, razorpay_payment_id, razorpay_signature)) {
      return res.status(400).json({ error: "Payment verification failed" });
    }
    const ref = db.collection("riders").doc(req.params.id);
    const limit = await getCodLimit();
    await db.runTransaction(async (tx) => {
      const d = await tx.get(ref);
      const rd = d.data() || {};
      const paid = Math.min(Number(amount) || 0, rd.cashInHand || 0);
      const newCash = Math.max(0, (rd.cashInHand || 0) - paid);
      const upd = { cashInHand: newCash };
      if (newCash < limit) upd.cashOverLimitSince = null;
      tx.update(ref, upd);
    });
    await db.collection("settlements").add({
      riderId: req.params.id, amount: Number(amount) || 0, paymentId: razorpay_payment_id, at: new Date().toISOString(),
    });
    const rider = toRider(await ref.get());
    const io = req.app.get("io");
    if (io) io.to("rider:" + req.params.id).emit("rider:updated", rider);
    res.json(rider);
  } catch (err) {
    console.error("settle verify:", err);
    res.status(500).json({ error: "Failed to confirm settlement" });
  }
});

module.exports = router;
