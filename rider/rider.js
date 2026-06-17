/* =========================================================
 * Business Wheels — Rider App
 * /rider/rider.js
 * ========================================================= */
(function () {
  "use strict";
  const { el, money, timeAgo, toast, topbar } = UI;
  const S = BW.STATUS;
  const root = document.getElementById("root");

  /* ── State ─────────────────────────────────────────────── */
  let me = null;        // JWT user (uid, name, email, role)
  let myRider = null;   // Firestore rider doc
  let gpsWatchId = null;
  let gpsActive = false;
  let gpsError = null;

  /* ── Boot ─────────────────────────────────────────────── */
  async function boot() {
    me = await BWAuth.requireLogin("rider");
    await BW.init("rider");

    syncRider();
    startGPS();   // always share location while the app is open

    BW.subscribe(() => { syncRider(); render(); });
    render();
  }

  function syncRider() {
    myRider = BW.riders().find((r) => r.id === me.uid) || myRider;
  }

  /* ── GPS — always on while app is open ──────────────── */
  function startGPS() {
    if (!navigator.geolocation) {
      gpsError = "GPS not supported on this device";
      render();
      return;
    }
    if (gpsWatchId !== null) return;

    gpsWatchId = navigator.geolocation.watchPosition(
      (pos) => {
        gpsActive = true;
        gpsError = null;
        BW.updateMyLocation(me.uid, pos.coords.latitude, pos.coords.longitude)
          .catch(() => {});
        render();
      },
      (err) => {
        gpsActive = false;
        gpsError = err.code === 1 ? "Location permission denied" : "GPS signal lost";
        render();
      },
      { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 }
    );
  }

  /* ── Actions ──────────────────────────────────────────── */
  async function doAdvance(orderId) {
    try {
      const order = await BW.advanceOrder(orderId);
      toast("✓ " + BW.STATUS_LABEL[order.status]);
    } catch (err) {
      toast(err.message || "Failed to update order");
    }
  }

  /* ── Render ───────────────────────────────────────────── */
  function myOrders() {
    return BW.orders().filter((o) =>
      o.riderId === me.uid &&
      [S.ASSIGNED, S.PICKED_UP, S.OUT_FOR_DELIVERY].includes(o.status)
    );
  }

  function render() {
    const orders = myOrders();
    root.innerHTML = "";
    root.appendChild(renderTopBar());
    root.appendChild(renderStatusCard());
    root.appendChild(renderOrderList(orders));
  }

  /* ── Top bar ──────────────────────────────────────────── */
  function renderTopBar() {
    return topbar("Rider", [
      el("span", { class: "topbar-name" }, me ? (me.name || me.email) : ""),
      el("button", { class: "btn ghost sm", onclick: () => BW.logout() }, "Logout"),
    ]);
  }

  /* ── Status card ─────────────────────────────────────── */
  function renderStatusCard() {
    const statusLabel = !myRider ? "Loading…" :
      myRider.status === "on_delivery" ? "On Delivery" : "Available";

    const deliveriesText = myRider && myRider.deliveriesToday
      ? myRider.deliveriesToday + " delivered today"
      : null;

    const gpsLine = gpsActive ? "📍 Location sharing active" :
      gpsError ? "⚠️ " + gpsError : "📡 Acquiring GPS…";

    return el("div", { class: "rider-status-card" }, [
      el("div", { class: "rider-status-top" }, [
        el("span", { class: "badge " + (myRider ? myRider.status : "available") }, statusLabel),
        deliveriesText ? el("span", { class: "rider-deliveries-count" }, deliveriesText) : null,
      ].filter(Boolean)),
      el("p", { class: "rider-gps-line" }, gpsLine),
    ]);
  }

  /* ── Order list ─────────────────────────────────────── */
  function renderOrderList(orders) {
    const wrap = el("div", { class: "rider-orders" });

    if (!orders.length) {
      wrap.appendChild(el("div", { class: "empty" }, [
        el("div", { class: "e" }, "✅"),
        el("p", {}, "No active deliveries. Orders will appear here when assigned."),
      ]));
      return wrap;
    }

    wrap.appendChild(
      el("h3", { class: "page-title" }, "Active Deliveries (" + orders.length + ")")
    );
    orders.forEach((o) => wrap.appendChild(renderCard(o)));
    return wrap;
  }

  /* ── Order card ─────────────────────────────────────── */
  function renderCard(o) {
    const vendor = BW.vendor(o.vendorId);
    const itemCount = (o.items || []).reduce((s, i) => s + (i.qty || 1), 0);
    const deliverTo = o.deliverTo || o.deliveryAddress || "Address not set";

    const NEXT = {
      [S.ASSIGNED]:         { label: "✅ Confirm Pickup",   cls: "primary" },
      [S.PICKED_UP]:        { label: "🛺 Out for Delivery", cls: "accent"  },
      [S.OUT_FOR_DELIVERY]: { label: "📦 Mark Delivered",   cls: "success" },
    };
    const next = NEXT[o.status];

    return el("div", { class: "card rider-card" }, [
      el("div", { class: "order-card-head" }, [
        el("span", { class: "order-id" }, "#" + o.id.slice(-6).toUpperCase()),
        el("span", { class: "badge " + o.status }, BW.STATUS_LABEL[o.status] || o.status),
      ]),
      el("div", { class: "rider-card-body" }, [
        row("From",       vendor ? (vendor.emoji || "🏪") + " " + vendor.name : "—"),
        row("Deliver to", deliverTo),
        row("Items",      itemCount + " item" + (itemCount !== 1 ? "s" : "") + " · " + money(o.total || 0)),
        row("Placed",     timeAgo(o.createdAt)),
      ]),
      next ? el("button", {
        class: "btn " + next.cls + " rider-advance-btn",
        onclick: () => doAdvance(o.id),
      }, next.label) : null,
    ].filter(Boolean));
  }

  function row(label, value) {
    return el("div", { class: "rider-row" }, [
      el("span", { class: "rider-row-label" }, label),
      el("span", { class: "rider-row-val"   }, value),
    ]);
  }

  /* ── Go ─────────────────────────────────────────────── */
  boot().catch((err) => {
    console.error("[rider]", err);
    toast(err.message || "Failed to start rider app");
  });
})();
