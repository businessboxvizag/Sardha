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
    const { total, discount } = await priceOrder({ vendorId, items, promoCode });

    // Don't charge the customer if no Saradhi can deliver (#10)
    const availSnap = await db.collection("riders").where("status", "==", "available").limit(1).get();
    if (availSnap.empty) {
      return res.status(409).json({ error: "No Saradhi is available right now. Please try again in a few minutes." });
    }

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
