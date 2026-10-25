// CT17.A3.Cards self-test (Playwright + Chromium):  node tests/test_ct17_a3.js [outdir]
// Loads index.html from file://, deals Klondike, clicks real card positions, switches to FreeCell, checks the
// Microsoft deal, clicks, auto-play, undo, then records a movie and checks it with ffprobe.
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs'), { execSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const out = path.resolve(process.argv[2] || path.join(root, 'tests', 'out'));
fs.mkdirSync(out, { recursive: true });
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader-webgl', '--enable-unsafe-swiftshader', '--disable-gpu-compositing', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 960, height: 600 }, acceptDownloads: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(() => localStorage.clear());
  await page.goto('file://' + path.join(root, 'index.html'));
  await page.waitForFunction(() => window.CT17 && window.CT17.app, null, { timeout: 60000 });

  const idle = () => page.waitForFunction(() => !CT17.app.busy && CT17.app.view.anims.size === 0, null, { timeout: 180000 });
  const total = () => page.evaluate(() => Object.values(CT17.app.game.state.piles).reduce((n, p) => n + p.length, 0));
  // screen position of a card (centre, slightly toward its visible top strip for fanned cards)
  const cardXY = (id, dy = 0.6) => page.evaluate(([id, dy]) => {
    const v = CT17.app.view, m = v.meshes[id];
    const p = new THREE.Vector3(m.cur.x, m.cur.y + dy, m.cur.z).project(v.camera);
    const r = v.renderer.domElement.getBoundingClientRect();
    return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height };
  }, [id, dy]);

  // ---- Klondike ----
  await page.click('#btnStart');
  await idle();
  ok(await page.evaluate(() => CT17.app.game.key) === 'klondike', 'starts in Klondike');
  ok(await total() === 52, 'Klondike: 52 cards');
  await page.screenshot({ path: path.join(out, 'klondike.png') });
  // draw a few, click the waste top card (A2 click rule) until something moves or 30 draws
  let moved = false;
  for (let i = 0; i < 30 && !moved; i++) {
    await page.click('#btnNext'); await idle();
    const w = await page.evaluate(() => { const g = CT17.app.game, p = g.pile('waste'); const c = p[p.length - 1]; return c ? { id: c.id, t: g.autoTarget('waste', p.length - 1) } : null; });
    if (w && w.t) { const xy = await cardXY(w.id, 0); const m0 = await page.evaluate(() => CT17.app.game.state.moves); await page.mouse.click(xy.x, xy.y); await idle(); moved = (await page.evaluate(() => CT17.app.game.state.moves)) > m0; }
  }
  ok(moved, 'Klondike: clicking the waste card made its move');
  ok(await total() === 52, 'Klondike: still 52 cards');

  // ---- switch to FreeCell ----
  await page.click('#gameSeg button[data-game=freecell]');
  await idle();
  const st = await page.evaluate(() => { const g = CT17.app.game; return { key: g.key, n: g.gameNumber, cols: [0,1,2,3,4,5,6,7].map((i) => g.pile('t' + i).length), f: [0,1,2,3].map((i) => g.pile('f' + i).length), slots: Object.keys(CT17.app.view.slots).length }; });
  ok(st.key === 'freecell', 'switched to FreeCell');
  ok(await total() === 52, 'FreeCell: 52 cards');
  ok(st.slots === 16, 'FreeCell: 16 slots drawn (4 cells, 4 foundations, 8 columns), deck spot hidden');
  ok(await page.isHidden('#btnNext') && await page.isVisible('#gameNum'), 'FreeCell: Klondike controls hidden, Game # shown');
  await page.screenshot({ path: path.join(out, 'freecell.png') });

  // Microsoft deal #1
  await page.fill('#gameNum', '1'); await page.press('#gameNum', 'Enter');
  await idle();
  const deal1 = await page.evaluate(() => { const S = 'SHDC', R = ' A23456789TJQK', g = CT17.app.game; return { n: g.gameNumber, row: [0,1,2,3,4,5,6,7].map((i) => { const c = g.pile('t' + i)[0]; return R[c.rank] + S[c.suit]; }).join(' ') }; });
  ok(deal1.n === 1 && deal1.row === 'JD 2D 9H JC 5D 7H 7C 5H', 'FreeCell Game #1 first row = Windows layout (' + deal1.row + ')');
  await page.screenshot({ path: path.join(out, 'freecell_game1.png') });

  // click top cards: each click should move the card somewhere (cell/column/foundation)
  let clicks = 0, movedFC = 0;
  for (let k = 0; k < 8; k++) {
    const t = await page.evaluate((k) => { const g = CT17.app.game, p = g.pile('t' + k); const c = p[p.length - 1]; return c ? { id: c.id, to: g.autoTarget('t' + k, p.length - 1) } : null; }, k);
    if (!t || !t.to) continue;
    const xy = await cardXY(t.id, 0); const m0 = await page.evaluate(() => CT17.app.game.state.moves);
    await page.mouse.click(xy.x, xy.y); await page.waitForTimeout(450); await idle(); clicks++;
    if ((await page.evaluate(() => CT17.app.game.state.moves)) > m0) movedFC++;
    if (clicks >= 4) break;
  }
  ok(clicks > 0 && movedFC === clicks, `FreeCell: ${movedFC}/${clicks} clicks made a move`);
  ok(await total() === 52, 'FreeCell: still 52 cards after clicks');
  const und = await page.evaluate(() => { const h = CT17.app.game.history.length; CT17.app.undo(); return [h, CT17.app.game.history.length]; });
  ok(und[1] === und[0] - 1, 'FreeCell: undo pops one step');
  await idle();

  // rules: supermove limit and auto-finish/win on a constructed position
  const rules = await page.evaluate(() => {
    const G = new CT17.games.freecell(); G.newGame(5);
    const r = { max0: G.maxMove(false), maxE: G.maxMove(true) };
    // build a won-in-one position: everything stacked down one column per suit
    const P = G.state.piles; for (const k in P) P[k] = [];
    for (let s = 0; s < 4; s++) for (let rk = 13; rk >= 1; rk--) P['t' + s].push(G.card(s * 13 + rk - 1));
    r.fin = G.canAutoFinish();
    let n = 0, mv; while ((mv = G.nextFinishMove()) && n < 60) { G.move(mv.from, mv.index, mv.to); n++; }
    r.won = G.isWon(); r.n = n;
    return r;
  });
  ok(rules.max0 === 5 && rules.maxE === 5, `supermove limit with 4 free cells, no empty column = ${rules.max0}`);
  ok(rules.fin && rules.won && rules.n === 52, 'FreeCell auto-finish clears a sorted layout and wins');

  // ---- record ----
  // A deal has a fixed timeline on CT17.clock.  Measure it live, then while recording: the game time must be the same,
  // however slowly this machine draws, and the movie must be exactly (frames / 60) s long -> plays at live speed.
  const dealTime = () => page.evaluate(() => new Promise((res) => {
    const t0 = CT17.clock.now(); CT17.app.deal();
    const iv = setInterval(() => { if (!CT17.app.busy) { clearInterval(iv); res((CT17.clock.now() - t0) / 1000); } }, 5);
  }));
  await page.evaluate(() => CT17.app.switchGame('klondike')); await idle();
  const live = await dealTime(); await idle();
  await page.click('#btnRec');
  await page.waitForFunction(() => CT17.recorder.active || /No video|needs|failed/.test(document.getElementById('stRec').textContent), null, { timeout: 90000 });
  const recOn = await page.evaluate(() => CT17.recorder.active);
  ok(recOn, 'recording started: ' + await page.evaluate(() => CT17.recorder.info || document.getElementById('stRec').textContent));
  if (recOn) {
    const w0 = Date.now();
    const inMovie = await dealTime();
    const wall = (Date.now() - w0) / 1000;
    const script = 0.55 + 1.05 + 27 * 0.075 + 0.3;   // gather + shuffle wait + 28-card stagger + last flight
    ok(Math.abs(inMovie - script) < 2.5 / 60, `deal timeline ${script.toFixed(3)} s; in the movie ${inMovie.toFixed(3)} s; live here ${live.toFixed(2)} s at ~5 fps; ${inMovie.toFixed(2)} s in the movie (this machine needed ${wall.toFixed(1)} s to draw it)`);
    const frames = await page.evaluate(() => Math.round(CT17.recorder.seconds * 60));
    const dl = page.waitForEvent('download', { timeout: 180000 });
    await page.click('#btnRec');
    const d = await dl;
    const f = path.join(out, d.suggestedFilename());
    await d.saveAs(f);
    const probe = JSON.parse(execSync(`ffprobe -v error -count_frames -show_streams -show_format -of json "${f}"`).toString());
    const v = probe.streams.find((s) => s.codec_type === 'video'), a = probe.streams.find((s) => s.codec_type === 'audio');
    const vp = await page.evaluate(() => { const c = CT17.app.view.renderer.domElement; return [c.width & ~1, c.height & ~1]; });
    ok(/CT17\.A3\.Cards_\d{8}_\d{6}\.mp4/.test(d.suggestedFilename()), 'movie downloaded: ' + d.suggestedFilename());
    ok(v && v.width === vp[0] && v.height === vp[1], `movie size ${v && v.width}x${v && v.height} = table canvas ${vp[0]}x${vp[1]}`);
    ok(v && v.r_frame_rate === '60/1', 'constant 60 fps: ' + (v && v.r_frame_rate));
    const nf = v ? +v.nb_read_frames : 0;
    ok(nf >= frames && Math.abs(parseFloat(v.duration) - nf / 60) < 0.05, `${nf} frames = ${v && v.duration} s (frames/60)`);
    ok(parseFloat(v.duration) >= inMovie, `movie (${v && v.duration} s) holds the whole ${inMovie.toFixed(2)} s deal`);
    ok(a && Math.abs(parseFloat(a.duration) - parseFloat(v.duration)) < 0.1, `sound track ${a && a.codec_name} ${a && a.duration} s, picture ${v && v.duration} s`);
    const vol = execSync(`ffmpeg -hide_banner -nostats -i "${f}" -map 0:a -af volumedetect -f null - 2>&1 || true`).toString();
    const mv = /max_volume: (-?[\d.]+) dB/.exec(vol);
    ok(mv && parseFloat(mv[1]) > -30, 'movie sound is audible, max ' + (mv ? mv[1] : '?') + ' dB');
    execSync(`ffmpeg -v error -y -sseof -0.5 -i "${f}" -frames:v 1 "${path.join(out, 'movie_last_frame.png')}"`);
  }
  ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  await browser.close();
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
