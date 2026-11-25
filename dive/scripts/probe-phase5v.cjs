/**
 * Phase 5 visual checks (§9.9 eyeball items). page.screenshot captures stale
 * composited frames under SwiftShader, so each viewpoint is rendered
 * synchronously in-page and read back from the WebGL canvas in the same task.
 * Output: /tmp/p5v-<name>.png + /tmp/p5v-chart.png (after the kelp feathering).
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

  const capture = async (name, setup) => {
    const dataUrl = await ev((s) => {
      const h = window.__THREE_GAME_TEST_HOOKS__;
      const g = h.game;
      if (s.state) return Promise.resolve(h.setState(s.state)).then(() => new Promise((res) => setTimeout(() => res(s), 400)));
      return s;
    }, setup).then((s) => ev((s2) => {
      const h = window.__THREE_GAME_TEST_HOOKS__;
      const g = h.game;
      g.tut.step = -1;
      if (s2.tp) h.teleport(s2.tp[0], s2.tp[1], s2.tp[2]);
      if (s2.look) h.look(s2.look[0], s2.look[1]);
      g.updateDiver(0.05);
      g.env.update(0.05, g.camera, g.renderer, g.time);
      g.renderer.render(g.scene, g.camera);
      return g.renderer.domElement.toDataURL('image/png');
    }, s));
    fs.writeFileSync(`/tmp/p5v-${name}.png`, Buffer.from(dataUrl.split(',')[1], 'base64'));
    console.log('captured', name);
  };

  await capture('pyramid-front', { state: 'ruins', tp: [-330, -13, 562], look: [0, -0.08] });
  await capture('pyramid-oblique', { tp: [-268, -7, 568], look: [0.74, -0.18] });
  await capture('cave-top', { tp: [-330, -1.7, 905], look: [2.6, -1.2] });
  await capture('cave-inside', { state: 'cave' });
  await capture('bluehole', { state: 'bluehole', tp: [300, -16, 548], look: [0, 0.25] });

  const chartUrl = await ev(() => {
    const g = window.__THREE_GAME_TEST_HOOKS__.game;
    g.ensureMinimap();
    return g.minimap.chart.toDataURL('image/png');
  });
  fs.writeFileSync('/tmp/p5v-chart.png', Buffer.from(chartUrl.split(',')[1], 'base64'));
  console.log('captured chart; page errors:', errors.length);
  await browser.close();
  server.close();
})().catch((e) => { console.error('PROBE CRASH', e); process.exit(2); });
