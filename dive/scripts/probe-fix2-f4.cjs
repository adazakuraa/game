/**
 * 修正バッチ2 F4 probe: 吹き出し（会話）の基盤と編集長。
 * 夜の休み方（nightRest）を実際のタップで最後まで通す／報酬の「受け取る」／一度きり／スキップ／途中で閉じたら最初から／noLight／カードのタップ／小型版／アクセシビリティ
 * Usage: node scripts/probe-fix2-f4.cjs [dist/artifact.html]   (PROBE_CHROME=<chromium binary>)
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
  const base = { found: {}, dives: 1, maxDepth: 5, money: 0, owned: [], earned: 0, discovered: ['lagoon'], visited: ['lagoon'], storyMain: 0, storyRead: 0, storyClaim: [], day: 1, clock: 780, tutorial: true, talked: [], p1: 1, p2: 1 };
  const open = (page) => page.evaluate(() => !document.getElementById('talk').classList.contains('hidden'));
  const waitOpen = (page) => page.waitForFunction(() => !document.getElementById('talk').classList.contains('hidden'), null, { timeout: 15000 });
  const text = (page) => page.evaluate(() => document.querySelector('#talk .tk-text').textContent);
  const who = (page) => page.evaluate(() => document.querySelector('#talk .tk-name').textContent);
  const saved = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('blue-depths-save-v1')));
  const tap = async (page) => { await page.waitForTimeout(300); await page.mouse.click(195, 330); await page.waitForTimeout(150); };
  const closed = (page) => page.waitForFunction(() => document.getElementById('talk').classList.contains('hidden'), null, { timeout: 8000 });

  // ============ A. チュートリアル直後の夜：褒め言葉 → 受け取る → 次の章の依頼 → nightRest（実際のタップで最後まで）
  let page = await boot(base);
  await waitOpen(page);
  const seq = [];
  seq.push([await who(page), await text(page)]);
  check('A1 暗幕が出て、吹き出し（role=dialog・aria-live）に話し手の顔・名前', await page.evaluate(() => { const r = document.getElementById('talk'); const dim = getComputedStyle(r.querySelector('.tk-dim')).backgroundColor; return r.getAttribute('role') === 'dialog' && r.getAttribute('aria-live') === 'polite' && !!r.querySelector('.tk-face svg') && /0\.6/.test(dim); }) && seq[0][0] === '編集長', JSON.stringify(seq[0]));
  await page.screenshot({ path: path.join(SHOT, 'f4-praise.png') });
  // 褒め言葉の段をタップで送り、「受け取る」の選ぶ段へ
  for (let n = 0; n < 6; n++) {
    const hasChoice = await page.evaluate(() => document.querySelectorAll('#talk .tk-choices button').length);
    if (hasChoice) break;
    await tap(page); seq.push([await who(page), await text(page)]);
  }
  const ch = await page.evaluate(() => [...document.querySelectorAll('#talk .tk-choices button')].map((b) => b.textContent));
  check('A2 褒め言葉（ストーリーの文面）→ 報酬の「受け取る／あとで」の選ぶ段', ch.join() === '受け取る,あとで' && seq.some(([, t]) => t.includes('噂どおりの腕')), JSON.stringify(seq));
  await page.click('#talk .tk-choices button');
  await page.waitForTimeout(400);
  const afterClaim = await saved(page);
  check('A3 「受け取る」で所持金が増え、受け取り待ちが消える', afterClaim.money === 1000 && !(afterClaim.storyClaim || []).length, `money=${afterClaim.money}`);
  // 次の章の依頼（intro:1）
  await page.waitForFunction(() => /あの腕なら|仕事|数/.test(document.querySelector('#talk .tk-text').textContent), null, { timeout: 8000 });
  const introSteps = [await text(page)];
  for (let n = 0; n < 5; n++) { await tap(page); const t = await text(page); if (/今日の写真/.test(t)) break; introSteps.push(t); }
  check('A4 次の章の依頼が吹き出しで出る（1 つに収まらない長さは 2〜3 段に自動で分かれる）', introSteps.length >= 2 && introSteps.length <= 3, `${introSteps.length} 段: ${introSteps.join(' / ')}`);
  // nightRest
  check('A5 nightRest の最初の 2 段（話）', (await text(page)) === '今日の写真、全部買い取ったよ。お疲れさま。', await text(page));
  await tap(page);
  check('A6 2 段目', (await text(page)).startsWith('もう日が暮れた。夜の海はライトがないと潜れない'), await text(page));
  await tap(page);
  // 操作させる：しおさい亭へ帰る
  await page.waitForTimeout(300);
  const ring = await page.evaluate(() => { const r = document.querySelector('#talk .tk-ring'); const t = document.querySelector('#daytime .dt-inn'); const a = r.getBoundingClientRect(), b = t.getBoundingClientRect(); return { shown: getComputedStyle(r).display !== 'none', around: a.left <= b.left && a.right >= b.right && a.top <= b.top && a.bottom >= b.bottom, acting: document.getElementById('talk').classList.contains('acting'), clip: document.querySelector('#talk .tk-dim').style.clipPath.slice(0, 20), cx: b.x + b.width / 2, cy: b.y + b.height / 2 }; });
  check('A7 「しおさい亭へ帰る」を指す輪が付き、そこだけ暗幕に穴が開く', ring.shown && ring.around && ring.acting && ring.clip.startsWith('polygon(evenodd'), JSON.stringify(ring));
  await page.screenshot({ path: path.join(SHOT, 'f4-point-inn.png') });
  await page.mouse.click(195, 330); await page.waitForTimeout(300);
  const stillClosed = await page.evaluate(() => document.getElementById('kitchen').classList.contains('hidden'));
  check('A8 指した所以外をタップしても進まない・しおさい亭は開かない', stillClosed && (await text(page)).startsWith('ここを押して'), await text(page));
  await page.mouse.click(ring.cx, ring.cy); await page.waitForTimeout(600);
  const kOpen = await page.evaluate(() => !document.getElementById('kitchen').classList.contains('hidden'));
  check('A9 指した要素を押すとしおさい亭が開き、女将さんの吹き出しに進む', kOpen && (await who(page)) === '女将のハルさん' && (await text(page)).includes('おかえり'), `${await who(page)} ${await text(page)}`);
  await page.waitForTimeout(300);
  const r2 = await page.evaluate(() => { const t = document.querySelector('#k-sleep').getBoundingClientRect(); return { cx: t.x + t.width / 2, cy: t.y + t.height / 2, on: document.querySelector('#talk .tk-ring').getBoundingClientRect().width > 20 }; });
  await page.screenshot({ path: path.join(SHOT, 'f4-point-sleep.png') });
  await page.mouse.click(r2.cx, r2.cy); await page.waitForTimeout(700);
  const morning = await saved(page);
  check('A10 「朝にする」を押すと朝（2 日目・clock 0）になり、編集長の「おはよう」へ', r2.on && morning.day === 2 && morning.clock === 0 && (await text(page)).startsWith('おはよう'), `day=${morning.day} ${await text(page)}`);
  await page.waitForTimeout(300);
  const kClosed = await page.evaluate(() => document.getElementById('kitchen').classList.contains('hidden'));
  const pts = await page.evaluate(() => { const r = document.querySelector('#talk .tk-ring'); const t = document.querySelector('#points').getBoundingClientRect(); const a = r.getBoundingClientRect(); return getComputedStyle(r).display !== 'none' && a.width >= t.width; });
  check('A11 しおさい亭が閉じ、ダイブポイントの一覧を指す', kClosed && pts);
  await page.screenshot({ path: path.join(SHOT, 'f4-points.png') });
  await tap(page); await closed(page);
  const fin = await saved(page);
  check('A12 一度きり：praise:0・intro:1・nightRest が talked に入り、1 回のボート画面で 3 本', ['praise:0', 'intro:1', 'nightRest'].every((k) => (fin.talked || []).includes(k)), JSON.stringify(fin.talked));
  await page.evaluate(() => { window.__THREE_GAME_TEST_HOOKS__.game.toTitle(); });
  await page.waitForTimeout(1200);
  check('A13 ボート画面に戻っても同じ台本は出ない', !(await open(page)));
  const card = await page.evaluate(() => document.getElementById('story-card').innerText);
  check('A14 章カードは短い表示（第◯章・目標）で、長い依頼文は載らない', card.includes('第2章') && card.includes('目標') && !card.includes('正式に仕事を頼みたい'), card.replace(/\n/g, ' / '));
  // カードのタップで今の依頼をもう一度
  await page.click('#story-card .sc-title');
  await waitOpen(page);
  const re = await text(page);
  await page.click('#talk .tk-skip'); await closed(page);
  check('A15 章カードをタップすると今の依頼の吹き出しをもう一度読める（記録は増えない）', /あの腕|仕事|数/.test(re) && (await saved(page)).talked.length === fin.talked.length, re);
  // 小型版
  await page.evaluate(() => { window.__THREE_GAME_TEST_HOOKS__.game.talk.showMini('editor', '小型の吹き出し', 30); });
  const mini = await page.evaluate(() => { const m = document.getElementById('talk-mini'); return { shown: !m.classList.contains('hidden'), dim: !document.getElementById('talk').classList.contains('hidden'), live: m.getAttribute('aria-live') }; });
  await page.click('#talk-mini');
  await page.waitForTimeout(200);
  const mini2 = await page.evaluate(() => document.getElementById('talk-mini').classList.contains('hidden'));
  check('A16 小型版：暗くしない・aria-live・タップで閉じる', mini.shown && !mini.dim && mini.live === 'polite' && mini2, JSON.stringify(mini));
  await page.context().close();

  // ============ B. 途中で閉じたら最初から（保存されない）／スキップは最後まで飛ばして既読
  page = await boot({ ...base, storyMain: 1, storyRead: 1, talked: ['praise:0', 'intro:1'] });
  await waitOpen(page);
  const first = await text(page);
  await tap(page);
  const second = await text(page);
  await page.reload();
  await page.waitForFunction(() => window.__THREE_GAME_TEST_HOOKS__, null, { timeout: 120000 });
  await waitOpen(page);
  check('B1 台本の途中でアプリを閉じて開き直すと、最初からもう一度', (await text(page)) === first && first !== second && !(await saved(page)).talked.includes('nightRest'), `${first} → ${second}`);
  await page.click('#talk .tk-skip'); await closed(page);
  check('B2 スキップで台本を最後まで飛ばし、既読になる', (await saved(page)).talked.includes('nightRest'));
  await page.context().close();

  // ============ C. (16) ライトが未入荷の間の noLight：夜に戻ったとき最初の 1 回
  page = await boot({ ...base, dives: 4, storyMain: 2, storyRead: 2, talked: ['nightRest'] });
  await waitOpen(page);
  const nl = [await who(page), await text(page)];
  await tap(page); await closed(page);
  check('C1 noLight：編集長「ライトは図鑑を埋めると、ダイブショップに入荷されるぞ。」（1 段・話）', nl[0] === '編集長' && nl[1] === 'ライトは図鑑を埋めると、ダイブショップに入荷されるぞ。' && (await saved(page)).talked.includes('noLight'), JSON.stringify(nl));
  await page.evaluate(() => { window.__THREE_GAME_TEST_HOOKS__.game.toTitle(); });
  await page.waitForTimeout(1200);
  check('C2 noLight は二度出ない', !(await open(page)));
  await page.context().close();
  // 第 4 章が始まったとき（昼でも）
  page = await boot({ ...base, dives: 4, clock: 100, storyMain: 3, storyRead: 3, talked: ['nightRest'] });
  await waitOpen(page);
  check('C3 第 4 章の開始時（昼）にも noLight が出る', (await text(page)).startsWith('ライトは図鑑'), await text(page));
  await page.context().close();
  // ライトが入荷済みなら出ない・チュートリアルの夜では出ない
  page = await boot({ ...base, dives: 4, storyMain: 2, storyRead: 2, found: Object.fromEntries(Array.from({ length: 60 }, (_, i) => ['x' + i, { photo: '', depth: 1, t: 0 }])), talked: ['nightRest'] });
  await page.waitForTimeout(2500);
  check('C4 ライトが入荷済みなら noLight は出ない', !(await open(page)));
  await page.context().close();
  page = await boot({ ...base, storyMain: 1, storyRead: 1, talked: ['praise:0', 'intro:1'] });
  await waitOpen(page);
  check('C5 チュートリアルの夜は noLight でなく nightRest', (await text(page)).startsWith('今日の写真'), await text(page));
  await page.context().close();

  // ============ D. 受け取りを「あとで」→ カードのタップで「受け取る」の吹き出し／上限 3 本／既存プレイヤーの移行
  page = await boot({ ...base, dives: 3, storyMain: 2, storyRead: 2, storyClaim: [1], clock: 100, found: Object.fromEntries(Array.from({ length: 15 }, (_, i) => ['y' + i, { photo: '', depth: 1, t: 0 }])), talked: ['nightRest'] });
  await waitOpen(page);
  for (let n = 0; n < 4; n++) { if (await page.evaluate(() => document.querySelectorAll('#talk .tk-choices button').length)) break; await tap(page); }
  await page.click('#talk .tk-choices button:nth-child(2)'); await page.waitForTimeout(400);
  const later = await saved(page);
  await page.waitForTimeout(800);
  const open1 = await open(page);
  check('D1 「あとで」を選ぶと受け取り待ちが残る（所持金は増えない）', (later.storyClaim || []).includes(1) && !later.money, JSON.stringify(later.storyClaim));
  if (open1) { await page.click('#talk .tk-skip'); await closed(page); }
  await page.click('#story-card .sc-title');
  await waitOpen(page);
  const hasChoice = await page.evaluate(() => [...document.querySelectorAll('#talk .tk-choices button')].map((b) => b.textContent).join());
  await page.click('#talk .tk-choices button'); await page.waitForTimeout(500);
  check('D2 カードのタップで「受け取る」の吹き出しが再び出て、受け取れる', hasChoice === '受け取る,あとで' && (await saved(page)).money === 3000, hasChoice);
  await page.context().close();
  // 既存プレイヤー（talked なし・もう潜った）は nightRest を見たことにする
  const old = { ...base, dives: 5, storyMain: 2, storyRead: 2 }; delete old.talked; old.clock = 100;
  page = await boot(old);
  await page.waitForTimeout(2000);
  check('D3 既存プレイヤー（talked なし・もう潜った）に nightRest は出ない', !(await open(page)));
  const st = await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.game.save.talked);
  check('D4 読み込み時に talked に nightRest が入る', Array.isArray(st) && st.includes('nightRest'), JSON.stringify(st));
  await page.context().close();

  // ============ E. 横長（844×390）でも吹き出しが画面内に収まり、指す先が隠れない
  page = await boot(base, { width: 844, height: 390 });
  await waitOpen(page);
  const land = await page.evaluate(() => { const b = document.querySelector('#talk .tk-box').getBoundingClientRect(); return { top: b.top, bottom: b.bottom, h: innerHeight }; });
  check('E1 横長で吹き出しが画面内', land.top >= 0 && land.bottom <= land.h + 1, JSON.stringify(land));
  await page.screenshot({ path: path.join(SHOT, 'f4-landscape.png') });
  await page.context().close();

  check('エラーなし', errors.length === 0, errors.join(' | ').slice(0, 300));
  await browser.close(); server.close();
  const fail = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - fail}/${results.length} passed`);
  process.exit(fail ? 1 : 0);
})();
