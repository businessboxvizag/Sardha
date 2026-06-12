const express = require("express");
const { db } = require("../config/firebase");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

/* ── GET /api/analytics ─────────────────────────────────────── */
router.get("/", requireAuth, requireRole("admin", "merchant"), async (req, res) => {
  try {
    const [ordersSnap, ridersSnap] = await Promise.all([
      db.collection("orders").get(),
      db.collection("riders").get(),
    ]);

    const orders = ordersSnap.docs.map((d) => d.data());
    const riders = ridersSnap.docs.map((d) => d.data());

    const delivered = orders.filter((o) => o.status === "DELIVERED");
    const active = orders.filter(
      (o) => o.status !== "DELIVERED" && o.status !== "CANCELLED"
    );
    const nonCancelled = orders.filter((o) => o.status !== "CANCELLED");
    const revenue = nonCancelled.reduce((s, o) => s + (o.total || 0), 0);

    const revenueByVendor = {};
    nonCancelled.forEach((o) => {
      revenueByVendor[o.vendorId] = (revenueByVendor[o.vendorId] || 0) + (o.total || 0);
    });

    const statusDist = {};
    orders.forEach((o) => {
      statusDist[o.status] = (statusDist[o.status] || 0) + 1;
    });

    res.json({
      totalOrders: orders.length,
      deliveredOrders: delivered.length,
      activeOrders: active.length,
      revenue,
      avgOrderValue: nonCancelled.length ? revenue / nonCancelled.length : 0,
      ridersOnline: riders.filter((r) => r.status !== "offline").length,
      ridersTotal: riders.length,
      revenueByVendor,
      statusDistribution: statusDist,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to compute analytics" });
  }
});

module.exports = router;
