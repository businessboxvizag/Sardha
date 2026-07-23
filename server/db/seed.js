/**
 * Seed Firestore with Saardha demo data.
 * Usage: node db/seed.js
 *
 * Creates:
 *   - 5 vendors
 *   - 17 products
 *   - 5 riders
 *   - 3 demo customer users + customer profiles
 *   - 4 historical orders
 *   - Favorites for demo customers
 *   - 1 demo admin user
 */
require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

const { db } = require("../config/firebase");
const bcrypt = require("bcryptjs");

const now = () => new Date().toISOString();
const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
};

/* ─────────────────────────────────────────────── */
const VENDORS = [
  { id: "v_kirana",  name: "Sharma Kirana Store",  category: "Groceries",   area: "MG Road",      rating: 4.6, lat: 12.9758, lng: 77.6045, prepMins: 10, img: "🛒" },
  { id: "v_chaat",   name: "Gupta Chaat Corner",   category: "Street Food", area: "Brigade Road",  rating: 4.8, lat: 12.9716, lng: 77.6101, prepMins: 15, img: "🥘" },
  { id: "v_florist", name: "Lily & Marigold",       category: "Florist",     area: "Indiranagar",   rating: 4.4, lat: 12.9719, lng: 77.6412, prepMins: 8,  img: "💐" },
  { id: "v_pharma",  name: "HealthFirst Pharmacy",  category: "Pharmacy",    area: "Koramangala",   rating: 4.7, lat: 12.9352, lng: 77.6245, prepMins: 5,  img: "💊" },
  { id: "v_bakery",  name: "Daily Bread Bakery",    category: "Bakery",      area: "Jayanagar",     rating: 4.5, lat: 12.9250, lng: 77.5938, prepMins: 12, img: "🥖" },
];

const PRODUCTS = [
  { id: "p1",  vendorId: "v_kirana",  name: "Toor Dal (1kg)",        price: 145, unit: "pack"   },
  { id: "p2",  vendorId: "v_kirana",  name: "Basmati Rice (5kg)",     price: 520, unit: "bag"    },
  { id: "p3",  vendorId: "v_kirana",  name: "Sunflower Oil (1L)",     price: 165, unit: "bottle" },
  { id: "p4",  vendorId: "v_kirana",  name: "Tea Powder (500g)",      price: 240, unit: "pack"   },
  { id: "p5",  vendorId: "v_chaat",   name: "Pani Puri (plate)",      price: 60,  unit: "plate"  },
  { id: "p6",  vendorId: "v_chaat",   name: "Samosa Chaat",           price: 80,  unit: "plate"  },
  { id: "p7",  vendorId: "v_chaat",   name: "Dahi Vada",              price: 70,  unit: "plate"  },
  { id: "p8",  vendorId: "v_chaat",   name: "Masala Dosa",            price: 90,  unit: "plate"  },
  { id: "p9",  vendorId: "v_florist", name: "Rose Bouquet",           price: 450, unit: "bunch"  },
  { id: "p10", vendorId: "v_florist", name: "Marigold Garland",       price: 120, unit: "string" },
  { id: "p11", vendorId: "v_florist", name: "Mixed Flowers",          price: 350, unit: "bunch"  },
  { id: "p12", vendorId: "v_pharma",  name: "Paracetamol Strip",      price: 30,  unit: "strip"  },
  { id: "p13", vendorId: "v_pharma",  name: "Vitamin C (60 tabs)",    price: 280, unit: "bottle" },
  { id: "p14", vendorId: "v_pharma",  name: "Antiseptic Liquid",      price: 95,  unit: "bottle" },
  { id: "p15", vendorId: "v_bakery",  name: "Whole Wheat Loaf",       price: 55,  unit: "loaf"   },
  { id: "p16", vendorId: "v_bakery",  name: "Chocolate Cake (500g)",  price: 420, unit: "box"    },
  { id: "p17", vendorId: "v_bakery",  name: "Butter Croissant",       price: 65,  unit: "piece"  },
];

const RIDERS = [
  { id: "r1", name: "Arjun Mehta",  phone: "+91 98450 11111", vehicle: "Bike",    status: "available",   lat: 12.9740, lng: 77.6080, shift: "Morning", deliveriesToday: 4, rating: 4.7 },
  { id: "r2", name: "Priya Nair",   phone: "+91 98450 22222", vehicle: "Scooter", status: "available",   lat: 12.9700, lng: 77.6200, shift: "Morning", deliveriesToday: 6, rating: 4.9 },
  { id: "r3", name: "Imran Khan",   phone: "+91 98450 33333", vehicle: "Bike",    status: "on_delivery", lat: 12.9360, lng: 77.6250, shift: "Evening", deliveriesToday: 3, rating: 4.5 },
  { id: "r4", name: "Lakshmi Rao",  phone: "+91 98450 44444", vehicle: "Cycle",   status: "available",   lat: 12.9260, lng: 77.5950, shift: "Morning", deliveriesToday: 5, rating: 4.6 },
  { id: "r5", name: "Vikram Singh", phone: "+91 98450 55555", vehicle: "Scooter", status: "offline",     lat: 12.9719, lng: 77.6412, shift: "Evening", deliveriesToday: 0, rating: 4.4 },
];

// Demo users: email + password (plaintext for seeding only)
const DEMO_USERS = [
  { uid: "c_srinivas", email: "srinivas@demo.bw", password: "demo1234", role: "customer", name: "Srinivas P",   phone: "+91 99000 11111" },
  { uid: "c_anita",    email: "anita@demo.bw",    password: "demo1234", role: "customer", name: "Anita Desai",  phone: "+91 99000 22222" },
  { uid: "c_rohit",    email: "rohit@demo.bw",    password: "demo1234", role: "customer", name: "Rohit Verma",  phone: "+91 99000 33333" },
  { uid: "admin1",     email: "admin@demo.bw",    password: "admin1234",role: "admin",    name: "Platform Admin", phone: null },
  { uid: "m_bakery",   email: "bakery@demo.bw",   password: "demo1234", role: "merchant", name: "Daily Bread Bakery", phone: "+91 80000 11111", vendorId: "v1" },
  { uid: "m_chaat",    email: "chaat@demo.bw",    password: "demo1234", role: "merchant", name: "Gupta Chaat Corner",  phone: "+91 80000 22222", vendorId: "v2" },
];

const CUSTOMER_PROFILES = [
  { userId: "c_srinivas", name: "Srinivas P",  address: "12, 4th Cross, Koramangala", lat: 12.9352, lng: 77.6245, joined: "2025-11-02" },
  { userId: "c_anita",    name: "Anita Desai", address: "7, Brigade Road",             lat: 12.9716, lng: 77.6101, joined: "2025-12-15" },
  { userId: "c_rohit",    name: "Rohit Verma", address: "21, Indiranagar 100ft Rd",    lat: 12.9719, lng: 77.6412, joined: "2026-01-20" },
];

function makeOrder(id, customerId, vendorId, items, riderId, createdAt, status) {
  const prodMap = Object.fromEntries(PRODUCTS.map((p) => [p.id, p]));
  const lineItems = items.map(([pid, qty]) => ({
    productId: pid,
    name: prodMap[pid].name,
    price: prodMap[pid].price,
    qty,
  }));
  const subtotal = lineItems.reduce((s, l) => s + l.price * l.qty, 0);
  return {
    id,
    customerId,
    vendorId,
    riderId,
    status,
    items: lineItems,
    subtotal,
    deliveryFee: 25,
    total: subtotal + 25,
    history: [{ status, at: createdAt }],
    createdAt,
    updatedAt: createdAt,
  };
}

/* ─────────────────────────────────────────────── */
async function seed() {
  console.log("🌱 Seeding Firestore…");
  const batch = db.batch();

  // Vendors
  for (const v of VENDORS) {
    batch.set(db.collection("vendors").doc(v.id), { ...v, active: true, createdAt: now() });
  }

  // Products
  for (const p of PRODUCTS) {
    batch.set(db.collection("products").doc(p.id), { ...p, available: true, createdAt: now() });
  }

  // Riders
  for (const r of RIDERS) {
    batch.set(db.collection("riders").doc(r.id), { ...r, createdAt: now() });
  }

  await batch.commit();
  console.log("  ✓ vendors, products, riders");

  // Users (bcrypt is async — can't use batch)
  for (const u of DEMO_USERS) {
    const passwordHash = await bcrypt.hash(u.password, 12);
    await db.collection("users").doc(u.uid).set({
      uid: u.uid,
      email: u.email,
      passwordHash,
      role: u.role,
      name: u.name,
      phone: u.phone,
      createdAt: now(),
    });
  }
  console.log("  ✓ users");

  // Customer profiles + favorites
  const profBatch = db.batch();
  for (const cp of CUSTOMER_PROFILES) {
    profBatch.set(db.collection("customers").doc(cp.userId), { ...cp, createdAt: now() });
  }
  profBatch.set(db.collection("favorites").doc("c_srinivas"), { vendorIds: ["v_chaat"] });
  profBatch.set(db.collection("favorites").doc("c_anita"),    { vendorIds: [] });
  profBatch.set(db.collection("favorites").doc("c_rohit"),    { vendorIds: [] });
  await profBatch.commit();
  console.log("  ✓ customer profiles + favorites");

  // Historical orders
  const orderBatch = db.batch();
  const orders = [
    makeOrder("ord_1", "c_anita",    "v_chaat",   [["p5",2],["p6",1]], "r2", daysAgo(2), "DELIVERED"),
    makeOrder("ord_2", "c_rohit",    "v_florist", [["p9",1]],          "r1", daysAgo(1), "DELIVERED"),
    makeOrder("ord_3", "c_srinivas", "v_kirana",  [["p1",1],["p3",2]], "r4", daysAgo(1), "DELIVERED"),
    makeOrder("ord_4", "c_anita",    "v_bakery",  [["p16",1],["p17",3]],"r2", now(),     "OUT_FOR_DELIVERY"),
  ];
  for (const o of orders) {
    orderBatch.set(db.collection("orders").doc(o.id), o);
  }
  await orderBatch.commit();
  console.log("  ✓ historical orders");

  console.log("\n✅ Seed complete!\n");
  console.log("Demo logins:");
  for (const u of DEMO_USERS) {
    console.log(`  ${u.role.padEnd(10)} ${u.email}  /  ${u.password}`);
  }
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
