const jwt = require("jsonwebtoken");
const { db } = require("../config/firebase");

/**
 * Verify JWT issued by our own /api/auth/login endpoint.
 * Attaches req.user = { uid, email, role, name } on success.
 */
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "No token provided" });
  }

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
  req.user = payload; // { uid, email, role, name, sid }

  // Single-device sign-in (#2): the token's session must still be the active one.
  // Older tokens without a sid are left valid so nobody is force-logged-out on deploy.
  if (payload.sid && payload.uid) {
    try {
      const doc = await db.collection("users").doc(payload.uid).get();
      const current = doc.exists ? doc.data().sessionId : null;
      if (current && current !== payload.sid) {
        return res.status(401).json({ error: "session_superseded" });
      }
    } catch (e) { /* fail open if the lookup errors */ }
  }

  next();
}

/**
 * Role guard factory.  Usage: requireRole("admin")
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "Not authenticated" });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: `Requires role: ${roles.join(" or ")}` });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };
