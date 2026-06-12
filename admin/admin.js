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
      navItem("overview",  "📊", "Overview"),
      navItem("fleet",     "🛵", "Fleet"),
      navItem("assign",    "🎯", "Task Assignment", unassigned),
      navItem("vendors",   "🏪", "Vendors"),
      navItem("analytics", "📈", "Analytics"),
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
      el("p", { class: "page-sub" }, "Live snapshot across all vendors and riders."),
      el("div", { class: "grid cols-4" }, [
        stat("Total orders",  String(a.totalOrders || 0), "+" + (a.activeOrders || 0) + " active"),
        stat("Revenue",       money(Math.round(a.revenue || 0)), "avg " + money(Math.round(a.avgOrderValue || 0))),
        stat("Delivered",     String(a.deliveredOrders || 0), ""),
        stat("Riders online", (a.ridersOnline || 0) + " / " + riders.length, ""),
      ]),
      el("h3", { style: "margin:24px 0 10px" }, "Recent orders"),
      el("div", { class: "card", style: "padding:0;overflow:hidden" }, [
        el("table", {}, [
          el("thead", {}, el("tr", {}, ["Order", "Vendor", "Customer", "Total", "Status", "Rider", "When"].map((h) => el("th", {}, h)))),
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
      const head = r.status === "available" ? "🟢" : r.status === "on_delivery" ? "🟣" : "⚪";
      map.appendChild(el("div", { class: "pin", style: `left:${x}%;top:${y}%` }, [
        el("div", { class: "head" }, "🛵"),
        el("div", { class: "lbl small" }, head + " " + r.name.split(" ")[0]),
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
      el("h1", { class: "page-title" }, "Fleet Management"),
      el("p", { class: "page-sub" }, "Location-tracked, salaried riders. Set shift status and monitor load."),
      el("div", { class: "grid cols-2" }, [
        el("div", { class: "card" }, [
          el("div", { class: "row between" }, [
            el("h3", { style: "margin:0" }, "Live fleet map"),
            el("div", { class: "row small muted", style: "gap:12px" }, [el("span", {}, "🟢 available"), el("span", {}, "🟣 on delivery"), el("span", {}, "⚪ offline")]),
          ]),
          el("div", { style: "margin-top:12px" }, map),
        ]),
        el("div", { class: "card", style: "padding:0;overflow:hidden" }, [
          el("table", {}, [
            el("thead", {}, el("tr", {}, ["Rider", "Vehicle/Shift", "Rating", "Load", "Active", "Status"].map((h) => el("th", {}, h)))),
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
      "⚡ Auto-assign all (" + unassigned.length + ")");

    const cards = unassigned.length ? unassigned.map((o) => assignmentCard(o)) :
      [el("div", { class: "empty" }, [el("div", { class: "e" }, "✅"), "All active orders have a rider assigned."])];

    const assignedRows = orders.filter((o) => o.riderId).map((o) => {
      const v = BW.vendor(o.vendorId);
      const r = BW.riders().find((r) => r.id === o.riderId);
      return el("tr", {}, [
        el("td", {}, el("strong", {}, "#" + o.id.slice(-6).toUpperCase())),
        el("td", {}, v ? v.name : "—"),
        el("td", {}, statusBadge(o.status)),
        el("td", {}, r ? "🛵 " + r.name : "—"),
        el("td", {}, el("button", { class: "btn ghost sm", onClick: () => openReassign(o) }, "Reassign")),
      ]);
    });

    shell("assign", [
      el("div", { class: "row between" }, [
        el("div", {}, [el("h1", { class: "page-title" }, "Dynamic Task Assignment"), el("p", { class: "page-sub" }, "Match unassigned orders to the nearest available rider.")]),
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
        : el("div", { class: "small", style: "margin:8px 0;color:var(--red)" }, "No riders available"),
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
      body: el("div", { class: "field" }, [el("label", {}, "Rider"), sel]),
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
    toast(n ? "Auto-assigned " + n + " order(s)" : "No available riders");
  }

  /* ====================== VENDORS ====================== */
  function viewVendors() {
    const vendors = BW.vendors();
    const orders  = BW.orders();
    const rows = vendors.map((v) => {
      const vOrders = orders.filter((o) => o.vendorId === v.id);
      const rev = vOrders.filter((o) => o.status !== S.CANCELLED).reduce((s, o) => s + o.total, 0);
      return el("tr", {}, [
        el("td", {}, el("strong", {}, v.img + " " + v.name)),
        el("td", { class: "muted" }, v.category),
        el("td", { class: "muted" }, v.area),
        el("td", {}, "⭐ " + v.rating),
        el("td", {}, BW.products(v.id).length + " items"),
        el("td", {}, String(vOrders.length)),
        el("td", {}, money(rev)),
        el("td", {}, el("button", { class: "btn ghost sm", onClick: () => editVendor(v) }, "Edit")),
      ]);
    });

    shell("vendors", [
      el("div", { class: "row between" }, [
        el("div", {}, [el("h1", { class: "page-title" }, "Vendor Management"), el("p", { class: "page-sub" }, "Onboard and manage local vendors on the platform.")]),
        el("button", { class: "btn primary", onClick: () => editVendor(null) }, "+ Onboard vendor"),
      ]),
      el("div", { class: "card", style: "padding:0;overflow:hidden" }, [
        el("table", {}, [
          el("thead", {}, el("tr", {}, ["Vendor", "Category", "Area", "Rating", "Catalog", "Orders", "Revenue", ""].map((h) => el("th", {}, h)))),
          el("tbody", {}, rows.length ? rows : [el("tr", {}, el("td", { colspan: "8", class: "muted", style: "text-align:center;padding:24px" }, "No vendors yet."))]),
        ]),
      ]),
    ]);
  }

  function editVendor(v) {
    const isNew = !v;
    const name     = el("input", { value: v ? v.name : "", placeholder: "Vendor name" });
    const category = el("input", { value: v ? v.category : "", placeholder: "Groceries / Street Food …" });
    const area     = el("input", { value: v ? v.area : "", placeholder: "Area / locality" });
    const emoji    = el("input", { value: v ? v.img : "🏪", placeholder: "🏪" });
    const body = el("div", {}, [
      el("div", { class: "field" }, [el("label", {}, "Name"), name]),
      el("div", { class: "field" }, [el("label", {}, "Category"), category]),
      el("div", { class: "field" }, [el("label", {}, "Area"), area]),
      el("div", { class: "field" }, [el("label", {}, "Icon (emoji)"), emoji]),
    ]);
    const close = UI.modal({
      title: isNew ? "Onboard vendor" : "Edit vendor",
      body,
      footer: [
        el("button", { class: "btn ghost", onClick: () => close() }, "Cancel"),
        el("button", { class: "btn primary", onClick: async () => {
          if (!name.value.trim()) { toast("Name required"); return; }
          try {
            await BW.upsertVendor({
              id: v ? v.id : undefined,
              name: name.value.trim(),
              category: category.value.trim() || "General",
              area: area.value.trim() || "—",
              img: emoji.value.trim() || "🏪",
              rating: v ? v.rating : 5.0,
              prepMins: v ? v.prepMins : 10,
              lat: v ? v.lat : 12.95,
              lng: v ? v.lng : 77.61,
            });
            toast(isNew ? "Vendor onboarded" : "Vendor updated");
            close();
          } catch (err) { toast("Error: " + err.message); }
        } }, "Save"),
      ],
    });
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
      default:          return viewOverview();
    }
  }

  boot().catch((err) => {
    console.error("Boot failed:", err);
    root.innerHTML = `<div class="bw-loading" style="color:var(--red)">Failed to connect to server. Is the backend running?</div>`;
  });
})();
