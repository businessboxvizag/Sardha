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

  /* ââ Auth helpers âââââââââââââââââââââââââââââââââââââââââââ */
  const Auth = {
    getToken: () => sessionStorage.getItem("bw_token"),
    getUser:  () => { try { return JSON.parse(sessionStorage.getItem("bw_user")); } catch { return null; } },
    setSession: (token, user) => {
      sessionStorage.setItem("bw_token", token);
      sessionStorage.setItem("bw_user", JSON.stringify(user));
    },
    clearSession: () => {
      sessionStorage.removeItem("bw_token");
      sessionStorage.removeItem("bw_user");
    },
    isLoggedIn: () => !!sessionStorage.getItem("bw_token"),
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
    logins: [], allUsers: [],
  };

  /* ââ Pub/sub ââââââââââââââââââââââââââââââââââââââââââââââââ */
  const _listeners = new Set();
  function emit() { _listeners.forEach((fn) => { try { fn(_cache); } catch (e) { console.error(e); } }); }
  function subscribe(fn) { _listeners.add(fn); return () => _listeners.delete(fn); }

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
  }

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
        get("/api/customers/me").then((c) => { _cache.myCustomer = c; }),
        get("/api/customers/me/favorites").then((f) => { _cache.favorites = f; }),
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
      );
    } else if (role === "rider") {
      loads.push(
        get("/api/orders").then((o) => { _cache.orders = o; }),
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

    /* Auth */
    Auth,
    login:  (email, password, role) => post("/api/auth/login", { email, password, role }),
    register: (data)           => post("/api/auth/register", data),
    checkEmail: (email, role)  => post("/api/auth/check-email", { email, role }),
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
    analytics:     ()   => _cache.analytics,
    logins:        ()   => [..._cache.logins],
    allUsers:      ()   => [..._cache.allUsers],

    /* ââ Async mutations ââ */
    placeOrder: async ({ vendorId, items, paymentMethod,
                         razorpay_payment_id, razorpay_order_id, razorpay_signature }) => {
      const order = await post("/api/orders", {
        vendorId, items, paymentMethod,
        razorpay_payment_id, razorpay_order_id, razorpay_signature,
      });
      _cache.orders.unshift(order);
      emit();
      return order;
    },

    // Create a Razorpay order for the server-computed amount (online checkout)
    createPaymentOrder: ({ vendorId, items }) =>
      post("/api/payments/create-order", { vendorId, items }),

    config: () => _config,

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

    advanceOrder: async (orderId) => {
      const order = await patch(`/api/orders/${orderId}/advance`);
      const idx = _cache.orders.findIndex((o) => o.id === orderId);
      if (idx >= 0) _cache.orders[idx] = order;
      emit();
      return order;
    },

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
    updateMyLocation: (riderId, lat, lng) =>
      patch(`/api/riders/${riderId}/location`, { lat, lng }),

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
    updateSettings: (data) => put("/api/settings", data),
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
    refreshLogins: async () => {
      _cache.logins = await get("/api/admin/logins");
      emit();
    },
    loadVendorProducts,

    // No-op reset (use admin tools or re-seed the server)
    reset: () => console.warn("BW.reset() is a no-op in production mode. Re-run `node db/seed.js` on the server."),
  };

  global.BW = API;
})(window);
