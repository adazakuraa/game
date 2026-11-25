/**
 * Phase 5 re-check probe: ONLY the items that failed in probe-phase5.cjs
 * (user's rule: never re-run checks that already passed).
 *  1. no page errors across boot + several dive starts (dex-total regression)
 *  2. world-edge toast now fires when the pushback holds the player at the wall
 *  3. chestReady appears after the goChest hook fix (stand within open radius)
 *  4. golden fins speed ratio, measured in open offshore water (no teleport per step)
 *  5. marine snow in the deep, via direct env.update calls (frame-starved headless)
 *
 * Usage: node scripts/probe-phase5b.cjs [path-to-artifact.html]
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
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('ERR_TUNNEL')) errors.push(m.text()); });
  const { server, url } = await serveArtifact(ARTIFACT);
  await page.goto(url);
  await page.waitForFunction(() => window.__THREE_GAME_TEST_HOOKS__, null, { timeout: 60000 });
  const ev = (fn, arg) => page.evaluate(fn, arg);
  await ev(() => { const b = document.getElementById('pr-go'); if (b) b.click(); });
  await page.waitForTimeout(1200);

  // 2 (setup shared): enter dives at several points — also feeds check 1
  for (const s of ['reef', 'lagoon', 'ruins']) {
    await ev((st) => window.__THREE_GAME_TEST_HOOKS__.setState(st), s);
    await page.waitForTimeout(900);
  }
  await ev(() => { const g = window.__THREE_GAME_TEST_HOOKS__.game; g.tut.step = -1; });

  // 2. edge toast at the east wall (offshore, warm water: no cold toast race)
  const edge = await ev(() => {
    const g = window.__THREE_GAME_TEST_HOOKS__.game;
    const h = window.__THREE_GAME_TEST_HOOKS__;
    h.teleport(428, -15, 500);
    g.lastEdgeWarn = -99;
    h.look(-Math.PI / 2, 0); // face +x
    g.input.moveY = 1;
    for (let i = 0; i < 40; i++) g.updateDiver(0.1);
    g.input.moveY = 0;
    const east = { x: g.camera.position.x, toast: document.getElementById('toast').textContent };
    // shore side: face -z at the lagoon beach edge
    h.teleport(0, -2, -58);
    g.lastEdgeWarn = -99;
    h.look(0, 0);
    g.input.moveY = 1;
    for (let i = 0; i < 10; i++) g.updateDiver(0.05);
    g.input.moveY = 0;
    return { east, shoreToast: document.getElementById('toast').textContent, z: g.camera.position.z };
  });
  check('edge: held at the east wall with the current toast', edge.east.x <= 430 && edge.east.x > 424 && /進めない/.test(edge.east.toast), `x=${edge.east.x.toFixed(1)} toast="${edge.east.toast}"`);
  check('edge: shore side says it is the beach', /浜/.test(edge.shoreToast), `z=${edge.z.toFixed(1)} toast="${edge.shoreToast}"`);

  // 3. chestReady with the fixed hook
  const ready = await ev(() => {
    const h = window.__THREE_GAME_TEST_HOOKS__;
    const g = h.game;
    h.goChest('c_reef');
    g.updateDiver(0.05);
    return g.chestReady;
  });
  check('chests: shutter target appears within reach', ready === 'c_reef', `ready=${ready}`);

  // 4. golden fins in open water
  const spd = async (owned) => ev((ow) => {
    const g = window.__THREE_GAME_TEST_HOOKS__.game;
    const h = window.__THREE_GAME_TEST_HOOKS__;
    g.save.owned = ow;
    h.teleport(0, -15, 500);
    g.vel.set(0, 0, 0);
    h.look(0, 0);
    g.input.moveY = 1;
    let v = 0;
    for (let i = 0; i < 40; i++) { g.updateDiver(0.1); v = g.vel.length(); }
    g.input.moveY = 0;
    return v;
  }, owned);
  const base = await spd([]);
  const boost = await spd(['goldfins']);
  check('gear: golden fins raise speed to ×1.1', base > 1.5 && Math.abs(boost / base - 1.1) < 0.04, `base=${base.toFixed(2)} with=${boost.toFixed(2)} ratio=${(boost / base).toFixed(3)}`);

  // 5. marine snow via direct env updates
  const snow = await ev(() => {
    const g = window.__THREE_GAME_TEST_HOOKS__.game;
    const h = window.__THREE_GAME_TEST_HOOKS__;
    h.teleport(0, -10, 500);
    for (let i = 0; i < 3; i++) g.env.update(0.05, g.camera, g.renderer, g.time);
    const shallow = { uAmb: g.env.snowMat.uniforms.uAmb.value };
    h.teleport(0, -200, 900);
    for (let i = 0; i < 3; i++) g.env.update(0.05, g.camera, g.renderer, g.time);
    return { shallow, deep: { uAmb: g.env.snowMat.uniforms.uAmb.value, vis: g.env.snow.visible } };
  });
  check('marine snow: none in shallow water (uAmb = 0)', snow.shallow.uAmb === 0, JSON.stringify(snow.shallow));
  check('marine snow: present in the deep', snow.deep.vis === true && snow.deep.uAmb > 0.02, JSON.stringify(snow.deep));

  // 1. page errors across everything above
  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  const fails = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - fails}/${results.length} checks passed`);
  await browser.close();
  server.close();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('PROBE CRASH', e); process.exit(2); });
