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
    return el("div", { class: "topbar" }, [
      el("a", { class: "brand", href: "../index.html" }, [
        el("span", { class: "brand-logo" }, "S"),
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

  function tracker(status) {
    const flow = BW.STATUS_FLOW;
    const idx = flow.indexOf(status);
    const wrap = el("div", { class: "tracker" });
    flow.forEach((s, i) => {
      let cls = "step";
      if (status === "CANCELLED") cls += "";
      else if (i < idx) cls += " done";
      else if (i === idx) cls += " active";
      wrap.appendChild(
        el("div", { class: cls }, [
          el("div", { class: "bead" }, i < idx ? "" : String(i + 1)),
          el("div", {}, BW.STATUS_LABEL[s]),
        ])
      );
    });
    return wrap;
  }

  global.UI = { el, esc, $, $$, money, timeAgo, clockTime, toast, modal, topbar, project, statusBadge, tracker };
})(window);
