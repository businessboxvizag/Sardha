const express = require("express");
const { db } = require("../config/firebase");
const { requireAuth, requireRole } = require("../middleware/auth");
const { verifySignature, instance: razorpayInstance } = require("../config/razorpay");
const { notifyPartner } = require("../lib/webhooks");

const router = express.Router();

const STATUS_FLOW = [
  "PLACED", "ACCEPTED", "ASSIGNED", "PICKED_UP", "OUT_FOR_DELIVERY", "DELIVERED",
];

// State machine: defines which transitions are legal and who may perform them
// role → allowed [from → to] pairs
const ALLOWED_TRANSITIONS = {
  customer:  { PLACED: ["CANCELLED"] },
  merchant:  { PLACED: ["ACCEPTED", "CANCELLED"], ACCEPTED: ["CANCELLED"] },
  rider:     { ASSIGNED: ["PICKED_UP"], PICKED_UP: ["OUT_FOR_DELIVERY"], OUT_FOR_DELIVERY: ["DELIVERED"] },
  // admin can do any sequential advance or cancel
};

function canTransition(role, fromStatus, toStatus) {
  if (role === "admin") return true;
  const allowed = ALLOWED_TRANSITIONS[role];
  if (!allowed) return false;
  return (allowed[fromStatus] || []).includes(toStatus);
}

// Never expose the delivery OTP inside order payloads — the rider must get it
// from the customer verbally. The customer reads theirs via GET /:id/otp.
const toOrder = (doc) => { const { deliveryOtp, ...rest } = doc.data(); return { id: doc.id, ...rest }; };

// COD cash-in-hand limit (admin-configurable in settings; default ₹2000)
async function getCodLimit() {
  try { const s = await db.collection("settings").doc("global").get(); const d = s.exists ? s.data() : {}; return Number(d.codCashLimit) || 2000; }
  catch (e) { return 2000; }
}

function emitOrderUpdate(io, order) {
  if (!io) return;
  io.to(`vendor:${order.vendorId}`).emit("order:updated", order);
  io.to(`customer:${order.customerId}`).emit("order:updated", order);
  io.to("admin").emit("order:updated", order);
  if (order.riderId) io.to(`rider:${order.riderId}`).emit("order:updated", order);
}

/* ââ GET /api/orders ââââââââââââââââââââââââââââââââââââââââââ */
router.get("/", requireAuth, async (req, res) => {
  try {
    let query = db.collection("orders");

    if (req.user.role === "customer") {
      // customers only see their own orders
      const custSnap = await db
        .collection("customers")
        .where("userId", "==", req.user.uid)
        .limit(1)
        .get();
      if (custSnap.empty) return res.json([]);
      query = query.where("customerId", "==", custSnap.docs[0].id);
    } else if (req.user.role === "merchant") {
      // Merchants only see orders belonging to THEIR vendor (derived from JWT, never client-supplied)
      const vendorSnap = await db.collection("vendors").where("merchantId", "==", req.user.uid).limit(1).get();
      if (vendorSnap.empty) return res.json([]);
      query = query.where("vendorId", "==", vendorSnap.docs[0].id);
    } else if (req.user.role === "rider") {
      // riders only see orders assigned to them
      query = query.where("riderId", "==", req.user.uid);
    }

    // Optional filters
    if (req.query.status) query = query.where("status", "==", req.query.status);

    const snap = await query.get();
    const orders = snap.docs.map(toOrder).sort((a, b) =>
      new Date(b.createdAt) - new Date(a.createdAt)
    );
    res.json(orders);
  } catch (err) {
    console.error("GET /orders:", err);
    res.status(500).json({ error: "Failed to fetch orders" });
  }
});

/* ââ GET /api/orders/:id ââââââââââââââââââââââââââââââââââââââ */
router.get("/:id", requireAuth, async (req, res) => {
  try {
    const doc = await db.collection("orders").doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: "Order not found" });

    const order = doc.data();
    const { role, uid } = req.user;

    // Ownership gate
    if (role === "customer") {
      const custSnap = await db.collection("customers").where("userId", "==", uid).limit(1).get();
      const custId = custSnap.empty ? null : custSnap.docs[0].id;
      if (order.customerId !== custId) return res.status(403).json({ error: "Not your order" });
    } else if (role === "rider") {
      if (order.riderId !== uid) return res.status(403).json({ error: "Not your assigned order" });
    } else if (role === "merchant") {
      const vendorSnap = await db.collection("vendors").where("merchantId", "==", uid).limit(1).get();
      const vendorId = vendorSnap.empty ? null : vendorSnap.docs[0].id;
      if (order.vendorId !== vendorId) return res.status(403).json({ error: "Not your vendor\'s order" });
    }
    // admin: no restriction

    res.json(toOrder(doc));
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch order" });
  }
});

/* ââ POST /api/orders  (customer places order) ââââââââââââââââ */
router.post("/", requireAuth, requireRole("customer"), async (req, res) => {
  try {
    const { vendorId, items, paymentMethod,
            razorpay_payment_id, razorpay_order_id, razorpay_signature } = req.body;
    // Payment method: COD (cash collected on delivery) or ONLINE (paid via Razorpay).
    // ONLINE orders stay paymentStatus PENDING until the gateway confirms (Stage B).
    const pm = paymentMethod === "ONLINE" ? "ONLINE" : "COD";
    if (!vendorId || !Array.isArray(items) || !items.length) {
      return res.status(400).json({ error: "vendorId and items required" });
    }

    // Resolve customer profile
    const custSnap = await db
      .collection("customers")
      .where("userId", "==", req.user.uid)
      .limit(1)
      .get();
    if (custSnap.empty) return res.status(400).json({ error: "Customer profile not found" });
    const customer = { id: custSnap.docs[0].id, ...custSnap.docs[0].data() };

    // Validate vendor — must exist and be active (#15)
    const vendorDoc = await db.collection("vendors").doc(vendorId).get();
    if (!vendorDoc.exists) return res.status(404).json({ error: "Vendor not found" });
    const vendor = vendorDoc.data();
    if (vendor.active === false || vendor.status === "inactive") {
      return res.status(400).json({ error: "This store is currently closed" });
    }

    // Don't accept an order we can't deliver — require at least one available Saradhi (#10).
    // Online orders are pre-checked before payment, so we never reject an already-paid order here.
    if (pm !== "ONLINE") {
      const availSnap = await db.collection("riders").where("status", "==", "available").limit(1).get();
      if (availSnap.empty) {
        return res.status(409).json({ error: "No Saradhi is available right now. Please try again in a few minutes." });
      }
    }

    // SERVER-SIDE PRICING (#3) — never trust prices from the client
    // Items must contain { productId, qty } only; price is read from Firestore
    const resolvedItems = [];
    let subtotal = 0;
    for (const line of items) {
      const { productId, qty } = line;
      if (!productId || !qty || Number(qty) < 1) {
        return res.status(400).json({ error: "Each item needs productId and qty >= 1" });
      }
      const prodDoc = await db.collection("products").doc(productId).get();
      if (!prodDoc.exists || prodDoc.data().available === false) {
        return res.status(400).json({ error: `Product ${productId} is unavailable` });
      }
      const prod = prodDoc.data();
      if (prod.vendorId !== vendorId) {
        return res.status(400).json({ error: `Product ${productId} does not belong to this vendor` });
      }
      const lineQty = Math.floor(Number(qty));
      const lineTotal = prod.price * lineQty;
      resolvedItems.push({ productId, name: prod.name, price: prod.price, qty: lineQty, lineTotal });
      subtotal += lineTotal;
    }

    const settingsDoc = await db.collection("settings").doc("global").get();
    const deliveryFee = settingsDoc.exists ? (settingsDoc.data().deliveryFee ?? 15) : 15;
    const gst = Math.round(subtotal * 0.18); // 18% GST on items

    // Online payment: authenticate the Razorpay callback BEFORE creating the order.
    let paymentStatus = "PENDING";
    if (pm === "ONLINE") {
      if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
        return res.status(400).json({ error: "Missing payment confirmation" });
      }
      if (!verifySignature(razorpay_order_id, razorpay_payment_id, razorpay_signature)) {
        return res.status(400).json({ error: "Payment verification failed" });
      }
      // Confirm the amount actually paid matches this order's server-side total
      // (stops a client paying for a cheap cart then submitting an expensive one).
      try {
        const rzpOrder = await razorpayInstance.orders.fetch(razorpay_order_id);
        if (Number(rzpOrder.amount) !== (subtotal + deliveryFee) * 100) {
          return res.status(400).json({ error: "Payment amount mismatch" });
        }
      } catch (e) {
        return res.status(400).json({ error: "Could not verify payment amount" });
      }
      paymentStatus = "PAID";
    }
    const now = new Date().toISOString();

    const ref = db.collection("orders").doc();
    const order = {
      id: ref.id,
      customerId: customer.id,
      vendorId,
      riderId: null,
      status: "PLACED",
      items: resolvedItems,
      subtotal,
      gst,
      deliveryFee,
      total: subtotal + gst + deliveryFee,
      paymentMethod: pm,
      paymentStatus, // COD -> PENDING then COLLECTED on delivery; ONLINE -> PAID here
      razorpayOrderId: pm === "ONLINE" ? razorpay_order_id : null,
      razorpayPaymentId: pm === "ONLINE" ? razorpay_payment_id : null,
      // Prefer a fresh delivery location sent at checkout; fall back to the saved profile.
      deliverTo: req.body.deliverTo || customer.address,
      deliverLat: req.body.deliverLat != null ? Number(req.body.deliverLat) : customer.lat,
      deliverLng: req.body.deliverLng != null ? Number(req.body.deliverLng) : customer.lng,
      dropPhone: req.body.deliverPhone || customer.phone || null,
      dropName: req.body.deliverName || customer.name || null,
      // Delivery OTP is issued at order time so the customer sees it from the start.
      deliveryOtp: String(Math.floor(1000 + Math.random() * 9000)),
      history: [{ status: "PLACED", at: now }],
      createdAt: now,
      updatedAt: now,
    };

    await ref.set(order);

    // Persist a fresh delivery location to the customer's profile for next time.
    if (req.body.deliverLat != null && req.body.deliverLng != null) {
      db.collection("customers").doc(customer.id).update({
        lat: Number(req.body.deliverLat), lng: Number(req.body.deliverLng),
        address: req.body.deliverTo || customer.address || null,
      }).catch(() => {});
    }

    // Order stays PLACED in the merchant's New queue until they accept it,
    // at which point they dispatch the nearest available Saradhi.

    // Emit via Socket.io (io attached to router by index.js)
    emitOrderUpdate(req.app.get("io"), order);

    res.status(201).json(order);
  } catch (err) {
    console.error("POST /orders:", err);
    res.status(500).json({ error: "Failed to place order" });
  }
});

/* ââ PATCH /api/orders/:id/status âââââââââââââââââââââââââââââ */
router.patch("/:id/status", requireAuth, async (req, res) => {
  try {
    const { status } = req.body;
    if (!status) return res.status(400).json({ error: "status required" });

    const validStatuses = [...STATUS_FLOW, "CANCELLED"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    const ref = db.collection("orders").doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: "Order not found" });

    const order = doc.data();
    const { role, uid } = req.user;

    // Ownership check — only the relevant party may change status
    if (role === "customer") {
      const custSnap = await db.collection("customers").where("userId", "==", uid).limit(1).get();
      const custId = custSnap.empty ? null : custSnap.docs[0].id;
      if (order.customerId !== custId) return res.status(403).json({ error: "Not your order" });
      if (status !== "CANCELLED") return res.status(403).json({ error: "Customers may only cancel orders" });
    } else if (role === "rider") {
      if (order.riderId !== uid) return res.status(403).json({ error: "Not your assigned order" });
    } else if (role === "merchant") {
      const vendorSnap = await db.collection("vendors").where("userId", "==", uid).limit(1).get();
      const vendorId = vendorSnap.empty ? null : vendorSnap.docs[0].id;
      if (order.vendorId !== vendorId) return res.status(403).json({ error: "Not your vendor\'s order" });
    }
    // admin: unrestricted

    // State machine validation (#11)
    if (!canTransition(role, order.status, status)) {
      return res.status(400).json({
        error: `Transition ${order.status} → ${status} is not allowed for role '${role}'`,
      });
    }

    const now = new Date().toISOString();

    const updates = {
      status,
      updatedAt: now,
      history: [...(order.history || []), { status, at: now }],
    };

    // Cash-on-delivery: mark the money collected once the rider delivers.
    if (status === "DELIVERED" && order.paymentMethod === "COD") {
      updates.paymentStatus = "COLLECTED";
    }

    // Free the rider when order completes or is cancelled
    if (status === "DELIVERED" || status === "CANCELLED") {
      if (order.riderId) {
        const riderRef = db.collection("riders").doc(order.riderId);
        const riderUpdates = { status: "available" };
        if (status === "DELIVERED") {
          const riderDoc = await riderRef.get();
          riderUpdates.deliveriesToday = (riderDoc.data().deliveriesToday || 0) + 1;
        }
        await riderRef.update(riderUpdates);
      }
    }

    await ref.update(updates);
    const updated = await ref.get();
    const updatedOrder = toOrder(updated);

    emitOrderUpdate(req.app.get("io"), updatedOrder);
    notifyPartner(updatedOrder, updatedOrder.status);
    res.json(updatedOrder);
  } catch (err) {
    console.error("PATCH /orders/:id/status:", err);
    res.status(500).json({ error: "Failed to update order status" });
  }
});

/* ââ PATCH /api/orders/:id/advance âââââââââââââââââââââââââââ */
router.patch("/:id/advance", requireAuth, async (req, res) => {
  try {
    const ref = db.collection("orders").doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: "Order not found" });

    const order = doc.data();
    const { role, uid } = req.user;

    // Ownership check for advance — customers cannot advance status
    if (role === "customer") {
      return res.status(403).json({ error: "Customers cannot advance order status" });
    } else if (role === "rider") {
      if (order.riderId !== uid) return res.status(403).json({ error: "Not your assigned order" });
    } else if (role === "merchant") {
      const vendorSnap = await db.collection("vendors").where("userId", "==", uid).limit(1).get();
      const vendorId = vendorSnap.empty ? null : vendorSnap.docs[0].id;
      if (order.vendorId !== vendorId) return res.status(403).json({ error: "Not your vendor\'s order" });
    }
    // admin: unrestricted

    const i = STATUS_FLOW.indexOf(order.status);
    if (i < 0 || i >= STATUS_FLOW.length - 1) {
      return res.status(400).json({ error: "Cannot advance from current status" });
    }

    const nextStatus = STATUS_FLOW[i + 1];
    const now = new Date().toISOString();
    const updates = {
      status: nextStatus,
      updatedAt: now,
      history: [...(order.history || []), { status: nextStatus, at: now }],
    };

    // Fallback: issue an OTP if one wasn't set at order time (older orders / non-partner).
    if (nextStatus === "OUT_FOR_DELIVERY" && order.source !== "partner" && !order.deliveryOtp) {
      updates.deliveryOtp = String(Math.floor(1000 + Math.random() * 9000));
    }

    if (nextStatus === "DELIVERED") {
      // Drop-off OTP verification — only when an OTP was issued (non-partner orders).
      if (role === "rider" && order.deliveryOtp) {
        const otp = String(req.body.otp || "").trim();
        if (otp !== order.deliveryOtp) {
          return res.status(400).json({ error: "Incorrect delivery OTP. Ask the customer for their 4-digit code." });
        }
      }
      // Cash on delivery — record the collected cash into the rider's floating balance.
      let cash = 0;
      if (order.paymentMethod === "COD") {
        cash = Number(req.body.cashCollected);
        if (!cash || cash <= 0) return res.status(400).json({ error: "Enter the cash amount collected from the customer." });
        updates.paymentStatus = "COLLECTED";
        updates.cashCollected = cash;
      }
      if (order.riderId) {
        const riderRef = db.collection("riders").doc(order.riderId);
        const rd = (await riderRef.get()).data() || {};
        const riderUpd = { status: "available", deliveriesToday: (rd.deliveriesToday || 0) + 1 };
        if (order.paymentMethod === "COD") {
          const limit = await getCodLimit();
          const newCash = (rd.cashInHand || 0) + cash;
          riderUpd.cashInHand = newCash;
          if (newCash >= limit && !rd.cashOverLimitSince) riderUpd.cashOverLimitSince = now;
        }
        await riderRef.update(riderUpd);
      }
    }

    await ref.update(updates);
    const updated = await ref.get();
    const updatedOrder = toOrder(updated);

    emitOrderUpdate(req.app.get("io"), updatedOrder);
    notifyPartner(updatedOrder, updatedOrder.status);
    res.json(updatedOrder);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to advance order" });
  }
});

/* ââ PATCH /api/orders/:id/assign âââââââââââââââââââââââââââââ
   Assign or reassign a rider to an order (merchant / admin)     */
router.get("/:id/otp", requireAuth, requireRole("customer"), async (req, res) => {
  try {
    const doc = await db.collection("orders").doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: "Order not found" });
    const order = doc.data();
    const custSnap = await db.collection("customers").where("userId", "==", req.user.uid).limit(1).get();
    const custId = custSnap.empty ? null : custSnap.docs[0].id;
    if (order.customerId !== custId) return res.status(403).json({ error: "Not your order" });
    res.json({ otp: order.deliveryOtp || null, status: order.status });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch delivery OTP" });
  }
});

router.patch("/:id/assign", requireAuth, requireRole("merchant", "admin"), async (req, res) => {
  try {
    const { riderId } = req.body;
    if (!riderId) return res.status(400).json({ error: "riderId required" });

    const [orderDoc, riderDoc] = await Promise.all([
      db.collection("orders").doc(req.params.id).get(),
      db.collection("riders").doc(riderId).get(),
    ]);

    if (!orderDoc.exists) return res.status(404).json({ error: "Order not found" });
    if (!riderDoc.exists) return res.status(404).json({ error: "Rider not found" });

    const order = orderDoc.data();
    const now = new Date().toISOString();

    // Free the previously assigned rider (if any)
    if (order.riderId && order.riderId !== riderId) {
      await db.collection("riders").doc(order.riderId).update({ status: "available" });
    }

    await db.collection("riders").doc(riderId).update({ status: "on_delivery" });

    const newStatus = ["PLACED", "ACCEPTED"].includes(order.status) ? "ASSIGNED" : order.status;
    const updates = {
      riderId,
      status: newStatus,
      updatedAt: now,
      history: [
        ...(order.history || []),
        { status: "ASSIGNED", at: now, note: "Assigned to " + riderDoc.data().name },
      ],
    };

    await db.collection("orders").doc(req.params.id).update(updates);
    const updated = await db.collection("orders").doc(req.params.id).get();
    const updatedOrder = toOrder(updated);

    emitOrderUpdate(req.app.get("io"), updatedOrder);
    notifyPartner(updatedOrder, updatedOrder.status);
    res.json(updatedOrder);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to assign rider" });
  }
});

/* ââ POST /api/orders/:id/auto-assign âââââââââââââââââââââââââ
   Auto-pick the nearest available fleet rider (merchant / admin) */
router.post("/:id/auto-assign", requireAuth, requireRole("merchant", "admin"), async (req, res) => {
  try {
    const orderDoc = await db.collection("orders").doc(req.params.id).get();
    if (!orderDoc.exists) return res.status(404).json({ error: "Order not found" });
    const order = orderDoc.data();

    // Get vendor location so we can rank by proximity
    const vendorDoc = await db.collection("vendors").doc(order.vendorId).get();
    const vendor = vendorDoc.exists ? vendorDoc.data() : null;
    const vLat = vendor?.lat || 0;
    const vLng = vendor?.lng || 0;

    // Fetch all available riders from the shared fleet
    const ridersSnap = await db.collection("riders").where("status", "==", "available").get();
    if (ridersSnap.empty) {
      return res.status(409).json({ error: "No available riders right now. Try again shortly." });
    }

    // Rank by distance to vendor (haversine)
    function haversine(la1, lo1, la2, lo2) {
      if (!la1 || !lo1 || !la2 || !lo2) return Infinity;
      const R = 6371, toR = (d) => (d * Math.PI) / 180;
      const dLa = toR(la2 - la1), dLo = toR(lo2 - lo1);
      const a = Math.sin(dLa / 2) ** 2 + Math.cos(toR(la1)) * Math.cos(toR(la2)) * Math.sin(dLo / 2) ** 2;
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    const ranked = ridersSnap.docs
      .map((d) => ({ id: d.id, ...d.data(), dist: haversine(d.data().lat, d.data().lng, vLat, vLng) }))
      .sort((a, b) => a.dist - b.dist);

    const rider = ranked[0];
    const now = new Date().toISOString();

    // Free any previously assigned rider
    if (order.riderId && order.riderId !== rider.id) {
      await db.collection("riders").doc(order.riderId).update({ status: "available" });
    }

    await db.collection("riders").doc(rider.id).update({ status: "on_delivery" });

    const newStatus = ["PLACED", "ACCEPTED"].includes(order.status) ? "ASSIGNED" : order.status;
    const updates = {
      riderId: rider.id,
      status: newStatus,
      updatedAt: now,
      history: [
        ...(order.history || []),
        { status: "ASSIGNED", at: now, note: "Auto-assigned to " + rider.name },
      ],
    };

    await db.collection("orders").doc(req.params.id).update(updates);
    const updated = await db.collection("orders").doc(req.params.id).get();
    const updatedOrder = toOrder(updated);

    emitOrderUpdate(req.app.get("io"), updatedOrder);
    notifyPartner(updatedOrder, updatedOrder.status);

    // Also notify rider's room
    const io = req.app.get("io");
    if (io) io.to(`rider:${rider.id}`).emit("order:assigned", updatedOrder);

    res.json({ order: updatedOrder, rider: { id: rider.id, name: rider.name, vehicle: rider.vehicle, dist: rider.dist } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to auto-assign rider" });
  }
});

/* ── POST /api/orders/:id/rating ── customer rates a delivered order ── */
router.post("/:id/rating", requireAuth, requireRole("customer"), async (req, res) => {
  try {
    const sr = Number(req.body.storeRating);
    if (!sr || sr < 1 || sr > 5) return res.status(400).json({ error: "storeRating must be 1–5" });
    const rr = req.body.riderRating != null && req.body.riderRating !== "" ? Number(req.body.riderRating) : null;
    if (rr != null && (rr < 1 || rr > 5)) return res.status(400).json({ error: "riderRating must be 1–5" });

    const ref = db.collection("orders").doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: "Order not found" });
    const order = doc.data();

    // Ownership: order must belong to the requesting customer
    const custSnap = await db.collection("customers").where("userId", "==", req.user.uid).limit(1).get();
    const custId = custSnap.empty ? null : custSnap.docs[0].id;
    if (order.customerId !== custId) return res.status(403).json({ error: "Not your order" });
    if (order.status !== "DELIVERED") return res.status(400).json({ error: "You can only rate delivered orders" });
    if (order.rating) return res.status(400).json({ error: "This order has already been rated" });

    const now = new Date().toISOString();
    await ref.update({
      rating: { store: sr, rider: rr, comment: (req.body.comment || "").slice(0, 500), at: now },
      updatedAt: now,
    });

    // Update the vendor's average rating
    const vendorRef = db.collection("vendors").doc(order.vendorId);
    await db.runTransaction(async (tx) => {
      const v = await tx.get(vendorRef);
      if (!v.exists) return;
      const d = v.data();
      const count = (d.ratingCount || 0) + 1;
      const sum = (d.ratingSum != null ? d.ratingSum : (d.rating || 0) * (d.ratingCount || 0)) + sr;
      tx.update(vendorRef, { ratingCount: count, ratingSum: sum, rating: Math.round((sum / count) * 10) / 10 });
    });

    // Update the rider's average rating
    if (rr != null && order.riderId) {
      const riderRef = db.collection("riders").doc(order.riderId);
      await db.runTransaction(async (tx) => {
        const r = await tx.get(riderRef);
        if (!r.exists) return;
        const d = r.data();
        const count = (d.ratingCount || 0) + 1;
        const sum = (d.ratingSum != null ? d.ratingSum : (d.rating || 0) * (d.ratingCount || 0)) + rr;
        tx.update(riderRef, { ratingCount: count, ratingSum: sum, rating: Math.round((sum / count) * 10) / 10 });
      });
    }

    const updated = await ref.get();
    emitOrderUpdate(req.app.get("io"), toOrder(updated));
    res.json(toOrder(updated));
  } catch (err) {
    console.error("POST /orders/:id/rating:", err);
    res.status(500).json({ error: "Failed to submit rating" });
  }
});

module.exports = router;
