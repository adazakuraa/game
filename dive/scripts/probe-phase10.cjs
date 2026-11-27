/**
 * Phase 10 probe: (3) the netted turtle — a shutter tap starts the cutting motion (knife thrust, strokes that
 * snap the rope strands, the net falls away), conditions / reward / frequency unchanged; (4) the dolphin follows
 * ~30 s and then leaves (no endless circling): constants + measured timeline.
 * Usage: node scripts/probe-phase10.cjs [dist/artifact.html]   (PROBE_CHROME=<chromium binary>, SHOTS=<dir> for screenshots)
 */
const path = require('path');
const http = require('http');
const fs = require('fs');
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('playwright-core')); }
const ARTIFACT = process.argv[2] || path.join(__dirname, '..', 'dist', 'artifact.html');
const EXE = process.env.PROBE_CHROME;
const SHOTS = process.env.SHOTS;
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

(async () => {
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(fs.readFileSync(ARTIFACT)); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({ ...(EXE ? { executablePath: EXE } : {}), args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => window.__THREE_GAME_TEST_HOOKS__, null, { timeout: 120000 });
  const ev = (fn, arg) => page.evaluate(fn, arg);
  await ev(() => document.getElementById('pr-go')?.click());
  await page.waitForTimeout(1200);
  await ev(() => window.__THREE_GAME_TEST_HOOKS__.setState('lagoon'));
  await page.waitForFunction(() => window.__THREE_GAME_TEST_HOOKS__.game.state === 'diving', null, { timeout: 240000, polling: 1000 });
  await ev(() => { window.__THREE_GAME_TEST_HOOKS__.game.tut.step = -1; window.__THREE_GAME_TEST_HOOKS__.setPausedForScreenshot(true); });
  await page.waitForTimeout(500);

  // ---------- (4) dolphin: follow ~30 s, then leave; never circle on ----------
  const C = await ev(async () => {
    const h = window.__THREE_GAME_TEST_HOOKS__, g = h.game;
    g.tut.step = -1;
    h.teleport(0, -6, 380);
    const pos = g.camera.position;
    const dir = g.camera.getWorldDirection(g.tmpDir);
    const step = (s) => { let left = s; while (left > 0) { const d = Math.min(0.25, left); g.creatures.update(d, pos, g.vel, dir); left -= d; } };
    step(6);
    const rt = g.creatures.list.find((r) => r.def.id === 'dolphin');
    const out = { follow: null, leftAt: null, firstFollowAt: null, episodes: 0, followTotal: 0, swept: 0, maxSweptPerFollow: 0, tl: [], dists: [] };
    h.callCurious('dolphin');
    let prev = 0, ang0 = null, cur = 0, sweptNow = 0;
    for (let t = 1; t <= 240; t++) {
      step(1);
      const gr = rt.groups[0], c = gr.cur ?? 0;
      const rel = gr.c.clone().sub(pos);
      const ang = Math.atan2(rel.z, rel.x);
      if (c === 1) { out.followTotal++; if (prev === 1 && ang0 !== null) { let d = ang - ang0; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; sweptNow += Math.abs(d); } }
      if (c === 1 && prev !== 1) { out.episodes++; sweptNow = 0; if (out.firstFollowAt === null) out.firstFollowAt = t; }
      if (c !== 1 && prev === 1) { if (out.leftAt === null) out.leftAt = t; out.maxSweptPerFollow = Math.max(out.maxSweptPerFollow, sweptNow); }
      ang0 = ang; prev = c;
      if (t % 10 === 0) out.tl.push([t, c, +(rel.length()).toFixed(1)]);
    }
    return out;
  });
  console.log('  dolphin (diver stationary, 240 s)', JSON.stringify({ firstFollowAt: C.firstFollowAt, leftAt: C.leftAt, episodes: C.episodes, followTotal: C.followTotal, maxSweptDeg: Math.round(C.maxSweptPerFollow * 180 / Math.PI) }));
  console.log('  timeline [t, state(1=follow,2=leave), dist m]', JSON.stringify(C.tl));
  const consts = await ev(() => window.__THREE_GAME_TEST_HOOKS__.curiousConsts());
  console.log('  CURIOUS', JSON.stringify(consts));
  check('イルカ：ついてくる時間の定数が約30秒', consts.follow >= 28 && consts.follow <= 32, `follow=${consts.follow}`);
  check('イルカ：実測で約30秒ついてきて離れる', C.leftAt !== null && C.leftAt - C.firstFollowAt >= 28 && C.leftAt - C.firstFollowAt <= 33, `follow ${C.firstFollowAt}→${C.leftAt}s`);
  check('イルカ：離れた後はクールダウン中に戻ってこない（240秒で最大2回）', C.episodes <= 2 && C.followTotal <= 70, `episodes=${C.episodes} followTotal=${C.followTotal}s`);
  const tail = C.tl.filter(([t, c]) => t > 40 && t < 130);
  check('イルカ：離れた後は距離が広がる（> 30 m）', tail.some(([, , d]) => d > 30), JSON.stringify(tail.map((x) => x[2])));

  // ---------- (3) netted turtle ----------
  const R = await ev(async () => {
    const h = window.__THREE_GAME_TEST_HOOKS__, g = h.game, inp = g.input;
    inp.poll = () => {};
    h.teleport(0, -3, 40);
    g.tool = 'camera';
    g.missions.force = 'rescue';
    g.missions.restDives = 9; g.missions.lastEnd = -999;
    for (let i = 0; i < 6 && !g.missions.active; i++) g.updateDiver(0.05);
    const a = g.missions.active;
    if (!a || a.kind !== 'rescue') return { err: 'no rescue' };
    const spot = a.spot.clone();
    const out = { spot: [spot.x, spot.y, spot.z], reach: 2.4, reward: a.reward, time: a.time, steps: [] };
    // far: the tap does nothing
    h.teleport(spot.x + 8, spot.y, spot.z);
    for (let i = 0; i < 4; i++) g.updateDiver(0.05);
    inp.press('shutter'); g.updateDiver(0.05);
    out.farCut = g.missions.cutProgress();
    out.farReady = g.cutReady;
    // near, facing the turtle
    h.teleport(spot.x, spot.y + 0.1, spot.z + 1.6);
    h.look(0, 0);
    for (let i = 0; i < 4; i++) g.updateDiver(0.05);
    out.ready = g.cutReady;
    out.preKnifeVisible = g.vmKnife.visible;
    out.cutBefore = g.missions.cutProgress();
    const t0 = a.t;
    inp.press('shutter'); g.updateDiver(0.05);
    out.cutAfterTap = g.missions.cutProgress();
    out.sampleAfterTap = h.cutFx ? h.cutFx() : null;
    const seq = [];
    for (let i = 0; i < 60 && g.missions.active && !g.missions.active.got; i++) {
      g.updateDiver(0.05);
      if (i % 4 === 0) seq.push(h.cutFx ? h.cutFx() : { k: g.missions.cutProgress() });
    }
    out.seq = seq;
    out.got = g.missions.active ? g.missions.active.got : 'ended';
    out.companion = g.creatures.companion ? g.creatures.companion.id : null;
    return out;
  });
  console.log('  rescue', JSON.stringify(R).slice(0, 1800));
  check('ウミガメ：遠くではタップしても切り始めない', R.farCut === null && !R.farReady, `farCut=${R.farCut}`);
  check('ウミガメ：そばでタップ可能になる（reach 2.4 m）', R.ready === true);
  check('ウミガメ：タップで切るモーションに入る', R.cutBefore === null && R.cutAfterTap !== null);
  const snaps = (R.seq || []).map((x) => x.snapped);
  check('ウミガメ：タップ前は綱が3本張られている（切れた本数 0）', R.sampleAfterTap && R.sampleAfterTap.snapped === 0 && R.sampleAfterTap.ropesVisible === true, JSON.stringify(R.sampleAfterTap));
  check('ウミガメ：ストロークごとに綱が1本ずつ切れ、最後は3本', snaps.length > 3 && snaps.every((v, i) => i === 0 || v >= snaps[i - 1]) && Math.max(...snaps) === 3 && snaps.includes(1) && snaps.includes(2), JSON.stringify(snaps));
  check('ウミガメ：網が裂けて薄くなる', (R.seq || []).some((x) => x.net < 0.6), JSON.stringify((R.seq || []).map((x) => +x.net.toFixed(2))));
  check('ウミガメ：切り終わると助かって、ついてくる（報酬 3500）', R.companion === 'turtle' && R.reward === 3500, `companion=${R.companion} reward=${R.reward} time=${R.time}`);

  check('ページエラー 0', errors.length === 0, errors.slice(0, 2).join(' | '));
  const bad = results.filter((r) => !r.ok);
  console.log(bad.length ? `FAILED ${bad.length}/${results.length}` : `ALL PASS ${results.length}`);
  await browser.close(); server.close();
  process.exit(bad.length ? 1 : 0);
})();
