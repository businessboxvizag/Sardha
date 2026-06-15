const express = require("express");
const { db } = require("../config/firebase");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

/* ── DELETE /api/admin/clear-demo ──────────────────────────────
 * Wipes seed/demo data from Firestore. Admin auth required.
 * ──────────────────────────────────────────────────────────── */
router.delete("/clear-demo", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const DEMO_VENDOR_IDS   = ["v_kirana","v_chaat","v_florist","v_pharma","v_bakery"];
    const DEMO_PRODUCT_IDS  = ["p1","p2","p3","p4","p5","p6","p7","p8","p9","p10","p11","p12","p13","p14","p15","p16","p17"];
    const DEMO_RIDER_IDS    = ["r1","r2","r3","r4","r5"];
    const DEMO_ORDER_IDS    = ["ord_1","ord_2","ord_3","ord_4"];
    const DEMO_CUSTOMER_IDS = ["c_srinivas","c_anita","c_rohit"];
    const DEMO_USER_IDS     = ["c_srinivas","c_anita","c_rohit","admin1","m_bakery","m_chaat"];

    const batch = db.batch();
    DEMO_VENDOR_IDS.forEach(id   => batch.delete(db.collection("vendors").doc(id)));
    DEMO_PRODUCT_IDS.forEach(id  => batch.delete(db.collection("products").doc(id)));
    DEMO_RIDER_IDS.forEach(id    => batch.delete(db.collection("riders").doc(id)));
    DEMO_ORDER_IDS.forEach(id    => batch.delete(db.collection("orders").doc(id)));
    DEMO_CUSTOMER_IDS.forEach(id => batch.delete(db.collection("customers").doc(id)));
    DEMO_CUSTOMER_IDS.forEach(id => batch.delete(db.collection("favorites").doc(id)));
    DEMO_USER_IDS.forEach(id     => batch.delete(db.collection("users").doc(id)));
    await batch.commit();
    res.json({ ok: true, message: "Demo data cleared." });
  } catch (err) {
    console.error("clear-demo error:", err);
    res.status(500).json({ error: "Failed to clear demo data: " + err.message });
  }
});

module.exports = router;
