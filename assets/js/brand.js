/**
 * brand.js — single source of truth for the app's identity.
 *
 * A rebrand (e.g. "Saardha" → "StreetOn") should be done by editing THIS file and
 * swapping the image assets — not by find-and-replace across the codebase. Every app
 * reads window.BRAND, so one change flips the name, tagline, support details, and
 * social handles everywhere. Colors live in assets/css/styles.css (:root variables).
 *
 * When the new name is confirmed, change `name`, `nameLower`, `tagline`, the domain
 * and handles below, replace the logo/icon image files, and update the four
 * manifest.json files' `name`/`short_name`. That's the whole rebrand.
 */
(function (global) {
  var BRAND = {
    name: "flik",                 // ← display name (change to "StreetOn" when confirmed)
    nameLower: "flik",
    tagline: "Your local market. One swipe away.",
    company: "BusinessBOX, Visakhapatnam",
    // Contact / support
    supportPhone: "+918688669816",
    supportEmail: "support@saardha.app",
    instagram: "",                   // e.g. "https://instagram.com/streeton"
    // Web / hosting (keep in sync if the domain ever changes)
    domain: "",                      // e.g. "https://streeton.app"
    // Rider brand word ("Saradhi" = a Saardha rider). Rename alongside the app if desired.
    riderWord: "Pilot",
    riderWordPlural: "Pilots",
  };
  global.BRAND = BRAND;
})(typeof window !== "undefined" ? window : this);
