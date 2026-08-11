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
      navItem("analytics", "An", "Analytics"),
      navItem("earnings",  "₹",  "Earnings"),
      navItem("customers", "Cu", "Customers"),
      navItem("vendors",   "Ve", "Stores"),
      navItem("partners",  "Pa", "Partners"),
      navItem("services",  "Sv", "Services"),
      navItem("fleet",     "Sa", "Saradhis"),
      navItem("settings",  "Se", "Settings"),
      navItem("monitor",   "Mo", "Monitor"),
    ]);
    root.appendChild(el("div", { class: "app" }, [nav, el("div", { class: "content" }, body)]));

    // Bottom nav (mobile only)
    root.appendChild(el("div", { class: "bottom-nav" }, [
      bnItem("overview",  "Ov", "Overview"),
      bnItem("fleet",     "Sa", "Saradhis"),
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
        el("td", {}, el("strong", {}, "#" + (o.orderNo || o.id.slice(-6).toUpperCase()))),
        el("td", {}, v ? v.img + " " + v.name : "—"),
        el("td", {}, cust ? cust.name : "—"),
        el("td", {}, money(o.total)),
        el("td", {}, statusBadge(o.status)),
        el("td", {}, rider ? rider.name : el("span", { class: "muted" }, "unassigned")),
        el("td", { class: "muted small" }, timeAgo(o.createdAt)),
      ]);
    });

    const O = computeAnalytics();
    shell("overview", [
      el("h1", { class: "page-title" }, "Platform Overview"),
      el("p", { class: "page-sub" }, "Live snapshot across all stores and Saradhis."),
      el("div", { class: "grid cols-4" }, [
        stat("Total orders",  String(O.totalOrders), "+" + O.active + " active"),
        stat("Revenue",       money(Math.round(O.revenue)), "avg " + money(Math.round(O.aov))),
        stat("Delivered",     String(O.delivered), Math.round(O.fulfilRate * 100) + "% fulfilment"),
        stat("Customers",     String(O.totalCustomers), "+" + O.newToday + " today"),
      ]),
      el("div", { class: "grid cols-4", style: "margin-top:14px" }, [
        stat("GMV",           money(Math.round(O.gmv)), "merchandise value"),
        stat("Cancelled",     String(O.cancelled), Math.round(O.cancelRate * 100) + "% rate"),
        stat("Repeat rate",   Math.round(O.repeatRate * 100) + "%", "returning buyers"),
        stat("Saradhis online", O.ridersOnline + " / " + riders.length, ""),
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

    let map;
    const gmMarkers = riders.filter((r) => r.lat && r.lng).map((r) => ({ lat: r.lat, lng: r.lng, label: r.name, icon: "chariot" }));
    const gm = UI.gmap ? UI.gmap({ markers: gmMarkers, height: 380 }) : null;
    if (gm) {
      map = gm;
    } else {
      map = el("div", { class: "map", style: "height:380px" });
      riders.forEach((r) => {
        if (!r.lat || !r.lng) return;
        const { x, y } = project(r.lat, r.lng);
        const statusCls = r.status === "available" ? "pin-available" : r.status === "on_delivery" ? "pin-busy" : "pin-offline";
        map.appendChild(el("div", { class: "pin " + statusCls, style: `left:${x}%;top:${y}%` }, [
          el("div", { class: "head" }, "R"),
          el("div", { class: "lbl small" }, r.name.split(" ")[0]),
        ]));
      });
    }

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
        el("td", {}, [
          el("strong", {}, r.name),
          (r.active === false) ? el("span", { style: "margin-left:6px;font-size:11px;color:var(--red);font-weight:700" }, "SUSPENDED") : document.createTextNode(""),
          el("div", { style: "display:flex;gap:6px;margin-top:4px" }, [
            el("button", { class: "btn ghost sm", onClick: () => editRiderModal(r) }, "✏️ Edit"),
            el("button", { class: "btn ghost sm", onClick: () => deleteRiderFlow(r) }, "🗑"),
          ]),
        ]),
        el("td", { class: "muted small" }, r.vehicle || "—"),
        el("td", {}, "⭐ " + r.rating),
        el("td", {}, r.deliveriesToday + " today"),
        el("td", { style: (r.cashInHand || 0) >= (BW.codCashLimit ? BW.codCashLimit() : 2000) ? "color:var(--red);font-weight:700" : "" }, money(r.cashInHand || 0)),
        el("td", {}, riderKyc(r)),
        el("td", {}, active ? "#" + (active.orderNo || active.id.slice(-6).toUpperCase()) : el("span", { class: "muted" }, "—")),
        el("td", {}, statusSel),
      ]);
    });

    shell("fleet", [
      el("div", { class: "row between", style: "margin-bottom:4px" }, [
        el("div", {}, [
          el("h1", { class: "page-title", style: "margin:0" }, "Saradhis"),
          el("p", { class: "page-sub", style: "margin:4px 0 0" }, "On-demand Saradhis. Monitor live location, manage and assign."),
        ]),
        el("button", { class: "btn primary", onClick: createRider }, "+ Add Saradhi"),
      ]),
      el("div", { class: "card" }, [
        el("div", { class: "row between" }, [
          el("h3", { style: "margin:0" }, "Live map"),
          el("div", { class: "row small muted", style: "gap:12px" }, [
            el("span", { class: "fleet-legend fleet-legend--available" }, "Available"),
            el("span", { class: "fleet-legend fleet-legend--busy" }, "On delivery"),
            el("span", { class: "fleet-legend fleet-legend--offline" }, "Offline"),
          ]),
        ]),
        el("div", { style: "margin-top:12px" }, map),
      ]),
      // Full-width, horizontally-scrollable table so every column and the Edit/Delete
      // and Status controls stay reachable on any screen width.
      el("div", { class: "card", style: "padding:0;margin-top:16px;overflow-x:auto" }, [
        el("table", { style: "min-width:820px" }, [
          el("thead", {}, el("tr", {}, ["Saradhi", "Vehicle", "Rating", "Deliveries", "Cash", "KYC", "Active", "Status"].map((h) => el("th", {}, h)))),
          el("tbody", {}, rows),
        ]),
      ]),
    ]);
  }

  // Compact KYC cell for the fleet table: status pill, document links, verify/reject.
  function riderKyc(r) {
    const d = r.documents || {};
    const status = r.kycStatus || (d.dlUrl && d.aadhaarUrl && d.familyIdUrl ? "submitted" : "pending");
    const pillColor = status === "verified" ? "#1a9d54" : status === "submitted" ? "#c77700" : status === "rejected" ? "var(--red)" : "#888";
    const wrap = el("div", { style: "display:flex;flex-direction:column;gap:4px;min-width:120px" });
    wrap.appendChild(el("span", { style: "font-weight:700;font-size:12px;color:" + pillColor }, status.toUpperCase()));
    const links = [];
    if (d.dlUrl) links.push(el("a", { href: d.dlUrl, target: "_blank", rel: "noopener", class: "small", title: "DL " + (d.dlNumber || "") }, "DL"));
    if (d.aadhaarUrl) links.push(el("a", { href: d.aadhaarUrl, target: "_blank", rel: "noopener", class: "small" }, "Aadhaar"));
    if (d.bikePhotoUrl) links.push(el("a", { href: d.bikePhotoUrl, target: "_blank", rel: "noopener", class: "small" }, "Bike"));
    if (d.familyIdUrl) links.push(el("a", { href: d.familyIdUrl, target: "_blank", rel: "noopener", class: "small", title: "Nominee: " + (d.familyName || "") + " · " + (d.familyRelation || "") }, "Nominee ID"));
    if (links.length) {
      const row = el("div", { style: "display:flex;gap:8px;flex-wrap:wrap" });
      links.forEach((l) => row.appendChild(l));
      wrap.appendChild(row);
    } else {
      wrap.appendChild(el("span", { class: "muted small" }, "No docs"));
    }
    if (d.vehicleNumber) wrap.appendChild(el("div", { class: "muted small" }, "🏍 " + d.vehicleNumber + (d.vehicleType ? " · " + d.vehicleType : "")));
    if (d.riderPhone || d.riderAddress) wrap.appendChild(el("div", { class: "muted small", title: d.riderAddress || "" }, "☎ " + (d.riderPhone || "—")));
    if (d.aadhaarLast4) wrap.appendChild(el("div", { class: "muted small" }, "Aadhaar ••••" + d.aadhaarLast4));
    if (d.familyName) wrap.appendChild(el("div", { class: "muted small", title: (d.familyAddress || "") }, "Nominee: " + d.familyName + (d.familyPhone ? " · " + d.familyPhone : "") + (d.nomineeAadhaarLast4 ? " · ••••" + d.nomineeAadhaarLast4 : "")));
    if (r.agreement && r.agreement.acceptedAt) wrap.appendChild(el("div", { class: "small", style: "color:#1a9d54", title: "Signed " + r.agreement.acceptedAt + " · IP " + (r.agreement.ip || "?") }, "✓ Agreement signed by " + r.agreement.fullName));

    // Per-item verification (offline decisions + optional online check).
    if (status !== "pending") {
      const v = r.verification || {};
      const itemRow = (label, key, online) => {
        const s = v[key] && v[key].status;
        const color = s === "verified" ? "#1a9d54" : s === "rejected" ? "var(--red)" : "#888";
        const state = el("span", { class: "small", style: "min-width:64px;color:" + color }, s ? s : "pending");
        const ok = el("button", { class: "btn success sm", title: "Mark " + label + " verified", onClick: async () => { try { await BW.verifyRiderItem(r.id, key, "verified"); toast(label + " verified"); } catch (e) { toast(e.message); } } }, "✓");
        const no = el("button", { class: "btn ghost sm", title: "Reject " + label, onClick: async () => { const notes = prompt("Reason for rejecting " + label + " (optional):") || ""; try { await BW.verifyRiderItem(r.id, key, "rejected", notes); toast(label + " rejected"); } catch (e) { toast(e.message); } } }, "✗");
        const kids = [el("span", { class: "small", style: "min-width:74px" }, label), state, ok, no];
        if (online) kids.push(el("button", { class: "btn ghost sm", title: "Run automated online check", onClick: async () => { try { const out = await BW.verifyRiderOnline(r.id, key); const rr = out.result || {}; toast(rr.status === "manual_required" ? "No KYC provider configured — verify manually" : (label + ": " + rr.status)); } catch (e) { toast(e.message); } } }, "⟳ online"));
        return el("div", { style: "display:flex;gap:6px;align-items:center;margin-top:4px" }, kids);
      };
      const panel = el("div", { style: "margin-top:6px;border-top:1px dashed var(--border,#ddd);padding-top:6px" }, [
        itemRow("DL", "dl", true),
        itemRow("Vehicle", "rc", true),
        itemRow("Aadhaar", "aadhaar", true),
        itemRow("Nominee", "nominee", false),
      ]);
      wrap.appendChild(panel);
    }
    return wrap;
  }

  /* ====================== TASK ASSIGNMENT ====================== */



  function bestRider(vendor) {
    if (!vendor) return null;
    const avail = BW.riders().filter((r) => r.status === "available");
    if (!avail.length) return null;
    return avail
      .map((r) => ({ ...r, dist: haversine(r.lat, r.lng, vendor.lat, vendor.lng) }))
      .sort((a, b) => a.dist - b.dist)[0];
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
    const ownerEl = el("input", { placeholder: "e.g. Ravi Kumar (owner's name)" });
    const nameEl  = el("input", { placeholder: "e.g. Ravi Kirana Store (business name)" });
    const ownerPhoneEl = el("input", { type: "tel", placeholder: "Owner mobile (10-digit)" });
    const bizPhoneEl   = el("input", { type: "tel", placeholder: "Business/shop phone (optional)" });
    const emailEl = el("input", { type: "email", placeholder: "merchant@example.com" });
    const passEl  = el("input", { type: "text", value: genPass(), placeholder: "Set a password" });
    const errEl   = el("div", { class: "auth-err" });

    const body = el("div", {}, [
      el("p", { class: "muted small", style: "margin:0 0 16px" }, "Creates a merchant account. The merchant sets up store description, location, products and discounts after logging in."),
      el("div", { class: "field" }, [el("label", {}, "Owner name"), ownerEl]),
      el("div", { class: "field" }, [el("label", {}, "Business name"), nameEl]),
      el("div", { style: "display:flex;gap:10px" }, [
        el("div", { class: "field", style: "flex:1" }, [el("label", {}, "Owner phone"), ownerPhoneEl]),
        el("div", { class: "field", style: "flex:1" }, [el("label", {}, "Business phone"), bizPhoneEl]),
      ]),
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
          if (!nameEl.value.trim()) { errEl.textContent = "Business name required."; return; }
          if (!emailEl.value.trim()) { errEl.textContent = "Login email required."; return; }
          if (passEl.value.length < 6) { errEl.textContent = "Password must be at least 6 characters."; return; }
          try {
            const result = await BW.createMerchant({
              businessName: nameEl.value.trim(),
              ownerName: ownerEl.value.trim(),
              ownerPhone: ownerPhoneEl.value.trim(),
              businessPhone: bizPhoneEl.value.trim(),
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
    const rxEl   = el("input", { type: "checkbox" });
    rxEl.checked = !!v.requiresPrescription;
    const close = UI.modal({
      title: "Edit Store",
      body: el("div", {}, [
        el("div", { class: "field" }, [el("label", {}, "Name"), nameEl]),
        el("div", { class: "field" }, [el("label", {}, "Category"), catEl]),
        el("div", { class: "field" }, [el("label", {}, "Area"), areaEl]),
        el("label", { style: "display:flex;gap:8px;align-items:center;font-size:13px;margin-top:6px;cursor:pointer" }, [
          rxEl, el("span", {}, "💊 Pharmacy — require prescription + selfie for orders"),
        ]),
      ]),
      footer: [
        el("button", { class: "btn ghost", onClick: () => close() }, "Cancel"),
        el("button", { class: "btn primary", onClick: async () => {
          try {
            await BW.upsertVendor({ id: v.id, name: nameEl.value.trim(), category: catEl.value.trim(), area: areaEl.value.trim(), img: "", rating: v.rating, prepMins: v.prepMins, lat: v.lat, lng: v.lng, requiresPrescription: rxEl.checked });
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

  // Deleting rider accounts is not allowed from the admin UI to avoid
  // accidental data loss. Show an explanatory modal instead.
  function deleteRider(r) {
    UI.modal({
      title: "Delete Saradhi",
      body: el("div", {}, [
        el("p", { class: "muted" }, "Deleting Saradhi accounts is disabled from the admin panel to prevent accidental data loss."),
        el("p", { class: "muted small" }, "To deactivate a Saradhi, change their status to 'offline' or contact support for an account removal.")
      ]),
      footer: [ el("button", { class: "btn primary", onClick: () => {} }, "OK") ],
    });
  }


  function createRider() {
    const nameEl    = el("input", { placeholder: "e.g. Ajay Kumar" });
    const emailEl   = el("input", { type: "email", placeholder: "rider@example.com" });
    const passEl    = el("input", { type: "text", value: genPass(), placeholder: "Set a password" });
    const vehicleEl = el("select", {});
    ["Bike", "Bicycle", "Scooter", "Van"].forEach((v) => vehicleEl.appendChild(el("option", { value: v }, v)));
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
      el("div", { class: "field" }, [el("label", {}, "Vehicle"), vehicleEl]),
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

  function editRiderModal(r) {
    const nameEl    = el("input", { value: r.name || "" });
    const phoneEl   = el("input", { type: "tel", value: r.phone || "" });
    const vehicleEl = el("select", {});
    ["Bike", "Bicycle", "Scooter", "Van"].forEach((v) => vehicleEl.appendChild(el("option", { value: v, ...(r.vehicle === v ? { selected: "" } : {}) }, v)));
    const areaEl    = el("input", { value: r.area || "" });
    const activeCb  = el("input", { type: "checkbox" }); activeCb.checked = r.active !== false;
    const errEl     = el("div", { class: "auth-err" });
    const body = el("div", {}, [
      el("div", { class: "field" }, [el("label", {}, "Full name"), nameEl]),
      el("div", { class: "field" }, [el("label", {}, "Phone"), phoneEl]),
      el("div", { class: "field" }, [el("label", {}, "Vehicle"), vehicleEl]),
      el("div", { class: "field" }, [el("label", {}, "Area / zone"), areaEl]),
      el("label", { style: "display:flex;gap:8px;align-items:center;margin:6px 0" }, [activeCb, el("span", {}, "Active (unchecked = suspended, can't go on duty)")]),
      errEl,
    ]);
    const close = UI.modal({
      title: "Edit Saradhi · " + (r.name || ""),
      body,
      footer: [
        el("button", { class: "btn ghost", onClick: () => close() }, "Cancel"),
        el("button", { class: "btn primary", onClick: async () => {
          errEl.textContent = "";
          if (!nameEl.value.trim()) { errEl.textContent = "Name required."; return; }
          try {
            await BW.updateRiderDetails(r.id, { name: nameEl.value.trim(), phone: phoneEl.value.trim(), vehicle: vehicleEl.value, area: areaEl.value.trim(), active: activeCb.checked });
            close(); toast("Saradhi updated"); render();
          } catch (e) { errEl.textContent = e.message || "Failed to update."; }
        } }, "Save"),
      ],
    });
  }

  function deleteRiderFlow(r) {
    const close = UI.modal({
      title: "Delete Saradhi?",
      body: el("div", {}, [
        el("p", { class: "muted small" }, "This permanently removes " + (r.name || "this Saradhi") + " and their login. This can't be undone. (Blocked if they have an active delivery or unsettled cash.)"),
      ]),
      footer: [
        el("button", { class: "btn ghost", onClick: () => close() }, "Cancel"),
        el("button", { class: "btn danger", onClick: async () => {
          try { await BW.deleteRider(r.id); close(); toast("Saradhi removed"); render(); }
          catch (e) { toast(e.message || "Couldn't delete"); }
        } }, "Delete"),
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
  /* ── Chart.js helpers ── */
  let _charts = [];
  function destroyCharts() { _charts.forEach((c) => { try { c.destroy(); } catch (e) {} }); _charts = []; }
  function makeChart(canvas, config) { if (typeof Chart === "undefined" || !canvas) return null; try { const c = new Chart(canvas, config); _charts.push(c); return c; } catch (e) { return null; } }
  function baseOpts() { return { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }; }
  function hbarOpts() { return { indexAxis: "y", responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true } } }; }
  function doughnutOpts() { return { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "right", labels: { boxWidth: 12, font: { size: 11 } } } } }; }
  function shortDay(k) { const d = new Date(k); return (d.getMonth() + 1) + "/" + d.getDate(); }
  function dayKey(d) { const x = new Date(d); return isNaN(x) ? null : x.toISOString().slice(0, 10); }
  function lastNDays(n) { const a = [], now = new Date(); for (let i = n - 1; i >= 0; i--) { const d = new Date(now); d.setDate(now.getDate() - i); a.push(d.toISOString().slice(0, 10)); } return a; }

  /* ── Compute the full analytics model from live data ── */
  function computeAnalytics() {
    const orders = BW.orders();
    const customers = BW.customers();
    const users = (BW.allUsers ? BW.allUsers() : []).filter((u) => u.role === "customer");
    const vendors = BW.vendors();
    const riders = BW.riders();

    const nonCancelled = orders.filter((o) => o.status !== "CANCELLED");
    const delivered = orders.filter((o) => o.status === "DELIVERED");
    const cancelled = orders.filter((o) => o.status === "CANCELLED");
    const active = orders.filter((o) => !["DELIVERED", "CANCELLED"].includes(o.status));
    const revenue = nonCancelled.reduce((s, o) => s + (o.total || 0), 0);
    const gmv = nonCancelled.reduce((s, o) => s + (o.subtotal || o.total || 0), 0);
    const deliveryFees = delivered.reduce((s, o) => s + (o.deliveryFee || 0), 0);
    const aov = nonCancelled.length ? revenue / nonCancelled.length : 0;
    const cancelRate = orders.length ? cancelled.length / orders.length : 0;
    const fulfilRate = orders.length ? delivered.length / orders.length : 0;
    const codCount = nonCancelled.filter((o) => o.paymentMethod !== "ONLINE").length;
    const onlineCount = nonCancelled.filter((o) => o.paymentMethod === "ONLINE").length;

    const statusDist = {}; orders.forEach((o) => { statusDist[o.status] = (statusDist[o.status] || 0) + 1; });
    const revByVendor = {}; nonCancelled.forEach((o) => { revByVendor[o.vendorId] = (revByVendor[o.vendorId] || 0) + (o.total || 0); });
    const topStores = vendors.map((v) => ({ name: v.name, rev: revByVendor[v.id] || 0 })).sort((a, b) => b.rev - a.rev).slice(0, 7);
    const itemQty = {}; nonCancelled.forEach((o) => (o.items || []).forEach((l) => { itemQty[l.name] = (itemQty[l.name] || 0) + (l.qty || 0); }));
    const topItems = Object.entries(itemQty).map(([name, qty]) => ({ name, qty })).sort((a, b) => b.qty - a.qty).slice(0, 7);
    const hours = new Array(24).fill(0); orders.forEach((o) => { const d = new Date(o.createdAt); if (!isNaN(d)) hours[d.getHours()]++; });

    const days = lastNDays(14);
    const ordersByDay = {}, revByDay = {}, newCustByDay = {};
    days.forEach((k) => { ordersByDay[k] = 0; revByDay[k] = 0; newCustByDay[k] = 0; });
    orders.forEach((o) => { const k = dayKey(o.createdAt); if (k in ordersByDay) { ordersByDay[k]++; if (o.status !== "CANCELLED") revByDay[k] += (o.total || 0); } });
    const custSource = customers.length ? customers : users;
    custSource.forEach((c) => { const k = dayKey(c.createdAt || c.joined); if (k in newCustByDay) newCustByDay[k]++; });

    const ordersByCust = {}; orders.forEach((o) => { ordersByCust[o.customerId] = (ordersByCust[o.customerId] || 0) + 1; });
    const custWithOrders = Object.keys(ordersByCust).length;
    const repeatCust = Object.values(ordersByCust).filter((n) => n > 1).length;
    const repeatRate = custWithOrders ? repeatCust / custWithOrders : 0;
    const todayKey = new Date().toISOString().slice(0, 10);
    const newToday = custSource.filter((c) => dayKey(c.createdAt || c.joined) === todayKey).length;
    const verifiedEmail = customers.filter((c) => c.emailVerified).length;
    const verifiedPhone = customers.filter((c) => c.phoneVerified).length;

    const durations = delivered.map((o) => { const h = o.history || []; if (h.length < 2) return null; const f = new Date(h[0].at), l = new Date(h[h.length - 1].at); return (l - f) / 60000; }).filter((x) => x != null && x > 0);
    const avgDelivery = durations.length ? durations.reduce((s, x) => s + x, 0) / durations.length : null;

    return {
      totalOrders: orders.length, delivered: delivered.length, active: active.length, cancelled: cancelled.length,
      revenue, gmv, deliveryFees, aov, cancelRate, fulfilRate, codCount, onlineCount, statusDist,
      topStores, topItems, hours, days, ordersByDay, revByDay, newCustByDay,
      totalCustomers: customers.length, custWithOrders, repeatRate, newToday, verifiedEmail, verifiedPhone,
      ridersOnline: riders.filter((r) => r.status && r.status !== "offline").length, ridersTotal: riders.length, avgDelivery,
    };
  }

  /* ====================== EARNINGS & SETTLEMENTS ====================== */
  function viewEarnings() {
    const s = (BW.settingsRaw && BW.settingsRaw()) || {};
    const payPerDelivery = Number(s.riderPayPerDelivery != null ? s.riderPayPerDelivery : 30);
    const commissionPct  = Number(s.merchantCommissionPct != null ? s.merchantCommissionPct : 10);

    const PERIODS = [["today", "Today"], ["7d", "Last 7 days"], ["30d", "Last 30 days"], ["all", "All time"]];
    const cur = viewEarnings._period || "today";
    const nowD = new Date();
    const startOfToday = new Date(nowD.getFullYear(), nowD.getMonth(), nowD.getDate()).getTime();
    const cutoff = cur === "today" ? startOfToday : cur === "7d" ? (Date.now() - 7 * 864e5) : cur === "30d" ? (Date.now() - 30 * 864e5) : 0;

    const inPeriod = (o) => new Date(o.createdAt).getTime() >= cutoff;
    const delivered = BW.orders().filter((o) => o.status === "DELIVERED" && inPeriod(o));

    // Totals
    let grossSales = 0, deliveryFees = 0, gstSum = 0;
    delivered.forEach((o) => { grossSales += (o.subtotal || 0); deliveryFees += (o.deliveryFee || 0); gstSum += (o.gst || 0); });
    const commission = Math.round(grossSales * commissionPct / 100);
    const merchantPayable = grossSales - commission;
    const riderPayouts = delivered.length * payPerDelivery;

    // Per-rider
    const riderMap = {};
    delivered.forEach((o) => {
      const id = o.riderId; if (!id) return;
      const r = riderMap[id] || (riderMap[id] = { deliveries: 0, cash: 0, upi: 0 });
      r.deliveries++;
      if (o.paymentMethod === "COD") { if (o.paymentMode === "UPI" || o.paymentStatus === "PAID") r.upi += (o.total || 0); else r.cash += (o.total || 0); }
    });
    const riderRows = Object.keys(riderMap).map((id) => {
      const r = riderMap[id]; const rider = BW.riders().find((x) => x.id === id);
      return el("tr", {}, [
        el("td", {}, el("strong", {}, rider ? rider.name : id.slice(-6))),
        el("td", {}, String(r.deliveries)),
        el("td", { style: "color:#1a9d54;font-weight:700" }, money(r.deliveries * payPerDelivery)),
        el("td", {}, money(r.cash)),
        el("td", {}, money(r.upi)),
        el("td", { style: (rider && (rider.cashInHand || 0) > 0) ? "color:var(--red);font-weight:700" : "" }, money(rider ? (rider.cashInHand || 0) : 0)),
      ]);
    });

    // Per-merchant
    const vendMap = {};
    delivered.forEach((o) => {
      const id = o.vendorId; if (!id) return;
      const m = vendMap[id] || (vendMap[id] = { orders: 0, gross: 0 });
      m.orders++; m.gross += (o.subtotal || 0);
    });
    const vendRows = Object.keys(vendMap).map((id) => {
      const m = vendMap[id]; const v = BW.vendor(id); const comm = Math.round(m.gross * commissionPct / 100);
      return el("tr", {}, [
        el("td", {}, el("strong", {}, v ? v.name : id)),
        el("td", {}, String(m.orders)),
        el("td", {}, money(m.gross)),
        el("td", { class: "muted" }, money(comm)),
        el("td", { style: "color:#1a9d54;font-weight:700" }, money(m.gross - comm)),
      ]);
    });

    const chips = el("div", { style: "display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px" }, PERIODS.map(([val, label]) =>
      el("button", { class: "btn " + (cur === val ? "primary sm" : "ghost sm"), onClick: () => { viewEarnings._period = val; render(); } }, label)));

    const card = (label, value, sub) => el("div", { class: "card", style: "flex:1;min-width:150px" }, [
      el("div", { class: "muted small" }, label),
      el("div", { style: "font-size:20px;font-weight:800;margin-top:2px" }, value),
      sub ? el("div", { class: "muted small" }, sub) : document.createTextNode(""),
    ]);

    return shell("earnings", [
      el("div", { class: "row between", style: "align-items:center" }, [
        el("div", {}, [el("h1", { class: "page-title" }, "Earnings & Settlements"), el("p", { class: "page-sub" }, "Delivered orders only · rider pay ₹" + payPerDelivery + "/delivery · commission " + commissionPct + "%")]),
        el("button", { class: "btn ghost sm", onClick: () => go("settings") }, "Change rates"),
      ]),
      chips,
      el("div", { style: "display:flex;gap:12px;flex-wrap:wrap;margin-bottom:18px" }, [
        card("Delivered orders", String(delivered.length)),
        card("Gross sales", money(grossSales), "items only"),
        card("Platform commission", money(commission), commissionPct + "% of sales"),
        card("Delivery fees", money(deliveryFees)),
        card("Rider payouts", money(riderPayouts), delivered.length + " × ₹" + payPerDelivery),
        card("Merchant payable", money(merchantPayable)),
      ]),
      el("h3", { style: "margin:0 0 8px" }, "Riders — earnings & cash to settle"),
      el("div", { class: "card", style: "padding:0;overflow:hidden;margin-bottom:20px" }, [
        el("table", {}, [
          el("thead", {}, el("tr", {}, ["Saradhi", "Deliveries", "Earnings", "Cash collected", "UPI collected", "Cash-in-hand (to settle)"].map((h) => el("th", {}, h)))),
          el("tbody", {}, riderRows.length ? riderRows : [el("tr", {}, el("td", { colspan: "6", class: "muted", style: "text-align:center;padding:20px" }, "No deliveries in this period."))]),
        ]),
      ]),
      el("h3", { style: "margin:0 0 8px" }, "Merchants — payable"),
      el("div", { class: "card", style: "padding:0;overflow:hidden" }, [
        el("table", {}, [
          el("thead", {}, el("tr", {}, ["Store", "Orders", "Gross sales", "Commission", "Net payable"].map((h) => el("th", {}, h)))),
          el("tbody", {}, vendRows.length ? vendRows : [el("tr", {}, el("td", { colspan: "5", class: "muted", style: "text-align:center;padding:20px" }, "No deliveries in this period."))]),
        ]),
      ]),
    ]);
  }

  function viewAnalytics() {
    const A = computeAnalytics();
    const m0 = (n) => money(Math.round(n || 0));
    const stat = (k, v, d) => el("div", { class: "card stat" }, [el("span", { class: "k" }, k), el("span", { class: "v" }, v), d ? el("span", { class: "d" }, d) : document.createTextNode("")]);
    const canv = () => el("canvas", {});
    const cRev = canv(), cOrd = canv(), cNew = canv(), cStatus = canv(), cPay = canv(), cStores = canv(), cItems = canv(), cHours = canv();
    const chartCard = (title, canvas, h) => el("div", { class: "card" }, [el("h3", { style: "margin:0 0 10px;font-size:14px" }, title), el("div", { style: "position:relative;height:" + (h || 220) + "px" }, [canvas])]);

    shell("analytics", [
      el("h1", { class: "page-title" }, "Analytics & Reporting"),
      el("p", { class: "page-sub" }, "Everything across orders, revenue, customers and fleet — private to you."),
      el("div", { class: "grid cols-4" }, [
        stat("GMV", m0(A.gmv), "gross merchandise value"),
        stat("Net revenue", m0(A.revenue), "incl. fees + tax"),
        stat("Orders", String(A.totalOrders), A.active + " active now"),
        stat("Avg order value", m0(A.aov), ""),
      ]),
      el("div", { class: "grid cols-4", style: "margin-top:14px" }, [
        stat("Delivered", String(A.delivered), Math.round(A.fulfilRate * 100) + "% fulfilment"),
        stat("Cancelled", String(A.cancelled), Math.round(A.cancelRate * 100) + "% cancel rate"),
        stat("Customers", String(A.totalCustomers), "+" + A.newToday + " today"),
        stat("Repeat rate", Math.round(A.repeatRate * 100) + "%", "of ordering customers"),
      ]),
      el("div", { class: "grid cols-4", style: "margin-top:14px" }, [
        stat("Delivery fees", m0(A.deliveryFees), "collected"),
        stat("Avg delivery", A.avgDelivery ? Math.round(A.avgDelivery) + " min" : "—", "placed → delivered"),
        stat("Saradhis online", A.ridersOnline + " / " + A.ridersTotal, ""),
        stat("Verified", A.verifiedEmail + " ✉ · " + A.verifiedPhone + " 📱", "email · phone"),
      ]),
      el("div", { class: "grid cols-2", style: "margin-top:16px" }, [chartCard("Revenue — last 14 days", cRev), chartCard("Orders — last 14 days", cOrd)]),
      el("div", { class: "grid cols-2", style: "margin-top:16px" }, [chartCard("New customers — last 14 days", cNew), chartCard("Order status", cStatus)]),
      el("div", { class: "grid cols-2", style: "margin-top:16px" }, [chartCard("Payment method", cPay), chartCard("Peak order hours", cHours)]),
      el("div", { class: "grid cols-2", style: "margin-top:16px" }, [chartCard("Top stores by revenue", cStores), chartCard("Top items", cItems)]),
    ]);

    requestAnimationFrame(() => {
      const RED = "#e62a1f", RED2 = "#ff8a3c", BLUE = "#4b7bec", GREEN = "#3ba55d", AMBER = "#f5a623";
      const PAL = ["#e62a1f", "#ff8a3c", "#f5a623", "#3ba55d", "#4b7bec", "#8e44ad", "#16a085"];
      makeChart(cRev, { type: "line", data: { labels: A.days.map(shortDay), datasets: [{ data: A.days.map((d) => Math.round(A.revByDay[d])), borderColor: RED, backgroundColor: "rgba(230,42,31,.12)", fill: true, tension: .35, pointRadius: 2 }] }, options: baseOpts() });
      makeChart(cOrd, { type: "bar", data: { labels: A.days.map(shortDay), datasets: [{ data: A.days.map((d) => A.ordersByDay[d]), backgroundColor: RED }] }, options: baseOpts() });
      makeChart(cNew, { type: "bar", data: { labels: A.days.map(shortDay), datasets: [{ data: A.days.map((d) => A.newCustByDay[d]), backgroundColor: BLUE }] }, options: baseOpts() });
      const sK = Object.keys(A.statusDist);
      makeChart(cStatus, { type: "doughnut", data: { labels: sK.map((s) => BW.STATUS_LABEL[s] || s), datasets: [{ data: sK.map((s) => A.statusDist[s]), backgroundColor: PAL }] }, options: doughnutOpts() });
      makeChart(cPay, { type: "doughnut", data: { labels: ["Cash on delivery", "Online"], datasets: [{ data: [A.codCount, A.onlineCount], backgroundColor: [RED, GREEN] }] }, options: doughnutOpts() });
      makeChart(cHours, { type: "bar", data: { labels: A.hours.map((_, h) => h), datasets: [{ data: A.hours, backgroundColor: RED2 }] }, options: baseOpts() });
      makeChart(cStores, { type: "bar", data: { labels: A.topStores.map((s) => s.name), datasets: [{ data: A.topStores.map((s) => Math.round(s.rev)), backgroundColor: RED }] }, options: hbarOpts() });
      makeChart(cItems, { type: "bar", data: { labels: A.topItems.map((s) => s.name), datasets: [{ data: A.topItems.map((s) => s.qty), backgroundColor: AMBER }] }, options: hbarOpts() });
    });
  }

  /* ====================== CUSTOMERS (directory) ====================== */
  function viewCustomers() {
    const customers = BW.customers();
    const orders = BW.orders();
    const ordersByCust = {}, spentByCust = {}, lastByCust = {};
    orders.forEach((o) => {
      ordersByCust[o.customerId] = (ordersByCust[o.customerId] || 0) + 1;
      if (o.status === "DELIVERED") spentByCust[o.customerId] = (spentByCust[o.customerId] || 0) + (o.total || 0);
      const t = new Date(o.createdAt);
      if (!lastByCust[o.customerId] || t > lastByCust[o.customerId]) lastByCust[o.customerId] = t;
    });

    const tbody = el("tbody", {});
    function renderRows(q) {
      const query = (q || "").toLowerCase().trim();
      let list = customers.slice();
      if (query) list = list.filter((c) => [c.name, c.email, c.phone].some((x) => String(x || "").toLowerCase().includes(query)));
      list.sort((a, b) => (ordersByCust[b.id] || 0) - (ordersByCust[a.id] || 0));
      tbody.innerHTML = "";
      if (!list.length) { tbody.appendChild(el("tr", {}, el("td", { colspan: "9", class: "muted", style: "text-align:center;padding:20px" }, "No customers found."))); return; }
      list.forEach((c) => {
        tbody.appendChild(el("tr", {}, [
          el("td", {}, el("strong", {}, c.name || "—")),
          el("td", { class: "muted small" }, c.email || "—"),
          el("td", {}, c.phone || el("span", { class: "muted" }, "—")),
          el("td", { class: "muted small" }, c.dob || "—"),
          el("td", { class: "muted small" }, c.gender || "—"),
          el("td", { class: "small" }, (c.emailVerified ? "✉️" : "·") + "  " + (c.phoneVerified ? "📱" : "·")),
          el("td", { class: "muted small" }, (Array.isArray(c.addresses) && c.addresses.length) ? (c.addresses.length + "×") : "—"),
          el("td", {}, String(ordersByCust[c.id] || 0)),
          el("td", {}, money(spentByCust[c.id] || 0)),
          el("td", { class: "muted small" }, lastByCust[c.id] ? timeAgo(lastByCust[c.id]) : "—"),
          el("td", { class: "muted small" }, c.joined || "—"),
        ]));
      });
    }
    renderRows("");

    const searchEl = el("input", { type: "search", placeholder: "Search name, email or phone…", style: "max-width:320px" });
    searchEl.addEventListener("input", (e) => renderRows(e.target.value));

    const withOrders = Object.keys(ordersByCust).length;
    const stat = (k, v) => el("div", { class: "card stat" }, [el("span", { class: "k" }, k), el("span", { class: "v" }, v)]);

    shell("customers", [
      el("div", { class: "row between", style: "align-items:center;flex-wrap:wrap;gap:10px" }, [
        el("div", {}, [el("h1", { class: "page-title" }, "Customers"), el("p", { class: "page-sub" }, customers.length + " total · visible only to you")]),
        searchEl,
      ]),
      el("div", { class: "grid cols-4", style: "margin:10px 0 16px" }, [
        stat("Total customers", String(customers.length)),
        stat("Placed an order", String(withOrders)),
        stat("Email verified", String(customers.filter((c) => c.emailVerified).length)),
        stat("Phone verified", String(customers.filter((c) => c.phoneVerified).length)),
      ]),
      el("div", { class: "card", style: "padding:0;overflow:hidden" }, [
        el("table", {}, [
          el("thead", {}, el("tr", {}, ["Name", "Email", "Phone", "DOB", "Gender", "Verified", "Addr", "Orders", "Spent", "Last order", "Joined"].map((h) => el("th", {}, h)))),
          tbody,
        ]),
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
    destroyCharts();
    switch (state.route) {
      case "fleet":     return viewFleet();
      case "vendors":   return viewVendors();
      case "analytics": return viewAnalytics();
      case "earnings":  return viewEarnings();
      case "customers": return viewCustomers();
      case "partners":  return viewPartners();
      case "services":  return viewServices();
      case "settings":  return viewSettings();
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
      tabBtn("behavior",  "Behavior"),
      tabBtn("orders",    "Orders"),
      tabBtn("payments",  "Payments"),
      tabBtn("tickets",   "Tickets"),
      tabBtn("support",   "AI logs"),
      tabBtn("rx",        "Rx / Compliance"),
    ]);

    let body;
    if (monState.tab === "logins")         body = renderLoginLogs();
    else if (monState.tab === "behavior")  body = renderBehavior();
    else if (monState.tab === "rx")        body = renderRx();
    else if (monState.tab === "tickets")   body = renderTickets();
    else if (monState.tab === "support")   body = renderSupport();
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

  /* ── Support tickets (two-way) ── */
  function ticketStatusLabel(s) {
    return { open: "Open", awaiting_customer: "Awaiting customer", resolved: "Resolved", closed: "Closed" }[s] || s;
  }
  function ticketLastPreview(t) {
    const m = (t.messages && t.messages[t.messages.length - 1]) || {};
    return (m.from === "support" ? "Support: " : (t.customerName || "Customer") + ": ") + (m.text || "");
  }

  function renderTickets() {
    const wrap = el("div", {});
    wrap.appendChild(el("div", { class: "muted", style: "padding:12px" }, "Loading tickets…"));
    BW.adminTickets().then((tickets) => { wrap.innerHTML = ""; renderTicketList(wrap, tickets); })
      .catch(() => { wrap.innerHTML = ""; wrap.appendChild(el("div", { class: "card" }, [el("p", { class: "muted" }, "Couldn't load tickets.")])); });
    return wrap;
  }

  function renderTicketList(container, tickets) {
    container.innerHTML = "";
    if (!tickets.length) { container.appendChild(el("div", { class: "card" }, [el("p", { class: "muted", style: "text-align:center;padding:24px" }, "No support tickets yet.")])); return; }
    tickets.forEach((t) => {
      container.appendChild(el("div", { class: "card", style: "margin-bottom:8px;cursor:pointer", onClick: () => openTicketDetail(container, t.id) }, [
        el("div", { class: "row between" }, [
          el("div", {}, [el("div", { style: "font-weight:700" }, t.subject), el("div", { class: "muted small" }, (t.customerName || "Customer") + (t.orderId ? " · order linked" : ""))]),
          el("span", { class: "badge" }, ticketStatusLabel(t.status)),
        ]),
        el("div", { class: "muted small", style: "margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" }, ticketLastPreview(t)),
      ]));
    });
  }

  function openTicketDetail(container, id) {
    container.innerHTML = "";
    container.appendChild(el("div", { class: "muted", style: "padding:12px" }, "Loading…"));
    BW.getTicket(id).then((t) => {
      container.innerHTML = "";
      container.appendChild(el("button", { class: "btn ghost sm", style: "margin-bottom:10px", onClick: () => renderTickets._reload(container) }, "← All tickets"));
      container.appendChild(el("div", { class: "card", style: "margin-bottom:10px" }, [
        el("div", { class: "row between" }, [
          el("div", {}, [el("div", { style: "font-weight:800" }, t.subject), el("div", { class: "muted small" }, (t.customerName || "Customer"))]),
          el("span", { class: "badge" }, ticketStatusLabel(t.status)),
        ]),
      ]));
      const thread = el("div", { class: "card", style: "margin-bottom:10px;display:flex;flex-direction:column;gap:8px;max-height:46vh;overflow:auto" });
      (t.messages || []).forEach((m) => {
        const support = m.from === "support";
        thread.appendChild(el("div", { style: "align-self:" + (support ? "flex-end" : "flex-start") + ";max-width:80%;background:" + (support ? "#e9f2ff" : "#f2f2f2") + ";padding:8px 12px;border-radius:12px" }, [
          el("div", { class: "small", style: "font-weight:700;margin-bottom:2px" }, support ? (m.byName || "Support") : (m.byName || "Customer")),
          el("div", { style: "white-space:pre-wrap" }, m.text),
          el("div", { style: "font-size:10px;color:#999;margin-top:3px" }, clockTime(m.at)),
        ]));
      });
      container.appendChild(thread);

      if (t.status !== "closed") {
        const reply = el("textarea", { placeholder: "Reply to the customer…", style: "width:100%;min-height:64px" });
        const send = el("button", { class: "btn primary sm", style: "margin-top:8px" }, "Send reply");
        send.onclick = async () => {
          if (!reply.value.trim()) return;
          send.disabled = true; send.textContent = "Sending…";
          try { await BW.replyTicket(id, reply.value.trim()); openTicketDetail(container, id); }
          catch (e) { toast(e.message || "Couldn't send"); send.disabled = false; send.textContent = "Send reply"; }
        };
        const resolveBtn = el("button", { class: "btn success sm", style: "margin-left:8px", onClick: async () => { try { await BW.setTicketStatus(id, "resolved"); openTicketDetail(container, id); } catch (e) { toast(e.message); } } }, "Mark resolved");
        const closeBtn = el("button", { class: "btn ghost sm", style: "margin-left:8px", onClick: async () => { try { await BW.setTicketStatus(id, "closed"); openTicketDetail(container, id); } catch (e) { toast(e.message); } } }, "Close");
        container.appendChild(el("div", { class: "card" }, [reply, el("div", { style: "margin-top:4px" }, [send, resolveBtn, closeBtn])]));
      } else {
        container.appendChild(el("div", { class: "muted small" }, "This ticket is closed."));
      }
    }).catch(() => { container.innerHTML = ""; container.appendChild(el("div", { class: "muted" }, "Couldn't load ticket.")); });
  }
  renderTickets._reload = (container) => {
    container.innerHTML = "";
    container.appendChild(el("div", { class: "muted", style: "padding:12px" }, "Loading tickets…"));
    BW.adminTickets().then((tickets) => renderTicketList(container, tickets)).catch(() => {});
  };

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
      el("td", { class: "muted small" }, uaDevice(l.ua)),
      el("td", { class: "muted small" }, l.ip || "—"),
    ]));
    return el("div", { class: "card", style: "padding:0;overflow:hidden" }, [
      el("table", {}, [
        el("thead", {}, el("tr", {}, ["Time", "Email", "Role", "Method", "Device", "IP"].map((h) => el("th", {}, h)))),
        el("tbody", {}, rows),
      ]),
    ]);
  }

  // Turn a raw user-agent into a short, readable device/browser label.
  function uaDevice(ua) {
    if (!ua) return "—";
    const os = /iphone|ipad|ipod/i.test(ua) ? "iOS" : /android/i.test(ua) ? "Android" : /windows/i.test(ua) ? "Windows" : /mac os/i.test(ua) ? "macOS" : /linux/i.test(ua) ? "Linux" : "";
    const br = /edg\//i.test(ua) ? "Edge" : /chrome|crios/i.test(ua) ? "Chrome" : /firefox|fxios/i.test(ua) ? "Firefox" : /safari/i.test(ua) ? "Safari" : "";
    return [os, br].filter(Boolean).join(" · ") || "Unknown";
  }

  /* ── Behavior (first-party event analytics) ── */
  function renderBehavior() {
    const events = BW.events ? BW.events() : [];
    const by = (t) => events.filter((e) => e.type === t);
    const searches = by("search"), views = by("view_store"), adds = by("add_to_cart"), placed = by("order_placed"), abandoned = by("cart_abandoned");

    const countMap = (arr, key) => { const m = {}; arr.forEach((e) => { const k = (e.props && e.props[key]) || "—"; m[k] = (m[k] || 0) + 1; }); return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 10); };
    const topSearches = countMap(searches, "q");
    const topStores = countMap(views, "name");
    const conv = adds.length ? Math.round((placed.length / adds.length) * 100) : 0;

    const stat = (k, v, d) => el("div", { class: "card stat" }, [el("span", { class: "k" }, k), el("span", { class: "v" }, v), d ? el("span", { class: "d" }, d) : document.createTextNode("")]);
    const listCard = (title, rows) => el("div", { class: "card" }, [
      el("h3", { style: "margin:0 0 8px;font-size:14px" }, title),
      rows.length ? el("div", {}, rows.map(([k, n]) => el("div", { class: "row between", style: "padding:6px 0;border-bottom:0.5px solid var(--border)" }, [el("span", { class: "small", style: "min-width:0;overflow:hidden;text-overflow:ellipsis" }, k), el("strong", {}, String(n))]))) : el("div", { class: "muted small" }, "No data yet."),
    ]);

    if (!events.length) {
      return el("div", { class: "card" }, [el("p", { class: "muted", style: "text-align:center;padding:24px" }, "No behavioral events yet. They'll appear as customers use the app after deploy.")]);
    }
    return el("div", {}, [
      el("div", { class: "grid cols-4", style: "margin-bottom:14px" }, [
        stat("Searches", String(searches.length)),
        stat("Store views", String(views.length)),
        stat("Add-to-cart", String(adds.length)),
        stat("Cart → order", conv + "%", abandoned.length + " abandoned"),
      ]),
      el("div", { class: "grid cols-2" }, [
        listCard("Top searches", topSearches),
        listCard("Most-viewed stores", topStores),
      ]),
    ]);
  }

  /* ── Rx / Compliance: pharmacy orders with prescription + selfie + consent ── */
  function renderRx() {
    const rows = BW.rxOrders ? BW.rxOrders() : [];
    if (!rows.length) return el("div", { class: "card" }, [el("p", { class: "muted", style: "text-align:center;padding:24px" }, "No pharmacy orders yet. Prescriptions & selfies appear here for compliance.")]);
    const thumb = (url, label) => url
      ? el("a", { href: url, target: "_blank", rel: "noopener" }, el("img", { src: url, alt: label, style: "width:64px;height:64px;object-fit:cover;border-radius:8px;border:1px solid var(--border)" }))
      : el("span", { class: "muted small" }, "—");
    return el("div", {}, [
      el("p", { class: "page-sub", style: "margin:0 0 12px" }, "Prescription & selfie records — visible only to you, for legal/verification. " + rows.length + " on file."),
      el("div", {}, rows.map((o) => {
        const v = BW.vendor(o.vendorId);
        const cust = BW.customers().find((c) => c.id === o.customerId);
        return el("div", { class: "card", style: "margin-bottom:12px" }, [
          el("div", { class: "row between", style: "margin-bottom:8px" }, [
            el("div", {}, [
              el("strong", {}, "#" + (o.orderNo || o.id.slice(-6).toUpperCase()) + " · " + (v ? v.name : "Pharmacy")),
              el("div", { class: "muted small" }, (o.dropName || (cust && cust.name) || "—") + " · " + (o.dropPhone || "—") + " · " + money(o.total || 0)),
            ]),
            statusBadge(o.status),
          ]),
          el("div", { class: "muted small", style: "margin-bottom:8px" }, "Deliver to: " + (o.deliverTo || "—") + " · " + clockTime(o.createdAt) + (o.rxConsentAt ? " · ✅ consent accepted" : " · ⚠️ no consent")),
          el("div", { style: "display:flex;gap:14px" }, [
            el("div", {}, [el("div", { class: "muted small", style: "margin-bottom:4px" }, "Prescription"), thumb(o.prescriptionUrl, "prescription")]),
            el("div", {}, [el("div", { class: "muted small", style: "margin-bottom:4px" }, "Selfie"), thumb(o.selfieUrl, "selfie")]),
          ]),
        ]);
      })),
    ]);
  }

  /* ── Support transcripts (assistant Q&A) ── */
  function renderSupport() {
    const logs = BW.support ? BW.support() : [];
    if (!logs.length) return el("div", { class: "card" }, [el("p", { class: "muted", style: "text-align:center;padding:24px" }, "No support conversations yet.")]);
    return el("div", {}, logs.slice(0, 100).map((l) => el("div", { class: "card", style: "margin-bottom:10px" }, [
      el("div", { class: "row between", style: "margin-bottom:6px" }, [el("strong", { class: "small" }, l.email || "Guest"), el("span", { class: "muted small" }, clockTime(l.at))]),
      el("div", { class: "small", style: "margin-bottom:4px" }, [el("span", { class: "muted" }, "Q: "), l.message || ""]),
      el("div", { class: "small" }, [el("span", { class: "muted" }, "A: "), l.reply || ""]),
    ])));
  }

  function orderPayCell(o) {
    if (o.paymentMethod === "ONLINE") return el("span", { style: "color:#1a9d54" }, "Online ✓");
    // Pay on delivery:
    if (o.paymentStatus === "PAID" || o.paymentMode === "UPI") return el("span", { style: "color:#1a9d54" }, "UPI ✓");
    if (o.paymentStatus === "COLLECTED" || o.paymentMode === "CASH") return el("span", {}, "Cash ✓");
    if (o.paymentStatus === "REFUNDED") return el("span", { style: "color:var(--brand)" }, "Refunded");
    return el("span", { class: "muted" }, "On delivery");
  }

  function renderAllOrders() {
    const FILTERS = [
      ["ALL", "All"], ["PLACED", "New"], ["ACCEPTED", "Accepted"], ["ASSIGNED", "Assigned"],
      ["OUT_FOR_DELIVERY", "Out for delivery"], ["DELIVERED", "Delivered"], ["CANCELLED", "Cancelled"],
    ];
    const cur = renderAllOrders._status || "ALL";
    let orders = BW.orders();
    if (cur !== "ALL") orders = orders.filter((o) => o.status === cur);

    const chips = el("div", { style: "display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px" }, FILTERS.map(([val, label]) => {
      const count = val === "ALL" ? BW.orders().length : BW.orders().filter((o) => o.status === val).length;
      return el("button", { class: "btn " + (cur === val ? "primary sm" : "ghost sm"), onClick: () => { renderAllOrders._status = val; render(); } }, label + " (" + count + ")");
    }));

    if (!orders.length) {
      return el("div", {}, [chips, el("div", { class: "card" }, [el("p", { class: "muted", style: "text-align:center;padding:24px" }, "No orders in this view.")])]);
    }
    const rows = orders.map((o) => {
      const v     = BW.vendor(o.vendorId);
      const cust  = BW.customers().find((c) => c.id === o.customerId);
      const rider = o.riderId ? BW.riders().find((r) => r.id === o.riderId) : null;
      const hist  = o.history || [];
      const first = hist[0] ? new Date(hist[0].at) : null;
      const last  = hist[hist.length - 1] ? new Date(hist[hist.length - 1].at) : null;
      const dur   = (first && last && last > first) ? Math.round((last - first) / 60000) + " min" : "—";
      return el("tr", {}, [
        el("td", {}, el("strong", {}, "#" + (o.orderNo || o.id.slice(-6).toUpperCase()))),
        el("td", { class: "muted small" }, clockTime(o.createdAt)),
        el("td", {}, v ? v.name : "—"),
        el("td", {}, cust ? cust.name : "—"),
        el("td", {}, money(o.total)),
        el("td", {}, orderPayCell(o)),
        el("td", {}, statusBadge(o.status)),
        el("td", {}, rider ? rider.name : el("span", { class: "muted" }, "unassigned")),
        el("td", { class: "muted small" }, dur),
      ]);
    });
    return el("div", {}, [
      chips,
      el("div", { class: "card", style: "padding:0;overflow:hidden" }, [
        el("table", {}, [
          el("thead", {}, el("tr", {}, ["Order", "Placed at", "Vendor", "Customer", "Total", "Payment", "Status", "Saradhi", "Duration"].map((h) => el("th", {}, h)))),
          el("tbody", {}, rows),
        ]),
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
      const method = o.paymentMethod === "ONLINE" ? "Online" : "COD";
      const payStatus =
        o.paymentStatus === "PAID"       ? method + " · Paid" :
        o.paymentStatus === "COLLECTED"  ? method + " · Collected" :
        o.status === "CANCELLED"         ? "Cancelled" :
        o.paymentMethod === "ONLINE"     ? "Online · Pending" :
                                           "COD · Pending";
      return el("tr", {}, [
        el("td", {}, el("strong", {}, "#" + (o.orderNo || o.id.slice(-6).toUpperCase()))),
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


  /* ====================== SETTINGS ====================== */
  /* ====================== DELIVERY PARTNERS ====================== */
  function viewPartners() {
    const partners = BW.partners ? BW.partners() : [];
    const orders = BW.orders();
    const nameEl = el("input", { placeholder: "Business name (e.g. Millet Mart)" });
    const hookEl = el("input", { placeholder: "https://their-app.com/webhooks/saardha" });
    const baseEl = el("input", { type: "number", value: "20", style: "max-width:90px" });
    const perkmEl = el("input", { type: "number", value: "8", style: "max-width:90px" });
    const minEl = el("input", { type: "number", value: "25", style: "max-width:90px" });

    const createBtn = el("button", { class: "btn primary" }, "Create partner + issue key");
    createBtn.addEventListener("click", async () => {
      if (!nameEl.value.trim()) { toast("Enter a business name"); return; }
      createBtn.disabled = true; createBtn.textContent = "Creating…";
      try {
        const r = await BW.createPartner({ name: nameEl.value.trim(), webhookUrl: hookEl.value.trim() || null, priceBase: Number(baseEl.value) || 20, pricePerKm: Number(perkmEl.value) || 8, priceMin: Number(minEl.value) || 25 });
        UI.modal({ title: "API key for " + r.partner.name, body: el("div", {}, [
          el("p", { class: "muted small" }, "Copy this now — it's shown only once. Send it to the partner to authenticate their delivery requests."),
          el("div", { style: "font-family:monospace;background:var(--surface-2);padding:10px;border-radius:8px;word-break:break-all;margin:8px 0" }, r.apiKey),
          el("button", { class: "btn ghost sm", onClick: () => { if (navigator.clipboard) navigator.clipboard.writeText(r.apiKey).then(() => toast("Copied")); } }, "Copy key"),
        ]) });
        nameEl.value = hookEl.value = ""; render();
      } catch (e) { toast("Error: " + (e.message || "failed")); }
      createBtn.disabled = false; createBtn.textContent = "Create partner + issue key";
    });

    const rows = partners.map((p) => {
      const dCount = orders.filter((o) => o.partnerId === p.id).length;
      const toggle = el("button", { class: "btn ghost sm", onClick: async () => {
        try { await BW.updatePartner(p.id, { status: p.status === "active" ? "suspended" : "active" }); toast("Updated"); render(); } catch (e) { toast(e.message); }
      } }, p.status === "active" ? "Suspend" : "Activate");
      return el("tr", {}, [
        el("td", {}, el("strong", {}, p.name)),
        el("td", {}, el("span", { class: "badge " + (p.status === "active" ? "DELIVERED" : "") }, p.status || "active")),
        el("td", { class: "muted small" }, "₹" + p.priceBase + " + ₹" + p.pricePerKm + "/km (min ₹" + p.priceMin + ")"),
        el("td", { class: "muted small" }, p.keyPrefix || "—"),
        el("td", {}, String(dCount)),
        el("td", {}, toggle),
      ]);
    });

    shell("partners", [
      el("h1", { class: "page-title" }, "Delivery Partners"),
      el("p", { class: "page-sub" }, "Businesses that use Saardha for last-mile delivery. Approve one to issue an API key."),
      el("div", { class: "card", style: "max-width:640px;margin-bottom:16px" }, [
        el("h3", { style: "margin-top:0" }, "Add a partner"),
        el("div", { class: "field" }, [el("label", {}, "Business name"), nameEl]),
        el("div", { class: "field" }, [el("label", {}, "Webhook URL (status callbacks, optional)"), hookEl]),
        el("div", { style: "display:flex;gap:12px;flex-wrap:wrap" }, [
          el("div", { class: "field" }, [el("label", {}, "Base ₹"), baseEl]),
          el("div", { class: "field" }, [el("label", {}, "Per km ₹"), perkmEl]),
          el("div", { class: "field" }, [el("label", {}, "Min ₹"), minEl]),
        ]),
        createBtn,
      ]),
      el("div", { class: "card", style: "padding:0;overflow:hidden" }, [
        el("table", {}, [
          el("thead", {}, el("tr", {}, ["Partner", "Status", "Pricing", "API key", "Deliveries", ""].map((h) => el("th", {}, h)))),
          el("tbody", {}, rows.length ? rows : [el("tr", {}, el("td", { colspan: "6", class: "muted", style: "text-align:center;padding:20px" }, "No partners yet."))]),
        ]),
      ]),
    ]);
  }

  /* ====================== SERVICES ====================== */
  const SERVICE_CATS = [
    ["laundry", "Laundry & Ironing"], ["tailoring", "Tailoring"], ["printing", "Print & Xerox"],
    ["courier", "Courier"], ["repair", "Repairs"], ["salon", "Salon & Care"], ["scrap", "Scrap (Raddi)"], ["other", "Other"],
  ];
  function catName(k) { const c = SERVICE_CATS.find((x) => x[0] === k); return c ? c[1] : (k || "—"); }

  function viewServices() {
    const vendors = BW.serviceVendors ? BW.serviceVendors() : [];
    const bookings = BW.bookings ? BW.bookings() : [];
    const statCard = (k, v) => el("div", { class: "card stat" }, [el("span", { class: "k" }, k), el("span", { class: "v" }, v)]);

    const nameEl = el("input", { placeholder: "Business name (e.g. Sparkle Laundry)" });
    const emailEl = el("input", { placeholder: "Login email", type: "email" });
    const passEl = el("input", { placeholder: "Temp password (min 6 chars)" });
    const areaEl = el("input", { placeholder: "Area / locality" });
    const catEl = el("select", {}, SERVICE_CATS.map(([v, l]) => el("option", { value: v }, l)));

    const createBtn = el("button", { class: "btn primary" }, "Onboard business + create login");
    createBtn.addEventListener("click", async () => {
      if (!nameEl.value.trim() || !emailEl.value.trim() || passEl.value.length < 6) { toast("Name, email and a 6+ char password are required"); return; }
      createBtn.disabled = true; createBtn.textContent = "Creating…";
      try {
        const r = await BW.createServiceVendor({ name: nameEl.value.trim(), email: emailEl.value.trim(), password: passEl.value, categoryKey: catEl.value, area: areaEl.value.trim(), patterns: ["pickup_drop"] });
        UI.modal({ title: "Service partner created", body: el("div", {}, [
          el("p", { class: "muted small" }, "Share these credentials with the business. They sign in at the /service portal."),
          el("div", { style: "font-family:monospace;background:var(--surface-2);padding:10px;border-radius:8px;margin:8px 0" }, [
            el("div", {}, "Portal: /service/"), el("div", {}, "Email: " + r.email), el("div", {}, "Password: " + r.password),
          ]),
        ]) });
        nameEl.value = emailEl.value = passEl.value = areaEl.value = "";
        // Refresh the list
        if (BW.refreshLogins) { try { await BW.refreshLogins(); } catch {} }
        render();
      } catch (e) { toast("Error: " + (e.message || "failed")); }
      createBtn.disabled = false; createBtn.textContent = "Onboard business + create login";
    });

    const rows = vendors.map((v) => {
      const bCount = bookings.filter((b) => b.serviceVendorId === v.id).length;
      const active = v.active !== false && v.status !== "inactive";
      const toggle = el("button", { class: "btn ghost sm", onClick: async () => {
        try { await BW.updateServiceVendor(v.id, { active: !active, status: active ? "inactive" : "active" }); toast("Updated"); render(); } catch (e) { toast(e.message); }
      } }, active ? "Deactivate" : "Activate");
      return el("tr", {}, [
        el("td", {}, el("strong", {}, v.name)),
        el("td", { class: "muted small" }, catName(v.categoryKey)),
        el("td", { class: "muted small" }, v.area || "—"),
        el("td", {}, el("span", { class: "badge " + (active ? "DELIVERED" : "") }, active ? "active" : "inactive")),
        el("td", {}, "★ " + (v.rating || 5)),
        el("td", {}, String(bCount)),
        el("td", {}, toggle),
      ]);
    });

    // Live booking snapshot
    const active = bookings.filter((b) => !["RETURNED", "CANCELLED"].includes(b.status));
    const bookingRows = active.slice(0, 30).map((b) => el("tr", {}, [
      el("td", {}, "#" + b.id.slice(-6).toUpperCase()),
      el("td", { class: "muted small" }, b.serviceVendorName || "—"),
      el("td", { class: "muted small" }, b.addressName || "—"),
      el("td", {}, el("span", { class: "badge" }, (BW.BOOKING_LABEL && BW.BOOKING_LABEL[b.status]) || b.status)),
      el("td", { class: "muted small" }, (b.paymentMethod === "ONLINE" ? "Online" : "COD")),
    ]));

    shell("services", [
      el("h1", { class: "page-title" }, "Local Services"),
      el("p", { class: "page-sub" }, "Pickup & Drop businesses (laundry, tailoring, xerox, courier…). Onboard one to give them a partner login."),
      el("div", { class: "grid cols-4", style: "margin-bottom:16px" }, [
        statCard("Businesses", String(vendors.length)),
        statCard("Active bookings", String(active.length)),
        statCard("Total bookings", String(bookings.length)),
        statCard("Returned", String(bookings.filter((b) => b.status === "RETURNED").length)),
      ]),
      el("div", { class: "card", style: "max-width:640px;margin-bottom:16px" }, [
        el("h3", { style: "margin-top:0" }, "Onboard a service business"),
        el("div", { class: "field" }, [el("label", {}, "Business name"), nameEl]),
        el("div", { style: "display:flex;gap:12px;flex-wrap:wrap" }, [
          el("div", { class: "field", style: "flex:1;min-width:180px" }, [el("label", {}, "Login email"), emailEl]),
          el("div", { class: "field", style: "flex:1;min-width:140px" }, [el("label", {}, "Temp password"), passEl]),
        ]),
        el("div", { style: "display:flex;gap:12px;flex-wrap:wrap" }, [
          el("div", { class: "field", style: "flex:1;min-width:160px" }, [el("label", {}, "Category"), catEl]),
          el("div", { class: "field", style: "flex:1;min-width:160px" }, [el("label", {}, "Area"), areaEl]),
        ]),
        createBtn,
      ]),
      el("div", { class: "card", style: "padding:0;overflow:hidden;margin-bottom:16px" }, [
        el("table", {}, [
          el("thead", {}, el("tr", {}, ["Business", "Category", "Area", "Status", "Rating", "Bookings", ""].map((h) => el("th", {}, h)))),
          el("tbody", {}, rows.length ? rows : [el("tr", {}, el("td", { colspan: "7", class: "muted", style: "text-align:center;padding:20px" }, "No service businesses yet."))]),
        ]),
      ]),
      el("h3", { style: "margin:0 0 8px" }, "Live bookings"),
      el("div", { class: "card", style: "padding:0;overflow:hidden" }, [
        el("table", {}, [
          el("thead", {}, el("tr", {}, ["Booking", "Business", "Customer", "Status", "Pay"].map((h) => el("th", {}, h)))),
          el("tbody", {}, bookingRows.length ? bookingRows : [el("tr", {}, el("td", { colspan: "5", class: "muted", style: "text-align:center;padding:20px" }, "No active bookings."))]),
        ]),
      ]),
    ]);
  }

  async function viewSettings() {
    const fee = BW.deliveryFee ? BW.deliveryFee() : 25;
    const feeEl  = el("input", { type: "number", value: String(fee), min: "0", step: "1", style: "max-width:140px" });
    const saveBtn = el("button", { class: "btn primary", onClick: async () => {
      const val = Number(feeEl.value);
      if (isNaN(val) || val < 0) { toast("Enter a valid amount"); return; }
      try {
        saveBtn.disabled = true;
        saveBtn.textContent = "Saving…";
        await BW.updateSettings({ deliveryFee: val });
        await BW.init("admin");
        toast("Delivery fee updated to ₹" + val);
        saveBtn.disabled = false;
        saveBtn.textContent = "Save";
      } catch (err) {
        toast("Error: " + err.message);
        saveBtn.disabled = false;
        saveBtn.textContent = "Save";
      }
    }}, "Save");

    /* --- COD cash-in-hand limit --- */
    const codLimit = BW.codCashLimit ? BW.codCashLimit() : 2000;
    const codEl = el("input", { type: "number", value: String(codLimit), min: "0", step: "100", style: "max-width:140px" });
    const codSave = el("button", { class: "btn primary" }, "Save");
    codSave.addEventListener("click", async () => {
      const val = Number(codEl.value);
      if (isNaN(val) || val < 0) { toast("Enter a valid amount"); return; }
      codSave.disabled = true; codSave.textContent = "Saving…";
      try { await BW.updateSettings({ codCashLimit: val }); await BW.init("admin"); toast("COD limit set to ₹" + val); }
      catch (err) { toast("Error: " + err.message); }
      codSave.disabled = false; codSave.textContent = "Save";
    });

    /* --- Support contact details (shown in the customer Help screen) --- */
    const s0 = (BW.settingsRaw && BW.settingsRaw()) || {};
    const spPhone = el("input", { type: "tel", value: s0.supportPhone || "", placeholder: "+91 …", style: "width:100%;margin-bottom:6px" });
    const spWa    = el("input", { type: "tel", value: s0.supportWhatsapp || "", placeholder: "WhatsApp number (+91 …)", style: "width:100%;margin-bottom:6px" });
    const spEmail = el("input", { type: "email", value: s0.supportEmail || "", placeholder: "support@yourdomain.com", style: "width:100%;margin-bottom:6px" });
    const spHours = el("input", { type: "text", value: s0.supportHours || "", placeholder: "e.g. Mon–Sun, 9am–9pm", style: "width:100%;margin-bottom:6px" });
    const spSave  = el("button", { class: "btn primary" }, "Save contact");
    spSave.addEventListener("click", async () => {
      spSave.disabled = true; spSave.textContent = "Saving…";
      try {
        await BW.updateSettings({ supportPhone: spPhone.value.trim(), supportWhatsapp: spWa.value.trim(), supportEmail: spEmail.value.trim(), supportHours: spHours.value.trim() });
        await BW.init("admin"); toast("Support contact saved");
      } catch (err) { toast("Error: " + err.message); }
      spSave.disabled = false; spSave.textContent = "Save contact";
    });

    /* --- Pay-on-delivery UPI (Saardha QR the Saradhi shows at the door) --- */
    const upiVpaEl  = el("input", { type: "text", value: s0.upiVpa || "", placeholder: "yourname@upi (Saardha's UPI ID)", style: "width:100%;margin-bottom:6px" });
    const upiNameEl = el("input", { type: "text", value: s0.upiName || "Saardha", placeholder: "Payee name shown to customer", style: "width:100%;margin-bottom:6px" });
    const upiSave   = el("button", { class: "btn primary" }, "Save UPI");
    upiSave.addEventListener("click", async () => {
      upiSave.disabled = true; upiSave.textContent = "Saving…";
      try { await BW.updateSettings({ upiVpa: upiVpaEl.value.trim(), upiName: upiNameEl.value.trim() || "Saardha" }); await BW.init("admin"); toast("UPI details saved"); }
      catch (err) { toast("Error: " + err.message); }
      upiSave.disabled = false; upiSave.textContent = "Save UPI";
    });

    /* --- Payouts: rider pay per delivery + merchant commission --- */
    const payEl = el("input", { type: "number", min: "0", value: String(s0.riderPayPerDelivery != null ? s0.riderPayPerDelivery : 30), style: "max-width:140px" });
    const commEl = el("input", { type: "number", min: "0", max: "100", value: String(s0.merchantCommissionPct != null ? s0.merchantCommissionPct : 10), style: "max-width:140px" });
    const paySave = el("button", { class: "btn primary" }, "Save payouts");
    paySave.addEventListener("click", async () => {
      paySave.disabled = true; paySave.textContent = "Saving…";
      try { await BW.updateSettings({ riderPayPerDelivery: Number(payEl.value) || 0, merchantCommissionPct: Number(commEl.value) || 0 }); await BW.init("admin"); toast("Payout settings saved"); }
      catch (err) { toast("Error: " + err.message); }
      paySave.disabled = false; paySave.textContent = "Save payouts";
    });

    /* --- Operational zones (geofencing for rider duty) --- */
    const zones = (BW.operationalZones ? BW.operationalZones() : []).slice();
    const zoneList = el("div", {});
    function renderZones() {
      zoneList.innerHTML = "";
      if (!zones.length) zoneList.appendChild(el("div", { class: "muted small", style: "padding:4px 0 8px" }, "No zones set — riders can go on duty anywhere."));
      zones.forEach((z, i) => zoneList.appendChild(el("div", { class: "row between", style: "padding:8px 0;border-bottom:0.5px solid var(--border)" }, [
        el("div", {}, [el("strong", {}, z.name || "Zone"), el("div", { class: "muted small" }, "(" + Number(z.lat).toFixed(4) + ", " + Number(z.lng).toFixed(4) + ") · " + (z.radiusKm || 5) + " km")]),
        el("button", { class: "btn ghost sm", onClick: () => { zones.splice(i, 1); renderZones(); } }, "Remove"),
      ])));
    }
    renderZones();
    const zName = el("input", { placeholder: "Zone name (e.g. Banjara Hills)", style: "width:100%;margin-bottom:6px" });
    const zLat = el("input", { placeholder: "Latitude", inputmode: "decimal", style: "width:100%;margin-bottom:6px" });
    const zLng = el("input", { placeholder: "Longitude", inputmode: "decimal", style: "width:100%;margin-bottom:6px" });
    const zRad = el("input", { placeholder: "Radius km", value: "5", inputmode: "decimal", style: "width:100%;margin-bottom:6px" });
    const zGps = el("button", { class: "btn ghost sm" }, "Use my location");
    zGps.addEventListener("click", () => {
      if (!navigator.geolocation) return toast("GPS not available");
      navigator.geolocation.getCurrentPosition((p) => { zLat.value = p.coords.latitude.toFixed(6); zLng.value = p.coords.longitude.toFixed(6); toast("Location filled"); }, () => toast("Couldn't get location"));
    });
    const zAdd = el("button", { class: "btn primary sm" }, "Add zone");
    zAdd.addEventListener("click", () => {
      const lat = Number(zLat.value), lng = Number(zLng.value);
      if (!zName.value.trim() || isNaN(lat) || isNaN(lng)) { toast("Enter a name and valid lat/lng"); return; }
      zones.push({ name: zName.value.trim(), lat: lat, lng: lng, radiusKm: Number(zRad.value) || 5 });
      zName.value = zLat.value = zLng.value = ""; zRad.value = "5"; renderZones();
    });
    const zSave = el("button", { class: "btn primary" }, "Save zones");
    zSave.addEventListener("click", async () => {
      zSave.disabled = true; zSave.textContent = "Saving…";
      try { await BW.updateSettings({ operationalZones: zones }); await BW.init("admin"); toast("Operational zones saved"); }
      catch (err) { toast("Error: " + err.message); }
      zSave.disabled = false; zSave.textContent = "Save zones";
    });

    shell("settings", [
      el("h1", { class: "page-title" }, "Settings"),
      el("p", { class: "page-sub" }, "Configure platform-wide options."),
      el("div", { class: "card", style: "max-width:480px" }, [
        el("h3", { style: "margin-top:0" }, "Delivery Charge"),
        el("p", { class: "muted small", style: "margin:0 0 14px" },
          "This amount is added to every customer order at checkout."),
        el("div", { class: "field" }, [
          el("label", {}, "Delivery fee (₹)"),
          el("div", { style: "display:flex;gap:10px;align-items:center" }, [feeEl, saveBtn]),
        ]),
      ]),
      el("div", { class: "card", style: "max-width:480px;margin-top:16px" }, [
        el("h3", { style: "margin-top:0" }, "Rider cash-in-hand limit"),
        el("p", { class: "muted small", style: "margin:0 0 14px" }, "When a rider's collected COD cash reaches this, they can't go online until they settle it (auto-suspended after 24h)."),
        el("div", { class: "field" }, [
          el("label", {}, "COD limit (₹)"),
          el("div", { style: "display:flex;gap:10px;align-items:center" }, [codEl, codSave]),
        ]),
      ]),
      el("div", { class: "card", style: "max-width:480px;margin-top:16px" }, [
        el("h3", { style: "margin-top:0" }, "Payouts & commission"),
        el("p", { class: "muted small", style: "margin:0 0 12px" }, "Used by the Earnings page to compute rider pay and merchant settlements."),
        el("div", { class: "field" }, [el("label", {}, "Rider pay per delivery (₹)"), payEl]),
        el("div", { class: "field" }, [el("label", {}, "Merchant commission (%)"), commEl]),
        el("div", { style: "margin-top:8px" }, [paySave]),
      ]),
      el("div", { class: "card", style: "max-width:480px;margin-top:16px" }, [
        el("h3", { style: "margin-top:0" }, "Pay-on-delivery UPI"),
        el("p", { class: "muted small", style: "margin:0 0 12px" }, "The Saradhi shows a Saardha UPI QR at the door so customers can pay by UPI (or cash). Enter Saardha's UPI ID."),
        el("div", { class: "field" }, [el("label", {}, "UPI ID (VPA)"), upiVpaEl]),
        el("div", { class: "field" }, [el("label", {}, "Payee name"), upiNameEl]),
        el("div", { style: "margin-top:8px" }, [upiSave]),
      ]),
      el("div", { class: "card", style: "max-width:480px;margin-top:16px" }, [
        el("h3", { style: "margin-top:0" }, "Support contact"),
        el("p", { class: "muted small", style: "margin:0 0 12px" }, "Shown to customers on the Help & Support screen (call / WhatsApp / email)."),
        el("div", { class: "field" }, [el("label", {}, "Phone"), spPhone]),
        el("div", { class: "field" }, [el("label", {}, "WhatsApp"), spWa]),
        el("div", { class: "field" }, [el("label", {}, "Email"), spEmail]),
        el("div", { class: "field" }, [el("label", {}, "Hours"), spHours]),
        el("div", { style: "margin-top:8px" }, [spSave]),
      ]),
      el("div", { class: "card", style: "max-width:480px;margin-top:16px" }, [
        el("h3", { style: "margin-top:0" }, "Operational zones"),
        el("p", { class: "muted small", style: "margin:0 0 12px" }, "Riders can only go on duty inside one of these zones. Leave empty to allow anywhere."),
        zoneList,
        el("div", { style: "margin-top:12px" }, [zName, zLat, zLng, zRad,
          el("div", { style: "display:flex;gap:8px" }, [zGps, zAdd]),
        ]),
        el("div", { style: "margin-top:12px" }, [zSave]),
      ]),
    ]);
  }

  boot().catch((err) => {
    console.error("Boot failed:", err);
    root.innerHTML = `<div class="bw-loading" style="color:var(--red)">Failed to connect to server. Is the backend running?</div>`;
  });
})();
