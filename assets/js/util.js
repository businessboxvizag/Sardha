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
  // Google calls this globally when the Maps key/billing is invalid. Instead of
  // leaving the ugly "can't load Google Maps" box, swap every embed for a note.
  function gmapFallbackNote(el) {
    el.innerHTML = "";
    var note = document.createElement("div");
    note.style.cssText = "display:flex;align-items:center;justify-content:center;height:100%;min-height:120px;padding:12px;text-align:center;color:var(--muted);font-size:12.5px";
    note.textContent = "Map preview unavailable right now — your location is still set from GPS / the address you typed.";
    el.appendChild(note);
  }
  window.gm_authFailure = function () {
    window.__gmapsFailed = true;
    try { document.querySelectorAll(".gmap-embed").forEach(gmapFallbackNote); } catch (e) {}
  };

  /* ── Free maps: Leaflet + OpenStreetMap (no API key, no billing needed) ── */
  var _leafletPromise = null;
  function loadLeaflet() {
    if (global.L && global.L.map) return Promise.resolve(global.L);
    if (_leafletPromise) return _leafletPromise;
    _leafletPromise = new Promise(function (resolve, reject) {
      if (!document.getElementById("leaflet-css")) {
        var link = document.createElement("link");
        link.id = "leaflet-css"; link.rel = "stylesheet";
        link.href = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css";
        document.head.appendChild(link);
      }
      var s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js";
      s.async = true;
      s.onload = function () { resolve(global.L); };
      s.onerror = function () { reject(new Error("leaflet failed to load")); };
      document.head.appendChild(s);
    });
    return _leafletPromise;
  }
  function osmLayer(L) {
    return L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" });
  }
  function pinIcon(L, kind, label) {
    var html = kind === "chariot"
      ? '<div style="font-size:26px;line-height:1;transform:translate(-13px,-24px)">🛺</div>'
      : '<div style="width:26px;height:26px;border-radius:50%;background:#e62a1f;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);transform:translate(-13px,-13px)">' + (label ? String(label).charAt(0) : "") + "</div>";
    return L.divIcon({ html: html, className: "", iconSize: [0, 0] });
  }

  // markers: [{ lat, lng, label, icon }] — returns a container with a live OSM map.
  function gmap(opts) {
    opts = opts || {};
    var container = el("div", { class: "gmap-embed", style: "width:100%;height:" + (opts.height || 220) + "px;border-radius:12px;overflow:hidden;background:var(--surface-2)" });
    loadLeaflet().then(function (L) {
      var pts = (opts.markers || []).filter(function (m) { return m && m.lat != null && m.lng != null; });
      var center = opts.center || (pts[0] ? [Number(pts[0].lat), Number(pts[0].lng)] : [17.6868, 83.2185]);
      var map = L.map(container, { zoomControl: true, attributionControl: false }).setView(center, opts.zoom || 13);
      osmLayer(L).addTo(map);
      var group = [];
      pts.forEach(function (m) {
        L.marker([Number(m.lat), Number(m.lng)], { icon: pinIcon(L, m.icon, m.label), title: m.label || "" }).addTo(map);
        group.push([Number(m.lat), Number(m.lng)]);
      });
      if (group.length > 1) { try { map.fitBounds(group, { padding: [30, 30] }); } catch (e) {} }
      setTimeout(function () { try { map.invalidateSize(); } catch (e) {} }, 200);
    }).catch(function () { gmapFallbackNote(container); });
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
    var container = el("div", { class: "gmap-embed", style: "width:100%;height:" + (opts.height || 220) + "px;border-radius:12px;overflow:hidden;background:var(--surface-2)" });
    loadLeaflet().then(function (L) {
      var start = [Number(opts.lat) || 17.6868, Number(opts.lng) || 83.2185]; // default Visakhapatnam
      var map = L.map(container, { zoomControl: true, attributionControl: false }).setView(start, opts.lat ? 16 : 12);
      osmLayer(L).addTo(map);
      var marker = L.marker(start, { draggable: true, icon: pinIcon(L, null, "") }).addTo(map);
      function report(ll) { if (opts.onPick) opts.onPick(ll.lat, ll.lng); }
      marker.on("dragend", function () { report(marker.getLatLng()); });
      map.on("click", function (e) { marker.setLatLng(e.latlng); report(e.latlng); });
      setTimeout(function () { try { map.invalidateSize(); } catch (e) {} }, 200);
    }).catch(function () { gmapFallbackNote(container); });
    return container;
  }

  /* ── Google Maps link → coordinates (no paid API needed) ──────────
   * Long links carry coords in the URL (parsed instantly here); short
   * "share" links are resolved by the backend, which follows the
   * redirect. The raw link is always kept for navigation. */
  function parseMapsLink(url) {
    if (!url) return null;
    var m;
    m = url.match(/@(-?\d{1,3}\.\d{3,}),(-?\d{1,3}\.\d{3,})/);      if (m) return { lat: +m[1], lng: +m[2] };
    m = url.match(/!3d(-?\d{1,3}\.\d{3,})!4d(-?\d{1,3}\.\d{3,})/);  if (m) return { lat: +m[1], lng: +m[2] };
    m = url.match(/[?&](?:q|query|ll|daddr|destination|center)=(-?\d{1,3}\.\d{3,}),\s*(-?\d{1,3}\.\d{3,})/);
    if (m) return { lat: +m[1], lng: +m[2] };
    return null;
  }

  // A paste-a-Google-Maps-link row. opts.onResolved(lat|null, lng|null, url) fires on save.
  function mapsLinkField(opts) {
    opts = opts || {};
    var input = el("input", { type: "url", placeholder: "Paste Google Maps link", value: opts.value || "" });
    var status = el("span", { class: "muted small" }, opts.value ? "📍 Link saved" : "");
    var btn = el("button", { class: "btn ghost sm", type: "button" }, "Save link");
    btn.addEventListener("click", async function () {
      var url = (input.value || "").trim();
      if (!url) { status.textContent = "Paste a link first"; return; }
      status.textContent = "Reading link…"; btn.disabled = true;
      var c = parseMapsLink(url);
      try {
        if (!c && global.BW && BW.resolveMapsLink) {
          var r = await BW.resolveMapsLink(url);
          if (r && r.lat != null) c = { lat: r.lat, lng: r.lng };
          if (r && r.url) url = r.url;
        }
      } catch (e) {}
      if (c) { status.textContent = "📍 Pin set from link"; }
      else { status.textContent = "✓ Link saved — navigation will open it"; }
      if (opts.onResolved) opts.onResolved(c ? c.lat : null, c ? c.lng : null, url);
      btn.disabled = false;
    });
    return el("div", {}, [
      el("div", { style: "display:flex;gap:8px;align-items:center" }, [input, btn]),
      el("div", { style: "margin-top:4px" }, status),
    ]);
  }

  global.UI = { el, esc, $, $$, money, timeAgo, clockTime, toast, modal, topbar, project, statusBadge, tracker, gmap, mapPicker, parseMapsLink, mapsLinkField };
})(window);
