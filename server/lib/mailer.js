/**
 * mailer.js — tiny email helper (reuses the Gmail SMTP already used for password resets).
 * Set SMTP_USER + SMTP_PASS (Gmail App Password) in the environment. No-op if unset.
 */
const nodemailer = require("nodemailer");

let _transport = null;
function getTransport() {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) return null;
  if (!_transport) {
    _transport = nodemailer.createTransport({
      service: "gmail",
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  return _transport;
}

async function sendMail(to, subject, html) {
  const t = getTransport();
  if (!t || !to) return false;
  try {
    await t.sendMail({ from: `"Saardha" <${process.env.SMTP_USER}>`, to, subject, html });
    return true;
  } catch (e) {
    console.error("sendMail failed:", e.message);
    return false;
  }
}

module.exports = { sendMail };
