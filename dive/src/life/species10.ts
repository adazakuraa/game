import { buildCrustacean, buildStar, buildUrchin } from './models';
import type { Paint } from './paint';
import { paintLook } from './paint';
import type { Region, SpeciesDef } from './species';
import { F, sh } from './species2';

/** Giant-kelp forest (海藻の森): modelled on the kelp forests off California. */

const KF: Region = [236, 422, 50, 390];

const dots = (p: Paint, n: number, r0: number, r1: number, col: string) => {
  p.g.fillStyle = col;
  for (let i = 0; i < n; i++) {
    p.g.beginPath();
    p.g.arc(p.rnd() * p.W, p.rnd() * p.H, r0 + p.rnd() * (r1 - r0), 0, Math.PI * 2);
    p.g.fill();
  }
};

export const KELP_SPECIES: SpeciesDef[] = [
  // ------------------------------------------------------------ fish
  F({ id: 'garibaldi', name: 'ガリバルディ', sci: 'Hypsypops rubicundus', zone: 'kelp', d: [2, 25], size: 0.3, body: sh('damsel', { H: 0.46 }), hab: 'rockyRoam', region: KF, n: 12, g: 6,
    look: { c: ['#f07010', '#f88418', '#fa9a30'], fin: '#f07a14', iris: '#222' }, desc: '全身あざやかなオレンジ色のスズメダイの仲間。ケルプの森の岩場に縄張りをもち、侵入者に向かってくる。' }),
  F({ id: 'sheephead', name: 'カリフォルニアシープヘッド', sci: 'Semicossyphus pulcher', zone: 'kelp', d: [3, 40], size: 0.7, r: 2, body: sh('bigwrasse', { H: 0.32 }), hab: 'rockyRoam', region: KF, n: 4, g: 2,
    look: { c: ['#1a1a1c', '#d0384a', '#1c1c1e'], mid: 0.5, fin: '#1a1a1c', front: [0.28, '#1a1a1c'], rear: [-0.22, '#1a1a1c'], snout: '#f0f0ea' }, desc: '雄は黒い頭と尾に赤い胴、白いあご。ウニを噛み砕いて食べ、ケルプの森を磯焼けから守る立役者。' }),
  F({ id: 'kelpbass', name: 'ケルプバス', sci: 'Paralabrax clathratus', zone: 'kelp', d: [2, 40], size: 0.5, body: sh('grouper', { H: 0.28 }), hab: 'midwater', region: KF, n: 10, g: 3,
    look: { c: ['#4a4a2e', '#6a6a48', '#c8c4a0'], fin: '#5a5a38', blotch: [26, ['rgba(220,210,170,0.45)', 'rgba(40,40,24,0.4)']] }, desc: 'ケルプの葉の間に浮かんで小魚を待ち伏せするハタの仲間。体の斑模様がケルプの木漏れ日に溶け込む。' }),
  F({ id: 'giantkelpfish', name: 'ジャイアントケルプフィッシュ', sci: 'Heterostichus rostratus', zone: 'kelp', d: [2, 20], size: 0.4, r: 2, body: sh('blenny', { H: 0.14 }), hab: 'perch', region: 'kelpSpots', n: 4, g: 4, pitch: -1.3,
    look: { c: ['#7a6a20', '#a08e32', '#c8b860'], fin: '#8a7a28', hl: [[0.1, 0.04, 'rgba(240,230,150,0.6)']] }, desc: '細長い体をケルプと同じ色に変え、葉に沿って頭を上にして立ち、ケルプそのものになりきる。' }),
  F({ id: 'blacksmith', name: 'ブラックスミス', sci: 'Chromis punctipinnis', zone: 'kelp', d: [2, 40], size: 0.2, body: sh('damsel'), hab: 'midwater', region: KF, n: 80, g: 5,
    look: { c: ['#2a3a4a', '#3a4c5c', '#6a7a88'], fin: '#2a3a4a', spots: [[16, 0.01, 0.02, '#141a20', [-0.5, 0.1, -0.1, 0.4]]] }, desc: 'ケルプの森の中層に大群で漂う青黒いスズメダイ。森の「天井」の下をきらきらと埋め尽くす。' }),
  F({ id: 'opaleye', name: 'オパールアイ', sci: 'Girella nigricans', zone: 'kelp', d: [1, 20], size: 0.4, body: sh('bream', { H: 0.4 }), hab: 'rockyRoam', region: KF, n: 16, g: 3,
    look: { c: ['#2e4a3a', '#3e5a48', '#6a8270'], fin: '#2e4a3a', ocel: [[0.05, 0.42, 4, '#e8e8e0']], iris: '#4a90d0' }, desc: '宝石のような青い目をもつメジナの仲間。ケルプや海藻をついばみ、群れで岩場を回る。' }),
  F({ id: 'leopardshark', name: 'ヒョウモンザメ', sci: 'Triakis semifasciata', zone: 'kelp', d: [2, 20], size: 1.4, r: 2, body: sh('shark', { H: 0.14 }), hab: 'sandForage', region: KF, n: 3, g: 1, speed: 0.6,
    look: { c: ['#8a8070', '#a89c88', '#e8e2d4'], fin: '#8a8070', saddle: [[0.3, 0.05, '#2a241e'], [0.12, 0.05, '#2a241e'], [-0.06, 0.05, '#2a241e'], [-0.24, 0.05, '#2a241e']], spots: [[30, 0.01, 0.025, 'rgba(40,34,28,0.7)']] }, desc: '背中に鞍のような黒い模様と斑点が並ぶおとなしいサメ。砂の上をすべるように泳いで貝やカニを探す。' }),
  F({ id: 'giantseabass', name: 'ジャイアントシーバス', sci: 'Stereolepis gigas', zone: 'kelp', d: [10, 40], size: 2.0, r: 3, body: sh('grouper', { H: 0.3 }), hab: 'rockyRoam', region: KF, n: 1, g: 1, speed: 0.3,
    look: { c: ['#2a2a2c', '#3a3a3c', '#5a5a5c'], fin: '#2a2a2c', spots: [[30, 0.03, 0.06, 'rgba(10,10,12,0.6)']] }, desc: '体重200kgを超える巨大魚。乱獲で数を減らしたが、保護されて森に戻りつつある。好奇心が強く、ゆっくり近づいてくる。' }),
  F({ id: 'pacificseahorse', name: 'ヒポカンパス・インゲンス', sci: 'Hippocampus ingens', zone: 'kelp', d: [2, 20], size: 0.2, r: 3, body: sh('cornet', { H: 0.16, W: 0.12, tail: 'none', nose: 0.6, eyes: 0.18 }), hab: 'perch', region: 'kelpSpots', n: 3, g: 3, pitch: -1.35,
    look: { c: ['#c8902a', '#d8a83a', '#e8c870'], fin: '#e0b050', bars: [[0.1, 0.03, 'rgba(120,70,20,0.4)'], [-0.1, 0.03, 'rgba(120,70,20,0.4)']] }, desc: '東太平洋で最大のタツノオトシゴ。尾をケルプに巻きつけて立ち、流れてくる小さなエビを吸い込む。' }),
  // ------------------------------------------------------------ mammal
  {
    id: 'calsealion', name: 'カリフォルニアアシカ', sci: 'Zalophus californianus', zone: 'kelp', depth: [0, 25], size: 2.0, rarity: 2,
    desc: '遊び好きで人なつこいアシカ。ケルプの森の中を宙返りしながら追いかけっこをする。', hint: '海藻の森。向こうから遊びに来る。', habLabel: 'ケルプの間を宙返りしながら泳ぐ',
    kind: 'fish', fish: { H: 0.22, W: 0.24, peak: 0.5, nose: 0.5, ped: 0.08, tail: 'flukes', tailL: 0.1, tailH: 0.22, pect: { t: 0.68, len: 0.2, wid: 0.08, down: 0.5, out: 0.7 }, eyes: 0.1, eyeT: 0.9, bendY: true },
    paint: (p) => paintLook(p, { c: ['#4a3624', '#5a4430', '#7a6448'], fin: '#3a2a1c', iris: '#111' }), tex: [512, 256],
    count: 3, groups: 1, behavior: 'solo', region: KF, speed: 2.2, flee: 0, curious: true, swim: [1.6, 0.06, 2], photoRange: 22,
  },
  // ------------------------------------------------------------ invertebrates
  {
    id: 'purpleurchin', name: 'パープルウニ', sci: 'Strongylocentrotus purpuratus', zone: 'kelp', depth: [1, 30], size: 0.08, rarity: 1,
    desc: '紫色のウニ。天敵のラッコやシープヘッドが減ると大発生し、ケルプの森を丸ごと食べ尽くしてしまう。', hint: '海藻の森の岩の上。',
    habLabel: '岩の上でケルプの根元をかじる',
    kind: 'inv', build: () => buildUrchin({ spine: 0.6, n: 90, thin: 0.03 }), tex: [64, 128],
    paint: (p) => { p.fill('#6a2a8a'); dots(p, 30, 1, 2, '#8a4aa8'); },
    count: 40, groups: 10, behavior: 'static', region: KF, speed: 0, flee: 0, photoRange: 4,
  },
  {
    id: 'batstar', name: 'バットスター', sci: 'Patiria miniata', zone: 'kelp', depth: [1, 30], size: 0.16, rarity: 1,
    desc: '腕の短いヒトデで、赤・橙・紫・黄と色の個体差がとても大きい。何でも食べる森の掃除屋。', hint: '海藻の森の岩や砂の上。',
    habLabel: '岩の上をゆっくり這う',
    kind: 'inv', build: () => buildStar({ arms: 5, arm: 0.18, core: 0.24, thick: 0.08, sharp: 1.0 }), tex: [128, 128],
    paint: (p) => { p.fill('#ffffff'); dots(p, 120, 0.5, 1.2, 'rgba(0,0,0,0.15)'); },
    instColors: ['#d84020', '#f08a20', '#8a3aa0', '#e8c020', '#d86080'],
    count: 20, groups: 10, behavior: 'static', region: KF, speed: 0, flee: 0, photoRange: 5,
  },
  {
    id: 'calspinylobster', name: 'カリフォルニアイセエビ', sci: 'Panulirus interruptus', zone: 'kelp', depth: [2, 40], size: 0.4, rarity: 2,
    desc: 'はさみのない大きなイセエビの仲間。昼は岩の割れ目に隠れ、長い触角だけをのぞかせている。', hint: '海藻の森の岩の割れ目。',
    habLabel: '岩の割れ目に隠れる',
    kind: 'lobster', tex: [128, 256],
    paint: (p) => { p.fill('#a83a24'); dots(p, 60, 1, 2.4, '#d8784a'); },
    count: 4, groups: 4, behavior: 'static', region: KF, speed: 0, flee: 1.5, photoRange: 6,
  },
  {
    id: 'kelpcrab', name: 'ケルプクラブ', sci: 'Pugettia producta', zone: 'kelp', depth: [1, 20], size: 0.1, rarity: 1,
    desc: 'ケルプと同じオリーブ色のカニ。ケルプの茎や葉にしがみついて、葉そのものを食べる。', hint: '海藻の森の海底や岩の上。',
    habLabel: 'ケルプにしがみつく',
    kind: 'isopod', tex: [128, 256],
    paint: (p) => { p.fill('#7a6a28'); dots(p, 60, 0.8, 1.6, 'rgba(60,50,20,0.5)'); },
    count: 10, groups: 5, behavior: 'bottom', region: KF, speed: 0.05, flee: 0, spread: 2, photoRange: 4,
  },
  {
    id: 'kelpshrimp', name: 'ケルプシュリンプ', sci: 'Heptacarpus sp.', zone: 'kelp', depth: [1, 20], size: 0.04, rarity: 2,
    desc: '透きとおった小さなエビ。ケルプの葉の上で体の色を葉に合わせて身を隠す。マクロレンズが欲しくなる被写体。', hint: '海藻の森のケルプの茎の途中。',
    habLabel: 'ケルプの茎に止まる',
    kind: 'inv', build: () => buildCrustacean({ shrimp: true }), tex: [64, 128],
    paint: (p) => { p.fill('rgba(200,180,110,0.85)'); },
    count: 10, groups: 5, behavior: 'static', region: 'kelpSpots', speed: 0, flee: 0, photoRange: 2.5, mat: { translucent: 0.75 },
  },
];
