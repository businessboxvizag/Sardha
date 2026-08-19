const express = require("express");
const { db } = require("../config/firebase");
const { requireAuth, requireRole } = require("../middleware/auth");
const razorpay = require("../config/razorpay");
const { priceOrder } = require("../lib/pricing");

const router = express.Router();

// POST /api/payments/create-order  { vendorId, items, promoCode? }
// Returns the details the browser needs to open Razorpay Checkout.
// The amount is the SAME server-computed total (incl. discount + GST + delivery)
// that orders.js will re-verify at placement, so the two can never disagree.
router.post("/create-order", requireAuth, requireRole("customer"), async (req, res) => {
  try {
    if (!razorpay.instance) {
      return res.status(503).json({ error: "Online payments are not configured" });
    }
    const { vendorId, items, promoCode } = req.body;
    // Include any redeemed reward so the charged amount matches order placement.
    const custSnap = await db.collection("customers").where("userId", "==", req.user.uid).limit(1).get();
    const cust = custSnap.empty ? {} : custSnap.docs[0].data();
    const { total, discount } = await priceOrder({ vendorId, items, promoCode, reward: cust.activeReward || null, freeDelivery: Number(cust.orderCount || 0) < 10 });

    // No rider-availability gate — a Saradhi can stack multiple tasks, so checkout is
    // never blocked on availability. The order is assigned after payment.

    const rzpOrder = await razorpay.instance.orders.create({
      amount: total * 100,          // amount in paise
      currency: "INR",
      receipt: "sardha_" + Date.now(),
      // Record the exact promo used so the placement step charges the identical basis.
      notes: { vendorId, userId: req.user.uid, promoCode: (discount.code || "") },
    });
    res.json({
      razorpayOrderId: rzpOrder.id,
      amount: rzpOrder.amount,
      currency: rzpOrder.currency,
      keyId: razorpay.keyId,
    });
  } catch (err) {
    console.error("POST /payments/create-order:", err);
    res.status(err.code || 500).json({ error: err.message || "Failed to create payment" });
  }
});

module.exports = router;
