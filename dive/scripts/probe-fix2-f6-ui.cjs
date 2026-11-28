/**
 * 修正バッチ2 F6 probe（画面・セーブ編）: 解放順、強力ライトの強化表示と購入、海図の入手元、深海の案内（deepChart）、旧セーブの移行、地図の霧。
 * Usage: node scripts/probe-fix2-f6-ui.cjs [dist/artifact.html]
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
  const errors = [];
  const url = `http://127.0.0.1:${server.address().port}/`;
  async function boot(seed) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    const page = await ctx.newPage();
    page.setDefaultTimeout(60000);
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.addInitScript((sv) => { if (!localStorage.getItem('blue-depths-save-v1')) localStorage.setItem('blue-depths-save-v1', JSON.stringify(sv)); }, seed);
    await page.goto(url);
    await page.waitForFunction(() => window.__THREE_GAME_TEST_HOOKS__, null, { timeout: 120000 });
    return page;
  }
  const fake = (n) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`fake${i}`, { photo: '', depth: 5, t: 1, score: 50 }]));
  const base = { found: {}, dives: 3, maxDepth: 5, money: 0, owned: [], earned: 0, discovered: ['lagoon'], visited: ['lagoon'], storyMain: 7, storyRead: 7, storyClaim: [], day: 1, clock: 300, tutorial: true, talked: ['nightRest', 'noLight', 'intro:0', 'intro:1', 'praise:0', 'shopOpen', 'tankUp', 'board', 'album', 'kitchen', 'bait'], p1: 1, p2: 1, talkMig: 1, airLv: 0, boardIntro: true };
  const openShop = async (page) => { await page.evaluate(() => document.getElementById('pr-go')?.click()); await page.waitForTimeout(700); await page.evaluate(() => document.getElementById('open-shop').click()); await page.waitForTimeout(400); };
  const jclick = (page, sel) => page.evaluate((q) => document.querySelector(q).click(), sel);
  const saved = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('blue-depths-save-v1')));

  // ============ A. 解放順の表示（図鑑 0 種：すべて「図鑑 N 種で入荷」）
  let page = await boot({ ...base, found: {} });
  await openShop(page);
  const order = await page.evaluate(() => [...document.querySelectorAll('#gear [data-buy]')].map((b) => ({ id: b.dataset.buy, t: b.textContent.replace(/\s+/g, ' ') })));
  const ids = order.map((o) => o.id);
  console.log(ids.join(','));
  check('A1 ショップの商品の並び（解放順）：ロングフィン→水中ライト→海図：流氷→フロート→ドライスーツ→手銛→マクロ→海図：ブルーホール→リブリーザー→ワイド→シールド→スクーター→探知機→大気圧潜水服',
    ids.join(',') === 'fins,torch,map_cold,float,drysuit,spear,macro,map_bluehole,rebreather,wide,shield,scooter,sonar,ads', ids.join(','));
  const needs = order.filter((o) => /図鑑(\d+)種で入荷/.test(o.t)).map((o) => ({ id: o.id, n: +o.t.match(/図鑑(\d+)種で入荷/)[1] }));
  const need = Object.fromEntries(needs.map((o) => [o.id, o.n]));
  console.log(JSON.stringify(need));
  check('A2 入荷の種数：10・20・25・30・35・50・60・80・85・95・110・120・135・150', JSON.stringify(Object.values(need)) === JSON.stringify([10, 20, 25, 30, 35, 50, 60, 80, 85, 95, 110, 120, 135, 150]), JSON.stringify(need));
  check('A3 海図：水中洞窟・海図：深海はショップにない', !ids.includes('map_cave') && !ids.includes('map_deep'));
  await page.close();
  page = await boot({ ...base, found: fake(20) });
  await openShop(page);
  const a4 = await page.evaluate(() => ({ alone: !!document.querySelector('#gear > [data-buy="light"]'), inCell: !!document.querySelector('#gear > .gear-cell > [data-buy="torch"]') && !!document.querySelector('#gear > .gear-cell > [data-buy="light"]'), up: document.querySelector('#gear .gear-cell .gear-upg')?.textContent }));
  check('A4 強力ライトの独立した枠はなく、水中ライトの枠（.gear-cell）の中に「強化：強力ライト（図鑑70種で入荷・¥2,500…）」', !a4.alone && a4.inCell && /強化：強力ライト（図鑑70種で入荷・¥2,500/.test(a4.up), JSON.stringify(a4));
  await page.close();

  // ============ B. 強化の購入
  page = await boot({ ...base, found: fake(70), money: 20000, owned: ['torch'], announced: ['torch'] });
  await openShop(page);
  const b0 = await page.evaluate(() => { const c = document.querySelector('#gear .gear-cell'); return { cell: !!c, up: c?.querySelector('.gear-upg')?.textContent, can: c?.querySelector('.gear-upg')?.classList.contains('can'), paths: c?.querySelectorAll('.gi svg path').length, alone: !!document.querySelector('#gear > button[data-buy="light"]') }; });
  console.log(JSON.stringify(b0));
  check('B1 水中ライトの枠の中に「強化する：強力ライト ¥2,500」（独立の枠なし）', b0.cell && /強化する：強力ライト ¥2,500/.test(b0.up) && b0.can && !b0.alone, JSON.stringify(b0));
  await jclick(page, '.gear-cell .gear-upg');
  await page.waitForTimeout(500);
  const b1 = await page.evaluate(() => { const c = document.querySelector('#gear .gear-cell'); return { up: c?.querySelector('.gear-upg')?.textContent, paths: c?.querySelectorAll('.gi svg path').length, cls: c.className, toast: document.body.innerText.includes('水中ライト」を強化した') }; });
  const sv = await saved(page);
  console.log(JSON.stringify(b1));
  check('B2 買うと owned に light（id は light のまま・torch も残る）、行は「強化済み：強力ライト」、アイコンが強化済みの印（path が増える）、知らせは「水中ライトを強化した」',
    sv.owned.includes('light') && sv.owned.includes('torch') && /強化済み/.test(b1.up) && b1.paths > b0.paths && /upgraded/.test(b1.cls) && b1.toast && sv.money === 17500, JSON.stringify({ owned: sv.owned, money: sv.money, ...b1 }));
  await page.close();

  page = await boot({ ...base, found: fake(69), money: 20000, owned: ['torch'], announced: ['torch'] });
  await openShop(page);
  const b3 = await page.evaluate(() => document.querySelector('#gear .gear-cell .gear-upg')?.textContent);
  check('B3 図鑑 69 種では強化は入荷前（図鑑70種で入荷・あと1種）で、押しても買えない', /図鑑70種で入荷/.test(b3) && /あと1種/.test(b3), b3);
  await jclick(page, '.gear-cell .gear-upg'); await page.waitForTimeout(300);
  check('B4 （未入荷は買えない）', !(await saved(page)).owned.includes('light'));
  await page.close();

  page = await boot({ ...base, found: fake(70), money: 20000, owned: [], announced: [] });
  await openShop(page);
  const b5 = await page.evaluate(() => document.querySelector('#gear .gear-cell .gear-upg')?.textContent);
  check('B5 水中ライトを持っていないと強化は買えず「水中ライトを買うと強化できる」', /水中ライトを買うと強化できる/.test(b5), b5);
  await page.close();

  // ============ C. 旧セーブの移行
  page = await boot({ ...base, owned: ['ads'], discovered: ['lagoon'] });
  let s1 = await saved(page); await page.waitForTimeout(1500); s1 = await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.game.save);
  check('C1 大気圧潜水服を持っているのに深海を知らない旧セーブ → 読み込み時に深海を発見済み・deepChart は見たことに', s1.discovered.includes('deep') && s1.talked.includes('deepChart') && !(await page.evaluate(() => !document.getElementById('talk').classList.contains('hidden'))), JSON.stringify(s1.discovered));
  await page.close();
  page = await boot({ ...base, story: 2, discovered: ['lagoon', 'bluehole'] });
  await page.waitForTimeout(1200);
  s1 = await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.game.save);
  check('C2 しおさい亭の話 Lv2 を読み済みの旧セーブ → 水中洞窟を発見済み（海図の入手元が変わっても失わない）。ブルーホールもそのまま', s1.discovered.includes('cave') && s1.discovered.includes('bluehole'), JSON.stringify(s1.discovered));
  await page.close();
  page = await boot({ ...base, found: { dangouo: { photo: '', depth: 5, t: 1, score: 50 }, akamatsukasa: { photo: '', depth: 25, t: 1, score: 50 } }, discovered: ['lagoon'] });
  await page.waitForTimeout(1200);
  s1 = await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.game.save);
  check('C3 すでに流氷・洞窟の生き物を撮っている（泳いで入った）旧セーブ → その海図を持っている扱い', s1.discovered.includes('cold') && s1.discovered.includes('cave') && !s1.discovered.includes('bluehole'), JSON.stringify(s1.discovered));
  await page.close();
  page = await boot({ ...base, found: fake(30), announced: ['fins', 'drysuit', 'float'], discovered: ['lagoon'], money: 9999 });
  await openShop(page);
  const dry = await page.evaluate(() => { const b = document.querySelector('#gear [data-buy="drysuit"]'); return b.className + '|' + b.textContent.replace(/\s+/g, ' '); });
  check('C4 すでに入荷を知らせた物（ドライスーツ 25→35）は、解放順の改定で引っ込まない', !/locked/.test(dry), dry);
  await page.close();

  // ============ D. 深海の案内（deepChart）：大気圧潜水服を買った直後
  page = await boot({ ...base, found: fake(150), money: 40000, owned: [], announced: [] });
  await openShop(page);
  await jclick(page, '#gear [data-buy="ads"]'); await page.waitForTimeout(500);
  check('D0 買う前は深海を知らない', !(await saved(page)).discovered.includes('deep'));
  await jclick(page, '#shop-close');
  await page.waitForFunction(() => !document.getElementById('talk').classList.contains('hidden'), null, { timeout: 15000 }).catch(() => {});
  const d1 = await page.evaluate(() => ({ open: !document.getElementById('talk').classList.contains('hidden'), text: document.querySelector('#talk .tk-text')?.textContent }));
  check('D1 ショップを出たボート画面で編集長が吹き出しで深海の場所を教える', d1.open && /大気圧潜水服を買った/.test(d1.text) && /深海/.test(d1.text), JSON.stringify(d1));
  for (let i = 0; i < 6; i++) { await page.waitForTimeout(350); if (await page.evaluate(() => document.getElementById('talk').classList.contains('hidden'))) break; await page.mouse.click(195, 330); }
  await page.waitForTimeout(500);
  const d2 = await saved(page);
  check('D2 見終わると深海を発見済み・deepChart を見たことに・ダイブポイントに「深海」が出る', d2.discovered.includes('deep') && d2.talked.includes('deepChart') && await page.evaluate(() => !!document.querySelector('#points [data-dp="deep"]')), JSON.stringify(d2.discovered));
  await page.close();

  // ============ E. 拾い物の海図の候補
  page = await boot({ ...base, discovered: ['lagoon'] });
  const cc = await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.chartCandidates());
  console.log(JSON.stringify(cc));
  check('E1 拾い物の海図の候補にゲートの 3 つと深海が入らない（岩礁・遺跡などは入る）', !['cold', 'bluehole', 'cave', 'deep'].some((a) => cc.includes(a)) && cc.includes('rocky') && cc.includes('ruins'), JSON.stringify(cc));

  // ============ F. 地図の霧
  const fog = await page.evaluate(() => {
    const h = window.__THREE_GAME_TEST_HOOKS__, mm = h.game.minimap;
    const px = (cv, x, z) => { const [a, b] = mm.px(x, z); const d = cv.getContext('2d').getImageData(Math.round(a), Math.round(b), 1, 1).data; return [d[0], d[1], d[2]]; };
    mm.known = new Set(['lagoon']);
    const closed = { cold: px(mm.view, -300, 130), blue: px(mm.view, 300, 600), cave: px(mm.view, -330, 880), reef: px(mm.view, -30, 215), chartCold: px(mm.chart, -300, 130) };
    mm.known = new Set(['lagoon', 'cold', 'bluehole', 'cave']);
    const open = { cold: px(mm.view, -300, 130), same: mm.view === mm.chart };
    mm.known = new Set(['lagoon']);
    return { closed, open };
  });
  console.log(JSON.stringify(fog));
  const lum = (c) => c[0] + c[1] + c[2];
  check('F1 海図がないエリアは、地図で霧のような暗い塗りで隠れる（海図のあるエリア・他の場所は隠れない）', lum(fog.closed.cold) < lum(fog.closed.chartCold) * 0.6 && lum(fog.closed.cold) < 150 && lum(fog.closed.blue) < 150 && lum(fog.closed.cave) < 150, JSON.stringify(fog.closed));
  check('F2 海図を得ると霧が晴れる（絵が元の地図に戻る）', fog.open.same, JSON.stringify(fog.open));
  await page.close();

  check('実行時エラーなし', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close(); server.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(failed ? `\n${failed} FAILED` : '\nALL PASS');
  process.exit(failed ? 1 : 0);
})();
