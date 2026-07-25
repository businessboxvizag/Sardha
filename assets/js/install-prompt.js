/* =====================================================================
 * Saardha — Smart install prompt
 * Auto-detects the device and shows the right install action:
 *   • Android/Chrome → one-tap native install (beforeinstallprompt)
 *   • iPhone/Safari  → guided "Add to Home Screen" sheet (Apple blocks
 *     programmatic install, so guiding is the only option)
 * Skips entirely if the app is already installed (running standalone),
 * on desktop, or if the user dismissed it before.
 * ===================================================================== */
(function () {
  "use strict";

  var isStandalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true;
  if (isStandalone) return; // already installed — nothing to do

  var ua = navigator.userAgent || "";
  var isIOS = /iphone|ipad|ipod/i.test(ua) && !window.MSStream;
  var isAndroid = /android/i.test(ua);
  if (!isIOS && !isAndroid) return; // desktop — skip

  var DISMISS_KEY = "saardha_install_dismissed";
  try { if (localStorage.getItem(DISMISS_KEY)) return; } catch (e) {}

  var BRAND = "#e62a1f";
  var deferredPrompt = null;
  var shown = false;

  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    deferredPrompt = e;
    show();
  });

  // iOS never fires beforeinstallprompt — show the guided sheet after load.
  if (isIOS) setTimeout(show, 1200);
  // Android fallback: if the event didn't fire, still offer guidance.
  if (isAndroid) setTimeout(function () { if (!shown) show(); }, 2600);

  function dismiss(node) {
    if (node && node.parentNode) node.parentNode.removeChild(node);
    try { localStorage.setItem(DISMISS_KEY, "1"); } catch (e) {}
  }

  function show() {
    if (shown) return;
    shown = true;

    var style = document.createElement("style");
    style.textContent =
      "@keyframes saUp{from{transform:translateY(110%)}to{transform:translateY(0)}}" +
      "@keyframes saBounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}";
    document.head.appendChild(style);

    var wrap = document.createElement("div");
    wrap.setAttribute("style",
      "position:fixed;left:0;right:0;bottom:0;z-index:99999;padding:16px 16px 22px;" +
      "background:#fff;border-top-left-radius:20px;border-top-right-radius:20px;" +
      "box-shadow:0 -10px 34px rgba(0,0,0,.20);animation:saUp .38s ease;font-family:inherit");

    var close =
      '<button id="saClose" aria-label="Close" style="position:absolute;top:6px;right:8px;' +
      "border:none;background:none;font-size:24px;line-height:1;color:#aaa;cursor:pointer\">&times;</button>";

    var header =
      '<div style="display:flex;align-items:center;gap:12px;margin-bottom:14px">' +
        '<img src="/assets/img/icon.png" alt="Saardha" style="width:48px;height:48px;object-fit:contain;flex-shrink:0"/>' +
        '<div><div style="font-weight:800;font-size:17px;color:#1a1a1a">Install Saardha</div>' +
        '<div style="font-size:13px;color:#666">Add it to your home screen for the best experience</div></div>' +
      "</div>";

    var body;
    if (isIOS) {
      body =
        '<div style="font-size:14.5px;color:#333;line-height:2.0">' +
          '<div>1&nbsp;&nbsp;Tap the <b>Share</b> button ' +
            '<span style="display:inline-block;color:' + BRAND + ';font-size:18px;vertical-align:-2px;animation:saBounce 1.4s infinite">&#x2191;</span>' +
            " at the bottom of Safari</div>" +
          '<div>2&nbsp;&nbsp;Scroll and tap <b>&ldquo;Add to Home Screen&rdquo;</b></div>' +
          "<div>3&nbsp;&nbsp;Tap <b>Add</b> &mdash; you're done!</div>" +
        "</div>";
    } else {
      body =
        '<button id="saInstall" style="width:100%;padding:14px;border:none;border-radius:12px;' +
        "background:" + BRAND + ";color:#fff;font-size:16px;font-weight:800;cursor:pointer\">Install app</button>" +
        '<div style="font-size:12px;color:#8a8a8a;text-align:center;margin-top:8px">Free &middot; installs in a second</div>';
    }

    wrap.innerHTML = '<div style="position:relative">' + close + header + body + "</div>";
    document.body.appendChild(wrap);

    var c = document.getElementById("saClose");
    if (c) c.onclick = function () { dismiss(wrap); };

    var btn = document.getElementById("saInstall");
    if (btn) btn.onclick = function () {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        deferredPrompt.userChoice.then(function () { dismiss(wrap); });
      } else {
        btn.textContent = 'Open the ⋮ menu → “Install app”';
      }
    };
  }
})();
