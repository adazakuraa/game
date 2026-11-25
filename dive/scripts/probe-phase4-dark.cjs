/**
 * Focused re-check: only the Phase 4 darkness items of probe-phase4.cjs
 * (the rest passed in earlier full runs). Cave + shade, light off:
 * an octopus 8 m away must not be a photo candidate, at 3 m it reads "dark".
 * Usage: node scripts/probe-phase4-dark.cjs [path-to-artifact.html]
 */
const path = require('path');
const http = require('http');
const fs = require('fs');

let chromium;
try { ({ chromium } = require('playwright')); }
catch { try { ({ chromium } = require('playwright-core')); } catch { ({ chromium } = require('/tmp/probe-env/node_modules/playwright-core')); } }

const ARTIFACT = process.argv[2] || path.join(__dirname, '..', 'dist', 'artifact.html');
const EXE = process.env.PROBE_CHROME || '/tmp/probe-env/cft/chrome-headless-shell-linux64/chrome-headless-shell';

(async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(ARTIFACT));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 320, height: 568 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => window.__THREE_GAME_TEST_HOOKS__, null, { timeout: 60000 });
  await page.evaluate(() => {
    const pr = document.getElementById('prologue');
    if (pr && !pr.classList.contains('hidden')) document.getElementById('pr-go').click();
  });
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.setState('cave'));
  await page.waitForFunction(() => window.__THREE_GAME_TEST_HOOKS__.game.state === 'diving', null, { timeout: 240000, polling: 1000 });
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.setPausedForScreenshot(true));
  await page.evaluate(() => { const e = window.__THREE_GAME_TEST_HOOKS__.game.env; e.shade = 1; e.lightOn = false; });
  // findTarget skips species whose mesh is not built yet (not rendered = not visible):
  // visit the octopus's home first and step the simulation so its mesh exists.
  await page.evaluate(() => {
    const h = window.__THREE_GAME_TEST_HOOKS__;
    const f = h.findSpecies('octopus');
    h.teleport(f.x + 2, f.y + 1, f.z + 2);
  });
  await page.evaluate(() => {
    const g = window.__THREE_GAME_TEST_HOOKS__.game;
    const pos = g.camera.position;
    const dir = g.camera.getWorldDirection(g.tmpDir);
    for (let i = 0; i < 12; i++) g.creatures.update(0.25, pos, g.vel, dir);
  });
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.setState('cave'));
  // The cave *entrance* is the open cenote shaft (no roof, not dark). Go to the
  // chamber at the end of CAVE_PATH (-350, 962), which is under the roof, and put
  // the octopus on the tunnel axis in front of the camera at an exact distance.
  // (env.shade is recomputed by updateDiver from caveRoofAt, so position is what matters;
  // the light is forced off — with the beam on, 8 m would legitimately read "dark".)
  const placeInChamber = (dist) => page.evaluate((d) => {
    const h = window.__THREE_GAME_TEST_HOOKS__;
    const g = h.game;
    g.env.lightOn = false;
    h.teleport(-350, -24, 962);
    h.look(Math.PI, -0.05); // face -z... look() sets yaw/pitch; forward is derived from them in updateDiver
    g.updateDiver(0.016);
    const cam = g.camera;
    const fwd = cam.getWorldDirection(g.tmpDir);
    const rt = g.creatures.list.find((r) => r.def.id === 'octopus');
    const a = rt.agents[0];
    rt.groups[a.g].absent = false;
    a.taken = false;
    a.p.copy(cam.position).addScaledVector(fwd, d);
    a.p.y = cam.position.y - 0.4;
    g.creatures.update(0, cam.position, g.vel, fwd);
    rt.active = true; // its group home is far away; the placed agent is what matters here
  }, dist);
  const stepDiver = () => page.evaluate(() => { window.__THREE_GAME_TEST_HOOKS__.game.updateDiver(0.016); });

  await placeInChamber(8);
  await stepDiver();
  const far = await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.targetInfo());
  console.log(`${!far || far.id !== 'octopus' ? 'PASS' : 'FAIL'}  暗所8mは候補にならない  — ${JSON.stringify(far)}`);
  await placeInChamber(3);
  await stepDiver();
  const near = await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.targetInfo());
  const ok = !!near && near.id === 'octopus' && near.reason === 'dark';
  console.log(`${ok ? 'PASS' : 'FAIL'}  暗所3mは dark（影は見える）  — ${JSON.stringify(near)}`);
  console.log('pageerrors:', errors.length);
  await browser.close();
  server.close();
  process.exit(ok && (!far || far.id !== 'octopus') ? 0 : 1);
})().catch((e) => { console.error('PROBE ERROR', e); process.exit(2); });
