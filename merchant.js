/* =========================================================
 * Merchant App — real API version
 * ========================================================= */
(function () {
  "use strict";
  const { el, money, timeAgo, clockTime, toast, topbar, project, statusBadge, tracker } = UI;
  const S = {
    PLACED: "PLACED", ACCEPTED: "ACCEPTED", ASSIGNED: "ASSIGNED",
    PICKED_UP: "PICKED_UP", OUT_FOR_DELIVERY: "OUT_FOR_DELIVERY",
    DELIVERED: "DELIVERED", CANCELLED: "CANCELLED",
  };

  const state = { route: "orders", vendorId: null, detailOrderId: null };
  const root = document.getElementById("root");

  /* ----- boot ----- */
  async function boot() {
    await BWAuth.requireLogin("merchant");
    await BW.init("merchant");

    // Default to first vendor
    const vendors = BW.vendors();
    if (vendors.length) {
      state.vendorId = vendors[0].id;
      await BW.loadVendorProducts(state.vendorId);
    }

    // Join Socket.io room for live order updates
    if (state.vendorId) BW.joinVendorRoom(state.vendorId);

    BW.subscribe(() => render());
    render();
  }

  async function switchVendor(id) {
    state.vendorId = id;
    BW.joinVendorRoom(id);
    if (!BW.products(id).length) await BW.loadVendorProducts(id);
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

    const switcher = el("select", { style: "width:auto", onChange: (e) => switchVendor(e.target.value) });
    BW.vendors().forEach((v) => {
      const o = el("option", { value: v.id }, v.img + " " + v.name);
      if (v.id === state.vendorId) o.selected = true;
      switcher.appendChild(o);
    });
    const logoutBtn = el("button", { class: "btn ghost sm", onClick: () => BW.logout() }, "Sign out");

    root.appendChild(topbar("Merchant · " + (user ? user.name : ""), [switcher, logoutBtn]));

    const pending = BW.orders({ vendorId: state.vendorId, status: S.PLACED }).length;
    const nav = el("div", { class: "sidebar" }, [
      navItem("orders",    "📋", "Orders",       pending),
      navItem("dispatch",  "🛵", "Live Dispatch"),
      navItem("inventory", "📦", "Inventory"),
      navItem("customers", "👥", "Customers"),
      navItem("qr",        "📱", "My QR Code"),
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
      actions.push(el("button", { class: "btn accent sm", onClick: (e) => { e.stopPropagation(); openDispatch(o); } }, "Dispatch rider"));
    }

    const riderName = o.riderId ? (BW.riders().find((r) => r.id === o.riderId) || {}).name : null;

    return el("div", { class: "card", style: "margin-bottom:12px;cursor:pointer", onClick: () => openOrderDetail(o.id) }, [
      el("div", { class: "row between" }, [
        el("strong", {}, "#" + o.id.slice(-6).toUpperCase()),
        statusBadge(o.status),
      ]),
      el("div", { class: "muted small", style: "margin:6px 0" }, (cust ? cust.name : "Customer") + " · " + itemCount + " items · " + money(o.total)),
      el("div", { class: "small muted" }, o.items.map((l) => l.qty + "× " + l.name).join(", ")),
      riderName ? el("div", { class: "small", style: "margin-top:6px" }, "🛵 " + riderName) : document.createTextNode(""),
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
      cust ? el("div", { class: "muted small", style: "margin-top:10px" }, "Customer: " + cust.name + " · " + cust.phone) : document.createTextNode(""),
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
  function openDispatch(order) {
    const riders = BW.riders();
    const vendor = BW.vendor(order.vendorId);
    const ranked = riders
      .map((r) => ({ r, dist: haversine(r.lat, r.lng, vendor.lat, vendor.lng), avail: r.status === "available" }))
      .sort((a, b) => (b.avail - a.avail) || (a.dist - b.dist));

    const list = el("div", {});
    ranked.forEach(({ r, dist, avail }) => {
      list.appendChild(el("div", { class: "card", style: "margin-bottom:10px" }, [
        el("div", { class: "row between" }, [
          el("div", {}, [
            el("div", { style: "font-weight:600" }, "🛵 " + r.name),
            el("div", { class: "muted small" }, r.vehicle + " · ⭐ " + r.rating + " · " + dist.toFixed(1) + " km away"),
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
    const close = UI.modal({ title: "Dispatch rider · #" + order.id.slice(-6).toUpperCase(), body: list });
  }

  function viewDispatch() {
    const vendor = BW.vendor(state.vendorId);
    if (!vendor) { shell("dispatch", [el("div", { class: "muted" }, "No vendor selected.")]); return; }

    const active = BW.orders({ vendorId: state.vendorId }).filter(
      (o) => ![S.DELIVERED, S.CANCELLED].includes(o.status)
    );
    const riders = BW.riders();

    const map = el("div", { class: "map", style: "height:360px" });
    const addPin = (lat, lng, head, lbl) => {
      if (!lat || !lng) return;
      const { x, y } = project(lat, lng);
      map.appendChild(el("div", { class: "pin", style: `left:${x}%;top:${y}%` }, [
        el("div", { class: "head" }, head), el("div", { class: "lbl small" }, lbl),
      ]));
    };
    addPin(vendor.lat, vendor.lng, "🏪", vendor.name.split(" ")[0]);
    active.forEach((o) => {
      if (o.riderId) {
        const r = BW.riders().find((r) => r.id === o.riderId);
        if (r) addPin(r.lat, r.lng, "🛵", r.name.split(" ")[0]);
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
        el("td", {}, cust ? cust.name : "—"),
        el("td", {}, statusBadge(o.status)),
        el("td", {}, r ? "🛵 " + r.name : el("span", { class: "muted" }, "—")),
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
    const vendor = BW.vendor(state.vendorId);
    const products = BW.products(state.vendorId);

    const rows = products.map((p) => el("tr", {}, [
      el("td", {}, el("strong", {}, p.name)),
      el("td", {}, money(p.price)),
      el("td", { class: "muted" }, p.unit),
      el("td", {}, el("div", { class: "row", style: "gap:6px" }, [
        el("button", { class: "btn ghost sm", onClick: () => editProduct(p) }, "Edit"),
        el("button", { class: "btn danger sm", onClick: async () => {
          if (confirm("Delete " + p.name + "?")) {
            try { await BW.deleteProduct(state.vendorId, p.id); toast("Deleted"); }
            catch (err) { toast("Error: " + err.message); }
          }
        } }, "Delete"),
      ])),
    ]));

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
          el("thead", {}, el("tr", {}, ["Item", "Price", "Unit", ""].map((h) => el("th", {}, h)))),
          el("tbody", {}, rows.length ? rows : [el("tr", {}, el("td", { colspan: "4", class: "muted", style: "text-align:center;padding:24px" }, "No items yet."))]),
        ]),
      ]),
    ]);
  }

  function editProduct(p) {
    const isNew = !p;
    const name  = el("input", { value: p ? p.name : "", placeholder: "e.g. Masala Dosa" });
    const price = el("input", { type: "number", value: p ? p.price : "", placeholder: "90" });
    const unit  = el("input", { value: p ? p.unit : "plate", placeholder: "plate / kg / piece" });
    const body = el("div", {}, [
      el("div", { class: "field" }, [el("label", {}, "Item name"), name]),
      el("div", { class: "field" }, [el("label", {}, "Price (₹)"), price]),
      el("div", { class: "field" }, [el("label", {}, "Unit"), unit]),
    ]);
    const close = UI.modal({
      title: isNew ? "Add item" : "Edit item",
      body,
      footer: [
        el("button", { class: "btn ghost", onClick: () => close() }, "Cancel"),
        el("button", { class: "btn primary", onClick: async () => {
          if (!name.value.trim() || !price.value) { toast("Name and price required"); return; }
          try {
            await BW.upsertProduct({
              id: p ? p.id : undefined,
              vendorId: state.vendorId,
              name: name.value.trim(),
              price: Number(price.value),
              unit: unit.value.trim() || "unit",
            });
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
        // QR card
        el("div", { style: "background:#fff;border-radius:16px;padding:24px;text-align:center;margin-bottom:20px" }, [
          el("img", { src: qrSrc, width: "220", height: "220", alt: "QR Code", style: "display:block;margin:0 auto 16px" }),
          el("div", { style: "font-size:18px;font-weight:700;color:#0f0f13;margin-bottom:4px" }, vendor.img + " " + vendor.name),
          el("div", { style: "font-size:12px;color:#888;word-break:break-all" }, scanUrl),
        ]),

        // How it works
        el("div", { style: "background:#1a1a24;border:1px solid #2a2a3a;border-radius:12px;padding:20px;margin-bottom:16px" }, [
          el("h3", { style: "margin-bottom:14px;font-size:14px;color:#f5a623" }, "How it works"),
          ...[
            ["1️⃣", "Customer scans QR code with their phone"],
            ["2️⃣", "First-time? They install the app — your store loads automatically"],
            ["3️⃣", "Returning? Your store is added to their existing app"],
            ["4️⃣", "They can collect stores from multiple merchants over time"],
          ].map(([ico, text]) =>
            el("div", { style: "display:flex;gap:10px;margin-bottom:10px;font-size:13px;color:#bbb" }, [
              el("span", {}, ico),
              el("span", {}, text),
            ])
          ),
        ]),

        // Buttons
        el("a", {
          href: qrSrc,
          download: vendor.name.replace(/\s+/g, "_") + "_QR.png",
          target: "_blank",
          class: "btn primary",
          style: "display:block;text-align:center;text-decoration:none;padding:14px;border-radius:10px;font-weight:600;margin-bottom:10px",
        }, "⬇️ Download QR Image"),

        el("button", {
          class: "btn",
          style: "display:block;width:100%;background:#252535;color:#f0f0f0;border:none;padding:14px;border-radius:10px;font-weight:600;cursor:pointer",
          onClick: () => {
            navigator.clipboard?.writeText(scanUrl).then(() => toast("Link copied!"));
          },
        }, "🔗 Copy Scan Link"),
      ]),
    ];

    shell("qr", body);
  }

  function render() {
    switch (state.route) {
      case "dispatch":  return viewDispatch();
      case "inventory": return viewInventory();
      case "customers": return viewCustomers();
      case "qr":        return viewQR();
      default:          return viewOrders();
    }
  }

  boot().catch((err) => {
    console.error("Boot failed:", err);
    root.innerHTML = `<div class="bw-loading" style="color:var(--red)">Failed to connect to server. Is the backend running?</div>`;
  });
})();
