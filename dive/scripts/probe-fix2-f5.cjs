/**
 * 修正バッチ2 F5 probe: 機能解放・新アイテムの操作チュートリアル。
 * shopOpen（買える／買えない）・tankUp・board・album・kitchen・bait・item:<id>（潜水中の小型吹き出し）・既存プレイヤーの移行・一度きり。
 * Usage: node scripts/probe-fix2-f5.cjs [dist/artifact.html]   (PROBE_CHROME=<chromium binary>)
 */
const path = require('path');
const http = require('http');
const fs = require('fs');
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('playwright-core')); }
const ARTIFACT = process.argv[2] || path.join(__dirname, '..', 'dist', 'artifact.html');
const EXE = process.env.PROBE_CHROME;
const SHOT = process.env.SHOT_DIR || '/tmp';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

(async () => {
  const html = fs.readFileSync(ARTIFACT);
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({ ...(EXE ? { executablePath: EXE } : {}), args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'] });
  const errors = [];
  const url = `http://127.0.0.1:${server.address().port}/`;
  async function boot(seed, vp = { width: 390, height: 844 }) {
    const ctx = await browser.newContext({ viewport: vp });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    const page = await ctx.newPage();
    page.setDefaultTimeout(60000);
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.addInitScript((sv) => { if (!localStorage.getItem('blue-depths-save-v1')) localStorage.setItem('blue-depths-save-v1', JSON.stringify(sv)); }, seed);
    await page.goto(url);
    await page.waitForFunction(() => window.__THREE_GAME_TEST_HOOKS__, null, { timeout: 120000 });
    return page;
  }
  const ids = ['gardeneel', 'stingray', 'flounder', 'boxfish', 'turtle', 'clownfish', 'bluetang', 'moorishidol', 'butterfly', 'parrotfish', 'chromis', 'lionfish', 'moray', 'lobster'];
  const found = (n) => Object.fromEntries(ids.slice(0, n).map((id) => [id, { photo: '', depth: 5, t: 1, score: 50 }]));
  // talkMig:1 ＝ 移行済み。nightRest は見たことにして F5 だけを見る
  const base = { found: {}, dives: 3, maxDepth: 5, money: 0, owned: [], earned: 0, discovered: ['lagoon'], visited: ['lagoon'], storyMain: 1, storyRead: 1, storyClaim: [], day: 1, clock: 300, tutorial: true, talked: ['nightRest', 'noLight', 'intro:0', 'intro:1', 'praise:0'], p1: 1, p2: 1, talkMig: 1, airLv: 0 };
  const open = (page) => page.evaluate(() => !document.getElementById('talk').classList.contains('hidden'));
  const waitOpen = (page) => page.waitForFunction(() => !document.getElementById('talk').classList.contains('hidden'), null, { timeout: 15000 });
  const text = (page) => page.evaluate(() => document.querySelector('#talk .tk-text').textContent);
  const saved = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('blue-depths-save-v1')));
  const tap = async (page) => { await page.waitForTimeout(300); await page.mouse.click(195, 330); await page.waitForTimeout(150); };
  const closed = (page) => page.waitForFunction(() => document.getElementById('talk').classList.contains('hidden'), null, { timeout: 8000 });
  const waitText = (page, re) => page.waitForFunction((s) => new RegExp(s).test(document.querySelector('#talk .tk-text').textContent), re, { timeout: 8000 });
  const ringOn = (page, sel) => page.evaluate((s) => { const r = document.querySelector('#talk .tk-ring'); const t = document.querySelector(s); if (!t) return false; const a = r.getBoundingClientRect(), b = t.getBoundingClientRect(); return getComputedStyle(r).display !== 'none' && Math.abs(a.left - b.left) < 14 && Math.abs(a.top - b.top) < 14; }, sel);
  // 指した所を押す（暗幕の穴から）
  const press = async (page, sel) => { await page.waitForTimeout(350); await page.click(sel); await page.waitForTimeout(250); };

  // ============ A. shopOpen（お金あり）
  let page = await boot({ ...base, found: found(10), money: 2000 });
  await waitOpen(page);
  check('A1 shopOpen：編集長が「新しい道具が入った」と言い、ショップのボタンを指す', /新しい道具/.test(await text(page)) && await ringOn(page, '#open-shop'), await text(page));
  await page.mouse.click(195, 330); await page.waitForTimeout(300);
  check('A2 指した所以外を押してもショップは開かない', await page.evaluate(() => document.getElementById('shop').classList.contains('hidden')));
  await press(page, '#open-shop');
  await waitText(page, 'ロングフィン');
  check('A3 ショップが開き、ロングフィンの購入ボタンを指す（暗幕はショップの上）', await ringOn(page, '[data-buy="fins"]') && !(await page.evaluate(() => document.getElementById('shop').classList.contains('hidden'))));
  await page.screenshot({ path: path.join(SHOT, 'f5-shop.png') });
  await press(page, '[data-buy="fins"]');
  await waitText(page, '装備は図鑑を埋めると');
  const sv = await saved(page);
  check('A4 購入が実際に行われ、最後に「図鑑を埋めると入荷」', sv.owned.includes('fins') && sv.money === 500, `owned=${sv.owned} money=${sv.money}`);
  await tap(page); await closed(page);
  check('A5 終わると talked に shopOpen（一度きり）', (await saved(page)).talked.includes('shopOpen'));
  await page.close();

  // ============ B. shopOpen（お金が足りない）
  page = await boot({ ...base, found: found(10), money: 100 });
  await waitOpen(page);
  await press(page, '#open-shop');
  await waitText(page, 'お金が貯まったら買おう');
  const poor = await saved(page);
  check('B1 お金が足りないと「お金が貯まったら買おう」で終わる（買わせない）', !poor.owned.includes('fins'));
  await tap(page); await waitText(page, '装備は図鑑');
  await tap(page); await closed(page);
  check('B2 台本は終わり、記録される', (await saved(page)).talked.includes('shopOpen'));
  await page.close();

  // ============ C. tankUp
  page = await boot({ ...base, found: found(5), money: 2500, talked: [...base.talked, 'shopOpen'] });
  await waitOpen(page);
  await press(page, '#open-shop');
  await waitText(page, 'タンクを強化');
  check('C1 tankUp：ショップのタンク強化ボタンを指す', await ringOn(page, '#tk-money'));
  await press(page, '#tk-money');
  await waitText(page, 'エアが長くもつ');
  const tv = await saved(page);
  check('C2 強化が実際に行われる', tv.airLv === 1 && tv.money === 500, `airLv=${tv.airLv}`);
  await tap(page); await closed(page);
  await page.close();

  // ============ D. board（5 日目の朝）
  page = await boot({ ...base, found: found(2), boardOn: true, day: 5, board: undefined, talked: [...base.talked, 'shopOpen', 'tankUp'] });
  await waitOpen(page);
  check('D1 board：女将さんが掲示板を指す', /掲示板/.test(await text(page)) && await ringOn(page, '#open-quests'), await text(page));
  await press(page, '#open-quests');
  await waitText(page, '「受ける」');
  check('D2 依頼の「受ける」を指す', await ringOn(page, '#q-board [data-take]:not([disabled])'));
  await page.screenshot({ path: path.join(SHOT, 'f5-board.png') });
  await press(page, '#q-board [data-take]:not([disabled])');
  await waitText(page, '金色の円');
  const bv = await saved(page);
  check('D3 依頼を実際に受け、使い方カードは畳まれる', (bv.quests || []).length === 1 && bv.boardIntro === true, `quests=${(bv.quests || []).length}`);
  await tap(page); await closed(page);
  await page.close();

  // ============ E. album
  page = await boot({ ...base, found: found(2), scenes: { reefglow: { photo: '', t: 1 } } });
  await waitOpen(page);
  check('E1 album：実績を指す', await ringOn(page, '#open-album'), await text(page));
  await press(page, '#open-album');
  await waitText(page, '光景と写真スポット');
  await tap(page); await closed(page);
  check('E2 記録される', (await saved(page)).talked.includes('album'));
  await page.close();

  // ============ F. kitchen（手銛）
  page = await boot({ ...base, found: found(2), owned: ['spear'], p1: 1 });
  await waitOpen(page);
  check('F1 kitchen：しおさい亭を指す', await ringOn(page, '#open-kitchen'), await text(page));
  await press(page, '#open-kitchen');
  await waitText(page, '腰を痛めて');
  let n = 0;
  while (!(await text(page)).startsWith('まずは') && n++ < 8) await tap(page);
  check('F2 女将さんの話（STORY[0] の文面）が吹き出しで流れ、「注文」タブを指す', (await text(page)).startsWith('まずは「注文」') && await ringOn(page, '[data-ktab="orders"]'));
  check('F3 第 1 話は既読になる（story=1）', (await saved(page)).story === 1);
  await press(page, '[data-ktab="orders"]');
  await waitText(page, '伝票');
  check('F4 伝票を指す', await ringOn(page, '#k-orders .k-item .what'));
  await press(page, '#k-orders .k-item .what');
  await waitText(page, '獲った魚で料理');
  await tap(page); await closed(page);
  check('F5 記録される', (await saved(page)).talked.includes('kitchen'));
  await page.close();

  // ============ G. bait（評判 Lv2）→ 潜水中の item:bait
  page = await boot({ ...base, found: found(2), owned: ['spear'], story: 1, rep: 200, orders: [], money: 1000, talked: [...base.talked, 'kitchen'] });
  await waitOpen(page);
  check('G1 bait：しおさい亭を指す', await ringOn(page, '#open-kitchen'), await text(page));
  await press(page, '#open-kitchen');
  await waitText(page, '買い物');
  await press(page, '[data-ktab="shop"]');
  await waitText(page, '好きな餌');
  check('G2 餌の購入ボタンを指す', await ringOn(page, '#k-bait [data-bait]:not([disabled])'));
  await press(page, '#k-bait [data-bait]:not([disabled])');
  await waitText(page, '次に潜ったとき');
  const gv = await saved(page);
  check('G3 餌を実際に買う', Object.values(gv.bait || {}).some((x) => x > 0), JSON.stringify(gv.bait));
  await tap(page); await closed(page);
  await page.close();

  // ============ H. item:<id> 潜水中の小型吹き出し（暗くしない・ボタンを指す・一度きり）
  const miniOpen = (page) => page.evaluate(() => !document.getElementById('talk-mini').classList.contains('hidden'));
  const miniText = (page) => page.evaluate(() => document.querySelector('#talk-mini .tk-text').textContent);
  const dive = async (page) => { await page.click('#points .pt'); await page.waitForFunction(() => !document.getElementById('talk-mini').classList.contains('hidden'), null, { timeout: 30000 }); };
  page = await boot({ ...base, found: found(2), owned: ['spear', 'torch'], story: 1, rep: 0, talked: [...base.talked, 'kitchen', 'shopOpen', 'tankUp'] });
  await dive(page);
  check('H1 spear：潜水開始直後に小型吹き出し（手銛・持ち替えボタン）', /持ち替えボタン/.test(await miniText(page)), await miniText(page));
  const hm = await page.evaluate(() => { const m = document.getElementById('talk-mini').getBoundingClientRect(); const c = document.getElementById('coach').getBoundingClientRect(); const ring = document.getElementById('talk-mini-ring'); const t = document.getElementById('btn-tool').getBoundingClientRect(); const r = ring.getBoundingClientRect(); return { dark: !document.getElementById('talk') || document.getElementById('talk').classList.contains('hidden'), mt: m.top, ct: c.top, ringOn: !ring.classList.contains('hidden') && Math.abs(r.left - t.left) < 12 && Math.abs(r.top - t.top) < 12, pe: getComputedStyle(ring).pointerEvents }; });
  check('H2 暗幕は出ず、輪が持ち替えボタンに重なる（押せなくしない）', hm.dark && hm.ringOn && hm.pe === 'none', JSON.stringify(hm));
  await page.evaluate(() => document.getElementById('talk-mini').click()); await page.waitForTimeout(200);
  check('H3 タップで 2 段目（クーラー）に進む', /クーラー/.test(await miniText(page)), await miniText(page));
  await page.evaluate(() => document.getElementById('talk-mini').click()); await page.waitForTimeout(200);
  check('H4 最後でタップすると閉じ、item:spear が記録される', !(await miniOpen(page)) && (await saved(page)).talked.includes('item:spear'));
  await page.close();
  // 同じ道具では二度目の潜水で出ない／ライトは次の潜水で（1 回の潜水では 1 つ）
  page = await boot({ ...base, found: found(2), owned: ['spear', 'torch'], story: 1, rep: 0, talked: [...base.talked, 'kitchen', 'shopOpen', 'tankUp', 'item:spear'] });
  await dive(page);
  check('H5 spear が済みなら次の道具（ライト）を指す', /ライトボタン/.test(await miniText(page)), await miniText(page));
  await page.close();
  // bait
  page = await boot({ ...base, found: found(2), owned: ['spear', 'torch'], story: 1, rep: 200, bait: { krill: 3 }, talked: [...base.talked, 'kitchen', 'shopOpen', 'tankUp', 'bait', 'item:spear', 'item:torch'] });
  await dive(page);
  check('H6 bait：餌ボタンを指す', /餌のボタン/.test(await miniText(page)) && await page.evaluate(() => { const r = document.getElementById('talk-mini-ring').getBoundingClientRect(), t = document.getElementById('btn-bait').getBoundingClientRect(); return Math.abs(r.left - t.left) < 12; }), await miniText(page));
  await page.close();

  // ============ I. 既存プレイヤー（移行）：もう使っている機能の台本は出ない
  page = await boot({ ...base, found: found(12), money: 5000, owned: ['fins', 'spear', 'torch', 'scooter'], airLv: 2, boardOn: true, boardIntro: true, story: 2, rep: 400, bait: { krill: 3 }, scenes: { baitball: { photo: '', t: 1 } }, talkMig: undefined, talked: ['nightRest'] });
  await page.waitForTimeout(3000);
  const iv = await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.game.save);
  check('I1 移行：使った印のある台本は talked に入り、吹き出しは出ない', !(await open(page)) && ['shopOpen', 'tankUp', 'board', 'album', 'kitchen', 'bait', 'item:spear', 'item:torch', 'item:scooter', 'item:bait'].every((k) => iv.talked.includes(k)) && iv.talkMig === 1, JSON.stringify(iv.talked));
  await page.close();
  // 新規（まだ潜っていない）セーブには印を付けない
  page = await boot({ found: {}, dives: 0, money: 0, owned: [], discovered: ['lagoon'], visited: ['lagoon'], storyMain: 0, storyRead: -1, p1: 1, p2: 1, airLv: 0 });
  await page.waitForTimeout(1500);
  const nv = await saved(page).catch(() => null);
  check('I2 新規セーブでは印を付けない', !nv || !(nv.talked || []).some((k) => /^(shopOpen|tankUp|board|album|kitchen|bait|item:)/.test(k)), JSON.stringify(nv && nv.talked));
  await page.close();

  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed; page errors: ${errors.length}`);
  errors.slice(0, 5).forEach((e) => console.log('ERR', e));
  await browser.close(); server.close();
  process.exit(results.every((r) => r.ok) && !errors.length ? 0 : 1);
})();
