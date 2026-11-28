/**
 * 修正バッチ2 F6 probe: 海図のゲート（流氷・ブルーホール・水中洞窟）、強力ライトのアップグレード表示、海図の入手元、深海の案内、移行、地図の霧、依頼の置き場所。
 * Usage: node scripts/probe-fix2-f6.cjs [dist/artifact.html]
 */
const path = require('path');
const http = require('http');
const fs = require('fs');
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('playwright-core')); }
const ARTIFACT = process.argv[2] || path.join(__dirname, '..', 'dist', 'artifact.html');
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
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.setState('offshore'));

  // ---- ゲート：3 方向から泳がせる（海図なし／あり）
  const swims = {
    cold: { zone: 'cold', from: [[-120, 200], [-250, 440], [-110, 380]], to: [-300, 130] },
    bluehole: { zone: 'bluehole', from: [[150, 600], [300, 800], [300, 380]], to: [300, 600] },
    cave: { zone: 'cave', from: [[-330, 700], [-100, 900], [-130, 1040]], to: [-330, 880] },
  };
  const gate = await page.evaluate((swims) => {
    const h = window.__THREE_GAME_TEST_HOOKS__, g = h.game;
    g.tut.step = -1;
    let toasts = 0;
    const origToast = g.toast.bind(g);
    g.toast = (t, ...r) => { if (String(t).includes('海図がないと進めない')) toasts++; return origToast(t, ...r); };
    const out = {};
    const swim = (area, from, to, known) => {
      g.save.discovered = ['lagoon', 'dropoff', ...(known ? [area] : [])];
      g.gateFree = new Set();
      h.teleport(from[0], -9, from[1]); g.vel.set(0, 0, 0);
      let inZone = 0, maxW = 0, minDist = 1e9; toasts = 0;
      g.input.keys.add('KeyW');
      for (let i = 0; i < 1500; i++) {
        const p = g.camera.position;
        const dx = to[0] - p.x, dz = to[1] - p.z;
        h.look(Math.atan2(-dx, -dz), 0);
        g.updateDiver(0.1); g.time += 0.1; g.air = 999;
        if (p.y > -2) p.y = -9;
        const w = h.gateWeight(area, p.x, p.z);
        maxW = Math.max(maxW, w);
        if (h.zoneAt(p.x, p.z) === swims[area].zone) inZone++;
        minDist = Math.min(minDist, Math.hypot(dx, dz));
      }
      g.input.keys.delete('KeyW');
      const p = g.camera.position;
      return { inZone, toasts, maxW: +maxW.toFixed(3), minDist: +minDist.toFixed(1), end: [Math.round(p.x), Math.round(p.z)] };
    };
    for (const [area, s] of Object.entries(swims)) {
      out[area] = { closed: s.from.map((f) => swim(area, f, s.to, false)), open: s.from.map((f) => swim(area, f, s.to, true)) };
    }
    return out;
  }, swims);
  console.log(JSON.stringify(gate));
  for (const [area, name] of [['cold', '流氷の入り江'], ['bluehole', 'ブルーホール'], ['cave', '水中洞窟']]) {
    check(`ゲート ${name}：海図なしでは 3 方向ともゾーン（0.5）に入れない`, gate[area].closed.every((r) => r.inZone === 0 && r.maxW <= 0.2 + 1e-6), JSON.stringify(gate[area].closed));
    check(`ゲート ${name}：壁まで近づける（行き止まりで手前に着く）`, gate[area].closed.every((r) => r.minDist > 5), '');
    check(`ゲート ${name}：海図ありでは 3 方向とも入れる`, gate[area].open.every((r) => r.inZone > 0), JSON.stringify(gate[area].open.map((r) => r.inZone)));
  }
  const closedAll = ['cold', 'bluehole', 'cave'].flatMap((a) => gate[a].closed);
  check('ゲート：壁に触れたらトースト「この先は流れが複雑で、海図がないと進めない」（150 秒で 4 秒に 1 回まで＝最大 38 回）', closedAll.every((r) => r.toasts >= 1 && r.toasts <= 38), JSON.stringify(closedAll.map((r) => r.toasts)));
  check('ゲート：海図ありではトーストが出ない', ['cold', 'bluehole', 'cave'].flatMap((a) => gate[a].open).every((r) => r.toasts === 0), '');

  // ---- 遺跡と洞窟の境で遺跡側は止まらない
  const ruins = await page.evaluate(() => {
    const h = window.__THREE_GAME_TEST_HOOKS__, g = h.game;
    g.save.discovered = ['lagoon', 'dropoff'];
    g.gateFree = new Set();
    // 遺跡の中（z 440〜650）を北→南に端まで泳ぐ（x=-290）
    h.teleport(-290, -9, 420); g.vel.set(0, 0, 0);
    let inRuins = 0, minZ = 1e9, maxZ = -1e9;
    g.input.keys.add('KeyW');
    for (let i = 0; i < 2200; i++) {
      const p = g.camera.position;
      h.look(Math.PI, 0); g.updateDiver(0.1); g.time += 0.1; g.air = 999; if (p.y > -2) p.y = -9;
      if (h.zoneAt(p.x, p.z) === 'ruins') inRuins++;
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    g.input.keys.delete('KeyW');
    return { inRuins, minZ: Math.round(minZ), maxZ: Math.round(maxZ), wRuins: +h.gateWeight('cave', -330, 600).toFixed(3), wEdge: +h.gateWeight('cave', -330, 774).toFixed(3) };
  });
  console.log(JSON.stringify(ruins));
  check('遺跡側は止まらない：遺跡のゾーンに入れて、洞窟の帯の手前（z≈774）まで進める', ruins.inRuins > 50 && ruins.wRuins === 0 && ruins.maxZ > 760 && ruins.maxZ < 780, JSON.stringify(ruins));

  // ---- 開始地点がもうエリアの中のとき（デバッグ）はその潜水だけゲートしない
  const free = await page.evaluate(() => {
    const h = window.__THREE_GAME_TEST_HOOKS__, g = h.game;
    g.save.discovered = ['lagoon'];
    g.gateFree = new Set(['cold']);
    return { blocked: h.gateBlocked(-300, 130), blockedBlue: h.gateBlocked(300, 600), openOutside: h.gateBlocked(0, 100) };
  });
  check('ゲートの内側の判定：未発見は内側が塞がり、外は塞がらない、gateFree は除外', free.blocked === false && free.blockedBlue === true && free.openOutside === false, JSON.stringify(free));

  // ---- 依頼の置き場所：ゲートの縁際（すぐ外）で、内側へ向けて始めても、ゲートの内側に置かない
  const runMissions = (control) => page.evaluate(async (control) => {
    const h = window.__THREE_GAME_TEST_HOOKS__, g = h.game;
    const realBlocked = g.gateBlocked.bind(g);
    if (control) g.gateBlocked = () => false;
    g.save.discovered = ['lagoon', 'dropoff'];
    g.gateFree = new Set();
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const res = { bad: 0, n: 0, kinds: {} };
    // 縁のすぐ外：重みが 0.12 の点（内側へ向かう向き）
    const edgeOf = (area, x0, z0, dx, dz) => { let x = x0, z = z0; for (let i = 0; i < 400 && h.gateWeight(area, x, z) < 0.12; i++) { x += dx; z += dz; } return [x, z, Math.atan2(-dx, -dz)]; };
    const spots = [edgeOf('cold', -120, 200, -0.5, 0), edgeOf('bluehole', 150, 600, 0.5, 0)];
    for (const [x, z, yaw] of spots) {
      for (const kind of ['urchin', 'trash', 'treasure', 'lost', 'rescue']) {
        for (let k = 0; k < 6; k++) {
          h.teleport(x, -9, z); g.vel.set(0, 0, 0); h.look(yaw, 0);
          g.missions.end?.(false, true);
          g.missions.startAt = null;
          h.startMission(kind);
          await sleep(120);
          const items = [...(g.missions.items ?? [])];
          if (g.missions.spot) items.push(g.missions.spot);
          if (g.missions.active?.spot) items.push(g.missions.active.spot);
          for (const it of items) { res.n++; if (['cold', 'bluehole', 'cave'].some((a) => h.gateWeight(a, it.x, it.z) >= 0.2)) res.bad++; }
          res.kinds[kind] = (res.kinds[kind] ?? 0) + items.length;
        }
      }
    }
    g.missions.end?.(false, true);
    g.gateBlocked = realBlocked;
    return res;
  }, control);
  const ms = await runMissions(false);
  console.log(JSON.stringify(ms));
  const ctl = await runMissions(true);
  check('（対照）ゲートの確認を外すと、内側に置かれる依頼が出る＝試験が効いている', ctl.bad > 0, JSON.stringify(ctl));
  check('依頼（ウニ・ごみ・宝・カメラ・救助）の置き場所がゲートの内側に出ない（縁際 2 か所で試行）', ms.n > 20 && ms.bad === 0, JSON.stringify(ms));

  check('実行時エラーなし', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close(); server.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(failed ? `\n${failed} FAILED` : '\nALL PASS');
  process.exit(failed ? 1 : 0);
})();
