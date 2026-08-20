/* =====================================================================
 * Saardha â API Client
 * ---------------------------------------------------------------------
 * Drop-in replacement for store.js.  Exposes window.BW with the same
 * synchronous read interface (vendors(), orders(), â¦) backed by a
 * local cache that is populated from the real Node/Firebase backend.
 *
 * Mutations (placeOrder, setOrderStatus, assignRider, â¦) are async
 * â they POST/PATCH the server and refresh the cache.  Socket.io
 * pushes live updates so every tab/device stays in sync.
 *
 * Auth: JWT stored in sessionStorage under "bw_token".
 * ===================================================================== */
(function (global) {
  "use strict";

  /* ââ Configuration ââââââââââââââââââââââââââââââââââââââââââ */
  // Update this if your backend runs on a different origin
  const API_BASE = window.BW_API_BASE || "http://localhost:3000";

  /* ââ Order status constants (same as server) ââââââââââââââââ */
  const STATUS = {
    PLACED: "PLACED", ACCEPTED: "ACCEPTED", ASSIGNED: "ASSIGNED",
    PICKED_UP: "PICKED_UP", OUT_FOR_DELIVERY: "OUT_FOR_DELIVERY",
    DELIVERED: "DELIVERED", CANCELLED: "CANCELLED",
  };
  const STATUS_FLOW = [
    STATUS.PLACED, STATUS.ACCEPTED, STATUS.ASSIGNED,
    STATUS.PICKED_UP, STATUS.OUT_FOR_DELIVERY, STATUS.DELIVERED,
  ];
  const STATUS_LABEL = {
    PLACED: "Placed", ACCEPTED: "Accepted", ASSIGNED: "Saradhi assigned",
    PICKED_UP: "Picked up", OUT_FOR_DELIVERY: "Out for delivery",
    DELIVERED: "Delivered", CANCELLED: "Cancelled",
  };

  /* ââ Services booking status (Pickup & Drop) ââââââââââââââââ */
  const BOOKING_STATUS = {
    REQUESTED: "REQUESTED", ACCEPTED: "ACCEPTED", RIDER_ASSIGNED: "RIDER_ASSIGNED",
    PICKED_FROM_CUSTOMER: "PICKED_FROM_CUSTOMER", AT_SHOP: "AT_SHOP", READY: "READY",
    OUT_FOR_RETURN: "OUT_FOR_RETURN", RETURNED: "RETURNED", CANCELLED: "CANCELLED",
  };
  const BOOKING_LABEL = {
    REQUESTED: "Requested", ACCEPTED: "Accepted", RIDER_ASSIGNED: "Saradhi collecting",
    PICKED_FROM_CUSTOMER: "Picked up from you", AT_SHOP: "At the shop", READY: "Ready",
    OUT_FOR_RETURN: "On the way back", RETURNED: "Returned", CANCELLED: "Cancelled",
  };

  /* ââ Auth helpers âââââââââââââââââââââââââââââââââââââââââââ */
  // Each app (customer / merchant / rider / admin) lives on the same domain and
  // shares localStorage, so scope the session by app path — otherwise logging into
  // one app clobbers another's token in the same browser.
  const SCOPE = (function () {
    var p = (location.pathname || "").toLowerCase();
    var roles = ["merchant", "rider", "admin", "service", "customer"];
    for (var i = 0; i < roles.length; i++) { if (p.indexOf("/" + roles[i]) !== -1) return roles[i]; }
    return "customer";
  })();
  const TOKEN_KEY = "bw_token_" + SCOPE;
  const USER_KEY  = "bw_user_" + SCOPE;

  const Auth = {
    getToken: () => localStorage.getItem(TOKEN_KEY),
    getUser:  () => { try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch { return null; } },
    setSession: (token, user) => {
      localStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(USER_KEY, JSON.stringify(user));
    },
    clearSession: () => {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    },
    isLoggedIn: () => !!localStorage.getItem(TOKEN_KEY),
  };

  /* ââ HTTP helpers âââââââââââââââââââââââââââââââââââââââââââ */
  async function api(method, path, body) {
    const token = Auth.getToken();
    const res = await fetch(API_BASE + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: "Bearer " + token } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    // Auth failures on a signed-in request → clear the (missing/expired/superseded)
    // session and send them back to login, instead of a confusing error toast.
    if (res.status === 401 && !path.startsWith("/api/auth/")) {
      const authErr = ["session_superseded", "No token provided", "Invalid or expired token"].includes(data.error);
      if (authErr) {
        Auth.clearSession();
        if (data.error === "session_superseded") alert("You've been signed out because your account was opened on another device.");
        window.location.reload();
        throw new Error(data.error);
      }
    }
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  const get  = (path)        => api("GET",    path);
  const post = (path, body)  => api("POST",   path, body);
  const put  = (path, body)  => api("PUT",    path, body);
  const patch = (path, body) => api("PATCH",  path, body);
  const del  = (path)        => api("DELETE", path);

  /* ââ Local cache ââââââââââââââââââââââââââââââââââââââââââââ */
  let _config = {};
  let _cache = {
    vendors: [], products: {}, orders: [], riders: [],
    customers: [], myCustomer: null, favorites: [], analytics: null,
    logins: [], allUsers: [], shops: [], events: [], support: [], partners: [], rxOrders: [],
    serviceVendors: [], services: {}, bookings: [], myServiceVendor: null,
  };

  /* ââ Pub/sub ââââââââââââââââââââââââââââââââââââââââââââââââ */
  const _listeners = new Set();
  function emit() { _listeners.forEach((fn) => { try { fn(_cache); } catch (e) { console.error(e); } }); }
  function subscribe(fn) { _listeners.add(fn); return () => _listeners.delete(fn); }

  // Merge a booking into the cache, notify subscribers, and return it (used by mutations).
  function _upsertBooking(b) {
    const i = _cache.bookings.findIndex((x) => x.id === b.id);
    if (i >= 0) _cache.bookings[i] = b; else _cache.bookings.unshift(b);
    emit();
    return b;
  }

  /* ââ Socket.io ââââââââââââââââââââââââââââââââââââââââââââââ */
  let _socket = null;

  function connectSocket() {
    const token = Auth.getToken();
    if (!token || typeof io === "undefined") return;

    _socket = io(API_BASE, { auth: { token } });

    _socket.on("connect", () => console.log("[WS] connected"));
    _socket.on("connect_error", (e) => console.warn("[WS] error", e.message));

    // Order updated (status change, rider assigned, etc.)
    _socket.on("order:updated", (order) => {
      const idx = _cache.orders.findIndex((o) => o.id === order.id);
      if (idx >= 0) _cache.orders[idx] = order;
      else _cache.orders.unshift(order);
      emit();
    });

    // Rider location update
    _socket.on("rider:location", ({ riderId, lat, lng }) => {
      const r = _cache.riders.find((r) => r.id === riderId);
      if (r) { r.lat = lat; r.lng = lng; }
      emit();
    });

    // Rider status change (admin changed it)
    _socket.on("rider:updated", (rider) => {
      const idx = _cache.riders.findIndex((r) => r.id === rider.id);
      if (idx >= 0) _cache.riders[idx] = rider;
      emit();
    });

    // Services booking updated / newly assigned
    const upsertBooking = (b) => {
      const idx = _cache.bookings.findIndex((x) => x.id === b.id);
      if (idx >= 0) _cache.bookings[idx] = b; else _cache.bookings.unshift(b);
      emit();
    };
    _socket.on("booking:updated", upsertBooking);
    _socket.on("booking:assigned", upsertBooking);

    // An order was just assigned to this rider — treat like an update so the app buzzes.
    _socket.on("order:assigned", (order) => {
      const idx = _cache.orders.findIndex((o) => o.id === order.id);
      if (idx >= 0) _cache.orders[idx] = order; else _cache.orders.unshift(order);
      emit();
    });

    // Support ticket created / new message — notify ticket listeners (live chat + alerts).
    _socket.on("support:updated", (ticket) => {
      _ticketListeners.forEach((fn) => { try { fn(ticket); } catch (e) { console.error(e); } });
    });
  }

  // Pub/sub for live support-ticket events (separate from the cache emit()).
  const _ticketListeners = new Set();

  /* ââ Init: load all data, connect socket ââââââââââââââââââââ */
  async function init(role) {
    // Determine what to load based on role
    const loads = [
      get("/api/vendors").then((v) => { _cache.vendors = v; }),
      get("/api/settings").then((s) => { _cache.settings = s; }).catch(() => {}),
      get("/api/config").then((c) => { _config = c || {}; }).catch(() => {}),
      get("/api/riders").then((r) => { _cache.riders = r; }),
    ];

    if (role === "customer") {
      loads.push(
        get("/api/orders").then((o) => { _cache.orders = o; }),
        get("/api/services/vendors").then((v) => { _cache.serviceVendors = v || []; }).catch(() => {}),
        get("/api/bookings").then((b) => { _cache.bookings = b || []; }).catch(() => {}),
        get("/api/customers/me").then((c) => { _cache.myCustomer = c; }),
        get("/api/customers/me/favorites").then((f) => { _cache.favorites = f; }),
        get("/api/customers/me/shops").then((s) => { _cache.shops = s || []; }).catch(() => {}),
      );
      // Load all products for all vendors
      for (const v of _cache.vendors) {
        loads.push(
          get(`/api/vendors/${v.id}/products`).then((p) => {
            _cache.products[v.id] = p;
          })
        );
      }
    } else if (role === "merchant") {
      loads.push(
        get("/api/orders").then((o) => { _cache.orders = o; }),
        get("/api/customers").then((c) => { _cache.customers = c; }),
      );
    } else if (role === "admin") {
      loads.push(
        get("/api/orders").then((o) => { _cache.orders = o; }),
        get("/api/customers").then((c) => { _cache.customers = c; }),
        get("/api/analytics").then((a) => { _cache.analytics = a; }),
        get("/api/admin/logins").then((l) => { _cache.logins = l; }),
        get("/api/admin/users").then((u) => { _cache.allUsers = u; }),
        get("/api/events").then((e) => { _cache.events = e; }).catch(() => {}),
        get("/api/admin/support").then((s) => { _cache.support = s; }).catch(() => {}),
        get("/api/admin/partners").then((p) => { _cache.partners = p; }).catch(() => {}),
        get("/api/admin/rx-orders").then((r) => { _cache.rxOrders = r; }).catch(() => {}),
        get("/api/services/vendors").then((v) => { _cache.serviceVendors = v || []; }).catch(() => {}),
        get("/api/bookings").then((b) => { _cache.bookings = b || []; }).catch(() => {}),
      );
    } else if (role === "rider") {
      loads.push(
        get("/api/orders").then((o) => { _cache.orders = o; }),
        get("/api/bookings").then((b) => { _cache.bookings = b || []; }).catch(() => {}),
        get("/api/riders").then((r) => { _cache.riders = r; }).catch(() => {}),
        get("/api/settings").then((s) => { _cache.settings = s; }).catch(() => {}),
      );
    } else if (role === "service") {
      loads.push(
        get("/api/services/mine").then((r) => { _cache.myServiceVendor = r.vendor; _cache.services[r.vendor ? r.vendor.id : "_mine"] = r.items || []; }).catch(() => {}),
        get("/api/bookings").then((b) => { _cache.bookings = b || []; }).catch(() => {}),
      );
    }

    await Promise.all(loads);
    connectSocket();
    return _cache;
  }

  /* ââ Load vendor products lazily (merchant inventory) âââââââ */
  async function loadVendorProducts(vendorId) {
    const prods = await get(`/api/vendors/${vendorId}/products`);
    _cache.products[vendorId] = prods;
    return prods;
  }

  /* ââ Refresh helpers ââââââââââââââââââââââââââââââââââââââââ */
  async function refreshOrders(vendorId) {
    const path = vendorId ? `/api/orders?vendorId=${vendorId}` : "/api/orders";
    _cache.orders = await get(path);
    emit();
  }
  async function refreshAnalytics() {
    _cache.analytics = await get("/api/analytics");
    emit();
  }

  /* âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ */
  /* PUBLIC API  (window.BW)                                     */
  /* âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ */
  const API = {
    /* Constants */
    STATUS, STATUS_FLOW, STATUS_LABEL,
    BOOKING_STATUS, BOOKING_LABEL,

    /* Auth */
    Auth,
    login:  (email, password, role) => post("/api/auth/login", { email, password, role }),
    register: (data)           => post("/api/auth/register", data),
    checkEmail: (email, role)  => post("/api/auth/check-email", { email, role }),
    sendEmailOtp:   (email)        => post("/api/auth/email-otp/send", { email }),
    verifyEmailOtp: (email, code)  => post("/api/auth/email-otp/verify", { email, code }),

    // Fire-and-forget behavioral event (never blocks or breaks the UI)
    track: (type, props) => { try { post("/api/events", { type, props: props || {} }).catch(() => {}); } catch (e) {} },
    events:  () => [...(_cache.events || [])],
    support: () => [...(_cache.support || [])],

    // Delivery partners (admin)
    partners: () => [...(_cache.partners || [])],
    rxOrders: () => [...(_cache.rxOrders || [])],
    createPartner: async (data) => { const r = await post("/api/admin/partners", data); if (r && r.partner) _cache.partners.push(r.partner); emit(); return r; },
    updatePartner: async (id, data) => { const p = await patch(`/api/admin/partners/${id}`, data); const i = _cache.partners.findIndex((x) => x.id === id); if (i >= 0) _cache.partners[i] = p; emit(); return p; },
    loginWithGoogle: (idToken, role) => post("/api/auth/google", { idToken, role }),
    forgotPassword: (email, role)    => post("/api/auth/forgot-password", { email, role }),
    resetPassword:  (token, newPassword) => post("/api/auth/reset-password", { token, newPassword }),
    logout: () => {
      Auth.clearSession();
      if (_socket) { _socket.disconnect(); _socket = null; }
      window.location.reload();
    },

    /* Socket room subscriptions */
    joinVendorRoom:   (id) => _socket && _socket.emit("join:vendor", id),
    joinCustomerRoom: (id) => _socket && _socket.emit("join:customer", id),
    joinOrderRoom:    (id) => _socket && _socket.emit("join:order", id),

    /* Pub/sub */
    subscribe,

    /* Init */
    init,

    /* Public (no-auth) vendor list — used by the in-app store picker as a fallback
       when the authed cache is empty (e.g. universal-QR scan before data loads). */
    apiBase:       () => API_BASE,
    publicVendors: async () => {
      try { const res = await fetch(API_BASE + "/api/public/vendors"); if (res.ok) return await res.json(); } catch (e) {}
      return [];
    },

    /* ââ Synchronous reads from cache ââ */
    vendors:       () => [..._cache.vendors],
    deliveryFee:   () => (_cache.settings && _cache.settings.deliveryFee != null) ? Number(_cache.settings.deliveryFee) : 15,
    vendor:        (id) => _cache.vendors.find((v) => v.id === id) || null,
    products:      (vendorId) => vendorId ? (_cache.products[vendorId] || []) : Object.values(_cache.products).flat(),
    riders:        () => [..._cache.riders],
    rider:         (id) => _cache.riders.find((r) => r.id === id) || null,
    customers:     () => [..._cache.customers],
    customer:      (id) => _cache.customers.find((c) => c.id === id) || _cache.myCustomer || null,
    currentCustomer: () => _cache.myCustomer,
    orders:        (filter = {}) => {
      return _cache.orders
        .filter((o) => !filter.vendorId   || o.vendorId   === filter.vendorId)
        .filter((o) => !filter.customerId || o.customerId === filter.customerId)
        .filter((o) => !filter.status     || o.status     === filter.status)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    },
    order:         (id) => _cache.orders.find((o) => o.id === id) || null,
    favorites:     ()   => [..._cache.favorites],
    shops:         ()   => [...(_cache.shops || [])],
    addShop:       async (vendorId) => {
      const list = await post("/api/customers/me/shops", { vendorId });
      _cache.shops = list;
      emit();
      return list;
    },
    analytics:     ()   => _cache.analytics,
    logins:        ()   => [..._cache.logins],
    allUsers:      ()   => [..._cache.allUsers],

    /* ââ Async mutations ââ */
    // Price a cart + validate a promo without placing an order. Returns the
    // authoritative server breakdown: { subtotal, discount, promoError, gst, deliveryFee, total }.
    quoteOrder: ({ vendorId, items, promoCode }) =>
      post("/api/orders/quote", { vendorId, items, promoCode: promoCode || undefined }),

    placeOrder: async ({ vendorId, items, paymentMethod, promoCode,
                         razorpay_payment_id, razorpay_order_id, razorpay_signature,
                         deliverLat, deliverLng, deliverTo, deliverPhone, deliverName, deliverMapsUrl,
                         prescriptionUrl, selfieUrl, rxConsent }) => {
      const order = await post("/api/orders", {
        vendorId, items, paymentMethod, promoCode: promoCode || undefined,
        razorpay_payment_id, razorpay_order_id, razorpay_signature,
        deliverLat, deliverLng, deliverTo, deliverPhone, deliverName, deliverMapsUrl,
        prescriptionUrl, selfieUrl, rxConsent,
      });
      _cache.orders.unshift(order);
      emit();
      return order;
    },

    // Create a Razorpay order for the server-computed amount (online checkout).
    // promoCode is passed so the charged amount already reflects the discount.
    createPaymentOrder: ({ vendorId, items, promoCode }) =>
      post("/api/payments/create-order", { vendorId, items, promoCode: promoCode || undefined }),

    config: () => _config,

    askAssistant: (message, history) => post("/api/assistant", { message, history }),

    /* ── Support tickets (customer ⇄ support) ── */
    createTicket:    ({ subject, message, orderId }) => post("/api/support", { subject, message, orderId: orderId || undefined }),
    myTickets:       () => get("/api/support/mine"),
    getTicket:       (id) => get("/api/support/" + id),
    replyTicket:     (id, text) => post("/api/support/" + id + "/messages", { text }),
    adminTickets:    () => get("/api/support"),
    setTicketStatus: (id, status) => patch("/api/support/" + id, { status }),

    // Support contact details (admin-configured) from cached settings.
    supportContact: () => {
      const s = _cache.settings || {};
      return { phone: s.supportPhone || "", whatsapp: s.supportWhatsapp || "", email: s.supportEmail || "", hours: s.supportHours || "" };
    },

    /* ── Cancel an order (optionally with a reason) ── */
    cancelOrder: async (orderId, reason) => {
      const order = await patch("/api/orders/" + orderId + "/status", { status: "CANCELLED", reason: reason || undefined });
      const i = _cache.orders.findIndex((o) => o.id === orderId);
      if (i >= 0) _cache.orders[i] = order;
      emit();
      return order;
    },

    // Subscribe to live support-ticket events (returns an unsubscribe fn).
    subscribeTickets: (fn) => { _ticketListeners.add(fn); return () => _ticketListeners.delete(fn); },

    // Admin settles a vendor's unsettled delivered orders; refreshes the order cache.
    settleVendor: async (vendorId) => {
      const r = await post("/api/admin/settle-vendor", { vendorId });
      try { _cache.orders = await get("/api/orders"); emit(); } catch (e) {}
      return r;
    },

    /* ── Web Push ── */
    savePushSubscription: (subscription) => post("/api/push/subscribe", { subscription }),

    /* ── Gold-coins rewards ── */
    rewardsMe:    () => get("/api/rewards/me"),
    gameWin:      (orderId) => post("/api/rewards/win", { orderId: orderId || undefined }),
    redeemReward: (type) => post("/api/rewards/redeem", { type }),

    /* ── Rider KYC document submission ── */
    submitRiderDocuments: async (riderId, docs) => {
      const rider = await patch("/api/riders/" + riderId + "/documents", docs);
      const i = _cache.riders.findIndex((r) => r.id === riderId);
      if (i >= 0) _cache.riders[i] = rider; else _cache.riders.push(rider);
      emit();
      return rider;
    },
    // Admin verification decision: status ∈ 'verified' | 'rejected' | 'submitted'.
    setRiderKyc: async (riderId, status) => {
      const rider = await patch("/api/riders/" + riderId + "/documents", { kycStatus: status });
      const i = _cache.riders.findIndex((r) => r.id === riderId);
      if (i >= 0) _cache.riders[i] = rider;
      emit();
      return rider;
    },
    // Admin edits a Saradhi's core details (name, phone, vehicle, area, active).
    updateRiderDetails: async (riderId, fields) => {
      const rider = await patch("/api/riders/" + riderId, fields);
      const i = _cache.riders.findIndex((r) => r.id === riderId);
      if (i >= 0) _cache.riders[i] = rider; else _cache.riders.push(rider);
      emit();
      return rider;
    },
    // Admin deletes a Saradhi (login + record). force=true writes off any pending cash.
    deleteRider: async (riderId, force) => {
      await api("DELETE", "/api/riders/" + riderId, force ? { force: true } : undefined);
      _cache.riders = _cache.riders.filter((r) => r.id !== riderId);
      emit();
      return true;
    },
    // Admin marks ONE KYC item verified/rejected (offline check).
    verifyRiderItem: async (riderId, item, decision, notes) => {
      const rider = await patch("/api/riders/" + riderId + "/verify", { item, decision, notes });
      const i = _cache.riders.findIndex((r) => r.id === riderId);
      if (i >= 0) _cache.riders[i] = rider;
      emit();
      return rider;
    },
    // Admin runs an automated online check (DL/RC/Aadhaar) via the KYC provider.
    verifyRiderOnline: async (riderId, item) => {
      const out = await post("/api/riders/" + riderId + "/verify-online", { item });
      if (out && out.rider) { const i = _cache.riders.findIndex((r) => r.id === riderId); if (i >= 0) _cache.riders[i] = out.rider; emit(); }
      return out;
    },

    // Update the signed-in customer's profile (name, phone, dob, photoUrl, address).
    updateProfile: async (fields) => {
      const c = await put("/api/customers/me", fields);
      _cache.myCustomer = c;
      emit();
      return c;
    },

    rateOrder: async (orderId, data) => {
      const order = await post(`/api/orders/${orderId}/rating`, data);
      const idx = _cache.orders.findIndex((o) => o.id === orderId);
      if (idx >= 0) _cache.orders[idx] = order;
      emit();
      return order;
    },

    // Pull a rider's latest position (used for the customer's live ETA)
    refreshRider: async (id) => {
      try {
        const r = await get(`/api/riders/${id}`);
        const i = _cache.riders.findIndex((x) => x.id === id);
        if (i >= 0) _cache.riders[i] = r; else _cache.riders.push(r);
        emit();
        return r;
      } catch (e) { return null; }
    },

    setOrderStatus: async (orderId, status) => {
      const order = await patch(`/api/orders/${orderId}/status`, { status });
      const idx = _cache.orders.findIndex((o) => o.id === orderId);
      if (idx >= 0) _cache.orders[idx] = order;
      emit();
      return order;
    },

    advanceOrder: async (orderId, extra) => {
      const order = await patch(`/api/orders/${orderId}/advance`, extra || {});
      const idx = _cache.orders.findIndex((o) => o.id === orderId);
      if (idx >= 0) _cache.orders[idx] = order;
      emit();
      return order;
    },

    // Customer reads their own delivery OTP (rider never receives it)
    deliveryOtp: (orderId) => get(`/api/orders/${orderId}/otp`),

    // Resolve a pasted Google Maps link → { lat, lng, url } (coords may be null; link still navigates)
    resolveMapsLink: (url) => post("/api/geo/resolve", { url }),

    /* ââ Services module (local services / Pickup & Drop) ââ */
    // Reads from cache
    serviceVendors: (filter = {}) => _cache.serviceVendors
      .filter((v) => !filter.pattern  || (v.patterns || []).includes(filter.pattern))
      .filter((v) => !filter.category || v.categoryKey === filter.category),
    serviceVendor: (id) => _cache.serviceVendors.find((v) => v.id === id) || null,
    serviceItems: (vendorId) => _cache.services[vendorId] || [],
    myServiceVendor: () => _cache.myServiceVendor,
    bookings: (filter = {}) => _cache.bookings
      .filter((b) => !filter.serviceVendorId || b.serviceVendorId === filter.serviceVendorId)
      .filter((b) => !filter.customerId      || b.customerId      === filter.customerId)
      .filter((b) => !filter.status          || b.status          === filter.status)
      .slice()
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
    booking: (id) => _cache.bookings.find((b) => b.id === id) || null,

    // Fetch a single service business + its catalog (customer browse)
    loadServiceVendor: async (id) => {
      const r = await get(`/api/services/vendors/${id}`);
      _cache.services[id] = r.items || [];
      const i = _cache.serviceVendors.findIndex((v) => v.id === id);
      if (i >= 0) _cache.serviceVendors[i] = r.vendor; else _cache.serviceVendors.push(r.vendor);
      emit();
      return r;
    },

    // Customer creates a booking
    createBooking: async (payload) => {
      const b = await post("/api/bookings", payload);
      _cache.bookings.unshift(b);
      emit();
      return b;
    },
    bookingOtp: (id) => get(`/api/bookings/${id}/otp`),
    rateBooking: async (id, data) => {
      const b = await post(`/api/bookings/${id}/rating`, data);
      const i = _cache.bookings.findIndex((x) => x.id === id); if (i >= 0) _cache.bookings[i] = b;
      emit(); return b;
    },

    // Partner / rider booking actions
    acceptBooking:  async (id)         => _upsertBooking(await patch(`/api/bookings/${id}/accept`, {})),
    rejectBooking:  async (id, reason) => _upsertBooking(await patch(`/api/bookings/${id}/reject`, { reason })),
    readyBooking:   async (id, finalTotal) => _upsertBooking(await patch(`/api/bookings/${id}/ready`, finalTotal != null ? { finalTotal } : {})),
    autoAssignBookingRider: async (id) => {
      const r = await post(`/api/bookings/${id}/auto-assign`, {});
      _upsertBooking(r.booking);
      const rr = _cache.riders.find((x) => x.id === r.rider.id); if (rr) rr.status = "on_delivery";
      return r;
    },
    advanceBooking: async (id, extra) => _upsertBooking(await patch(`/api/bookings/${id}/advance`, extra || {})),

    // Partner catalog management
    updateServiceVendor: async (id, data) => {
      const v = await patch(`/api/services/vendors/${id}`, data);
      if (_cache.myServiceVendor && _cache.myServiceVendor.id === id) _cache.myServiceVendor = v;
      const i = _cache.serviceVendors.findIndex((x) => x.id === id);
      if (i >= 0) _cache.serviceVendors[i] = v;
      emit(); return v;
    },
    addServiceItem: async (vendorId, data) => { const it = await post(`/api/services/vendors/${vendorId}/items`, data); (_cache.services[vendorId] = _cache.services[vendorId] || []).push(it); emit(); return it; },
    updateServiceItem: async (id, data) => {
      const it = await patch(`/api/services/items/${id}`, data);
      Object.keys(_cache.services).forEach((k) => { const i = _cache.services[k].findIndex((s) => s.id === id); if (i >= 0) _cache.services[k][i] = it; });
      emit(); return it;
    },
    deleteServiceItem: async (id) => {
      await del(`/api/services/items/${id}`);
      Object.keys(_cache.services).forEach((k) => { _cache.services[k] = _cache.services[k].filter((s) => s.id !== id); });
      emit(); return true;
    },
    // Admin onboards a service business
    createServiceVendor: (data) => post("/api/services/vendors", data),
    joinBookingRoom: (id) => _socket && _socket.emit("join:order", id),

    // Rider cash settlement via Razorpay UPI deposit
    settleCashStart:  (riderId, amount) => post(`/api/riders/${riderId}/settle`, { amount }),
    settleCashVerify: (riderId, data)   => post(`/api/riders/${riderId}/settle/verify`, data),
    settingsRaw: () => ({ ...(_cache.settings || {}) }),
    codCashLimit: () => (_cache.settings && _cache.settings.codCashLimit != null) ? Number(_cache.settings.codCashLimit) : 2000,
    operationalZones: () => (_cache.settings && Array.isArray(_cache.settings.operationalZones)) ? _cache.settings.operationalZones : [],

    assignRider: async (orderId, riderId) => {
      const order = await patch(`/api/orders/${orderId}/assign`, { riderId });
      const idx = _cache.orders.findIndex((o) => o.id === orderId);
      if (idx >= 0) _cache.orders[idx] = order;
      // Mark rider busy in cache
      const r = _cache.riders.find((r) => r.id === riderId);
      if (r) r.status = "on_delivery";
      emit();
      return order;
    },

    // Auto-pick nearest available fleet rider â no manual selection needed
    autoAssignRider: async (orderId) => {
      const result = await post(`/api/orders/${orderId}/auto-assign`, {});
      const { order, rider } = result;
      const idx = _cache.orders.findIndex((o) => o.id === orderId);
      if (idx >= 0) _cache.orders[idx] = order;
      // Mark rider busy in cache
      const r = _cache.riders.find((r) => r.id === rider.id);
      if (r) r.status = "on_delivery";
      emit();
      return { order, rider };
    },

    setRiderStatus: async (riderId, status) => {
      const rider = await patch(`/api/riders/${riderId}/status`, { status });
      const idx = _cache.riders.findIndex((r) => r.id === riderId);
      if (idx >= 0) _cache.riders[idx] = rider;
      emit();
      return rider;
    },

    // Rider toggles own availability (available ↔ offline)
    setMyRiderStatus: async (riderId, status) => {
      const rider = await patch(`/api/riders/${riderId}/availability`, { status });
      const idx = _cache.riders.findIndex((r) => r.id === riderId);
      if (idx >= 0) _cache.riders[idx] = rider;
      emit();
      return rider;
    },

    // Rider pushes GPS position to server
    updateMyLocation: (riderId, lat, lng, orderId) =>
      patch(`/api/riders/${riderId}/location`, { lat, lng, orderId: orderId || null }),

    toggleFavorite: async (vendorId) => {
      const vendorIds = await post("/api/customers/me/favorites/toggle", { vendorId });
      _cache.favorites = vendorIds;
      emit();
      return vendorIds;
    },

    upsertProduct: async (product) => {
      const { id, vendorId, ...rest } = product;
      let saved;
      if (id) {
        saved = await put(`/api/vendors/${vendorId}/products/${id}`, rest);
      } else {
        saved = await post(`/api/vendors/${vendorId}/products`, rest);
      }
      // Refresh product list for this vendor
      await loadVendorProducts(vendorId);
      emit();
      return saved;
    },


    deleteProduct: async (vendorId, productId) => {
      await del(`/api/vendors/${vendorId}/products/${productId}`);
      if (_cache.products[vendorId]) {
        _cache.products[vendorId] = _cache.products[vendorId].filter((p) => p.id !== productId);
      }
      emit();
    },

    clearDemoData: async () => {
      return del("/api/admin/clear-demo");
    },

    createMerchant: (data) => post("/api/admin/merchants", data),
    updateSettings: async (data) => { const s = await put("/api/settings", data); _cache.settings = s; emit(); return s; },
    createRider: (data) => post("/api/admin/riders", data),
    deleteMerchant: async (vendorId) => {
      await del(`/api/admin/merchants/${vendorId}`);
      _cache.vendors = _cache.vendors.filter((v) => v.id !== vendorId);
      emit();
    },

    upsertVendor: async (vendor) => {
      const { id, ...rest } = vendor;
      let saved;
      if (id) {
        saved = await put(`/api/vendors/${id}`, rest);
        const idx = _cache.vendors.findIndex((v) => v.id === id);
        if (idx >= 0) _cache.vendors[idx] = saved;
      } else {
        saved = await post("/api/vendors", rest);
        _cache.vendors.push(saved);
      }
      emit();
      return saved;
    },

    refreshOrders,
    refreshAnalytics,
    // Admin monitor refresh — reloads every live monitor feed, not just logins,
    // so newly-placed pharmacy (Rx) orders, partners and support show up without a full reload.
    refreshLogins: async () => {
      await Promise.all([
        get("/api/admin/logins").then((l) => { _cache.logins = l; }).catch(() => {}),
        get("/api/admin/rx-orders").then((r) => { _cache.rxOrders = r; }).catch(() => {}),
        get("/api/admin/partners").then((p) => { _cache.partners = p; }).catch(() => {}),
        get("/api/admin/support").then((s) => { _cache.support = s; }).catch(() => {}),
        get("/api/events").then((e) => { _cache.events = e; }).catch(() => {}),
        get("/api/orders").then((o) => { _cache.orders = o; }).catch(() => {}),
        get("/api/customers").then((c) => { _cache.customers = c; }).catch(() => {}),
        get("/api/services/vendors").then((v) => { _cache.serviceVendors = v || []; }).catch(() => {}),
        get("/api/bookings").then((b) => { _cache.bookings = b || []; }).catch(() => {}),
      ]);
      emit();
    },
    loadVendorProducts,

    // No-op reset (use admin tools or re-seed the server)
    reset: () => console.warn("BW.reset() is a no-op in production mode. Re-run `node db/seed.js` on the server."),
  };

  global.BW = API;
})(window);
