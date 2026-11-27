/** S8 breakdown: reef triangles / shadow pass by group, texture bytes by category.
 *  Writes results incrementally to OUTFILE so a lost session keeps partial data. */
const http = require('http');
const fs = require('fs');
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('playwright-core')); }
const ARTIFACT = process.argv[2] || path.join(__dirname, '..', 'dist', 'artifact.html');
const OUTFILE = process.argv[3] || '/tmp/s8-breakdown.json';
const out = {};
const save = () => fs.writeFileSync(OUTFILE, JSON.stringify(out, null, 1));

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
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
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
    window.__measure = (shadow) => {
      const i = g.renderer.info;
      const auto = i.autoReset;
      i.autoReset = false; i.reset();
      g.renderer.shadowMap.needsUpdate = shadow;
      g.renderer.render(g.scene, g.camera);
      const r = { calls: i.render.calls, tris: i.render.triangles };
      i.autoReset = auto;
      return r;
    };
    window.__only = (keep) => {
      const groups = { creatures: g.creatures.group, flora: g.flora.group, terrain: g.terrain.group };
      for (const [k, gr] of Object.entries(groups)) gr.visible = keep === null || k === keep;
    };
  });
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.setState('reef'));
  await page.evaluate(() => window.__step(240));
  for (let i = 0; i < 40; i++) {
    const w = await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.game.creatures.imp.waiting);
    if (w === 0) break;
    await page.evaluate(() => window.__step(5));
    await page.waitForTimeout(250);
  }
  out.stage = 'built';
  save();
  for (const [name, keep] of [['all', null], ['creatures', 'creatures'], ['flora', 'flora'], ['terrain', 'terrain']]) {
    await page.evaluate((k) => window.__only(k), keep);
    out[name + 'NoShadow'] = await page.evaluate(() => window.__measure(false));
    save();
    out[name + 'Shadow'] = await page.evaluate(() => window.__measure(true));
    save();
  }
  await page.evaluate(() => window.__only(null));
  out.tex = await page.evaluate(() => {
    const g = window.__THREE_GAME_TEST_HOOKS__.game;
    const bytes = (t) => { const im = t.image; const w = im?.width || 0, h = im?.height || 0; return w * h * 4 * (t.generateMipmaps !== false ? 1.333 : 1); };
    const seen = new Map();
    g.scene.traverse((o) => {
      for (const m of [].concat(o.material || [])) {
        const list = [m.map, m.normalMap, m.alphaMap, m.emissiveMap];
        for (const u of Object.values(m.userData?.shader?.uniforms || m.uniforms || {})) if (u?.value?.isTexture) list.push(u.value);
        for (const t of list) if (t && !seen.has(t.uuid)) seen.set(t.uuid, bytes(t));
      }
    });
    let creature = bytes(g.creatures.imp.atlas.texture);
    const buckets = {};
    let built = 0;
    for (const rt of g.creatures.list) if (rt.mesh?.material.map) {
      built++;
      const b = bytes(rt.mesh.material.map); creature += b;
      const key = `${rt.mesh.material.map.image.width}x${rt.mesh.material.map.image.height}`;
      buckets[key] = (buckets[key] || 0) + 1;
    }
    return { allMB: [...seen.values()].reduce((a, b) => a + b, 0) / 1048576, creatureMB: creature / 1048576, atlasMB: bytes(g.creatures.imp.atlas.texture) / 1048576, atlasMips: g.creatures.imp.atlas.texture.generateMipmaps, built, buckets };
  });
  out.diag = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.creatures);
  out.errors = errors.slice(0, 5);
  out.stage = 'done';
  save();
  console.log(JSON.stringify(out));
  await browser.close();
  server.close();
})();
