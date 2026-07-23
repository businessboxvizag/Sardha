/**
 * Password reset routes
 *
 * POST /api/auth/forgot-password   { email, role }
 *   → generates a 1-hour token, stores in Firestore, emails a reset link
 *
 * POST /api/auth/reset-password    { token, newPassword }
 *   → validates token, updates passwordHash, deletes token
 *
 * Email is sent via nodemailer (Gmail SMTP).
 * Set SMTP_USER and SMTP_PASS (Gmail App Password) in Render env vars.
 */

const express    = require("express");
const crypto     = require("crypto");
const bcrypt     = require("bcryptjs");
const nodemailer = require("nodemailer");
const { db }     = require("../config/firebase");

const router = express.Router();

/* ── mail transport (lazy-initialised so missing env vars don't crash startup) ── */
function getTransport() {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) return null;
  return nodemailer.createTransport({
    service: "gmail",
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

const FRONTEND_URL = process.env.FRONTEND_URL || "https://sardha-b48f1.web.app";
const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

/* ── POST /api/auth/forgot-password ──────────────────────────── */
router.post("/forgot-password", async (req, res) => {
  // Always respond 200 so attackers can't enumerate registered emails
  const genericOk = () => res.json({ ok: true, message: "If that email is registered you will receive a reset link shortly." });

  try {
    const { email, role } = req.body;
    if (!email) return genericOk();

    const snap = await db.collection("users")
      .where("email", "==", email.toLowerCase().trim())
      .get();
    if (snap.empty) return genericOk();

    // Find the right doc (prefer role match; fall back to first)
    const targetDoc = (role ? snap.docs.find((d) => d.data().role === role) : null) || snap.docs[0];
    const user = targetDoc.data();

    // Don't reset Google-only accounts
    if (!user.passwordHash) return genericOk();

    // Create token
    const token     = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();

    await db.collection("password_resets").doc(token).set({
      userId: user.uid,
      email:  user.email,
      role:   user.role,
      expiresAt,
      createdAt: new Date().toISOString(),
    });

    // Determine reset URL based on role
    const portalPaths = { admin: "/admin/", merchant: "/merchant/", rider: "/rider/", customer: "/customer/" };
    const portalPath  = portalPaths[user.role] || "/customer/";
    const resetUrl    = `${FRONTEND_URL}${portalPath}?reset_token=${token}`;

    // Send email if SMTP is configured
    const transport = getTransport();
    if (transport) {
      await transport.sendMail({
        from:    `"Saardha" <${process.env.SMTP_USER}>`,
        to:      user.email,
        subject: "Reset your Saardha password",
        html: `
          <p>Hi ${user.name || "there"},</p>
          <p>We received a request to reset your Saardha password.</p>
          <p><a href="${resetUrl}" style="background:#f07830;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;display:inline-block">Reset Password</a></p>
          <p>This link expires in 1 hour. If you didn't request this, ignore this email.</p>
        `,
      });
    } else {
      // SMTP not configured — log token for manual testing
      console.warn("[reset] SMTP not configured. Reset URL:", resetUrl);
    }

    return genericOk();
  } catch (err) {
    console.error("forgot-password:", err);
    return genericOk(); // never reveal errors externally
  }
});

/* ── POST /api/auth/reset-password ───────────────────────────── */
router.post("/reset-password", async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({ error: "token and newPassword are required" });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters" });
    }

    const tokenDoc = await db.collection("password_resets").doc(token).get();
    if (!tokenDoc.exists) {
      return res.status(400).json({ error: "Invalid or expired reset link" });
    }

    const { userId, expiresAt } = tokenDoc.data();
    if (new Date(expiresAt) < new Date()) {
      await db.collection("password_resets").doc(token).delete();
      return res.status(400).json({ error: "Reset link has expired. Please request a new one." });
    }

    const newHash = await bcrypt.hash(newPassword, 12);

    // Update every user doc with this userId (covers multi-role accounts)
    const userSnap = await db.collection("users").where("uid", "==", userId).get();
    const batch = db.batch();
    userSnap.docs.forEach((d) => batch.update(d.ref, { passwordHash: newHash }));
    await batch.commit();

    // Invalidate token immediately
    await db.collection("password_resets").doc(token).delete();

    res.json({ ok: true, message: "Password updated successfully. You can now sign in." });
  } catch (err) {
    console.error("reset-password:", err);
    res.status(500).json({ error: "Failed to reset password" });
  }
});

module.exports = router;
