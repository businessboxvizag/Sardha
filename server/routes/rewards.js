/**
 * rewards.js — gold-coins loyalty engine.
 *
 * Customers earn 10 gold coins for winning a mini-game. To stop farming, a win only
 * pays out when the customer has a "play credit", and a play credit is granted when
 * they place an order (see orders.js). At 100 coins they can redeem a reward:
 *   FREE_DELIVERY  — next order's delivery fee waived
 *   PERCENT10      — 10% off the next order's items (Saardha absorbs this)
 * The redeemed reward is stored on the customer as `activeReward` and consumed by
 * the next successful order (pricing + orders.js).
 *
 * Customer fields: goldCoins (number), gamePlays (number), activeReward ({type,createdAt}|null)
 */
const express = require("express");
const { db } = require("../config/firebase");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();
const COINS_PER_WIN = 10;
const REDEEM_COST = 100;
const REWARD_TYPES = ["FREE_DELIVERY", "PERCENT10"];

async function customerRefFor(uid) {
  const snap = await db.collection("customers").where("userId", "==", uid).limit(1).get();
  return snap.empty ? null : snap.docs[0].ref;
}

/* ── GET /api/rewards/me ── balance + play credits + active reward ── */
router.get("/me", requireAuth, requireRole("customer"), async (req, res) => {
  try {
    const ref = await customerRefFor(req.user.uid);
    if (!ref) return res.status(404).json({ error: "Customer profile not found" });
    const d = (await ref.get()).data();
    res.json({
      goldCoins: d.goldCoins || 0,
      gamePlays: d.gamePlays || 0,
      activeReward: d.activeReward || null,
      redeemCost: REDEEM_COST,
      coinsPerWin: COINS_PER_WIN,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch rewards" });
  }
});

/* ── POST /api/rewards/win  { orderId } ──────────────────────────────
 * Coins are ONLY earnable while an order is actively being delivered, and each
 * order pays out at most once. This blocks farming from the profile screen or from
 * old/delivered orders — the client must pass the id of a live, in-progress order
 * that belongs to the customer and hasn't already been rewarded.                 */
const ACTIVE_ORDER_STATUSES = ["PLACED", "ACCEPTED", "ASSIGNED", "PICKED_UP", "OUT_FOR_DELIVERY"];
router.post("/win", requireAuth, requireRole("customer"), async (req, res) => {
  try {
    const orderId = req.body.orderId;
    const snap = await db.collection("customers").where("userId", "==", req.user.uid).limit(1).get();
    if (snap.empty) return res.status(404).json({ error: "Customer profile not found" });
    const custDoc = snap.docs[0];
    const custId = custDoc.id;
    const ref = custDoc.ref;

    if (!orderId) return res.json({ awarded: 0, goldCoins: custDoc.data().goldCoins || 0, reason: "no_active_order" });

    // The order must exist, belong to this customer, and still be in progress.
    const orderDoc = await db.collection("orders").doc(orderId).get();
    if (!orderDoc.exists || orderDoc.data().customerId !== custId) {
      return res.status(403).json({ error: "Not your order" });
    }
    if (!ACTIVE_ORDER_STATUSES.includes(orderDoc.data().status)) {
      return res.json({ awarded: 0, goldCoins: custDoc.data().goldCoins || 0, reason: "order_not_active" });
    }

    const result = await db.runTransaction(async (tx) => {
      const doc = await tx.get(ref);
      const d = doc.data() || {};
      const rewarded = Array.isArray(d.rewardedOrderIds) ? d.rewardedOrderIds : [];
      if (rewarded.includes(orderId)) {
        return { awarded: 0, goldCoins: d.goldCoins || 0, reason: "already_rewarded" };
      }
      const goldCoins = (d.goldCoins || 0) + COINS_PER_WIN;
      tx.update(ref, { goldCoins, rewardedOrderIds: [...rewarded, orderId] });
      return { awarded: COINS_PER_WIN, goldCoins };
    });

    res.json(result);
  } catch (err) {
    console.error("POST /rewards/win:", err);
    res.status(500).json({ error: "Failed to record win" });
  }
});

/* ── POST /api/rewards/redeem  { type } ── spend 100 coins for a reward ── */
router.post("/redeem", requireAuth, requireRole("customer"), async (req, res) => {
  try {
    const type = req.body.type;
    if (!REWARD_TYPES.includes(type)) return res.status(400).json({ error: "Invalid reward type" });

    const ref = await customerRefFor(req.user.uid);
    if (!ref) return res.status(404).json({ error: "Customer profile not found" });

    const out = await db.runTransaction(async (tx) => {
      const doc = await tx.get(ref);
      const d = doc.data() || {};
      if ((d.goldCoins || 0) < REDEEM_COST) { const e = new Error("Not enough coins"); e.code = 400; throw e; }
      if (d.activeReward) { const e = new Error("You already have a reward waiting — use it on your next order first."); e.code = 400; throw e; }
      const goldCoins = (d.goldCoins || 0) - REDEEM_COST;
      const activeReward = { type, createdAt: new Date().toISOString() };
      tx.update(ref, { goldCoins, activeReward });
      return { goldCoins, activeReward };
    });

    res.json(out);
  } catch (err) {
    res.status(err.code || 500).json({ error: err.message || "Failed to redeem" });
  }
});

module.exports = router;
