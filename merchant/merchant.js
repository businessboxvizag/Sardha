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
    { value: "Restaurant",   label: "ð½ï¸  Restaurant" },
    { value: "Street Food",  label: "ð¥  Street Food / Chaat" },
    { value: "Bakery",       label: "ð¥  Bakery / Cafe" },
    { value: "Sweets",       label: "ð¬  Sweets & Snacks" },
    { value: "Groceries",    label: "ð  Groceries" },
    { value: "Pharmacy",     label: "ð  Pharmacy" },
    { value: "Florist",      label: "ð  Florist" },
    { value: "Electronics",  label: "ð±  Electronics" },
    { value: "Clothing",     label: "ð  Clothing / Textiles" },
    { value: "General",      label: "ðª  General Store" },
  ];

  const EMOJI_OPTIONS = ["ðª","ð½ï¸","ð¥","ð¥","ð","ð","ð","ð","ð","ð","â","ð±","ð§","ð®","ð"];

  const state = { route: "orders", vendorId: null, detailOrderId: null };
  const root = document.getElementById("root");

  /* ----- boot ----- */
  async function boot() {
    await BWAuth.requireLogin("merchant");
    await BW.init("merchant");

    const vendors = BW.vendors();
    if (!vendors.length) {
      renderSetup();
      return;
    }

    state.vendorId = vendors[0].id;
    await BW.loadVendorProducts(state.vendorId);
    if (state.vendorId) BW.joinVendorRoom(state.vendorId);

    BW.subscribe(() => render());
    render();
  }

  /* ====================== SETUP (first-time) ====================== */
  function renderSetup() {
    const user = BW.Auth.getUser();
    root.innerHTML = "";
    root.appendChild(topbar("Merchant Â· " + (user ? user.name : ""), []));

    const nameEl = el("input", { placeholder: "e.g. Sharma Kirana, Hotel Udupi Palaceâ¦" });
    const areaEl = el("input", { placeholder: "e.g. MG Road, Koramangalaâ¦" });

    const catEl = el("select", {});
    CATEGORY_OPTIONS.forEach((c) => catEl.appendChild(el("option", { value: c.value }, c.label)));

    const emojiDisplay = el("span", { style: "font-size:32px;cursor:pointer" }, "ðª");
    let chosenEmoji = "ðª";
    const emojiGrid = el("div", { style: "display:flex;flex-wrap:wrap;gap:8px;margin-top:8px" });
    EMOJI_OPTIONS.forEach((e) => {
      const btn = el("button", {
        class: "btn",
        style: "font-size:22px;padding:6px 10px",
        onClick: () => { chosenEmoji = e; emojiDisplay.textContent = e; },
      }, e);
      emojiGrid.appendChild(btn);
    });

    const errEl = el("div", { class: "auth-err" });
    const submitBtn = el("button", { class: "btn primary", style: "width:100%", onClick: async () => {
      errEl.textContent = "";
      const name = nameEl.value.trim();
      const area = areaEl.value.trim();
      if (!name) { errEl.textContent = "Store name is required."; return; }

      submitBtn.disabled = true;
      submitBtn.textContent = "Creating your storeâ¦";
      try {
        const vendor = await BW.upsertVendor({
          name,
          category: catEl.value,
          area: area || "â",
          img: chosenEmoji,
        });
        state.vendorId = vendor.id;
        await BW.loadVendorProducts(vendor.id);
        BW.joinVendorRoom(vendor.id);
        BW.subscribe(() => render());
        toast("Your store is ready! ð");
        render();
      } catch (err) {
        errEl.textContent = err.message || "Failed to create store.";
        submitBtn.disabled = false;
        submitBtn.textContent = "Create my store";
      }
    } }, "Create my store");

    const content = el("div", { style: "max-width:480px;margin:40px auto;padding:0 16px" }, [
      el("h1", { class: "page-title" }, "Welcome! Set up your store"),
      el("p",  { class: "page-sub"   }, "You only need to do this once. Fill in the basics â you can change everything later."),
      el("div", { class: "card", style: "margin-top:24px" }, [
        el("div", { class: "field" }, [el("label", {}, "Store name"), nameEl]),
        el("div", { class: "field" }, [el("label", {}, "Type of store"), catEl]),
        el("div", { class: "field" }, [el("label", {}, "Your area / locality"), areaEl]),
        el("div", { class: "field" }, [
          el("label", {}, "Store icon"),
          el("div", { class: "row", style: "gap:12px;align-items:center;margin-bottom:6px" }, [emojiDisplay]),
          emojiGrid,
        ]),
        el("div", { style: "margin-top:16px" }, [errEl, submitBtn]),
      ]),
    ]);

    root.appendChild(el("div", { class: "app" }, [
      el("div", { class: "content" }, [content]),
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
    root.appendChild(topbar("Merchant Â· " + (user ? user.name : ""), [logoutBtn]));

    const pending = BW.orders({ vendorId: state.vendorId, status: S.PLACED }).length;
    const nav = el("div", { class: "sidebar" }, [
      navItem("orders",    "ð", "Orders",       pending),
      navItem("dispatch",  "ðµ", "Live Dispatch"),
      navItem("inventory", "ð¦", "Inventory"),
      navItem("customers", "ð¥", "Customers"),
      navItem("qr",        "ð±", "My QR Code"),
    ]);

    root.appendChild(el("div", { class: "app" }, [nav, el("div", { class: "content" }, body)]));

    function navItem(route, ico, label, count) {
      return el("div", { class: "nav-item" + (active === route ? " active" : ""), onClick: () => go(route) }, [
        el("span", { class: "ico" }, ico),
        el("span", { style: "flex:1" }, label),
        count ? el("span", { class: "badge PLACED" }, String(count)) : document.createTextNode(""),
      ]);
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
      if (!list.length) col.appendChild(el("div", { class: "muted small", style: "padding:10px 0" }, "â"));
      list.forEach((o) => col.appendChild(orderCard(o)));
      cols.appendChild(col);
    });

    shell("orders", [
      el("h1", { class: "page-title" }, "Orders"),
      el("p", { class: "page-sub" }, (vendor ? vendor.name : "") + " Â· accept new orders, then dispatch a rider."),
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
      actions.push(el("button", { class: "btn accent sm", onClick: (e) => { e.stopPropagation(); openDispatch(o); } }, "Dispatch rider"));
    }

    const riderName = o.riderId ? (BW.riders().find((r) => r.id === o.riderId) || {}).name : null;

    return el("div", { class: "card", style: "margin-bottom:12px;cursor:pointer", onClick: () => openOrderDetail(o.id) }, [
      el("div", { class: "row between" }, [
        el("strong", {}, "#" + o.id.slice(-6).toUpperCase()),
        statusBadge(o.status),
      ]),
      el("div", { class: "muted small", style: "margin:6px 0" }, (cust ? cust.name : "Customer") + " Â· " + itemCount + " items Â· " + money(o.total)),
      el("div", { class: "small muted" }, o.items.map((l) => l.qty + "Ã " + l.name).join(", ")),
      riderName ? el("div", { class: "small", style: "margin-top:6px" }, "ðµ " + riderName) : document.createTextNode(""),
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
          el("span", {}, l.qty + "Ã " + l.name), el("span", { class: "muted" }, money(l.price * l.qty)),
        ])),
        el("div", { class: "line", style: "border:none" }, [el("strong", {}, "Total"), el("strong", {}, money(o.total))]),
      ]),
      cust ? el("div", { class: "muted small", style: "margin-top:10px" }, "Customer: " + cust.name + " Â· " + (cust.phone || "")) : document.createTextNode(""),
      cust ? el("div", { class: "muted small" }, "Deliver to: " + cust.address) : document.createTextNode(""),
      el("div", { class: "card", style: "margin-top:12px" }, [
        el("strong", { class: "small" }, "Timeline"),
        ...(o.history || []).map((h) => el("div", { class: "row between small muted", style: "padding:4px 0" }, [
          el("span", {}, BW.STATUS_LABEL[h.status] + (h.note ? " â " + h.note : "")),
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
      } }, "Advance â " + BW.STATUS_LABEL[statusFlow[i + 1]]));
    }
    const close = UI.modal({ title: "Order #" + o.id.slice(-6).toUpperCase(), body, footer });
  }

  /* ====================== DISPATCH ====================== */
  function openDispatch(order) {
    const riders = BW.riders();
    const vendor = BW.vendor(order.vendorId);
    const ranked = riders
      .map((r) => ({ r, dist: haversine(r.lat, r.lng, vendor ? vendor.lat : 0, vendor ? vendor.lng : 0), avail: r.status === "available" }))
      .sort((a, b) => (b.avail - a.avail) || (a.dist - b.dist));

    const list = el("div", {});
    if (!ranked.length) {
      list.appendChild(el("p", { class: "muted" }, "No riders registered yet. Ask admin to add riders."));
    }
    ranked.forEach(({ r, dist, avail }) => {
      list.appendChild(el("div", { class: "card", style: "margin-bottom:10px" }, [
        el("div", { class: "row between" }, [
          el("div", {}, [
            el("div", { style: "font-weight:600" }, "ðµ " + r.name),
            el("div", { class: "muted small" }, r.vehicle + " Â· â­ " + r.rating + " Â· " + (isFinite(dist) ? dist.toFixed(1) + " km" : "â")),
          ]),
          el("div", { class: "row", style: "gap:8px" }, [
            el("span", { class: "badge " + r.status }, r.status.replace("_", " ")),
            el("button", { class: "btn primary sm", disabled: !avail, onClick: async () => {
              try { await BW.assignRider(order.id, r.id); toast("Dispatched to " + r.name); close(); }
              catch (err) { toast("Error: " + err.message); }
            } }, avail ? "Assign" : "Busy"),
          ]),
        ]),
      ]));
    });
    const close = UI.modal({ title: "Dispatch rider Â· #" + order.id.slice(-6).toUpperCase(), body: list });
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
    addPin(vendor.lat, vendor.lng, "ðª", vendor.name.split(" ")[0]);
    active.forEach((o) => {
      if (o.riderId) {
        const r = BW.riders().find((r) => r.id === o.riderId);
        if (r) addPin(r.lat, r.lng, "ðµ", r.name.split(" ")[0]);
      }
    });

    const rows = active.length ? active.map((o) => {
      const cust = BW.customers().find((c) => c.id === o.customerId);
      const r = o.riderId ? BW.riders().find((r) => r.id === o.riderId) : null;
      const act = [];
      if (!r && [S.ACCEPTED, S.ASSIGNED].includes(o.status)) {
        act.push(el("button", { class: "btn accent sm", onClick: () => openDispatch(o) }, "Assign"));
      } else if (o.status !== S.DELIVERED) {
        act.push(el("button", { class: "btn primary sm", onClick: async () => {
          try { await BW.advanceOrder(o.id); }
          catch (err) { toast("Error: " + err.message); }
        } }, "Advance"));
      }
      return el("tr", {}, [
        el("td", {}, el("strong", {}, "#" + o.id.slice(-6).toUpperCase())),
        el("td", {}, cust ? cust.name : "â"),
        el("td", {}, statusBadge(o.status)),
        el("td", {}, r ? "ðµ " + r.name : el("span", { class: "muted" }, "â")),
        el("td", {}, el("div", { class: "row", style: "gap:6px" }, act)),
      ]);
    }) : [el("tr", {}, el("td", { colspan: "5", class: "muted", style: "text-align:center;padding:24px" }, "No active deliveries."))];

    shell("dispatch", [
      el("h1", { class: "page-title" }, "Live Dispatch"),
      el("p", { class: "page-sub" }, "Track active deliveries and assign riders in real time."),
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
    if (food)         headers = ["Item", "Price (â¹)", "Qty available", ""];
    else if (pharma)  headers = ["Item", "Price (â¹)", "Pack size", ""];
    else if (general) headers = ["Item", "Price (â¹)", "Unit / sold per", ""];
    else              headers = ["Item", "Price (â¹)", ""];

    const rows = products.map((p) => {
      const cells = [
        el("td", {}, el("strong", {}, p.name)),
        el("td", {}, p.price ? money(p.price) : el("span", { class: "muted" }, "â")),
      ];

      if (food) {
        cells.push(el("td", {}, p.qty !== undefined ? String(p.qty) : el("span", { class: "muted" }, "â")));
      } else if (pharma) {
        const label = (p.qty !== undefined && p.unit) ? `${p.qty} ${p.unit}`
                    : p.unit ? p.unit : null;
        cells.push(el("td", {}, label ? label : el("span", { class: "muted" }, "â")));
      } else if (general) {
        cells.push(el("td", {}, p.unit ? "per " + p.unit : el("span", { class: "muted" }, "â")));
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
          el("p", { class: "page-sub" }, (vendor ? vendor.img + " " + vendor.name : "") + " Â· " + productË[Ý
È][\ÈKJK[
]ÛÈÛ\ÜÎ[X\HÛÛXÚÎ

HOY]ÙXÝ
[
HKÈY][HKJK[
]ÈÛ\ÜÎØ\Ý[NY[ÎÛÝ\ÝÎY[KÂ[
XHßKÂ[
XYßK[
ßKXY\ËX\


HO[
ßK
JJJK[
ÙHßKÝÜË[ÝÈÝÜÈÙ[
ßK[
ÈÛÛÜ[Ý[ÊXY\Ë[Ý
KÛ\ÜÎ]]YÝ[N^X[YÛÙ[\ÜY[ÎKÈ][\ÈY]ÛXÚÈÈY][WÈÙ]Ý\YJWJKJKJKJNÂB[Ý[ÛY]ÙXÝ

HÂÛÛÝ[ÜHË[ÜÝ]K[ÜY
NÂÛÛÝÛÙH\ÑÛÙ[Ü[ÜNÂÛÛÝ\XHH\Ô\XXÞU[Ü[ÜNÂÛÛÝÙ[\[H\ÑÙ[\[[Ü[ÜNÂÛÛÝ\Ó]ÈH\ÂÛÛÝ[YTXÙZÛ\H\XHÈKË\XÙ][[ÛÛÝYÚÞ\\][Z[ø )Ù[\[ÈKËÛÜ[Ý\^Ù[ÛÛØ]x )KËX\Ø[HÜØKÛÛÛÙYx )ÂÛÛÝ[YQ[H[
[]È[YNÈ[YHXÙZÛ\[YTXÙZÛ\JNÂÛÛÝXÙQ[H[
[]È\N[X\[YNÈXÙHXÙZÛ\Z[JNÂÛÛÝY[ÈHÂ[
]ÈÛ\ÜÎY[KÙ[
X[ßK][H[YHK[YQ[JKNÂÊ8 %\XØ]YÛÜH^HY[È8 %
Â]XÚÔ]Q[[][ÝØÚÑ[]Q[ÂY
\XJHÂÊ\XXÞNXÚÈ]H
È[]\H
KËLX]ËÜÝ\L[H
ÂXÚÔ]Q[H[
[]Â\N[X\[YN	]HOOH[Y[YÈ]HXÙZÛ\KËLZ[Ý[NÚYLÙ^LJNÂ[][H[
Ù[XÝßJNÂTPPÖWÕSUËÜXXÚ

JHO[][\[Ú[
[
Ü[ÛÈ[YNK[YK	[]OOHK[YHÈÈÙ[XÝYHßJHKKX[
JB
NÂY[Ë\Ú
[
]ÈÛ\ÜÎY[KÙ[
X[ßKXÙH
8 ®JHKXÙQ[JJNÂY[Ë\Ú
[
]ÈÛ\ÜÎY[KÂ[
X[ßKXÚÈÚ^HK[
]ÈÛ\ÜÎÝÈÝ[NØ\Ø[YÛZ][\ÎÙ[\KÜXÚÔ]Q[[][JK[
]ÈÛ\ÜÎ]]YÛX[Ý[NX\Ú[]ÜKKËLX]ËÜÝ\0­ÈL[0­ÈÌØ\Ý[\È0­ÈMHÈÜX[HKJJNÂH[ÙHY
Ù[\[
HÂÊÙ[\[ÈÜØÙ\NXÙH\Ý[]H
ÈÜ[Û[ÝØÚÈ]H
Â[][H[
Ù[XÝßJNÂÑSTSÕSUËÜXXÚ

JHO[][\[Ú[
[
Ü[ÛÈ[YNK[YK	[]OOHK[YHÈÈÙ[XÝYHßJHKKX[
JB
NÂÝØÚÑ[H[
[]Â\N[X\[YN	]HOOH[Y[YÈ]HXÙZÛ\Ü[Û[Z[JNÂY[Ë\Ú
[
]ÈÛ\ÜÎY[KÂ[
X[ßKXÙH
8 ®JH8 %ÛÛ\K[
]ÈÛ\ÜÎÝÈÝ[NØ\Ø[YÛZ][\ÎÙ[\KÜXÙQ[[][JKJJNÂY[Ë\Ú
[
]ÈÛ\ÜÎY[KÂ[
X[ßKÝØÚÈ]H
Ü[Û[
HKÝØÚÑ[JJNÂH[ÙHÂÊÛÙ
È]\][È[ÙNXÙH
ÈÜ[Û[]KX]Z[XH
ÂY[Ë\Ú
[
]ÈÛ\ÜÎY[KÙ[
X[ßKXÙH
8 ®JHKXÙQ[JJNÂY
ÛÙ
HÂ]Q[H[
[]Â\N[X\[YN	]HOOH[Y[YÈ]HXÙZÛ\KËZ[JNÂY[Ë\Ú
[
]ÈÛ\ÜÎY[KÙ[
X[ßK]X[]H]Z[XHK]Q[JJNÂBBÛÛÝÛÜÙHHRK[Ù[
Â]N\Ó]ÈÈY][HY]][HÙN[
]ßKY[ÊKÛÝ\Â[
]ÛÈÛ\ÜÎÚÜÝÛÛXÚÎ

HOÛÜÙJ
HKØ[Ù[K[
]ÛÈÛ\ÜÎ[X\HÛÛXÚÎ\Þ[È

HOÂY
[[YQ[[YK[J
JHÈØ\Ý
][H[YH\È\]Z\YNÈ]\ÈBHÂÛÛÝ^[ØYHÂYÈY[Y[Y[ÜYÝ]K[ÜY[YN[YQ[[YK[J
KXÙNXÙQ[[YHÈ[X\XÙQ[[YJHNÂY
\XJHÂ^[ØY[]H[][[YNÂY
XÚÔ]Q[[YHOOHH^[ØY]HH[X\XÚÔ]Q[[YJNÂH[ÙHY
Ù[\[
HÂ^[ØY[]H[][[YHYXÙHÂY
ÝØÚÑ[[YHOOHH^[ØY]HH[X\ÝØÚÑ[[YJNÂH[ÙHY
ÛÙ	]Q[	]Q[[YHOOHHÂ^[ØY]HH[X\]Q[[YJNÂB]ØZ]Ë\Ù\ÙXÝ
^[ØY
NÂØ\Ý
\Ó]ÈÈ][HYY][H\]YNÂÛÜÙJ
NÂHØ]Ú
\HÈØ\Ý
\Ü
È\Y\ÜØYÙJNÈBHKØ]HKKJNÂBÊOOOOOOOOOOOOOOOOOOOOOHÕTÕÓQTÈOOOOOOOOOOOOOOOOOOOOOH
Â[Ý[ÛY]ÐÝ\ÝÛY\Ê
HÂÛÛÝÜ\ÈHËÜ\ÊÈ[ÜYÝ]K[ÜYJNÂÛÛÝX\HßNÂÜ\ËÜXXÚ

ÊHOÂÛÛÝÈHËÝ\ÝÛY\Ê
K[

ÊHOËYOOHËÝ\ÝÛY\Y
NÂY
XÊH]\ÂY
[X\ØËYJHX\ØËYHHÈËÜ\ÎÜ[\ÝËÜX]Y]NÂX\ØËYKÜ\È
ÏHNÂX\ØËYKÜ[
ÏHËÝ[ÂY
]È]JËÜX]Y]
H]È]JX\ØËYK\Ý
JHX\ØËYK\ÝHËÜX]Y]ÂJNÂÛÛÝ\ÝHØXÝ[Y\ÊX\
KÛÜ

KHOÜ[HKÜ[
NÂÛÛÝÝÜÈH\Ý[ÝÈ\ÝX\


HO[
ßKÂ[
ßK[
ÝÛÈßKË[YJJK[
ÈÛ\ÜÎ]]YKËÛH¸ %K[
ßKÝ[ÊÜ\ÊJK[
ßK[Û^JÜ[
JK[
ÈÛ\ÜÎ]]YÛX[K[YPYÛÊ\Ý
JKJJHÙ[
ßK[
ÈÛÛÜ[HÛ\ÜÎ]]YÝ[N^X[YÛÙ[\ÜY[ÎKÈÝ\ÝÛY\ÈY]JWNÂÚ[
Ý\ÝÛY\ÈÂ[
HÈÛ\ÜÎYÙK]]HKÝ\ÝÛY\ÈK[
ÈÛ\ÜÎYÙK\ÝXK[ÜHÚÈ]HÜ\YÛH[ÝK[ÙYHÜ[K[
]ÈÛ\ÜÎØ\Ý[NY[ÎÛÝ\ÝÎY[KÂ[
XHßKÂ[
XYßK[
ßKÈÝ\ÝÛY\ÛHÜ\ÈÝ[Ü[\ÝÜ\KX\


HO[
ßK
JJJK[
ÙHßKÝÜÊKJKJKJNÂBÊKKKKHÙ[ÈKKKKH
Â[Ý[Û]\Ú[JLKÌKLÌHÂY
[LH[ÌH[L[ÌH]\[[]NÂÛÛÝH
ÍÌKÔH

HO

X]JHÈNÂÛÛÝHHÔLHLJKÈHÔÌHÌJNÂÛÛÝHHX]Ú[HÈH

ÈX]ÛÜÊÔLJJH
X]ÛÜÊÔLJH
X]Ú[ÈÈH
Â]\

X]][X]Ü\
JKX]Ü\
HHJJNÂBÊOOOOOOOOOOOOOOOOOOOOOHTÓÑHOOOOOOOOOOOOOOOOOOOOOH
Â[Ý[ÛY]ÔT
HÂÛÛÝ[ÜHË[ÜÝ]K[ÜY
NÂY
][ÜHÈÚ[
\Ù[
ÈÛ\ÜÎ]]YKÙ[XÝH[Ü\ÝWJNÈ]\ÈBÛÛÝØØ[\HÎËØ\Ú[\ÜË]ÚY[Ë\Ù[\ÜØØ[ÏÝH
È[ÜYÂÛÛÝ\ÜÈHÎËØ\K\Ù\\ÛÛKÝKØÜX]K\\XÛÙKÏÜÚ^OL	XØÏSIÜX]\É]OH
È[ÛÙUTPÛÛ\Û[
ØØ[\
NÂÛÛÝÙHHÂ[
HÈÛ\ÜÎYÙK]]HK^HTÛÙHK[
ÈÛ\ÜÎYÙK\ÝXK\Ü^H\ÈT][Ý\ÝÜKÝ\ÝÛY\ÈØØ[ÛÙHÈ[ØÚÈ[Ý\Ù\XÙ\ËK[
]ÈÝ[NX^]ÚYÛX\Ú[]]ÈKÂ[
]ÈÝ[NXÚÙÜÝ[ÙØÜ\\ÛÛYÙLÎØÜ\\Y]\ÎMÜY[ÎÝ^X[YÛÙ[\ÛX\Ú[XÝÛNØÞ\ÚYÝÎLØJL

HKÂ[
[YÈÈÜÎ\ÜËÚYZYÚ[TÛÙHÝ[N\Ü^NØÚÎÛX\Ú[]]ÈMØÜ\\Y]\ÎJK[
]ÈÝ[NÛ\Ú^NNÙÛ]ÙZYÚÌØÛÛÜÌXLXLÛX\Ú[XÝÛNK[Ü[YÈ
È
È[Ü[YJK[
]ÈÝ[NÛ\Ú^NLØÛÛÜÎNNNÝÛÜXXZÎXZËX[KØØ[\
KJK[
]ÈÝ[NXÚÙÜÝ[ÙYNØÜ\\ÛÛYÙLÎØÜ\\Y]\ÎLÜY[ÎÛX\Ú[XÝÛNMKÂ[
ÈÈÝ[NX\Ú[MÙÛ\Ú^NMØÛÛÜÙ
ÎÌKÝÈ]ÛÜÜÈKÂÈ{î#ø èÈÝ\ÝÛY\ØØ[ÈTÛÙHÚ]Z\ÛHKÈ»î#ø èÈ\Ý][YOÈ^H[Ý[H\8 %[Ý\ÝÜHØYÈ]]ÛX]XØ[HKÈûî#ø èÈ]\[ÏÈ[Ý\ÝÜH\ÈYYÈZ\^\Ý[È\KÈ;î#ø èÈ^HØ[ÛÛXÝÝÜ\ÈÛH][\HY\Ú[ÈÝ\[YHKKX\

ÚXÛË^JHO[
]ÈÝ[N\Ü^N^ÙØ\LÛX\Ú[XÝÛNLÙÛ\Ú^NLÜØÛÛÜÍMMHKÂ[
Ü[ßKXÛÊK[
Ü[ßK^
KJB
KJK[
HÂY\ÜËÝÛØY[Ü[YK\XÙJ×ÊËÙËÈH
ÈÔTÈ\Ù]Ø[ÈÛ\ÜÎ[X\HÝ[N\Ü^NØÚÎÝ^X[YÛÙ[\Ý^YXÛÜ][ÛÛNÜY[ÎMØÜ\\Y]\ÎLÙÛ]ÙZYÚÛX\Ú[XÝÛNLK¸«!ûî#ÈÝÛØYT[XYÙHK[
]ÛÂÛ\ÜÎÝ[N\Ü^NØÚÎÝÚYL	NÜY[ÎMØÜ\\Y]\ÎLÙÛ]ÙZYÚØÝ\ÛÜÚ[\ÛÛXÚÎ

HOÈ]YØ]ÜÛ\Ø\ËÜ]U^
ØØ[\
K[

HOØ\Ý
[ÈÛÜYYHJNÈKK¼'å%ÈÛÜHØØ[[ÈKJKNÂÚ[
\ÙJNÂB[Ý[Û[\
HÂÝÚ]Ú
Ý]KÝ]JHÂØ\ÙH\Ü]Ú]\Y]Ñ\Ü]Ú

NÂØ\ÙH[[ÜH]\Y]Ò[[ÜJ
NÂØ\ÙHÝ\ÝÛY\È]\Y]ÐÝ\ÝÛY\Ê
NÂØ\ÙH\]\Y]ÔT
NÂY][]\Y]ÓÜ\Ê
NÂBBÛÝ

KØ]Ú

\HOÂÛÛÛÛK\ÜÛÝZ[Y\NÂÛÝ[\SH]Û\ÜÏHË[ØY[ÈÝ[OHÛÛÜ\K\Y
HZ[YÈÛÛXÝÈÙ\\\ÈHXÚÙ[[[ÏÏÙ]ÂJNÂJJ
NÂ
