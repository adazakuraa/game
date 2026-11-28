import type { PhotoTarget } from '../life/creatures';

/**
 * Photo grading and the money it earns (a marine magazine buys the shots).
 * Risk and return sit close together: getting near, side-on, deep, or in front of a charging shark pays more.
 * All tuning values live here.
 */
export const PHOTO = {
  /** 【1ダイブ1種1回】a species' photo pays only once per dive (the first shot's value is final; a better shot only upgrades the dex photo) */
  oncePerDive: true,
  /** 【写真の基本報酬】by rarity ★1..★3, ★4 = legendary (yen). Phase 2: about 1/7 of the old 300/900/2400/8000 */
  base: [0, 40, 130, 340, 1140],
  /** 【評価の重み】size in frame / side view / centring / clarity */
  weight: { size: 0.36, side: 0.26, centre: 0.16, clear: 0.22 },
  /** 【画面占有の目標】fraction of frame height at which size scores full marks */
  sizeFull: 0.32,
  /** 【大きすぎ】once the subject spans more than this share of the frame it crowds the edges and the size score falls off */
  fillMax: 0.8,
  /** 【はみ出し】body share that must be inside the frame for an S */
  fitForS: 0.99,
  /** grade thresholds and pay multipliers */
  grades: [
    { g: 'S', min: 70, mult: 2.5, word: 'すばらしい！' },
    { g: 'A', min: 55, mult: 1.8, word: 'いい写真！' },
    { g: 'B', min: 40, mult: 1.3, word: 'なかなか' },
    { g: 'C', min: 0, mult: 1, word: '記録写真' },
  ],
  /** 【危険手当】subject circling / charging the diver */
  dangerMult: 2,
  /** 【ダウンカレント手当】shot taken while caught in a down-current */
  currentMult: 1.5,
  /** 【夜間手当】night dive */
  nightMult: 1.3,
  /** 【深度手当】+1 per this many metres */
  depthPerBonus: 60,
  /** 【撮り直し】re-shooting a known species pays this share, unless the grade improves */
  repeatShare: 0.2,
  /** 【光景の報酬】share of SCENES[].pay actually paid (Phase 2: photos earn about 1/7) */
  sceneShare: 1 / 7,
  /** 【光景の初回報酬】share of SCENES[].pay for the first photo of a sight (Phase 3: an achievement should feel big; repeats stay at sceneShare × repeatShare) */
  sceneFirstShare: 1 / 3,
  /** 【救助費用】share of the dive's earnings kept after a blackout */
  blackoutKeep: 0.3,
};

export type Grade = (typeof PHOTO.grades)[number];

export type ShotEval = {
  score: number;
  grade: Grade;
  value: number;
  bonus: string[];
  /** Phase 3: the parts of the score (0..1 each), for the editor's advice */
  parts: { size: number; side: number; centre: number; clear: number; fit: number; fill: number };
};

export function gradeOf(score: number): Grade {
  return PHOTO.grades.find((g) => score >= g.min)!;
}

/** Score 0..100 and money for one in-range shot. */
export function evaluateShot(t: PhotoTarget, clear: number, depth: number, inCurrent: boolean, night = false): ShotEval {
  const W = PHOTO.weight;
  let size = Math.min(1, Math.max(0, (t.frac - 0.06) / (PHOTO.sizeFull - 0.06)));
  const fill = t.fill ?? 0.5;
  if (fill > PHOTO.fillMax) size = Math.max(0.2, 1 - (fill - PHOTO.fillMax) * 3);
  const clarity = Math.min(1, Math.max(0, 1 - t.dist / (t.clear ?? clear))) ** 0.7;
  const fit = t.fit ?? 1;
  let score = Math.round(100 * (W.size * size + W.side * t.side + W.centre * t.centred + W.clear * clarity) * (0.3 + 0.7 * fit ** 3));
  if (fit < PHOTO.fitForS || fill > 0.92) score = Math.min(score, PHOTO.grades[0].min - 1);
  const grade = gradeOf(score);
  const bonus: string[] = [];
  if (fit < 0.8) bonus.push('見切れ減点');
  let mult = grade.mult;
  if (t.danger) { mult *= PHOTO.dangerMult; bonus.push('危険手当 ×' + PHOTO.dangerMult); }
  if (inCurrent) { mult *= PHOTO.currentMult; bonus.push('激流手当 ×' + PHOTO.currentMult); }
  if (night) { mult *= PHOTO.nightMult; bonus.push('夜間手当 ×' + PHOTO.nightMult); }
  const deep = 1 + depth / PHOTO.depthPerBonus;
  if (depth >= 20) bonus.push(`深度手当 ×${deep.toFixed(1)}`);
  const value = Math.round((PHOTO.base[t.rt.def.rarity] * mult * deep) / 10) * 10;
  return { score, grade, value, bonus, parts: { size, side: t.side, centre: t.centred, clear: clarity, fit, fill } };
}

/**
 * Gear: comes into stock when the dex holds 【入荷に必要な図鑑の種数】need species (an absolute count, never a share of
 * the total, so adding species never makes the shop harder), then is bought with money. Ordered by need (= stock order).
 * Each item changes how you dive rather than just making numbers bigger.
 */
export type ShopItem = { id: string; need: number; price: number; name: string; desc: string; icon: string; rep?: number; req?: string; map?: string; /** 強化の商品の id（この枠の中に出す） */ upgrade?: string; /** 強化済みのアイコン */ iconUp?: string };
export const SHOP: readonly ShopItem[] = [
  { id: 'fins', need: 10, price: 1500, name: 'ロングフィン', desc: '泳ぐ速さ +30%', icon: '<path d="M7 3h4l1 8 4 8-3 2-5-7z"/>' },
  { id: 'torch', need: 20, price: 800, name: '水中ライト', desc: '暗い所や夜の海を照らせる（夜の海に潜るのに必要）', icon: '<path d="M9 3h6l-1 5h-4zM9 9h6v3l-1 1v8a2 2 0 0 1-4 0v-8l-1-1z"/>', iconUp: '<path d="M9 3h6l-1 5h-4zM9 9h6v3l-1 1v8a2 2 0 0 1-4 0v-8l-1-1z"/><path d="M19 2l.9 2.1 2.1.9-2.1.9L19 8l-.9-2.1-2.1-.9 2.1-.9z"/>', upgrade: 'light' },
  { id: 'map_cold', map: 'cold', need: 25, price: 3000, name: '海図：流氷の入り江', desc: '流氷の入り江の場所が分かり、直接行ける（水温2℃・ドライスーツ推奨）', icon: '<path d="M3 5l6-2 6 2 6-2v16l-6 2-6-2-6 2z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 7v8M8.5 9l7 4M15.5 9l-7 4" stroke="currentColor" stroke-width="1.6"/>' },
  { id: 'float', need: 30, price: 3000, name: 'シグナルフロート', desc: 'どこからでも浮上の合図を出して、ボートに拾ってもらえる', icon: '<path d="M12 2l3 9h-6z"/><rect x="10.5" y="11" width="3" height="9" rx="1"/><path d="M4 21c2-1.5 4-1.5 6 0s4 1.5 6 0 4-1.5 4-1.5" fill="none" stroke="currentColor" stroke-width="1.6"/>' },
  { id: 'drysuit', need: 35, price: 4000, name: 'ドライスーツ', desc: '冷たい海でもエアが普通にもつ', icon: '<path d="M8 3h8l2 6-2 1v11h-3v-7h-2v7H8V10L6 9z"/>' },
  { id: 'spear', need: 50, price: 2500, name: '手銛', desc: '魚を獲れる（しおさい亭から頼まれごとが来る）', icon: '<path d="M3 21L18 6" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round"/><path d="M15 3.5l5.5-1-1 5.5z"/>' },
  { id: 'macro', need: 60, price: 6000, name: 'マクロレンズ', desc: '小さな生き物（20cm未満）を大きく写せる', icon: '<circle cx="11" cy="11" r="6" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M15 15l5 5" stroke="currentColor" stroke-width="2.6"/>' },
  { id: 'light', need: 70, price: 2500, req: 'torch', name: '強力ライト', desc: '暗い所でも遠くまで照らして撮れる（水中ライトの強化）', icon: '<path d="M9 2h6l-1 6h-4zM8 9h8l-2 4v7a2 2 0 0 1-4 0v-7z"/>' },
  { id: 'map_bluehole', map: 'bluehole', need: 80, price: 9000, name: '海図：ブルーホール', desc: 'ブルーホールの場所が分かり、直接行ける', icon: '<path d="M3 5l6-2 6 2 6-2v16l-6 2-6-2-6 2z" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="11" r="3"/>' },
  { id: 'rebreather', need: 85, price: 9000, name: 'リブリーザー', desc: '泡が出ず、魚に気づかれにくい', icon: '<circle cx="8" cy="9" r="3"/><circle cx="16" cy="9" r="3"/><path d="M5 15h14v3H5z"/>' },
  { id: 'wide', need: 95, price: 8000, name: 'ワイドレンズ', desc: '大物（1m以上）を離れた所から撮れる', icon: '<path d="M3 12c4-6 14-6 18 0-4 6-14 6-18 0z"/><circle cx="12" cy="12" r="3" fill="#0b2a3a"/>' },
  { id: 'shield', need: 110, price: 12000, name: 'シャークシールド', desc: '突進してくるサメ・ゴマモンガラを追い払う', icon: '<path d="M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5z"/>' },
  { id: 'scooter', need: 120, price: 18000, name: '水中スクーター', desc: '高速移動ボタン', icon: '<path d="M3 12l7-5v3h8l3 2-3 2h-8v3z"/>' },
  { id: 'sonar', need: 135, price: 15000, name: '魚群探知機', desc: '近くの未撮影の生き物がマップに出る', icon: '<path d="M12 21a9 9 0 0 1-9-9h3a6 6 0 0 0 12 0h3a9 9 0 0 1-9 9z"/><circle cx="12" cy="12" r="2"/>' },
  { id: 'ads', need: 150, price: 30000, name: '大気圧潜水服', desc: '深海へ潜れる', icon: '<circle cx="12" cy="7" r="4"/><path d="M6 21v-6a6 6 0 0 1 12 0v6z"/>' },
  // fishing gear: comes into stock as the diner's reputation grows (【入荷に必要な評判】rep)
  { id: 'cooler', need: 0, rep: 2, price: 3000, name: 'クーラーボックス', desc: '獲物を15kgまで持ち帰れる', icon: '<rect x="3" y="8" width="18" height="12" rx="2"/><path d="M8 8V5h8v3" fill="none" stroke="currentColor" stroke-width="2"/>' },
  { id: 'license', need: 0, rep: 3, price: 8000, name: '漁業権（遊漁承認）', desc: '水中銃を使ってよい許可', icon: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 9h8M8 13h8M8 17h5" stroke="#0b2a3a" stroke-width="1.6"/>' },
  { id: 'speargun', need: 0, rep: 3, req: 'license', price: 12000, name: '水中銃', desc: '射程6m・大物も獲れる。突進してくるサメ・縄張りの魚・ライトに寄る魚を、引きつけて突けば撃退できる（要 漁業権）', icon: '<path d="M2 12h14l2-2h4v4h-4l-2-2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M6 12v5h3v-5z"/>' },
  { id: 'powerhead', need: 0, rep: 5, req: 'speargun', price: 25000, name: '大物用水中銃', desc: 'サメも仕留められる強力な銃。ダンクルオステウスやメガロドンの突進も、引きつけて突けば撃退できる', icon: '<path d="M1 12h15l3-3h4v6h-4l-3-3" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M5 12v6h4v-6z"/>' },
  { id: 'bigcooler', need: 0, rep: 4, price: 12000, name: '大型クーラー', desc: '獲物を40kgまで持ち帰れる', icon: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M7 7V4h10v3M2 12h20" fill="none" stroke="currentColor" stroke-width="2"/>' },
];
export type GearId = string;

/**
 * 【エアタンクの強化】The one tank is upgraded step by step instead of buying new ones. Capacity in bar only
 * (capacities follow the table in PHASE2-DESIGN §1.2; no wall-clock estimate is written here or in the UI). After the spear is in hand, the shop also takes fish
 * (kg from the cooler) in place of half the money.
 */
export const AIR_TANK = [
  { cap: 105, price: 0, kg: 0 },
  { cap: 140, price: 2000, kg: 1 },
  { cap: 170, price: 4000, kg: 2 },
  { cap: 210, price: 7000, kg: 3 },
  { cap: 260, price: 11000, kg: 5 },
  { cap: 320, price: 16000, kg: 8 },
  { cap: 400, price: 24000, kg: 12 },
];

/** Phase 2 moved stock from a dex share (%) to a species count: what those % rules had already stocked stays stocked. */
export const LEGACY_NEED_PCT: Partial<Record<GearId, number>> = { fins: 3, drysuit: 7, torch: 0, light: 5, spear: 4, macro: 12, map_bluehole: 14, rebreather: 16, wide: 20, map_cave: 22, shield: 24, scooter: 28, sonar: 32, map_deep: 34, ads: 36 };

/** Earlier saves unlocked gear by species count: keep what those players already had. */
export const LEGACY_NEED: Partial<Record<GearId, number>> = { fins: 5, scooter: 22, ads: 35 };

export const yen = (n: number) => '¥' + Math.round(n).toLocaleString('ja-JP');

/** The one thing that kept a shot from an S (Phase 3: the editor's advice), or null if it is an S. */
export function sAdvice(e: ShotEval): string | null {
  if (e.grade.g === 'S') return null;
  const p = e.parts;
  if (p.fit < PHOTO.fitForS || p.fill > 0.92) return p.fill > PHOTO.fillMax ? '近すぎて体が枠からはみ出している。少し離れて全身を入れよう' : '体の一部が枠から切れている。全身を枠に入れよう';
  const W = PHOTO.weight;
  const lack = [
    { k: 'size', v: (1 - p.size) * W.size, t: p.fill > PHOTO.fillMax ? '大きすぎる。少し離れよう' : 'もっと近づいて大きく写そう' },
    { k: 'side', v: (1 - p.side) * W.side, t: 'もっと真横から撮ろう（回り込んで）' },
    { k: 'centre', v: (1 - p.centre) * W.centre, t: '照準の真ん中に入れよう' },
    { k: 'clear', v: (1 - p.clear) * W.clear, t: 'ぼやけている。もっと近くで撮るとくっきりする' },
  ].sort((a, b) => b.v - a.v)[0];
  return lack.t;
}
