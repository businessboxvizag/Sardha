/* =========================================================
 * Admin Dashboard — real API version
 * ========================================================= */
(function () {
  "use strict";
  const { el, money, timeAgo, clockTime, toast, topbar, project, statusBadge } = UI;
  const S = {
    PLACED: "PLACED", ACCEPTED: "ACCEPTED", ASSIGNED: "ASSIGNED",
    PICKED_UP: "PICKED_UP", OUT_FOR_DELIVERY: "OUT_FOR_DELIVERY",
    DELIVERED: "DELIVERED", CANCELLED: "CANCELLED",
  };

  const state = { route: "overview" };
  const root = document.getElementById("root");

  /* ----- boot ----- */
  async function boot() {
    await BWAuth.requireLogin("admin");
    await BW.init("admin");
    // Load products for all vendors (needed by vendor management)
    for (const v of BW.vendors()) {
      await BW.loadVendorProducts(v.id);
    }
    BW.subscribe(() => render());
    render();
  }

  function go(route) { state.route = route; window.scrollTo(0, 0); render(); }

  function shell(active, body) {
    root.innerHTML = "";
    const user = BW.Auth.getUser();
    const logoutBtn = el("button", { class: "btn ghost sm", onClick: () => BW.logout() }, "Sign out");

    root.appendChild(topbar("Admin · " + (user ? user.name : ""), [logoutBtn]));

    const unassigned = BW.orders().filter((o) => !o.riderId && [S.PLACED, S.ACCEPTED].includes(o.status)).length;
    const nav = el("div", { class: "sidebar" }, [
      navItem("overview",  "Ov", "Overview"),
      navItem("fleet",     "Fl", "Fleet"),
      navItem("assign",    "Ta", "Task Assignment", unassigned),
      navItem("vendors",   "Ve", "Vendors"),
      navItem("analytics", "An", "Analytics"),
      navItem("monitor",   "Mo", "Monitor"),
    ]);
    root.appendChild(el("div", { class: "app" }, [nav, el("div", { class: "content" }, body)]));

    // Bottom nav (mobile only)
    root.appendChild(el("div", { class: "bottom-nav" }, [
      bnItem("overview",  "Ov", "Overview"),
      bnItem("fleet",     "Fl", "Fleet"),
      bnItem("assign",    "Ta", "Tasks",   unassigned || null),
      bnItem("vendors",   "Ve", "Vendors"),
      bnItem("monitor",   "Mo", "Monitor"),
    ]));

    function navItem(route, ico, label, count) {
      return el("div", { class: "nav-item" + (active === route ? " active" : ""), onClick: () => go(route) }, [
        el("span", { class: "ico nav-ico-text" }, ico),
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

  /* ====================== OVERVIEW ====================== */
  function viewOverview() {
    const a = BW.analytics() || {};
    const orders = BW.orders();
    const riders = BW.riders();

    const stat = (k, v, d) => el("div", { class: "card stat" }, [
      el("span", { class: "k" }, k),
      el("span", { class: "v" }, v),
      d ? el("span", { class: "d" }, d) : document.createTextNode(""),
    ]);

    const recent = orders.slice(0, 8).map((o) => {
      const v    = BW.vendor(o.vendorId);
      const cust = BW.customers().find((c) => c.id === o.customerId);
      const rider = o.riderId ? BW.riders().find((r) => r.id === o.riderId) : null;
      return el("tr", {}, [
        el("td", {}, el("strong", {}, "#" + o.id.slice(-6).toUpperCase())),
        el("td", {}, v ? v.img + " " + v.name : "—"),
        el("td", {}, cust ? cust.name : "—"),
        el("td", {}, money(o.total)),
        el("td", {}, statusBadge(o.status)),
        el("td", {}, rider ? rider.name : el("span", { class: "muted" }, "unassigned")),
        el("td", { class: "muted small" }, timeAgo(o.createdAt)),
      ]);
    });

    shell("overview", [
      el("h1", { class: "page-title" }, "Platform Overview"),
      el("p", { class: "page-sub" }, "Live snapshot across all vendors and Saradhis."),
      el("div", { class: "grid cols-4" }, [
        stat("Total orders",  String(a.totalOrders || 0), "+" + (a.activeOrders || 0) + " active"),
        stat("Revenue",       money(Math.round(a.revenue || 0)), "avg " + money(Math.round(a.avgOrderValue || 0))),
        stat("Delivered",     String(a.deliveredOrders || 0), ""),
        stat("Saradhis online", (a.ridersOnline || 0) + " / " + riders.length, ""),
      ]),
      el("h3", { style: "margin:24px 0 10px" }, "Recent orders"),
      el("div", { class: "card", style: "padding:0;overflow:hidden" }, [
        el("table", {}, [
          el("thead", {}, el("tr", {}, ["Order", "Vendor", "Customer", "Total", "Status", "Saradhi", "When"].map((h) => el("th", {}, h)))),
          el("tbody", {}, recent.length ? recent : [el("tr", {}, el("td", { colspan: "7", class: "muted", style: "text-align:center;padding:20px" }, "No orders yet."))]),
        ]),
      ]),
    ]);
  }

  /* ====================== FLEET ====================== */
  function viewFleet() {
    const riders = BW.riders();

    const map = el("div", { class: "map", style: "height:380px" });
    riders.forEach((r) => {
      if (!r.lat || !r.lng) return;
      const { x, y } = project(r.lat, r.lng);
      const statusCls = r.status === "available" ? "pin-available" : r.status === "on_delivery" ? "pin-busy" : "pin-offline";
      map.appendChild(el("div", { class: "pin " + statusCls, style: `left:${x}%;top:${y}%` }, [
        el("div", { class: "head" }, "R"),
        el("div", { class: "lbl small" }, r.name.split(" ")[0]),
      ]));
    });

    const rows = riders.map((r) => {
      const active = BW.orders().find((o) => o.riderId === r.id && ![S.DELIVERED, S.CANCELLED].includes(o.status));
      const statusSel = el("select", { style: "width:auto", onChange: async (e) => {
        try { await BW.setRiderStatus(r.id, e.target.value); toast(r.name + " → " + e.target.value); }
        catch (err) { toast("Error: " + err.message); }
      } });
      ["available", "on_delivery", "offline"].forEach((s) => {
        const o = el("option", { value: s }, s.replace("_", " "));
        if (s === r.status) o.selected = true;
        statusSel.appendChild(o);
      });
      return el("tr", {}, [
        el("td", {}, el("strong", {}, r.name)),
        el("td", { class: "muted small" }, r.vehicle + " · " + r.shift),
        el("td", {}, "⭐ " + r.rating),
        el("td", {}, r.deliveriesToday + " today"),
        el("td", {}, active ? "#" + active.id.slice(-6).toUpperCase() : el("span", { class: "muted" }, "—")),
        el("td", {}, statusSel),
      ]);
    });

    shell("fleet", [
      el("div", { class: "row between", style: "margin-bottom:4px" }, [
        el("div", {}, [
          el("h1", { class: "page-title", style: "margin:0" }, "Fleet Management"),
          el("p", { class: "page-sub", style: "margin:4px 0 0" }, "Location-tracked, salaried Saradhis. Set shift status and monitor load."),
        ]),
        el("button", { class: "btn primary", onClick: createRider }, "+ Add Saradhi"),
      ]),
      el("div", { class: "grid cols-2" }, [
        el("div", { class: "card" }, [
          el("div", { class: "row between" }, [
            el("h3", { style: "margin:0" }, "Live fleet map"),
            el("div", { class: "row small muted", style: "gap:12px" }, [
              el("span", { class: "fleet-legend fleet-legend--available" }, "Available"),
              el("span", { class: "fleet-legend fleet-legend--busy" }, "On delivery"),
              el("span", { class: "fleet-legend fleet-legend--offline" }, "Offline"),
            ]),
          ]),
          el("div", { style: "margin-top:12px" }, map),
        ]),
        el("div", { class: "card", style: "padding:0;overflow:hidden" }, [
          el("table", {}, [
            el("thead", {}, el("tr", {}, ["Saradhi", "Vehicle/Shift", "Rating", "Load", "Active", "Status"].map((h) => el("th", {}, h)))),
            el("tbody", {}, rows),
          ]),
        ]),
      ]),
    ]);
  }

  /* ====================== TASK ASSIGNMENT ====================== */
  function viewAssign() {
    const orders = BW.orders().filter((o) => ![S.DELIVERED, S.CANCELLED].includes(o.status));
    const unassigned = orders.filter((o) => !o.riderId);

    const autoBtn = el("button", { class: "btn primary", onClick: autoAssignAll, disabled: !unassigned.length },
      "Auto-assign all (" + unassigned.length + ")");

    const cards = unassigned.length ? unassigned.map((o) => assignmentCard(o)) :
      [el("div", { class: "empty" }, [el("div", { class: "e" }, ""), "All active orders have a Saradhi assigned."])];

    const assignedRows = orders.filter((o) => o.riderId).map((o) => {
      const v = BW.vendor(o.vendorId);
      const r = BW.riders().find((r) => r.id === o.riderId);
      return el("tr", {}, [
        el("td", {}, el("strong", {}, "#" + o.id.slice(-6).toUpperCase())),
        el("td", {}, v ? v.name : "—"),
        el("td", {}, statusBadge(o.status)),
        el("td", {}, r ? r.name : "—"),
        el("td", {}, el("button", { class: "btn ghost sm", onClick: () => openReassign(o) }, "Reassign")),
      ]);
    });

    shell("assign", [
      el("div", { class: "row between" }, [
        el("div", {}, [el("h1", { class: "page-title" }, "Dynamic Task Assignment"), el("p", { class: "page-sub" }, "Match unassigned orders to the nearest available Saradhi.")]),
        autoBtn,
      ]),
      el("div", { class: "grid cols-2" }, cards),
      el("h3", { style: "margin:24px 0 10px" }, "Currently assigned"),
      el("div", { class: "card", style: "padding:0;overflow:hidden" }, [
        el("table", {}, [
          el("thead", {}, el("tr", {}, ["Order", "Vendor", "Status", "Rider", ""].map((h) => el("th", {}, h)))),
          el("tbody", {}, assignedRows.length ? assignedRows : [el("tr", {}, el("td", { colspan: "5", class: "muted", style: "text-align:center;padding:20px" }, "None yet."))]),
        ]),
      ]),
    ]);
  }

  function assignmentCard(o) {
    const v = BW.vendor(o.vendorId);
    const cust = BW.customers().find((c) => c.id === o.customerId);
    const best = bestRider(v);
    const sel = el("select", {});
    BW.riders().forEach((r) => {
      const opt = el("option", { value: r.id }, r.name + (r.status === "available" ? "" : " (" + r.status.replace("_", " ") + ")"));
      if (best && r.id === best.id) opt.selected = true;
      sel.appendChild(opt);
    });
    return el("div", { class: "card" }, [
      el("div", { class: "row between" }, [el("strong", {}, "#" + o.id.slice(-6).toUpperCase()), statusBadge(o.status)]),
      el("div", { class: "muted small", style: "margin:6px 0" }, (v ? v.img + " " + v.name : "—") + " → " + (cust ? cust.name : "—")),
      el("div", { class: "small muted" }, o.items.reduce((s, l) => s + l.qty, 0) + " items · " + money(o.total)),
      best
        ? el("div", { class: "small", style: "margin:8px 0;color:var(--green)" }, "Suggested: " + best.name + " (" + best.dist.toFixed(1) + " km)")
        : el("div", { class: "small", style: "margin:8px 0;color:var(--red)" }, "No Saradhis available"),
      el("div", { class: "row", style: "gap:8px;margin-top:6px" }, [
        sel,
        el("button", { class: "btn primary sm", onClick: async () => {
          try { await BW.assignRider(o.id, sel.value); toast("Assigned"); }
          catch (err) { toast("Error: " + err.message); }
        } }, "Assign"),
      ]),
    ]);
  }

  function openReassign(o) {
    const sel = el("select", {});
    BW.riders().forEach((r) => {
      const opt = el("option", { value: r.id }, r.name + (r.status === "available" ? "" : " (" + r.status.replace("_", " ") + ")"));
      if (r.id === o.riderId) opt.selected = true;
      sel.appendChild(opt);
    });
    const close = UI.modal({
      title: "Reassign #" + o.id.slice(-6).toUpperCase(),
      body: el("div", { class: "field" }, [el("label", {}, "Saradhi"), sel]),
      footer: [
        el("button", { class: "btn ghost", onClick: () => close() }, "Cancel"),
        el("button", { class: "btn primary", onClick: async () => {
          try { await BW.assignRider(o.id, sel.value); toast("Reassigned"); close(); }
          catch (err) { toast("Error: " + err.message); }
        } }, "Save"),
      ],
    });
  }

  function bestRider(vendor) {
    if (!vendor) return null;
    const avail = BW.riders().filter((r) => r.status === "available");
    if (!avail.length) return null;
    return avail
      .map((r) => ({ ...r, dist: haversine(r.lat, r.lng, vendor.lat, vendor.lng) }))
      .sort((a, b) => a.dist - b.dist)[0];
  }

  async function autoAssignAll() {
    const unassigned = BW.orders().filter((o) => !o.riderId && ![S.DELIVERED, S.CANCELLED].includes(o.status));
    let n = 0;
    for (const o of unassigned) {
      const v = BW.vendor(o.vendorId);
      const best = bestRider(v);
      if (best) {
        try { await BW.assignRider(o.id, best.id); n++; } catch {}
      }
    }
    toast(n ? "Auto-assigned " + n + " order(s) to Saradhis" : "No available Saradhis");
  }

  /* ====================== VENDORS ====================== */
  // APP_BASE is the Firebase Hosting origin — scan page lives here, not on the backend
  const APP_BASE = window.location.origin;

  function storeQrUrl(vendorId) {
    return "https://api.qrserver.com/v1/create-qr-code/?size=300x300&ecc=M&format=png&data="
      + encodeURIComponent(APP_BASE + "/scan/?v=" + vendorId);
  }

  function viewVendors() {
    const vendors = BW.vendors();
    const orders  = BW.orders();
    const rows = vendors.map((v) => {
      const isPending = v.status === "pending_setup" || !v.active;
      const vOrders = orders.filter((o) => o.vendorId === v.id);
      const rev = vOrders.filter((o) => o.status !== S.CANCELLED).reduce((s, o) => s + o.total, 0);
      const displayName = v.name ? v.name : el("span", { class: "muted small" }, "(store not set up yet)");
      return el("tr", {}, [
        el("td", {}, [
          el("div", { style: "display:flex;align-items:center;gap:10px" }, [
            el("div", { class: "vendor-initial", style: "width:32px;height:32px;font-size:14px;border-radius:8px" }, (v.name || "?")[0].toUpperCase()),
            el("div", {}, [
              el("strong", {}, displayName),
              isPending ? el("span", { style: "display:inline-block;margin-left:8px;font-size:11px;background:var(--surface-2);border:1px solid var(--border);border-radius:4px;padding:1px 6px;color:var(--muted)" }, "Pending setup") : document.createTextNode(""),
            ]),
          ]),
        ]),
        el("td", { class: "muted" }, v.category || "—"),
        el("td", { class: "muted" }, v.area || "—"),
        el("td", {}, isPending ? el("span", { class: "muted" }, "—") : BW.products(v.id).length + " items"),
        el("td", {}, String(vOrders.length)),
        el("td", {}, money(rev)),
        el("td", {}, [
          el("button", { class: "btn ghost sm", style: "margin-right:6px", onClick: () => showStoreQR(v) }, "QR"),
          el("button", { class: "btn ghost sm", style: "margin-right:6px", onClick: () => editVendorDetails(v) }, "Edit"),
          el("button", { class: "btn danger sm", onClick: () => deleteStore(v) }, "Delete"),
        ]),
      ]);
    });

    shell("vendors", [
      el("div", { class: "row between", style: "margin-bottom:20px;flex-wrap:wrap;gap:12px" }, [
        el("div", {}, [
          el("h1", { class: "page-title" }, "Stores"),
          el("p", { class: "page-sub", style: "margin:0" }, "Create and manage merchant stores. Each store gets a unique QR code."),
        ]),
        el("button", { class: "btn primary", onClick: createStore }, "+ Create Store"),
      ]),
      vendors.length === 0
        ? el("div", { class: "empty" }, [el("div", { class: "e" }, ""), "No stores yet. Create one to get started."])
        : el("div", { class: "card", style: "padding:0;overflow:hidden" }, [
            el("table", {}, [
              el("thead", {}, el("tr", {}, ["Store", "Category", "Area", "Catalog", "Orders", "Revenue", "Actions"].map((h) => el("th", {}, h)))),
              el("tbody", {}, rows),
            ]),
          ]),
    ]);
  }

  function createStore() {
    const nameEl  = el("input", { placeholder: "e.g. Ravi (merchant's name)" });
    const emailEl = el("input", { type: "email", placeholder: "merchant@example.com" });
    const passEl  = el("input", { type: "text", value: genPass(), placeholder: "Set a password" });
    const errEl   = el("div", { class: "auth-err" });

    const body = el("div", {}, [
      el("p", { class: "muted small", style: "margin:0 0 16px" }, "Creates a merchant account. The merchant will set up their store name, location and products after logging in."),
      el("div", { class: "field" }, [el("label", {}, "Merchant name"), nameEl]),
      el("div", { class: "field" }, [el("label", {}, "Login email"), emailEl]),
      el("div", { class: "field" }, [
        el("label", {}, "Password"),
        el("div", { style: "display:flex;gap:8px" }, [
          passEl,
          el("button", { class: "btn ghost sm", type: "button", onClick: () => { passEl.value = genPass(); } }, "New"),
        ]),
      ]),
      errEl,
    ]);

    const close = UI.modal({
      title: "Create Merchant Account",
      body,
      footer: [
        el("button", { class: "btn ghost", onClick: () => close() }, "Cancel"),
        el("button", { class: "btn primary", onClick: async () => {
          errEl.textContent = "";
          if (!nameEl.value.trim()) { errEl.textContent = "Merchant name required."; return; }
          if (!emailEl.value.trim()) { errEl.textContent = "Login email required."; return; }
          if (passEl.value.length < 6) { errEl.textContent = "Password must be at least 6 characters."; return; }
          try {
            const result = await BW.createMerchant({
              merchantName: nameEl.value.trim(),
              email: emailEl.value.trim().toLowerCase(),
              password: passEl.value,
            });
            close();
            showCreatedStore(result);
            await BW.init("admin"); // refresh vendor cache so new pending store appears immediately
            go("vendors");
          } catch (err) { errEl.textContent = err.message || "Failed to create account."; }
        }}, "Create Account"),
      ],
    });
  }

  function showCreatedStore(result) {
    const { vendorId, email, password, merchantName } = result;
    const qrSrc = storeQrUrl(vendorId);
    const scanUrl = APP_BASE + "/scan/?v=" + vendorId;
    const credText = `Email: ${email}\nPassword: ${password}`;

    const close = UI.modal({
      title: "Account Created",
      body: el("div", { style: "text-align:center" }, [
        el("p", { class: "muted small", style: "margin:0 0 16px" }, "Share these login credentials with " + merchantName + ". They will set up their store after logging in."),
        el("img", { src: qrSrc, width: "200", height: "200", style: "display:block;margin:0 auto 16px;border-radius:10px" }),
        el("div", { style: "background:var(--surface-2);border:1px solid var(--border);border-radius:10px;padding:14px;text-align:left;font-size:13px;line-height:1.8;margin-bottom:12px" }, [
          el("div", {}, [el("span", { class: "muted" }, "Merchant: "), el("strong", {}, merchantName)]),
          el("div", {}, [el("span", { class: "muted" }, "Email: "), el("strong", {}, email)]),
          el("div", {}, [el("span", { class: "muted" }, "Password: "), el("strong", { style: "font-family:monospace;letter-spacing:1px" }, password)]),
        ]),
        el("div", { style: "display:flex;gap:8px;justify-content:center;flex-wrap:wrap" }, [
          el("button", { class: "btn ghost sm", onClick: () => navigator.clipboard?.writeText(credText).then(() => toast("Credentials copied!")) }, "Copy credentials"),
          el("a", { class: "btn ghost sm", href: qrSrc, download: merchantName.replace(/\s+/g, "_") + "_QR.png" }, "Download QR"),
        ]),
        el("p", { class: "muted small", style: "margin-top:14px;word-break:break-all" }, scanUrl),
      ]),
      footer: [el("button", { class: "btn primary", onClick: () => close() }, "Done")],
    });
  }

  function showStoreQR(v) {
    const qrSrc = storeQrUrl(v.id);
    const scanUrl = APP_BASE + "/scan/?v=" + v.id;
    UI.modal({
      title: v.name + " — QR Code",
      body: el("div", { style: "text-align:center" }, [
        el("img", { src: qrSrc, width: "220", height: "220", style: "display:block;margin:0 auto 14px;border-radius:10px" }),
        el("p", { class: "muted small", style: "word-break:break-all;margin:0" }, scanUrl),
        el("div", { style: "display:flex;gap:8px;justify-content:center;margin-top:12px" }, [
          el("button", { class: "btn ghost sm", onClick: () => navigator.clipboard?.writeText(scanUrl).then(() => toast("Link copied!")) }, "Copy link"),
          el("a", { class: "btn ghost sm", href: qrSrc, download: v.name.replace(/\s+/g, "_") + "_QR.png" }, "Download"),
        ]),
      ]),
      footer: [],
    });
  }

  function editVendorDetails(v) {
    const nameEl = el("input", { value: v.name });
    const catEl  = el("input", { value: v.category });
    const areaEl = el("input", { value: v.area });
    const close = UI.modal({
      title: "Edit Store",
      body: el("div", {}, [
        el("div", { class: "field" }, [el("label", {}, "Name"), nameEl]),
        el("div", { class: "field" }, [el("label", {}, "Category"), catEl]),
        el("div", { class: "field" }, [el("label", {}, "Area"), areaEl]),
      ]),
      footer: [
        el("button", { class: "btn ghost", onClick: () => close() }, "Cancel"),
        el("button", { class: "btn primary", onClick: async () => {
          try {
            await BW.upsertVendor({ id: v.id, name: nameEl.value.trim(), category: catEl.value.trim(), area: areaEl.value.trim(), img: "", rating: v.rating, prepMins: v.prepMins, lat: v.lat, lng: v.lng });
            toast("Store updated"); close(); go("vendors");
          } catch (err) { toast("Error: " + err.message); }
        }}, "Save"),
      ],
    });
  }

  function deleteStore(v) {
    const close = UI.modal({
      title: "Delete Store",
      body: el("p", { style: "color:var(--red)" }, `Delete "${v.name}" and its merchant account? This cannot be undone.`),
      footer: [
        el("button", { class: "btn ghost", onClick: () => close() }, "Cancel"),
        el("button", { class: "btn danger", onClick: async () => {
          try { await BW.deleteMerchant(v.id); toast("Store deleted"); close(); go("vendors"); }
          catch (err) { toast("Error: " + err.message); }
        }}, "Delete"),
      ],
    });
  }


  function createRider() {
    const nameEl    = el("input", { placeholder: "e.g. Ajay Kumar" });
    const emailEl   = el("input", { type: "email", placeholder: "rider@example.com" });
    const passEl    = el("input", { type: "text", value: genPass(), placeholder: "Set a password" });
    const vehicleEl = el("select", {});
    ["Bike", "Bicycle", "Scooter", "Van"].forEach((v) => vehicleEl.appendChild(el("option", { value: v }, v)));
    const shiftEl   = el("select", {});
    ["Morning", "Afternoon", "Evening", "Night"].forEach((s) => shiftEl.appendChild(el("option", { value: s }, s)));
    const errEl     = el("div", { class: "auth-err" });

    const body = el("div", {}, [
      el("p", { class: "muted small", style: "margin:0 0 16px" }, "Creates a Saradhi (rider) account. They can log in to the rider app immediately."),
      el("div", { class: "field" }, [el("label", {}, "Full name"), nameEl]),
      el("div", { class: "field" }, [el("label", {}, "Login email"), emailEl]),
      el("div", { class: "field" }, [
        el("label", {}, "Password"),
        el("div", { style: "display:flex;gap:8px" }, [
          passEl,
          el("button", { class: "btn ghost sm", type: "button", onClick: () => { passEl.value = genPass(); } }, "New"),
        ]),
      ]),
      el("div", { class: "grid cols-2", style: "gap:12px" }, [
        el("div", { class: "field" }, [el("label", {}, "Vehicle"), vehicleEl]),
        el("div", { class: "field" }, [el("label", {}, "Shift"), shiftEl]),
      ]),
      errEl,
    ]);

    const close = UI.modal({
      title: "Add Saradhi",
      body,
      footer: [
        el("button", { class: "btn ghost", onClick: () => close() }, "Cancel"),
        el("button", { class: "btn primary", onClick: async () => {
          errEl.textContent = "";
          if (!nameEl.value.trim())  { errEl.textContent = "Name required."; return; }
          if (!emailEl.value.trim()) { errEl.textContent = "Email required."; return; }
          if (passEl.value.length < 6) { errEl.textContent = "Password must be at least 6 characters."; return; }
          try {
            const result = await BW.createRider({
              name: nameEl.value.trim(),
              email: emailEl.value.trim().toLowerCase(),
              password: passEl.value,
              vehicle: vehicleEl.value,
              shift: shiftEl.value,
            });
            close();
            showCreatedRider(result);
            await BW.init("admin");
            go("fleet");
          } catch (err) { errEl.textContent = err.message || "Failed to create rider."; }
        }}, "Create Saradhi"),
      ],
    });
  }

  function showCreatedRider(result) {
    const { name, email, password } = result;
    const credText = `Email: ${email}\nPassword: ${password}`;
    const close = UI.modal({
      title: "Saradhi Account Created",
      body: el("div", {}, [
        el("p", { class: "muted small", style: "margin:0 0 16px" }, "Share these credentials with " + name + " to log in to the Saradhi app."),
        el("div", { style: "background:var(--surface-2);border:1px solid var(--border);border-radius:10px;padding:14px;font-size:13px;line-height:1.8;margin-bottom:12px" }, [
          el("div", {}, [el("span", { class: "muted" }, "Name: "), el("strong", {}, name)]),
          el("div", {}, [el("span", { class: "muted" }, "Email: "), el("strong", {}, email)]),
          el("div", {}, [el("span", { class: "muted" }, "Password: "), el("strong", { style: "font-family:monospace;letter-spacing:1px" }, password)]),
        ]),
        el("button", { class: "btn ghost sm", onClick: () => navigator.clipboard?.writeText(credText).then(() => toast("Credentials copied!")) }, "Copy credentials"),
      ]),
      footer: [el("button", { class: "btn primary", onClick: () => close() }, "Done")],
    });
  }

  function genPass() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
    return Array.from({ length: 10 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  }

  /* ====================== ANALYTICS ====================== */
  function viewAnalytics() {
    const a = BW.analytics() || {};
    const vendors = BW.vendors();
    const revenueByVendor = a.revenueByVendor || {};
    const maxRev = Math.max(1, ...Object.values(revenueByVendor));

    const bars = vendors.map((v) => {
      const rev = revenueByVendor[v.id] || 0;
      const pct = (rev / maxRev) * 100;
      return el("div", { style: "margin-bottom:14px" }, [
        el("div", { class: "row between small", style: "margin-bottom:4px" }, [
          el("span", {}, v.img + " " + v.name), el("strong", {}, money(rev)),
        ]),
        el("div", { style: "height:12px;background:var(--surface-2);border-radius:999px;overflow:hidden" }, [
          el("div", { style: `height:100%;width:${pct}%;background:linear-gradient(90deg,var(--brand),var(--brand-2))` }),
        ]),
      ]);
    });

    const dist = a.statusDistribution || {};
    const STATUS_LABEL = BW.STATUS_LABEL;
    const distRows = Object.keys(STATUS_LABEL).filter((s) => dist[s]).map((s) =>
      el("div", { class: "row between", style: "padding:7px 0;border-bottom:1px solid var(--border)" }, [
        statusBadge(s), el("strong", {}, String(dist[s])),
      ]));

    const stat = (k, v) => el("div", { class: "card stat" }, [el("span", { class: "k" }, k), el("span", { class: "v" }, v)]);

    shell("analytics", [
      el("h1", { class: "page-title" }, "Analytics & Reporting"),
      el("p", { class: "page-sub" }, "Platform performance across vendors, orders and revenue."),
      el("div", { class: "grid cols-4" }, [
        stat("Gross revenue",   money(Math.round(a.revenue || 0))),
        stat("Orders",          String(a.totalOrders || 0)),
        stat("Avg order value", money(Math.round(a.avgOrderValue || 0))),
        stat("Fulfilment",      a.totalOrders ? Math.round(((a.deliveredOrders || 0) / a.totalOrders) * 100) + "%" : "—"),
      ]),
      el("div", { class: "grid cols-2", style: "margin-top:16px" }, [
        el("div", { class: "card" }, [el("h3", { style: "margin-top:0" }, "Revenue by vendor"), bars.length ? el("div", {}, bars) : el("div", { class: "muted small" }, "No data yet.")]),
        el("div", { class: "card" }, [el("h3", { style: "margin-top:0" }, "Order status distribution"), ...distRows]),
      ]),
    ]);
  }

  function haversine(la1, lo1, la2, lo2) {
    if (!la1 || !lo1 || !la2 || !lo2) return Infinity;
    const R = 6371, toR = (d) => (d * Math.PI) / 180;
    const dLa = toR(la2 - la1), dLo = toR(lo2 - lo1);
    const a = Math.sin(dLa / 2) ** 2 + Math.cos(toR(la1)) * Math.cos(toR(la2)) * Math.sin(dLo / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function render() {
    switch (state.route) {
      case "fleet":     return viewFleet();
      case "assign":    return viewAssign();
      case "vendors":   return viewVendors();
      case "analytics": return viewAnalytics();
      case "monitor":   return viewMonitor();
      default:          return viewOverview();
    }
  }

  /* ====================== MONITOR ====================== */
  function viewMonitor() {
    const monState = { tab: viewMonitor._tab || "logins" };
    viewMonitor._tab = monState.tab;

    function setTab(t) { viewMonitor._tab = t; render(); }

    function tabBtn(id, label) {
      return el("button", {
        class: "btn " + (monState.tab === id ? "primary sm" : "ghost sm"),
        onClick: () => setTab(id),
      }, label);
    }

    const tabs = el("div", { style: "display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap" }, [
      tabBtn("logins",    "Logins"),
      tabBtn("orders",    "Orders"),
      tabBtn("customers", "Customers"),
      tabBtn("payments",  "Payments"),
    ]);

    let body;
    if (monState.tab === "logins")         body = renderLoginLogs();
    else if (monState.tab === "orders")    body = renderAllOrders();
    else if (monState.tab === "customers") body = renderAllCustomers();
    else                                   body = renderPayments();

    const refreshBtn = el("button", { class: "btn ghost sm", style: "margin-left:auto", onClick: async () => {
      try { await BW.refreshLogins(); } catch {}
    } }, "↻ Refresh");

    shell("monitor", [
      el("div", { class: "row between", style: "align-items:center;margin-bottom:4px" }, [
        el("div", {}, [
          el("h1", { class: "page-title" }, "Platform Monitor"),
          el("p", { class: "page-sub" }, "Full visibility across all users, orders, and activity."),
        ]),
        refreshBtn,
      ]),
      tabs,
      body,
    ]);
  }
  viewMonitor._tab = "logins";

  function renderLoginLogs() {
    const logs = BW.logins();
    if (!logs.length) {
      return el("div", { class: "card" }, [
        el("p", { class: "muted", style: "text-align:center;padding:24px" }, "No login events recorded yet."),
      ]);
    }
    const rows = logs.map((l) => el("tr", {}, [
      el("td", { class: "muted small" }, clockTime(l.at)),
      el("td", {}, l.email || "—"),
      el("td", {}, el("span", { class: "badge " + l.role }, l.role)),
      el("td", { class: "muted small" }, l.method || "email"),
      el("td", { class: "muted small" }, l.ip || "—"),
    ]));
    return el("div", { class: "card", style: "padding:0;overflow:hidden" }, [
      el("table", {}, [
        el("thead", {}, el("tr", {}, ["Time", "Email", "Role", "Method", "IP"].map((h) => el("th", {}, h)))),
        el("tbody", {}, rows),
      ]),
    ]);
  }

  function renderAllOrders() {
    const orders = BW.orders();
    if (!orders.length) {
      return el("div", { class: "card" }, [el("p", { class: "muted", style: "text-align:center;padding:24px" }, "No orders yet.")]);
    }
    const rows = orders.map((o) => {
      const v     = BW.vendor(o.vendorId);
      const cust  = BW.customers().find((c) => c.id === o.customerId);
      const rider = o.riderId ? BW.riders().find((r) => r.id === o.riderId) : null;
      const hist  = o.history || [];
      const first = hist[0] ? new Date(hist[0].at) : null;
      const last  = hist[hist.length - 1] ? new Date(hist[hist.length - 1].at) : null;
      const dur   = (first && last && last > first)
        ? Math.round((last - first) / 60000) + " min"
        : "—";
      return el("tr", {}, [
        el("td", {}, el("strong", {}, "#" + o.id.slice(-6).toUpperCase())),
        el("td", { class: "muted small" }, clockTime(o.createdAt)),
        el("td", {}, v ? v.name : "—"),
        el("td", {}, cust ? cust.name : "—"),
        el("td", {}, money(o.total)),
        el("td", {}, statusBadge(o.status)),
        el("td", {}, rider ? rider.name : el("span", { class: "muted" }, "—")),
        el("td", { class: "muted small" }, dur),
      ]);
    });
    return el("div", { class: "card", style: "padding:0;overflow:hidden" }, [
      el("table", {}, [
        el("thead", {}, el("tr", {}, ["Order", "Placed at", "Vendor", "Customer", "Total", "Status", "Saradhi", "Duration"].map((h) => el("th", {}, h)))),
        el("tbody", {}, rows),
      ]),
    ]);
  }

  function renderAllCustomers() {
    const customers = BW.customers();
    const allUsers  = BW.allUsers().filter((u) => u.role === "customer");
    const orders    = BW.orders();
    if (!customers.length) {
      return el("div", { class: "card" }, [el("p", { class: "muted", style: "text-align:center;padding:24px" }, "No customers yet.")]);
    }
    const rows = customers.map((c) => {
      const user  = allUsers.find((u) => u.uid === c.userId);
      const cOrds = orders.filter((o) => o.customerId === c.id);
      const spent = cOrds.filter((o) => o.status === "DELIVERED").reduce((s, o) => s + (o.total || 0), 0);
      return el("tr", {}, [
        el("td", {}, el("strong", {}, c.name)),
        el("td", { class: "muted small" }, user ? user.email : "—"),
        el("td", { class: "muted small" }, user ? (user.authProvider === "google" ? "Google" : "Email") : "—"),
        el("td", {}, c.address || el("span", { class: "muted" }, "—")),
        el("td", {}, String(cOrds.length)),
        el("td", {}, money(spent)),
        el("td", { class: "muted small" }, c.joined || "—"),
      ]);
    });
    return el("div", { class: "card", style: "padding:0;overflow:hidden" }, [
      el("table", {}, [
        el("thead", {}, el("tr", {}, ["Name", "Email", "Auth", "Address", "Orders", "Spent", "Joined"].map((h) => el("th", {}, h)))),
        el("tbody", {}, rows),
      ]),
    ]);
  }

  function renderPayments() {
    const orders    = BW.orders();
    const delivered = orders.filter((o) => o.status === "DELIVERED");
    const totalRev  = delivered.reduce((s, o) => s + (o.total || 0), 0);
    const totalFees = delivered.reduce((s, o) => s + (o.deliveryFee || 0), 0);

    const stat = (k, v, sub) => el("div", { class: "card stat" }, [
      el("span", { class: "k" }, k),
      el("span", { class: "v" }, v),
      sub ? el("span", { class: "d" }, sub) : document.createTextNode(""),
    ]);

    const rows = orders.slice(0, 100).map((o) => {
      const v    = BW.vendor(o.vendorId);
      const cust = BW.customers().find((c) => c.id === o.customerId);
      const payStatus = o.status === "DELIVERED" ? "Paid" :
        o.status === "CANCELLED" ? "Cancelled" : "Pending";
      return el("tr", {}, [
        el("td", {}, el("strong", {}, "#" + o.id.slice(-6).toUpperCase())),
        el("td", { class: "muted small" }, clockTime(o.createdAt)),
        el("td", {}, cust ? cust.name : "—"),
        el("td", {}, v ? v.name : "—"),
        el("td", {}, money(o.subtotal || 0)),
        el("td", {}, money(o.deliveryFee || 0)),
        el("td", {}, el("strong", {}, money(o.total || 0))),
        el("td", {}, payStatus),
      ]);
    });

    return el("div", {}, [
      el("div", { class: "grid cols-4", style: "margin-bottom:16px" }, [
        stat("Gross revenue",   money(totalRev),  delivered.length + " orders"),
        stat("Delivery fees",   money(totalFees), "collected"),
        stat("Vendor payouts",  money(totalRev - totalFees), "excl. fees"),
        stat("Avg order value", delivered.length ? money(Math.round(totalRev / delivered.length)) : "—", ""),
      ]),
      el("div", { class: "card", style: "padding:0;overflow:hidden" }, [
        el("table", {}, [
          el("thead", {}, el("tr", {}, ["Order", "Date", "Customer", "Vendor", "Subtotal", "Delivery fee", "Total", "Payment"].map((h) => el("th", {}, h)))),
          el("tbody", {}, rows),
        ]),
      ]),
    ]);
  }

  boot().catch((err) => {
    console.error("Boot failed:", err);
    root.innerHTML = `<div class="bw-loading" style="color:var(--red)">Failed to connect to server. Is the backend running?</div>`;
  });
})();
