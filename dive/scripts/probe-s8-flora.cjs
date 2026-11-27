/** S8 flora census: per-set geometry triangles (lo/hi/far), cells, instances, casters. */
const http = require('http');
const fs = require('fs');
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('playwright-core')); }
const ARTIFACT = process.argv[2] || path.join(__dirname, '..', 'dist', 'artifact.html');
const OUTFILE = process.argv[3] || '/tmp/s8-flora.json';

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
  const census = await page.evaluate(() => {
    const g = window.__THREE_GAME_TEST_HOOKS__.game;
    const tris = (geo) => geo ? (geo.index ? geo.index.count : geo.attributes.position.count) / 3 : null;
    return g.flora.sets.map((s, i) => {
      let cells = 0, inst = 0, drawn = 0, casters = 0;
      const geos = new Set();
      s.group.traverse((o) => {
        if (o.isInstancedMesh || o.isMesh) {
          cells++;
          const n = o.count ?? 1;
          inst += n;
          drawn += tris(o.geometry) * n;
          if (o.castShadow) casters++;
          geos.add(o.geometry.uuid);
        }
      });
      let matName = '';
      s.group.traverse((o) => { if (!matName && o.material) matName = (Array.isArray(o.material) ? o.material[0] : o.material).name || ''; });
      return {
        i, mat: matName,
        lo: tris(s['loGeo']), hi: tris(s['hiGeo']), far: tris(s['farGeo']),
        view: s.viewDist, cells, inst, drawn, casters, geos: geos.size,
      };
    }).sort((a, b) => b.drawn - a.drawn);
  });
  fs.writeFileSync(OUTFILE, JSON.stringify(census, null, 1));
  console.log(JSON.stringify(census));
  await browser.close();
  server.close();
})();
