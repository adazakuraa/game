/**
 * 修正バッチ2 F9 probe: ADS の浮上（HUD ボタンなし・一時停止から）・鯨骨生物群集（骨・生き物・写真スポット）・宝箱との重なり。
 * Usage: node scripts/probe-fix2-f9.cjs [dist/artifact.html] [screenshot-dir]
 */
const path = require('path');
const http = require('http');
const fs = require('fs');
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('playwright-core')); }
const ARTIFACT = process.argv[2] || path.join(__dirname, '..', 'dist', 'artifact.html');
const SHOTS = process.argv[3] || null;
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

(async () => {
  const html = fs.readFileSync(ARTIFACT);
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({ ...(process.env.PROBE_CHROME ? { executablePath: process.env.PROBE_CHROME } : {}), args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => window.__THREE_GAME_TEST_HOOKS__, null, { timeout: 120000 });
  await page.waitForTimeout(1500);
  await page.evaluate(() => document.getElementById('pr-go')?.click());
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.setState('deep'));
  await page.waitForTimeout(1500);

  // ---- (1) 浮上
  const s1 = await page.evaluate(() => {
    const h = window.__THREE_GAME_TEST_HOOKS__, g = h.game;
    g.tut.step = -1;
    h.teleport(20, -300, 900); g.air = 999;
    g.updateHud?.(0.1);
    const out = { ads: g.ads, canDeep: g.canSurface() };
    g.setPaused(true);
    const abort = document.getElementById('abort');
    out.abortShown = !abort.classList.contains('hidden');
    out.note = document.getElementById('pause-note').textContent;
    g.setPaused(false);
    h.teleport(20, -1.0, 900);
    out.canShallow = g.canSurface();
    return out;
  });
  check('ADS（水深300m）：canSurface が false（HUD の浮上ボタンを出さない）', s1.ads && !s1.canDeep, JSON.stringify(s1));
  check('ADS：一時停止メニューに「浮上して終了」が出る', s1.abortShown);
  check('ADS：水深1m では canSurface', s1.canShallow);
  const btnHidden = await page.evaluate(async () => {
    const h = window.__THREE_GAME_TEST_HOOKS__, g = h.game;
    h.teleport(20, -300, 900);
    await new Promise((r) => setTimeout(r, 1200));
    return { hidden: document.getElementById('surface-btn').classList.contains('hidden'), text: document.getElementById('surface-text').textContent };
  });
  check('ADS：HUD の #surface-btn が隠れている・ウインチの文言なし', btnHidden.hidden && !btnHidden.text.includes('ウインチ'), JSON.stringify(btnHidden));

  // ---- (3) 鯨骨
  const s3 = await page.evaluate(() => {
    const h = window.__THREE_GAME_TEST_HOOKS__, g = h.game;
    const spot = h.spots().find((s) => s.id === 'whalefall');
    const chest = { x: 28 + 30, z: 965 + 20 };
    const vent = { x: 28, z: 965 };
    const W = { x: -32, z: 988 };
    const homes = {};
    for (const rt of g.creatures.list) {
      const id = rt.def.id;
      if (!['isopod', 'goemonkoshiori', 'sodara', 'kagurazame', 'ondenzame', 'honekuihanamushi', 'nutaunagi'].includes(id)) continue;
      homes[id] = { groups: rt.groups.length, count: rt.def.count, whaleDef: rt.def.whale ?? null, near: rt.groups.filter((gr) => Math.hypot(gr.home.x - W.x, gr.home.z - W.z) < 18).length, zone: rt.def.zone, rarity: rt.def.rarity };
    }
    return { spot, dChest: Math.hypot(W.x - chest.x, W.z - chest.z), dVent: Math.hypot(W.x - vent.x, W.z - vent.z), homes, depth: -h.heightAt(W.x, W.z), total: g.creatures.list.length, scenes: JSON.stringify(Object.keys(window.__SCENES__ ?? {})) };
  });
  console.log(JSON.stringify(s3));
  check('写真スポット「鯨骨生物群集」がある（深海）', !!s3.spot);
  check('鯨骨は水深200m以上・噴出孔から40m以上・宝箱 c_deep から40m以上', s3.depth >= 200 && s3.dVent >= 40 && s3.dChest >= 40, `depth ${s3.depth.toFixed(0)} vent ${s3.dVent.toFixed(0)} chest ${s3.dChest.toFixed(0)}`);
  const H = s3.homes;
  check('ホネクイハナムシ（★3）：全群れが鯨骨', H.honekuihanamushi && H.honekuihanamushi.near === H.honekuihanamushi.groups && H.honekuihanamushi.rarity === 3);
  check('ヌタウナギ（★2）：全群れが鯨骨', H.nutaunagi && H.nutaunagi.near === H.nutaunagi.groups && H.nutaunagi.rarity === 2);
  for (const id of ['isopod', 'goemonkoshiori', 'sodara', 'kagurazame', 'ondenzame']) check(`${id}：群れの一部が鯨骨に住む（残りは元の場所）`, H[id] && H[id].near >= 1 && H[id].near === H[id].whaleDef && H[id].near < H[id].groups + (id === 'isopod' ? 1 : 0) && H[id].groups > H[id].near - (id === 'isopod' ? 1 : 0), JSON.stringify(H[id]));

  // 地形と見た目：鯨骨のそばへ行って撮る
  const draw = await page.evaluate(async () => {
    const h = window.__THREE_GAME_TEST_HOOKS__, g = h.game;
    g.air = 999;
    const ca = Math.cos(0.262), sa = Math.sin(0.262);
    const cx = -32, cz = 988;
    // 骨格の横 11m、軸に直角に向く
    const px = cx + sa * 17, pz = cz - ca * 17;
    h.teleport(px, h.heightAt(px, pz) + 8, pz);
    g.yaw = Math.atan2(-(cx - px), -(cz - pz)); g.pitch = -0.4;
    g.env.lightOn = true;
    await new Promise((r) => setTimeout(r, 2500));
    g.renderer.info.reset();
    g.render?.();
    return { calls: g.renderer.info.render.calls, tris: g.renderer.info.render.triangles };
  });
  console.log('draw', JSON.stringify(draw));
  if (SHOTS) {
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, 'whale-side.png') });
    await page.evaluate(() => { const h = window.__THREE_GAME_TEST_HOOKS__, g = h.game; const cx = -32, cz = 988; const px = cx + 7, pz = cz - 9; h.teleport(px, h.heightAt(px, pz) + 4.5, pz); g.yaw = Math.atan2(-(cx - px), -(cz - pz)); g.pitch = -0.3; });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(SHOTS, 'whale-close.png') });
  }
  check('ページエラーなし', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close(); server.close();
  const bad = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - bad}/${results.length} passed`);
  process.exit(bad ? 1 : 0);
})();
