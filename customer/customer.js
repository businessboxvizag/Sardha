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

    // Notify the customer live when a fresh order is accepted or declined by the store
    const _lastStatus = {};
    BW.subscribe(() => {
      try {
        const c = BW.currentCustomer();
        (c ? BW.orders({ customerId: c.id }) : BW.orders()).forEach((o) => {
          const prev = _lastStatus[o.id];
          if (prev && prev !== o.status) {
            if (o.status === "CANCELLED") toast("Order " + o.id.slice(-6).toUpperCase() + " was declined by the store");
            else if (o.status === "ACCEPTED" && prev === "PLACED") toast("Order " + o.id.slice(-6).toUpperCase() + " accepted! Preparing now.");
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
  function go(route, extra = {}) {
    // Stop any active camera scan before leaving the scan view
    if (window._scanCleanup) { window._scanCleanup(); window._scanCleanup = null; }
    stopEtaPolling();
    Object.assign(state, { route }, extra);
    window.scrollTo(0, 0);
    render();
  }

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
          el("div", { style: "font-weight:800;font-size:13px" }, "Pilot launch — thanks for trying Saardha!"),
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

  function viewStores() {
    const unlocked = getUnlockedVendors();
    const favs = BW.favorites();

    // Empty state — no QR scans yet
    if (!unlocked.length) {
      shell("stores", [
        pilotBanner(),
        el("h1", { class: "page-title" }, "My Stores"),
        el("div", { class: "empty", style: "margin-top:40px" }, [
          el("div", { class: "e" }, ""),
          el("p", { style: "margin:12px 0 6px;font-size:15px;font-weight:600;color:#f0f0f0" }, "No stores yet"),
          el("p", { class: "muted small", style: "max-width:240px;margin:0 auto;line-height:1.6" },
            "Scan a merchant's QR code to add their store to your app."),
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
    return el("div", { class: "vcard", onClick: () => openVendor(v.id) }, [
      el("div", { class: "vcard-img" }, v.img || (v.name || "?")[0].toUpperCase()),
      el("div", { class: "vcard-body" }, [
        el("div", { class: "vcard-name" }, v.name),
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
          el("div", { class: "item-price" }, money(p.price)),
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

    const body = [
      el("div", { class: "store-hero" }, [
        el("button", { class: "store-back", onClick: () => go("stores"), "aria-label": "Back" }, "‹"),
        el("div", { class: "store-hero-logo" }, v.img || (v.name || "?")[0].toUpperCase()),
        el("div", { class: "store-hero-info" }, [
          el("div", { class: "store-hero-name" }, v.name),
          el("div", { class: "store-hero-meta" }, v.category + " · " + v.area),
        ]),
        el("div", { class: "store-hero-rating" }, "★ " + v.rating),
      ]),
      el("div", { class: "store-time-strip" }, "🛵 " + v.prepMins + "–" + (v.prepMins + 15) + " min  ·  Delivery " + money(fee)),
      listEl,
    ];
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
      const gst = Math.round(sub * 0.18);
      const fee = BW.deliveryFee ? BW.deliveryFee() : 15;
      linesWrap.appendChild(el("div", { class: "line", style: "border:none" }, [
        el("span", { class: "muted" }, "Subtotal"), el("span", {}, money(sub)),
      ]));
      linesWrap.appendChild(el("div", { class: "line", style: "border:none" }, [
        el("span", { class: "muted" }, "GST (18%)"), el("span", {}, money(gst)),
      ]));
      linesWrap.appendChild(el("div", { class: "line", style: "border:none" }, [
        el("span", { class: "muted" }, "Delivery fee"), el("span", {}, money(fee)),
      ]));
      linesWrap.appendChild(el("div", { class: "line", style: "border:none;font-size:16px;padding-top:4px" }, [
        el("strong", {}, "Total"), el("strong", { style: "color:var(--brand)" }, money(sub + gst + fee)),
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
        mkOpt("COD", "Cash on delivery"),
        mkOpt("ONLINE", "Pay online (UPI/Card)"),
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
      const gst = Math.round(sub * 0.18);
      const fee = BW.deliveryFee ? BW.deliveryFee() : 15;
      const bill = el("div", { class: "card", style: "margin-bottom:12px" }, [
        el("div", { class: "line", style: "border:none" }, [el("span", { class: "muted" }, "Subtotal"), el("span", {}, money(sub))]),
        el("div", { class: "line", style: "border:none" }, [el("span", { class: "muted" }, "GST (18%)"), el("span", {}, money(gst))]),
        el("div", { class: "line", style: "border:none" }, [el("span", { class: "muted" }, "Delivery fee"), el("span", {}, money(fee))]),
        el("div", { class: "line", style: "border:none;font-size:16px;padding-top:4px" }, [
          el("strong", {}, "Total"), el("strong", { style: "color:var(--brand)" }, money(sub + gst + fee)),
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
        mkOpt("COD", "Cash on delivery"),
        mkOpt("ONLINE", "Pay online (UPI/Card)"),
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

      const locStatus = el("span", { class: "muted small" }, state.deliverLoc ? "📍 Pin set" : "⚠️ No pin — please set your location");
      const useLocBtn = el("button", { class: "btn ghost sm", type: "button" }, "📍 Use my current location");
      useLocBtn.addEventListener("click", () => {
        if (!navigator.geolocation) { toast("Location not available"); return; }
        useLocBtn.disabled = true; useLocBtn.textContent = "Locating…";
        navigator.geolocation.getCurrentPosition(
          (p) => { state.deliverLoc = { lat: p.coords.latitude, lng: p.coords.longitude }; toast("Location pinned"); renderCartPanel(); },
          () => { toast("Couldn't get location — allow GPS or drop a pin."); useLocBtn.disabled = false; useLocBtn.textContent = "📍 Use my current location"; }
        );
      });
      const picker = UI.mapPicker ? UI.mapPicker({
        height: 180,
        lat: state.deliverLoc && state.deliverLoc.lat,
        lng: state.deliverLoc && state.deliverLoc.lng,
        onPick: (la, ln) => { state.deliverLoc = { lat: la, lng: ln }; locStatus.textContent = "📍 Pin set"; },
      }) : null;

      panelCart.appendChild(el("div", { class: "card", style: "margin-bottom:12px" }, [
        el("div", { style: "font-weight:800;margin-bottom:8px" }, "Delivery address"),
        el("div", { style: "display:flex;gap:8px;align-items:center;margin-bottom:8px" }, [useLocBtn, locStatus]),
        picker ? el("div", { style: "margin-bottom:10px" }, [el("div", { class: "muted small", style: "margin-bottom:4px" }, "Drag the pin to your exact door"), picker]) : document.createTextNode(""),
        field("Flat / House no. & building", "deliverFlat", "e.g. Flat 3B, Sunrise Apartments"),
        field("Area / street / colony", "deliverArea", "e.g. MG Road, Dwaraka Nagar"),
        field("Landmark", "deliverLandmark", "e.g. near Reliance Fresh"),
        el("div", { style: "display:flex;gap:8px" }, [
          el("div", { style: "flex:1" }, [field("Receiver name", "deliverName", "Name")]),
          el("div", { style: "flex:1" }, [field("Receiver phone", "deliverPhone", "10-digit mobile", "tel")]),
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
          el("span", { class: "oc-id" }, "#" + o.id.slice(-6).toUpperCase()),
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
    const addr = composedDeliverTo();
    if (!state.deliverLoc && addr.length < 6) {
      toast("Please set your delivery address — drop a pin or fill the address.");
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
      const order = await BW.placeOrder({ vendorId, items, paymentMethod: "COD",
        deliverLat: loc && loc.lat, deliverLng: loc && loc.lng, deliverTo: composedDeliverTo() || (cust && cust.address),
        deliverPhone: state.deliverPhone, deliverName: state.deliverName,
        prescriptionUrl: state.rxPrescriptionUrl, selfieUrl: state.rxSelfieUrl, rxConsent: state.rxConsent });
      state.cart = {};
      state.cartVendor = null;
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
      pay = await BW.createPaymentOrder({ vendorId, items });
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
            vendorId, items, paymentMethod: "ONLINE",
            razorpay_payment_id: resp.razorpay_payment_id,
            razorpay_order_id: resp.razorpay_order_id,
            razorpay_signature: resp.razorpay_signature,
            deliverLat: loc && loc.lat, deliverLng: loc && loc.lng, deliverTo: composedDeliverTo() || (cust && cust.address),
            deliverPhone: state.deliverPhone, deliverName: state.deliverName,
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
          el("h1", { class: "page-title", style: "margin:0" }, "Order " + o.id.slice(-6).toUpperCase()),
          el("div", { class: "muted" }, v.name + " · placed " + timeAgo(o.createdAt)),
        ]),
        statusBadge(o.status),
      ]),
      el("div", { class: "card" }, [tracker(o.status)]),
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
          mapFor(v, cust, rider),
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
          el("div", { class: "line", style: "border-top:1px solid var(--border);margin-top:8px;padding-top:10px" }, [
            el("strong", {}, "Total"), el("strong", {}, money(o.total)),
          ]),
          el("div", { class: "muted small", style: "margin-top:10px" }, "Deliver to: " + (o.deliverTo || (cust && cust.address) || "—")),
        ]),
      ]),
    ];
    shell("history", body);
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
          el("td", {}, el("strong", {}, o.id.slice(-6).toUpperCase())),
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
      el("button", { class: "btn danger", style: "width:100%;margin-top:18px", onClick: () => BW.logout() }, "Log out"),
    ]);
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
  function render() {
    switch (state.route) {
      case "vendor":    return viewVendor();
      case "track":     return viewTrack();
      case "cart":      return viewCart(state.cartTab);
      case "history":   return viewCart("orders");   // Orders now live inside Cart
      case "profile":   return viewProfile();
      case "scan":      return viewScan();
      default:          return viewStores();
    }
  }

  boot().catch((err) => {
    console.error("Boot failed:", err);
    root.innerHTML = `<div class="bw-loading" style="color:var(--red)">Failed to connect to server. Is the backend running?</div>`;
  });
})();
