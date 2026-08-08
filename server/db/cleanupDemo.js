/**
 * cleanupDemo.js — remove ALL seeded demo data before going live.
 *
 * Deletes exactly the fixed-ID / known-email records created by db/seed.js and
 * db/seedServices.js (5 vendors, 17 products, 5 riders, 3 demo customers + their
 * users/profiles/favorites, 4 historical orders, and the 3 demo service partners),
 * plus a safety sweep of any user whose email is on a demo domain
 * (@demo.bw / @saardha.test) and any bookings tied to the demo service vendors.
 *
 * It NEVER touches the env-seeded production admin (ADMIN_EMAIL) or any account /
 * store a real merchant or customer created.
 *
 * USAGE:
 *   node db/cleanupDemo.js         # DRY RUN — lists what would be deleted, changes nothing
 *   node db/cleanupDemo.js --yes   # actually delete
 */
require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const { db } = require("../config/firebase");

const APPLY = process.argv.includes("--yes");
const DEMO_EMAIL_DOMAINS = ["@demo.bw", "@saardha.test"];

// Fixed IDs created by the seeders.
const IDS = {
  vendors:   ["v_kirana", "v_chaat", "v_florist", "v_pharma", "v_bakery"],
  products:  Array.from({ length: 17 }, (_, i) => "p" + (i + 1)),
  riders:    ["r1", "r2", "r3", "r4", "r5"],
  users:     ["c_srinivas", "c_anita", "c_rohit", "admin1", "m_bakery", "m_chaat", "su_sparkle", "su_stitch", "su_print"],
  customers: ["c_srinivas", "c_anita", "c_rohit"],
  favorites: ["c_srinivas", "c_anita", "c_rohit"],
  orders:    ["ord_1", "ord_2", "ord_3", "ord_4"],
  serviceVendors: ["sv_sparkle", "sv_stitch", "sv_print"],
};

// Collections that use the service-vendor set (bookings may reference them).
const DEMO_SERVICE_VENDOR_SET = new Set(IDS.serviceVendors);

async function existingIds(collection, ids) {
  const found = [];
  for (const id of ids) {
    const doc = await db.collection(collection).doc(id).get();
    if (doc.exists) found.push(id);
  }
  return found;
}

async function main() {
  console.log(`\n🧹 Demo-data cleanup — ${APPLY ? "APPLY (will delete)" : "DRY RUN (no changes)"}\n`);

  // Resolve which fixed-ID docs actually exist.
  const plan = {};
  for (const [coll, ids] of Object.entries(IDS)) {
    const collName = coll === "serviceVendors" ? "service_vendors" : coll;
    plan[collName] = await existingIds(collName, ids);
  }

  // Safety sweep: any user on a demo email domain (covers renamed/duplicated demo users).
  const usersSnap = await db.collection("users").get();
  const demoDomainUserIds = usersSnap.docs
    .filter((d) => {
      const e = String(d.data().email || "").toLowerCase();
      return DEMO_EMAIL_DOMAINS.some((dom) => e.endsWith(dom));
    })
    .map((d) => d.id);
  plan.users = Array.from(new Set([...(plan.users || []), ...demoDomainUserIds]));

  // Bookings tied to demo service vendors.
  let demoBookingIds = [];
  try {
    const bookingsSnap = await db.collection("bookings").get();
    demoBookingIds = bookingsSnap.docs
      .filter((d) => DEMO_SERVICE_VENDOR_SET.has(d.data().serviceVendorId || d.data().vendorId))
      .map((d) => d.id);
  } catch (e) { /* bookings collection may not exist */ }
  if (demoBookingIds.length) plan.bookings = demoBookingIds;

  // Report.
  let totalDocs = 0;
  for (const [coll, ids] of Object.entries(plan)) {
    if (!ids.length) continue;
    totalDocs += ids.length;
    console.log(`  ${coll.padEnd(16)} ${ids.length}  [${ids.join(", ")}]`);
  }
  if (totalDocs === 0) { console.log("  Nothing to delete — database is already clean.\n"); process.exit(0); }

  console.log(`\n  TOTAL: ${totalDocs} documents.`);
  const keptAdmin = process.env.ADMIN_EMAIL ? ` (production admin ${process.env.ADMIN_EMAIL} is preserved)` : "";
  console.log(`  Real merchant/customer data is untouched${keptAdmin}.\n`);

  if (!APPLY) {
    console.log("  DRY RUN only. Re-run with --yes to delete.\n");
    process.exit(0);
  }

  // Delete in batches of 400.
  let batch = db.batch(), n = 0, done = 0;
  for (const [coll, ids] of Object.entries(plan)) {
    for (const id of ids) {
      batch.delete(db.collection(coll).doc(id));
      n++; done++;
      if (n >= 400) { await batch.commit(); batch = db.batch(); n = 0; }
    }
  }
  if (n > 0) await batch.commit();

  console.log(`  ✅ Deleted ${done} demo documents.\n`);
  process.exit(0);
}

main().catch((err) => { console.error("cleanupDemo failed:", err); process.exit(1); });
