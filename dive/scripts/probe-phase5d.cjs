/** Phase 5 re-check, round 4: ONLY the shore-side edge toast, at the real
 *  world edge (WORLD.minZ = -70; round 3 teleported to -58, which is 12 m
 *  inside the world, so nothing fired and the toast read was stale). */
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
  await ev(() => window.__THREE_GAME_TEST_HOOKS__.setState('lagoon'));
  await page.waitForTimeout(3000);
  const r = await ev(() => {
    const g = window.__THREE_GAME_TEST_HOOKS__.game;
    const h = window.__THREE_GAME_TEST_HOOKS__;
    g.tut.step = -1;
    g.input.poll = () => {};
    h.teleport(0, -2, -84.3);
    g.vel.set(0, 0, -2.4);
    g.lastEdgeWarn = -99; g.lastShoreWarn = -99;
    h.look(0, 0); // face -z, toward the beach at the shore (Phase 9: z≈-84)
    g.input.moveY = 1;
    for (let i = 0; i < 10; i++) g.updateDiver(0.05);
    g.input.moveY = 0;
    return { z: g.camera.position.z, toast: document.getElementById('toast').textContent };
  });
  const ok = r.z >= -90 && /浜/.test(r.toast);
  console.log(`${ok ? 'PASS' : 'FAIL'}  edge: shore side says it is the beach  — z=${r.z.toFixed(1)} toast="${r.toast}"`);
  console.log(errors.length === 0 ? 'PASS  no page errors' : `FAIL  page errors: ${errors[0]}`);
  await browser.close();
  server.close();
  process.exit(ok && errors.length === 0 ? 0 : 1);
})().catch((e) => { console.error('PROBE CRASH', e); process.exit(2); });
