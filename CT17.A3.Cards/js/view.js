// CT17 Cards - three.js table view: card meshes, layout, tweening, shadows, picking, dragging.
// A3: any column count (Klondike 7, FreeCell 8), setGame() to swap games on the same cards, all timing on CT17.clock,
// and a hook so the recorder can take exactly one movie frame per drawn frame.
(function () {
  'use strict';
  const CT17 = (window.CT17 = window.CT17 || {});
  const T = window.THREE;

  const CW = 1, CH = 1 / 0.6;          // card size (world units)
  const SPX = 1.22;                    // column spacing
  const ROW_GAP = 0.34;                // gap between top row and tableau
  const FAN_DOWN = 0.2, FAN_UP = 0.42; // tableau fan steps
  const WASTE_FAN = 0.34;
  const Z0 = 0.004, DZ = 0.006;        // stack thickness
  const DRAG_Z = 0.7;
  const TILT = 0.13;                   // camera tilt (radians)
  const FOV = 32;

  const easeInOut = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
  const easeOut = (u) => 1 - Math.pow(1 - u, 3);
  const lerp = (a, b, u) => a + (b - a) * u;

  class TableView {
    constructor(container, game, handlers) {
      this.container = container;
      this.slots = {};
      this.game = game;
      this.h = handlers || {};
      this.renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: false });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      this.renderer.outputColorSpace = T.SRGBColorSpace;
      container.appendChild(this.renderer.domElement);
      this.scene = new T.Scene();
      this.scene.background = new T.Color('#0a1d14');
      this.camera = new T.PerspectiveCamera(FOV, 1, 0.1, 200);
      this.raycaster = new T.Raycaster();
      this.maxAniso = this.renderer.capabilities.getMaxAnisotropy();
      this.buildTable();
      this.buildCards();
      this.buildSlots();
      this.anims = new Map();      // cardId -> anim
      this.timers = [];
      this.drag = null;
      this.fx = null;              // win cascade
      this.bindInput();
      this.resize();
      window.addEventListener('resize', () => this.resize());
      this.clock = CT17.clock.now();
      const loop = () => {
        requestAnimationFrame(loop);
        const R = CT17.recorder;
        if (R && R.active) {
          // recording: one movie frame per drawn frame, the clock moving exactly 1/fps each time
          if (!R.wantFrame()) return;
          CT17.clock.step(1000 / R.fps);
          this.tick();
          R.capture(this);
        } else this.tick();
      };
      requestAnimationFrame(loop);
    }

    // ---------- scene building ----------
    tex(canvas) {
      const t = new T.CanvasTexture(canvas);
      t.colorSpace = T.SRGBColorSpace;
      t.anisotropy = this.maxAniso;
      t.generateMipmaps = true;
      t.minFilter = T.LinearMipmapLinearFilter;
      return t;
    }
    buildTable() {
      const N = 1024;
      const c = document.createElement('canvas');
      c.width = c.height = N;
      const g = c.getContext('2d');
      const gr = g.createRadialGradient(N / 2, N * 0.46, N * 0.05, N / 2, N / 2, N * 0.72);
      gr.addColorStop(0, '#22603f'); gr.addColorStop(0.5, '#174a32'); gr.addColorStop(1, '#06170e');
      g.fillStyle = gr; g.fillRect(0, 0, N, N);
      // fine felt fibres
      const img = g.getImageData(0, 0, N, N), d = img.data;
      for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - 0.5) * 7; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
      g.putImageData(img, 0, 0);
      const t = this.tex(c);
      this.table = new T.Mesh(new T.PlaneGeometry(22, 22), new T.MeshBasicMaterial({ map: t }));
      this.table.position.set(0, -3, -0.002);
      this.scene.add(this.table);
    }
    buildCards() {
      const geo = new T.PlaneGeometry(CW, CH);
      const backTex = this.tex(CT17.drawBack());
      const backMat = new T.MeshBasicMaterial({ map: backTex, alphaTest: 0.5 });
      const shTex = this.tex(CT17.drawShadow());
      const shGeo = new T.PlaneGeometry(CW * 1.6, CH * (288 / 216));
      this.meshes = [];
      for (const c of this.game.cards) {
        const grp = new T.Group();
        const front = new T.Mesh(geo, new T.MeshBasicMaterial({ map: this.tex(CT17.drawFace(c.rank, c.suit)), alphaTest: 0.5 }));
        const back = new T.Mesh(geo, backMat);
        back.rotation.y = Math.PI;
        back.position.z = -0.0004;
        front.userData.cardId = back.userData.cardId = c.id;
        grp.add(front, back);
        const sh = new T.Mesh(shGeo, new T.MeshBasicMaterial({ map: shTex, transparent: true, opacity: 0.42, depthWrite: false }));
        this.scene.add(grp, sh);
        const m = { grp, front, back, sh, cur: { x: 0, y: 0, z: 0, f: 0, rz: 0 }, rest: { x: 0, y: 0, z: 0, f: 0, rz: 0 }, lift: 0, showShadow: true };
        this.meshes[c.id] = m;
      }
      this.pickables = this.meshes.flatMap((m) => [m.front, m.back]);
    }
    buildSlots() {
      const geo = new T.PlaneGeometry(CW, CH);
      const mk = (kind) => new T.MeshBasicMaterial({ map: this.tex(CT17.drawSlot(kind)), transparent: true, depthWrite: false });
      this.slotGeo = geo;
      this.slotMats = { stock: mk('stock'), 'stock-empty': mk('stock-empty'), foundation: mk('foundation'), tableau: mk('tableau'), waste: mk('waste'),
        freecell: mk('freecell'), 'tableau-any': mk('tableau-any') };
      this.makeSlots();
    }
    makeSlots() {
      for (const k in this.slots) this.scene.remove(this.slots[k]);
      this.slots = {};
      for (const s of this.game.pileSpecs) {
        if (s.hidden) continue;
        const m = new T.Mesh(this.slotGeo, this.slotMats[s.kind] || this.slotMats.waste);
        m.userData.pileId = s.id;
        m.position.z = 0.0005;
        this.scene.add(m);
        this.slots[s.id] = m;
      }
      this.slotPickables = Object.values(this.slots);
    }

    /** A3: switch to another game using the same 52 card meshes */
    setGame(game, noSync) {
      this.game = game;
      this.makeSlots();
      this.resize(noSync);
    }

    // ---------- layout ----------
    pileOrigin(spec) {
      const mid = (this.game.columns - 1) / 2;
      return { x: (spec.col - mid) * SPX, y: spec.row === 0 ? 0 : -(CH + ROW_GAP) };
    }
    resize(noSync) {
      const w = this.container.clientWidth, h = this.container.clientHeight;
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      // content box: 7 columns wide; height = top row + tableau with ~12 fanned cards
      const contentW = this.game.columns * SPX + 0.35;
      const top = CH / 2 + 0.22;
      const bottom = -(CH + ROW_GAP) - CH / 2 - 3.4;
      const contentH = top - bottom;
      const tanH = Math.tan((FOV * Math.PI) / 360);
      const distH = contentH / 2 / tanH;
      const distW = contentW / 2 / (tanH * this.camera.aspect);
      const D = Math.max(distH, distW) * 1.04;
      // when width-bound (portrait), pin the top row to the top of the view
      const cy = distW > distH ? top - D * tanH * 0.98 : (top + bottom) / 2;
      this.camera.position.set(0, cy - D * Math.sin(TILT), D * Math.cos(TILT));
      this.camera.lookAt(0, cy, 0);
      this.camera.updateProjectionMatrix();
      this.camera.updateMatrixWorld();
      // visible bottom on the table plane
      const p = this.ndcToPlane(0, -1, 0);
      this.visBottom = p ? p.y : bottom;
      const pt = this.ndcToPlane(0, 1, 0);
      this.visTop = pt ? pt.y : top;
      const pr = this.ndcToPlane(1, 0, 0);
      this.visRight = pr ? pr.x : contentW / 2;
      for (const s of this.game.pileSpecs) {
        if (!this.slots[s.id]) continue;
        const o = this.pileOrigin(s);
        this.slots[s.id].position.set(o.x, o.y, 0.0005);
      }
      if (!noSync && this.game.state.piles[this.game.deckPile]) { if (this.isAnimating() || this.drag) this.needResync = true; else this.sync({ instant: true }); }
    }
    ndcToPlane(nx, ny, z) {
      this.raycaster.setFromCamera(new T.Vector2(nx, ny), this.camera);
      const out = new T.Vector3();
      return this.raycaster.ray.intersectPlane(new T.Plane(new T.Vector3(0, 0, 1), -z), out) ? out : null;
    }

    // jitter that is stable for a card in a given spot
    jitter(id, pileId, i) {
      let h = (id * 2654435761 + pileId.charCodeAt(0) * 97 + pileId.charCodeAt(pileId.length - 1) * 13 + i * 31) >>> 0;
      h ^= h >>> 13; h = Math.imul(h, 1274126177) >>> 0;
      return ((h % 1000) / 1000 - 0.5);
    }

    // target transform for every card from the game state
    targets() {
      const out = [];
      const g = this.game;
      for (const s of g.pileSpecs) {
        const p = g.state.piles[s.id];
        const o = this.pileOrigin(s);
        if (s.fan === 'down') {
          let nDown = 0; for (const c of p) if (!c.up) nDown++;
          const nUp = p.length - nDown;
          const avail = o.y - CH / 2 - (this.visBottom + 0.12) - CH / 2 - (0);
          const need = nDown * FAN_DOWN + Math.max(0, nUp - 1) * FAN_UP;
          const k = need > avail && need > 0 ? Math.max(0.25, avail / need) : 1;
          let y = o.y;
          p.forEach((c, i) => {
            out.push({ id: c.id, pile: s.id, i, n: p.length, x: o.x + this.jitter(c.id, s.id, i) * 0.03, y, z: Z0 + i * DZ, f: c.up ? 1 : 0, rz: this.jitter(c.id, s.id, i + 7) * 0.02 });
            y -= (c.up ? FAN_UP : FAN_DOWN) * k;
          });
        } else if (s.fan === 'waste') {
          const show = g.drawCount === 3 ? 3 : 1;
          const first = Math.max(0, p.length - show);
          p.forEach((c, i) => {
            const k = Math.max(0, i - first);
            out.push({ id: c.id, pile: s.id, i, n: p.length, x: o.x + k * WASTE_FAN, y: o.y, z: Z0 + i * DZ, f: c.up ? 1 : 0, rz: this.jitter(c.id, s.id, i) * 0.03, stacked: i < p.length - 3 });
          });
        } else {
          p.forEach((c, i) => {
            out.push({ id: c.id, pile: s.id, i, n: p.length, x: o.x + this.jitter(c.id, s.id, i) * 0.02, y: o.y + this.jitter(c.id, s.id, i + 3) * 0.02, z: Z0 + i * DZ, f: c.up ? 1 : 0, rz: this.jitter(c.id, s.id, i + 5) * 0.035, stacked: i < p.length - 2 });
          });
        }
      }
      return out;
    }

    // Move every card toward its target.  opts: instant, order (array of ids for staggering),
    // stagger (s), delay (s), dur (s), onLand(id), skip (Set of ids not to animate: currently dragged)
    sync(opts) {
      opts = opts || {};
      const now = CT17.clock.now() / 1000;
      const orderIdx = new Map();
      if (opts.order) opts.order.forEach((id, k) => orderIdx.set(id, k));
      let landedAny = false;
      this.updateSlots();
      for (const t of this.targets()) {
        const m = this.meshes[t.id];
        m.showShadow = !t.stacked;
        const cu = m.cur;
        m.rest = { x: t.x, y: t.y, z: t.z, f: t.f, rz: t.rz };
        if (opts.instant) { this.anims.delete(t.id); m.cur = Object.assign({}, m.rest); m.lift = 0; continue; }
        const atRest = Math.abs(cu.x - t.x) < 1e-4 && Math.abs(cu.y - t.y) < 1e-4 && Math.abs(cu.z - t.z) < 1e-4 && cu.f === t.f;
        if (atRest && !this.anims.has(t.id)) { cu.rz = t.rz; continue; }
        if (this.drag && this.drag.started && this.drag.ids.includes(t.id)) continue;
        const from = Object.assign({}, m.cur);
        const dist = Math.hypot(t.x - from.x, t.y - from.y);
        const k = orderIdx.has(t.id) ? orderIdx.get(t.id) : 0;
        const delay = opts.delays && opts.delays.has(t.id) ? opts.delays.get(t.id) : (opts.delay || 0) + (opts.order ? k * (opts.stagger || 0.05) : 0);
        const dur = opts.dur || Math.min(0.42, 0.16 + dist * 0.045);
        const arc = dist > 0.2 ? Math.min(0.5, 0.12 + dist * 0.04) : 0;
        const flipping = from.f !== t.f;
        this.anims.set(t.id, { t0: now + delay, dur, from, arc, flipping, onLand: opts.onLand, onStart: opts.onStart, started: false, dist });
        landedAny = true;
      }
      return landedAny;
    }
    isAnimating() { return this.anims.size > 0 || !!this.fx; }

    updateSlots() {
      const g = this.game;
      if (!g.hasStock || !g.state.piles.stock) return;
      this.slots.stock.material = g.pile('waste').length && g.recyclesLeft() > 0 ? this.slotMats.stock : this.slotMats['stock-empty'];
    }

    // ---------- per-frame ----------
    tick() {
      CT17.clock.runDue();
      const nowMs = CT17.clock.now();
      const now = nowMs / 1000;
      const dt = Math.max(0, Math.min(0.05, (nowMs - this.clock) / 1000));
      this.clock = nowMs;
      for (const [id, a] of this.anims) {
        const m = this.meshes[id];
        if (now < a.t0) continue;
        if (!a.started) { a.started = true; if (a.onStart) a.onStart(id, a); }
        let u = Math.min(1, (now - a.t0) / a.dur);
        const e = easeInOut(u);
        const r = m.rest, f = a.from;
        m.cur.x = lerp(f.x, r.x, e);
        m.cur.y = lerp(f.y, r.y, e);
        m.cur.rz = lerp(f.rz, r.rz, e);
        const fe = a.flipping ? easeOut(Math.min(1, u * 1.15)) : 1;
        m.cur.f = a.flipping ? lerp(f.f, r.f, fe) : r.f;
        const flipLift = a.flipping ? Math.sin(Math.PI * Math.min(1, u * 1.15)) * 0.55 : 0;
        m.cur.z = lerp(f.z, r.z, e) + Math.sin(Math.PI * u) * a.arc + flipLift + (u < 1 ? 0.25 * Math.sin(Math.PI * u) : 0);
        m.lift = Math.max(0, m.cur.z - r.z);
        if (u >= 1) {
          m.cur = Object.assign({}, r); m.lift = 0;
          this.anims.delete(id);
          if (a.onLand) a.onLand(id, a);
        }
      }
      if (this.drag) this.updateDrag();
      if (this.needResync && !this.anims.size && !this.fx && !this.drag) { this.needResync = false; this.sync({}); }
      if (this.fx) this.tickFx(dt);
      for (const m of this.meshes) this.apply(m);
      this.renderer.render(this.scene, this.camera);
    }
    apply(m) {
      const c = m.cur;
      m.grp.position.set(c.x, c.y, c.z);
      m.grp.rotation.set(0, (1 - c.f) * Math.PI, c.rz);
      const L = Math.min(1.2, m.lift);
      const vis = m.showShadow || L > 0.01;
      m.sh.visible = vis && !m.hidden;
      if (vis) {
        m.sh.position.set(c.x + 0.04 + 0.32 * L, c.y - 0.06 - 0.32 * L, L > 0.01 ? Math.min(c.z - 0.003, 0.34) : c.z - 0.003);
        m.sh.rotation.z = c.rz;
        const sx = Math.abs(Math.cos((1 - c.f) * Math.PI));
        m.sh.scale.set(Math.max(0.05, sx) * (1 + 0.12 * L), 1 + 0.12 * L, 1);
        m.sh.material.opacity = 0.42 - 0.14 * L;
      }
      m.grp.visible = !m.hidden;
    }

    // ---------- input ----------
    bindInput() {
      const el = this.renderer.domElement;
      el.style.touchAction = 'none';
      el.addEventListener('pointerdown', (e) => this.onDown(e));
      window.addEventListener('pointermove', (e) => this.onMove(e));
      window.addEventListener('pointerup', (e) => this.onUp(e));
      el.addEventListener('contextmenu', (e) => e.preventDefault());
      this.lastClick = { t: 0, id: -1 };
    }
    ndc(e) {
      const r = this.renderer.domElement.getBoundingClientRect();
      return new T.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    }
    pick(e) {
      this.raycaster.setFromCamera(this.ndc(e), this.camera);
      const hits = this.raycaster.intersectObjects(this.pickables, false).filter((h) => !this.meshes[h.object.userData.cardId].hidden);
      if (hits.length) {
        // highest card in the stack (raycast gives nearest = top)
        const id = hits[0].object.userData.cardId;
        const loc = this.game.pileOf(id);
        if (loc) return { cardId: id, pile: loc.pile, index: loc.index };
      }
      const sh = this.raycaster.intersectObjects(this.slotPickables, false);
      if (sh.length) return { cardId: -1, pile: sh[0].object.userData.pileId, index: -1 };
      return null;
    }
    planePoint(e, z) {
      this.raycaster.setFromCamera(this.ndc(e), this.camera);
      const out = new T.Vector3();
      return this.raycaster.ray.intersectPlane(new T.Plane(new T.Vector3(0, 0, 1), -z), out) ? out : null;
    }
    onDown(e) {
      if (e.button !== 0 || this.locked || this.fx) return;
      const hit = this.pick(e);
      if (!hit) return;
      this.down = { x: e.clientX, y: e.clientY, hit, t: performance.now() };
      if (hit.cardId >= 0 && this.game.canPickUp(hit.pile, hit.index) && !this.anims.has(hit.cardId)) {
        const p = this.planePoint(e, DRAG_Z);
        const ids = this.game.pile(hit.pile).slice(hit.index).map((c) => c.id);
        const m0 = this.meshes[ids[0]];
        this.drag = {
          ids, from: hit.pile, index: hit.index, started: false,
          off: { x: m0.cur.x - p.x, y: m0.cur.y - p.y },
          offsets: ids.map((id) => ({ x: this.meshes[id].rest.x - m0.rest.x, y: this.meshes[id].rest.y - m0.rest.y })),
          pointer: p, lift: 0
        };
      }
    }
    onMove(e) {
      if (!this.drag || !this.down) return;
      const p = this.planePoint(e, DRAG_Z);
      if (p) this.drag.pointer = p;
      if (!this.drag.started && Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > 5) {
        this.drag.started = true;
        for (const id of this.drag.ids) this.anims.delete(id);
        if (this.h.onPickup) this.h.onPickup(this.drag);
      }
    }
    updateDrag() {
      const d = this.drag;
      if (!d.started) return;
      d.lift = Math.min(1, d.lift + 0.15);
      d.ids.forEach((id, k) => {
        const m = this.meshes[id];
        const tx = d.pointer.x + d.off.x + d.offsets[k].x, ty = d.pointer.y + d.off.y + d.offsets[k].y;
        m.cur.x = lerp(m.cur.x, tx, 0.55);
        m.cur.y = lerp(m.cur.y, ty, 0.55);
        m.cur.z = lerp(m.rest.z, DRAG_Z + k * DZ, d.lift);
        m.cur.rz = lerp(m.cur.rz, 0, 0.2);
        m.lift = m.cur.z - m.rest.z;
        m.showShadow = true;
      });
    }
    onUp(e) {
      const down = this.down; this.down = null;
      const d = this.drag; this.drag = null;
      if (!down) return;
      if (d && d.started) {
        const m0 = this.meshes[d.ids[0]];
        const target = this.dropTarget(d, m0.cur.x, m0.cur.y);
        if (this.h.onDrop) this.h.onDrop(d, target);
        return;
      }
      // a click
      const hit = down.hit;
      const now = performance.now();
      const dbl = hit.cardId >= 0 && this.lastClick.id === hit.cardId && now - this.lastClick.t < 380;
      this.lastClick = { t: now, id: hit.cardId };
      if (this.h.onClick) this.h.onClick(hit, dbl);
    }
    // nearest legal pile to where the dragged card is held
    dropTarget(d, x, y) {
      const cards = d.ids.map((id) => this.game.card(id));
      let best = null, bestD = Infinity;
      for (const s of this.game.pileSpecs) {
        if (s.id === d.from || s.hidden) continue;
        if (!this.game.canDrop(cards, s.id)) continue;
        const p = this.game.pile(s.id);
        let tx, ty;
        if (p.length) { const r = this.meshes[p[p.length - 1].id].rest; tx = r.x; ty = r.y - (s.fan === 'down' ? FAN_UP * 0.5 : 0); }
        else { const o = this.pileOrigin(s); tx = o.x; ty = o.y; }
        const dx = Math.abs(x - tx), dy = Math.abs(y - ty);
        if (dx > CW * 0.95 || dy > CH * 0.9) continue;
        const dd = dx * dx + dy * dy * 0.6;
        if (dd < bestD) { bestD = dd; best = s.id; }
      }
      return best;
    }

    // ---------- win cascade ----------
    startCascade(done) {
      const order = [];
      for (let r = 13; r >= 1; r--) for (let f = 0; f < 4; f++) { const c = this.game.pile('f' + f).find((c) => c.rank === r); if (c) order.push(c.id); }
      this.fx = { order, next: 0, t: 0, live: [], done, z: 1.0 };
    }
    tickFx(dt) {
      const fx = this.fx;
      fx.t += dt;
      while (fx.next < fx.order.length && fx.t > fx.next * 0.075) {
        const id = fx.order[fx.next++];
        const m = this.meshes[id];
        this.anims.delete(id);
        const dir = Math.random() < 0.5 ? -1 : 1;
        fx.live.push({ id, vx: dir * (3 + Math.random() * 4), vy: 1 + Math.random() * 5, vr: (Math.random() - 0.5) * 3, z: (fx.z += 0.004) });
        m.showShadow = true;
        if (CT17.audio) CT17.audio.slide(0.15);
      }
      const floor = this.visBottom + CH / 2;
      const right = this.visRight + CW;
      fx.live = fx.live.filter((p) => {
        const m = this.meshes[p.id];
        p.vy -= 26 * dt;
        m.cur.x += p.vx * dt; m.cur.y += p.vy * dt; m.cur.rz += p.vr * dt;
        m.cur.z = p.z; m.lift = 0.5; m.cur.f = 1;
        if (m.cur.y < floor && p.vy < 0) { m.cur.y = floor; p.vy = -p.vy * 0.72; if (Math.abs(p.vy) > 2.5 && CT17.audio) CT17.audio.snap(0.4); }
        if (Math.abs(m.cur.x) > right) { m.hidden = true; return false; }
        return true;
      });
      if (fx.next >= fx.order.length && !fx.live.length) {
        this.fx = null;
        if (fx.done) fx.done();
      }
    }
    stopCascade() {
      this.fx = null;
      for (const m of this.meshes) m.hidden = false;
    }
  }

  CT17.TableView = TableView;
  CT17.VIEW = { CW, CH };
})();
