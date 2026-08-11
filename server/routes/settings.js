const express = require("express");
const { db } = require("../config/firebase");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();
const SETTINGS_DOC = "global";

/* ── GET /api/settings ─── public read ── */
router.get("/", async (req, res) => {
  try {
    const doc = await db.collection("settings").doc(SETTINGS_DOC).get();
    const data = doc.exists ? doc.data() : {};
    res.json({
      deliveryFee: data.deliveryFee ?? 15,
      codCashLimit: data.codCashLimit ?? 2000,
      operationalZones: data.operationalZones ?? [],
      supportPhone: data.supportPhone ?? "",
      supportWhatsapp: data.supportWhatsapp ?? "",
      supportEmail: data.supportEmail ?? "",
      supportHours: data.supportHours ?? "Mon–Sun, 9am–9pm",
      upiVpa: data.upiVpa ?? "",           // Saardha's UPI ID for pay-on-delivery QR
      upiName: data.upiName ?? "Saardha",  // payee name shown in the customer's UPI app
      upiQrImageUrl: data.upiQrImageUrl ?? "", // optional: an uploaded static UPI QR image (e.g. PhonePe)
      riderPayPerDelivery: data.riderPayPerDelivery ?? 30,   // ₹ paid to a rider per completed delivery
      merchantCommissionPct: data.merchantCommissionPct ?? 10, // Saardha's % cut of merchant item sales
      ...data,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch settings" });
  }
});

/* ── PUT /api/settings ─── admin only ── */
router.put("/", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const allowed = ["deliveryFee", "codCashLimit", "operationalZones",
                     "supportPhone", "supportWhatsapp", "supportEmail", "supportHours",
                     "upiVpa", "upiName", "upiQrImageUrl", "riderPayPerDelivery", "merchantCommissionPct"];
    if (req.body.riderPayPerDelivery !== undefined) req.body.riderPayPerDelivery = Number(req.body.riderPayPerDelivery) || 0;
    if (req.body.merchantCommissionPct !== undefined) req.body.merchantCommissionPct = Math.max(0, Math.min(100, Number(req.body.merchantCommissionPct) || 0));
    const updates = {};
    allowed.forEach((k) => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
    if (updates.deliveryFee !== undefined) updates.deliveryFee = Number(updates.deliveryFee);
    if (updates.codCashLimit !== undefined) updates.codCashLimit = Number(updates.codCashLimit);
    if (updates.operationalZones !== undefined && !Array.isArray(updates.operationalZones)) delete updates.operationalZones;
    await db.collection("settings").doc(SETTINGS_DOC).set(updates, { merge: true });
    const doc = await db.collection("settings").doc(SETTINGS_DOC).get();
    res.json(doc.data());
  } catch (err) {
    res.status(500).json({ error: "Failed to update settings" });
  }
});

module.exports = router;
