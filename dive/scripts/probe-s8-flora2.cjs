/** S8 flora per-set frame attribution: render flora with only one set visible at a time. */
const http = require('http');
const fs = require('fs');
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('playwright-core')); }
const ARTIFACT = process.argv[2] || path.join(__dirname, '..', 'dist', 'artifact.html');
const OUTFILE = process.argv[3] || '/tmp/s8-flora2.json';

(async () => {
  const server = http.createServer((q, r) => {
    if (q.url.split('?')[0] !== '/a') { r.writeHead(404); r.end(); return; }
    r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    r.end(fs.readFileSync(ARTIFACT));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: process.env.PROBE_CHROME || undefined, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await page.goto(base + '/a');
  await page.waitForFunction(() => window.__THREE_GAME_TEST_HOOKS__, null, { timeout: 120000 });
  await page.evaluate(() => document.getElementById('pr-go')?.click());
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.setState('title'));
  await page.evaluate(() => {
    const g = window.__THREE_GAME_TEST_HOOKS__.game;
    window.__step = (n, dt = 0.05) => {
      const V = g.camera.position.constructor, cp = g.camera.position;
      for (let i = 0; i < n; i++) {
        g.updateDiver(dt);
        g.creatures.update(dt, cp, g.vel, g.camera.getWorldDirection(new V()));
        g.flora.update(cp, g.time);
        g.terrain.update(cp.x, cp.z, g.terrain.radius, 1);
        g.chests.update(cp, dt);
      }
      g.env.update(dt, g.camera, g.renderer, g.time);
    };
  });
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.setState('reef'));
  await page.evaluate(() => window.__step(120));
  const rows = await page.evaluate(() => {
    const g = window.__THREE_GAME_TEST_HOOKS__.game;
    const sets = g.flora.sets;
    const others = [];
    g.scene.traverse((o) => { if (o.isGroup && o !== g.flora.group && o.parent === g.scene) others.push(o); });
    // hide everything except flora group children we control
    const keepVis = new Map();
    g.scene.children.forEach((c) => { keepVis.set(c, c.visible); if (c !== g.flora.group) c.visible = false; });
    g.creatures.group.visible = false; g.terrain.group.visible = false;
    const info = g.renderer.info;
    const measure = () => {
      const auto = info.autoReset; info.autoReset = false; info.reset();
      g.renderer.shadowMap.needsUpdate = false;
      g.renderer.render(g.scene, g.camera);
      const r = { calls: info.render.calls, tris: info.render.triangles };
      info.autoReset = auto;
      return r;
    };
    const out = [];
    sets.forEach((s, i) => { s.group.visible = false; });
    out.push({ i: -1, ...measure() }); // flora empty baseline (water, sky, diver…)
    sets.forEach((s, i) => {
      sets.forEach((t) => { t.group.visible = false; });
      s.group.visible = true;
      out.push({ i, ...measure() });
    });
    sets.forEach((s) => { s.group.visible = true; });
    g.scene.children.forEach((c) => { c.visible = keepVis.get(c) ?? true; });
    return out;
  });
  fs.writeFileSync(OUTFILE, JSON.stringify(rows, null, 1));
  console.log(JSON.stringify(rows));
  await browser.close();
  server.close();
})();
