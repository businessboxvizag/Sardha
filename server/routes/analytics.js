const express = require("express");
const { db } = require("../config/firebase");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

/* ── GET /api/analytics ─────────────────────────────────────────
   Admin → global stats across all vendors.
   Merchant → stats scoped to their own vendor only. (#29)        */
router.get("/", requireAuth, requireRole("admin", "merchant"), async (req, res) => {
  try {
    let ordersSnap;

    if (req.user.role === "merchant") {
      // Derive the vendor ID from the authenticated merchant's UID — never trust query params
      const vendorSnap = await db.collection("vendors")
        .where("merchantId", "==", req.user.uid)
        .limit(1)
        .get();
      if (vendorSnap.empty) {
        return res.json({
          totalOrders: 0, deliveredOrders: 0, activeOrders: 0,
          revenue: 0, avgOrderValue: 0, statusDistribution: {}, revenueByVendor: {},
        });
      }
      const merchantVendorId = vendorSnap.docs[0].id;
      ordersSnap = await db.collection("orders").where("vendorId", "==", merchantVendorId).get();
    } else {
      // Admin: full view
      ordersSnap = await db.collection("orders").get();
    }

    const orders = ordersSnap.docs.map((d) => d.data());

    const delivered    = orders.filter((o) => o.status === "DELIVERED");
    const active       = orders.filter((o) => !["DELIVERED", "CANCELLED"].includes(o.status));
    const nonCancelled = orders.filter((o) => o.status !== "CANCELLED");
    const revenue      = nonCancelled.reduce((s, o) => s + (o.total || 0), 0);

    const statusDist = {};
    orders.forEach((o) => { statusDist[o.status] = (statusDist[o.status] || 0) + 1; });

    const revenueByVendor = {};
    nonCancelled.forEach((o) => {
      revenueByVendor[o.vendorId] = (revenueByVendor[o.vendorId] || 0) + (o.total || 0);
    });

    const result = {
      totalOrders:    orders.length,
      deliveredOrders: delivered.length,
      activeOrders:   active.length,
      revenue,
      avgOrderValue:  nonCancelled.length ? revenue / nonCancelled.length : 0,
      statusDistribution: statusDist,
      revenueByVendor,
    };

    // Rider data only exposed to admin
    if (req.user.role === "admin") {
      const ridersSnap = await db.collection("riders").get();
      const riders = ridersSnap.docs.map((d) => d.data());
      result.ridersOnline = riders.filter((r) => r.status !== "offline").length;
      result.ridersTotal  = riders.length;
    }

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to compute analytics" });
  }
});

module.exports = router;
