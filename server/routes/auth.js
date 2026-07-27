const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { admin, db } = require("../config/firebase");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

/* ── helpers ────────────────────────────────────────────────── */
const crypto = require("crypto");

function signToken(user, sid) {
  return jwt.sign(
    { uid: user.uid, email: user.email, role: user.role, name: user.name, sid },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
  );
}

/* Rotate the user's active session id — this invalidates any other device
 * still holding an older token (single-device sign-in, #2). */
async function startSession(uid) {
  const sid = crypto.randomBytes(16).toString("hex");
  await db.collection("users").doc(uid).update({ sessionId: sid }).catch(() => {});
  return sid;
}

/** Non-blocking login audit — failure is silently ignored */
function logLogin(userId, email, role, ip, method, ua) {
  db.collection("logins").add({
    userId, email, role,
    ip: ip || "unknown",
    method: method || "email",
    ua: (ua || "").slice(0, 200),
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
    const { email, password, name, role, phone, dob, gender, consent, lat, lng } = req.body;
    const consentAt = consent ? new Date().toISOString() : null;

    if (!email || !password || !name || !role) {
      return res.status(400).json({ error: "email, password, name and role are required" });
    }
    // Admin accounts are seeded internally — never via public registration
    if (!["customer", "merchant", "rider"].includes(role)) {
      return res.status(400).json({ error: "role must be customer | merchant | rider" });
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

    // ── OTP gate (feature-flagged so it can't break signups until enabled) ──
    const REQUIRE_OTP = process.env.REQUIRE_SIGNUP_OTP === "true";
    let verifiedPhone = phone || null;
    let emailVerified = false, phoneVerified = false;
    if (REQUIRE_OTP && role === "customer") {
      try {
        const dec = jwt.verify(String(req.body.emailVerifyToken || ""), process.env.JWT_SECRET);
        if (dec.purpose !== "email_verify" || String(dec.email || "").toLowerCase() !== String(email).toLowerCase()) throw new Error("bad");
        emailVerified = true;
      } catch {
        return res.status(400).json({ error: "Please verify your email with the code we sent." });
      }
      try {
        const dec = await admin.auth().verifyIdToken(String(req.body.phoneToken || ""));
        if (!dec.phone_number) throw new Error("no phone");
        verifiedPhone = dec.phone_number;
        phoneVerified = true;
      } catch {
        return res.status(400).json({ error: "Please verify your phone number with the OTP." });
      }
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const userRef = db.collection("users").doc();
    const uid = userRef.id;
    const now = new Date().toISOString();

    await userRef.set({
      uid, email, passwordHash, role,
      name, phone: verifiedPhone, gender: gender || null, createdAt: now,
      emailVerified, phoneVerified, consentAt,
    });

    // Role-specific profile creation
    if (role === "customer") {
      await db.collection("customers").doc(uid).set({
        userId: uid, name,
        phone: verifiedPhone, dob: dob || null, gender: gender || null,
        address: null, addresses: [], lat: null, lng: null,
        emailVerified, phoneVerified, consentAt,
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
        img: "",
        rating: 5.0,
        prepMins: 15,
        lat: lat != null ? Number(lat) : null,
        lng: lng != null ? Number(lng) : null,
        status: "active",
        createdAt: now,
      });
    }

    logLogin(uid, email, role, clientIp(req), "email_register", req.headers["user-agent"]);

    const sid = await startSession(uid);
    const token = signToken({ uid, email, role, name }, sid);
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

    // Prefer the doc matching the requested role; fall back to any matching doc
    const roleDoc = role ? snap.docs.find((d) => d.data().role === role) : null;
    const anyDoc  = snap.docs[0];
    const authDoc = roleDoc || anyDoc; // use for password check

    const authUser = authDoc.data();
    if (!authUser.passwordHash) {
      return res.status(401).json({ error: "This account uses Google Sign-In" });
    }
    const ok = await bcrypt.compare(password, authUser.passwordHash);
    if (!ok) return res.status(401).json({ error: "Invalid credentials" });

    // Password verified. Now get/create the requested role account.
    let user = authUser;
    if (role && !roleDoc) {
      // No account for this role yet — auto-create one (customer only)
      if (role === "customer") {
        const now = new Date().toISOString();
        const newRef = db.collection("users").doc();
        const newUid = newRef.id;
        await newRef.set({
          uid: newUid, email: authUser.email, passwordHash: authUser.passwordHash,
          role: "customer", name: authUser.name, authProvider: "email",
          createdAt: now,
        });
        await db.collection("customers").doc(newUid).set({
          userId: newUid, name: authUser.name,
          address: null, lat: null, lng: null,
          joined: now.slice(0, 10), createdAt: now,
        });
        await db.collection("favorites").doc(newUid).set({ vendorIds: [] });
        user = { uid: newUid, email: authUser.email, role: "customer", name: authUser.name };
      } else {
        // Non-customer roles must be explicitly created by admin
        return res.status(403).json({ error: "No " + role + " account found for this email." });
      }
    }

    logLogin(user.uid, user.email, user.role, clientIp(req), "email", req.headers["user-agent"]);

    const sid = await startSession(user.uid);
    const token = signToken(user, sid);
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
      // Google Sign-In cannot create admin accounts; default to customer
      const userRole = ["customer", "merchant", "rider"].includes(role) ? role : "customer";
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
    logLogin(user.uid, user.email, user.role, clientIp(req), "google", req.headers["user-agent"]);

    const sid = await startSession(user.uid);
    const token = signToken(user, sid);
    res.json({ token, user: { uid: user.uid, email: user.email, role: user.role, name: user.name } });
  } catch (err) {
    console.error("google auth:", err);
    res.status(401).json({ error: "Google authentication failed" });
  }
});

/* ── Email OTP (signup verification) ─────────────────────────── */
const nodemailer = require("nodemailer");
function mailTransport() {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) return null;
  return nodemailer.createTransport({
    service: "gmail",
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}
const EMAIL_OTP_TTL_MS = 10 * 60 * 1000;

/* POST /api/auth/email-otp/send  { email } → emails a 6-digit code */
router.post("/email-otp/send", async (req, res) => {
  try {
    const email = String(req.body.email || "").toLowerCase().trim();
    if (!/\S+@\S+\.\S+/.test(email)) return res.status(400).json({ error: "Enter a valid email address." });

    const ref = db.collection("email_otps").doc(email);
    const existing = await ref.get();
    if (existing.exists) {
      const d = existing.data();
      if (d.lastSentAt && (Date.now() - new Date(d.lastSentAt).getTime()) < 30000) {
        return res.status(429).json({ error: "Please wait a few seconds before requesting another code." });
      }
    }

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const codeHash = await bcrypt.hash(code, 8);
    await ref.set({
      codeHash,
      expiresAt: new Date(Date.now() + EMAIL_OTP_TTL_MS).toISOString(),
      attempts: 0,
      lastSentAt: new Date().toISOString(),
    });

    const transport = mailTransport();
    if (transport) {
      await transport.sendMail({
        from: `"Saardha" <${process.env.SMTP_USER}>`,
        to: email,
        subject: "Your Saardha verification code",
        html: `<p>Your Saardha verification code is:</p>
               <p style="font-size:26px;font-weight:800;letter-spacing:5px">${code}</p>
               <p>It expires in 10 minutes. If you didn't request this, you can ignore this email.</p>`,
      });
    } else {
      console.warn("[email-otp] SMTP not configured. Code for " + email + " = " + code);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("email-otp/send:", err);
    res.status(500).json({ error: "Could not send the code. Please try again." });
  }
});

/* POST /api/auth/email-otp/verify  { email, code } → { verifyToken } */
router.post("/email-otp/verify", async (req, res) => {
  try {
    const email = String(req.body.email || "").toLowerCase().trim();
    const code = String(req.body.code || "").trim();
    if (!email || !code) return res.status(400).json({ error: "Email and code are required." });

    const ref = db.collection("email_otps").doc(email);
    const snap = await ref.get();
    if (!snap.exists) return res.status(400).json({ error: "Please request a code first." });

    const d = snap.data();
    if (new Date(d.expiresAt) < new Date()) { await ref.delete().catch(() => {}); return res.status(400).json({ error: "That code expired. Request a new one." }); }
    if ((d.attempts || 0) >= 5) { await ref.delete().catch(() => {}); return res.status(429).json({ error: "Too many attempts. Request a new code." }); }

    const ok = await bcrypt.compare(code, d.codeHash);
    if (!ok) { await ref.update({ attempts: (d.attempts || 0) + 1 }); return res.status(400).json({ error: "Incorrect code. Try again." }); }

    await ref.delete().catch(() => {});
    const verifyToken = jwt.sign({ purpose: "email_verify", email }, process.env.JWT_SECRET, { expiresIn: "20m" });
    res.json({ ok: true, verifyToken });
  } catch (err) {
    console.error("email-otp/verify:", err);
    res.status(500).json({ error: "Verification failed. Please try again." });
  }
});

/* ── POST /api/auth/check-email ─────────────────────────────── */
/* Returns whether an email is registered (+ name + authProvider).
   Used by the frontend to decide sign-in vs sign-up flow.       */
router.post("/check-email", async (req, res) => {
  try {
    const { email, role } = req.body;
    if (!email) return res.status(400).json({ error: "email required" });

    const snap = await db.collection("users").where("email", "==", email).get();
    if (snap.empty) return res.json({ exists: false });

    // For customers: any existing account with this email counts as "exists"
    // so they can log in and get a customer profile auto-created.
    const roleDoc = role ? snap.docs.find((d) => d.data().role === role) : null;
    const doc = roleDoc || snap.docs[0];

    const { name, authProvider } = doc.data();
    res.json({ exists: true, name: name || null, authProvider: authProvider || "email" });
  } catch (err) {
    console.error("check-email:", err);
    res.status(500).json({ error: "Check failed" });
  }
});

/* ── GET /api/auth/me ───────────────────────────────────────── */
router.get("/me", requireAuth, async (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
