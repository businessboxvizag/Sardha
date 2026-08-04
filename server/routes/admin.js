const express = require("express");
const bcrypt = require("bcryptjs");
const { db } = require("../config/firebase");
const { requireAuth, requireRole } = require("../middleware/auth");
const { hashKey, generateKey } = require("../middleware/partnerAuth");

const router = express.Router();

/* ── Delivery partners (DaaS) ─────────────────────────────────
 * Admin approves businesses and issues API keys. The raw key is
 * returned ONCE at creation; only its hash is stored.          */
router.get("/partners", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const snap = await db.collection("partners").get();
    res.json(snap.docs.map((d) => { const { apiKeyHash, ...safe } = d.data(); return { id: d.id, ...safe }; }));
  } catch (err) { res.json([]); }
});

router.post("/partners", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    if (!name) return res.status(400).json({ error: "Partner name required" });
    const key = generateKey();
    const now = new Date().toISOString();
    const ref = db.collection("partners").doc();
    const partner = {
      name,
      webhookUrl: req.body.webhookUrl || null,
      priceBase: Number(req.body.priceBase) || 20,
      pricePerKm: Number(req.body.pricePerKm) || 8,
      priceMin: Number(req.body.priceMin) || 25,
      status: "active",
      apiKeyHash: hashKey(key),
      keyPrefix: key.slice(0, 12) + "…",
      createdAt: now,
    };
    await ref.set(partner);
    const { apiKeyHash, ...safe } = partner;
    res.status(201).json({ partner: { id: ref.id, ...safe }, apiKey: key });
  } catch (err) {
    console.error("create partner:", err);
    res.status(500).json({ error: "Failed to create partner" });
  }
});

router.patch("/partners/:id", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const allowed = ["name", "webhookUrl", "priceBase", "pricePerKm", "priceMin", "status"];
    const updates = {};
    allowed.forEach((k) => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
    ["priceBase", "pricePerKm", "priceMin"].forEach((k) => { if (updates[k] !== undefined) updates[k] = Number(updates[k]); });
    await db.collection("partners").doc(req.params.id).update(updates);
    const doc = await db.collection("partners").doc(req.params.id).get();
    const { apiKeyHash, ...safe } = doc.data();
    res.json({ id: doc.id, ...safe });
  } catch (err) { res.status(500).json({ error: "Failed to update partner" }); }
});

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

/* ── GET /api/admin/rx-orders ── pharmacy compliance records (admin only) ──
 * Prescription + selfie images are kept out of every other payload and only
 * returned here, to the admin, for legal/compliance review.               */
router.get("/rx-orders", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const snap = await db.collection("orders").where("requiresPrescription", "==", true).get();
    const rows = snap.docs.map((d) => {
      const o = d.data();
      return {
        id: d.id, vendorId: o.vendorId, customerId: o.customerId, total: o.total,
        status: o.status, createdAt: o.createdAt, deliverTo: o.deliverTo || null,
        dropName: o.dropName || null, dropPhone: o.dropPhone || null,
        prescriptionUrl: o.prescriptionUrl || null, selfieUrl: o.selfieUrl || null,
        rxConsentAt: o.rxConsentAt || null,
      };
    }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 300);
    res.json(rows);
  } catch (err) { res.json([]); }
});

/* ── GET /api/admin/support ──── recent assistant/support transcripts ── */
router.get("/support", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const snap = await db.collection("support_logs").get();
    const logs = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => new Date(b.at) - new Date(a.at))
      .slice(0, 300);
    res.json(logs);
  } catch (err) {
    res.json([]);
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
    // Accept the richer onboarding fields; keep merchantName as a fallback for older callers.
    const email = req.body.email;
    const password = req.body.password;
    const ownerName = (req.body.ownerName || "").trim();
    const businessName = (req.body.businessName || req.body.merchantName || "").trim();
    const ownerPhone = (req.body.ownerPhone || "").trim() || null;
    const businessPhone = (req.body.businessPhone || "").trim() || null;

    if (!businessName || !email || !password) {
      return res.status(400).json({ error: "businessName, email and password are required" });
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

    // Create merchant user (owner details live on the account)
    await userRef.set({
      uid, email, passwordHash,
      role: "merchant",
      name: ownerName || businessName,
      ownerName: ownerName || null,
      phone: ownerPhone,
      authProvider: "email",
      createdAt: now,
      createdBy: "admin",
    });

    // Create stub vendor doc pre-filled with the business name/phone.
    // The merchant completes the rest (description, category, location) on first login.
    await db.collection("vendors").doc(uid).set({
      id: uid,
      name: businessName,
      description: "",
      merchantId: uid,
      userId: uid,
      ownerName: ownerName || null,
      ownerPhone: ownerPhone,
      businessPhone: businessPhone,
      category: "",
      area: "",
      img: "",
      rating: 5.0,
      prepMins: 15,
      lat: null,
      lng: null,
      storeDiscountPct: 0,
      promos: [],
      active: false,
      status: "pending_setup",
      createdAt: now,
      createdBy: "admin",
    });

    res.status(201).json({
      vendorId: uid,
      email,
      password,
      merchantName: businessName,
      ownerName,
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


/* ── POST /api/admin/riders ────────────────────────────────────
 * Admin creates a rider (Saradhi) login account + rider doc.    */
router.post("/riders", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const { name, email, password, vehicle } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: "name, email and password are required" });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }

    const existing = await db.collection("users").where("email", "==", email).where("role", "==", "rider").get();
    if (!existing.empty) {
      return res.status(409).json({ error: "A rider account with this email already exists" });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const userRef = db.collection("users").doc();
    const uid = userRef.id;
    const now = new Date().toISOString();

    await userRef.set({
      uid, email, passwordHash,
      role: "rider",
      name,
      authProvider: "email",
      createdAt: now,
      createdBy: "admin",
    });

    // Rider doc — id must match uid so rider app can find it
    await db.collection("riders").doc(uid).set({
      id: uid,
      name,
      email,
      vehicle: vehicle || "Bike",
      status: "offline",
      rating: 5.0,
      deliveriesToday: 0,
      lat: null,
      lng: null,
      createdAt: now,
    });

    res.status(201).json({ riderId: uid, name, email, password });
  } catch (err) {
    console.error("POST /admin/riders:", err);
    res.status(500).json({ error: "Failed to create rider: " + err.message });
  }
});

module.exports = router;
