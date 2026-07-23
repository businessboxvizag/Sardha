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

  /* One two-tone "ding-dong" chime */
  function beep() {
    const c = ensureCtx();
    if (!c) return;
    const now = c.currentTime;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(880, now);
    o.frequency.setValueAtTime(1180, now + 0.16);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.45, now + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.34);
    o.connect(g);
    g.connect(c.destination);
    o.start(now);
    o.stop(now + 0.36);
  }

  /* Repeat the chime for `durationMs` (default 6s) or until stop() */
  function play(durationMs) {
    stop();
    stopAt = Date.now() + (durationMs || 6000);
    beep();
    timer = setInterval(function () {
      if (Date.now() >= stopAt) { stop(); return; }
      beep();
    }, 750);
    if (global.navigator && navigator.vibrate) {
      navigator.vibrate([250, 120, 250, 120, 250]);
    }
  }

  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
    if (global.navigator && navigator.vibrate) navigator.vibrate(0);
  }

  /* Unlock audio on the first user gesture (login click counts) */
  function unlock() {
    ensureCtx();
    ["click", "keydown", "touchstart"].forEach(function (ev) {
      global.removeEventListener(ev, unlock);
    });
  }
  ["click", "keydown", "touchstart"].forEach(function (ev) {
    global.addEventListener(ev, unlock);
  });

  global.Buzzer = { play: play, stop: stop, beep: beep };
})(window);
