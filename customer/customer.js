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
  };

  const root = document.getElementById("root");

  /* ----- boot ----- */
  async function boot() {
    const user = await BWAuth.requireLogin("customer");
    await BW.init("customer");

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
    return Object.entries(state.cart).map(([pid, qty]) => {
      const p = prods.find((x) => x.id === pid);
      return { productId: pid, name: p.name, price: p.price, qty };
    });
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

    const countHint = el("div", { style: "display:flex;align-items:center;gap:10px;background:#1a1a24;border:1px solid #2a2a3a;border-radius:10px;padding:10px 14px;margin-bottom:16px;font-size:13px" }, [
      el("span", { style: "font-size:13px;font-weight:700;color:var(--brand)" }, "M"),
      el("span", { style: "flex:1;color:#bbb" }, [
        el("strong", { style: "color:#f5a623" }, String(unlocked.length) + " store" + (unlocked.length !== 1 ? "s" : "") + " in your collection"),
        document.createTextNode(" · Scan more QR codes to add stores"),
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
    return el("div", { class: "card hover", onClick: () => openVendor(v.id) }, [
      el("div", { class: "row between" }, [
        el("div", { class: "vendor-initial" }, (v.name || "?")[0].toUpperCase()),
        el("button", {
          class: "x",
          title: "Favorite",
          onClick: async (e) => {
            e.stopPropagation();
            await BW.toggleFavorite(v.id);
            render();
          },
        }, isFav ? "Saved" : "Save"),
      ]),
      el("h3", { style: "margin:8px 0 2px" }, v.name),
      el("div", { class: "muted small" }, v.category + " · " + v.area),
      el("div", { class: "row", style: "margin-top:10px;gap:8px" }, [
        el("span", { class: "tag" }, v.rating + " rating"),
        el("span", { class: "tag" }, "~" + v.prepMins + " min prep"),
      ]),
    ]);
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
    const products = BW.products(v.id);
    const favs = BW.favorites();

    const list = el("div", { class: "grid", style: "gap:0" });
    products.forEach((p) => {
      list.appendChild(el("div", { class: "line" }, [
        el("div", {}, [
          el("div", { style: "font-weight:600" }, p.name),
          el("div", { class: "muted small" }, money(p.price) + " / " + p.unit),
        ]),
        el("button", { class: "btn primary sm", onClick: () => addToCart(p) }, "Add +"),
      ]));
    });

    const body = [
      el("button", { class: "btn ghost sm", onClick: () => go("stores") }, "← Back"),
      el("div", { class: "row between", style: "margin:14px 0 4px" }, [
        el("div", { class: "row", style: "gap:14px" }, [
          el("div", { class: "vendor-initial vendor-initial--lg" }, (v.name || "?")[0].toUpperCase()),
          el("div", {}, [
            el("h1", { class: "page-title", style: "margin:0" }, v.name),
            el("div", { class: "muted" }, v.category + " · " + v.area + " · " + v.rating + " rating"),
          ]),
        ]),
        el("button", {
          class: "btn ghost",
          onClick: async () => { await BW.toggleFavorite(v.id); render(); },
        }, favs.includes(v.id) ? "Saved" : "Save"),
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
      linesWrap.appendChild(el("div", { class: "line", style: "border:none" }, [
        el("strong", {}, "Subtotal"), el("strong", {}, money(sub)),
      ]));
      linesWrap.appendChild(el("div", { class: "row between muted small" }, [
        el("span", {}, "Delivery fee"), el("span", {}, money(25)),
      ]));
      linesWrap.appendChild(el("div", { class: "line", style: "border:none;font-size:16px" }, [
        el("strong", {}, "Total"), el("strong", {}, money(sub + 25)),
      ]));
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
    try {
      const order = await BW.placeOrder({ vendorId: state.cartVendor, items: cartLines() });
      state.cart = {};
      state.cartVendor = null;
      toast("Order placed! Tracking now.");
      go("track", { trackOrderId: order.id });
    } catch (err) {
      toast("Failed to place order: " + err.message);
    }
  }

  /* ====================== TRACK ====================== */
  function viewTrack() {
    const o = BW.order(state.trackOrderId);
    if (!o) return go("history");
    const v = BW.vendor(o.vendorId);
    const cust = BW.currentCustomer();
    const rider = o.riderId ? BW.rider(o.riderId) : null;

    // Track rider's live location
    if (rider) BW.joinOrderRoom(o.id);

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
      el("div", { class: "grid cols-2", style: "margin-top:16px" }, [
        el("div", { class: "card" }, [
          el("h3", { style: "margin-top:0" }, "Live tracking"),
          mapFor(v, cust, rider),
          rider
            ? el("div", { class: "row between", style: "margin-top:12px" }, [
                el("div", {}, [el("div", { style: "font-weight:600" }, rider.name), el("div", { class: "muted small" }, rider.vehicle + " · " + rider.rating + " rating")]),
                el("a", { class: "btn ghost sm", href: "tel:" + rider.phone }, "Call rider"),
              ])
            : el("div", { class: "muted small", style: "margin-top:12px" }, "Waiting for a rider to be assigned…"),
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
