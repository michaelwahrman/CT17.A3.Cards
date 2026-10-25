// CT17 Cards - synthesized card sounds (WebAudio, no sample files needed)
// A3: every sound is written against an "env" {ctx, master, noiseBuf}, so the SAME synth plays the speakers live and
// is re-rendered into the movie afterwards (OfflineAudioContext), locked to the picture.  While recording, each sound
// is logged with its movie time (CT17.clock).
(function () {
  'use strict';
  const CT17 = (window.CT17 = window.CT17 || {});

  let live = null;                 // env for the speakers
  let enabled = true, volume = 0.8;
  let lastSnap = 0;
  let log = null, logT0 = 0;       // recording log: [{t (s, movie time), name, args}]

  function makeEnv(ctx) {
    const master = ctx.createGain();
    master.gain.value = volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    master.connect(comp); comp.connect(ctx.destination);
    const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 1.0, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return { ctx, master, noiseBuf };
  }
  function init() {
    if (live) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    live = makeEnv(new AC({ sampleRate: 48000 }));
  }
  function ready() {
    if (!enabled) return false;
    init();
    if (!live) return false;
    if (live.ctx.state === 'suspended') live.ctx.resume();
    return true;
  }

  // filtered noise burst
  function noise(E, t, dur, type, freq, q, gain, attack) {
    const ctx = E.ctx;
    const src = ctx.createBufferSource();
    src.buffer = E.noiseBuf;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + (attack || 0.002));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(E.master);
    src.start(t, Math.random() * 0.5, dur + 0.05);
    return f;
  }
  function tone(E, t, freq, dur, gain, type) {
    const ctx = E.ctx;
    const o = ctx.createOscillator();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(E.master);
    o.start(t); o.stop(t + dur + 0.05);
    return o;
  }

  // the sounds themselves: (env, start time, ...args)
  const SOUNDS = {
    // card landing on felt / on another card
    snap(E, t, strength) {
      const s = strength == null ? 1 : strength;
      noise(E, t, 0.05 + Math.random() * 0.02, 'bandpass', 2600 + Math.random() * 1600, 1.2, 0.55 * s);
      noise(E, t, 0.09, 'lowpass', 700, 0.7, 0.35 * s);
      tone(E, t, 120 + Math.random() * 30, 0.06, 0.12 * s);
    },
    // card sliding across the felt
    slide(E, t, dur) {
      const d = Math.max(0.08, Math.min(dur || 0.18, 0.35));
      const f = noise(E, t, d, 'bandpass', 1800, 0.6, 0.16, d * 0.35);
      f.frequency.setValueAtTime(1200, t);
      f.frequency.linearRampToValueAtTime(3600, t + d);
    },
    // card being turned over
    flip(E, t) {
      noise(E, t, 0.035, 'highpass', 3000, 0.8, 0.3);
      noise(E, t + 0.05, 0.04, 'bandpass', 2200, 1.5, 0.35);
    },
    // riffle shuffle before a deal
    shuffle(E, t) {
      const t0 = t + 0.01, n = 34;
      for (let i = 0; i < n; i++) {
        const ti = t0 + i * 0.022 + Math.random() * 0.006;
        noise(E, ti, 0.022, 'bandpass', 3000 + Math.random() * 2500, 2, 0.22 + 0.15 * Math.sin(i / n * Math.PI));
      }
      noise(E, t0 + n * 0.022 + 0.08, 0.35, 'bandpass', 1500, 0.5, 0.25, 0.12);
      noise(E, t0 + n * 0.022 + 0.45, 0.07, 'lowpass', 600, 0.7, 0.5);
    },
    // illegal move
    nope(E, t) {
      tone(E, t, 150, 0.12, 0.18, 'triangle');
      tone(E, t + 0.07, 110, 0.16, 0.16, 'triangle');
    },
    // card reaches a foundation
    chime(E, t, n) {
      const base = 523.25 * Math.pow(2, ((n || 0) % 13) / 24);
      tone(E, t + 0.03, base, 0.4, 0.07);
      tone(E, t + 0.03, base * 2, 0.25, 0.03);
    },
    win(E, t) {
      const notes = [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5, 1318.5];
      notes.forEach((f, i) => { tone(E, t + 0.05 + i * 0.13, f, 0.5, 0.12, 'triangle'); tone(E, t + 0.05 + i * 0.13, f / 2, 0.5, 0.05); });
    },
    // A3: record start / stop blip (not put in the movie)
    rec(E, t, on) { tone(E, t, on ? 880 : 440, 0.12, 0.08); tone(E, t + 0.1, on ? 1320 : 330, 0.14, 0.07); }
  };

  function play(name, ...args) {
    if (!ready()) return;
    if (name === 'snap') {                        // de-duplicate stack landings
      const now = live.ctx.currentTime;
      if (now - lastSnap < 0.018) return;
      lastSnap = now;
    }
    SOUNDS[name](live, live.ctx.currentTime + 0.001, ...args);
    if (log && name !== 'rec') log.push({ t: (CT17.clock.now() - logT0) / 1000, name, args });
  }

  const A = {
    unlock() { if (ready()) tone(live, live.ctx.currentTime, 40, 0.01, 0.0002); },
    setEnabled(v) { enabled = v; if (!v && live) live.ctx.suspend(); else if (v && live) live.ctx.resume(); },
    isEnabled() { return enabled; },
    setVolume(v) { volume = v; if (live) live.master.gain.value = v; },
    snap: (s) => play('snap', s),
    slide: (d) => play('slide', d),
    flip: () => play('flip'),
    shuffle: () => play('shuffle'),
    nope: () => play('nope'),
    chime: (n) => play('chime', n),
    win: () => play('win'),
    recBlip: (on) => play('rec', on),

    // ---- A3: movie sound ----
    /** start logging sounds; t0 = movie start (CT17.clock ms) */
    startLog(t0) { log = []; logT0 = t0; },
    stopLog() { const l = log; log = null; return l || []; },
    /** render a log with the same synth: returns planar stereo Float32Array [L..., R...] of exactly `frames` samples */
    async render(events, seconds, SR) {
      const frames = Math.max(1, Math.round(seconds * SR));
      const off = new OfflineAudioContext(2, frames, SR);
      const E = makeEnv(off);
      E.master.gain.value = volume;
      for (const ev of events) if (ev.t < seconds) SOUNDS[ev.name](E, Math.max(0, ev.t) + 0.001, ...ev.args);
      const buf = await off.startRendering();
      const out = new Float32Array(frames * 2);
      out.set(buf.getChannelData(0), 0);
      out.set(buf.numberOfChannels > 1 ? buf.getChannelData(1) : buf.getChannelData(0), frames);
      return out;
    }
  };
  CT17.audio = A;
})();
