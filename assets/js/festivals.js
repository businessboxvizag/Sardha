/**
 * festivals.js — shared festival / observance calendar for the customer app.
 *
 * Data-driven so new occasions are a one-line addition. Each entry is either:
 *   tier "major"  → full themed ribbon + animated full-screen overlay
 *   tier "minor"  → a slim greeting strip only (the ~daily "international days")
 *
 * Date matching:
 *   md: "MM-DD"            → fires every year on that date
 *   md + mdEnd            → fires across an inclusive same-month window
 *   ymd: ["YYYY-MM-DD"]   → exact dates (lunar festivals that shift each year)
 *
 * Lunar/variable dates are filled for 2026–2027 (verified against public
 * panchang / Islamic / Christian calendars). Fixed-date entries fire every year.
 * The admin can always override with a specific theme from Settings.
 */
(function (global) {
  // Palettes reused across similar occasions.
  var HINDU = ["#c2410c", "#ea580c", "#f59e0b"], HINDU_C = ["#ffd54f", "#ff8f00", "#fff59d", "#e62a1f"];
  var MUSLIM = ["#065f46", "#047857", "#10b981"], MUSLIM_C = ["#fde047", "#ffffff", "#34d399"];
  var TRICOLOR = "linear-gradient(90deg,#ff9933 0 33%,#ffffff 33% 66%,#138808 66% 100%)";

  var FESTIVALS = [
    /* ── National ─────────────────────────────────────────────── */
    { key: "new_year",        tier: "major", cat: "national", pri: 8, name: "Happy New Year! 🎆", emoji: "🎆", md: "01-01", grad: ["#4f46e5", "#7c3aed", "#db2777"], conf: ["#fde047", "#f472b6", "#a78bfa", "#ffffff"], fx: "sparkle", overlay: "🎆", text: "#fff" },
    { key: "republic_day",    tier: "major", cat: "national", pri: 9, name: "Happy Republic Day — Jai Hind! 🇮🇳", emoji: "🇮🇳", md: "01-26", bg: TRICOLOR, conf: ["#ff9933", "#ffffff", "#138808", "#0a3d0a"], fx: "fly", overlay: "🇮🇳", text: "#0a3d0a" },
    { key: "independence_day", tier: "major", cat: "national", pri: 9, name: "Happy Independence Day — Jai Hind! 🇮🇳", emoji: "🇮🇳", md: "08-13", mdEnd: "08-16", bg: TRICOLOR, conf: ["#ff9933", "#ffffff", "#138808", "#0a3d0a"], fx: "fly", overlay: "🇮🇳", text: "#0a3d0a" },
    { key: "gandhi_jayanti",  tier: "major", cat: "national", pri: 6, name: "Gandhi Jayanti — Day of Non-Violence 🕊️", emoji: "🕊️", md: "10-02", grad: ["#f3f4f6", "#d1d5db", "#e5e7eb"], conf: ["#ff9933", "#138808", "#94a3b8"], fx: "petal", overlay: "🕊️", text: "#374151" },

    /* ── Hindu / Telugu ───────────────────────────────────────── */
    { key: "makar_sankranti", tier: "major", cat: "telugu", pri: 8, name: "Happy Makar Sankranti & Pongal! 🪁", emoji: "🪁", md: "01-14", mdEnd: "01-15", grad: ["#f59e0b", "#f97316", "#eab308"], conf: ["#fff59d", "#ff8f00", "#4ade80", "#ffffff"], fx: "fly", overlay: "🪁", text: "#fff" },
    { key: "maha_shivaratri", tier: "major", cat: "hindu", pri: 7, name: "Har Har Mahadev — Maha Shivaratri 🕉️", emoji: "🕉️", ymd: ["2026-02-15"], grad: ["#1e3a8a", "#3730a3", "#6d28d9"], conf: ["#ffffff", "#a5b4fc", "#c4b5fd"], fx: "sparkle", overlay: "🔱", text: "#fff" },
    { key: "holi",            tier: "major", cat: "hindu", pri: 8, name: "Happy Holi! 🎨", emoji: "🌈", ymd: ["2026-03-04", "2027-03-21"], grad: ["#ec4899", "#8b5cf6", "#22c55e", "#f59e0b"], conf: ["#ec4899", "#22c55e", "#3b82f6", "#f59e0b", "#eab308"], fx: "petal", overlay: "🎨", text: "#fff" },
    { key: "ugadi",           tier: "major", cat: "telugu", pri: 9, name: "Happy Ugadi — Telugu New Year! 🌿", emoji: "🌿", ymd: ["2026-03-19", "2027-04-07"], grad: ["#16a34a", "#65a30d", "#f59e0b"], conf: ["#fde047", "#4ade80", "#fb923c"], fx: "petal", overlay: "🌸", text: "#fff" },
    { key: "ram_navami",      tier: "major", cat: "hindu", pri: 6, name: "Jai Shri Ram — Happy Ram Navami 🏹", emoji: "🏹", ymd: ["2026-03-26"], grad: HINDU, conf: HINDU_C, fx: "sparkle", overlay: "🙏", text: "#fff" },
    { key: "hanuman_jayanti", tier: "major", cat: "hindu", pri: 6, name: "Jai Hanuman! 🚩", emoji: "🚩", ymd: ["2026-04-02"], grad: ["#dc2626", "#ea580c", "#f59e0b"], conf: ["#ffffff", "#fca5a5", "#fde047"], fx: "fly", overlay: "🚩", text: "#fff" },
    { key: "raksha_bandhan",  tier: "major", cat: "hindu", pri: 7, name: "Happy Raksha Bandhan 🎀", emoji: "🎀", ymd: ["2026-08-28"], grad: ["#db2777", "#e11d48", "#f59e0b"], conf: ["#fbcfe8", "#fda4af", "#fde047"], fx: "petal", overlay: "🎀", text: "#fff" },
    { key: "janmashtami",     tier: "major", cat: "hindu", pri: 7, name: "Happy Krishna Janmashtami 🦚", emoji: "🦚", ymd: ["2026-09-04"], grad: ["#1d4ed8", "#0891b2", "#7c3aed"], conf: ["#fde047", "#22d3ee", "#a78bfa"], fx: "sparkle", overlay: "🪈", text: "#fff" },
    { key: "ganesh_chaturthi", tier: "major", cat: "telugu", pri: 8, name: "Ganpati Bappa Morya — Vinayaka Chavithi 🐘", emoji: "🐘", ymd: ["2026-09-14"], grad: ["#dc2626", "#f59e0b", "#fbbf24"], conf: ["#fde047", "#fca5a5", "#fb923c"], fx: "fly", overlay: "🐘", text: "#fff" },
    { key: "bathukamma",      tier: "major", cat: "telugu", pri: 6, name: "Happy Bathukamma 🌼", emoji: "🌼", md: "10-10", mdEnd: "10-18", grad: ["#f59e0b", "#84cc16", "#ec4899"], conf: ["#fde047", "#a3e635", "#f9a8d4"], fx: "petal", overlay: "🌼", text: "#fff" },
    { key: "dussehra",        tier: "major", cat: "hindu", pri: 8, name: "Happy Dussehra — Vijaya Dashami 🏹", emoji: "🏹", ymd: ["2026-10-20", "2027-10-09"], grad: ["#b91c1c", "#ea580c", "#f59e0b"], conf: ["#fde047", "#fca5a5", "#ffffff"], fx: "fly", overlay: "🏹", text: "#fff" },
    { key: "diwali",          tier: "major", cat: "hindu", pri: 10, name: "Happy Diwali from Saardha! ✨", emoji: "🪔", ymd: ["2026-11-08", "2027-10-29"], grad: ["#3a0ca3", "#7209b7", "#b5179e"], conf: ["#ffd54f", "#ff8f00", "#fff59d", "#ffab40"], fx: "sparkle", overlay: "🪔", text: "#ffd54f" },
    { key: "karthika_purnima", tier: "major", cat: "telugu", pri: 5, name: "Happy Karthika Purnima 🪔", emoji: "🪔", ymd: ["2026-11-24"], grad: ["#7c3aed", "#4f46e5", "#f59e0b"], conf: ["#ffd54f", "#fff59d", "#c4b5fd"], fx: "sparkle", overlay: "✨", text: "#fff" },

    /* ── Christian ────────────────────────────────────────────── */
    { key: "good_friday",     tier: "major", cat: "christian", pri: 5, name: "Good Friday 🕯️", emoji: "✝️", ymd: ["2026-04-03", "2027-03-26"], grad: ["#374151", "#4b5563", "#6b7280"], conf: ["#ffffff", "#d1d5db"], fx: "petal", overlay: "🕯️", text: "#fff" },
    { key: "easter",          tier: "major", cat: "christian", pri: 6, name: "Happy Easter! 🐣", emoji: "🐣", ymd: ["2026-04-05", "2027-03-28"], grad: ["#f472b6", "#a78bfa", "#facc15"], conf: ["#fbcfe8", "#c4b5fd", "#fde047", "#86efac"], fx: "petal", overlay: "🐣", text: "#fff" },
    { key: "christmas",       tier: "major", cat: "christian", pri: 9, name: "Merry Christmas! 🎄", emoji: "🎄", md: "12-24", mdEnd: "12-25", grad: ["#065f46", "#047857", "#b91c1c"], conf: ["#ffffff", "#ef4444", "#22c55e", "#fde047"], fx: "petal", overlay: "❄️", text: "#fff" },

    /* ── Muslim ───────────────────────────────────────────────── */
    { key: "eid_fitr",        tier: "major", cat: "muslim", pri: 8, name: "Eid Mubarak — Eid al-Fitr 🌙", emoji: "🌙", ymd: ["2026-03-21", "2027-03-10"], grad: MUSLIM, conf: MUSLIM_C, fx: "sparkle", overlay: "🌙", text: "#fff" },
    { key: "eid_adha",        tier: "major", cat: "muslim", pri: 8, name: "Eid Mubarak — Eid al-Adha (Bakrid) 🐑", emoji: "🐑", ymd: ["2026-05-27", "2027-05-16"], grad: ["#065f46", "#0d9488", "#10b981"], conf: MUSLIM_C, fx: "sparkle", overlay: "🌙", text: "#fff" },
    { key: "muharram",        tier: "major", cat: "muslim", pri: 5, name: "Muharram 🕌", emoji: "🕌", ymd: ["2026-06-26", "2027-06-15"], grad: ["#111827", "#1f2937", "#374151"], conf: ["#ffffff", "#9ca3af"], fx: "sparkle", overlay: "🕌", text: "#fff" },
    { key: "milad",           tier: "major", cat: "muslim", pri: 6, name: "Eid Milad-un-Nabi 🕌", emoji: "🕌", ymd: ["2026-08-26", "2027-08-15"], grad: ["#047857", "#059669", "#10b981"], conf: ["#fde047", "#ffffff"], fx: "sparkle", overlay: "🌙", text: "#fff" },

    /* ── International / observance days (slim greeting only) ──── */
    { key: "cancer_day",      tier: "minor", cat: "intl", pri: 3, name: "World Cancer Day 🎗️", emoji: "🎗️", md: "02-04", color: "#3b82f6" },
    { key: "rose_day",        tier: "minor", cat: "intl", pri: 2, name: "Happy Rose Day 🌹", emoji: "🌹", md: "02-07", color: "#e11d48" },
    { key: "chocolate_day",   tier: "minor", cat: "intl", pri: 2, name: "Happy Chocolate Day 🍫", emoji: "🍫", md: "02-09", color: "#7c3f1d" },
    { key: "hug_day",         tier: "minor", cat: "intl", pri: 2, name: "Happy Hug Day 🤗", emoji: "🤗", md: "02-12", color: "#f59e0b" },
    { key: "valentines_day",  tier: "minor", cat: "intl", pri: 5, name: "Happy Valentine's Day ❤️", emoji: "❤️", md: "02-14", color: "#e11d48" },
    { key: "wildlife_day",    tier: "minor", cat: "intl", pri: 3, name: "World Wildlife Day 🐾", emoji: "🐾", md: "03-03", color: "#16a34a" },
    { key: "womens_day",      tier: "minor", cat: "intl", pri: 5, name: "Happy Women's Day 💜", emoji: "💜", md: "03-08", color: "#a21caf" },
    { key: "water_day",       tier: "minor", cat: "intl", pri: 3, name: "World Water Day 💧", emoji: "💧", md: "03-22", color: "#0891b2" },
    { key: "health_day",      tier: "minor", cat: "intl", pri: 3, name: "World Health Day 🩺", emoji: "🩺", md: "04-07", color: "#dc2626" },
    { key: "earth_day",       tier: "minor", cat: "intl", pri: 4, name: "Happy Earth Day 🌍", emoji: "🌍", md: "04-22", color: "#15803d" },
    { key: "book_day",        tier: "minor", cat: "intl", pri: 2, name: "World Book Day 📚", emoji: "📚", md: "04-23", color: "#7c3aed" },
    { key: "labour_day",      tier: "minor", cat: "intl", pri: 4, name: "Happy Labour Day 🛠️", emoji: "🛠️", md: "05-01", color: "#b45309" },
    { key: "mothers_day",     tier: "minor", cat: "intl", pri: 5, name: "Happy Mother's Day 💐", emoji: "💐", ymd: ["2026-05-10", "2027-05-09"], color: "#db2777" },
    { key: "tobacco_day",     tier: "minor", cat: "intl", pri: 2, name: "No Tobacco Day 🚭", emoji: "🚭", md: "05-31", color: "#dc2626" },
    { key: "environment_day", tier: "minor", cat: "intl", pri: 4, name: "World Environment Day 🌳", emoji: "🌳", md: "06-05", color: "#15803d" },
    { key: "ocean_day",       tier: "minor", cat: "intl", pri: 3, name: "World Ocean Day 🌊", emoji: "🌊", md: "06-08", color: "#0e7490" },
    { key: "blood_donor_day", tier: "minor", cat: "intl", pri: 4, name: "World Blood Donor Day 🩸", emoji: "🩸", md: "06-14", color: "#b91c1c" },
    { key: "fathers_day",     tier: "minor", cat: "intl", pri: 5, name: "Happy Father's Day 👔", emoji: "👔", ymd: ["2026-06-21", "2027-06-20"], color: "#1d4ed8" },
    { key: "yoga_day",        tier: "minor", cat: "intl", pri: 4, name: "International Yoga Day 🧘", emoji: "🧘", md: "06-21", color: "#0d9488" },
    { key: "music_day",       tier: "minor", cat: "intl", pri: 2, name: "World Music Day 🎶", emoji: "🎶", md: "06-21", color: "#7c3aed" },
    { key: "doctors_day",     tier: "minor", cat: "intl", pri: 3, name: "Happy Doctor's Day 🩺", emoji: "🩺", md: "07-01", color: "#0891b2" },
    { key: "population_day",  tier: "minor", cat: "intl", pri: 2, name: "World Population Day 👪", emoji: "👪", md: "07-11", color: "#6d28d9" },
    { key: "friendship_intl", tier: "minor", cat: "intl", pri: 3, name: "International Friendship Day 🤝", emoji: "🤝", md: "07-30", color: "#f59e0b" },
    { key: "friendship_in",   tier: "minor", cat: "intl", pri: 5, name: "Happy Friendship Day 🤝", emoji: "🤝", ymd: ["2026-08-02", "2027-08-01"], color: "#f59e0b" },
    { key: "elephant_day",    tier: "minor", cat: "intl", pri: 3, name: "World Elephant Day 🐘", emoji: "🐘", md: "08-12", color: "#6b7280" },
    { key: "photography_day", tier: "minor", cat: "intl", pri: 2, name: "World Photography Day 📷", emoji: "📷", md: "08-19", color: "#334155" },
    { key: "sports_day",      tier: "minor", cat: "intl", pri: 3, name: "National Sports Day 🏑", emoji: "🏑", md: "08-29", color: "#ea580c" },
    { key: "teachers_day",    tier: "minor", cat: "intl", pri: 5, name: "Happy Teachers' Day 📖", emoji: "📖", md: "09-05", color: "#7c3aed" },
    { key: "literacy_day",    tier: "minor", cat: "intl", pri: 2, name: "World Literacy Day ✏️", emoji: "✏️", md: "09-08", color: "#0891b2" },
    { key: "peace_day",       tier: "minor", cat: "intl", pri: 3, name: "International Peace Day 🕊️", emoji: "🕊️", md: "09-21", color: "#0ea5e9" },
    { key: "tourism_day",     tier: "minor", cat: "intl", pri: 2, name: "World Tourism Day 🧳", emoji: "🧳", md: "09-27", color: "#0d9488" },
    { key: "animal_day",      tier: "minor", cat: "intl", pri: 3, name: "World Animal Day 🐾", emoji: "🐾", md: "10-04", color: "#16a34a" },
    { key: "food_day",        tier: "minor", cat: "intl", pri: 3, name: "World Food Day 🍲", emoji: "🍲", md: "10-16", color: "#b45309" },
    { key: "childrens_day",   tier: "minor", cat: "intl", pri: 5, name: "Happy Children's Day 🧒", emoji: "🧒", md: "11-14", color: "#f59e0b" },
    { key: "mens_day",        tier: "minor", cat: "intl", pri: 3, name: "International Men's Day 👔", emoji: "👔", md: "11-19", color: "#1d4ed8" },
    { key: "aids_day",        tier: "minor", cat: "intl", pri: 3, name: "World AIDS Day ❤️", emoji: "❤️", md: "12-01", color: "#dc2626" },
    { key: "disability_day",  tier: "minor", cat: "intl", pri: 2, name: "Day of Persons with Disabilities ♿", emoji: "♿", md: "12-03", color: "#2563eb" },
    { key: "human_rights_day", tier: "minor", cat: "intl", pri: 3, name: "Human Rights Day ⚖️", emoji: "⚖️", md: "12-10", color: "#4f46e5" },
    { key: "new_year_eve",    tier: "minor", cat: "intl", pri: 4, name: "New Year's Eve 🎆", emoji: "🎆", md: "12-31", color: "#7c3aed" },
  ];

  function pad(n) { return String(n).length < 2 ? "0" + n : String(n); }
  function ymdStr(d) { d = d || new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function mdStr(d) { d = d || new Date(); return pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }

  function matches(f, d) {
    d = d || new Date();
    if (Array.isArray(f.ymd)) return f.ymd.indexOf(ymdStr(d)) !== -1;
    if (f.md) {
      var md = mdStr(d);
      if (f.mdEnd) return md >= f.md && md <= f.mdEnd;
      return md === f.md;
    }
    return false;
  }

  // Resolve the active { major, minor } for a date (or an admin override key).
  function resolve(overrideKey, d) {
    d = d || new Date();
    if (overrideKey && overrideKey !== "auto" && overrideKey !== "") {
      if (overrideKey === "none") return { major: null, minor: null };
      var f = null;
      for (var i = 0; i < FESTIVALS.length; i++) if (FESTIVALS[i].key === overrideKey) { f = FESTIVALS[i]; break; }
      if (!f) return { major: null, minor: null };
      return f.tier === "minor" ? { major: null, minor: f } : { major: f, minor: null };
    }
    var majors = [], minors = [];
    for (var j = 0; j < FESTIVALS.length; j++) {
      if (!matches(FESTIVALS[j], d)) continue;
      (FESTIVALS[j].tier === "minor" ? minors : majors).push(FESTIVALS[j]);
    }
    majors.sort(function (a, b) { return (b.pri || 0) - (a.pri || 0); });
    minors.sort(function (a, b) { return (b.pri || 0) - (a.pri || 0); });
    return { major: majors[0] || null, minor: minors[0] || null };
  }

  global.Festivals = { list: FESTIVALS, resolve: resolve, matches: matches, ymdStr: ymdStr, mdStr: mdStr };
})(typeof window !== "undefined" ? window : this);
