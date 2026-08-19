require("dotenv").config();

const express = require("express");
const rateLimit = require("express-rate-limit");
const helmet   = require("helmet");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

// Behind Render's (and Firebase Hosting's) reverse proxy the real client IP arrives
// in X-Forwarded-For. Trust one proxy hop so rate limiting keys on the actual client,
// not the shared proxy IP (without this, express-rate-limit also throws in v7+).
app.set("trust proxy", 1);

/* ── Startup safety checks ───────────────────────────────────── */
// In production, CORS_ORIGINS must be set explicitly — never allow wildcard (#25)
if (process.env.NODE_ENV === "production" && !process.env.CORS_ORIGINS) {
  console.error("FATAL: CORS_ORIGINS must be set in production. Refusing to start.");
  process.exit(1);
}
// JWT_SECRET signs every session token — refuse to boot prod without it.
if (process.env.NODE_ENV === "production" && !process.env.JWT_SECRET) {
  console.error("FATAL: JWT_SECRET must be set in production. Refusing to start.");
  process.exit(1);
}
const allowedOrigins = (process.env.CORS_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);

app.use(
  cors({
    origin: allowedOrigins.length ? allowedOrigins : "*",
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

/* ── Body parsing ────────────────────────────────────────────── */
/* ── Rate limiting ───────────────────────────────────── */
const limiterDefaults = {
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." },
};
// Auth endpoints (#27)
const authLimiter = rateLimit({ ...limiterDefaults, windowMs: 15 * 60 * 1000, max: 30 });
// Order placement — prevent spam ordering
const orderLimiter = rateLimit({ ...limiterDefaults, windowMs: 60 * 1000, max: 10 });
// General API calls
const apiLimiter = rateLimit({ ...limiterDefaults, windowMs: 60 * 1000, max: 120 });
// Costly endpoints: payments (hits Razorpay) and the AI assistant (hits Gemini).
const paymentLimiter   = rateLimit({ ...limiterDefaults, windowMs: 60 * 1000, max: 20 });
const assistantLimiter = rateLimit({ ...limiterDefaults, windowMs: 60 * 1000, max: 20 });

app.use(express.json({ limit: "512kb" }));
app.use(helmet()); // Security headers: CSP, HSTS, X-Content-Type-Options, etc. (#23)

/* ── Socket.io ───────────────────────────────────────────────── */
const io = new Server(server, {
  cors: {
    origin: allowedOrigins.length ? allowedOrigins : "*",
    methods: ["GET", "POST"],
  },
});
app.set("io", io); // routes access io via req.app.get("io")

require("./socket")(io);

/* ── API Routes ──────────────────────────────────────────────── */
app.use("/api/public",    require("./routes/public"));
app.use("/files",         require("express").static(require("path").join(__dirname, "public")));   // no auth — scan page
app.use("/api/auth",      authLimiter, require("./routes/auth"));
app.use("/api/auth",      authLimiter, require("./routes/reset"));
app.use("/api/vendors",   apiLimiter,  require("./routes/vendors"));
app.use("/api/orders",    orderLimiter, require("./routes/orders"));
app.use("/api/services",  apiLimiter,  require("./routes/services"));   // local-services catalog
app.use("/api/bookings",  orderLimiter, require("./routes/bookings"));  // services booking engine
app.use("/api/geo",       apiLimiter,  require("./routes/geo"));        // Google Maps link → coords
app.use("/api/payments",  paymentLimiter,   require("./routes/payments"));
app.use("/api/assistant", assistantLimiter, require("./routes/assistant"));
app.use("/api/events",    apiLimiter, require("./routes/events"));
app.use("/api/partner",   apiLimiter, require("./routes/partner"));
app.use("/api/riders",    apiLimiter, require("./routes/riders"));
app.use("/api/customers", apiLimiter, require("./routes/customers"));
app.use("/api/analytics", apiLimiter, require("./routes/analytics"));
app.use("/api/admin",     apiLimiter, require("./routes/admin"));
app.use("/api/settings",  apiLimiter, require("./routes/settings"));
app.use("/api/support",   apiLimiter, require("./routes/support"));   // customer ⇄ support tickets
app.use("/api/rewards",   apiLimiter, require("./routes/rewards"));   // gold-coins loyalty
app.use("/api/push",      apiLimiter, require("./routes/push"));      // web-push subscriptions

/* ── Expose Mapbox token safely ──────────────────────────────── */
app.get("/api/config", (req, res) => {
  res.json({
    mapboxToken: process.env.MAPBOX_TOKEN || "",
    googleMapsKey: process.env.GOOGLE_MAPS_KEY || "",
    razorpayKeyId: process.env.RAZORPAY_KEY_ID || "",
    cloudinaryCloud: process.env.CLOUDINARY_CLOUD_NAME || "",
    cloudinaryPreset: process.env.CLOUDINARY_UPLOAD_PRESET || "",
    // When true, customer signup requires verified email OTP + phone OTP.
    requireSignupOtp: process.env.REQUIRE_SIGNUP_OTP === "true",
    // Feature flags. v1 ships products-only; Local Services (Pickup & Drop) is built
    // but hidden until v2. Set FEATURES_SERVICES=true to switch the whole module on.
    features: {
      services: process.env.FEATURES_SERVICES === "true",
    },
    // Web Push public key (empty string disables push on the client).
    vapidPublicKey: require("./lib/push").publicKey(),
  });
});

/* ── Health check ────────────────────────────────────────────── */
app.get("/health", (req, res) => res.json({ ok: true, ts: Date.now() }));

/* ── 404 fallback ────────────────────────────────────────────── */
app.use((req, res) => res.status(404).json({ error: "Not found" }));

/* ── Global error handler ────────────────────────────────────── */
app.use((err, req, res, _next) => {
  // Log full details server-side; never expose internals to clients (#26)
  console.error(`[ERROR] ${req.method} ${req.path}`, err);
  const isProd = process.env.NODE_ENV === "production";
  res.status(err.status || 500).json({
    error: isProd ? "Internal server error" : (err.message || "Internal server error"),
  });
});

/* ── Start ───────────────────────────────────────────────────── */

/* ── Seed admin account on startup ──────────────────────── */
async function seedAdmin() {
  // Credentials are ONLY read from environment variables — never hard-coded (#1)
  const ADMIN_EMAIL    = process.env.ADMIN_EMAIL;
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    console.warn("seedAdmin: ADMIN_EMAIL / ADMIN_PASSWORD env vars not set — skipping.");
    return;
  }
  try {
    const { db } = require("./config/firebase");
    const bcrypt = require("bcryptjs");
    // Always re-hash from env var so the env var is the single source of truth
    const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);
    const snap = await db.collection("users")
      .where("email", "==", ADMIN_EMAIL)
      .where("role",  "==", "admin")
      .get();
    if (snap.empty) {
      const ref = db.collection("users").doc();
      await ref.set({
        uid: ref.id, email: ADMIN_EMAIL, passwordHash,
        role: "admin", name: "Admin", phone: null,
        createdAt: new Date().toISOString(),
      });
      console.log("Admin user created in Firestore");
    } else {
      await snap.docs[0].ref.update({ passwordHash });
      console.log("Admin password refreshed from env var");
    }
  } catch (err) {
    console.error("seedAdmin failed:", err.message);
  }
}

/* ── Escalate unaccepted orders ───────────────────────────────
 * If a merchant hasn't accepted an order within 5 minutes of it being placed,
 * alert every admin (Web Push + email) so the team can call the store. Each
 * order is escalated only once. Runs every minute while the server is awake. */
async function escalateStaleOrders() {
  try {
    const { db } = require("./config/firebase");
    const push = require("./lib/push");
    const { sendMail } = require("./lib/mailer");
    const cutoff = Date.now() - 5 * 60 * 1000;
    const snap = await db.collection("orders").where("status", "==", "PLACED").get();
    const stale = snap.docs.filter((d) => !d.data().escalatedAt && new Date(d.data().createdAt).getTime() < cutoff);
    if (!stale.length) return;

    // Admin recipients (uids for push, emails for mail).
    const adminSnap = await db.collection("users").where("role", "==", "admin").get();
    const adminUids = adminSnap.docs.map((d) => d.id);
    const adminEmails = adminSnap.docs.map((d) => d.data().email).filter(Boolean);

    for (const d of stale) {
      const o = d.data();
      await d.ref.update({ escalatedAt: new Date().toISOString() });
      let vendor = {};
      try { const vd = await db.collection("vendors").doc(o.vendorId).get(); vendor = vd.exists ? vd.data() : {}; } catch (e) {}
      const store = vendor.name || "a store";
      const phone = vendor.businessPhone || vendor.ownerPhone || "—";
      const title = "⚠️ Order not accepted";
      const body = "#" + (o.orderNo || "") + " at " + store + " — waiting 5+ min. Call " + phone;
      adminUids.forEach((uid) => push.sendToUser(uid, { title, body, tag: "escalate-" + o.id, url: "/admin/" }).catch(() => {}));
      const html = "<p><b>Order #" + (o.orderNo || "") + "</b> at <b>" + store + "</b> hasn't been accepted for over 5 minutes.</p>" +
        "<p>Store phone: <b>" + phone + "</b></p><p>Please call the merchant and ask them to accept it in the Saardha merchant app.</p>";
      if (adminEmails.length) sendMail(adminEmails.join(","), "⚠️ Saardha: order not accepted (" + store + ")", html);
      console.log("[escalate] order", o.orderNo, "at", store, "→ admins notified");
    }
  } catch (e) { console.error("escalateStaleOrders:", e.message); }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Saardha API running on http://localhost:${PORT}`);
  seedAdmin();
  setInterval(escalateStaleOrders, 60 * 1000);   // check every minute
});
