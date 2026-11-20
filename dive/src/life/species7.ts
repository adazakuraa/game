import { buildCrustacean, buildStar, buildUrchin } from './models';
import type { Paint } from './paint';
import type { Region, SpeciesDef } from './species';
import { F, sh } from './species2';

/** Cold cove (流氷の入り江): northern kelp-and-boulder bay, water about 2 C. */
const COLD: Region = [-415, -232, -20, 320];

const dots = (p: Paint, n: number, r0: number, r1: number, col: string) => {
  p.g.fillStyle = col;
  for (let i = 0; i < n; i++) {
    p.g.beginPath();
    p.g.arc(p.rnd() * p.W, p.rnd() * p.H, r0 + p.rnd() * (r1 - r0), 0, Math.PI * 2);
    p.g.fill();
  }
};

export const COLD_SPECIES: SpeciesDef[] = [
  // ------------------------------------------------------------ fish
  F({ id: 'dangouo', name: 'ダンゴウオ', sci: 'Lethotremus awae', zone: 'cold', d: [2, 20], size: 0.03, r: 2, body: sh('puffer', { H: 0.8, W: 0.7 }), hab: 'perch', region: 'coldSpots', n: 6, g: 6,
    look: { c: ['#d0342a', '#e04a34', '#f07a5a'], fin: '#e8907a', iris: '#111', noise: 0.08 }, desc: '体長2〜3cmの丸い魚。腹の吸盤で海藻や岩に張りつく。赤や緑など色の個体差が大きい、冬の海のアイドル。' }),
  F({ id: 'fuusenuo', name: 'フウセンウオ', sci: 'Eumicrotremus pacificus', zone: 'cold', d: [5, 30], size: 0.08, r: 3, body: sh('puffer', { H: 0.85, W: 0.75 }), hab: 'perch', region: 'coldSpots', n: 3, g: 3,
    look: { c: ['#8a9a3a', '#a8b44a', '#d8d07a'], fin: '#a8a050', spots: [[30, 0.02, 0.05, '#5a6420']], iris: '#111' }, desc: '風船のように丸く、体中にイボがある。ダンゴウオの仲間で、吸盤で岩にくっついて暮らす。' }),
  F({ id: 'hoteiuo', name: 'ホテイウオ', sci: 'Aptocyclus ventricosus', zone: 'cold', d: [2, 40], size: 0.3, r: 2, body: sh('puffer', { H: 0.62, W: 0.55 }), hab: 'perch', region: 'coldSpots', n: 3, g: 3,
    look: { c: ['#3a4a56', '#54646e', '#8a9aa2'], fin: '#4a5a64', iris: '#1a1a1a', noise: 0.06 }, desc: '「ゴッコ」とも呼ばれる、ぶよぶよした丸い魚。冬に浅瀬へ来て卵を産み、雄が卵を守る。' }),
  F({ id: 'ookamiuo', name: 'オオカミウオ', sci: 'Anarhichas orientalis', zone: 'cold', d: [5, 40], size: 1.0, r: 3, body: sh('blenny', { H: 0.17 }), hab: 'perch', region: 'coldSpots', n: 2, g: 2,
    look: { c: ['#4a4038', '#5e544a', '#7a6e62'], fin: '#4a4038', blotch: [26, ['rgba(30,24,20,0.55)', 'rgba(120,108,94,0.35)']], iris: '#c8b070' }, desc: '大きな頭と鋭い歯で、ウニや貝を殻ごと噛み砕く。いかつい顔に似合わず、岩穴でじっとしている。' }),
  F({ id: 'kemushikajika', name: 'ケムシカジカ', sci: 'Hemitripterus villosus', zone: 'cold', d: [3, 40], size: 0.35, r: 2, body: sh('scorp'), hab: 'perch', region: 'coldSpots', n: 4, g: 4,
    look: { c: ['#8a5a34', '#a4703e', '#c8a070'], fin: '#946036', blotch: [30, ['rgba(60,30,14,0.5)', 'rgba(200,150,90,0.3)']] }, desc: '体中にトゲやヒゲのような突起がある大型のカジカ。岩や海藻に紛れて獲物を待つ。' }),
  F({ id: 'gisukajika', name: 'ギスカジカ', sci: 'Myoxocephalus stelleri', zone: 'cold', d: [1, 25], size: 0.3, body: sh('scorp', { H: 0.24 }), hab: 'perch', region: 'coldSpots', n: 8, g: 8,
    look: { c: ['#5a5a3a', '#6e6e48', '#c8c4a0'], fin: '#6a6a40', bars: [[0.2, 0.08, 'rgba(40,40,20,0.5)'], [-0.1, 0.08, 'rgba(40,40,20,0.5)']] }, desc: '北の磯でよく見るカジカ。大きな口で甲殻類や小魚を丸のみにする。' }),
  F({ id: 'hokke', name: 'ホッケ', sci: 'Pleurogrammus azonus', zone: 'cold', d: [3, 60], size: 0.35, body: sh('mullet', { H: 0.2 }), hab: 'midwater', region: COLD, n: 30, g: 3,
    look: { c: ['#3a5a4a', '#6a8a6e', '#d8dcc8'], mid: 0.45, fin: '#4a6a56', bars: [[0.3, 0.05, 'rgba(30,50,40,0.4)'], [0.1, 0.05, 'rgba(30,50,40,0.4)'], [-0.1, 0.05, 'rgba(30,50,40,0.4)']] }, desc: '北の海の代表的な魚。群れで中層を泳ぎ、繁殖期の雄は鮮やかな婚姻色になる。' }),
  F({ id: 'nishin', name: 'ニシン', sci: 'Clupea pallasii', zone: 'cold', d: [1, 40], size: 0.28, body: sh('fusilier', { H: 0.2 }), hab: 'midwater', region: COLD, n: 60, g: 3, metal: 0.6,
    look: { c: ['#2a4a6a', '#9ab0c0', '#eef2f4'], mid: 0.4, fin: '#8aa0b0' }, desc: '銀色に輝く群れで回遊する。春に大群で沿岸へ押し寄せ、海が白く濁るほど産卵する。' }),
  F({ id: 'kurosoi', name: 'クロソイ', sci: 'Sebastes schlegelii', zone: 'cold', d: [3, 50], size: 0.4, body: sh('grouper', { H: 0.32 }), hab: 'rockyRoam', region: COLD, n: 8, g: 3,
    look: { c: ['#2e3236', '#44484c', '#7a7e80'], fin: '#2e3236', iris: '#b09060' }, desc: '岩礁の暗がりを好む黒っぽいメバルの仲間。夜になると活発に小魚を追う。' }),
  F({ id: 'usumebaru', name: 'ウスメバル', sci: 'Sebastes thompsoni', zone: 'cold', d: [5, 60], size: 0.25, body: sh('snapper', { H: 0.32 }), hab: 'midwater', region: COLD, n: 30, g: 3,
    look: { c: ['#a86a3a', '#c88a5a', '#f0d0b0'], fin: '#b47a48', bars: [[0.15, 0.06, 'rgba(120,60,30,0.4)'], [-0.12, 0.06, 'rgba(120,60,30,0.4)']], iris: '#222' }, desc: '大きな目をした赤みのあるメバル。海藻の上の中層で、頭を少し上に向けて群れる。' }),
  F({ id: 'ainame', name: 'アイナメ', sci: 'Hexagrammos otakii', zone: 'cold', d: [1, 30], size: 0.4, body: sh('grouper', { H: 0.26 }), hab: 'sandForage', region: COLD, n: 8, g: 4,
    look: { c: ['#6a5034', '#8a6a46', '#c8b090'], fin: '#7a5a3a', blotch: [30, ['rgba(60,40,20,0.45)', 'rgba(180,150,110,0.3)']] }, desc: '岩礁の海底近くを縄張りにする。産卵期の雄は黄色く色づき、卵を守る。' }),
  F({ id: 'madara', name: 'マダラ', sci: 'Gadus macrocephalus', zone: 'cold', d: [10, 80], size: 0.8, r: 2, body: sh('grouper', { H: 0.24 }), hab: 'rockyRoam', region: COLD, n: 3, g: 2,
    look: { c: ['#5a5440', '#7a7258', '#d8d4c4'], fin: '#6a6448', spots: [[60, 0.01, 0.025, 'rgba(60,54,36,0.6)']] }, desc: '大きな頭と下あごの1本のヒゲが目印。冬に深場から浅場へ産卵に来る。' }),
  // ------------------------------------------------------------ invertebrates
  {
    id: 'clione', name: 'クリオネ', sci: 'Clione limacina', zone: 'cold', depth: [0, 30], size: 0.03, rarity: 2,
    desc: '「流氷の天使」と呼ばれる殻のない巻貝の仲間。翼のような足をはばたかせて泳ぐ。', hint: '流氷の入り江の中層。小さく透明なので近くでよく見て。',
    habLabel: '翼足をはばたかせて中層を漂う',
    kind: 'jelly', jelly: { tentacles: 2, tentLen: 0.02, flat: 1.6 }, tex: [64, 64],
    paint: (p) => { p.fill('rgba(230,240,250,0.85)'); p.g.fillStyle = 'rgba(240,120,60,0.95)'; p.g.beginPath(); p.g.arc(p.W / 2, p.H / 2, p.W * 0.18, 0, Math.PI * 2); p.g.fill(); },
    count: 30, groups: 5, behavior: 'drift', region: COLD, speed: 0.08, flee: 0, pulse: [3.2, 0.2], swim: [1, 0.05, 2], spread: 3, mat: { translucent: 0.55, rough: 0.2 }, photoRange: 2.5,
  },
  {
    id: 'mizudako', name: 'ミズダコ', sci: 'Enteroctopus dofleini', zone: 'cold', depth: [3, 60], size: 1.5, rarity: 3,
    desc: '腕を広げると3mにもなる世界最大級のタコ。冷たい海の岩穴にひそみ、カニや貝を食べる。', hint: '流氷の入り江の大きな岩の上や陰。',
    habLabel: '大きな岩の上や陰でじっとしている',
    kind: 'octopus', tex: [256, 256],
    paint: (p) => { p.fill('#9a4a30'); p.blotch(140, 3, 10, ['rgba(180,90,60,0.6)', 'rgba(80,30,20,0.5)', 'rgba(220,160,130,0.35)']); },
    count: 2, groups: 2, behavior: 'static', region: 'coldSpots', speed: 0, flee: 2, swim: [0.6, 0.05, 1], photoRange: 12,
  },
  {
    id: 'kitamurasakiuni', name: 'キタムラサキウニ', sci: 'Mesocentrotus nudus', zone: 'cold', depth: [1, 30], size: 0.09, rarity: 1,
    desc: '北の海に多い紫黒色のウニ。増えすぎると海藻を食べ尽くし「磯焼け」を起こす。', hint: '流氷の入り江の岩の上。',
    habLabel: '岩の上にびっしり並び、海藻を食べる',
    kind: 'inv', build: () => buildUrchin({ spine: 0.6, n: 90, thin: 0.03 }), tex: [64, 128],
    paint: (p) => { p.fill('#2a1a2e'); dots(p, 40, 1, 2, '#4a2a50'); },
    count: 40, groups: 10, behavior: 'static', region: 'coldSpots', speed: 0, flee: 0, photoRange: 4,
  },
  {
    id: 'kihitode', name: 'キヒトデ', sci: 'Asterias amurensis', zone: 'cold', depth: [1, 40], size: 0.22, rarity: 1,
    desc: '黄色に紫の斑が入る5本腕のヒトデ。貝を腕でこじ開けて食べる、冷たい海の大食漢。', hint: '流氷の入り江の岩や砂の上。',
    habLabel: '岩や砂の上をゆっくり這う',
    kind: 'inv', build: () => buildStar({ arms: 5, arm: 0.42, core: 0.1, thick: 0.06, sharp: 0.8, spines: 40 }), tex: [128, 128],
    paint: (p) => { p.fill('#e0a830'); dots(p, 70, 1.5, 3.5, '#7a3a8a'); },
    count: 16, groups: 8, behavior: 'static', region: 'coldSpots', speed: 0, flee: 0, photoRange: 6,
  },
  {
    id: 'tarabagani', name: 'タラバガニ', sci: 'Paralithodes camtschaticus', zone: 'cold', depth: [5, 60], size: 0.8, rarity: 3,
    desc: '脚を広げると1mを超える大型のヤドカリの仲間。トゲだらけの甲羅で海底をゆっくり歩く。', hint: '流氷の入り江の深めの海底。',
    habLabel: '海底をゆっくり歩き回る',
    kind: 'isopod', tex: [128, 256],
    paint: (p) => { p.fill('#a83a24'); dots(p, 160, 1, 2.6, '#d86a40'); },
    count: 3, groups: 3, behavior: 'bottom', region: COLD, speed: 0.06, flee: 0, spread: 2, photoRange: 10,
  },
  {
    id: 'botanebi', name: 'トヤマエビ', sci: 'Pandalus hypsinotus', zone: 'cold', depth: [5, 60], size: 0.12, rarity: 2,
    desc: '「ボタンエビ」の名で知られる赤い大型のエビ。冷たい岩場の陰で群れている。', hint: '流氷の入り江の岩の陰。',
    habLabel: '岩の陰に集まっている',
    kind: 'inv', build: () => buildCrustacean({ shrimp: true }), tex: [64, 128],
    paint: (p) => { p.fill('#e06a4a'); dots(p, 40, 1, 2.2, '#f8e0d0'); },
    count: 12, groups: 4, behavior: 'static', region: 'coldSpots', speed: 0, flee: 1.2, photoRange: 4,
  },
];
