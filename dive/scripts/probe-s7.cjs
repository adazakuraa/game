/** Phase 9 S7: per-site budget (§6.1) at E1/E2/R1/R2/R3 (+ reef baseline) with species live.
 *  node scripts/probe-s7.cjs [artifact] [outfile]. Needs PROBE_CHROME for chromium. */
const http = require('http'), fs = require('fs'), path = require('path');
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('playwright-core')); }
const ARTIFACT = process.argv[2] || path.join(__dirname, '..', 'dist', 'artifact.html');
const OUTFILE = process.argv[3] || '/tmp/s7.json';
const SITES = [['reef', null], ['E1', [240, -1.2, -170]], ['E2', [300, -3.2, -110]], ['R1', [300, -3.2, -340]], ['R2', [256, -1.0, -420]], ['R3', [224, -4, -612]]];
const only = process.env.SITES ? process.env.SITES.split(',') : null;
(async () => {
  const server = http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); r.end(fs.readFileSync(ARTIFACT)); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({ executablePath: process.env.PROBE_CHROME || undefined, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'] });
  const errors = [];
  const open = async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${server.address().port}/a`);
  await page.waitForFunction(() => window.__THREE_GAME_TEST_HOOKS__, null, { timeout: 120000 });
  await page.evaluate(() => document.getElementById('pr-go')?.click());
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.setState('title'));
  await page.evaluate(() => {
    const h = window.__THREE_GAME_TEST_HOOKS__, g = h.game;
    g.input.poll = () => {};
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
    const meas = (shadow) => { const i = g.renderer.info; i.reset(); g.renderer.shadowMap.needsUpdate = shadow; g.renderer.render(g.scene, g.camera); return { c: i.render.calls, t: i.render.triangles }; };
    window.__measure = () => {
      const i = g.renderer.info, auto = i.autoReset; i.autoReset = false;
      const groups = { creatures: g.creatures.group, flora: g.flora.group, terrain: g.terrain.group };
      const res = {};
      const vis = (k) => { for (const [n, gr] of Object.entries(groups)) gr.visible = k === null || n === k; };
      vis(null); const a = meas(false), b = meas(true);
      res.all = a; res.shadowPass = { c: b.c - a.c, t: b.t - a.t };
      for (const k of Object.keys(groups)) { vis(k); res[k] = meas(false); }
      vis(null); i.autoReset = auto; return res;
    };
    window.__tex = () => {
      const bytes = (t) => { const im = t.image; const w = im?.width || 0, hh = im?.height || 0; return w * hh * 4 * (t.generateMipmaps !== false ? 1.333 : 1); };
      const seen = new Map();
      g.scene.traverse((o) => { for (const m of [].concat(o.material || [])) {
        const list = [m.map, m.normalMap, m.alphaMap, m.emissiveMap];
        for (const u of Object.values(m.userData?.shader?.uniforms || m.uniforms || {})) if (u?.value?.isTexture) list.push(u.value);
        for (const t of list) if (t && !seen.has(t.uuid)) seen.set(t.uuid, bytes(t)); } });
      let creature = bytes(g.creatures.imp.atlas.texture), built = 0; const ids = {};
      for (const rt of g.creatures.list) if (rt.mesh?.material.map) { built++; creature += bytes(rt.mesh.material.map); ids[rt.def.zone] = (ids[rt.def.zone] || 0) + 1; }
      const atl = g.creatures.imp.atlas.texture; const held = g.creatures.heldTexBytes ? g.creatures.heldTexBytes() / 1048576 : null; const bk = {}; for (const rt of g.creatures.list) { const im = rt.mesh?.material.map?.image; if (im) { const k = im.width + 'x' + im.height + (rt.mesh.material.map.generateMipmaps ? 'm' : ''); bk[k] = (bk[k] || 0) + 1; } }
      return { atlasMB: +(bytes(atl) / 1048576).toFixed(1), atlasMips: atl.generateMipmaps, heldMB: held && +held.toFixed(2), bk, allMB: +([...seen.values()].reduce((a, b) => a + b, 0) / 1048576).toFixed(1), creatureMB: +(creature / 1048576).toFixed(1), built, builtByZone: ids };
    };
  });
    return { ctx, page };
  };
  const out = { sites: {} };
  if (process.env.SEQ) { // churn: reef -> E1 -> R2 -> R3 -> reef in one page, creature texture MB after each stop (12 s) and after 140 s idle
    const { page } = await open();
    await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.setState('reef'));
    out.seq = [];
    for (const [name, p] of [['reef', null], ...SITES.slice(1), ['reef2', null]]) {
      if (p) await page.evaluate((p) => { const h = window.__THREE_GAME_TEST_HOOKS__, g = h.game; h.teleport(p[0], p[1], p[2]); g.terrain.prime(p[0], p[2], 90); }, p);
      else if (name === 'reef2') await page.evaluate(() => { const h = window.__THREE_GAME_TEST_HOOKS__; h.teleport(0, -6, 150); });
      await page.evaluate(() => window.__step(240));
      for (let i = 0; i < 40; i++) { const w = await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.game.creatures.imp.waiting); if (w === 0) break; await page.evaluate(() => window.__step(5)); await page.waitForTimeout(250); }
      const t = await page.evaluate(() => window.__tex());
      out.seq.push([name, t.creatureMB, t.allMB, t.built]);
      console.log('seq', name, t.creatureMB, t.allMB, t.built);
    }
    await page.evaluate(() => window.__step(700, 0.2));
    const t = await page.evaluate(() => window.__tex()); console.log('seq settled', t.creatureMB, t.allMB, t.built);
    fs.writeFileSync(OUTFILE, JSON.stringify(out, null, 1)); await browser.close(); server.close(); return;
  }
  for (const [name, p] of SITES) {
    if (only && !only.includes(name)) continue;
    const { ctx, page } = await open();
    await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.setState('reef'));
    const r = {};
    for (const yaw of [0, 1.57, 3.14, 4.71]) {
      if (p) await page.evaluate(([p, yaw]) => { const h = window.__THREE_GAME_TEST_HOOKS__, g = h.game; h.teleport(p[0], p[1], p[2]); g.terrain.prime(p[0], p[2], 90); h.look(yaw, 0.05); }, [p, yaw]);
      await page.evaluate(() => window.__step(240));
      for (let i = 0; i < 40; i++) {
        const w = await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.game.creatures.imp.waiting);
        if (w === 0) break; await page.evaluate(() => window.__step(5)); await page.waitForTimeout(250);
      }
      const m = await page.evaluate(() => window.__measure());
      for (const k of Object.keys(m)) { const cur = r[k] || { c: 0, t: 0 }; r[k] = { c: Math.max(cur.c, m[k].c), t: Math.max(cur.t, m[k].t) }; }
    }
    r.tex = await page.evaluate(() => window.__tex());
    await page.evaluate(() => window.__step(700, 0.2));
    r.texSettled = await page.evaluate(() => window.__tex());
    await ctx.close();
    out.sites[name] = r; fs.writeFileSync(OUTFILE, JSON.stringify(out, null, 1));
    console.log(name, JSON.stringify(r));
  }
  out.errors = errors.slice(0, 5); fs.writeFileSync(OUTFILE, JSON.stringify(out, null, 1));
  console.log('errors', JSON.stringify(out.errors));
  await browser.close(); server.close();
})();
