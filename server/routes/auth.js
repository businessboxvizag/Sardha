const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { admin, db } = require("../config/firebase");
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

/** Non-blocking login audit — failure is silently ignored */
function logLogin(userId, email, role, ip, method) {
  db.collection("logins").add({
    userId, email, role,
    ip: ip || "unknown",
    method: method || "email",
    at: new Date().toISOString(),
  }).catch(() => {});
}

function clientIp(req) {
  return (req.headers["x-forwarded-for"] || "").split(",")[0].trim()
    || req.socket.remoteAddress
    || "unknown";
}

/* ── POST /api/auth/register ────────────────────────────────── */
router.post("/register", async (req, res) => {
  try {
    const { email, password, name, role, phone, lat, lng } = req.body;

    if (!email || !password || !name || !role) {
      return res.status(400).json({ error: "email, password, name and role are required" });
    }
    if (!["customer", "merchant", "admin", "rider"].includes(role)) {
      return res.status(400).json({ error: "role must be customer | merchant | admin | rider" });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }

    // Allow same email for different roles — block duplicate email+role combos
    const existing = await db.collection("users").where("email", "==", email).get();
    const sameRole = existing.docs.find((d) => d.data().role === role);
    if (sameRole) {
      return res.status(409).json({ error: "Email already registered for this role" });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const userRef = db.collection("users").doc();
    const uid = userRef.id;
    const now = new Date().toISOString();

    await userRef.set({
      uid, email, passwordHash, role,
      name, phone: phone || null, createdAt: now,
    });

    // Role-specific profile creation
    if (role === "customer") {
      await db.collection("customers").doc(uid).set({
        userId: uid, name,
        address: null, lat: null, lng: null,
        joined: now.slice(0, 10), createdAt: now,
      });
      await db.collection("favorites").doc(uid).set({ vendorIds: [] });
    }

    if (role === "merchant") {
      // Vendor doc uses uid as its ID so the merchant can always find it
      await db.collection("vendors").doc(uid).set({
        id: uid,
        name: name + "'s Store",
        userId: uid,
        category: "General",
        area: "",
        img: "🏪",
        rating: 5.0,
        prepMins: 15,
        lat: lat != null ? Number(lat) : null,
        lng: lng != null ? Number(lng) : null,
        status: "active",
        createdAt: now,
      });
    }

    logLogin(uid, email, role, clientIp(req), "email_register");

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
    const { email, password, role } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "email and password required" });
    }

    const snap = await db.collection("users").where("email", "==", email).get();
    if (snap.empty) return res.status(401).json({ error: "Invalid credentials" });

    // If a role is specified prefer that account; otherwise use the first match
    const doc = role
      ? (snap.docs.find((d) => d.data().role === role) || snap.docs[0])
      : snap.docs[0];

    const user = doc.data();
    if (!user.passwordHash) {
      return res.status(401).json({ error: "This account uses Google Sign-In" });
    }
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: "Invalid credentials" });

    logLogin(user.uid, user.email, user.role, clientIp(req), "email");

    const token = signToken(user);
    res.json({ token, user: { uid: user.uid, email: user.email, role: user.role, name: user.name } });
  } catch (err) {
    console.error("login:", err);
    res.status(500).json({ error: "Login failed" });
  }
});

/* ── POST /api/auth/google ──────────────────────────────────── */
router.post("/google", async (req, res) => {
  try {
    const { idToken, role } = req.body;
    if (!idToken) return res.status(400).json({ error: "idToken required" });

    const decoded = await admin.auth().verifyIdToken(idToken);
    const { uid, email, name: firebaseName, picture } = decoded;

    let userSnap = await db.collection("users").doc(uid).get();

    if (!userSnap.exists) {
      const now = new Date().toISOString();
      const userRole = ["customer", "merchant", "admin", "rider"].includes(role) ? role : "customer";
      const name = firebaseName || (email ? email.split("@")[0] : "User");

      await db.collection("users").doc(uid).set({
        uid, email, passwordHash: null, role: userRole,
        name, phone: null, authProvider: "google",
        photoURL: picture || null, createdAt: now,
      });

      if (userRole === "customer") {
        await db.collection("customers").doc(uid).set({
          userId: uid, name, address: null, lat: null, lng: null,
          joined: now.slice(0, 10), createdAt: now,
        });
        await db.collection("favorites").doc(uid).set({ vendorIds: [] });
      }
      if (userRole === "merchant") {
        await db.collection("vendors").doc(uid).set({
          id: uid, name: name + "'s Store", userId: uid,
          category: "General", area: "", img: "🏪",
          rating: 5.0, prepMins: 15, lat: null, lng: null,
          status: "active", createdAt: now,
        });
      }

      userSnap = await db.collection("users").doc(uid).get();
    }

    const user = userSnap.data();
    logLogin(user.uid, user.email, user.role, clientIp(req), "google");

    const token = signToken(user);
    res.json({ token, user: { uid: user.uid, email: user.email, role: user.role, name: user.name } });
  } catch (err) {
    console.error("google auth:", err);
    res.status(401).json({ error: "Google authentication failed" });
  }
});

/* ── GET /api/auth/me ───────────────────────────────────────── */
router.get("/me", requireAuth, async (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
