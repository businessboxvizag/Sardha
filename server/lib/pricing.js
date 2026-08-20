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
function computeDiscount(vendor, subtotal, promoCode, opts = {}) {
  const platformPromos = Array.isArray(opts.platformPromos) ? opts.platformPromos : [];
  const usedPromos = Array.isArray(opts.usedPromos) ? opts.usedPromos.map(normalizeCode) : [];

  const storePct = clampPct(vendor.storeDiscountPct);
  const storeAmt = Math.round((subtotal * storePct) / 100);

  let promoAmt = 0;
  let promo = null;          // { code, pct, isPlatform }
  let promoError = null;

  const code = normalizeCode(promoCode);
  if (code) {
    // A code can be a store's own promo OR a Saardha-wide platform code (the daily
    // Instagram offer). We validate BOTH and use whichever is usable — so an inactive
    // store code with the same name can never shadow a valid platform code.
    const storeList = Array.isArray(vendor.promos) ? vendor.promos : [];
    const storeFound = storeList.find((p) => normalizeCode(p.code) === code);
    const platformFound = platformPromos.find((p) => normalizeCode(p.code) === code);

    // Returns { pct } if usable, else { error }.
    function evaluate(p, isPlatform) {
      if (!p) return null;
      if (p.active === false) return { error: "That code is no longer active." };
      if (p.expiresAt && new Date(p.expiresAt) < new Date()) return { error: "That code has expired." };
      if (isPlatform && Number(p.totalCap) > 0 && Number(p.usedCount || 0) >= Number(p.totalCap)) return { error: "That code has reached its limit." };
      if (isPlatform && p.perCustomerOnce && usedPromos.includes(code)) return { error: "You've already used that code." };
      if (p.minSubtotal && subtotal < Number(p.minSubtotal)) return { error: `Add ₹${Number(p.minSubtotal) - subtotal} more to use ${code}.` };
      return { pct: clampPct(p.pct) };
    }

    const storeEval = evaluate(storeFound, false);
    const platformEval = evaluate(platformFound, true);

    // Prefer whichever is usable; if both, take the bigger %. If neither, surface an error.
    const candidates = [];
    if (storeEval && storeEval.pct != null) candidates.push({ pct: storeEval.pct, isPlatform: false });
    if (platformEval && platformEval.pct != null) candidates.push({ pct: platformEval.pct, isPlatform: true });

    if (candidates.length) {
      const best = candidates.sort((a, b) => b.pct - a.pct)[0];
      promoAmt = Math.round((subtotal * best.pct) / 100);
      promo = { code, pct: best.pct, isPlatform: best.isPlatform };
    } else if (platformEval && platformEval.error) {
      promoError = platformEval.error;
    } else if (storeEval && storeEval.error) {
      promoError = storeEval.error;
    } else {
      promoError = "That code isn't valid.";
    }
  }

  // Bigger of the two — never stack.
  if (promo && promoAmt > 0 && promoAmt >= storeAmt) {
    return { amount: promoAmt, source: "promo", code: promo.code, pct: promo.pct, isPlatform: promo.isPlatform, promoError: null };
  }
  if (storeAmt > 0) {
    // A valid-but-smaller promo still "worked", it was just beaten by the store %.
    return { amount: storeAmt, source: "store", code: null, pct: storePct, isPlatform: false, promoError };
  }
  return { amount: 0, source: "none", code: null, pct: 0, isPlatform: false, promoError };
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
async function priceOrder({ vendorId, items, promoCode, reward, freeDelivery, usedPromos }) {
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

  const settingsDoc = await db.collection("settings").doc("global").get();
  const settings = settingsDoc.exists ? settingsDoc.data() : {};
  const baseDeliveryFee = settings.deliveryFee ?? 15;
  const platformPromos = Array.isArray(settings.platformPromos) ? settings.platformPromos : [];

  const discount = computeDiscount(vendor, subtotal, promoCode, { platformPromos, usedPromos });
  const discountedSubtotal = Math.max(0, subtotal - discount.amount);

  // Gold-coin reward (platform-borne, validated by the caller from the customer doc):
  //   FREE_DELIVERY → delivery fee waived; PERCENT10 → extra 10% off items.
  // Applied AFTER any store/promo discount, and it stacks (Saardha absorbs it).
  const rewardType = reward && reward.type;
  let rewardAmount = 0, deliveryFee = baseDeliveryFee, rewardApplied = null;
  if (rewardType === "PERCENT10") {
    rewardAmount = Math.round(discountedSubtotal * 0.10);
    rewardApplied = { type: "PERCENT10", amount: rewardAmount };
  } else if (rewardType === "FREE_DELIVERY") {
    deliveryFee = 0;
    rewardApplied = { type: "FREE_DELIVERY", amount: baseDeliveryFee };
  }

  // Launch promo: a new customer's first N orders ship free (caller decides eligibility).
  const firstOrdersFreeDelivery = !!freeDelivery && baseDeliveryFee > 0;
  if (freeDelivery) deliveryFee = 0;

  const netSubtotal = Math.max(0, discountedSubtotal - rewardAmount);
  const gst = Math.round(netSubtotal * GST_RATE);
  const total = netSubtotal + gst + deliveryFee;

  return {
    vendor,
    resolvedItems,
    subtotal,
    discount: { amount: discount.amount, source: discount.source, code: discount.code, pct: discount.pct, isPlatform: !!discount.isPlatform },
    promoError: discount.promoError || null,
    discountedSubtotal,
    reward: rewardApplied,      // null, or { type, amount } — what the coins reward saved
    firstOrdersFreeDelivery,    // true when the first-N-orders free-delivery promo applied
    gst,
    deliveryFee,
    total,
  };
}

module.exports = { priceOrder, computeDiscount, normalizeCode, GST_RATE };
