/**
 * Phase 9 probe (PHASE9-DESIGN §8.1). S2 (river: depths, flow, air, waterfall, water by position, dive point, Low fixes) is the last block. S0 (world extension + shore) and S1 (estuary terrain, water, dive point):
 *   - the shore stops the diver (heightAt stays <= -0.8) and says so; it slides instead of sticking
 *   - the creatures never leave the water in the south; no species lives in the new zones yet
 *   - the chart shows the island as land (green), the margin south of the world is land too
 *   - S1: estuary floor depths 0.9–9 m, dive point 6.5 m, zoneAt along the channel, channel swimmable (BFS + a steered swim),
 *     tea-green water 16 m with the 1.8 m salt wedge (fog colour / density above vs below), discovery banner + boat-screen entry,
 *     upstream-facing start with the boat downstream, 0.15 m/s channel flow and no change to currentF
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

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close(); server.close();
  const fail = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - fail}/${results.length} passed`);
  process.exit(fail ? 1 : 0);
})();
