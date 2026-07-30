/**
 * Partner API-key auth for the Delivery-as-a-Service platform.
 * Businesses authenticate to /api/partner/* with a header:
 *    x-api-key: <key>   (or  Authorization: Bearer <key>)
 * Keys are stored only as SHA-256 hashes; the raw key is shown once at creation.
 */
const crypto = require("crypto");
const { db } = require("../config/firebase");

function hashKey(key) {
  return crypto.createHash("sha256").update(String(key)).digest("hex");
}
function generateKey() {
  return "sk_live_" + crypto.randomBytes(24).toString("hex");
}

async function requirePartner(req, res, next) {
  const raw = req.headers["x-api-key"] || (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!raw) return res.status(401).json({ error: "API key required (send it in the x-api-key header)" });
  try {
    const snap = await db.collection("partners").where("apiKeyHash", "==", hashKey(raw)).limit(1).get();
    if (snap.empty) return res.status(401).json({ error: "Invalid API key" });
    const partner = { id: snap.docs[0].id, ...snap.docs[0].data() };
    if (partner.status && partner.status !== "active") {
      return res.status(403).json({ error: "This partner account is " + partner.status + "." });
    }
    delete partner.apiKeyHash;
    req.partner = partner;
    next();
  } catch (e) {
    console.error("partner auth:", e && e.message);
    res.status(500).json({ error: "Authentication failed" });
  }
}

module.exports = { requirePartner, hashKey, generateKey };
