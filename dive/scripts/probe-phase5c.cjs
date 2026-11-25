/**
 * Phase 5 re-check, round 3: ONLY the two input-driven checks that failed in
 * probe-phase5b.cjs. Root cause found there: updateDiver() begins with
 * input.poll(), which recomputes moveX/moveY from real devices and wipes the
 * values the probe set. This probe stubs poll() out inside the page (test
 * only) so the synthetic input survives.
 *
 * Usage: node scripts/probe-phase5c.cjs [path-to-artifact.html]
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
    g.input.poll = () => {}; // keep synthetic moveY/moveX alive across updateDiver calls
  });

  const edge = await ev(() => {
    const g = window.__THREE_GAME_TEST_HOOKS__.game;
    const h = window.__THREE_GAME_TEST_HOOKS__;
    h.teleport(428, -15, 500);
    g.vel.set(0, 0, 0);
    g.lastEdgeWarn = -99;
    h.look(-Math.PI / 2, 0); // face +x, toward the east wall
    g.input.moveY = 1;
    for (let i = 0; i < 40; i++) g.updateDiver(0.1);
    g.input.moveY = 0;
    const east = { x: g.camera.position.x, toast: document.getElementById('toast').textContent };
    h.teleport(0, -2, -58);
    g.vel.set(0, 0, 0);
    g.lastEdgeWarn = -99;
    h.look(0, 0); // face -z, toward the beach
    g.input.moveY = 1;
    for (let i = 0; i < 10; i++) g.updateDiver(0.05);
    g.input.moveY = 0;
    return { east, shoreToast: document.getElementById('toast').textContent, z: g.camera.position.z };
  });
  check('edge: held at the east wall with the current toast', edge.east.x <= 430 && edge.east.x > 427 && /進めない/.test(edge.east.toast), `x=${edge.east.x.toFixed(1)} toast="${edge.east.toast}"`);
  check('edge: shore side says it is the beach', /浜/.test(edge.shoreToast), `z=${edge.z.toFixed(1)} toast="${edge.shoreToast}"`);

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

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  const fails = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - fails}/${results.length} checks passed`);
  await browser.close();
  server.close();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('PROBE CRASH', e); process.exit(2); });
