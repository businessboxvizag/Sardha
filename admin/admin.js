/* =========================================================
 * Admin Dashboard — real API version
 * ========================================================= */
(function () {
  "use strict";
  const { el, money, timeAgo, clockTime, toast, topbar, project, statusBadge } = UI;

  // Upload an image file to Cloudinary (unsigned preset from /api/config).
  // Resize an image File down to a data URL (keeps the inline fallback small).
  function resizeToDataUrl(file, maxDim, quality) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        let w = img.width, h = img.height;
        if (w >= h && w > maxDim) { h = Math.round(h * maxDim / w); w = maxDim; }
        else if (h > maxDim) { w = Math.round(w * maxDim / h); h = maxDim; }
        const c = document.createElement("canvas"); c.width = w; c.height = h;
        c.getContext("2d").drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL("image/jpeg", quality || 0.72));
      };
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }
  async function uploadToCloudinary(file) {
    const cfg = (BW.config && BW.config()) || {};
    if (cfg.cloudinaryCloud && cfg.cloudinaryPreset) {
      try {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("upload_preset", cfg.cloudinaryPreset);
        const r = await fetch("https://api.cloudinary.com/v1_1/" + cfg.cloudinaryCloud + "/image/upload", { method: "POST", body: fd });
        const d = await r.json();
        if (d && d.secure_url) return d.secure_url;
        console.warn("Cloudinary rejected, using inline image:", d && d.error && d.error.message);
      } catch (e) { console.warn("Cloudinary failed, using inline image:", e && e.message); }
    }
    // Fallback: store a resized inline data URL so the image still saves.
    try { return await resizeToDataUrl(file, 900, 0.72); }
    catch (e) { throw new Error("Could not process that image"); }
  }

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
    // Load products for all vendors in PARALLEL (was sequential → very slow with many stores).
    await Promise.all(BW.vendors().map((v) => BW.loadVendorProducts(v.id).catch(() => {})));
    BW.subscribe(() => { render(); updateEscalationBanner(); });
    setInterval(updateEscalationBanner, 60 * 1000);   // re-evaluate the 5-min threshold each minute

    // Alerts: buzz + notify when a customer raises a ticket or replies, and live-refresh
    // the open ticket thread. Also register for push so it works with the app closed.
    if (window.Buzzer && window.Buzzer.requestNotify) window.Buzzer.requestNotify();
    if (window.SaardhaPush) window.SaardhaPush.enable();
    BW.subscribeTickets((t) => {
      const last = (t.messages && t.messages[t.messages.length - 1]) || {};
      if (last.from === "customer" && window.Buzzer) {
        window.Buzzer.alert("New support message", (t.customerName || "A customer") + ": " + (t.subject || last.text || ""));
      }
      // If we're viewing this ticket, refresh it live.
      if (openTicketDetail._container && openTicketDetail._openId === t.id) {
        openTicketDetail(openTicketDetail._container, t.id);
      } else if (state.route === "monitor" && viewMonitor._tab === "tickets") {
        render();
      }
    });

    updateEscalationBanner();
    render();
  }

  // Red "needs attention" banner: orders a merchant hasn't accepted within 5 minutes.
  // Server also alerts admins by push/email — this is the in-panel view + buzzer.
  function updateEscalationBanner() {
    const stale = BW.orders().filter((o) => o.status === S.PLACED && (Date.now() - new Date(o.createdAt).getTime()) > 5 * 60 * 1000);
    let bar = document.getElementById("adm-escalate");
    if (!stale.length) { if (bar) bar.remove(); return; }
    const fresh = !bar;
    if (!bar) {
      bar = el("div", { id: "adm-escalate", style: "position:fixed;left:12px;right:12px;top:8px;z-index:9600;background:#b71c1c;color:#fff;border-radius:10px;padding:10px 14px;box-shadow:0 6px 18px rgba(0,0,0,.35);display:flex;align-items:center;gap:10px;flex-wrap:wrap" });
      document.body.appendChild(bar);
      if (window.Buzzer) window.Buzzer.alert("Orders not accepted", stale.length + " order(s) waiting > 5 min — call the store");
    }
    const o = stale[0]; const v = BW.vendor(o.vendorId) || {};
    const phone = (v.businessPhone || v.ownerPhone || "").replace(/[^0-9+]/g, "");
    bar.innerHTML = "";
    bar.appendChild(el("div", { style: "flex:1;min-width:180px" }, [
      el("div", { style: "font-weight:800" }, "⚠️ " + stale.length + " order" + (stale.length > 1 ? "s" : "") + " not accepted (>5 min)"),
      el("div", { style: "font-size:12px;opacity:.92" }, "#" + (o.orderNo || "") + " · " + (v.name || "store") + " · " + (phone || "no phone")),
    ]));
    if (phone) {
      bar.appendChild(el("a", { class: "btn sm", style: "background:#fff;color:#b71c1c;font-weight:700", href: "tel:" + phone }, "📞 Call"));
      bar.appendChild(el("a", { class: "btn sm", style: "background:rgba(255,255,255,.25);color:#fff", href: "https://wa.me/" + phone.replace(/^\+/, ""), target: "_blank", rel: "noopener" }, "💬 WhatsApp"));
    }
    bar.appendChild(el("button", { class: "btn sm", style: "background:rgba(255,255,255,.18);color:#fff", onClick: () => { go("monitor"); viewMonitor._tab = "orders"; renderAllOrders._status = "PLACED"; render(); } }, "View"));
    void fresh;
  }

  let _navPop = false;
  function go(route) {
    state.route = route;
    if (!_navPop && route !== "overview") { try { history.pushState({ r: route }, "", "#" + route); } catch (e) {} }
    window.scrollTo(0, 0);
    render();
  }
  window.addEventListener("popstate", function (ev) {
    _navPop = true;
    go(ev.state && ev.state.r ? ev.state.r : "overview");
    _navPop = false;
  });

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
      navItem("offers",    "%",  "Offers"),
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

    // PWA analytics — fetch once, then re-render when they arrive.
    const M = viewOverview._metrics;
    if (M === undefined) {
      viewOverview._metrics = null;
      BW.getMetrics().then((m) => { viewOverview._metrics = m || null; if (state.route === "overview") render(); }).catch(() => {});
    }
    function last7(kind) {
      if (!M || !M.daily) return 0;
      let sum = 0;
      for (let i = 0; i < 7; i++) {
        const day = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
        sum += Number((M.daily[day] || {})[kind] || 0);
      }
      return sum;
    }

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
      el("h3", { style: "margin:24px 0 10px" }, "App analytics"),
      el("div", { class: "grid cols-4" }, [
        stat("App installs",  M ? String(M.installs || 0) : "…", "+" + last7("installs") + " this week"),
        stat("App opens",     M ? String(M.opens || 0) : "…", "+" + last7("opens") + " this week"),
        stat("Customers",     String(O.totalCustomers), "registered"),
        stat("Installs (7d)", M ? String(last7("installs")) : "…", "last 7 days"),
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
            el("button", { class: "btn ghost sm", onClick: () => onboardRiderModal(r) }, "⚙ Onboard"),
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
  // ONE universal QR for the whole platform — customers scan it and pick their store.
  function masterQrUrl() {
    return "https://api.qrserver.com/v1/create-qr-code/?size=600x600&ecc=M&format=png&data="
      + encodeURIComponent(APP_BASE + "/scan/");
  }
  function printMasterQr() {
    const w = window.open("", "_blank");
    if (!w) { toast("Allow pop-ups to print the QR"); return; }
    const html = "<!DOCTYPE html><html><head><meta charset='utf-8'><title>Saardha QR</title>" +
      "<style>body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;text-align:center;padding:40px}h1{color:#e62a1f;margin:0 0 4px}p{color:#555;margin:2px 0 20px}img{width:340px;height:340px}.tag{font-size:18px;font-weight:700;margin-top:14px}.sub{color:#777;font-size:13px;margin-top:6px}" +
      "@media print{button{display:none}}button{margin-top:20px;background:#e62a1f;color:#fff;border:none;padding:10px 18px;border-radius:8px;cursor:pointer}</style></head><body>" +
      "<h1>Saardha</h1><p>Scan to order — local home delivery</p>" +
      "<img src='" + masterQrUrl() + "' alt='Saardha QR'/>" +
      "<div class='tag'>📷 Scan &amp; choose your store</div>" +
      "<div class='sub'>One QR for every Saardha store</div>" +
      "<button onclick='window.print()'>🖨 Print</button></body></html>";
    w.document.open(); w.document.write(html); w.document.close();
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
      // Single universal QR — print once, works for every store.
      el("div", { class: "card", style: "margin-bottom:16px;display:flex;gap:16px;align-items:center;flex-wrap:wrap" }, [
        el("img", { src: masterQrUrl(), alt: "Saardha universal QR", style: "width:120px;height:120px;border-radius:8px;background:#fff" }),
        el("div", { style: "flex:1;min-width:200px" }, [
          el("div", { style: "font-weight:800;font-size:16px" }, "🎯 One Saardha QR for all stores"),
          el("div", { class: "muted small", style: "margin:4px 0 10px" }, "Print this once and place it anywhere. Customers scan it and pick their store from the list — no separate QR per shop needed."),
          el("div", { style: "display:flex;gap:8px;flex-wrap:wrap" }, [
            el("button", { class: "btn primary sm", onClick: printMasterQr }, "🖨 Print / download"),
            el("a", { class: "btn ghost sm", href: masterQrUrl(), download: "saardha-qr.png", target: "_blank", rel: "noopener" }, "Save PNG"),
          ]),
        ]),
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
    const cash = r.cashInHand || 0;
    let close;
    async function doDelete(force) {
      try { await BW.deleteRider(r.id, force); close(); toast("Saradhi removed"); render(); }
      catch (e) {
        if (e.message === "cash_pending") {
          if (confirm("This Saradhi holds " + money(cash) + " cash-in-hand. Write it off and delete anyway?")) return doDelete(true);
        } else if ((e.message || "").indexOf("active delivery") >= 0) {
          toast("Reassign their active delivery first, then delete.");
        } else { toast(e.message || "Couldn't delete"); }
      }
    }
    close = UI.modal({
      title: "Delete Saradhi?",
      body: el("div", {}, [
        el("p", { class: "muted small" }, "This permanently removes " + (r.name || "this Saradhi") + " and their login. This can't be undone."),
        cash > 0 ? el("p", { class: "small", style: "color:var(--red)" }, "Holds " + money(cash) + " cash-in-hand — you'll be asked to write it off.") : document.createTextNode(""),
      ]),
      footer: [
        el("button", { class: "btn ghost", onClick: () => close() }, "Cancel"),
        el("button", { class: "btn danger", onClick: () => doDelete(false) }, "Delete"),
      ],
    });
  }

  // Full admin-driven onboarding: collect + verify docs, set pay, activate, print letters.
  function onboardRiderModal(r) {
    const d = r.documents || {};
    const docs = { dlUrl: d.dlUrl || "", aadhaarUrl: d.aadhaarUrl || "", bikePhotoUrl: d.bikePhotoUrl || "", familyIdUrl: d.familyIdUrl || "" };
    const ip = (val, ph, type) => el("input", { type: type || "text", value: val || "", placeholder: ph || "", style: "width:100%" });
    const ta = (val, ph) => { const t = el("textarea", { placeholder: ph || "", style: "width:100%;min-height:46px" }); t.value = val || ""; return t; };

    const nameEl = ip(r.name, "Full name");
    const phoneEl = ip(d.riderPhone || r.phone, "Phone", "tel");
    const addrEl = ta(d.riderAddress, "Full address");
    const dlNumEl = ip(d.dlNumber, "Driving licence number");
    const dobEl = ip(d.riderDob, "", "date");
    const vehNumEl = ip(d.vehicleNumber, "Vehicle number plate");
    const vehTypeEl = ip(r.vehicle || d.vehicleType, "Bike / Scooter / Cycle");
    const nomName = ip(d.familyName, "Nominee full name");
    const nomRel = ip(d.familyRelation, "Relation");
    const nomPhone = ip(d.familyPhone, "Nominee phone", "tel");
    const nomAddr = ta(d.familyAddress, "Nominee address");
    const desig = ip(r.designation || "Delivery Partner (Saradhi)", "Designation");
    const salaryEl = ip(r.salary != null ? r.salary : "", "e.g. 15000", "number");
    const allowEl = ip(r.allowance != null ? r.allowance : "", "e.g. 2000", "number");
    const incentiveEl = ta(r.incentive || "₹30 per delivery + performance bonus for 100+ deliveries/month", "Incentive terms");

    function uploadRow(label, key) {
      const st = el("span", { class: "muted small" }, docs[key] ? "✓ uploaded" : "not uploaded");
      const view = docs[key] ? el("a", { href: docs[key], target: "_blank", rel: "noopener", class: "small", style: "margin-left:6px" }, "view") : document.createTextNode("");
      const btn = el("button", { class: "btn ghost sm", type: "button" }, docs[key] ? "Replace" : "Upload");
      btn.onclick = () => {
        const inp = el("input", { type: "file", accept: "image/*" });
        inp.onchange = async () => { const f = inp.files && inp.files[0]; if (!f) return; st.textContent = "uploading…"; try { docs[key] = await uploadToCloudinary(f); st.textContent = "✓ uploaded"; } catch (e) { st.textContent = "failed"; toast(e.message || "Upload failed"); } };
        inp.click();
      };
      return el("div", { class: "row between", style: "align-items:center;margin:5px 0" }, [el("span", {}, label), el("span", { style: "display:flex;gap:6px;align-items:center" }, [st, view, btn])]);
    }
    const field = (label, node) => el("div", { class: "field", style: "margin-bottom:8px" }, [el("label", {}, label), node]);
    const errEl = el("div", { class: "auth-err" });

    // Profile photo (avatar).
    let _photoUrl = r.photoUrl || "";
    const photoPrev = el("div", { style: "width:64px;height:64px;border-radius:50%;overflow:hidden;background:var(--surface-2,#eee);flex-shrink:0;display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:11px" });
    function renderPhoto() { photoPrev.innerHTML = ""; if (_photoUrl) photoPrev.appendChild(el("img", { src: _photoUrl, style: "width:100%;height:100%;object-fit:cover" })); else photoPrev.appendChild(document.createTextNode("photo")); }
    renderPhoto();
    const photoBtn = el("button", { class: "btn ghost sm", type: "button" }, _photoUrl ? "Change photo" : "Add photo");
    photoBtn.onclick = () => {
      const inp = el("input", { type: "file", accept: "image/*" });
      inp.onchange = async () => { const f = inp.files && inp.files[0]; if (!f) return; photoBtn.textContent = "Uploading…"; try { _photoUrl = await uploadToCloudinary(f); renderPhoto(); } catch (e) { toast(e.message || "Upload failed"); } photoBtn.textContent = "Change photo"; };
      inp.click();
    };

    // Payment & settlement controls.
    const cashNow = el("strong", { style: (r.cashInHand || 0) > 0 ? "color:var(--red)" : "" }, money(r.cashInHand || 0));
    const clearCashBtn = el("button", { class: "btn danger sm", onClick: async () => {
      if (!confirm("Clear cash-in-hand to ₹0? This records a manual settlement.")) return;
      try { await BW.updateRiderDetails(r.id, { cashInHand: 0 }); r.cashInHand = 0; cashNow.textContent = money(0); cashNow.style.color = ""; toast("Cash cleared to ₹0"); } catch (e) { toast(e.message || "Failed"); }
    } }, "Clear cash → ₹0");
    const resetDelBtn = el("button", { class: "btn ghost sm", onClick: async () => {
      try { await BW.updateRiderDetails(r.id, { deliveriesToday: 0 }); toast("Today's deliveries reset"); } catch (e) { toast(e.message || "Failed"); }
    } }, "Reset today's deliveries");

    function collect() {
      return {
        id: r.id, name: nameEl.value.trim(), phone: phoneEl.value.trim(), address: addrEl.value.trim(),
        dlNumber: dlNumEl.value.trim(), riderDob: dobEl.value, vehicleNumber: vehNumEl.value.trim(), vehicleType: vehTypeEl.value.trim(),
        nomName: nomName.value.trim(), nomRel: nomRel.value.trim(), nomPhone: nomPhone.value.trim(), nomAddr: nomAddr.value.trim(),
        designation: desig.value.trim(), salary: Number(salaryEl.value) || 0, allowance: Number(allowEl.value) || 0, incentive: incentiveEl.value.trim(),
      };
    }
    async function saveAll() {
      await BW.submitRiderDocuments(r.id, {
        dlUrl: docs.dlUrl, dlNumber: dlNumEl.value.trim(), riderDob: dobEl.value,
        aadhaarUrl: docs.aadhaarUrl, bikePhotoUrl: docs.bikePhotoUrl, vehicleNumber: vehNumEl.value.trim(), vehicleType: vehTypeEl.value.trim(),
        riderPhone: phoneEl.value.trim(), riderAddress: addrEl.value.trim(),
        familyName: nomName.value.trim(), familyRelation: nomRel.value.trim(), familyPhone: nomPhone.value.trim(), familyAddress: nomAddr.value.trim(), familyIdUrl: docs.familyIdUrl,
      });
      await BW.updateRiderDetails(r.id, { name: nameEl.value.trim(), phone: phoneEl.value.trim(), vehicle: vehTypeEl.value.trim(), designation: desig.value.trim(), salary: Number(salaryEl.value) || 0, allowance: Number(allowEl.value) || 0, incentive: incentiveEl.value.trim(), photoUrl: _photoUrl });
    }

    const body = el("div", { style: "max-height:64vh;overflow:auto" }, [
      el("div", { style: "display:flex;align-items:center;gap:12px;margin-bottom:10px" }, [photoPrev, el("div", {}, [el("div", { style: "font-weight:800" }, "Profile photo"), photoBtn])]),
      el("div", { style: "font-weight:800;margin-bottom:6px" }, "Identity & vehicle"),
      field("Full name", nameEl), field("Phone", phoneEl), field("Address", addrEl),
      el("div", { style: "display:flex;gap:8px" }, [el("div", { style: "flex:1" }, [field("DL number", dlNumEl)]), el("div", { style: "flex:1" }, [field("Date of birth", dobEl)])]),
      el("div", { style: "display:flex;gap:8px" }, [el("div", { style: "flex:1" }, [field("Vehicle no.", vehNumEl)]), el("div", { style: "flex:1" }, [field("Vehicle type", vehTypeEl)])]),
      el("div", { style: "font-weight:800;margin:10px 0 4px" }, "Documents"),
      uploadRow("Driving licence", "dlUrl"), uploadRow("Aadhaar card", "aadhaarUrl"), uploadRow("Vehicle photo (number plate)", "bikePhotoUrl"), uploadRow("Nominee Aadhaar / ID", "familyIdUrl"),
      el("div", { style: "font-weight:800;margin:10px 0 4px" }, "Nominee (guarantor)"),
      el("div", { style: "display:flex;gap:8px" }, [el("div", { style: "flex:1" }, [field("Name", nomName)]), el("div", { style: "flex:1" }, [field("Relation", nomRel)])]),
      el("div", { style: "display:flex;gap:8px" }, [el("div", { style: "flex:1" }, [field("Phone", nomPhone)]), el("div", { style: "flex:2" }, [field("Address", nomAddr)])]),
      el("div", { style: "font-weight:800;margin:10px 0 4px" }, "Compensation"),
      field("Designation", desig),
      el("div", { style: "display:flex;gap:8px" }, [el("div", { style: "flex:1" }, [field("Monthly salary (₹)", salaryEl)]), el("div", { style: "flex:1" }, [field("Allowance (₹)", allowEl)])]),
      field("Incentive terms", incentiveEl),
      el("div", { style: "font-weight:800;margin:10px 0 4px" }, "Payment & settlement"),
      el("div", { class: "row between", style: "align-items:center;margin-bottom:8px" }, [el("span", { class: "muted" }, "Cash-in-hand (owed to Saardha)"), cashNow]),
      el("div", { style: "display:flex;gap:8px;flex-wrap:wrap" }, [clearCashBtn, resetDelBtn]),
      errEl,
    ]);

    const close = UI.modal({
      title: "Onboard / Manage · " + (r.name || "Saradhi"),
      body,
      footer: [
        el("button", { class: "btn ghost", onClick: () => close() }, "Close"),
        el("button", { class: "btn ghost", onClick: () => generateLetter(collect(), "offer") }, "📄 Offer letter"),
        el("button", { class: "btn ghost", onClick: () => generateLetter(collect(), "onboarding") }, "📄 Onboarding letter"),
        el("button", { class: "btn primary", onClick: async (e) => {
          const btn = e.target; btn.disabled = true; btn.textContent = "Saving…"; errEl.textContent = "";
          try { await saveAll(); toast("Saved"); btn.disabled = false; btn.textContent = "Save"; }
          catch (er) { errEl.textContent = er.message || "Save failed"; btn.disabled = false; btn.textContent = "Save"; }
        } }, "Save"),
        el("button", { class: "btn success", onClick: async (e) => {
          const btn = e.target; btn.disabled = true; btn.textContent = "Activating…"; errEl.textContent = "";
          try {
            await saveAll();
            await BW.verifyRiderItem(r.id, "dl", "verified"); await BW.verifyRiderItem(r.id, "rc", "verified");
            await BW.verifyRiderItem(r.id, "aadhaar", "verified"); await BW.verifyRiderItem(r.id, "nominee", "verified");
            await BW.updateRiderDetails(r.id, { active: true, onboardedAt: new Date().toISOString().slice(0, 10) });
            toast("Saradhi verified & activated ✓"); close(); render();
          } catch (er) { errEl.textContent = er.message || "Activation failed"; btn.disabled = false; btn.textContent = "✓ Verify & Activate"; }
        } }, "✓ Verify & Activate"),
      ],
    });
  }

  // Open a printable offer / onboarding letter in a new window (admin saves as PDF / prints).
  function generateLetter(x, type) {
    const today = new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
    const sal = x.salary ? ("₹" + Number(x.salary).toLocaleString("en-IN")) : "—";
    const allw = x.allowance ? ("₹" + Number(x.allowance).toLocaleString("en-IN")) : "—";
    const isOffer = type === "offer";
    const title = isOffer ? "Offer Letter" : "Onboarding Letter";
    const intro = isOffer
      ? "We are pleased to offer you the position of <b>" + esc(x.designation || "Delivery Partner (Saradhi)") + "</b> with Saardha. The terms of this offer are set out below."
      : "Welcome to the Saardha team! This letter confirms your onboarding as a <b>" + esc(x.designation || "Delivery Partner (Saradhi)") + "</b>. Your engagement details are set out below.";
    const esc2 = (s) => String(s == null ? "" : s).replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
    function esc(s) { return esc2(s); }
    const html =
      "<!DOCTYPE html><html><head><meta charset='utf-8'><title>Saardha — " + title + "</title>" +
      "<style>body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1b1d24;line-height:1.65;max-width:720px;margin:0 auto;padding:36px 28px}" +
      ".hd{display:flex;align-items:center;gap:12px;border-bottom:2px solid #e62a1f;padding-bottom:12px;margin-bottom:20px}" +
      ".hd h1{font-size:22px;margin:0;color:#e62a1f}.muted{color:#666;font-size:13px}h2{font-size:16px;margin:22px 0 6px}" +
      "table{border-collapse:collapse;width:100%;margin:8px 0}td{padding:7px 10px;border:1px solid #e5e5e5;font-size:14px}td:first-child{color:#555;width:42%}" +
      ".sign{margin-top:40px;display:flex;justify-content:space-between}.note{font-size:12px;color:#777;margin-top:26px}" +
      "@media print{.noprint{display:none}}button{background:#e62a1f;color:#fff;border:none;padding:9px 16px;border-radius:8px;cursor:pointer}</style></head><body>" +
      "<div class='noprint' style='text-align:right;margin-bottom:8px'><button onclick='window.print()'>🖨 Print / Save as PDF</button></div>" +
      "<div class='hd'><div><h1>Saardha</h1><div class='muted'>Local logistics &amp; premium home delivery</div></div></div>" +
      "<div class='muted'>Date: " + today + "</div>" +
      "<h2>" + title + "</h2>" +
      "<p>Dear " + esc(x.name || "Saradhi") + ",</p><p>" + intro + "</p>" +
      "<table>" +
      "<tr><td>Name</td><td>" + esc(x.name || "—") + "</td></tr>" +
      "<tr><td>Designation</td><td>" + esc(x.designation || "Delivery Partner (Saradhi)") + "</td></tr>" +
      "<tr><td>Phone</td><td>" + esc(x.phone || "—") + "</td></tr>" +
      "<tr><td>Address</td><td>" + esc(x.address || "—") + "</td></tr>" +
      "<tr><td>Vehicle</td><td>" + esc([x.vehicleType, x.vehicleNumber].filter(Boolean).join(" · ") || "—") + "</td></tr>" +
      "<tr><td>Monthly salary</td><td>" + sal + "</td></tr>" +
      "<tr><td>Allowance</td><td>" + allw + "</td></tr>" +
      "<tr><td>Incentive</td><td>" + esc(x.incentive || "—") + "</td></tr>" +
      "<tr><td>Nominee</td><td>" + esc([x.nomName, x.nomRel, x.nomPhone].filter(Boolean).join(" · ") || "—") + "</td></tr>" +
      "</table>" +
      (isOffer
        ? "<p>This offer is subject to verification of your submitted documents (driving licence, Aadhaar, vehicle and nominee details) and acceptance of the Saardha Delivery Partner Agreement, including the cash-settlement terms.</p>"
        : "<p>Your documents have been verified and your account is active. You are bound by the Saardha Delivery Partner Agreement, including the cash-settlement obligations. All COD cash you collect belongs to Saardha and must be settled in full and on time.</p>") +
      "<div class='sign'><div>____________________<br><span class='muted'>Saradhi signature</span></div><div>____________________<br><span class='muted'>For Saardha</span></div></div>" +
      "<div class='note'>This is a computer-generated letter from the Saardha admin console. Please review with a qualified professional before issuing officially.</div>" +
      "</body></html>";
    const w = window.open("", "_blank");
    if (!w) { toast("Allow pop-ups to open the letter"); return; }
    w.document.open(); w.document.write(html); w.document.close();
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
    const platformRevenue = gstSum + deliveryFees;   // Saardha keeps GST + delivery fee
    const merchantPayable = grossSales;              // merchants are paid the full item cost
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
    // Unsettled payable = all delivered orders (any date) not yet marked settled.
    const unsettledMap = {};
    BW.orders().filter((o) => o.status === "DELIVERED" && !o.vendorSettled).forEach((o) => {
      const id = o.vendorId; if (!id) return;
      const u = unsettledMap[id] || (unsettledMap[id] = { gross: 0, orders: 0 });
      u.gross += Number(o.subtotal || 0); u.orders++;
    });
    const vendorIds = Array.from(new Set([...Object.keys(vendMap), ...Object.keys(unsettledMap)]));
    const vendRows = vendorIds.map((id) => {
      const m = vendMap[id] || { orders: 0, gross: 0 };
      const u = unsettledMap[id] || { orders: 0, gross: 0 };
      const v = BW.vendor(id);
      const unsettledNet = u.gross;   // merchant is owed the full item cost
      const settleBtn = u.orders > 0
        ? el("button", { class: "btn success sm", onClick: async (e) => { e.target.disabled = true; try { const r = await BW.settleVendor(id); toast("Settled " + money(r.amount) + " (" + r.orderCount + " orders)"); render(); } catch (er) { toast(er.message || "Settle failed"); e.target.disabled = false; } } }, "Settle " + money(unsettledNet))
        : el("span", { class: "muted small" }, "—");
      return el("tr", {}, [
        el("td", {}, el("strong", {}, v ? v.name : id)),
        el("td", {}, String(m.orders)),
        el("td", { style: "color:#1a9d54;font-weight:700" }, money(m.gross)),
        el("td", { style: unsettledNet > 0 ? "color:var(--red);font-weight:700" : "" }, money(unsettledNet)),
        el("td", {}, settleBtn),
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
        el("div", {}, [el("h1", { class: "page-title" }, "Earnings & Settlements"), el("p", { class: "page-sub" }, "Merchants get item cost only · Saardha keeps GST + delivery · Saradhis are salaried (no commission)")]),
        el("button", { class: "btn ghost sm", onClick: () => go("settings") }, "Change rates"),
      ]),
      chips,
      el("div", { style: "display:flex;gap:12px;flex-wrap:wrap;margin-bottom:18px" }, [
        card("Delivered orders", String(delivered.length)),
        card("Item sales (merchant payable)", money(merchantPayable), "item cost — paid to stores"),
        card("Saardha revenue", money(platformRevenue), "GST " + money(gstSum) + " + delivery " + money(deliveryFees)),
        card("Rider payouts", money(riderPayouts), delivered.length + " × ₹" + payPerDelivery + " (incentive)"),
      ]),
      el("h3", { style: "margin:0 0 8px" }, "Riders — earnings & cash to settle"),
      el("div", { class: "card", style: "padding:0;overflow:hidden;margin-bottom:20px" }, [
        el("table", {}, [
          el("thead", {}, el("tr", {}, ["Saradhi", "Deliveries", "Earnings", "Cash collected", "UPI collected", "Cash-in-hand (to settle)"].map((h) => el("th", {}, h)))),
          el("tbody", {}, riderRows.length ? riderRows : [el("tr", {}, el("td", { colspan: "6", class: "muted", style: "text-align:center;padding:20px" }, "No deliveries in this period."))]),
        ]),
      ]),
      el("h3", { style: "margin:0 0 4px" }, "Merchants — payable & settlement"),
      el("p", { class: "page-sub", style: "margin:0 0 8px" }, "Working cycle 9am–9pm. Accounts settle each store twice daily (≈9am & 9pm). 'Settle' pays out all delivered orders not yet settled."),
      el("div", { class: "card", style: "padding:0;overflow-x:auto" }, [
        el("table", { style: "min-width:620px" }, [
          el("thead", {}, el("tr", {}, ["Store", "Orders (period)", "Item sales (period)", "Unsettled (payable)", "Settle"].map((h) => el("th", {}, h)))),
          el("tbody", {}, vendRows.length ? vendRows : [el("tr", {}, el("td", { colspan: "5", class: "muted", style: "text-align:center;padding:20px" }, "No delivered orders yet."))]),
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
      case "offers":    return viewOffers();
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
    openTicketDetail._openId = null; // showing the list, no single ticket open
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
    openTicketDetail._container = container; openTicketDetail._openId = id; // for live socket refresh
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
  /* ====================== OFFERS (platform promo codes) ====================== */
  async function viewOffers() {
    let promos = [];
    try { promos = await BW.listPromos(); } catch (e) { promos = viewOffers._cache || []; }
    viewOffers._cache = promos;

    const edit = viewOffers._edit || null;   // code being edited, or null for a new one

    const codeEl  = el("input", { placeholder: "e.g. SAAR20", value: edit ? edit.code : "", autocapitalize: "characters", maxlength: "20", style: "text-transform:uppercase" });
    if (edit) codeEl.disabled = true;         // code is the key — don't rename, just edit fields
    const pctEl   = el("input", { type: "number", min: "1", max: "90", value: edit ? edit.pct : "20", style: "max-width:90px" });
    const minEl   = el("input", { type: "number", min: "0", value: edit ? (edit.minSubtotal || 0) : "0", style: "max-width:110px" });
    const capEl   = el("input", { type: "number", min: "0", value: edit ? (edit.totalCap || 0) : "0", style: "max-width:110px" });
    const expEl   = el("input", { type: "date", value: edit && edit.expiresAt ? String(edit.expiresAt).slice(0, 10) : "" });
    const onceEl  = el("input", { type: "checkbox" }); onceEl.checked = edit ? edit.perCustomerOnce !== false : true;
    const activeEl = el("input", { type: "checkbox" }); activeEl.checked = edit ? edit.active !== false : true;
    const noteEl  = el("input", { placeholder: "Internal note (optional)", value: edit ? (edit.note || "") : "", maxlength: "140" });

    const saveBtn = el("button", { class: "btn primary" }, edit ? "Save changes" : "Create code");
    saveBtn.addEventListener("click", async () => {
      const code = (codeEl.value || "").trim().toUpperCase();
      if (!/^[A-Z0-9]{3,20}$/.test(code)) { toast("Code must be 3–20 letters/numbers, no spaces."); return; }
      const pct = Number(pctEl.value);
      if (!(pct >= 1 && pct <= 90)) { toast("Enter a percent between 1 and 90."); return; }
      saveBtn.disabled = true; saveBtn.textContent = "Saving…";
      try {
        await BW.savePromo({
          code, pct,
          minSubtotal: Number(minEl.value) || 0,
          totalCap: Number(capEl.value) || 0,
          expiresAt: expEl.value ? new Date(expEl.value + "T23:59:59").toISOString() : null,
          perCustomerOnce: onceEl.checked,
          active: activeEl.checked,
          note: noteEl.value.trim(),
        });
        viewOffers._edit = null;
        toast(edit ? "Code updated" : "Code created");
        render();
      } catch (e) { toast("Error: " + (e.message || "failed")); saveBtn.disabled = false; saveBtn.textContent = edit ? "Save changes" : "Create code"; }
    });

    const formCard = el("div", { class: "card", style: "max-width:680px;margin-bottom:16px" }, [
      el("h3", { style: "margin-top:0" }, edit ? ("Edit " + edit.code) : "Create a promo code"),
      el("div", { style: "display:flex;gap:12px;flex-wrap:wrap" }, [
        el("div", { class: "field" }, [el("label", {}, "Code"), codeEl]),
        el("div", { class: "field" }, [el("label", {}, "Discount %"), pctEl]),
        el("div", { class: "field" }, [el("label", {}, "Min order ₹"), minEl]),
      ]),
      el("div", { style: "display:flex;gap:12px;flex-wrap:wrap" }, [
        el("div", { class: "field" }, [el("label", {}, "Expires on"), expEl]),
        el("div", { class: "field" }, [el("label", {}, "Total uses cap (0 = unlimited)"), capEl]),
      ]),
      el("label", { style: "display:flex;align-items:center;gap:8px;margin:6px 0" }, [onceEl, el("span", {}, "One use per customer")]),
      el("label", { style: "display:flex;align-items:center;gap:8px;margin:6px 0" }, [activeEl, el("span", {}, "Active (customers can use it now)")]),
      el("div", { class: "field" }, [el("label", {}, "Note"), noteEl]),
      el("div", { style: "display:flex;gap:8px" }, [
        saveBtn,
        edit ? el("button", { class: "btn ghost", onClick: () => { viewOffers._edit = null; render(); } }, "Cancel") : null,
      ].filter(Boolean)),
      el("p", { class: "muted small", style: "margin-bottom:0" }, "Codes work across every store. Saardha absorbs the discount — merchants still receive full item cost."),
    ]);

    function captionFor(p) {
      const exp = p.expiresAt ? (" Valid till " + new Date(p.expiresAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) + ".") : " Today only.";
      const minTxt = p.minSubtotal ? (" Min order ₹" + p.minSubtotal + ".") : "";
      return "🎉 Today's Saardha offer!\nUse code " + p.code + " for " + p.pct + "% OFF your order." + minTxt + exp + "\nOrder now on the Saardha app 🚚\n#Saardha #LocalDelivery #Offer";
    }

    const rows = promos.map((p) => {
      const expired = p.expiresAt && new Date(p.expiresAt) < new Date();
      const live = p.active !== false && !expired;
      const status = expired ? "expired" : (p.active !== false ? "live" : "paused");
      const capTxt = Number(p.totalCap) > 0 ? (Number(p.usedCount || 0) + " / " + p.totalCap) : String(Number(p.usedCount || 0));
      return el("tr", {}, [
        el("td", {}, el("strong", {}, p.code)),
        el("td", {}, p.pct + "%"),
        el("td", { class: "muted small" }, (p.minSubtotal ? "min ₹" + p.minSubtotal : "—") + (p.perCustomerOnce !== false ? " · 1/cust" : "")),
        el("td", { class: "muted small" }, p.expiresAt ? new Date(p.expiresAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "no expiry"),
        el("td", {}, capTxt),
        el("td", {}, el("span", { style: "font-weight:800;font-size:11px;padding:2px 8px;border-radius:20px;color:#fff;background:" + (live ? "#16a34a" : expired ? "#9ca3af" : "#dc2626") }, live ? "LIVE" : status.toUpperCase())),
        el("td", {}, el("div", { style: "display:flex;gap:6px;flex-wrap:wrap" }, [
          el("button", { class: "btn ghost sm", onClick: () => { if (navigator.clipboard) navigator.clipboard.writeText(captionFor(p)).then(() => toast("Instagram caption copied")); } }, "📋 Caption"),
          el("button", { class: "btn " + (p.active !== false ? "ghost" : "primary") + " sm", onClick: async () => { try { await BW.savePromo({ ...p, active: !(p.active !== false) }); toast(p.active !== false ? "Paused" : "Activated ✓"); render(); } catch (e) { toast(e.message); } } }, p.active !== false ? "⏸ Pause" : "▶ Activate"),
          el("button", { class: "btn ghost sm", onClick: () => { viewOffers._edit = p; render(); } }, "Edit"),
          el("button", { class: "btn ghost sm", onClick: async () => { if (!confirm("Delete code " + p.code + "?")) return; try { await BW.deletePromo(p.code); toast("Deleted"); render(); } catch (e) { toast(e.message); } } }, "Delete"),
        ])),
      ]);
    });

    shell("offers", [
      el("h1", { class: "page-title" }, "Offers & Promo Codes"),
      el("p", { class: "page-sub" }, "Create a fresh code each day, post it to your Instagram story, and followers redeem it at checkout."),
      formCard,
      el("div", { class: "card", style: "padding:0;overflow:hidden;overflow-x:auto" }, [
        el("table", {}, [
          el("thead", {}, el("tr", {}, ["Code", "Off", "Rules", "Expires", "Used", "Status", ""].map((h) => el("th", {}, h)))),
          el("tbody", {}, rows.length ? rows : [el("tr", {}, el("td", { colspan: "7", class: "muted", style: "text-align:center;padding:20px" }, "No codes yet. Create your first offer above."))]),
        ]),
      ]),
    ]);
  }

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
      try { await BW.updateSettings({ codCashLimit: val }); toast("COD limit set to ₹" + val); }
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
        toast("Support contact saved");
      } catch (err) { toast("Error: " + err.message); }
      spSave.disabled = false; spSave.textContent = "Save contact";
    });

    /* --- Festival / seasonal theme --- */
    const themeSel = el("select", { style: "max-width:260px" });
    const curTheme = s0.festivalTheme || "auto";
    const opt = (v, l) => themeSel.appendChild(el("option", { value: v, ...(curTheme === v ? { selected: "" } : {}) }, l));
    opt("auto", "Auto (today's festival)");
    opt("none", "None");
    // Build the rest from the shared festival calendar, grouped by category.
    const CAT_LABEL = { national: "National", telugu: "Telugu / South Indian", hindu: "Hindu", christian: "Christian", muslim: "Muslim", intl: "International days" };
    const fests = (window.Festivals && window.Festivals.list) ? window.Festivals.list : [];
    Object.keys(CAT_LABEL).forEach((cat) => {
      const inCat = fests.filter((f) => f.cat === cat);
      if (!inCat.length) return;
      const og = el("optgroup", { label: CAT_LABEL[cat] });
      inCat.forEach((f) => og.appendChild(el("option", { value: f.key, ...(curTheme === f.key ? { selected: "" } : {}) }, (f.emoji ? f.emoji + " " : "") + f.name)));
      themeSel.appendChild(og);
    });
    const themeSave = el("button", { class: "btn primary" }, "Save theme");
    themeSave.addEventListener("click", async () => {
      themeSave.disabled = true; themeSave.textContent = "Saving…";
      try { await BW.updateSettings({ festivalTheme: themeSel.value }); toast("Theme updated"); }
      catch (err) { toast("Error: " + err.message); }
      themeSave.disabled = false; themeSave.textContent = "Save theme";
    });

    /* --- Pay-on-delivery UPI (Saardha QR the Saradhi shows at the door) --- */
    const upiVpaEl  = el("input", { type: "text", value: s0.upiVpa || "", placeholder: "yourname@ybl (your UPI ID)", style: "width:100%;margin-bottom:6px" });
    const upiNameEl = el("input", { type: "text", value: s0.upiName || "Saardha", placeholder: "Payee name shown to customer", style: "width:100%;margin-bottom:6px" });
    let _upiQrUrl = s0.upiQrImageUrl || "";
    const qrPreview = el("div", { style: "margin:6px 0" });
    function renderQrPreview() { qrPreview.innerHTML = ""; if (_upiQrUrl) qrPreview.appendChild(el("img", { src: _upiQrUrl, alt: "UPI QR", style: "width:120px;height:120px;object-fit:contain;border:1px solid var(--border);border-radius:8px" })); }
    renderQrPreview();
    const qrUpBtn = el("button", { class: "btn ghost sm", type: "button" }, _upiQrUrl ? "Replace QR image" : "Upload QR image");
    qrUpBtn.onclick = () => {
      const inp = el("input", { type: "file", accept: "image/*" });
      inp.onchange = async () => {
        const f = inp.files && inp.files[0]; if (!f) return;
        qrUpBtn.textContent = "Uploading…";
        try { _upiQrUrl = await uploadToCloudinary(f); renderQrPreview(); toast("QR uploaded — remember to Save"); }
        catch (e) { toast(e.message || "Upload failed"); }
        qrUpBtn.textContent = "Replace QR image";
      };
      inp.click();
    };
    const upiSave   = el("button", { class: "btn primary" }, "Save UPI");
    upiSave.addEventListener("click", async () => {
      upiSave.disabled = true; upiSave.textContent = "Saving…";
      try { await BW.updateSettings({ upiVpa: upiVpaEl.value.trim(), upiName: upiNameEl.value.trim() || "Saardha", upiQrImageUrl: _upiQrUrl }); toast("UPI details saved"); }
      catch (err) { toast("Error: " + err.message); }
      upiSave.disabled = false; upiSave.textContent = "Save UPI";
    });

    /* --- Payouts: rider pay per delivery + merchant commission --- */
    const payEl = el("input", { type: "number", min: "0", value: String(s0.riderPayPerDelivery != null ? s0.riderPayPerDelivery : 30), style: "max-width:140px" });
    const commEl = el("input", { type: "number", min: "0", max: "100", value: String(s0.merchantCommissionPct != null ? s0.merchantCommissionPct : 10), style: "max-width:140px" });
    const paySave = el("button", { class: "btn primary" }, "Save payouts");
    paySave.addEventListener("click", async () => {
      paySave.disabled = true; paySave.textContent = "Saving…";
      try { await BW.updateSettings({ riderPayPerDelivery: Number(payEl.value) || 0, merchantCommissionPct: Number(commEl.value) || 0 }); toast("Payout settings saved"); }
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
      try { await BW.updateSettings({ operationalZones: zones }); toast("Operational zones saved"); }
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
        el("h3", { style: "margin-top:0" }, "Festival theme"),
        el("p", { class: "muted small", style: "margin:0 0 12px" }, "Themes the customer app for the day. 'Auto' detects today's occasion automatically — Hindu, Telugu, Christian, Muslim, national festivals and international days (Diwali, Ugadi, Eid, Christmas, Friendship Day…). Pick a specific one to force it, or 'None' to switch off."),
        el("div", { class: "field" }, [el("label", {}, "Theme"), themeSel]),
        el("div", { style: "margin-top:8px" }, [themeSave]),
      ]),
      el("div", { class: "card", style: "max-width:480px;margin-top:16px" }, [
        el("h3", { style: "margin-top:0" }, "Pay-on-delivery UPI"),
        el("p", { class: "muted small", style: "margin:0 0 12px" }, "The Saradhi shows this at the door so customers pay by UPI (or cash). Best: enter your UPI ID — the app then makes a QR with the order amount pre-filled. Or upload your existing QR image (e.g. PhonePe); customers type the amount."),
        el("div", { class: "field" }, [el("label", {}, "UPI ID (VPA) — recommended"), upiVpaEl]),
        el("div", { class: "field" }, [el("label", {}, "Payee name"), upiNameEl]),
        el("div", { class: "field" }, [el("label", {}, "…or upload a UPI QR image"), qrPreview, qrUpBtn]),
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
