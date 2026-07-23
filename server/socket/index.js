const jwt = require("jsonwebtoken");
const { db } = require("../config/firebase");

/**
 * Set up Socket.io event handlers.
 * Clients must authenticate with their JWT immediately after connecting.
 *
 * Rooms:
 *   "admin"              — admin dashboard
 *   "vendor:<vendorId>"  — merchant watching their own vendor
 *   "customer:<custId>"  — customer tracking their orders
 *   "rider:<riderId>"    — rider app
 *
 * Security (#7, #8):
 *   - Room IDs are NEVER trusted from the client; they are derived from the JWT.
 *   - Riders cannot spoof their location by supplying a different riderId.
 *   - Merchants can only join their own vendor room (ownership verified against Firestore).
 *   - Customers' room ID is resolved from their userId, not supplied by the client.
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

  io.on("connection", async (socket) => {
    const { role, uid, name } = socket.user;
    console.log(`[WS] ${name} (${role}) connected`);

    // ── Auto-join rooms by role ──────────────────────────────────
    if (role === "admin") {
      socket.join("admin");
    }

    if (role === "rider") {
      // Rider room uses their UID — not a client-supplied ID
      socket.join(`rider:${uid}`);
    }

    if (role === "customer") {
      // Resolve customer profile ID from JWT uid; never from client
      try {
        const custSnap = await db.collection("customers").where("userId", "==", uid).limit(1).get();
        if (!custSnap.empty) {
          socket.customerId = custSnap.docs[0].id;
          socket.join(`customer:${socket.customerId}`);
        }
      } catch (e) {
        console.warn("[WS] Could not resolve customer room:", e.message);
      }
    }

    if (role === "merchant") {
      // Resolve vendor from JWT uid; join only their own vendor room
      try {
        const vendorSnap = await db.collection("vendors").where("merchantId", "==", uid).limit(1).get();
        if (!vendorSnap.empty) {
          socket.vendorId = vendorSnap.docs[0].id;
          socket.join(`vendor:${socket.vendorId}`);
        }
      } catch (e) {
        console.warn("[WS] Could not resolve vendor room:", e.message);
      }
    }

    // ── join:order — customer or rider subscribes to a specific order ──
    // Verify the caller actually has access to this order
    socket.on("join:order", async (orderId) => {
      try {
        const orderDoc = await db.collection("orders").doc(orderId).get();
        if (!orderDoc.exists) return;
        const order = orderDoc.data();

        const allowed =
          role === "admin" ||
          (role === "customer" && order.customerId === socket.customerId) ||
          (role === "rider"    && order.riderId    === uid) ||
          (role === "merchant" && order.vendorId   === socket.vendorId);

        if (allowed) {
          socket.join(`order:${orderId}`);
        }
      } catch (e) {
        console.warn("[WS] join:order error:", e.message);
      }
    });

    // ── Rider sends GPS position — ID is always from JWT, never from client ──
    socket.on("rider:location", ({ lat, lng }) => {
      if (role !== "rider") return; // only riders emit location

      const latN = Number(lat);
      const lngN = Number(lng);
      if (isNaN(latN) || isNaN(lngN) || latN < -90 || latN > 90 || lngN < -180 || lngN > 180) return;

      // Broadcast using the authenticated uid, not a client-supplied riderId
      io.to("admin").emit("rider:location", { riderId: uid, lat: latN, lng: lngN });
    });

    socket.on("disconnect", () => {
      console.log(`[WS] ${name} disconnected`);
    });
  });
}

module.exports = setupSocket;
