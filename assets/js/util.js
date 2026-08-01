/* =========================================================
 * Saardha — shared UI helpers (no framework)
 * ========================================================= */
(function (global) {
  "use strict";

  // HTML-escape helper — use whenever inserting user data into a template literal / innerHTML
  function esc(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // tiny DOM helper: el("div", {class:"x"}, [children])
  // String children are always inserted via createTextNode (XSS-safe).
  // The "html" attribute key has been intentionally removed — use el() children instead.
  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        if (k === "class") node.className = attrs[k];
        else if (k.startsWith("on") && typeof attrs[k] === "function")
          node.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
        else if (attrs[k] != null) node.setAttribute(k, attrs[k]);
      }
    }
    (Array.isArray(children) ? children : children != null ? [children] : [])
      .forEach((c) => node.appendChild(typeof c === "string" ? document.createTextNode(c) : c));
    return node;
  }

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const money = (n) => "₹" + Number(n).toLocaleString("en-IN");

  function timeAgo(iso) {
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 60) return "just now";
    if (s < 3600) return Math.floor(s / 60) + "m ago";
    if (s < 86400) return Math.floor(s / 3600) + "h ago";
    return Math.floor(s / 86400) + "d ago";
  }
  function clockTime(iso) {
    return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  }

  function toast(msg) {
    let host = $("#toasts");
    if (!host) {
      host = el("div", { id: "toasts" });
      document.body.appendChild(host);
    }
    const t = el("div", { class: "toast" }, msg);
    host.appendChild(t);
    setTimeout(() => {
      t.style.transition = "opacity .3s";
      t.style.opacity = "0";
      setTimeout(() => t.remove(), 300);
    }, 2600);
  }

  // Simple modal. content = DOM node. Returns close fn.
  function modal({ title, body, footer }) {
    const close = () => backdrop.remove();
    const head = el("header", {}, [
      el("strong", {}, title || ""),
      el("button", { class: "x", onClick: close }, "×"),
    ]);
    const b = el("div", { class: "body" }, body);
    const parts = [head, b];
    if (footer) parts.push(el("div", { class: "foot" }, footer));
    const card = el("div", { class: "modal" }, parts);
    const backdrop = el("div", {
      class: "modal-backdrop",
      onClick: (e) => { if (e.target === backdrop) close(); },
    }, [card]);
    document.body.appendChild(backdrop);
    return close;
  }

  // Build the standard top bar
  function topbar(roleLabel, right) {
    const logoImg = el("img", {
      class: "brand-logo-img",
      src: "../assets/img/saardha-mark.png",
      alt: "Saardha",
    });
    return el("div", { class: "topbar" }, [
      el("a", { class: "brand", href: "./" }, [
        logoImg,
        el("span", {}, [
          document.createTextNode("Saardha"),
          el("small", {}, "On-demand local delivery"),
        ]),
      ]),
      el("span", { class: "spacer" }),
      ...(right || []),
      el("span", { class: "role-pill topbar-title" }, roleLabel),
    ]);
  }

  // crude pixel projection of lat/lng into the faux map box
  function project(lat, lng) {
    // Bengaluru-ish bounding box
    const minLat = 12.92, maxLat = 12.98, minLng = 77.59, maxLng = 77.65;
    const x = ((lng - minLng) / (maxLng - minLng)) * 100;
    const y = (1 - (lat - minLat) / (maxLat - minLat)) * 100;
    return { x: Math.max(4, Math.min(96, x)), y: Math.max(6, Math.min(94, y)) };
  }

  function statusBadge(status) {
    return el("span", { class: "badge " + status }, BW.STATUS_LABEL[status] || status);
  }

  /* ── Google Maps (shared across all apps) ─────────────────────
     Lazy-loads the Maps JS API using the key from BW.config().
     gmap(opts) returns a populated container, or null when no key
     is configured so the caller can fall back to the simple map. */
  var _gmapsPromise = null;
  function loadGoogleMaps(key) {
    if (window.google && window.google.maps) return Promise.resolve(window.google.maps);
    if (_gmapsPromise) return _gmapsPromise;
    if (!key) return Promise.reject(new Error("no maps key"));
    _gmapsPromise = new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = "https://maps.googleapis.com/maps/api/js?key=" + encodeURIComponent(key) + "&loading=async";
      s.async = true; s.defer = true;
      s.onload = function () { resolve(window.google.maps); };
      s.onerror = function () { reject(new Error("maps failed to load")); };
      document.head.appendChild(s);
    });
    return _gmapsPromise;
  }
  function mapsKey() {
    try { return (window.BW && BW.config && BW.config().googleMapsKey) || ""; } catch (e) { return ""; }
  }
  // Chariot marker for the Saradhi (who "rides a chariot").
  var CHARIOT_ICON = "data:image/svg+xml;utf8," + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">' +
    '<circle cx="24" cy="24" r="21" fill="#ffffff" stroke="#e62a1f" stroke-width="2.5"/>' +
    '<g stroke="#e62a1f" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" fill="none">' +
    '<path d="M17 27 L17 20 L30 20 C31 20 31 21 31 22 L31 27 Z" fill="#e62a1f"/>' +
    '<path d="M31 21 L36 18"/><path d="M31 26 L38 24"/>' +
    '<circle cx="18" cy="31" r="5.5" fill="#ffffff"/>' +
    '<path d="M18 25.5 L18 36.5 M12.5 31 L23.5 31 M14.2 27.2 L21.8 34.8 M21.8 27.2 L14.2 34.8"/>' +
    '</g></svg>');
  // markers: [{ lat, lng, label, color }]
  function gmap(opts) {
    opts = opts || {};
    var key = mapsKey();
    if (!key) return null; // caller falls back to the built-in map
    var container = el("div", { style: "width:100%;height:" + (opts.height || 220) + "px;border-radius:12px;overflow:hidden;background:var(--surface-2)" });
    loadGoogleMaps(key).then(function (maps) {
      var pts = (opts.markers || []).filter(function (m) { return m && m.lat != null && m.lng != null; });
      var center = opts.center || (pts[0] ? { lat: Number(pts[0].lat), lng: Number(pts[0].lng) } : { lat: 17.385, lng: 78.4867 });
      var map = new maps.Map(container, { center: center, zoom: opts.zoom || 14, disableDefaultUI: true, zoomControl: true });
      var bounds = new maps.LatLngBounds();
      pts.forEach(function (m) {
        var opts = { position: { lat: Number(m.lat), lng: Number(m.lng) }, map: map, title: m.label || "" };
        if (m.icon === "chariot") {
          // The Saradhi's top-down chariot artwork (falls back to the SVG glyph if missing).
          opts.icon = { url: "/assets/img/saradhi-chariot.png", scaledSize: new maps.Size(72, 34), anchor: new maps.Point(36, 17) };
        } else if (m.label) {
          opts.label = { text: String(m.label).charAt(0), color: "#fff", fontWeight: "700" };
        }
        new maps.Marker(opts);
        bounds.extend({ lat: Number(m.lat), lng: Number(m.lng) });
      });
      if (pts.length > 1) map.fitBounds(bounds);
    }).catch(function () { container.innerHTML = ""; });
    return container;
  }

  // Order progress rendered along an S-curve (echoes the Saardha logo).
  // The brand stroke fills from "Placed" to "Delivered"; a red S means cancelled.
  function tracker(status) {
    const flow = BW.STATUS_FLOW;
    const cancelled = status === "CANCELLED";
    const idx = cancelled ? -1 : flow.indexOf(status);
    const NS = "http://www.w3.org/2000/svg";
    // A smooth letter-S path; nodes are placed on it via getPointAtLength.
    const D = "M78,30 C78,14 55,8 40,16 C22,26 24,50 49,58 C75,67 77,92 58,101 C44,108 24,103 22,86";

    const wrap = el("div", { class: "s-track" + (cancelled ? " cancelled" : "") });
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 100 130");
    svg.setAttribute("class", "s-track-svg");
    const base = document.createElementNS(NS, "path");
    base.setAttribute("d", D); base.setAttribute("class", "s-base");
    const prog = document.createElementNS(NS, "path");
    prog.setAttribute("d", D); prog.setAttribute("class", "s-prog");
    svg.appendChild(base); svg.appendChild(prog);
    wrap.appendChild(svg);

    const cap = el("div", { class: "s-cap" }, cancelled ? "Order declined by the store" : (BW.STATUS_LABEL[status] || status));
    wrap.appendChild(cap);
    if (!cancelled && idx >= 0) {
      const total = flow.length - 1;
      wrap.appendChild(el("div", { class: "s-step-count" }, "Step " + (idx + 1) + " of " + (total + 1)));
    }

    // Fill + place nodes after the SVG is measurable in the DOM.
    requestAnimationFrame(() => {
      try {
        if (typeof prog.getTotalLength !== "function") return;
        const len = prog.getTotalLength();
        prog.style.strokeDasharray = len;
        prog.style.strokeDashoffset = len;                 // start empty
        const frac = cancelled ? 1 : (flow.length > 1 ? idx / (flow.length - 1) : 0);
        setTimeout(() => { prog.style.strokeDashoffset = len * (1 - Math.max(0, frac)); }, 40);
        flow.forEach((s, i) => {
          const p = prog.getPointAtLength(len * (i / (flow.length - 1)));
          const c = document.createElementNS(NS, "circle");
          c.setAttribute("cx", p.x); c.setAttribute("cy", p.y);
          c.setAttribute("r", i === idx ? 6 : 4.5);
          c.setAttribute("class", "s-node" + (i < idx ? " done" : "") + (i === idx ? " active" : ""));
          const t = document.createElementNS(NS, "title");
          t.textContent = BW.STATUS_LABEL[s] || s;
          c.appendChild(t);
          svg.appendChild(c);
        });
      } catch (e) { /* non-DOM env */ }
    });
    return wrap;
  }

  // Interactive pin picker: a Google Map with a draggable marker. Tap or drag to
  // set the drop point; calls opts.onPick(lat, lng). Returns null if no Maps key.
  function mapPicker(opts) {
    opts = opts || {};
    var key = mapsKey();
    if (!key) return null;
    var container = el("div", { style: "width:100%;height:" + (opts.height || 220) + "px;border-radius:12px;overflow:hidden;background:var(--surface-2)" });
    loadGoogleMaps(key).then(function (maps) {
      var start = { lat: Number(opts.lat) || 17.6868, lng: Number(opts.lng) || 83.2185 }; // default Visakhapatnam
      var map = new maps.Map(container, { center: start, zoom: (opts.lat ? 16 : 12), disableDefaultUI: true, zoomControl: true });
      var marker = new maps.Marker({ position: start, map: map, draggable: true });
      function report(latLng) { if (opts.onPick) opts.onPick(latLng.lat(), latLng.lng()); }
      marker.addListener("dragend", function () { report(marker.getPosition()); });
      map.addListener("click", function (e) { marker.setPosition(e.latLng); report(e.latLng); });
    }).catch(function () { container.innerHTML = ""; });
    return container;
  }

  global.UI = { el, esc, $, $$, money, timeAgo, clockTime, toast, modal, topbar, project, statusBadge, tracker, gmap, mapPicker };
})(window);
