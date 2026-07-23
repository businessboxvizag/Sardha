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

    // A merchant QR / scan page can deep-link a store via ?v=<vendorId> — add it
    handleAddStoreParam();

    // Join the customer's Socket.io room for live order updates
    const me = BW.currentCustomer();
    if (me) BW.joinCustomerRoom(me.id);

    BW.subscribe(() => {
      if (state.route === "track" || state.route === "history") render();
    });

    render();
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

  /* ----- shell ----- */
  function shell(active, body) {
    root.innerHTML = "";
    const cust = BW.currentCustomer();
    const user = BW.Auth.getUser();

    const cartBtn = el("button", { class: "btn primary sm", onClick: openCart }, [
      document.createTextNode("Cart"),
      cartCount() ? el("span", { class: "badge", style: "background:#1a1205" }, String(cartCount())) : document.createTextNode(""),
    ]);
    const logoutBtn = el("button", { class: "btn ghost sm", onClick: () => BW.logout() }, "Sign out");

    root.appendChild(topbar("Customer · " + (user ? user.name : ""), [cartBtn, logoutBtn]));

    const nav = el("div", { class: "sidebar" }, [
      navItem("stores",    "St", "My Stores"),
      navItem("history",   "Or", "My Orders"),
      navItem("favorites", "Fv", "Favorites"),
      navItem("scan",      "QR", "Scan QR"),
    ]);

    const content = el("div", { class: "content" }, body);
    root.appendChild(el("div", { class: "app" }, [nav, content]));

    // Bottom nav (mobile only — hidden on desktop via CSS)
    root.appendChild(el("div", { class: "bottom-nav" }, [
      bnItem("stores",    "St", "Stores"),
      bnItem("history",   "Or", "Orders"),
      bnItem("favorites", "Fv", "Favs"),
      bnItem("scan",      "QR", "Scan"),
    ]));

    function navItem(route, ico, label) {
      return el("div", {
        class: "nav-item" + (active === route ? " active" : ""),
        onClick: () => go(route),
      }, [el("span", { class: "ico nav-ico-text" }, ico), el("span", {}, label)]);
    }

    function bnItem(route, ico, label, badge) {
      const wrap = el("div", { class: "bottom-nav-item-wrap" }, [
        el("button", {
          class: "bottom-nav-item" + (active === route ? " active" : ""),
          onClick: () => go(route),
        }, [
          el("span", { class: "bn-ico" }, ico),
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
          unlocked.push(vId);
          localStorage.setItem("bw_unlocked_vendors", JSON.stringify(unlocked));
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
    try {
      const raw = localStorage.getItem("bw_unlocked_vendors");
      if (!raw) return [];
      const list = JSON.parse(raw);
      return Array.isArray(list) ? list : [];
    } catch { return []; }
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

  function vendorCard(v, favs) {
    const isFav = favs.includes(v.id);
    const card = el("div", { class: "store-card", onClick: () => openVendor(v.id) }, [
      el("div", { class: "store-card-banner" }, v.img || (v.name || "?")[0].toUpperCase()),
      el("div", { class: "store-card-body" }, [
        el("div", { class: "row between" }, [
          el("div", { class: "store-card-name" }, v.name),
          el("button", {
            class: "btn ghost sm", style: "padding:4px 8px;font-size:11px",
            onClick: async (e) => {
              e.stopPropagation();
              await BW.toggleFavorite(v.id);
              render();
            },
          }, isFav ? "♥ Saved" : "♡ Save"),
        ]),
        el("div", { class: "store-card-meta" }, v.category + " · " + v.area),
        el("div", { class: "store-card-tags" }, [
          el("span", { class: "tag" }, "⭐ " + v.rating),
          el("span", { class: "tag" }, "~" + v.prepMins + "m"),
        ]),
      ]),
    ]);
    return card;
  }

  /* ====================== VENDOR ====================== */
  async function openVendor(vendorId) {
    // Load products for this vendor if not already cached
    if (!BW.products(vendorId).length) {
      await BW.loadVendorProducts(vendorId);
    }
    go("vendor", { vendorId });
  }

  function viewVendor() {
    const v = BW.vendor(state.vendorId);
    if (!v) { go("stores"); return; }
    const products = BW.products(v.id);
    const favs = BW.favorites();

    const list = el("div", {});
    products.forEach((p) => {
      const qty = state.cart[p.id] || 0;
      const qtyCtrl = qty > 0
        ? el("div", { class: "qty" }, [
            el("button", { onClick: (e) => { e.stopPropagation(); setQty(p.id, qty - 1); viewVendor(); } }, "−"),
            el("span", { style: "font-weight:700;min-width:18px;text-align:center" }, String(qty)),
            el("button", { onClick: (e) => { e.stopPropagation(); addToCart(p); viewVendor(); } }, "+"),
          ])
        : el("button", { class: "btn primary sm", onClick: (e) => { e.stopPropagation(); addToCart(p); viewVendor(); } }, "+ Add");
      list.appendChild(el("div", { class: "product-item" }, [
        el("div", { class: "product-info" }, [
          el("div", { class: "product-name" }, p.name),
          el("div", { class: "product-price" }, money(p.price) + " / " + p.unit),
        ]),
        qtyCtrl,
      ]));
    });

    const body = [
      el("button", { class: "btn ghost sm", onClick: () => go("stores") }, "← Back"),
      el("div", { class: "row between", style: "margin:14px 0 4px" }, [
        el("div", { class: "row", style: "gap:14px" }, [
          el("div", { class: "vendor-initial vendor-initial--lg", style: "font-size:28px;background:var(--surface-2);color:var(--text)" }, v.img || (v.name || "?")[0].toUpperCase()),
          el("div", {}, [
            el("h1", { class: "page-title", style: "margin:0" }, v.name),
            el("div", { class: "muted small" }, v.category + " · " + v.area + " · ⭐ " + v.rating),
          ]),
        ]),
        el("button", {
          class: "btn ghost sm",
          onClick: async () => { await BW.toggleFavorite(v.id); render(); },
        }, favs.includes(v.id) ? "♥ Saved" : "♡ Save"),
      ]),
      el("div", { class: "card", style: "margin-top:16px" }, [
        el("h3", { style: "margin-top:0" }, "Menu"),
        list,
      ]),
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
      const fee = BW.deliveryFee ? BW.deliveryFee() : 25;
      linesWrap.appendChild(el("div", { class: "line", style: "border:none" }, [
        el("span", { class: "muted" }, "Subtotal"), el("span", {}, money(sub)),
      ]));
      linesWrap.appendChild(el("div", { class: "line", style: "border:none" }, [
        el("span", { class: "muted" }, "Delivery fee"), el("span", {}, money(fee)),
      ]));
      linesWrap.appendChild(el("div", { class: "line", style: "border:none;font-size:16px;padding-top:4px" }, [
        el("strong", {}, "Total"), el("strong", { style: "color:var(--brand)" }, money(sub + fee)),
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

  async function placeOrder() {
    const vendorId = state.cartVendor;
    const items = cartLines();
    if (state.paymentMethod === "ONLINE") return payOnlineThenPlace(vendorId, items);
    try {
      const order = await BW.placeOrder({ vendorId, items, paymentMethod: "COD" });
      state.cart = {};
      state.cartVendor = null;
      showOrderConfirmation(order);
    } catch (err) {
      toast("Failed to place order: " + err.message);
    }
  }

  async function payOnlineThenPlace(vendorId, items) {
    if (typeof Razorpay === "undefined") {
      toast("Online payment unavailable — please choose Cash on delivery");
      return;
    }
    let pay;
    try {
      pay = await BW.createPaymentOrder({ vendorId, items });
    } catch (err) {
      toast("Could not start payment: " + err.message);
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
      theme: { color: "#e8590c" },
      handler: async (resp) => {
        try {
          const order = await BW.placeOrder({
            vendorId, items, paymentMethod: "ONLINE",
            razorpay_payment_id: resp.razorpay_payment_id,
            razorpay_order_id: resp.razorpay_order_id,
            razorpay_signature: resp.razorpay_signature,
          });
          state.cart = {};
          state.cartVendor = null;
          showOrderConfirmation(order);
        } catch (err) {
          toast("Payment received but order failed — contact support: " + err.message);
        }
      },
    });
    rzp.on("payment.failed", (r) =>
      toast("Payment failed: " + ((r.error && r.error.description) || "please try again")));
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
      const unlocked = getUnlockedVendors();
      if (!unlocked.includes(vendorId)) {
        unlocked.push(vendorId);
        localStorage.setItem("bw_unlocked_vendors", JSON.stringify(unlocked));
      }
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
        el("video", { id: "scanVideo", autoplay: true, playsinline: true, style: "width:100%;border-radius:10px;background:#000;max-height:280px;object-fit:cover" }, []),
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

  /* ====================== ROUTER ====================== */
  function render() {
    switch (state.route) {
      case "vendor":    return viewVendor();
      case "track":     return viewTrack();
      case "history":   return viewHistory();
      case "favorites": return viewFavorites();
      case "scan":      return viewScan();
      default:          return viewStores();
    }
  }

  boot().catch((err) => {
    console.error("Boot failed:", err);
    root.innerHTML = `<div class="bw-loading" style="color:var(--red)">Failed to connect to server. Is the backend running?</div>`;
  });
})();
