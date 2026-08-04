/* =========================================================
 * Saardha — Service Partner console
 * /service/service.js
 *
 * Minimal Phase-1 console for local-services businesses
 * (Pickup & Drop): accept requests, dispatch a Saradhi to
 * collect, mark ready + set final price, dispatch for return,
 * and manage the service catalogue.
 * ========================================================= */
(function () {
  "use strict";
  const { el, money, timeAgo, toast, topbar, modal } = UI;
  const B = BW.BOOKING_STATUS;
  const LABEL = BW.BOOKING_LABEL;
  const root = document.getElementById("root");

  let me = null;
  let vendor = null;
  let tab = "bookings";

  let _seenBookingIds = new Set();
  async function boot() {
    me = await BWAuth.requireLogin("service");
    await BW.init("service");
    vendor = BW.myServiceVendor();
    _seenBookingIds = new Set((BW.bookings ? BW.bookings() : []).filter((b) => b.status === B.REQUESTED).map((b) => b.id));
    if (window.Buzzer && window.Buzzer.requestNotify) window.Buzzer.requestNotify();
    BW.subscribe(() => { vendor = BW.myServiceVendor() || vendor; checkNewBookings(); render(); });
    render();
  }

  // Buzzer + notification when a new booking request lands.
  function checkNewBookings() {
    const fresh = (BW.bookings ? BW.bookings() : []).filter((b) => b.status === B.REQUESTED && !_seenBookingIds.has(b.id));
    if (!fresh.length) return;
    fresh.forEach((b) => _seenBookingIds.add(b.id));
    if (window.Buzzer) window.Buzzer.alert("New service request", "#" + (fresh[0].id.slice(-6).toUpperCase()) + " — tap to open");
    toast("🔔 New service request");
  }

  function setTab(t) { tab = t; render(); }

  function render() {
    root.innerHTML = "";
    root.appendChild(topbar(vendor ? vendor.name : "Service Partner", [
      el("button", { class: "btn ghost sm", onClick: () => BW.logout() }, "Log out"),
    ]));

    if (!vendor) {
      root.appendChild(el("div", { class: "content" }, [
        el("div", { class: "card", style: "margin:20px" }, [
          el("h2", {}, "No business linked"),
          el("p", { class: "muted" }, "Your account isn't linked to a service business yet. Please contact Saardha admin to finish onboarding."),
        ]),
      ]));
      return;
    }

    const tabs = el("div", { style: "display:flex;gap:8px;padding:12px 16px 0" }, [
      el("button", { class: "btn " + (tab === "bookings" ? "primary" : "ghost") + " sm", onClick: () => setTab("bookings") }, "Bookings"),
      el("button", { class: "btn " + (tab === "catalog" ? "primary" : "ghost") + " sm", onClick: () => setTab("catalog") }, "Catalogue"),
      el("button", { class: "btn " + (tab === "settings" ? "primary" : "ghost") + " sm", onClick: () => setTab("settings") }, "Settings"),
    ]);

    const body = el("div", { class: "content", style: "padding:12px 16px 40px" },
      tab === "bookings" ? renderBookings() : tab === "catalog" ? renderCatalog() : renderSettings());
    root.appendChild(el("div", {}, [tabs, body]));
  }

  /* ── Bookings ─────────────────────────────────────────── */
  function renderBookings() {
    const all = BW.bookings ? BW.bookings() : [];
    const isNew    = (b) => b.status === B.REQUESTED;
    const isActive = (b) => [B.ACCEPTED, B.RIDER_ASSIGNED, B.PICKED_FROM_CUSTOMER, B.AT_SHOP, B.READY, B.OUT_FOR_RETURN].includes(b.status);
    const isDone   = (b) => [B.RETURNED, B.CANCELLED].includes(b.status);

    const news = all.filter(isNew), active = all.filter(isActive), done = all.filter(isDone);
    const out = [];

    out.push(section("New requests (" + news.length + ")", news.length ? news.map(bookingCard) :
      [el("div", { class: "muted small", style: "padding:12px" }, "No new requests.")]));
    out.push(section("In progress (" + active.length + ")", active.length ? active.map(bookingCard) :
      [el("div", { class: "muted small", style: "padding:12px" }, "Nothing in progress.")]));
    if (done.length) out.push(section("Completed", done.slice(0, 20).map(bookingCard)));
    return el("div", {}, out);
  }

  function section(title, children) {
    return el("div", { style: "margin-bottom:18px" }, [
      el("h3", { style: "margin:0 0 8px;font-size:15px" }, title),
      el("div", {}, children),
    ]);
  }

  function bookingCard(b) {
    const due = (b.finalTotal != null ? b.finalTotal : b.estTotal) + (b.deliveryFee || 0);
    const itemsTxt = (b.items || []).map((i) => i.qty + "× " + i.name).join(", ");
    const actions = [];

    if (b.status === B.REQUESTED) {
      actions.push(btn("Accept", "primary", async () => { await guard(() => BW.acceptBooking(b.id), "Accepted"); }));
      actions.push(btn("Reject", "danger", async () => { await guard(() => BW.rejectBooking(b.id), "Rejected"); }));
    } else if (b.status === B.ACCEPTED) {
      actions.push(btn("Dispatch Saradhi (collect)", "accent", async () => { await guardDispatch(b); }));
    } else if (b.status === B.AT_SHOP) {
      actions.push(btn("Set price & mark ready", "primary", () => promptReady(b)));
    } else if (b.status === B.READY) {
      actions.push(btn("Dispatch Saradhi (return)", "accent", async () => { await guardDispatch(b); }));
    }
    // RIDER_ASSIGNED / PICKED_FROM_CUSTOMER / OUT_FOR_RETURN → monitoring only

    const riderName = b.riderId ? ((BW.rider && BW.rider(b.riderId)) || {}).name : null;

    return el("div", { class: "card", style: "margin-bottom:10px" }, [
      el("div", { class: "row between", style: "align-items:center" }, [
        el("strong", {}, "#" + b.id.slice(-6).toUpperCase()),
        el("span", { class: "badge" }, LABEL[b.status] || b.status),
      ]),
      el("div", { class: "muted small", style: "margin:6px 0" }, itemsTxt || "Service"),
      el("div", { class: "muted small" }, (b.addressName || "Customer") + " · " + (b.addressPhone || "—") + " · " + (b.slot && b.slot.window ? b.slot.window : "ASAP")),
      el("div", { class: "muted small" }, "📍 " + (b.address || "—")),
      b.note ? el("div", { class: "small", style: "margin-top:4px" }, "Note: " + b.note) : document.createTextNode(""),
      el("div", { class: "row between", style: "margin-top:6px" }, [
        el("span", { class: "small" }, (b.paymentMethod === "ONLINE" ? "Online" : "COD") + " · " + money(due)),
        riderName ? el("span", { class: "muted small" }, "Saradhi: " + riderName) : document.createTextNode(""),
      ]),
      actions.length ? el("div", { style: "display:flex;gap:8px;margin-top:10px;flex-wrap:wrap" }, actions) : document.createTextNode(""),
    ]);
  }

  function btn(label, cls, onClick) { return el("button", { class: "btn " + cls + " sm", onClick }, label); }

  async function guard(fn, okMsg) { try { await fn(); if (okMsg) toast(okMsg); } catch (e) { toast(e.message || "Something went wrong"); } }
  async function guardDispatch(b) {
    try { const r = await BW.autoAssignBookingRider(b.id); toast("Saradhi assigned: " + (r.rider ? r.rider.name : "")); }
    catch (e) { toast(e.message || "No Saradhi available right now"); }
  }

  function promptReady(b) {
    const est = (b.estTotal || 0) + (b.deliveryFee || 0);
    const inp = el("input", { inputmode: "numeric", placeholder: "Final amount incl. pickup fee (₹)", value: est ? String(est) : "", style: "width:100%;margin-bottom:10px" });
    let close;
    const submit = el("button", { class: "btn primary" }, "Mark ready");
    submit.addEventListener("click", async () => {
      const v = Number(inp.value);
      if (!v || v <= 0) { toast("Enter the final amount."); return; }
      try { await BW.readyBooking(b.id, v); if (close) close(); toast("Marked ready — dispatch the return leg."); }
      catch (e) { toast(e.message || "Could not mark ready"); }
    });
    close = modal({
      title: "Confirm price · #" + b.id.slice(-6).toUpperCase(),
      body: el("div", {}, [
        el("p", { class: "muted small", style: "margin:0 0 10px" }, "Set the final amount the customer pays (e.g. after weighing/counting). Includes the two-way pickup fee."),
        inp,
      ]),
      footer: [submit],
    });
  }

  /* ── Catalogue ────────────────────────────────────────── */
  function renderCatalog() {
    const items = BW.serviceItems(vendor.id) || [];
    const rows = items.length ? items.map((s) => el("div", { class: "card", style: "margin-bottom:10px" }, [
      el("div", { class: "row between" }, [
        el("div", {}, [
          el("strong", {}, s.name),
          el("div", { class: "muted small" }, priceText(s) + (s.active === false ? " · hidden" : "")),
          s.description ? el("div", { class: "muted small" }, s.description) : document.createTextNode(""),
        ]),
        el("div", { style: "display:flex;gap:6px" }, [
          btn(s.active === false ? "Show" : "Hide", "ghost", async () => { await guard(() => BW.updateServiceItem(s.id, { active: s.active === false }), "Updated"); }),
          btn("Edit", "ghost", () => promptItem(s)),
          btn("✕", "ghost", async () => { if (confirm("Delete this service?")) await guard(() => BW.deleteServiceItem(s.id), "Deleted"); }),
        ]),
      ]),
    ])) : [el("div", { class: "muted small", style: "padding:12px" }, "No services yet. Add your first one below.")];

    return el("div", {}, [
      el("div", { style: "display:flex;justify-content:flex-end;margin-bottom:10px" }, [
        btn("+ Add service", "primary", () => promptItem(null)),
      ]),
      el("div", {}, rows),
    ]);
  }

  function priceText(s) {
    if (s.priceType === "quote") return "Price on inspection";
    if (s.priceType === "from") return "From " + money(s.price) + (s.unitLabel ? " · " + s.unitLabel : "");
    if (s.priceType === "per_unit") return money(s.price) + " " + (s.unitLabel || "per unit");
    return money(s.price);
  }

  function promptItem(existing) {
    const name = el("input", { placeholder: "Service name (e.g. Wash & Iron)", value: existing ? existing.name : "", style: "width:100%;margin-bottom:8px" });
    const desc = el("input", { placeholder: "Short description (optional)", value: existing ? existing.description || "" : "", style: "width:100%;margin-bottom:8px" });
    const priceType = el("select", { style: "width:100%;margin-bottom:8px" }, [
      ["from", "From price (per kg/item)"], ["fixed", "Fixed price"], ["per_unit", "Per unit"], ["quote", "Price on inspection"],
    ].map(([v, l]) => el("option", { value: v, selected: existing && existing.priceType === v ? "selected" : null }, l)));
    const price = el("input", { inputmode: "numeric", placeholder: "Price ₹ (leave 0 for inspection)", value: existing ? String(existing.price || "") : "", style: "width:100%;margin-bottom:8px" });
    const unit = el("input", { placeholder: "Unit label (e.g. per kg, per page)", value: existing ? existing.unitLabel || "" : "", style: "width:100%;margin-bottom:8px" });
    let close;
    const submit = el("button", { class: "btn primary" }, existing ? "Save" : "Add service");
    submit.addEventListener("click", async () => {
      const data = { name: name.value.trim(), description: desc.value.trim(), priceType: priceType.value, price: Number(price.value) || 0, unitLabel: unit.value.trim(), pattern: "pickup_drop" };
      if (!data.name) { toast("Enter a service name."); return; }
      try {
        if (existing) await BW.updateServiceItem(existing.id, data);
        else await BW.addServiceItem(vendor.id, data);
        if (close) close(); toast("Saved");
      } catch (e) { toast(e.message || "Could not save"); }
    });
    close = modal({ title: existing ? "Edit service" : "Add service", body: el("div", {}, [name, desc, priceType, price, unit]), footer: [submit] });
  }

  /* ── Settings (business location) ─────────────────────── */
  function renderSettings() {
    const nameI = el("input", { value: vendor.name || "", style: "width:100%;margin-bottom:8px" });
    const areaI = el("input", { value: vendor.area || "", placeholder: "Area / locality", style: "width:100%;margin-bottom:8px" });
    const locStatus = el("span", { class: "muted small" }, vendor.lat ? "📍 Location set" : "⚠️ Not set");
    const locBtn = el("button", { class: "btn ghost sm", type: "button" }, "📍 Use my shop's current location");
    let picked = vendor.lat ? { lat: vendor.lat, lng: vendor.lng } : null;
    locBtn.addEventListener("click", () => {
      if (!navigator.geolocation) { toast("Location unavailable"); return; }
      locBtn.disabled = true; locBtn.textContent = "Locating…";
      navigator.geolocation.getCurrentPosition(
        (p) => { picked = { lat: p.coords.latitude, lng: p.coords.longitude }; locStatus.textContent = "📍 Location set"; locBtn.disabled = false; locBtn.textContent = "📍 Use my shop's current location"; },
        () => { toast("Couldn't get location"); locBtn.disabled = false; locBtn.textContent = "📍 Use my shop's current location"; }
      );
    });
    const picker = UI.mapPicker ? UI.mapPicker({ height: 180, lat: picked && picked.lat, lng: picked && picked.lng, onPick: (la, ln) => { picked = { lat: la, lng: ln }; locStatus.textContent = "📍 Location set"; } }) : null;
    let mapsUrl = vendor.mapsUrl || null;
    const linkField = UI.mapsLinkField ? UI.mapsLinkField({ value: vendor.mapsUrl || "", onResolved: (la, ln, url) => { mapsUrl = url; if (la != null) { picked = { lat: la, lng: ln }; locStatus.textContent = "📍 Location set"; } } }) : document.createTextNode("");

    const save = el("button", { class: "btn primary", style: "width:100%;margin-top:8px" }, "Save business details");
    save.addEventListener("click", async () => {
      const data = { name: nameI.value.trim(), area: areaI.value.trim() };
      if (picked) { data.lat = picked.lat; data.lng = picked.lng; }
      if (mapsUrl) data.mapsUrl = mapsUrl;
      try { await BW.updateServiceVendor(vendor.id, data); toast("Saved"); }
      catch (e) { toast(e.message || "Could not save"); }
    });

    return el("div", { class: "card" }, [
      el("div", { style: "font-weight:800;margin-bottom:8px" }, "Business details"),
      el("label", { class: "small muted" }, "Business name"), nameI,
      el("label", { class: "small muted" }, "Area"), areaI,
      el("div", { style: "display:flex;gap:8px;align-items:center;margin:6px 0" }, [locBtn, locStatus]),
      picker ? el("div", { style: "margin-bottom:8px" }, [el("div", { class: "muted small", style: "margin-bottom:4px" }, "Drag the pin to your shop — the Saradhi navigates here."), picker]) : document.createTextNode(""),
      el("div", { style: "margin-bottom:8px" }, [el("div", { class: "muted small", style: "margin-bottom:4px" }, "…or paste your shop's Google Maps link"), linkField]),
      save,
    ]);
  }

  boot().catch((err) => {
    console.error("Boot failed:", err);
    root.innerHTML = '<div class="bw-loading" style="color:var(--red)">Failed to connect. Is the backend running?</div>';
  });
})();
