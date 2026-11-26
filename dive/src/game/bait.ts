import type { SpeciesDef } from '../life/species';

/**
 * Bait (Phase 4): bought at the diner, scattered underwater to draw fish in.
 * Species data has no diet field, so the diet is inferred from the Japanese name
 * (word lists below) with a size/behaviour fallback. When Phase 12 adds species,
 * extend the word lists if a new name falls through to the wrong diet.
 */
export type BaitId = 'krill' | 'chunk' | 'weed';
export type Diet = 'plankton' | 'meat' | 'weed';

export const BAIT = {
  /** seconds a scattered cloud stays in the water */
  life: 40,
  /** uses per purchase */
  pack: 3,
  kinds: [
    { id: 'krill' as BaitId, name: 'オキアミ', price: 300, diet: 'plankton' as Diet, color: '#f0a080', desc: 'プランクトンを食べる小魚が寄る' },
    { id: 'chunk' as BaitId, name: '魚の切り身', price: 500, diet: 'meat' as Diet, color: '#e8d0c0', desc: '肉食の魚が寄る' },
    { id: 'weed' as BaitId, name: '海藻だんご', price: 300, diet: 'weed' as Diet, color: '#7aa050', desc: '海藻を食べる魚が寄る' },
  ],
};

/**
 * Name fragments -> diet. The LONGEST matching fragment wins (ties: list order), so specific names beat general ones:
 * カワハギ (meat) beats ハギ (weed), コショウダイ / カスミアジ / ギンガメアジ (meat) beat アジ (plankton).
 */
const DIET_WORDS: [Diet, string[]][] = [
  ['weed', ['ハギ', 'ブダイ', 'アイゴ', 'メジナ', 'ニザダイ', 'イスズミ', 'ハコフグ', 'オヤビッチャ']],
  ['plankton', ['スズメダイ', 'ハナダイ', 'ハナゴイ', 'キンギョハナダイ', 'タカサゴ', 'イワシ', 'アジ']],
  ['meat', ['ハタ', 'フエダイ', 'ベラ', 'カサゴ', 'メバル', 'ソイ', 'タイ', 'イサキ', 'フグ', 'カワハギ', 'モンガラ', 'カマス', 'コショウダイ', 'カスミアジ', 'ギンガメアジ']],
];

/**
 * タイ in the design's table never matches names spelled ダイ, so the sea breams are listed by their exact name (F1).
 * Exact, not substring: 'マダイ' would also hit トノサマダイ (a butterflyfish).
 */
const MEAT_EXACT = ['マダイ', 'クロダイ', 'ヘダイ', 'イシダイ', 'イシガキダイ'];

/** Names containing 'ハゼ' are not judged by the word lists (ハタタテハゼ is a tiny goby, not a ハタ): size / behaviour decides. */
const NO_WORDS = ['ハゼ'];

/** ハタタテダイ (butterflyfish) must not hit the grouper word 'ハタ' (F4); its other words / the fallback decide. */
const NOT_GROUPER = 'ハタタテ';

export function dietOf(def: SpeciesDef): Diet | null {
  if (!NO_WORDS.some((w) => def.name.includes(w))) {
    let best: Diet | null = null;
    let len = 0;
    for (const [diet, words] of DIET_WORDS) {
      for (const w of words) {
        if (w === 'ハタ' && def.name.includes(NOT_GROUPER)) continue;
        if (w.length > len && def.name.includes(w)) { best = diet; len = w.length; }
      }
    }
    if (best) return best;
  }
  if (MEAT_EXACT.includes(def.name)) return 'meat';
  // fallback (PHASE4-DESIGN §9 governs, decision AV): a school under 15 cm is plankton, 15 cm-2.5 m is meat, schools included
  if (def.behavior === 'school' && def.size < 0.15) return 'plankton';
  if (def.size >= 0.15 && def.size <= 2.5) return 'meat';
  return null;
}

/** Does this species come to this bait? (The caller also checks it may be lured at all.) */
export function eatsBait(def: SpeciesDef, id: BaitId): boolean {
  const k = BAIT.kinds.find((x) => x.id === id);
  return !!k && dietOf(def) === k.diet;
}
