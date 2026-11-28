/**
 * 修正バッチ2 F12b（サメの専用の体）の確認。
 * Usage: node scripts/probe-fix2-f12b.cjs [dist/artifact.html] [out.json]   （PROBE_CHROME で Chromium を指定）
 * 各種（サメ 25 種）を実ゲームに出して、L0/L1 の三角形数・ページエラー・撮影の判定（fit・frac・reason）・
 * 泳ぎ（左右のしなり。BEND_Y なし）を確かめる。写真テクスチャの 5 種（ジンベエザメ・アカシュモクザメ・ヨゴレ・ツマジロ・ツマグロ）は体が使われないので三角形は見ない。
 * 同じプローブを変更前の main の artifact で流して、撮影の分布が変わらないことを比べる（配置の乱数で「見つからない」が揺れる）。ONLY=id,id で絞れる。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('playwright-core')); }
const ARTIFACT = process.argv[2] || path.join(__dirname, '..', 'dist', 'artifact.html');
const OUT = process.argv[3] || '';
let failed = 0;
const check = (name, ok, extra = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`); };
const SP = [
  ['whaleshark', 'offshore'], ['ubazame', 'offshore'], ['yogore', 'offshore'], ['yoshikiri', 'offshore'], ['itachizame', 'offshore'], ['aozame', 'offshore'], ['megalodon', 'offshore'],
  ['hammerhead', 'wall'], ['silvertip', 'wall'], ['nitari', 'wall'], ['shirowani', 'wall'],
  ['tsumaguro', 'lagoon'], ['ootenjiku', 'lagoon'], ['torafuzame', 'lagoon'], ['dochizame', 'lagoon'],
  ['leopardshark', 'kelp'], ['hornshark', 'kelp'], ['oose', 'rocky'], ['nekozame', 'rocky'],
  ['kagurazame', 'deep'], ['ondenzame', 'deep'], ['darumazame', 'deep'], ['mitsukurizame', 'deep'], ['yoroizame', 'deep'], ['oomejirozame', 'bluehole'],
];
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
if (ONLY) for (let i = SP.length - 1; i >= 0; i--) if (!ONLY.includes(SP[i][0])) SP.splice(i, 1);
(async () => {
  const server = http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); r.end(fs.readFileSync(ARTIFACT)); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: process.env.PROBE_CHROME || undefined, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'] });
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_|Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 300)); });
  await page.goto(base + '/');
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
      }
      g.env.update(dt, g.camera, g.renderer, g.time);
    };
  });
  const result = {};
  let place = '';
  for (const [id, pl] of SP) {
    if (pl !== place) {
      place = pl;
      await page.evaluate((p) => window.__THREE_GAME_TEST_HOOKS__.setState(p), pl);
      await page.waitForTimeout(1200);
      await page.waitForFunction(() => !document.getElementById('fade').classList.contains('on'), null, { timeout: 60000 });
      await page.evaluate(() => { const g = window.__THREE_GAME_TEST_HOOKS__.game; g.tut.step = -1; g.paused = false; g.creatures.time += 100; g.creatures.buildBudgetMs = 1e9; window.__step(40); g.paused = true; });
    }
    const r = await page.evaluate(async (id) => {
      const h = window.__THREE_GAME_TEST_HOOKS__, g = h.game, c = g.creatures;
      const rt = c.list.find((x) => x.def.id === id);
      if (!rt) return { missing: true };
      const saved = [];
      for (const r2 of c.list) for (const gr of r2.groups) { saved.push(gr.absent); gr.absent = r2 !== rt; }
      if (!rt.agents[0]) { for (const r2 of c.list) for (const gr of r2.groups) gr.absent = saved.shift(); return { noAgent: true }; }
      rt.groups[0].absent = false;
      if (!rt.mesh) c.buildMesh(rt);
      const tri = (geo) => (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
      const out = { size: rt.def.size, tri0: tri(rt.mesh.geometry), tri1: rt.geo1 ? tri(rt.geo1) : 0, mode: rt.swimF0 !== undefined, mam: !!rt.def.fish.shark, shots: [] };
      const clear = 0.83 / g.env.fog.density;
      for (const k of [1.2, 2, 3.2]) {
        const dist = Math.max(1.6, rt.def.size * k);
        const t = h.probe(id, dist);
        const V = g.camera.position.constructor;
        const tg = c.findTarget(g.camera, { clear, dark: false, lightOn: false, cropX: 0.6, cropY: 0.8 });
        out.shots.push({ k, dist: +dist.toFixed(1), reason: t?.reason ?? null, frac: t?.frac ?? null, fit: tg ? +tg.fit.toFixed(2) : null, fill: tg ? +tg.fill.toFixed(2) : null, side: tg ? +tg.side.toFixed(2) : null, centred: tg ? +tg.centred.toFixed(2) : null });
      }
      // 泳ぎ：数フレーム進めて、体が上下にしなる（BEND_Y）かを材質の defines で見る
      out.bendY = 'BEND_Y' in (rt.mesh.material.defines ?? {});
      out.swimV2 = 'SWIM_V2' in (rt.mesh.material.defines ?? {});
      window.__step(30);
      g.renderer.render(g.scene, g.camera);
      const gl = g.renderer.getContext();
      out.glError = gl.getError();
      for (const r2 of c.list) for (const gr of r2.groups) gr.absent = saved.shift();
      return out;
    }, id);
    result[id] = r;
    if (['whaleshark', 'ubazame', 'hammerhead', 'itachizame', 'yogore', 'silvertip', 'mitsukurizame', 'oose', 'megalodon', 'nitari', 'tsumaguro', 'kagurazame'].includes(id)) {
      await page.evaluate((id) => { const h = window.__THREE_GAME_TEST_HOOKS__, g = h.game, c = g.creatures; const rt = c.list.find((x) => x.def.id === id); for (const r2 of c.list) for (const gr of r2.groups) gr.absent = r2 !== rt; rt.groups[0].absent = false; h.probe(id, rt.def.size * 2.2); window.__step(2, 0.01); g.renderer.render(g.scene, g.camera); }, id);
      await page.screenshot({ path: path.join(path.dirname(OUT || ARTIFACT), `f12b-${id}.png`) });
    }
  }
  console.log(JSON.stringify(result, null, 1).slice(0, 6000));
  if (OUT) fs.writeFileSync(OUT, JSON.stringify(result, null, 1));
  for (const [id] of SP) {
    const r = result[id];
    if (!r || r.missing || r.noAgent) { console.log(`SKIP  ${id}: ${r?.missing ? '種がない' : '個体がまだ出ていない'}`); continue; }
    if (r.mam && r.tri1 === 0) console.log(`NOTE  ${id}: 写真テクスチャの種（設計どおり対象外。体は使われない）`);
    else if (r.mam) {
      check(`${id}: 専用の体（L0 ${r.tri0.toFixed(0)}・L1 ${r.tri1.toFixed(0)} 三角形）`, r.tri0 >= 2000 && r.tri0 <= 6000 && r.tri1 > 0 && r.tri1 <= r.tri0 * 0.5);
      check(`${id}: 左右にしなる泳ぎ（SWIM_V2・BEND_Y なし）`, r.swimV2 && !r.bendY);
    }
    check(`${id}: 撮影の判定が出る（frac・fit）`, r.shots.some((s) => s.fit !== null), JSON.stringify(r.shots.map((s) => [s.k, s.reason, s.fit])));
    check(`${id}: GL エラーなし`, r.glError === 0);
  }
  check('ページエラーなし', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  server.close();
  process.exit(failed ? 1 : 0);
})();
