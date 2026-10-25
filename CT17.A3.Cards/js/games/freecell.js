// CT17 Cards - FreeCell rules (A3; pure logic, same module shape as klondike.js).
// Deals are the classic Microsoft FreeCell deals: Game #1..#32000 give the same layout as Windows FreeCell.
(function () {
  'use strict';
  const CT17 = (window.CT17 = window.CT17 || {});
  const isRed = (s) => s === 1 || s === 2;          // suit 0♠ 1♥ 2♦ 3♣
  const MS_SUIT = [3, 2, 1, 0];                     // Microsoft order ♣ ♦ ♥ ♠ -> ours

  /** the Microsoft deal: returns 52 card ids in dealing order (card k goes to column k % 8) */
  function msDeal(num) {
    let seed = num >>> 0;
    const rand = () => { seed = (Math.imul(seed, 214013) + 2531011) & 0x7fffffff; return seed >>> 16; };
    const deck = []; for (let i = 0; i < 52; i++) deck.push(i);
    const out = [];
    for (let i = 0; i < 52; i++) {
      const left = 52 - i, j = rand() % left;
      out.push(deck[j]); deck[j] = deck[left - 1];
    }
    return out.map((c) => MS_SUIT[c % 4] * 13 + Math.floor(c / 4));
  }

  class FreeCell {
    constructor(opts) {
      opts = opts || {};
      this.name = 'FreeCell';
      this.key = 'freecell';
      this.columns = 8;
      this.deckPile = 'deck';
      this.hasStock = false;
      this.autoPlay = opts.autoPlay !== false;      // safe cards go up to the foundations by themselves
      this.pileSpecs = [];
      for (let i = 0; i < 4; i++) this.pileSpecs.push({ id: 'c' + i, kind: 'freecell', col: i, row: 0, fan: 'stack' });
      for (let i = 0; i < 4; i++) this.pileSpecs.push({ id: 'f' + i, kind: 'foundation', col: 4 + i, row: 0, fan: 'stack' });
      for (let i = 0; i < 8; i++) this.pileSpecs.push({ id: 't' + i, kind: 'tableau-any', col: i, row: 1, fan: 'down' });
      // the deck waits face down in the middle of the table before a deal (no slot drawn)
      this.pileSpecs.push({ id: 'deck', kind: 'deck', col: 3.5, row: 1, fan: 'stack', hidden: true });
      this.cards = [];
      for (let s = 0; s < 4; s++) for (let r = 1; r <= 13; r++) this.cards.push({ id: s * 13 + r - 1, suit: s, rank: r, up: false });
      this.state = { piles: {}, moves: 0, passUsed: 1 };
      this.history = [];
      this.dealOrder = [];
      this.gameNumber = 0;
    }

    card(id) { return this.cards[id]; }
    pile(id) { return this.state.piles[id]; }
    top(id) { const p = this.pile(id); return p[p.length - 1]; }
    pileOf(cardId) {
      for (const k in this.state.piles) { const i = this.state.piles[k].indexOf(this.cards[cardId]); if (i >= 0) return { pile: k, index: i }; }
      return null;
    }
    kindOf(pileId) { return this.pileSpecs.find((s) => s.id === pileId).kind; }

    newGame(num) {
      this.gameNumber = num == null ? 1 + Math.floor(Math.random() * 32000) : num;
      const order = msDeal(this.gameNumber);
      const P = {};
      for (const s of this.pileSpecs) P[s.id] = [];
      order.forEach((id, k) => { const c = this.cards[id]; c.up = true; P['t' + (k % 8)].push(c); });
      this.cards.forEach((c) => (c.up = true));
      this.dealOrder = order.slice();
      this.state = { piles: P, moves: 0, passUsed: 1 };
      this.history = [];
    }

    // ----- undo -----
    snapshot() {
      const P = {};
      for (const k in this.state.piles) P[k] = this.state.piles[k].map((c) => [c.id, c.up]);
      return { P, moves: this.state.moves };
    }
    restore(s) {
      for (const k in s.P) this.state.piles[k] = s.P[k].map(([id, up]) => { const c = this.cards[id]; c.up = up; return c; });
      this.state.moves = s.moves;
    }
    pushHistory() { this.history.push(this.snapshot()); if (this.history.length > 500) this.history.shift(); }
    undo() { const s = this.history.pop(); if (!s) return false; this.restore(s); return true; }

    // no stock in FreeCell
    recyclesLeft() { return 0; }
    canDraw() { return false; }
    draw() { return { type: 'none' }; }

    // ----- moves -----
    freeCellsEmpty() { let n = 0; for (let i = 0; i < 4; i++) if (!this.pile('c' + i).length) n++; return n; }
    columnsEmpty() { let n = 0; for (let i = 0; i < 8; i++) if (!this.pile('t' + i).length) n++; return n; }
    /** how many cards may move at once ("supermove": as if one at a time through free cells and empty columns) */
    maxMove(toEmptyColumn) {
      const e = this.columnsEmpty() - (toEmptyColumn ? 1 : 0);
      return (this.freeCellsEmpty() + 1) * Math.pow(2, Math.max(0, e));
    }
    isRun(cards) {
      for (let i = 0; i < cards.length - 1; i++) {
        const a = cards[i], b = cards[i + 1];
        if (!(a.rank === b.rank + 1 && isRed(a.suit) !== isRed(b.suit))) return false;
      }
      return true;
    }
    canPickUp(pileId, index) {
      const p = this.pile(pileId), kind = this.kindOf(pileId);
      if (!p || !p[index]) return false;
      if (kind === 'deck') return false;
      if (kind !== 'tableau-any') return index === p.length - 1;
      const cards = p.slice(index);
      return this.isRun(cards) && cards.length <= this.maxMove(false);
    }
    canDrop(cards, pileId) {
      const kind = this.kindOf(pileId);
      const first = cards[0], t = this.top(pileId);
      if (kind === 'freecell') return cards.length === 1 && !t;
      if (kind === 'foundation') {
        if (cards.length !== 1) return false;
        if (!t) return first.rank === 1;
        return t.suit === first.suit && first.rank === t.rank + 1;
      }
      if (kind === 'tableau-any') {
        if (!this.isRun(cards)) return false;
        if (!t) return cards.length <= this.maxMove(true);
        return t.rank === first.rank + 1 && isRed(t.suit) !== isRed(first.suit) && cards.length <= this.maxMove(false);
      }
      return false;
    }
    move(fromId, index, toId, opts) {
      if (!(opts && opts.noHistory)) this.pushHistory();
      const cards = this.pile(fromId).splice(index);
      this.pile(toId).push(...cards);
      this.state.moves++;
      return { flipped: null };
    }
    /** A2 rule for a click: foundation, else onto a card, else a free cell (single card), else an empty column */
    autoTarget(pileId, index) {
      if (!this.canPickUp(pileId, index)) return null;
      const kind = this.kindOf(pileId);
      if (kind === 'foundation') return null;
      const cards = this.pile(pileId).slice(index);
      if (cards.length === 1) for (let i = 0; i < 4; i++) if (this.canDrop(cards, 'f' + i)) return 'f' + i;
      let emptyT = null;
      for (let i = 0; i < 8; i++) {
        const id = 't' + i;
        if (id === pileId || !this.canDrop(cards, id)) continue;
        if (this.pile(id).length) return id;
        if (!(kind === 'tableau-any' && index === 0)) emptyT = emptyT || id;   // a whole column to an empty one is pointless
      }
      if (cards.length === 1 && kind !== 'freecell') for (let i = 0; i < 4; i++) if (this.canDrop(cards, 'c' + i)) return 'c' + i;
      return emptyT;
    }

    // ----- foundations -----
    foundationRank(suit) {
      for (let i = 0; i < 4; i++) { const t = this.top('f' + i); if (t && t.suit === suit) return t.rank; }
      return 0;
    }
    sources() { return ['c0', 'c1', 'c2', 'c3', 't0', 't1', 't2', 't3', 't4', 't5', 't6', 't7']; }
    foundationFor(c) { for (let f = 0; f < 4; f++) if (this.canDrop([c], 'f' + f)) return 'f' + f; return null; }
    /** a card that can go up and is no longer needed below (both opposite-colour foundations reach rank-1) */
    safeAutoMove() {
      if (!this.autoPlay) return null;
      for (const s of this.sources()) {
        const p = this.pile(s); if (!p.length) continue;
        const c = p[p.length - 1];
        const to = this.foundationFor(c);
        if (!to) continue;
        const opp = isRed(c.suit) ? [0, 3] : [1, 2];
        if (c.rank <= 2 || opp.every((su) => this.foundationRank(su) >= c.rank - 1)) return { from: s, index: p.length - 1, to };
      }
      return null;
    }

    // ----- end game -----
    isWon() { return [0, 1, 2, 3].every((i) => this.pile('f' + i).length === 13); }
    /** every column runs downhill to its top card, so the rest can go up in rank order */
    canAutoFinish() {
      if (this.isWon()) return false;
      for (let i = 0; i < 8; i++) {
        const p = this.pile('t' + i);
        for (let k = 0; k < p.length - 1; k++) if (p[k].rank < p[k + 1].rank) return false;
      }
      return true;
    }
    nextFinishMove() {
      let best = null;
      for (const s of this.sources()) {
        const p = this.pile(s); if (!p.length) continue;
        const c = p[p.length - 1];
        const to = this.foundationFor(c);
        if (to && (!best || c.rank < best.rank)) best = { from: s, index: p.length - 1, to, rank: c.rank };
      }
      return best;
    }
  }
  FreeCell.msDeal = msDeal;

  CT17.games = CT17.games || {};
  CT17.games.freecell = FreeCell;
})();
