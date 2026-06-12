const express = require("express");
const { db } = require("../config/firebase");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

const toVendor = (doc) => ({ id: doc.id, ...doc.data() });

/* ── GET /api/vendors ───────────────────────────────────────── */
router.get("/", requireAuth, async (req, res) => {
  try {
    const snap = await db.collection("vendors").where("active", "==", true).get();
    res.json(snap.docs.map(toVendor));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch vendors" });
  }
});

/* ── GET /api/vendors/:id ───────────────────────────────────── */
router.get("/:id", requireAuth, async (req, res) => {
  try {
    const doc = await db.collection("vendors").doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: "Vendor not found" });
    res.json(toVendor(doc));
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch vendor" });
  }
});

/* ── POST /api/vendors (admin only) ────────────────────────── */
router.post("/", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const { name, category, area, img, lat, lng, prepMins } = req.body;
    if (!name) return res.status(400).json({ error: "name is required" });

    const now = new Date().toISOString();
    const ref = db.collection("vendors").doc();
    const vendor = {
      id: ref.id,
      name,
      category: category || "General",
      area: area || "—",
      img: img || "🏪",
      lat: lat || 12.95,
      lng: lng || 77.61,
      prepMins: prepMins || 15,
      rating: 5.0,
      active: true,
      createdAt: now,
    };
    await ref.set(vendor);
    res.status(201).json(vendor);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create vendor" });
  }
});

/* ── PUT /api/vendors/:id (admin only) ─────────────────────── */
router.put("/:id", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const ref = db.collection("vendors").doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: "Vendor not found" });

    const allowed = ["name", "category", "area", "img", "lat", "lng", "prepMins", "rating", "active"];
    const updates = {};
    allowed.forEach((k) => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });

    await ref.update(updates);
    const updated = await ref.get();
    res.json(toVendor(updated));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update vendor" });
  }
});

/* ── GET /api/vendors/:id/products ─────────────────────────── */
router.get("/:id/products", requireAuth, async (req, res) => {
  try {
    const snap = await db
      .collection("products")
      .where("vendorId", "==", req.params.id)
      .where("available", "==", true)
      .get();
    res.json(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch products" });
  }
});

/* ── POST /api/vendors/:id/products (merchant/admin) ───────── */
router.post("/:id/products", requireAuth, requireRole("merchant", "admin"), async (req, res) => {
  try {
    const { name, price, unit } = req.body;
    if (!name || price === undefined) {
      return res.status(400).json({ error: "name and price are required" });
    }
    const ref = db.collection("products").doc();
    const product = {
      id: ref.id,
      vendorId: req.params.id,
      name,
      price: Number(price),
      unit: unit || "piece",
      available: true,
      createdAt: new Date().toISOString(),
    };
    await ref.set(product);
    res.status(201).json(product);
  } catch (err) {
    res.status(500).json({ error: "Failed to create product" });
  }
});

/* ── PUT /api/vendors/:vid/products/:pid (merchant/admin) ───── */
router.put("/:vid/products/:pid", requireAuth, requireRole("merchant", "admin"), async (req, res) => {
  try {
    const ref = db.collection("products").doc(req.params.pid);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: "Product not found" });

    const allowed = ["name", "price", "unit", "available"];
    const updates = {};
    allowed.forEach((k) => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
    if (updates.price) updates.price = Number(updates.price);

    await ref.update(updates);
    const updated = await ref.get();
    res.json({ id: updated.id, ...updated.data() });
  } catch (err) {
    res.status(500).json({ error: "Failed to update product" });
  }
});

/* ── DELETE /api/vendors/:vid/products/:pid (merchant/admin) ── */
router.delete("/:vid/products/:pid", requireAuth, requireRole("merchant", "admin"), async (req, res) => {
  try {
    await db.collection("products").doc(req.params.pid).delete();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete product" });
  }
});

module.exports = router;
