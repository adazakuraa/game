import { buildCrustacean } from './models';
import type { SpeciesDef } from './species';
import { b, fx, nf } from './species11';

/**
 * Phase 9: estuary and river species (PHASE9-DESIGN §4). S4 = the estuary (16 new + 2 moved from the lagoon in species.ts `MAP_MOVES`).
 * Every species names its region (a `Homes` list from flora.ts) explicitly: the estuary's rectangle is mostly land.
 * Names are matched exactly by the diet / protection tables (bait.ts `DIET_EXACT`, fishing.ts `PROTECTED_EXACT`), never by substring.
 */

const akame = fx('akame', 'アカメ', 'Lates japonicus', 'estuary', [3, 9], 1.0, 3, b('snapper', { H: 0.27, nose: 0.55, eyes: 0.15 }), 'under', 3,
  { c: ['#68707a', '#a8b0b6', '#dfe3e4'], mid: 0.45, fin: '#5c646e', iris: '#e8281c' },
  'この河口のヌシ。赤く光る目で流木の陰から獲物をうかがう、高知の「幻の魚」。大きな口で魚を丸のみにする。',
  { region: 'estChannel', g: 3, metal: 0.4, behavior: 'solo', speed: 0.22 });
akame.mat = { ...akame.mat, emissive: 0xff2418 }; // eyes only (creatures.ts uEyeGlow)
akame.hint = '河口の奥。流木の山の陰にいる。夜のほうが見つけやすい。';

const maanago = fx('maanago', 'アナゴ', 'Conger myriaster', 'estuary', [2, 8], 0.6, 2,
  b('rattail', { H: 0.09, W: 0.08, tail: 'none', dorsal: [{ a: 0, b: 0.82, h: 0.03, sweep: 0 }], anal: [{ a: 0, b: 0.5, h: 0.02 }], pect: undefined, eyes: 0.2, eyeT: 0.93, segs: 30, rings: 8, peak: 0.6, nose: 0.6 }),
  'burrow', 10,
  { c: ['#7a6a58', '#9a8a76', '#e8e0d0'], fin: '#7a6a58', spots: [[40, 0.004, 0.007, 'rgba(250,246,236,0.85)']] },
  '昼は泥の中にもぐり、夜になると出てきて小魚やエビを食べる。白い点の列が側線に並ぶ。江戸前の天ぷらや寿司の定番。',
  { region: 'estFlat', g: 4, swim: [0.8, 0.015, 8] });
maanago.when = 'night';

export const ESTUARY_RIVER_SPECIES: SpeciesDef[] = [
  akame,
  fx('mahaze', 'マハゼ', 'Acanthogobius flavimanus', 'estuary', [1, 5], 0.18, 1, b('goby', {}), 'sandForage', 30,
    { c: ['#a8946a', '#c0ac80', '#e6dcc0'], fin: '#a8946a', blotch: [16, ['rgba(70,54,34,0.55)']] },
    '河口の砂泥の底にすむ、釣りの人気者。秋に「デキハゼ」と呼ばれる大きさになる。底の砂をはねあげてエサを探す。',
    { region: 'estFlat', g: 8, behavior: 'bottom' }),
  fx('tobihaze', 'トビハゼ', 'Periophthalmus modestus', 'estuary', [0.9, 1.5], 0.09, 1, b('goby', { eyeT: 0.94, eyes: 0.22 }), 'perch', 24,
    { c: ['#8a8068', '#a69c82', '#cfc7aa'], fin: '#8a8068', spots: [[26, 0.004, 0.008, 'rgba(40,36,28,0.55)']] },
    '干潟の水際の泥にとまり、胸びれで跳ねて歩く。目は頭の上についていて、水から出ても平気。',
    { region: 'estFlat', g: 6 }),
  fx('teppouuo', 'テッポウウオ', 'Toxotes jaculatrix', 'estuary', [0.3, 1.5], 0.2, 2, b('bream', { H: 0.5, W: 0.1 }), 'surface', 12,
    { c: ['#c8ccc0', '#e0e2d8', '#f4f4ec'], fin: '#a0a498', bars: [[0.28, 0.05, '#1a1a1a'], [0.1, 0.05, '#1a1a1a'], [-0.08, 0.05, '#1a1a1a'], [-0.26, 0.05, '#1a1a1a']] },
    '口から水鉄砲を撃って、水面の上の虫を落として食べる。マングローブの枝の下で水面を見上げている。',
    { region: 'mangrove', g: 3, metal: 0.4 }),
  fx('gomafuedai', 'ゴマフエダイ', 'Lutjanus argentimaculatus', 'estuary', [1, 4], 0.5, 2, b('snapper', {}), 'under', 16,
    { c: ['#8a4a38', '#b06a4e', '#d8a88c'], fin: '#8a4a38' },
    '若い個体がマングローブの根のあいだに入り込んで育つ。赤褐色の体で、成長すると沖の岩礁へ移る。',
    { region: 'mangrove', g: 3, behavior: 'school', metal: 0.2 }),
  fx('minamikurodai', 'ミナミクロダイ', 'Acanthopagrus sivicolus', 'estuary', [1, 7], 0.35, 1, b('bream', {}), 'reefRoam', 24,
    { c: ['#3e4448', '#6a7074', '#b8bcbc'], fin: '#3a4044' },
    '黒っぽい体で、河口の澪筋を群れで行き来する。岩礁のクロダイに似ているが、南の島の汽水域にすむ別の種。',
    { region: 'estChannel', g: 5, metal: 0.35 }),
  fx('shimaisaki', 'シマイサキ', 'Rhynchopelates oxyrhynchus', 'estuary', [1, 5], 0.25, 1, b('snapper', { H: 0.3 }), 'sandForage', 20,
    { c: ['#e8e6da', '#f0eee4', '#fbfaf4'], fin: '#c8c4b4', bars: [[0.28, 0.05, '#1c1c1c'], [0.08, 0.05, '#1c1c1c'], [-0.12, 0.05, '#1c1c1c'], [-0.3, 0.05, '#1c1c1c']] },
    '白地に4本の黒い縦じまがある。浮き袋で「グーグー」と鳴くので、釣り人には「ふえふき」とも呼ばれる。',
    { region: 'estFlat', g: 4 }),
  fx('hiiragi', 'ヒイラギ', 'Nuchequula nuchalis', 'estuary', [2, 8], 0.1, 1, b('batfish', { H: 0.5 }), 'sandForage', 40,
    { c: ['#aab4b8', '#d4dadc', '#f2f4f4'], fin: '#b0bcc0', lines: { n: 5, color: 'rgba(120,130,134,0.35)', ang: 0 } },
    '薄く平たい銀色の体で、底近くを群れる。口を管のように突き出して砂の中の小さな生き物を吸い出す。',
    { region: 'estChannel', g: 4, metal: 0.6 }),
  fx('sappa', 'サッパ', 'Sardinella zunasi', 'estuary', [1, 6], 0.15, 1, b('fusilier', { H: 0.2 }), 'midwater', 60,
    { c: ['#3e6a6a', '#b4c4c4', '#eef2f2'], mid: 0.45, fin: '#7a9696' },
    '背が青緑の小さなイワシの仲間。河口の中層を大群で泳ぐ。大きな魚に追われると、銀の群れがいっせいに向きを変える。',
    { region: 'estChannel', g: 4, metal: 0.55 }),
  fx('konoshiro', 'コノシロ', 'Konosirus punctatus', 'estuary', [1, 8], 0.25, 1, b('fusilier', { H: 0.26 }), 'midwater', 50,
    { c: ['#506878', '#c4ccd0', '#f2f4f4'], mid: 0.45, fin: '#8498a4', spots: [[1, 0.014, 0.014, 'rgba(20,24,30,0.8)', [0.1, 0.2, 0.1, 0.2]]] },
    '肩に黒い点があり、背びれの先が糸のように伸びる。成長すると名前が変わる出世魚で、河口の中層を群れて泳ぐ。',
    { region: 'estChannel', g: 3, metal: 0.55 }),
  maanago,
  fx('himetsubameuo', 'ヒメツバメウオ', 'Monodactylus argenteus', 'estuary', [0.5, 3], 0.15, 2, b('batfish', { H: 0.62 }), 'under', 24,
    { c: ['#bcc4c4', '#dce0e0', '#f4f6f6'], fin: '#e8c83a', tail: '#d8d8c0' },
    '銀色の円盤のような体で、背びれとしりびれの先が黄色い。汽水の入り江のマングローブの根のあいだに群れる。',
    { region: 'mangrove', g: 3, behavior: 'school', metal: 0.6 }),
  nf('crab', 'nokogirigazami', 'ノコギリガザミ', 'Scylla serrata', 'estuary', [1, 4], 0.2, 2, {}, ['#3e4a30', '#6a7a4a', 30, null], 8, 4,
    'マングローブの泥底に穴を掘ってすむ大きなカニ。はさみの力が強く、貝の殻も砕く。沖縄では「ガサミ」と呼ばれる高級食材。',
    { region: 'mangrove' }),
  nf('crab', 'shiomaneki', 'シオマネキ', 'Tubuca arcuata', 'estuary', [0.9, 1.3], 0.04, 1, {}, ['#8a6a48', '#e07a3a', 18, null], 30, 6,
    '雄は片方のはさみだけが大きく、赤橙色。干潟の水際で、大きなはさみを振って雌を招く。',
    { region: 'estFlat', kind: 'inv', behavior: 'static', speed: 0, build: () => buildCrustacean({ fiddler: true }) }),
  nf('clam', 'yamatoshijimi', 'ヤマトシジミ', 'Corbicula japonica', 'estuary', [1, 4], 0.03, 1, { mantle: false }, ['#2a2218', '#7a6a4c', 24, null], 40, 8,
    '黒褐色で光沢のある二枚貝。汽水の砂泥に半分もぐり、水をこして餌を食べる。みそ汁の「しじみ」。',
    { region: 'estFlat' }),
  nf('clam', 'magaki', 'マガキ', 'Magallana gigas', 'estuary', [0.5, 3], 0.1, 1, { mantle: false }, ['#9a9688', '#d0ccbc', 40, null], 30, 6,
    'マングローブの根や流木にびっしりと付く、灰白色のごつごつした二枚貝。海水をこして育つ。',
    { region: 'mangrove' }),
];
