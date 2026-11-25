/**
 * Phase 6 checks (PHASE6-DESIGN §8.7):
 *  1. depth display = body-centre depth (level vs pitched)
 *  2. narcosis warning wording at 40-52 m
 *  3. narcosis stage 2: the instruments lie briefly at narc >= 0.55
 *  4. narcosis stage 3: vignette at 5 s, blackout (NARCOSIS) at 10 s in the band
 *  5. urchin mission: 150 s, 27 urchins, 24 edible points
 *  6. urchin end flow: time-of-day change -> menu, no change -> diner
 *  7. pause menu: surface button only with the signal float
 *  8. diner time button: hidden without the light by day, "make night" with it, "make morning" at night
 * (Air display is bar-only — verified by a text sweep of the sources, no probe needed.)
 */
const path = require('path');
const http = require('http');
const fs = require('fs');

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
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const { server, url } = await serveArtifact(ARTIFACT);
  await page.goto(url);
  await page.waitForFunction(() => window.__THREE_GAME_TEST_HOOKS__, null, { timeout: 60000 });
  const ev = (fn, arg) => page.evaluate(fn, arg);
  await ev(() => { const b = document.getElementById('pr-go'); if (b) b.click(); });
  await page.waitForTimeout(1200);
  await ev(() => window.__THREE_GAME_TEST_HOOKS__.setState('reef'));
  await page.waitForTimeout(3000);
  await ev(() => {
    const g = window.__THREE_GAME_TEST_HOOKS__.game;
    g.tut.step = -1;
    g.input.poll = () => {};
  });

  // 1. body-centre depth display (expected value computed independently from the
  // camera matrix: look direction = -(3rd column), centre = eye + dirY * 0.85)
  const depth = await ev(() => {
    const h = window.__THREE_GAME_TEST_HOOKS__;
    const g = h.game;
    h.setPausedForScreenshot(true);
    const read = () => {
      g.camera.updateMatrixWorld();
      const e = g.camera.matrixWorld.elements;
      const expected = Math.max(0, -g.camera.position.y + (-e[9]) * 0.85);
      g.updateHud(0.05);
      return { shown: parseFloat(document.getElementById('depth-value').textContent), expected };
    };
    h.teleport(300, -20, 600);
    h.look(0, 0);
    g.updateDiver(0.05); // look() only sets yaw/pitch; the camera turns in updateDiver
    const level = read();
    h.look(0, 0.6);
    g.updateDiver(0.05);
    const pitched = read();
    h.setPausedForScreenshot(false);
    return { level, pitched };
  });
  check('depth: level look shows the eye depth (20 m)', Math.abs(depth.level.shown - 20) <= 0.2 && Math.abs(depth.level.shown - depth.level.expected) <= 0.15, JSON.stringify(depth.level));
  check('depth: pitched look shows the body-centre depth', Math.abs(depth.pitched.shown - depth.pitched.expected) <= 0.15 && Math.abs(depth.pitched.shown - depth.level.shown) > 0.2, JSON.stringify(depth.pitched));

  // 2. narcosis warning wording (45 m in the blue hole; move once if a down-current wins)
  const warn = await ev(() => {
    const h = window.__THREE_GAME_TEST_HOOKS__;
    const g = h.game;
    const read = () => { g.updateHud(0.05); return document.getElementById('depth-warn').textContent; };
    h.teleport(300, -45, 600);
    let t = read();
    if (/ダウンカレント/.test(t)) { h.teleport(300, -45, 555); t = read(); }
    return t;
  });
  check('narcosis: warning names the actual effects at 40-52 m', /窒素酔い：エア消費増・視界が揺れる/.test(warn), `warn="${warn}"`);

  // 3. stage 2: instrument blur at narc >= 0.55 (51 m)
  const blur = await ev(() => {
    const h = window.__THREE_GAME_TEST_HOOKS__;
    const g = h.game;
    h.teleport(300, -51, 600);
    g.vel.set(0, 0, 0);
    let seen = false;
    for (let i = 0; i < 200 && !seen; i++) { g.updateDiver(0.05); if (g.narcBlur > 0) seen = true; }
    return { seen, diff: g.displayYaw() - g.yaw, narc: g.narc };
  });
  check('narcosis stage 2: instruments falsify the heading briefly', blur.seen && Math.abs(blur.diff - 2.2) < 0.01, JSON.stringify(blur));

  // 4. stage 3: vignette at 5 s, blackout at 10 s (56 m)
  const blackout = await ev(() => {
    const h = window.__THREE_GAME_TEST_HOOKS__;
    const g = h.game;
    h.teleport(300, -56, 600);
    g.vel.set(0, 0, 0);
    let bandWarn = null;
    for (let i = 0; i < 30; i++) g.updateDiver(0.05);
    g.updateHud(0.05);
    bandWarn = document.getElementById('depth-warn').textContent;
    let deepAt5 = null;
    for (let i = 30; i < 110; i++) g.updateDiver(0.05);
    g.updateHud(0.05);
    deepAt5 = document.getElementById('narc').classList.contains('deep');
    let steps = 110;
    while (g.state === 'diving' && steps < 260) { g.updateDiver(0.05); steps++; }
    return {
      bandWarn, deepAt5, steps, state: g.state,
      kicker: document.getElementById('res-kicker').textContent,
      title: document.getElementById('res-title').textContent,
    };
  });
  check('narcosis stage 3: the band itself warns in text', /窒素酔い：このままでは意識を失う/.test(blackout.bandWarn ?? ''), JSON.stringify(blackout.bandWarn));
  check('narcosis stage 3: vignette closes in after 5 s in the band', blackout.deepAt5 === true, JSON.stringify(blackout));
  check('narcosis stage 3: blackout rescue at ~10 s with its own result text', blackout.state !== 'diving' && blackout.kicker === 'NARCOSIS' && /窒素酔い/.test(blackout.title), JSON.stringify(blackout));

  // back to the title
  await ev(() => document.getElementById('res-ok').click());
  await page.waitForTimeout(600);

  // 5 + 6. urchin mission and its end flow
  const urchin = await ev(() => {
    const h = window.__THREE_GAME_TEST_HOOKS__;
    const g = h.game;
    g.save.clock = 0;
    g.quickUrchin();
    return true;
  });
  await page.waitForTimeout(3000);
  const umi = await ev(() => {
    const g = window.__THREE_GAME_TEST_HOOKS__.game;
    // the harvest begins once diveTime passes 0.6 s; the headless loop is slow, so step it
    for (let i = 0; i < 80 && !g.missions.active; i++) g.updateDiver(0.05);
    const m = g.missions;
    const counts = [0, 0, 0, 0];
    let pts = 0;
    const PTS = [1, 2, 0, 0];
    m.itemType.forEach((t) => { counts[t]++; pts += PTS[t]; });
    return { state: g.state, time: m.active?.time, items: m.items.length, counts, pts };
  });
  check('urchin: 150 s limit', umi.time === 150, JSON.stringify(umi));
  check('urchin: 27 placed (12/6/5/4), 24 edible points', umi.items === 27 && umi.counts.join() === '12,6,5,4' && umi.pts === 24, JSON.stringify(umi));

  const flowA = await ev(() => {
    const g = window.__THREE_GAME_TEST_HOOKS__.game;
    g.save.owned = [...new Set([...(g.save.owned ?? []), 'torch'])];
    g.save.clock = 0;
    g.quick.ok = true;
    g.endDive('surface');
    const backAtDiner = !document.getElementById('kitchen').classList.contains('hidden');
    document.getElementById('k-sleep').click(); // "make night" right after the harvest
    return {
      backAtDiner,
      kitchenHidden: document.getElementById('kitchen').classList.contains('hidden'),
      clock: g.save.clock,
    };
  });
  check('urchin end: back at the diner first, then the time button returns to the menu', flowA.backAtDiner && flowA.kitchenHidden && flowA.clock >= 780, JSON.stringify(flowA));

  const flowB = await ev(() => {
    const g = window.__THREE_GAME_TEST_HOOKS__.game;
    g.save.clock = 0;
    g.kitchen.open(); // an ordinary diner visit, not after a harvest
    document.getElementById('k-sleep').click();
    return { kitchenHidden: document.getElementById('kitchen').classList.contains('hidden'), clock: g.save.clock };
  });
  check('urchin end: an ordinary diner visit stays in the diner on the time button', flowB.kitchenHidden === false && flowB.clock >= 780, JSON.stringify(flowB));

  // 7. pause menu surfacing
  await ev(() => window.__THREE_GAME_TEST_HOOKS__.setState('reef'));
  await page.waitForTimeout(3000);
  const pause = await ev(() => {
    const g = window.__THREE_GAME_TEST_HOOKS__.game;
    g.tut.step = -1;
    g.input.poll = () => {};
    g.save.owned = (g.save.owned ?? []).filter((id) => id !== 'float');
    g.setPaused(true);
    const without = document.getElementById('abort').classList.contains('hidden');
    g.setPaused(false);
    g.save.owned = [...(g.save.owned ?? []), 'float'];
    g.setPaused(true);
    const withFloat = document.getElementById('abort').classList.contains('hidden');
    g.setPaused(false);
    return { without, withFloat };
  });
  check('pause: no surface button without the float, shown with it', pause.without === true && pause.withFloat === false, JSON.stringify(pause));

  // 8. diner time button
  await ev(() => document.getElementById('res-ok')?.click());
  await ev(() => window.__THREE_GAME_TEST_HOOKS__.game.toTitle());
  const timeBtn = await ev(() => {
    const g = window.__THREE_GAME_TEST_HOOKS__.game;
    const read = () => {
      g.kitchen.open();
      const b = document.getElementById('k-sleep');
      const r = { hidden: b.classList.contains('hidden'), text: b.textContent };
      g.kitchen.close?.();
      document.getElementById('kitchen').classList.add('hidden');
      return r;
    };
    g.save.clock = 0;
    g.save.owned = (g.save.owned ?? []).filter((id) => id !== 'torch');
    const noTorch = read();
    g.save.owned = [...(g.save.owned ?? []), 'torch'];
    const day = read();
    g.save.clock = 800;
    const night = read();
    return { noTorch, day, night };
  });
  check('time button: hidden by day without the light', timeBtn.noTorch.hidden === true, JSON.stringify(timeBtn.noTorch));
  check('time button: "make night" by day with the light', !timeBtn.day.hidden && /夜にする/.test(timeBtn.day.text), JSON.stringify(timeBtn.day));
  check('time button: "make morning" at night', !timeBtn.night.hidden && /朝にする/.test(timeBtn.night.text), JSON.stringify(timeBtn.night));

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  const fails = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - fails}/${results.length} checks passed`);
  await browser.close();
  server.close();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('PROBE CRASH', e); process.exit(2); });
