const express = require("express");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const SYSTEM = `You are the in-app help assistant for Saardha, a local home-delivery app in India.
Help users use the app, briefly and warmly. Key facts:
- To add a shop: open the Scan tab and scan the shop's Saardha QR code. Only scanned shops appear under "My Stores".
- To order: open a shop, tap ADD on items, open the cart, choose Cash on delivery or Pay online, then Place order.
- Charges: items + 18% GST + a flat Rs 15 delivery fee.
- Tracking: the order page shows the Saradhi (delivery rider) location and a live ETA.
- Profile tab shows your details and Log out. You can only be logged in on one device at a time.
Keep replies short (2-4 sentences), friendly, and specific to Saardha. If asked something unrelated, gently steer back to using the app. Never invent features that don't exist.`;

router.post("/", requireAuth, async (req, res) => {
  try {
    const message = (req.body.message || "").toString().slice(0, 1000).trim();
    if (!message) return res.status(400).json({ error: "message required" });

    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      return res.json({
        reply: "Quick help: scan a shop's QR from the Scan tab to add it, tap ADD on items, then open your cart and place the order (cash or online). Track it live on the order page. Tap the ? guide anytime.",
      });
    }

    const history = Array.isArray(req.body.history) ? req.body.history.slice(-6) : [];
    const contents = history.map((h) => ({
      role: h.role === "assistant" ? "model" : "user",
      parts: [{ text: String(h.text || "").slice(0, 1000) }],
    }));
    contents.push({ role: "user", parts: [{ text: message }] });

    const model = process.env.GEMINI_MODEL || "gemini-2.0-flash";
    const r = await fetch(
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
    const data = await r.json();
    const reply =
      data && data.candidates && data.candidates[0] &&
      data.candidates[0].content && data.candidates[0].content.parts &&
      data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text;

    res.json({ reply: reply || "Sorry, I couldn't answer that. Try asking about adding a shop, ordering, payment, or tracking." });
  } catch (err) {
    console.error("assistant:", err);
    res.status(500).json({ error: "The assistant is unavailable right now. Please try again." });
  }
});

module.exports = router;
