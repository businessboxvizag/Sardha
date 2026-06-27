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

  /* ----- boot ----- */
  async function boot() {
    await BWAuth.requireLogin("merchant");
    await BW.init("merchant");

    const me = BW.Auth.getUser();
    const vendors = BW.vendors();

    // Find the vendor assigned to this merchant (uid === vendorId)
    const myVendor = vendors.find((v) => v.id === me.uid || v.userId === me.uid);

    if (!myVendor) {
      // No store assigned — show a clear message, not a setup form
      root.innerHTML = "";
      root.appendChild(topbar("Merchant · " + (me ? me.name : ""), [
        el("button", { class: "btn ghost sm", onClick: () => BW.logout() }, "Sign out"),
      ]));
      root.appendChild(el("div", { class: "content", style: "text-align:center;padding:60px 24px" }, [
        el("h2", {}, "Store not set up"),
        el("p", { class: "muted" }, "Your store account has been created but no store has been assigned yet."),
        el("p", { class: "muted" }, "Please contact the administrator to set up your store."),
      ]));
      return;
    }

    state.vendorId = myVendor.id;
    await BW.loadVendorProducts(state.vendorId);
    BW.joinVendorRoom(state.vendorId);

    BW.subscribe(() => render());
    render();
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
    ]);

    root.appendChild(el("div", { class: "app" }, [nav, el("div", { class: "content" }, body)]));

    // Bottom nav (mobile only)
    root.appendChild(el("div", { class: "bottom-nav" }, [
      bnItem("orders",    "Or", "Orders",    pending || null),
      bnItem("inventory", "In", "Inventory"),
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
        el("strong", {}, "#" + o.id.slice(-6).toUpperCase()),
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
    const footer = [];
    const statusFlow = BW.STATUS_FLOW;
    const i = statusFlow.indexOf(o.status);
    if (o.status !== S.DELIVERED && o.status !== S.CANCELLED && i >= 0 && i < statusFlow.length - 1) {
      footer.push(el("button", { class: "btn primary", onClick: async () => {
        try { await BW.advanceOrder(o.id); toast("Status advanced"); close(); }
        catch (err) { toast("Error: " + err.message); }
      } }, "Advance → " + BW.STATUS_LABEL[statusFlow[i + 1]]));
    }
    const close = UI.modal({ title: "Order #" + o.id.slice(-6).toUpperCase(), body, footer });
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

    const map = el("div", { class: "map", style: "height:360px" });
    const addPin = (lat, lng, head, lbl) => {
      if (!lat || !lng) return;
      const { x, y } = project(lat, lng);
      map.appendChild(el("div", { class: "pin", style: `left:${x}%;top:${y}%` }, [
        el("div", { class: "head" }, head), el("div", { class: "lbl small" }, lbl),
      ]));
    };
    addPin(vendor.lat, vendor.lng, "M", vendor.name.split(" ")[0]);
    active.forEach((o) => {
      if (o.riderId) {
        const r = BW.riders().find((r) => r.id === o.riderId);
        if (r) addPin(r.lat, r.lng, "R", r.name.split(" ")[0]);
      }
    });

    const rows = active.length ? active.map((o) => {
      const cust = BW.customers().find((c) => c.id === o.customerId);
      const r = o.riderId ? BW.riders().find((r) => r.id === o.riderId) : null;
      const act = [];
      if (!r && [S.ACCEPTED, S.ASSIGNED].includes(o.status)) {
        act.push(el("button", { class: "btn accent sm", onClick: async () => {
          try { const { rider } = await BW.autoAssignRider(o.id); toast("Assigned to " + rider.name); }
          catch (err) { toast(err.message || "No available riders"); }
        } }, "Auto-assign"));
      } else if (o.status !== S.DELIVERED) {
        act.push(el("button", { class: "btn primary sm", onClick: async () => {
          try { await BW.advanceOrder(o.id); }
          catch (err) { toast("Error: " + err.message); }
        } }, "Advance"));
      }
      return el("tr", {}, [
        el("td", {}, el("strong", {}, "#" + o.id.slice(-6).toUpperCase())),
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
    const vendor   = BW.vendor(state.vendorId);
    const products = BW.products(state.vendorId);
    const food    = isFoodVendor(vendor);
    const pharma  = isPharmacyVendor(vendor);
    const general = isGeneralVendor(vendor);

    let headers;
    if (food)         headers = ["Item", "Price (₹)", "Qty available", ""];
    else if (pharma)  headers = ["Item", "Price (₹)", "Pack size", ""];
    else if (general) headers = ["Item", "Price (₹)", "Unit / sold per", ""];
    else              headers = ["Item", "Price (₹)", ""];

    const rows = products.map((p) => {
      const cells = [
        el("td", {}, el("strong", {}, p.name)),
        el("td", {}, p.price ? money(p.price) : el("span", { class: "muted" }, "—")),
      ];

      if (food) {
        cells.push(el("td", {}, p.qty !== undefined ? String(p.qty) : el("span", { class: "muted" }, "—")));
      } else if (pharma) {
        const label = (p.qty !== undefined && p.unit) ? `${p.qty} ${p.unit}`
                    : p.unit ? p.unit : null;
        cells.push(el("td", {}, label ? label : el("span", { class: "muted" }, "—")));
      } else if (general) {
        cells.push(el("td", {}, p.unit ? "per " + p.unit : el("span", { class: "muted" }, "—")));
      }

      cells.push(el("td", {}, el("div", { class: "row", style: "gap:6px" }, [
        el("button", { class: "btn ghost sm", onClick: () => editProduct(p) }, "Edit"),
        el("button", { class: "btn danger sm", onClick: async () => {
          if (confirm("Delete " + p.name + "?")) {
            try { await BW.deleteProduct(state.vendorId, p.id); toast("Deleted"); }
            catch (err) { toast("Error: " + err.message); }
          }
        } }, "Delete"),
      ])));
      return el("tr", {}, cells);
    });

    shell("inventory", [
      el("div", { class: "row between" }, [
        el("div", {}, [
          el("h1", { class: "page-title" }, "Inventory"),
          el("p", { class: "page-sub" }, (vendor ? vendor.name : "") + " · " + products.length + " items"),
        ]),
        el("button", { class: "btn primary", onClick: () => editProduct(null) }, "+ Add item"),
      ]),
      el("div", { class: "card", style: "padding:0;overflow:hidden" }, [
        el("table", {}, [
          el("thead", {}, el("tr", {}, headers.map((h) => el("th", {}, h)))),
          el("tbody", {}, rows.length ? rows : [el("tr", {}, el("td", { colspan: String(headers.length), class: "muted", style: "text-align:center;padding:24px" }, "No items yet. Click \"+ Add item\" to get started."))]),
        ]),
      ]),
    ]);
  }

  function editProduct(p) {
    const vendor  = BW.vendor(state.vendorId);
    const food    = isFoodVendor(vendor);
    const pharma  = isPharmacyVendor(vendor);
    const general = isGeneralVendor(vendor);
    const isNew   = !p;

    const namePlaceholder = pharma  ? "e.g. Paracetamol, Cough Syrup, Vitamin C…"
                          : general ? "e.g. Toor Dal, Surf Excel, Colgate…"
                          :           "e.g. Masala Dosa, Cold Coffee…";

    const nameEl  = el("input", { value: p ? p.name : "", placeholder: namePlaceholder });
    const priceEl = el("input", { type: "number", value: p ? p.price : "", placeholder: "0", min: "0" });

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

    const close = UI.modal({
      title: isNew ? "Add item" : "Edit item",
      body: el("div", {}, fields),
      footer: [
        el("button", { class: "btn ghost", onClick: () => close() }, "Cancel"),
        el("button", { class: "btn primary", onClick: async () => {
          if (!nameEl.value.trim()) { toast("Item name is required"); return; }
          try {
            const payload = {
              id: p ? p.id : undefined,
              vendorId: state.vendorId,
              name: nameEl.value.trim(),
              price: priceEl.value ? Number(priceEl.value) : 0,
            };
            if (pharma) {
              payload.unit = unitEl.value;
              if (packQtyEl.value !== "") payload.qty = Number(packQtyEl.value);
            } else if (general) {
              payload.unit = unitEl.value || "piece";
              if (stockEl.value !== "") payload.qty = Number(stockEl.value);
            } else if (food && qtyEl && qtyEl.value !== "") {
              payload.qty = Number(qtyEl.value);
            }
            await BW.upsertProduct(payload);
            toast(isNew ? "Item added" : "Item updated");
            close();
          } catch (err) { toast("Error: " + err.message); }
        } }, "Save"),
      ],
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

    const scanUrl = "https://business-wheels.vercel.app/scan/?v=" + vendor.id;
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

  function render() {
    switch (state.route) {
      case "inventory": return viewInventory();
      default:          return viewOrders();
    }
  }

  boot().catch((err) => {
    console.error("Boot failed:", err);
    root.innerHTML = `<div class="bw-loading" style="color:var(--red)">Failed to connect to server. Is the backend running?</div>`;
  });
})();
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    