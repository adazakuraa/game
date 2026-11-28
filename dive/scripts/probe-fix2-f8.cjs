/**
 * 修正バッチ2 F8 probe：潜水中のイベントの見せ方
 *  (4) 光景の円と確率（写真スポットの円はヒント後・章の光景も気配後・時間帯と天気の条件・「出会えるかは運しだい」）
 *  (20) 光景に出会えたときの帯＋小型吹き出し
 *  (22) ウミガメの［助ける］［今はやめる］・初回の操作チュートリアル・専用の表示
 *  (3) 手記（拾う → 浮上後に読む → 実績画面のタブ・セーブ journals の移行）
 * Usage: node scripts/probe-fix2-f8.cjs [dist/artifact.html]   (PROBE_CHROME=<chromium binary>)
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
const ONLY = process.env.ONLY;
const on = (k) => !ONLY || ONLY.includes(k);
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
  const base = { found, dives: 4, maxDepth: 5, money: 1000, owned: ['float'], earned: 0, discovered: ['lagoon', 'reef', 'rocky', 'dropoff', 'kelp', 'river'], visited: ['lagoon'], storyMain: 1, storyRead: 1, storyClaim: [], day: 3, clock: 100, tutorial: true, talked: allTalked, p1: 1, p2: 1, talkMig: 1, airLv: 0, boardOn: true, boardIntro: true, rep: 10, story: 3 };
  const H = (page, fn, ...a) => page.evaluate(([f, args]) => window.__THREE_GAME_TEST_HOOKS__[f](...args), [fn, a]);
  const G = (page, fn, ...a) => page.evaluate(([f, args]) => { const g = window.__THREE_GAME_TEST_HOOKS__.game; const v = g[f]; return typeof v === 'function' ? v.apply(g, args) : v; }, [fn, a]);
  const ev = (page, code) => page.evaluate(`(() => { const g = window.__THREE_GAME_TEST_HOOKS__.game; ${code} })()`);
  const st = (page) => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__ && window.__THREE_GAME_DIAGNOSTICS__.state);
  const waitState = (page, s, t = 90000) => page.waitForFunction((x) => window.__THREE_GAME_DIAGNOSTICS__ && window.__THREE_GAME_DIAGNOSTICS__.state === x, s, { timeout: t });
  const saved = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('blue-depths-save-v1')));
  const jsClick = (page, sel) => page.evaluate((s) => document.querySelector(s).click(), sel);
  const hidden = (page, sel) => page.evaluate((s) => document.querySelector(s).classList.contains('hidden'), sel);
  const text = (page, sel) => page.evaluate((s) => document.querySelector(s)?.textContent ?? '', sel);
  const mini = (page) => page.evaluate(() => { const m = document.getElementById('talk-mini'); return m.classList.contains('hidden') ? '' : m.textContent; });
  const dive = async (page, dp) => { await jsClick(page, `[data-dp="${dp}"]`); await waitState(page, 'diving'); await page.waitForTimeout(600); };
  const surface = async (page) => { await page.click('#btn-pause'); await page.waitForTimeout(300); await page.click('#abort'); await page.waitForFunction(() => !document.getElementById('result').classList.contains('hidden'), null, { timeout: 30000 }); };
  const settle = (page, ms = 500) => page.waitForTimeout(ms);

  // ============ A. 写真スポット：条件・ヒントと円
  {
    const page = await boot(base);
    const sp = await H(page, 'spots');
    const withWhen = sp.filter((s) => s.when);
    check('A1 撮れる条件の付いたスポットは 4 か所（ラグーン・ケルプ・セノーテ・滝つぼ）', withWhen.length === 4 && ['lagoon', 'kelp', 'cenote', 'waterfall'].every((id) => withWhen.some((s) => s.id === id)), withWhen.map((s) => s.id).join(','));
    const open = async (w, night) => page.evaluate(([w, n]) => { const h = window.__THREE_GAME_TEST_HOOKS__; h.setWeather(w); h.game.env.night = n; return Object.fromEntries(h.spots().map((s) => [s.id, s.open])); }, [w, night]);
    let o = await open('sunny', 0);
    check('A2 晴れの昼：条件つき 4 か所とも撮れる', o.lagoon && o.kelp && o.cenote && o.waterfall);
    o = await open('cloudy', 0);
    check('A3 曇りの昼：ラグーン・セノーテ（晴れだけ）は閉じ、ケルプ・滝つぼは開く', !o.lagoon && !o.cenote && o.kelp && o.waterfall);
    o = await open('rain', 0);
    check('A4 雨：4 か所とも閉じる。条件のない 8 か所は開いたまま', !o.lagoon && !o.kelp && !o.cenote && !o.waterfall && o.reef && o.arch && o.wreck && o.ruins && o.cold && o.bluehole && o.mangrove && o.vent);
    o = await open('sunny', 1);
    check('A5 晴れの夜：昼だけの 3 か所（ラグーン・ケルプ・セノーテ）は閉じ、滝つぼ（時間帯なし）は開く', !o.lagoon && !o.kelp && !o.cenote && o.waterfall);
    await page.context().close();
  }
  {
    const page = await boot(base);
    await dive(page, 'lagoon');
    await H(page, 'setWeather', 'sunny');
    await ev(page, 'g.env.night = 0; return 1;');
    // 入り口の近く（ラグーンの砂紋は入り口から 45m 以内）のヒントだけ。遠い所の円は出ていない
    const mk0 = await ev(page, 'return { marks: g.spotMarks().length, hinted: g.spotHinted.size, all: g.discovered.size };');
    check('A6 潜り始めの円は、近くでヒントが出たスポットだけ（発見済みの全部の円は出ない）', mk0.marks === mk0.hinted && mk0.marks <= 1, JSON.stringify(mk0));
    await ev(page, 'g.spotHinted.clear(); return 1;');
    // ラグーンの白い砂紋（-14,52）から 45m 以内へ
    await H(page, 'teleport', 20, -3, 52);
    await page.waitForFunction(() => window.__THREE_GAME_TEST_HOOKS__.game.spotHinted.size > 0, null, { timeout: 20000 });
    let info = await ev(page, 'return { hinted: [...g.spotHinted], marks: g.spotMarks().map((m) => m.spot) };');
    check('A7 45m 以内に入るとヒントが出て、その円だけが出る', info.hinted.join() === 'lagoon' && info.marks.length === 1 && info.marks[0] === true, JSON.stringify(info));
    const m1 = await mini(page);
    check('A8 小型吹き出し「ラグーンの白い砂紋の見どころが近い…」', m1.includes('ラグーンの白い砂紋の見どころが近い'), m1);
    // 雨の日は、近づいても気配も円も出ない
    await ev(page, 'g.spotHinted.clear(); return 1;');
    await H(page, 'setWeather', 'rain');
    await H(page, 'teleport', 10, -3, 45);
    await settle(page, 1800);
    info = await ev(page, 'return { hinted: [...g.spotHinted], marks: g.spotMarks().length };');
    check('A9 雨の日：ラグーンの砂紋は近づいても気配も円も出ない', info.hinted.length === 0 && info.marks === 0, JSON.stringify(info));
    // 撮った所は出ない
    await H(page, 'setWeather', 'sunny');
    await ev(page, 'g.save.spots = ["lagoon"]; g.spotHinted.clear(); return 1;');
    await H(page, 'teleport', 12, -3, 47);
    await settle(page, 1800);
    info = await ev(page, 'return { hinted: [...g.spotHinted], marks: g.spotMarks().length };');
    check('A10 一度撮ったスポットは近づいても気配も円も出ない', info.hinted.length === 0 && info.marks === 0, JSON.stringify(info));
    // 雨の日は撮れない（フレームに収めても写らない）
    await ev(page, 'g.save.spots = []; return 1;');
    const view = await page.evaluate(() => { const h = window.__THREE_GAME_TEST_HOOKS__; const sp = h.spots().find((s) => s.id === 'lagoon'); return sp; });
    await H(page, 'teleport', view.x + 8, view.y + 1.5, view.z + 8);
    await H(page, 'look', Math.atan2(-(view.x - (view.x + 8)), -(view.z - (view.z + 8))), -0.1);
    await settle(page, 400);
    const shoot = async (w) => { await H(page, 'setWeather', w); await ev(page, 'g.env.night = 0; g.pendingSpots.clear(); g.bonuses.length = 0; g.save.spots = []; g.spotShot("", false); return 1;'); return ev(page, 'return g.pendingSpots.has("lagoon");'); };
    check('A11 晴れなら撮れて、雨なら同じ構図でも撮れない', (await shoot('sunny')) === true && (await shoot('rain')) === false);
    await page.context().close();
  }

  // ============ B. 章の光景：円は気配の後・場所の手がかり／C. 光景に出会えた帯
  {
    const page = await boot({ ...base, storyMain: 4, storyRead: 4, talked: [...allTalked, 'intro:4'] });
    await dive(page, 'dropoff');
    const wm = () => ev(page, 'return g.sceneMarks().filter((m) => Math.hypot(m.x - 14, m.z - 590) < 5).length;');
    let info = await ev(page, 'return { staged: g.stagedScene, active: [...g.scenes.active] };');
    check('B1 章の光景（眠るマッコウクジラ）は最初の 1 回は必ず出る決まりのまま', info.staged === 'whalesleep' && info.active.includes('whalesleep'), JSON.stringify(info));
    check('B2 章の光景も、最初から円は出ない', (await wm()) === 0);
    await ev(page, 'g.diveTime = 10; return 1;');
    await page.waitForFunction(() => document.getElementById('talk-mini') && !document.getElementById('talk-mini').classList.contains('hidden') && document.getElementById('talk-mini').textContent.includes('マッコウクジラ'), null, { timeout: 20000 }).catch(() => {});
    const m = await mini(page);
    check('B3 編集長の小型吹き出しで場所の手がかり（沖・水深15m・ドロップオフの先）', m.includes('マッコウクジラ') && m.includes('沖'), m);
    // 気配が出てから円を出す
    await H(page, 'teleport', 14, -10, 520);
    await settle(page, 600);
    info = await ev(page, 'return { sensed: g.scenes.sensed.has("whalesleep") };');
    check('B4 遠い間は（章の光景の）円も気配もない', (await wm()) === 0 && info.sensed === false, JSON.stringify(info));
    await H(page, 'teleport', 14, -10, 560);
    await page.waitForFunction(() => window.__THREE_GAME_TEST_HOOKS__.game.scenes.sensed.has('whalesleep'), null, { timeout: 20000 });
    check('B5 近づいて気配が出てから、円が出る', (await wm()) === 1);
    // C. 光景に出会えた帯：主役が画面内・25m 以内
    await ev(page, 'g.toastTimer = 0; return 1;');
    await H(page, 'teleport', 14, -12, 572);
    await H(page, 'look', Math.PI, 0);
    await page.waitForFunction(() => window.__THREE_GAME_TEST_HOOKS__.game.sceneAnnounced.has('whalesleep'), null, { timeout: 20000 }).catch(() => {});
    const ban = await page.evaluate(() => { const b = document.getElementById('scene-banner'); const cs = getComputedStyle(b); return { show: b.classList.contains('show'), text: b.textContent, border: cs.borderTopColor, top: b.getBoundingClientRect().top }; });
    check('C1 主役が視界に入った瞬間に帯が出る（「特別な光景」＋光景の名前、金色の縁）', ban.show && ban.text.includes('特別な光景') && ban.text.includes('縦になって眠るマッコウクジラ') && /240|192|64/.test(ban.border), JSON.stringify(ban));
    const m2 = await mini(page);
    check('C2 初回の光景だけ「これはすごい…！ 撮影しよう」', m2.includes('これはすごい…！ 撮影しよう'), m2);
    check('C3 操作は止めない（一時停止にならない）', (await st(page)) === 'diving' && !(await G(page, 'paused')));
    await page.screenshot({ path: path.join(SHOT, 'f8-banner-portrait.png') });
    await page.waitForFunction(() => !document.getElementById('scene-banner').classList.contains('show'), null, { timeout: 12000 });
    check('C4 帯は約 3 秒で消える', true);
    // 2 回目は出ない（1 ダイブ 1 回）
    await H(page, 'teleport', 14, -12, 640); await settle(page, 300); await H(page, 'teleport', 14, -12, 572); await settle(page, 1500);
    check('C5 同じ光景では 1 ダイブに帯は 1 回だけ', !(await page.evaluate(() => document.getElementById('scene-banner').classList.contains('show'))));
    await page.context().close();
  }
  {
    // 遠い（25m より先）と出ない・初回以外はふつうのひとこと
    const page = await boot({ ...base, storyMain: 4, storyRead: 4, scenes: { dolphins: { photo: '', t: 1 } }, talked: [...allTalked, 'intro:4', 'sceneFirst'] });
    await dive(page, 'dropoff');
    await H(page, 'teleport', 14, -12, 470);
    await H(page, 'look', Math.PI, 0);
    await settle(page, 1500);
    check('C6 25m より遠いときは帯が出ない', !(await page.evaluate(() => document.getElementById('scene-banner').classList.contains('show'))));
    await H(page, 'teleport', 14, -12, 572);
    await H(page, 'look', Math.PI, 0);
    await page.waitForFunction(() => window.__THREE_GAME_TEST_HOOKS__.game.sceneAnnounced.has('whalesleep'), null, { timeout: 20000 }).catch(() => {});
    const m3 = await mini(page);
    check('C7 2 回目以降の光景は「これはすごい…」ではないひとこと', m3.length > 0 && !m3.includes('これはすごい'), m3);
    await page.context().close();
  }

  // ============ D. ウミガメ
  if (on('D')) {
    const page = await boot(base);
    await dive(page, 'lagoon');
    await page.evaluate(() => { window.__minilog = []; const m = document.getElementById('talk-mini'); const f = () => { if (!m.classList.contains('hidden')) { const t = m.textContent; if (window.__minilog[window.__minilog.length - 1] !== t) window.__minilog.push(t); } }; new MutationObserver(f).observe(m, { childList: true, subtree: true, characterData: true, attributes: true }); });
    await ev(page, 'g.diveTime = 100; return 1;');
    // D1 発生 → 一時停止して吹き出し（選ぶ段）
    await ev(page, 'g.missions.forceRescueAsk = true; return 1;');
    await page.waitForFunction(() => !document.getElementById('talk').classList.contains('hidden'), null, { timeout: 20000 });
    const tk = await page.evaluate(() => ({ text: document.querySelector('#talk .tk-text').textContent, name: document.querySelector('#talk .tk-name').textContent, btns: [...document.querySelectorAll('#talk .tk-choices button')].map((b) => b.textContent), paused: window.__THREE_GAME_TEST_HOOKS__.game.paused }));
    check('D1 ウミガメ発生：潜水が止まり、漁師の吹き出し（［助ける］［今はやめる］）', tk.paused && tk.name.includes('ゲン') && tk.text.includes('網に絡まったウミガメがいる！ 助けてくれないか？') && tk.btns.join() === '助ける,今はやめる', JSON.stringify(tk));
    await page.screenshot({ path: path.join(SHOT, 'f8-turtle-ask.png') });
    // D2 今はやめる → 再開・始まらない・そのダイブでは再び出ない
    await page.evaluate(() => [...document.querySelectorAll('#talk .tk-choices button')].find((b) => b.textContent === '今はやめる').click());
    await page.waitForFunction(() => !window.__THREE_GAME_TEST_HOOKS__.game.paused, null, { timeout: 10000 });
    await settle(page, 800);
    let info = await ev(page, 'return { active: g.missions.active?.kind ?? null, declined: g.missions.rescueDeclined, tut: g.save.talked.includes("turtleHow") };');
    check('D2 ［今はやめる］：潜水が再開し、ウミガメの依頼は始まらない', info.active === null && info.declined === true && !info.tut, JSON.stringify(info));
    await page.evaluate(() => { window.__rand = Math.random; Math.random = () => 0; });
    await ev(page, 'g.missions.restDives = 99; g.missions.nextCheck = 0; g.missions.lastEnd = -1e9; g.diveTime = 200; return 1;');
    await settle(page, 2500);
    check('D3 そのダイブでは再び出ない（発生の抽選が当たっても吹き出しは出ない）', await hidden(page, '#talk'));
    // D4 次のダイブでは出る（抽選が当たれば）
    await ev(page, 'g.missions.newDive(); return 1;');
    info = await ev(page, 'return g.missions.rescueDeclined;');
    check('D4 次のダイブ（newDive）では断った記録が戻る', info === false);
    await page.evaluate(() => { Math.random = window.__rand; });
    // D5 助ける → 円と制限時間・専用の表示・初回のチュートリアル 1 段目
    await ev(page, 'g.missions.forceRescueAsk = true; return 1;');
    await page.waitForFunction(() => !document.getElementById('talk').classList.contains('hidden'), null, { timeout: 20000 });
    await page.evaluate(() => [...document.querySelectorAll('#talk .tk-choices button')].find((b) => b.textContent === '助ける').click());
    await page.waitForFunction(() => window.__THREE_GAME_TEST_HOOKS__.game.missions.active?.kind === 'rescue', null, { timeout: 20000 });
    await settle(page, 600);
    info = await page.evaluate(() => { const r = document.getElementById('mission'); return { cls: r.className, title: document.getElementById('ms-title').innerHTML, prog: document.getElementById('ms-prog').textContent, svg: !!r.querySelector('svg.ms-turtle'), hid: r.classList.contains('hidden'), paused: window.__THREE_GAME_TEST_HOOKS__.game.paused, marks: window.__THREE_GAME_TEST_HOOKS__.game.missions.marks().length }; });
    check('D5 ［助ける］で円と制限時間が始まる（潜水は再開）', !info.paused && info.marks === 1 && /残り\d+秒|金色の円の中へ/.test(info.prog), JSON.stringify(info));
    check('D6 上部にウミガメの専用の表示（アイコン＋残り時間）', !info.hid && info.cls.includes('rescue') && info.svg && info.title.includes('ウミガメを助ける'), JSON.stringify(info));
    let mm = await mini(page);
    check('D7 初回のチュートリアル 1 段目「マップの金色の円の中にいる」', mm.includes('マップの金色の円の中にいる'), mm);
    check('D8 チュートリアルは一度きりとして記録（talked に turtleHow）', (await ev(page, 'return g.save.talked.includes("turtleHow");')) === true);
    await page.screenshot({ path: path.join(SHOT, 'f8-turtle-mission-portrait.png') });
    // D9 円に入ったら 2 段目（6 秒後）。円の中心へ移動
    await ev(page, 'g.missions.active.tipT = (g.missions.active.tipT ?? 0) - 10; return 1;'); // 実時間が短くても、1 段目から 6 秒たった扱いにする
    const area = await ev(page, 'const a = g.missions.active.area; const s = g.missions.active.spot; return { ax: a.x, az: a.z, sx: s.x, sy: s.y, sz: s.z };');
    await H(page, 'teleport', area.ax, area.sy + 2, area.az);
    await page.waitForFunction(() => window.__minilog.some((t) => t.includes('ナイフのボタン')), null, { timeout: 30000 }).catch(() => {});
    const lg = await page.evaluate(() => window.__minilog);
    check('D9 円に入ると 2 段目「近づいて、ナイフのボタンをタップ」（1 段目の 6 秒後以降）', lg.some((t) => t.includes('近づいて、ナイフのボタンをタップ')) && lg.findIndex((t) => t.includes('金色の円の中にいる')) < lg.findIndex((t) => t.includes('ナイフのボタン')), JSON.stringify(lg));
    // D10 近づいてナイフ → 3 段目
    await H(page, 'teleport', area.sx + 1.2, area.sy + 0.3, area.sz);
    await H(page, 'look', Math.atan2(-(area.sx - (area.sx + 1.2)), -(area.sz - area.sz)), 0);
    await page.waitForFunction(() => window.__THREE_GAME_TEST_HOOKS__.game.cutReady, null, { timeout: 20000 }).catch(() => {});
    await H(page, 'press', 'shutter');
    await page.waitForFunction(() => document.getElementById('talk-mini').textContent.includes('ついてくる'), null, { timeout: 30000 }).catch(() => {});
    mm = await mini(page);
    check('D10 切れたら 3 段目「助けたウミガメは、このダイブの間ついてくる」', mm.includes('助けたウミガメは、このダイブの間ついてくる'), mm);
    info = await ev(page, 'return { comp: !!g.creatures.companion, active: g.missions.active?.kind ?? null };');
    check('D11 ウミガメがついてくる・依頼は終わる', info.comp && info.active === null, JSON.stringify(info));
    // D12 2 回目以降はチュートリアルなし
    await ev(page, 'g.missions.newDive(); g.talk.hideMini(); g.missions.forceRescueAsk = true; return 1;');
    await page.waitForFunction(() => !document.getElementById('talk').classList.contains('hidden'), null, { timeout: 20000 });
    await page.evaluate(() => [...document.querySelectorAll('#talk .tk-choices button')].find((b) => b.textContent === '助ける').click());
    await page.waitForFunction(() => window.__THREE_GAME_TEST_HOOKS__.game.missions.active?.kind === 'rescue', null, { timeout: 20000 });
    await settle(page, 800);
    check('D12 2 回目以降の［助ける］ではチュートリアルの吹き出しは出ない', (await mini(page)) === '', await mini(page));
    await page.context().close();
  }

  // ============ E. 手記
  {
    const page = await boot({ ...base, sceneHints: ['whalesleep', 'orcas'] });
    const j0 = await ev(page, 'return g.save.journals;');
    check('E1 読み込み時に sceneHints から journals を作る（sceneHints も残す）', Array.isArray(j0) && j0.length === 2 && j0[0].scene === 'whalesleep' && j0[1].scene === 'orcas' && (await ev(page, 'return g.save.sceneHints.length;')) === 2, JSON.stringify(j0));
    await page.context().close();
  }
  {
    const page = await boot(base);
    await dive(page, 'lagoon');
    await ev(page, 'g.openChest("c_lagoon"); return 1;');
    await settle(page, 400);
    let s = await saved(page);
    const m = await mini(page);
    check('E2 宝箱を開ける：潜水中は短く「古い手記の切れはしを拾った…（浮上してから読もう）」', m.includes('古い手記の切れはしを拾った') && m.includes('浮上してから読もう'), m);
    check('E3 セーブに journals（scene と t）を拾った順に足す。sceneHints も残る', s.journals?.length === 1 && typeof s.journals[0].scene === 'string' && typeof s.journals[0].t === 'number' && s.sceneHints?.length === 1 && s.sceneHints[0] === s.journals[0].scene, JSON.stringify({ j: s.journals, h: s.sceneHints }));
    check('E4 潜水中は手記を読ませない（画面は出ない・発見カードも出ない）', (await hidden(page, '#journal')) && (await hidden(page, '#discover')));
    const scene = s.journals[0].scene;
    await surface(page);
    check('E5 浮上すると、まず結果画面', !(await hidden(page, '#result')) && (await hidden(page, '#journal')));
    await jsClick(page, '#res-ok');
    await page.waitForFunction(() => !document.getElementById('journal').classList.contains('hidden'), null, { timeout: 10000 });
    const jr = await page.evaluate(() => ({ kicker: document.getElementById('jr-kicker').textContent, ps: [...document.querySelectorAll('#jr-body p')].map((p) => p.textContent), end: document.getElementById('jr-end').textContent, met: document.getElementById('jr-met').classList.contains('hidden'), bg: getComputedStyle(document.querySelector('.jr-paper')).backgroundImage.length > 20 }));
    check('E6 結果画面の後に手記の画面（紙の質感・2〜3 行の本文＋最後に意味深な一文）', jr.ps.length >= 2 && jr.ps.length <= 3 && jr.end === 'これに従えば、面白い生き物に会えるかもしれない……' && jr.bg, JSON.stringify(jr));
    check('E7 まだ出会えていない光景には「出会えた」の印は出ない', jr.met === true);
    await page.screenshot({ path: path.join(SHOT, 'f8-journal-portrait.png') });
    await jsClick(page, '#jr-ok');
    await page.waitForFunction(() => document.getElementById('journal').classList.contains('hidden') && !document.getElementById('title').classList.contains('hidden'), null, { timeout: 10000 });
    check('E8 閉じるとボート画面へ', true);
    // 実績画面のタブ
    await jsClick(page, '#open-album');
    await settle(page, 300);
    let tabs = await page.evaluate(() => [...document.querySelectorAll('.al-tab')].map((b) => b.textContent));
    check('E9 実績画面にタブ「手記」', tabs.length === 2 && tabs[1].startsWith('手記'), tabs.join('|'));
    await page.evaluate(() => document.querySelector('[data-altab="journals"]').click());
    await settle(page, 200);
    let list = await page.evaluate(() => [...document.querySelectorAll('.al-journal')].map((b) => b.textContent));
    check('E10 手記の一覧（拾った順）・まだ出会えていない', list.length === 1 && list[0].includes('その1') && list[0].includes('タップで読む'), list.join('|'));
    await page.evaluate(() => document.querySelector('.al-journal').click());
    await page.waitForFunction(() => !document.getElementById('journal').classList.contains('hidden'));
    check('E11 タップで本文が開く', (await page.evaluate(() => document.querySelectorAll('#jr-body p').length)) >= 2);
    await jsClick(page, '#jr-ok');
    // 光景を撮った後は「◯◯に出会えた」
    await ev(page, `g.save.scenes = { ["${scene}"]: { photo: "", t: 1 } }; g.renderAlbum(); return 1;`);
    list = await page.evaluate(() => [...document.querySelectorAll('.al-journal')].map((b) => b.textContent));
    check('E12 光景を撮った後は「◯◯に出会えた」の印', list[0].includes('に出会えた'), list.join('|'));
    await page.evaluate(() => document.querySelector('.al-journal').click());
    await page.waitForFunction(() => !document.getElementById('journal').classList.contains('hidden'));
    check('E13 手記の画面にも「◯◯に出会えた」', !(await hidden(page, '#jr-met')) && (await text(page, '#jr-met')).includes('に出会えた'));
    await jsClick(page, '#jr-ok');
    // F. 実績画面の「？？？」のヒント文
    await page.evaluate(() => document.querySelector('[data-altab="scenes"]').click());
    const q = await page.evaluate(() => [...document.querySelectorAll('#album-body figure.locked figcaption')].filter((f) => f.textContent.includes('？？？')).map((f) => f.textContent));
    check('F1 実績画面の「？？？」のヒント文に「出会えるかは運しだい」', q.length > 0 && q.every((t) => t.includes('出会えるかは運しだい')), `${q.length} 件`);
    await page.context().close();
  }
  {
    // 16 本の文面がそろっている・複数の手記は 1 枚ずつ
    const page = await boot(base);
    const out = await ev(page, `const ids = Object.keys(g.save.scenes ? {} : {}).concat(['whalesleep','spawning','baitball','mantatrain','whaleshark','humpback','dolphins','hammers','noctiluca','orcas','tornado','mantanight','lanternrise','flashlight','akameeyes','ayurun']); const r = []; for (const id of ids) { g.openJournal(id); r.push(document.querySelectorAll('#jr-body p').length); g.closeJournal(); } return r;`);
    check('E14 16 本すべて 2〜3 行の本文がある', out.length === 16 && out.every((n) => n >= 2 && n <= 3), out.join(','));
    await ev(page, 'g.journalQueue.push("orcas", "tornado"); g.flushJournals(); return 1;');
    check('E15 複数拾ったときは 1 枚ずつ（1 枚目は「次の手記へ」）', (await text(page, '#jr-ok')) === '次の手記へ');
    await jsClick(page, '#jr-ok');
    check('E16 2 枚目は「閉じる」', (await text(page, '#jr-ok')) === '閉じる' && !(await hidden(page, '#journal')));
    await jsClick(page, '#jr-ok');
    check('E17 最後で閉じる', await hidden(page, '#journal'));
    await page.context().close();
  }

  check('Z0 ページエラーなし', errors.length === 0, errors.slice(0, 3).join(' | '));
  const bad = results.filter((r) => !r.ok);
  console.log(`\n${results.length - bad.length}/${results.length} 件 OK`);
  await browser.close();
  server.close();
  process.exit(bad.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
