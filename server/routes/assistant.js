const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { db } = require("../config/firebase");

const router = express.Router();

// Store each Q&A so admin can review support quality (first-party, no sharing).
function logSupport(req, message, reply) {
  try {
    db.collection("support_logs").add({
      userId: (req.user && req.user.uid) || null,
      email: (req.user && req.user.email) || null,
      message, reply,
      at: new Date().toISOString(),
    });
  } catch (e) { /* logging must never break the reply */ }
}

const SYSTEM = `You are the in-app help assistant for Saardha, a local home-delivery app in India.
Help customers use the app, briefly and warmly. Key facts:
- Adding a shop: open the Scan tab and scan the shop's Saardha QR code (or upload a photo of the QR and tap "Scan this QR"). Only scanned shops appear under "My Stores".
- Ordering: open a shop, tap ADD on items to build your cart, open Cart (bottom-right), choose Cash on delivery or Pay online (UPI/Card via Razorpay), then Place order.
- Cart & Orders: the Cart tab has two sections — "Cart" (items you're buying) and "Orders" (Fresh orders you can track live, and Previous orders you can Reorder with one tap).
- Charges: item total + 18% GST + a delivery fee (typically a small flat fee shown at checkout).
- Tracking: tap any order to see the Saradhi (delivery rider) location and a live ETA on the map.
- Profile: set your photo, name, phone and date of birth, and log out there. You can be logged in on one device at a time.
- The Saardha button in the centre of the bottom bar opens this assistant any time.
Keep replies short (2-4 sentences), friendly, and specific to Saardha. If asked something unrelated, gently steer back to using the app. Never invent features that don't exist. If you don't know an order-specific detail (like a live ETA), tell the user to open the order to see it.`;

router.post("/", requireAuth, async (req, res) => {
  try {
    const message = (req.body.message || "").toString().slice(0, 1000).trim();
    if (!message) return res.status(400).json({ error: "message required" });

    const FALLBACK = "Quick help: scan a shop's QR from the Scan tab to add it, tap ADD on items, then open your cart (bottom-right) and place the order (cash or online). Track it live from the order. The Saardha button in the middle of the bottom bar opens me any time.";

    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      console.warn("assistant: GEMINI_API_KEY not set — returning canned help.");
      logSupport(req, message, FALLBACK);
      return res.json({ reply: FALLBACK });
    }

    const history = Array.isArray(req.body.history) ? req.body.history.slice(-6) : [];
    const contents = history.map((h) => ({
      role: h.role === "assistant" ? "model" : "user",
      parts: [{ text: String(h.text || "").slice(0, 1000) }],
    }));
    contents.push({ role: "user", parts: [{ text: message }] });

    const model = process.env.GEMINI_MODEL || "gemini-2.0-flash";

    let r;
    try {
      r = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": key },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: SYSTEM }] },
            contents,
            generationConfig: { temperature: 0.4, maxOutputTokens: 300 },
          }),
        }
      );
    } catch (netErr) {
      console.error("assistant: network error calling Gemini:", netErr && netErr.message);
      return res.json({ reply: FALLBACK });
    }

    // Surface the real reason in the server logs so misconfig is diagnosable.
    if (!r.ok) {
      const errText = await r.text().catch(() => "");
      console.error("assistant: Gemini returned HTTP " + r.status + " for model '" + model + "'. Body: " + errText.slice(0, 600));
      return res.json({ reply: FALLBACK });
    }

    const data = await r.json();
    const reply =
      data && data.candidates && data.candidates[0] &&
      data.candidates[0].content && data.candidates[0].content.parts &&
      data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text;

    if (!reply) {
      console.error("assistant: Gemini response had no text. Payload:", JSON.stringify(data).slice(0, 600));
      logSupport(req, message, FALLBACK);
      return res.json({ reply: FALLBACK });
    }
    logSupport(req, message, reply);
    res.json({ reply });
  } catch (err) {
    console.error("assistant:", err);
    res.status(500).json({ error: "The assistant is unavailable right now. Please try again." });
  }
});

module.exports = router;
