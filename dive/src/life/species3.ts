import { buildClam, buildCrustacean, buildCucumber, buildFeather, buildHermit, buildSpindle, buildStar, buildTreeWorm, buildUrchin } from './models';
import type { Paint } from './paint';
import type { SpeciesDef } from './species';

/**
 * Animals other than fish that divers meet all the time, grouped by area.
 * Most are sessile or slow; they sit in the micro-habitats where they really occur.
 */

const vgrad = (p: Paint, stops: [number, string][]) => {
  const g = p.g.createLinearGradient(0, p.H, 0, 0);
  for (const [t, c] of stops) g.addColorStop(t, c);
  p.g.fillStyle = g;
  p.g.fillRect(0, 0, p.W, p.H);
};
const dots = (p: Paint, n: number, r0: number, r1: number, col: string, y0 = 0, y1 = 1) => {
  p.g.fillStyle = col;
  for (let i = 0; i < n; i++) {
    p.g.beginPath();
    p.g.arc(p.rnd() * p.W, (y0 + p.rnd() * (y1 - y0)) * p.H, r0 + p.rnd() * (r1 - r0), 0, Math.PI * 2);
    p.g.fill();
  }
};

export const INVERTS: SpeciesDef[] = [
  // ============================== 浅瀬ラグーン・砂地
  {
    id: 'kuronamako', name: 'クロナマコ', sci: 'Holothuria atra', zone: 'lagoon', depth: [0.5, 20], size: 0.3, rarity: 1,
    desc: '黒い体に砂をまぶしたナマコ。砂ごと餌を食べ、きれいな砂を排出して海底を掃除する。', hint: '浅瀬ラグーンの砂地に転がっている。',
    habLabel: '砂地の上をゆっくり這い、砂の中の有機物を食べる',
    kind: 'inv', build: () => buildCucumber({ papillae: 0.12 }), tex: [128, 128],
    paint: (p) => { p.fill('#141210'); dots(p, 260, 0.6, 1.8, 'rgba(210,200,180,0.55)'); },
    count: 18, groups: 6, behavior: 'bottom', region: [-170, 170, -40, 130], speed: 0.01, flee: 0, spread: 3, photoRange: 6,
  },
  {
    id: 'aohitode', name: 'アオヒトデ', sci: 'Linckia laevigata', zone: 'reef', depth: [0.5, 20], size: 0.28, rarity: 1,
    desc: '鮮やかな青色のヒトデ。サンゴ礁の砂地やサンゴのかけらの上でよく目立つ。', hint: 'サンゴ礁の砂地やがれ場。',
    habLabel: 'サンゴのかけらが積もった砂地にいる',
    kind: 'inv', build: () => buildStar({ arms: 5, arm: 0.44, core: 0.06, thick: 0.05, sharp: 0.7 }), tex: [128, 128],
    paint: (p) => { p.fill('#2a62d8'); dots(p, 200, 0.5, 1.2, 'rgba(20,50,140,0.6)'); },
    count: 12, groups: 12, behavior: 'static', region: 'sandSpots', speed: 0, flee: 0, photoRange: 6,
  },
  {
    id: 'manjuhitode', name: 'マンジュウヒトデ', sci: 'Culcita novaeguineae', zone: 'lagoon', depth: [0.5, 30], size: 0.25, rarity: 1,
    desc: '腕がほとんどなく、まんじゅうのように膨らんだヒトデ。体の中に小さなエビが隠れていることも。', hint: '浅瀬の海草藻場。',
    habLabel: '海草藻場や砂地にぽつんと置かれている',
    kind: 'inv', build: () => buildStar({ arms: 5, arm: 0.1, core: 0.4, thick: 0.28, sharp: 1.2 }), tex: [128, 128],
    paint: (p) => { p.fill('#b07040'); p.blotch(40, 3, 8, ['rgba(80,40,20,0.5)', 'rgba(230,180,120,0.4)']); dots(p, 160, 0.6, 1.4, 'rgba(60,30,10,0.6)'); },
    count: 8, groups: 8, behavior: 'static', region: 'grassSpots', speed: 0, flee: 0, photoRange: 7,
  },
  {
    id: 'komonyadokari', name: 'コモンヤドカリ', sci: 'Dardanus megistos', zone: 'lagoon', depth: [1, 30], size: 0.12, rarity: 1,
    desc: '白い斑点が並ぶ赤い脚の大型ヤドカリ。成長に合わせて大きな貝殻へ引っ越す。', hint: '浅瀬やサンゴ礁の砂地を歩いている。',
    habLabel: '砂地を貝殻ごと歩き回る',
    kind: 'inv', build: () => buildHermit(), tex: [128, 128],
    paint: (p) => { p.fill('#c83020'); dots(p, 30, 1, 2.5, '#f6f0e8', 0.6, 1); const g = p.g; g.fillStyle = '#9a7a5a'; g.fillRect(0, 0, p.W, p.H * 0.5); g.strokeStyle = 'rgba(60,40,20,0.6)'; g.lineWidth = 3; for (let i = 0; i < 6; i++) { g.beginPath(); g.moveTo(0, i * 12); g.lineTo(p.W, i * 12 + 20); g.stroke(); } },
    count: 10, groups: 5, behavior: 'bottom', region: [-170, 170, 0, 330], speed: 0.04, flee: 1.5, spread: 2, photoRange: 4,
  },
  {
    id: 'erabuumihebi', name: 'エラブウミヘビ', sci: 'Laticauda semifasciata', zone: 'reef', depth: [0, 30], size: 1.2, rarity: 2,
    desc: '強い毒をもつが性質はおとなしいウミヘビ。肺で呼吸するため、ときどき水面へ息継ぎに上がる。', hint: 'サンゴ礁の岩の隙間を探りながら泳ぐ。',
    habLabel: 'サンゴの隙間で獲物を探し、ときどき水面へ息継ぎに行く', hab: 'reefRoam',
    kind: 'fish', fish: { H: 0.035, W: 0.035, peak: 0.6, nose: 0.75, ped: 0.6, tail: 'round', tailL: 0.05, tailH: 0.06, eyes: 0.35, eyeT: 0.95, segs: 32, rings: 8 },
    paint: (p) => { p.fill('#3a5a8a'); p.g.fillStyle = '#5a7ab0'; p.g.fillRect(0, 0, p.W, p.H); for (let i = 0; i < 30; i++) { p.g.fillStyle = '#141820'; p.g.fillRect(i * (p.W / 30), 0, p.W / 70, p.H); } p.eye(0.35, '#222'); },
    count: 3, groups: 3, behavior: 'solo', region: [-180, 180, 140, 335], speed: 0.35, flee: 0, swim: [1.6, 0.12, 9], photoRange: 12,
  },
  // ============================== サンゴ礁
  {
    id: 'shiranami', name: 'シラナミ', sci: 'Tridacna maxima', zone: 'reef', depth: [0.5, 20], size: 0.25, rarity: 1,
    desc: 'シャコガイの仲間。外套膜の中に褐虫藻を住まわせ、光合成の栄養で育つ。外套膜の色は一つ一つ違う。', hint: 'サンゴの根の上。開いた殻から色鮮やかな外套膜が見える。',
    habLabel: 'サンゴの根の岩に殻を埋めて固着している',
    kind: 'inv', build: () => buildClam({ mantle: true }), tex: [128, 128], instColors: ['#ffffff', '#c0f0ff', '#d0ffd0', '#e8d0ff', '#fff0b0'],
    paint: (p) => { const g = p.g; g.fillStyle = '#d8d2c4'; g.fillRect(0, 0, p.W, p.H); g.fillStyle = '#2a8ab8'; g.fillRect(0, 0, p.W, p.H * 0.45); dots(p, 120, 0.8, 2, '#7af0e0', 0.05, 0.42); g.strokeStyle = 'rgba(20,40,80,0.5)'; for (let i = 0; i < 12; i++) { g.beginPath(); g.moveTo(0, i * 5); g.lineTo(p.W, i * 5 + 8); g.stroke(); } g.strokeStyle = 'rgba(120,110,100,0.6)'; for (let i = 0; i < 10; i++) { g.beginPath(); g.moveTo(i * 13, p.H * 0.5); g.lineTo(i * 13, p.H); g.stroke(); } },
    count: 14, groups: 14, behavior: 'static', region: 'bommieSpots', speed: 0, flee: 0, pulse: [0.6, 0.05], photoRange: 5,
  },
  {
    id: 'ibarakanzashi', name: 'イバラカンザシ', sci: 'Spirobranchus giganteus', zone: 'reef', depth: [1, 30], size: 0.035, rarity: 1,
    desc: 'ハマサンゴに棲むゴカイの仲間。クリスマスツリーのような鰓冠を広げ、驚くと一瞬で引っ込める。', hint: 'サンゴの表面。色とりどりの小さな「ツリー」を探そう。',
    habLabel: 'サンゴの表面に棲管を埋め、驚くと鰓冠を一瞬で引っ込める', hab: 'burrow', anchorHome: true,
    kind: 'inv', build: () => buildTreeWorm(), tex: [64, 64], instColors: ['#3a7af0', '#f08a20', '#f0d020', '#f2f2f2', '#e03a3a', '#8a4ae0'],
    paint: (p) => { p.fill('#ffffff'); p.g.strokeStyle = 'rgba(0,0,0,0.25)'; for (let i = 0; i < 16; i++) { p.g.beginPath(); p.g.moveTo(0, i * 4); p.g.lineTo(p.W, i * 4); p.g.stroke(); } },
    count: 70, groups: 14, behavior: 'buried', region: 'bommieSpots', speed: 0, flee: 1.6, spread: 0.6, swim: [1.2, 0.05, 2], photoRange: 2.2,
  },
  {
    id: 'umishida', name: 'ニッポンウミシダ', sci: 'Anneissia japonica', zone: 'reef', depth: [2, 40], size: 0.28, rarity: 1,
    desc: 'ヒトデやウニの仲間（棘皮動物）。羽のような腕を広げて流れてくるプランクトンをとらえる。', hint: 'サンゴの頂上や岩の上。流れに向かって腕を広げている。',
    habLabel: '潮通しのよいサンゴの上で腕を広げる', hab: 'perch',
    kind: 'inv', build: () => buildFeather({ arms: 20, len: 0.45, curl: 1.3, width: 0.03 }), tex: [128, 64], instColors: ['#ffffff', '#ffe0a0', '#ffb0b0', '#c0ffc0'],
    paint: (p) => { p.fill('#e8c030'); for (let i = 0; i < 12; i++) { p.g.fillStyle = 'rgba(40,20,10,0.7)'; p.g.fillRect(i * (p.W / 12), 0, p.W / 40, p.H); } },
    count: 16, groups: 16, behavior: 'static', region: 'coralTops', speed: 0, flee: 0, swim: [1.3, 0.04, 2], photoRange: 5,
  },
  {
    id: 'onihitode', name: 'オニヒトデ', sci: 'Acanthaster planci', zone: 'reef', depth: [1, 30], size: 0.4, rarity: 2,
    desc: '毒のある棘に覆われた大型のヒトデ。サンゴを食べるため、大発生するとサンゴ礁に大きな被害が出る。', hint: 'サンゴの上。食べられたサンゴは白くなっている。',
    habLabel: 'サンゴの上に覆いかぶさり、サンゴを食べる',
    kind: 'inv', build: () => buildStar({ arms: 15, arm: 0.22, core: 0.22, thick: 0.1, sharp: 1.0, spines: 120 }), tex: [128, 128],
    paint: (p) => { p.fill('#7a3a6a'); p.blotch(60, 2, 6, ['rgba(220,120,60,0.5)', 'rgba(40,20,40,0.5)']); },
    count: 5, groups: 5, behavior: 'static', region: 'bommieSpots', speed: 0, flee: 0, photoRange: 8,
  },
  {
    id: 'gangaze', name: 'ガンガゼ', sci: 'Diadema setosum', zone: 'reef', depth: [0.5, 25], size: 0.35, rarity: 1,
    desc: '30cm近い長い棘をもつウニ。棘は細くもろく、刺さると折れて抜けにくい。昼は岩陰に集まる。', hint: 'テーブルサンゴや岩棚の下の暗がり。',
    habLabel: '岩陰やサンゴの下に集まり、夜に藻を食べに出る',
    kind: 'inv', build: () => buildUrchin({ spine: 1.4, n: 70, thin: 0.015 }), tex: [64, 128],
    paint: (p) => { vgrad(p, [[0, '#1a1018'], [0.4, '#141016'], [1, '#0a0a0c']]); dots(p, 10, 1, 2, '#4ab0f0', 0.0, 0.35); p.g.fillStyle = '#e86a20'; p.g.fillRect(p.W * 0.45, p.H * 0.62, p.W * 0.1, p.H * 0.06); },
    count: 24, groups: 8, behavior: 'static', region: 'underTables', speed: 0, flee: 0, swim: [0.6, 0.02, 1], photoRange: 6,
  },
  {
    id: 'otohimeebi', name: 'オトヒメエビ', sci: 'Stenopus hispidus', zone: 'reef', depth: [1, 30], size: 0.07, rarity: 2,
    desc: '赤と白のしま模様に長い白い触角。魚の体を掃除するクリーナーシュリンプとして知られる。', hint: 'テーブルサンゴや岩の下の暗がり。白い触角が目印。',
    habLabel: '岩陰で長い触角を揺らし、魚の掃除をする',
    kind: 'inv', build: () => buildCrustacean({ shrimp: true }), tex: [64, 128],
    paint: (p) => { p.fill('#f4f0ea'); for (let i = 0; i < 8; i++) { p.g.fillStyle = '#d02020'; p.g.fillRect(0, i * 16 + 4, p.W, 7); } },
    count: 10, groups: 10, behavior: 'static', region: 'underTables', speed: 0, flee: 0, swim: [1.5, 0.05, 2], photoRange: 2.6,
  },
  {
    id: 'nishikiebi', name: 'ニシキエビ', sci: 'Panulirus ornatus', zone: 'reef', depth: [1, 30], size: 0.45, rarity: 2,
    desc: '青緑に黄色の斑紋が鮮やかなイセエビの仲間。昼間は岩陰から長い触角だけを出している。', hint: 'サンゴ礁の岩棚やテーブルサンゴの下。',
    habLabel: '岩棚の下に隠れて触角を出している',
    kind: 'lobster', tex: [128, 256],
    paint: (p) => { p.fill('#3a7a7a'); p.blotch(80, 2, 6, ['rgba(240,200,60,0.6)', 'rgba(20,40,60,0.5)']); for (let i = 0; i < 8; i++) { p.g.fillStyle = 'rgba(20,20,30,0.7)'; p.g.fillRect(0, i * 32 + 14, p.W, 4); } },
    count: 5, groups: 5, behavior: 'static', region: 'underTables', speed: 0, flee: 0, swim: [1.2, 0.04, 3], photoRange: 6,
  },
  {
    id: 'mikadoumiushi', name: 'ミカドウミウシ', sci: 'Hexabranchus sanguineus', zone: 'reef', depth: [1, 50], size: 0.25, rarity: 2,
    desc: '真っ赤な大型のウミウシ。外套膜を波打たせて泳ぐ姿は「スパニッシュダンサー」と呼ばれる。', hint: 'サンゴ礁の砂地やがれ場を這っている。',
    habLabel: 'サンゴのがれ場を這い、ときどき体を波打たせて泳ぐ',
    kind: 'nudi', tex: [64, 128],
    paint: (p) => { p.fill('#d02a2a'); p.blotch(40, 2, 6, ['rgba(255,220,220,0.4)', 'rgba(120,10,10,0.4)']); p.g.fillStyle = '#f8f0e8'; p.g.fillRect(0, 0, p.W * 0.08, p.H); p.g.fillRect(p.W * 0.92, 0, p.W * 0.08, p.H); },
    count: 4, groups: 4, behavior: 'bottom', region: 'sandSpots', speed: 0.02, flee: 0, flap: [1.6, 0.05, 6], photoRange: 5,
  },
  // ============================== 岩礁
  {
    id: 'murasakiuni', name: 'ムラサキウニ', sci: 'Heliocidaris crassispina', zone: 'rocky', depth: [0.5, 15], size: 0.08, rarity: 1,
    desc: '岩礁にごく普通に見られる紫黒色のウニ。岩のくぼみにはまり込み、海藻を食べる。', hint: '岩礁の岩の上やくぼみ。',
    habLabel: '岩のくぼみにはまり込んで海藻を食べる',
    kind: 'inv', build: () => buildUrchin({ spine: 0.55, n: 90, thin: 0.03 }), tex: [64, 128],
    paint: (p) => { vgrad(p, [[0, '#2a1830'], [0.5, '#3a2040'], [1, '#1a0e1e']]); },
    count: 60, groups: 15, behavior: 'static', region: 'rockSpots', speed: 0, flee: 0, photoRange: 4,
  },
  {
    id: 'amefurashi', name: 'アメフラシ', sci: 'Aplysia kurodai', zone: 'rocky', depth: [0.5, 10], size: 0.25, rarity: 1,
    desc: '殻が退化した巻貝の仲間。刺激すると紫色の汁を出す。春の磯でよく見られる。', hint: '岩礁の海藻の多い岩の上。',
    habLabel: '海藻の生えた岩の上をゆっくり這う',
    kind: 'nudi', tex: [64, 128],
    paint: (p) => { p.fill('#4a3a2a'); dots(p, 70, 0.8, 2.2, 'rgba(240,235,220,0.8)'); },
    count: 6, groups: 6, behavior: 'bottom', region: 'rockSpots', speed: 0.015, flee: 0, photoRange: 5,
  },
  {
    id: 'itomakihitode', name: 'イトマキヒトデ', sci: 'Patiria pectinifera', zone: 'rocky', depth: [0.5, 30], size: 0.1, rarity: 1,
    desc: '腕の短い五角形のヒトデ。青地にオレンジの斑紋。日本の磯で最もよく見られるヒトデ。', hint: '岩礁の岩の上。',
    habLabel: '岩の上をゆっくり移動し、貝などを食べる',
    kind: 'inv', build: () => buildStar({ arms: 5, arm: 0.22, core: 0.26, thick: 0.08, sharp: 1.3 }), tex: [128, 128],
    paint: (p) => { p.fill('#2a4a9a'); p.blotch(30, 4, 10, ['rgba(240,120,40,0.75)']); },
    count: 14, groups: 14, behavior: 'static', region: 'rockSpots', speed: 0, flee: 0, photoRange: 4,
  },
  {
    id: 'shiroumiushi', name: 'シロウミウシ', sci: 'Chromodoris orientalis', zone: 'rocky', depth: [1, 20], size: 0.05, rarity: 1,
    desc: '白い体に黒い点、縁が黄色いウミウシ。日本の岩礁で最も普通に見られる種のひとつ。', hint: 'とても小さい。岩の表面をよく探そう。',
    habLabel: '岩の上のカイメンを食べている',
    kind: 'nudi', tex: [64, 128],
    paint: (p) => { p.fill('#f6f4f0'); dots(p, 18, 1.5, 3, '#141414'); p.g.fillStyle = '#f0c020'; p.g.fillRect(0, 0, p.W * 0.1, p.H); p.g.fillRect(p.W * 0.9, 0, p.W * 0.1, p.H); },
    count: 10, groups: 10, behavior: 'static', region: 'rockSpots', speed: 0, flee: 0, photoRange: 2.6,
  },
  // ============================== ドロップオフ・沖
  {
    id: 'akakurage', name: 'アカクラゲ', sci: 'Chrysaora pacifica', zone: 'offshore', depth: [1, 25], size: 0.25, rarity: 1,
    desc: '傘に赤褐色の放射状のすじが入るクラゲ。長い触手に刺されると強く痛む。', hint: '沖の浅い中層を漂う。',
    habLabel: '潮にのって漂う',
    kind: 'jelly', jelly: { tentacles: 24, tentLen: 1.6, oral: true, flat: 0.5 }, tex: [256, 256],
    paint: (p) => { p.fill('rgba(240,225,210,1)'); const g = p.g; g.strokeStyle = 'rgba(180,50,30,0.9)'; g.lineWidth = 7; for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; g.beginPath(); g.moveTo(p.W / 2, p.H / 2); g.lineTo(p.W / 2 + Math.cos(a) * 128, p.H / 2 + Math.sin(a) * 128); g.stroke(); } g.fillStyle = '#c84a30'; g.fillRect(0, p.H * 0.9, p.W, p.H * 0.1); },
    count: 12, groups: 4, behavior: 'drift', region: [-150, 150, 360, 700], speed: 0.08, flee: 0, pulse: [0.9, 0.1], swim: [0.6, 0.1, 1.5], spread: 8, mat: { translucent: 0.6, rough: 0.3 }, photoRange: 9,
  },
  {
    id: 'kushikurage', name: 'ウリクラゲ', sci: 'Beroe cucumis', zone: 'dropoff', depth: [2, 60], size: 0.12, rarity: 2,
    desc: 'クシクラゲの仲間。体にある8列の「櫛板」が光を反射して虹色に輝きながら泳ぐ。刺胞はもたない。', hint: 'ドロップオフの中層。虹色の光の列を探そう。',
    habLabel: '中層を漂い、櫛板を虹色に光らせて泳ぐ', rainbow: true,
    kind: 'inv', build: () => buildSpindle({ len: 1.0, rad: 0.32, rows: 8 }), tex: [64, 64],
    paint: (p) => { p.fill('rgba(240,230,235,1)'); },
    count: 24, groups: 6, behavior: 'drift', region: [-170, 170, 330, 560], speed: 0.06, flee: 0, pulse: [0.8, 0.04], swim: [0.6, 0.02, 1], spread: 6, mat: { translucent: 0.35, rough: 0.15 }, photoRange: 6,
  },
  {
    id: 'hikaribo', name: 'ヒカリボヤ', sci: 'Pyrosoma atlanticum', zone: 'offshore', depth: [10, 400], size: 0.5, rarity: 2,
    desc: '小さなホヤが筒状に集まった群体。刺激を受けると青白く発光する。', hint: '沖の深めの中層。筒状のものがゆっくり漂う。',
    habLabel: '外洋の中層を筒の口から水を噴き出してゆっくり進む',
    kind: 'inv', build: () => buildSpindle({ len: 1.0, rad: 0.16, rows: 14, open: true }), tex: [128, 64],
    paint: (p) => { p.fill('#e8b8c0'); dots(p, 400, 0.6, 1.6, 'rgba(255,240,240,0.8)'); },
    count: 10, groups: 5, behavior: 'drift', region: [-150, 150, 450, 760], speed: 0.06, flee: 0, pulse: [0.4, 0.03], swim: [0.4, 0.02, 1], spread: 8, mat: { translucent: 0.7, glow: 0x5ad0ff, rough: 0.4 }, photoRange: 10,
  },
  // ============================== 深海
  {
    id: 'umiyuri', name: 'トリノアシ', sci: 'Metacrinus rotundus', zone: 'deep', depth: [150, 430], size: 0.6, rarity: 2,
    desc: 'ウミユリの仲間。長い茎で海底に立ち、羽のような腕を花のように広げる「生きた化石」。', hint: '深海の海底。花畑のように群生している。',
    habLabel: '海底に茎で立ち、腕を広げて餌をこしとる',
    kind: 'inv', build: () => buildFeather({ arms: 10, len: 0.35, stalk: 0.65, curl: 1.8, width: 0.025 }), tex: [128, 64],
    paint: (p) => { p.fill('#d8c8a0'); for (let i = 0; i < 20; i++) { p.g.fillStyle = 'rgba(120,90,50,0.5)'; p.g.fillRect(i * (p.W / 20), 0, 2, p.H); } },
    count: 30, groups: 6, behavior: 'static', region: [-150, 150, 760, 1060], speed: 0, flee: 0, swim: [0.5, 0.03, 1], spread: 3, photoRange: 9,
  },
  {
    id: 'ooguchiboya', name: 'オオグチボヤ', sci: 'Megalodicopia hians', zone: 'deep', depth: [250, 430], size: 0.2, rarity: 3,
    desc: '大きな口をぱっくり開けて、流れてくる小さな生き物を捕らえる肉食性のホヤ。', hint: '深海の岩場。ピンクの大きな口。',
    habLabel: '流れに向かって口を開け、獲物を待つ',
    kind: 'inv', build: () => buildClam({ mantle: false }), tex: [64, 64],
    paint: (p) => { p.fill('#f0b0b8'); p.noise(0.2, false, false); },
    count: 6, groups: 6, behavior: 'static', region: [-150, 150, 820, 1060], speed: 0, flee: 0, mat: { translucent: 0.8, rough: 0.3 }, photoRange: 6,
  },
  {
    id: 'shirouri', name: 'シロウリガイ', sci: 'Calyptogena soyoae', zone: 'deep', depth: [300, 430], size: 0.15, rarity: 2,
    desc: '熱水や冷水がしみ出す場所に群生する白い二枚貝。エラの共生細菌が作る栄養で生きる。', hint: '熱水噴出孔のまわりの海底。',
    habLabel: '熱水噴出孔のまわりの海底に群がる',
    kind: 'inv', build: () => buildClam({ mantle: false }), tex: [64, 64],
    paint: (p) => { p.fill('#ece8de'); p.noise(0.25, true, false); },
    count: 40, groups: 8, behavior: 'static', region: 'vent', speed: 0, flee: 0, photoRange: 5,
  },
  {
    id: 'yumenamako', name: 'ユメナマコ', sci: 'Enypniastes eximia', zone: 'deep', depth: [300, 430], size: 0.25, rarity: 3,
    desc: '透きとおった赤い体のナマコ。ひれのような膜を使って海底から浮き上がり、泳ぐことができる。', hint: '深海の海底のすぐ上を漂う。',
    habLabel: '海底近くを、ひれを波打たせて泳ぐ',
    kind: 'inv', build: () => buildCucumber({ papillae: 0.05, skirt: true }), tex: [64, 64],
    paint: (p) => { p.fill('#d04060'); p.noise(0.2, false, false); },
    count: 6, groups: 6, behavior: 'bottom', region: [-150, 150, 820, 1060], speed: 0.05, flee: 0, flap: [1.0, 0.06, 4], mat: { translucent: 0.65, rough: 0.3 }, photoRange: 7,
  },
  {
    id: 'tezurumozuru', name: 'テヅルモヅル', sci: 'Astrocladus coniferus', zone: 'deep', depth: [100, 430], size: 0.5, rarity: 2,
    desc: '何度も枝分かれする腕をもつクモヒトデの仲間。夜になると腕を網のように広げて餌をとる。', hint: '深海の尾根の上。',
    habLabel: '高い場所にとまり、枝分かれした腕を網のように広げる',
    kind: 'inv', build: () => buildFeather({ arms: 5, len: 0.6, curl: 2.4, width: 0.03 }), tex: [128, 64],
    paint: (p) => { p.fill('#c89a6a'); p.noise(0.3, true, false); },
    count: 8, groups: 8, behavior: 'static', region: [-150, 150, 760, 1060], speed: 0, flee: 0, swim: [0.4, 0.05, 1], photoRange: 8,
  },
];

