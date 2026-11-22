import { buildAmmonite, buildCrustacean } from './models';
import type { Paint } from './paint';
import type { Region, SpeciesDef } from './species';
import { F, sh } from './species2';

/** Animals of the western sites (ruins, blue hole, cave) and of night dives. */

const RUINS_R: Region = [-400, -262, 430, 598];
const HOLE: Region = [-352, -308, 668, 712];
const RIM: Region = [-372, -288, 650, 730];

const dots = (p: Paint, n: number, r0: number, r1: number, col: string) => {
  p.g.fillStyle = col;
  for (let i = 0; i < n; i++) {
    p.g.beginPath();
    p.g.arc(p.rnd() * p.W, p.rnd() * p.H, r0 + p.rnd() * (r1 - r0), 0, Math.PI * 2);
    p.g.fill();
  }
};
const night = (d: SpeciesDef): SpeciesDef => ({ ...d, when: 'night', hint: `夜の海（ナイトダイブ）でしか会えない。${d.hint}` });

export const SITE_SPECIES: SpeciesDef[] = [
  // ============================================================ underwater cave
  F({ id: 'hikarikinme2', name: 'ヒカリキンメダイ', sci: 'Anomalops katoptron', zone: 'cave', d: [15, 30], size: 0.22, r: 2, body: sh('soldier'), hab: 'under', region: 'caveSpots', n: 24, g: 6, glow: 0x8af0ff,
    look: { c: ['#1a1a20', '#22222a', '#30303a'], fin: '#1a1a20', ocel: [[0.38, -0.05, 9, '#e8fbff']] }, desc: '目の下に発光バクテリアをすまわせた魚。光をまぶたのような膜で点滅させ、暗い洞窟の中で合図を送り合う。' }),
  F({ id: 'tsumagurohatanpo', name: 'ツマグロハタンポ', sci: 'Pempheris japonica', zone: 'cave', d: [10, 30], size: 0.15, body: sh('sweeper'), hab: 'under', region: 'caveSpots', n: 60, g: 8, metal: 0.4,
    look: { c: ['#a0703a', '#c08a4a', '#e8c890'], fin: '#a0703a', iris: '#111' }, desc: '洞窟や岩陰の暗がりに大群でひしめく。光が当たると一斉に向きを変えて奥へ逃げる。' }),
  {
    id: 'akashimashirahige', name: 'アカシマシラヒゲエビ', sci: 'Lysmata amboinensis', zone: 'cave', depth: [10, 30], size: 0.06, rarity: 1,
    desc: '赤と白の帯に長い白いヒゲ。洞窟の壁で客の魚を待ち、口の中まで入ってクリーニングする。', hint: '水中洞窟の壁や天井の近く。',
    habLabel: '洞窟の壁でクリーニングを営む',
    kind: 'inv', build: () => buildCrustacean({ shrimp: true }), tex: [64, 128],
    paint: (p) => { p.fill('#f4ecd8'); p.g.fillStyle = '#d8282a'; p.g.fillRect(0, 0, p.W * 0.35, p.H); p.g.fillRect(p.W * 0.65, 0, p.W * 0.35, p.H); p.g.fillStyle = '#ffffff'; p.g.fillRect(p.W * 0.47, 0, p.W * 0.06, p.H); },
    count: 18, groups: 9, behavior: 'static', region: 'caveSpots', speed: 0, flee: 0.8, photoRange: 3,
  },
  {
    id: 'mukadeebi', name: 'ムカデエビ', sci: 'Remipedia', zone: 'cave', depth: [18, 30], size: 0.04, rarity: 3,
    desc: '洞窟の奥の暗闇だけにすむ、目のない原始的な甲殻類。体の両側の多数の脚を漕いで泳ぐ。', hint: '水中洞窟のいちばん奥の大広間。ライトでよく探そう。',
    habLabel: '真っ暗な洞窟の奥を漂う',
    kind: 'isopod', tex: [64, 128],
    paint: (p) => { p.fill('rgba(240,236,224,0.95)'); p.g.fillStyle = 'rgba(200,190,170,0.6)'; for (let i = 0; i < 20; i++) p.g.fillRect(0, (i / 20) * p.H, p.W, 1); },
    count: 4, groups: 2, behavior: 'bottom', region: [-372, -346, 952, 976], speed: 0.04, flee: 0, spread: 2, photoRange: 2.5,
  },
  // ============================================================ blue hole
  {
    id: 'oumugai', name: 'オウムガイ', sci: 'Nautilus pompilius', zone: 'bluehole', depth: [35, 55], size: 0.2, rarity: 3,
    desc: '5億年前から姿をほとんど変えていない「生きている化石」。殻の中の部屋のガスで浮き沈みし、夜に浅場へ上がってくる。', hint: 'ブルーホールの深いところ。ゆっくり上下している。',
    habLabel: '縦穴の深みを浮き沈みする',
    kind: 'inv', build: buildAmmonite, tex: [128, 128],
    paint: (p) => { p.fill('#f2ece0'); for (let i = 0; i < 18; i++) { p.g.fillStyle = 'rgba(150,70,30,0.7)'; p.g.fillRect((i / 18) * p.W, 0, p.W / 40, p.H * (0.4 + (i % 3) * 0.15)); } },
    count: 3, groups: 2, behavior: 'drift', region: HOLE, speed: 0.12, flee: 0, swim: [0.8, 0.02, 2], spread: 6, photoRange: 5,
  },
  F({ id: 'oomejirozame', name: 'オオメジロザメ', sci: 'Carcharhinus leucas', zone: 'bluehole', d: [10, 50], size: 2.4, r: 3, body: sh('shark', { H: 0.24, nose: 0.85 }), hab: 'midwater', region: HOLE, n: 2, g: 1, speed: 0.9,
    aggro: { kind: 'shark', chance: 0.3, range: 14, bite: 15, speed: 3.4 },
    look: { c: ['#6a6e70', '#868a8c', '#e4e6e6'], mid: 0.55, fin: '#5a5e60' }, desc: 'ずんぐりした体の大型のサメ。川をさかのぼることもある適応力の持ち主。縦穴の中層を回り、ときに大胆に近づいてくる。' }),
  F({ id: 'kasurihata', name: 'カスリハタ', sci: 'Epinephelus tukula', zone: 'bluehole', d: [7, 40], size: 1.4, r: 2, body: sh('grouper'), hab: 'rockyRoam', region: RIM, n: 2, g: 1, speed: 0.4,
    look: { c: ['#6a6a5a', '#8a8a76', '#c8c4b0'], fin: '#5a5a4a', blotch: [30, ['rgba(40,40,30,0.6)', 'rgba(180,170,140,0.3)']] }, desc: '大きな黒い斑紋が並ぶ大型のハタ。好奇心が強く、穴の縁でダイバーに寄ってくることもある。' }),
  F({ id: 'himefuedai', name: 'ヒメフエダイ', sci: 'Lutjanus gibbus', zone: 'bluehole', d: [5, 40], size: 0.4, body: sh('snapper', { H: 0.4 }), hab: 'midwater', region: RIM, n: 50, g: 3,
    look: { c: ['#b03a3a', '#c85a4a', '#e8a090'], fin: '#8a2a2a', tail: '#4a1a1a' }, desc: '背中が盛り上がった赤いフエダイ。縦穴の縁に大きな群れをつくり、じっと流れに向かって浮かぶ。' }),
  // ============================================================ ruins / ship graveyard
  F({ id: 'kappore', name: 'カッポレ', sci: 'Caranx lugubris', zone: 'ruins', d: [10, 60], size: 0.8, r: 2, body: sh('jack', { nose: 0.7 }), hab: 'midwater', region: RUINS_R, n: 10, g: 1, speed: 1.8,
    look: { c: ['#2a2c30', '#3a3c40', '#5a5c60'], fin: '#1e2024' }, desc: '全身が黒っぽいアジの仲間。遺跡の石段の上を黒い群れでゆっくり回遊する。' }),
  F({ id: 'aochibiki', name: 'アオチビキ', sci: 'Aprion virescens', zone: 'ruins', d: [5, 40], size: 0.9, r: 2, body: sh('snapper', { H: 0.22 }), hab: 'midwater', region: RUINS_R, n: 3, g: 1, speed: 1.4,
    look: { c: ['#3a5a6a', '#5a7a88', '#c0d0d6'], fin: '#3a5a6a' }, desc: '細長い体のフエダイの仲間。遺跡の石段の上を悠々と見回り、近づくとこちらを品定めする。' }),
  F({ id: 'tengudai', name: 'テングダイ', sci: 'Evistias acutirostris', zone: 'ruins', d: [10, 50], size: 0.5, r: 2, body: sh('bream', { H: 0.5, dorsal: [{ a: 0.35, b: 0.72, h: 0.3 }] }), hab: 'rockyRoam', region: RUINS_R, n: 4, g: 2, speed: 0.4,
    look: { c: ['#e8d8a0', '#f0e4b8', '#f6f0dc'], fin: '#f0c020', bars: [[0.3, 0.07, '#2a2a2a'], [0.08, 0.07, '#2a2a2a'], [-0.14, 0.07, '#2a2a2a'], [-0.34, 0.06, '#2a2a2a']], dorsal: '#f0c020' }, desc: '天狗の鼻のように尖った口と、黒い横帯、黄色い大きな背ビレ。遺跡の石の陰に2匹でたたずんでいることが多い。' }),
  // ============================================================ night dive only
  night({
    id: 'umihotaru', name: 'ウミホタル', sci: 'Vargula hilgendorfii', zone: 'lagoon', depth: [1, 15], size: 0.02, rarity: 2,
    desc: '3mmほどの甲殻類。刺激されると青い発光液を水中に吐き出し、夜の海が光の粒で満たされる。', hint: '浅瀬の砂地の上を漂う。ライトを消すと光って見える。',
    habLabel: '夜の砂地の上を群れで漂う',
    kind: 'jelly', jelly: { tentacles: 2, tentLen: 0.01, flat: 1.2 }, tex: [32, 32],
    paint: (p) => { p.fill('rgba(180,230,255,0.9)'); },
    count: 60, groups: 6, behavior: 'drift', region: [-150, 150, 0, 120], speed: 0.05, flee: 0, pulse: [4, 0.15], swim: [1, 0.05, 2], spread: 2, mat: { translucent: 0.7, glow: 0x3ad8ff, rough: 0.2 }, photoRange: 2,
  }),
  night({
    id: 'zouriebi', name: 'ゾウリエビ', sci: 'Parribacus japonicus', zone: 'reef', depth: [3, 30], size: 0.2, rarity: 2,
    desc: 'ぞうりのように平たいエビ。昼は岩の割れ目に隠れ、夜になると出てきて貝や死骸を食べる。', hint: 'サンゴ礁の岩の上を夜に歩き回る。',
    habLabel: '夜に岩の上を歩き回る',
    kind: 'lobster', tex: [128, 256],
    paint: (p) => { p.fill('#a07a54'); dots(p, 120, 1, 2.4, 'rgba(70,46,26,0.6)'); },
    count: 4, groups: 4, behavior: 'static', region: 'bommieSpots', speed: 0, flee: 1.5, photoRange: 5,
  }),
  night({
    id: 'hanaika', name: 'ハナイカ', sci: 'Metasepia pfefferi', zone: 'lagoon', depth: [3, 20], size: 0.08, rarity: 3,
    desc: '紫・黄・赤の派手な色を波のように変化させる小さなコウイカ。泳ぐより海底を「歩く」。体に毒がある。', hint: '浅瀬の砂地を夜に歩く。',
    habLabel: '夜の砂地を腕で歩く',
    kind: 'squid', squid: { armLen: 0.2, tentLen: 0.1, finSize: 0.08 }, tex: [128, 64],
    paint: (p) => { p.fill('#7a3a8a'); p.blotch(30, 3, 8, ['rgba(240,200,40,0.7)', 'rgba(220,60,60,0.6)', 'rgba(250,250,240,0.5)']); },
    count: 3, groups: 3, behavior: 'bottom', region: [-150, 150, 0, 120], speed: 0.05, flee: 0, photoRange: 4,
  }),
  night({
    ...F({ id: 'aobudai-sleep', name: 'ブダイ（寝袋）', sci: 'Scarus ghobban', zone: 'reef', d: [2, 20], size: 0.5, r: 2, body: sh('parrot'), hab: 'under', region: 'underTables', n: 4, g: 4, speed: 0.02,
      look: { c: ['#4a8aa0', '#6aa0b0', '#d0e0d8'], fin: '#4a8aa0', net: 'rgba(250,250,240,0.5)' }, desc: 'ブダイの仲間は夜、口から粘液を出して透明な「寝袋」に包まって眠る。においを外に漏らさず、天敵から身を守る。' }),
    behavior: 'static',
  }),
  // ---- more night-only animals (the day shift is asleep; these come out)
  night({
    id: 'goshikiebi', name: 'ゴシキエビ', sci: 'Panulirus versicolor', zone: 'reef', depth: [3, 30], size: 0.35, rarity: 3,
    desc: '青・緑・白の縞が派手なイセエビの仲間。昼は岩穴の奥にいて、夜になると長い触角を揺らして歩き出す。', hint: 'サンゴ礁の岩棚の近くを夜に歩く。',
    habLabel: '夜に岩棚のまわりを歩き回る',
    kind: 'lobster', tex: [128, 256],
    paint: (p) => { p.fill('#2f7a8a'); p.blotch(70, 2, 6, ['rgba(240,240,230,0.6)', 'rgba(30,90,60,0.5)']); for (let i = 0; i < 8; i++) { p.g.fillStyle = 'rgba(245,245,235,0.75)'; p.g.fillRect(0, i * 32 + 12, p.W, 4); } },
    count: 3, groups: 3, behavior: 'static', region: 'underTables', speed: 0, flee: 2, photoRange: 6,
  }),
  night({
    id: 'uchiwaebi', name: 'ウチワエビ', sci: 'Ibacus ciliatus', zone: 'reef', depth: [3, 40], size: 0.22, rarity: 2,
    desc: 'うちわのように平たい頭をもつエビ。昼は砂に潜り、夜になると海底を歩いて餌を探す。', hint: 'サンゴ礁の砂地や岩の上を夜に歩く。',
    habLabel: '夜に砂地や岩の上を歩く',
    kind: 'lobster', tex: [128, 256],
    paint: (p) => { p.fill('#b87a58'); dots(p, 140, 1, 2.6, 'rgba(120,70,40,0.5)'); },
    count: 4, groups: 4, behavior: 'static', region: 'bommieSpots', speed: 0, flee: 1.5, photoRange: 5,
  }),
  night({
    id: 'mizuhikigani', name: 'ミズヒキガニ', sci: 'Lauridromia dehaani', zone: 'rocky', depth: [3, 40], size: 0.16, rarity: 2,
    desc: '赤い毛におおわれたカニ。昼は海綿や貝殻を背負って隠れ、夜に岩の上へ出てくる。', hint: '岩礁の岩の上を夜に歩く。',
    habLabel: '夜に岩の上をゆっくり歩く',
    kind: 'lobster', tex: [128, 256],
    paint: (p) => { p.fill('#c05a3a'); dots(p, 160, 0.8, 1.8, 'rgba(250,200,150,0.7)'); },
    count: 4, groups: 4, behavior: 'static', region: 'bommieSpots', speed: 0, flee: 1.2, photoRange: 4,
  }),
  night({
    id: 'odorikakureebi', name: 'オドリカクレエビ', sci: 'Urocaridella antonbruunii', zone: 'reef', depth: [2, 25], size: 0.05, rarity: 3,
    desc: '透きとおった体に紫の点をもつ小さなエビ。尾を振り上げて踊るように体を揺らす。夜はサンゴの上に出てくる。', hint: 'サンゴ礁の岩の上を夜に揺れている。',
    habLabel: '夜にサンゴの上で尾を振る',
    kind: 'lobster', tex: [128, 256],
    paint: (p) => { p.fill('rgba(230,240,240,0.9)'); dots(p, 40, 1.2, 2.4, 'rgba(150,60,160,0.85)'); },
    count: 3, groups: 3, behavior: 'static', region: 'bommieSpots', speed: 0, flee: 1, photoRange: 3,
  }),
  night({
    id: 'himeika', name: 'ヒメイカ', sci: 'Idiosepius paradoxus', zone: 'lagoon', depth: [1, 8], size: 0.025, rarity: 3,
    desc: '米粒ほどの極小のイカ。昼は海草や海藻にくっついて眠り、夜になると浅瀬をふわふわと泳ぎ回る。', hint: '浅瀬の夜の水中を漂う。ライトで探そう。',
    habLabel: '夜の浅瀬を群れでふわふわ泳ぐ',
    kind: 'squid', squid: { armLen: 0.2, tentLen: 0.1, finSize: 0.2 }, tex: [128, 64],
    paint: (p) => { p.fill('rgba(240,225,205,0.9)'); dots(p, 40, 1, 2, 'rgba(180,90,60,0.8)'); },
    count: 5, groups: 3, behavior: 'drift', region: [-150, 150, 0, 120], speed: 0.1, flee: 0, swim: [1.4, 0.05, 2], spread: 1.5, photoRange: 2,
  }),
  night(F({ id: 'benitenjikudai', name: 'ベニテンジクダイ', sci: 'Ostorhinchus cyanosoma', zone: 'reef', d: [2, 25], size: 0.07, r: 2, body: sh('cardinal'), hab: 'under', n: 12, g: 3,
    look: { c: ['#d85a3a', '#e8806a', '#f0c0a8'], fin: '#c84a30', bars: [[0.05, 0.03, '#f6e8d0'], [-0.05, 0.03, '#f6e8d0']], iris: '#111' }, desc: '赤みの強いテンジクダイ。昼は岩陰で群れて休み、夜になると広がって小さな餌を食べに出る。' })),
  night(F({ id: 'shimofuritanabata', name: 'シモフリタナバタウオ', sci: 'Belonepterygion fasciolatum', zone: 'reef', d: [10, 40], size: 0.06, r: 4, body: sh('goby', { H: 0.2 }), hab: 'under', n: 3, g: 3,
    look: { c: ['#a82a6a', '#c8408a', '#e890b8'], fin: '#d04a8a', bars: [[0.2, 0.08, '#f0e0a0'], [-0.05, 0.08, '#f0e0a0'], [-0.3, 0.07, '#f0e0a0']], iris: '#111' }, desc: '紫がかった体に細い横帯をもつ、手のひらよりずっと小さなタナバタウオの仲間。夜になると岩棚の下から出てくる。' })),
  night(F({ id: 'isokasago', name: 'イソカサゴ', sci: 'Scorpaenodes littoralis', zone: 'rocky', d: [1, 20], size: 0.1, r: 2, body: sh('scorp'), hab: 'perch', region: 'rockSpots', n: 5, g: 5,
    look: { c: ['#7a4a3a', '#a06a50', '#d8b090'], fin: '#7a4a3a', spots: [[12, 0.01, 0.025, '#e8d8c0'], [8, 0.01, 0.02, '#3a2218']] }, desc: '岩に溶け込む小さなカサゴ。夜になると岩の上でじっと待ち伏せ、通りかかった小魚や甲殻類を丸のみにする。ヒレの棘に注意。' })),
  night(F({ id: 'hotarujako', name: 'ホタルジャコ', sci: 'Acropoma japonicum', zone: 'dropoff', d: [8, 80], size: 0.09, r: 2, body: sh('fusilier', { H: 0.3 }), hab: 'wall', n: 24, g: 3, spread: 3,
    look: { c: ['#c0807a', '#d8a8a0', '#f0e0d8'], fin: '#c0807a', iris: '#111' }, desc: '体の中に発光器をもつ小さな魚。昼は深場の壁に隠れ、夜に群れで浮上してくる。' })),
  night(F({ id: 'minamiisuzumi', name: 'ミナミイスズミ', sci: 'Kyphosus cinerascens', zone: 'rocky', d: [1, 15], size: 0.4, r: 3, body: sh('bream', { H: 0.34 }), hab: 'rockyRoam', n: 3, g: 1, speed: 0.4,
    look: { c: ['#5a6a70', '#8a9aa0', '#d8e0e0'], fin: '#5a6a70', lines: { n: 6, color: 'rgba(240,230,160,0.55)', ang: 0 }, iris: '#111' }, desc: '昼は岩礁で海藻を食べているイスズミの仲間。夜は群れがばらけ、岩陰で銀色に光りながらじっと眠る。めったに見られない。' })),
];
