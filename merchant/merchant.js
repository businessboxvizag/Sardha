/* =========================================================
 * Merchant App
 * ========================================================= */
(function () {
  "use strict";
  const { el, money, timeAgo, clockTime, toast, topbar, project, statusBadge, tracker } = UI;
  const S = {
    PLACED: "PLACED", ACCEPTED: "ACCEPTED", ASSIGNED: "ASSIGNED",
    PICKED_UP: "PICKED_UP", OUT_FOR_DELIVERY: "OUT_FOR_DELIVERY",
    DELIVERED: "DELIVERED", CANCELLED: "CANCELLED",
  };

  const FOOD_CATEGORIES = ["food", "street food", "restaurant", "bakery", "cafe",
    "fast food", "sweets", "chaat", "catering", "beverages", "desserts", "snacks", "tiffin"];
  const PHARMACY_CATEGORIES = ["pharmacy", "medical", "medicine", "chemist", "drug", "pharma"];
  const GENERAL_CATEGORIES  = ["general", "grocery", "groceries", "kirana", "supermarket",
    "mart", "departmental", "provisions", "stationary", "hardware"];

  function isFoodVendor(vendor) {
    if (!vendor) return false;
    return FOOD_CATEGORIES.some((c) => (vendor.category || "").toLowerCase().includes(c));
  }
  function isPharmacyVendor(vendor) {
    if (!vendor) return false;
    return PHARMACY_CATEGORIES.some((c) => (vendor.category || "").toLowerCase().includes(c));
  }
  function isGeneralVendor(vendor) {
    if (!vendor) return false;
    return GENERAL_CATEGORIES.some((c) => (vendor.category || "").toLowerCase().includes(c));
  }

  /* Unit presets */
  const PHARMACY_UNITS = [
    { value: "tablets/strip",  label: "Tablets / strip"              },
    { value: "capsules",       label: "Capsules"                     },
    { value: "ml",             label: "ml  (Syrup / Tonic / Liquid)" },
    { value: "mg",             label: "mg  (Powder / Sachet)"        },
    { value: "g",              label: "g   (Cream / Gel / Ointment)" },
    { value: "drops",          label: "Drops  (Eye / Ear)"           },
    { value: "vial",           label: "Vial / Injection"             },
    { value: "sachet",         label: "Sachet / Powder packet"       },
    { value: "units",          label: "Units (other)"                },
  ];
  const GENERAL_UNITS = [
    { value: "piece",   label: "Per piece / pcs"  },
    { value: "kg",      label: "Per kg"           },
    { value: "g",       label: "Per gram (g)"     },
    { value: "liter",   label: "Per liter"        },
    { value: "ml",      label: "Per ml"           },
    { value: "packet",  label: "Per packet"       },
    { value: "box",     label: "Per box"          },
    { value: "bottle",  label: "Per bottle"       },
    { value: "can",     label: "Per can / tin"    },
    { value: "jar",     label: "Per jar"          },
    { value: "dozen",   label: "Per dozen (12)"   },
    { value: "pair",    label: "Per pair"         },
    { value: "set",     label: "Per set"          },
    { value: "bundle",  label: "Per bundle"       },
    { value: "roll",    label: "Per roll"         },
    { value: "meter",   label: "Per meter"        },
    { value: "bag",     label: "Per bag / sack"   },
    { value: "strip",   label: "Per strip"        },
  ];

  const CATEGORY_OPTIONS = [
    { value: "Restaurant",   label: "Restaurant" },
    { value: "Street Food",  label: "Street Food / Chaat" },
    { value: "Bakery",       label: "Bakery / Cafe" },
    { value: "Sweets",       label: "Sweets & Snacks" },
    { value: "Groceries",    label: "Groceries" },
    { value: "Pharmacy",     label: "Pharmacy" },
    { value: "Florist",      label: "Florist" },
    { value: "Electronics",  label: "Electronics" },
    { value: "Clothing",     label: "Clothing / Textiles" },
    { value: "General",      label: "General Store" },
  ];

  const EMOJI_OPTIONS = [];

  const state = { route: "orders", vendorId: null, detailOrderId: null };
  const root = document.getElementById("root");
  let _seenOrderIds = new Set();

  /* ----- boot ----- */
  async function boot() {
    await BWAuth.requireLogin("merchant");
    await BW.init("merchant");

    const me = BW.Auth.getUser();
    const vendors = BW.vendors();

    // Find this merchant's vendor (created by admin as a stub)
    const myVendor = vendors.find((v) => v.merchantId === me.uid || v.userId === me.uid || v.id === me.uid);

    if (!myVendor || myVendor.status === "pending_setup" || !myVendor.active) {
      showStoreSetup(myVendor ? myVendor.id : me.uid, me);
      return;
    }

    state.vendorId = myVendor.id;
    await BW.loadVendorProducts(state.vendorId);
    BW.joinVendorRoom(state.vendorId);

    // Seed with orders already on-screen so we only alarm on genuinely new ones
    _seenOrderIds = new Set(
      BW.orders({ vendorId: state.vendorId, status: S.PLACED }).map((o) => o.id)
    );
    if (window.Buzzer && window.Buzzer.requestNotify) window.Buzzer.requestNotify();
    BW.subscribe(() => { checkNewOrders(); render(); });
    render();
  }

  /* ----- new-order alarm (buzzer + system notification) ----- */
  function checkNewOrders() {
    const placed = BW.orders({ vendorId: state.vendorId, status: S.PLACED });
    const fresh = placed.filter((o) => !_seenOrderIds.has(o.id));
    if (!fresh.length) return;
    fresh.forEach((o) => _seenOrderIds.add(o.id));
    const o = fresh[0];
    const label = "#" + (o.orderNo || o.id.slice(-6).toUpperCase());
    if (window.Buzzer) window.Buzzer.alert("New order " + label, placed.length + " order(s) waiting to accept — tap to open");
    toast("🔔 New order received — " + placed.length + " waiting to accept");
  }

  function showStoreSetup(vendorId, me) {
    root.innerHTML = "";
    root.appendChild(topbar("Welcome, " + (me ? me.name : ""), [
      el("button", { class: "btn ghost sm", onClick: () => BW.logout() }, "Sign out"),
    ]));

    const nameEl = el("input", { placeholder: "e.g. Ravi Kirana Store", style: "font-size:16px" });
    const descEl = el("textarea", { placeholder: "Short description customers see (e.g. Fresh groceries, daily essentials & home delivery)", style: "min-height:60px" });
    const catEl  = el("select", { style: "font-size:16px" });
    CATEGORY_OPTIONS.forEach((c) => catEl.appendChild(el("option", { value: c.value }, c.label)));
    const areaEl = el("input", { placeholder: "e.g. Dwaraka Nagar, Vizag" });
    const errEl  = el("div", { class: "auth-err", style: "margin-top:8px" });

    let _lat = null, _lng = null, _mapsUrl = null;
    const gpsStatus = el("span", { class: "muted small" });
    const gpsBtn = el("button", { class: "btn ghost sm", type: "button" }, "Use my location");
    gpsBtn.addEventListener("click", () => {
      if (!navigator.geolocation) { gpsStatus.textContent = "GPS not supported"; return; }
      gpsBtn.disabled = true; gpsStatus.textContent = "Locating...";
      navigator.geolocation.getCurrentPosition(
        (p) => { _lat = p.coords.latitude; _lng = p.coords.longitude; gpsStatus.textContent = `${_lat.toFixed(4)}, ${_lng.toFixed(4)}`; gpsBtn.disabled = false; },
        ()  => { gpsStatus.textContent = "Unavailable"; gpsBtn.disabled = false; },
        { enableHighAccuracy: true, timeout: 12000 }
      );
    });

    const saveBtn = el("button", { class: "btn primary", style: "width:100%;padding:14px;font-size:16px;margin-top:8px" }, "Save & Open My Store");
    saveBtn.addEventListener("click", async () => {
      errEl.textContent = "";
      if (!nameEl.value.trim()) { errEl.textContent = "Store name is required."; return; }
      if (!areaEl.value.trim()) { errEl.textContent = "Area / locality is required."; return; }
      saveBtn.disabled = true; saveBtn.textContent = "Saving...";
      try {
        await BW.upsertVendor({
          id: vendorId,
          name: nameEl.value.trim(),
          description: descEl.value.trim(),
          category: catEl.value,
          area: areaEl.value.trim(),
          lat: _lat,
          lng: _lng,
          mapsUrl: _mapsUrl,
          active: true,
          status: "active",
        });
        await BW.init("merchant");
        state.vendorId = vendorId;
        await BW.loadVendorProducts(state.vendorId);
        BW.joinVendorRoom(state.vendorId);
        BW.subscribe(() => render());
        go("inventory");
      } catch (err) {
        errEl.textContent = err.message || "Failed to save. Please try again.";
        saveBtn.disabled = false; saveBtn.textContent = "Save & Open My Store";
      }
    });

    root.appendChild(el("div", { class: "content", style: "max-width:520px;margin:0 auto;padding:32px 20px" }, [
      el("h2", { style: "margin:0 0 6px" }, "Set up your store"),
      el("p", { class: "muted", style: "margin:0 0 28px" }, "Fill in your store details. You can update these any time from your profile."),
      el("div", { class: "card" }, [
        el("div", { class: "field" }, [el("label", {}, "Store name"), nameEl]),
        el("div", { class: "field" }, [el("label", {}, "Store description"), descEl]),
        el("div", { class: "field" }, [el("label", {}, "Category"), catEl]),
        el("div", { class: "field" }, [el("label", {}, "Area / locality"), areaEl]),
        el("div", { class: "field" }, [
          el("label", {}, "Store location"),
          el("div", { style: "display:flex;align-items:center;gap:10px;margin-bottom:8px" }, [gpsBtn, gpsStatus]),
          el("div", { class: "muted small", style: "margin-bottom:4px" }, "…or paste your shop's Google Maps link (the Saradhi navigates here)"),
          UI.mapsLinkField({ onResolved: (la, ln, url) => { _mapsUrl = url; if (la != null) { _lat = la; _lng = ln; gpsStatus.textContent = "📍 " + la.toFixed(4) + ", " + ln.toFixed(4); } } }),
        ]),
        errEl,
        saveBtn,
      ]),
    ]));
  }

  function go(route, extra = {}) {
    Object.assign(state, { route }, extra);
    window.scrollTo(0, 0);
    render();
  }

  function shell(active, body) {
    root.innerHTML = "";
    const user = BW.Auth.getUser();

    const logoutBtn = el("button", { class: "btn ghost sm", onClick: () => BW.logout() }, "Sign out");
    root.appendChild(topbar("Merchant · " + (user ? user.name : ""), [logoutBtn]));

    const pending = BW.orders({ vendorId: state.vendorId, status: S.PLACED }).length;
    const nav = el("div", { class: "sidebar" }, [
      navItem("orders",    "Orders",    pending),
      navItem("inventory", "Inventory"),
      navItem("analytics", "Analytics"),
      navItem("profile",   "Store"),
    ]);

    root.appendChild(el("div", { class: "app" }, [nav, el("div", { class: "content" }, body)]));

    // Bottom nav (mobile only)
    root.appendChild(el("div", { class: "bottom-nav" }, [
      bnItem("orders",    "Or", "Orders",    pending || null),
      bnItem("inventory", "In", "Inventory"),
      bnItem("analytics", "An", "Analytics"),
      bnItem("profile",   "St", "Store"),
    ]));

    function navItem(route, label, count) {
      return el("div", { class: "nav-item" + (active === route ? " active" : ""), onClick: () => go(route) }, [
        el("span", { style: "flex:1" }, label),
        count ? el("span", { class: "badge PLACED" }, String(count)) : document.createTextNode(""),
      ]);
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

  /* ====================== ORDERS ====================== */
  function viewOrders() {
    const vendor = BW.vendor(state.vendorId);
    const orders = BW.orders({ vendorId: state.vendorId });
    const groups = [
      { key: "New",         statuses: [S.PLACED] },
      { key: "In progress", statuses: [S.ACCEPTED, S.ASSIGNED, S.PICKED_UP, S.OUT_FOR_DELIVERY] },
      { key: "Completed",   statuses: [S.DELIVERED, S.CANCELLED] },
    ];

    const cols = el("div", { class: "grid cols-3" });
    groups.forEach((g) => {
      const list = orders.filter((o) => g.statuses.includes(o.status));
      const col = el("div", {}, [
        el("div", { class: "row between", style: "margin-bottom:10px" }, [
          el("strong", {}, g.key), el("span", { class: "tag" }, String(list.length)),
        ]),
      ]);
      if (!list.length) col.appendChild(el("div", { class: "muted small", style: "padding:10px 0" }, "—"));
      list.forEach((o) => col.appendChild(orderCard(o)));
      cols.appendChild(col);
    });

    shell("orders", [
      el("h1", { class: "page-title" }, "Orders"),
      el("p", { class: "page-sub" }, (vendor ? vendor.name : "") + " · accept new orders, then dispatch a rider."),
      cols,
    ]);
  }

  function orderCard(o) {
    const cust = BW.customers().find((c) => c.id === o.customerId);
    const itemCount = o.items.reduce((s, l) => s + l.qty, 0);
    const actions = [];

    if (o.status === S.PLACED) {
      actions.push(el("button", { class: "btn primary sm", onClick: async (e) => {
        e.stopPropagation();
        try { await BW.setOrderStatus(o.id, S.ACCEPTED); toast("Order accepted"); }
        catch (err) { toast("Error: " + err.message); }
      } }, "Accept"));
      actions.push(el("button", { class: "btn danger sm", onClick: async (e) => {
        e.stopPropagation();
        try { await BW.setOrderStatus(o.id, S.CANCELLED); }
        catch (err) { toast("Error: " + err.message); }
      } }, "Reject"));
    } else if (o.status === S.ACCEPTED) {
      actions.push(el("button", { class: "btn accent sm", onClick: async (e) => { e.stopPropagation(); await autoDispatch(o); } }, "Dispatch rider"));
    }

    const riderName = o.riderId ? (BW.riders().find((r) => r.id === o.riderId) || {}).name : null;

    return el("div", { class: "card", style: "margin-bottom:12px;cursor:pointer", onClick: () => openOrderDetail(o.id) }, [
      el("div", { class: "row between" }, [
        el("strong", {}, "#" + (o.orderNo || o.id.slice(-6).toUpperCase())),
        statusBadge(o.status),
      ]),
      el("div", { class: "muted small", style: "margin:6px 0" }, (cust ? cust.name : "Customer") + " · " + itemCount + " items · " + money(o.total)),
      el("div", { class: "small muted" }, o.items.map((l) => l.qty + "× " + l.name).join(", ")),
      riderName ? el("div", { class: "small muted", style: "margin-top:6px" }, "Rider: " + riderName) : document.createTextNode(""),
      actions.length ? el("div", { class: "row", style: "gap:8px;margin-top:10px" }, actions) : document.createTextNode(""),
    ]);
  }

  function openOrderDetail(orderId) {
    const o = BW.order(orderId);
    if (!o) return;
    const cust = BW.customers().find((c) => c.id === o.customerId);
    const body = el("div", {}, [
      tracker(o.status),
      el("div", { class: "card", style: "margin-top:12px" }, [
        ...o.items.map((l) => el("div", { class: "row between small", style: "padding:5px 0" }, [
          el("span", {}, l.qty + "× " + l.name), el("span", { class: "muted" }, money(l.price * l.qty)),
        ])),
        el("div", { class: "line", style: "border:none" }, [el("strong", {}, "Total"), el("strong", {}, money(o.total))]),
      ]),
      cust ? el("div", { class: "muted small", style: "margin-top:10px" }, "Customer: " + cust.name + " · " + (cust.phone || "")) : document.createTextNode(""),
      cust ? el("div", { class: "muted small" }, "Deliver to: " + cust.address) : document.createTextNode(""),
      el("div", { class: "card", style: "margin-top:12px" }, [
        el("strong", { class: "small" }, "Timeline"),
        ...(o.history || []).map((h) => el("div", { class: "row between small muted", style: "padding:4px 0" }, [
          el("span", {}, BW.STATUS_LABEL[h.status] + (h.note ? " — " + h.note : "")),
          el("span", {}, clockTime(h.at)),
        ])),
      ]),
    ]);
    // The merchant's actions end at dispatch. Accept from the PLACED card; dispatch a
    // rider once ACCEPTED. After a rider is assigned, pickup & delivery belong to the
    // Saradhi — the merchant only monitors here.
    const footer = [];
    if (o.status === S.PLACED) {
      footer.push(el("button", { class: "btn primary", onClick: async () => {
        try { await BW.setOrderStatus(o.id, S.ACCEPTED); toast("Order accepted"); close(); }
        catch (err) { toast("Error: " + err.message); }
      } }, "Accept order"));
    } else if (o.status === S.ACCEPTED && !o.riderId) {
      footer.push(el("button", { class: "btn accent", onClick: async () => {
        try { await autoDispatch(o); close(); } catch (err) { toast("Error: " + err.message); }
      } }, "Dispatch rider"));
    } else if (![S.DELIVERED, S.CANCELLED].includes(o.status)) {
      footer.push(el("div", { class: "muted small", style: "padding:4px 2px" },
        "Rider is handling pickup & delivery — track progress in the timeline above."));
    }
    const close = UI.modal({ title: "Order #" + (o.orderNo || o.id.slice(-6).toUpperCase()), body, footer });
  }

  /* ====================== DISPATCH ====================== */
  // Auto-assigns the nearest available fleet rider — no manual selection
  async function autoDispatch(order) {
    try {
      const { rider } = await BW.autoAssignRider(order.id);
      const distTxt = isFinite(rider.dist) ? " · " + rider.dist.toFixed(1) + " km away" : "";
      toast("Rider assigned: " + rider.name + distTxt);
    } catch (err) {
      toast(err.message || "No available riders right now");
    }
  }

  function viewDispatch() {
    const vendor = BW.vendor(state.vendorId);
    if (!vendor) { shell("dispatch", [el("div", { class: "muted" }, "No vendor selected.")]); return; }

    const active = BW.orders({ vendorId: state.vendorId }).filter(
      (o) => ![S.DELIVERED, S.CANCELLED].includes(o.status)
    );

    // Build markers (store + active riders) for a real map when a key is set
    const gmMarkers = [];
    if (vendor.lat && vendor.lng) gmMarkers.push({ lat: vendor.lat, lng: vendor.lng, label: vendor.name });
    active.forEach((o) => {
      if (o.riderId) { const r = BW.riders().find((r) => r.id === o.riderId); if (r && r.lat) gmMarkers.push({ lat: r.lat, lng: r.lng, label: r.name, icon: "chariot" }); }
    });
    let map = UI.gmap ? UI.gmap({ markers: gmMarkers, height: 360 }) : null;
    if (!map) {
      map = el("div", { class: "map", style: "height:360px" });
      const addPin = (lat, lng, head, lbl) => {
        if (!lat || !lng) return;
        const { x, y } = project(lat, lng);
        map.appendChild(el("div", { class: "pin", style: `left:${x}%;top:${y}%` }, [
          el("div", { class: "head" }, head), el("div", { class: "lbl small" }, lbl),
        ]));
      };
      addPin(vendor.lat, vendor.lng, "M", vendor.name.split(" ")[0]);
      active.forEach((o) => {
        if (o.riderId) { const r = BW.riders().find((r) => r.id === o.riderId); if (r) addPin(r.lat, r.lng, "R", r.name.split(" ")[0]); }
      });
    }

    const rows = active.length ? active.map((o) => {
      const cust = BW.customers().find((c) => c.id === o.customerId);
      const r = o.riderId ? BW.riders().find((r) => r.id === o.riderId) : null;
      const act = [];
      if (!r && [S.ACCEPTED, S.ASSIGNED].includes(o.status)) {
        act.push(el("button", { class: "btn accent sm", onClick: async () => {
          try { const { rider } = await BW.autoAssignRider(o.id); toast("Assigned to " + rider.name); }
          catch (err) { toast(err.message || "No available riders"); }
        } }, "Auto-assign"));
      } else if (r && ![S.DELIVERED, S.CANCELLED].includes(o.status)) {
        // Rider assigned — pickup & delivery are the Saradhi's to advance, not the merchant's.
        act.push(el("span", { class: "muted small" }, "Rider en route"));
      }
      return el("tr", {}, [
        el("td", {}, el("strong", {}, "#" + (o.orderNo || o.id.slice(-6).toUpperCase()))),
        el("td", {}, cust ? cust.name : "—"),
        el("td", {}, statusBadge(o.status)),
        el("td", {}, r ? r.name : el("span", { class: "muted" }, "—")),
        el("td", {}, el("div", { class: "row", style: "gap:6px" }, act)),
      ]);
    }) : [el("tr", {}, el("td", { colspan: "5", class: "muted", style: "text-align:center;padding:24px" }, "No active deliveries."))];

    shell("dispatch", [
      el("h1", { class: "page-title" }, "Live Dispatch"),
      el("p", { class: "page-sub" }, "Fleet riders are auto-assigned by proximity. Monitor live deliveries here."),
      el("div", { class: "grid cols-2" }, [
        el("div", { class: "card" }, [el("h3", { style: "margin-top:0" }, "Map"), map]),
        el("div", { class: "card", style: "padding:0;overflow:hidden" }, [
          el("table", {}, [
            el("thead", {}, el("tr", {}, ["Order", "Customer", "Status", "Rider", ""].map((h) => el("th", {}, h)))),
            el("tbody", {}, rows),
          ]),
        ]),
      ]),
    ]);
  }

  /* ====================== INVENTORY ====================== */
  function viewInventory() {
    const vendor = BW.vendor(state.vendorId);
    const allProducts = () => BW.products(state.vendorId);

    // Unit / stock sub-line per item.
    function metaLine(p) {
      const bits = [];
      if (p.unit) bits.push("per " + p.unit);
      if (p.qty !== undefined && p.qty !== null) bits.push(p.qty + " in stock");
      return bits.join(" · ");
    }

    function priceNode(p) {
      if (p.mrp && p.mrp > p.price) {
        return el("div", { style: "display:flex;align-items:center;gap:6px;flex-wrap:wrap" }, [
          el("strong", {}, money(p.price)),
          el("span", { style: "text-decoration:line-through;color:var(--muted);font-size:12px" }, money(p.mrp)),
          el("span", { style: "background:#e6f4ea;color:#1a7f37;font-size:11px;font-weight:700;padding:1px 6px;border-radius:6px" }, Math.round((1 - p.price / p.mrp) * 100) + "% OFF"),
        ]);
      }
      return el("strong", {}, p.price ? money(p.price) : "—");
    }

    async function toggleStock(p) {
      try { await BW.upsertProduct({ id: p.id, vendorId: state.vendorId, available: p.available === false }); toast(p.available === false ? "Back in stock" : "Marked out of stock"); }
      catch (e) { toast("Error: " + e.message); }
    }

    function itemCard(p) {
      const out = p.available === false;
      const thumb = p.photoUrl
        ? el("div", { style: "width:48px;height:48px;border-radius:10px;overflow:hidden;flex:none" }, el("img", { src: p.photoUrl, alt: "", style: "width:100%;height:100%;object-fit:cover" }))
        : el("div", { style: "width:48px;height:48px;border-radius:10px;flex:none;background:var(--surface-2);display:flex;align-items:center;justify-content:center;font-size:20px" }, (vendor && vendor.img) || "🛍");
      return el("div", { class: "card", style: "display:flex;gap:12px;align-items:center;margin-bottom:8px;padding:10px 12px" + (out ? ";opacity:.6" : "") }, [
        thumb,
        el("div", { style: "flex:1;min-width:0" }, [
          el("div", { style: "font-weight:700;display:flex;align-items:center;gap:6px" }, [
            el("span", { style: "overflow:hidden;text-overflow:ellipsis;white-space:nowrap" }, p.name),
            out ? el("span", { style: "background:#fdeaea;color:#c0392b;font-size:10px;font-weight:700;padding:1px 6px;border-radius:6px;flex:none" }, "OUT OF STOCK") : document.createTextNode(""),
          ]),
          priceNode(p),
          metaLine(p) ? el("div", { class: "muted small" }, metaLine(p)) : document.createTextNode(""),
        ]),
        el("div", { style: "display:flex;flex-direction:column;gap:6px;flex:none" }, [
          el("button", { class: "btn " + (out ? "success" : "ghost") + " sm", onClick: () => toggleStock(p) }, out ? "In stock" : "Out of stock"),
          el("div", { style: "display:flex;gap:6px" }, [
            el("button", { class: "btn ghost sm", onClick: () => editProduct(p) }, "Edit"),
            el("button", { class: "btn danger sm", onClick: async () => { if (confirm("Delete " + p.name + "?")) { try { await BW.deleteProduct(state.vendorId, p.id); toast("Deleted"); } catch (e) { toast("Error: " + e.message); } } } }, "✕"),
          ]),
        ]),
      ]);
    }

    const listWrap = el("div", {});
    function renderRows() {
      const q = (state.invSearch || "").toLowerCase().trim();
      const list = allProducts().filter((p) => !q || (p.name || "").toLowerCase().includes(q));
      listWrap.innerHTML = "";
      if (!list.length) {
        listWrap.appendChild(el("div", { class: "muted", style: "text-align:center;padding:24px" }, allProducts().length ? "No items match your search." : "No items yet — tap “+ Add items” to get started."));
        return;
      }
      list.forEach((p) => listWrap.appendChild(itemCard(p)));
    }

    const search = el("input", { placeholder: "Search your items…", value: state.invSearch || "" });
    search.addEventListener("input", (e) => { state.invSearch = e.target.value; renderRows(); });

    const total = allProducts().length;
    const outCount = allProducts().filter((p) => p.available === false).length;
    const chip = (label, val, danger) => el("div", { class: "card", style: "flex:1;text-align:center;padding:10px" }, [
      el("div", { style: "font-size:20px;font-weight:800;color:" + (danger && val > 0 ? "var(--red)" : "var(--text)") }, String(val)),
      el("div", { class: "muted small" }, label),
    ]);

    shell("inventory", [
      el("div", { class: "row between", style: "align-items:center" }, [
        el("div", {}, [
          el("h1", { class: "page-title" }, "Inventory"),
          el("p", { class: "page-sub" }, (vendor ? vendor.name : "") + " · manage your items"),
        ]),
        el("button", { class: "btn primary", onClick: () => editProduct(null, true) }, "+ Add items"),
      ]),
      el("div", { style: "display:flex;gap:10px;margin-bottom:12px" }, [
        chip("Total items", total),
        chip("In stock", total - outCount),
        chip("Out of stock", outCount, true),
      ]),
      el("div", { class: "field", style: "margin-bottom:12px" }, [search]),
      listWrap,
    ]);
    renderRows();
  }

  function resizeImage(file, maxDim, quality) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        let w = img.width, h = img.height;
        if (w >= h && w > maxDim) { h = Math.round(h * maxDim / w); w = maxDim; }
        else if (h > maxDim) { w = Math.round(w * maxDim / h); h = maxDim; }
        const c = document.createElement("canvas"); c.width = w; c.height = h;
        c.getContext("2d").drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL("image/jpeg", quality || 0.7));
      };
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }

  async function uploadToCloudinary(dataUrl) {
    const cfg = (BW.config && BW.config()) || {};
    const cloud = cfg.cloudinaryCloud, preset = cfg.cloudinaryPreset;
    if (!cloud || !preset) throw new Error("Image uploads aren't set up yet");
    const fd = new FormData();
    fd.append("file", dataUrl);
    fd.append("upload_preset", preset);
    const r = await fetch("https://api.cloudinary.com/v1_1/" + cloud + "/image/upload", { method: "POST", body: fd });
    const d = await r.json();
    if (!d.secure_url) throw new Error((d.error && d.error.message) || "Upload failed");
    return d.secure_url;
  }

  function editProduct(p, quickAdd) {
    const vendor  = BW.vendor(state.vendorId);
    const food    = isFoodVendor(vendor);
    const pharma  = isPharmacyVendor(vendor);
    const general = isGeneralVendor(vendor);
    const isNew   = !p;
    let addedCount = 0;

    const namePlaceholder = pharma  ? "e.g. Paracetamol, Cough Syrup, Vitamin C…"
                          : general ? "e.g. Toor Dal, Surf Excel, Colgate…"
                          :           "e.g. Masala Dosa, Cold Coffee…";

    const nameEl  = el("input", { value: p ? p.name : "", placeholder: namePlaceholder });
    const priceEl = el("input", { type: "number", value: p ? p.price : "", placeholder: "0", min: "0" });
    const mrpEl   = el("input", { type: "number", value: p && p.mrp ? p.mrp : "", placeholder: "optional", min: "0" });

    const fields = [
      el("div", { class: "field" }, [el("label", {}, "Item name"), nameEl]),
    ];

    /* — per-category extra fields — */
    let packQtyEl, unitEl, stockEl, qtyEl;

    if (pharma) {
      /* Pharmacy: pack qty + unit type (e.g. "10 tablets/strip", "100 ml") */
      packQtyEl = el("input", {
        type: "number",
        value: p && p.qty !== undefined ? p.qty : "",
        placeholder: "e.g. 10",
        min: "0",
        style: "width:90px;flex:0 0 90px",
      });
      unitEl = el("select", {});
      PHARMACY_UNITS.forEach((u) =>
        unitEl.appendChild(el("option", { value: u.value, ...(p && p.unit === u.value ? { selected: "" } : {}) }, u.label))
      );
      fields.push(el("div", { class: "field" }, [el("label", {}, "Price (₹)"), priceEl]));
      fields.push(el("div", { class: "field" }, [
        el("label", {}, "Pack size"),
        el("div", { class: "row", style: "gap:8px;align-items:center" }, [packQtyEl, unitEl]),
        el("div", { class: "muted small", style: "margin-top:4px" },
          "e.g. 10 tablets/strip · 100 ml · 30 capsules · 15 g cream"),
      ]));

    } else if (general) {
      /* General / Grocery: "Price per [unit]" + optional stock qty */
      unitEl = el("select", {});
      GENERAL_UNITS.forEach((u) =>
        unitEl.appendChild(el("option", { value: u.value, ...(p && p.unit === u.value ? { selected: "" } : {}) }, u.label))
      );
      stockEl = el("input", {
        type: "number",
        value: p && p.qty !== undefined ? p.qty : "",
        placeholder: "optional",
        min: "0",
      });
      fields.push(el("div", { class: "field" }, [
        el("label", {}, "Price (₹) — sold per"),
        el("div", { class: "row", style: "gap:8px;align-items:center" }, [priceEl, unitEl]),
      ]));
      fields.push(el("div", { class: "field" }, [
        el("label", {}, "Stock qty (optional)"),
        stockEl,
      ]));

    } else {
      /* Food + everything else: price + optional qty-available */
      fields.push(el("div", { class: "field" }, [el("label", {}, "Price (₹)"), priceEl]));
      if (food) {
        qtyEl = el("input", {
          type: "number",
          value: p && p.qty !== undefined ? p.qty : "",
          placeholder: "e.g. 20",
          min: "0",
        });
        fields.push(el("div", { class: "field" }, [el("label", {}, "Quantity available"), qtyEl]));
      }
    }

    // MRP for a strike-through discount (shown to customers when higher than the sale price).
    fields.push(el("div", { class: "field" }, [
      el("label", {}, "MRP (₹) — for discount, optional"),
      mrpEl,
      el("div", { class: "muted small", style: "margin-top:4px" }, "Set higher than the price above to show customers a struck-through MRP and a % off."),
    ]));

    let photoData = null;
    const photoPreview = el("div", { class: "prod-photo-prev" }, (p && p.photoUrl) ? el("img", { src: p.photoUrl, alt: "" }) : document.createTextNode("📷"));
    const fileEl = el("input", { type: "file", accept: "image/*", style: "display:none" });
    fileEl.addEventListener("change", async () => {
      const f = fileEl.files && fileEl.files[0]; if (!f) return;
      try {
        photoData = await resizeImage(f, 720, 0.72);
        photoPreview.innerHTML = ""; photoPreview.appendChild(el("img", { src: photoData, alt: "" }));
      } catch (e) { toast("Couldn't read that image"); }
    });
    fields.push(el("div", { class: "field" }, [
      el("label", {}, "Photo (optional)"),
      el("div", { class: "row", style: "gap:12px;align-items:center" }, [
        photoPreview,
        el("button", { class: "btn ghost sm", type: "button", onClick: () => fileEl.click() }, "Upload photo"),
        fileEl,
      ]),
    ]));

    // In quick-add mode, adding one item keeps the form open (reset) so the
    // merchant can add many items in a row — much faster to stock a store.
    const counter = el("div", { class: "muted small", style: "text-align:center;margin-bottom:6px;display:none" });

    async function saveItem(keepOpen) {
      if (!nameEl.value.trim()) { toast("Item name is required"); return; }
      try {
        const payload = {
          id: p ? p.id : undefined,
          vendorId: state.vendorId,
          name: nameEl.value.trim(),
          price: priceEl.value ? Number(priceEl.value) : 0,
          mrp: mrpEl.value ? Number(mrpEl.value) : null,
        };
        if (pharma) { payload.unit = unitEl.value; if (packQtyEl.value !== "") payload.qty = Number(packQtyEl.value); }
        else if (general) { payload.unit = unitEl.value || "piece"; if (stockEl.value !== "") payload.qty = Number(stockEl.value); }
        else if (food && qtyEl && qtyEl.value !== "") { payload.qty = Number(qtyEl.value); }
        if (photoData) { try { payload.photoUrl = await uploadToCloudinary(photoData); } catch (e) { toast("Photo upload failed: " + (e.message || "")); } }
        else if (p && p.photoUrl) { payload.photoUrl = p.photoUrl; }
        await BW.upsertProduct(payload);
        if (keepOpen && isNew) {
          addedCount++;
          toast("Added ✓ — add the next one");
          counter.style.display = ""; counter.textContent = addedCount + " item" + (addedCount === 1 ? "" : "s") + " added this session";
          nameEl.value = ""; priceEl.value = ""; mrpEl.value = "";
          if (packQtyEl) packQtyEl.value = ""; if (stockEl) stockEl.value = ""; if (qtyEl) qtyEl.value = "";
          photoData = null; photoPreview.innerHTML = ""; photoPreview.appendChild(document.createTextNode("📷"));
          nameEl.focus();
        } else {
          toast(isNew ? "Item added" : "Item updated");
          close();
        }
      } catch (err) { toast("Error: " + err.message); }
    }

    const footer = isNew
      ? [
          el("button", { class: "btn ghost", onClick: () => close() }, "Done"),
          el("button", { class: "btn accent", onClick: () => saveItem(true) }, "Save & add another"),
          el("button", { class: "btn primary", onClick: () => saveItem(false) }, "Save & close"),
        ]
      : [
          el("button", { class: "btn ghost", onClick: () => close() }, "Cancel"),
          el("button", { class: "btn primary", onClick: () => saveItem(false) }, "Save"),
        ];

    const close = UI.modal({
      title: isNew ? "Add items" : "Edit item",
      body: el("div", {}, [counter].concat(fields)),
      footer: footer,
    });
  }

  /* ====================== CUSTOMERS ====================== */
  function viewCustomers() {
    const orders = BW.orders({ vendorId: state.vendorId });
    const map = {};
    orders.forEach((o) => {
      const c = BW.customers().find((c) => c.id === o.customerId);
      if (!c) return;
      if (!map[c.id]) map[c.id] = { c, orders: 0, spend: 0, last: o.createdAt };
      map[c.id].orders += 1;
      map[c.id].spend  += o.total;
      if (new Date(o.createdAt) > new Date(map[c.id].last)) map[c.id].last = o.createdAt;
    });
    const list = Object.values(map).sort((a, b) => b.spend - a.spend);

    const rows = list.length ? list.map((x) => el("tr", {}, [
      el("td", {}, el("strong", {}, x.c.name)),
      el("td", { class: "muted" }, x.c.phone || "—"),
      el("td", {}, String(x.orders)),
      el("td", {}, money(x.spend)),
      el("td", { class: "muted small" }, timeAgo(x.last)),
    ])) : [el("tr", {}, el("td", { colspan: "5", class: "muted", style: "text-align:center;padding:24px" }, "No customers yet."))];

    shell("customers", [
      el("h1", { class: "page-title" }, "Customers"),
      el("p", { class: "page-sub" }, "People who have ordered from you, ranked by spend."),
      el("div", { class: "card", style: "padding:0;overflow:hidden" }, [
        el("table", {}, [
          el("thead", {}, el("tr", {}, ["Customer", "Phone", "Orders", "Total spend", "Last order"].map((h) => el("th", {}, h)))),
          el("tbody", {}, rows),
        ]),
      ]),
    ]);
  }

  /* ----- geo ----- */
  function haversine(la1, lo1, la2, lo2) {
    if (!la1 || !lo1 || !la2 || !lo2) return Infinity;
    const R = 6371, toR = (d) => (d * Math.PI) / 180;
    const dLa = toR(la2 - la1), dLo = toR(lo2 - lo1);
    const a = Math.sin(dLa / 2) ** 2 + Math.cos(toR(la1)) * Math.cos(toR(la2)) * Math.sin(dLo / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /* ====================== QR CODE ====================== */
  function viewQR() {
    const vendor = BW.vendor(state.vendorId);
    if (!vendor) { shell("qr", [el("p", { class: "muted" }, "Select a vendor first.")]); return; }

    const scanUrl = window.location.origin + "/scan/?v=" + vendor.id;
    const qrSrc = "https://api.qrserver.com/v1/create-qr-code/?size=260x260&ecc=M&format=png&data=" + encodeURIComponent(scanUrl);

    const body = [
      el("h1", { class: "page-title" }, "My QR Code"),
      el("p", { class: "page-sub" }, "Display this QR at your store. Customers scan once to unlock your services."),

      el("div", { style: "max-width:400px;margin:0 auto" }, [
        el("div", { style: "background:#fff;border:1px solid #ffe0c8;border-radius:16px;padding:24px;text-align:center;margin-bottom:20px;box-shadow:0 2px 12px rgba(240,120,48,0.08)" }, [
          el("img", { src: qrSrc, width: "220", height: "220", alt: "QR Code", style: "display:block;margin:0 auto 16px;border-radius:8px" }),
          el("div", { style: "font-size:18px;font-weight:700;color:#1a1a24;margin-bottom:4px" }, vendor.name),
          el("div", { style: "font-size:12px;color:#999;word-break:break-all" }, scanUrl),
        ]),

        el("div", { style: "background:#fff9f5;border:1px solid #ffe0c8;border-radius:12px;padding:20px;margin-bottom:16px" }, [
          el("h3", { style: "margin:0 0 14px;font-size:14px;color:#f07830" }, "How it works"),
          ...[
            ["1.", "Customer scans QR code with their phone"],
            ["2.", "First-time? They install the app — your store loads automatically"],
            ["3.", "Returning? Your store is added to their existing app"],
            ["4.", "They can collect stores from multiple merchants over time"],
          ].map(([num, text]) =>
            el("div", { style: "display:flex;gap:12px;margin-bottom:10px;font-size:13px;color:#555;align-items:flex-start" }, [
              el("span", { style: "font-weight:700;color:#f07830;min-width:16px" }, num),
              el("span", {}, text),
            ])
          ),
        ]),

        el("a", {
          href: qrSrc,
          download: vendor.name.replace(/\s+/g, "_") + "_QR.png",
          target: "_blank",
          class: "btn primary",
          style: "display:block;text-align:center;text-decoration:none;padding:14px;border-radius:10px;font-weight:600;margin-bottom:10px",
        }, "Download QR Image"),

        el("button", {
          class: "btn",
          style: "display:block;width:100%;padding:14px;border-radius:10px;font-weight:600;cursor:pointer",
          onClick: () => { navigator.clipboard?.writeText(scanUrl).then(() => toast("Link copied!")); },
        }, "Copy Scan Link"),
      ]),
    ];

    shell("qr", body);
  }

  /* ====================== ANALYTICS ====================== */
  function viewAnalytics() {
    const period = viewAnalytics._period || "7d";
    const orders = BW.orders({ vendorId: state.vendorId });
    const now = Date.now();
    const startToday = new Date(new Date().toDateString()).getTime();
    const cutoff = period === "today" ? startToday : period === "30d" ? now - 30 * 864e5 : now - 7 * 864e5;
    const inRange = orders.filter((o) => new Date(o.createdAt).getTime() >= cutoff);
    const nonCancelled = inRange.filter((o) => o.status !== "CANCELLED");
    const delivered = inRange.filter((o) => o.status === "DELIVERED");
    const cod = nonCancelled.filter((o) => o.paymentMethod !== "ONLINE");
    const online = nonCancelled.filter((o) => o.paymentMethod === "ONLINE");
    const revenue = nonCancelled.reduce((s, o) => s + (o.total || 0), 0);
    const codRev = cod.reduce((s, o) => s + (o.total || 0), 0);
    const onlineRev = online.reduce((s, o) => s + (o.total || 0), 0);
    const aov = nonCancelled.length ? revenue / nonCancelled.length : 0;

    const periodBtn = (id, label) => el("button", {
      class: "btn " + (period === id ? "primary sm" : "ghost sm"),
      onClick: () => { viewAnalytics._period = id; render(); },
    }, label);
    const stat = (k, v, d) => el("div", { class: "card stat" }, [el("span", { class: "k" }, k), el("span", { class: "v" }, v), d ? el("span", { class: "d" }, d) : document.createTextNode("")]);
    const kv = (k, v) => el("div", { class: "row between", style: "padding:7px 0;border-bottom:0.5px solid var(--border)" }, [el("span", { class: "muted" }, k), el("strong", {}, v)]);
    const payRow = (label, count, rev, total) => {
      const pct = total ? Math.round((rev / total) * 100) : 0;
      return el("div", { style: "margin-bottom:14px" }, [
        el("div", { class: "row between small", style: "margin-bottom:4px" }, [
          el("span", {}, label + " · " + count + " order" + (count === 1 ? "" : "s")),
          el("strong", {}, money(Math.round(rev)) + " · " + pct + "%"),
        ]),
        el("div", { style: "height:12px;background:var(--surface-2);border-radius:999px;overflow:hidden" }, [
          el("div", { style: "height:100%;width:" + pct + "%;background:linear-gradient(90deg,var(--brand),var(--brand-2))" }),
        ]),
      ]);
    };

    shell("analytics", [
      el("h1", { class: "page-title" }, "Analytics"),
      el("p", { class: "page-sub" }, "Your store's sales and payment breakdown."),
      el("div", { style: "display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap" }, [
        periodBtn("today", "Today"), periodBtn("7d", "This week"), periodBtn("30d", "This month"),
      ]),
      el("div", { class: "grid cols-4" }, [
        stat("Revenue", money(Math.round(revenue)), nonCancelled.length + " orders"),
        stat("Delivered", String(delivered.length), ""),
        stat("Avg order", money(Math.round(aov)), ""),
        stat("Cancelled", String(inRange.length - nonCancelled.length), ""),
      ]),
      el("div", { class: "grid cols-2", style: "margin-top:16px" }, [
        el("div", { class: "card" }, [
          el("h3", { style: "margin-top:0" }, "Payment method"),
          payRow("Cash on delivery", cod.length, codRev, revenue),
          payRow("Online (UPI / Card)", online.length, onlineRev, revenue),
          !nonCancelled.length ? el("div", { class: "muted small" }, "No orders in this period yet.") : document.createTextNode(""),
        ]),
        el("div", { class: "card" }, [
          el("h3", { style: "margin-top:0" }, "Summary"),
          kv("Gross revenue", money(Math.round(revenue))),
          kv("COD collected", money(Math.round(codRev))),
          kv("Online received", money(Math.round(onlineRev))),
          kv("Total orders", String(nonCancelled.length)),
        ]),
      ]),
    ]);
  }
  viewAnalytics._period = "7d";

  /* ====================== STORE PROFILE ====================== */
  function viewStoreProfile() {
    const v = BW.vendor(state.vendorId) || {};
    const nameEl = el("input", { value: v.name || "" });
    const descEl = el("textarea", { value: v.description || "", placeholder: "Short description customers see", style: "min-height:60px" });
    const catEl  = el("select", {});
    CATEGORY_OPTIONS.forEach((c) => catEl.appendChild(el("option", { value: c.value, ...(v.category === c.value ? { selected: "" } : {}) }, c.label)));
    const areaEl = el("input", { value: v.area || "", placeholder: "Area / locality" });
    const ownerPhoneEl = el("input", { type: "tel", value: v.ownerPhone || "", placeholder: "Owner mobile" });
    const bizPhoneEl   = el("input", { type: "tel", value: v.businessPhone || "", placeholder: "Business phone" });
    const prepEl = el("input", { type: "number", value: v.prepMins != null ? v.prepMins : 15, min: "1", placeholder: "15" });
    const discEl = el("input", { type: "number", value: v.storeDiscountPct || 0, min: "0", max: "90", placeholder: "0" });

    // Location: GPS + Google Maps link
    let _lat = v.lat != null ? v.lat : null, _lng = v.lng != null ? v.lng : null, _mapsUrl = v.mapsUrl || null;
    const locStatus = el("span", { class: "muted small" }, (_lat != null) ? ("📍 " + Number(_lat).toFixed(4) + ", " + Number(_lng).toFixed(4)) : (_mapsUrl ? "📍 Maps link saved" : "Not set"));
    const gpsBtn = el("button", { class: "btn ghost sm", type: "button" }, "Use my location");
    gpsBtn.addEventListener("click", () => {
      if (!navigator.geolocation) { locStatus.textContent = "GPS not supported"; return; }
      if (!window.isSecureContext) { locStatus.textContent = "GPS needs https — paste a Maps link instead"; return; }
      gpsBtn.disabled = true; locStatus.textContent = "Locating…";
      navigator.geolocation.getCurrentPosition(
        (p) => { _lat = p.coords.latitude; _lng = p.coords.longitude; locStatus.textContent = "📍 " + _lat.toFixed(4) + ", " + _lng.toFixed(4); gpsBtn.disabled = false; },
        () => { locStatus.textContent = "Couldn't get GPS — paste a Maps link"; gpsBtn.disabled = false; },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    });
    const linkField = UI.mapsLinkField ? UI.mapsLinkField({ value: v.mapsUrl || "", onResolved: (la, ln, url) => { _mapsUrl = url; if (la != null) { _lat = la; _lng = ln; locStatus.textContent = "📍 " + la.toFixed(4) + ", " + ln.toFixed(4); } } }) : document.createTextNode("");

    // Open / closed toggle
    const isOpen = v.active !== false;
    const openBtn = el("button", { class: "btn " + (isOpen ? "success" : "danger") + " sm" }, isOpen ? "🟢 Store is OPEN — tap to close" : "🔴 Store is CLOSED — tap to open");
    openBtn.addEventListener("click", async () => {
      try { await BW.upsertVendor({ id: v.id, active: !isOpen, status: !isOpen ? "active" : "inactive" }); toast(!isOpen ? "Store opened" : "Store closed"); render(); }
      catch (e) { toast("Error: " + e.message); }
    });

    // Pharmacy prescription toggle
    const rxCb = el("input", { type: "checkbox" });
    rxCb.checked = !!v.requiresPrescription;

    const saveBtn = el("button", { class: "btn primary", style: "width:100%;margin-top:8px" }, "Save store details");
    saveBtn.addEventListener("click", async () => {
      if (!nameEl.value.trim()) { toast("Store name is required"); return; }
      saveBtn.disabled = true; saveBtn.textContent = "Saving…";
      try {
        await BW.upsertVendor({
          id: v.id,
          name: nameEl.value.trim(),
          description: descEl.value.trim(),
          category: catEl.value,
          area: areaEl.value.trim(),
          ownerPhone: ownerPhoneEl.value.trim(),
          businessPhone: bizPhoneEl.value.trim(),
          prepMins: Number(prepEl.value) || 15,
          storeDiscountPct: Math.max(0, Math.min(90, Number(discEl.value) || 0)),
          requiresPrescription: rxCb.checked,
          lat: _lat, lng: _lng, mapsUrl: _mapsUrl,
        });
        toast("Store details saved ✓");
        render();
      } catch (e) { toast("Error: " + e.message); saveBtn.disabled = false; saveBtn.textContent = "Save store details"; }
    });

    const fieldRow = (label, node, hint) => el("div", { class: "field" }, [el("label", {}, label), node, hint ? el("div", { class: "muted small", style: "margin-top:4px" }, hint) : document.createTextNode("")]);

    shell("profile", [
      el("h1", { class: "page-title" }, "Store profile"),
      el("p", { class: "page-sub" }, "Update your store details any time. Changes show to customers immediately."),
      el("div", { class: "card", style: "margin-bottom:14px" }, [
        el("div", { style: "font-weight:800;margin-bottom:8px" }, "Availability"),
        openBtn,
        el("div", { class: "muted small", style: "margin-top:6px" }, "Closed stores stay listed but can't take new orders."),
      ]),
      el("div", { class: "card", style: "margin-bottom:14px" }, [
        fieldRow("Store name", nameEl),
        fieldRow("Description", descEl),
        fieldRow("Category", catEl),
        fieldRow("Area / locality", areaEl),
        el("div", { style: "display:flex;gap:10px" }, [
          el("div", { style: "flex:1" }, [fieldRow("Owner phone", ownerPhoneEl)]),
          el("div", { style: "flex:1" }, [fieldRow("Business phone", bizPhoneEl)]),
        ]),
        el("div", { style: "display:flex;gap:10px" }, [
          el("div", { style: "flex:1" }, [fieldRow("Prep time (mins)", prepEl)]),
          el("div", { style: "flex:1" }, [fieldRow("Store-wide discount %", discEl, "Optional. Shown on your storefront.")]),
        ]),
        el("label", { style: "display:flex;gap:8px;align-items:center;margin:4px 0 8px;cursor:pointer" }, [rxCb, el("span", { class: "small" }, "This is a pharmacy — require prescription + selfie at checkout")]),
      ]),
      el("div", { class: "card", style: "margin-bottom:14px" }, [
        el("div", { style: "font-weight:800;margin-bottom:8px" }, "Store location"),
        el("div", { style: "display:flex;align-items:center;gap:10px;margin-bottom:8px" }, [gpsBtn, locStatus]),
        el("div", { class: "muted small", style: "margin-bottom:4px" }, "…or paste your shop's Google Maps link (the Saradhi navigates here)"),
        linkField,
      ]),
      saveBtn,
    ]);
  }

  function render() {
    switch (state.route) {
      case "inventory": return viewInventory();
      case "analytics": return viewAnalytics();
      case "profile":   return viewStoreProfile();
      default:          return viewOrders();
    }
  }

  boot().catch((err) => {
    console.error("Boot failed:", err);
    root.innerHTML = `<div class="bw-loading" style="color:var(--red)">Failed to connect to server. Is the backend running?</div>`;
  });
})();
