const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { db } = require("../config/firebase");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

/* ── helpers ────────────────────────────────────────────────── */
function signToken(user) {
  return jwt.sign(
    { uid: user.uid, email: user.email, role: user.role, name: user.name },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
  );
}

/* ── POST /api/auth/register ────────────────────────────────── */
router.post("/register", async (req, res) => {
  try {
    const { email, password, name, role, phone } = req.body;

    if (!email || !password || !name || !role) {
      return res.status(400).json({ error: "email, password, name and role are required" });
    }
    if (!["customer", "merchant", "admin"].includes(role)) {
      return res.status(400).json({ error: "role must be customer | merchant | admin" });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }

    // Check email uniqueness
    const existing = await db.collection("users").where("email", "==", email).get();
    if (!existing.empty) {
      return res.status(409).json({ error: "Email already registered" });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const userRef = db.collection("users").doc();
    const uid = userRef.id;
    const now = new Date().toISOString();

    const userData = { uid, email, passwordHash, role, name, phone: phone || null, createdAt: now };
    await userRef.set(userData);

    // Create role-specific profile
    if (role === "customer") {
      await db.collection("customers").doc(uid).set({
        userId: uid,
        name,
        address: null,
        lat: null,
        lng: null,
        joined: now.slice(0, 10),
        createdAt: now,
      });
      // Initialize favorites doc
      await db.collection("favorites").doc(uid).set({ vendorIds: [] });
    }

    const token = signToken({ uid, email, role, name });
    res.status(201).json({ token, user: { uid, email, role, name } });
  } catch (err) {
    console.error("register:", err);
    res.status(500).json({ error: "Registration failed" });
  }
});

/* ── POST /api/auth/login ───────────────────────────────────── */
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "email and password required" });
    }

    const snap = await db.collection("users").where("email", "==", email).limit(1).get();
    if (snap.empty) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const user = snap.docs[0].data();
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = signToken(user);
    res.json({ token, user: { uid: user.uid, email: user.email, role: user.role, name: user.name } });
  } catch (err) {
    console.error("login:", err);
    res.status(500).json({ error: "Login failed" });
  }
});

/* ── GET /api/auth/me ───────────────────────────────────────── */
router.get("/me", requireAuth, async (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
