/**
 * 修正バッチ2 F7 (35)：ウニ漁の「見つけやすさ」の計測。変更前（main）と変更後の artifact で同じ手順を流して比べる。
 * 手順：岩礁へ潜る（昼・ライトなし）→ 依頼のウニ漁を N 回始め直す（そのつど置き直し）→ そのつど、開始地点（潜る位置）から 20m 以内のウニ・群れの数と、
 *       潜った向きのまま画面に映るウニの数（全部／15m 以内）を数える。変更後は群れの数（8）も出す。
 * Usage: node scripts/probe-fix2-f7-count.cjs [dist/artifact.html] [N=12]
 */
const path = require('path');
const http = require('http');
const fs = require('fs');
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('playwright-core')); }
const ARTIFACT = process.argv[2] || path.join(__dirname, '..', 'dist', 'artifact.html');
const N = Number(process.argv[3] || 12);
const EXE = process.env.PROBE_CHROME;
(async () => {
  const html = fs.readFileSync(ARTIFACT);
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({ ...(EXE ? { executablePath: EXE } : {}), args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const page = await ctx.newPage();
  page.setDefaultTimeout(90000);
  const ids = ['gardeneel', 'stingray', 'flounder', 'boxfish', 'turtle', 'clownfish', 'bluetang', 'moorishidol', 'butterfly', 'parrotfish', 'chromis', 'lionfish', 'moray', 'lobster'];
  const found = Object.fromEntries(ids.map((id) => [id, { photo: '', depth: 5, t: 1, score: 50 }]));
  const sv = { found, dives: 4, maxDepth: 5, money: 1000, owned: ['float'], earned: 0, discovered: ['lagoon', 'reef', 'rocky'], visited: ['lagoon'], storyMain: 1, storyRead: 1, storyClaim: [], day: 3, clock: 100, tutorial: true, p1: 1, p2: 1, talkMig: 1, airLv: 0, rep: 10, story: 3,
    talked: ['nightRest', 'noLight', 'intro:0', 'intro:1', 'praise:0', 'kitchen', 'shopOpen', 'tankUp', 'board', 'album', 'bait', 'item:spear', 'item:float', 'item:urchin', 'item:torch', 'deepChart'] };
  await page.addInitScript((s) => { if (!localStorage.getItem('blue-depths-save-v1')) localStorage.setItem('blue-depths-save-v1', JSON.stringify(s)); }, sv);
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => window.__THREE_GAME_TEST_HOOKS__, null, { timeout: 120000 });
  await page.waitForTimeout(1200);
  await page.click('[data-dp="rocky"]');
  await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__ && window.__THREE_GAME_DIAGNOSTICS__.state === 'diving', null, { timeout: 90000 });
  await page.waitForTimeout(2500);
  const rows = [];
  for (let n = 0; n < N; n++) {
    await page.evaluate(() => { const h = window.__THREE_GAME_TEST_HOOKS__; h.missionReset(); h.startMission('urchin'); });
    await page.waitForFunction(() => window.__THREE_GAME_TEST_HOOKS__.urchinInfo(), null, { timeout: 20000 });
    await page.waitForTimeout(250);
    const r = await page.evaluate(() => {
      const h = window.__THREE_GAME_TEST_HOOKS__, i = h.urchinInfo(), me = h.me();
      const d = (p) => Math.hypot(p.x - me.x, p.z - me.z);
      return { items: i.items.length, within20: i.items.filter((p) => d(p) <= 20).length, clusters: i.clusters.length, clustersWithin20: i.clusters.filter((c) => d(c) <= 20).length, onScreen: i.onScreen, onScreen15: i.onScreen15, edible15: i.items.filter((p) => p.type < 2 && d(p) <= 15).length, clear: i.clear };
    });
    rows.push(r);
  }
  const avg = (k) => (rows.reduce((a, r) => a + r[k], 0) / rows.length).toFixed(1);
  const mn = (k) => Math.min(...rows.map((r) => r[k])), mx = (k) => Math.max(...rows.map((r) => r[k]));
  console.log(`${path.basename(path.dirname(path.dirname(ARTIFACT)))}  N=${rows.length}  視界の目安 clear=${rows[0].clear?.toFixed?.(1)}m`);
  for (const [k, label] of [['items', 'ウニの総数'], ['within20', '開始地点から 20m 以内のウニの数'], ['clusters', '群れの数'], ['clustersWithin20', '開始地点から 20m 以内の群れの数'], ['edible15', '15m 以内の食べられるウニ'], ['onScreen', '画面に映るウニ（距離の制限なし）'], ['onScreen15', '画面に映るウニ（15m 以内）']]) console.log(`  ${label}: 平均 ${avg(k)}（最小 ${mn(k)}・最大 ${mx(k)}）`);
  await browser.close();
  server.close();
})();
