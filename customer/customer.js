/* =========================================================
 * Customer App — real API version
 * ========================================================= */
(function () {
  "use strict";
  const { el, money, timeAgo, clockTime, toast, topbar, project, statusBadge, tracker } = UI;

  const state = {
    route: "stores",
    vendorId: null,
    trackOrderId: null,
    cart: {},
    cartVendor: null,
    search: "",
    paymentMethod: "COD",
  };

  const root = document.getElementById("root");

  /* ----- boot ----- */
  async function boot() {
    const user = await BWAuth.requireLogin("customer");
    await BW.init("customer");

    // Bring any device-local stores onto the account so they sync across devices (#1)
    migrateLocalShops();
    // A merchant QR / scan page can deep-link a store via ?v=<vendorId> — add it
    handleAddStoreParam();

    // Join the customer's Socket.io room for live order updates
    const me = BW.currentCustomer();
    if (me) BW.joinCustomerRoom(me.id);

    // Load gold-coin balance / active reward so checkout and the Games hub reflect it.
    refreshRewards();

    // Live support chat: when support replies, refresh the open ticket instantly.
    BW.subscribeTickets((t) => {
      if (state.route === "ticket" && state.ticketId === t.id) viewTicket();
      const last = (t.messages && t.messages[t.messages.length - 1]) || {};
      if (last.from === "support" && window.Buzzer) window.Buzzer.notify("Saardha Support replied", last.text || "");
    });

    // Notify the customer live when a fresh order is accepted or declined by the store
    const _lastStatus = {};
    BW.subscribe(() => {
      try {
        const c = BW.currentCustomer();
        (c ? BW.orders({ customerId: c.id }) : BW.orders()).forEach((o) => {
          const prev = _lastStatus[o.id];
          if (prev && prev !== o.status) {
            if (o.status === "CANCELLED") toast("Order " + (o.orderNo || o.id.slice(-6).toUpperCase()) + " was declined by the store");
            else if (o.status === "ACCEPTED" && prev === "PLACED") toast("Order " + (o.orderNo || o.id.slice(-6).toUpperCase()) + " accepted! Preparing now.");
          }
          _lastStatus[o.id] = o.status;
        });
      } catch (e) { /* ignore */ }
      if (state.route === "track" || state.route === "history" || state.route === "cart") render();
    });

    render();

    // First-time users get an animated how-to guide (once)
    try { if (!localStorage.getItem("saardha_onboarded")) setTimeout(showOnboarding, 500); } catch (e) {}

    // Behavioral analytics (first-party): app open + cart abandonment
    if (BW.track) {
      BW.track("app_open", {});
      window.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden" && cartCount() > 0 && !_orderJustPlaced) {
          BW.track("cart_abandoned", { items: cartCount(), value: cartTotal(), vendorId: state.cartVendor });
        }
      });
    }
  }
  let _orderJustPlaced = false;

  /* ----- cart helpers ----- */
  function cartCount() {
    return Object.values(state.cart).reduce((s, q) => s + q, 0);
  }
  function cartLines() {
    const prods = BW.products(state.cartVendor);
    return Object.entries(state.cart)
      .map(([pid, qty]) => {
        const p = prods.find((x) => x.id === pid);
        if (!p) return null; // product removed from store
        return { productId: pid, name: p.name, price: p.price, qty };
      })
      .filter(Boolean);
  }
  function cartTotal() {
    return cartLines().reduce((s, l) => s + l.price * l.qty, 0);
  }
  function addToCart(product) {
    if (state.cartVendor && state.cartVendor !== product.vendorId) {
      if (!confirm("Your cart has items from another vendor. Start a new cart?")) return;
      state.cart = {};
    }
    state.cartVendor = product.vendorId;
    state.cart[product.id] = (state.cart[product.id] || 0) + 1;
    if (BW.track) BW.track("add_to_cart", { product: product.name, vendorId: product.vendorId, price: product.price });
    toast(product.name + " added");
    render();
  }
  function setQty(pid, qty) {
    if (qty <= 0) delete state.cart[pid];
    else state.cart[pid] = qty;
    if (cartCount() === 0) state.cartVendor = null;
    render();
  }

  /* ----- navigation ----- */
  let _navPop = false;   // true while handling a browser Back, so we don't re-push history
  function go(route, extra = {}) {
    // Stop any active camera scan before leaving the scan view
    if (window._scanCleanup) { window._scanCleanup(); window._scanCleanup = null; }
    stopEtaPolling();
    Object.assign(state, { route }, extra);
    // Push a browser history entry so Android's Back button steps back one screen
    // instead of exiting the app. Home ("stores") is the base — Back there exits.
    if (!_navPop && route !== "stores") {
      try { history.pushState({ r: route, e: extra }, "", "#" + route); } catch (e) {}
    }
    window.scrollTo(0, 0);
    render();
  }
  window.addEventListener("popstate", function (ev) {
    _navPop = true;
    const s = ev.state;
    if (s && s.r) go(s.r, s.e || {}); else go("stores");
    _navPop = false;
  });

  /* ----- nav icons ----- */
  const ICONS = {
    store:   '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l1.5-5h15L21 9"/><path d="M4 9v9a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9"/><path d="M4 9a2 2 0 0 0 4 0 2 2 0 0 0 4 0 2 2 0 0 0 4 0 2 2 0 0 0 4 0"/><path d="M9 20v-5h6v5"/></svg>',
    orders:  '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/></svg>',
    cart:    '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2 3h3l2.5 12h11l2-8H6"/></svg>',
    scan:    '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M4 12h16"/></svg>',
    profile: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
  };

  /* ----- shell ----- */
  function shell(active, body) {
    root.innerHTML = "";
    const cust = BW.currentCustomer();
    const user = BW.Auth.getUser();

    root.appendChild(topbar(user ? "Hi, " + String(user.name).split(" ")[0] : "Saardha", []));
    festivalRibbon(root);   // themed festival strip (e.g. Independence Day) when active
    festivalOverlay();      // full-screen floating petals + flying flags

    const nav = el("div", { class: "sidebar" }, [
      navItem("stores",   ICONS.store,   "My Stores"),
      navItem("scan",     ICONS.scan,    "Scan QR"),
      navItem("cart",     ICONS.cart,    "Cart & Orders", () => go("cart")),
      navItem("profile",  ICONS.profile, "Profile"),
    ]);

    const content = el("div", { class: "content" }, body);
    root.appendChild(el("div", { class: "app" }, [nav, content]));

    // Bottom nav (mobile only — hidden on desktop via CSS)
    // Orders moved into Cart; Saardha AI docked in the centre.
    const aiImg = el("img", { src: "../assets/img/saardha-mark.png", alt: "AI" });
    const aiCenter = el("div", { class: "bn-ai-wrap" }, [
      el("div", { class: "bn-ai", role: "button", "aria-label": "Saardha Assistant", onClick: showAssistant },
        [aiImg, el("span", { class: "bn-ai-dot" })]),
    ]);
    root.appendChild(el("div", { class: "bottom-nav" }, [
      bnItem("stores",   ICONS.store,   "Stores"),
      bnItem("scan",     ICONS.scan,    "Scan"),
      aiCenter,
      bnItem("cart",     ICONS.cart,    "Cart", () => go("cart"), cartCount() || null),
      bnItem("profile",  ICONS.profile, "Profile"),
    ]));

    // Floating cart bar — slides up whenever the cart has items (but not on the cart page itself)
    if (cartCount() > 0 && active !== "cart") {
      const sub = cartTotal();
      const tot = sub + Math.round(sub * 0.18) + (BW.deliveryFee ? BW.deliveryFee() : 15);
      root.appendChild(el("div", { class: "cart-bar", onClick: () => go("cart") }, [
        el("span", {}, cartCount() + (cartCount() === 1 ? " item" : " items") + " · " + money(tot)),
        el("span", {}, "View cart →"),
      ]));
    }

    // Help button — reopens the how-to guide any time
    root.appendChild(el("div", { class: "help-fab", title: "Help", "aria-label": "Help", onClick: showAssistant }, "?"));

    function navItem(route, ico, label, onClick) {
      const icoEl = el("span", { class: "ico nav-ico" });
      icoEl.innerHTML = ico;
      return el("div", {
        class: "nav-item" + (active === route ? " active" : ""),
        onClick: onClick || (() => go(route)),
      }, [icoEl, el("span", {}, label)]);
    }

    function bnItem(route, ico, label, onClick, badge) {
      const icoEl = el("span", { class: "bn-ico" });
      icoEl.innerHTML = ico;
      const wrap = el("div", { class: "bottom-nav-item-wrap" }, [
        el("button", {
          class: "bottom-nav-item" + (active === route ? " active" : ""),
          onClick: onClick || (() => go(route)),
        }, [
          icoEl,
          document.createTextNode(label),
        ]),
      ]);
      if (badge) wrap.appendChild(el("span", { class: "bn-badge" }, String(badge)));
      return wrap;
    }
  }

  /* ---- Unlocked vendors (QR-only) ---- */
  // Handle a deep-linked store add: ?v=<vendorId> (from a scanned merchant QR)
  function handleAddStoreParam() {
    try {
      const params = new URLSearchParams(location.search);
      const vId = params.get("v") || params.get("add");
      if (!vId) return;
      if (BW.vendor(vId)) {
        const unlocked = getUnlockedVendors();
        if (!unlocked.includes(vId)) {
          if (BW.addShop) BW.addShop(vId).catch(function () {});
          addStoreLocal(vId);
          toast("✓ " + BW.vendor(vId).name + " added to your stores");
        }
        state.route = "stores";
        state.vendorId = vId;
      } else {
        toast("That store isn't available right now");
      }
      history.replaceState(null, "", location.pathname);
    } catch (e) { /* ignore malformed links */ }
  }

  // Per-user local cache key — so different customers on the SAME device never
  // see each other's stores. The server account list (BW.shops) is the real
  // source of truth; this local list is just a per-user fallback cache.
  function lsKey() {
    var u = (BW.Auth && BW.Auth.getUser) ? BW.Auth.getUser() : null;
    return "bw_unlocked_vendors_" + ((u && u.uid) || "anon");
  }

  function getUnlockedVendors() {
    var acct = (BW.shops ? BW.shops() : []) || [];   // account-backed, scoped to this user
    var local = [];
    try { local = JSON.parse(localStorage.getItem(lsKey()) || "[]"); } catch (e) {}
    if (!Array.isArray(local)) local = [];
    var seen = {}, out = [];
    acct.concat(local).forEach(function (id) { if (id && !seen[id]) { seen[id] = 1; out.push(id); } });
    return out;
  }

  function addStoreLocal(id) {
    try {
      var k = lsKey();
      var l = JSON.parse(localStorage.getItem(k) || "[]");
      if (!Array.isArray(l)) l = [];
      if (l.indexOf(id) < 0) { l.push(id); localStorage.setItem(k, JSON.stringify(l)); }
    } catch (e) {}
  }

  function migrateLocalShops() {
    try {
      if (!BW.addShop) return;
      var acct = (BW.shops ? BW.shops() : []) || [];
      // Move any legacy device-global list + the current per-user list into the account,
      // then delete the legacy global key so it can never leak between users again.
      var legacy = []; try { legacy = JSON.parse(localStorage.getItem("bw_unlocked_vendors") || "[]"); } catch (e) {}
      var mine   = []; try { mine   = JSON.parse(localStorage.getItem(lsKey()) || "[]"); } catch (e) {}
      var all = (Array.isArray(legacy) ? legacy : []).concat(Array.isArray(mine) ? mine : []);
      all.forEach(function (id) { if (id && acct.indexOf(id) < 0) BW.addShop(id).catch(function () {}); });
      try { localStorage.removeItem("bw_unlocked_vendors"); } catch (e) {}
    } catch (e) {}
  }

  /* ====================== MY STORES ====================== */
  // Pilot / early-launch announcement banner with a scrolling note + feedback contact.
  function pilotBanner() {
    const num = "8688669816";
    return el("div", { style: "background:linear-gradient(90deg,var(--brand),#ff6a5c);color:#fff;border-radius:12px;padding:10px 14px;margin-bottom:14px" }, [
      el("div", { style: "display:flex;align-items:center;gap:8px" }, [
        el("span", { style: "font-size:16px" }, "🚀"),
        el("div", { style: "flex:1;min-width:0" }, [
          el("div", { style: "font-weight:800;font-size:13px" }, "Beta version — thanks for trying Saardha!"),
          el("div", { class: "marquee" }, el("span", { class: "marquee-in" },
            "A new local delivery app by BusinessBOX, Vizag. We're in testing — your feedback shapes what we build. Spotted a bug or have an idea? Tell us at " + num + ".")),
        ]),
      ]),
      el("div", { style: "display:flex;gap:8px;margin-top:8px" }, [
        el("a", { class: "btn sm", style: "background:#fff;color:var(--brand);flex:1;text-align:center", href: "tel:" + num }, "📞 Call feedback"),
        el("a", { class: "btn sm", style: "background:rgba(255,255,255,.22);color:#fff;flex:1;text-align:center", href: "https://wa.me/91" + num, target: "_blank", rel: "noopener" }, "💬 WhatsApp"),
      ]),
    ]);
  }

  // Festival theming — admin picks a theme (Settings), or it auto-detects a festival window.
  function activeFestival() {
    const s = (BW.settingsRaw && BW.settingsRaw()) || {};
    let theme = s.festivalTheme || "";
    if (!theme || theme === "auto") {
      const d = new Date();
      if (d.getMonth() === 7 && d.getDate() >= 13 && d.getDate() <= 16) return "independence"; // 13–16 Aug
      if (theme === "auto") return "";
    }
    return theme === "auto" ? "" : theme;
  }
  // Inject festival animation keyframes once (waving flag, shimmer sweep, falling confetti, glow).
  let _festStyles = false;
  function ensureFestivalStyles() {
    if (_festStyles) return; _festStyles = true;
    const st = document.createElement("style");
    st.textContent =
      "@keyframes bwFlagWave{0%,100%{transform:rotate(-9deg)}50%{transform:rotate(9deg)}}" +
      "@keyframes bwShine{0%{background-position:-180% 0}100%{background-position:180% 0}}" +
      "@keyframes bwFall{0%{transform:translateY(-12px) rotate(0);opacity:0}12%{opacity:1}100%{transform:translateY(52px) rotate(260deg);opacity:0}}" +
      "@keyframes bwGlow{0%,100%{text-shadow:0 0 5px #ffb300}50%{text-shadow:0 0 16px #ffe082}}" +
      // Full-screen ambient effects: petals rising, flags flying across, sparkles twinkling.
      "@keyframes bwPetal{0%{transform:translateY(30px) rotate(0);opacity:0}10%{opacity:.85}88%{opacity:.85}100%{transform:translateY(-112vh) rotate(360deg);opacity:0}}" +
      "@keyframes bwFly{0%{transform:translateX(-18vw) rotate(-8deg)}50%{transform:translateX(48vw) rotate(8deg)}100%{transform:translateX(118vw) rotate(-8deg)}}" +
      "@keyframes bwTwinkle{0%,100%{opacity:.2;transform:scale(.7)}50%{opacity:1;transform:scale(1.2)}}" +
      ".bw-fest{position:relative;overflow:hidden}" +
      ".bw-fest .fflag{display:inline-block;animation:bwFlagWave 1.3s ease-in-out infinite;transform-origin:bottom left}" +
      ".bw-fest .fshine{position:absolute;inset:0;background:linear-gradient(110deg,transparent 35%,rgba(255,255,255,.55) 50%,transparent 65%);background-size:200% 100%;animation:bwShine 3.2s linear infinite;pointer-events:none}" +
      ".bw-fest .fconf{position:absolute;top:0;width:7px;height:7px;border-radius:2px;animation:bwFall linear infinite;pointer-events:none}" +
      "#bw-fest-overlay{position:fixed;inset:0;pointer-events:none;overflow:hidden;z-index:9990}" +
      "#bw-fest-overlay .petal{position:absolute;bottom:-24px;border-radius:50%;animation:bwPetal linear infinite}" +
      "#bw-fest-overlay .flyflag{position:absolute;left:0;animation:bwFly linear infinite;filter:drop-shadow(0 2px 3px rgba(0,0,0,.25))}" +
      "#bw-fest-overlay .spark{position:absolute;border-radius:50%;animation:bwTwinkle ease-in-out infinite}";
    document.head.appendChild(st);
  }

  // Full-screen festive overlay (floating petals + flying flags). Created once; harmless
  // pointer-events:none so it never blocks taps. Removed if the theme turns off.
  function festivalOverlay() {
    const theme = activeFestival();
    const existing = document.getElementById("bw-fest-overlay");
    if (!theme || theme === "none") { if (existing) existing.remove(); return; }
    if (existing) return;
    ensureFestivalStyles();
    const ov = el("div", { id: "bw-fest-overlay" });
    if (theme === "independence") {
      const colors = ["#ff9933", "#ffffff", "#138808"];
      for (let i = 0; i < 22; i++) {
        const p = el("div", { class: "petal" });
        const s = 6 + Math.random() * 9;
        p.style.left = (Math.random() * 100) + "%";
        p.style.width = p.style.height = s + "px";
        p.style.background = colors[i % 3];
        p.style.boxShadow = "0 0 4px rgba(0,0,0,.15)";
        p.style.animationDuration = (6 + Math.random() * 7) + "s";
        p.style.animationDelay = (Math.random() * 9) + "s";
        ov.appendChild(p);
      }
      for (let i = 0; i < 5; i++) {
        const f = el("div", { class: "flyflag" }, "🇮🇳");
        f.style.top = (8 + Math.random() * 74) + "%";
        f.style.fontSize = (22 + Math.random() * 18) + "px";
        f.style.animationDuration = (9 + Math.random() * 9) + "s";
        f.style.animationDelay = (Math.random() * 11) + "s";
        ov.appendChild(f);
      }
    } else if (theme === "diwali") {
      const colors = ["#ffd54f", "#ff8f00", "#fff59d", "#ffab40"];
      for (let i = 0; i < 26; i++) {
        const sp = el("div", { class: "spark" });
        const s = 4 + Math.random() * 6;
        sp.style.left = (Math.random() * 100) + "%";
        sp.style.top = (Math.random() * 100) + "%";
        sp.style.width = sp.style.height = s + "px";
        sp.style.background = colors[i % colors.length];
        sp.style.boxShadow = "0 0 8px " + colors[i % colors.length];
        sp.style.animationDuration = (1.2 + Math.random() * 2) + "s";
        sp.style.animationDelay = (Math.random() * 2) + "s";
        ov.appendChild(sp);
      }
      for (let i = 0; i < 4; i++) {
        const d = el("div", { class: "flyflag" }, "🪔");
        d.style.top = (10 + Math.random() * 70) + "%"; d.style.fontSize = (20 + Math.random() * 16) + "px";
        d.style.animationDuration = (10 + Math.random() * 8) + "s"; d.style.animationDelay = (Math.random() * 10) + "s";
        ov.appendChild(d);
      }
    }
    document.body.appendChild(ov);
  }

  function festivalRibbon(root) {
    const theme = activeFestival();
    if (!theme || theme === "none") return;
    ensureFestivalStyles();
    if (theme === "independence") {
      const strip = el("div", { class: "bw-fest", style: "height:46px;background:linear-gradient(90deg,#ff9933 0 33%,#ffffff 33% 66%,#138808 66% 100%);display:flex;align-items:center;justify-content:center" });
      const colors = ["#ff9933", "#ffffff", "#138808", "#0a3d0a"];
      for (let i = 0; i < 14; i++) {
        const c = el("span", { class: "fconf" });
        c.style.left = (Math.random() * 100) + "%";
        c.style.background = colors[i % colors.length];
        c.style.animationDuration = (1.8 + Math.random() * 1.8) + "s";
        c.style.animationDelay = (Math.random() * 2.6) + "s";
        strip.appendChild(c);
      }
      strip.appendChild(el("div", { style: "position:relative;z-index:1;font-weight:800;font-size:13px;color:#0a3d0a;background:rgba(255,255,255,.6);padding:4px 14px;border-radius:20px" }, [
        el("span", { class: "fflag", style: "margin-right:6px" }, "🇮🇳"),
        "Happy Independence Day — Jai Hind!",
      ]));
      strip.appendChild(el("div", { class: "fshine" }));
      root.appendChild(strip);
    } else if (theme === "diwali") {
      const strip = el("div", { class: "bw-fest", style: "height:44px;background:linear-gradient(90deg,#3a0ca3,#7209b7,#b5179e);display:flex;align-items:center;justify-content:center" });
      ["#ffd54f", "#ff8f00", "#fff59d"].forEach((col, i) => {
        for (let k = 0; k < 4; k++) {
          const c = el("span", { class: "fconf" });
          c.style.left = (Math.random() * 100) + "%"; c.style.background = col;
          c.style.animationDuration = (1.6 + Math.random() * 1.6) + "s"; c.style.animationDelay = (Math.random() * 2.4) + "s";
          strip.appendChild(c);
        }
      });
      strip.appendChild(el("div", { style: "position:relative;z-index:1;font-weight:800;font-size:13px;color:#ffd54f;animation:bwGlow 1.6s ease-in-out infinite" }, "🪔 Happy Diwali from Saardha! ✨"));
      strip.appendChild(el("div", { class: "fshine" }));
      root.appendChild(strip);
    } else {
      root.appendChild(el("div", { style: "background:var(--brand);color:#fff;text-align:center;font-weight:700;font-size:13px;padding:7px 12px" }, "🎉 " + theme));
    }
  }

  function viewStores() {
    const unlocked = getUnlockedVendors();
    const favs = BW.favorites();

    // Empty state — no QR scans yet
    if (!unlocked.length) {
      shell("stores", [
        pilotBanner(),
        el("h1", { class: "page-title" }, "My Stores"),
        servicesEntry(),
        el("div", { class: "empty", style: "margin-top:24px" }, [
          el("div", { class: "e" }, ""),
          el("p", { style: "margin:12px 0 6px;font-size:15px;font-weight:600;color:#f0f0f0" }, "No stores yet"),
          el("p", { class: "muted small", style: "max-width:240px;margin:0 auto;line-height:1.6" },
            "Scan a merchant's QR code to add their store — or explore local Services above."),
        ]),
      ]);
      return;
    }

    const searchBar = el("div", { class: "field" }, [
      el("input", {
        placeholder: "Search your stores…",
        value: state.search,
        onInput: (e) => {
          state.search = e.target.value; renderGrid();
          if (BW.track) {
            clearTimeout(window._searchTrackTimer);
            const q = e.target.value.trim();
            if (q.length >= 2) window._searchTrackTimer = setTimeout(() => BW.track("search", { q: q }), 900);
          }
        },
      }),
    ]);

    const countHint = el("div", { style: "display:flex;align-items:center;gap:10px;background:var(--brand-lt);border:1px solid var(--border);border-radius:10px;padding:10px 14px;margin-bottom:16px;font-size:13px" }, [
      el("span", { style: "font-size:18px" }, "🛒"),
      el("span", { style: "flex:1;color:var(--text)" }, [
        el("strong", {}, String(unlocked.length) + " store" + (unlocked.length !== 1 ? "s" : "") + " in your collection"),
        el("span", { class: "muted" }, " · Scan a QR to add more"),
      ]),
    ]);

    const grid = el("div", { class: "grid cols-3", id: "vendorGrid" });
    shell("stores", [
      pilotBanner(),
      el("h1", { class: "page-title" }, "My Stores"),
      el("p", { class: "page-sub" }, "Stores you've added by scanning their QR code."),
      servicesEntry(),
      countHint,
      searchBar,
      grid,
    ]);
    renderGrid();

    function renderGrid() {
      const g = document.getElementById("vendorGrid");
      if (!g) return;
      g.innerHTML = "";

      const list = BW.vendors().filter((v) => {
        if (!unlocked.includes(v.id)) return false;
        return !state.search || (v.name + v.category + v.area).toLowerCase().includes(state.search.toLowerCase());
      });

      if (!list.length) {
        g.appendChild(el("div", { class: "empty" }, [el("div", { class: "e" }, ""), "No stores match your search."]));
        return;
      }
      list.forEach((v) => g.appendChild(vendorCard(v, favs)));
    }
  }

  function vendorCard(v) {
    const closed = v.active === false || v.status === "inactive";
    const img = v.photoUrl
      ? el("div", { class: "vcard-img", style: "padding:0;overflow:hidden" }, el("img", { src: v.photoUrl, alt: v.name, style: "width:100%;height:100%;object-fit:cover" }))
      : el("div", { class: "vcard-img" }, v.img || (v.name || "?")[0].toUpperCase());
    return el("div", { class: "vcard", style: closed ? "opacity:.6" : "", onClick: () => openVendor(v.id) }, [
      img,
      el("div", { class: "vcard-body" }, [
        el("div", { class: "vcard-name" }, [v.name, closed ? el("span", { style: "background:#fdeaea;color:#c0392b;font-size:10px;font-weight:700;padding:1px 6px;border-radius:6px;margin-left:6px" }, "CLOSED") : document.createTextNode("")]),
        el("div", { class: "vcard-meta" }, v.category + " · " + v.area),
        el("div", { class: "vcard-tags" }, [
          el("span", { class: "vcard-rating" }, "★ " + v.rating),
          el("span", { class: "vcard-time" }, "~" + v.prepMins + " min"),
        ]),
      ]),
    ]);
  }

  /* ====================== VENDOR ====================== */
  async function openVendor(vendorId) {
    const need = !BW.products(vendorId).length;
    go("vendor", { vendorId, vendorLoading: need });   // show instantly (skeleton while loading)
    if (need) {
      try { await BW.loadVendorProducts(vendorId); } catch (e) {}
      if (state.route === "vendor" && state.vendorId === vendorId) { state.vendorLoading = false; viewVendor(); }
    }
  }

  const TILE_COLORS = [["#FCEBEB","#A32D2D"],["#FAEEDA","#854F0B"],["#EAF3DE","#3B6D11"],["#E6F1FB","#0C447C"],["#EEEDFE","#3C3489"],["#FBEAF0","#993556"]];

  function itemCtrl(p) {
    const qty = state.cart[p.id] || 0;
    if (!qty) return el("button", { class: "add-btn", onClick: (e) => { e.stopPropagation(); addToCart(p); refreshItem(p.id); } }, "ADD");
    return el("div", { class: "add-stepper" }, [
      el("button", { onClick: (e) => { e.stopPropagation(); setQty(p.id, qty - 1); refreshItem(p.id); } }, "−"),
      el("span", {}, String(qty)),
      el("button", { onClick: (e) => { e.stopPropagation(); addToCart(p); refreshItem(p.id); } }, "+"),
    ]);
  }

  function refreshItem(id) {
    const box = document.getElementById("it-" + id);
    const p = BW.products(state.vendorId).find((x) => x.id === id);
    if (box && p) { box.innerHTML = ""; box.appendChild(itemCtrl(p)); box.style.animation = "srPop .25s ease"; }
    refreshCartBar();
  }

  function refreshCartBar() {
    const ex = document.querySelector(".cart-bar");
    if (ex) ex.remove();
    if (cartCount() > 0) {
      const sub = cartTotal();
      const tot = sub + Math.round(sub * 0.18) + (BW.deliveryFee ? BW.deliveryFee() : 15);
      const bar = el("div", { class: "cart-bar", onClick: () => go("cart") }, [
        el("span", {}, cartCount() + (cartCount() === 1 ? " item" : " items") + " · " + money(tot)),
        el("span", {}, "View cart →"),
      ]);
      document.getElementById("root").appendChild(bar);
    }
  }

  let _lastViewedStore = null;
  function viewVendor() {
    const v = BW.vendor(state.vendorId);
    if (!v) { go("stores"); return; }
    if (BW.track && _lastViewedStore !== v.id) { _lastViewedStore = v.id; BW.track("view_store", { vendorId: v.id, name: v.name }); }
    const products = BW.products(v.id);
    const fee = BW.deliveryFee ? BW.deliveryFee() : 15;

    const listEl = state.vendorLoading ? skeletonItems(6) : el("div", { style: "padding:0 2px" });
    if (!state.vendorLoading) products.forEach((p, i) => {
      const cols = TILE_COLORS[i % TILE_COLORS.length];
      const ctrlBox = el("div", { id: "it-" + p.id, class: "item-ctrl" }, [itemCtrl(p)]);
      listEl.appendChild(el("div", { class: "item-row" }, [
        el("span", { class: "veg-dot" }, el("span", {})),
        el("div", { class: "item-info" }, [
          el("div", { class: "item-name" }, p.name),
          (p.mrp && p.mrp > p.price)
            ? el("div", { class: "item-price", style: "display:flex;align-items:center;gap:6px;flex-wrap:wrap" }, [
                el("span", {}, money(p.price)),
                el("span", { style: "text-decoration:line-through;color:var(--muted);font-weight:400;font-size:12px" }, money(p.mrp)),
                el("span", { style: "background:#e6f4ea;color:#1a7f37;font-size:11px;font-weight:700;padding:1px 6px;border-radius:6px" }, Math.round((1 - p.price / p.mrp) * 100) + "% OFF"),
              ])
            : el("div", { class: "item-price" }, money(p.price)),
          el("div", { class: "item-unit" }, "per " + p.unit),
        ]),
        el("div", { class: "item-thumb-wrap" }, [
          p.photoUrl
            ? el("div", { class: "item-thumb", style: "padding:0;overflow:hidden" }, el("img", { src: p.photoUrl, alt: p.name, style: "width:100%;height:100%;object-fit:cover" }))
            : el("div", { class: "item-thumb", style: "background:" + cols[0] + ";color:" + cols[1] }, v.img || "🍽"),
          ctrlBox,
        ]),
      ]));
    });

    const closed = v.active === false || v.status === "inactive";
    const gallery = Array.isArray(v.gallery) ? v.gallery : [];
    const heroLogo = v.photoUrl
      ? el("div", { class: "store-hero-logo", style: "padding:0;overflow:hidden" }, el("img", { src: v.photoUrl, alt: v.name, style: "width:100%;height:100%;object-fit:cover" }))
      : el("div", { class: "store-hero-logo" }, v.img || (v.name || "?")[0].toUpperCase());

    const body = [];
    // Cover photo banner
    if (v.photoUrl) {
      body.push(el("div", { style: "position:relative;width:100%;height:150px;border-radius:0 0 16px 16px;overflow:hidden;margin-bottom:10px" }, [
        el("img", { src: v.photoUrl, alt: v.name, style: "width:100%;height:100%;object-fit:cover" }),
        el("button", { class: "store-back", style: "position:absolute;top:10px;left:10px;background:rgba(0,0,0,.5);color:#fff", onClick: () => go("stores"), "aria-label": "Back" }, "‹"),
      ]));
    }
    body.push(el("div", { class: "store-hero" }, [
      v.photoUrl ? document.createTextNode("") : el("button", { class: "store-back", onClick: () => go("stores"), "aria-label": "Back" }, "‹"),
      heroLogo,
      el("div", { class: "store-hero-info" }, [
        el("div", { class: "store-hero-name" }, v.name),
        el("div", { class: "store-hero-meta" }, v.category + " · " + v.area),
      ]),
      el("div", { class: "store-hero-rating" }, "★ " + v.rating),
    ]));
    if (v.description) body.push(el("div", { class: "muted small", style: "padding:0 4px 8px;line-height:1.5" }, v.description));
    if (closed) body.push(el("div", { class: "card", style: "border:1px solid var(--red);color:var(--red);text-align:center;margin-bottom:8px" }, "This store is currently closed and isn't taking orders right now."));
    // Photo gallery strip
    if (gallery.length) {
      body.push(el("div", { style: "display:flex;gap:8px;overflow-x:auto;padding:0 2px 10px;-webkit-overflow-scrolling:touch" },
        gallery.map((url) => el("img", { src: url, alt: "", loading: "lazy", style: "width:120px;height:90px;object-fit:cover;border-radius:10px;flex:none" }))));
    }
    body.push(el("div", { class: "store-time-strip" }, "🛵 " + v.prepMins + "–" + (v.prepMins + 15) + " min  ·  Delivery " + money(fee)));
    body.push(listEl);
    shell("stores", body);
  }

  /* ====================== CART ====================== */
  function openCart() {
    if (cartCount() === 0) {
      UI.modal({
        title: "Your cart",
        body: el("div", { class: "empty" }, [el("div", { class: "e" }, ""), "Your cart is empty."]),
      });
      return;
    }
    const v = BW.vendor(state.cartVendor);
    if (!v) { toast("Store no longer available"); state.cart = {}; state.cartVendor = null; return; }
    const linesWrap = el("div", {});
    const rebuild = () => {
      linesWrap.innerHTML = "";
      cartLines().forEach((l) => {
        linesWrap.appendChild(el("div", { class: "line" }, [
          el("div", {}, [
            el("div", { style: "font-weight:600" }, l.name),
            el("div", { class: "muted small" }, money(l.price)),
          ]),
          el("div", { class: "qty" }, [
            el("button", { onClick: () => { setQty(l.productId, l.qty - 1); refresh(); } }, "−"),
            el("span", {}, String(l.qty)),
            el("button", { onClick: () => { setQty(l.productId, l.qty + 1); refresh(); } }, "+"),
          ]),
        ]));
      });
      const sub = cartTotal();
      const fee = BW.deliveryFee ? BW.deliveryFee() : 15;
      // Discount = bigger of (store-wide %) or (applied promo %), mirroring the server.
      // Store % comes from the cached vendor; promo % is set only after a server-validated Apply.
      const storePct = Math.max(0, Math.min(90, Number(v.storeDiscountPct) || 0));
      const storeDisc = Math.round(sub * storePct / 100);
      const promoPct  = state.appliedPromoCode ? (Number(state.appliedPromoPct) || 0) : 0;
      const promoDisc = Math.round(sub * promoPct / 100);
      let disc = 0, discLabel = "";
      if (promoDisc > 0 && promoDisc >= storeDisc) { disc = promoDisc; discLabel = "Discount (" + state.appliedPromoCode + ")"; }
      else if (storeDisc > 0)                       { disc = storeDisc; discLabel = "Store discount (" + storePct + "%)"; }
      const discountedSub = Math.max(0, sub - disc);
      // Gold-coin reward (auto-applied at checkout, mirrors the server).
      const _rw = _rewards.activeReward;
      const rewardAmt = (_rw && _rw.type === "PERCENT10") ? Math.round(discountedSub * 0.10) : 0;
      const rewardFreeDel = !!(_rw && _rw.type === "FREE_DELIVERY");
      const netSub = Math.max(0, discountedSub - rewardAmt);
      const feeFinal = rewardFreeDel ? 0 : fee;
      const gst = Math.round(netSub * 0.18);
      const total = netSub + gst + feeFinal;

      // ── Promo code row ──
      const promoInput = el("input", { type: "text", value: state.appliedPromoCode || "",
        placeholder: "Promo code", autocapitalize: "characters",
        style: "flex:1;text-transform:uppercase;padding:8px 10px;border:1px solid var(--line,#ddd);border-radius:8px" });
      const applyBtn = el("button", { type: "button", class: "btn ghost sm" }, state.appliedPromoCode ? "Remove" : "Apply");
      applyBtn.onclick = async () => {
        if (state.appliedPromoCode) {  // acts as "Remove"
          state.appliedPromoCode = null; state.appliedPromoPct = 0; state.promoMsg = null; rebuild(); return;
        }
        const code = (promoInput.value || "").trim().toUpperCase();
        if (!code) return;
        applyBtn.disabled = true; applyBtn.textContent = "…";
        try {
          const qi = cartLines().map((l) => ({ productId: l.productId, qty: l.qty }));
          const r = await BW.quoteOrder({ vendorId: v.id, items: qi, promoCode: code });
          if (r.promoError) {
            state.appliedPromoCode = null; state.appliedPromoPct = 0;
            state.promoMsg = { ok: false, text: r.promoError };
          } else if (r.discount && r.discount.source === "promo") {
            state.appliedPromoCode = code; state.appliedPromoPct = r.discount.pct;
            state.promoMsg = { ok: true, text: "Code " + code + " applied — you save " + money(r.discount.amount) };
          } else {
            // Valid code, but the store-wide discount is equal or better — that one applies.
            state.appliedPromoCode = null; state.appliedPromoPct = 0;
            state.promoMsg = { ok: true, text: r.discount && r.discount.amount
              ? "Your store discount (" + money(r.discount.amount) + ") already beats that code."
              : "That code gives no extra discount on this order." };
          }
        } catch (e) {
          state.promoMsg = { ok: false, text: e.message || "Couldn't apply that code" };
        }
        rebuild();
      };
      linesWrap.appendChild(el("div", { class: "line", style: "border:none;gap:8px" }, [promoInput, applyBtn]));
      if (state.promoMsg) linesWrap.appendChild(el("div", { class: "small", style: "margin:-2px 0 6px;color:" + (state.promoMsg.ok ? "var(--brand)" : "#c0392b") }, state.promoMsg.text));

      linesWrap.appendChild(el("div", { class: "line", style: "border:none" }, [
        el("span", { class: "muted" }, "Subtotal"), el("span", {}, money(sub)),
      ]));
      if (disc > 0) linesWrap.appendChild(el("div", { class: "line", style: "border:none" }, [
        el("span", { class: "muted" }, discLabel), el("span", { style: "color:var(--brand)" }, "− " + money(disc)),
      ]));
      if (rewardAmt > 0) linesWrap.appendChild(el("div", { class: "line", style: "border:none" }, [
        el("span", { class: "muted" }, "🎁 Reward (10% off)"), el("span", { style: "color:var(--brand)" }, "− " + money(rewardAmt)),
      ]));
      linesWrap.appendChild(el("div", { class: "line", style: "border:none" }, [
        el("span", { class: "muted" }, "GST (18%)"), el("span", {}, money(gst)),
      ]));
      linesWrap.appendChild(el("div", { class: "line", style: "border:none" }, [
        el("span", { class: "muted" }, "Delivery fee"), rewardFreeDel ? el("span", { style: "color:var(--brand)" }, "FREE 🎁") : el("span", {}, money(fee)),
      ]));
      linesWrap.appendChild(el("div", { class: "line", style: "border:none;font-size:16px;padding-top:4px" }, [
        el("strong", {}, "Total"), el("strong", { style: "color:var(--brand)" }, money(total)),
      ]));

      // Payment method selector
      const payWrap = el("div", { style: "margin-top:14px" });
      payWrap.appendChild(el("div", { class: "muted small", style: "margin-bottom:6px" }, "Payment method"));
      const mkOpt = (val, label) => el("button", {
        type: "button",
        class: "btn " + (state.paymentMethod === val ? "primary" : "ghost") + " sm",
        style: "flex:1",
        onClick: () => { state.paymentMethod = val; rebuild(); },
      }, label);
      payWrap.appendChild(el("div", { style: "display:flex;gap:8px" }, [
        mkOpt("COD", "Pay on delivery"),
        mkOpt("ONLINE", "Pay now online"),
      ]));
      linesWrap.appendChild(payWrap);
    };

    let closeFn;
    function refresh() {
      if (cartCount() === 0) { closeFn && closeFn(); return; }
      rebuild();
    }
    rebuild();

    closeFn = UI.modal({
      title: "Your cart · " + v.name,
      body: linesWrap,
      footer: [
        el("button", { class: "btn ghost",    onClick: () => closeFn() }, "Keep shopping"),
        el("button", { class: "btn primary",  onClick: () => { placeOrder(); closeFn(); } }, "Place order →"),
      ],
    });
  }

  /* ====================== CART + ORDERS (full page) ====================== */
  // Orders were moved out of the footer and now live inside the Cart page,
  // split into "Fresh orders" (active) and "Previous orders".
  function viewCart(tab) {
    const activeTab = tab === "orders" ? "orders" : "cart";
    state.cartTab = activeTab;
    const cust = BW.currentCustomer();

    const panelCart   = el("div", {});
    const panelOrders = el("div", {});

    const btnCart = el("button", { onClick: () => switchTab("cart") },
      "Cart" + (cartCount() ? " (" + cartCount() + ")" : ""));
    const btnOrders = el("button", { onClick: () => switchTab("orders") }, "Orders");
    const toggle = el("div", { class: "seg-toggle" }, [btnCart, btnOrders]);

    function switchTab(t) {
      state.cartTab = t;
      const showCart = t === "cart";
      panelCart.style.display   = showCart ? "" : "none";
      panelOrders.style.display = showCart ? "none" : "";
      btnCart.className   = showCart ? "on" : "";
      btnOrders.className = showCart ? "" : "on";
    }

    /* ---- Cart panel ---- */
    function renderCartPanel() {
      panelCart.innerHTML = "";
      if (cartCount() === 0) {
        panelCart.appendChild(el("div", { class: "empty" },
          [el("div", { class: "e" }, ""), "Your cart is empty. Scan a store and add items to get started."]));
        return;
      }
      const v = BW.vendor(state.cartVendor);
      panelCart.appendChild(el("div", { class: "muted small", style: "margin-bottom:8px" },
        v ? "From " + v.name : ""));

      const lines = el("div", { class: "card", style: "margin-bottom:12px" });
      cartLines().forEach((l) => {
        lines.appendChild(el("div", { class: "line" }, [
          el("div", {}, [
            el("div", { style: "font-weight:600" }, l.name),
            el("div", { class: "muted small" }, money(l.price)),
          ]),
          el("div", { class: "qty" }, [
            el("button", { onClick: () => { setQty(l.productId, l.qty - 1); renderCartPanel(); } }, "−"),
            el("span", {}, String(l.qty)),
            el("button", { onClick: () => { setQty(l.productId, l.qty + 1); renderCartPanel(); } }, "+"),
          ]),
        ]));
      });
      panelCart.appendChild(lines);

      const sub = cartTotal();
      const fee = BW.deliveryFee ? BW.deliveryFee() : 15;
      const pv = BW.vendor(state.cartVendor) || {};
      const storePct = Math.max(0, Math.min(90, Number(pv.storeDiscountPct) || 0));
      const storeDisc = Math.round(sub * storePct / 100);
      const promoPct  = state.appliedPromoCode ? (Number(state.appliedPromoPct) || 0) : 0;
      const promoDisc = Math.round(sub * promoPct / 100);
      let disc = 0, discLabel = "";
      if (promoDisc > 0 && promoDisc >= storeDisc) { disc = promoDisc; discLabel = "Discount (" + state.appliedPromoCode + ")"; }
      else if (storeDisc > 0)                       { disc = storeDisc; discLabel = "Store discount (" + storePct + "%)"; }
      const discountedSub = Math.max(0, sub - disc);
      const _rwP = _rewards.activeReward;
      const rewardAmtP = (_rwP && _rwP.type === "PERCENT10") ? Math.round(discountedSub * 0.10) : 0;
      const rewardFreeDelP = !!(_rwP && _rwP.type === "FREE_DELIVERY");
      const netSubP = Math.max(0, discountedSub - rewardAmtP);
      const feeFinalP = rewardFreeDelP ? 0 : fee;
      const gst = Math.round(netSubP * 0.18);

      // Promo code entry
      const pInput = el("input", { type: "text", value: state.appliedPromoCode || "", placeholder: "Promo code",
        autocapitalize: "characters", style: "flex:1;text-transform:uppercase;padding:8px 10px;border:1px solid var(--line,#ddd);border-radius:8px" });
      const pBtn = el("button", { type: "button", class: "btn ghost sm" }, state.appliedPromoCode ? "Remove" : "Apply");
      pBtn.onclick = async () => {
        if (state.appliedPromoCode) { state.appliedPromoCode = null; state.appliedPromoPct = 0; state.promoMsg = null; renderCartPanel(); return; }
        const code = (pInput.value || "").trim().toUpperCase();
        if (!code) return;
        pBtn.disabled = true; pBtn.textContent = "…";
        try {
          const qi = cartLines().map((l) => ({ productId: l.productId, qty: l.qty }));
          const r = await BW.quoteOrder({ vendorId: state.cartVendor, items: qi, promoCode: code });
          if (r.promoError) { state.appliedPromoCode = null; state.appliedPromoPct = 0; state.promoMsg = { ok: false, text: r.promoError }; }
          else if (r.discount && r.discount.source === "promo") { state.appliedPromoCode = code; state.appliedPromoPct = r.discount.pct; state.promoMsg = { ok: true, text: "Code " + code + " applied — you save " + money(r.discount.amount) }; }
          else { state.appliedPromoCode = null; state.appliedPromoPct = 0; state.promoMsg = { ok: true, text: r.discount && r.discount.amount ? "Your store discount already beats that code." : "That code gives no extra discount." }; }
        } catch (e) { state.promoMsg = { ok: false, text: e.message || "Couldn't apply that code" }; }
        renderCartPanel();
      };

      const bill = el("div", { class: "card", style: "margin-bottom:12px" }, [
        el("div", { class: "line", style: "border:none;gap:8px" }, [pInput, pBtn]),
        state.promoMsg ? el("div", { class: "small", style: "margin:-2px 0 6px;color:" + (state.promoMsg.ok ? "var(--brand)" : "#c0392b") }, state.promoMsg.text) : document.createTextNode(""),
        el("div", { class: "line", style: "border:none" }, [el("span", { class: "muted" }, "Subtotal"), el("span", {}, money(sub))]),
        disc > 0 ? el("div", { class: "line", style: "border:none" }, [el("span", { class: "muted" }, discLabel), el("span", { style: "color:var(--brand)" }, "− " + money(disc))]) : document.createTextNode(""),
        rewardAmtP > 0 ? el("div", { class: "line", style: "border:none" }, [el("span", { class: "muted" }, "🎁 Reward (10% off)"), el("span", { style: "color:var(--brand)" }, "− " + money(rewardAmtP))]) : document.createTextNode(""),
        el("div", { class: "line", style: "border:none" }, [el("span", { class: "muted" }, "GST (18%)"), el("span", {}, money(gst))]),
        el("div", { class: "line", style: "border:none" }, [el("span", { class: "muted" }, "Delivery fee"), rewardFreeDelP ? el("span", { style: "color:var(--brand)" }, "FREE 🎁") : el("span", {}, money(fee))]),
        el("div", { class: "line", style: "border:none;font-size:16px;padding-top:4px" }, [
          el("strong", {}, "Total"), el("strong", { style: "color:var(--brand)" }, money(netSubP + gst + feeFinalP)),
        ]),
      ]);
      panelCart.appendChild(bill);

      const mkOpt = (val, label) => el("button", {
        type: "button",
        class: "btn " + (state.paymentMethod === val ? "primary" : "ghost") + " sm",
        style: "flex:1",
        onClick: () => { state.paymentMethod = val; renderCartPanel(); },
      }, label);
      panelCart.appendChild(el("div", { class: "muted small", style: "margin-bottom:6px" }, "Payment method"));
      panelCart.appendChild(el("div", { style: "display:flex;gap:8px;margin-bottom:14px" }, [
        mkOpt("COD", "Pay on delivery"),
        mkOpt("ONLINE", "Pay now online"),
      ]));

      // ---- Delivery address (Zomato-style: pin + structured fields) ----
      const cust0 = BW.currentCustomer();
      if (state.deliverFlat == null) state.deliverFlat = "";
      if (state.deliverArea == null) state.deliverArea = (cust0 && cust0.address) || "";
      if (state.deliverLandmark == null) state.deliverLandmark = "";
      if (state.deliverPhone == null) state.deliverPhone = (cust0 && cust0.phone) || "";
      if (state.deliverName == null) state.deliverName = (cust0 && cust0.name) || "";
      if (!state.deliverLoc && cust0 && cust0.lat) state.deliverLoc = { lat: cust0.lat, lng: cust0.lng };

      const field = (label, valKey, ph, inputmode) => {
        const inp = el("input", { type: "text", value: state[valKey] || "", placeholder: ph, inputmode: inputmode || "text" });
        inp.addEventListener("input", (e) => { state[valKey] = e.target.value; });
        return el("div", { class: "field", style: "margin-bottom:8px" }, [el("label", {}, label), inp]);
      };

      const locStatus = el("div", { class: "small", style: "margin-top:6px;color:" + (state.deliverLoc ? "var(--brand)" : "var(--muted)") },
        state.deliverLoc ? ("📍 Location set" + (state.deliverAcc ? " (±" + state.deliverAcc + "m)" : "") + " — drag the pin below to fine-tune.") : "Tap above to set your location automatically.");
      const useLocBtn = el("button", { class: "btn primary", type: "button", style: "width:100%" }, "📍 Use my current location");
      useLocBtn.addEventListener("click", () => {
        if (!navigator.geolocation) { toast("Location not available on this device"); return; }
        if (!window.isSecureContext) { toast("Location needs a secure (https) connection. Please open the app via https."); return; }
        useLocBtn.disabled = true; useLocBtn.textContent = "Locating…";
        navigator.geolocation.getCurrentPosition(
          (p) => { state.deliverLoc = { lat: p.coords.latitude, lng: p.coords.longitude }; state.deliverAcc = Math.round(p.coords.accuracy || 0); toast("Location set ✓"); renderCartPanel(); },
          (err) => {
            toast(err && err.code === 1 ? "Location permission blocked. Enable location for this site, or type your address below." : "Couldn't get your location — drag the pin on the map, or type your address below.");
            useLocBtn.disabled = false; useLocBtn.textContent = "📍 Use my current location";
          },
          { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
        );
      });
      const picker = UI.mapPicker({
        height: 190,
        lat: state.deliverLoc && state.deliverLoc.lat,
        lng: state.deliverLoc && state.deliverLoc.lng,
        accuracy: state.deliverAcc || 0,
        onPick: (la, ln) => { state.deliverLoc = { lat: la, lng: ln }; state.deliverAcc = 0; locStatus.style.color = "var(--brand)"; locStatus.textContent = "📍 Location set — drag the pin to fine-tune."; },
      });

      panelCart.appendChild(el("div", { class: "card", style: "margin-bottom:12px" }, [
        el("div", { style: "font-weight:800;margin-bottom:8px" }, "Delivery location"),
        useLocBtn,
        locStatus,
        el("div", { style: "margin:10px 0" }, [
          el("div", { class: "muted small", style: "margin-bottom:4px" }, "Or pick / drag the pin to your exact door:"),
          picker,
        ]),
        field("Flat / House no. & building", "deliverFlat", "e.g. Flat 3B, Sunrise Apartments"),
        field("Area / street / colony", "deliverArea", "e.g. MG Road, Dwaraka Nagar"),
        field("Landmark", "deliverLandmark", "e.g. near Reliance Fresh"),
        el("div", { style: "display:flex;gap:8px" }, [
          el("div", { style: "flex:1" }, [field("Receiver name", "deliverName", "Name")]),
          el("div", { style: "flex:1" }, [field("Receiver phone", "deliverPhone", "10-digit mobile", "tel")]),
        ]),
        // Advanced fallback — paste a Maps link (kept for edge cases, de-emphasised).
        el("details", { style: "margin-top:6px" }, [
          el("summary", { class: "muted small", style: "cursor:pointer" }, "Advanced: paste a Google Maps link instead"),
          el("div", { style: "margin-top:8px" }, [
            UI.mapsLinkField({ value: state.deliverMapsUrl || "", onResolved: (la, ln, url) => { state.deliverMapsUrl = url; if (la != null) { state.deliverLoc = { lat: la, lng: ln }; state.deliverAcc = 0; locStatus.style.color = "var(--brand)"; locStatus.textContent = "📍 Location set from link."; } } }),
          ]),
        ]),
      ]));

      // ---- Pharmacy verification (prescription + selfie + liability consent) ----
      if (isMedicalVendor(BW.vendor(state.cartVendor))) {
        const mkUpload = (labelText, key, accept, capture) => {
          const inp = el("input", { type: "file", accept: accept });
          if (capture) inp.setAttribute("capture", capture);
          const st = el("span", { class: "muted small", style: "margin-left:8px" }, state[key] ? "✓ uploaded" : "required");
          inp.addEventListener("change", async (e) => {
            const f = e.target.files[0]; if (!f) return;
            st.textContent = "uploading…";
            try { state[key] = await uploadToCloudinary(f); st.textContent = "✓ uploaded"; }
            catch (err) { st.textContent = "upload failed — try again"; }
          });
          return el("div", { class: "field", style: "margin-bottom:8px" }, [el("label", {}, labelText), el("div", { style: "display:flex;align-items:center" }, [inp, st])]);
        };
        const consentCb = el("input", { type: "checkbox" });
        consentCb.checked = !!state.rxConsent;
        consentCb.addEventListener("change", (e) => { state.rxConsent = e.target.checked; });
        panelCart.appendChild(el("div", { class: "card", style: "margin-bottom:12px;border:1px solid var(--brand)" }, [
          el("div", { style: "font-weight:800;color:var(--brand);margin-bottom:4px" }, "💊 Pharmacy order — verification required"),
          el("div", { class: "muted small", style: "margin-bottom:10px" }, "This store sells medicines. A valid prescription and a selfie are mandatory."),
          mkUpload("Upload prescription (photo / PDF)", "rxPrescriptionUrl", "image/*,application/pdf"),
          mkUpload("Upload a selfie (identity check)", "rxSelfieUrl", "image/*", "user"),
          el("label", { style: "display:flex;gap:8px;align-items:flex-start;font-size:11.5px;color:var(--muted);margin-top:6px;cursor:pointer" }, [
            consentCb,
            el("span", {}, "I confirm this prescription is genuine and issued to me, I take full responsibility for this medicine order and any legal consequences, and I authorise Saardha to securely store my prescription and selfie for verification and legal compliance."),
          ]),
        ]));
      }

      panelCart.appendChild(el("button", {
        class: "btn primary", style: "width:100%",
        onClick: () => placeOrder(),
      }, "Place order →"));
    }

    /* ---- Orders panel ---- */
    function orderCard(o) {
      const v = BW.vendor(o.vendorId);
      const terminal = o.status === "DELIVERED" || o.status === "CANCELLED";
      const itemsTxt = o.items.reduce((s, l) => s + l.qty, 0) + " items";
      const card = el("div", { class: "order-card clickable", onClick: () => go("track", { trackOrderId: o.id }) }, [
        el("div", { class: "oc-top" }, [
          el("span", { class: terminal ? "oc-done" : "oc-live" },
            terminal ? (BW.STATUS_LABEL[o.status] || o.status).toUpperCase() : "● " + (BW.STATUS_LABEL[o.status] || o.status).toUpperCase()),
          el("span", { class: "oc-id" }, "#" + (o.orderNo || o.id.slice(-6).toUpperCase())),
        ]),
        el("div", { class: "oc-items" }, (v ? v.name + " · " : "") + itemsTxt),
        el("div", { class: "oc-meta" }, timeAgo(o.createdAt) + " · " + money(o.total)),
      ]);
      if (terminal && o.status === "DELIVERED" && v) {
        card.appendChild(el("div", { class: "oc-reorder", onClick: (e) => { e.stopPropagation(); reorder(o); } }, "Reorder"));
      }
      return card;
    }

    function renderOrdersPanel() {
      panelOrders.innerHTML = "";
      const orders = cust ? BW.orders({ customerId: cust.id }) : BW.orders();
      if (!orders.length) {
        panelOrders.appendChild(el("div", { class: "empty" },
          [el("div", { class: "e" }, ""), "No orders yet. Scan a store's QR code to get started."]));
        return;
      }
      const fresh = orders.filter((o) => o.status !== "DELIVERED" && o.status !== "CANCELLED");
      const prev  = orders.filter((o) => o.status === "DELIVERED" || o.status === "CANCELLED");
      if (fresh.length) {
        panelOrders.appendChild(el("div", { class: "order-section-title" }, "Fresh orders"));
        fresh.forEach((o) => panelOrders.appendChild(orderCard(o)));
      }
      if (prev.length) {
        panelOrders.appendChild(el("div", { class: "order-section-title" }, "Previous orders"));
        prev.forEach((o) => panelOrders.appendChild(orderCard(o)));
      }
    }

    renderCartPanel();
    renderOrdersPanel();
    panelCart.style.display   = activeTab === "cart" ? "" : "none";
    panelOrders.style.display = activeTab === "orders" ? "" : "none";
    btnCart.className   = activeTab === "cart" ? "on" : "";
    btnOrders.className = activeTab === "orders" ? "on" : "";

    shell("cart", [
      el("h1", { class: "page-title" }, "Cart & Orders"),
      toggle,
      panelCart,
      panelOrders,
    ]);
  }

  // Re-add every item from a past order into a fresh cart, then open the cart.
  function reorder(o) {
    const v = BW.vendor(o.vendorId);
    if (!v) { toast("That store is no longer available"); return; }
    state.cart = {};
    state.cartVendor = o.vendorId;
    o.items.forEach((l) => {
      const pid = l.productId || l.id;
      if (pid) state.cart[pid] = (state.cart[pid] || 0) + (l.qty || 1);
    });
    toast("Items added to your cart");
    go("cart", { cartTab: "cart" });
  }

  // Grab the customer's GPS so the rider gets an exact drop location. Resolves
  // to null if unavailable/denied — the order still places (rider uses the address).
  function getDeliveryLocation() {
    return new Promise(function (resolve) {
      if (!navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        function (p) { resolve({ lat: p.coords.latitude, lng: p.coords.longitude }); },
        function () { resolve(null); },
        { enableHighAccuracy: true, timeout: 8000 }
      );
    });
  }

  // Compose a precise delivery address from the structured fields.
  function composedDeliverTo() {
    return [state.deliverFlat, state.deliverArea, state.deliverLandmark]
      .map((s) => (s || "").trim()).filter(Boolean).join(", ");
  }
  // Require a usable address (a pin, or enough typed detail) before ordering.
  function ensureDeliveryAddress() {
    // A saved Google Maps link is enough on its own — the Saradhi navigates straight to it.
    if (state.deliverMapsUrl) return true;
    const addr = composedDeliverTo();
    if (!state.deliverLoc && addr.length < 6) {
      toast("Please set your address — paste a Google Maps link, drop a pin, or fill the address.");
      return false;
    }
    if (!state.deliverArea || state.deliverArea.trim().length < 3) {
      toast("Please add the area / street for delivery.");
      return false;
    }
    return true;
  }

  // A store that sells medicines needs a prescription + selfie + consent.
  function isMedicalVendor(v) {
    return !!(v && (v.requiresPrescription || /medical|pharma|chemist|clinic|drug/i.test(v.category || "")));
  }
  // Upload a file to Cloudinary (unsigned preset) → returns the secure URL.
  async function uploadToCloudinary(file) {
    const cfg = BW.config ? BW.config() : {};
    if (!cfg.cloudinaryCloud || !cfg.cloudinaryPreset) throw new Error("Uploads are not configured");
    const fd = new FormData();
    fd.append("file", file);
    fd.append("upload_preset", cfg.cloudinaryPreset);
    const r = await fetch("https://api.cloudinary.com/v1_1/" + cfg.cloudinaryCloud + "/auto/upload", { method: "POST", body: fd });
    const data = await r.json();
    if (!data.secure_url) throw new Error("Upload failed");
    return data.secure_url;
  }
  function ensureRx(vendorId) {
    if (!isMedicalVendor(BW.vendor(vendorId))) return true;
    if (!state.rxPrescriptionUrl || !state.rxSelfieUrl || !state.rxConsent) {
      toast("Pharmacy order: upload prescription + selfie and accept the terms.");
      return false;
    }
    return true;
  }

  let _placing = false;
  async function placeOrder() {
    if (_placing) return; // guard against double-tap creating two orders
    const vendorId = state.cartVendor;
    const items = cartLines();
    if (!ensureDeliveryAddress()) return;
    if (!ensureRx(vendorId)) return;
    if (state.paymentMethod === "ONLINE") return payOnlineThenPlace(vendorId, items);
    _placing = true;
    const loc = state.deliverLoc || await getDeliveryLocation();   // chosen pin, else auto-GPS
    showPlacing();
    try {
      const cust = BW.currentCustomer();
      const order = await BW.placeOrder({ vendorId, items, paymentMethod: "COD", promoCode: state.appliedPromoCode || null,
        deliverLat: loc && loc.lat, deliverLng: loc && loc.lng, deliverTo: composedDeliverTo() || (cust && cust.address),
        deliverPhone: state.deliverPhone, deliverName: state.deliverName, deliverMapsUrl: state.deliverMapsUrl || null,
        prescriptionUrl: state.rxPrescriptionUrl, selfieUrl: state.rxSelfieUrl, rxConsent: state.rxConsent });
      state.cart = {};
      state.cartVendor = null;
      state.appliedPromoCode = null; state.appliedPromoPct = 0; state.promoMsg = null;
      refreshRewards();  // refresh coin balance; a redeemed reward may have been consumed
      hidePlacing();
      showOrderConfirmation(order);
    } catch (err) {
      hidePlacing();
      toast(err.message || "Failed to place order");
    } finally {
      _placing = false;
    }
  }

  async function payOnlineThenPlace(vendorId, items) {
    if (_placing) return;
    if (typeof Razorpay === "undefined") {
      toast("Online payment unavailable — please choose Cash on delivery");
      return;
    }
    _placing = true;
    const loc = state.deliverLoc || await getDeliveryLocation();   // chosen pin, else auto-GPS
    let pay;
    try {
      pay = await BW.createPaymentOrder({ vendorId, items, promoCode: state.appliedPromoCode || null });
    } catch (err) {
      toast(err.message || "Could not start payment");
      _placing = false;
      return;
    }
    const cust = BW.currentCustomer();
    const rzp = new Razorpay({
      key: pay.keyId,
      amount: pay.amount,
      currency: pay.currency,
      order_id: pay.razorpayOrderId,
      name: "Saardha",
      description: "Order payment",
      prefill: cust ? { name: cust.name || "", contact: cust.phone || "", email: cust.email || "" } : {},
      theme: { color: "#e62a1f" },
      modal: { ondismiss: () => { _placing = false; } },
      handler: async (resp) => {
        _placing = false;
        showPlacing();
        try {
          const order = await BW.placeOrder({
            vendorId, items, paymentMethod: "ONLINE", promoCode: state.appliedPromoCode || null,
            razorpay_payment_id: resp.razorpay_payment_id,
            razorpay_order_id: resp.razorpay_order_id,
            razorpay_signature: resp.razorpay_signature,
            deliverLat: loc && loc.lat, deliverLng: loc && loc.lng, deliverTo: composedDeliverTo() || (cust && cust.address),
            deliverPhone: state.deliverPhone, deliverName: state.deliverName, deliverMapsUrl: state.deliverMapsUrl || null,
            prescriptionUrl: state.rxPrescriptionUrl, selfieUrl: state.rxSelfieUrl, rxConsent: state.rxConsent,
          });
          state.cart = {};
          state.cartVendor = null;
          hidePlacing();
          showOrderConfirmation(order);
        } catch (err) {
          hidePlacing();
          toast("Payment received but order failed — contact support: " + err.message);
        }
      },
    });
    rzp.on("payment.failed", (r) => {
      _placing = false;
      toast("Payment failed: " + ((r.error && r.error.description) || "please try again"));
    });
    rzp.open();
  }

  function showOrderConfirmation(order) {
    _orderJustPlaced = true;
    if (BW.track) BW.track("order_placed", { orderId: order && order.id, vendorId: order && order.vendorId, total: order && order.total, method: order && order.paymentMethod });
    const overlay = el("div", { class: "order-confirm-overlay" }, [
      el("div", { class: "order-confirm-circle" }, [
        el("svg", { width: "50", height: "50", viewBox: "0 0 50 50" }, [
          el("polyline", { class: "order-confirm-tick", points: "10,27 21,38 40,16" }),
        ]),
      ]),
      el("div", { class: "order-confirm-title" }, "Order Placed!"),
      el("div", { class: "order-confirm-sub" }, "We're finding your Saradhi…"),
    ]);
    document.body.appendChild(overlay);
    setTimeout(() => {
      overlay.remove();
      go("track", { trackOrderId: order.id });
    }, 2200);
  }

  /* ====================== TRACK ====================== */
  function viewTrack() {
    const o = BW.order(state.trackOrderId);
    if (!o) return go("history");
    const v = BW.vendor(o.vendorId);
    const cust = BW.currentCustomer();
    const rider = o.riderId ? BW.rider(o.riderId) : null;

    // Track rider's live location + live ETA
    if (rider) BW.joinOrderRoom(o.id);
    if (rider && !["DELIVERED", "CANCELLED"].includes(o.status)) startEtaPolling(o.id, o.riderId);
    else stopEtaPolling();

    const body = [
      el("button", { class: "btn ghost sm", onClick: () => go("history") }, "← My Orders"),
      el("div", { class: "row between", style: "margin:14px 0" }, [
        el("div", {}, [
          el("h1", { class: "page-title", style: "margin:0" }, "Order " + (o.orderNo || o.id.slice(-6).toUpperCase())),
          el("div", { class: "muted" }, v.name + " · placed " + timeAgo(o.createdAt)),
        ]),
        statusBadge(o.status),
      ]),
      el("div", { class: "card" }, [tracker(o.status)]),
      (o.status === "PLACED")
        ? el("div", { class: "card", style: "margin-top:12px" }, [
            el("div", { class: "muted small", style: "margin-bottom:8px" }, "Changed your mind? You can cancel until the store accepts your order" + (o.paymentMethod === "ONLINE" ? " — your online payment is refunded automatically." : ".")),
            el("button", { class: "btn danger", style: "width:100%", onClick: () => cancelOrderFlow(o) }, "Cancel order"),
          ])
        : document.createTextNode(""),
      (o.status !== "DELIVERED" && o.status !== "CANCELLED")
        ? (function () {
            ensureGameStyles();
            const coins = _rewards.goldCoins || 0;
            const toGoal = Math.max(0, (_rewards.redeemCost || 100) - coins);
            return el("div", { class: "bw-play-invite", style: "margin-top:12px;border-radius:14px;background:linear-gradient(90deg,#f7b733,#fc4a1a);color:#fff;padding:16px;text-align:center;box-shadow:0 6px 18px rgba(252,74,26,.35)" }, [
              el("div", { class: "bw-play-emoji", style: "font-size:34px;line-height:1" }, "🎮"),
              el("div", { style: "font-weight:900;font-size:17px;margin-top:4px" }, "Play while you wait!"),
              el("div", { style: "font-size:13px;opacity:.95;margin:4px 0 2px" }, "Win a quick game → earn 🪙 10 gold coins."),
              el("div", { style: "font-size:12.5px;opacity:.92;margin-bottom:10px" },
                coins >= (_rewards.redeemCost || 100)
                  ? "You have 🪙 " + coins + " — enough for FREE delivery or 10% off!"
                  : "You have 🪙 " + coins + " · just " + toGoal + " more for FREE delivery or 10% off."),
              el("button", { class: "bw-play-btn", style: "background:#fff;color:#c0392b;font-weight:800;border:none;border-radius:10px;padding:11px 22px;font-size:15px;cursor:pointer", onClick: () => { openGameModal(o.id); refreshRewards(); } }, "▶ Play now"),
              el("div", { style: "font-size:11px;opacity:.85;margin-top:8px" }, "A different game every time · one reward per order"),
            ]);
          })()
        : document.createTextNode(""),
      el("div", { style: "margin-top:12px" }, [
        el("button", { class: "btn ghost sm", style: "width:100%", onClick: () => openTicketForm(o.id) }, "🎧 Get help with this order"),
      ]),
      (o.status !== "DELIVERED" && o.status !== "CANCELLED") ? deliveryOtpCard(o) : document.createTextNode(""),
      o.status === "CANCELLED"
        ? el("div", { class: "card", style: "border:1px solid var(--red);background:#fdeceb;margin-top:12px" }, [
            el("div", { style: "font-weight:800;color:var(--red)" }, "Order declined by the store"),
            el("div", { class: "muted small", style: "margin-top:4px" }, "Sorry — the store couldn't accept this order. If you paid online, your refund is being processed. You can try another store from My Stores."),
            el("button", { class: "btn ghost sm", style: "margin-top:10px", onClick: () => go("stores") }, "Back to stores"),
          ])
        : document.createTextNode(""),
      ratingCard(o),
      el("div", { class: "grid cols-2", style: "margin-top:16px" }, [
        el("div", { class: "card" }, [
          el("h3", { style: "margin-top:0" }, "Live tracking"),
          mapFallbackCard(o, rider),
          // Always-works fallback: open the Saradhi's live position in Google Maps
          // (no API key needed — handy when the embedded map can't load).
          (rider && rider.lat && !["DELIVERED", "CANCELLED"].includes(o.status))
            ? el("a", {
                class: "btn primary sm", style: "width:100%;margin-top:8px;display:block;text-align:center",
                target: "_blank", rel: "noopener",
                href: "https://www.google.com/maps/dir/?api=1&origin=" + rider.lat + "," + rider.lng +
                      "&destination=" + (cust && cust.lat ? cust.lat + "," + cust.lng : encodeURIComponent(o.deliverTo || "")) + "&travelmode=driving",
              }, "🧭 See where your Saradhi is")
            : document.createTextNode(""),
          rider
            ? el("div", {}, [
                el("div", { class: "row between", style: "margin-top:12px" }, [
                  el("div", {}, [el("div", { style: "font-weight:600" }, rider.name), el("div", { class: "muted small" }, (rider.vehicle || "") + " · " + (rider.rating || "5") + " ★")]),
                  el("a", { class: "btn ghost sm", href: "tel:" + rider.phone }, "Call"),
                  waLink(rider.phone) ? el("a", { class: "btn ghost sm", href: waLink(rider.phone), target: "_blank", rel: "noopener" }, "Chat") : document.createTextNode(""),
                ]),
                etaBadge(o, rider, cust),
              ])
            : el("div", { class: "muted small", style: "margin-top:12px" },
                o.status === "CANCELLED" ? "This order was declined — no delivery." : "Waiting for a Saradhi to be assigned…"),
        ]),
        el("div", { class: "card" }, [
          el("h3", { style: "margin-top:0" }, "Order summary"),
          ...o.items.map((l) => el("div", { class: "row between small", style: "padding:5px 0" }, [
            el("span", {}, l.qty + "× " + l.name), el("span", { class: "muted" }, money(l.price * l.qty)),
          ])),
          (o.discount && o.discount.amount > 0)
            ? el("div", { class: "row between small", style: "padding:3px 0;color:var(--brand)" }, [
                el("span", {}, "Discount" + (o.discount.code ? " (" + o.discount.code + ")" : "")), el("span", {}, "− " + money(o.discount.amount)),
              ])
            : document.createTextNode(""),
          el("div", { class: "line", style: "border-top:1px solid var(--border);margin-top:8px;padding-top:10px" }, [
            el("strong", {}, "Total"), el("strong", {}, money(o.total)),
          ]),
          (o.paymentStatus === "REFUNDED")
            ? el("div", { class: "small", style: "margin-top:8px;color:var(--brand)" }, "✓ Refund of " + money((o.refund && o.refund.amount) || o.total) + " initiated to your original payment method.")
            : (o.paymentStatus === "REFUND_PENDING")
              ? el("div", { class: "small", style: "margin-top:8px;color:#c0392b" }, "Refund is being processed by our team.")
              : document.createTextNode(""),
          el("div", { class: "muted small", style: "margin-top:10px" }, "Deliver to: " + (o.deliverTo || (cust && cust.address) || "—")),
        ]),
      ]),
    ];
    shell("history", body);
  }

  // Confirm + cancel a still-PLACED order, with an optional reason. Online payments
  // are auto-refunded server-side; we surface the outcome to the customer.
  function cancelOrderFlow(o) {
    const reasons = ["Ordered by mistake", "Changed my mind", "Wrong items in cart", "Delivery taking too long", "Other"];
    const sel = el("select", {}, reasons.map((r) => el("option", { value: r }, r)));
    let close;
    const confirmBtn = el("button", { class: "btn danger" }, "Cancel my order");
    confirmBtn.onclick = async () => {
      confirmBtn.disabled = true; confirmBtn.textContent = "Cancelling…";
      try {
        const updated = await BW.cancelOrder(o.id, sel.value);
        close && close();
        if (updated.paymentStatus === "REFUNDED") toast("Order cancelled. Refund of " + money((updated.refund && updated.refund.amount) || o.total) + " initiated.");
        else if (updated.paymentStatus === "REFUND_PENDING") toast("Order cancelled. Your refund is being processed.");
        else toast("Order cancelled.");
        render();
      } catch (e) { toast(e.message || "Couldn't cancel"); confirmBtn.disabled = false; confirmBtn.textContent = "Cancel my order"; }
    };
    close = UI.modal({
      title: "Cancel this order?",
      body: el("div", {}, [
        el("p", { class: "muted small", style: "margin:0 0 10px" }, o.paymentMethod === "ONLINE"
          ? "Your online payment will be refunded automatically to your original payment method."
          : "This order hasn't been accepted yet, so you can cancel it now."),
        el("div", { class: "field" }, [el("label", {}, "Reason (optional)"), sel]),
      ]),
      footer: [el("button", { class: "btn ghost", onClick: () => close() }, "Keep order"), confirmBtn],
    });
  }

  /* ----- live ETA ----- */
  let _etaTimer = null, _etaOrderId = null;
  function haversineKm(la1, lo1, la2, lo2) {
    if (!la1 || !lo1 || !la2 || !lo2) return null;
    const R = 6371, toR = (d) => d * Math.PI / 180;
    const dLa = toR(la2 - la1), dLo = toR(lo2 - lo1);
    const a = Math.sin(dLa / 2) ** 2 + Math.cos(toR(la1)) * Math.cos(toR(la2)) * Math.sin(dLo / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
  function etaMinutes(rider, cust) {
    const km = haversineKm(rider && rider.lat, rider && rider.lng, cust && cust.lat, cust && cust.lng);
    if (km == null) return null;
    return Math.max(2, Math.round((km / 20) * 60)); // ~20 km/h city speed
  }
  function etaBadge(o, rider, cust) {
    if (["DELIVERED", "CANCELLED"].includes(o.status)) return document.createTextNode("");
    const mins = rider && cust ? etaMinutes(rider, cust) : null;
    if (mins == null) return document.createTextNode("");
    return el("div", { style: "margin-top:10px;background:var(--brand-lt);border-radius:8px;padding:9px 12px;font-weight:800;color:var(--brand);text-align:center" },
      "🛵 Arriving in about " + mins + " min");
  }
  function startEtaPolling(orderId, riderId) {
    if (_etaTimer && _etaOrderId === orderId) return;
    stopEtaPolling();
    _etaOrderId = orderId;
    if (!riderId) return;
    _etaTimer = setInterval(() => { BW.refreshRider(riderId); }, 15000);
  }
  function stopEtaPolling() {
    if (_etaTimer) { clearInterval(_etaTimer); _etaTimer = null; }
    _etaOrderId = null;
  }

  /* ----- ratings ----- */
  function ratingCard(o) {
    if (o.status !== "DELIVERED") return document.createTextNode("");
    if (o.rating) {
      return el("div", { class: "card", style: "margin-top:14px" }, [
        el("h3", { style: "margin-top:0" }, "Your rating"),
        el("div", { style: "font-size:22px;color:#f5b301;letter-spacing:2px" },
          "★".repeat(o.rating.store) + "☆".repeat(5 - o.rating.store)),
        o.rating.comment
          ? el("div", { class: "muted small", style: "margin-top:6px" }, o.rating.comment)
          : document.createTextNode(""),
      ]);
    }
    return el("div", { class: "card", style: "margin-top:14px;text-align:center" }, [
      el("div", { style: "font-weight:600;margin-bottom:10px" }, "Your order was delivered 🎉"),
      el("button", { class: "btn primary", onClick: () => openRatingModal(o) }, "★ Rate your order"),
    ]);
  }

  function starRow(onPick) {
    const btns = [];
    const wrap = el("div", { style: "display:flex;gap:8px;font-size:32px;cursor:pointer;justify-content:center" });
    const paint = (n) => btns.forEach((b, i) => (b.style.color = i < n ? "#f5b301" : "#d0d0d0"));
    for (let i = 1; i <= 5; i++) {
      const idx = i;
      const s = el("span", { onClick: () => { onPick(idx); paint(idx); } }, "★");
      s.style.color = "#d0d0d0";
      btns.push(s); wrap.appendChild(s);
    }
    return wrap;
  }

  function openRatingModal(o) {
    const v = BW.vendor(o.vendorId);
    const rider = o.riderId ? BW.rider(o.riderId) : null;
    let storeRating = 0, riderRating = 0;
    const commentEl = el("textarea", { placeholder: "Add a comment (optional)", rows: "2", style: "width:100%;margin-top:6px" });

    const body = el("div", {}, [
      el("div", { style: "font-weight:600;margin-bottom:8px;text-align:center" }, "How was " + (v ? v.name : "the store") + "?"),
      starRow((n) => storeRating = n),
      rider ? el("div", { style: "font-weight:600;margin:18px 0 8px;text-align:center" }, "How was your Saradhi, " + rider.name + "?") : document.createTextNode(""),
      rider ? starRow((n) => riderRating = n) : document.createTextNode(""),
      commentEl,
    ]);

    let close;
    close = UI.modal({
      title: "Rate your order",
      body,
      footer: [
        el("button", { class: "btn ghost", onClick: () => close() }, "Later"),
        el("button", { class: "btn primary", onClick: async () => {
          if (!storeRating) { toast("Please tap a star to rate the store"); return; }
          try {
            await BW.rateOrder(o.id, { storeRating, riderRating: riderRating || null, comment: commentEl.value });
            toast("Thanks for your feedback!");
            close();
            render();
          } catch (e) { toast(e.message || "Failed to submit rating"); }
        } }, "Submit rating"),
      ],
    });
  }

  // WhatsApp deep link (adds India country code for 10-digit numbers).
  function waLink(phone) {
    if (!phone) return null;
    var d = String(phone).replace(/\D/g, "");
    if (!d) return null;
    if (d.length === 10) d = "91" + d;
    return "https://wa.me/" + d;
  }

  // Customer's own 4-digit delivery OTP — read out to the Saradhi at the door.
  function deliveryOtpCard(o) {
    const box = el("div", { class: "card", style: "text-align:center;border:1px solid var(--brand);background:var(--brand-lt)" }, [
      el("div", { class: "small", style: "font-weight:700;color:var(--brand)" }, "Delivery OTP"),
      el("div", { style: "font-size:30px;font-weight:800;letter-spacing:8px;color:var(--brand);margin:4px 0" }, "····"),
      el("div", { class: "muted small" }, "Share this with your Saradhi to receive your order"),
    ]);
    const codeEl = box.children[1];
    if (BW.deliveryOtp) BW.deliveryOtp(o.id).then((r) => { if (r && r.otp) codeEl.textContent = r.otp; }).catch(() => {});
    return box;
  }

  function mapFor(vendor, customer, rider) {
    // Real Google Map when a key is configured, else the built-in map.
    if (UI.gmap) {
      const markers = [];
      if (vendor && vendor.lat)   markers.push({ lat: vendor.lat, lng: vendor.lng, label: "Store" });
      if (customer && customer.lat) markers.push({ lat: customer.lat, lng: customer.lng, label: "You" });
      if (rider && rider.lat)     markers.push({ lat: rider.lat, lng: rider.lng, label: "Saradhi", icon: "chariot" });
      const gm = UI.gmap({ markers: markers, height: 240 });
      if (gm) return gm;
    }
    const map = el("div", { class: "map" });
    const pin = (lat, lng, head, lbl) => {
      if (!lat || !lng) return document.createTextNode("");
      const { x, y } = project(lat, lng);
      return el("div", { class: "pin", style: `left:${x}%;top:${y}%` }, [
        el("div", { class: "head" }, head),
        el("div", { class: "lbl small" }, lbl),
      ]);
    };
    if (vendor) map.appendChild(pin(vendor.lat, vendor.lng, "M", "Vendor"));
    if (customer) map.appendChild(pin(customer.lat, customer.lng, "Y", "You"));
    if (rider) map.appendChild(pin(rider.lat, rider.lng, "R", rider.name.split(" ")[0]));
    return map;
  }

  /* ====================== HISTORY ====================== */
  function viewHistory() {
    const cust = BW.currentCustomer();
    const orders = cust ? BW.orders({ customerId: cust.id }) : BW.orders();

    let body;
    if (!orders.length) {
      body = [
        el("h1", { class: "page-title" }, "My Orders"),
        el("div", { class: "empty" }, [el("div", { class: "e" }, ""), "No orders yet. Scan a store's QR code to get started."]),
      ];
    } else {
      const rows = orders.map((o) => {
        const v = BW.vendor(o.vendorId);
        return el("tr", { class: "clickable", onClick: () => go("track", { trackOrderId: o.id }) }, [
          el("td", {}, el("strong", {}, (o.orderNo || o.id.slice(-6).toUpperCase()))),
          el("td", {}, v ? v.name : "—"),
          el("td", {}, o.items.reduce((s, l) => s + l.qty, 0) + " items"),
          el("td", {}, money(o.total)),
          el("td", {}, statusBadge(o.status)),
          el("td", { class: "muted small" }, timeAgo(o.createdAt)),
        ]);
      });
      const table = el("table", {}, [
        el("thead", {}, el("tr", {}, ["Order", "Vendor", "Items", "Total", "Status", "When"].map((h) => el("th", {}, h)))),
        el("tbody", {}, rows),
      ]);
      body = [
        el("h1", { class: "page-title" }, "My Orders"),
        el("p", { class: "page-sub" }, "Tap any order to track it live."),
        el("div", { class: "card", style: "padding:0;overflow:hidden" }, table),
      ];
    }
    shell("history", body);
  }

  /* ====================== FAVORITES ====================== */
  function viewFavorites() {
    const favIds = BW.favorites();
    const vendors = BW.vendors().filter((v) => favIds.includes(v.id));

    let body;
    if (!vendors.length) {
      body = [
        el("h1", { class: "page-title" }, "Favorites"),
        el("div", { class: "empty" }, [el("div", { class: "e" }, ""), "No favorites yet. Open a store and tap the heart."]),
      ];
    } else {
      const grid = el("div", { class: "grid cols-3" });
      vendors.forEach((v) => grid.appendChild(vendorCard(v, favIds)));
      body = [el("h1", { class: "page-title" }, "Favorites"), grid];
    }
    shell("favorites", body);
  }

  /* ====================== SCAN QR ====================== */
  function viewScan() {
    let _stream = null;
    let _scanLoop = null;
    let _detector = ("BarcodeDetector" in window) ? new BarcodeDetector({ formats: ["qr_code"] }) : null;

    function stopCamera() {
      if (_scanLoop) { cancelAnimationFrame(_scanLoop); _scanLoop = null; }
      if (_stream) { _stream.getTracks().forEach((t) => t.stop()); _stream = null; }
    }

    function addVendorById(vendorId) {
      if (!vendorId) return;
      if (BW.addShop) BW.addShop(vendorId).catch(function () {});
      addStoreLocal(vendorId);
    }

    function processUrl(urlStr) {
      try {
        const url = new URL(urlStr);
        const v = url.searchParams.get("v");
        if (v) return v;
        const m = url.pathname.match(/\/scan\/([^/?#]+)/);
        return m ? m[1] : null;
      } catch {
        // A raw vendor id (not a URL) is also acceptable
        return /^[A-Za-z0-9_-]{3,}$/.test((urlStr || "").trim()) ? urlStr.trim() : null;
      }
    }

    // Decode a QR from a canvas — BarcodeDetector where available (Chromium),
    // otherwise jsQR (works on iOS Safari). Returns a Promise<string|null>.
    async function decodeCanvas(canvas, ctx) {
      if (_detector) {
        try {
          const codes = await _detector.detect(canvas);
          if (codes && codes.length) return codes[0].rawValue;
        } catch (e) { /* fall through to jsQR */ }
      }
      if (typeof jsQR === "function") {
        try {
          const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const res = jsQR(imgData.data, canvas.width, canvas.height);
          if (res && res.data) return res.data;
        } catch (e) { /* ignore */ }
      }
      return null;
    }

    function startCamera() {
      const videoEl  = document.getElementById("scanVideo");
      const resultEl = document.getElementById("scanResult");
      const startBtn = document.getElementById("scanStartBtn");
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        resultEl.textContent = "Camera not available on this device. Please upload a QR image below.";
        return;
      }
      resultEl.textContent = "Requesting camera permission…";
      navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } })
        .then((stream) => {
          _stream = stream;
          if (startBtn) startBtn.style.display = "none";
          videoEl.style.display = "";
          videoEl.srcObject = stream;
          videoEl.setAttribute("playsinline", "true");
          videoEl.play();
          resultEl.textContent = "Point at a store's QR code…";
          const canvas = document.createElement("canvas");
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          function tick() {
            if (!_stream) return;
            if (videoEl.readyState >= 2) {
              canvas.width = videoEl.videoWidth;
              canvas.height = videoEl.videoHeight;
              ctx.drawImage(videoEl, 0, 0);
              decodeCanvas(canvas, ctx).then((raw) => {
                if (!raw) return;
                const vendorId = processUrl(raw);
                if (vendorId) { stopCamera(); addVendorById(vendorId); onSuccess(vendorId); }
                else { resultEl.textContent = "QR found but not a Saardha store. Try again."; }
              });
            }
            _scanLoop = requestAnimationFrame(tick);
          }
          tick();
        })
        .catch((err) => {
          if (err && err.name === "NotAllowedError") {
            resultEl.innerHTML = "Camera permission was blocked. On iPhone: open Settings → Safari → Camera → Allow, then reload. Or upload a QR image below.";
          } else if (err && err.name === "NotFoundError") {
            resultEl.textContent = "No camera found. Please upload a QR image below.";
          } else {
            resultEl.textContent = "Could not start the camera. Please upload a QR image below.";
          }
          if (startBtn) { startBtn.style.display = ""; startBtn.textContent = "Try camera again"; }
        });
    }

    function onSuccess(vendorId) {
      const vendor = BW.vendor(vendorId);
      const successEl = document.getElementById("scanSuccess");
      if (successEl) {
        successEl.style.display = "";
        successEl.innerHTML = "";
        successEl.appendChild(el("p", { style: "font-size:15px;font-weight:600;margin:0 0 4px" },
          vendor ? `Store added: ${vendor.name}` : "Store added successfully"));
        successEl.appendChild(el("p", { class: "muted small", style: "margin:0 0 16px" },
          "You can now order from this store in My Stores."));
        successEl.appendChild(el("button", { class: "btn primary", onClick: () => go("stores") }, "Browse stores"));
      }
    }

    // --- File upload: show a preview, then an explicit "Scan this QR" button ---
    let _pendingImg = null;
    function handleFilePreview(file) {
      const previewWrap = document.getElementById("scanPreview");
      const scanFileBtn = document.getElementById("scanFileBtn");
      const resultEl = document.getElementById("scanResult");
      resultEl.textContent = "";
      const img = new Image();
      img.onload = () => {
        _pendingImg = img;
        previewWrap.innerHTML = "";
        img.style.cssText = "max-width:100%;max-height:200px;border-radius:10px;border:1px solid var(--border)";
        previewWrap.appendChild(img);
        previewWrap.style.display = "";
        scanFileBtn.style.display = "";
      };
      img.onerror = () => { resultEl.textContent = "Could not open that image."; };
      img.src = URL.createObjectURL(file);
    }
    function scanPendingImage() {
      const resultEl = document.getElementById("scanResult");
      if (!_pendingImg) { resultEl.textContent = "Please choose a QR image first."; return; }
      const canvas = document.createElement("canvas");
      canvas.width = _pendingImg.naturalWidth;
      canvas.height = _pendingImg.naturalHeight;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(_pendingImg, 0, 0);
      decodeCanvas(canvas, ctx).then((raw) => {
        if (!raw) { resultEl.textContent = "No QR code found in that image. Try a clearer photo."; return; }
        const vendorId = processUrl(raw);
        if (vendorId) { addVendorById(vendorId); onSuccess(vendorId); }
        else { resultEl.textContent = "QR found but it's not a Saardha store code."; }
      });
    }

    shell("scan", [
      el("h1", { class: "page-title" }, "Scan QR Code"),
      el("p", { class: "page-sub" }, "Point your camera at a merchant's QR code to add their store."),

      el("div", { class: "scan-camera-box" }, [
        el("video", { id: "scanVideo", playsinline: true, muted: true, style: "display:none;width:100%;border-radius:10px;background:#2c1a0e;max-height:280px;object-fit:cover" }, []),
        el("button", { id: "scanStartBtn", class: "btn primary", style: "width:100%", onClick: startCamera }, "📷  Tap to start camera"),
        el("div", { id: "scanResult", class: "auth-err", style: "margin-top:8px;text-align:left" }, []),
      ]),

      el("div", { id: "scanSuccess", style: "display:none;margin-top:16px;padding:16px;background:var(--surface-2);border-radius:10px;border:1px solid var(--border)" }, []),

      el("div", { class: "scan-file-section" }, [
        el("p", { class: "muted small", style: "margin:16px 0 8px" }, "Or upload a QR code image:"),
        el("input", {
          type: "file", accept: "image/*", id: "scanFileInput", style: "font-size:13px",
          onChange: (e) => { const f = e.target.files[0]; if (f) handleFilePreview(f); },
        }),
        el("div", { id: "scanPreview", style: "display:none;margin-top:12px" }, []),
        el("button", {
          id: "scanFileBtn", class: "btn primary", style: "display:none;width:100%;margin-top:12px",
          onClick: scanPendingImage,
        }, "Scan this QR →"),
      ]),
    ]);

    // On iOS the camera MUST be started from a user gesture, so we no longer
    // auto-start — the user taps "start camera" above.
    window._scanCleanup = stopCamera;
  }

  /* ====================== UI DELIGHT ====================== */
  function skeletonItems(n) {
    const wrap = el("div", { style: "padding:0 2px" });
    for (let i = 0; i < (n || 5); i++) {
      wrap.appendChild(el("div", { class: "skel-row" }, [
        el("span", { class: "skel", style: "width:15px;height:15px;flex-shrink:0" }),
        el("div", { style: "flex:1" }, [
          el("div", { class: "skel", style: "height:14px;width:55%;margin-bottom:8px" }),
          el("div", { class: "skel", style: "height:11px;width:30%" }),
        ]),
        el("div", { class: "skel", style: "width:96px;height:82px;border-radius:14px;flex-shrink:0" }),
      ]));
    }
    return wrap;
  }

  function showPlacing() {
    hidePlacing();
    document.body.appendChild(el("div", { class: "placing-overlay", id: "placingOverlay" }, [
      el("div", { class: "placing-spinner" }),
      el("div", { class: "pl-txt" }, "Placing your order…"),
    ]));
  }
  function hidePlacing() { const o = document.getElementById("placingOverlay"); if (o) o.remove(); }

  const OB_STEPS = [
    { e: "🔍", t: "Scan a shop", s: "Point your camera at a shop's Saardha QR code to add it to your app." },
    { e: "🛒", t: "Build your cart", s: "Open a shop and tap ADD on the items you want." },
    { e: "💳", t: "Place your order", s: "Pay by cash on delivery or online — whatever you prefer." },
    { e: "🛵", t: "Track it live", s: "Watch your Saradhi bring your order to your door in real time." },
  ];
  function showOnboarding() {
    let i = 0;
    const overlay = el("div", { class: "ob-overlay" });
    const card = el("div", { class: "ob-card" });
    overlay.appendChild(card);
    const done = () => { overlay.remove(); try { localStorage.setItem("saardha_onboarded", "1"); } catch (e) {} };
    function paint() {
      const st = OB_STEPS[i];
      card.innerHTML = "";
      card.appendChild(el("div", { class: "ob-emoji" }, st.e));
      card.appendChild(el("div", { class: "ob-title" }, st.t));
      card.appendChild(el("div", { class: "ob-sub" }, st.s));
      const dots = el("div", { class: "ob-dots" });
      OB_STEPS.forEach((_, j) => dots.appendChild(el("div", { class: "ob-dot" + (j === i ? " on" : "") })));
      card.appendChild(dots);
      card.appendChild(el("button", { class: "btn primary", style: "width:100%", onClick: () => {
        if (i < OB_STEPS.length - 1) { i++; paint(); } else { done(); }
      } }, i < OB_STEPS.length - 1 ? "Next" : "Get started"));
      if (i < OB_STEPS.length - 1) {
        card.appendChild(el("div", { class: "muted small", style: "margin-top:12px;cursor:pointer", onClick: done }, "Skip"));
      }
    }
    paint();
    document.body.appendChild(overlay);
  }

  /* ====================== AI HELP ====================== */
  function showAssistant() {
    const overlay = el("div", { class: "ai-overlay" });
    const sheet = el("div", { class: "ai-sheet" });
    overlay.appendChild(sheet);
    const close = () => overlay.remove();
    overlay.onclick = (e) => { if (e.target === overlay) close(); };

    const msgs = el("div", { class: "ai-msgs" });
    const history = [];

    function addMsg(text, who) {
      history.push({ role: who === "bot" ? "assistant" : "user", text: text });
      const m = el("div", { class: "ai-msg " + (who === "bot" ? "bot" : "me") }, text);
      msgs.appendChild(m);
      msgs.scrollTop = msgs.scrollHeight;
    }
    function typing() {
      const t = el("div", { class: "ai-msg bot ai-typing" }, [el("span", {}), el("span", {}), el("span", {})]);
      msgs.appendChild(t); msgs.scrollTop = msgs.scrollHeight; return t;
    }
    async function send(text) {
      if (!text || !text.trim()) return;
      addMsg(text, "me");
      const t = typing();
      try {
        const r = await BW.askAssistant(text, history.slice(0, -1));
        t.remove();
        addMsg((r && r.reply) || "Sorry, please try again.", "bot");
      } catch (e) {
        t.remove();
        addMsg("I'm having trouble right now — please try again in a moment.", "bot");
      }
    }

    const input = el("input", { class: "ai-input-field", placeholder: "Ask about ordering, payment, tracking…" });
    const sendIt = () => { const v = input.value; input.value = ""; send(v); };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") sendIt(); });

    sheet.appendChild(el("div", { class: "ai-header" }, [
      el("div", { class: "row", style: "gap:10px;align-items:center" }, [
        el("img", { src: "../assets/img/icon.png", alt: "", style: "width:26px;height:26px;object-fit:contain" }),
        el("div", { style: "font-weight:800" }, "Saardha Help"),
      ]),
      el("button", { class: "ai-close", "aria-label": "Close", onClick: close }, "×"),
    ]));
    sheet.appendChild(msgs);
    sheet.appendChild(el("div", { class: "ai-chips" }, [
      el("button", { onClick: () => send("How do I place an order?") }, "How to order"),
      el("button", { onClick: () => send("What are the delivery charges?") }, "Charges"),
      el("button", { onClick: () => send("How do I track my order?") }, "Track order"),
      el("button", { onClick: () => { close(); showOnboarding(); } }, "Show the guide"),
    ]));
    sheet.appendChild(el("div", { class: "ai-input" }, [input, el("button", { class: "ai-send", "aria-label": "Send", onClick: sendIt }, "→")]));

    document.body.appendChild(overlay);
    addMsg("Hi! I'm your Saardha helper. Ask me anything, or tap a suggestion below.", "bot");
  }

  /* ====================== PROFILE ====================== */
  function viewProfile() {
    const cust = BW.currentCustomer();
    const user = BW.Auth.getUser();
    const name  = (cust && cust.name)  || (user && user.name)  || "Customer";
    const email = (user && user.email) || (cust && cust.email) || "";
    const initials = name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();

    // working copy of editable fields
    const draft = {
      name: name,
      phone: (cust && cust.phone) || "",
      dob: (cust && cust.dob) || "",
      gender: (cust && cust.gender) || "",
      photoUrl: (cust && cust.photoUrl) || "",
      addresses: (cust && Array.isArray(cust.addresses) ? cust.addresses.slice() : []),
    };

    /* --- Avatar (photo or initials) with camera overlay --- */
    const avatar = el("div", {
      style: "position:relative;width:88px;height:88px;flex-shrink:0",
    });
    const avatarInner = el("div", {
      style: "width:88px;height:88px;border-radius:50%;overflow:hidden;background:var(--brand-lt);color:var(--brand);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:30px;box-shadow:var(--shadow)",
    });
    function paintAvatar() {
      avatarInner.innerHTML = "";
      if (draft.photoUrl) {
        avatarInner.appendChild(el("img", { src: draft.photoUrl, alt: "", style: "width:100%;height:100%;object-fit:cover" }));
      } else {
        avatarInner.textContent = initials || "U";
      }
    }
    paintAvatar();
    const photoInput = el("input", { type: "file", accept: "image/*", style: "display:none" });
    photoInput.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;
      resizeImage(file, 256, (dataUrl) => { draft.photoUrl = dataUrl; paintAvatar(); });
    });
    const camBtn = el("div", {
      onClick: () => photoInput.click(),
      style: "position:absolute;bottom:0;right:0;width:30px;height:30px;border-radius:50%;background:var(--surface);box-shadow:var(--shadow);display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:15px;border:1px solid var(--border)",
    }, "📷");
    avatar.appendChild(avatarInner);
    avatar.appendChild(camBtn);
    avatar.appendChild(photoInput);

    /* --- Field helper --- */
    function field(label, inputEl, hint) {
      return el("div", { class: "field", style: "margin-bottom:10px" }, [
        el("label", {}, label),
        inputEl,
        hint ? el("div", { class: "muted small", style: "margin-top:4px" }, hint) : null,
      ].filter(Boolean));
    }
    const nameIn  = el("input", { type: "text", value: draft.name, placeholder: "Your name" });
    const emailIn = el("input", { type: "email", value: email, disabled: true, style: "opacity:.7" });
    const phoneIn = el("input", { type: "tel", value: draft.phone, placeholder: "+91 …", inputmode: "tel" });
    const dobIn   = el("input", { type: "date", value: draft.dob });
    const genderIn = el("select", {}, ["", "female", "male", "other"].map((g) =>
      el("option", Object.assign({ value: g }, draft.gender === g ? { selected: true } : {}),
        g === "" ? "Prefer not to say" : g.charAt(0).toUpperCase() + g.slice(1))));

    /* --- Saved addresses manager --- */
    const addrList = el("div", {});
    function renderAddrs() {
      addrList.innerHTML = "";
      if (!draft.addresses.length) {
        addrList.appendChild(el("div", { class: "muted small", style: "padding:4px 0 8px" }, "No saved addresses yet."));
      }
      draft.addresses.forEach((a, i) => {
        addrList.appendChild(el("div", { class: "row between", style: "padding:8px 0;border-bottom:0.5px solid var(--border);gap:10px" }, [
          el("div", { style: "min-width:0" }, [
            el("span", { class: "badge", style: "background:var(--brand-lt);color:var(--brand);font-weight:700" }, a.tag || "Address"),
            el("div", { class: "small", style: "margin-top:3px" }, a.line || ""),
          ]),
          el("button", { class: "btn ghost sm", onClick: () => { draft.addresses.splice(i, 1); renderAddrs(); } }, "Remove"),
        ]));
      });
    }
    renderAddrs();
    const tagIn = el("select", {}, ["Home", "Work", "Other"].map((t) => el("option", { value: t }, t)));
    const lineIn = el("input", { type: "text", placeholder: "Flat / street / area, landmark" });
    const addAddrBtn = el("button", { class: "btn ghost sm", onClick: () => {
      const line = lineIn.value.trim();
      if (!line) return;
      draft.addresses.push({ tag: tagIn.value, line: line });
      lineIn.value = "";
      renderAddrs();
    } }, "Add");

    const errEl = el("div", { class: "auth-err", style: "margin:4px 0" });
    const saveBtn = el("button", { class: "btn primary", style: "width:100%;margin-top:6px" }, "Save changes");
    saveBtn.addEventListener("click", async () => {
      errEl.textContent = "";
      const fields = {
        name: nameIn.value.trim(),
        phone: phoneIn.value.trim(),
        dob: dobIn.value,
        gender: genderIn.value,
        photoUrl: draft.photoUrl,
        addresses: draft.addresses,
      };
      if (!fields.name) { errEl.textContent = "Please enter your name."; return; }
      saveBtn.disabled = true; saveBtn.textContent = "Saving…";
      try {
        if (BW.updateProfile) await BW.updateProfile(fields);
        toast("Profile saved");
      } catch (e) {
        errEl.textContent = (e && e.message) || "Could not save. Please try again.";
      } finally {
        saveBtn.disabled = false; saveBtn.textContent = "Save changes";
      }
    });

    shell("profile", [
      el("h1", { class: "page-title" }, "Profile"),
      el("div", { class: "card", style: "display:flex;flex-direction:column;align-items:center;gap:10px;text-align:center" }, [
        avatar,
        el("div", {}, [
          el("div", { style: "font-weight:800;font-size:17px" }, name),
          el("div", { class: "muted small" }, email || "Add your details below"),
        ]),
      ]),
      el("div", { class: "card", style: "margin-top:12px" }, [
        field("Full name", nameIn),
        field("Email", emailIn, "Email is linked to your login."),
        field("Phone number", phoneIn),
        field("Date of birth", dobIn, "🎁 We'll send a birthday treat on your special day."),
        field("Gender", genderIn),
        errEl,
        saveBtn,
      ]),
      el("div", { class: "card", style: "margin-top:12px" }, [
        el("h3", { style: "margin:0 0 6px;font-size:15px" }, "Saved addresses"),
        addrList,
        el("div", { style: "display:flex;gap:8px;margin-top:10px" }, [
          el("div", { style: "flex:0 0 90px" }, [tagIn]),
          el("div", { style: "flex:1" }, [lineIn]),
        ]),
        el("div", { style: "margin-top:8px" }, [addAddrBtn]),
      ]),
      el("div", { class: "card", style: "margin-top:12px" }, [
        el("div", { class: "row between", style: "padding:2px 0" }, [
          el("span", { class: "muted" }, "Stores added"),
          el("span", { style: "font-weight:600" }, String(getUnlockedVendors().length)),
        ]),
      ]),
      el("div", { class: "card", style: "margin-top:12px;cursor:pointer", onClick: () => go("games") }, [
        el("div", { class: "row between", style: "align-items:center" }, [
          el("div", {}, [
            el("div", { style: "font-weight:700" }, "🪙 My Rewards"),
            el("div", { class: "muted small" }, "Your gold coins — redeem for free delivery or 10% off"),
          ]),
          el("div", { style: "font-size:20px;color:var(--muted)" }, "→"),
        ]),
      ]),
      el("div", { class: "card", style: "margin-top:12px;cursor:pointer", onClick: () => go("help") }, [
        el("div", { class: "row between", style: "align-items:center" }, [
          el("div", {}, [
            el("div", { style: "font-weight:700" }, "🎧 Help & Support"),
            el("div", { class: "muted small" }, "Chat with us, call, or cancel an order"),
          ]),
          el("div", { style: "font-size:20px;color:var(--muted)" }, "→"),
        ]),
      ]),
      el("div", { class: "card", style: "margin-top:12px" }, [
        el("div", { style: "font-weight:700;margin-bottom:8px" }, "Policies"),
        policyLinks(),
      ]),
      el("button", { class: "btn danger", style: "width:100%;margin-top:18px", onClick: () => BW.logout() }, "Log out"),
    ]);
  }

  // Shared list of policy links (opens the static policy pages in a new tab).
  function policyLinks() {
    const items = [
      ["Cancellation & Refund", "/policies/cancellation-refund.html"],
      ["Support / Contact",     "/policies/support.html"],
      ["Delivery policy",       "/policies/delivery.html"],
      ["Terms of Service",      "/policies/terms.html"],
      ["Delivery Partner policy", "/policies/delivery-partner.html"],
    ];
    return el("div", {}, items.map(([label, href]) =>
      el("a", { href, target: "_blank", rel: "noopener",
        style: "display:flex;justify-content:space-between;align-items:center;padding:9px 0;border-bottom:1px solid var(--border);text-decoration:none;color:inherit" },
        [el("span", {}, label), el("span", { style: "color:var(--muted)" }, "↗")])
    ));
  }

  /* ====================== HELP & SUPPORT ====================== */
  function viewHelp() {
    const c = BW.supportContact ? BW.supportContact() : {};
    const digits = (s) => String(s || "").replace(/[^0-9+]/g, "");
    const contactBtns = [];
    if (c.phone) contactBtns.push(el("a", { class: "btn primary", style: "flex:1;text-align:center;text-decoration:none", href: "tel:" + digits(c.phone) }, "📞 Call us"));
    if (c.whatsapp) contactBtns.push(el("a", { class: "btn success", style: "flex:1;text-align:center;text-decoration:none", href: "https://wa.me/" + digits(c.whatsapp).replace(/^\+/, ""), target: "_blank", rel: "noopener" }, "💬 WhatsApp"));
    if (c.email) contactBtns.push(el("a", { class: "btn ghost", style: "flex:1;text-align:center;text-decoration:none", href: "mailto:" + c.email }, "✉️ Email"));

    const listWrap = el("div", {}, [el("div", { class: "muted small" }, "Loading your tickets…")]);
    BW.myTickets().then((tickets) => {
      listWrap.innerHTML = "";
      if (!tickets.length) { listWrap.appendChild(el("div", { class: "muted small" }, "No support tickets yet.")); return; }
      tickets.forEach((t) => {
        const last = (t.messages && t.messages[t.messages.length - 1]) || {};
        listWrap.appendChild(el("div", { class: "card", style: "margin-bottom:8px;cursor:pointer", onClick: () => go("ticket", { ticketId: t.id }) }, [
          el("div", { class: "row between" }, [
            el("div", { style: "font-weight:700" }, t.subject),
            el("span", { class: "badge", style: "font-size:11px" }, ticketStatusLabel(t.status)),
          ]),
          el("div", { class: "muted small", style: "margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" }, (last.from === "support" ? "Support: " : "You: ") + (last.text || "")),
        ]));
      });
    }).catch(() => { listWrap.innerHTML = ""; listWrap.appendChild(el("div", { class: "muted small" }, "Couldn't load tickets.")); });

    shell("profile", [
      el("div", { class: "row", style: "align-items:center;gap:10px;margin-bottom:6px" }, [
        el("button", { class: "btn ghost sm", onClick: () => go("profile") }, "←"),
        el("h1", { class: "page-title", style: "margin:0" }, "Help & Support"),
      ]),
      c.hours ? el("div", { class: "muted small", style: "margin-bottom:10px" }, "🕑 " + c.hours) : document.createTextNode(""),
      contactBtns.length ? el("div", { class: "card" }, [
        el("div", { style: "font-weight:700;margin-bottom:8px" }, "Reach us directly"),
        el("div", { style: "display:flex;gap:8px;flex-wrap:wrap" }, contactBtns),
      ]) : document.createTextNode(""),
      el("div", { class: "card", style: "margin-top:12px" }, [
        el("div", { style: "font-weight:700;margin-bottom:8px" }, "Message support"),
        el("button", { class: "btn primary", style: "width:100%", onClick: () => openTicketForm() }, "✏️ Raise a ticket"),
        el("div", { style: "margin-top:12px" }, [el("div", { class: "muted small", style: "margin-bottom:6px" }, "Your tickets"), listWrap]),
      ]),
      el("div", { class: "card", style: "margin-top:12px" }, [
        el("div", { style: "font-weight:700;margin-bottom:8px" }, "Policies"),
        policyLinks(),
      ]),
    ]);
  }

  function ticketStatusLabel(s) {
    return { open: "Open", awaiting_customer: "Reply needed", resolved: "Resolved", closed: "Closed" }[s] || s;
  }

  function openTicketForm(prefillOrderId) {
    const subj = el("input", { type: "text", placeholder: "What's it about? (e.g. Missing item)" });
    const msg  = el("textarea", { placeholder: "Describe the issue…", style: "min-height:90px" });
    // Optional order picker: recent orders to attach.
    const orders = BW.orders ? BW.orders({}).slice(0, 8) : [];
    const orderSel = el("select", {}, [el("option", { value: "" }, "Not about a specific order")]
      .concat(orders.map((o) => el("option", { value: o.id, ...(prefillOrderId === o.id ? { selected: "" } : {}) }, "#" + (o.orderNo || o.id.slice(0, 5)) + " · " + money(o.total)))));
    let close;
    const submit = el("button", { class: "btn primary" }, "Send");
    submit.onclick = async () => {
      if (!subj.value.trim() || !msg.value.trim()) { toast("Add a subject and a message"); return; }
      submit.disabled = true; submit.textContent = "Sending…";
      try {
        const t = await BW.createTicket({ subject: subj.value.trim(), message: msg.value.trim(), orderId: orderSel.value || null });
        close && close();
        go("ticket", { ticketId: t.id });
      } catch (e) { toast(e.message || "Couldn't send"); submit.disabled = false; submit.textContent = "Send"; }
    };
    close = UI.modal({
      title: "Raise a ticket",
      body: el("div", {}, [
        el("div", { class: "field", style: "margin-bottom:8px" }, [el("label", {}, "Subject"), subj]),
        el("div", { class: "field", style: "margin-bottom:8px" }, [el("label", {}, "Related order (optional)"), orderSel]),
        el("div", { class: "field" }, [el("label", {}, "Message"), msg]),
      ]),
      footer: [el("button", { class: "btn ghost", onClick: () => close() }, "Cancel"), submit],
    });
  }

  function viewTicket() {
    const id = state.ticketId;
    const wrap = el("div", {}, [el("div", { class: "muted" }, "Loading…")]);
    shell("profile", [
      el("div", { class: "row", style: "align-items:center;gap:10px;margin-bottom:10px" }, [
        el("button", { class: "btn ghost sm", onClick: () => go("help") }, "←"),
        el("h1", { class: "page-title", style: "margin:0" }, "Ticket"),
      ]),
      wrap,
    ]);
    BW.getTicket(id).then((t) => {
      wrap.innerHTML = "";
      wrap.appendChild(el("div", { class: "card", style: "margin-bottom:10px" }, [
        el("div", { class: "row between" }, [el("div", { style: "font-weight:800" }, t.subject), el("span", { class: "badge" }, ticketStatusLabel(t.status))]),
        t.orderId ? el("div", { class: "muted small", style: "margin-top:4px" }, "Linked to an order") : document.createTextNode(""),
      ]));
      const thread = el("div", { class: "card", style: "margin-bottom:10px;display:flex;flex-direction:column;gap:8px;max-height:50vh;overflow:auto" });
      (t.messages || []).forEach((m) => {
        const mine = m.from === "customer";
        thread.appendChild(el("div", { style: "align-self:" + (mine ? "flex-end" : "flex-start") + ";max-width:80%;background:" + (mine ? "var(--brand-lt)" : "var(--surface-2,#f2f2f2)") + ";padding:8px 12px;border-radius:12px" }, [
          el("div", { class: "small", style: "font-weight:700;margin-bottom:2px" }, mine ? "You" : (m.byName || "Support")),
          el("div", { style: "white-space:pre-wrap" }, m.text),
          el("div", { class: "muted", style: "font-size:10px;margin-top:3px" }, timeAgo(m.at)),
        ]));
      });
      wrap.appendChild(thread);
      if (t.status === "closed") {
        wrap.appendChild(el("div", { class: "muted small" }, "This ticket is closed. Raise a new one if you still need help."));
      } else {
        const reply = el("textarea", { placeholder: "Type a reply…", style: "min-height:60px" });
        const send = el("button", { class: "btn primary", style: "margin-top:8px;width:100%" }, "Send reply");
        send.onclick = async () => {
          if (!reply.value.trim()) return;
          send.disabled = true; send.textContent = "Sending…";
          try { await BW.replyTicket(id, reply.value.trim()); viewTicket(); }
          catch (e) { toast(e.message || "Couldn't send"); send.disabled = false; send.textContent = "Send reply"; }
        };
        wrap.appendChild(el("div", { class: "card" }, [reply, send]));
      }
    }).catch(() => { wrap.innerHTML = ""; wrap.appendChild(el("div", { class: "muted" }, "Couldn't load this ticket.")); });
  }

  // Downscale an image File to a square-ish JPEG data URL for lightweight avatar storage.
  function resizeImage(file, maxSize, cb) {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      try { cb(canvas.toDataURL("image/jpeg", 0.85)); }
      catch (e) { cb(null); }
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => toast("Could not read that image");
    img.src = URL.createObjectURL(file);
  }

  /* ====================== ROUTER ====================== */
  /* ====================== SERVICES (Pickup & Drop) ====================== */
  const SERVICE_CATEGORIES = [
    { key: "laundry",   label: "Laundry & Ironing", icon: "🧺" },
    { key: "tailoring", label: "Tailoring",         icon: "🧵" },
    { key: "printing",  label: "Print & Xerox",     icon: "🖨️" },
    { key: "courier",   label: "Courier",           icon: "📦" },
    { key: "repair",    label: "Repairs",           icon: "🔧" },
    { key: "salon",     label: "Salon & Care",      icon: "💇" },
    { key: "scrap",     label: "Scrap (Raddi)",     icon: "♻️" },
    { key: "other",     label: "More",              icon: "🛠️" },
  ];
  function catLabel(k) { const c = SERVICE_CATEGORIES.find((x) => x.key === k); return c ? c.label : (k || "Service"); }

  // v1 ships products-only. Local Services is hidden behind a server feature flag
  // (/api/config → features.services) so it can be switched on for v2 without a code change.
  function servicesOn() {
    const cfg = (BW.config && BW.config()) || {};
    return !!(cfg.features && cfg.features.services);
  }

  // Entry tile shown on the My Stores home.
  function servicesEntry() {
    if (!servicesOn()) return document.createTextNode("");
    return el("div", {
      class: "card", style: "margin-bottom:16px;cursor:pointer;background:linear-gradient(90deg,#0C447C,#3C3489);color:#fff;border:none",
      onClick: () => go("services"),
    }, [
      el("div", { style: "display:flex;align-items:center;gap:12px" }, [
        el("div", { style: "font-size:26px" }, "🛠️"),
        el("div", { style: "flex:1" }, [
          el("div", { style: "font-weight:800;font-size:15px" }, "Local Services — Pickup & Drop"),
          el("div", { style: "font-size:12px;opacity:.85" }, "Laundry, tailoring, xerox, courier & more. We collect, they do it, we return it."),
        ]),
        el("div", { style: "font-size:20px" }, "→"),
      ]),
    ]);
  }

  function serviceCart() { if (!state.serviceCart) state.serviceCart = {}; return state.serviceCart; }
  function serviceCartCount() { return Object.values(serviceCart()).reduce((a, b) => a + b, 0); }

  function viewServices() {
    if (!servicesOn()) return go("stores");   // module disabled in v1 — bounce home
    const cat = state.serviceCat || null;
    let vendors = BW.serviceVendors ? BW.serviceVendors({ pattern: "pickup_drop" }) : [];
    if (cat) vendors = vendors.filter((v) => v.categoryKey === cat);

    const chips = el("div", { style: "display:flex;gap:8px;overflow-x:auto;padding:4px 0 10px;-webkit-overflow-scrolling:touch" },
      [el("button", { class: "btn " + (!cat ? "primary" : "ghost") + " sm", onClick: () => go("services", { serviceCat: null }) }, "All")]
        .concat(SERVICE_CATEGORIES.map((c) => el("button", {
          class: "btn " + (cat === c.key ? "primary" : "ghost") + " sm", style: "white-space:nowrap",
          onClick: () => go("services", { serviceCat: c.key }),
        }, c.icon + " " + c.label)))
    );

    const list = vendors.length
      ? el("div", { class: "grid cols-2" }, vendors.map(serviceVendorCard))
      : el("div", { class: "empty", style: "margin-top:24px" }, [el("div", { class: "e" }, "🛠️"),
          el("p", { class: "muted small", style: "max-width:260px;margin:8px auto;line-height:1.6" },
            "No service businesses here yet. We're onboarding local shops — check back soon.")]);

    shell("stores", [
      el("div", { style: "display:flex;align-items:center;gap:10px;margin-bottom:4px" }, [
        el("button", { class: "btn ghost sm", onClick: () => go("stores") }, "← Back"),
        el("h1", { class: "page-title", style: "margin:0" }, "Local Services"),
      ]),
      el("p", { class: "page-sub" }, "Pickup & Drop — a Saradhi collects your item, the shop does the work, we return it to your door."),
      chips,
      list,
    ]);
  }

  function serviceVendorCard(v) {
    return el("div", { class: "vcard", onClick: () => openServiceVendor(v.id) }, [
      el("div", { class: "vcard-img" }, v.img || (SERVICE_CATEGORIES.find((c) => c.key === v.categoryKey) || {}).icon || "🛠️"),
      el("div", { class: "vcard-body" }, [
        el("div", { class: "vcard-name" }, v.name),
        el("div", { class: "vcard-meta" }, catLabel(v.categoryKey) + (v.area ? " · " + v.area : "")),
        el("div", { class: "vcard-tags" }, [el("span", { class: "vcard-rating" }, "★ " + (v.rating || 5))]),
      ]),
    ]);
  }

  async function openServiceVendor(id) {
    // Switching business clears the in-progress service cart.
    if (state.serviceVendorId !== id) state.serviceCart = {};
    go("serviceVendor", { serviceVendorId: id, serviceLoading: true });
    try { await BW.loadServiceVendor(id); } catch (e) {}
    if (state.route === "serviceVendor" && state.serviceVendorId === id) { state.serviceLoading = false; viewServiceVendor(); }
  }

  function serviceItemPriceText(s) {
    if (s.priceType === "quote") return "Price on inspection";
    if (s.priceType === "from") return "From " + money(s.price) + (s.unitLabel ? " · " + s.unitLabel : "");
    if (s.priceType === "per_unit") return money(s.price) + " " + (s.unitLabel || "per unit");
    return money(s.price);
  }

  function viewServiceVendor() {
    if (!servicesOn()) return go("stores");
    const v = BW.serviceVendor(state.serviceVendorId);
    if (!v) { shell("stores", [el("button", { class: "btn ghost sm", onClick: () => go("services") }, "← Services"), el("div", { class: "muted", style: "margin-top:20px" }, "Loading business…")]); return; }
    const items = BW.serviceItems(v.id) || [];

    const rows = items.length ? items.map((s) => {
      const qty = serviceCart()[s.id] || 0;
      const ctrl = qty
        ? el("div", { class: "add-stepper" }, [
            el("button", { onClick: () => { serviceCart()[s.id] = Math.max(0, qty - 1); if (!serviceCart()[s.id]) delete serviceCart()[s.id]; viewServiceVendor(); } }, "−"),
            el("span", {}, String(qty)),
            el("button", { onClick: () => { serviceCart()[s.id] = qty + 1; viewServiceVendor(); } }, "+"),
          ])
        : el("button", { class: "add-btn", onClick: () => { serviceCart()[s.id] = 1; viewServiceVendor(); } }, "ADD");
      return el("div", { class: "card", style: "display:flex;gap:12px;align-items:center;margin-bottom:10px" }, [
        el("div", { style: "flex:1" }, [
          el("div", { style: "font-weight:700" }, s.name),
          s.description ? el("div", { class: "muted small" }, s.description) : document.createTextNode(""),
          el("div", { class: "small", style: "color:var(--brand);margin-top:2px" }, serviceItemPriceText(s)),
        ]),
        ctrl,
      ]);
    }) : [el("div", { class: "muted", style: "padding:16px" }, "This business hasn't listed services yet.")];

    const body = [
      el("div", { style: "display:flex;align-items:center;gap:10px;margin-bottom:8px" }, [
        el("button", { class: "btn ghost sm", onClick: () => go("services") }, "← Back"),
        el("h1", { class: "page-title", style: "margin:0" }, v.name),
      ]),
      el("p", { class: "page-sub" }, catLabel(v.categoryKey) + (v.area ? " · " + v.area : "") + " · ★ " + (v.rating || 5)),
      el("div", { class: "card", style: "background:var(--brand-lt);border:1px solid var(--border);margin-bottom:12px" },
        el("div", { class: "small" }, "🛵 A Saardha Saradhi collects your item and returns it after the work is done. Final price may be confirmed after inspection (e.g. by weight/count).")),
      el("div", {}, rows),
    ];

    // Sticky schedule button when the cart has items
    if (serviceCartCount() > 0) {
      body.push(el("button", { class: "btn primary", style: "width:100%;position:sticky;bottom:12px;margin-top:8px", onClick: () => openBookingComposer(v) },
        "Schedule pickup (" + serviceCartCount() + ") →"));
    }
    shell("stores", body);
  }

  function openBookingComposer(v) {
    const cust0 = BW.currentCustomer();
    if (state.deliverFlat == null) state.deliverFlat = "";
    if (state.deliverArea == null) state.deliverArea = (cust0 && cust0.address) || "";
    if (state.deliverLandmark == null) state.deliverLandmark = "";
    if (state.deliverPhone == null) state.deliverPhone = (cust0 && cust0.phone) || "";
    if (state.deliverName == null) state.deliverName = (cust0 && cust0.name) || "";
    if (!state.deliverLoc && cust0 && cust0.lat) state.deliverLoc = { lat: cust0.lat, lng: cust0.lng };
    if (!state.bookingSlot) state.bookingSlot = "ASAP";
    if (!state.bookingPay) state.bookingPay = "COD";

    const field = (label, valKey, ph, inputmode) => {
      const inp = el("input", { type: "text", value: state[valKey] || "", placeholder: ph, inputmode: inputmode || "text" });
      inp.addEventListener("input", (e) => { state[valKey] = e.target.value; });
      return el("div", { class: "field", style: "margin-bottom:8px" }, [el("label", {}, label), inp]);
    };
    const locStatus = el("span", { class: "muted small" }, state.deliverLoc ? "📍 Pin set" : "Optional — typed address is enough");
    const useLocBtn = el("button", { class: "btn ghost sm", type: "button" }, "📍 Use my current location");
    useLocBtn.addEventListener("click", () => {
      if (!navigator.geolocation) { toast("Location not available on this device"); return; }
      if (!window.isSecureContext) { toast("GPS needs a secure (https) link. Just type your address below — that works fine."); return; }
      useLocBtn.disabled = true; useLocBtn.textContent = "Locating…";
      navigator.geolocation.getCurrentPosition(
        (p) => { state.deliverLoc = { lat: p.coords.latitude, lng: p.coords.longitude }; locStatus.textContent = "📍 Pin set"; useLocBtn.disabled = false; useLocBtn.textContent = "📍 Use my current location"; toast("Location pinned"); },
        (err) => { toast(err && err.code === 1 ? "Location permission blocked — type your address below." : "Couldn't get GPS — type your address below."); useLocBtn.disabled = false; useLocBtn.textContent = "📍 Use my current location"; },
        { enableHighAccuracy: true, timeout: 8000 }
      );
    });
    const picker = UI.mapPicker ? UI.mapPicker({ height: 170, lat: state.deliverLoc && state.deliverLoc.lat, lng: state.deliverLoc && state.deliverLoc.lng,
      onPick: (la, ln) => { state.deliverLoc = { lat: la, lng: ln }; locStatus.textContent = "📍 Pin set"; } }) : null;

    const slots = ["ASAP", "Today evening", "Tomorrow morning", "Tomorrow evening"];
    const slotSel = el("select", {}, slots.map((s) => el("option", { value: s, selected: state.bookingSlot === s ? "selected" : null }, s)));
    slotSel.addEventListener("change", (e) => { state.bookingSlot = e.target.value; });

    const payWrap = el("div", { style: "display:flex;gap:8px" }, ["COD", "ONLINE"].map((m) =>
      el("button", { class: "btn " + (state.bookingPay === m ? "primary" : "ghost") + " sm", style: "flex:1", type: "button",
        onClick: () => { state.bookingPay = m; toast(m === "COD" ? "Pay cash on return" : "Pay online"); document.querySelectorAll(".svc-pay-btn").forEach(() => {}); reopen(); } },
        m === "COD" ? "💵 Cash on return" : "💳 Pay online")));

    const noteInp = el("textarea", { placeholder: "Any instructions (e.g. 3 shirts + 2 trousers, starch light)", style: "width:100%;min-height:56px", value: state.bookingNote || "" });
    noteInp.addEventListener("input", (e) => { state.bookingNote = e.target.value; });

    const est = serviceEstTotal(v);
    let close;
    function reopen() { if (close) close(); openBookingComposer(v); }

    const submit = el("button", { class: "btn primary", style: "width:100%" }, "Confirm booking · " + (est > 0 ? money(est) : "price on inspection"));
    submit.addEventListener("click", () => submitBooking(v, () => { if (close) close(); }));

    close = UI.modal({
      title: "Schedule pickup",
      body: el("div", {}, [
        el("div", { class: "card", style: "margin-bottom:10px" }, [
          el("div", { style: "font-weight:800;margin-bottom:8px" }, "Pickup & return address"),
          el("div", { style: "display:flex;gap:8px;align-items:center;margin-bottom:8px" }, [useLocBtn, locStatus]),
          picker ? el("div", { style: "margin-bottom:10px" }, [el("div", { class: "muted small", style: "margin-bottom:4px" }, "Drag the pin to your door"), picker]) : document.createTextNode(""),
          el("div", { style: "margin-bottom:10px" }, [
            el("div", { class: "muted small", style: "margin-bottom:4px" }, "…or paste a Google Maps link"),
            UI.mapsLinkField({ value: state.deliverMapsUrl || "", onResolved: (la, ln, url) => { state.deliverMapsUrl = url; if (la != null) { state.deliverLoc = { lat: la, lng: ln }; locStatus.textContent = "📍 Pin set"; } } }),
          ]),
          field("Flat / House no. & building", "deliverFlat", "e.g. Flat 3B, Sunrise Apartments"),
          field("Area / street / colony", "deliverArea", "e.g. MG Road, Dwaraka Nagar"),
          field("Landmark", "deliverLandmark", "e.g. near Reliance Fresh"),
          el("div", { style: "display:flex;gap:8px" }, [
            el("div", { style: "flex:1" }, [field("Name", "deliverName", "Name")]),
            el("div", { style: "flex:1" }, [field("Phone", "deliverPhone", "10-digit mobile", "tel")]),
          ]),
        ]),
        el("div", { class: "field", style: "margin-bottom:10px" }, [el("label", {}, "Pickup time"), slotSel]),
        el("div", { style: "margin-bottom:10px" }, [el("label", { class: "small muted", style: "display:block;margin-bottom:6px" }, "Payment"), payWrap]),
        el("div", { class: "field", style: "margin-bottom:6px" }, [el("label", {}, "Notes"), noteInp]),
        est > 0 ? el("div", { class: "muted small", style: "margin-bottom:6px" }, "Estimated " + money(est) + " (incl. two-way pickup fee). Final amount may change after inspection.")
                : el("div", { class: "muted small", style: "margin-bottom:6px" }, "Price will be confirmed by the shop after inspection."),
      ]),
      footer: [submit],
    });
  }

  function serviceEstTotal(v) {
    const items = BW.serviceItems(v.id) || [];
    let est = 0;
    Object.entries(serviceCart()).forEach(([sid, qty]) => {
      const s = items.find((x) => x.id === sid);
      if (s && (s.priceType === "fixed" || s.priceType === "from" || s.priceType === "per_unit")) est += (Number(s.price) || 0) * qty;
    });
    if (est > 0) est += Number(v.deliveryFee) || 30;
    return est;
  }

  async function submitBooking(v, onDone) {
    if (!serviceCartCount()) { toast("Add at least one service."); return; }
    if (!ensureDeliveryAddress()) return;
    const items = Object.entries(serviceCart()).map(([serviceId, qty]) => ({ serviceId, qty }));
    const payload = {
      serviceVendorId: v.id, items,
      address: composedDeliverTo(),
      addressName: state.deliverName, addressPhone: state.deliverPhone,
      lat: state.deliverLoc && state.deliverLoc.lat, lng: state.deliverLoc && state.deliverLoc.lng,
      mapsUrl: state.deliverMapsUrl || null,
      slot: { window: state.bookingSlot || "ASAP" },
      note: state.bookingNote || "",
      paymentMethod: state.bookingPay || "COD",
    };
    try {
      const b = await BW.createBooking(payload);
      state.serviceCart = {}; state.bookingNote = "";
      if (onDone) onDone();
      toast("Booking placed ✓");
      go("bookingTrack", { bookingId: b.id });
    } catch (err) { toast(err.message || "Could not place booking"); }
  }

  const BOOKING_STEPS = ["REQUESTED", "ACCEPTED", "RIDER_ASSIGNED", "PICKED_FROM_CUSTOMER", "AT_SHOP", "READY", "OUT_FOR_RETURN", "RETURNED"];

  function viewBookingTrack() {
    if (!servicesOn()) return go("stores");
    const b = BW.booking(state.bookingId);
    if (!b) { shell("stores", [el("button", { class: "btn ghost sm", onClick: () => go("services") }, "← Services"), el("div", { class: "muted", style: "margin-top:20px" }, "Loading booking…")]); return; }
    const v = BW.serviceVendor(b.serviceVendorId);
    const label = (s) => (BW.BOOKING_LABEL && BW.BOOKING_LABEL[s]) || s;
    const cancelled = b.status === "CANCELLED";
    const done = b.status === "RETURNED";
    const curIdx = BOOKING_STEPS.indexOf(b.status);

    // Vertical step tracker
    const steps = el("div", { class: "card" }, BOOKING_STEPS.map((s, i) => {
      const reached = curIdx >= i;
      return el("div", { style: "display:flex;align-items:center;gap:10px;padding:7px 0" }, [
        el("div", { style: "width:18px;height:18px;border-radius:50%;flex:none;background:" + (reached ? "var(--brand)" : "var(--surface-2)") + ";border:2px solid " + (reached ? "var(--brand)" : "var(--border)") }),
        el("div", { style: "font-weight:" + (curIdx === i ? "800" : "500") + ";color:" + (reached ? "var(--text)" : "var(--muted)") }, label(s)),
      ]);
    }));

    // Return OTP (fetch async, customer-only)
    const otpBox = el("div", { class: "card", style: "text-align:center;margin-bottom:12px" }, el("div", { class: "muted small" }, "Loading return code…"));
    if (!cancelled && !done) {
      BW.bookingOtp(b.id).then((r) => {
        if (!r || !r.otp) { otpBox.innerHTML = ""; otpBox.appendChild(el("div", { class: "muted small" }, "Return code appears once assigned.")); return; }
        otpBox.innerHTML = "";
        otpBox.appendChild(el("div", { class: "muted small", style: "margin-bottom:4px" }, "Show this code to the Saradhi on return"));
        otpBox.appendChild(el("div", { style: "font-size:30px;font-weight:800;letter-spacing:6px;color:var(--brand)" }, r.otp));
      }).catch(() => { otpBox.remove(); });
    } else { otpBox.remove(); }

    // Rider contact + map (if assigned)
    const contact = [];
    if (b.riderId) {
      const r = BW.rider(b.riderId);
      if (r) {
        contact.push(el("div", { class: "card", style: "margin-bottom:12px" }, [
          el("div", { style: "font-weight:700;margin-bottom:6px" }, "Your Saradhi: " + r.name),
          el("div", { style: "display:flex;gap:8px" }, [
            r.phone ? el("a", { class: "btn ghost sm", style: "flex:1;text-align:center", href: "tel:" + r.phone }, "📞 Call") : document.createTextNode(""),
            r.phone ? el("a", { class: "btn ghost sm", style: "flex:1;text-align:center", href: waLink(r.phone), target: "_blank", rel: "noopener" }, "💬 WhatsApp") : document.createTextNode(""),
          ].filter((x) => x.nodeType !== 3 || x.textContent)),
          (r.lat && r.lng) ? el("a", { class: "btn ghost sm", style: "width:100%;text-align:center;margin-top:8px", href: "https://www.google.com/maps/search/?api=1&query=" + r.lat + "," + r.lng, target: "_blank", rel: "noopener" }, "🗺️ See Saradhi on Google Maps") : document.createTextNode(""),
        ]));
      }
    }

    const priceRow = el("div", { class: "card", style: "margin-bottom:12px" }, [
      el("div", { class: "row between" }, [el("span", { class: "muted small" }, b.finalTotal != null ? "Final amount" : "Estimated"), el("strong", {}, (b.finalTotal != null ? money(b.finalTotal) : (b.estTotal ? money(b.estTotal + (b.deliveryFee || 0)) : "On inspection")))]),
      el("div", { class: "row between", style: "margin-top:4px" }, [el("span", { class: "muted small" }, "Payment"), el("span", { class: "small" }, (b.paymentMethod === "ONLINE" ? "Online" : "Cash on return") + " · " + (b.paymentStatus === "COLLECTED" ? "paid" : "due"))]),
    ]);

    const items = el("div", { class: "card", style: "margin-bottom:12px" }, (b.items || []).map((it) =>
      el("div", { class: "row between small", style: "padding:4px 0" }, [el("span", {}, it.qty + "× " + it.name), el("span", { class: "muted" }, it.priceType === "quote" ? "on inspection" : money((it.price || 0) * it.qty))])));

    // Rate when returned
    const rateCard = (done && !b.rating) ? bookingRateCard(b) : (b.rating ? el("div", { class: "card", style: "margin-bottom:12px" }, el("div", { class: "small" }, "You rated this ★ " + b.rating.store)) : document.createTextNode(""));

    shell("stores", [
      el("div", { style: "display:flex;align-items:center;gap:10px;margin-bottom:4px" }, [
        el("button", { class: "btn ghost sm", onClick: () => go("services") }, "← Services"),
        el("h1", { class: "page-title", style: "margin:0" }, "#" + b.id.slice(-6).toUpperCase()),
      ]),
      el("p", { class: "page-sub" }, (v ? v.name : "Service") + " · " + label(b.status) + (b.slot && b.slot.window ? " · " + b.slot.window : "")),
      cancelled ? el("div", { class: "card", style: "border:1px solid var(--red);color:var(--red)" }, "This booking was cancelled.") : otpBox,
      contact.length ? contact[0] : document.createTextNode(""),
      steps,
      priceRow,
      items,
      rateCard,
    ]);
  }

  function bookingRateCard(b) {
    let stars = 0;
    const starRow = el("div", { style: "font-size:26px;letter-spacing:4px;cursor:pointer;text-align:center" });
    function paint() { starRow.innerHTML = ""; for (let i = 1; i <= 5; i++) { const on = i <= stars; const s = el("span", { style: "color:" + (on ? "#f5a623" : "var(--border)") }, "★"); s.addEventListener("click", () => { stars = i; paint(); }); starRow.appendChild(s); } }
    paint();
    const cmt = el("textarea", { placeholder: "How was the service?", style: "width:100%;min-height:48px;margin-top:8px" });
    const btn = el("button", { class: "btn primary", style: "width:100%;margin-top:8px" }, "Submit rating");
    btn.addEventListener("click", async () => {
      if (!stars) { toast("Tap the stars to rate."); return; }
      try { await BW.rateBooking(b.id, { storeRating: stars, comment: cmt.value }); toast("Thanks for the feedback!"); viewBookingTrack(); }
      catch (e) { toast(e.message || "Could not submit"); }
    });
    return el("div", { class: "card", style: "margin-bottom:12px" }, [el("div", { style: "font-weight:700;margin-bottom:6px;text-align:center" }, "Rate this service"), starRow, cmt, btn]);
  }

  /* ====================== GAMES & REWARDS ====================== */
  // Gold coins: win a mini-game (+10) using a play credit earned by ordering.
  // 100 coins → free delivery or 10% off, applied automatically on the next order.
  let _rewards = { goldCoins: 0, gamePlays: 0, activeReward: null, redeemCost: 100, coinsPerWin: 10 };
  function refreshRewards() {
    return BW.rewardsMe().then((r) => { _rewards = { ..._rewards, ...r }; return _rewards; }).catch(() => _rewards);
  }

  // Inject the game-invite animations once (keyframes can't live in inline styles).
  let _gameStyles = false;
  function ensureGameStyles() {
    if (_gameStyles) return; _gameStyles = true;
    const st = document.createElement("style");
    st.textContent =
      "@keyframes bwInvitePulse{0%,100%{transform:scale(1)}50%{transform:scale(1.03)}}" +
      "@keyframes bwEmojiBounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-7px)}}" +
      "@keyframes bwBtnGlow{0%,100%{box-shadow:0 0 0 0 rgba(255,255,255,.6)}50%{box-shadow:0 0 0 8px rgba(255,255,255,0)}}" +
      ".bw-play-invite{animation:bwInvitePulse 1.8s ease-in-out infinite}" +
      ".bw-play-emoji{animation:bwEmojiBounce 1.1s ease-in-out infinite;display:inline-block}" +
      ".bw-play-btn{animation:bwBtnGlow 1.8s ease-in-out infinite}";
    document.head.appendChild(st);
  }

  const GAMES = [
    { key: "reaction", name: "Quick Tap",      build: buildReactionGame },
    { key: "memory",   name: "Memory Match",   build: buildMemoryGame },
    { key: "catch",    name: "Tap Rush",       build: buildTapRushGame },
    { key: "trivia",   name: "Tricky Trivia",  build: buildTriviaGame },
    { key: "puzzle",   name: "Brain Teaser",   build: buildPuzzleGame },
  ];
  // Pick a game at random, never the same one twice in a row — so it feels fresh each time.
  function nextGame() {
    let last = -1; try { last = parseInt(localStorage.getItem("bw_game_last") || "-1", 10); } catch (e) {}
    let idx = 0;
    if (GAMES.length > 1) { do { idx = Math.floor(Math.random() * GAMES.length); } while (idx === last); }
    try { localStorage.setItem("bw_game_last", String(idx)); } catch (e) {}
    return GAMES[idx];
  }

  // Open a game in a modal. Coins are awarded only for a win tied to an ACTIVE order
  // (orderId supplied) — the server enforces one payout per in-progress order.
  function openGameModal(orderId, forced) {
    const game = forced || nextGame();
    const arena = el("div", { style: "min-height:220px" });
    const msg = el("div", { style: "text-align:center;font-weight:700;margin-top:10px;min-height:22px" }, "");
    let close;
    async function handleWin() {
      if (orderId) {
        try {
          const r = await BW.gameWin(orderId);
          _rewards.goldCoins = r.goldCoins;
          msg.innerHTML = "";
          if (r.awarded) msg.appendChild(el("span", { style: "color:var(--brand)" }, "🏆 You won +" + r.awarded + " coins! Total: " + r.goldCoins));
          else if (r.reason === "already_rewarded") msg.appendChild(el("span", {}, "You won! 🎉 (coins for this order already earned)"));
          else msg.appendChild(el("span", {}, "You won! 🎉"));
        } catch (e) { msg.textContent = "You won! 🎉"; }
      } else {
        msg.textContent = "You won! 🎉";
      }
      againBtn.style.display = "inline-block";
    }
    function startGame(g) {
      arena.innerHTML = ""; msg.textContent = ""; againBtn.style.display = "none";
      g.build(arena, handleWin);
    }
    const againBtn = el("button", { class: "btn ghost sm", style: "display:none", onClick: () => startGame(nextGame()) }, "Play another");
    close = UI.modal({
      title: "🎮 " + game.name,
      body: el("div", {}, [arena, msg]),
      footer: [againBtn, el("button", { class: "btn primary", onClick: () => close() }, "Done")],
    });
    startGame(game);
  }

  // ---- Game 1: Quick Tap (reaction) ----
  function buildReactionGame(root, onWin) {
    const box = el("div", { style: "height:180px;border-radius:12px;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:18px;cursor:pointer;background:#c0392b;user-select:none" }, "Wait for green…");
    let ready = false, t0 = 0, done = false;
    const timer = setTimeout(() => { ready = true; t0 = Date.now(); box.style.background = "#1a9d54"; box.textContent = "TAP NOW!"; }, 900 + Math.random() * 2200);
    box.onclick = () => {
      if (done) return;
      if (!ready) { clearTimeout(timer); box.style.background = "#8e44ad"; box.textContent = "Too soon! Tap Play another"; done = true; return; }
      const ms = Date.now() - t0; done = true;
      if (ms <= 600) { box.style.background = "#1a9d54"; box.textContent = ms + " ms — nice!"; onWin(); }
      else { box.style.background = "#c0392b"; box.textContent = ms + " ms — too slow, try again"; }
    };
    root.appendChild(el("div", { class: "muted small", style: "text-align:center;margin-bottom:8px" }, "Tap the box the instant it turns green (under 600ms wins)."));
    root.appendChild(box);
  }

  // ---- Game 2: Memory Match ----
  function buildMemoryGame(root, onWin) {
    const emojis = ["🍎", "🥑", "🍕", "🍰"];
    const deck = emojis.concat(emojis).sort(() => Math.random() - 0.5);
    let first = null, lock = false, matched = 0;
    const grid = el("div", { style: "display:grid;grid-template-columns:repeat(4,1fr);gap:8px" });
    deck.forEach((em) => {
      const card = el("div", { style: "height:70px;border-radius:10px;background:var(--brand);display:flex;align-items:center;justify-content:center;font-size:26px;cursor:pointer" }, "");
      card._em = em; card._open = false;
      card.onclick = () => {
        if (lock || card._open) return;
        card.textContent = em; card.style.background = "#eee"; card._open = true;
        if (!first) { first = card; return; }
        if (first._em === em) { matched++; first = null; if (matched === emojis.length) onWin(); }
        else { lock = true; const a = first; setTimeout(() => { a.textContent = ""; a.style.background = "var(--brand)"; a._open = false; card.textContent = ""; card.style.background = "var(--brand)"; card._open = false; first = null; lock = false; }, 700); }
      };
      grid.appendChild(card);
    });
    root.appendChild(el("div", { class: "muted small", style: "text-align:center;margin-bottom:8px" }, "Flip two cards at a time — match all 4 pairs to win."));
    root.appendChild(grid);
  }

  // ---- Game 3: Tap Rush ----
  function buildTapRushGame(root, onWin) {
    const GOAL = 12, SECS = 12;
    let score = 0, left = SECS, ended = false;
    const hud = el("div", { style: "display:flex;justify-content:space-between;font-weight:700;margin-bottom:6px" }, [el("span", {}, "Score: 0"), el("span", {}, SECS + "s")]);
    const field = el("div", { style: "position:relative;height:200px;border-radius:12px;background:#faf3ef;overflow:hidden" });
    const target = el("div", { style: "position:absolute;width:52px;height:52px;border-radius:50%;background:var(--brand);display:flex;align-items:center;justify-content:center;font-size:26px;cursor:pointer", }, "🎯");
    function place() { target.style.left = Math.random() * 78 + "%"; target.style.top = Math.random() * 70 + "%"; }
    target.onclick = () => { if (ended) return; score++; hud.firstChild.textContent = "Score: " + score; place(); if (score >= GOAL) { ended = true; clearInterval(iv); field.innerHTML = ""; field.appendChild(el("div", { style: "text-align:center;padding-top:80px;font-weight:800" }, "You hit " + score + "! 🎉")); onWin(); } };
    field.appendChild(target); place();
    const iv = setInterval(() => { if (ended) return; left--; hud.lastChild.textContent = left + "s"; if (left <= 0) { ended = true; clearInterval(iv); field.innerHTML = ""; field.appendChild(el("div", { style: "text-align:center;padding-top:80px;font-weight:800;color:#c0392b" }, "Time! You got " + score + ". Try again.")); } }, 1000);
    root.appendChild(el("div", { class: "muted small", style: "text-align:center;margin-bottom:8px" }, "Tap the target " + GOAL + " times before the clock runs out."));
    root.appendChild(hud); root.appendChild(field);
  }

  // ---- Game 4: Tricky Trivia ----
  const TRIVIA = [
    { q: "A bat and a ball cost ₹110 in total. The bat costs ₹100 more than the ball. How much is the ball?", opts: ["₹10", "₹5", "₹0"], a: 1 },
    { q: "Which weighs more: 1 kg of iron or 1 kg of cotton?", opts: ["Iron", "Cotton", "They weigh the same"], a: 2 },
    { q: "If you overtake the person in 2nd place in a race, what position are you in?", opts: ["1st", "2nd", "3rd"], a: 1 },
    { q: "How many months have 28 days?", opts: ["1", "2", "All 12"], a: 2 },
    { q: "What is 7 × 8?", opts: ["54", "56", "58"], a: 1 },
    { q: "A farmer has 17 sheep; all but 9 run away. How many are left?", opts: ["8", "9", "17"], a: 1 },
    { q: "Which is heavier: a kilo of feathers or half a kilo of gold?", opts: ["Feathers", "Gold", "Equal"], a: 0 },
    { q: "Next in the series: 2, 4, 8, 16, …?", opts: ["24", "32", "30"], a: 1 },
    { q: "Divide 30 by ½ and add 10. What do you get?", opts: ["25", "70", "40"], a: 1 },
    { q: "A clock shows 3:15. What number is the hour hand closest to?", opts: ["3", "Between 3 and 4", "4"], a: 1 },
  ];
  function buildTriviaGame(root, onWin) {
    const item = TRIVIA[Math.floor(Math.random() * TRIVIA.length)];
    const msg = el("div", { style: "min-height:20px;text-align:center;font-weight:700;margin-top:8px" });
    let done = false;
    root.appendChild(el("div", { style: "font-weight:700;text-align:center;margin-bottom:12px;line-height:1.4" }, item.q));
    const opts = el("div", { style: "display:flex;flex-direction:column;gap:8px" });
    item.opts.forEach((o, i) => {
      const b = el("button", { class: "btn ghost", style: "width:100%" }, o);
      b.onclick = () => {
        if (done) return; done = true;
        if (i === item.a) { b.className = "btn success"; msg.style.color = "#1a9d54"; msg.textContent = "Correct! 🎉"; onWin(); }
        else { b.className = "btn danger"; msg.style.color = "#c0392b"; msg.textContent = "Not quite — answer: " + item.opts[item.a]; }
      };
      opts.appendChild(b);
    });
    root.appendChild(opts); root.appendChild(msg);
  }

  // ---- Game 5: Brain Teaser (number sequence) ----
  function buildPuzzleGame(root, onWin) {
    // Generate a simple arithmetic/geometric sequence and ask for the next term.
    const type = Math.random() < 0.5 ? "add" : "mul";
    const start = 1 + Math.floor(Math.random() * 5);
    const step = 2 + Math.floor(Math.random() * 3);
    const seq = []; let v = start;
    for (let i = 0; i < 4; i++) { seq.push(v); v = type === "add" ? v + step : v * step; }
    const answer = v;
    // Build 3 options including the answer.
    const wrongs = new Set();
    while (wrongs.size < 2) { const w = answer + (Math.random() < 0.5 ? 1 : -1) * (step + Math.floor(Math.random() * 5) + 1); if (w !== answer && w > 0) wrongs.add(w); }
    const options = [answer, ...wrongs].sort(() => Math.random() - 0.5);
    const msg = el("div", { style: "min-height:20px;text-align:center;font-weight:700;margin-top:8px" });
    let done = false;
    root.appendChild(el("div", { class: "muted small", style: "text-align:center;margin-bottom:6px" }, "What comes next in the sequence?"));
    root.appendChild(el("div", { style: "font-weight:800;font-size:20px;text-align:center;margin-bottom:12px" }, seq.join(",  ") + ",  ?"));
    const optsWrap = el("div", { style: "display:flex;gap:8px;justify-content:center" });
    options.forEach((o) => {
      const b = el("button", { class: "btn ghost", style: "min-width:64px" }, String(o));
      b.onclick = () => {
        if (done) return; done = true;
        if (o === answer) { b.className = "btn success"; msg.style.color = "#1a9d54"; msg.textContent = "Correct! 🎉"; onWin(); }
        else { b.className = "btn danger"; msg.style.color = "#c0392b"; msg.textContent = "Answer was " + answer; }
      };
      optsWrap.appendChild(b);
    });
    root.appendChild(optsWrap); root.appendChild(msg);
  }

  // ---- Rewards hub (view balance + redeem only — games are played during a live delivery) ----
  function viewGames() {
    const wrap = el("div", {}, [el("div", { class: "muted" }, "Loading…")]);
    shell("profile", [
      el("div", { class: "row", style: "align-items:center;gap:10px;margin-bottom:10px" }, [
        el("button", { class: "btn ghost sm", onClick: () => go("profile") }, "←"),
        el("h1", { class: "page-title", style: "margin:0" }, "My Rewards"),
      ]),
      wrap,
    ]);
    refreshRewards().then(() => {
      wrap.innerHTML = "";
      const coins = _rewards.goldCoins || 0;
      const cost = _rewards.redeemCost || 100;
      wrap.appendChild(el("div", { class: "card", style: "text-align:center;background:linear-gradient(90deg,#f7b733,#fc4a1a);color:#fff" }, [
        el("div", { style: "font-size:34px;font-weight:900" }, "🪙 " + coins),
        el("div", { style: "opacity:.9" }, "gold coins"),
      ]));

      // Active reward banner.
      if (_rewards.activeReward) {
        wrap.appendChild(el("div", { class: "card", style: "border:1px solid var(--brand);margin-top:10px" }, [
          el("div", { style: "font-weight:700" }, "🎁 Reward ready: " + rewardLabel(_rewards.activeReward.type)),
          el("div", { class: "muted small" }, "It's applied automatically on your next order."),
        ]));
      }

      // Redeem options.
      const canRedeem = coins >= cost && !_rewards.activeReward;
      const redeemCard = el("div", { class: "card", style: "margin-top:10px" }, [
        el("div", { style: "font-weight:800;margin-bottom:6px" }, "Redeem " + cost + " coins"),
        el("div", { class: "muted small", style: "margin-bottom:10px" }, canRedeem ? "Pick your reward:" : (_rewards.activeReward ? "Use your current reward first." : "Earn " + (cost - coins) + " more coins to redeem.")),
        el("div", { style: "display:flex;gap:8px" }, [
          redeemBtn("FREE_DELIVERY", "🚚 Free delivery", canRedeem),
          redeemBtn("PERCENT10", "💯 10% off", canRedeem),
        ]),
      ]);
      wrap.appendChild(redeemCard);

      // How to earn — games are ONLY playable while an order is on the way.
      wrap.appendChild(el("div", { class: "card", style: "margin-top:10px" }, [
        el("div", { style: "font-weight:800;margin-bottom:6px" }, "How to earn coins 🎮"),
        el("div", { class: "muted small" }, "Play the mini-game on your order-tracking screen while your order is being delivered — win to earn " + (_rewards.coinsPerWin || 10) + " coins (once per order)."),
      ]));
    }).catch(() => { wrap.innerHTML = ""; wrap.appendChild(el("div", { class: "muted" }, "Couldn't load rewards.")); });
  }

  function rewardLabel(type) { return type === "FREE_DELIVERY" ? "Free delivery" : type === "PERCENT10" ? "10% off your order" : type; }

  function redeemBtn(type, label, enabled) {
    const b = el("button", { class: "btn " + (enabled ? "primary" : "ghost") + " sm", style: "flex:1", disabled: enabled ? undefined : "" }, label);
    if (enabled) b.onclick = async () => {
      b.disabled = true; b.textContent = "…";
      try { await BW.redeemReward(type); toast("Redeemed! " + rewardLabel(type) + " will apply on your next order."); await refreshRewards(); go("games"); }
      catch (e) { toast(e.message || "Couldn't redeem"); b.disabled = false; b.textContent = label; }
    };
    return b;
  }

  // Fallback for the live-tracking map (the embedded Google map needs a billing-enabled
  // key; until then we show a clean card and the always-works "open in Google Maps" link).
  function mapFallbackCard(o, rider) {
    const active = rider && rider.lat && !["DELIVERED", "CANCELLED"].includes(o.status);
    return el("div", { style: "height:120px;border-radius:12px;background:#faf3ef;display:flex;align-items:center;justify-content:center;text-align:center;padding:0 16px;color:var(--muted)" },
      active ? "📍 Your Saradhi is on the way — tap below for live location."
             : (o.status === "DELIVERED" ? "✓ Delivered" : "Live location appears here once a Saradhi is assigned."));
  }

  function render() {
    // Don't rebuild the screen (wiping a form the user is filling — checkout, address,
    // ticket reply) while an input/textarea/select is focused.
    const ae = document.activeElement;
    if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.tagName === "SELECT") && root.contains && root.contains(ae)) return;
    switch (state.route) {
      case "vendor":        return viewVendor();
      case "track":         return viewTrack();
      case "cart":          return viewCart(state.cartTab);
      case "history":       return viewCart("orders");   // Orders now live inside Cart
      case "profile":       return viewProfile();
      case "scan":          return viewScan();
      case "services":      return viewServices();
      case "serviceVendor": return viewServiceVendor();
      case "bookingTrack":  return viewBookingTrack();
      case "help":          return viewHelp();
      case "ticket":        return viewTicket();
      case "games":         return viewGames();
      default:              return viewStores();
    }
  }

  boot().catch((err) => {
    console.error("Boot failed:", err);
    root.innerHTML = `<div class="bw-loading" style="color:var(--red)">Failed to connect to server. Is the backend running?</div>`;
  });
})();
