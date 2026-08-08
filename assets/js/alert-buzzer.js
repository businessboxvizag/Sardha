/* =====================================================================
 * Saardha — New-order alarm
 * Generates an attention-grabbing alarm using the Web Audio API, so it
 * needs no external sound file. Exposes window.Buzzer.{play,stop,beep}.
 * Also vibrates on supported phones. Audio is unlocked on first user
 * interaction (browsers block sound until the user taps/clicks).
 * ===================================================================== */
(function (global) {
  "use strict";

  let ctx = null;
  let timer = null;
  let stopAt = 0;

  function ensureCtx() {
    if (!ctx) {
      const AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return null;
      try { ctx = new AC(); } catch (e) { return null; }
    }
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    return ctx;
  }

  /* One loud, urgent alarm burst (two rising square-wave tones through a shared gain) */
  function beep() {
    const c = ensureCtx();
    if (!c) return;
    const now = c.currentTime;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.9, now + 0.02);   // loud
    g.gain.setValueAtTime(0.9, now + 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);
    g.connect(c.destination);
    // Square waves cut through ambient noise far better than a sine chime.
    [ [740, now], [988, now + 0.22], [740, now + 0.44] ].forEach(function (pair) {
      const o = c.createOscillator();
      o.type = "square";
      o.frequency.setValueAtTime(pair[0], pair[1]);
      o.connect(g);
      o.start(pair[1]);
      o.stop(pair[1] + 0.2);
    });
  }

  function vibrateLoop() {
    if (global.navigator && navigator.vibrate) navigator.vibrate([400, 150, 400, 150, 400, 150, 400]);
  }

  /* Ring loudly and KEEP ringing until stop() (or up to durationMs as a safety cap,
     default 60s). The alarm repeats so a busy merchant/rider can't miss it. */
  function play(durationMs) {
    stop();
    stopAt = Date.now() + (durationMs || 60000);
    beep();
    vibrateLoop();
    timer = setInterval(function () {
      if (Date.now() >= stopAt) { stop(); return; }
      beep();
      vibrateLoop();
    }, 900);
    // A tap/click anywhere silences the alarm (the person has clearly noticed it).
    setTimeout(function () {
      ["click", "keydown", "touchstart"].forEach(function (ev) { global.addEventListener(ev, stop, { once: true }); });
    }, 400);
  }

  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
    if (global.navigator && navigator.vibrate) navigator.vibrate(0);
    ["click", "keydown", "touchstart"].forEach(function (ev) { global.removeEventListener(ev, stop); });
  }

  /* ── Browser notifications (pull the user back from another app) ── */
  function requestNotify() {
    try {
      if ("Notification" in global && Notification.permission === "default") {
        Notification.requestPermission().catch(function () {});
      }
    } catch (e) {}
  }
  // Show a system notification (title + body). Clicking it focuses the app.
  function notify(title, body) {
    try {
      if (!("Notification" in global) || Notification.permission !== "granted") return;
      var n = new Notification(title, { body: body || "", icon: "../assets/img/icon.png", tag: "saardha", renotify: true });
      n.onclick = function () { try { global.focus(); } catch (e) {} n.close(); };
    } catch (e) {}
  }
  // Buzzer + vibrate + system notification together — the full "new task" alert.
  function alert(title, body, durationMs) {
    play(durationMs);
    notify(title, body);
  }

  /* Unlock audio on the first user gesture (login click counts) */
  function unlock() {
    ensureCtx();
    requestNotify();
    ["click", "keydown", "touchstart"].forEach(function (ev) {
      global.removeEventListener(ev, unlock);
    });
  }
  ["click", "keydown", "touchstart"].forEach(function (ev) {
    global.addEventListener(ev, unlock);
  });

  global.Buzzer = { play: play, stop: stop, beep: beep, notify: notify, requestNotify: requestNotify, alert: alert };
})(window);
