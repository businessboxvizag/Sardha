const Razorpay = require("razorpay");
const crypto = require("crypto");

const keyId = process.env.RAZORPAY_KEY_ID || "";
const keySecret = process.env.RAZORPAY_KEY_SECRET || "";

// null when keys aren't set (e.g. a COD-only deployment) — routes guard on this.
const instance = keyId && keySecret
  ? new Razorpay({ key_id: keyId, key_secret: keySecret })
  : null;

// Authenticate a Razorpay Checkout callback. Signs order_id|payment_id with the
// key secret and compares in constant time to the signature the browser sent.
function verifySignature(orderId, paymentId, signature) {
  if (!keySecret || !signature) return false;
  const expected = crypto
    .createHmac("sha256", keySecret)
    .update(orderId + "|" + paymentId)
    .digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { instance, keyId, keySecret, verifySignature };
