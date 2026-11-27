/**
 * Phase 9 probe (PHASE9-DESIGN §8.1). Currently S0 only (world extension + shore):
 *   - the shore stops the diver (heightAt stays <= -0.8) and says so; it slides instead of sticking
 *   - the creatures never leave the water in the south; no species lives in the new zones yet
 *   - the chart shows the island as land (green), the margin south of the world is land too
 *   - boots with 0 page errors
 * (The terrain-invariance check for z >= -60 is scripts/terrain-dump.ts: dump before/after and compare.)
 * Usage: node scripts/probe-phase9.cjs [dist/artifact.html]   (PROBE_CHROME=<chromium binary>)
 */
const path = require('path');
const http = require('http');
const fs = require('fs');
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('playwright-core')); }
const ARTIFACT = process.argv[2] || path.join(__dirname, '..', 'dist', 'artifact.html');
const EXE = process.env.PROBE_CHROME;
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
  await page.waitForTimeout(900);
  await ev(() => { window.__THREE_GAME_TEST_HOOKS__.game.tut.step = -1; });

  // 1. shore block: swim south (-z) and diagonally into the beach from several x
  const shore = await ev(() => {
    const h = window.__THREE_GAME_TEST_HOOKS__, g = h.game;
    const out = [];
    g.input.poll = () => {}; // synthetic input (poll would recompute moveX/moveY from the devices)
    for (const [x0, yaw] of [[0, 0], [300, 0], [-350, 0], [300, 0.7], [300, -0.7]]) {
      h.teleport(x0, -2, -70);
      g.lastShoreWarn = -99; g.lastEdgeWarn = -99;
      document.getElementById('toast').textContent = '';
      h.look(yaw, 0); // yaw 0 faces -z
      g.input.moveY = 1;
      for (let i = 0; i < 160; i++) g.updateDiver(0.05);
      g.input.moveY = 0;
      const p = g.camera.position;
      out.push({ x0, yaw, x: +p.x.toFixed(1), z: +p.z.toFixed(1), ground: +h.heightAt(p.x, p.z).toFixed(2), toast: document.getElementById('toast').textContent });
    }
    return out;
  });
  console.log('  shore samples', JSON.stringify(shore));
  check('shore: the diver stops short of the land at every entry', shore.every((s) => s.ground <= -0.8 && s.z > -90 && s.z < -70), shore.map((s) => s.z).join(','));
  check('shore: the "beach" toast appears', shore.every((s) => /浜/.test(s.toast)), shore.map((s) => s.toast).join('|'));

  // 2. no creature position is on land (the shore reflection), after letting groups move for a while
  const life = await ev(() => {
    const h = window.__THREE_GAME_TEST_HOOKS__, g = h.game;
    h.teleport(0, -3, -40);
    for (let i = 0; i < 200; i++) g.creatures.update(0.1, g.camera.position, g.vel);
    let south = 0, onLand = 0;
    for (const rt of g.creatures.list) for (const gr of rt.groups) { if (gr.c.z < -45) { south++; if (h.heightAt(gr.c.x, gr.c.z) > -0.6) onLand++; } }
    return { south, onLand, zones: [h.zoneAt(0, -300), h.zoneAt(300, -500)] };
  });
  console.log('  creatures', JSON.stringify(life));
  check('creatures: none on land in the south', life.onLand === 0, JSON.stringify(life));

  // 3. chart: land colour south of the shore and in the south margin; sea unchanged north
  const chart = await ev(() => {
    const g = window.__THREE_GAME_TEST_HOOKS__.game;
    const c = g.minimap.chart, ctx = c.getContext('2d');
    const img = ctx.getImageData(0, 0, c.width, c.height);
    const at = (x, z) => { const [i, j] = g.minimap.px(x, z); const o = (Math.round(j) * c.width + Math.round(i)) * 4; return [img.data[o], img.data[o + 1], img.data[o + 2]]; };
    return { land: [at(0, -300), at(300, -500), at(-300, -200), at(0, -650)], margin: [at(0, -675), at(-425, -690)], sea: at(0, 400), size: [c.width, c.height] };
  });
  console.log('  chart', JSON.stringify(chart));
  const green = (c) => c[1] > c[2] + 25 && c[1] > c[0] - 10 && c[2] < 140; // land is greenish/sandy, not blue
  check('chart: the island is land-coloured', chart.land.every(green), JSON.stringify(chart.land));
  check('chart: the south margin is land-coloured', chart.margin.every(green), JSON.stringify(chart.margin));
  check('chart: open sea still reads as water', chart.sea[2] > chart.sea[0], JSON.stringify(chart.sea));

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close(); server.close();
  const fail = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - fail}/${results.length} passed`);
  process.exit(fail ? 1 : 0);
})();
