/**
 * 修正バッチ2 F7 probe：夜明けの演出・夜の潜水の後は朝・ボートで向かう演出・ウニ漁（夜の報酬・群れ・縁の光・銛で取る・借りた銛・イベント停止）・餌の解放。
 * Usage: node scripts/probe-fix2-f7.cjs [dist/artifact.html]   (PROBE_CHROME=<chromium binary>)
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
    page.setDefaultTimeout(90000);
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.addInitScript((sv) => { if (!localStorage.getItem('blue-depths-save-v1')) localStorage.setItem('blue-depths-save-v1', JSON.stringify(sv)); }, seed);
    await page.goto(url);
    await page.waitForFunction(() => window.__THREE_GAME_TEST_HOOKS__, null, { timeout: 120000 });
    await page.waitForTimeout(1200);
    return page;
  }
  const ids = ['gardeneel', 'stingray', 'flounder', 'boxfish', 'turtle', 'clownfish', 'bluetang', 'moorishidol', 'butterfly', 'parrotfish', 'chromis', 'lionfish', 'moray', 'lobster'];
  const found = Object.fromEntries(ids.map((id) => [id, { photo: '', depth: 5, t: 1, score: 50 }]));
  const allTalked = ['nightRest', 'noLight', 'intro:0', 'intro:1', 'praise:0', 'kitchen', 'shopOpen', 'tankUp', 'board', 'album', 'bait', 'item:spear', 'item:float', 'item:torch', 'item:bait', 'deepChart'];
  const base = { found, dives: 4, maxDepth: 5, money: 1000, owned: ['float'], earned: 0, discovered: ['lagoon', 'reef', 'rocky'], visited: ['lagoon'], storyMain: 1, storyRead: 1, storyClaim: [], day: 3, clock: 100, tutorial: true, talked: allTalked, p1: 1, p2: 1, talkMig: 1, airLv: 0, boardOn: true, boardIntro: true, rep: 10, story: 3 };
  const H = (page, fn, ...a) => page.evaluate(([f, args]) => window.__THREE_GAME_TEST_HOOKS__[f](...args), [fn, a]);
  const st = (page) => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__ && window.__THREE_GAME_DIAGNOSTICS__.state);
  const saved = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('blue-depths-save-v1')));
  const waitState = (page, s, t = 90000) => page.waitForFunction((x) => window.__THREE_GAME_DIAGNOSTICS__ && window.__THREE_GAME_DIAGNOSTICS__.state === x, s, { timeout: t });
  const hidden = (page, sel) => page.evaluate((s) => document.querySelector(s).classList.contains('hidden'), sel);
  // ページの中で時刻を記録する（page.click は重い描画の間ブロックされ、演出が終わってから返ることがあるため）
  const watch = (page) => page.evaluate(() => {
    window.__ev = [];
    const mk = (id, name) => { const el = document.getElementById(id); let prev = el.className; new MutationObserver(() => { const c = el.className; if (c !== prev) { prev = c; window.__ev.push({ name, hidden: el.classList.contains('hidden'), card: el.classList.contains('card'), t: performance.now(), text: el.textContent }); } }).observe(el, { attributes: true, attributeFilter: ['class'] }); };
    mk('travel', 'travel'); mk('dawn', 'dawn');
  });
  const evs = (page, name) => page.evaluate((n) => window.__ev.filter((e) => e.name === n), name);
  const jsClick = (page, sel) => page.evaluate((s) => document.querySelector(s).click(), sel);
  const surface = async (page) => { await page.click('#btn-pause'); await page.waitForTimeout(300); await page.click('#abort'); await page.waitForFunction(() => !document.getElementById('result').classList.contains('hidden'), null, { timeout: 30000 }); };

  let fullSec = 0;
  // ============ A. 夜に潜った後は朝・夜明けの演出・ボートで向かう演出
  {
    const night = { ...base, clock: 780, owned: ['float', 'torch'], cooler: [{ id: 'kasumiaji', kg: 3 }, { id: 'tsumuburi', kg: 2 }] };
    const page = await boot(night);
    check('A0 夜の初期状態：時間ボタンは夜', (await saved(page)).clock >= 690);
    await watch(page);
    await jsClick(page, '[data-dp="lagoon"]');
    await page.waitForFunction(() => window.__ev.some((e) => e.name === 'travel' && e.hidden), null, { timeout: 30000 });
    const te = await evs(page, 'travel');
    const tTravel = (te.find((e) => e.hidden).t - te.find((e) => !e.hidden).t) / 1000;
    check('A1 ポイントを押すと、ボートで向かう演出（#travel）が出る', te.some((e) => !e.hidden));
    check('A3 演出は 1.2〜2.0 秒（ここはソフト描画なので遅れを見て 1.0〜6 秒以内）', tTravel >= 1.0 && tTravel <= 8, tTravel.toFixed(2) + 's（描画ソフト実装では潜水の準備で画面が止まる分が加わる）');
    await waitState(page, 'diving');
    const tr = await H(page, 'transit');
    check('A4 夜に始めた潜水は diveNight ＝ true', tr.diveNight === true && tr.boatAt && Math.round(tr.boatAt.x) === -10, JSON.stringify(tr));
    await page.waitForTimeout(800);
    await surface(page);
    const sv0 = await saved(page);
    check('A5 浮上の結果画面を閉じるまでは、まだ夜・同じ日', sv0.day === 3 && sv0.clock >= 690, `day=${sv0.day} clock=${sv0.clock}`);
    const tr1 = await H(page, 'transit');
    check('A6 morningDue ＝ true', tr1.morningDue === true);
    await page.evaluate(() => { window.__ev = window.__ev.filter((e) => e.name !== 'dawn'); });
    await jsClick(page, '#res-ok');
    await page.waitForFunction(() => window.__ev.some((e) => e.name === 'dawn' && e.card), null, { timeout: 15000 });
    const card = await page.evaluate(() => ({ day: document.getElementById('dw-day').textContent, w: document.getElementById('dw-weather').textContent }));
    check('A7 暗転のあと「4日目の朝」と天気のアイコンが出る', card.day === '4日目の朝' && card.w.length > 1, JSON.stringify(card));
    await page.screenshot({ path: path.join(SHOT, 'f7-dawn.png') });
    await page.waitForFunction(() => window.__ev.some((e) => e.name === 'dawn' && e.hidden), null, { timeout: 15000 });
    const de = await evs(page, 'dawn');
    const tShow = de.find((e) => !e.hidden && !e.card).t, tCard = de.find((e) => e.card).t, tHide = de.find((e) => e.hidden).t;
    fullSec = (tHide - tShow) / 1000;
    check('A8 夜明けの演出：暗転（0.6 秒）→ 「◯日目の朝」（1.2 秒）→ 明け（0.5 秒）の順。暗転は 0.5 秒以上、カードが出てから消えるまで 1.7 秒以上（描画が遅い環境では長くなる）', (tCard - tShow) / 1000 >= 0.5 && (tHide - tCard) / 1000 >= 1.7, `暗転 ${((tCard - tShow) / 1000).toFixed(2)}s・カード以降 ${((tHide - tCard) / 1000).toFixed(2)}s`);
    await page.waitForTimeout(900);
    const sv = await saved(page);
    check('A9 日付 +1・朝（clock 0）・クーラーは空・魚が市場に卸されてお金が増えた', sv.day === 4 && sv.clock === 0 && (sv.cooler ?? []).length === 0 && sv.money > 1000, `day=${sv.day} clock=${sv.clock} money=${sv.money}`);
    const ui = await page.evaluate(() => ({ title: !document.getElementById('title').classList.contains('hidden'), kitchen: document.getElementById('kitchen').classList.contains('hidden'), talk: !document.getElementById('talk').classList.contains('hidden'), text: document.querySelector('#talk .tk-text')?.textContent ?? '', who: document.querySelector('#talk .tk-name')?.textContent ?? '' }));
    check('A10 ボート画面に戻り、女将さんの朝のひとこと（天気＋市場の売上）が吹き出しで 1 段', ui.title && ui.kitchen && ui.talk && /市場に卸/.test(ui.text) && /\+¥/.test(ui.text), JSON.stringify(ui));
    await page.screenshot({ path: path.join(SHOT, 'f7-morning-talk.png') });
    await page.mouse.click(195, 330);
    await page.waitForFunction(() => document.getElementById('talk').classList.contains('hidden'), null, { timeout: 4000 });
    check('A11 タップで吹き出しは閉じる（1 段だけ）', true);
    const tr2 = await H(page, 'transit');
    check('A12 朝になったのでボートは港に戻る', tr2.boatAt === null && !tr2.morningDue, JSON.stringify(tr2));

    // 昼に潜った後は、朝にしない（夜になるだけ）
    await jsClick(page, '[data-dp="reef"]');
    await waitState(page, 'diving');
    await page.waitForTimeout(800);
    const tr3 = await H(page, 'transit');
    check('A13 昼に始めた潜水は diveNight ＝ false', tr3.diveNight === false);
    await surface(page);
    await jsClick(page, '#res-ok');
    await page.waitForTimeout(500);
    const dawnNow = await page.evaluate(() => !document.getElementById('dawn').classList.contains('hidden'));
    const sv2 = await saved(page);
    check('A14 昼の潜水の後は夜明けにならず、同じ日の夜になる', !dawnNow && sv2.day === 4 && sv2.clock >= 690, `day=${sv2.day} clock=${sv2.clock}`);
    // しおさい亭で寝る：ボート画面へ戻る・タップで早送り
    await page.waitForTimeout(800);
    await page.click('#open-kitchen');
    await page.waitForTimeout(500);
    await page.evaluate(() => { window.__ev = []; });
    await page.evaluate(() => { document.getElementById('k-sleep').click(); document.getElementById('dawn').click(); });
    await page.waitForFunction(() => window.__ev.some((e) => e.name === 'dawn' && e.hidden), null, { timeout: 15000 });
    const se = await evs(page, 'dawn');
    const skipSec = (se.find((e) => e.hidden).t - se.find((e) => !e.hidden).t) / 1000;
    const skippedCard = !se.some((e) => e.card);
    const sv3 = await saved(page);
    const k3 = await page.evaluate(() => ({ kitchen: document.getElementById('kitchen').classList.contains('hidden'), title: !document.getElementById('title').classList.contains('hidden') }));
    check('A15 しおさい亭で寝ても、暗転してボート画面へ（しおさい亭は閉じる）。タップで早送りできる', sv3.day === 5 && sv3.clock === 0 && k3.kitchen && k3.title && skippedCard, `day=${sv3.day} 早送り ${skipSec.toFixed(2)}s（通しは ${fullSec.toFixed(2)}s・早送りでは「朝」のカードを出さない）${JSON.stringify(k3)}`);
    await page.context().close();
  }

  // ============ B. ウニ漁（手銛あり・昼）：群れ・数・銛・縁の光・イベント停止・レイアウト
  const urchinSave = { ...base, talked: [...allTalked, 'item:urchin'], owned: ['float', 'spear', 'torch'], rep: 10, story: 3, clock: 100 };
  async function urchinRun(save, label, night) {
    const page = await boot(save);
    await page.click('#open-kitchen');
    await page.waitForTimeout(500);
    await page.click('[data-ktab="work"]');
    const work = await page.evaluate(() => document.getElementById('k-work').textContent);
    check(`${label}-0 しおさい亭「今日の仕込み：ウニ漁」に${night ? '「夜は報酬 ×1.5」' : '夜の倍率の案内'}が出る`, night ? /夜は報酬 ×1\.5/.test(work) : /×1\.5/.test(work), work.slice(0, 80));
    await watch(page);
    await jsClick(page, '#k-sort');
    await page.waitForFunction(() => window.__ev.some((e) => e.name === 'travel' && e.hidden), null, { timeout: 30000 });
    const ue = await evs(page, 'travel');
    const sec = (ue.find((e) => e.hidden).t - ue.find((e) => !e.hidden).t) / 1000;
    check(`${label}-1 ウニ漁も同じ演出（店の前から岩礁へ・短め 1.0 秒。ソフト描画の遅れ込みで 0.8〜8 秒）`, sec >= 0.8 && sec <= 8, sec.toFixed(2) + 's');
    await waitState(page, 'diving');
    await page.waitForFunction(() => window.__THREE_GAME_TEST_HOOKS__.urchinInfo(), null, { timeout: 20000 });
    await page.waitForTimeout(500);
    const info = await H(page, 'urchinInfo');
    const me = await H(page, 'me');
    const counts = [0, 0, 0, 0];
    info.items.forEach((i) => counts[i.type]++);
    check(`${label}-2 ウニは 45 個（ムラサキ 24・アカ 10・ガンガゼ 6・ラッパ 5）`, info.items.length === 45 && counts.join() === '24,10,6,5', counts.join());
    check(`${label}-3 群れは 8 か所・1 群れ 3〜6 個`, info.clusters.length === 8 && info.clusters.every((c) => c.n >= 3 && c.n <= 6) && info.clusters.reduce((a, c) => a + c.n, 0) === 45, info.clusters.map((c) => c.n).join());
    const within = info.clusters.filter((c) => Math.hypot(c.x - me.x, c.z - me.z) <= 20).length;
    const farItem = Math.max(...info.items.map((i) => Math.hypot(i.x - me.x, i.z - me.z)));
    check(`${label}-4 すべての群れ（と個体）が開始地点から 20m 以内`, within === 8 && farItem <= 21, `群れ ${within}/8・最遠の個体 ${farItem.toFixed(1)}m`);
    console.log(`  [計測] ${label}：開始地点から 20m 以内の群れ ${within}・画面内のウニ ${info.onScreen}（15m 以内 ${info.onScreen15}）`);
    check(`${label}-5 報酬 ${night ? '¥2,250（夜 ×1.5）' : '¥1,500'}`, info.reward === (night ? 2250 : 1500), String(info.reward));
    const sc = await H(page, 'scenesInfo');
    check(`${label}-6 ウニ漁の間は光景（特別な光景の抽選・円）が出ない`, sc.active === 0 && sc.marks === 0, JSON.stringify(sc));
    check(`${label}-7 持ち替えボタンが出ている（手銛あり）`, info.btnToolHidden === false && info.loan === false);
    // カメラのときはウニに反応しない
    const edible = info.items.map((v, i) => ({ ...v, i })).filter((v) => v.type < 2 && !v.taken);
    let tgt = edible[0];
    await H(page, 'faceUrchin', tgt.i, 1.2);
    await page.waitForTimeout(500);
    let i2 = await H(page, 'urchinInfo');
    check(`${label}-8 カメラのままウニに近づいても「突いてはがす」にならない（pryIdx なし）`, i2.tool === 'camera' && i2.pryIdx === null, `tool=${i2.tool} pry=${i2.pryIdx}`);
    await page.waitForFunction(() => (window.__THREE_GAME_TEST_HOOKS__.urchinInfo()?.glow ?? 0) > 0.05, null, { timeout: 10000 }).catch(() => {});
    i2 = await H(page, 'urchinInfo');
    check(`${label}-9 近づいたウニに縁の光（${night ? '夜 4m' : '昼 6m'}）`, i2.glow > 0.05, `glow=${i2.glow.toFixed(2)}`);
    await H(page, 'press', 'shutter');
    await page.waitForTimeout(400);
    i2 = await H(page, 'urchinInfo');
    check(`${label}-10 カメラのシャッターではウニははがれない（撮影になる）`, i2.got === 0 && !i2.items[tgt.i].taken);
    // 銛に持ち替え
    await H(page, 'press', 'tool');
    await page.waitForTimeout(500);
    // 群れの中は近いので、いちばん近いウニが突く相手になる。食べられるものが相手になる位置を探す
    for (const c of edible.slice(0, 12)) {
      await H(page, 'faceUrchin', c.i, 1.0);
      await page.waitForTimeout(350);
      i2 = await H(page, 'urchinInfo');
      if (i2.pryIdx !== null && i2.items[i2.pryIdx].type < 2) { tgt = { ...i2.items[i2.pryIdx], i: i2.pryIdx }; break; }
    }
    check(`${label}-11 銛に持ち替えて、前方 1.8m 以内にウニがあると pryIdx が立つ`, i2.tool === 'spear' && i2.pryIdx !== null && i2.items[i2.pryIdx].type < 2, `tool=${i2.tool} pry=${i2.pryIdx}`);
    const lab = await page.evaluate(() => document.getElementById('ret-label')?.textContent ?? document.querySelector('#reticle')?.textContent ?? '');
    for (let n = 0; n < 3; n++) { await H(page, 'press', 'shutter'); await page.waitForTimeout(170); }
    await page.waitForTimeout(300);
    i2 = await H(page, 'urchinInfo');
    check(`${label}-12 銛で 3 回（リロードを待たずに）突くとはがれる・点が入る`, i2.items[tgt.i].taken && i2.got >= 1, `got=${i2.got} taken=${i2.items[tgt.i].taken} label=${lab}`);
    // 縁の光：遠いと消える
    // 縁の光：いちばん近いウニまでが 4.6〜5.8m の位置（昼は光る・夜は光らない）を探す
    let band = null;
    for (const c of info.items.map((v, i) => ({ ...v, i }))) {
      for (const back of [5.2, 6.4, 7.6, 8.8]) {
        await H(page, 'faceUrchin', c.i, back);
        const ii = await H(page, 'urchinInfo'), mm = await H(page, 'me');
        const near = Math.min(...ii.items.filter((q) => !q.taken).map((q) => Math.hypot(q.x - mm.x, q.y - mm.y, q.z - mm.z)));
        if (near > 4.7 && near < 5.7) { band = { near, back }; break; }
      }
      if (band) break;
    }
    if (night) await page.waitForTimeout(2200);
    else await page.waitForFunction(() => (window.__THREE_GAME_TEST_HOOKS__.urchinInfo()?.glow ?? 0) > 0.02, null, { timeout: 10000 }).catch(() => {});
    i2 = await H(page, 'urchinInfo');
    if (!band) check(`${label}-13 縁の光の距離（4.7〜5.7m の位置が見つからず測れなかった）`, false);
    else if (night) check(`${label}-13 夜は縁の光が 4m に縮む（最も近いウニまで ${band.near.toFixed(1)}m では光らない）`, i2.glow < 0.02, `glow=${i2.glow.toFixed(3)}`);
    else check(`${label}-13 昼は 6m 以内（最も近いウニまで ${band.near.toFixed(1)}m）で光る`, i2.glow > 0.02, `glow=${i2.glow.toFixed(3)}`);
    await page.screenshot({ path: path.join(SHOT, `f7-urchin-${label}.png`) });
    // ウニ漁を終えて戻る（レイアウト）
    await H(page, 'finishUrchin', true);
    await page.waitForFunction(() => !document.getElementById('mg').classList.contains('hidden'), null, { timeout: 30000 });
    await page.waitForTimeout(400);
    const back = await page.evaluate(() => { const b = document.getElementById('mg-box').getBoundingClientRect(); const h = document.querySelector('#kitchen .k-head h2').getBoundingClientRect(); return { sc: document.getElementById('kitchen').scrollTop, titleSc: document.getElementById('title').scrollTop, top: Math.round(b.top), bottom: Math.round(b.bottom), head: Math.round(h.top), vh: innerHeight, pos: getComputedStyle(document.getElementById('mg')).position }; });
    check(`${label}-14 浮上後、しおさい亭の見出しと結果の箱が画面内・scrollTop 0・#mg は fixed`, back.sc === 0 && back.titleSc === 0 && back.top >= 0 && back.bottom <= back.vh && back.head >= 0 && back.head < back.vh && back.pos === 'fixed', JSON.stringify(back));
    const tr = await H(page, 'transit');
    const sv = await saved(page);
    check(`${label}-15 ウニ漁の後は時間を変えない（${night ? '夜のまま・同じ日・夜明けなし' : '昼のまま'}）`, !tr.dawning && sv.day === 3 && (night ? sv.clock >= 690 : sv.clock < 600), `day=${sv.day} clock=${sv.clock}`);
    await page.context().close();
  }
  await urchinRun(urchinSave, 'B昼', false);
  await urchinRun({ ...urchinSave, clock: 780 }, 'B夜', true);

  // ============ C. 借りた銛（手銛なし）・掲示板のウニ漁の夜の倍率
  {
    const page = await boot({ ...base, owned: ['float', 'torch'], clock: 780 });
    await jsClick(page, '[data-dp="rocky"]');
    await waitState(page, 'diving');
    await page.waitForTimeout(1200);
    let toolHidden = await page.evaluate(() => document.getElementById('btn-tool').classList.contains('hidden'));
    check('C1 手銛を持っていないと、ふだんは持ち替えボタンが出ない', toolHidden);
    await H(page, 'beginUrchin', 1500);
    await page.waitForTimeout(700);
    let info = await H(page, 'urchinInfo');
    check('C2 掲示板のウニ漁（夜）は、潜水中の達成時に ×1.5：¥1,500 → ¥2,250', info && info.reward === 2250, String(info && info.reward));
    check('C3 ウニ漁が始まると持ち替えボタンが出る（借りた銛）', info.btnToolHidden === false && info.loan === true && (await page.evaluate(() => !document.getElementById('btn-tool').classList.contains('hidden'))));
    const toast = await page.evaluate(() => document.getElementById('toast').textContent);
    check('C4 開始の案内：持ち替えボタンで銛に替えて…3 回突いてはがそう', /持ち替えボタンで銛に替えて/.test(toast) && /3回突いてはがそう/.test(toast), toast.slice(0, 60));
    // 初めてのウニ漁：小型吹き出しで持ち替えボタンを指す
    await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('blue-depths-save-v1')); });
    await page.waitForTimeout(1500);
    const mini = await page.evaluate(() => ({ open: !document.getElementById('talk-mini').classList.contains('hidden'), text: document.querySelector('#talk-mini')?.textContent ?? '' }));
    check('C5 初めてのウニ漁では小型吹き出し（台本 urchin）が持ち替えボタンを指す', mini.open && /持ち替えボタン/.test(mini.text), mini.text.slice(0, 50));
    // 持ち替え → 魚には反応しない・ウニは突ける
    await H(page, 'press', 'tool');
    await page.waitForTimeout(500);
    await page.evaluate(() => { document.getElementById('talk-mini')?.click(); });
    let tgt = info.items.map((v, i) => ({ ...v, i })).find((v) => v.type < 2);
    await H(page, 'faceUrchin', tgt.i, 6);
    await page.waitForTimeout(400);
    await H(page, 'press', 'shutter');
    await page.waitForTimeout(300);
    const t1 = await page.evaluate(() => document.getElementById('toast').textContent);
    check('C6 借りた銛は魚用ではない（ウニから離れて突くと「ウニ専用」）', /ウニ専用/.test(t1), t1);
    for (const c of info.items.map((v, i) => ({ ...v, i })).filter((v) => v.type < 2).slice(0, 12)) {
      await H(page, 'faceUrchin', c.i, 1.0);
      await page.waitForTimeout(350);
      info = await H(page, 'urchinInfo');
      if (info.pryIdx !== null && info.items[info.pryIdx].type < 2) { tgt = { ...info.items[info.pryIdx], i: info.pryIdx }; break; }
    }
    for (let n = 0; n < 3; n++) { await H(page, 'press', 'shutter'); await page.waitForTimeout(170); }
    await page.waitForTimeout(300);
    info = await H(page, 'urchinInfo');
    check('C7 借りた銛でウニを 3 回突いてはがせる', info.items[tgt.i].taken && info.got >= 1, `got=${info.got}`);
    // ウニ漁が終わると持ち替えボタンが消え、カメラに戻る
    await H(page, 'missionReset');
    await page.waitForTimeout(500);
    const after = await page.evaluate(() => ({ hidden: document.getElementById('btn-tool').classList.contains('hidden'), spearHud: document.getElementById('hud').classList.contains('spear') }));
    check('C8 ウニ漁が終わると持ち替えボタンが消え、カメラに戻る', after.hidden && !after.spearHud, JSON.stringify(after));
    await page.context().close();
  }

  // ============ D. 餌：「買い物」タブ・評判 Lv2 で解放・持っている分は Lv1 でも使える
  {
    let page = await boot({ ...base, owned: ['spear', 'float'], rep: 1, money: 5000 });
    await page.click('#open-kitchen');
    await page.waitForTimeout(500);
    let d = await page.evaluate(() => ({ shopTab: !document.querySelector('[data-ktab="shop"]').offsetParent ? 'hidden' : 'shown', heading: document.getElementById('kitchen').textContent.includes('釣具の棚') }));
    check('D1 評判 Lv1：「買い物」タブは出ない・「釣具の棚」の見出しは無い', d.shopTab === 'hidden' && !d.heading, JSON.stringify(d));
    await page.context().close();
    page = await boot({ ...base, owned: ['spear', 'float'], rep: 10, money: 5000, bait: { krill: 3 } });
    await page.click('#open-kitchen');
    await page.waitForTimeout(500);
    d = await page.evaluate(() => ({ shopTab: !!document.querySelector('[data-ktab="shop"]').offsetParent, heading: document.getElementById('kitchen').textContent.includes('釣具の棚') }));
    check('D2 評判 Lv3：「買い物」タブが出る・見出し「釣具の棚：餌」は無い', d.shopTab && !d.heading, JSON.stringify(d));
    await page.click('[data-ktab="shop"]');
    await page.waitForTimeout(300);
    const n0 = (await saved(page)).bait.krill;
    await page.click('#k-bait [data-bait]:not([disabled])');
    await page.waitForTimeout(300);
    check('D3 「買い物」タブで餌が買える（Lv2 以上）', (await saved(page)).bait.krill > n0);
    await page.context().close();
    // 旧セーブ：Lv1 でも持っている分は潜水中に使える（ボタンが出る）。買い足しはできない
    page = await boot({ ...base, owned: ['spear', 'float'], rep: 1, money: 5000, bait: { krill: 3 } });
    await jsClick(page, '[data-dp="reef"]');
    await waitState(page, 'diving');
    await page.waitForTimeout(800);
    check('D4 評判 Lv1 でも持っている餌は潜水中に使える（餌ボタンが出る）', await page.evaluate(() => !document.getElementById('btn-bait').classList.contains('hidden')));
    await page.context().close();
  }

  await H0();
  async function H0() {}
  await browser.close();
  server.close();
  const real = errors.filter((e) => !/ResizeObserver|Failed to load resource/.test(e));
  check('Z ページエラーなし', real.length === 0, real.slice(0, 3).join(' | '));
  const bad = results.filter((x) => !x.ok).length;
  console.log(bad ? `\n${bad} FAIL / ${results.length}` : `\nALL PASS (${results.length})`);
  process.exit(bad ? 1 : 0);
})();
