require("dotenv").config();

const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

/* ── CORS ────────────────────────────────────────────────────── */
const allowedOrigins = (process.env.CORS_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);

app.use(
  cors({
    origin: allowedOrigins.length ? allowedOrigins : "*",
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

/* ── Body parsing ────────────────────────────────────────────── */
app.use(express.json());

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
app.use("/api/public",    require("./routes/public"));   // no auth — scan page
app.use("/api/auth",      require("./routes/auth"));
app.use("/api/vendors",   require("./routes/vendors"));
app.use("/api/orders",    require("./routes/orders"));
app.use("/api/riders",    require("./routes/riders"));
app.use("/api/customers", require("./routes/customers"));
app.use("/api/analytics", require("./routes/analytics"));

/* ── Expose Mapbox token safely ──────────────────────────────── */
app.get("/api/config", (req, res) => {
  res.json({ mapboxToken: process.env.MAPBOX_TOKEN || "" });
});

/* ── Health check ────────────────────────────────────────────── */
app.get("/health", (req, res) => res.json({ ok: true, ts: Date.now() }));

/* ── 404 fallback ────────────────────────────────────────────── */
app.use((req, res) => res.status(404).json({ error: "Not found" }));

/* ── Global error handler ────────────────────────────────────── */
app.use((err, req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || "Internal server error" });
});

/* ── Start ───────────────────────────────────────────────────── */
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Business Wheels API running on http://localhost:${PORT}`);
});
