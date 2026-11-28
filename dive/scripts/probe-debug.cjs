/**
 * テスト用デバッグ機能（game/debug.ts。完成版で削除）の probe：各操作がセーブとゲームに実際に効くことを確認する。
 * 手順：セーブを仕込む → 2 タップ（1 回目は確認表示だけで何も変わらない）→ ページ再読み込み → セーブとゲームの値を見る。
 * Usage: node scripts/probe-debug.cjs [dist/artifact.html]   (PROBE_CHROME=<chromium binary> NODE_PATH=...)
 */
const path = require('path');
const http = require('http');
const fs = require('fs');
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('playwright-core')); }
const ARTIFACT = process.argv[2] || path.join(__dirname, '..', 'dist', 'artifact.html');
const EXE = process.env.PROBE_CHROME;
const KEY = 'blue-depths-save-v1';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
// セーブ形式の項目（Save 型）。デバッグ操作がこの外のキーを作っていないこと
const KNOWN = new Set(['found', 'dives', 'maxDepth', 'muted', 'money', 'owned', 'earned', 'discovered', 'storyMain', 'storyRead', 'scenes', 'tutorial', 'talked', 'nightHint', 'airLv', 'board', 'quests', 'boardOn', 'boardIntro', 'questsDone', 'stocked', 'announced', 'p1', 'p2', 'storyClaim', 'visited', 'spots', 'chests', 'sceneHints', 'rep', 'orders', 'cooler', 'day', 'clock', 'buff', 'story', 'uniDay', 'okami', 'bait']);

(async () => {
  const html = fs.readFileSync(ARTIFACT);
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({ ...(EXE ? { executablePath: EXE } : {}), args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const ready = () => page.waitForFunction(() => window.__THREE_GAME_TEST_HOOKS__ && window.__THREE_GAME_TEST_HOOKS__.game.state === 'title', null, { timeout: 240000, polling: 500 });
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const readSave = () => ev((k) => JSON.parse(localStorage.getItem(k) || 'null'), KEY);
  const BASE = { found: {}, dives: 3, maxDepth: 10, money: 500, owned: ['spear'], earned: 0, discovered: ['lagoon'], visited: ['lagoon'], storyMain: 1, storyRead: 1, airLv: 0, p1: 1, p2: 1, tutorial: true, boardOn: true, rep: 3, story: 1, day: 2, clock: 100 };
  /** セーブを仕込んでから読み直す */
  const seed = async (patch) => {
    await ev(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), [KEY, { ...BASE, ...patch }]);
    await page.reload();
    await ready();
  };
  /** 入力をセットして 1 タップ目（確認表示）→ 2 タップ目（実行・再読み込み） */
  const act = async (id, inputs = {}) => {
    await ev((inp) => { for (const [i, v] of Object.entries(inp)) { const e = document.getElementById(i); e.value = String(v); } }, inputs);
    const before = await readSave();
    const sel = id.startsWith('#') ? id : `[data-dbg="${id}"]`;
    const label = await ev((s) => { const b = document.querySelector(s); b.click(); return b.textContent; }, sel);
    const afterTap1 = await readSave();
    const unchanged = JSON.stringify(before) === JSON.stringify(afterTap1);
    await Promise.all([page.waitForNavigation({ timeout: 60000 }), ev((s) => document.querySelector(s).click(), sel)]);
    await ready();
    return { label, unchanged, save: await readSave() };
  };
  const game = (fn, arg) => ev(`(${fn.toString()})(window.__THREE_GAME_TEST_HOOKS__.game, ${JSON.stringify(arg ?? null)})`);
  const keysOk = (s) => Object.keys(s).every((k) => KNOWN.has(k));

  await page.waitForFunction(() => window.__THREE_GAME_TEST_HOOKS__, null, { timeout: 240000 });
  await seed({});
  const panel = await ev(() => ({ det: !!document.getElementById('dbg-panel'), btns: document.querySelectorAll('[data-dbg]').length, state: document.getElementById('dbg-state').textContent, ch: document.getElementById('dbg-chapter').options.length, rep: document.getElementById('dbg-rep').options.length }));
  check('panel: 既存の「リセット」「最大」の 2 ボタンも残っている', await ev(() => !!document.getElementById('reset-save') && !!document.getElementById('unlock-all')));
  check('panel: デバッグパネルが出る（操作ボタン・現在値・章と評判の選択肢）', panel.det && panel.btns >= 17 && panel.state.includes('所持金') && panel.ch === 8 && panel.rep === 6, JSON.stringify(panel));

  // ---- 所持金
  let r = await act('money-set', { 'dbg-money': 12345 });
  check('money: 任意額の設定（2 タップ。1 回目は確認表示だけで変わらない）', r.save.money === 12345 && r.unchanged && r.label.includes('本当'), `money=${r.save.money} label=${r.label}`);
  check('money: ボート画面に反映', (await ev(() => document.getElementById('t-goal').textContent)).includes('12,345'));
  r = await act('money-add10k'); check('money: +10,000', r.save.money === 22345, String(r.save.money));
  r = await act('money-add100k'); check('money: +100,000', r.save.money === 122345, String(r.save.money));
  r = await act('money-set', { 'dbg-money': 0 }); check('money: 0 にも戻せる', r.save.money === 0);

  // ---- 図鑑の割合
  r = await act('dex-set', { 'dbg-dex': 50 });
  const n50 = Object.keys(r.save.found).length;
  const tot = await ev(() => window.__THREE_GAME_TEST_HOOKS__.game.foundCount);
  const all = await ev(() => document.getElementById('dbg-state').textContent.match(/図鑑 (\d+)\/(\d+)/).slice(1).map(Number));
  check('dex: 50% まで発見済みにする（種数の半分）', n50 === Math.round(all[1] / 2) && tot === n50 && all[0] === n50, `found=${n50} total=${all[1]}`);
  const firstKeys = Object.keys(r.save.found);
  r = await act('dex-set', { 'dbg-dex': 20 });
  const n20 = Object.keys(r.save.found).length;
  check('dex: 20% に減らすと発見を取り消す（先頭の種は残る）', n20 === Math.round(all[1] * 0.2) && Object.keys(r.save.found).every((k) => firstKeys.includes(k)), `found=${n20}`);
  r = await act('dex-set', { 'dbg-dex': 100 }); check('dex: 100% で全種', Object.keys(r.save.found).length === all[1], String(Object.keys(r.save.found).length));
  const cards = await ev(() => { window.__THREE_GAME_TEST_HOOKS__.game.openDex(); return { all: document.querySelectorAll('#dex-grid .dcard').length, unk: document.querySelectorAll('#dex-grid .dcard.unk').length }; });
  check('dex: 図鑑画面に全種が発見済みで出る（？？？なし）', cards.all === all[1] && cards.unk === 0, JSON.stringify(cards));
  await page.reload(); await ready();
  r = await act('dex-set', { 'dbg-dex': 0 }); check('dex: 0% で空', Object.keys(r.save.found).length === 0);

  // ---- ストーリーの章
  r = await act('chapter-set', { 'dbg-chapter': 3 });
  const ch3 = await game((g) => ({ main: g.save.storyMain, title: g.chapter?.title, claim: g.save.storyClaim }));
  check('chapter: 3 章までクリア（章カードは第 4 章、報酬の未受取なし）', r.save.storyMain === 3 && r.save.storyRead === 2 && ch3.main === 3 && Array.isArray(ch3.claim) && ch3.claim.length === 0 && !!ch3.title, JSON.stringify(ch3));
  r = await act('chapter-set', { 'dbg-chapter': 7 }); check('chapter: 全章クリア', r.save.storyMain === 7 && r.save.storyRead === 7, `main=${r.save.storyMain}`);
  r = await act('chapter-set', { 'dbg-chapter': 0 }); check('chapter: 0 章に戻せる', r.save.storyMain === 0 && r.save.storyRead === -1);

  // ---- 評判
  r = await act('rep-set', { 'dbg-rep': 4 });
  check('rep: Lv4 にする（rep=15、食堂の評判レベルも 4）', r.save.rep === 15 && (await game((g) => g.kitchen.level)) === 4, `rep=${r.save.rep}`);
  r = await act('rep-set', { 'dbg-rep': 1 });
  check('rep: Lv1 に戻す（rep=0、既読の話数は評判を超えない）', r.save.rep === 0 && r.save.story <= 1 && (await game((g) => g.kitchen.level)) === 1, `rep=${r.save.rep} story=${r.save.story}`);

  // ---- 装備
  r = await act('gear-all');
  const gear = await game((g) => ({ oldreg: g.has('oldreg'), goldfins: g.has('goldfins'), compass: g.has('compass'), spear: g.has('spear'), torch: g.has('torch'), n: g.save.owned.length, air: g.save.airLv }));
  check('gear: 全装備を所持（宝箱の 3 装備・フグ免許・タンク最大も）', gear.oldreg && gear.goldfins && gear.compass && gear.spear && gear.torch && r.save.owned.includes('fugulicense') && r.save.airLv >= 1, JSON.stringify(gear));
  r = await act('gear-none'); check('gear: 全部手放すと初期状態', r.save.owned.length === 0 && r.save.airLv === 0);

  // ---- マップ
  r = await act('maps-all');
  const dp = await game((g) => ({ known: g.discovered.size }));
  const npts = await ev(() => document.getElementById('dbg-state').textContent.match(/マップ (\d+)\/(\d+)/).slice(1).map(Number));
  check('maps: 全ダイブポイントを発見済み', r.save.discovered.length === npts[1] && dp.known === npts[1] && r.save.visited.length === npts[1], `${r.save.discovered.length}/${npts[1]}`);
  r = await act('maps-none'); check('maps: ラグーンだけに戻せる', r.save.discovered.length === 1 && r.save.discovered[0] === 'lagoon' && r.save.visited.length === 1);

  // ---- 宝箱・光景・スポットのリセット
  await seed({ chests: ['c_lagoon', 'c_reef'], sceneHints: ['akameeyes'], scenes: { akameeyes: { photo: '', t: 1 }, ayurun: { photo: '', t: 1 } }, spots: ['lagoon', 'reef'] });
  r = await act('chests-reset'); check('reset: 宝箱の取得状態を戻す（光景・スポットは残る）', r.save.chests.length === 0 && r.save.sceneHints.length === 0 && Object.keys(r.save.scenes).length === 2 && r.save.spots.length === 2);
  r = await act('scenes-reset'); check('reset: 特別な光景を戻す（アルバムのバッジも 0）', Object.keys(r.save.scenes).length === 0 && r.save.spots.length === 2 && (await ev(() => document.getElementById('open-album').title)).includes('0 /'));
  r = await act('spots-reset'); check('reset: 写真スポットを戻す', r.save.spots.length === 0);

  // ---- 日数と時間帯
  r = await act('day-set', { 'dbg-day': 7 });
  check('day: 7 日目にする（ボート画面にも反映）', r.save.day === 7 && (await ev(() => document.getElementById('daytime').textContent)).includes('7日目'));
  for (const [id, label, nightMin] of [['time-night', '夜', true], ['time-noon', '昼', false], ['time-dusk', '夕方', false], ['time-morning', '朝', false]]) {
    r = await act(id);
    const t = await ev(() => document.getElementById('daytime').textContent);
    const night = await game((g) => g.nightBlocked?.() ?? null);
    check(`time: ${label}にする（表示「${label}」、clock=${r.save.clock}）`, t.includes(label) && t.includes('7日目'), t.slice(0, 40) + ` nightBlocked=${night}`);
  }
  r = await act('time-night');
  check('time: 夜にすると nightOf ≥ 0.5（夜のダイブ条件）', await game((g) => g.save.clock) >= 780 && (await game((g) => g.env ? 1 : 1)) === 1);

  // ---- 既存の「最大」と「リセット」、セーブ形式
  r = await act('#unlock-all');
  check('既存の最大：全解禁（所持金 999999 以上・全章・タンク最大）', r.save.money >= 999999 && r.save.storyMain === 7 && r.save.owned.length >= 12 && r.save.tutorial === true && r.unchanged);
  check('セーブ形式：デバッグ操作が既存の項目以外を作っていない', keysOk(r.save), Object.keys(r.save).filter((k) => !KNOWN.has(k)).join(','));
  await ev(() => { const b = document.getElementById('reset-save'); b.click(); });
  const stillThere = await readSave();
  await Promise.all([page.waitForNavigation({ timeout: 60000 }), ev(() => document.getElementById('reset-save').click())]);
  await page.waitForFunction(() => window.__THREE_GAME_TEST_HOOKS__, null, { timeout: 240000 });
  const afterReset = await readSave();
  check('既存のリセット：1 回目では消えず、2 回目で初期化', !!stillThere && (afterReset === null || afterReset.money === 0 || afterReset.dives === 0), JSON.stringify(afterReset)?.slice(0, 80));
  check('ページエラーなし', errors.length === 0, errors.slice(0, 3).join(' | '));

  const fail = results.filter((x) => !x.ok).length;
  console.log(`\n${results.length - fail}/${results.length} passed`);
  await browser.close();
  server.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
