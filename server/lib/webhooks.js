/**
 * Fire a status webhook to a delivery partner when their delivery changes state.
 * Best-effort: failures are logged, never thrown (must not break the order flow).
 */
const { db } = require("../config/firebase");

async function notifyPartner(order, event) {
  try {
    if (!order || !order.partnerId) return;
    const p = await db.collection("partners").doc(order.partnerId).get();
    if (!p.exists) return;
    const url = p.data().webhookUrl;
    if (!url) return;
    const payload = {
      event: event || order.status,
      deliveryId: order.id || order.deliveryId,
      reference: order.reference || null,
      status: order.status,
      fee: order.deliveryFee != null ? order.deliveryFee : null,
      at: new Date().toISOString(),
    };
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    console.error("webhook notifyPartner:", e && e.message);
  }
}

module.exports = { notifyPartner };
