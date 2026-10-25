// CT17 Cards - app controller: UI, settings, game flow, sounds.
// A3: two games (Klondike, FreeCell) switched from the top bar, all timing on CT17.clock, Record button.
(function () {
  'use strict';
  const CT17 = window.CT17;
  const A = CT17.audio;
  const C = CT17.clock;
  const REC = CT17.recorder;
  const $ = (id) => document.getElementById(id);

  const store = {
    get(k, d) { try { const v = localStorage.getItem('CT17.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('CT17.' + k, JSON.stringify(v)); } catch (e) { /* ignore */ } }
  };

  const settings = {
    game: store.get('game', 'klondike'),
    drawCount: store.get('drawCount', 1),
    passes: store.get('passes', 3),
    autoPlay: store.get('autoPlay', true),
    sound: store.get('sound', true),
    volume: store.get('volume', 0.8)
  };
  if (!CT17.games[settings.game]) settings.game = 'klondike';

  let game, view;
  let timer = { start: 0, elapsed: 0, running: false };
  let busy = false;           // dealing / auto-finishing / auto-playing
  let won = false;
  let lastClickMove = 0;     // time of the last click that triggered a move
  let recMsg = '', recMsgT = 0;

  function makeGame(key) {
    const G = CT17.games[key];
    return key === 'klondike'
      ? new G({ drawCount: settings.drawCount, passes: settings.passes })
      : new G({ autoPlay: settings.autoPlay });
  }
  const isFC = () => game.key === 'freecell';

  // ---------- boot ----------
  async function boot() {
    $('loading').textContent = 'Painting the cards…';
    await CT17.loadArt();
    await new Promise((r) => setTimeout(r, 20));
    game = makeGame(settings.game);
    game.newGame();
    view = new CT17.TableView($('stage'), game, { onClick, onDrop, onPickup });
    stackAllInStock(game.dealOrder);
    A.setEnabled(settings.sound);
    A.setVolume(settings.volume);
    REC.caption = caption;
    REC.banner = () => ($('win').classList.contains('show') ? ['You Won!', $('winStats').textContent] : null);
    REC.onStatus = (t) => { recMsg = t; recMsgT = performance.now(); updateRecUI(); };
    bindUI();
    updateHUD();
    $('loading').remove();
    $('splash').classList.add('show');
    setInterval(updateClock, 250);
    setTimeout(() => REC.warm(view), 1500);
    window.CT17.app = { get game() { return game; }, get view() { return view; }, deal, nextCard, undo, switchGame, toggleRecord, get busy() { return busy; } };
  }

  // put every card face-down on the deck spot (first-dealt card on top) without changing the real game
  function stackAllInStock(dealOrder, animate) {
    const real = game.state.piles;
    const fake = {};
    for (const s of game.pileSpecs) fake[s.id] = [];
    const dealt = new Set(dealOrder);
    const rest = game.cards.filter((c) => !dealt.has(c.id));
    const ups = game.cards.map((c) => c.up);
    fake[game.deckPile] = rest.concat(dealOrder.slice().reverse().map((id) => game.card(id)));
    game.cards.forEach((c) => (c.up = false));
    game.state.piles = fake;
    view.sync(animate ? { order: game.cards.map((c) => c.id), stagger: 0.004, dur: 0.38 } : { instant: true });
    game.state.piles = real;
    game.cards.forEach((c, i) => (c.up = ups[i]));
  }

  // ---------- actions ----------
  /** deal a new game of the current kind (FreeCell: optional deal number) */
  function deal(num) {
    if (busy && !view.fx) return;
    const wasPlaying = game.state.moves > 0 || game.pile('t0').length > 0;
    if (game.key === 'klondike') { game.drawCount = settings.drawCount; game.passes = settings.passes; }
    game.newGame(isFC() ? num : undefined);
    runDeal(wasPlaying);
  }
  /** switch to another game: the cards are swept together and dealt into the new layout */
  function switchGame(key) {
    if (!CT17.games[key] || key === game.key) return;
    if (busy && !view.fx) return;
    settings.game = key; store.set('game', key);
    game = makeGame(key);
    game.newGame();
    view.stopCascade();
    view.setGame(game, true);
    runDeal(true);
  }
  function runDeal(gather) {
    A.unlock();
    C.cancelAll();
    view.stopCascade();
    $('win').classList.remove('show');
    $('splash').classList.remove('show');
    busy = true; won = false;
    view.locked = true;
    let gatherDelay = 0;
    if (gather) { stackAllInStock(game.dealOrder, true); A.slide(0.3); gatherDelay = 0.55; }
    else stackAllInStock(game.dealOrder, false);
    const last = game.dealOrder[game.dealOrder.length - 1];
    C.after(gatherDelay * 1000, () => {
      A.shuffle();
      view.sync({
        order: game.dealOrder, stagger: isFC() ? 0.05 : 0.075, delay: 1.05, dur: 0.3,
        onStart: () => A.slide(0.16),
        onLand: (id) => { A.snap(0.8); if (id === last) dealDone(); }
      });
    });
    timer = { start: 0, elapsed: 0, running: false };
    applyGameUI();
    updateHUD();
  }
  function dealDone() {
    busy = false; view.locked = false;
    updateHUD();
    if (isFC()) afterAction();          // aces dealt to the bottom of a column go straight up
  }

  function startTimer() { if (!timer.running && !won) { timer.running = true; timer.start = C.now() - timer.elapsed; } }

  function nextCard() {
    if (busy || won || !game.hasStock) return;
    A.unlock();
    const res = game.draw();
    if (res.type === 'draw') {
      startTimer();
      const drawn = game.pile('waste').slice(-res.n).map((c) => c.id);
      view.sync({ order: drawn, stagger: 0.09, onStart: () => A.flip(), onLand: () => A.snap(0.7) });
    } else if (res.type === 'recycle') {
      const ids = game.pile('stock').map((c) => c.id).reverse();
      view.sync({ order: ids, stagger: 0.008, dur: 0.28 });
      A.slide(0.3);
      C.after(380, () => A.snap(1));
    } else {
      A.nope();
    }
    afterAction();
  }

  function doMove(from, index, to) {
    const moving = game.pile(from).slice(index).map((c) => c.id);
    const res = game.move(from, index, to);
    startTimer();
    const delays = new Map();
    moving.forEach((id, k) => delays.set(id, k * 0.025));
    if (res.flipped) delays.set(res.flipped.id, 0.22);
    const toFoundation = to[0] === 'f';
    view.sync({
      delays,
      onLand: (id) => {
        if (res.flipped && id === res.flipped.id) A.snap(0.5);
        else if (id === moving[0]) { A.snap(1); if (toFoundation) A.chime(game.pile(to).length); }
      },
      onStart: (id) => { if (res.flipped && id === res.flipped.id) A.flip(); }
    });
    afterAction(0.22);
  }

  function undo() {
    if (busy || won) return;
    if (!game.undo()) { A.nope(); return; }
    view.sync({ onLand: () => A.snap(0.6) });
    A.slide(0.2);
    updateHUD();
  }

  function autoMove(pile, index) {
    const to = game.autoTarget(pile, index);
    if (to) doMove(pile, index, to);
    else A.nope();
  }

  function afterAction(wait) {
    updateHUD();
    if (game.isWon()) return onWin();
    if (game.canAutoFinish()) return autoFinish();
    if (game.safeAutoMove && game.safeAutoMove()) autoPlay(wait || 0);
  }

  // FreeCell: cards no longer needed below go up to the foundations by themselves (one undo step with the move)
  function autoPlay(wait) {
    busy = true; view.locked = true;
    const step = () => {
      const mv = game.safeAutoMove();
      if (!mv) {
        busy = false; view.locked = false;
        updateHUD();
        if (game.isWon()) onWin(); else if (game.canAutoFinish()) autoFinish();
        return;
      }
      const id = game.pile(mv.from)[mv.index].id;
      game.move(mv.from, mv.index, mv.to, { noHistory: true });
      view.sync({ dur: 0.3, onLand: (cid) => { if (cid === id) { A.snap(0.9); A.chime(game.pile(mv.to).length); } } });
      updateHUD();
      C.after(140, step);
    };
    C.after(120 + wait * 1000, step);
  }

  function autoFinish() {
    busy = true; view.locked = true;
    const step = () => {
      const mv = game.nextFinishMove();
      if (!mv) { busy = false; view.locked = false; if (game.isWon()) onWin(); return; }
      const id = game.pile(mv.from)[mv.index].id;
      game.move(mv.from, mv.index, mv.to);
      view.sync({ dur: 0.26, onLand: (cid) => { if (cid === id) { A.snap(0.9); A.chime(game.pile(mv.to).length); } } });
      updateHUD();
      C.after(125, step);
    };
    C.after(350, step);
  }

  function onWin() {
    if (won) return;
    won = true;
    timer.running = false;
    timer.elapsed = C.now() - timer.start;
    busy = true; view.locked = true;
    const wait = () => {
      if (view.anims.size) return C.after(100, wait);
      A.win();
      updateHUD();
      C.after(500, () => won && view.startCascade(() => {
        busy = false; view.locked = false;
        $('winStats').textContent = (isFC() ? `Game #${game.gameNumber} · ` : '') + `${game.state.moves} moves · ${fmtTime(timer.elapsed)}`;
        $('win').classList.add('show');
      }));
    };
    wait();
  }

  // ---------- view callbacks ----------
  function onClick(hit, dbl) {
    if (busy) return;
    if (hit.pile === 'stock') return nextCard();
    if (hit.cardId < 0 || dbl) return;          // 2nd click of a double-click was already handled
    const now = performance.now();
    if (now - lastClickMove < 380) return;       // habit double-click: don't let the 2nd click move the card underneath
    if (hit.pile[0] === 'f') return;             // foundation cards stay put on a click
    const c = game.card(hit.cardId);
    if (!c.up) return;
    // A2: a single click makes the best available move (foundation first, then a column; FreeCell: then a free cell)
    const index = hit.pile === 'waste' ? game.pile('waste').length - 1 : hit.index;
    lastClickMove = now;
    autoMove(hit.pile, index);
  }
  function onPickup() { A.unlock(); A.slide(0.1); }
  function onDrop(drag, target) {
    if (target) doMove(drag.from, drag.index, target);
    else { view.sync({ onLand: (id) => { if (id === drag.ids[0]) A.snap(0.5); } }); }
  }

  // ---------- recording ----------
  async function toggleRecord() {
    A.unlock();
    if (REC.busyStarting) return;
    if (REC.active) { A.recBlip(false); await REC.stop(); }
    else { const ok = await REC.start(view); if (ok) A.recBlip(true); }
    updateRecUI();
  }
  function caption() {
    const ms = timer.running ? C.now() - timer.start : timer.elapsed;
    return `CT17 Cards · ${game.name}` + (isFC() ? ` · Game #${game.gameNumber}` : '') + ` · Moves ${game.state.moves} · ${fmtTime(ms)}`;
  }
  function updateRecUI() {
    const b = $('btnRec');
    b.classList.toggle('rec', REC.active);
    b.textContent = REC.active ? '■ Stop' : '● Record';
    b.disabled = REC.busyStarting && !REC.active;
    let t = '';
    if (REC.active) t = `● REC ${fmtTime(REC.seconds * 1000)} · ${REC.info}`;
    else if (recMsg && performance.now() - recMsgT < 15000) t = recMsg;
    $('stRec').textContent = t;
    $('stRec').classList.toggle('on', REC.active);
  }

  // ---------- HUD ----------
  function fmtTime(ms) {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
  function updateClock() {
    if (!game) return;
    const ms = timer.running ? C.now() - timer.start : timer.elapsed;
    if (timer.running) timer.elapsed = ms;
    $('stTime').textContent = fmtTime(ms);
    updateRecUI();
  }
  function applyGameUI() {
    const fc = isFC();
    document.querySelectorAll('#gameSeg button').forEach((b) => b.classList.toggle('on', b.dataset.game === game.key));
    document.querySelectorAll('.only-klondike').forEach((e) => (e.style.display = fc ? 'none' : ''));
    document.querySelectorAll('.only-freecell').forEach((e) => (e.style.display = fc ? '' : 'none'));
    $('brandGame').textContent = game.name;
    $('splashTitle').textContent = game.name;
    document.title = `CT17 Cards — ${game.name}`;
  }
  function updateHUD() {
    const g = game;
    if (g.hasStock) {
      const stockN = g.pile('stock').length;
      $('stPass').textContent = g.passes === 0 ? `Pass ${g.state.passUsed} (unlimited)` : `Pass ${g.state.passUsed} of ${g.passes}`;
      $('stStock').textContent = `Stock ${stockN}`;
      const btn = $('btnNext');
      if (stockN) { btn.textContent = g.drawCount === 3 ? 'Next 3 Cards' : 'Next Card'; btn.disabled = false; }
      else if (g.pile('waste').length && g.recyclesLeft() > 0) { btn.textContent = 'Turn Deck Over'; btn.disabled = false; }
      else { btn.textContent = 'Deck Used Up'; btn.disabled = true; }
    } else {
      $('stPass').textContent = `Game #${g.gameNumber}`;
      $('stStock').textContent = `Free cells ${g.freeCellsEmpty()} · move up to ${g.maxMove(false)}`;
      if (document.activeElement !== $('gameNum')) $('gameNum').value = g.gameNumber;
    }
    $('stMoves').textContent = `Moves ${g.state.moves}`;
    $('btnUndo').disabled = !g.history.length || won;
    document.querySelectorAll('#drawSeg button').forEach((b) => b.classList.toggle('on', +b.dataset.n === settings.drawCount));
    $('selPasses').value = String(settings.passes);
    $('btnAuto').classList.toggle('on', settings.autoPlay);
    $('btnSound').classList.toggle('off', !settings.sound);
    $('btnSound').textContent = settings.sound ? '♪ Sound' : '♪ Muted';
    if (view) view.updateSlots();
  }

  function bindUI() {
    applyGameUI();
    document.querySelectorAll('#gameSeg button').forEach((b) => { b.onclick = () => switchGame(b.dataset.game); });
    $('btnDeal').onclick = () => deal();
    $('btnStart').onclick = () => { $('splash').classList.remove('show'); deal(); };
    $('btnAgain').onclick = () => deal();
    $('btnNext').onclick = () => nextCard();
    $('btnUndo').onclick = () => undo();
    $('btnRec').onclick = () => toggleRecord();
    document.querySelectorAll('#drawSeg button').forEach((b) => {
      b.onclick = () => {
        settings.drawCount = +b.dataset.n; store.set('drawCount', settings.drawCount);
        if (game.hasStock) { game.drawCount = settings.drawCount; view.sync({}); }
        updateHUD();
      };
    });
    $('selPasses').onchange = (e) => {
      settings.passes = +e.target.value; store.set('passes', settings.passes);
      if (game.hasStock) game.passes = settings.passes;
      updateHUD();
    };
    $('btnAuto').onclick = () => {
      settings.autoPlay = !settings.autoPlay; store.set('autoPlay', settings.autoPlay);
      if (isFC()) { game.autoPlay = settings.autoPlay; if (!busy) afterAction(); }
      updateHUD();
    };
    $('gameNum').onchange = (e) => {
      const n = Math.round(+e.target.value);
      if (n >= 1 && n <= 32000 && isFC()) deal(n); else updateHUD();
    };
    $('gameNum').onkeydown = (e) => { if (e.key === 'Enter') e.target.blur(); e.stopPropagation(); };
    $('btnSound').onclick = () => {
      settings.sound = !settings.sound; store.set('sound', settings.sound);
      A.setEnabled(settings.sound); if (settings.sound) A.snap(0.7);
      updateHUD();
    };
    $('volume').value = settings.volume;
    $('volume').oninput = (e) => { settings.volume = +e.target.value; store.set('volume', settings.volume); A.setVolume(settings.volume); };
    $('volume').onchange = () => A.snap(0.8);
    $('btnHelp').onclick = () => $('help').classList.toggle('show');
    $('help').onclick = () => $('help').classList.remove('show');
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT') return;
      if (e.key === 'v' || e.key === 'V') { e.preventDefault(); toggleRecord(); return; }
      if ($('splash').classList.contains('show')) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('btnStart').click(); } return; }
      if (e.key === ' ' || e.key === 'n' || e.key === 'N') { e.preventDefault(); nextCard(); }
      else if ((e.key === 'z' && (e.ctrlKey || e.metaKey)) || e.key === 'u' || e.key === 'U' || e.key === 'Backspace') { e.preventDefault(); undo(); }
      else if (e.key === 'F2' || e.key === 'd' || e.key === 'D') { e.preventDefault(); deal(); }
      else if (e.key === 'g' || e.key === 'G') { e.preventDefault(); switchGame(isFC() ? 'klondike' : 'freecell'); }
      else if (e.key === '?' || e.key === 'h' || e.key === 'H') $('help').classList.toggle('show');
    });
  }

  window.addEventListener('DOMContentLoaded', () => boot().catch((err) => {
    console.error(err);
    const l = $('loading'); if (l) l.textContent = 'Error: ' + err.message;
  }));
})();
