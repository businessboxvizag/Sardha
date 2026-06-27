const express = require("express");
const bcrypt = require("bcryptjs");
const { db } = require("../config/firebase");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

/* ── DELETE /api/admin/clear-demo ──────────────────────────────
 * One-time endpoint to wipe seed/demo data from Firestore.
 * Deletes specific demo document IDs only — does NOT wipe the
 * entire database.  Admin auth required.
 * ──────────────────────────────────────────────────────────── */
router.delete("/clear-demo", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const DEMO_VENDOR_IDS   = ["v_kirana", "v_chaat", "v_florist", "v_pharma", "v_bakery"];
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

/* ── GET /api/admin/logins ─────────────────────────────────────
 * Returns the latest login events across all roles.             */
router.get("/logins", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const snap = await db.collection("logins").get();
    const logs = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => new Date(b.at) - new Date(a.at))
      .slice(0, 200);
    res.json(logs);
  } catch (err) {
    console.error("GET /admin/logins:", err);
    res.status(500).json({ error: "Failed to fetch login logs" });
  }
});

/* ── GET /api/admin/users ──────────────────────────────────────
 * Returns all user accounts (no passwordHash).                  */
router.get("/users", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const snap = await db.collection("users").get();
    const users = snap.docs.map((d) => {
      const { passwordHash, ...safe } = d.data();
      return safe;
    });
    res.json(users);
  } catch (err) {
    console.error("GET /admin/users:", err);
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

/* ── POST /api/admin/merchants ─────────────────────────────────
 * Admin creates a merchant account + store in one step.
 * Returns { vendorId, email, password } so admin can hand
 * credentials to the merchant and display the store QR.       */
router.post("/merchants", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const { merchantName, email, password } = req.body;

    if (!merchantName || !email || !password) {
      return res.status(400).json({ error: "merchantName, email and password are required" });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }

    // Block duplicate merchant email
    const existing = await db.collection("users")
      .where("email", "==", email)
      .where("role", "==", "merchant")
      .get();
    if (!existing.empty) {
      return res.status(409).json({ error: "A merchant account with this email already exists" });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const userRef = db.collection("users").doc();
    const uid = userRef.id;
    const now = new Date().toISOString();

    // Create merchant user
    await userRef.set({
      uid, email, passwordHash,
      role: "merchant",
      name: merchantName,
      authProvider: "email",
      createdAt: now,
      createdBy: "admin",
    });

    // Create stub vendor doc (merchant completes setup on first login)
    await db.collection("vendors").doc(uid).set({
      id: uid,
      name: "",
      merchantId: uid,
      userId: uid,
      category: "",
      area: "",
      img: "",
      rating: 5.0,
      prepMins: 15,
      lat: null,
      lng: null,
      active: false,
      status: "pending_setup",
      createdAt: now,
      createdBy: "admin",
    });

    res.status(201).json({
      vendorId: uid,
      email,
      password,
      merchantName,
    });
  } catch (err) {
    console.error("POST /admin/merchants:", err);
    res.status(500).json({ error: "Failed to create merchant: " + err.message });
  }
});

/* ── DELETE /api/admin/merchants/:vendorId ─────────────────────
 * Removes vendor + associated merchant user account.           */
router.delete("/merchants/:vendorId", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const { vendorId } = req.params;
    const batch = db.batch();
    batch.delete(db.collection("vendors").doc(vendorId));
    batch.delete(db.collection("users").doc(vendorId)); // uid === vendorId
    await batch.commit();
    res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /admin/merchants:", err);
    res.status(500).json({ error: "Failed to delete: " + err.message });
  }
});

module.exports = router;
