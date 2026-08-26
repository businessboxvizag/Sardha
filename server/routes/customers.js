const express = require("express");
const { db, admin } = require("../config/firebase");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

/* ── GET /api/customers ─────────────────────────────────────── */
router.get("/", requireAuth, requireRole("merchant", "admin"), async (req, res) => {
  try {
    const snap = await db.collection("customers").get();
    const isAdmin = req.user.role === "admin";

    // Admin gets the full directory enriched with the account email + verification
    // status (joined from the users collection). Merchants get a minimal view.
    let usersByUid = {};
    if (isAdmin) {
      const usersSnap = await db.collection("users").get();
      usersSnap.docs.forEach((u) => { const d = u.data(); usersByUid[d.uid] = d; });
    }

    const customers = snap.docs.map((d) => {
      const data = d.data();
      const uid = data.userId;
      if (!isAdmin) { delete data.userId; return { id: d.id, name: data.name, phone: data.phone || null }; }
      const u = usersByUid[uid] || {};
      return {
        id: d.id, ...data,
        email: u.email || data.email || null,
        authProvider: u.authProvider || "email",
        emailVerified: data.emailVerified || u.emailVerified || false,
        phoneVerified: data.phoneVerified || u.phoneVerified || false,
      };
    });
    res.json(customers);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch customers" });
  }
});

/* ── GET /api/customers/me ───────────────────────────────────── */
router.get("/me", requireAuth, requireRole("customer"), async (req, res) => {
  try {
    const snap = await db
      .collection("customers")
      .where("userId", "==", req.user.uid)
      .limit(1)
      .get();
    if (snap.empty) return res.status(404).json({ error: "Customer profile not found" });
    const doc = snap.docs[0];
    res.json({ id: doc.id, ...doc.data() });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch customer profile" });
  }
});

/* ── PUT /api/customers/me ───────────────────────────────────── */
router.put("/me", requireAuth, requireRole("customer"), async (req, res) => {
  try {
    const snap = await db
      .collection("customers")
      .where("userId", "==", req.user.uid)
      .limit(1)
      .get();
    if (snap.empty) return res.status(404).json({ error: "Customer profile not found" });

    const ref = snap.docs[0].ref;
    const allowed = ["address", "lat", "lng", "name", "phone", "dob", "photoUrl", "gender", "addresses"];
    const updates = {};
    allowed.forEach((k) => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });

    await ref.update(updates);
    const updated = await ref.get();
    res.json({ id: updated.id, ...updated.data() });
  } catch (err) {
    res.status(500).json({ error: "Failed to update profile" });
  }
});

/* ── GET /api/customers/me/favorites ────────────────────────── */
router.get("/me/favorites", requireAuth, requireRole("customer"), async (req, res) => {
  try {
    const custSnap = await db
      .collection("customers")
      .where("userId", "==", req.user.uid)
      .limit(1)
      .get();
    if (custSnap.empty) return res.json([]);
    const custId = custSnap.docs[0].id;

    const doc = await db.collection("favorites").doc(custId).get();
    res.json(doc.exists ? (doc.data().vendorIds || []) : []);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch favorites" });
  }
});

/* ── POST /api/customers/me/favorites/toggle ────────────────── */
router.post("/me/favorites/toggle", requireAuth, requireRole("customer"), async (req, res) => {
  try {
    const { vendorId } = req.body;
    if (!vendorId) return res.status(400).json({ error: "vendorId required" });

    const custSnap = await db
      .collection("customers")
      .where("userId", "==", req.user.uid)
      .limit(1)
      .get();
    if (custSnap.empty) return res.status(404).json({ error: "Profile not found" });
    const custId = custSnap.docs[0].id;

    const ref = db.collection("favorites").doc(custId);
    const doc = await ref.get();
    let vendorIds = doc.exists ? (doc.data().vendorIds || []) : [];

    if (vendorIds.includes(vendorId)) {
      vendorIds = vendorIds.filter((v) => v !== vendorId);
    } else {
      vendorIds.push(vendorId);
    }

    await ref.set({ vendorIds }, { merge: true });
    res.json(vendorIds);
  } catch (err) {
    res.status(500).json({ error: "Failed to toggle favorite" });
  }
});

/* ── GET /api/customers/me/shops ── the customer's scanned stores (account-backed) ── */
router.get("/me/shops", requireAuth, requireRole("customer"), async (req, res) => {
  try {
    const snap = await db.collection("customers").where("userId", "==", req.user.uid).limit(1).get();
    if (snap.empty) return res.json([]);
    res.json(snap.docs[0].data().shops || []);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch stores" });
  }
});

/* ── POST /api/customers/me/shops  { vendorId } ── add a scanned store to the account ── */
router.post("/me/shops", requireAuth, requireRole("customer"), async (req, res) => {
  try {
    const { vendorId } = req.body;
    if (!vendorId) return res.status(400).json({ error: "vendorId required" });
    const snap = await db.collection("customers").where("userId", "==", req.user.uid).limit(1).get();
    if (snap.empty) return res.status(404).json({ error: "Profile not found" });
    const ref = snap.docs[0].ref;
    await ref.update({ shops: admin.firestore.FieldValue.arrayUnion(vendorId) });
    const updated = await ref.get();
    res.json(updated.data().shops || []);
  } catch (err) {
    console.error("POST /customers/me/shops:", err);
    res.status(500).json({ error: "Failed to add store" });
  }
});

/* ── Hidden stores ──────────────────────────────────────────────
 * New model: EVERY store is shown to every customer by default. A customer can
 * "remove" a store they don't want — that just hides it (adds it to hiddenShops).
 * Scanning the shop's QR again un-hides it. Nothing is ever locked. */
router.get("/me/hidden-shops", requireAuth, requireRole("customer"), async (req, res) => {
  try {
    const snap = await db.collection("customers").where("userId", "==", req.user.uid).limit(1).get();
    if (snap.empty) return res.json([]);
    res.json(snap.docs[0].data().hiddenShops || []);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch hidden stores" });
  }
});

// Hide (remove) a store from the customer's view.
router.post("/me/hidden-shops", requireAuth, requireRole("customer"), async (req, res) => {
  try {
    const { vendorId } = req.body;
    if (!vendorId) return res.status(400).json({ error: "vendorId required" });
    const snap = await db.collection("customers").where("userId", "==", req.user.uid).limit(1).get();
    if (snap.empty) return res.status(404).json({ error: "Profile not found" });
    const ref = snap.docs[0].ref;
    await ref.update({ hiddenShops: admin.firestore.FieldValue.arrayUnion(vendorId) });
    const updated = await ref.get();
    res.json(updated.data().hiddenShops || []);
  } catch (err) {
    console.error("POST /customers/me/hidden-shops:", err);
    res.status(500).json({ error: "Failed to hide store" });
  }
});

// Un-hide (restore) a store — used when a removed store's QR is scanned again.
router.delete("/me/hidden-shops/:vendorId", requireAuth, requireRole("customer"), async (req, res) => {
  try {
    const snap = await db.collection("customers").where("userId", "==", req.user.uid).limit(1).get();
    if (snap.empty) return res.status(404).json({ error: "Profile not found" });
    const ref = snap.docs[0].ref;
    await ref.update({ hiddenShops: admin.firestore.FieldValue.arrayRemove(req.params.vendorId) });
    const updated = await ref.get();
    res.json(updated.data().hiddenShops || []);
  } catch (err) {
    console.error("DELETE /customers/me/hidden-shops:", err);
    res.status(500).json({ error: "Failed to restore store" });
  }
});

/* ── DELETE /api/customers/me ── permanent account + data deletion ──
 * Required by Google Play: a user who can create an account must be able to
 * delete it (and their personal data) from inside the app. We remove the login
 * (users doc) and the customer profile, and strip personal identifiers from past
 * orders (order records are retained for the merchants' legitimate business/tax
 * purposes, but no longer tied to a person). */
router.delete("/me", requireAuth, requireRole("customer"), async (req, res) => {
  try {
    const uid = req.user.uid;
    const custSnap = await db.collection("customers").where("userId", "==", uid).limit(1).get();
    const customerId = custSnap.empty ? null : custSnap.docs[0].id;

    // 1) Anonymize this customer's orders (keep the sales record, drop the person).
    if (customerId) {
      const ordSnap = await db.collection("orders").where("customerId", "==", customerId).get();
      let batch = db.batch(); let n = 0;
      for (const d of ordSnap.docs) {
        batch.update(d.ref, {
          dropName: "Deleted user", dropPhone: null, deliverTo: "[account deleted]",
          deliverLat: null, deliverLng: null, deliverMapsUrl: null,
          prescriptionUrl: null, selfieUrl: null, deletedCustomer: true,
        });
        if (++n >= 400) { await batch.commit(); batch = db.batch(); n = 0; }
      }
      if (n) await batch.commit();
    }

    // 2) Delete support tickets raised by this customer.
    try {
      const tSnap = await db.collection("tickets").where("customerId", "==", customerId || "__none__").get();
      const tb = db.batch(); tSnap.docs.forEach((d) => tb.delete(d.ref)); if (tSnap.size) await tb.commit();
    } catch (e) { /* tickets collection may not exist */ }

    // 3) Delete the customer profile and the login account.
    if (customerId) await db.collection("customers").doc(customerId).delete();
    const userSnap = await db.collection("users").where("uid", "==", uid).get();
    const ub = db.batch(); userSnap.docs.forEach((d) => ub.delete(d.ref)); if (userSnap.size) await ub.commit();

    res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /customers/me:", err);
    res.status(500).json({ error: "Failed to delete account" });
  }
});

module.exports = router;
