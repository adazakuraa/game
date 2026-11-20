import { buildAmmonite, buildAnomalocaris, buildCrustacean, buildPlesiosaur, type FishShape } from './models';
import type { Paint } from './paint';
import { paintLook, type Look } from './paint';
import type { Region, SpeciesDef } from './species';
import { F, sh } from './species2';

/** Marine mammals, penguins, prehistoric "legendary" animals and more cold-cove fish. */

const COLD: Region = [-415, -232, -20, 320];
const OFF: Region = [-150, 150, 380, 700];
const DROP: Region = [-170, 170, 335, 470];
const EDGE: Region = [-180, 180, 290, 360];
const DEEP: Region = [-150, 150, 730, 1060];

const dots = (p: Paint, n: number, r0: number, r1: number, col: string, y0 = 0, y1 = 1) => {
  p.g.fillStyle = col;
  for (let i = 0; i < n; i++) {
    p.g.beginPath();
    p.g.arc(p.rnd() * p.W, (y0 + p.rnd() * (y1 - y0)) * p.H, r0 + p.rnd() * (r1 - r0), 0, Math.PI * 2);
    p.g.fill();
  }
};

/** Air-breathing / non-fish swimmers drawn with the fish body model. */
type Swimmer = {
  id: string; name: string; sci: string; zone: SpeciesDef['zone']; d: [number, number]; size: number; r: 1 | 2 | 3 | 4;
  body: FishShape; look: Look; desc: string; hint: string; habLabel: string; region: Region; n: number; g: number;
  speed: number; curious?: boolean; swim?: [number, number, number]; behavior?: SpeciesDef['behavior']; aggro?: SpeciesDef['aggro'];
};
const swimmer = (s: Swimmer): SpeciesDef => ({
  id: s.id, name: s.name, sci: s.sci, zone: s.zone, depth: s.d, size: s.size, rarity: s.r, desc: s.desc, hint: s.hint, habLabel: s.habLabel,
  kind: 'fish', fish: s.body, paint: (p) => paintLook(p, s.look), tex: [512, 256],
  count: s.n, groups: s.g, behavior: s.behavior ?? 'solo', region: s.region, speed: s.speed, flee: s.curious ? 0 : 3, curious: s.curious,
  swim: s.swim ?? [Math.max(0.5, 2.4 - s.size * 0.3), 0.05, 2], photoRange: Math.min(30, s.size * 9 + 4), aggro: s.aggro,
});

const CETACEAN = (o: Partial<FishShape>): FishShape => ({ H: 0.2, W: 0.21, peak: 0.55, nose: 0.3, ped: 0.06, tail: 'flukes', tailL: 0.14, tailH: 0.3, pect: { t: 0.72, len: 0.13, wid: 0.06, down: 0.6, out: 0.6 }, eyes: 0.05, eyeT: 0.86, bendY: true, ...o });
const PINNIPED = (o: Partial<FishShape>): FishShape => ({ H: 0.24, W: 0.26, peak: 0.5, nose: 0.55, ped: 0.08, belly: 0.06, tail: 'flukes', tailL: 0.1, tailH: 0.22, pect: { t: 0.68, len: 0.14, wid: 0.07, down: 0.5, out: 0.7 }, eyes: 0.1, eyeT: 0.9, bendY: true, ...o });

export const WILD_SPECIES: SpeciesDef[] = [
  // ============================================================ marine mammals
  swimmer({ id: 'shachi', name: 'シャチ', sci: 'Orcinus orca', zone: 'offshore', d: [0, 40], size: 7, r: 3, region: OFF, n: 3, g: 1, speed: 2.2, curious: true,
    body: CETACEAN({ H: 0.22, W: 0.22, nose: 0.55, dorsal: [{ a: 0.44, b: 0.56, h: 0.22, sweep: 0.15 }], pect: { t: 0.72, len: 0.16, wid: 0.09, down: 0.6, out: 0.6 } }),
    look: { c: ['#101012', '#141416', '#f2f2ee'], mid: 0.6, fin: '#0e0e10', tail: '#101012', ocel: [[0.36, 0.22, 9, '#f2f2ee']], saddle: [[0.05, 0.12, 'rgba(150,150,150,0.55)']] },
    desc: '海の生態系の頂点に立つ大型のイルカの仲間。家族の群れで暮らし、群れごとに独自の「方言」で鳴き交わす。', hint: '沖の大海原。群れで回遊している。', habLabel: '家族の群れで沖を回遊する' }),
  swimmer({ id: 'makkou', name: 'マッコウクジラ', sci: 'Physeter macrocephalus', zone: 'deep', d: [150, 430], size: 15, r: 3, region: DEEP, n: 1, g: 1, speed: 1.0, swim: [0.4, 0.05, 1.5],
    body: CETACEAN({ H: 0.2, W: 0.19, peak: 0.78, nose: 1.0, ped: 0.05, dorsal: [{ a: 0.3, b: 0.36, h: 0.03 }], pect: { t: 0.66, len: 0.07, wid: 0.04, down: 0.6, out: 0.6 }, eyes: 0.03, eyeT: 0.68 }),
    look: { c: ['#3a3634', '#46423e', '#5a5652'], fin: '#3a3634', noise: 0.1, blotch: [40, ['rgba(90,86,80,0.4)', 'rgba(30,28,26,0.3)']] },
    desc: '巨大な四角い頭をもつ歯クジラ。1000m以上の深海まで潜り、ダイオウイカを捕らえて食べる。', hint: '深海。ダイオウイカを追って潜ってくる。', habLabel: '深海まで潜ってイカを狩る' }),
  swimmer({ id: 'todo', name: 'トド', sci: 'Eumetopias jubatus', zone: 'cold', d: [0, 30], size: 2.8, r: 3, region: COLD, n: 2, g: 1, speed: 1.4, curious: true,
    body: PINNIPED({ H: 0.26, nose: 0.5 }), look: { c: ['#7a5a34', '#8e6a40', '#a88458'], fin: '#5a4024', iris: '#111' },
    desc: 'アシカの仲間で最大。雄は体重1トン近くになる。好奇心が強く、ダイバーの周りを泳ぎ回ることもある。', hint: '流氷の入り江。向こうから近づいてくる。', habLabel: '岩場を拠点に魚を追う' }),
  swimmer({ id: 'gomafuazarashi', name: 'ゴマフアザラシ', sci: 'Phoca largha', zone: 'cold', d: [0, 30], size: 1.6, r: 2, region: COLD, n: 3, g: 2, speed: 1.2, curious: true,
    body: PINNIPED({}), look: { c: ['#8a8c86', '#a8aaa4', '#c8c8c0'], fin: '#7a7c76', spots: [[90, 0.01, 0.025, 'rgba(40,42,40,0.7)']], iris: '#111' },
    desc: '灰色の体にゴマのような黒い斑点。流氷の上で子育てをする。丸い目でじっとこちらを見つめてくる。', hint: '流氷の入り江の中層。好奇心旺盛。', habLabel: '流氷の周りで魚やタコを食べる' }),
  swimmer({ id: 'kitaottosei', name: 'キタオットセイ', sci: 'Callorhinus ursinus', zone: 'cold', d: [0, 40], size: 1.8, r: 2, region: COLD, n: 3, g: 1, speed: 2.2,
    body: PINNIPED({ H: 0.22, nose: 0.45, pect: { t: 0.66, len: 0.22, wid: 0.08, down: 0.5, out: 0.7 } }), look: { c: ['#3a2e24', '#4a3c2e', '#6a5a46'], fin: '#2a2018', iris: '#111' },
    desc: '密集した下毛で寒さをしのぐアシカの仲間。大きな前ビレで飛ぶように速く泳ぐ。', hint: '流氷の入り江の中層。動きが速い。', habLabel: '大きな前ビレで速く泳ぐ' }),
  swimmer({ id: 'rakko', name: 'ラッコ', sci: 'Enhydra lutris', zone: 'cold', d: [0, 5], size: 1.2, r: 3, region: COLD, n: 2, g: 2, speed: 0.4, behavior: 'school', swim: [1, 0.04, 2],
    body: PINNIPED({ H: 0.24, nose: 0.7, tail: 'round', tailL: 0.12, tailH: 0.12, eyes: 0.08 }), look: { c: ['#4a3626', '#5a4430', '#c8b8a0'], mid: 0.7, fin: '#3a2a1c', front: [0.32, '#cdbca2'], iris: '#111' },
    desc: '海面に仰向けに浮かび、お腹の上で石を使って貝を割る。寝るときは海藻を体に巻いて流されないようにする。', hint: '流氷の入り江の海面近く。見上げて探そう。', habLabel: '海面に浮かんで暮らす' }),
  // ============================================================ penguins (for fun: wild ones live in the southern hemisphere)
  F({ id: 'kouteipengin', name: 'コウテイペンギン', sci: 'Aptenodytes forsteri', zone: 'cold', d: [0, 60], size: 1.1, r: 3, body: sh('tuna', { H: 0.3, W: 0.3, tail: 'none', nose: 0.35, peak: 0.5, pect: { t: 0.64, len: 0.38, wid: 0.06, down: 0.3, out: 0.8 }, dorsal: [], anal: [], eyes: 0.05, eyeT: 0.88 }), hab: 'midwater', region: COLD, n: 3, g: 1, speed: 1.6, swim: [2.4, 0.02, 3],
    look: { c: ['#141416', '#1a1a1c', '#f4f2ea'], mid: 0.62, fin: '#121214', front: [0.36, '#18181a'], ocel: [[0.33, -0.05, 8, '#f6c020']] },
    desc: '最大のペンギン。本来は南極の海にすむが、この入り江にはなぜか姿を見せる。水中では翼をはばたかせて飛ぶように泳ぐ。' }),
  F({ id: 'iwatobipengin', name: 'イワトビペンギン', sci: 'Eudyptes chrysocome', zone: 'cold', d: [0, 30], size: 0.5, r: 2, body: sh('tuna', { H: 0.3, W: 0.3, tail: 'none', nose: 0.35, peak: 0.5, pect: { t: 0.64, len: 0.32, wid: 0.06, down: 0.3, out: 0.8 }, dorsal: [], anal: [], eyes: 0.06, eyeT: 0.9 }), hab: 'midwater', region: COLD, n: 8, g: 1, speed: 1.8, swim: [2.8, 0.02, 3],
    look: { c: ['#1c1c22', '#22222a', '#f2f0ea'], mid: 0.6, fin: '#18181e', hl: [[0.3, 0.04, '#f2c820', 0.3, 0.46]], iris: '#c02010' },
    desc: '黄色い飾り羽と赤い目が目印の小型のペンギン。本来は南半球の岩の島にすむ。群れで素早く泳ぎ回る。' }),
  // ============================================================ legendary: prehistoric survivors (★4, seldom present)
  F({ id: 'coelacanth', name: 'シーラカンス', sci: 'Latimeria chalumnae', zone: 'deep', d: [150, 300], size: 1.8, r: 4, body: sh('grouper', { H: 0.26, W: 0.2, tail: 'round', tailL: 0.22, tailH: 0.34, pelvic: true, pect: { t: 0.66, len: 0.16, wid: 0.07, down: 0.4, out: 0.6 }, dorsal: [{ a: 0.5, b: 0.62, h: 0.12 }, { a: 0.2, b: 0.28, h: 0.08 }], eyes: 0.07 }), hab: 'midwater', region: DEEP, n: 1, g: 1, speed: 0.3, behavior: 'solo',
    look: { c: ['#20304a', '#2a3c5a', '#3a4a66'], fin: '#22324c', spots: [[46, 0.01, 0.022, 'rgba(230,236,240,0.85)']], iris: '#7ab0c8' },
    desc: '「生きている化石」。4億年前とほとんど姿を変えていない。肉厚のヒレを足のように交互に動かしてゆっくり泳ぐ。' }),
  F({ id: 'dunkleosteus', name: 'ダンクルオステウス', sci: 'Dunkleosteus terrelli', zone: 'offshore', d: [10, 60], size: 6, r: 4, body: sh('shark', { H: 0.24, W: 0.22, nose: 0.95, peak: 0.66, eyes: 0.06, eyeT: 0.88 }), hab: 'midwater', region: OFF, n: 1, g: 1, speed: 1.4, behavior: 'solo',
    aggro: { kind: 'shark', chance: 0.6, range: 16, bite: 20, speed: 3.2 },
    look: { c: ['#4a4a40', '#5a5a4e', '#8a8a78'], fin: '#3a3a32', front: [0.22, '#6a6250'], bars: [[0.22, 0.02, 'rgba(30,26,20,0.6)']], iris: '#e0c040' },
    desc: '約3億7000万年前の海の覇者。頭と胸を厚い骨の鎧で覆い、刃のような顎で何でも噛み砕いた。' }),
  F({ id: 'megalodon', name: 'メガロドン', sci: 'Otodus megalodon', zone: 'offshore', d: [5, 80], size: 16, r: 4, body: sh('shark', { H: 0.24, W: 0.22, nose: 0.75, eyes: 0.04 }), hab: 'midwater', region: OFF, n: 1, g: 1, speed: 1.6, behavior: 'pelagic',
    aggro: { kind: 'shark', chance: 0.5, range: 26, bite: 30, speed: 4 },
    look: { c: ['#4e5862', '#66727c', '#e8ecee'], mid: 0.55, fin: '#4a545e', tail: '#4a545e' },
    desc: '全長15mを超えた史上最大級のサメ。クジラを襲って食べていたと考えられている。歯の化石は手のひらほどもある。' }),
  {
    id: 'futabasuzukiryu', name: 'フタバスズキリュウ', sci: 'Futabasaurus suzukii', zone: 'offshore', depth: [5, 50], size: 7, rarity: 4,
    desc: '日本で見つかった首長竜（約8500万年前）。長い首を伸ばして魚の群れに忍び寄り、4枚のヒレで空を飛ぶように泳ぐ。', hint: '沖の大海原。めったに現れない。',
    habLabel: '4枚のヒレで羽ばたくように泳ぐ',
    kind: 'inv', build: buildPlesiosaur, tex: [256, 256],
    paint: (p) => { p.fill('#4a5650'); p.blotch(60, 4, 12, ['rgba(90,104,96,0.55)', 'rgba(30,36,32,0.45)']); p.g.fillStyle = 'rgba(200,204,190,0.55)'; p.g.fillRect(0, p.H * 0.55, p.W, p.H * 0.45); },
    count: 1, groups: 1, behavior: 'pelagic', region: OFF, speed: 1.1, flee: 0, curious: true, flap: [0.45, 0.3, 0.5], swim: [0.6, 0.04, 1.5], photoRange: 26,
  },
  {
    id: 'ammonite', name: 'アンモナイト', sci: 'Ammonoidea', zone: 'dropoff', depth: [20, 80], size: 0.45, rarity: 4,
    desc: '恐竜と同じ時代に栄え、白亜紀末に姿を消した殻をもつイカ・タコの仲間。殻の中の部屋で浮力を調整して漂う。', hint: 'ドロップオフの深めの中層。',
    habLabel: '壁沿いの中層をゆっくり漂う',
    kind: 'inv', build: buildAmmonite, tex: [128, 128],
    paint: (p) => { p.fill('#c8a070'); for (let i = 0; i < 26; i++) { p.g.fillStyle = i % 2 ? 'rgba(120,80,40,0.55)' : 'rgba(240,210,170,0.4)'; p.g.fillRect((i / 26) * p.W, 0, p.W / 52, p.H); } },
    count: 3, groups: 1, behavior: 'solo', region: DROP, speed: 0.15, flee: 0, swim: [1.2, 0.02, 2], photoRange: 6,
  },
  {
    id: 'anomalocaris', name: 'アノマロカリス', sci: 'Anomalocaris canadensis', zone: 'dropoff', depth: [8, 40], size: 0.9, rarity: 4,
    desc: '約5億年前、カンブリア紀の海の最強の捕食者。体の横のヒレを波打たせて泳ぎ、トゲのある触手で獲物を捕らえた。', hint: 'サンゴ礁の縁からドロップオフの壁沿い。',
    habLabel: '体側のヒレを波打たせて泳ぐ',
    kind: 'inv', build: buildAnomalocaris, tex: [128, 256],
    paint: (p) => { p.fill('#b0603a'); dots(p, 140, 1, 3, 'rgba(90,40,20,0.5)'); p.g.fillStyle = 'rgba(240,200,150,0.35)'; for (let i = 0; i < 12; i++) p.g.fillRect(0, (i / 12) * p.H, p.W, 3); },
    count: 2, groups: 1, behavior: 'solo', region: EDGE, speed: 0.45, flee: 3, flap: [2.6, 0.22, 0.4], swim: [1, 0.02, 2], photoRange: 9,
  },
  {
    id: 'sanyouchu', name: '三葉虫', sci: 'Trilobita', zone: 'deep', depth: [150, 430], size: 0.3, rarity: 4,
    desc: '古生代の海で3億年近く栄えた節足動物。方解石のレンズでできた複眼をもっていた。', hint: '深海の海底をはっている。',
    habLabel: '海底をゆっくりはい回る',
    kind: 'isopod', tex: [128, 256],
    paint: (p) => { p.fill('#7a6a58'); p.g.fillStyle = 'rgba(40,32,24,0.55)'; for (let i = 0; i < 14; i++) p.g.fillRect(0, (i / 14) * p.H, p.W, 2); p.g.fillRect(p.W * 0.4, 0, 2, p.H); p.g.fillRect(p.W * 0.6, 0, 2, p.H); },
    count: 4, groups: 2, behavior: 'bottom', region: DEEP, speed: 0.05, flee: 0, spread: 2, photoRange: 6,
  },
  // ============================================================ more cold-cove fish
  {
    id: 'magarei', name: 'マガレイ', sci: 'Pseudopleuronectes herzensteini', zone: 'cold', depth: [2, 40], size: 0.3, rarity: 1,
    desc: '右側に両目が寄った北の海のカレイ。砂に潜って目だけを出し、ゴカイなどを待ち伏せる。', hint: '流氷の入り江の砂地にじっとしている。',
    habLabel: '砂地に潜んで待ち伏せる',
    kind: 'ray', ray: { span: 0.45, len: 0.85, thick: 0.05, flounder: true }, tex: [256, 256],
    paint: (p) => { p.fill('#8a7a58'); p.blotch(80, 2, 6, ['rgba(60,50,30,0.45)', 'rgba(190,175,140,0.4)']); p.g.fillStyle = '#efeae0'; p.g.fillRect(0, p.H / 2, p.W, p.H / 2); },
    count: 6, groups: 6, behavior: 'static', region: COLD, speed: 0, flee: 2.5, photoRange: 8,
  },
  F({ id: 'kichiji', name: 'キチジ', sci: 'Sebastolobus macrochir', zone: 'cold', d: [10, 60], size: 0.3, r: 2, body: sh('scorp', { H: 0.3 }), hab: 'perch', region: 'coldSpots', n: 4, g: 4,
    look: { c: ['#d0301e', '#e04428', '#f07858'], fin: '#d83a22', ocel: [[0.05, 0.42, 5, '#1a1a1a']], iris: '#e0e0d0' }, desc: '「キンキ」の名で知られる真っ赤な高級魚。背ビレに黒い斑紋がある。深めの岩場にじっとしている。' }),
  F({ id: 'gindara', name: 'ギンダラ', sci: 'Anoplopoma fimbria', zone: 'cold', d: [15, 80], size: 0.7, r: 2, body: sh('grouper', { H: 0.22 }), hab: 'rockyRoam', region: COLD, n: 3, g: 2,
    look: { c: ['#2e3236', '#3e4246', '#8a9096'], fin: '#2a2e32', noise: 0.08 }, desc: '名前に「タラ」とつくがタラの仲間ではない。深めの冷たい海を回遊し、脂がのっている。' }),
  F({ id: 'suketoudara', name: 'スケトウダラ', sci: 'Gadus chalcogrammus', zone: 'cold', d: [5, 80], size: 0.5, body: sh('grouper', { H: 0.2 }), hab: 'midwater', region: COLD, n: 40, g: 3,
    look: { c: ['#5a5440', '#7a7458', '#e0dcd0'], mid: 0.5, fin: '#6a6448', hl: [[0.0, 0.03, 'rgba(60,54,36,0.5)']] }, desc: '大きな群れをつくるタラの仲間。卵は「たらこ」、身はかまぼこの原料になる。' }),
  F({ id: 'shirozake', name: 'シロザケ', sci: 'Oncorhynchus keta', zone: 'cold', d: [0, 30], size: 0.75, r: 2, body: sh('mullet', { H: 0.24 }), hab: 'midwater', region: COLD, n: 12, g: 2, metal: 0.5,
    look: { c: ['#2a4a5a', '#8aa0aa', '#eef2f2'], mid: 0.45, fin: '#5a7280', spots: [[30, 0.01, 0.02, 'rgba(30,40,50,0.4)', [-0.5, 0.5, 0.2, 0.5]]] }, desc: '川で生まれ、北の海を回遊して大きく育ち、生まれた川へ帰ってくる。秋が近づくと婚姻色になる。' }),
  F({ id: 'karafutoshishamo', name: 'カラフトシシャモ', sci: 'Mallotus villosus', zone: 'cold', d: [0, 30], size: 0.15, body: sh('fusilier', { H: 0.18 }), hab: 'midwater', region: COLD, n: 80, g: 4, metal: 0.4,
    look: { c: ['#4a6a54', '#9ab0a0', '#eef2ee'], mid: 0.45, fin: '#7a9080' }, desc: '大群で泳ぐ小さな魚。北の海の多くの魚、海鳥、アザラシのごちそうになる。' }),
  F({ id: 'hatahata', name: 'ハタハタ', sci: 'Arctoscopus japonicus', zone: 'cold', d: [5, 60], size: 0.2, body: sh('mullet', { H: 0.24, pect: { t: 0.72, len: 0.16, wid: 0.1, down: 0.4, out: 0.7 } }), hab: 'sandForage', region: COLD, n: 30, g: 3,
    look: { c: ['#9a8a6a', '#c8bca0', '#f4f0e8'], mid: 0.45, fin: '#b0a080', blotch: [20, ['rgba(110,90,60,0.4)']] }, desc: '鱗のない、口が上を向いた魚。冬の雷の季節に岸へ押し寄せることから「鰰」と書く。' }),
  F({ id: 'kusauo', name: 'クサウオ', sci: 'Liparis tessellatus', zone: 'cold', d: [5, 60], size: 0.4, r: 2, body: sh('blenny', { H: 0.24 }), hab: 'perch', region: 'coldSpots', n: 3, g: 3,
    look: { c: ['#c89a90', '#dcb0a6', '#f0d8d0'], fin: '#c08c82', noise: 0.04 }, desc: 'ぶよぶよしたゼリーのような体の魚。吸盤で岩に張りつき、ゆっくりとしか動かない。' }),
  F({ id: 'tokubire', name: 'トクビレ', sci: 'Podothecus sachi', zone: 'cold', d: [5, 60], size: 0.4, r: 2, body: sh('lizard', { H: 0.18, dorsal: [{ a: 0.3, b: 0.62, h: 0.24 }], anal: [{ a: 0.3, b: 0.6, h: 0.2 }] }), hab: 'sandForage', region: COLD, n: 3, g: 3,
    look: { c: ['#5a4a3a', '#7a6a54', '#d8ccb8'], fin: '#e0a030', dorsal: '#e0a030', iris: '#222' }, desc: '「ハッカク」とも呼ばれる、硬い板状の鱗に覆われた魚。雄は背ビレと尻ビレが帆のように大きい。' }),
  F({ id: 'nijikajika', name: 'ニジカジカ', sci: 'Alcichthys elongatus', zone: 'cold', d: [2, 30], size: 0.25, r: 2, body: sh('scorp', { H: 0.26 }), hab: 'perch', region: 'coldSpots', n: 4, g: 4,
    look: { c: ['#a0402a', '#c8603a', '#e8b080'], fin: '#c05030', blotch: [24, ['rgba(60,120,80,0.45)', 'rgba(240,200,80,0.4)']] }, desc: '赤・緑・黄色が入り混じる派手なカジカ。海藻の茂みでよく目立たないように見える。' }),
  F({ id: 'muroranginpo', name: 'ムロランギンポ', sci: 'Pholidapus dybowskii', zone: 'cold', d: [2, 30], size: 0.35, body: sh('blenny', { H: 0.14 }), hab: 'perch', region: 'coldSpots', n: 4, g: 4,
    look: { c: ['#6a5034', '#8a6a46', '#c8b090'], fin: '#7a5a3a', ocel: [[0.2, 0.42, 4, '#1a1a1a', '#e0d080']], iris: '#e0c060' }, desc: '岩の穴から顔だけ出していることが多いギンポの仲間。目の上にひげのような突起がある。' }),
  {
    id: 'gangiei', name: 'ガンギエイ', sci: 'Dipturus kwangtungensis', zone: 'cold', depth: [10, 60], size: 0.9, rarity: 2,
    desc: '菱形の体と細い尾をもつエイ。尾の付け根に小さな背ビレがある。砂泥の上でじっとしていることが多い。', hint: '流氷の入り江の砂底。',
    habLabel: '砂泥底を滑るように泳ぐ',
    kind: 'ray', ray: { span: 0.85, len: 0.95, thick: 0.05, tail: 0.9 }, tex: [256, 256],
    paint: (p) => { p.fill('#8a7a5a'); p.blotch(60, 2, 7, ['rgba(60,50,30,0.4)', 'rgba(180,160,120,0.3)']); p.g.fillStyle = '#e4dcd0'; p.g.fillRect(0, p.H / 2, p.W, p.H / 2); },
    count: 3, groups: 3, behavior: 'bottom', region: COLD, speed: 0.4, flee: 3, flap: [0.8, 0.06, 4], swim: [0.8, 0.1, 2], photoRange: 12,
  },
  {
    id: 'kegani', name: 'ケガニ', sci: 'Erimacrus isenbeckii', zone: 'cold', depth: [5, 60], size: 0.15, rarity: 1,
    desc: '甲羅が短い毛でびっしり覆われた北の海のカニ。砂地や岩場を横歩きする。', hint: '流氷の入り江の海底。',
    habLabel: '海底を歩き回る',
    kind: 'isopod', tex: [128, 256],
    paint: (p) => { p.fill('#9a5a3a'); dots(p, 300, 0.5, 1.2, 'rgba(60,30,20,0.6)'); },
    count: 8, groups: 4, behavior: 'bottom', region: COLD, speed: 0.08, flee: 0, spread: 2, photoRange: 4,
  },
  {
    id: 'hokkokuakaebi', name: 'ホッコクアカエビ', sci: 'Pandalus eous', zone: 'cold', depth: [20, 80], size: 0.1, rarity: 1,
    desc: '「甘エビ」の名で知られる赤いエビ。冷たく深い海の泥底近くに群れる。', hint: '流氷の入り江の岩の陰。',
    habLabel: '岩陰の海底近くに群れる',
    kind: 'inv', build: () => buildCrustacean({ shrimp: true }), tex: [64, 128],
    paint: (p) => { p.fill('#e8604a'); },
    count: 14, groups: 4, behavior: 'static', region: 'coldSpots', speed: 0, flee: 1.2, photoRange: 4,
  },
];
