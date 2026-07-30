/**
 * Partner Delivery API (Delivery-as-a-Service).
 * Any approved business authenticates with its API key and can request deliveries.
 *   POST /api/partner/quote        → distance-based fee quote
 *   POST /api/partner/deliveries   → create a delivery job (enters the rider fleet)
 *   GET  /api/partner/deliveries/:id → delivery status
 *
 * Deliveries live in the shared `orders` collection (source: "partner") so the
 * existing dispatch, rider app, tracking, OTP and COD-cash flow all just work.
 */
const express = require("express");
const { db } = require("../config/firebase");
const { requirePartner } = require("../middleware/partnerAuth");

const router = express.Router();

function haversineKm(la1, lo1, la2, lo2) {
  if (la1 == null || lo1 == null || la2 == null || lo2 == null) return null;
  const R = 6371, toR = (d) => (d * Math.PI) / 180;
  const dLa = toR(la2 - la1), dLo = toR(lo2 - lo1);
  const a = Math.sin(dLa / 2) ** 2 + Math.cos(toR(la1)) * Math.cos(toR(la2)) * Math.sin(dLo / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Distance-based fee: max(min, base + perKm * distance) — configured per partner.
function quoteFee(partner, km) {
  const base = Number(partner.priceBase != null ? partner.priceBase : 20);
  const perKm = Number(partner.pricePerKm != null ? partner.pricePerKm : 8);
  const min = Number(partner.priceMin != null ? partner.priceMin : 25);
  return Math.max(min, Math.round(base + perKm * (km || 0)));
}

/* ── POST /api/partner/quote ──────────────────────────────── */
router.post("/quote", requirePartner, async (req, res) => {
  const { pickup, drop } = req.body || {};
  if (!pickup || !drop || pickup.lat == null || drop.lat == null) {
    return res.status(400).json({ error: "pickup and drop coordinates are required" });
  }
  const km = haversineKm(Number(pickup.lat), Number(pickup.lng), Number(drop.lat), Number(drop.lng));
  res.json({ distanceKm: km != null ? Math.round(km * 10) / 10 : null, fee: quoteFee(req.partner, km || 0), currency: "INR" });
});

/* ── POST /api/partner/deliveries ─────────────────────────── */
router.post("/deliveries", requirePartner, async (req, res) => {
  try {
    const b = req.body || {};
    const { pickup, drop } = b;
    if (!pickup || pickup.lat == null || !drop || drop.lat == null) {
      return res.status(400).json({ error: "pickup and drop with coordinates are required" });
    }
    const km = haversineKm(Number(pickup.lat), Number(pickup.lng), Number(drop.lat), Number(drop.lng));
    const fee = quoteFee(req.partner, km || 0);
    const paymentType = b.paymentType === "COD" ? "COD" : "PREPAID";
    const now = new Date().toISOString();

    const ref = db.collection("orders").doc();
    const order = {
      source: "partner",
      partnerId: req.partner.id,
      partnerName: req.partner.name,
      reference: b.reference || null,
      pickup: { name: pickup.name || req.partner.name, phone: pickup.phone || null, address: pickup.address || "", lat: Number(pickup.lat), lng: Number(pickup.lng) },
      deliverTo: drop.address || "",
      deliverLat: Number(drop.lat), deliverLng: Number(drop.lng),
      dropName: drop.name || "", dropPhone: drop.phone || null,
      itemsText: (b.items || "").toString().slice(0, 300),
      orderValue: Number(b.orderValue) || 0,
      paymentType,
      paymentMethod: paymentType === "COD" ? "COD" : "ONLINE",
      paymentStatus: paymentType === "COD" ? "PENDING" : "PAID",
      deliveryFee: fee,
      distanceKm: km != null ? Math.round(km * 10) / 10 : null,
      total: Number(b.orderValue) || 0,
      status: "ACCEPTED",
      customerId: null, vendorId: null,
      createdAt: now, updatedAt: now,
      history: [{ status: "ACCEPTED", at: now, note: "Partner delivery created" }],
    };
    await ref.set(order);

    // Auto-assign the nearest available rider to the pickup point.
    let assignedName = null, assignedId = null;
    try {
      const ridersSnap = await db.collection("riders").where("status", "==", "available").get();
      const ranked = ridersSnap.docs
        .map((d) => { const r = d.data(); return { id: d.id, name: r.name, dist: haversineKm(r.lat, r.lng, order.pickup.lat, order.pickup.lng) ?? Infinity }; })
        .sort((a, b) => a.dist - b.dist);
      if (ranked.length) {
        assignedId = ranked[0].id; assignedName = ranked[0].name;
        await db.collection("riders").doc(assignedId).update({ status: "on_delivery" });
        await ref.update({
          riderId: assignedId, status: "ASSIGNED", updatedAt: now,
          history: [...order.history, { status: "ASSIGNED", at: now, note: "Auto-assigned to " + assignedName }],
        });
      }
    } catch (e) { /* leave ACCEPTED for manual dispatch if assignment fails */ }

    const io = req.app.get("io");
    if (io) {
      if (assignedId) io.to("rider:" + assignedId).emit("order:assigned", { id: ref.id });
      io.to("admin").emit("order:updated", { id: ref.id });
    }

    const trackingUrl = (process.env.FRONTEND_URL || "") + "/track/?d=" + ref.id;
    res.status(201).json({
      deliveryId: ref.id,
      status: assignedId ? "ASSIGNED" : "ACCEPTED",
      rider: assignedName,
      fee, distanceKm: order.distanceKm, currency: "INR",
      trackingUrl,
    });
  } catch (err) {
    console.error("partner create delivery:", err);
    res.status(500).json({ error: "Failed to create delivery" });
  }
});

/* ── GET /api/partner/deliveries/:id ──────────────────────── */
router.get("/deliveries/:id", requirePartner, async (req, res) => {
  try {
    const doc = await db.collection("orders").doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: "Delivery not found" });
    const o = doc.data();
    if (o.partnerId !== req.partner.id) return res.status(403).json({ error: "Not your delivery" });
    res.json({
      deliveryId: doc.id,
      reference: o.reference || null,
      status: o.status,
      fee: o.deliveryFee != null ? o.deliveryFee : null,
      distanceKm: o.distanceKm != null ? o.distanceKm : null,
      paymentType: o.paymentType || (o.paymentMethod === "COD" ? "COD" : "PREPAID"),
      riderAssigned: !!o.riderId,
      cashCollected: o.cashCollected != null ? o.cashCollected : null,
      deliveredAt: o.status === "DELIVERED" ? o.updatedAt : null,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch delivery" });
  }
});

module.exports = router;
