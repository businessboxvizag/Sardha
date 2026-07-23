const express = require("express");
const { db } = require("../config/firebase");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

const toVendor  = (doc) => ({ id: doc.id, ...doc.data() });
const toProduct = (doc) => ({ id: doc.id, ...doc.data() });

/* ── GET /api/vendors ───────────────────────────────────────── */
// Merchants see only their own vendors; customers/admin see all active
router.get("/", requireAuth, async (req, res) => {
  try {
    let snap;
    if (req.user.role === "merchant") {
      // Merchants see their own store regardless of active status (setup wizard)
      snap = await db.collection("vendors")
        .where("merchantId", "==", req.user.uid)
        .get();
    } else if (req.user.role === "admin") {
      // Admins see all stores including pending
      snap = await db.collection("vendors").get();
    } else {
      // Customers only see active stores
      snap = await db.collection("vendors").where("active", "==", true).get();
    }
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

/* ── POST /api/vendors — merchant creates their own store / admin creates any */
router.post("/", requireAuth, requireRole("merchant", "admin"), async (req, res) => {
  try {
    const { name, category, area, img, lat, lng, prepMins } = req.body;
    if (!name) return res.status(400).json({ error: "name is required" });

    // Merchants can only own one store
    if (req.user.role === "merchant") {
      const existing = await db.collection("vendors")
        .where("merchantId", "==", req.user.uid)
        .limit(1).get();
      if (!existing.empty) {
        return res.status(400).json({ error: "You already have a store. Edit it instead." });
      }
    }

    const now = new Date().toISOString();
    const ref = db.collection("vendors").doc();
    const vendor = {
      id: ref.id,
      name,
      category: category || "General",
      area: area || "—",
      img: img || "🏪",
      lat: lat || null,
      lng: lng || null,
      prepMins: prepMins || 15,
      rating: 5.0,
      active: true,
      merchantId: req.user.role === "merchant" ? req.user.uid : (req.body.merchantId || null),
      createdAt: now,
    };
    await ref.set(vendor);
    res.status(201).json(vendor);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create vendor" });
  }
});

/* ── PUT /api/vendors/:id — merchant edits their own / admin edits any */
router.put("/:id", requireAuth, requireRole("merchant", "admin"), async (req, res) => {
  try {
    const ref = db.collection("vendors").doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: "Vendor not found" });

    if (req.user.role === "merchant" && doc.data().merchantId !== req.user.uid) {
      return res.status(403).json({ error: "Not your store" });
    }

    const allowed = ["name", "category", "area", "img", "lat", "lng", "prepMins", "rating", "active", "status"];
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
    res.json(snap.docs.map(toProduct));
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch products" });
  }
});

/* ── POST /api/vendors/:id/products ────────────────────────── */
router.post("/:id/products", requireAuth, requireRole("merchant", "admin"), async (req, res) => {
  try {
    if (req.user.role === "merchant") {
      const vDoc = await db.collection("vendors").doc(req.params.id).get();
      if (!vDoc.exists || vDoc.data().merchantId !== req.user.uid) {
        return res.status(403).json({ error: "Not your store" });
      }
    }

    const { name, price, unit, qty } = req.body;
    if (!name) return res.status(400).json({ error: "name is required" });

    const ref = db.collection("products").doc();
    const product = {
      id: ref.id,
      vendorId: req.params.id,
      name,
      price: price !== undefined ? Number(price) : 0,
      unit: unit || "item",
      ...(qty !== undefined ? { qty: Number(qty) } : {}),
      available: true,
      createdAt: new Date().toISOString(),
    };
    await ref.set(product);
    res.status(201).json(product);
  } catch (err) {
    res.status(500).json({ error: "Failed to create product" });
  }
});

/* ── PUT /api/vendors/:vid/products/:pid ────────────────────── */
router.put("/:vid/products/:pid", requireAuth, requireRole("merchant", "admin"), async (req, res) => {
  try {
    if (req.user.role === "merchant") {
      const vDoc = await db.collection("vendors").doc(req.params.vid).get();
      if (!vDoc.exists || vDoc.data().merchantId !== req.user.uid) {
        return res.status(403).json({ error: "Not your store" });
      }
    }

    const ref = db.collection("products").doc(req.params.pid);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: "Product not found" });

    // Ensure product belongs to the requested vendor (#10)
    if (doc.data().vendorId !== req.params.vid) {
      return res.status(403).json({ error: "Product does not belong to this vendor" });
    }

    const allowed = ["name", "price", "unit", "qty", "available"];
    const updates = {};
    allowed.forEach((k) => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
    if (updates.price !== undefined) updates.price = Number(updates.price);
    if (updates.qty   !== undefined) updates.qty   = Number(updates.qty);

    await ref.update(updates);
    const updated = await ref.get();
    res.json(toProduct(updated));
  } catch (err) {
    res.status(500).json({ error: "Failed to update product" });
  }
});

/* ── DELETE /api/vendors/:vid/products/:pid ─────────────────── */
router.delete("/:vid/products/:pid", requireAuth, requireRole("merchant", "admin"), async (req, res) => {
  try {
    if (req.user.role === "merchant") {
      const vDoc = await db.collection("vendors").doc(req.params.vid).get();
      if (!vDoc.exists || vDoc.data().merchantId !== req.user.uid) {
        return res.status(403).json({ error: "Not your store" });
      }
    }
    const prodDoc = await db.collection("products").doc(req.params.pid).get();
    if (!prodDoc.exists) return res.status(404).json({ error: "Product not found" });

    // Ensure product belongs to the requested vendor (#10)
    if (prodDoc.data().vendorId !== req.params.vid) {
      return res.status(403).json({ error: "Product does not belong to this vendor" });
    }

    await db.collection("products").doc(req.params.pid).delete();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete product" });
  }
});

module.exports = router;
