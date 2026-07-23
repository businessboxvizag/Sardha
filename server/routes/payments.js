const express = require("express");
const { db } = require("../config/firebase");
const { requireAuth, requireRole } = require("../middleware/auth");
const razorpay = require("../config/razorpay");

const router = express.Router();

// Server-side pricing — never trusts prices sent by the client.
async function computeTotal(vendorId, items) {
  if (!vendorId || !Array.isArray(items) || !items.length) {
    const e = new Error("vendorId and items required"); e.code = 400; throw e;
  }
  const vendorDoc = await db.collection("vendors").doc(vendorId).get();
  if (!vendorDoc.exists) { const e = new Error("Vendor not found"); e.code = 404; throw e; }
  const vendor = vendorDoc.data();
  if (vendor.active === false || vendor.status === "inactive") {
    const e = new Error("This store is currently closed"); e.code = 400; throw e;
  }
  let subtotal = 0;
  for (const line of items) {
    const { productId, qty } = line;
    if (!productId || !qty || Number(qty) < 1) {
      const e = new Error("Each item needs productId and qty >= 1"); e.code = 400; throw e;
    }
    const prodDoc = await db.collection("products").doc(productId).get();
    if (!prodDoc.exists || prodDoc.data().available === false) {
      const e = new Error(`Product ${productId} is unavailable`); e.code = 400; throw e;
    }
    const prod = prodDoc.data();
    if (prod.vendorId !== vendorId) {
      const e = new Error(`Product ${productId} does not belong to this vendor`); e.code = 400; throw e;
    }
    subtotal += prod.price * Math.floor(Number(qty));
  }
  const settingsDoc = await db.collection("settings").doc("global").get();
  const deliveryFee = settingsDoc.exists ? (settingsDoc.data().deliveryFee ?? 15) : 15;
  return { subtotal, deliveryFee, total: subtotal + deliveryFee };
}

// POST /api/payments/create-order  { vendorId, items }
// Returns the details the browser needs to open Razorpay Checkout.
router.post("/create-order", requireAuth, requireRole("customer"), async (req, res) => {
  try {
    if (!razorpay.instance) {
      return res.status(503).json({ error: "Online payments are not configured" });
    }
    const { vendorId, items } = req.body;
    const { total } = await computeTotal(vendorId, items);
    const rzpOrder = await razorpay.instance.orders.create({
      amount: total * 100,          // amount in paise
      currency: "INR",
      receipt: "sardha_" + Date.now(),
      notes: { vendorId, userId: req.user.uid },
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
