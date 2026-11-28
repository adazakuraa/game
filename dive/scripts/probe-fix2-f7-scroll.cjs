/**
 * 修正バッチ2 F7 (37) の再現・確認：しおさい亭でウニ漁のボタンまでスクロール → 潜る → 浮上後の #kitchen.scrollTop と #mg の画面上の位置。
 * 変更前（main）の artifact でも動く（UI だけを操作する）。Usage: node scripts/probe-fix2-f7-scroll.cjs [dist/artifact.html]
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
  const html = fs.readFileSync(ARTIFACT);
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({ ...(EXE ? { executablePath: EXE } : {}), args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'] });
  const url = `http://127.0.0.1:${server.address().port}/`;
  const ids = ['gardeneel', 'stingray', 'flounder', 'boxfish', 'turtle', 'clownfish', 'bluetang', 'moorishidol', 'butterfly', 'parrotfish', 'chromis', 'lionfish', 'moray', 'lobster'];
  const found = Object.fromEntries(ids.map((id) => [id, { photo: '', depth: 5, t: 1, score: 50 }]));
  const base = { found, dives: 3, maxDepth: 5, money: 5000, owned: ['spear', 'float'], earned: 0, discovered: ['lagoon', 'reef', 'rocky'], visited: ['lagoon'], storyMain: 1, storyRead: 1, storyClaim: [], day: 1, clock: 300, tutorial: true, rep: 12, story: 3,
    talked: ['nightRest', 'noLight', 'intro:0', 'intro:1', 'praise:0', 'kitchen', 'shopOpen', 'tankUp', 'board', 'album', 'bait', 'item:spear', 'item:float', 'item:urchin', 'deepChart'], p1: 1, p2: 1, talkMig: 1, airLv: 0 };
  for (const vp of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
    const ctx = await browser.newContext({ viewport: vp });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    const page = await ctx.newPage();
    page.setDefaultTimeout(60000);
    await page.addInitScript((sv) => { if (!localStorage.getItem('blue-depths-save-v1')) localStorage.setItem('blue-depths-save-v1', JSON.stringify(sv)); }, base);
    await page.goto(url);
    await page.waitForFunction(() => window.__THREE_GAME_TEST_HOOKS__, null, { timeout: 120000 });
    await page.waitForTimeout(1500);
    const tag = `${vp.width}x${vp.height}`;
    await page.click('#open-kitchen');
    await page.waitForTimeout(500);
    // 店の仕事のタブ（あれば）→ ウニ漁のボタンまでスクロール
    if (await page.$('[data-ktab="work"]')) await page.click('[data-ktab="work"]');
    await page.waitForTimeout(200);
    await page.evaluate(() => { const k = document.getElementById('kitchen'); k.scrollTop = k.scrollHeight; document.getElementById('k-sort').scrollIntoView({ block: 'end' }); });
    await page.waitForTimeout(200);
    const before = await page.evaluate(() => document.getElementById('kitchen').scrollTop);
    await page.click('#k-sort');
    await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__ && window.__THREE_GAME_DIAGNOSTICS__.state === 'diving', null, { timeout: 60000 });
    await page.waitForTimeout(1500);
    await page.click('#btn-pause');
    await page.waitForTimeout(400);
    await page.click('#abort');
    await page.waitForFunction(() => !document.getElementById('mg').classList.contains('hidden'), null, { timeout: 30000 });
    await page.waitForTimeout(500);
    const r = await page.evaluate(() => {
      const k = document.getElementById('kitchen'), mg = document.getElementById('mg-box').getBoundingClientRect(), mgo = document.getElementById('mg').getBoundingClientRect();
      const h = document.querySelector('#kitchen .k-head h2').getBoundingClientRect();
      return { scrollTop: k.scrollTop, titleScroll: document.getElementById('title').scrollTop, mgTop: Math.round(mg.top), mgBottom: Math.round(mg.bottom), mgOuterTop: Math.round(mgo.top), mgPos: getComputedStyle(document.getElementById('mg')).position, headTop: Math.round(h.top), headBottom: Math.round(h.bottom), vh: innerHeight };
    });
    console.log(tag, 'スクロール前', before, JSON.stringify(r));
    await page.screenshot({ path: `/tmp/f7-37-${tag}.png` });
    check(`${tag} 浮上後の しおさい亭 scrollTop = 0`, r.scrollTop === 0, `scrollTop=${r.scrollTop}`);
    check(`${tag} 結果の箱 #mg が画面内（上端が 0 以上・下端が画面の高さ以内）`, r.mgTop >= 0 && r.mgBottom <= r.vh && r.mgOuterTop === 0, `top=${r.mgTop} bottom=${r.mgBottom} outerTop=${r.mgOuterTop} position=${r.mgPos}`);
    // 負荷をかけた確認：しおさい亭が長くスクロールしている状態でも、結果の箱が画面に固定されていること（旧：スクロールする箱の中に absolute で置かれ、画面の外に出ていた）
    const stress = await page.evaluate(() => {
      const k = document.getElementById('kitchen');
      const sp = document.createElement('div'); sp.id = 'probe-spacer'; sp.style.height = '1600px'; k.querySelector('.k-body').appendChild(sp);
      k.scrollTop = 700;
      const b = document.getElementById('mg-box').getBoundingClientRect();
      return { scrollTop: k.scrollTop, top: Math.round(b.top), bottom: Math.round(b.bottom), vh: innerHeight };
    });
    check(`${tag} 負荷：しおさい亭を 700px スクロールしても結果の箱は画面内`, stress.scrollTop > 0 && stress.top >= 0 && stress.bottom <= stress.vh, JSON.stringify(stress));
    await page.evaluate(() => { document.getElementById('probe-spacer')?.remove(); document.getElementById('kitchen').scrollTop = 0; });
    await page.click('#mg-ok');
    await page.waitForTimeout(400);
    const r2 = await page.evaluate(() => { const h = document.querySelector('#kitchen .k-head h2').getBoundingClientRect(); const t = document.querySelector('#k-tabs').getBoundingClientRect(); return { scrollTop: document.getElementById('kitchen').scrollTop, headTop: Math.round(h.top), tabsTop: Math.round(t.top), vh: innerHeight }; });
    check(`${tag} 結果を閉じた後も 見出し・タブが画面内`, r2.scrollTop === 0 && r2.headTop >= 0 && r2.headTop < r2.vh && r2.tabsTop < r2.vh, JSON.stringify(r2));
    await ctx.close();
  }
  await browser.close();
  server.close();
  const bad = results.filter((x) => !x.ok).length;
  console.log(bad ? `\n${bad} FAIL` : '\nALL PASS');
  process.exit(bad ? 1 : 0);
})();
