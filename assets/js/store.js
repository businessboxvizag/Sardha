/* =====================================================================
 * Business Wheels — Shared Data Layer ("simulated backend")
 * ---------------------------------------------------------------------
 * A single localStorage-backed datastore shared by the Customer,
 * Merchant and Admin apps. Provides:
 *   - Seed data (vendors, products, riders, customers, orders)
 *   - CRUD + domain operations (place order, accept, assign rider, ...)
 *   - Live pub/sub across tabs via BroadcastChannel + storage events
 *
 * In a real deployment this module would be replaced by REST/WebSocket
 * calls to a server. The public API (window.BW) is intentionally shaped
 * like one so swapping it out is mechanical.
 * ===================================================================== */
(function (global) {
  "use strict";

  const DB_KEY = "bw_db_v1";
  const CHANNEL = "bw_events";

  /* ----------------------------- Utilities ------------------------- */
  const uid = (p = "id") =>
    p + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const now = () => new Date().toISOString();
  const clone = (o) => JSON.parse(JSON.stringify(o));

  /* --------------------------- Order status ------------------------ */
  const STATUS = {
    PLACED: "PLACED",
    ACCEPTED: "ACCEPTED",
    ASSIGNED: "ASSIGNED",
    PICKED_UP: "PICKED_UP",
    OUT_FOR_DELIVERY: "OUT_FOR_DELIVERY",
    DELIVERED: "DELIVERED",
    CANCELLED: "CANCELLED",
  };
  const STATUS_FLOW = [
    STATUS.PLACED,
    STATUS.ACCEPTED,
    STATUS.ASSIGNED,
    STATUS.PICKED_UP,
    STATUS.OUT_FOR_DELIVERY,
    STATUS.DELIVERED,
  ];
  const STATUS_LABEL = {
    PLACED: "Placed",
    ACCEPTED: "Accepted",
    ASSIGNED: "Rider assigned",
    PICKED_UP: "Picked up",
    OUT_FOR_DELIVERY: "Out for delivery",
    DELIVERED: "Delivered",
    CANCELLED: "Cancelled",
  };

  /* ------------------------------ Seed ----------------------------- */
  function seed() {
    const vendors = [
      { id: "v_kirana", name: "Sharma Kirana Store", category: "Groceries", area: "MG Road", rating: 4.6, lat: 12.9758, lng: 77.6045, prepMins: 10, img: "🛒" },
      { id: "v_chaat", name: "Gupta Chaat Corner", category: "Street Food", area: "Brigade Road", rating: 4.8, lat: 12.9716, lng: 77.6101, prepMins: 15, img: "🥘" },
      { id: "v_florist", name: "Lily & Marigold", category: "Florist", area: "Indiranagar", rating: 4.4, lat: 12.9719, lng: 77.6412, prepMins: 8, img: "💐" },
      { id: "v_pharma", name: "HealthFirst Pharmacy", category: "Pharmacy", area: "Koramangala", rating: 4.7, lat: 12.9352, lng: 77.6245, prepMins: 5, img: "💊" },
      { id: "v_bakery", name: "Daily Bread Bakery", category: "Bakery", area: "Jayanagar", rating: 4.5, lat: 12.9250, lng: 77.5938, prepMins: 12, img: "🥖" },
    ];

    const products = [
      { id: "p1", vendorId: "v_kirana", name: "Toor Dal (1kg)", price: 145, unit: "pack" },
      { id: "p2", vendorId: "v_kirana", name: "Basmati Rice (5kg)", price: 520, unit: "bag" },
      { id: "p3", vendorId: "v_kirana", name: "Sunflower Oil (1L)", price: 165, unit: "bottle" },
      { id: "p4", vendorId: "v_kirana", name: "Tea Powder (500g)", price: 240, unit: "pack" },
      { id: "p5", vendorId: "v_chaat", name: "Pani Puri (plate)", price: 60, unit: "plate" },
      { id: "p6", vendorId: "v_chaat", name: "Samosa Chaat", price: 80, unit: "plate" },
      { id: "p7", vendorId: "v_chaat", name: "Dahi Vada", price: 70, unit: "plate" },
      { id: "p8", vendorId: "v_chaat", name: "Masala Dosa", price: 90, unit: "plate" },
      { id: "p9", vendorId: "v_florist", name: "Rose Bouquet", price: 450, unit: "bunch" },
      { id: "p10", vendorId: "v_florist", name: "Marigold Garland", price: 120, unit: "string" },
      { id: "p11", vendorId: "v_florist", name: "Mixed Flowers", price: 350, unit: "bunch" },
      { id: "p12", vendorId: "v_pharma", name: "Paracetamol Strip", price: 30, unit: "strip" },
      { id: "p13", vendorId: "v_pharma", name: "Vitamin C (60 tabs)", price: 280, unit: "bottle" },
      { id: "p14", vendorId: "v_pharma", name: "Antiseptic Liquid", price: 95, unit: "bottle" },
      { id: "p15", vendorId: "v_bakery", name: "Whole Wheat Loaf", price: 55, unit: "loaf" },
      { id: "p16", vendorId: "v_bakery", name: "Chocolate Cake (500g)", price: 420, unit: "box" },
      { id: "p17", vendorId: "v_bakery", name: "Butter Croissant", price: 65, unit: "piece" },
    ];

    const riders = [
      { id: "r1", name: "Arjun Mehta", phone: "+91 98450 11111", vehicle: "Bike", status: "available", lat: 12.9740, lng: 77.6080, shift: "Morning", deliveriesToday: 4, rating: 4.7 },
      { id: "r2", name: "Priya Nair", phone: "+91 98450 22222", vehicle: "Scooter", status: "available", lat: 12.9700, lng: 77.6200, shift: "Morning", deliveriesToday: 6, rating: 4.9 },
      { id: "r3", name: "Imran Khan", phone: "+91 98450 33333", vehicle: "Bike", status: "on_delivery", lat: 12.9360, lng: 77.6250, shift: "Evening", deliveriesToday: 3, rating: 4.5 },
      { id: "r4", name: "Lakshmi Rao", phone: "+91 98450 44444", vehicle: "Cycle", status: "available", lat: 12.9260, lng: 77.5950, shift: "Morning", deliveriesToday: 5, rating: 4.6 },
      { id: "r5", name: "Vikram Singh", phone: "+91 98450 55555", vehicle: "Scooter", status: "offline", lat: 12.9719, lng: 77.6412, shift: "Evening", deliveriesToday: 0, rating: 4.4 },
    ];

    const customers = [
      { id: "c1", name: "Srinivas P", phone: "+91 99000 11111", address: "12, 4th Cross, Koramangala", lat: 12.9352, lng: 77.6245, joined: "2025-11-02" },
      { id: "c2", name: "Anita Desai", phone: "+91 99000 22222", address: "7, Brigade Road", lat: 12.9716, lng: 77.6101, joined: "2025-12-15" },
      { id: "c3", name: "Rohit Verma", phone: "+91 99000 33333", address: "21, Indiranagar 100ft Rd", lat: 12.9719, lng: 77.6412, joined: "2026-01-20" },
    ];

    const prodIndex = Object.fromEntries(products.map((p) => [p.id, p]));
    function makeHistoricalOrder(custId, vendorId, items, riderId, dayOffset, status) {
      const lineItems = items.map(([pid, qty]) => {
        const p = prodIndex[pid];
        return { productId: pid, name: p.name, price: p.price, qty };
      });
      const subtotal = lineItems.reduce((s, l) => s + l.price * l.qty, 0);
      const fee = 25;
      const d = new Date();
      d.setDate(d.getDate() + dayOffset);
      return {
        id: uid("ord"),
        customerId: custId,
        vendorId,
        items: lineItems,
        subtotal,
        deliveryFee: fee,
        total: subtotal + fee,
        status,
        riderId,
        createdAt: d.toISOString(),
        updatedAt: d.toISOString(),
        history: [{ status, at: d.toISOString() }],
      };
    }

    const seededOrders = [
      makeHistoricalOrder("c2", "v_chaat", [["p5", 2], ["p6", 1]], "r2", -2, STATUS.DELIVERED),
      makeHistoricalOrder("c3", "v_florist", [["p9", 1]], "r1", -1, STATUS.DELIVERED),
      makeHistoricalOrder("c1", "v_kirana", [["p1", 1], ["p3", 2]], "r4", -1, STATUS.DELIVERED),
      makeHistoricalOrder("c2", "v_bakery", [["p16", 1], ["p17", 3]], "r2", 0, STATUS.OUT_FOR_DELIVERY),
    ];

    return {
      vendors,
      products,
      riders,
      customers,
      orders: seededOrders,
      currentCustomerId: "c1",
      favorites: { c1: ["v_chaat"], c2: [], c3: [] },
      meta: { seededAt: now() },
    };
  }

  /* --------------------------- Persistence ------------------------- */
  function load() {
    try {
      const raw = localStorage.getItem(DB_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {
      console.warn("BW: failed to read db, reseeding", e);
    }
    const fresh = seed();
    localStorage.setItem(DB_KEY, JSON.stringify(fresh));
    return fresh;
  }

  function save(database) {
    localStorage.setItem(DB_KEY, JSON.stringify(database));
    broadcast();
    emit();
  }

  let db = load();

  /* ----------------------------- Pub/Sub --------------------------- */
  const listeners = new Set();
  let channel = null;
  try {
    channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = () => {
      db = load();
      emit();
    };
  } catch (e) {
    /* BroadcastChannel unsupported — fall back to storage events */
  }
  global.addEventListener("storage", (e) => {
    if (e.key === DB_KEY) {
      db = load();
      emit();
    }
  });

  function broadcast() {
    if (channel) channel.postMessage("changed");
  }
  function emit() {
    listeners.forEach((fn) => {
      try {
        fn(db);
      } catch (e) {
        console.error(e);
      }
    });
  }
  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  /* ------------------------- Query helpers ------------------------- */
  const byId = (arr, id) => arr.find((x) => x.id === id);

  /* ----------------------------- Public API ------------------------ */
  const API = {
    STATUS,
    STATUS_FLOW,
    STATUS_LABEL,
    subscribe,

    vendors: () => clone(db.vendors),
    vendor: (id) => clone(byId(db.vendors, id)),
    products: (vendorId) =>
      clone(db.products.filter((p) => !vendorId || p.vendorId === vendorId)),
    riders: () => clone(db.riders),
    rider: (id) => clone(byId(db.riders, id)),
    customers: () => clone(db.customers),
    customer: (id) => clone(byId(db.customers, id)),
    currentCustomer: () => clone(byId(db.customers, db.currentCustomerId)),
    setCurrentCustomer: (id) => {
      db.currentCustomerId = id;
      save(db);
    },
    orders: (filter = {}) =>
      clone(
        db.orders
          .filter((o) => !filter.vendorId || o.vendorId === filter.vendorId)
          .filter((o) => !filter.customerId || o.customerId === filter.customerId)
          .filter((o) => !filter.status || o.status === filter.status)
          .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      ),
    order: (id) => clone(byId(db.orders, id)),

    favorites: (customerId) => clone(db.favorites[customerId] || []),
    toggleFavorite: (customerId, vendorId) => {
      db.favorites[customerId] = db.favorites[customerId] || [];
      const list = db.favorites[customerId];
      const i = list.indexOf(vendorId);
      if (i >= 0) list.splice(i, 1);
      else list.push(vendorId);
      save(db);
    },

    placeOrder: ({ customerId, vendorId, items }) => {
      const subtotal = items.reduce((s, l) => s + l.price * l.qty, 0);
      const deliveryFee = 25;
      const order = {
        id: uid("ord"),
        customerId,
        vendorId,
        items: clone(items),
        subtotal,
        deliveryFee,
        total: subtotal + deliveryFee,
        status: STATUS.PLACED,
        riderId: null,
        createdAt: now(),
        updatedAt: now(),
        history: [{ status: STATUS.PLACED, at: now() }],
      };
      db.orders.push(order);
      save(db);
      return clone(order);
    },

    setOrderStatus: (orderId, status) => {
      const o = byId(db.orders, orderId);
      if (!o) return null;
      o.status = status;
      o.updatedAt = now();
      o.history.push({ status, at: now() });
      if (status === STATUS.DELIVERED || status === STATUS.CANCELLED) {
        const r = o.riderId && byId(db.riders, o.riderId);
        if (r) {
          r.status = "available";
          if (status === STATUS.DELIVERED) r.deliveriesToday += 1;
        }
      }
      save(db);
      return clone(o);
    },

    advanceOrder: (orderId) => {
      const o = byId(db.orders, orderId);
      if (!o) return null;
      const i = STATUS_FLOW.indexOf(o.status);
      if (i < 0 || i >= STATUS_FLOW.length - 1) return clone(o);
      return API.setOrderStatus(orderId, STATUS_FLOW[i + 1]);
    },

    assignRider: (orderId, riderId) => {
      const o = byId(db.orders, orderId);
      const r = byId(db.riders, riderId);
      if (!o || !r) return null;
      o.riderId = riderId;
      r.status = "on_delivery";
      if (o.status === STATUS.PLACED || o.status === STATUS.ACCEPTED) {
        o.status = STATUS.ASSIGNED;
      }
      o.updatedAt = now();
      o.history.push({ status: STATUS.ASSIGNED, at: now(), note: "Assigned to " + r.name });
      save(db);
      return clone(o);
    },

    setRiderStatus: (riderId, status) => {
      const r = byId(db.riders, riderId);
      if (!r) return null;
      r.status = status;
      save(db);
      return clone(r);
    },

    upsertProduct: (product) => {
      if (product.id) {
        const p = byId(db.products, product.id);
        if (p) Object.assign(p, product);
      } else {
        product.id = uid("p");
        db.products.push(product);
      }
      save(db);
      return clone(product);
    },
    deleteProduct: (id) => {
      db.products = db.products.filter((p) => p.id !== id);
      save(db);
    },

    upsertVendor: (vendor) => {
      if (vendor.id) {
        const v = byId(db.vendors, vendor.id);
        if (v) Object.assign(v, vendor);
      } else {
        vendor.id = uid("v");
        db.vendors.push(vendor);
      }
      save(db);
      return clone(vendor);
    },

    analytics: () => {
      const delivered = db.orders.filter((o) => o.status === STATUS.DELIVERED);
      const active = db.orders.filter(
        (o) => o.status !== STATUS.DELIVERED && o.status !== STATUS.CANCELLED
      );
      const revenue = db.orders
        .filter((o) => o.status !== STATUS.CANCELLED)
        .reduce((s, o) => s + o.total, 0);
      const byVendor = {};
      db.orders.forEach((o) => {
        if (o.status === STATUS.CANCELLED) return;
        byVendor[o.vendorId] = (byVendor[o.vendorId] || 0) + o.total;
      });
      return {
        totalOrders: db.orders.length,
        deliveredOrders: delivered.length,
        activeOrders: active.length,
        revenue,
        avgOrderValue: db.orders.length ? revenue / db.orders.length : 0,
        ridersOnline: db.riders.filter((r) => r.status !== "offline").length,
        revenueByVendor: byVendor,
      };
    },

    reset: () => {
      localStorage.removeItem(DB_KEY);
      db = load();
      save(db);
    },
  };

  global.BW = API;
})(window);
