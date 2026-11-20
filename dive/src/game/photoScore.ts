import type { PhotoTarget } from '../life/creatures';

/**
 * Photo grading and the money it earns (a marine magazine buys the shots).
 * Risk and return sit close together: getting near, side-on, deep, or in front of a charging shark pays more.
 * All tuning values live here.
 */
export const PHOTO = {
  /** 【写真の基本報酬】by rarity ★1..★3 (yen) */
  base: [0, 1200, 3500, 9000],
  /** 【評価の重み】size in frame / side view / centring / clarity */
  weight: { size: 0.36, side: 0.26, centre: 0.16, clear: 0.22 },
  /** 【画面占有の目標】fraction of frame height at which size scores full marks */
  sizeFull: 0.32,
  /** grade thresholds and pay multipliers */
  grades: [
    { g: 'S', min: 86, mult: 3, word: 'すばらしい！' },
    { g: 'A', min: 70, mult: 2, word: 'いい写真！' },
    { g: 'B', min: 50, mult: 1.3, word: 'なかなか' },
    { g: 'C', min: 0, mult: 1, word: '記録写真' },
  ],
  /** 【危険手当】subject circling / charging the diver */
  dangerMult: 2,
  /** 【ダウンカレント手当】shot taken while caught in a down-current */
  currentMult: 1.5,
  /** 【深度手当】+1 per this many metres */
  depthPerBonus: 40,
  /** 【撮り直し】re-shooting a known species pays this share, unless the grade improves */
  repeatShare: 0.25,
  /** 【救助費用】share of the dive's earnings kept after a blackout */
  blackoutKeep: 0.3,
};

export type Grade = (typeof PHOTO.grades)[number];

export type ShotEval = {
  score: number;
  grade: Grade;
  value: number;
  bonus: string[];
};

export function gradeOf(score: number): Grade {
  return PHOTO.grades.find((g) => score >= g.min)!;
}

/** Score 0..100 and money for one in-range shot. */
export function evaluateShot(t: PhotoTarget, clear: number, depth: number, inCurrent: boolean): ShotEval {
  const W = PHOTO.weight;
  const size = Math.min(1, Math.max(0, (t.frac - 0.06) / (PHOTO.sizeFull - 0.06)));
  const clarity = Math.min(1, Math.max(0, 1 - t.dist / clear)) ** 0.7;
  const score = Math.round(100 * (W.size * size + W.side * t.side + W.centre * t.centred + W.clear * clarity));
  const grade = gradeOf(score);
  const bonus: string[] = [];
  let mult = grade.mult;
  if (t.danger) { mult *= PHOTO.dangerMult; bonus.push('危険手当 ×' + PHOTO.dangerMult); }
  if (inCurrent) { mult *= PHOTO.currentMult; bonus.push('激流手当 ×' + PHOTO.currentMult); }
  const deep = 1 + depth / PHOTO.depthPerBonus;
  if (depth >= 20) bonus.push(`深度手当 ×${deep.toFixed(1)}`);
  const value = Math.round((PHOTO.base[t.rt.def.rarity] * mult * deep) / 10) * 10;
  return { score, grade, value, bonus };
}

/** Gear bought with photo money (replaces automatic unlocks: the player chooses what to buy first). */
export const SHOP = [
  { id: 'fins', price: 6000, name: 'ロングフィン', desc: '泳ぐ速さ +30%', icon: '<path d="M7 3h4l1 8 4 8-3 2-5-7z"/>' },
  { id: 'tank', price: 15000, name: '大型タンク', desc: 'エア容量 1.5倍', icon: '<rect x="8" y="5" width="8" height="16" rx="3"/><rect x="10.5" y="2" width="3" height="3"/>' },
  { id: 'scooter', price: 40000, name: '水中スクーター', desc: '高速移動ボタン', icon: '<path d="M3 12l7-5v3h8l3 2-3 2h-8v3z"/>' },
  { id: 'ads', price: 90000, name: '大気圧潜水服', desc: '深海へ潜れる', icon: '<circle cx="12" cy="7" r="4"/><path d="M6 21v-6a6 6 0 0 1 12 0v6z"/>' },
] as const;
export type GearId = (typeof SHOP)[number]['id'];

/** Earlier saves unlocked gear by species count: keep what those players already had. */
export const LEGACY_NEED: Record<GearId, number> = { fins: 5, tank: 12, scooter: 22, ads: 35 };

export const yen = (n: number) => '¥' + Math.round(n).toLocaleString('ja-JP');
