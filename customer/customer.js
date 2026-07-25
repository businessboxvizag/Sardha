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

    BW.subscribe(() => {
      if (state.route === "track" || state.route === "history") render();
    });

    render();

    // First-time users get an animated how-to guide (once)
    try { if (!localStorage.getItem("saardha_onboarded")) setTimeout(showOnboarding, 500); } catch (e) {}
  }

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
      navItem("history",  ICONS.orders,  "My Orders"),
      navItem("scan",     ICONS.scan,    "Scan QR"),
      navItem("cart",     ICONS.cart,    "Cart", openCart),
      navItem("profile",  ICONS.profile, "Profile"),
    ]);

    const content = el("div", { class: "content" }, body);
    root.appendChild(el("div", { class: "app" }, [nav, content]));

    // Bottom nav (mobile only — hidden on desktop via CSS)
    root.appendChild(el("div", { class: "bottom-nav" }, [
      bnItem("stores",   ICONS.store,   "Stores"),
      bnItem("history",  ICONS.orders,  "Orders"),
      bnItem("cart",     ICONS.cart,    "Cart", openCart, cartCount() || null),
      bnItem("scan",     ICONS.scan,    "Scan"),
      bnItem("profile",  ICONS.profile, "Profile"),
    ]));

    // Floating cart bar — slides up whenever the cart has items
    if (cartCount() > 0) {
      const sub = cartTotal();
      const tot = sub + Math.round(sub * 0.18) + (BW.deliveryFee ? BW.deliveryFee() : 15);
      root.appendChild(el("div", { class: "cart-bar", onClick: openCart }, [
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

  function getUnlockedVendors() {
    // Account-backed stores (sync across devices) merged with any legacy device-local list
    var acct = (BW.shops ? BW.shops() : []) || [];
    var local = [];
    try { local = JSON.parse(localStorage.getItem("bw_unlocked_vendors") || "[]"); } catch (e) {}
    if (!Array.isArray(local)) local = [];
    var seen = {}, out = [];
    acct.concat(local).forEach(function (id) { if (id && !seen[id]) { seen[id] = 1; out.push(id); } });
    return out;
  }

  function addStoreLocal(id) {
    try {
      var l = JSON.parse(localStorage.getItem("bw_unlocked_vendors") || "[]");
      if (!Array.isArray(l)) l = [];
      if (l.indexOf(id) < 0) { l.push(id); localStorage.setItem("bw_unlocked_vendors", JSON.stringify(l)); }
    } catch (e) {}
  }

  function migrateLocalShops() {
    try {
      var local = JSON.parse(localStorage.getItem("bw_unlocked_vendors") || "[]");
      if (!Array.isArray(local) || !local.length || !BW.addShop) return;
      var acct = (BW.shops ? BW.shops() : []) || [];
      local.forEach(function (id) { if (acct.indexOf(id) < 0) BW.addShop(id).catch(function () {}); });
    } catch (e) {}
  }

  /* ====================== MY STORES ====================== */
  function viewStores() {
    const unlocked = getUnlockedVendors();
    const favs = BW.favorites();

    // Empty state — no QR scans yet
    if (!unlocked.length) {
      shell("stores", [
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
        onInput: (e) => { state.search = e.target.value; renderGrid(); },
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
      const bar = el("div", { class: "cart-bar", onClick: openCart }, [
        el("span", {}, cartCount() + (cartCount() === 1 ? " item" : " items") + " · " + money(tot)),
        el("span", {}, "View cart →"),
      ]);
      document.getElementById("root").appendChild(bar);
    }
  }

  function viewVendor() {
    const v = BW.vendor(state.vendorId);
    if (!v) { go("stores"); return; }
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

  let _placing = false;
  async function placeOrder() {
    if (_placing) return; // guard against double-tap creating two orders
    const vendorId = state.cartVendor;
    const items = cartLines();
    if (state.paymentMethod === "ONLINE") return payOnlineThenPlace(vendorId, items);
    _placing = true;
    showPlacing();
    try {
      const order = await BW.placeOrder({ vendorId, items, paymentMethod: "COD" });
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
      ratingCard(o),
      el("div", { class: "grid cols-2", style: "margin-top:16px" }, [
        el("div", { class: "card" }, [
          el("h3", { style: "margin-top:0" }, "Live tracking"),
          mapFor(v, cust, rider),
          rider
            ? el("div", {}, [
                el("div", { class: "row between", style: "margin-top:12px" }, [
                  el("div", {}, [el("div", { style: "font-weight:600" }, rider.name), el("div", { class: "muted small" }, (rider.vehicle || "") + " · " + (rider.rating || "5") + " ★")]),
                  el("a", { class: "btn ghost sm", href: "tel:" + rider.phone }, "Call"),
                ]),
                etaBadge(o, rider, cust),
              ])
            : el("div", { class: "muted small", style: "margin-top:12px" }, "Waiting for a Saradhi to be assigned…"),
        ]),
        el("div", { class: "card" }, [
          el("h3", { style: "margin-top:0" }, "Order summary"),
          ...o.items.map((l) => el("div", { class: "row between small", style: "padding:5px 0" }, [
            el("span", {}, l.qty + "× " + l.name), el("span", { class: "muted" }, money(l.price * l.qty)),
          ])),
          el("div", { class: "line", style: "border-top:1px solid var(--border);margin-top:8px;padding-top:10px" }, [
            el("strong", {}, "Total"), el("strong", {}, money(o.total)),
          ]),
          cust ? el("div", { class: "muted small", style: "margin-top:10px" }, "Deliver to: " + cust.address) : document.createTextNode(""),
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

  function mapFor(vendor, customer, rider) {
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
    let _detector = null;
    let _scanLoop = null;

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
        // fallback: /scan/VENDOR_ID pattern
        const m = url.pathname.match(/\/scan\/([^/?#]+)/);
        return m ? m[1] : null;
      } catch { return null; }
    }

    function startCamera(videoEl, resultEl, successCb) {
      if (!("BarcodeDetector" in window)) {
        resultEl.textContent = "Camera scanning unavailable in this browser. Use file upload below.";
        return;
      }
      _detector = new BarcodeDetector({ formats: ["qr_code"] });
      navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } })
        .then((stream) => {
          _stream = stream;
          videoEl.srcObject = stream;
          videoEl.play();
          const canvas = document.createElement("canvas");
          const ctx = canvas.getContext("2d");

          function tick() {
            if (!_stream) return;
            if (videoEl.readyState >= 2) {
              canvas.width = videoEl.videoWidth;
              canvas.height = videoEl.videoHeight;
              ctx.drawImage(videoEl, 0, 0);
              _detector.detect(canvas).then((codes) => {
                if (codes.length > 0) {
                  const rawValue = codes[0].rawValue;
                  const vendorId = processUrl(rawValue);
                  if (vendorId) {
                    stopCamera();
                    addVendorById(vendorId);
                    successCb(vendorId);
                  } else {
                    resultEl.textContent = "QR code found but could not identify a vendor. Try again.";
                  }
                }
              }).catch(() => {});
            }
            _scanLoop = requestAnimationFrame(tick);
          }
          tick();
        })
        .catch((err) => {
          resultEl.textContent = err.name === "NotAllowedError"
            ? "Camera access denied. Please allow camera access or use file upload below."
            : "Could not start camera. Use file upload below.";
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

    const wrap = el("div", { class: "scan-wrap" }, []);

    shell("scan", [
      el("h1", { class: "page-title" }, "Scan QR Code"),
      el("p", { class: "page-sub" }, "Point your camera at a merchant's QR code to add their store."),

      el("div", { class: "scan-camera-box" }, [
        el("video", { id: "scanVideo", autoplay: true, playsinline: true, style: "width:100%;border-radius:10px;background:#2c1a0e;max-height:280px;object-fit:cover" }, []),
        el("div", { id: "scanResult", class: "auth-err", style: "margin-top:8px;text-align:left" }, []),
      ]),

      el("div", { id: "scanSuccess", style: "display:none;margin-top:16px;padding:16px;background:var(--surface-2);border-radius:10px;border:1px solid var(--border)" }, []),

      el("div", { class: "scan-file-section" }, [
        el("p", { class: "muted small", style: "margin:16px 0 8px" }, "Or upload a QR code image:"),
        el("input", {
          type: "file", accept: "image/*", id: "scanFileInput",
          style: "font-size:13px",
          onChange: (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const img = new Image();
            img.onload = () => {
              if (!_detector) _detector = new BarcodeDetector({ formats: ["qr_code"] }).catch(() => null);
              if (!("BarcodeDetector" in window)) {
                document.getElementById("scanResult").textContent = "BarcodeDetector not supported. Try a Chromium browser.";
                return;
              }
              const det = new BarcodeDetector({ formats: ["qr_code"] });
              det.detect(img).then((codes) => {
                const resultEl = document.getElementById("scanResult");
                if (!codes.length) { resultEl.textContent = "No QR code found in image."; return; }
                const vendorId = processUrl(codes[0].rawValue);
                if (vendorId) { addVendorById(vendorId); onSuccess(vendorId); }
                else { resultEl.textContent = "QR code found but vendor not recognized."; }
              }).catch(() => {
                document.getElementById("scanResult").textContent = "Could not read QR code from image.";
              });
            };
            img.src = URL.createObjectURL(file);
          },
        }),
      ]),
    ]);

    // Start camera after DOM is ready
    setTimeout(() => {
      const videoEl = document.getElementById("scanVideo");
      const resultEl = document.getElementById("scanResult");
      if (videoEl && resultEl) startCamera(videoEl, resultEl, onSuccess);
    }, 0);

    // Stop camera when navigating away
    const origGo = go;
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
    const name = (cust && cust.name) || (user && user.name) || "Customer";
    const initials = name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
    const rowKV = (k, v) => el("div", { class: "row between", style: "padding:9px 0;border-bottom:0.5px solid var(--border)" }, [
      el("span", { class: "muted" }, k), el("span", { style: "font-weight:500;text-align:right" }, v),
    ]);
    shell("profile", [
      el("h1", { class: "page-title" }, "Profile"),
      el("div", { class: "card", style: "display:flex;align-items:center;gap:14px" }, [
        el("div", { style: "width:56px;height:56px;border-radius:50%;background:var(--brand-lt);color:var(--brand);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:20px;flex-shrink:0" }, initials || "U"),
        el("div", { style: "min-width:0" }, [
          el("div", { style: "font-weight:700;font-size:17px" }, name),
          el("div", { class: "muted small" }, (user && user.email) || ""),
        ]),
      ]),
      el("div", { class: "card", style: "margin-top:12px" }, [
        rowKV("Phone", (cust && cust.phone) || "—"),
        rowKV("Delivery address", (cust && cust.address) || "Not set yet"),
        el("div", { class: "row between", style: "padding:9px 0" }, [
          el("span", { class: "muted" }, "Stores added"), el("span", { style: "font-weight:500" }, String(getUnlockedVendors().length)),
        ]),
      ]),
      el("button", { class: "btn danger", style: "width:100%;margin-top:18px", onClick: () => BW.logout() }, "Log out"),
    ]);
  }

  /* ====================== ROUTER ====================== */
  function render() {
    switch (state.route) {
      case "vendor":    return viewVendor();
      case "track":     return viewTrack();
      case "history":   return viewHistory();
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
