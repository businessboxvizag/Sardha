/**
 * Seed Firestore with demo LOCAL SERVICES data (Pickup & Drop).
 * Usage:  node db/seedServices.js
 *
 * Creates 3 service businesses (laundry, tailoring, xerox), each with a
 * partner login (role "service") and a small catalogue. Safe to re-run —
 * it uses fixed doc IDs and overwrites.
 *
 * Partner logins (portal: /service/):
 *   sparkle@saardha.test   / service123   (Sparkle Laundry)
 *   stitchwell@saardha.test / service123  (StitchWell Tailors)
 *   quickprint@saardha.test / service123  (QuickPrint Xerox)
 */
require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const { db } = require("../config/firebase");
const bcrypt = require("bcryptjs");

const now = () => new Date().toISOString();

// Vizag-ish coordinates
const BUSINESSES = [
  {
    id: "sv_sparkle", userId: "su_sparkle", name: "Sparkle Laundry", email: "sparkle@saardha.test",
    categoryKey: "laundry", area: "Dwaraka Nagar", lat: 17.7280, lng: 83.3050,
    services: [
      { id: "svc_wash_iron", name: "Wash & Iron",       priceType: "per_unit", price: 40, unitLabel: "per kg" },
      { id: "svc_iron_only", name: "Steam Ironing",      priceType: "per_unit", price: 10, unitLabel: "per piece" },
      { id: "svc_dryclean",  name: "Dry Cleaning",       priceType: "from",     price: 90, unitLabel: "per piece" },
    ],
  },
  {
    id: "sv_stitch", userId: "su_stitch", name: "StitchWell Tailors", email: "stitchwell@saardha.test",
    categoryKey: "tailoring", area: "MVP Colony", lat: 17.7420, lng: 83.3350,
    services: [
      { id: "svc_alter",   name: "Alteration (fit/length)", priceType: "from", price: 60, unitLabel: "per garment" },
      { id: "svc_blouse",  name: "Blouse Stitching",        priceType: "from", price: 350, unitLabel: "" },
      { id: "svc_fall",    name: "Saree Fall & Pico",       priceType: "fixed", price: 80, unitLabel: "" },
    ],
  },
  {
    id: "sv_print", userId: "su_print", name: "QuickPrint Xerox", email: "quickprint@saardha.test",
    categoryKey: "printing", area: "Gajuwaka", lat: 17.6800, lng: 83.2000,
    services: [
      { id: "svc_bw",    name: "B/W Xerox",        priceType: "per_unit", price: 1,  unitLabel: "per page" },
      { id: "svc_color", name: "Colour Print",     priceType: "per_unit", price: 10, unitLabel: "per page" },
      { id: "svc_bind",  name: "Spiral Binding",   priceType: "fixed",    price: 40, unitLabel: "" },
    ],
  },
];

async function run() {
  const passwordHash = await bcrypt.hash("service123", 12);
  for (const b of BUSINESSES) {
    await db.collection("users").doc(b.userId).set({
      uid: b.userId, email: b.email, passwordHash, role: "service",
      name: b.name, authProvider: "email", createdAt: now(), createdBy: "seed",
    });
    await db.collection("serviceVendors").doc(b.id).set({
      name: b.name, ownerUserId: b.userId, categoryKey: b.categoryKey,
      patterns: ["pickup_drop"], area: b.area, img: "", lat: b.lat, lng: b.lng,
      rating: 5.0, ratingCount: 0, deliveryFee: 30, active: true, status: "active",
      createdAt: now(), createdBy: "seed",
    });
    for (const s of b.services) {
      await db.collection("services").doc(s.id).set({
        serviceVendorId: b.id, name: s.name, description: "", img: "",
        pattern: "pickup_drop", priceType: s.priceType, price: s.price,
        unitLabel: s.unitLabel || "", durationMins: 0, active: true, createdAt: now(),
      });
    }
    console.log("Seeded", b.name, "with", b.services.length, "services");
  }
  console.log("\nDone. Partner logins (portal /service/), password: service123");
  BUSINESSES.forEach((b) => console.log("  " + b.email));
  process.exit(0);
}

run().catch((e) => { console.error("Seed failed:", e); process.exit(1); });
