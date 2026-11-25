/**
 * Phase 4 verification probe (see docs/PHASE4-DESIGN.md §7 / §9.6).
 * Opens dist/artifact.html in headless Chromium (SwiftShader) and checks:
 * distribution metrics, curious-follow timing, bait lure, photo targeting,
 * the octopus grab, weather multipliers and the diner's weather line / bait shelf.
 *
 * Usage: node scripts/probe-phase4.cjs [path-to-artifact.html]
 * Needs playwright (or playwright-core) and a Chromium: set PROBE_CHROME to the binary.
 * Headless SwiftShader runs at well under 1 fps here, so the probe does not wait on the
 * render loop: it dismisses the prologue, pauses the game, and steps
 * creatures.update() / updateDiver() by hand for exact game-time control.
 */
const path = require('path');
const http = require('http');
const fs = require('fs');

/** Serve the artifact over HTTP with an explicit UTF-8 charset (the artifact strips
 *  <meta charset> for its host page, so file:// loads can be mis-decoded). */
function serveArtifact(file) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fs.readFileSync(file));
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/` }));
  });
}

let chromium;
try { ({ chromium } = require('playwright')); }
catch { try { ({ chromium } = require('playwright-core')); } catch { ({ chromium } = require('/tmp/probe-env/node_modules/playwright-core')); } }

const ARTIFACT = process.argv[2] || path.join(__dirname, '..', 'dist', 'artifact.html');
const EXE = process.env.PROBE_CHROME || '/tmp/probe-env/cft/chrome-headless-shell-linux64/chrome-headless-shell';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 320, height: 568 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('ERR_TUNNEL')) errors.push(m.text()); });
  const { server, url } = await serveArtifact(ARTIFACT);
  await page.goto(url);
  await page.waitForFunction(() => window.__THREE_GAME_TEST_HOOKS__, null, { timeout: 60000 });
  const H = () => window.__THREE_GAME_TEST_HOOKS__;
  /** Step the creature simulation by hand (game paused): exact game-time control. */
  const stepCreatures = (secs) => page.evaluate((s) => {
    const g = window.__THREE_GAME_TEST_HOOKS__.game;
    const pos = g.camera.position;
    const dir = g.camera.getWorldDirection(g.tmpDir);
    let left = s;
    while (left > 0) { const d = Math.min(0.25, left); g.creatures.update(d, pos, g.vel, dir); left -= d; }
  }, secs);
  const stepDiver = (dt) => page.evaluate((d) => { window.__THREE_GAME_TEST_HOOKS__.game.updateDiver(d); }, dt);

  // ---------- boot: dismiss the prologue, go to the reef, pause ----------
  await page.evaluate(() => {
    const pr = document.getElementById('prologue');
    if (pr && !pr.classList.contains('hidden')) document.getElementById('pr-go').click();
  });
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.setState('reef'));
  await page.waitForFunction(() => window.__THREE_GAME_TEST_HOOKS__.game.state === 'diving', null, { timeout: 240000, polling: 1000 });
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.setPausedForScreenshot(true));

  // ---------- reef distribution ----------
  await stepCreatures(8);
  const spread = await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.spreadStats(40));
  console.log('spreadStats:', JSON.stringify(spread));
  check('魚のいないサンゴが30%以下', spread.emptyPct <= 30, `emptyPct=${spread.emptyPct} corals=${spread.corals}`);
  check('4種以上のマスが旧計測（19マス・最大11種）から大幅減', spread.cells4plus <= 12 && spread.maxSpecies <= 7, `cells4plus=${spread.cells4plus} maxSpecies=${spread.maxSpecies}`);

  // ---------- curious follow (dolphin), stepped by hand ----------
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.callCurious('dolphin'));
  await stepCreatures(2);
  let cur = await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.curiousState('dolphin'));
  check('イルカがついてくる状態になる', cur[0].cur === 1, JSON.stringify(cur[0]));
  let t = 2, leftAt = -1;
  while (t < 45) {
    await stepCreatures(2); t += 2;
    cur = await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.curiousState('dolphin'));
    if (cur[0].cur === 2) { leftAt = t; break; }
  }
  check('約30秒で離れていく（28〜36秒）', leftAt >= 28 && leftAt <= 36, `leftAt=${leftAt}s`);
  const distOf = () => page.evaluate(() => {
    const g = window.__THREE_GAME_TEST_HOOKS__.game;
    const rt = g.creatures.list.find((r) => r.def.id === 'dolphin');
    return rt.groups[0].c.distanceTo(g.camera.position);
  });
  const dBefore = await distOf();
  await stepCreatures(15);
  const dAfter = await distOf();
  check('離れたあとは距離が広がる', dAfter > dBefore + 3, `${dBefore.toFixed(1)}m -> ${dAfter.toFixed(1)}m`);

  // ---------- bait ----------
  await page.evaluate(() => {
    const g = window.__THREE_GAME_TEST_HOOKS__.game;
    g.save.tutorial = true;
    window.__THREE_GAME_TEST_HOOKS__.giveBait(3);
  });
  const baitSets = {};
  for (const kind of ['krill', 'chunk', 'weed']) {
    await page.evaluate((k) => window.__THREE_GAME_TEST_HOOKS__.dropBait(k), kind);
    await stepCreatures(9);
    const info = await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.baitInfo());
    baitSets[kind] = info;
    console.log(`bait ${kind}:`, JSON.stringify(info));
    check(`餌 ${kind}：10匹以下・3種以下`, !!info && info.fish <= 10 && info.species.length <= 3, `fish=${info?.fish} species=${info?.species.length}`);
  }
  const setsDiffer = JSON.stringify(baitSets.krill?.species) !== JSON.stringify(baitSets.chunk?.species)
    || JSON.stringify(baitSets.krill?.species) !== JSON.stringify(baitSets.weed?.species);
  check('餌の種類で寄る種が変わる', setsDiffer, `krill=${baitSets.krill?.species} chunk=${baitSets.chunk?.species} weed=${baitSets.weed?.species}`);
  const held = await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.game.save.bait);
  check('まくたびに手持ちが1減る', held.krill === 2 && held.chunk === 2 && held.weed === 2, JSON.stringify(held));

  // bait buttons do not overlap the other controls (portrait + landscape)
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.game.updateHud(0.016));
  for (const vp of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(vp);
    await page.waitForTimeout(400);
    const overlap = await page.evaluate(() => {
      const r = (id) => document.getElementById(id).getBoundingClientRect();
      const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      const bait = r('btn-bait'), kind = r('btn-bait-kind'), shut = r('btn-shutter'), tool = r('btn-tool');
      return { baitTool: hit(bait, tool), baitShutter: hit(bait, shut), kindBait: hit(kind, bait), baitVisible: bait.width > 0 };
    });
    check(`餌ボタンが重ならない (${vp.width}x${vp.height})`, overlap.baitVisible && !overlap.baitTool && !overlap.baitShutter && !overlap.kindBait, JSON.stringify(overlap));
  }
  await page.setViewportSize({ width: 320, height: 568 });

  // ---------- photo targeting ----------
  const probeNear = await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.probe('dolphin', 3));
  console.log('probe near:', JSON.stringify(probeNear));
  check('目の前3mは ok', !!probeNear && probeNear.id === 'dolphin' && probeNear.reason === 'ok', JSON.stringify(probeNear));
  const clear = probeNear?.clear ?? 20;
  const probeMurky = await page.evaluate((d) => window.__THREE_GAME_TEST_HOOKS__.probe('dolphin', d), Math.round(clear * 1.15));
  console.log('probe murky:', JSON.stringify(probeMurky));
  check('霞の距離では murky か対象外', !probeMurky || probeMurky.id !== 'dolphin' || probeMurky.reason === 'murky', JSON.stringify(probeMurky));
  const probeFar = await page.evaluate((d) => window.__THREE_GAME_TEST_HOOKS__.probe('dolphin', d), Math.round(clear * 1.6));
  console.log('probe far:', JSON.stringify(probeFar));
  check('霞の向こうは候補にならない', !probeFar || probeFar.id !== 'dolphin', JSON.stringify(probeFar));

  // darkness: in the cave (shade), a fish 8 m away is not a candidate, at 3 m it reads "dark"
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.setState('cave'));
  await page.waitForFunction(() => window.__THREE_GAME_TEST_HOOKS__.game.state === 'diving', null, { timeout: 240000, polling: 1000 });
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.setPausedForScreenshot(true));
  // env.update() runs on the render loop (paused here), so set the cave's shade by hand;
  // the light stays off: with the beam on, 8 m would legitimately read as "dark" (§4).
  // (showcase's pin does not move static species, so place the octopus with placeOcto
  // and move the camera to an exact distance from it, facing it.)
  await page.evaluate(() => { const e = window.__THREE_GAME_TEST_HOOKS__.game.env; e.shade = 1; e.lightOn = false; });
  // findTarget skips species whose mesh is not built yet: visit its home and step
  // the simulation so the mesh exists before placing it in the cave.
  await page.evaluate(() => {
    const h = window.__THREE_GAME_TEST_HOOKS__;
    const f = h.findSpecies('octopus');
    h.teleport(f.x + 2, f.y + 1, f.z + 2);
  });
  await stepCreatures(3);
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.setState('cave'));
  await page.evaluate(() => { const e = window.__THREE_GAME_TEST_HOOKS__.game.env; e.shade = 1; e.lightOn = false; });
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.placeOcto('octopus'));
  const faceOctoAt = (dist) => page.evaluate((d) => {
    const h = window.__THREE_GAME_TEST_HOOKS__;
    const g = h.game;
    const f = h.findSpecies('octopus');
    const cam = g.camera.position;
    // keep the camera's current horizontal offset direction, scaled to the wanted distance
    let dx = cam.x - f.x, dz = cam.z - f.z;
    const len = Math.hypot(dx, dz) || 1;
    dx = (dx / len) * Math.sqrt(Math.max(0.1, d * d - 0.09));
    dz = (dz / len) * Math.sqrt(Math.max(0.1, d * d - 0.09));
    h.teleport(f.x + dx, f.y + 0.3, f.z + dz);
    const tx = f.x - (f.x + dx), ty = f.y - (f.y + 0.3), tz = f.z - (f.z + dz);
    h.look(Math.atan2(-tx, -tz), Math.atan2(ty, Math.hypot(tx, tz)));
  }, dist);
  await faceOctoAt(8);
  await stepDiver(0.016);
  const darkFar = await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.targetInfo());
  check('暗所8mは候補にならない', !darkFar || darkFar.id !== 'octopus', JSON.stringify(darkFar));
  await faceOctoAt(3);
  await stepDiver(0.016);
  const darkNear = await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.targetInfo());
  check('暗所3mは dark（影は見える）', !!darkNear && darkNear.id === 'octopus' && darkNear.reason === 'dark', JSON.stringify(darkNear));

  // ---------- octopus grab ----------
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.setState('rocky'));
  await page.waitForFunction(() => window.__THREE_GAME_TEST_HOOKS__.game.state === 'diving', null, { timeout: 240000, polling: 1000 });
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.setPausedForScreenshot(true));
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.placeOcto('octopus'));
  await page.evaluate(() => {
    const h = window.__THREE_GAME_TEST_HOOKS__;
    const f = h.findSpecies('octopus');
    h.teleport(f.x + 0.4, f.y + 0.25, f.z + 0.2);
  });
  const air0 = await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.octo());
  for (let i = 0; i < 16; i++) {
    await stepCreatures(0.25);
    const o = await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.octo());
    if (o.grab) break;
  }
  await stepDiver(0.016); // process the grab event (air -3, toasts)
  const grabbed = await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.octo());
  check('タコに絡まれる', grabbed.grab, JSON.stringify(grabbed));
  check('絡まれた瞬間にエアが減る', grabbed.air < air0.air - 2, `air ${air0.air} -> ${grabbed.air}`);
  await stepDiver(1.0);
  await stepDiver(1.0);
  const draining = await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.octo());
  check('絡まれている間もエアが減り続ける', draining.air < grabbed.air - 1, `air ${grabbed.air} -> ${draining.air}`);
  for (let i = 0; i < (grabbed.need || 6); i++) {
    await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.game.input.press('shutter'));
    await stepDiver(0.016);
  }
  const released = await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.octo());
  check('シャッター連打で振りほどける', !released.grab, `need=${grabbed.need} taps=${released.taps}`);

  // ---------- weather ----------
  const wmIds = ['dolphin', 'octopus', 'aoriika', 'gardeneel', 'stingray', 'lobster', 'isopod', 'wamondako', 'knifejaw'];
  const wm = await page.evaluate((ids) => {
    const h = window.__THREE_GAME_TEST_HOOKS__;
    const out = {};
    for (const id of ids) for (const w of ['sunny', 'cloudy', 'rain', 'storm']) out[id + '/' + w] = h.weatherMult(id, w);
    return out;
  }, wmIds);
  const wmBad = Object.entries(wm).filter(([, v]) => v === null || v < 0.75 || v > 1.35);
  check('天候の出現倍率が0.75〜1.35に収まる', wmBad.length === 0, wmBad.length ? JSON.stringify(wmBad) : 'all in range');
  const wmVaries = new Set(Object.values(wm)).size > 2;
  check('天候で倍率が実際に変わる', wmVaries, `distinct=${new Set(Object.values(wm)).size}`);

  // ---------- diner: weather line + bait shelf ----------
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.setState('title'));
  await page.waitForTimeout(800);
  const diner = await page.evaluate(() => {
    const h = window.__THREE_GAME_TEST_HOOKS__;
    const g = h.game;
    g.save.tutorial = true;
    g.save.money = 10000;
    g.save.day = 3;
    g.save.boardOn = true;
    g.save.okami = { lore: 5, ev: 'morning' };
    g.kitchen.open();
    const line = document.getElementById('k-okami').textContent;
    const status = document.getElementById('k-status').textContent;
    const shelf = document.getElementById('k-bait').textContent;
    const moneyBefore = g.save.money;
    const krillBefore = g.save.bait?.krill ?? 0;
    document.querySelector('#k-bait [data-bait="krill"]').click();
    return { line, status, shelf, moneyBefore, moneyAfter: g.save.money, krillBefore, krill: g.save.bait?.krill ?? 0 };
  });
  console.log('diner:', JSON.stringify(diner));
  check('朝の女将さんの一言が天候', diner.line.includes('おはよう。今日は'), diner.line.slice(0, 40));
  check('食堂の状態行に天気', diner.status.includes('天気'), diner.status.slice(0, 60));
  check('餌の棚に3種並ぶ', diner.shelf.includes('オキアミ') && diner.shelf.includes('切り身') && diner.shelf.includes('海藻だんご'), '');
  check('餌を買うと3回分増えて代金が引かれる', diner.krill === diner.krillBefore + 3 && diner.moneyAfter === diner.moneyBefore - 300, `krill=${diner.krillBefore}->${diner.krill} money ${diner.moneyBefore}->${diner.moneyAfter}`);

  check('ページエラーなし', errors.length === 0, errors.slice(0, 3).join(' | '));

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  await browser.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('PROBE ERROR', e); process.exit(2); });
