/**
 * support.js — two-way customer ⇄ support tickets.
 *
 * A ticket belongs to a customer, may reference an order, and holds a thread of
 * messages. Customers create tickets and reply on their own; admins see every
 * ticket, reply, and change status. Real-time nudges go out over socket.io to the
 * customer's room and the admin room.
 *
 * Collection: support_tickets
 *   { id, customerId, customerName, orderId?, subject, status, messages:[{from,byUid,byName,text,at}],
 *     createdAt, updatedAt, lastMessageAt }
 *   status: "open" | "awaiting_customer" | "resolved" | "closed"
 */
const express = require("express");
const { db } = require("../config/firebase");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();
const COL = "support_tickets";
const now = () => new Date().toISOString();

// Resolve the signed-in customer's profile id + name.
async function customerFor(uid) {
  const snap = await db.collection("customers").where("userId", "==", uid).limit(1).get();
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...snap.docs[0].data() };
}

function emitTicket(io, ticket) {
  if (!io) return;
  io.to("admin").emit("support:updated", ticket);
  io.to("customer:" + ticket.customerId).emit("support:updated", ticket);
}

/* ── POST /api/support  (customer opens a ticket) ── */
router.post("/", requireAuth, requireRole("customer"), async (req, res) => {
  try {
    const subject = String(req.body.subject || "").trim().slice(0, 140);
    const message = String(req.body.message || "").trim().slice(0, 2000);
    const orderId = req.body.orderId ? String(req.body.orderId) : null;
    if (!subject || !message) return res.status(400).json({ error: "Subject and message are required" });

    const cust = await customerFor(req.user.uid);
    if (!cust) return res.status(400).json({ error: "Customer profile not found" });

    // If an order is referenced, make sure it belongs to this customer.
    if (orderId) {
      const od = await db.collection("orders").doc(orderId).get();
      if (!od.exists || od.data().customerId !== cust.id) return res.status(400).json({ error: "That order isn't yours" });
    }

    const ref = db.collection(COL).doc();
    const ts = now();
    const ticket = {
      id: ref.id,
      customerId: cust.id,
      customerName: cust.name || req.user.name || "Customer",
      orderId,
      subject,
      status: "open",
      messages: [{ from: "customer", byUid: req.user.uid, byName: cust.name || "Customer", text: message, at: ts }],
      createdAt: ts, updatedAt: ts, lastMessageAt: ts,
    };
    await ref.set(ticket);
    emitTicket(req.app.get("io"), ticket);
    res.json(ticket);
  } catch (err) {
    console.error("POST /support:", err);
    res.status(500).json({ error: "Failed to open ticket" });
  }
});

/* ── GET /api/support/mine  (customer's own tickets) ── */
router.get("/mine", requireAuth, requireRole("customer"), async (req, res) => {
  try {
    const cust = await customerFor(req.user.uid);
    if (!cust) return res.json([]);
    const snap = await db.collection(COL).where("customerId", "==", cust.id).get();
    const list = snap.docs.map((d) => d.data()).sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt));
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch tickets" });
  }
});

/* ── GET /api/support  (admin: all tickets) ── */
router.get("/", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const snap = await db.collection(COL).get();
    const list = snap.docs.map((d) => d.data()).sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt));
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch tickets" });
  }
});

/* ── GET /api/support/:id  (owner customer or admin) ── */
router.get("/:id", requireAuth, async (req, res) => {
  try {
    const doc = await db.collection(COL).doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: "Ticket not found" });
    const t = doc.data();
    if (req.user.role === "customer") {
      const cust = await customerFor(req.user.uid);
      if (!cust || t.customerId !== cust.id) return res.status(403).json({ error: "Not your ticket" });
    } else if (req.user.role !== "admin") {
      return res.status(403).json({ error: "Forbidden" });
    }
    res.json(t);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch ticket" });
  }
});

/* ── POST /api/support/:id/messages  (owner customer or admin replies) ── */
router.post("/:id/messages", requireAuth, async (req, res) => {
  try {
    const text = String(req.body.text || "").trim().slice(0, 2000);
    if (!text) return res.status(400).json({ error: "Message is required" });

    const ref = db.collection(COL).doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: "Ticket not found" });
    const t = doc.data();

    let from, byName;
    if (req.user.role === "admin") {
      from = "support"; byName = req.user.name || "Support";
    } else if (req.user.role === "customer") {
      const cust = await customerFor(req.user.uid);
      if (!cust || t.customerId !== cust.id) return res.status(403).json({ error: "Not your ticket" });
      from = "customer"; byName = cust.name || "Customer";
    } else {
      return res.status(403).json({ error: "Forbidden" });
    }
    if (t.status === "closed") return res.status(400).json({ error: "This ticket is closed. Open a new one if you still need help." });

    const ts = now();
    const msg = { from, byUid: req.user.uid, byName, text, at: ts };
    const updates = {
      messages: [...(t.messages || []), msg],
      updatedAt: ts, lastMessageAt: ts,
      // Support reply → awaiting the customer; customer reply → back to open.
      status: from === "support" ? "awaiting_customer" : "open",
    };
    await ref.update(updates);
    const updated = { ...t, ...updates };
    emitTicket(req.app.get("io"), updated);
    res.json(updated);
  } catch (err) {
    console.error("POST /support/:id/messages:", err);
    res.status(500).json({ error: "Failed to send message" });
  }
});

/* ── PATCH /api/support/:id  (admin sets status) ── */
router.patch("/:id", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const status = req.body.status;
    if (!["open", "awaiting_customer", "resolved", "closed"].includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }
    const ref = db.collection(COL).doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: "Ticket not found" });
    const updates = { status, updatedAt: now() };
    await ref.update(updates);
    const updated = { ...doc.data(), ...updates };
    emitTicket(req.app.get("io"), updated);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: "Failed to update ticket" });
  }
});

module.exports = router;
