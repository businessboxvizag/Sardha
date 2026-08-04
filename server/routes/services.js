/* =========================================================
 * Saardha — Services module: service vendors + catalog
 * /api/services/...
 *
 * A "service vendor" is a local services business (laundry,
 * tailoring, xerox, repairs, salon…). It is a SEPARATE model
 * from product "vendors" so the services vertical can evolve
 * independently. Service partners log in with role "service".
 * ========================================================= */
const express = require("express");
const bcrypt = require("bcryptjs");
const { db } = require("../config/firebase");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

// Strip internal fields before returning a service vendor
const toVendor = (doc) => {
  const d = doc.data();
  const { ownerUserId, ...safe } = d;
  return { id: doc.id, ...safe };
};

/* ── Resolve the service-vendor owned by the logged-in partner ── */
async function myVendor(uid) {
  const snap = await db.collection("serviceVendors").where("ownerUserId", "==", uid).limit(1).get();
  return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
}

/* ── GET /api/services/vendors ── active service businesses (any signed-in user) ── */
router.get("/vendors", requireAuth, async (req, res) => {
  try {
    const snap = await db.collection("serviceVendors").get();
    let vendors = snap.docs.map(toVendor).filter((v) => v.active !== false && v.status !== "inactive");
    if (req.query.pattern) vendors = vendors.filter((v) => (v.patterns || []).includes(req.query.pattern));
    if (req.query.category) vendors = vendors.filter((v) => v.categoryKey === req.query.category);
    res.json(vendors);
  } catch (err) { console.error("GET /services/vendors:", err); res.json([]); }
});

/* ── GET /api/services/vendors/:id ── one vendor + its catalog ── */
router.get("/vendors/:id", requireAuth, async (req, res) => {
  try {
    const doc = await db.collection("serviceVendors").doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: "Service business not found" });
    const itemsSnap = await db.collection("services").where("serviceVendorId", "==", req.params.id).get();
    const items = itemsSnap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((s) => s.active !== false);
    res.json({ vendor: toVendor(doc), items });
  } catch (err) { res.status(500).json({ error: "Failed to load service business" }); }
});

/* ── GET /api/services/mine ── the logged-in partner's own vendor + catalog ── */
router.get("/mine", requireAuth, requireRole("service", "admin"), async (req, res) => {
  try {
    const v = await myVendor(req.user.uid);
    if (!v) return res.json({ vendor: null, items: [] });
    const itemsSnap = await db.collection("services").where("serviceVendorId", "==", v.id).get();
    const items = itemsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const { ownerUserId, ...safe } = v;
    res.json({ vendor: safe, items });
  } catch (err) { res.status(500).json({ error: "Failed to load your business" }); }
});

/* ── POST /api/services/vendors ── admin onboards a service business + owner login ── */
router.post("/vendors", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const { name, email, password, categoryKey, area, patterns } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: "name, email and password are required" });
    if (String(password).length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });

    const existing = await db.collection("users").where("email", "==", email).where("role", "==", "service").get();
    if (!existing.empty) return res.status(409).json({ error: "A service account with this email already exists" });

    const passwordHash = await bcrypt.hash(password, 12);
    const userRef = db.collection("users").doc();
    const uid = userRef.id;
    const now = new Date().toISOString();

    await userRef.set({ uid, email, passwordHash, role: "service", name, authProvider: "email", createdAt: now, createdBy: "admin" });

    const vRef = db.collection("serviceVendors").doc();
    await vRef.set({
      name, ownerUserId: uid,
      categoryKey: categoryKey || "laundry",
      patterns: Array.isArray(patterns) && patterns.length ? patterns : ["pickup_drop"],
      area: area || "", img: "", lat: null, lng: null,
      rating: 5.0, ratingCount: 0, active: true, status: "active",
      createdAt: now, createdBy: "admin",
    });

    res.status(201).json({ serviceVendorId: vRef.id, email, password, name });
  } catch (err) { console.error("POST /services/vendors:", err); res.status(500).json({ error: "Failed to create service business" }); }
});

/* ── PATCH /api/services/vendors/:id ── admin or owner edits the business ── */
router.patch("/vendors/:id", requireAuth, requireRole("service", "admin"), async (req, res) => {
  try {
    const ref = db.collection("serviceVendors").doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: "Not found" });
    if (req.user.role === "service" && doc.data().ownerUserId !== req.user.uid) {
      return res.status(403).json({ error: "Not your business" });
    }
    const allowed = ["name", "categoryKey", "patterns", "area", "img", "lat", "lng", "active", "status"];
    const updates = {};
    allowed.forEach((k) => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
    ["lat", "lng"].forEach((k) => { if (updates[k] !== undefined && updates[k] !== null) updates[k] = Number(updates[k]); });
    await ref.update(updates);
    const fresh = await ref.get();
    res.json(toVendor(fresh));
  } catch (err) { res.status(500).json({ error: "Failed to update business" }); }
});

/* ── POST /api/services/vendors/:id/items ── add a bookable service ── */
router.post("/vendors/:id/items", requireAuth, requireRole("service", "admin"), async (req, res) => {
  try {
    const vRef = db.collection("serviceVendors").doc(req.params.id);
    const vDoc = await vRef.get();
    if (!vDoc.exists) return res.status(404).json({ error: "Business not found" });
    if (req.user.role === "service" && vDoc.data().ownerUserId !== req.user.uid) {
      return res.status(403).json({ error: "Not your business" });
    }
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: "Service name required" });
    const ref = db.collection("services").doc();
    const item = {
      serviceVendorId: req.params.id,
      name: String(name).trim(),
      description: req.body.description || "",
      img: req.body.img || "",
      pattern: req.body.pattern || "pickup_drop",
      priceType: req.body.priceType || "from",       // fixed | from | per_unit | quote
      price: Number(req.body.price) || 0,
      unitLabel: req.body.unitLabel || "",            // e.g. "per kg", "per page"
      durationMins: Number(req.body.durationMins) || 0,
      active: true,
      createdAt: new Date().toISOString(),
    };
    await ref.set(item);
    res.status(201).json({ id: ref.id, ...item });
  } catch (err) { res.status(500).json({ error: "Failed to add service" }); }
});

/* ── PATCH /api/services/items/:id ── edit / toggle a service ── */
router.patch("/items/:id", requireAuth, requireRole("service", "admin"), async (req, res) => {
  try {
    const ref = db.collection("services").doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: "Service not found" });
    if (req.user.role === "service") {
      const vDoc = await db.collection("serviceVendors").doc(doc.data().serviceVendorId).get();
      if (!vDoc.exists || vDoc.data().ownerUserId !== req.user.uid) return res.status(403).json({ error: "Not your service" });
    }
    const allowed = ["name", "description", "img", "pattern", "priceType", "price", "unitLabel", "durationMins", "active"];
    const updates = {};
    allowed.forEach((k) => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
    ["price", "durationMins"].forEach((k) => { if (updates[k] !== undefined) updates[k] = Number(updates[k]); });
    await ref.update(updates);
    const fresh = await ref.get();
    res.json({ id: fresh.id, ...fresh.data() });
  } catch (err) { res.status(500).json({ error: "Failed to update service" }); }
});

/* ── DELETE /api/services/items/:id ── remove a service ── */
router.delete("/items/:id", requireAuth, requireRole("service", "admin"), async (req, res) => {
  try {
    const ref = db.collection("services").doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: "Service not found" });
    if (req.user.role === "service") {
      const vDoc = await db.collection("serviceVendors").doc(doc.data().serviceVendorId).get();
      if (!vDoc.exists || vDoc.data().ownerUserId !== req.user.uid) return res.status(403).json({ error: "Not your service" });
    }
    await ref.delete();
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: "Failed to delete service" }); }
});

module.exports = router;
module.exports.myVendor = myVendor;
