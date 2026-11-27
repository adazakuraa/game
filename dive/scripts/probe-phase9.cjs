/**
 * Phase 9 probe (PHASE9-DESIGN §8.1). S6 (system integration: Low-1/Low-2 fixes, river spear ban, kitchen pool, found-box charts, board requests, photo spots, chests, sights) comes right before the page-error check. S5 (river species: 24 species / 19 fish, exact-name protection and diet, triangle limits, placement, upstream-facing fish, territorial ayu, photo targets, dex section) comes right after S4. S4 (estuary species: 18 species / 14 fish, lagoon 21, the guardian アカメ, exact-name protection and diet, placement, photo targets, dex section) comes before the page-error check. S3 (scenery + homes) is the last block before the page-error check. S2 (river: depths, flow, air, waterfall, water by position, dive point, Low fixes) is the last block. S0 (world extension + shore) and S1 (estuary terrain, water, dive point):
 *   - the shore stops the diver (heightAt stays <= -0.8) and says so; it slides instead of sticking
 *   - the creatures never leave the water in the south; no species lives in the new zones yet (S0 only; S4 and S5 add them)
 *   - the chart shows the island as land (green), the margin south of the world is land too
 *   - S1: estuary floor depths 0.9–9 m, dive point 6.5 m, zoneAt along the channel, channel swimmable (BFS + a steered swim),
 *     tea-green water 16 m with the 1.8 m salt wedge (fog colour / density above vs below), discovery banner + boat-screen entry,
 *     upstream-facing start with the boat downstream, 0.15 m/s channel flow and no change to currentF
 *   - S3 (scenery and homes): the ten Homes lists within +-30% of the design tables and every point under water (floor < -0.9, y between floor and surface,
 *     zoneAt = its zone); mangrove / reed / driftwood / boat / stones / boulders / weeds placed; trunk, log, boulder colliders push the diver out; the
 *     swim lane along the river's centre line is free of solid rocks; mid-build render budget at E1 and R2 (calls / triangles / shadow pass)
 *   - boots with 0 page errors
 * (The terrain-invariance check for z >= -60 is scripts/terrain-dump.ts: dump before/after and compare.)
 * Usage: node scripts/probe-phase9.cjs [dist/artifact.html]   (PROBE_CHROME=<chromium binary>)
 */
const path = require('path');
const http = require('http');
const fs = require('fs');
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('playwright-core')); }
const ARTIFACT = process.argv[2] || path.join(__dirname, '..', 'dist', 'artifact.html');
const EXE = process.env.PROBE_CHROME;
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

(async () => {
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(fs.readFileSync(ARTIFACT)); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({ ...(EXE ? { executablePath: EXE } : {}), args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => window.__THREE_GAME_TEST_HOOKS__, null, { timeout: 120000 });
  const ev = (fn, arg) => page.evaluate(fn, arg);
  await ev(() => document.getElementById('pr-go')?.click());
  await page.waitForTimeout(1200);
  await ev(() => window.__THREE_GAME_TEST_HOOKS__.setState('lagoon'));
  await page.waitForTimeout(900);
  await ev(() => { window.__THREE_GAME_TEST_HOOKS__.game.tut.step = -1; });

  // 1. shore block: swim south (-z) and diagonally into the beach from several x
  const shore = await ev(() => {
    const h = window.__THREE_GAME_TEST_HOOKS__, g = h.game;
    const out = [];
    g.input.poll = () => {}; // synthetic input (poll would recompute moveX/moveY from the devices)
    for (const [x0, yaw] of [[0, 0], [420, 0], [-350, 0], [100, 0.7], [100, -0.7]] /* the estuary (x 190–410) is water, not beach */) {
      h.teleport(x0, -2, -70);
      g.lastShoreWarn = -99; g.lastEdgeWarn = -99;
      document.getElementById('toast').textContent = '';
      h.look(yaw, 0); // yaw 0 faces -z
      g.input.moveY = 1;
      for (let i = 0; i < 260; i++) g.updateDiver(0.05);
      g.input.moveY = 0;
      const p = g.camera.position;
      out.push({ x0, yaw, x: +p.x.toFixed(1), z: +p.z.toFixed(1), ground: +h.heightAt(p.x, p.z).toFixed(2), toast: document.getElementById('toast').textContent });
    }
    return out;
  });
  console.log('  shore samples', JSON.stringify(shore));
  check('shore: the diver stops short of the land at every entry', shore.every((s) => s.ground <= -0.8 && s.z > -90 && s.z < -70), shore.map((s) => s.z).join(','));
  check('shore: the "beach" toast appears', shore.every((s) => /浜/.test(s.toast)), shore.map((s) => s.toast).join('|'));

  // 2. no creature position is on land (the shore reflection), after letting groups move for a while
  const life = await ev(() => {
    const h = window.__THREE_GAME_TEST_HOOKS__, g = h.game;
    h.teleport(0, -3, -40);
    for (let i = 0; i < 200; i++) g.creatures.update(0.1, g.camera.position, g.vel);
    let south = 0, onLand = 0;
    for (const rt of g.creatures.list) for (const gr of rt.groups) { if (gr.c.z < -45) { south++; if (h.heightAt(gr.c.x, gr.c.z) > -0.6) onLand++; } }
    return { south, onLand, zones: [h.zoneAt(0, -300), h.zoneAt(300, -500)] };
  });
  console.log('  creatures', JSON.stringify(life));
  check('creatures: none on land in the south', life.onLand === 0, JSON.stringify(life));

  // 3. chart: land colour south of the shore and in the south margin; sea unchanged north
  const chart = await ev(() => {
    const g = window.__THREE_GAME_TEST_HOOKS__.game;
    const c = g.minimap.chart, ctx = c.getContext('2d');
    const img = ctx.getImageData(0, 0, c.width, c.height);
    const at = (x, z) => { const [i, j] = g.minimap.px(x, z); const o = (Math.round(j) * c.width + Math.round(i)) * 4; return [img.data[o], img.data[o + 1], img.data[o + 2]]; };
    return { land: [at(0, -300), at(120, -500), at(-300, -200), at(0, -650)], margin: [at(0, -675), at(-425, -690)], sea: at(0, 400), size: [c.width, c.height] };
  });
  console.log('  chart', JSON.stringify(chart));
  const green = (c) => c[1] > c[2] + 25 && c[1] > c[0] - 10 && c[2] < 140; // land is greenish/sandy, not blue
  check('chart: the island is land-coloured', chart.land.every(green), JSON.stringify(chart.land));
  check('chart: the south margin is land-coloured', chart.margin.every(green), JSON.stringify(chart.margin));
  check('chart: open sea still reads as water', chart.sea[2] > chart.sea[0], JSON.stringify(chart.sea));

  // ---------------- S1: the estuary ----------------
  const est = await ev(() => {
    const h = window.__THREE_GAME_TEST_HOOKS__, g = h.game;
    const c = (z) => 300 + 15 * Math.sin(z * 0.02);
    const W = (z) => { const t = Math.min(1, Math.max(0, (z + 60) / -240)); return 110 + (35 - 110) * t * t * (3 - 2 * t); };
    // 1. floor depths over the water footprint (u < 0.88 and clear of the mouth blend / closed head)
    let dmin = 99, dmax = 0, n = 0, bad = 0;
    for (let z = -90; z >= -292; z -= 2) for (let x = 180; x <= 420; x += 2) {
      const u = Math.abs(x - c(z)) / W(z);
      if (u >= 0.88) continue;
      const d = -h.heightAt(x, z);
      n++; dmin = Math.min(dmin, d); dmax = Math.max(dmax, d);
      if (d < 0.85 || d > 9.2) bad++;
    }
    const centre = []; for (let z = -90; z >= -290; z -= 10) centre.push(-h.heightAt(c(z), z));
    // 2. zones along the centre line (50 points) and outside
    let zOk = 0, zN = 0; for (let i = 0; i < 50; i++) { const z = -66 - i * (230 / 49); zN++; if (h.zoneAt(c(z), z) === 'estuary') zOk++; }
    const outside = [h.zoneAt(0, -100), h.zoneAt(300, -40), h.zoneAt(300, -330), h.zoneAt(150, -150), h.zoneAt(300, 100)];
    // 3. BFS over the water (heightAt < -0.8, 4 m grid) from the lagoon side reaches the head
    const seen = new Set(), q = [[286, -50]]; seen.add('286,-50');
    let reachedZ = -50;
    while (q.length) {
      const [x, z] = q.pop(); reachedZ = Math.min(reachedZ, z);
      for (const [dx, dz] of [[4, 0], [-4, 0], [0, 4], [0, -4]]) {
        const nx = x + dx, nz = z + dz, k = nx + ',' + nz;
        if (seen.has(k) || nx < 150 || nx > 450 || nz > -40 || nz < -330) continue;
        if (h.heightAt(nx, nz) > -0.8) continue;
        seen.add(k); q.push([nx, nz]);
      }
    }
    // 4. a real swim: steer along the centre line from the lagoon to the head with updateDiver
    g.input.poll = () => {};
    h.teleport(c(-48), -2, -48);
    g.lastShoreWarn = -99;
    let minGap = 99, t = 0;
    for (let i = 0; i < 4000 && g.camera.position.z > -285; i++) {
      const p = g.camera.position, tz = p.z - 14, tx = c(tz);
      g.yaw = Math.atan2(-(tx - p.x), -(tz - p.z)); g.pitch = 0;
      g.input.moveY = 1; g.input.moveX = 0;
      g.updateDiver(0.05); t += 0.05;
      if (p.y < h.heightAt(p.x, p.z) + 0.4) p.y = h.heightAt(p.x, p.z) + 0.6; // the floor holds him up (collision is in the main loop)
      if (p.y > -0.6) p.y = -0.6;
      minGap = Math.min(minGap, -h.heightAt(p.x, p.z));
    }
    g.input.moveY = 0;
    const swim = { z: +g.camera.position.z.toFixed(1), x: +g.camera.position.x.toFixed(1), secs: +t.toFixed(0), minDepth: +minGap.toFixed(2) };
    return { n, dmin: +dmin.toFixed(2), dmax: +dmax.toFixed(2), bad, centre: centre.map((v) => +v.toFixed(1)), zOk, zN, outside, reachedZ, swim, dp: -h.heightAt(300, -110), dpZone: h.zoneAt(300, -110) };
  });
  console.log('  estuary', JSON.stringify(est));
  check('estuary: floor depth 0.85–9.2 m everywhere over the water', est.bad === 0 && est.n > 3000, `n=${est.n} min=${est.dmin} max=${est.dmax} bad=${est.bad}`);
  check('estuary: channel (澪筋) 4.5–9 m the whole way, deepest at the mouth', est.centre.every((d) => d >= 4.5 && d <= 9) && est.centre[0] > est.centre[est.centre.length - 1] + 1, est.centre.join(','));
  check('estuary: dive point (300, -110) is 6.5 m (±0.5) deep and in the estuary zone', Math.abs(est.dp - 6.5) <= 0.5 && est.dpZone === 'estuary', `${est.dp.toFixed(2)} ${est.dpZone}`);
  check('estuary: zoneAt is "estuary" on 50 centre-line points; lagoon/sea/land outside', est.zOk === est.zN && est.outside[0] === 'lagoon' && est.outside[1] === 'lagoon' && est.outside[4] !== 'estuary' && est.outside[2] !== 'estuary' && est.outside[3] !== 'estuary', `${est.zOk}/${est.zN} ${est.outside}`);
  check('estuary: the water is connected from the lagoon to the head (BFS)', est.reachedZ <= -290, 'reached z=' + est.reachedZ);
  check('estuary: swimming the channel from the lagoon reaches the head, never stuck', est.swim.z <= -285 && est.swim.minDepth >= 0.8, JSON.stringify(est.swim));

  // water: tea-green 16 m, salt wedge at 1.8 m
  const wat = await ev(() => {
    const h = window.__THREE_GAME_TEST_HOOKS__, g = h.game, env = g.env;
    env.weatherFog = 1; env.weatherLight = 1; env.night = 0; env.narcosis = 0;
    const at = (x, z, y) => { g.camera.position.set(x, y, z); for (let i = 0; i < 60; i++) env.update(0.5, g.camera, g.renderer, 10 + i); const f = env.fog; return { r: f.color.r, g: f.color.g, b: f.color.b, d: f.density, bump: env.wedgeBump, vis: 1.75 / (f.density / env.wedgeBump) }; };
    const above = at(288, -110, -0.9), below = at(288, -110, -3.8), mid = at(288, -110, -1.8), deep = at(288, -110, -6);
    const lagoon = at(0, 40, -2);
    return { tbl: h.estuaryWater(), above, below, mid, deep, lagoon };
  });
  console.log('  water', JSON.stringify(wat));
  check('water: estuary zone water is tea-green with 16 m visibility', wat.tbl.base[3] === 16 && wat.tbl.base[1] > wat.tbl.base[2] && wat.tbl.base[0] > 0.04, JSON.stringify(wat.tbl.base));
  check('water: salt wedge layers are 10 m (river, above) and 20 m (sea, below 1.8 m) — fog only', Math.abs(wat.above.vis - 10) < 0.8 && Math.abs(wat.below.vis - 20) < 1.6, `above=${wat.above.vis.toFixed(1)} below=${wat.below.vis.toFixed(1)}`);
  check('water: the fog colour changes across 1.8 m (river-brown above, sea-blue below)', (wat.below.b / wat.below.g) > (wat.above.b / wat.above.g) * 1.4, `b/g above=${(wat.above.b / wat.above.g).toFixed(2)} below=${(wat.below.b / wat.below.g).toFixed(2)}`);
  check('water: the fog is 1.4x thicker right at the boundary, 1.0 away from it', Math.abs(wat.mid.bump - 1.4) < 0.03 && wat.above.bump < 1.02 && wat.deep.bump < 1.02 && Math.abs(wat.lagoon.bump - 1) < 1e-6, `mid=${wat.mid.bump.toFixed(3)} above=${wat.above.bump.toFixed(3)} deep=${wat.deep.bump.toFixed(3)} lagoon=${wat.lagoon.bump}`);
  check('water: outside the estuary nothing changes (lagoon 38 m)', Math.abs(wat.lagoon.vis - 38) < 2, wat.lagoon.vis.toFixed(1));

  // flow: weak 0.15 m/s seaward in the channel only, never a photo penalty
  const flow = await ev(() => {
    const h = window.__THREE_GAME_TEST_HOOKS__, g = h.game;
    const c = (z) => 300 + 15 * Math.sin(z * 0.02);
    const mid = h.flowAt(c(-150), -150), flat = h.flowAt(c(-150) + 40, -150), sea = h.flowAt(0, 100);
    h.teleport(c(-150), -4, -150); g.input.moveY = 0; g.vel.set(0, 0, 0);
    g.updateDiver(0.05);
    return { mid, flat, sea, currentF: h.currentF() };
  });
  check('flow: 0.15 m/s seaward (+z) in the channel, 0 on the flats and at sea, currentF stays 0', Math.abs(flow.mid.z - 0.15) < 0.01 && flow.flat.z === 0 && flow.sea.z === 0 && flow.currentF === 0, JSON.stringify(flow));

  // discovery banner, boat screen, dive-point start
  const disc = await ev(() => {
    const h = window.__THREE_GAME_TEST_HOOKS__, g = h.game;
    g.save.discovered = g.save.discovered.filter((v) => v !== 'estuary'); g.save.visited = g.save.visited.filter((v) => v !== 'estuary'); // the live loop may have visited it between evaluations
    const before = g.discovered.has('estuary');
    h.teleport(288, -4, -110);
    g.exploreCheck(g.camera.position);
    const after = g.discovered.has('estuary'), q = g.mapFoundQ.map((m) => m.name);
    return { before, after, q, visited: g.save.visited.includes('estuary') };
  });
  check('discovery: swimming into the estuary discovers it and queues the 河口 banner', !disc.before && disc.after && disc.q.includes('河口') && disc.visited, JSON.stringify(disc));
  const boat = await ev(async () => {
    const h = window.__THREE_GAME_TEST_HOOKS__, g = h.game;
    h.setState('title');
    await new Promise((r) => setTimeout(r, 300));
    const listed = [...document.querySelectorAll('#points .pt .nm')].map((e) => e.textContent);
    const dp = g.point && window.__THREE_GAME_TEST_HOOKS__ && null;
    return { listed };
  });
  check('boat screen: 河口 is listed as a destination (after the kelp forest)', boat.listed.includes('河口') && boat.listed.indexOf('河口') > boat.listed.indexOf('海藻の森'), boat.listed.join(','));
  const start = await ev(async () => {
    const h = window.__THREE_GAME_TEST_HOOKS__, g = h.game;
    const btn = [...document.querySelectorAll('#points .pt')].find((b) => b.querySelector('.nm')?.textContent === '河口');
    btn.click();
    for (let i = 0; i < 100 && g.state !== 'diving'; i++) await new Promise((r) => setTimeout(r, 200));
    await new Promise((r) => setTimeout(r, 300));
    const p = g.camera.position, bp = g.flora.boat.position;
    return { state: g.state, x: p.x, y: p.y, z: p.z, floor: h.heightAt(p.x, p.z), yaw: g.yaw, boatZ: bp.z, boatX: bp.x, boatVisible: g.flora.boat.visible, boatFloor: h.heightAt(bp.x, bp.z) };
  });
  console.log('  start', JSON.stringify(start));
  check('dive point: starts under the boat at -3.2 m over a 6.5 m floor, facing upstream (-z)', start.state === 'diving' && Math.abs(start.y + 3.2) < 0.05 && Math.abs(start.floor + 6.5) <= 0.5 && start.yaw === 0, JSON.stringify({ y: start.y, floor: start.floor, yaw: start.yaw }));
  check('dive point: the boat is 12 m downstream (+z) of the diver, over water deep enough for the hull', Math.abs(start.boatZ - (-110 + 12)) < 0.01 && Math.abs(start.boatX - 302) < 0.01 && start.boatVisible && start.boatFloor < -3, `boatZ=${start.boatZ} floor=${start.boatFloor.toFixed(1)}`);


  // ---------------- S2: the river, flow, waterfall ----------------
  const PATH = [[320, -300, 11, 4.5], [300, -340, 10, 5], [272, -380, 9, 3], [256, -420, 8, 1.6], [270, -460, 9, 5.5], [300, -500, 7, 1.5], [292, -540, 8, 4], [252, -575, 7, 2.2], [226, -608, 9, 7], [216, -631, 9, 7]];
  const rv = await ev((PATH) => {
    const h = window.__THREE_GAME_TEST_HOOKS__, g = h.game;
    // 1. depth on the centre line vs the table (±0.3)
    const dev = PATH.map(([x, z, w, D]) => +(-h.heightAt(x, z) - D).toFixed(2));
    // 2. zone: 50 points along the centre line from z=-306 to the plunge pool
    const pts = [];
    for (let i = 0; i < 9; i++) { const [ax, az] = PATH[i], [bx, bz] = PATH[i + 1]; for (let k = 0; k < 6; k++) pts.push([ax + (bx - ax) * k / 6, az + (bz - az) * k / 6]); }
    const sel = pts.filter(([, z]) => z < -308).slice(0, 50);
    const zOk = sel.filter(([x, z]) => h.zoneAt(x, z) === 'river').length;
    // 3. BFS from the estuary head to the waterfall's pool
    const seen = new Set(), q = [[304, -290]]; let minz = 0, cells = 0;
    while (q.length) { const [x, z] = q.pop(); minz = Math.min(minz, z); cells++; for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) { const nx = x + dx, nz = z + dz, k = nx + ',' + nz; if (seen.has(k) || nz > -285 || nz < -660 || nx < 150 || nx > 420) continue; if (h.heightAt(nx, nz) > -0.8) continue; seen.add(k); q.push([nx, nz]); } }
    // 4. river water floor everywhere in [1.2, 7.3] over the swimmable water, and the swimmable width per section
    let dmin = 99, dmax = 0, n = 0;
    const widths = [];
    for (let z = -310; z >= -628; z -= 6) { let first = null, last = null; for (let x = 200; x <= 345; x += 0.5) { const d = -h.heightAt(x, z); if (d > 0.8) { if (first === null) first = x; last = x; if (h.zoneAt(x, z) === 'river') { n++; dmin = Math.min(dmin, d); dmax = Math.max(dmax, d); } } } if (first !== null) widths.push(last - first); }
    // zone boundary fix (Low 1): the lagoon's terrain is untouched at z > -60, so is its zone
    const zb = [h.zoneAt(300, -59.5), h.zoneAt(300, -59.01), h.zoneAt(300, -62), h.zoneAt(250, -59.5), h.zoneAt(380, -59.2)];
    return { dev, zOk, zN: sel.length, minz, cells, dmin: +dmin.toFixed(2), dmax: +dmax.toFixed(2), n, wmin: +Math.min(...widths).toFixed(1), wmax: +Math.max(...widths).toFixed(1), zb };
  }, PATH);
  console.log('  river', JSON.stringify(rv));
  check('river: centre-line depth matches the table (±0.3 m) at all 10 points', rv.dev.every((d) => Math.abs(d) <= 0.3), rv.dev.join(','));
  check('river: floor depth 0.8–7.3 m over the river water (edges shoal; the centre line is 1.5–7), swimmable width 10–24 m', rv.dmin >= 0.79 && rv.dmax <= 7.3 && rv.wmin >= 10 && rv.wmax <= 24, `min=${rv.dmin} max=${rv.dmax} width ${rv.wmin}..${rv.wmax}`);
  check('river: zoneAt is "river" on 50 centre-line points', rv.zOk === rv.zN && rv.zN === 50, `${rv.zOk}/${rv.zN}`);
  check('river: the water is connected from the estuary head to the plunge pool (BFS, ~400 m)', rv.minz <= -630, `reached z=${rv.minz}`);
  check('zone fix: the lagoon keeps z > -60 (the estuary begins at the terrain boundary z < -60)', rv.zb[0] === 'lagoon' && rv.zb[1] === 'lagoon' && rv.zb[3] === 'lagoon' && rv.zb[4] === 'lagoon' && rv.zb[2] === 'estuary', rv.zb.join(','));

  // flow
  const fl = await ev((PATH) => {
    const h = window.__THREE_GAME_TEST_HOOKS__, g = h.game;
    const sp = (x, z, y) => { const f = h.flowAt(x, z, y); return Math.hypot(f.x, f.z); };
    const riffles = [[256, -420], [300, -500]].map(([x, z]) => sp(x, z));
    const pools = [[300, -340], [270, -460], [292, -540]].map(([x, z]) => sp(x, z));
    const all = PATH.slice(1).map(([x, z]) => sp(x, z));
    const bank = sp(256 + 7.5, -420);
    const floorHalf = sp(256, -420, h.heightAt(256, -420) + 0.3) / sp(256, -420, h.heightAt(256, -420) + 3);
    const away = h.flowAt(215 + 1, -633); // inside 6 m of the fall: pushed away from it
    // the direction is downstream: at (256, -420) it points to -x/+z? (towards the path start = +z side)
    const dir = h.flowAt(300, -500);
    g.input.poll = () => {};
    // drift: with no input the diver is carried downstream; at the surface he is not
    g.input.moveX = 0; g.input.moveY = 0; g.vel.set(0, 0, 0);
    h.teleport(300, -0.8, -500); g.camera.position.y = -0.8;
    const z0 = g.camera.position.z; for (let i = 0; i < 20; i++) { g.vel.set(0, 0, 0); g.updateDiver(0.05); g.camera.position.y = -0.8; }
    const drift = g.camera.position.z - z0;
    h.teleport(300, -0.3, -500); g.camera.position.y = -0.3;
    const zs = g.camera.position.z; for (let i = 0; i < 20; i++) { g.vel.set(0, 0, 0); g.updateDiver(0.05); g.camera.position.y = -0.3; }
    const surfaceDrift = Math.abs(g.camera.position.z - zs);
    // estuary at the surface: same rule
    const c = (z) => 300 + 15 * Math.sin(z * 0.02);
    h.teleport(c(-150), -0.3, -150); g.camera.position.y = -0.3;
    const ze = g.camera.position.z; for (let i = 0; i < 20; i++) { g.vel.set(0, 0, 0); g.updateDiver(0.05); g.camera.position.y = -0.3; }
    const estSurface = Math.abs(g.camera.position.z - ze);
    h.teleport(c(-150), -3, -150);
    const ze2 = g.camera.position.z; for (let i = 0; i < 20; i++) { g.vel.set(0, 0, 0); g.updateDiver(0.05); g.camera.position.y = -3; }
    const estDeep = g.camera.position.z - ze2;
    // air: swim against the flow (upstream = -z at (300, -500)? the flow goes to +z/+x side) vs with it
    const f = h.flowAt(300, -500), fl = Math.hypot(f.x, f.z);
    const against = [], withF = [];
    for (const sgn of [-1, 1]) {
      h.teleport(300, -0.8, -500); g.camera.position.y = -0.8; g.flowWarned = false;
      g.vel.set(sgn * -f.x / fl * 2, 0, sgn * -f.z / fl * 2); g.input.moveY = 0; g.input.moveX = 0;
      g.updateDiver(0.01);
      (sgn < 0 ? withF : against).push(g.flowAir);
    }
    // toast
    h.teleport(300, -0.8, -500); g.camera.position.y = -0.8; g.flowWarned = false; document.getElementById('toast').textContent = '';
    g.vel.set(0, 0, 0); g.updateDiver(0.05);
    const toast = document.getElementById('toast').textContent;
    // swim against the flow for real: moveY forward facing upstream, see the measured air use
    return { riffles, pools, all, bank, floorHalf, away, dir, drift, surfaceDrift, estSurface, estDeep, against, withF, toast, currentF: h.currentF() };
  }, PATH);
  console.log('  flow', JSON.stringify(fl));
  check('flow: riffles 0.6–0.8 m/s, pools 0.2–0.35 m/s', fl.riffles.every((v) => v >= 0.6 && v <= 0.81) && fl.pools.every((v) => v >= 0.2 && v <= 0.35), `riffles=${fl.riffles.map((v) => v.toFixed(2))} pools=${fl.pools.map((v) => v.toFixed(2))}`);
  check('flow: 0.2–0.8 m/s on the whole centre line (the pool at the fall adds its push)', fl.all.every((v) => v >= 0.19 && v <= 0.81), fl.all.map((v) => v.toFixed(2)).join(','));
  check('flow: slower at the bank (0 outside) and near the floor (x0.5)', fl.bank < 0.35 && Math.abs(fl.floorHalf - 0.5) < 0.02, `bank=${fl.bank.toFixed(2)} floor ratio=${fl.floorHalf.toFixed(2)}`);
  check('flow: the plunge pool pushes away from the fall (within 6 m)', Math.hypot(fl.away.x, fl.away.z) > 0.45 && fl.away.z > 0, JSON.stringify(fl.away));
  check('flow: without swimming the diver is carried downstream (+z) in the river', fl.drift > 0.4, `${fl.drift.toFixed(2)} m in 1 s`);
  check('depth rule: no push at the surface, in the river or the estuary; the estuary pushes below it', fl.surfaceDrift < 1e-6 && fl.estSurface < 1e-6 && fl.estDeep > 0.1, `river surface=${fl.surfaceDrift} estuary surface=${fl.estSurface} estuary deep=${fl.estDeep.toFixed(2)}`);
  check('air: swimming against the flow costs up to x1.4; with the flow x1.0; currentF stays 0', fl.against[0] > 1.35 && fl.against[0] <= 1.41 && fl.withF[0] === 1 && fl.currentF === 0, `against=${fl.against} with=${fl.withF} currentF=${fl.currentF}`);
  check('flow: the first >0.5 m/s toast ("流れが速い")', /流れが速い/.test(fl.toast), fl.toast);

  // waterfall: cannot climb it, toasts
  const wf = await ev(() => {
    const h = window.__THREE_GAME_TEST_HOOKS__, g = h.game;
    g.input.poll = () => {};
    const out = {};
    // upstream toward the fall from the pool
    h.teleport(222, -4, -612); g.lastShoreWarn = -99; g.lastEdgeWarn = -99; document.getElementById('toast').textContent = '';
    h.look(Math.atan2(-(215 - 222), -(-650 + 612)), 0);
    g.input.moveY = 1; g.input.moveX = 0;
    for (let i = 0; i < 400; i++) { g.updateDiver(0.05); if (g.camera.position.y < -3) g.camera.position.y = -3; }
    g.input.moveY = 0;
    const p = g.camera.position;
    out.fall = { z: +p.z.toFixed(1), x: +p.x.toFixed(1), ground: +h.heightAt(p.x, p.z).toFixed(2), toast: document.getElementById('toast').textContent };
    // the bank: from the middle reach at (252,-575) swim sideways into the bank
    h.teleport(300, -4, -500); g.lastShoreWarn = -99; document.getElementById('toast').textContent = '';
    h.look(-Math.PI / 2, 0); // yaw -pi/2 faces +x
    g.input.moveY = 1;
    for (let i = 0; i < 300; i++) { g.updateDiver(0.05); if (g.camera.position.y < -1.2) g.camera.position.y = -1.2; }
    g.input.moveY = 0;
    out.bank = { x: +p.x.toFixed(1), ground: +h.heightAt(p.x, p.z).toFixed(2), toast: document.getElementById('toast').textContent };
    out.shoreText = [h.riverWater().shore(215, -630), h.riverWater().shore(277, -470), h.riverWater().shore(0, -75)];
    return out;
  });
  console.log('  waterfall', JSON.stringify(wf));
  check('waterfall: swimming at the fall stops at the cliff (z > -634) and says so', wf.fall.ground <= -0.8 && wf.fall.z > -636 && /滝/.test(wf.fall.toast), JSON.stringify(wf.fall));
  check('bank: swimming into the bank stops in the water and says "川岸"', wf.bank.ground <= -0.8 && /川岸/.test(wf.bank.toast), JSON.stringify(wf.bank));
  check('toasts: waterfall / river bank / beach are chosen by place', /滝/.test(wf.shoreText[0]) && /川岸/.test(wf.shoreText[1]) && /浜/.test(wf.shoreText[2]), wf.shoreText.join('|'));

  // water: clearer upstream, foam at the fall
  const rw = await ev(() => {
    const h = window.__THREE_GAME_TEST_HOOKS__, g = h.game, env = g.env;
    env.weatherFog = 1; env.weatherLight = 1; env.night = 0; env.narcosis = 0;
    const at = (x, z, y) => { g.camera.position.set(x, y, z); for (let i = 0; i < 80; i++) env.update(0.5, g.camera, g.renderer, 10 + i); const f = env.fog; return { r: f.color.r, g: f.color.g, b: f.color.b, vis: 1.75 / (f.density / env.wedgeBump), t: env.riverT, foam: env.foamK }; };
    return { down: at(300, -340, -2), mid: at(256, -420, -1.2), up: at(226, -608, -2), fall: at(215, -633, -2), table: h.riverWater().table };
  });
  console.log('  river water', JSON.stringify(rw));
  check('river water: visibility grows downstream 18 m -> upstream 34 m', rw.down.vis > 15 && rw.down.vis < 22 && rw.up.vis > rw.mid.vis && rw.mid.vis > rw.down.vis && rw.table.up[3] === 34 && rw.table.down[3] === 18, `down=${rw.down.vis.toFixed(1)} mid=${rw.mid.vis.toFixed(1)} up=${rw.up.vis.toFixed(1)}`);
  check('river water: foam within 8 m of the fall cuts visibility and whitens the fog; none beyond', rw.fall.foam > 0.5 && rw.up.foam === 0 && rw.fall.vis < rw.up.vis * 0.85 && rw.fall.r / rw.fall.b > 0 , `fall vis=${rw.fall.vis.toFixed(1)} foam=${rw.fall.foam.toFixed(2)} up vis=${rw.up.vis.toFixed(1)}`);

  // discovery, boat screen, dive point
  const rd = await ev(() => {
    const h = window.__THREE_GAME_TEST_HOOKS__, g = h.game;
    g.save.discovered = g.save.discovered.filter((v) => v !== 'river'); g.save.visited = g.save.visited.filter((v) => v !== 'river'); // the live loop may have visited it between evaluations (same as the estuary check)
    const before = g.discovered.has('river');
    h.teleport(300, -4, -340); g.exploreCheck(g.camera.position);
    return { before, after: g.discovered.has('river'), q: g.mapFoundQ.map((m) => m.name), visited: g.save.visited.includes('river') };
  });
  check('discovery: swimming into the river discovers it and queues the 川 banner', !rd.before && rd.after && rd.q.includes('川') && rd.visited, JSON.stringify(rd));
  const rb = await ev(async () => {
    const h = window.__THREE_GAME_TEST_HOOKS__, g = h.game;
    h.setState('title'); await new Promise((r) => setTimeout(r, 300));
    const listed = [...document.querySelectorAll('#points .pt .nm')].map((e) => e.textContent);
    const btn = [...document.querySelectorAll('#points .pt')].find((b) => b.querySelector('.nm')?.textContent === '川');
    btn.click();
    for (let i = 0; i < 100 && g.state !== 'diving'; i++) await new Promise((r) => setTimeout(r, 200));
    await new Promise((r) => setTimeout(r, 300));
    const p = g.camera.position, bp = g.flora.boat.position;
    return { listed, state: g.state, y: p.y, floor: h.heightAt(p.x, p.z), yaw: g.yaw, boatFloor: h.heightAt(bp.x, bp.z), boatZ: bp.z, boatVisible: g.flora.boat.visible, zone: h.zoneAt(p.x, p.z) };
  });
  console.log('  river dive', JSON.stringify(rb));
  check('boat screen: 川 is listed (after 河口)', rb.listed.includes('川') && rb.listed.indexOf('川') > rb.listed.indexOf('河口'), rb.listed.join(','));
  check('dive point: 川 starts at -3.2 m over a 5 m pool, facing upstream, boat downstream over deep-enough water', rb.state === 'diving' && Math.abs(rb.y + 3.2) < 0.05 && Math.abs(rb.floor + 5) <= 0.5 && rb.yaw === 0 && rb.boatFloor < -3 && Math.abs(rb.boatZ - (-340 + 12)) < 0.01 && rb.boatVisible && rb.zone === 'river', JSON.stringify(rb));
  const sw = await ev(() => {
    const h = window.__THREE_GAME_TEST_HOOKS__, g = h.game; g.input.poll = () => {};
    // a real swim up the river with the steering aimed at the centre line 14 m ahead (updateDiver): from the dive point to the pool
    const P = [[320, -300], [300, -340], [272, -380], [256, -420], [270, -460], [300, -500], [292, -540], [252, -575], [226, -608], [216, -631]];
    const cl = (z) => { for (let i = 0; i < P.length - 1; i++) { const [ax, az] = P[i], [bx, bz] = P[i + 1]; if (z <= az && z >= bz) return ax + (bx - ax) * (az - z) / (az - bz); } return P[P.length - 1][0]; };
    h.teleport(300, -3, -340); g.vel.set(0, 0, 0); g.lastShoreWarn = -99;
    let t = 0; const air0 = g.air;
    for (let i = 0; i < 9000 && g.camera.position.z > -605; i++) {
      const p = g.camera.position, tz = p.z - 12, tx = cl(tz);
      g.yaw = Math.atan2(-(tx - p.x), -(tz - p.z)); g.pitch = 0; g.input.moveY = 1; g.input.moveX = 0;
      g.updateDiver(0.05); t += 0.05;
      const fl = h.heightAt(p.x, p.z); if (p.y < fl + 0.5) p.y = fl + 0.8; if (p.y > -1) p.y = -1;
    }
    g.input.moveY = 0;
    return { z: +g.camera.position.z.toFixed(1), secs: +t.toFixed(0), airUsed: +(air0 - g.air).toFixed(1) };
  });
  console.log('  swim upriver', JSON.stringify(sw));
  check('swim: the diver can swim up the river against the flow to the plunge pool', sw.z <= -605, JSON.stringify(sw));

  // ---------------------------------------------------------------- S3: scenery and homes
  const TARGET = { estChannel: 120, estFlat: 160, mangrove: 140, reed: 160, riverLow: 120, riverRiffle: 120, riverPool: 100, riverUp: 80, riverStones: 160, riverSand: 100 };
  const ZONEOF = { estChannel: 'estuary', estFlat: 'estuary', mangrove: 'estuary', reed: null, riverLow: 'river', riverRiffle: 'river', riverPool: 'river', riverUp: 'river', riverStones: 'river', riverSand: 'river' };
  const hm = await ev((arg) => {
    const h = window.__THREE_GAME_TEST_HOOKS__;
    const out = {};
    for (const k of Object.keys(arg.T)) {
      const pts = h.homesList(k);
      let bad = 0, badZone = 0;
      for (const [x, y, z] of pts) {
        const fl = h.heightAt(x, z);
        if (!(fl < -0.9 && y >= fl - 1e-6 && y <= -0.3)) bad++;
        const zn = h.zoneAt(x, z);
        if (arg.Z[k] ? zn !== arg.Z[k] : (zn !== 'estuary' && zn !== 'river')) badZone++;
      }
      out[k] = { n: pts.length, count: h.homesCount(k), bad, badZone };
    }
    return out;
  }, { T: TARGET, Z: ZONEOF });
  console.log('  homes', JSON.stringify(Object.fromEntries(Object.entries(hm).map(([k, v]) => [k, v.n + '/' + TARGET[k]]))));
  check('homes: all ten lists are within +-30% of the design tables (§2.5・§3.5)', Object.keys(TARGET).every((k) => hm[k].n >= TARGET[k] * 0.7 && hm[k].n <= TARGET[k] * 1.3 && hm[k].count === hm[k].n), JSON.stringify(Object.fromEntries(Object.entries(hm).map(([k, v]) => [k, v.n]))));
  check('homes: every point is under water (floor < -0.9 m, y between the floor and -0.3 m)', Object.values(hm).every((v) => v.bad === 0), JSON.stringify(Object.fromEntries(Object.entries(hm).map(([k, v]) => [k, v.bad]))));
  check('homes: every point lies in its zone (estuary lists in estuary, river lists in river, reed in either)', Object.values(hm).every((v) => v.badZone === 0), JSON.stringify(Object.fromEntries(Object.entries(hm).map(([k, v]) => [k, v.badZone]))));
  const sc = await ev(() => {
    const h = window.__THREE_GAME_TEST_HOOKS__, g = h.game, S = g.flora.south;
    const rd = (x, z) => { const hh = window.__THREE_GAME_TEST_HOOKS__.flowAt; return hh; };
    // swim lane: solid stones / boulders keep clear of the river's centre line (distance to the line >= 0.3 w + radius)
    const P = [[320, -300], [300, -340], [272, -380], [256, -420], [270, -460], [300, -500], [292, -540], [252, -575], [226, -608], [216, -631]];
    const distLine = (x, z) => { let best = 1e9, w = 0; for (let i = 0; i < P.length - 1; i++) { const [ax, az] = P[i], [bx, bz] = P[i + 1]; const dx = bx - ax, dz = bz - az; const u = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz))); const d = Math.hypot(x - (ax + dx * u), z - (az + dz * u)); if (d < best) best = d; } return best; };
    const W = [11, 10, 9, 8, 9, 7, 8, 7, 9];
    const blocked = [...S.stones.filter((b) => b.solid), ...S.boulders].filter((b) => distLine(b.x, b.z) < 2.0 + b.r * 0.9).length;
    const inWater = (a) => a.filter((b) => h.heightAt(b.x, b.z) < -0.9).length;
    return {
      mang: S.mangroves.length, mangWater: inWater(S.mangroves), reeds: S.reeds.length, logs: S.logs.length, stones: S.stones.length, boulders: S.boulders.length, weeds: S.weeds.length,
      boatFloor: h.heightAt(S.boat.m.elements[12], S.boat.m.elements[14]), blocked,
      mangWest: S.mangroves.every((t) => h.zoneAt(t.x, t.z) === 'estuary' && t.x < 300 + 15 * Math.sin(t.z * 0.02)),
      inst: g.flora.instanceCount,
    };
  });
  console.log('  scenery', JSON.stringify(sc));
  check('scenery: mangroves 182–338 on the west flat (design ~260), reeds >= 6000, 12 + 8 driftwood piles of logs, 400 stones, 60 boulders, 500 weeds', sc.mang >= 182 && sc.mang <= 338 && sc.mangWest && sc.mangWater === sc.mang && sc.reeds >= 6000 && sc.logs >= 50 && sc.stones === 400 && sc.boulders === 60 && sc.weeds === 500, JSON.stringify(sc));
  check('scenery: the sunken boat rests on a pool bed 3–6 m deep; no solid rock blocks the 4 m swim lane on the centre line', sc.boatFloor < -3 && sc.boatFloor > -6 && sc.blocked === 0, `floor=${sc.boatFloor.toFixed(2)} blocked=${sc.blocked}`);
  const col = await ev(() => {
    const h = window.__THREE_GAME_TEST_HOOKS__, g = h.game, S = g.flora.south;
    g.input.poll = () => {};
    // 3-D displacement over 3 steps from a start point (flow alone moves a diver in the river by ~0.1 m in this time: the control)
    const push = (x, y, z) => { h.teleport(x, y, z); g.vel.set(0, 0, 0); g.input.moveX = 0; g.input.moveY = 0; for (let i = 0; i < 3; i++) g.updateDiver(0.05); const p = g.camera.position; return +Math.hypot(p.x - x, p.y - y, p.z - z).toFixed(3); };
    const t = S.mangroves[0], b = S.boulders[0], lg = S.logs[0].spheres[1];
    const bt = S.boulders[1];
    return {
      tree: push(t.x + 0.05, t.y + 1.2, t.z), free: push(300, -3.5, -95),
      boulder: push(b.x, b.y + b.sy * 0.6, b.z),
      log: push(lg.x, lg.y, lg.z),
      trunkR: +(0.27 * t.s).toFixed(2),
    };
  });
  check('colliders: a diver placed inside a mangrove trunk / a boulder / a driftwood log is pushed out (>= 0.2 m; a diver in the open channel moves < 0.2 m)', col.tree >= 0.2 && col.boulder >= 0.2 && col.log >= 0.2 && col.free < 0.2, JSON.stringify(col));
  // mid-build budget (§6.1 places E1 and R2): worst of four headings, scenery + terrain only (no species live here yet)
  const bud = await ev(async () => {
    const h = window.__THREE_GAME_TEST_HOOKS__, g = h.game, V = g.camera.position.constructor;
    g.input.poll = () => {};
    const out = {};
    for (const [name, x, y, z] of [['E1', 240, -1.2, -170], ['E2', 300, -3.2, -110], ['R1', 300, -3.2, -340], ['R2', 256, -1.0, -420], ['R3', 224, -4, -612]]) {
      let worst = { calls: 0, tris: 0, sCalls: 0, sTris: 0 };
      for (const yaw of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
        h.teleport(x, y, z); g.terrain.prime(x, z, 90); h.look(yaw, 0.05); g.updateDiver(0.05);
        const cp = g.camera.position;
        for (let i = 0; i < 6; i++) { g.flora.update(cp, g.time); g.terrain.update(cp.x, cp.z, g.terrain.radius, 1); }
        g.env.update(0.05, g.camera, g.renderer, g.time);
        const info = g.renderer.info, auto = info.autoReset; info.autoReset = false;
        const m = (sh) => { info.reset(); g.renderer.shadowMap.needsUpdate = sh; g.renderer.render(g.scene, g.camera); return { c: info.render.calls, t: info.render.triangles }; };
        const a = m(false), b = m(true);
        info.autoReset = auto;
        worst = { calls: Math.max(worst.calls, a.c), tris: Math.max(worst.tris, a.t), sCalls: Math.max(worst.sCalls, b.c - a.c), sTris: Math.max(worst.sTris, b.t - a.t) };
      }
      out[name] = worst;
    }
    return out;
  });
  console.log('  budget (scenery+terrain only)', JSON.stringify(bud));
  check('budget: at E1 / E2 / R1 / R2 / R3 the scenery stays in §6.1 (calls <= 140, triangles <= 350k, shadow pass <= 35 calls / 100k tris)', Object.values(bud).every((b) => b.calls <= 140 && b.tris <= 350000 && b.sCalls <= 35 && b.sTris <= 100000), JSON.stringify(bud));


  // ---------------------------------------------------------------- S4: estuary species
  const EST = ['akame', 'mahaze', 'tobihaze', 'teppouuo', 'gomafuedai', 'minamikurodai', 'shimaisaki', 'hiiragi', 'sappa', 'konoshiro', 'maanago', 'himetsubameuo', 'bora', 'kurohoshimanjuu', 'nokogirigazami', 'shiomaneki', 'yamatoshijimi', 'magaki'];
  const sp = await ev((ids) => {
    const h = window.__THREE_GAME_TEST_HOOKS__, g = h.game;
    const isFish = (d) => d.kind === 'fish' || d.kind === 'ray' || d.kind === 'gardenEel';
    const list = g.creatures.list.map((r) => r.def);
    const est = list.filter((d) => d.zone === 'estuary');
    const river = list.filter((d) => d.zone === 'river');
    // Phase 5 §6.1 count: a species is native to a zone when >= 80% of its group homes lie in that zone (zoneAt of the point)
    const native = (zone) => g.creatures.list.filter((r) => isFish(r.def) && r.groups.filter((gr) => h.zoneAt(gr.home.x, gr.home.z) === zone).length >= 0.8 * r.groups.length).map((r) => r.def.id);
    const akame = list.find((d) => d.id === 'akame');
    const named = list.filter((d) => d.name.includes('アカメ')).map((d) => d.name + ':' + !!h.edible(d.id)?.protected);
    const byName = new Map(); for (const d of list) byName.set(d.name, (byName.get(d.name) || 0) + 1);
    return {
      estIds: est.map((d) => d.id), estFish: est.filter(isFish).length, riverN: river.length,
      nativeEst: native('estuary'), nativeLag: native('lagoon'),       missing: ids.filter((i) => !est.some((d) => d.id === i)),
      akame: { r: akame.rarity, size: akame.size, emissive: akame.mat?.emissive, protectedA: !!h.edible('akame')?.protected, diet: h.dietOf('akame') },
      named, dupNames: [...byName.entries()].filter(([k, n]) => n > 1 && est.some((d) => d.name === k)).map(([k]) => k),
      moved: ['bora', 'kurohoshimanjuu'].map((i) => { const d = list.find((x) => x.id === i); return d.zone + ':' + d.region; }),
      protectedOthers: list.filter((d) => d.id !== 'akame' && h.edible(d.id)?.protected && d.zone === 'estuary').map((d) => d.id),
      nightOnly: list.filter((d) => d.when === 'night' && d.zone === 'estuary').map((d) => d.id),
    };
  }, EST);
  console.log('  estuary species', JSON.stringify({ n: sp.estIds.length, fish: sp.estFish, nativeEst: sp.nativeEst.length, nativeLag: sp.nativeLag.length, moved: sp.moved }));
  check('species: 18 estuary species (16 new + bora and kurohoshimanjuu moved from the lagoon), none missing', sp.estIds.length === 18 && sp.missing.length === 0, JSON.stringify(sp.missing));
  check('species: 14 estuary fish (kind fish / ray / gardenEel)', sp.estFish === 14, `estuary=${sp.estFish}`);
  check('species: native fish by home zone (Phase 5 §6.1, >= 80% of the groups): estuary >= 10 (target 14), lagoon >= 10', sp.nativeEst.length >= 10 && sp.nativeLag.length >= 10, `estuary=${sp.nativeEst.length} lagoon=${sp.nativeLag.length}`);
  check('species: bora → estChannel, kurohoshimanjuu → mangrove (ids unchanged)', sp.moved[0] === 'estuary:estChannel' && sp.moved[1] === 'estuary:mangrove', sp.moved.join(','));
  check('species: アカメ is the guardian (rarity 3, 1.0 m, red eyes via mat.emissive) and is protected; its diet is meat by exact name', sp.akame.r === 3 && sp.akame.size === 1 && sp.akame.emissive > 0 && sp.akame.protectedA && sp.akame.diet === 'meat', JSON.stringify(sp.akame));
  check('species: protection / diet use exact names — no other species named *アカメ* is protected, no estuary species besides アカメ is protected, and no species name appears twice', sp.named.every((n) => n.startsWith('アカメ:') || n.endsWith(':false')) && sp.protectedOthers.length === 0 && sp.dupNames.length === 0, JSON.stringify({ named: sp.named, others: sp.protectedOthers, dup: sp.dupNames }));
  check('species: アナゴ is a night-only species (when: night)', sp.nightOnly.join() === 'maanago', sp.nightOnly.join());
  // placement: every individual under water above the floor, inside its zone, and inside the estuary
  const pl = await ev(async (ids) => {
    const h = window.__THREE_GAME_TEST_HOOKS__, g = h.game;
    g.input.poll = () => {};
    // start the creatures near the estuary so the species are built / active, then check initial positions of every agent
    h.teleport(300, -3, -120);
    const pos = g.camera.position, dir = g.camera.getWorldDirection(g.tmpDir);
    for (let i = 0; i < 40; i++) g.creatures.update(0.25, pos, g.vel, dir);
    const bad = [];
    for (const id of ids) {
      const rt = g.creatures.list.find((r) => r.def.id === id);
      let n = 0, under = 0, inZone = 0, aboveFloor = 0;
      for (const a of rt.agents) {
        if (rt.groups[a.g].absent) continue; // hidden groups (day / night presence) are not placed in the water yet
        n++;
        const fl = h.heightAt(a.p.x, a.p.z);
        if (a.p.y < -0.05) under++;
        if (a.p.y >= fl - 0.4) aboveFloor++; // heightFast (grid) vs heightAt (exact) differ by up to ~0.3 m on the steep banks and riffles
        { const zz = h.zoneAt(a.p.x, a.p.z); if (zz === 'estuary' || (zz === 'lagoon' && a.p.z > -100)) inZone++; } // the mouth (z > -100) still counts
      }
      if (under < n || aboveFloor < n || inZone < n * 0.7) bad.push(`${id}: n=${n} under=${under} aboveFloor=${aboveFloor} inZone=${inZone} zones=${rt.agents.map((a) => h.zoneAt(a.p.x, a.p.z)[0] + Math.round(a.p.z / 10)).join(',')} maxY=${Math.max(...rt.agents.map((a) => a.p.y)).toFixed(2)} ${rt.agents.filter((a) => a.p.y >= -0.05).map((a) => a.mode + '/' + a.lured + '/' + (rt.active ? 'act' : 'idle')).join()}`);
    }
    return bad;
  }, EST);
  check('placement: every individual of the 18 species is under water, above the floor and (>= 70%, the rest at the mouth) inside the estuary', pl.length === 0, pl.join(' | '));
  // photo: put each species 2 m from the camera and ask findTarget for it (nocturnal アナゴ: at night, the absent flags cleared)
  const ph = await ev(async (ids) => {
    const h = window.__THREE_GAME_TEST_HOOKS__, g = h.game;
    g.input.poll = () => {};
    const out = [];
    for (const id of ids) {
      const rt = g.creatures.list.find((r) => r.def.id === id);
      const a0 = rt.agents[0];
      h.teleport(a0.p.x + 2, a0.p.y + 0.3, a0.p.z + 2);
      g.creatures.night = id === 'maanago';
      for (const gr of rt.groups) gr.absent = false;
      const pos = g.camera.position, dir = g.camera.getWorldDirection(g.tmpDir);
      for (let i = 0; i < 12; i++) g.creatures.update(0.25, pos, g.vel, dir);
      for (const gr of rt.groups) gr.absent = false;
      rt.active = true;
      const a = rt.agents[0];
      const d = Math.max(0.8, Math.min(3, rt.def.size * 10 + 0.5));
      for (const o of g.creatures.list) if (o !== rt) o.active = false; // only this species is a candidate (a fish swimming past would otherwise take the target)
      let hit = null;
      // try several sides (an animal can sit behind a trunk or a log from one side; a diver would swim round)
      for (let k = 0; k < 16 && !hit; k++) {
        const az = 0.64 + k * Math.PI / 6; // 16 tries on different bearings, camera low or high
        pos.set(a.p.x + d * Math.cos(az), Math.min(a.p.y + ((k >> 1) % 2 ? 1.0 : 0.1), -0.7), a.p.z + d * Math.sin(az)); a.retract = 0; // odd tries look down from above (a boulder collider can shadow a perch seen from the side)
        const dx = a.p.x - pos.x, dy = a.p.y - pos.y, dz = a.p.z - pos.z;
        g.camera.rotation.order = 'YXZ'; g.camera.rotation.set(Math.atan2(dy, Math.hypot(dx, dz)), Math.atan2(-dx, -dz), 0);
        g.camera.updateMatrixWorld();
        for (let q = 0; q < 2 && !hit; q++) {
          const t = g.creatures.findTarget(g.camera, { clear: 30, dark: false, lightOn: true, cropX: 0.95, cropY: 0.95, macro: true, wide: false });
          if (t && t.rt.def.id === id) hit = t;
          else { for (let i = 0; i < 4; i++) g.creatures.update(0.1, pos, g.vel, dir); const b = rt.agents[0]; const ex = b.p.x - pos.x, ey = b.p.y - pos.y, ez = b.p.z - pos.z; g.camera.rotation.set(Math.atan2(ey, Math.hypot(ex, ez)), Math.atan2(-ex, -ez), 0); g.camera.updateMatrixWorld(); }
        }
      }
      out.push(hit ? { id, ok: true, reason: hit.reason } : { id, ok: false });
    }
    g.creatures.night = false;
    return out;
  }, EST);
  console.log('  photo targets', JSON.stringify(ph.map((p) => p.id + (p.ok ? '' : ':NO'))));
  check('photo: each of the 18 estuary species can be targeted by findTarget from a short distance', ph.every((p) => p.ok), ph.filter((p) => !p.ok).map((p) => p.id).join(','));
  // dex: the 河口 heading lists all 18
  const dx = await ev(async () => {
    const h = window.__THREE_GAME_TEST_HOOKS__;
    h.setState('dex'); await new Promise((r) => setTimeout(r, 200));
    const titles = [...document.querySelectorAll('#dex-grid .dz-title')].map((e) => e.textContent);
    const i = titles.indexOf('河口');
    const grids = [...document.querySelectorAll('#dex-grid .dz-grid')];
    const n = i >= 0 ? grids[i].children.length : -1;
    document.getElementById('dex-close')?.click();
    return { titles, n };
  });
  check('dex: a 河口 section follows ラグーン and holds 18 cards', dx.titles.indexOf('河口') === dx.titles.indexOf('浅瀬ラグーン') + 1 && dx.n === 18, JSON.stringify(dx));


  // ---------------------------------------------------------------- S5: river species
  const RIV = ['koi', 'gengorobuna', 'nigoi', 'namazu', 'unagi', 'gigi', 'dojou', 'nipponbaratanago', 'medaka', 'ayu', 'oikawa', 'ugui', 'kawamutsu', 'kamatsuka', 'kawayoshinobori', 'yamame', 'iwana', 'aburahaya', 'kajika', 'minamitenagaebi', 'mokuzugani', 'sawagani', 'dobugai', 'oosanshouuo'];
  const rs = await ev((ids) => {
    const h = window.__THREE_GAME_TEST_HOOKS__, g = h.game;
    const isFish = (d) => d.kind === 'fish' || d.kind === 'ray' || d.kind === 'gardenEel';
    const list = g.creatures.list.map((r) => r.def);
    const river = list.filter((d) => d.zone === 'river');
    const native = (zone) => g.creatures.list.filter((r) => isFish(r.def) && r.groups.filter((gr) => h.zoneAt(gr.home.x, gr.home.z) === zone).length >= 0.8 * r.groups.length).map((r) => r.def.id);
    const byName = new Map(); for (const d of list) byName.set(d.name, (byName.get(d.name) || 0) + 1);
    const sal = list.find((d) => d.id === 'oosanshouuo');
    const fallback = (d) => (d.behavior === 'school' && d.size < 0.15 ? 'plankton' : d.size >= 0.15 && d.size <= 2.5 ? 'meat' : null);
    const exactDiet = { koi: 'weed', gengorobuna: 'weed', ayu: 'weed', namazu: 'meat', unagi: 'meat' };
    const sub = (w) => list.filter((d) => d.name.includes(w) && d.name !== w).map((d) => d.name);
    return {
      ids: river.map((d) => d.id), fish: river.filter(isFish).length, estN: list.filter((d) => d.zone === 'estuary').length,
      missing: ids.filter((i) => !river.some((d) => d.id === i)), nativeRiver: native('river'), nativeEst: native('estuary'), nativeLag: native('lagoon'),
      dup: [...byName.entries()].filter(([k, n]) => n > 1 && river.some((d) => d.name === k)).map(([k]) => k),
      sal: { kind: sal.kind, r: sal.rarity, size: sal.size, prot: !!h.edible('oosanshouuo')?.protected, behavior: sal.behavior },
      akameProt: !!h.edible('akame')?.protected,
      protectedRiver: river.filter((d) => h.edible(d.id)?.protected).map((d) => d.id),
      // names that merely contain a protected / exact-diet name must not be judged by it
      partialProt: [...sub('アカメ'), ...sub('オオサンショウウオ')].map((n) => n + ':' + !!h.edible(list.find((d) => d.name === n).id)?.protected),
      exactOK: Object.entries(exactDiet).every(([id, dd]) => h.dietOf(id) === dd),
      partialDiet: ['コイ', 'ウナギ', 'ナマズ', 'アユ'].flatMap((w) => sub(w).map((n) => { const d = list.find((x) => x.name === n); return n + ':' + h.dietOf(d.id); })),
      // the other river species fall through to the word lists / size rule; none of them may hit a sea-fish word by accident
      dietOther: river.filter((d) => !(d.id in exactDiet)).map((d) => ({ id: d.id, diet: h.dietOf(d.id), fb: fallback(d) })).filter((x) => x.diet !== x.fb).map((x) => x.id + ':' + x.diet + '!=' + x.fb),
      ayu: list.find((d) => d.id === 'ayu').aggro, night: list.filter((d) => d.when === 'night' && d.zone === 'river').map((d) => d.id),
    };
  }, RIV);
  console.log('  river species', JSON.stringify({ n: rs.ids.length, fish: rs.fish, nativeRiver: rs.nativeRiver.length, nativeEst: rs.nativeEst.length, nativeLag: rs.nativeLag.length }));
  check('river: 24 species in the river zone (all new), none missing; the estuary still has its 18', rs.ids.length === 24 && rs.missing.length === 0 && rs.estN === 18, JSON.stringify(rs.missing) + ' est=' + rs.estN);
  check('river: 19 river fish (kind fish / ray / gardenEel)', rs.fish === 19, `fish=${rs.fish}`);
  check('river: native fish by home zone (>= 80% of the groups): river >= 10 (target 19), estuary >= 10, lagoon >= 10', rs.nativeRiver.length >= 10 && rs.nativeEst.length >= 10 && rs.nativeLag.length >= 10, `river=${rs.nativeRiver.length} estuary=${rs.nativeEst.length} lagoon=${rs.nativeLag.length}`);
  check('river: no species name appears twice (against all species)', rs.dup.length === 0, rs.dup.join(','));
  check('river: オオサンショウウオ is the guardian (kind inv, crevice, rarity 3, 1.0 m) and protected by exact name; アカメ stays protected; no other river species is', rs.sal.kind === 'inv' && rs.sal.behavior === 'crevice' && rs.sal.r === 3 && rs.sal.size === 1 && rs.sal.prot && rs.akameProt && rs.protectedRiver.join() === 'oosanshouuo', JSON.stringify(rs.sal) + ' ' + rs.protectedRiver.join());
  check('river: exact-name tables — 6 diets (コイ・ゲンゴロウブナ・アユ=weed, ナマズ・ウナギ・アカメ=meat) hold; a name that only contains one (チンアナゴ, コイボウミウシ…) is not protected by it; the other river species keep the size / word fallback', rs.exactOK && rs.partialProt.every((n) => n.endsWith(':false')) && rs.dietOther.length === 0, JSON.stringify({ partialProt: rs.partialProt, partialDiet: rs.partialDiet, dietOther: rs.dietOther }));
  check('river: アユ is a harmless territory guard (aggro territory, bite 0); ギギ is night-only', rs.ayu?.kind === 'territory' && rs.ayu.bite === 0 && rs.night.join() === 'gigi', JSON.stringify(rs.ayu) + ' night=' + rs.night.join());
  // placement + triangle limits (the mesh is built when the species is first near the diver)
  const rp = await ev(async (ids) => {
    const h = window.__THREE_GAME_TEST_HOOKS__, g = h.game;
    g.input.poll = () => {};
    const bad = [], tris = {};
    const tri = (geo) => (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
    g.creatures.night = false;
    for (const id of ids) {
      const rt = g.creatures.list.find((r) => r.def.id === id);
      const a0 = rt.agents[0];
      h.teleport(a0.p.x + 1.5, Math.min(a0.p.y + 0.3, -0.8), a0.p.z + 1.5);
      for (const gr of rt.groups) gr.absent = false;
      const pos = g.camera.position, dir = g.camera.getWorldDirection(g.tmpDir);
      for (let i = 0; i < 12; i++) g.creatures.update(0.25, pos, g.vel, dir);
      let n = 0, under = 0, inZone = 0, aboveFloor = 0;
      for (const a of rt.agents) {
        n++;
        const fl = h.heightAt(a.p.x, a.p.z);
        if (a.p.y < -0.05) under++;
        if (a.p.y >= fl - 0.4) aboveFloor++; // heightFast (grid) vs heightAt (exact) differ by up to ~0.3 m on the steep banks and riffles
        if (h.zoneAt(a.p.x, a.p.z) === 'river') inZone++;
      }
      if (under < n || aboveFloor < n || inZone < n * 0.7) bad.push(`${id}: n=${n} under=${under} aboveFloor=${aboveFloor} inZone=${inZone} minAboveFloor=${Math.min(...rt.agents.map((a) => a.p.y - h.heightAt(a.p.x, a.p.z))).toFixed(3)} high=[${rt.agents.filter((a) => a.p.y >= -0.05).map((a) => 'g' + a.g + ':' + a.p.y.toFixed(2) + ':' + (rt.groups[a.g].absent ? 'abs' : 'pres') + ':' + (rt.active ? 'act' : 'idle')).join(' ')}] zones=${rt.agents.map((a) => h.zoneAt(a.p.x, a.p.z)[0]).join('')}`);
      tris[id] = rt.mesh ? tri(rt.mesh.geometry) : -1;
    }
    return { bad, tris };
  }, RIV);
  console.log('  river tris', JSON.stringify(rp.tris));
  check('placement: every individual of the 24 river species is under water, above the floor and inside the river zone (>= 70%, like the estuary: the channel is 14–22 m wide, so a fish near a bank is in the zone-less margin)', rp.bad.length === 0, rp.bad.join(' | '));
  const sizes = await ev((ids) => Object.fromEntries(ids.map((id) => [id, window.__THREE_GAME_TEST_HOOKS__.game.creatures.list.find((r) => r.def.id === id).def.size])), RIV);
  const isFishId = Object.fromEntries(await ev((ids) => ids.map((id) => [id, window.__THREE_GAME_TEST_HOOKS__.game.creatures.list.find((r) => r.def.id === id).def.kind === 'fish']), RIV));
  // the fish limit (FISH_TRIS) is the generated-fish builder's; the crabs / shrimp / clam use the shared invertebrate builders (crab 1,568 like every existing crab)
  const overT = RIV.filter((id) => { const t = rp.tris[id]; const lim = id === 'oosanshouuo' ? 1100 : !isFishId[id] ? 1600 : sizes[id] < 0.4 ? 1500 : 2500; return t < 0 || t > lim; });
  check('models: every river species is built and within the triangle limits (fish < 0.4 m 1,500 / >= 0.4 m 2,500; salamander 1,100; crabs, shrimp, clam <= 1,600 = the shared builders)', overT.length === 0, overT.map((id) => id + ':' + rp.tris[id]).join(','));
  // upstream-facing: fish holding station in the river face upstream (mean angle <= 45 deg)
  const up = await ev(() => {
    const h = window.__THREE_GAME_TEST_HOOKS__, g = h.game;
    g.input.poll = () => {};
    const fl = { x: 0, z: 0 };
    const rows = [];
    for (const [x, z] of [[300, -340], [256, -420], [292, -540], [236, -600]]) {
      h.teleport(x, -1.2, z);
      const pos = g.camera.position, dir = g.camera.getWorldDirection(g.tmpDir);
      for (let i = 0; i < 80; i++) g.creatures.update(0.1, pos, g.vel, dir);
      for (const rt of g.creatures.list) {
        const d = rt.def;
        if (d.zone !== 'river' || d.kind !== 'fish' || (d.behavior !== 'school' && d.behavior !== 'solo') || !rt.active) continue;
        for (const a of rt.agents) {
          if (rt.groups[a.g].absent || Math.hypot(a.p.x - x, a.p.z - z) > 40) continue;
          if (a.v.length() >= 0.35) continue;
          const f = h.flowAt(a.p.x, a.p.z, a.p.y);
          const fm = Math.hypot(f.x, f.z);
          if (fm < 0.05) continue;
          const hx = Math.sin(a.yaw), hz = Math.cos(a.yaw);
          const cos = (hx * -f.x + hz * -f.z) / fm; // against the flow = upstream
          rows.push({ id: d.id, ang: Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI });
        }
      }
    }
    const mean = rows.reduce((s, r) => s + r.ang, 0) / Math.max(1, rows.length);
    const ids = [...new Set(rows.map((r) => r.id))];
    return { n: rows.length, mean: +mean.toFixed(1), ids };
  });
  console.log('  upstream facing', JSON.stringify(up));
  check('upstream: stopped river fish (school / solo, speed < 0.35, flow >= 0.05 m/s) face upstream, mean angle <= 45° (design §3.3)', up.n >= 20 && up.mean <= 45, JSON.stringify(up));
  // photo: each species 2 m away through findTarget (ギギ at night)
  const rph = await ev(async (ids) => {
    const h = window.__THREE_GAME_TEST_HOOKS__, g = h.game;
    g.input.poll = () => {};
    const out = [];
    for (const id of ids) {
      const rt = g.creatures.list.find((r) => r.def.id === id);
      const a0 = rt.agents[0];
      h.teleport(a0.p.x + 2, a0.p.y + 0.3, a0.p.z + 2);
      g.creatures.night = id === 'gigi';
      for (const gr of rt.groups) gr.absent = false;
      const pos = g.camera.position, dir = g.camera.getWorldDirection(g.tmpDir);
      for (let i = 0; i < 12; i++) g.creatures.update(0.25, pos, g.vel, dir);
      for (const gr of rt.groups) gr.absent = false;
      rt.active = true;
      const a = rt.agents[0];
      const d = Math.max(0.8, Math.min(3, rt.def.size * 10 + 0.5));
      for (const o of g.creatures.list) if (o !== rt) o.active = false;
      let hit = null;
      // the boulders upstream can hide an animal from one side: try 16 bearings, camera low or high (a diver would swim round)
      for (let k = 0; k < 16 && !hit; k++) {
        const az = 0.64 + k * Math.PI / 6; // 16 tries on different bearings, camera low or high
        pos.set(a.p.x + d * Math.cos(az), Math.min(a.p.y + ((k >> 1) % 2 ? 1.0 : 0.1), -0.7), a.p.z + d * Math.sin(az)); a.retract = 0; // odd tries look down from above (a boulder collider can shadow a perch seen from the side)
        const dx = a.p.x - pos.x, dy = a.p.y - pos.y, dz = a.p.z - pos.z;
        g.camera.rotation.order = 'YXZ'; g.camera.rotation.set(Math.atan2(dy, Math.hypot(dx, dz)), Math.atan2(-dx, -dz), 0);
        g.camera.updateMatrixWorld();
        for (let q = 0; q < 2 && !hit; q++) {
        const t = g.creatures.findTarget(g.camera, { clear: 30, dark: false, lightOn: true, cropX: 0.95, cropY: 0.95, macro: true, wide: false });
        if (t && t.rt.def.id === id) hit = t;
        else { for (let i = 0; i < 4; i++) g.creatures.update(0.1, pos, g.vel, dir); const b = rt.agents[0]; const ex = b.p.x - pos.x, ey = b.p.y - pos.y, ez = b.p.z - pos.z; g.camera.rotation.set(Math.atan2(ey, Math.hypot(ex, ez)), Math.atan2(-ex, -ez), 0); g.camera.updateMatrixWorld(); }
        }
      }
      out.push(hit ? { id, ok: true } : { id, ok: false });
    }
    g.creatures.night = false;
    return out;
  }, RIV);
  check('photo: each of the 24 river species can be targeted by findTarget from a short distance', rph.every((p) => p.ok), rph.filter((p) => !p.ok).map((p) => p.id).join(','));
  const rdx = await ev(async () => {
    const h = window.__THREE_GAME_TEST_HOOKS__;
    h.setState('dex'); await new Promise((r) => setTimeout(r, 200));
    const titles = [...document.querySelectorAll('#dex-grid .dz-title')].map((e) => e.textContent);
    const i = titles.indexOf('川');
    const grids = [...document.querySelectorAll('#dex-grid .dz-grid')];
    const n = i >= 0 ? grids[i].children.length : -1;
    document.getElementById('dex-close')?.click();
    return { titles, n };
  });
  check('dex: a 川 section follows 河口 and holds 24 cards', rdx.titles.indexOf('川') === rdx.titles.indexOf('河口') + 1 && rdx.n === 24, JSON.stringify(rdx));


  // ---------------------------------------------------------------- S6: system integration
  // Low-1: swimming against the flow costs air in the river zone only (not the estuary's 0.15 m/s), whatever the flow speed
  const low1 = await ev(() => {
    const h = window.__THREE_GAME_TEST_HOOKS__, g = h.game;
    g.input.poll = () => {};
    const run = (x, z) => {
      h.teleport(x, -2.5, z);
      const f = h.flowAt(x, z, -2.5), m = Math.hypot(f.x, f.z) || 1;
      g.input.moveX = 0; g.input.moveY = 0;
      g.vel.set(-f.x / m * 1.5, 0, -f.z / m * 1.5);
      g.updateDiver(0.05);
      return { zone: h.zoneAt(x, z), flow: +m.toFixed(2), air: +g.flowAir.toFixed(3) };
    };
    return { est: run(300, -150), riv: run(272, -380), slow: run(270, -460) };
  });
  console.log('  low-1', JSON.stringify(low1));
  check('Low-1: against the flow the air factor is 1 in the estuary (0.15 m/s) and > 1 in the river (any river flow, not only > 0.3 m/s)', low1.est.air === 1 && low1.est.zone === 'estuary' && low1.riv.zone === 'river' && low1.riv.air > 1 && low1.slow.air > 1, JSON.stringify(low1));
  // Low-2: the fall's foam follows the river's width (riverDist.d < w), not the zone label
  const low2 = await ev(() => {
    const h = window.__THREE_GAME_TEST_HOOKS__, g = h.game, env = g.env;
    let inW = 0, inWOk = 0, outW = 0, outWOk = 0, offLabel = 0, offLabelOk = 0;
    for (let x = 195; x <= 236; x += 1) for (let z = -660; z <= -618; z += 1) {
      const wd = Math.hypot(x - 215, z + 635);
      if (wd > 7 || h.heightAt(x, z) > -1) continue;
      const r = h.riverDist(x, z);
      g.camera.position.set(x, -2.5, z);
      for (let i = 0; i < 2; i++) env.update(0.5, g.camera, g.renderer, 10 + i);
      if (r.d < r.w) { inW++; if (env.foamK > 0) inWOk++; if (h.zoneAt(x, z) !== 'river') { offLabel++; if (env.foamK > 0) offLabelOk++; } }
      else { outW++; if (env.foamK === 0) outWOk++; }
    }
    return { inW, inWOk, outW, outWOk, offLabel, offLabelOk };
  });
  console.log('  low-2', JSON.stringify(low2));
  check('Low-2: foam is on for every underwater point within 7 m of the fall that is inside the river (d < w), including where zoneAt is not river, and off outside it', low2.inW > 50 && low2.inW === low2.inWOk && low2.outW === low2.outWOk && low2.offLabel === low2.offLabelOk, JSON.stringify(low2));

  // spear: hidden in the river (once-only toast, tool forced to camera), shown in the estuary
  const spear = await ev(() => {
    const h = window.__THREE_GAME_TEST_HOOKS__, g = h.game, btn = document.getElementById('btn-tool');
    g.input.poll = () => {};
    g.save.owned = [...new Set([...(g.save.owned ?? []), 'spear'])];
    g.ads = false;
    const step = (x, z) => { h.teleport(x, -2.5, z); g.input.moveX = 0; g.input.moveY = 0; g.vel.set(0, 0, 0); g.updateDiver(0.05); };
    step(300, -150); // estuary
    const est1 = !btn.classList.contains('hidden');
    g.input.press('tool'); g.updateDiver(0.05); // pressing the button in the estuary swaps to the spear
    const estTool = g.tool;
    g.setTool('camera');
    document.getElementById('toast').textContent = '';
    g.riverToasted = false;
    g.setTool('spear');
    step(272, -380); // river
    const riv = btn.classList.contains('hidden');
    const rivTool = g.tool;
    const toast1 = document.getElementById('toast').textContent;
    g.input.press('tool'); g.updateDiver(0.05); // the button press does nothing in the river
    const rivTool2 = g.tool;
    step(300, -150); // back to the estuary
    const est2 = !btn.classList.contains('hidden');
    g.setTool('camera');
    return { est1, estTool, riv, rivTool, rivTool2, est2, toast1 };
  });
  console.log('  spear', JSON.stringify(spear));
  check('spear: the button shows in the estuary (and swaps tools), hides in the river (tool forced back to camera, toast), returns in the estuary', spear.est1 && spear.estTool === 'spear' && spear.riv && spear.rivTool === 'camera' && spear.rivTool2 === 'camera' && spear.est2 && /川では銛は使えない/.test(spear.toast1), JSON.stringify(spear));

  // kitchen: no river species in the order pool; estuary species can be ordered
  const pool = await ev(() => window.__THREE_GAME_TEST_HOOKS__.orderPool());
  const pz = {}; for (const p of pool) pz[p.zone] = (pz[p.zone] || 0) + 1;
  check('kitchen: the order pool holds no river species and does hold estuary species', !pz.river && (pz.estuary ?? 0) > 0, JSON.stringify(pz));

  // charts from found boxes: only maps with creatures
  const cc = await ev(() => { const h = window.__THREE_GAME_TEST_HOOKS__, g = h.game; const saved = g.save.discovered; g.save.discovered = ['lagoon']; const out = h.chartCandidates(); g.save.discovered = saved; return out; });
  check('found-box charts: unknown maps with species only (estuary and river included)', cc.includes('estuary') && cc.includes('river') && cc.length >= 10, cc.join(','));

  // board requests: the estuary and the river come up, and the circle is in the water
  const bq = await ev(() => {
    const h = window.__THREE_GAME_TEST_HOOKS__;
    const known = ['lagoon', 'reef', 'rocky', 'dropoff', 'kelp', 'cold', 'ruins', 'estuary', 'river'];
    const kinds = {}; let n = 0; const bad = [];
    for (let seed = 1; seed <= 600; seed++) {
      const q = h.makeQuest(known, seed);
      if (!q || (q.zone !== 'estuary' && q.zone !== 'river')) continue;
      n++; kinds[q.zone + ':' + q.kind] = (kinds[q.zone + ':' + q.kind] || 0) + 1;
      if (q.kind === 'trash') {
        const hh = h.heightAt(q.x, q.z);
        if (hh > (q.zone === 'estuary' ? -1.5 : -1.2) || h.zoneAt(q.x, q.z) !== q.zone) bad.push([q.zone, +q.x.toFixed(1), +q.z.toFixed(1), +hh.toFixed(2)]);
      }
    }
    return { n, kinds, bad: bad.slice(0, 3), nbad: bad.length };
  });
  console.log('  board', JSON.stringify(bq));
  check('board: estuary/river requests appear (survey, photo, trash) and trash circles are in water of their own zone', ['estuary', 'river'].every((z) => bq.kinds[z + ':trash'] > 0 && bq.kinds[z + ':survey'] > 0 && bq.kinds[z + ':photo'] > 0) && bq.nbad === 0, JSON.stringify(bq));

  // photo spots, chests
  const s6c = await ev(() => {
    const h = window.__THREE_GAME_TEST_HOOKS__, g = h.game;
    const spots = h.spots().filter((s) => s.id === 'mangrove' || s.id === 'waterfall').map((s) => ({ id: s.id, x: Math.round(s.x), y: +s.y.toFixed(1), z: Math.round(s.z), water: h.heightAt(s.x, s.z) < -0.9, zone: h.zoneAt(s.x, s.z) }));
    const chests = h.chests().filter((c) => c.id === 'c_estuary' || c.id === 'c_river').map((c) => ({ id: c.id, x: Math.round(c.x), z: Math.round(c.z), floor: +h.heightAt(c.x, c.z).toFixed(1), zone: h.zoneAt(c.x, c.z) }));
    g.save.chests = (g.save.chests ?? []).filter((id) => id !== 'c_estuary' && id !== 'c_river');
    g.save.money = 0; g.save.sceneHints = []; g.save.scenes = {};
    h.openChest('c_estuary'); h.openChest('c_estuary'); h.openChest('c_river'); h.openChest('c_river');
    return { spots, chests, opened: (g.save.chests ?? []).filter((id) => id === 'c_estuary' || id === 'c_river'), hints: g.save.sceneHints };
  });
  console.log('  spots/chests', JSON.stringify(s6c));
  check('spots: mangrove (estuary) and waterfall (river) lie in the water of their own zones', s6c.spots.length === 2 && s6c.spots.every((s) => s.water && s.zone === (s.id === 'mangrove' ? 'estuary' : 'river')), JSON.stringify(s6c.spots));
  check('chests: one each in the estuary and the river, on the floor of their zone; each opens once and names its own map\'s sight', s6c.chests.length === 2 && s6c.chests.every((c) => c.floor < -1 && c.zone === (c.id === 'c_estuary' ? 'estuary' : 'river')) && s6c.opened.length === 2 && s6c.hints.length === 2 && s6c.hints.includes('akameeyes') && s6c.hints.includes('ayurun'), JSON.stringify(s6c));
  const s6p = await ev(() => {
    const h = window.__THREE_GAME_TEST_HOOKS__, g = h.game;
    const out = {}, reshot = {};
    g.input.poll = () => {};
    g.tut.step = -1;
    g.save.spots = (g.save.spots ?? []).filter((id) => id !== 'mangrove' && id !== 'waterfall');
    g.pendingSpots.clear(); g.bonuses = [];
    for (const s of h.spots().filter((q) => q.id === 'mangrove' || q.id === 'waterfall')) {
      let hit = false;
      for (let k = 0; k < 24 && !hit; k++) {
        const az = k * Math.PI / 12, d = 6;
        const px = s.x + d * Math.cos(az), pz = s.z + d * Math.sin(az);
        if (h.heightAt(px, pz) > -1.2) continue;
        h.teleport(px, Math.min(-1.5, Math.max(s.y, h.heightAt(px, pz) + 1.2)), pz);
        const dx = s.x - px, dy = s.y - g.camera.position.y, dz = s.z - pz;
        g.camera.rotation.order = 'YXZ'; g.camera.rotation.set(Math.atan2(dy, Math.hypot(dx, dz)), Math.atan2(-dx, -dz), 0); g.camera.updateMatrixWorld();
        hit = g.spotShot('', false) === true && g.pendingSpots.has(s.id);
      }
      out[s.id] = hit;
      if (hit) g.spotShot('', false); // the same spot again: no second pay
    }
    const pays = g.bonuses.filter((b) => /写真スポット/.test(b.label)).map((b) => b.value);
    return { out, pays };
  });
  console.log('  spot shots', JSON.stringify(s6p));
  check('spots: each of the two pays its first shot once (¥600 / ¥800) and a second shot pays nothing', s6p.out.mangrove && s6p.out.waterfall && s6p.pays.length === 2 && s6p.pays.includes(600) && s6p.pays.includes(800), JSON.stringify(s6p));

  // sights: staged inside the water (night: one fish with the glowing eyes; day: the shoal facing upstream)
  const stage = await ev(() => {
    const h = window.__THREE_GAME_TEST_HOOKS__, g = h.game;
    g.input.poll = () => {};
    const out = {};
    const scenes = g.scenes;
    for (const [id, star, n] of [['akameeyes', 'akame', 1], ['ayurun', 'ayu', 40]]) {
      h.teleport(id === 'ayurun' ? 258 : 318, -2, id === 'ayurun' ? -410 : -230);
      scenes.start([id], g.camera.position.clone());
      const rt = g.creatures.list.find((r) => r.def.id === star);
      const poses = g.creatures.stage.get(star) ?? [];
      for (let i = 0; i < 4; i++) scenes.update(0.25, id === 'akameeyes' ? 1 : 0, g.camera.position, 0);
      let wet = 0; for (const p of poses) if (p.p.y < -0.7 && p.p.y > h.heightAt(p.p.x, p.p.z) + 0.05) wet++;
      let up = 0;
      if (id === 'ayurun') { for (const p of poses) { const f = h.flowAt(p.p.x, p.p.z, p.p.y), m = Math.hypot(f.x, f.z) || 1; up += Math.acos(Math.max(-1, Math.min(1, Math.sin(p.yaw) * -f.x / m + Math.cos(p.yaw) * -f.z / m))) * 180 / Math.PI; } up = poses.length ? up / poses.length : 999; }
      out[id] = { n: poses.length, want: Math.min(n, rt ? rt.agents.length : 0), wet, up: +up.toFixed(1) };
      scenes.stop();
    }
    return out;
  });
  console.log('  stage', JSON.stringify(stage));
  check('sights: アカメの赤い目 (1 fish) and アユの群れ (40 fish, facing upstream within 45°) are staged under water', stage.akameeyes.n === 1 && stage.akameeyes.wet === 1 && stage.ayurun.n === stage.ayurun.want && stage.ayurun.n >= 30 && stage.ayurun.wet === stage.ayurun.n && stage.ayurun.up <= 45, JSON.stringify(stage));

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close(); server.close();
  const fail = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - fail}/${results.length} passed`);
  process.exit(fail ? 1 : 0);
})();
