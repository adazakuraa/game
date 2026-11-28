/**
 * 修正バッチ2 F2 (11): 底に付く置き物（サンゴ・岩・海綿など flora の ScatterSet）とウニ漁のウニが「浮いて」いないかの計測。
 * 足元の 5 点（中心＋四隅）で地形メッシュ（チャンクの頂点の高さの双一次補間）を測り、置き物の底面との差（浮き）を出す。
 * 使い方: node scripts/probe-float.cjs [dist/artifact.html] [出力 json]   （先に npm run artifact）
 * 浮き = 底面の高さ − 足元 5 点の地形の最小値。0.15m 以上 3m 以下を「浮き」と数える（3m を超えるものは氷・昆布の冠など底に付かない物なので hover として別に数える）。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('playwright-core')); }
const ARTIFACT = process.argv[2] || path.join(__dirname, '..', 'dist', 'artifact.html');
const OUTFILE = process.argv[3] || '/tmp/float.json';
const LIMIT = 0.15;
const MAX_INST = 24000;

(async () => {
  const server = http.createServer((q, r) => {
    if (q.url.split('?')[0] !== '/a') { r.writeHead(404); r.end(); return; }
    r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    r.end(fs.readFileSync(ARTIFACT));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: process.env.PROBE_CHROME || undefined, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.goto(base + '/a');
  await page.waitForFunction(() => window.__THREE_GAME_TEST_HOOKS__, null, { timeout: 120000 });
  await page.evaluate(() => document.getElementById('pr-go')?.click());
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.setState('title'));
  const res = await page.evaluate(({ LIMIT, MAX_INST }) => {
    const g = window.__THREE_GAME_TEST_HOOKS__.game;
    const terr = g.terrain;
    const CH = 40;
    const meshH = (x, z) => {
      const cx = Math.floor(x / CH), cz = Math.floor(z / CH);
      const m = terr.chunks.get(cx + ',' + cz);
      if (!m) return null;
      const p = m.geometry.attributes.position;
      const n = Math.round(Math.sqrt(p.count)), seg = n - 1, st = CH / seg;
      const fx = (x - cx * CH) / st, fz = (z - cz * CH) / st;
      const i = Math.min(seg - 1, Math.floor(fx)), j = Math.min(seg - 1, Math.floor(fz));
      const u = fx - i, v = fz - j;
      const y = (a, b) => p.getY((j + b) * n + (i + a));
      return y(0, 0) * (1 - u) * (1 - v) + y(1, 0) * u * (1 - v) + y(0, 1) * (1 - u) * v + y(1, 1) * u * v;
    };
    // gather instances
    const all = [];
    g.flora.sets.forEach((s, si) => {
      const geo = s.loGeo; geo.computeBoundingBox(); const bb = geo.boundingBox;
      const rad = Math.max(-bb.min.x, bb.max.x, -bb.min.z, bb.max.z);
      for (const c of s.cells) {
        const mesh = c.mesh, mm = new mesh.matrix.constructor(), P = new mesh.position.constructor(), Q = new mesh.quaternion.constructor(), S = new mesh.scale.constructor();
        for (let i = 0; i < mesh.count; i++) {
          mesh.getMatrixAt(i, mm); mm.decompose(P, Q, S);
          all.push({ si, x: P.x, y: P.y, z: P.z, base: P.y + bb.min.y * S.y, r: rad * Math.max(S.x, S.z) * 0.5, tall: bb.max.y * S.y });
        }
      }
    });
    const stride = Math.max(1, Math.ceil(all.length / MAX_INST));
    const sel = all.filter((_, i) => i % stride === 0);
    const buckets = new Map();
    for (const it of sel) { const k = Math.floor(it.x / CH) + ',' + Math.floor(it.z / CH); (buckets.get(k) ?? buckets.set(k, []).get(k)).push(it); }
    const per = new Map();
    let missing = 0;
    for (const [k, list] of buckets) {
      const [cx, cz] = k.split(',').map(Number);
      terr.prime(cx * CH + 20, cz * CH + 20, 45);
      for (const it of list) {
        let lo = Infinity, bad = false;
        for (const [dx, dz] of [[0, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
          const h = meshH(it.x + dx * it.r, it.z + dz * it.r);
          if (h === null) { bad = true; break; }
          lo = Math.min(lo, h);
        }
        if (bad) { missing++; continue; }
        const f = it.base - lo;
        let a = per.get(it.si); if (!a) per.set(it.si, (a = { si: it.si, n: 0, float: 0, hover: 0, max: -1e9, sum: 0 }));
        a.n++; a.sum += f; if (f > a.max) a.max = f; if (f > LIMIT && f <= 3) a.float++; if (f > 3) a.hover = (a.hover || 0) + 1;
      }
    }
    const info = (si) => { const geo = g.flora.sets[si].loGeo; const bb = geo.boundingBox; return { tri: Math.round((geo.index ? geo.index.count : geo.attributes.position.count) / 3), size: [bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z].map((v) => +v.toFixed(1)), minY: +bb.min.y.toFixed(2) }; };
    const sets = [...per.values()].map((a) => ({ si: a.si, ...info(a.si), n: a.n, float: a.float, hover: a.hover, max: +a.max.toFixed(2), mean: +(a.sum / a.n).toFixed(3) }));
    // urchins of the urchin mission
    return { total: all.length, sampled: sel.length, missing, sets };
  }, { LIMIT, MAX_INST });
  // urchin mission: start a dive on the reef and read item heights vs. mesh
  const urch = await (async () => {
    await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.setState('rocky'));
    await page.evaluate(() => {
      const h = window.__THREE_GAME_TEST_HOOKS__, g = h.game;
      g.tut.step = -1;
      h.startMission('urchin');
      for (let i = 0; i < 6 && !g.missions.active; i++) g.missions.update(g['missionCtx']());
    });
    return page.evaluate((LIMIT) => {
      const g = window.__THREE_GAME_TEST_HOOKS__.game;
      const m = g.missions;
      if (!m.items || !m.items.length) return { note: 'no urchin items (mission not started)' };
      const CH = 40, terr = g.terrain;
      const meshH = (x, z) => {
        terr.prime(x, z, 45);
        const cx = Math.floor(x / CH), cz = Math.floor(z / CH);
        const mm = terr.chunks.get(cx + ',' + cz); if (!mm) return null;
        const p = mm.geometry.attributes.position; const n = Math.round(Math.sqrt(p.count)), seg = n - 1, st = CH / seg;
        const fx = (x - cx * CH) / st, fz = (z - cz * CH) / st; const i = Math.min(seg - 1, Math.floor(fx)), j = Math.min(seg - 1, Math.floor(fz)); const u = fx - i, v = fz - j;
        const y = (a, b) => p.getY((j + b) * n + (i + a));
        return y(0, 0) * (1 - u) * (1 - v) + y(1, 0) * u * (1 - v) + y(0, 1) * (1 - u) * v + y(1, 1) * u * v;
      };
      const R = 0.25; let n = 0, fl = 0, mx = -1e9;
      for (const it of m.items) {
        let lo = Infinity; for (const [dx, dz] of [[0, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]]) { lo = Math.min(lo, window.__THREE_GAME_TEST_HOOKS__.surfaceAt(it.x + dx * R * 0.7, it.z + dz * R * 0.7)); }
        const f = it.y - lo; n++; if (f > LIMIT) fl++; if (f > mx) mx = f;
      }
      return { n, float: fl, max: +mx.toFixed(2) };
    }, LIMIT);
  })();
  const out = { limit: LIMIT, flora: res, urchins: urch };
  fs.writeFileSync(OUTFILE, JSON.stringify(out, null, 1));
  const t = res.sets.reduce((a, s) => ({ n: a.n + s.n, f: a.f + s.float, m: Math.max(a.m, s.max) }), { n: 0, f: 0, m: -1e9 });
  console.log(`flora: instances ${res.total} (sampled ${res.sampled}, no-chunk ${res.missing}) measured ${t.n} float>${LIMIT}m: ${t.f} max ${t.m}`);
  console.log('per set (si,n,float,max,mean):', res.sets.filter((s) => s.float).map((s) => [s.si, 'tri' + s.tri, s.size.join('x'), 'minY' + s.minY, 'n' + s.n, 'fl' + s.float, 'max' + s.max, 'mean' + s.mean].join(',')).join(' | '));
  console.log('urchins:', JSON.stringify(urch));
  await browser.close();
  server.close();
})();
