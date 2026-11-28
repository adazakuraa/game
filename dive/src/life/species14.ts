import { buildOsedax } from '../world/whalefall';
import type { SpeciesDef } from './species';
import { b, fx } from './species11';

/**
 * 修正バッチ2 F9 (30)：鯨骨生物群集の新種 2（ホネクイハナムシ ★3・ヌタウナギ ★2）。
 * 追加前の照合（Phase 12 の手順）：図鑑のすべての id・和名・学名を「ホネクイ」「ヌタウナギ」「Osedax」「Eptatretus」「Myxine」
 * 「Myxini」「hagfish」で検索 → いずれも未登録（`life/swim.ts` の ANGUILLA の正規表現にヌタウナギの名前があるだけ）。
 * 別名：ホネクイハナムシ＝骨喰花虫（Osedax japonicus。標準和名はホネクイハナムシ）、ヌタウナギ＝Eptatretus burgeri。幼生・成体の区別は不要。
 */
export const WHALE_FALL_SPECIES: SpeciesDef[] = [
  {
    id: 'honekuihanamushi', name: 'ホネクイハナムシ', sci: 'Osedax japonicus', zone: 'deep', depth: [200, 430], size: 0.3, rarity: 3,
    desc: '沈んだクジラの骨に根を張って、骨の中の脂質を食べる赤い羽毛状のゴカイの仲間。口も消化管もなく、根にすむ共生細菌の力を借りる。目に見える赤い房は雌で、雄は雌の体の中にすむ極小の姿のまま一生を終える。',
    hint: '深海の鯨骨（クジラの骨）。骨のまわりに赤い毛のような房が揺れている。',
    habLabel: '鯨骨に根を張り、赤い羽毛状のえらを広げる',
    kind: 'inv', build: buildOsedax, tex: [64, 64],
    paint: (p) => { p.fill('#c8281c'); p.blotch(24, 2, 6, ['rgba(255,120,90,0.5)', 'rgba(110,10,10,0.4)']); },
    count: 24, groups: 8, behavior: 'static', region: 'whale', speed: 0, flee: 0, spread: 1, mat: { rough: 0.55, translucent: 0.7 }, photoRange: 6,
  },
  fx('nutaunagi', 'ヌタウナギ', 'Eptatretus burgeri', 'deep', [200, 430], 0.5, 2,
    b('rattail', { H: 0.08, W: 0.07, tail: 'none', dorsal: [{ a: 0, b: 0.8, h: 0.03, sweep: 0 }], anal: [{ a: 0, b: 0.5, h: 0.02 }], pect: undefined, eyes: 0.1, eyeT: 0.95, segs: 30, rings: 8, peak: 0.6, nose: 0.6 }),
    'sandForage', 5,
    { c: ['#8a7a86', '#a898a4', '#d0c4cc'], fin: '#8a7a86', spots: [[26, 0.004, 0.006, 'rgba(240,230,236,0.7)']] },
    'あごのない原始的な魚。目はほとんど退化し、触れるとぬるぬるの粘液を大量に出す。沈んだクジラの肉に頭を突っこんで食べる。',
    { region: 'whale', g: 5, behavior: 'bottom', speed: 0.12, flee: 0, swim: [0.8, 0.015, 8], photoRange: 7 }),
];
