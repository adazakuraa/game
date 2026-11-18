// ガレージ: コイン・パーツカタログ・所持と装備のセーブ。見た目だけで、性能には一切影響しない。
import { store } from './store.js';

// slot: カテゴリ。view: プレビューのカメラ位置
export const SLOTS = [
  { id: 'paint', name: 'ボディカラー', view: 'front' },
  { id: 'finish', name: '塗装', view: 'front' },
  { id: 'stripe', name: 'ストライプ', view: 'top' },
  { id: 'stripeColor', name: 'ストライプ色', view: 'top' },
  { id: 'body', name: 'ボディキット', view: 'front' },
  { id: 'front', name: 'フロント', view: 'nose' },
  { id: 'hood', name: 'ボンネット', view: 'top' },
  { id: 'roof', name: 'ルーフ', view: 'top' },
  { id: 'height', name: '車高', view: 'side' },
  { id: 'wheel', name: 'ホイール', view: 'wheel' },
  { id: 'wheelColor', name: 'ホイール色', view: 'wheel' },
  { id: 'caliper', name: 'キャリパー', view: 'wheel' },
  { id: 'wing', name: 'リアウイング', view: 'rear' },
  { id: 'exhaust', name: 'マフラー', view: 'rearLow' },
  { id: 'window', name: 'ウインドウ', view: 'front' },
  { id: 'light', name: 'ライト色', view: 'nose' },
  { id: 'glow', name: 'アンダーグロー', view: 'glow' },
  { id: 'smoke', name: 'スモーク', view: 'smoke' },
  { id: 'number', name: 'ゼッケン', view: 'side' },
];


export const ITEMS = {
  paint: [
    { id: 'ruby', name: 'ルビーレッド', color: 0xd0101c, price: 0 },
    { id: 'blue', name: 'コバルトブルー', color: 0x1450c8, price: 0 },
    { id: 'white', name: 'ホワイト', color: 0xf0f0f0, price: 0 },
    { id: 'black', name: 'ブラック', color: 0x101012, price: 0 },
    { id: 'yellow', name: 'イエロー', color: 0xffb300, price: 0 },
    { id: 'green', name: 'レーシンググリーン', color: 0x13a05a, price: 0 },
    { id: 'orange', name: 'オレンジ', color: 0xff5f1f, price: 0 },
    { id: 'purple', name: 'パープル', color: 0x8e44ff, price: 0 },
    { id: 'sky', name: 'スカイブルー', color: 0x35a7ff, price: 200 },
    { id: 'mint', name: 'ミント', color: 0x3de0b4, price: 200 },
    { id: 'silver', name: 'シルバー', color: 0xbfc5cc, price: 250 },
    { id: 'gunmetal', name: 'ガンメタル', color: 0x4a5058, price: 250 },
    { id: 'navy', name: 'ネイビー', color: 0x0d2a6b, price: 300 },
    { id: 'wine', name: 'ワイン', color: 0x6d1230, price: 300 },
    { id: 'lime', name: 'ライム', color: 0xa6e22e, price: 300 },
    { id: 'pink', name: 'ホットピンク', color: 0xff5fa8, price: 350 },
    { id: 'turquoise', name: 'ターコイズ', color: 0x00a6a6, price: 350 },
    { id: 'champagne', name: 'シャンパンゴールド', color: 0xc9a96a, price: 450 },
    { id: 'copper', name: 'コッパー', color: 0xb5651d, price: 450 },
    { id: 'rose', name: 'ローズゴールド', color: 0xd78c7f, price: 600 },
  ],
  finish: [
    { id: 'metallic', name: 'メタリック', desc: '標準の輝き', price: 0 },
    { id: 'gloss', name: 'ソリッドグロス', desc: '濃く深いツヤ', price: 0 },
    { id: 'satin', name: 'サテン', desc: '落ち着いた半ツヤ', price: 250 },
    { id: 'matte', name: 'マット', desc: 'ツヤ消し', price: 400 },
    { id: 'pearl', name: 'パール', desc: '角度で色が変わる', price: 800 },
    { id: 'chrome', name: 'クローム', desc: '鏡のような反射', price: 2000 },
  ],
  stripe: [
    { id: 'none', name: 'なし', price: 0 },
    { id: 'center2', name: 'ツインライン', desc: 'ボンネットからルーフ、トランクへ', price: 150 },
    { id: 'wide', name: 'ワイドライン', desc: '太い1本線', price: 150 },
    { id: 'triple', name: 'トリプル', desc: '太線と細線の組み合わせ', price: 300 },
    { id: 'checker', name: 'チェッカー', desc: '市松模様の帯', price: 500 },
  ],
  stripeColor: [
    { id: 'white', name: 'ホワイト', color: 0xf4f4f4, price: 0 },
    { id: 'black', name: 'ブラック', color: 0x101012, price: 0 },
    { id: 'red', name: 'レッド', color: 0xd0101c, price: 100 },
    { id: 'yellow', name: 'イエロー', color: 0xffc400, price: 100 },
    { id: 'blue', name: 'ブルー', color: 0x1f6bff, price: 100 },
    { id: 'orange', name: 'オレンジ', color: 0xff6a00, price: 100 },
    { id: 'cyan', name: 'シアン', color: 0x1ad6ff, price: 150 },
    { id: 'lime', name: 'ライム', color: 0xb6f01a, price: 150 },
    { id: 'pink', name: 'ピンク', color: 0xff5fa8, price: 150 },
    { id: 'gold', name: 'ゴールド', color: 0xd4a017, price: 250 },
  ],
  wheel: [
    { id: 'twin', name: 'ツインスポーク', desc: '標準の10本スポーク', price: 0 },
    { id: 'five', name: '5スポーク', desc: '太く力強い5本', price: 150 },
    { id: 'mesh', name: 'メッシュ', desc: '細いスポークが交差', price: 300 },
    { id: 'disc', name: 'エアロディスク', desc: '空力カバー付き', price: 400 },
    { id: 'fan', name: 'タービン', desc: '羽根状のスポーク', price: 500 },
  ],
  wheelColor: [
    { id: 'silver', name: 'シルバー', color: 0x9aa0a6, price: 0 },
    { id: 'gunmetal', name: 'ガンメタル', color: 0x2a2c30, price: 0 },
    { id: 'black', name: 'グロスブラック', color: 0x0c0c0e, price: 100 },
    { id: 'white', name: 'ホワイト', color: 0xe8e8e8, price: 100 },
    { id: 'red', name: 'レッド', color: 0xc0141c, price: 150 },
    { id: 'blue', name: 'ブルー', color: 0x1a5fd0, price: 150 },
    { id: 'bronze', name: 'ブロンズ', color: 0x8a5a2b, price: 200 },
    { id: 'gold', name: 'ゴールド', color: 0xd4a017, price: 250 },
  ],
  caliper: [
    { id: 'yellow', name: 'イエロー', color: 0xc8a000, price: 0 },
    { id: 'red', name: 'レッド', color: 0xd01818, price: 100 },
    { id: 'blue', name: 'ブルー', color: 0x1a56d6, price: 100 },
    { id: 'green', name: 'グリーン', color: 0x18a85a, price: 100 },
    { id: 'orange', name: 'オレンジ', color: 0xff7a00, price: 100 },
    { id: 'white', name: 'ホワイト', color: 0xe8e8e8, price: 100 },
    { id: 'pink', name: 'ピンク', color: 0xff5fa8, price: 150 },
  ],
  wing: [
    { id: 'gt', name: 'GTウイング', desc: '標準の大型ウイング', price: 0 },
    { id: 'none', name: 'なし', desc: 'すっきりした見た目', price: 0 },
    { id: 'duck', name: 'ダックテール', desc: 'トランク後端の小さなリップ', price: 150 },
    { id: 'high', name: 'ハイマウント', desc: '背の高い2段ウイング', price: 300 },
    { id: 'swan', name: 'スワンネック', desc: '上から吊る曲線のステー', price: 450 },
  ],
  body: [
    { id: 'std', name: 'ノーマル', desc: '標準のボディ', price: 0 },
    { id: 'street', name: 'ストリート', desc: '低いサイドステップ', price: 300 },
    { id: 'wide', name: 'ワイドボディ', desc: 'オーバーフェンダーで幅広く。トレッドも広がる', price: 900 },
  ],
  front: [
    { id: 'lip', name: 'リップスポイラー', desc: '標準の薄いリップ', price: 0 },
    { id: 'none', name: 'なし', desc: 'すっきりしたノーズ', price: 0 },
    { id: 'big', name: '大型スプリッター', desc: '前に張り出す板とエンドプレート', price: 350 },
    { id: 'canard', name: 'カナード', desc: 'バンパー左右の小さな羽根', price: 450 },
  ],
  hood: [
    { id: 'std', name: '標準', desc: 'ボディ同色', price: 0 },
    { id: 'vent', name: 'エアダクト', desc: '熱を抜く2つの開口', price: 250 },
    { id: 'louver', name: 'ルーバー', desc: '細いスリットが並ぶ', price: 350 },
    { id: 'carbon', name: 'カーボン', desc: 'ツヤのあるカーボンパネル', price: 500 },
  ],
  roof: [
    { id: 'none', name: 'なし', price: 0 },
    { id: 'fin', name: 'シャークフィン', desc: '後ろ寄りの小さなフィン', price: 120 },
    { id: 'spoiler', name: 'ルーフスポイラー', desc: 'リアガラスの上の小さな羽根', price: 300 },
    { id: 'scoop', name: 'ルーフスクープ', desc: 'ラリーカー風の空気取り入れ口', price: 280 },
  ],
  height: [
    { id: 'std', name: '標準', price: 0 },
    { id: 'low', name: 'ローダウン', desc: '-4cm', price: 150 },
    { id: 'slam', name: 'シャコタン', desc: '-7.5cm。地をはうような低さ', price: 300 },
    { id: 'lift', name: 'リフトアップ', desc: '+6cm', price: 200 },
  ],
  exhaust: [
    { id: 'dual', name: 'デュアル', desc: '左右 1 本ずつ', price: 0 },
    { id: 'center', name: 'センター出し', desc: '中央に太い 1 本', price: 200 },
    { id: 'quad', name: '4本出し', desc: '左右 2 本ずつ', price: 350 },
    { id: 'big', name: '大口径', desc: '太いテールを左右に', price: 250 },
  ],
  window: [
    { id: 'clear', name: 'クリア', color: 0x7f97ad, price: 0 },
    { id: 'smoke', name: 'スモーク', color: 0x2a323c, price: 100 },
    { id: 'black', name: 'ブラック', color: 0x050505, price: 200 },
    { id: 'mirror', name: 'ミラー', color: 0x3c6fa8, price: 400 },
  ],
  light: [
    { id: 'white', name: 'ホワイト', color: 0xfff3dd, price: 0 },
    { id: 'blue', name: 'ブルーホワイト', color: 0xcfe2ff, price: 120 },
    { id: 'yellow', name: 'イエロー', color: 0xffcf4a, price: 150 },
    { id: 'purple', name: 'パープル', color: 0xc9a6ff, price: 200 },
  ],
  glow: [
    { id: 'none', name: 'なし', price: 0 },
    { id: 'white', name: 'ホワイト', color: 0xdfe8ff, price: 250 },
    { id: 'red', name: 'レッド', color: 0xff1a1a, price: 300 },
    { id: 'blue', name: 'ブルー', color: 0x1f6bff, price: 300 },
    { id: 'green', name: 'グリーン', color: 0x1aff6a, price: 300 },
    { id: 'purple', name: 'パープル', color: 0xa23cff, price: 300 },
    { id: 'cyan', name: 'シアン', color: 0x18e4ff, price: 300 },
    { id: 'pink', name: 'ピンク', color: 0xff3fa0, price: 300 },
    { id: 'rainbow', name: 'レインボー', desc: '色がゆっくり変わる', color: 'rainbow', price: 1200 },
  ],
  smoke: [
    { id: 'white', name: 'ホワイト', price: 0 },
    { id: 'black', name: 'ブラック', color: 0x2a2a2a, price: 150 },
    { id: 'red', name: 'レッド', color: 0xff3b30, price: 200 },
    { id: 'blue', name: 'ブルー', color: 0x3b8cff, price: 200 },
    { id: 'green', name: 'グリーン', color: 0x3dd86a, price: 200 },
    { id: 'pink', name: 'ピンク', color: 0xff6fb5, price: 200 },
    { id: 'yellow', name: 'イエロー', color: 0xffd84a, price: 200 },
    { id: 'purple', name: 'パープル', color: 0xb46bff, price: 200 },
    { id: 'rainbow', name: 'レインボー', desc: '煙の色が変わる', color: 'rainbow', price: 800 },
  ],
};

const DEFAULT_EQUIP = {
  paint: 'ruby', finish: 'metallic', stripe: 'none', stripeColor: 'white', wheel: 'twin', wheelColor: 'silver',
  caliper: 'yellow', wing: 'gt', glow: 'none', smoke: 'white', number: 1,
  body: 'std', front: 'lip', hood: 'std', roof: 'none', height: 'std', exhaust: 'dual', window: 'clear', light: 'white',
};

function load() {
  const s = store.get('garage', null) || {};
  return {
    coins: Number.isFinite(s.coins) ? s.coins : 0,
    owned: Array.isArray(s.owned) ? s.owned : [],
    equipped: Object.assign({}, DEFAULT_EQUIP, s.equipped || {}),
    earned: Number.isFinite(s.earned) ? s.earned : 0,
  };
}
const state = load();
const save = () => store.set('garage', state);
const key = (slot, id) => slot + ':' + id;

// 無料のものは最初から所持
export function isOwned(slot, id) {
  if (slot === 'number') return true;
  const it = ITEMS[slot].find((i) => i.id === id);
  return !!it && (it.price === 0 || state.owned.includes(key(slot, id)));
}

// 装備が不正な場合は初期値に戻す（カタログ変更への備え）
for (const slot of Object.keys(ITEMS)) {
  if (!ITEMS[slot].some((i) => i.id === state.equipped[slot]) || !isOwned(slot, state.equipped[slot])) state.equipped[slot] = DEFAULT_EQUIP[slot];
}

export const garage = {
  get coins() { return state.coins; },
  get earned() { return state.earned; },
  get equipped() { return { ...state.equipped }; },
  item(slot, id) { return ITEMS[slot].find((i) => i.id === id); },
  isOwned,
  addCoins(n) {
    state.coins += n;
    if (n > 0) state.earned += n;
    save();
  },
  buy(slot, id) {
    const it = this.item(slot, id);
    if (!it || isOwned(slot, id) || state.coins < it.price) return false;
    state.coins -= it.price;
    state.owned.push(key(slot, id));
    save();
    return true;
  },
  equip(slot, id) {
    if (!isOwned(slot, id)) return false;
    state.equipped[slot] = id;
    save();
    return true;
  },
  setNumber(n) {
    state.equipped.number = Math.max(0, Math.min(99, n | 0));
    save();
  },
  // 所持数 / 全数
  progress() {
    let have = 0, all = 0;
    for (const slot of Object.keys(ITEMS)) for (const it of ITEMS[slot]) { all++; if (isOwned(slot, it.id)) have++; }
    return { have, all };
  },
  look(eq = state.equipped) { return resolveLook(eq); },
};

// 装備 → 車モデルに渡す見た目の指定
export function resolveLook(eq) {
  const g = (slot) => ITEMS[slot].find((i) => i.id === eq[slot]) || ITEMS[slot][0];
  return {
    color: g('paint').color,
    finish: g('finish').id,
    stripe: g('stripe').id,
    stripeColor: g('stripeColor').color,
    wheel: g('wheel').id,
    wheelColor: g('wheelColor').color,
    caliper: g('caliper').color,
    wing: g('wing').id,
    glow: g('glow').color ?? null,
    smoke: g('smoke').color ?? null,
    num: eq.number,
    body: g('body').id,
    front: g('front').id,
    hood: g('hood').id,
    roof: g('roof').id,
    height: g('height').id,
    exhaust: g('exhaust').id,
    window: g('window').id,
    light: g('light').color,
  };
}

// ---------- 報酬 ----------
const POS_COINS = [600, 400, 300, 200, 150, 120, 100, 80];
const DIFF_MULT = { easy: 0.6, normal: 1, hard: 1.5 };

// info: { position, difficulty, laps, fastestLap, clean, firstPodium, firstWin }
export function raceReward(info) {
  const lapMult = info.laps / 3;
  const base = Math.round((POS_COINS[Math.min(7, info.position - 1)] * (DIFF_MULT[info.difficulty] ?? 1) * lapMult) / 10) * 10;
  const rows = [{ label: `${info.position}位の賞金`, coins: base }];
  if (info.fastestLap) rows.push({ label: 'ファステストラップ', coins: 100 });
  if (info.clean) rows.push({ label: 'クリーンレース（接触2回以内）', coins: 100 });
  if (info.firstPodium) rows.push({ label: 'このコース・難易度で初の表彰台', coins: 150 });
  if (info.firstWin) rows.push({ label: 'このコース・難易度で初優勝', coins: 300 });
  return { rows, total: rows.reduce((a, r) => a + r.coins, 0) };
}

// タイムアタック: 周回ごと。新記録で加算。1回の挑戦で報酬が出る周回数には上限がある
export const TA_LAP_COINS = 20;
export const TA_BEST_COINS = 80;
export const TA_MAX_PAID_LAPS = 10;

// ラリー: ステージの順位に応じた報酬。長いステージなので周回レースより少し多め
export function stageReward(info) {
  const base = Math.round((POS_COINS[Math.min(7, info.position - 1)] * (DIFF_MULT[info.difficulty] ?? 1) * 1.2) / 10) * 10;
  const rows = [{ label: `${info.position}位の賞金`, coins: base }];
  if (info.clean) rows.push({ label: 'ノーミス走行（強い接触なし）', coins: 120 });
  if (info.firstPodium) rows.push({ label: 'このステージ・難易度で初の表彰台', coins: 150 });
  if (info.firstWin) rows.push({ label: 'このステージ・難易度で初優勝', coins: 300 });
  return { rows, total: rows.reduce((a, r) => a + r.coins, 0) };
}
