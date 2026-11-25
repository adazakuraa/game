/**
 * Phase 5 re-check, round 5: ONLY the items the Sonnet review (PR #24) flagged.
 *  1. discover photo stays visible after a chest card (showDiscover restores display)
 *  2. chart world-edge row/column has no NaN navy line (index clamp)
 *  3. edge toast at a corner names the closest wall; the shore side still says beach
 *  4. cave-top sand fish still on the plateau after spots were allowed over the roof
 * (The pyramid dip is checked in node from layout.ts; the sceneHints dedupe is a
 *  Set construction, verified by inspection.)
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

  // 1. chest card hides the photo; a later discover card must show it again
  const photoFlow = await ev(() => {
    const h = window.__THREE_GAME_TEST_HOOKS__;
    const g = h.game;
    h.openChest('c_reef');
    const afterChest = document.getElementById('disc-photo').style.display;
    g.showDiscover('kusafugu', 'data:image/png;base64,', true);
    const afterDiscover = document.getElementById('disc-photo').style.display;
    return { afterChest, afterDiscover };
  });
  check('discover photo restored after a chest card', photoFlow.afterChest === 'none' && photoFlow.afterDiscover === '', JSON.stringify(photoFlow));

  // 2. chart edge pixels: south world-edge row (lagoon, shallow) must not be navy
  const edgePx = await ev(() => {
    const g = window.__THREE_GAME_TEST_HOOKS__.game;
    g.ensureMinimap();
    const ch = g.minimap.chart;
    const ctx = ch.getContext('2d');
    const rowS = Math.round((1080 + 120 - (-70)) / 2.5); // z = WORLD.minZ
    const colW = Math.round((430 + 120 - (-430)) / 2.5); // x = WORLD.minX
    const rowCave = Math.round((1080 + 120 - 900) / 2.5); // cave plateau latitude
    const px = (x, y) => Array.from(ctx.getImageData(x, y, 1, 1).data.slice(0, 3));
    return {
      south: [px(150, rowS), px(220, rowS), px(290, rowS)],
      westOnPlateau: px(colW, rowCave),
    };
  });
  const isNavy = (p) => p[2] > 80 && p[2] - p[0] > 60 && p[0] < 40;
  check('chart: south world-edge row is shallow, not a navy line', edgePx.south.every((p) => !isNavy(p)), JSON.stringify(edgePx.south));
  check('chart: west world-edge column on the cave plateau is bright, not navy', !isNavy(edgePx.westOnPlateau), JSON.stringify(edgePx.westOnPlateau));

  // 3. corner toast names the closest wall
  const corner = await ev(() => {
    const g = window.__THREE_GAME_TEST_HOOKS__.game;
    const h = window.__THREE_GAME_TEST_HOOKS__;
    // SE corner: 2 m from the east wall, 4 m from the shore — push diagonally
    // (the SW corner is cold water; its warning toast would mask the edge one)
    h.teleport(428, -5, -66);
    g.vel.set(0, 0, 0);
    g.lastEdgeWarn = -99;
    h.look(0, 0);
    g.input.moveX = 1;
    g.input.moveY = 1;
    for (let i = 0; i < 10; i++) g.updateDiver(0.05);
    g.input.moveX = 0;
    g.input.moveY = 0;
    const west = document.getElementById('toast').textContent;
    // pure shore: 2 m from the beach — push toward it
    h.teleport(0, -2, -68);
    g.vel.set(0, 0, 0);
    g.lastEdgeWarn = -99;
    g.input.moveY = 1;
    for (let i = 0; i < 10; i++) g.updateDiver(0.05);
    g.input.moveY = 0;
    return { west, shore: document.getElementById('toast').textContent };
  });
  check('edge: corner toast names the side wall, not the beach', /潮の流れ/.test(corner.west), `toast="${corner.west}"`);
  check('edge: shore toast still says beach', /浜/.test(corner.shore), `toast="${corner.shore}"`);

  // 4. cave-top fish still on the plateau
  await ev(() => window.__THREE_GAME_TEST_HOOKS__.setState('cave'));
  await page.waitForTimeout(2500);
  const kusa = await ev(() => window.__THREE_GAME_TEST_HOOKS__.findSpecies('kusafugu'));
  check('cave-top sand fish on the plateau (y > -5)', !!kusa && kusa.y > -5, JSON.stringify(kusa));

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  const fails = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - fails}/${results.length} checks passed`);
  await browser.close();
  server.close();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('PROBE CRASH', e); process.exit(2); });
