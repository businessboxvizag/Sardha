const jwt = require("jsonwebtoken");

/**
 * Set up Socket.io event handlers.
 * Clients must authenticate with their JWT immediately after connecting.
 *
 * Rooms:
 *   "admin"              — admin dashboard
 *   "vendor:<vendorId>"  — merchant watching a specific vendor
 *   "customer:<custId>"  — customer tracking their orders
 *   "rider:<riderId>"    — rider app (future mobile app)
 */
function setupSocket(io) {
  // Middleware: verify JWT on every connection
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error("No token"));

    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      socket.user = payload;
      next();
    } catch {
      next(new Error("Invalid token"));
    }
  });

  io.on("connection", (socket) => {
    const { role, uid, name } = socket.user;
    console.log(`[WS] ${name} (${role}) connected`);

    // ── Auto-join rooms by role ──────────────────────────────────
    if (role === "admin") {
      socket.join("admin");
    }
    if (role === "rider") {
      socket.join(`rider:${uid}`);
    }

    // ── Client-driven room subscriptions ────────────────────────
    socket.on("join:vendor", (vendorId) => {
      if (role === "merchant" || role === "admin") {
        socket.join(`vendor:${vendorId}`);
      }
    });

    socket.on("join:customer", (customerId) => {
      if (role === "customer") {
        socket.join(`customer:${customerId}`);
      }
    });

    socket.on("join:order", (orderId) => {
      // Customers track a specific order for live rider location
      socket.join(`order:${orderId}`);
    });

    // ── Rider sends their GPS position ───────────────────────────
    socket.on("rider:location", ({ riderId, lat, lng }) => {
      // Broadcast to admin and to any customer watching this rider
      io.to("admin").emit("rider:location", { riderId, lat, lng });
      io.to(`rider:${riderId}`).emit("rider:location", { riderId, lat, lng });
    });

    socket.on("disconnect", () => {
      console.log(`[WS] ${name} disconnected`);
    });
  });
}

module.exports = setupSocket;
