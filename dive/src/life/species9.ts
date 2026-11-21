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
];
