require("dotenv").config();

const express = require("express");
const rateLimit = require("express-rate-limit");
const helmet   = require("helmet");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

/* ── CORS ────────────────────────────────────────────────────── */
// In production, CORS_ORIGINS must be set explicitly — never allow wildcard (#25)
if (process.env.NODE_ENV === "production" && !process.env.CORS_ORIGINS) {
  console.error("FATAL: CORS_ORIGINS must be set in production. Refusing to start.");
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

app.use(express.json());
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
app.use("/api/payments",  require("./routes/payments"));
app.use("/api/riders",    require("./routes/riders"));
app.use("/api/customers", require("./routes/customers"));
app.use("/api/analytics", require("./routes/analytics"));
app.use("/api/admin",    require("./routes/admin"));
app.use("/api/settings",  require("./routes/settings"));

/* ── Expose Mapbox token safely ──────────────────────────────── */
app.get("/api/config", (req, res) => {
  res.json({ mapboxToken: process.env.MAPBOX_TOKEN || "", razorpayKeyId: process.env.RAZORPAY_KEY_ID || "" });
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

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Saardha API running on http://localhost:${PORT}`);
  seedAdmin();
});
