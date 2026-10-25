// CT17 Cards - Record button (A3): the CT54/CT55/CT40 movie mechanism.
//  * No ffmpeg, no server, no batch file: WebCodecs in the page -> MP4 (mp4-muxer, js/lib/) -> downloaded when you stop.
//  * Full resolution: the table at its real device-pixel size (even numbers; up to 3840x2160).
//  * Right speed: while recording, the whole app runs on the movie's clock (CT17.clock): every drawn frame advances it
//    exactly 1/60 s and becomes movie frame i at time i/60.  If the encoder falls behind, the SCREEN slows down; the movie
//    still plays at normal speed.  Never runs ahead of real time either.
//  * Sound: every card sound is logged with its movie time and, at Stop, rendered again with the same synth
//    (OfflineAudioContext) -> AAC (else Opus), sample-locked to the picture.
//  * A caption (game, moves, time) is drawn in the lower left of the movie, and the "You Won!" banner when it shows.
(function () {
  'use strict';
  const CT17 = (window.CT17 = window.CT17 || {});
  const Rec = window.CT17Rec;
  const FPS = 60, SR = 48000, MAXW = 3840, MAXH = 2160;

  let take = null, comp = null, g2 = null, wallStart = 0, t0 = 0, starting = false, stopping = false;

  function size(view) {
    const c = view.renderer.domElement;
    let w = c.width, h = c.height;
    const k = Math.min(1, MAXW / w, MAXH / h);
    w = Math.floor((w * k) / 2) * 2; h = Math.floor((h * k) / 2) * 2;
    return { w, h };
  }
  function stamp() {
    const d = new Date(), p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  }
  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  }

  function drawOverlay(w, h) {
    const cap = R.caption ? R.caption() : '';
    const fs = Math.max(12, Math.round(h * 0.022));
    g2.font = `${fs}px "Palatino Linotype", "Book Antiqua", Palatino, Georgia, serif`;
    if (cap) {
      const tw = g2.measureText(cap).width, pad = fs * 0.5;
      g2.fillStyle = 'rgba(8,6,3,0.55)';
      g2.fillRect(fs * 0.6, h - fs * 2.2, tw + pad * 2, fs * 1.6);
      g2.fillStyle = '#d9b46a'; g2.textBaseline = 'middle'; g2.textAlign = 'left';
      g2.fillText(cap, fs * 0.6 + pad, h - fs * 1.4);
    }
    const win = R.banner ? R.banner() : null;
    if (win) {
      const big = Math.round(h * 0.08);
      g2.fillStyle = 'rgba(3,8,5,0.45)'; g2.fillRect(0, 0, w, h);
      g2.textAlign = 'center'; g2.textBaseline = 'middle';
      g2.font = `${big}px "Palatino Linotype", Palatino, Georgia, serif`;
      g2.fillStyle = '#d9b46a'; g2.fillText(win[0], w / 2, h / 2 - big * 0.4);
      g2.font = `italic ${Math.round(big * 0.35)}px "Palatino Linotype", Palatino, Georgia, serif`;
      g2.fillStyle = '#efe4c6'; g2.fillText(win[1] || '', w / 2, h / 2 + big * 0.45);
    }
  }

  const R = {
    fps: FPS,
    caption: null,          // () => string, set by main.js
    banner: null,           // () => [title, sub] | null
    onStatus: null,         // (text) => void
    get active() { return !!take; },
    get busyStarting() { return starting || stopping; },
    supported() { return !!(Rec && Rec.supported()); },
    status(t) { if (R.onStatus) R.onStatus(t); },

    /** get the encoder chosen for this window size in the background (so Record starts at once) */
    warm(view) { if (R.supported()) { const { w, h } = size(view); Rec.prepare(w, h, FPS, SR).catch(() => {}); } },

    async start(view) {
      if (take || starting || stopping) return;
      if (!R.supported()) { R.status('Recording needs a browser with WebCodecs (Chrome or Edge).'); return false; }
      starting = true;
      try {
        const { w, h } = size(view);
        R.status(`Preparing the recorder for ${w}×${h}…`);
        const pick = await Rec.prepare(w, h, FPS, SR);
        if (!pick) { R.status('No video encoder for this size: ' + Rec.tried.slice(-3).join('; ')); return false; }
        comp = document.createElement('canvas'); comp.width = w; comp.height = h;
        g2 = comp.getContext('2d', { alpha: false });
        take = Rec.Take(comp, w, h, FPS, SR, pick, Rec.audioPick);
        CT17.clock.freeze();
        t0 = CT17.clock.now();
        CT17.audio.startLog(t0);
        wallStart = performance.now();
        R.status('');
        return true;
      } finally { starting = false; }
    },

    /** may the view draw the next movie frame now?  (not ahead of real time, not while the encoder is full) */
    wantFrame() {
      if (!take) return false;
      if (take.busy()) return false;
      return (take.frames * 1000) / FPS <= performance.now() - wallStart + 2;
    },
    /** called right after the view rendered: that picture becomes the next movie frame */
    capture(view) {
      if (!take) return;
      const { width: w, height: h } = comp;
      g2.drawImage(view.renderer.domElement, 0, 0, w, h);
      drawOverlay(w, h);
      take.add(null);
      if (take.failed) { R.status('Recording failed: ' + take.failed); R.cancel(); }
    },
    get seconds() { return take ? take.seconds : 0; },
    get info() { return take ? `${take.w}×${take.h} ${take.fps} fps · ${take.codec} · sound ${take.audio}` : ''; },

    async stop() {
      if (!take || stopping) return;
      stopping = true;
      const tk = take; take = null;
      CT17.clock.thaw();
      const events = CT17.audio.stopLog();
      try {
        if (tk.hasAudio && tk.frames) {
          R.status('Adding the sound…');
          const pcm = await CT17.audio.render(events, tk.frames / FPS, SR);
          const n = pcm.length / 2;
          for (let s = 0; s < n; s += SR) {
            const e = Math.min(n, s + SR), m = e - s;
            const chunk = new Float32Array(m * 2);
            chunk.set(pcm.subarray(s, e), 0); chunk.set(pcm.subarray(n + s, n + e), m);
            tk.addAudio(chunk);
            while (tk.audioBusy()) await new Promise((r) => setTimeout(r, 10));
          }
        }
        R.status('Finishing the movie…');
        const blob = await tk.finish();
        const name = `CT17.A3.Cards_${stamp()}.mp4`;
        download(blob, name);
        R.status(`Saved ${name} (${tk.seconds.toFixed(1)} s, ${(blob.size / 1e6).toFixed(1)} MB) to your Downloads folder`);
        R.lastBlob = blob;
      } catch (e) {
        console.error(e);
        R.status('Recording failed: ' + (e && e.message || e));
      } finally { stopping = false; }
    },
    cancel() { if (take) { take.abort(); take = null; CT17.clock.thaw(); CT17.audio.stopLog(); } }
  };
  CT17.recorder = R;
})();
