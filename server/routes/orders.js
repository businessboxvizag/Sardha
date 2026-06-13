const express = require("express");
const { db } = require("../config/firebase");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

const STATUS_FLOW = [
  "PLACED", "ACCEPTED", "ASSIGNED", "PICKED_UP", "OUT_FOR_DELIVERY", "DELIVERED",
];

const toOrder = (doc) => ({ id: doc.id, ...doc.data() });

function emitOrderUpdate(io, order) {
  if (!io) return;
  // Broadcast to vendor room, customer room, and admin room
  io.to(`vendor:${order.vendorId}`).emit("order:updated", order);
  io.to(`customer:${order.customerId}`).emit("order:updated", order);
  io.to("admin").emit("order:updated", order);
}

/* ── GET /api/orders ────────────────────────────────────────── */
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
      // merchants see orders for their vendor(s)
      const vendorId = req.query.vendorId;
      if (vendorId) query = query.where("vendorId", "==", vendorId);
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

/* ── GET /api/orders/:id ────────────────────────────────────── */
router.get("/:id", requireAuth, async (req, res) => {
  try {
    const doc = await db.collection("orders").doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: "Order not found" });
    res.json(toOrder(doc));
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch order" });
  }
});

/* ── POST /api/orders  (customer places order) ──────────────── */
router.post("/", requireAuth, requireRole("customer"), async (req, res) => {
  try {
    const { vendorId, items } = req.body;
    if (!vendorId || !items || !items.length) {
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

    // Validate vendor
    const vendorDoc = await db.collection("vendors").doc(vendorId).get();
    if (!vendorDoc.exists) return res.status(404).json({ error: "Vendor not found" });

    const subtotal = items.reduce((s, l) => s + l.price * l.qty, 0);
    const deliveryFee = 25;
    const now = new Date().toISOString();

    const ref = db.collection("orders").doc();
    const order = {
      id: ref.id,
      customerId: customer.id,
      vendorId,
      riderId: null,
      status: "PLACED",
      items,
      subtotal,
      deliveryFee,
      total: subtotal + deliveryFee,
      deliverTo: customer.address,
      deliverLat: customer.lat,
      deliverLng: customer.lng,
      history: [{ status: "PLACED", at: now }],
      createdAt: now,
      updatedAt: now,
    };

    await ref.set(order);

    // Emit via Socket.io (io attached to router by index.js)
    emitOrderUpdate(req.app.get("io"), order);

    res.status(201).json(order);
  } catch (err) {
    console.error("POST /orders:", err);
    res.status(500).json({ error: "Failed to place order" });
  }
});

/* ── PATCH /api/orders/:id/status ───────────────────────────── */
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
    const now = new Date().toISOString();

    const updates = {
      status,
      updatedAt: now,
      history: [...(order.history || []), { status, at: now }],
    };

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
    res.json(updatedOrder);
  } catch (err) {
    console.error("PATCH /orders/:id/status:", err);
    res.status(500).json({ error: "Failed to update order status" });
  }
});

/* ── PATCH /api/orders/:id/advance ─────────────────────────── */
router.patch("/:id/advance", requireAuth, async (req, res) => {
  try {
    const ref = db.collection("orders").doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: "Order not found" });

    const order = doc.data();
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

    if (nextStatus === "DELIVERED" && order.riderId) {
      const riderRef = db.collection("riders").doc(order.riderId);
      const riderDoc = await riderRef.get();
      await riderRef.update({
        status: "available",
        deliveriesToday: (riderDoc.data().deliveriesToday || 0) + 1,
      });
    }

    await ref.update(updates);
    const updated = await ref.get();
    const updatedOrder = toOrder(updated);

    emitOrderUpdate(req.app.get("io"), updatedOrder);
    res.json(updatedOrder);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to advance order" });
  }
});

/* ── PATCH /api/orders/:id/assign ─────────────────────────────
   Assign or reassign a rider to an order (merchant / admin)     */
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
    res.json(updatedOrder);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to assign rider" });
  }
});

module.exports = router;
