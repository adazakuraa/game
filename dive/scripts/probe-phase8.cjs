/**
 * Phase 8 verification (docs/PHASE8-DESIGN.md §10.1; the items that belong to steps S0-S2).
 *
 * Usage: node scripts/probe-phase8.cjs [dist/artifact.html] [dist/play.html]
 *   The first file is the Artifact output (no viewport meta), the second the stand-alone page (--page).
 *   PROBE_CHROME may point at a Chromium binary.
 *
 * Headless SwiftShader barely advances the main loop (RESUME.md), so the world is stepped by hand and
 * renderer.info is read around a single render. Render times are meaningless here and are not measured.
 * Between two dive points the creature clock is advanced by TRAVEL seconds, standing in for the swim
 * (species are only dropped after KEEP.idleSec away).
 *
 * Budget rows (§6.1) are printed as OK / OVER and do not fail the run on their own: several of them
 * depend on later steps (S5 LOD). Behaviour checks are PASS / FAIL and set the exit code.
 * Not covered yet (later steps): item 3 (L2 draw call), 4 (L0 target), 9 (swim), 10 (3D models).
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('playwright-core')); }

const ARTIFACT = process.argv[2] || path.join(__dirname, '..', 'dist', 'artifact.html');
const PAGE = process.argv[3] || path.join(__dirname, '..', 'dist', 'play.html');
const TRAVEL = 100;
const PLACES = ['lagoon', 'reef', 'rocky', 'wall', 'offshore', 'kelp', 'ruins', 'deep'];
/** main 0d806c8 (§0.2): [calls, calls with shadows, triangles, triangles with shadows, creature calls, creature triangles] */
const BEFORE = {
  lagoon: [125, 149, 164e3, 208e3, 25, 68e3], reef: [201, 269, 622e3, 891e3, 60, 88e3], rocky: [134, 173, 187e3, 259e3, 34, 93e3],
  wall: [122, 175, 251e3, 404e3, 27, 107e3], offshore: [65, 70, 15e3, 29e3, 3, 9e3], kelp: [108, 149, 214e3, 411e3, 10, 18e3],
  ruins: [94, 107, 43e3, 76e3, 3, 6e3], deep: [44, 44, 1.3e3, 1.3e3, 0, 0],
};

let failed = 0;
const check = (name, ok, extra = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`); };
const budget = (name, value, max, unit = '') => console.log(`${value <= max ? 'OK  ' : 'OVER'}  ${name}: ${value}${unit} (budget <= ${max}${unit})`);

(async () => {
  const files = { '/a': ARTIFACT, '/p': PAGE };
  const server = http.createServer((q, r) => {
    const f = files[q.url.split('?')[0]];
    if (!f || !fs.existsSync(f)) { r.writeHead(404); r.end(); return; }
    r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    r.end(fs.readFileSync(f));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: process.env.PROBE_CHROME || undefined, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'] });
  const errors = [];
  const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true };
  const open = async (url, opts = phone) => {
    const ctx = await browser.newContext(opts);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error' && !/ERR_|Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 300)); });
    await page.goto(base + url);
    await page.waitForFunction(() => window.__THREE_GAME_TEST_HOOKS__, null, { timeout: 120000 });
    return page;
  };

  // ---------- 2: pixel count (and the diagnostics readout)
  const canvasInfo = (page) => page.evaluate(() => {
    const g = window.__THREE_GAME_TEST_HOOKS__.game, c = g.renderer.domElement;
    return { iw: innerWidth, w: c.width, h: c.height, px: c.width * c.height, dpr: +g.renderer.getPixelRatio().toFixed(3) };
  });
  for (const [name, url, opts] of [
    ['artifact（viewport なし・スマホ）', '/a', phone],
    ['play.html（スマホ）', '/p', phone],
    ['大画面タブレット', '/p', { viewport: { width: 1366, height: 1024 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true }],
    ['PC', '/p', { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 }],
  ]) {
    if (!fs.existsSync(files[url])) { console.log(`SKIP  ${name}: ${files[url]} がない`); continue; }
    const page = await open(url, opts);
    const r = await canvasInfo(page);
    check(`画素数 90万以下: ${name}`, r.px <= 900000, JSON.stringify(r));
    if (name.startsWith('play.html')) check('play.html は innerWidth 390', r.iw === 390, `innerWidth=${r.iw}`);
    await page.context().close();
  }
  {
    const page = await open('/a?diag');
    await page.waitForFunction(() => /fps/.test(document.getElementById('diag').textContent), null, { timeout: 120000 }).catch(() => {});
    const r = await page.evaluate(() => ({
      text: document.getElementById('diag').textContent,
      d: window.__THREE_GAME_DIAGNOSTICS__?.diag, c: window.__THREE_GAME_DIAGNOSTICS__?.creatures,
    }));
    check('?diag で診断表示（fps・呼び出し・三角形・画素・DPR・L0/L1/L2）', ['fps', '呼び出し', '三角形', '画素', 'DPR', 'L0/L1/L2'].every((k) => r.text.includes(k)), r.text.replace(/\n/g, ' | '));
    await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.diag, null, { timeout: 120000 }).catch(() => {});
    const d = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__);
    check('__THREE_GAME_DIAGNOSTICS__ に diag と l0/l1/l2', !!d?.diag && typeof d.creatures.l0 === 'number' && typeof d.creatures.l2 === 'number');
    const t = await page.evaluate(() => {
      const b = document.getElementById('diag-toggle'), el = document.getElementById('diag');
      b.click(); const off = el.classList.contains('hidden');
      b.click(); const on = !el.classList.contains('hidden');
      b.click();
      return { off, on, auto: window.__THREE_GAME_TEST_HOOKS__.game.renderer.info.autoReset };
    });
    check('デバッグ欄のボタンで診断表示を切り替え', t.off && t.on && t.auto === true, JSON.stringify(t));
    await page.context().close();
  }

  // ---------- the tour: 1, 5, 6, 7
  const page = await open('/a');
  const H = 'window.__THREE_GAME_TEST_HOOKS__';
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
  });
  /** Enter a place; returns the programs that exist once the dive has started (black screen lifted). */
  const go = async (place) => {
    await page.evaluate((p) => window.__THREE_GAME_TEST_HOOKS__.setState(p), place);
    await page.waitForTimeout(1200);
    await page.waitForFunction(() => !document.getElementById('fade').classList.contains('on'), null, { timeout: 60000 });
    const start = await programs();
    await page.evaluate((travel) => {
      const g = window.__THREE_GAME_TEST_HOOKS__.game;
      g.tut.step = -1;
      g.paused = false;
      g.creatures.time += travel;
      g.creatures.buildBudgetMs = 1e9;
      window.__step(40);
      g.paused = true;
    }, TRAVEL);
    return start;
  };
  const programs = () => page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.game.renderer.info.programs.map((p) => p.cacheKey));
  const added = [];
  const newSince = async (start, where) => {
    for (const k of await programs()) if (!start.includes(k)) added.push(`${where}: ${(k.match(/(uw-[\w-]+|prop)/) || [k.slice(0, 60)])[0]}`);
  };
  const rows = [];
  for (const pl of PLACES) {
    const start = await go(pl);
    const r = await page.evaluate(() => {
      const g = window.__THREE_GAME_TEST_HOOKS__.game;
      const a = window.__measure(false), b = window.__measure(true);
      // creatures alone: what disappears when their group is hidden
      g.creatures.group.visible = false;
      const c = window.__measure(false);
      g.creatures.group.visible = true;
      return { a, b, cr: { calls: a.calls - c.calls, tris: a.tris - c.tris }, held: g.creatures.list.filter((x) => x.mesh).length, progs: g.renderer.info.programs.length };
    });
    rows.push({ pl, ...r });
    await newSince(start, pl);
    console.log(`  ${pl}: calls ${r.a.calls}/${r.b.calls}  tris ${r.a.tris}/${r.b.tris}  creatures ${r.cr.calls} calls ${r.cr.tris} tris  built ${r.held}  programs ${r.progs}`);
  }
  console.log('--- §6.1（サンゴ礁）');
  const reef = rows.find((r) => r.pl === 'reef');
  budget('呼び出し（影なし）', reef.a.calls, 140);
  budget('呼び出し（影あり）', reef.b.calls, 175);
  budget('影パスの呼び出し', reef.b.calls - reef.a.calls, 35);
  budget('三角形（影なし）', reef.a.tris, 350000);
  budget('三角形（影パス）', reef.b.tris - reef.a.tris, 100000);
  budget('生き物の呼び出し', reef.cr.calls, 50);
  budget('生き物の三角形', reef.cr.tris, 90000);
  for (const r of rows.filter((x) => x.pl !== 'reef')) {
    const b = BEFORE[r.pl];
    // which groups are present is random on every dive: compare the scenery (everything but the creatures)
    const now = [r.a.calls - r.cr.calls, r.b.calls - r.cr.calls, r.a.tris - r.cr.tris, r.b.tris - r.cr.tris];
    const was = [b[0] - b[4], b[1] - b[4], b[2] - b[5], b[3] - b[5]];
    check(`${r.pl}: 生き物を除く描画が変更前より増えない`, now.every((v, i) => v <= was[i] * 1.05 + (i < 2 ? 3 : 2000)),
      `呼び出し ${now[0]}/${now[1]} (${was[0]}/${was[1]}), 三角形 ${now[2]}/${now[3]} (${was[2]}/${was[3]})`);
  }
  const last = rows[rows.length - 1];
  check('5: 8地点を回った後の生成済みの種 <= 120', last.held <= 120, `${last.held}（地点ごと ${rows.map((r) => r.held).join(',')}）`);

  const tex = await page.evaluate(() => {
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
    let creature = 0;
    for (const rt of g.creatures.list) if (rt.mesh?.material.map) creature += bytes(rt.mesh.material.map);
    return { all: [...seen.values()].reduce((a, b) => a + b, 0) / 1048576, creature: creature / 1048576, gpu: g.renderer.info.memory.textures };
  });
  budget('6: テクスチャ推定（シーン内）', +tex.all.toFixed(1), 40, ' MB');
  budget('6: うち生き物', +tex.creature.toFixed(1), 20, ' MB');

  // 7: no new program while diving
  await newSince(await go('reef'), 'reef (2)');
  check('7: 潜水中（潜水開始の後）にシェーダプログラムが増えない', added.length === 0, added.join(', '));

  const size = fs.statSync(ARTIFACT).size / 1024;
  budget('8: 単一 HTML', Math.round(size), 4500, ' KB');

  // ---------- S1 behaviour
  await go('reef');
  const atEnd = await programs();
  const sh = await page.evaluate(() => {
    const g = window.__THREE_GAME_TEST_HOOKS__.game, cp = g.camera.position;
    const cam = g.env.sun.shadow.camera;
    let floraBad = 0, floraCast = 0, noShadowSetCast = 0, far = 0;
    for (const s of g.flora.sets) for (const c of s.cells) {
      const want = s.shadows && c.box.distanceToPoint(cp) < 30;
      if (c.mesh.castShadow !== want) floraBad++;
      if (c.mesh.castShadow) floraCast++;
      if (!s.shadows && c.mesh.castShadow) noShadowSetCast++;
      if (s.farGeo && c.mesh.geometry === s.farGeo) far++;
    }
    let terrBad = 0, terrCast = 0;
    for (const [k, m] of g.terrain.chunks) {
      const [x, z] = k.split(',').map(Number);
      const want = Math.abs(x - Math.floor(cp.x / 40)) <= 1 && Math.abs(z - Math.floor(cp.z / 40)) <= 1;
      if (m.castShadow !== want) terrBad++;
      if (m.castShadow) terrCast++;
    }
    let crBad = 0;
    for (const rt of g.creatures.list) {
      if (!rt.mesh?.visible) continue;
      const want = rt.def.kind !== 'jelly' && rt.def.size >= 0.6 && rt.minD < 20;
      if (rt.mesh.castShadow !== want) crBad++;
    }
    const ratios = g.flora.sets.filter((s) => s.farGeo).map((s) => {
      const t = (q) => (q.index ? q.index.count : q.attributes.position.count) / 3;
      return +(t(s.farGeo) / t(s.loGeo)).toFixed(2);
    });
    return { half: cam.right, type: g.renderer.shadowMap.type, floraBad, floraCast, noShadowSetCast, far, terrBad, terrCast, crBad, ratios,
      mobileKey: g.terrain.materials[0].customProgramCacheKey(), rays: g.env.rays.isMesh, raysCount: g.env.group.children.filter((c) => c.material === g.env.rayMat).length };
  });
  check('① 影：植生は 30m 以内のセルだけ（小さい群体は落とさない）', sh.floraBad === 0 && sh.noShadowSetCast === 0 && sh.floraCast > 0, JSON.stringify({ cast: sh.floraCast, bad: sh.floraBad }));
  check('① 影：地形は今いるチャンクと隣だけ', sh.terrBad === 0 && sh.terrCast >= 1 && sh.terrCast <= 9, `${sh.terrCast} chunks`);
  check('① 影：生き物は 0.6m 以上かつ 20m 以内', sh.crBad === 0);
  check('① 影のカメラは 30m 四方', sh.half === 15, `half=${sh.half}`);
  check('② サンゴの遠景ジオメトリ（三角形は約 1/4）が使われる', sh.far > 0 && sh.ratios.every((r) => r <= 0.42), `far cells ${sh.far}, ratios ${sh.ratios}`);
  check('③ スマホ：BasicShadowMap と UW_MOBILE', sh.type === 0 && sh.mobileKey.endsWith('-m'), `type=${sh.type} key=${sh.mobileKey}`);
  check('④ 光芒は 1 メッシュ', sh.rays === true && sh.raysCount === 1);

  const chest = await page.evaluate(() => {
    const h = window.__THREE_GAME_TEST_HOOKS__, g = h.game;
    g.save.chests = [];
    g.chests.build(new Set());
    const items = g.chests.items;
    const meshes = g.chests.group.children.filter((c) => c.isMesh);
    const it = items.find((i) => i.def.id === 'c_reef');
    const p = it.mesh.geometry.attributes.position;
    const top = () => { let y = -9, z = 9; for (let i = p.count - 1; i >= p.count - 20; i--) { y = Math.max(y, p.getY(i)); z = Math.min(z, p.getZ(i)); } return [+y.toFixed(3), +z.toFixed(3)]; };
    const closed = top();
    g.chests.open('c_reef');
    const near = it.pos.clone(); near.x += 1.2;
    g.chests.update(near, 0.4);
    const half = top();
    for (let i = 0; i < 20; i++) g.chests.update(near, 0.1);
    const opened = top();
    const vis = it.mesh.visible;
    const far = it.pos.clone(); far.x += 70;
    g.chests.update(far, 0.016);
    const hidden = !it.mesh.visible;
    g.chests.build(new Set(['c_reef']));
    const again = g.chests.items.find((i) => i.def.id === 'c_reef');
    const q = again.mesh.geometry.attributes.position;
    let y = -9; for (let i = q.count - 20; i < q.count; i++) y = Math.max(y, q.getY(i));
    const rm = again.mesh.geometry.attributes.aRM, em = again.mesh.geometry.attributes.aEmis;
    const kinds = new Set(); for (let i = 0; i < rm.count; i++) kinds.add([rm.getX(i).toFixed(2), rm.getY(i).toFixed(2), em.getX(i).toFixed(4)].join('/'));
    return { meshes: meshes.length, items: items.length, closed, half, opened, vis, hidden, rebuilt: +y.toFixed(3), kinds: [...kinds] };
  });
  check('④ 宝箱は 1 個 1 メッシュ', chest.meshes === chest.items && chest.items === 10, `${chest.meshes} meshes / ${chest.items}`);
  check('④ 宝箱：蓋が開く（途中・全開・作り直し後も開いたまま）', chest.half[0] !== chest.closed[0] && chest.opened[0] !== chest.half[0] && Math.abs(chest.rebuilt - chest.opened[0]) < 0.01, JSON.stringify(chest));
  check('④ 宝箱：木と金の質感と発光を保持', chest.kinds.length === 2 && chest.kinds.some((k) => k.startsWith('0.30/0.80')) && chest.kinds.some((k) => k.startsWith('0.80/0.00')), chest.kinds.join(' '));
  check('④ 宝箱は 60m より遠いと描かない', chest.vis && chest.hidden);

  const finds = await page.evaluate(() => {
    const g = window.__THREE_GAME_TEST_HOOKS__.game, out = [];
    const rnd = Math.random;
    for (const pick of [0.01, 0.5, 0.99]) {
      let n = 0;
      // spawn: [chance, angle, distance, kind]
      const seq = [0, 0.25, 0.3, pick];
      Math.random = () => (n < seq.length ? seq[n++] : rnd());
      g.finds.spawn(g.camera.position.clone(), () => true);
      Math.random = rnd;
      const it = g.finds.item;
      if (!it) { out.push(null); continue; }
      const far = it.p.clone(); far.x += 70;
      g.finds.update(1, far); const hidden = !it.mesh.visible;
      const near = it.p.clone(); near.x += 5;
      g.finds.update(1, near); const shown = it.mesh.visible;
      const got = g.finds.update(1, it.p.clone());
      out.push({ kind: it.kind, children: it.mesh.children.length, mesh: it.mesh.isMesh, hidden, shown, got });
    }
    return out;
  });
  check('④ 拾い物は 1 メッシュ・60m で非表示・拾える', finds.every((f) => f && f.mesh && f.children === 0 && f.hidden && f.shown && f.got === f.kind), JSON.stringify(finds));

  const thin = await page.evaluate(() => {
    const g = window.__THREE_GAME_TEST_HOOKS__.game, c = g.creatures, cp = g.camera.position;
    const V = cp.constructor, dir = g.camera.getWorldDirection(new V());
    const pickAt = (lo, hi) => {
      for (const rt of c.list) {
        if (!rt.active || rt.def.curious || rt.def.aggro || rt.def.behavior !== 'school' && rt.def.behavior !== 'solo') continue;
        if (rt.def.flee > 8) continue;
        for (const a of rt.agents) {
          const d = a.p.distanceTo(cp), gr = rt.groups[a.g];
          if (!gr.absent && !a.taken && !a.alarm && d > lo && d < hi && Math.abs(gr.c.x - cp.x) < 68) return a;
        }
      }
      return null;
    };
    const count = (a) => { let n = 0; for (let i = 0; i < 8; i++) { c.update(0.05, cp, g.vel, dir); if (a.pend === 0) n++; } return n; };
    const near = pickAt(0, 20), mid = pickAt(29, 41), farA = pickAt(50, 90);
    c.focus = null;
    const r = { near: near && count(near), mid: mid && count(mid), far: farA && count(farA) };
    if (farA) {
      c.focus = farA; r.focus = count(farA); c.focus = null;
      farA.lured = true; r.lured = count(farA); farA.lured = false;
      farA.alarm = 1; r.alarm = count(farA); farA.alarm = 0;
      // accumulated time: the skipped frames are handed over together
      count(farA); let max = 0; for (let i = 0; i < 4; i++) { c.update(0.05, cp, g.vel, dir); max = Math.max(max, farA.pend); }
      r.maxPend = +max.toFixed(3);
    }
    return r;
  });
  check('⑦ 間引き：近くは毎フレーム、25m超は1/2、45m超は1/4', thin.near === 8 && thin.mid === 4 && thin.far === 2, JSON.stringify(thin));
  check('⑦ 撮影対象・餌に寄る魚・逃走中は遠くても毎フレーム', thin.focus === 8 && thin.lured === 8 && thin.alarm === 8 && thin.maxPend > 0.1 && thin.maxPend <= 0.2, JSON.stringify(thin));

  const evict = await page.evaluate(() => {
    const g = window.__THREE_GAME_TEST_HOOKS__.game, c = g.creatures;
    const cp = g.camera.position;
    const built = () => c.list.filter((x) => x.mesh);
    // force every species to be built, then let time pass at this spot
    for (const rt of c.held) rt.lastNear = c.time;
    for (const rt of c.list) if (!rt.mesh && rt.def.kind !== 'none') c.buildMesh(rt);
    const all = built().length;
    const V = cp.constructor, dir = g.camera.getWorldDirection(new V());
    c.update(0.05, cp, g.vel, dir);
    const young = built().length;
    c.time += 91;
    const tex0 = g.renderer.info.memory.textures;
    c.update(0.05, cp, g.vel, dir);
    window.__measure(false);
    const old = built().length;
    const inRange = c.list.filter((rt) => rt.mesh && c.time - rt.lastNear < 90).length;
    const orphans = c.group.children.length - built().length - c.list.filter((x) => x.halo).length;
    // a dropped species comes back when it is needed again
    const gone = c.list.find((rt) => !rt.mesh && rt.def.kind === 'fish');
    c.pin = { id: gone.def.id, p: cp.clone().addScaledVector(dir, 2), yaw: 0 };
    c.update(0.05, cp, g.vel, dir);
    const back = !!gone.mesh && gone.mesh.visible && gone.mesh.count > 0;
    c.pin = null;
    window.__measure(false);
    return { all, young, old, inRange, orphans, back, tex0, tex1: g.renderer.info.memory.textures, size: c.held.size, real: built().length };
  });
  check('⑥ 90秒未満の種は破棄しない', evict.young === evict.all, JSON.stringify(evict));
  check('⑥ 離れて90秒の種を破棄して 120 以下（近くの種は残す）', evict.old <= Math.max(120, evict.inRange) && evict.old < evict.all && evict.orphans === 0 && evict.size === evict.real, JSON.stringify(evict));
  check('⑥ 破棄した種は必要になれば作り直す', evict.back);
  const after = await programs();
  check('⑥⑧ 破棄と作り直しでプログラムが増えない', after.every((k) => atEnd.includes(k)), `${atEnd.length} -> ${after.length}`);

  check('11: ページエラーなし', errors.length === 0, errors.slice(0, 5).join(' / '));
  console.log(failed ? `${failed} FAILED` : 'all behaviour checks passed');
  await browser.close();
  server.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('PROBE CRASH', e); process.exit(2); });
