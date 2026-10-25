// CT17 Cards - Klondike rules (pure logic, no rendering).
// A game module exposes: pileSpecs, newGame(), state.piles, canPickUp(),
// canDrop(), move(), draw(), autoTarget(), snapshot()/restore(), isWon().
// Other solitaire games can be added later as sibling modules with the same shape.
(function () {
  'use strict';
  const CT17 = (window.CT17 = window.CT17 || {});
  const isRed = (s) => s === 1 || s === 2;

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  class Klondike {
    constructor(opts) {
      opts = opts || {};
      this.name = 'Klondike';
      this.key = 'klondike';
      this.columns = 7;            // A3: layout width in columns (view centres on this)
      this.deckPile = 'stock';     // A3: where the deck sits before a deal
      this.hasStock = true;
      this.drawCount = opts.drawCount || 1;
      this.passes = opts.passes == null ? 3 : opts.passes; // 0 = unlimited
      // layout in grid units: col 0..6, row 0 = top row, row 1 = tableau
      this.pileSpecs = [
        { id: 'stock', kind: 'stock', col: 0, row: 0, fan: 'stack' },
        { id: 'waste', kind: 'waste', col: 1, row: 0, fan: 'waste' },
        { id: 'f0', kind: 'foundation', col: 3, row: 0, fan: 'stack' },
        { id: 'f1', kind: 'foundation', col: 4, row: 0, fan: 'stack' },
        { id: 'f2', kind: 'foundation', col: 5, row: 0, fan: 'stack' },
        { id: 'f3', kind: 'foundation', col: 6, row: 0, fan: 'stack' }
      ];
      for (let i = 0; i < 7; i++) this.pileSpecs.push({ id: 't' + i, kind: 'tableau', col: i, row: 1, fan: 'down' });
      this.cards = [];
      for (let s = 0; s < 4; s++) for (let r = 1; r <= 13; r++) this.cards.push({ id: s * 13 + r - 1, suit: s, rank: r, up: false });
      this.state = { piles: {}, passUsed: 1, moves: 0 };
      this.history = [];
      this.dealOrder = [];
    }

    card(id) { return this.cards[id]; }
    pile(id) { return this.state.piles[id]; }
    top(id) { const p = this.pile(id); return p[p.length - 1]; }
    pileOf(cardId) {
      for (const k in this.state.piles) { const i = this.state.piles[k].indexOf(this.cards[cardId]); if (i >= 0) return { pile: k, index: i }; }
      return null;
    }

    newGame(seed) {
      this.seed = seed == null ? (Math.random() * 2 ** 31) | 0 : seed;
      const rnd = mulberry32(this.seed);
      const deck = this.cards.slice();
      for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
      deck.forEach((c) => (c.up = false));
      const P = {};
      for (const s of this.pileSpecs) P[s.id] = [];
      // deal in the traditional order: row by row, left to right
      this.dealOrder = [];
      let k = 0;
      for (let row = 0; row < 7; row++) {
        for (let col = row; col < 7; col++) {
          const c = deck[k++];
          c.up = col === row;
          P['t' + col].push(c);
          this.dealOrder.push(c.id);
        }
      }
      P.stock = deck.slice(k).reverse(); // last element = top of stock
      this.state = { piles: P, passUsed: 1, moves: 0 };
      this.history = [];
      // stock order before the deal (top of stock first): the deal takes cards off the top
      this.preDealStock = deck.slice().reverse();
    }

    // ----- undo -----
    snapshot() {
      const P = {};
      for (const k in this.state.piles) P[k] = this.state.piles[k].map((c) => [c.id, c.up]);
      return { P, passUsed: this.state.passUsed, moves: this.state.moves };
    }
    restore(s) {
      for (const k in s.P) this.state.piles[k] = s.P[k].map(([id, up]) => { const c = this.cards[id]; c.up = up; return c; });
      this.state.passUsed = s.passUsed;
      this.state.moves = s.moves;
    }
    pushHistory() { this.history.push(this.snapshot()); if (this.history.length > 500) this.history.shift(); }
    undo() { const s = this.history.pop(); if (!s) return false; this.restore(s); return true; }

    // ----- stock -----
    recyclesLeft() { return this.passes === 0 ? Infinity : this.passes - this.state.passUsed; }
    canDraw() { return this.pile('stock').length > 0 || (this.pile('waste').length > 0 && this.recyclesLeft() > 0); }
    draw() {
      const stock = this.pile('stock'), waste = this.pile('waste');
      if (stock.length) {
        this.pushHistory();
        const n = Math.min(this.drawCount, stock.length);
        for (let i = 0; i < n; i++) { const c = stock.pop(); c.up = true; waste.push(c); }
        this.state.moves++;
        return { type: 'draw', n };
      }
      if (waste.length && this.recyclesLeft() > 0) {
        this.pushHistory();
        while (waste.length) { const c = waste.pop(); c.up = false; stock.push(c); }
        this.state.passUsed++;
        this.state.moves++;
        return { type: 'recycle' };
      }
      return { type: 'none' };
    }

    // ----- moves -----
    kindOf(pileId) { return this.pileSpecs.find((s) => s.id === pileId).kind; }
    canPickUp(pileId, index) {
      const p = this.pile(pileId), kind = this.kindOf(pileId);
      const c = p[index];
      if (!c || !c.up) return false;
      if (kind === 'stock') return false;
      if (kind === 'waste' || kind === 'foundation') return index === p.length - 1;
      // tableau: any face-up run that is a valid alternating sequence
      for (let i = index; i < p.length - 1; i++) {
        const a = p[i], b = p[i + 1];
        if (!(a.rank === b.rank + 1 && isRed(a.suit) !== isRed(b.suit))) return false;
      }
      return true;
    }
    canDrop(cards, pileId) {
      const kind = this.kindOf(pileId);
      const first = cards[0];
      const t = this.top(pileId);
      if (kind === 'foundation') {
        if (cards.length !== 1) return false;
        if (!t) return first.rank === 1;
        return t.suit === first.suit && first.rank === t.rank + 1;
      }
      if (kind === 'tableau') {
        if (!t) return first.rank === 13;
        return t.up && t.rank === first.rank + 1 && isRed(t.suit) !== isRed(first.suit);
      }
      return false;
    }
    // returns {flipped: card|null}
    move(fromId, index, toId, opts) {
      if (!(opts && opts.noHistory)) this.pushHistory();
      const from = this.pile(fromId);
      const cards = from.splice(index);
      this.pile(toId).push(...cards);
      let flipped = null;
      const nt = from[from.length - 1];
      if (this.kindOf(fromId) === 'tableau' && nt && !nt.up) { nt.up = true; flipped = nt; }
      this.state.moves++;
      return { flipped };
    }
    // best destination for a double-click: foundation first, then tableau (non-empty first)
    autoTarget(pileId, index) {
      if (!this.canPickUp(pileId, index)) return null;
      const cards = this.pile(pileId).slice(index);
      if (cards.length === 1) for (let i = 0; i < 4; i++) if (this.canDrop(cards, 'f' + i)) return 'f' + i;
      if (this.kindOf(pileId) === 'foundation') {
        // allow pulling a card back down
      }
      let emptyT = null;
      for (let i = 0; i < 7; i++) {
        const id = 't' + i;
        if (id === pileId) continue;
        if (this.canDrop(cards, id)) {
          if (this.pile(id).length) return id;
          // moving a king from the bottom of a column to another empty column is pointless
          if (!(this.kindOf(pileId) === 'tableau' && index === 0)) emptyT = emptyT || id;
        }
      }
      return emptyT;
    }

    // ----- end game -----
    isWon() { return [0, 1, 2, 3].every((i) => this.pile('f' + i).length === 13); }
    canAutoFinish() {
      if (this.pile('stock').length || this.pile('waste').length) return false;
      for (let i = 0; i < 7; i++) if (this.pile('t' + i).some((c) => !c.up)) return false;
      return !this.isWon();
    }
    // next {from, index, to} for auto-finish (lowest rank first)
    nextFinishMove() {
      let best = null;
      const sources = ['waste'].concat([0, 1, 2, 3, 4, 5, 6].map((i) => 't' + i));
      for (const s of sources) {
        const p = this.pile(s); if (!p.length) continue;
        const c = p[p.length - 1];
        for (let f = 0; f < 4; f++) {
          if (this.canDrop([c], 'f' + f) && (!best || c.rank < best.rank)) best = { from: s, index: p.length - 1, to: 'f' + f, rank: c.rank };
        }
      }
      return best;
    }
  }

  CT17.games = CT17.games || {};
  CT17.games.klondike = Klondike;
})();
