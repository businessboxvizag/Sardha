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
  let _seenBookingIds = new Set();

  /* ── Boot ─────────────────────────────────────────────── */
  async function boot() {
    me = await BWAuth.requireLogin("rider");
    await BW.init("rider");

    syncRider();
    // Always-on duty: make the Saradhi available for assignment while the app is open.
    if (myRider && myRider.status === "offline") {
      try { await BW.setMyRiderStatus(me.uid, "available"); syncRider(); } catch (e) {}
    }
    startGPS();   // always share location while the app is open

    // Seed so we only alarm on deliveries assigned AFTER the app opened
    _seenOrderIds = new Set(
      BW.orders().filter((o) => o.riderId === me.uid && o.status === S.ASSIGNED).map((o) => o.id)
    );
    _seenBookingIds = new Set(
      (BW.bookings ? BW.bookings() : []).filter((b) => b.riderId === me.uid && b.status === (BW.BOOKING_STATUS || {}).RIDER_ASSIGNED).map((b) => b.id)
    );
    if (window.Buzzer && window.Buzzer.requestNotify) window.Buzzer.requestNotify();
    BW.subscribe(() => { syncRider(); checkNewOrders(); render(); });
    render();
  }

  /* ── New-assignment alarm (buzzer + system notification) ─ */
  function checkNewOrders() {
    const assigned = BW.orders().filter((o) => o.riderId === me.uid && o.status === S.ASSIGNED);
    const fresh = assigned.filter((o) => !_seenOrderIds.has(o.id));
    if (fresh.length) {
      fresh.forEach((o) => _seenOrderIds.add(o.id));
      const o = fresh[0];
      const label = "#" + (o.orderNo || o.id.slice(-6).toUpperCase());
      if (window.Buzzer) window.Buzzer.alert("New delivery assigned", "Order " + label + " — tap to open Saardha");
      toast("🔔 New delivery assigned to you");
    }
    // Also alert on new service pickups (Pickup & Drop collect leg)
    const freshB = (BW.bookings ? BW.bookings() : []).filter((b) => b.riderId === me.uid && b.status === BS.RIDER_ASSIGNED && !_seenBookingIds.has(b.id));
    if (freshB.length) {
      freshB.forEach((b) => _seenBookingIds.add(b.id));
      if (window.Buzzer) window.Buzzer.alert("New service pickup", "#" + (b.orderNo || b.id.slice(-6).toUpperCase()) + " — tap to open Saardha");
      toast("🔔 New service pickup assigned");
    }
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
        // Include the active delivery's id so the customer watching it gets live updates.
        const active = myOrders()[0];
        BW.updateMyLocation(me.uid, pos.coords.latitude, pos.coords.longitude, active && active.id)
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
    const bookings = myBookings();
    if (bookings.length) root.appendChild(renderBookingList(bookings));
  }

  /* ── Services bookings (Pickup & Drop, two legs) ──────── */
  const BS = (BW.BOOKING_STATUS || {});
  function myBookings() {
    const active = [BS.RIDER_ASSIGNED, BS.PICKED_FROM_CUSTOMER, BS.OUT_FOR_RETURN];
    return (BW.bookings ? BW.bookings() : []).filter((b) => b.riderId === me.uid && active.includes(b.status));
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
      title: "Complete delivery · #" + (order.orderNo || order.id.slice(-6).toUpperCase()),
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
  // Always-on-duty model: salaried Saradhis don't toggle — they're on duty
  // whenever the app is open and receive assigned tasks directly.
  function renderStatusCard() {
    const deliveriesText = myRider && myRider.deliveriesToday
      ? myRider.deliveriesToday + " delivered today"
      : "Ready for tasks";
    const gpsLine = gpsActive ? "📍 Location sharing active" :
      gpsError ? "Warning: " + gpsError : "Acquiring GPS signal…";
    return el("div", { class: "rider-status-card" }, [
      el("div", { class: "rider-status-top" }, [
        el("span", { class: "badge available" }, "On duty"),
        el("span", { class: "rider-deliveries-count" }, deliveriesText),
      ]),
      el("p", { class: "rider-gps-line" }, gpsLine),
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
      el("h3", { class: "page-title" }, "Your tasks (" + orders.length + ")")
    );
    orders.forEach((o, i) => wrap.appendChild(renderCard(o, i + 1)));
    return wrap;
  }

  /* ── Map link helpers (fall back to a text address when GPS coords are missing) ── */
  function mapsLink(lat, lng, label, addressFallback) {
    let query = null;
    if (lat && lng) query = lat + "," + lng;
    else if (addressFallback) query = encodeURIComponent(addressFallback);
    if (!query) return null;
    const url = "https://www.google.com/maps/search/?api=1&query=" + query;
    return el("a", { class: "rider-map-btn", href: url, target: "_blank", rel: "noopener" }, label);
  }

  // Turn-by-turn navigation from the rider's CURRENT location (origin omitted →
  // Google Maps uses live GPS) straight to the destination, starting navigation.
  function navigateBtn(lat, lng, addr, label) {
    let dest = null;
    if (lat && lng) dest = lat + "," + lng;
    else if (addr) dest = encodeURIComponent(addr);
    if (!dest) return null;
    const url = "https://www.google.com/maps/dir/?api=1&destination=" + dest + "&travelmode=driving&dir_action=navigate";
    return el("a", { class: "btn accent", href: url, target: "_blank", rel: "noopener", style: "width:100%;display:block;text-align:center;margin-bottom:8px" }, label);
  }

  // Big "navigate" button that opens a raw pasted Google Maps link directly.
  function linkBtn(url, label) {
    if (!url) return null;
    return el("a", { class: "btn accent", href: url, target: "_blank", rel: "noopener", style: "width:100%;display:block;text-align:center;margin-bottom:8px" }, label);
  }

  function directionsLink(fromLat, fromLng, toLat, toLng, toAddress) {
    let dest = null;
    if (toLat && toLng) dest = toLat + "," + toLng;
    else if (toAddress) dest = encodeURIComponent(toAddress);
    if (!dest) return null;
    const origin = (fromLat && fromLng) ? (fromLat + "," + fromLng) : "";
    const url = "https://www.google.com/maps/dir/?api=1" + (origin ? "&origin=" + origin : "") + "&destination=" + dest + "&travelmode=driving";
    return el("a", { class: "rider-map-btn rider-map-btn--nav", href: url, target: "_blank", rel: "noopener" }, "Navigate");
  }

  /* ── Order card ─────────────────────────────────────── */
  function renderCard(o, taskNo) {
    const isPartner = o.source === "partner";
    const vendor = BW.vendor(o.vendorId);
    const fromName = isPartner ? ((o.pickup && o.pickup.name) || o.partnerName || "Pickup") : (vendor ? vendor.name : "—");
    const itemCount = (o.items || []).reduce((s, i) => s + (i.qty || 1), 0);
    const itemsLabel = isPartner ? (o.itemsText || "Package") : (itemCount + " item" + (itemCount !== 1 ? "s" : "") + " · " + money(o.total || 0));
    const deliverTo = o.deliverTo || o.deliveryAddress || (o.dropName || "Address not set");

    const NEXT = {
      [S.ASSIGNED]:         { label: "Confirm Pickup",   cls: "primary" },
      [S.PICKED_UP]:        { label: "Out for Delivery", cls: "accent"  },
      [S.OUT_FOR_DELIVERY]: { label: "Mark Delivered",   cls: "success" },
    };
    const next = NEXT[o.status];

    const vendorLat = isPartner ? (o.pickup && o.pickup.lat) : (vendor && vendor.lat);
    const vendorLng = isPartner ? (o.pickup && o.pickup.lng) : (vendor && vendor.lng);
    const custLat   = o.deliverLat;
    const custLng   = o.deliverLng;

    const pickupAddr = isPartner ? (o.pickup && o.pickup.address) : (vendor && vendor.name);
    // Context-aware navigation: head to the store until picked up, then to the customer.
    // The customer's delivery location stays hidden until the parcel is actually picked up.
    const pickedUp = [S.PICKED_UP, S.OUT_FOR_DELIVERY].includes(o.status);
    const pickupMapsUrl = isPartner ? (o.pickup && o.pickup.mapsUrl) : (vendor && vendor.mapsUrl);
    // Prefer exact coordinates; otherwise open the customer's / shop's pasted Google Maps link.
    const nav = pickedUp
      ? ((custLat && custLng) ? navigateBtn(custLat, custLng, deliverTo, "🧭 Navigate to customer")
          : (o.deliverMapsUrl ? linkBtn(o.deliverMapsUrl, "🧭 Open customer's Maps location") : navigateBtn(null, null, deliverTo, "🧭 Navigate to customer")))
      : ((vendorLat && vendorLng) ? navigateBtn(vendorLat, vendorLng, pickupAddr, "🧭 Navigate to pickup")
          : (pickupMapsUrl ? linkBtn(pickupMapsUrl, "🧭 Open pickup Maps location") : navigateBtn(null, null, pickupAddr, "🧭 Navigate to pickup")));
    // Before pickup show only the pickup map; after pickup, only the customer's.
    const mapBtns = (pickedUp
      ? [mapsLink(custLat, custLng, "Delivery", deliverTo)]
      : [mapsLink(vendorLat, vendorLng, "Pickup", pickupAddr)]
    ).filter(Boolean);

    const orderLabel = "#" + (o.orderNo || o.id.slice(-6).toUpperCase());

    return el("div", { class: "card rider-card" }, [
      el("div", { class: "order-card-head" }, [
        el("span", { class: "order-id" }, (taskNo ? "Task " + taskNo + " · " : "") + orderLabel),
        el("span", { class: "badge " + o.status }, BW.STATUS_LABEL[o.status] || o.status),
      ]),
      el("div", { class: "rider-card-body" }, [
        row("From",       fromName),
        row("Deliver to", pickedUp ? deliverTo : "🔒 Revealed after pickup"),
        row("Items",      itemsLabel),
        isPartner ? row("Via",  o.partnerName || "Partner") : null,
        row("Placed",     timeAgo(o.createdAt)),
      ].filter(Boolean)),
      nav,
      mapBtns.length ? el("div", { class: "rider-map-row" }, mapBtns) : null,
      pickedUp ? contactRow(o) : null,
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

  // WhatsApp deep link (adds India country code for 10-digit numbers).
  function waLink(phone) {
    if (!phone) return null;
    var d = String(phone).replace(/\D/g, "");
    if (!d) return null;
    if (d.length === 10) d = "91" + d;
    return "https://wa.me/" + d;
  }

  // Call / WhatsApp the customer (uses the order's receiver phone).
  function contactRow(o) {
    const phone = o.dropPhone || o.customerPhone;
    if (!phone) return null;
    const btns = [
      el("a", { class: "rider-map-btn", href: "tel:" + phone }, "📞 Call customer"),
    ];
    const wa = waLink(phone);
    if (wa) btns.push(el("a", { class: "rider-map-btn", href: wa, target: "_blank", rel: "noopener" }, "💬 Chat"));
    return el("div", { class: "rider-map-row" }, btns);
  }

  /* ── Services booking list (two-leg Pickup & Drop) ────── */
  function renderBookingList(bookings) {
    const wrap = el("div", { class: "rider-orders", style: "margin-top:16px" });
    wrap.appendChild(el("h3", { class: "page-title" }, "Service pickups (" + bookings.length + ")"));
    bookings.forEach((b, i) => wrap.appendChild(renderBookingCard(b, i + 1)));
    return wrap;
  }

  function renderBookingCard(b, taskNo) {
    const collecting = b.status === BS.RIDER_ASSIGNED;        // go to customer, collect
    const toShop     = b.status === BS.PICKED_FROM_CUSTOMER;  // go to shop, drop
    const returning  = b.status === BS.OUT_FOR_RETURN;        // go to customer, return

    const custLabel = b.address || b.addressName || "Customer";
    let dest, destAddr, navLabel, actionLabel, actionCls;
    if (collecting) { dest = { lat: b.lat, lng: b.lng }; destAddr = custLabel; navLabel = "🧭 Navigate to customer (collect)"; actionLabel = "Confirm pickup from customer"; actionCls = "primary"; }
    else if (toShop) { dest = { lat: b.shopLat, lng: b.shopLng }; destAddr = b.serviceVendorName + (b.shopArea ? ", " + b.shopArea : ""); navLabel = "🧭 Navigate to shop (drop)"; actionLabel = "Dropped at " + b.serviceVendorName; actionCls = "accent"; }
    else { dest = { lat: b.lat, lng: b.lng }; destAddr = custLabel; navLabel = "🧭 Navigate to customer (return)"; actionLabel = "Complete return (OTP)"; actionCls = "success"; }

    const legText = collecting ? "Leg 1 · Collect from customer" : toShop ? "Leg 1 · Drop at shop" : "Leg 2 · Return to customer";
    const destMapsUrl = toShop ? b.shopMapsUrl : b.mapsUrl;
    const nav = (dest.lat && dest.lng) ? navigateBtn(dest.lat, dest.lng, destAddr, navLabel)
              : (destMapsUrl ? linkBtn(destMapsUrl, navLabel) : navigateBtn(null, null, destAddr, navLabel));
    const map = (dest.lat && dest.lng) ? mapsLink(dest.lat, dest.lng, "Open map", destAddr) : null;
    const phone = b.addressPhone;
    const contact = phone ? el("div", { class: "rider-map-row" }, [
      el("a", { class: "rider-map-btn", href: "tel:" + phone }, "📞 Call"),
      waLink(phone) ? el("a", { class: "rider-map-btn", href: waLink(phone), target: "_blank", rel: "noopener" }, "💬 Chat") : null,
    ].filter(Boolean)) : null;

    const itemsTxt = (b.items || []).reduce((s, i) => s + (i.qty || 1), 0) + " item(s) · " + (b.serviceVendorName || "Service");

    const act = el("button", { class: "btn " + actionCls + " rider-advance-btn" }, actionLabel);
    act.addEventListener("click", async () => {
      if (returning) { promptBookingComplete(b); return; }
      try { await BW.advanceBooking(b.id); toast("Updated ✓"); await syncRider(); render(); }
      catch (e) { toast(e.message || "Could not update"); }
    });

    return el("div", { class: "card rider-card" }, [
      el("div", { class: "order-card-head" }, [
        el("span", { class: "order-id" }, (taskNo ? "Pickup " + taskNo + " · " : "") + "#" + b.id.slice(-6).toUpperCase()),
        el("span", { class: "badge" }, (BW.BOOKING_LABEL && BW.BOOKING_LABEL[b.status]) || b.status),
      ]),
      el("div", { class: "rider-card-body" }, [
        row("Task", legText),
        row("Customer", custLabel),
        row("Shop", b.serviceVendorName || "—"),
        row("Items", itemsTxt),
        row("Pay", (b.paymentMethod === "ONLINE" ? "Prepaid online" : "Collect cash on return · " + money((b.finalTotal != null ? b.finalTotal : b.estTotal) + (b.deliveryFee || 0)))),
      ]),
      nav,
      map ? el("div", { class: "rider-map-row" }, [map]) : null,
      contact,
      act,
    ].filter(Boolean));
  }

  // Return leg completion — OTP (+ COD cash) just like an order delivery.
  function promptBookingComplete(b) {
    const isCod = b.paymentMethod !== "ONLINE";
    const due = (b.finalTotal != null ? b.finalTotal : b.estTotal) + (b.deliveryFee || 0);
    const otpIn = el("input", { inputmode: "numeric", maxlength: "4", placeholder: "4-digit return OTP", style: "width:100%;margin-bottom:10px" });
    const cashIn = isCod ? el("input", { inputmode: "numeric", placeholder: "Cash collected (₹)", value: String(due || ""), style: "width:100%;margin-bottom:10px" }) : null;
    const err = el("div", { class: "auth-err", style: "text-align:left" });
    let close;
    const submit = el("button", { class: "btn success" }, "Mark returned");
    submit.addEventListener("click", async () => {
      const otp = otpIn.value.trim();
      if (otp.length !== 4) { err.textContent = "Enter the 4-digit OTP the customer shows you."; return; }
      const body = { otp: otp };
      if (isCod) { const c = Number(cashIn.value); if (!c || c <= 0) { err.textContent = "Enter the cash collected."; return; } body.cashCollected = c; }
      submit.disabled = true; submit.textContent = "Confirming…";
      try { await BW.advanceBooking(b.id, body); if (close) close(); toast("Returned ✓"); await syncRider(); render(); }
      catch (e) { err.textContent = e.message || "Could not complete."; submit.disabled = false; submit.textContent = "Mark returned"; }
    });
    close = modal({
      title: "Complete return · #" + b.id.slice(-6).toUpperCase(),
      body: el("div", {}, [
        el("p", { class: "muted small", style: "margin:0 0 10px" }, "Ask the customer for their 4-digit return OTP" + (isCod ? " and collect the cash." : ".")),
        otpIn, cashIn, err,
      ].filter(Boolean)),
      footer: [submit],
    });
  }

  /* ── Go ─────────────────────────────────────────────── */
  boot().catch((err) => {
    console.error("[rider]", err);
    toast(err.message || "Failed to start rider app");
  });
})();
