/* =========================================================
 * Saardha — Rider App
 * /rider/rider.js
 * ========================================================= */
(function () {
  "use strict";
  const { el, money, timeAgo, toast, topbar, modal } = UI;
  const S = BW.STATUS;
  const root = document.getElementById("root");

  /* ── State ─────────────────────────────────────────────── */
  let me = null;        // JWT user (uid, name, email, role)
  let myRider = null;   // Firestore rider doc
  let gpsWatchId = null;
  let gpsActive = false;
  let gpsError = null;
  let _seenOrderIds = new Set();

  /* ── Boot ─────────────────────────────────────────────── */
  async function boot() {
    me = await BWAuth.requireLogin("rider");
    await BW.init("rider");

    syncRider();
    startGPS();   // always share location while the app is open

    // Seed so we only alarm on deliveries assigned AFTER the app opened
    _seenOrderIds = new Set(
      BW.orders().filter((o) => o.riderId === me.uid && o.status === S.ASSIGNED).map((o) => o.id)
    );
    BW.subscribe(() => { syncRider(); checkNewOrders(); render(); });
    render();
  }

  /* ── New-assignment alarm ─────────────────────────────── */
  function checkNewOrders() {
    const assigned = BW.orders().filter((o) => o.riderId === me.uid && o.status === S.ASSIGNED);
    const fresh = assigned.filter((o) => !_seenOrderIds.has(o.id));
    if (!fresh.length) return;
    fresh.forEach((o) => _seenOrderIds.add(o.id));
    if (window.Buzzer) window.Buzzer.play();
    toast("🔔 New delivery assigned to you");
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
    // Final step (Out for delivery → Delivered) needs the customer's OTP (+ cash for COD)
    const cur = BW.orders().find((o) => o.id === orderId);
    if (cur && cur.status === S.OUT_FOR_DELIVERY) { promptDeliver(cur); return; }
    try {
      const order = await BW.advanceOrder(orderId);
      toast(BW.STATUS_LABEL[order.status]);
    } catch (err) {
      toast(err.message || "Failed to update order");
    }
  }

  /* ── Render ───────────────────────────────────────────── */
  function myOrders() {
    return BW.orders().filter((o) =>
      o.riderId === me.uid &&
      [S.PLACED, S.ACCEPTED, S.ASSIGNED, S.PICKED_UP, S.OUT_FOR_DELIVERY].includes(o.status)
    );
  }

  function render() {
    const orders = myOrders();
    root.innerHTML = "";
    root.appendChild(renderTopBar());
    root.appendChild(renderStatusCard());
    root.appendChild(renderCashCard());
    root.appendChild(renderRatingsCard());
    root.appendChild(renderOrderList(orders));
  }

  /* ── Cash-in-hand (COD floating balance) ───────────────── */
  function renderCashCard() {
    const cash = (myRider && myRider.cashInHand) || 0;
    const limit = BW.codCashLimit ? BW.codCashLimit() : 2000;
    const pct = Math.min(100, Math.round((cash / limit) * 100));
    const over = cash >= limit;
    const suspended = over && myRider && myRider.cashOverLimitSince &&
      (Date.now() - new Date(myRider.cashOverLimitSince).getTime() > 24 * 3600 * 1000);
    return el("div", { class: "rider-status-card", style: "margin-top:12px" }, [
      el("div", { class: "row between", style: "align-items:center" }, [
        el("div", {}, [
          el("div", { style: "font-weight:800;font-size:15px" }, "Cash in hand"),
          el("div", { class: "muted small" }, "Limit " + money(limit) + (over ? " · over limit" : "")),
        ]),
        el("div", { style: "font-size:22px;font-weight:800;color:" + (over ? "var(--red)" : "var(--brand)") }, money(cash)),
      ]),
      el("div", { style: "height:10px;background:var(--surface-2);border-radius:999px;overflow:hidden;margin-top:10px" }, [
        el("div", { style: "height:100%;width:" + pct + "%;background:" + (over ? "var(--red)" : "linear-gradient(90deg,var(--brand),var(--brand-2))") }),
      ]),
      suspended ? el("div", { class: "auth-err", style: "margin-top:10px;text-align:left" }, "Duty suspended — settle your cash to go back online.") : null,
      cash > 0 ? el("button", {
        class: "btn " + (over ? "danger" : "primary") + " sm", style: "width:100%;margin-top:12px",
        onClick: () => settleCash(Math.round(cash)),
      }, "Settle " + money(Math.round(cash)) + " via UPI") : null,
    ].filter(Boolean));
  }

  async function settleCash(amount) {
    if (typeof Razorpay === "undefined") { toast("Settlement is unavailable right now."); return; }
    try {
      const start = await BW.settleCashStart(me.uid, amount);
      const rzp = new Razorpay({
        key: start.keyId, amount: start.amount, currency: start.currency, order_id: start.razorpayOrderId,
        name: "Saardha", description: "Cash settlement",
        handler: async function (resp) {
          try {
            await BW.settleCashVerify(me.uid, {
              razorpay_payment_id: resp.razorpay_payment_id, razorpay_order_id: resp.razorpay_order_id,
              razorpay_signature: resp.razorpay_signature, amount: amount,
            });
            await syncRider(); toast("Cash settled — thank you!"); render();
          } catch (e) { toast(e.message || "Could not confirm settlement."); }
        },
      });
      rzp.open();
    } catch (e) { toast(e.message || "Could not start settlement."); }
  }

  /* ── Geofence check when going on duty ─────────────────── */
  function haversineKm(la1, lo1, la2, lo2) {
    if (la1 == null || lo1 == null || la2 == null || lo2 == null) return Infinity;
    var R = 6371, toR = function (d) { return d * Math.PI / 180; };
    var dLa = toR(la2 - la1), dLo = toR(lo2 - lo1);
    var a = Math.sin(dLa / 2) ** 2 + Math.cos(toR(la1)) * Math.cos(toR(la2)) * Math.sin(dLo / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
  function checkGeofence() {
    return new Promise(function (resolve) {
      var zones = BW.operationalZones ? BW.operationalZones() : [];
      if (!zones.length) return resolve(true); // no zones configured → allow
      if (!navigator.geolocation) { toast("Enable location to go on duty."); return resolve(false); }
      navigator.geolocation.getCurrentPosition(function (pos) {
        var lat = pos.coords.latitude, lng = pos.coords.longitude;
        var inside = zones.some(function (z) { return haversineKm(lat, lng, z.lat, z.lng) <= (z.radiusKm || 5); });
        if (!inside) { toast("You're outside the operational zone — move closer to go on duty."); resolve(false); }
        else resolve(true);
      }, function () { toast("Couldn't get your location. Allow GPS to go on duty."); resolve(false); },
        { enableHighAccuracy: true, timeout: 10000 });
    });
  }

  /* ── Delivery: collect OTP (+ cash for COD) ────────────── */
  function promptDeliver(order) {
    const isCod = order.paymentMethod === "COD";
    const otpIn = el("input", { inputmode: "numeric", maxlength: "4", placeholder: "4-digit OTP from customer", style: "width:100%;margin-bottom:10px" });
    const cashIn = isCod ? el("input", { inputmode: "numeric", placeholder: "Cash collected (₹)", value: String(order.total || ""), style: "width:100%;margin-bottom:10px" }) : null;
    const err = el("div", { class: "auth-err", style: "text-align:left" });
    let close;
    const submit = el("button", { class: "btn success" }, "Mark Delivered");
    submit.addEventListener("click", async function () {
      const otp = otpIn.value.trim();
      if (otp.length !== 4) { err.textContent = "Enter the 4-digit OTP the customer shows you."; return; }
      const body = { otp: otp };
      if (isCod) { const c = Number(cashIn.value); if (!c || c <= 0) { err.textContent = "Enter the cash amount collected."; return; } body.cashCollected = c; }
      submit.disabled = true; submit.textContent = "Confirming…";
      try { await BW.advanceOrder(order.id, body); if (close) close(); toast("Delivered ✓"); await syncRider(); render(); }
      catch (e) { err.textContent = e.message || "Could not complete delivery."; submit.disabled = false; submit.textContent = "Mark Delivered"; }
    });
    close = modal({
      title: "Complete delivery · #" + order.id.slice(-6).toUpperCase(),
      body: el("div", {}, [
        el("p", { class: "muted small", style: "margin:0 0 10px" }, "Ask the customer for their 4-digit delivery OTP" + (isCod ? " and collect the cash." : ".")),
        otpIn, cashIn, err,
      ].filter(Boolean)),
      footer: [submit],
    });
  }

  /* ── Ratings & feedback from customers ─────────────────── */
  function renderRatingsCard() {
    const rated = BW.orders().filter((o) => o.riderId === me.uid && o.rating && o.rating.rider != null);
    const count = rated.length;
    const avg = count ? (rated.reduce((s, o) => s + o.rating.rider, 0) / count)
                      : ((myRider && myRider.rating) || null);
    const stars = (n) => "★".repeat(Math.round(n)) + "☆".repeat(5 - Math.round(n));
    const comments = rated.filter((o) => o.rating.comment)
      .sort((a, b) => new Date(b.rating.at) - new Date(a.rating.at)).slice(0, 6);

    return el("div", { class: "rider-status-card", style: "margin-top:12px" }, [
      el("div", { class: "row between", style: "align-items:center" }, [
        el("div", {}, [
          el("div", { style: "font-weight:800;font-size:15px" }, "My rating"),
          el("div", { class: "muted small" }, count ? (count + " rated deliver" + (count === 1 ? "y" : "ies")) : "No ratings yet"),
        ]),
        el("div", { style: "text-align:right" }, [
          el("div", { style: "font-size:22px;font-weight:800;color:var(--brand)" }, avg ? avg.toFixed(1) : "—"),
          el("div", { style: "color:#f5a623;font-size:13px" }, avg ? stars(avg) : ""),
        ]),
      ]),
      comments.length
        ? el("div", { style: "margin-top:10px" }, comments.map((o) => el("div", { style: "padding:8px 0;border-top:0.5px solid var(--border)" }, [
            el("div", { style: "color:#f5a623;font-size:12px" }, stars(o.rating.rider)),
            el("div", { class: "small", style: "margin-top:2px" }, o.rating.comment),
          ])))
        : null,
    ].filter(Boolean));
  }

  /* ── Top bar ──────────────────────────────────────────── */
  function renderTopBar() {
    return topbar("Saradhi", [
      el("span", { class: "topbar-name" }, me ? (me.name || me.email) : ""),
      el("button", { class: "btn ghost sm", onClick: () => BW.logout() }, "Logout"),
    ]);
  }

  /* ── Status card ─────────────────────────────────────── */
  function renderStatusCard() {
    const statusLabel = !myRider ? "Loading…" :
      myRider.status === "on_delivery" ? "On Delivery" :
      myRider.status === "offline"     ? "Offline" : "Online";

    const deliveriesText = myRider && myRider.deliveriesToday
      ? myRider.deliveriesToday + " delivered today"
      : null;

    const gpsLine = gpsActive ? "Location sharing active" :
      gpsError ? "Warning: " + gpsError : "Acquiring GPS signal...";

    const isOnline = myRider && myRider.status !== "offline";
    const toggleBtn = el("button", {
      class: "btn sm " + (isOnline ? "danger" : "success"),
      style: "margin-top:12px;width:100%",
      disabled: myRider && myRider.status === "on_delivery",
      onClick: async () => {
        if (!myRider) return;
        const next = isOnline ? "offline" : "available";
        if (next === "available") {
          const inZone = await checkGeofence();   // blocks + toasts if outside the operational zone
          if (!inZone) return;
        }
        try {
          await BW.setMyRiderStatus(me.uid, next);
          toast(next === "available" ? "You are now Online" : "You are now Offline");
        } catch (err) { toast("Error: " + err.message); }
      },
    }, myRider && myRider.status === "on_delivery"
        ? "On Delivery"
        : isOnline ? "Go Offline" : "Go Online");

    return el("div", { class: "rider-status-card" }, [
      el("div", { class: "rider-status-top" }, [
        el("span", { class: "badge " + (myRider ? myRider.status : "offline") }, statusLabel),
        deliveriesText ? el("span", { class: "rider-deliveries-count" }, deliveriesText) : null,
      ].filter(Boolean)),
      el("p", { class: "rider-gps-line" }, gpsLine),
      toggleBtn,
    ]);
  }

  /* ── Order list ─────────────────────────────────────── */
  function renderOrderList(orders) {
    const wrap = el("div", { class: "rider-orders" });

    if (!orders.length) {
      wrap.appendChild(el("div", { class: "empty" }, [
        el("div", { class: "e" }, ""),
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

  /* ── Map link helpers ───────────────────────────────── */
  function mapsLink(lat, lng, label) {
    if (!lat || !lng) return null;
    const url = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
    return el("a", { class: "rider-map-btn", href: url, target: "_blank", rel: "noopener" }, label);
  }

  function directionsLink(fromLat, fromLng, toLat, toLng) {
    if (!fromLat || !fromLng || !toLat || !toLng) return null;
    const url = `https://www.google.com/maps/dir/?api=1&origin=${fromLat},${fromLng}&destination=${toLat},${toLng}&travelmode=driving`;
    return el("a", { class: "rider-map-btn rider-map-btn--nav", href: url, target: "_blank", rel: "noopener" }, "Navigate");
  }

  /* ── Order card ─────────────────────────────────────── */
  function renderCard(o) {
    const vendor = BW.vendor(o.vendorId);
    const itemCount = (o.items || []).reduce((s, i) => s + (i.qty || 1), 0);
    const deliverTo = o.deliverTo || o.deliveryAddress || "Address not set";

    const NEXT = {
      [S.ASSIGNED]:         { label: "Confirm Pickup",   cls: "primary" },
      [S.PICKED_UP]:        { label: "Out for Delivery", cls: "accent"  },
      [S.OUT_FOR_DELIVERY]: { label: "Mark Delivered",   cls: "success" },
    };
    const next = NEXT[o.status];

    const vendorLat = vendor && vendor.lat;
    const vendorLng = vendor && vendor.lng;
    const custLat   = o.deliverLat;
    const custLng   = o.deliverLng;

    const mapBtns = [
      mapsLink(vendorLat, vendorLng, "Pickup location"),
      mapsLink(custLat, custLng, "Delivery location"),
      directionsLink(vendorLat, vendorLng, custLat, custLng),
    ].filter(Boolean);

    return el("div", { class: "card rider-card" }, [
      el("div", { class: "order-card-head" }, [
        el("span", { class: "order-id" }, "#" + o.id.slice(-6).toUpperCase()),
        el("span", { class: "badge " + o.status }, BW.STATUS_LABEL[o.status] || o.status),
      ]),
      el("div", { class: "rider-card-body" }, [
        row("From",       vendor ? vendor.name : "—"),
        row("Deliver to", deliverTo),
        row("Items",      itemCount + " item" + (itemCount !== 1 ? "s" : "") + " · " + money(o.total || 0)),
        row("Placed",     timeAgo(o.createdAt)),
      ]),
      mapBtns.length ? el("div", { class: "rider-map-row" }, mapBtns) : null,
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
