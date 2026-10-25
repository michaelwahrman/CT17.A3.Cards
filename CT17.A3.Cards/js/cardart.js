// CT17 Cards - procedural card faces/backs drawn on canvas, using the
// prototype art (art/art.js -> window.CT17_ART) for A, J, Q, K.
// All drawing is done in a 600 x 1000 design space, scaled to TEX_W.
(function () {
  'use strict';
  const CT17 = (window.CT17 = window.CT17 || {});

  const DW = 600, DH = 1000;           // design space (card aspect 0.6)
  const TEX_W = 420, TEX_H = 700;      // texture resolution
  const RADIUS = 34;                    // corner radius (design units)
  const SUITS = ['spade', 'heart', 'diamond', 'club'];
  const RANKS = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const FONT = '"Palatino Linotype","Book Antiqua",Palatino,"URW Palladio L",Georgia,"Times New Roman",serif';

  const INK = {
    light: { red: '#b9382b', black: '#24201b' },   // on cream cards
    queen: { red: '#de5a41', black: '#efe2bd' },   // on dark navy
    ace: { red: '#d8573c', black: '#dcb66c' }      // on black/gold
  };
  const isRed = (s) => s === 1 || s === 2;

  // ---------- images ----------
  const images = {};
  CT17.loadArt = function () {
    const art = window.CT17_ART || {};
    const names = Object.keys(art);
    return Promise.all(names.map((n) => new Promise((res) => {
      const im = new Image();
      im.onload = () => { images[n] = im; res(); };
      im.onerror = () => res();
      im.src = art[n];
    })));
  };

  // ---------- helpers ----------
  function newCanvas() {
    const c = document.createElement('canvas');
    c.width = TEX_W; c.height = TEX_H;
    const g = c.getContext('2d');
    g.scale(TEX_W / DW, TEX_H / DH);
    return { c, g };
  }
  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }
  function clipCard(g) { roundRect(g, 0, 0, DW, DH, RADIUS); g.clip(); }

  // seeded random so the paper grain is stable
  function rng(seed) {
    let s = seed >>> 0 || 1;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  }

  // ---------- suit shapes (centered at 0,0, fits in a 1x1 box) ----------
  function suitPath(g, suit) {
    g.beginPath();
    switch (suit) {
      case 1: // heart
        g.moveTo(0, 0.5);
        g.bezierCurveTo(-0.16, 0.30, -0.5, 0.08, -0.5, -0.18);
        g.bezierCurveTo(-0.5, -0.42, -0.3, -0.5, -0.18, -0.5);
        g.bezierCurveTo(-0.06, -0.5, 0, -0.4, 0, -0.3);
        g.bezierCurveTo(0, -0.4, 0.06, -0.5, 0.18, -0.5);
        g.bezierCurveTo(0.3, -0.5, 0.5, -0.42, 0.5, -0.18);
        g.bezierCurveTo(0.5, 0.08, 0.16, 0.30, 0, 0.5);
        break;
      case 2: // diamond
        g.moveTo(0, -0.5);
        g.quadraticCurveTo(0.14, -0.2, 0.4, 0);
        g.quadraticCurveTo(0.14, 0.2, 0, 0.5);
        g.quadraticCurveTo(-0.14, 0.2, -0.4, 0);
        g.quadraticCurveTo(-0.14, -0.2, 0, -0.5);
        break;
      case 0: // spade
        g.moveTo(0, -0.5);
        g.bezierCurveTo(0.12, -0.3, 0.48, -0.12, 0.48, 0.12);
        g.bezierCurveTo(0.48, 0.32, 0.3, 0.4, 0.18, 0.38);
        g.bezierCurveTo(0.09, 0.37, 0.04, 0.32, 0.03, 0.27);
        g.quadraticCurveTo(0.06, 0.42, 0.2, 0.5);
        g.lineTo(-0.2, 0.5);
        g.quadraticCurveTo(-0.06, 0.42, -0.03, 0.27);
        g.bezierCurveTo(-0.04, 0.32, -0.09, 0.37, -0.18, 0.38);
        g.bezierCurveTo(-0.3, 0.4, -0.48, 0.32, -0.48, 0.12);
        g.bezierCurveTo(-0.48, -0.12, -0.12, -0.3, 0, -0.5);
        break;
      case 3: // club
        g.arc(0, -0.25, 0.22, 0, Math.PI * 2);
        g.moveTo(-0.03, 0.08);
        g.arc(-0.25, 0.08, 0.22, 0, Math.PI * 2);
        g.moveTo(0.47, 0.08);
        g.arc(0.25, 0.08, 0.22, 0, Math.PI * 2);
        g.moveTo(0.06, -0.05);
        g.lineTo(-0.06, -0.05);
        g.lineTo(-0.04, 0.3);
        g.quadraticCurveTo(-0.08, 0.44, -0.2, 0.5);
        g.lineTo(0.2, 0.5);
        g.quadraticCurveTo(0.08, 0.44, 0.04, 0.3);
        g.closePath();
        break;
    }
  }
  function drawSuit(g, suit, x, y, size, fill, opts) {
    opts = opts || {};
    g.save();
    g.translate(x, y);
    if (opts.flip) g.rotate(Math.PI);
    g.scale(size, size);
    suitPath(g, suit);
    if (opts.glow) { g.shadowColor = opts.glow; g.shadowBlur = 14 / 1; }
    g.fillStyle = fill;
    g.fill('nonzero');
    g.shadowBlur = 0;
    if (opts.stroke) { g.lineWidth = opts.strokeW || 0.02; g.strokeStyle = opts.stroke; g.stroke(); }
    g.restore();
  }

  // ---------- paper / frames ----------
  function paper(g, seed) {
    const gr = g.createRadialGradient(DW / 2, DH / 2, 80, DW / 2, DH / 2, 640);
    gr.addColorStop(0, '#f1e8d2');
    gr.addColorStop(1, '#ddcfae');
    g.fillStyle = gr;
    g.fillRect(0, 0, DW, DH);
    const r = rng(seed);
    for (let i = 0; i < 1400; i++) {
      const a = r() * 0.07;
      g.fillStyle = r() < 0.5 ? `rgba(90,60,30,${a})` : `rgba(255,255,255,${a * 1.4})`;
      const s = 1 + r() * 2.5;
      g.fillRect(r() * DW, r() * DH, s, s);
    }
    // a few foxing spots
    for (let i = 0; i < 6; i++) {
      const x = r() * DW, y = r() * DH, rad = 20 + r() * 60;
      const sp = g.createRadialGradient(x, y, 0, x, y, rad);
      sp.addColorStop(0, 'rgba(150,110,60,0.07)');
      sp.addColorStop(1, 'rgba(150,110,60,0)');
      g.fillStyle = sp;
      g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
  }
  function engraving(g, color) {
    // faint concentric circles + ticks (echo of the jack's background)
    g.save();
    g.strokeStyle = color;
    g.globalAlpha = 0.16;
    g.lineWidth = 1.5;
    for (const rr of [150, 190, 196, 250]) { g.beginPath(); g.arc(DW / 2, DH / 2, rr, 0, Math.PI * 2); g.stroke(); }
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * Math.PI * 2;
      g.beginPath();
      g.moveTo(DW / 2 + Math.cos(a) * 196, DH / 2 + Math.sin(a) * 196);
      g.lineTo(DW / 2 + Math.cos(a) * (i % 6 ? 210 : 232), DH / 2 + Math.sin(a) * (i % 6 ? 210 : 232));
      g.stroke();
    }
    g.restore();
  }
  function frame(g, color, inset) {
    g.save();
    g.strokeStyle = color;
    g.lineWidth = 2.5;
    roundRect(g, inset, inset, DW - inset * 2, DH - inset * 2, 10);
    g.stroke();
    g.lineWidth = 1.2;
    roundRect(g, inset + 8, inset + 8, DW - inset * 2 - 16, DH - inset * 2 - 16, 6);
    g.stroke();
    // corner rosettes
    g.fillStyle = color;
    for (const [x, y] of [[inset + 4, inset + 4], [DW - inset - 4, inset + 4], [inset + 4, DH - inset - 4], [DW - inset - 4, DH - inset - 4]]) {
      g.beginPath(); g.arc(x, y, 6, 0, Math.PI * 2); g.fill();
    }
    g.restore();
  }
  function edge(g) {
    g.save();
    roundRect(g, 1.5, 1.5, DW - 3, DH - 3, RADIUS);
    g.lineWidth = 3;
    g.strokeStyle = 'rgba(60,40,20,0.45)';
    g.stroke();
    g.restore();
  }

  // ---------- corner index ----------
  function index(g, rank, suit, ink, opts) {
    opts = opts || {};
    const col = isRed(suit) ? ink.red : ink.black;
    const draw = () => {
      const label = RANKS[rank];
      g.save();
      g.fillStyle = col;
      g.textAlign = 'center';
      g.textBaseline = 'alphabetic';
      g.font = `bold 124px ${FONT}`;
      const cx = 60, base = 140;
      if (label === '10') { g.translate(cx, base); g.scale(0.62, 1); g.fillText('10', 0, 0); }
      else { g.translate(cx, base); g.scale(0.85, 1); g.fillText(label, 0, 0); }
      g.restore();
      drawSuit(g, suit, 60, 196, 66, col);
      if (opts.bigPip) drawSuit(g, suit, 168, 168, 122, col);
    };
    if (opts.outline) {
      g.save(); g.shadowColor = opts.outline; g.shadowBlur = 10; draw(); g.restore();
    }
    draw();
    g.save(); g.translate(DW, DH); g.rotate(Math.PI);
    if (opts.outline) { g.save(); g.shadowColor = opts.outline; g.shadowBlur = 10; draw(); g.restore(); }
    draw();
    g.restore();
  }

  // ---------- pip layouts ----------
  // columns: L, C, R ; rows 0..1 inside pip box
  const L = 0, C = 1, R = 2;
  const PIPS = {
    2: [[C, 0], [C, 1]],
    3: [[C, 0], [C, 0.5], [C, 1]],
    4: [[L, 0], [R, 0], [L, 1], [R, 1]],
    5: [[L, 0], [R, 0], [C, 0.5], [L, 1], [R, 1]],
    6: [[L, 0], [R, 0], [L, 0.5], [R, 0.5], [L, 1], [R, 1]],
    7: [[L, 0], [R, 0], [C, 0.25], [L, 0.5], [R, 0.5], [L, 1], [R, 1]],
    8: [[L, 0], [R, 0], [C, 0.25], [L, 0.5], [R, 0.5], [C, 0.75], [L, 1], [R, 1]],
    9: [[L, 0], [R, 0], [L, 1 / 3], [R, 1 / 3], [C, 0.5], [L, 2 / 3], [R, 2 / 3], [L, 1], [R, 1]],
    10: [[L, 0], [R, 0], [C, 1 / 6], [L, 1 / 3], [R, 1 / 3], [L, 2 / 3], [R, 2 / 3], [C, 5 / 6], [L, 1], [R, 1]]
  };
  function pipCard(g, rank, suit) {
    paper(g, rank * 31 + suit * 7 + 3);
    engraving(g, '#6b4a2a');
    frame(g, 'rgba(120,85,45,0.55)', 26);
    const ink = INK.light;
    const col = isRed(suit) ? ink.red : ink.black;
    const xs = [196, 300, 404], y0 = 230, y1 = 770;
    const size = rank >= 9 ? 100 : 108;
    for (const [c, r] of PIPS[rank]) {
      const y = y0 + (y1 - y0) * r;
      drawSuit(g, suit, xs[c], y, size, col, { flip: r > 0.5 + 1e-6 });
    }
    index(g, rank, suit, ink);
  }

  // ---------- aces ----------
  function rays(g, cx, cy, color) {
    g.save();
    g.strokeStyle = color;
    for (let i = 0; i < 120; i++) {
      const a = (i / 120) * Math.PI * 2;
      const long = i % 4 === 0, mid = i % 2 === 0;
      const r0 = 150, r1 = long ? 272 : mid ? 240 : 210;
      g.globalAlpha = long ? 0.85 : 0.5;
      g.lineWidth = long ? 2.2 : 1.2;
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0 * 1.12);
      g.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1 * 1.12);
      g.stroke();
    }
    g.restore();
  }
  function goldGradient(g, x0, y0, x1, y1, red) {
    const gr = g.createLinearGradient(x0, y0, x1, y1);
    if (red) {
      gr.addColorStop(0, '#f08a62'); gr.addColorStop(0.45, '#b8321f'); gr.addColorStop(1, '#5e140c');
    } else {
      gr.addColorStop(0, '#fbe7a8'); gr.addColorStop(0.45, '#c8a05a'); gr.addColorStop(1, '#6b4c22');
    }
    return gr;
  }
  function aceCard(g, suit) {
    const ink = INK.ace;
    if (suit === 0 && images.ace_spade) {
      g.drawImage(images.ace_spade, 0, 0, DW, DH);
    } else {
      if (images.ace_blank) g.drawImage(images.ace_blank, 0, 0, DW, DH);
      else { g.fillStyle = '#0b0a08'; g.fillRect(0, 0, DW, DH); }
      const cx = 300, cy = 490, S = 360;
      rays(g, cx, cy, '#cfa760');
      // dark halo so rays fade into the glyph
      const halo = g.createRadialGradient(cx, cy, 60, cx, cy, 190);
      halo.addColorStop(0, 'rgba(8,7,6,0.9)'); halo.addColorStop(1, 'rgba(8,7,6,0)');
      g.fillStyle = halo; g.fillRect(cx - 200, cy - 220, 400, 440);
      // glyph body
      drawSuit(g, suit, cx, cy, S, goldGradient(g, -0.4, -0.5, 0.4, 0.5, isRed(suit)), { glow: 'rgba(230,190,110,0.55)' });
      // engraved hatching inside the glyph
      g.save(); g.translate(cx, cy); g.scale(S, S); suitPath(g, suit); g.clip();
      g.strokeStyle = 'rgba(40,22,6,0.22)'; g.lineWidth = 0.003;
      for (let k = -0.6; k < 0.6; k += 0.018) { g.beginPath(); g.moveTo(k, -0.6); g.lineTo(k + 0.5, 0.6); g.stroke(); }
      const sheen = g.createRadialGradient(-0.12, -0.22, 0.02, -0.12, -0.22, 0.5);
      sheen.addColorStop(0, 'rgba(255,250,225,0.45)'); sheen.addColorStop(1, 'rgba(255,250,225,0)');
      g.fillStyle = sheen; g.fillRect(-0.6, -0.6, 1.2, 1.2);
      g.restore();
      drawSuit(g, suit, cx, cy, S * 0.9, 'rgba(0,0,0,0)', { stroke: isRed(suit) ? '#f6c79a' : '#fff1c4', strokeW: 0.006 });
      drawSuit(g, suit, cx, cy, S * 0.82, 'rgba(0,0,0,0)', { stroke: 'rgba(40,20,5,0.6)', strokeW: 0.004 });
      // filigree inside: concentric suit outlines
      for (let k = 0.72; k > 0.4; k -= 0.08) drawSuit(g, suit, cx, cy, S * k, 'rgba(0,0,0,0)', { stroke: 'rgba(255,235,180,0.18)', strokeW: 0.004 });
      // the eye
      if (images.eye) {
        const ew = suit === 2 ? 170 : suit === 3 ? 180 : 210, eh = ew * (images.eye.height / images.eye.width);
        const ey = suit === 1 ? cy - 30 : suit === 3 ? cy - 4 : cy;
        g.drawImage(images.eye, cx - ew / 2, ey - eh / 2, ew, eh);
      }
    }
    index(g, 1, suit, ink, { outline: 'rgba(0,0,0,0.9)' });
  }

  // ---------- court cards ----------
  function courtCard(g, rank, suit) {
    const key = rank === 11 ? 'jack' : rank === 12 ? 'queen' : 'king';
    if (images[key]) g.drawImage(images[key], 0, 0, DW, DH);
    else { paper(g, rank); }
    if (rank === 12) index(g, rank, suit, INK.queen, { outline: 'rgba(5,10,20,0.95)' });
    else index(g, rank, suit, INK.light, { bigPip: true, outline: 'rgba(240,230,205,0.9)' });
  }

  // ---------- public: faces / back / placeholders ----------
  CT17.drawFace = function (rank, suit) {
    const { c, g } = newCanvas();
    g.save();
    clipCard(g);
    if (rank === 1) aceCard(g, suit);
    else if (rank >= 11) courtCard(g, rank, suit);
    else pipCard(g, rank, suit);
    g.restore();
    edge(g);
    return c;
  };

  CT17.drawBack = function () {
    const { c, g } = newCanvas();
    g.save();
    clipCard(g);
    const bg = g.createRadialGradient(DW / 2, DH / 2, 50, DW / 2, DH / 2, 620);
    bg.addColorStop(0, '#1d2433'); bg.addColorStop(1, '#07080c');
    g.fillStyle = bg; g.fillRect(0, 0, DW, DH);
    const r = rng(77);
    for (let i = 0; i < 500; i++) {
      g.fillStyle = `rgba(230,200,140,${r() * 0.5})`;
      const s = r() * 2.2; g.fillRect(r() * DW, r() * DH, s, s);
    }
    // lattice
    g.save();
    g.strokeStyle = 'rgba(207,167,96,0.22)'; g.lineWidth = 1.2;
    for (let k = -DH; k < DW + DH; k += 38) {
      g.beginPath(); g.moveTo(k, 0); g.lineTo(k - DH * 0.6, DH); g.stroke();
      g.beginPath(); g.moveTo(k - DH * 0.6, 0); g.lineTo(k, DH); g.stroke();
    }
    g.restore();
    // center medallion
    const cx = DW / 2, cy = DH / 2;
    const md = g.createRadialGradient(cx, cy, 20, cx, cy, 230);
    md.addColorStop(0, 'rgba(10,10,14,1)'); md.addColorStop(0.8, 'rgba(10,10,14,0.95)'); md.addColorStop(1, 'rgba(10,10,14,0)');
    g.fillStyle = md; g.beginPath(); g.ellipse(cx, cy, 230, 300, 0, 0, Math.PI * 2); g.fill();
    rays(g, cx, cy, '#cfa760');
    g.save();
    g.strokeStyle = '#d9b46a'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(cx, cy - 190); g.lineTo(cx + 130, cy); g.lineTo(cx, cy + 190); g.lineTo(cx - 130, cy); g.closePath(); g.stroke();
    g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(cx, cy - 172); g.lineTo(cx + 116, cy); g.lineTo(cx, cy + 172); g.lineTo(cx - 116, cy); g.closePath(); g.stroke();
    g.fillStyle = '#0b0b0f';
    g.beginPath(); g.moveTo(cx, cy - 168); g.lineTo(cx + 112, cy); g.lineTo(cx, cy + 168); g.lineTo(cx - 112, cy); g.closePath(); g.fill();
    g.restore();
    if (images.eye) {
      const ew = 200, eh = ew * images.eye.height / images.eye.width;
      g.drawImage(images.eye, cx - ew / 2, cy - eh / 2, ew, eh);
    }
    // four small suit glyphs
    const gold = '#d9b46a';
    drawSuit(g, 0, cx, cy - 250, 44, gold);
    drawSuit(g, 1, cx + 170, cy, 40, gold);
    drawSuit(g, 2, cx, cy + 250, 44, gold);
    drawSuit(g, 3, cx - 170, cy, 40, gold);
    frame(g, '#c9a45e', 24);
    g.restore();
    edge(g);
    return c;
  };

  // empty-pile placeholder; kind: 'stock' | 'stock-empty' | 'foundation' | 'tableau'
  CT17.drawSlot = function (kind) {
    const { c, g } = newCanvas();
    g.save();
    roundRect(g, 6, 6, DW - 12, DH - 12, RADIUS);
    g.fillStyle = 'rgba(0,0,0,0.18)'; g.fill();
    g.lineWidth = 6; g.strokeStyle = 'rgba(235,220,170,0.38)';
    g.setLineDash([22, 14]); g.stroke(); g.setLineDash([]);
    g.fillStyle = 'rgba(235,220,170,0.38)';
    g.strokeStyle = 'rgba(235,220,170,0.38)';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    if (kind === 'foundation') {
      g.font = `bold 230px ${FONT}`; g.fillText('A', DW / 2, DH / 2 + 10);
    } else if (kind === 'stock') {
      // recycle arrow
      g.lineWidth = 26; g.beginPath(); g.arc(DW / 2, DH / 2, 130, -Math.PI * 0.35, Math.PI * 1.45); g.stroke();
      const a = -Math.PI * 0.35, x = DW / 2 + Math.cos(a) * 130, y = DH / 2 + Math.sin(a) * 130;
      g.beginPath(); g.moveTo(x - 50, y - 40); g.lineTo(x + 45, y - 10); g.lineTo(x - 10, y + 70); g.closePath(); g.fill();
    } else if (kind === 'stock-empty') {
      g.lineWidth = 26;
      g.beginPath(); g.moveTo(DW / 2 - 110, DH / 2 - 110); g.lineTo(DW / 2 + 110, DH / 2 + 110);
      g.moveTo(DW / 2 + 110, DH / 2 - 110); g.lineTo(DW / 2 - 110, DH / 2 + 110); g.stroke();
    } else if (kind === 'tableau') {
      g.font = `bold 200px ${FONT}`; g.fillText('K', DW / 2, DH / 2 + 10);
    } else if (kind === 'freecell') {
      // A3: FreeCell free cell - an open diamond with a small "free" label
      g.lineWidth = 18; g.beginPath();
      g.moveTo(DW / 2, DH / 2 - 150); g.lineTo(DW / 2 + 110, DH / 2); g.lineTo(DW / 2, DH / 2 + 150); g.lineTo(DW / 2 - 110, DH / 2);
      g.closePath(); g.stroke();
      g.font = `italic 64px ${FONT}`; g.fillText('free', DW / 2, DH / 2 + 250);
    }
    // 'tableau-any' (FreeCell empty column): outline only - any card may go there
    g.restore();
    return c;
  };

  CT17.drawShadow = function () {
    const c = document.createElement('canvas');
    c.width = 192; c.height = 288;
    const g = c.getContext('2d');
    g.filter = 'blur(12px)';
    g.fillStyle = '#000';
    roundRect(g, 36, 36, 120, 216, 14);
    g.fill();
    return c;
  };

  CT17.CARD = { DW, DH, ASPECT: DW / DH, SUITS, RANKS, isRed };
})();
