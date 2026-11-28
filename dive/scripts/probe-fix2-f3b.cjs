/**
 * 修正バッチ2 F3b probe: (45) 撮影カードがスティックを塞がない（右上寄り・本体は pointer-events:none・ボタンだけ auto）、
 * (47) 水面が格子状でない（水中から見上げた画面と、ボート画面の両方）。スクリーンショットは SHOT_DIR（既定 /tmp）。
 * Usage: node scripts/probe-fix2-f3b.cjs [dist/artifact.html]   (PROBE_CHROME=<chromium binary>)
 */
const path = require('path');
const http = require('http');
const fs = require('fs');
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('playwright-core')); }
const ARTIFACT = process.argv[2] || path.join(__dirname, '..', 'dist', 'artifact.html');
const SHOT = process.env.SHOT_DIR || '/tmp';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

(async () => {
  const html = fs.readFileSync(ARTIFACT);
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({ ...(process.env.PROBE_CHROME ? { executablePath: process.env.PROBE_CHROME } : {}), args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'] });
  const errors = [];
  for (const vp of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
    const tag = vp.width < vp.height ? 'p' : 'l';
    const page = await browser.newPage({ viewport: vp });
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => window.__THREE_GAME_TEST_HOOKS__, null, { timeout: 120000 });
    await page.waitForTimeout(1500);
    await page.evaluate(() => document.getElementById('pr-go')?.click());
    await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.setState('reef'));
    await page.waitForTimeout(1500);

    // ---- (45) 図鑑へ行ける種のカード
    await page.evaluate(() => {
      const g = window.__THREE_GAME_TEST_HOOKS__.game;
      g.tut.step = -1;
      const id = g.creatures.list[0].def.id;
      g.save.found[id] = { photo: '', depth: 3, t: 1, score: 50 };
      g.showDiscover(id, 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', true, undefined, 0);
      g.discoverTimer = 999;
    });
    await page.waitForTimeout(500);
    const info = await page.evaluate(() => {
      const r = (el) => { const b = el.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, pe: getComputedStyle(el).pointerEvents }; };
      const card = document.getElementById('discover');
      card.style.animation = 'none'; // 出現アニメ（scale 0.7→1）の途中で測らない
      return { card: r(card), dex: r(document.getElementById('disc-dex')), x: r(document.getElementById('disc-x')), W: innerWidth, H: innerHeight };
    });
    console.log(tag, JSON.stringify(info));
    check(`[${tag}] カードは右半分・上半分に収まる（左のスティック領域に被らない）`, info.card.r > info.W * 0.5 && info.card.l > info.W * 0.3 && info.card.b < info.H * 0.65, JSON.stringify(info.card));
    check(`[${tag}] カード本体は pointer-events:none、ボタンは auto`, info.card.pe === 'none' && info.dex.pe === 'auto' && info.x.pe === 'auto');
    check(`[${tag}] ボタンは 36px 以上`, info.dex.b - info.dex.t >= 36 && info.x.b - info.x.t >= 36);
    // カードの真上（本体）を押すとその下の要素（canvas 等）に届く
    const hit = await page.evaluate(() => { const c = document.getElementById('discover').getBoundingClientRect(); const e = document.elementFromPoint(c.left + 8, c.top + 8); return e ? e.id || e.tagName : null; });
    check(`[${tag}] カード本体の位置のタッチはカードに届かない`, hit !== 'discover' && !String(hit).startsWith('disc-'), String(hit));
    // 左側のスティック：左下から押してドラッグ → 移動入力が入る
    await page.screenshot({ path: path.join(SHOT, `f3b-card-${tag}.png`) });
    await page.evaluate(() => document.getElementById('disc-x').click());
    check(`[${tag}] ✕ で閉じる`, await page.evaluate(() => document.getElementById('discover').classList.contains('hidden')));
    await page.evaluate(() => { const g = window.__THREE_GAME_TEST_HOOKS__.game; const id = g.creatures.list[0].def.id; g.showDiscover(id, 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', true, undefined, 0); });
    await page.evaluate(() => document.getElementById('disc-dex').click());
    check(`[${tag}] 「図鑑へ」で図鑑が開く`, await page.evaluate(() => { const g = window.__THREE_GAME_TEST_HOOKS__.game; return g.state === 'dex' && document.getElementById('discover').classList.contains('hidden'); }));
    await page.evaluate(() => document.getElementById('dd-close')?.click());
    await page.waitForTimeout(300);

    // ---- (47) 水面
    await page.evaluate(() => {
      const h = window.__THREE_GAME_TEST_HOOKS__, g = h.game;
      document.getElementById('discover').classList.add('hidden');
      h.teleport(0, -4, 150); h.look(Math.PI, 1.0);
    });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(SHOT, `f3b-up-${tag}.png`) });
    await page.evaluate(() => { const h = window.__THREE_GAME_TEST_HOOKS__; h.teleport(0, -1.2, 150); h.look(Math.PI, 0.5); });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(SHOT, `f3b-up-shallow-${tag}.png`) });
    await page.close();
  }
  check('ページエラーなし', errors.length === 0, errors.join(' | '));
  await browser.close();
  server.close();
  const bad = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - bad}/${results.length} passed`);
  process.exit(bad ? 1 : 0);
})();
