/**
 * pricing.js — single source of truth for order totals.
 *
 * Both the payment-order creation (payments.js) and the final order placement
 * (orders.js) MUST use priceOrder() so the amount charged via Razorpay always
 * matches the amount stored on the order. Prices are ALWAYS read from Firestore
 * here — never trusted from the client.
 *
 * Discount policy (v1):
 *   - Percent-only. A store may set a store-wide discount % (vendor.storeDiscountPct)
 *     and/or a list of promo codes (vendor.promos = [{ code, pct, active, minSubtotal, expiresAt }]).
 *   - "Bigger of the two": we apply EITHER the store-wide % OR a matching promo code —
 *     whichever yields the larger rupee discount. They never stack.
 *   - GST is charged on the DISCOUNTED subtotal. Delivery fee is never discounted (v1).
 */

const { db } = require("../config/firebase");

const GST_RATE = 0.18;

function normalizeCode(code) {
  return String(code || "").trim().toUpperCase();
}

function clampPct(n) {
  return Math.max(0, Math.min(90, Number(n) || 0));
}

/**
 * Decide the discount for a given vendor + subtotal + optional promo code.
 * Percent-only, bigger-of-the-two. Returns:
 *   { amount, source: 'store'|'promo'|'none', code, pct, promoError }
 * promoError is a customer-facing string ONLY when a code was supplied but rejected.
 */
function computeDiscount(vendor, subtotal, promoCode) {
  const storePct = clampPct(vendor.storeDiscountPct);
  const storeAmt = Math.round((subtotal * storePct) / 100);

  let promoAmt = 0;
  let promo = null;
  let promoError = null;

  const code = normalizeCode(promoCode);
  if (code) {
    const list = Array.isArray(vendor.promos) ? vendor.promos : [];
    const found = list.find((p) => normalizeCode(p.code) === code);
    if (!found) {
      promoError = "That code isn't valid for this store.";
    } else if (found.active === false) {
      promoError = "That code is no longer active.";
    } else if (found.expiresAt && new Date(found.expiresAt) < new Date()) {
      promoError = "That code has expired.";
    } else if (found.minSubtotal && subtotal < Number(found.minSubtotal)) {
      promoError = `Add ₹${Number(found.minSubtotal) - subtotal} more to use ${code}.`;
    } else {
      const pct = clampPct(found.pct);
      promoAmt = Math.round((subtotal * pct) / 100);
      promo = { code, pct };
    }
  }

  // Bigger of the two — never stack.
  if (promo && promoAmt > 0 && promoAmt >= storeAmt) {
    return { amount: promoAmt, source: "promo", code: promo.code, pct: promo.pct, promoError: null };
  }
  if (storeAmt > 0) {
    // A valid-but-smaller promo still "worked", it was just beaten by the store %.
    return { amount: storeAmt, source: "store", code: null, pct: storePct, promoError };
  }
  return { amount: 0, source: "none", code: null, pct: 0, promoError };
}

/**
 * Resolve a cart server-side and compute the full price breakdown.
 * Throws Error with .code (HTTP status) on any validation failure.
 *
 * @param {{ vendorId: string, items: Array<{productId, qty}>, promoCode?: string }}
 * @returns {Promise<{
 *   vendor, resolvedItems, subtotal, discount:{amount,source,code,pct},
 *   promoError, discountedSubtotal, gst, deliveryFee, total
 * }>}
 */
async function priceOrder({ vendorId, items, promoCode }) {
  if (!vendorId || !Array.isArray(items) || !items.length) {
    const e = new Error("vendorId and items required"); e.code = 400; throw e;
  }

  const vendorDoc = await db.collection("vendors").doc(vendorId).get();
  if (!vendorDoc.exists) { const e = new Error("Vendor not found"); e.code = 404; throw e; }
  const vendor = vendorDoc.data();
  if (vendor.active === false || vendor.status === "inactive") {
    const e = new Error("This store is currently closed"); e.code = 400; throw e;
  }

  const resolvedItems = [];
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
    const lineQty = Math.floor(Number(qty));
    const lineTotal = prod.price * lineQty;
    resolvedItems.push({ productId, name: prod.name, price: prod.price, qty: lineQty, lineTotal });
    subtotal += lineTotal;
  }

  const discount = computeDiscount(vendor, subtotal, promoCode);
  const discountedSubtotal = Math.max(0, subtotal - discount.amount);

  const settingsDoc = await db.collection("settings").doc("global").get();
  const deliveryFee = settingsDoc.exists ? (settingsDoc.data().deliveryFee ?? 15) : 15;
  const gst = Math.round(discountedSubtotal * GST_RATE);
  const total = discountedSubtotal + gst + deliveryFee;

  return {
    vendor,
    resolvedItems,
    subtotal,
    discount: { amount: discount.amount, source: discount.source, code: discount.code, pct: discount.pct },
    promoError: discount.promoError || null,
    discountedSubtotal,
    gst,
    deliveryFee,
    total,
  };
}

module.exports = { priceOrder, computeDiscount, normalizeCode, GST_RATE };
