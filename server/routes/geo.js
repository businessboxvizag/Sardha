/* =========================================================
 * Saardha — Geo helper: resolve a Google Maps link to coords
 * /api/geo/resolve
 *
 * Lets users set a location by pasting a Google Maps link instead
 * of using the (paid) Maps JS API. Long links carry the coordinates
 * in the URL; short "share" links (maps.app.goo.gl) redirect to one,
 * so we follow the redirect server-side and read the coordinates.
 * The raw link is always usable for navigation even if we can't
 * extract exact coordinates.
 * ========================================================= */
const express = require("express");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// SSRF guard: only ever fetch known Google/short-link hosts.
const ALLOWED_HOST = /(?:^|\.)google\.com$|(?:^|\.)goo\.gl$|(?:^|\.)app\.goo\.gl$|(?:^|\.)maps\.google\.com$/i;

// Pull lat/lng out of a Google Maps URL (or page text) in the common formats.
function extractCoords(str) {
  if (!str) return null;
  let m;
  m = str.match(/@(-?\d{1,3}\.\d{3,}),(-?\d{1,3}\.\d{3,})/);        if (m) return { lat: +m[1], lng: +m[2] };
  m = str.match(/!3d(-?\d{1,3}\.\d{3,})!4d(-?\d{1,3}\.\d{3,})/);    if (m) return { lat: +m[1], lng: +m[2] };
  m = str.match(/[?&](?:q|query|ll|daddr|destination|center|sll)=(-?\d{1,3}\.\d{3,}),\s*(-?\d{1,3}\.\d{3,})/);
  if (m) return { lat: +m[1], lng: +m[2] };
  return null;
}

router.post("/resolve", requireAuth, async (req, res) => {
  try {
    const raw = String(req.body.url || "").trim();
    if (!raw) return res.status(400).json({ error: "Paste a Google Maps link." });

    // 1) Long links carry coordinates directly — no network call needed.
    let coords = extractCoords(raw);
    let finalUrl = raw;

    // 2) Short links redirect to the long one; follow it (guarded hosts only).
    if (!coords) {
      let host;
      try { host = new URL(raw).hostname; } catch (e) { return res.status(400).json({ error: "That doesn't look like a valid link." }); }
      if (!ALLOWED_HOST.test(host)) {
        return res.status(400).json({ error: "Please paste a Google Maps link (google.com/maps or maps.app.goo.gl)." });
      }
      if (typeof fetch === "function") {
        try {
          const r = await fetch(raw, { redirect: "follow", headers: { "User-Agent": "Mozilla/5.0 (compatible; SaardhaBot/1.0)" } });
          finalUrl = r.url || raw;
          coords = extractCoords(finalUrl);
          if (!coords) { const body = await r.text().catch(() => ""); coords = extractCoords(body); }
        } catch (e) { /* leave coords null — the raw link still navigates */ }
      }
    }

    res.json({ lat: coords ? coords.lat : null, lng: coords ? coords.lng : null, url: finalUrl });
  } catch (err) {
    console.error("geo/resolve:", err);
    res.status(500).json({ error: "Could not read that link." });
  }
});

module.exports = router;
