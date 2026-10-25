// CT17 Cards - the app clock (A3).
// Everything that moves (tweens, deal timing, auto-finish, timer) reads CT17.clock.now() and schedules with
// CT17.clock.after() instead of performance.now()/setTimeout.  Live, the clock is wall time.  While a movie is
// being recorded the clock is the MOVIE's clock: it advances exactly 1/fps per recorded frame, so the movie plays
// at the speed the screen shows when not recording, even if the screen slows down while it records.
(function () {
  'use strict';
  const CT17 = (window.CT17 = window.CT17 || {});
  let offset = 0;            // live: now = performance.now() + offset
  let virt = null;           // recording: virtual time in ms (null when live)
  const timers = [];         // {t, fn}

  const clock = {
    now() { return virt != null ? virt : performance.now() + offset; },
    /** enter movie time, starting from the current time */
    freeze() { virt = clock.now(); },
    /** advance movie time by ms */
    step(ms) { if (virt != null) virt += ms; },
    /** back to wall time, continuing smoothly from the movie time */
    thaw() { if (virt == null) return; offset = virt - performance.now(); virt = null; },
    get virtual() { return virt != null; },
    after(ms, fn) { const t = { t: clock.now() + ms, fn }; timers.push(t); return t; },
    cancel(t) { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); },
    cancelAll() { timers.length = 0; },
    /** run timers that are due (called once per frame by the view, before animating) */
    runDue() {
      const now = clock.now();
      for (let guard = 0; guard < 200; guard++) {
        let k = -1;
        for (let i = 0; i < timers.length; i++) if (timers[i].t <= now && (k < 0 || timers[i].t < timers[k].t)) k = i;
        if (k < 0) return;
        const t = timers.splice(k, 1)[0];
        try { t.fn(); } catch (e) { console.error(e); }
      }
    }
  };
  CT17.clock = clock;
})();
