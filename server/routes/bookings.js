/* =========================================================
 * Saardha — Services module: bookings engine
 * /api/bookings/...
 *
 * Phase 1 covers the Pickup & Drop pattern (laundry, tailoring,
 * xerox, courier, scrap). A booking has TWO Saradhi legs:
 *   Leg 1 (collect): rider goes to customer → brings item to shop
 *   Leg 2 (return):  rider takes finished item back to customer
 *
 * Flow:
 *   REQUESTED → ACCEPTED → RIDER_ASSIGNED → PICKED_FROM_CUSTOMER
 *             → AT_SHOP → READY → OUT_FOR_RETURN → RETURNED ✓
 *
 * Kept fully separate from product "orders": own collection,
 * own routes, own socket room (booking:<id>).
 * ========================================================= */
const express = require("express");
const { db } = require("../config/firebase");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

const B = {
  REQUESTED: "REQUESTED", ACCEPTED: "ACCEPTED", RIDER_ASSIGNED: "RIDER_ASSIGNED",
  PICKED_FROM_CUSTOMER: "PICKED_FROM_CUSTOMER", AT_SHOP: "AT_SHOP", READY: "READY",
  OUT_FOR_RETURN: "OUT_FOR_RETURN", RETURNED: "RETURNED", CANCELLED: "CANCELLED",
};

// Which "from → to" advances each role may perform (admin unrestricted).
// The service partner accepts, marks ready, and dispatches (via /assign).
// The Saradhi handles the physical legs only.
const RIDER_ADVANCE = {
  [B.RIDER_ASSIGNED]: B.PICKED_FROM_CUSTOMER,
  [B.PICKED_FROM_CUSTOMER]: B.AT_SHOP,
  [B.OUT_FOR_RETURN]: B.RETURNED,
};

// Hide the return OTP from every payload except the customer's own OTP lookup.
const toBooking = (doc) => { const { returnOtp, ...rest } = doc.data(); return { id: doc.id, ...rest }; };

function emitBooking(io, b) {
  if (!io) return;
  io.to(`serviceVendor:${b.serviceVendorId}`).emit("booking:updated", b);
  io.to(`customer:${b.customerId}`).emit("booking:updated", b);
  io.to("admin").emit("booking:updated", b);
  if (b.riderId) io.to(`rider:${b.riderId}`).emit("booking:updated", b);
}

async function resolveCustomer(uid) {
  const snap = await db.collection("customers").where("userId", "==", uid).limit(1).get();
  return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
}
async function ownsVendor(uid, serviceVendorId) {
  const doc = await db.collection("serviceVendors").doc(serviceVendorId).get();
  return doc.exists && doc.data().ownerUserId === uid;
}

/* ── GET /api/bookings ── role-scoped list ── */
router.get("/", requireAuth, async (req, res) => {
  try {
    let q = db.collection("bookings");
    if (req.user.role === "customer") {
      const cust = await resolveCustomer(req.user.uid);
      if (!cust) return res.json([]);
      q = q.where("customerId", "==", cust.id);
    } else if (req.user.role === "service") {
      const v = await db.collection("serviceVendors").where("ownerUserId", "==", req.user.uid).limit(1).get();
      if (v.empty) return res.json([]);
      q = q.where("serviceVendorId", "==", v.docs[0].id);
    } else if (req.user.role === "rider") {
      q = q.where("riderId", "==", req.user.uid);
    }
    const snap = await q.get();
    const rows = snap.docs.map(toBooking).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json(rows);
  } catch (err) { console.error("GET /bookings:", err); res.json([]); }
});

/* ── GET /api/bookings/:id ── */
router.get("/:id", requireAuth, async (req, res) => {
  try {
    const doc = await db.collection("bookings").doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: "Booking not found" });
    const b = doc.data();
    const { role, uid } = req.user;
    if (role === "customer") { const c = await resolveCustomer(uid); if (!c || b.customerId !== c.id) return res.status(403).json({ error: "Not your booking" }); }
    else if (role === "rider") { if (b.riderId !== uid) return res.status(403).json({ error: "Not your booking" }); }
    else if (role === "service") { if (!(await ownsVendor(uid, b.serviceVendorId))) return res.status(403).json({ error: "Not your booking" }); }
    res.json(toBooking(doc));
  } catch (err) { res.status(500).json({ error: "Failed to fetch booking" }); }
});

/* ── GET /api/bookings/:id/otp ── customer reads their return OTP ── */
router.get("/:id/otp", requireAuth, requireRole("customer"), async (req, res) => {
  try {
    const doc = await db.collection("bookings").doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: "Booking not found" });
    const b = doc.data();
    const cust = await resolveCustomer(req.user.uid);
    if (!cust || b.customerId !== cust.id) return res.status(403).json({ error: "Not your booking" });
    res.json({ otp: b.returnOtp || null, status: b.status });
  } catch (err) { res.status(500).json({ error: "Failed to fetch OTP" }); }
});

/* ── POST /api/bookings ── customer books a Pickup & Drop service ── */
router.post("/", requireAuth, requireRole("customer"), async (req, res) => {
  try {
    const { serviceVendorId, items } = req.body;
    if (!serviceVendorId || !Array.isArray(items) || !items.length) {
      return res.status(400).json({ error: "serviceVendorId and at least one service are required" });
    }
    const cust = await resolveCustomer(req.user.uid);
    if (!cust) return res.status(400).json({ error: "Customer profile not found" });

    const vDoc = await db.collection("serviceVendors").doc(serviceVendorId).get();
    if (!vDoc.exists) return res.status(404).json({ error: "Service business not found" });
    const vendor = vDoc.data();
    if (vendor.active === false || vendor.status === "inactive") return res.status(400).json({ error: "This business is currently closed" });

    // Resolve the chosen services server-side (never trust client prices)
    const resolved = [];
    let estTotal = 0;
    for (const line of items) {
      const sDoc = await db.collection("services").doc(line.serviceId).get();
      if (!sDoc.exists || sDoc.data().active === false) return res.status(400).json({ error: "A selected service is unavailable" });
      const s = sDoc.data();
      if (s.serviceVendorId !== serviceVendorId) return res.status(400).json({ error: "Service does not belong to this business" });
      const qty = Math.max(1, Math.floor(Number(line.qty) || 1));
      resolved.push({ serviceId: line.serviceId, name: s.name, priceType: s.priceType, price: s.price, unitLabel: s.unitLabel, qty });
      if (s.priceType === "fixed" || s.priceType === "from" || s.priceType === "per_unit") estTotal += (Number(s.price) || 0) * qty;
    }

    const now = new Date().toISOString();
    const ref = db.collection("bookings").doc();
    const booking = {
      id: ref.id,
      serviceVendorId,
      serviceVendorName: vendor.name,
      // Denormalised shop location so the Saradhi app can navigate to the shop
      // without loading the whole service-vendor catalogue.
      shopLat: vendor.lat != null ? Number(vendor.lat) : null,
      shopLng: vendor.lng != null ? Number(vendor.lng) : null,
      shopArea: vendor.area || "",
      customerId: cust.id,
      pattern: "pickup_drop",
      status: B.REQUESTED,
      items: resolved,
      estTotal,
      finalTotal: null,           // partner sets after inspection (e.g. by weight)
      deliveryFee: Number(vendor.deliveryFee) || 30, // two legs
      // Structured pickup/return address (defaults to profile)
      address: req.body.address || cust.address || "",
      addressName: req.body.addressName || cust.name || null,
      addressPhone: req.body.addressPhone || cust.phone || null,
      lat: req.body.lat != null ? Number(req.body.lat) : cust.lat,
      lng: req.body.lng != null ? Number(req.body.lng) : cust.lng,
      // Scheduling
      slot: req.body.slot || null,          // { date, window } or null = ASAP
      note: (req.body.note || "").slice(0, 300),
      // Payment
      paymentMethod: req.body.paymentMethod === "ONLINE" ? "ONLINE" : "COD",
      paymentStatus: "PENDING",
      // Legs
      riderId: null,
      returnOtp: String(Math.floor(1000 + Math.random() * 9000)),
      history: [{ status: B.REQUESTED, at: now }],
      createdAt: now, updatedAt: now,
    };
    await ref.set(booking);

    if (req.body.lat != null && req.body.lng != null) {
      db.collection("customers").doc(cust.id).update({ lat: Number(req.body.lat), lng: Number(req.body.lng), address: booking.address || cust.address || null }).catch(() => {});
    }

    const { returnOtp, ...safe } = booking;
    emitBooking(req.app.get("io"), safe);
    res.status(201).json(safe);
  } catch (err) { console.error("POST /bookings:", err); res.status(500).json({ error: "Failed to create booking" }); }
});

/* ── PATCH /api/bookings/:id/accept ── partner accepts a request ── */
router.patch("/:id/accept", requireAuth, requireRole("service", "admin"), async (req, res) => {
  try {
    const ref = db.collection("bookings").doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: "Booking not found" });
    const b = doc.data();
    if (req.user.role === "service" && !(await ownsVendor(req.user.uid, b.serviceVendorId))) return res.status(403).json({ error: "Not your booking" });
    if (b.status !== B.REQUESTED) return res.status(400).json({ error: "Only new requests can be accepted" });
    const now = new Date().toISOString();
    await ref.update({ status: B.ACCEPTED, updatedAt: now, history: [...(b.history || []), { status: B.ACCEPTED, at: now }] });
    const fresh = await ref.get();
    emitBooking(req.app.get("io"), toBooking(fresh));
    res.json(toBooking(fresh));
  } catch (err) { res.status(500).json({ error: "Failed to accept booking" }); }
});

/* ── PATCH /api/bookings/:id/reject ── partner or customer cancels ── */
router.patch("/:id/reject", requireAuth, async (req, res) => {
  try {
    const ref = db.collection("bookings").doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: "Booking not found" });
    const b = doc.data();
    const { role, uid } = req.user;
    if (role === "service" && !(await ownsVendor(uid, b.serviceVendorId))) return res.status(403).json({ error: "Not your booking" });
    if (role === "customer") { const c = await resolveCustomer(uid); if (!c || b.customerId !== c.id) return res.status(403).json({ error: "Not your booking" }); }
    if ([B.RETURNED, B.CANCELLED].includes(b.status)) return res.status(400).json({ error: "Booking already closed" });
    const now = new Date().toISOString();
    if (b.riderId) await db.collection("riders").doc(b.riderId).update({ status: "available" }).catch(() => {});
    await ref.update({ status: B.CANCELLED, updatedAt: now, history: [...(b.history || []), { status: B.CANCELLED, at: now, note: req.body.reason || null }] });
    const fresh = await ref.get();
    emitBooking(req.app.get("io"), toBooking(fresh));
    res.json(toBooking(fresh));
  } catch (err) { res.status(500).json({ error: "Failed to cancel booking" }); }
});

/* ── PATCH /api/bookings/:id/ready ── partner marks processed + sets final price ── */
router.patch("/:id/ready", requireAuth, requireRole("service", "admin"), async (req, res) => {
  try {
    const ref = db.collection("bookings").doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: "Booking not found" });
    const b = doc.data();
    if (req.user.role === "service" && !(await ownsVendor(req.user.uid, b.serviceVendorId))) return res.status(403).json({ error: "Not your booking" });
    if (b.status !== B.AT_SHOP) return res.status(400).json({ error: "Item must be at the shop before it can be marked ready" });
    const now = new Date().toISOString();
    const updates = { status: B.READY, updatedAt: now, history: [...(b.history || []), { status: B.READY, at: now }] };
    if (req.body.finalTotal != null) updates.finalTotal = Number(req.body.finalTotal);
    await ref.update(updates);
    const fresh = await ref.get();
    emitBooking(req.app.get("io"), toBooking(fresh));
    res.json(toBooking(fresh));
  } catch (err) { res.status(500).json({ error: "Failed to mark ready" }); }
});

/* ── POST /api/bookings/:id/auto-assign ── partner/admin dispatches nearest Saradhi ──
   Leg 1 from ACCEPTED → RIDER_ASSIGNED; Leg 2 from READY → OUT_FOR_RETURN. */
router.post("/:id/auto-assign", requireAuth, requireRole("service", "admin"), async (req, res) => {
  try {
    const ref = db.collection("bookings").doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: "Booking not found" });
    const b = doc.data();
    if (req.user.role === "service" && !(await ownsVendor(req.user.uid, b.serviceVendorId))) return res.status(403).json({ error: "Not your booking" });

    let nextStatus;
    if (b.status === B.ACCEPTED) nextStatus = B.RIDER_ASSIGNED;
    else if (b.status === B.READY) nextStatus = B.OUT_FOR_RETURN;
    else return res.status(400).json({ error: "Dispatch a rider after accepting (collect) or after marking ready (return)." });

    const ridersSnap = await db.collection("riders").where("status", "==", "available").get();
    if (ridersSnap.empty) return res.status(409).json({ error: "No Saradhi available right now. Try again shortly." });

    // Rank nearest to the pickup point of the current leg (customer for leg1, shop for leg2)
    const vDoc = await db.collection("serviceVendors").doc(b.serviceVendorId).get();
    const vendor = vDoc.exists ? vDoc.data() : {};
    const target = nextStatus === B.RIDER_ASSIGNED ? { lat: b.lat, lng: b.lng } : { lat: vendor.lat, lng: vendor.lng };
    const hav = (la1, lo1, la2, lo2) => {
      if (!la1 || !lo1 || !la2 || !lo2) return Infinity;
      const R = 6371, toR = (d) => d * Math.PI / 180;
      const dLa = toR(la2 - la1), dLo = toR(lo2 - lo1);
      const a = Math.sin(dLa / 2) ** 2 + Math.cos(toR(la1)) * Math.cos(toR(la2)) * Math.sin(dLo / 2) ** 2;
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    };
    const ranked = ridersSnap.docs.map((d) => ({ id: d.id, ...d.data(), dist: hav(d.data().lat, d.data().lng, target.lat, target.lng) })).sort((a, b) => a.dist - b.dist);
    const rider = ranked[0];
    const now = new Date().toISOString();

    if (b.riderId && b.riderId !== rider.id) await db.collection("riders").doc(b.riderId).update({ status: "available" }).catch(() => {});
    await db.collection("riders").doc(rider.id).update({ status: "on_delivery" });

    await ref.update({
      riderId: rider.id, status: nextStatus, updatedAt: now,
      history: [...(b.history || []), { status: nextStatus, at: now, note: (nextStatus === B.RIDER_ASSIGNED ? "Collect leg → " : "Return leg → ") + rider.name }],
    });
    const fresh = await ref.get();
    const updated = toBooking(fresh);
    emitBooking(req.app.get("io"), updated);
    const io = req.app.get("io");
    if (io) io.to(`rider:${rider.id}`).emit("booking:assigned", updated);
    res.json({ booking: updated, rider: { id: rider.id, name: rider.name, vehicle: rider.vehicle, dist: rider.dist } });
  } catch (err) { console.error("auto-assign booking:", err); res.status(500).json({ error: "Failed to dispatch rider" }); }
});

/* ── PATCH /api/bookings/:id/advance ── rider advances the physical legs ── */
router.patch("/:id/advance", requireAuth, requireRole("rider", "admin"), async (req, res) => {
  try {
    const ref = db.collection("bookings").doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: "Booking not found" });
    const b = doc.data();
    if (req.user.role === "rider" && b.riderId !== req.user.uid) return res.status(403).json({ error: "Not your booking" });

    const next = RIDER_ADVANCE[b.status];
    if (!next) return res.status(400).json({ error: "Nothing to advance from " + b.status });

    const now = new Date().toISOString();
    const updates = { status: next, updatedAt: now, history: [...(b.history || []), { status: next, at: now }] };

    // Final return step: verify the customer's OTP (+ collect COD cash).
    if (next === B.RETURNED) {
      if (req.user.role === "rider" && b.returnOtp) {
        const otp = String(req.body.otp || "").trim();
        if (otp !== b.returnOtp) return res.status(400).json({ error: "Incorrect OTP. Ask the customer for their 4-digit return code." });
      }
      if (b.paymentMethod === "COD") {
        const cash = Number(req.body.cashCollected);
        const due = b.finalTotal != null ? b.finalTotal : b.estTotal;
        if (!cash || cash <= 0) return res.status(400).json({ error: "Enter the cash collected from the customer." });
        updates.paymentStatus = "COLLECTED";
        updates.cashCollected = cash;
        // Fold into rider floating cash (same limit machinery as orders)
        const riderRef = db.collection("riders").doc(b.riderId);
        const rd = (await riderRef.get()).data() || {};
        const riderUpd = { status: "available", cashInHand: (rd.cashInHand || 0) + cash, deliveriesToday: (rd.deliveriesToday || 0) + 1 };
        await riderRef.update(riderUpd);
      } else {
        if (b.riderId) await db.collection("riders").doc(b.riderId).update({ status: "available" }).catch(() => {});
      }
    }
    // When the rider drops at the shop, free them for other work between legs.
    if (next === B.AT_SHOP && b.riderId) {
      await db.collection("riders").doc(b.riderId).update({ status: "available" }).catch(() => {});
    }

    await ref.update(updates);
    const fresh = await ref.get();
    emitBooking(req.app.get("io"), toBooking(fresh));
    res.json(toBooking(fresh));
  } catch (err) { console.error("advance booking:", err); res.status(500).json({ error: "Failed to advance booking" }); }
});

/* ── POST /api/bookings/:id/rating ── customer rates a returned booking ── */
router.post("/:id/rating", requireAuth, requireRole("customer"), async (req, res) => {
  try {
    const sr = Number(req.body.storeRating);
    if (!sr || sr < 1 || sr > 5) return res.status(400).json({ error: "Rating must be 1–5" });
    const ref = db.collection("bookings").doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: "Booking not found" });
    const b = doc.data();
    const cust = await resolveCustomer(req.user.uid);
    if (!cust || b.customerId !== cust.id) return res.status(403).json({ error: "Not your booking" });
    if (b.status !== B.RETURNED) return res.status(400).json({ error: "You can only rate completed bookings" });
    if (b.rating) return res.status(400).json({ error: "Already rated" });
    const now = new Date().toISOString();
    await ref.update({ rating: { store: sr, rider: req.body.riderRating != null ? Number(req.body.riderRating) : null, comment: (req.body.comment || "").slice(0, 500), at: now }, updatedAt: now });
    const vRef = db.collection("serviceVendors").doc(b.serviceVendorId);
    await db.runTransaction(async (tx) => {
      const v = await tx.get(vRef); if (!v.exists) return;
      const d = v.data(); const count = (d.ratingCount || 0) + 1;
      const sum = (d.ratingSum != null ? d.ratingSum : (d.rating || 0) * (d.ratingCount || 0)) + sr;
      tx.update(vRef, { ratingCount: count, ratingSum: sum, rating: Math.round((sum / count) * 10) / 10 });
    });
    const fresh = await ref.get();
    emitBooking(req.app.get("io"), toBooking(fresh));
    res.json(toBooking(fresh));
  } catch (err) { res.status(500).json({ error: "Failed to submit rating" }); }
});

module.exports = router;
module.exports.BOOKING_STATUS = B;
