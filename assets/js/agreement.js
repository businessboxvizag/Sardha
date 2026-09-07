/* flik Merchant Partner Agreement — single source of truth (version + text).
 * Loaded by the merchant and admin apps. Rendered read-only in admin; signable in merchant.
 * NOTE: template for the flik pilot — have a lawyer review before commercial launch. */
(function (global) {
  var A = {
    version: "1.0",
    effective: "September 2026",
    title: "flik Merchant Partner Agreement",
    intro: "This Merchant Partner Agreement (“Agreement”) is between flik, operated by BusinessBOX, Visakhapatnam (“flik”, “we”), and the merchant accepting it (“Merchant”, “you”). By tapping “Sign agreement” you agree to the terms below for listing and selling your products on flik.",
    sections: [
      { h: "1. Listing on flik", p: [
        "flik lists your store and products so nearby customers can order from you. Orders are delivered by flik delivery partners (“flik Pilots”).",
        "You keep your catalogue, prices, stock and store timings accurate and up to date."
      ]},
      { h: "2. Zero commission", p: [
        "flik charges you 0% commission on the price of your items — you keep the full item value of every delivered order.",
        "The customer pays a separate delivery fee to flik for the delivery service; it is not deducted from your item value."
      ]},
      { h: "3. Payments & daily settlement (9-to-9 cycle)", p: [
        "flik collects the order amount from the customer (online) or via the flik Pilot (cash on delivery) and settles your item value to your registered bank / UPI account on a daily 9-to-9 cycle:",
        "•  Orders delivered between 10:00 AM and 8:00 PM are settled to you by 9:00 PM the same day.",
        "•  Orders delivered between 8:00 PM and 10:00 AM (overnight) are settled to you by 9:00 AM.",
        "Settlements cover successfully delivered, non-cancelled orders. Cancelled, undelivered, refunded or disputed orders are excluded and reconciled in a later cycle."
      ]},
      { h: "4. Your responsibilities", p: [
        "Accept or reject new orders promptly, and hand over correctly prepared, well-packed orders to the flik Pilot on time.",
        "Sell only genuine, safe, good-quality items at the listed prices, and never list prohibited or illegal items.",
        "Hold and maintain every licence your business needs (e.g. FSSAI for food, a valid drug licence for pharmacy) and follow all hygiene, safety and legal requirements."
      ]},
      { h: "5. Pricing & taxes", p: [
        "You set your own prices, inclusive of any taxes you must charge. You are solely responsible for your own tax compliance, including GST where applicable."
      ]},
      { h: "6. Cancellations & refunds", p: [
        "Orders are cancelled and refunded in line with flik’s customer policy in force at the time."
      ]},
      { h: "7. Term & termination", p: [
        "This Agreement continues until ended by either party with reasonable notice. flik may suspend or remove your store immediately for fraud, unsafe or illegal items, repeated quality/hygiene failures, or breach of this Agreement.",
        "On termination, flik settles any amounts genuinely due to you for delivered orders per the cycle above."
      ]},
      { h: "8. Data & confidentiality", p: [
        "Each party protects the other’s confidential information. flik handles personal data per its Privacy Policy and applicable law (including the Digital Personal Data Protection Act, 2023)."
      ]},
      { h: "9. Liability", p: [
        "You are responsible for the items you sell — their quality, safety and description. flik is not liable for issues arising from your items or your breach of law; each party’s liability is limited to the extent permitted by law."
      ]},
      { h: "10. Governing law & disputes", p: [
        "This Agreement is governed by the laws of India; the courts at Visakhapatnam, Andhra Pradesh have jurisdiction, subject to good-faith efforts to resolve disputes amicably first."
      ]}
    ],
    note: "Template provided for the flik pilot — pending review by a qualified lawyer before commercial launch. Not legal advice."
  };
  global.FLIK_AGREEMENT = A;
})(typeof window !== "undefined" ? window : this);
