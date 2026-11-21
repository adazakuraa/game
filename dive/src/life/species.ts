import type { ZoneId } from '../world/layout';
import type { FishShape, RayShape } from './models';
import type { Paint } from './paint';

export type Behavior = 'school' | 'solo' | 'anemone' | 'crevice' | 'bottom' | 'drift' | 'buried' | 'static' | 'pelagic';
export type Kind = 'fish' | 'ray' | 'jelly' | 'squid' | 'octopus' | 'dumbo' | 'turtle' | 'lobster' | 'isopod' | 'nudi' | 'gardenEel' | 'inv' | 'none';
export type Region = [number, number, number, number] | 'anemones' | 'crevices' | 'reefSpots' | 'rockSpots' | 'vent' | 'eelPatch' | 'coralTops' | 'underTables' | 'wallSpots' | 'sandSpots' | 'grassSpots' | 'bommieSpots' | 'coldSpots' | 'caveSpots' | 'kelpSpots';
/** Micro-habitat: where in the 3D reef structure a species lives and how it reacts. */
export type Habitat = 'coralHover' | 'coralPick' | 'reefRoam' | 'midwater' | 'wall' | 'under' | 'perch' | 'burrow' | 'sandForage' | 'seagrass' | 'surface' | 'cleaner' | 'rockyRoam';

export type SpeciesDef = {
  id: string;
  name: string;
  sci: string;
  zone: ZoneId;
  depth: [number, number];
  size: number;
  desc: string;
  hint: string;
  /** 1 common .. 3 rare, 4 = legendary (prehistoric survivors: seldom present on a dive) */
  rarity: 1 | 2 | 3 | 4;
  kind: Kind;
  fish?: FishShape;
  ray?: RayShape;
  jelly?: { tentacles: number; tentLen: number; oral?: boolean; flat?: number; glowRim?: boolean };
  squid?: { armLen: number; tentLen: number; finSize: number };
  paint?: (p: Paint) => void;
  tex?: [number, number];
  count: number;
  groups: number;
  behavior: Behavior;
  region: Region;
  speed: number;
  flee: number;
  curious?: boolean;
  swim?: [number, number, number]; // freq, amp, k
  flap?: [number, number, number];
  pulse?: [number, number];
  mat?: { rough?: number; metal?: number; translucent?: number; glow?: number; emissive?: number; additive?: boolean };
  photoRange?: number;
  spread?: number;
  hab?: Habitat;
  habLabel?: string;
  /** custom geometry builder (kind 'inv') */
  build?: () => import('three').BufferGeometry;
  /** per-individual colour variants (multiplied with the texture) */
  instColors?: string[];
  /** buried-type animals sit at their home point (e.g. on coral) instead of on the sand */
  anchorHome?: boolean;
  rainbow?: boolean;
  /** only out on night dives */
  when?: 'night';
  /** lateral thickness / core height for photo-based models */
  photoWidth?: number;
  /**
   * Some individuals are aggressive. territory: guards its nest and charges a diver who comes close
   * (triggerfish); shark: circles a diver, then makes a bumping pass. chance = share of individuals.
   */
  aggro?: { kind: 'territory' | 'shark'; chance: number; range: number; bite: number; speed: number };
  /** fixed body pitch (e.g. razorfish swim head-down) */
  pitch?: number;
};

const fins = (p: Paint, c: string) => p.fill(c);

export const SPECIES: SpeciesDef[] = [
  // ======================================================== 浅瀬ラグーン
  {
    id: 'gardeneel', name: 'チンアナゴ', sci: 'Heteroconger hassi', zone: 'lagoon', depth: [4, 7], size: 0.38, rarity: 1,
    desc: '砂底に巣穴を掘り、体の半分を出して流れてくるプランクトンを食べる。驚くとすぐに砂の中へ隠れる。',
    hint: 'ラグーンの開けた砂地。近づきすぎると隠れてしまう。',
    kind: 'gardenEel', fish: { H: 0.05, W: 0.05, tail: 'none', nose: 0.7, ped: 0.6, peak: 0.5, eyes: 0.5, eyeT: 0.95, segs: 16, rings: 6 },
    paint: (p) => { p.fill('#f1ece0'); p.spots(60, 0.004, 0.008, '#222', undefined, false); p.eye(0.5, '#ddd'); },
    count: 46, groups: 1, behavior: 'buried', region: 'eelPatch', speed: 0, flee: 5.5, swim: [1.5, 0.25, 2], photoRange: 9,
  },
  {
    id: 'stingray', name: 'アカエイ', sci: 'Hemitrygon akajei', zone: 'lagoon', depth: [3, 8], size: 0.9, rarity: 1,
    desc: '砂地に潜って身を隠す平たい魚。尾に毒棘をもつので、むやみに近づかないこと。',
    hint: 'ラグーンの砂底をゆっくり滑るように泳ぐ。',
    kind: 'ray', ray: { span: 0.85, len: 0.9, thick: 0.06, tail: 1.0 },
    paint: (p) => {
      p.fill('#efe6dc');
      const gr = p.g.createRadialGradient(p.W * 0.55, p.H * 0.25, 4, p.W * 0.55, p.H * 0.25, p.W * 0.4);
      gr.addColorStop(0, '#8a5a3a'); gr.addColorStop(1, '#a87048');
      p.g.fillStyle = gr; p.g.fillRect(0, 0, p.W, p.H / 2);
      p.blotch(40, 2, 8, ['rgba(60,35,20,0.25)', 'rgba(200,150,110,0.2)']);
      p.g.fillStyle = '#e6d6c8'; p.g.fillRect(0, p.H / 2, p.W, p.H / 2);
      p.g.fillStyle = '#e8a050'; p.g.fillRect(0, p.H / 2 + 4, p.W, 3);
    },
    tex: [256, 256],
    count: 4, groups: 4, behavior: 'bottom', region: [-140, 140, -40, 120], speed: 0.6, flee: 4, flap: [0.9, 0.06, 4], swim: [0.8, 0.12, 2],
  },
  {
    id: 'flounder', name: 'ヒラメ', sci: 'Paralichthys olivaceus', zone: 'lagoon', depth: [3, 9], size: 0.55, rarity: 2,
    desc: '左側に両目が寄った平たい魚。体色を砂地にそっくり変えて、待ち伏せで小魚を捕らえる。',
    hint: '砂地にじっと擬態している。目をこらして探そう。',
    kind: 'ray', ray: { span: 0.45, len: 0.85, thick: 0.05, flounder: true },
    paint: (p) => {
      p.fill('#f0ebe0');
      p.g.fillStyle = '#b8a888'; p.g.fillRect(0, 0, p.W, p.H / 2);
      p.blotch(120, 2, 7, ['rgba(110,95,70,0.5)', 'rgba(230,220,190,0.5)', 'rgba(80,70,50,0.35)']);
      p.g.fillStyle = '#f4f0ea'; p.g.fillRect(0, p.H / 2, p.W, p.H / 2);
    },
    tex: [256, 256],
    count: 5, groups: 5, behavior: 'static', region: [-150, 150, -40, 118], speed: 0, flee: 2.2, flap: [1.5, 0.02, 10], photoRange: 9,
  },
  {
    id: 'boxfish', name: 'ミナミハコフグ', sci: 'Ostracion cubicus', zone: 'lagoon', depth: [2, 14], size: 0.2, rarity: 1,
    desc: '硬い骨板の箱に包まれた体。幼魚は鮮やかな黄色に黒い水玉。小さなヒレを懸命に動かして泳ぐ。',
    hint: '海草のあいだやサンゴの根元をよたよた泳ぐ。',
    kind: 'fish', fish: { H: 0.5, W: 0.46, peak: 0.55, nose: 0.85, ped: 0.18, tail: 'round', tailL: 0.2, tailH: 0.32, dorsal: [{ a: 0.18, b: 0.3, h: 0.12 }], anal: [{ a: 0.18, b: 0.3, h: 0.1 }], pect: { t: 0.72, len: 0.08, wid: 0.06, down: 0.3 }, eyes: 0.12, eyeT: 0.82, rings: 8 },
    paint: (p) => { fins(p, '#e8c040'); p.shade('#f2d020', '#f6d830', '#f0e080'); p.spots(26, 0.012, 0.016, '#1a1a1a'); p.spots(26, 0.005, 0.007, '#fff'); p.eye(0.12, '#2a3040'); },
    hab: 'seagrass', count: 8, groups: 6, behavior: 'solo', region: 'grassSpots', speed: 0.25, flee: 2.5, swim: [3.2, 0.03, 4], photoRange: 7,
  },
  {
    id: 'turtle', name: 'アオウミガメ', sci: 'Chelonia mydas', zone: 'lagoon', depth: [2, 20], size: 1.0, rarity: 2,
    desc: '海草を主食とする大型のウミガメ。前脚を翼のように羽ばたかせ、ゆったりと泳ぐ。息継ぎのため時々水面へ。',
    hint: '海草藻場やサンゴ礁をゆったりと回遊している。',
    kind: 'turtle',
    paint: (p) => {
      p.fill('#d8cdb0');
      const g = p.g;
      g.fillStyle = '#5a4a2a'; g.fillRect(0, 0, p.W, p.H / 2);
      for (let i = 0; i < 16; i++) {
        const cx = p.W * (0.3 + (i % 4) * 0.14), cy = p.H * (0.08 + Math.floor(i / 4) * 0.1);
        const gr = g.createRadialGradient(cx, cy, 2, cx, cy, 22);
        gr.addColorStop(0, '#9a7a40'); gr.addColorStop(0.6, '#6e5428'); gr.addColorStop(1, '#3a2c16');
        g.fillStyle = gr; g.beginPath(); g.ellipse(cx, cy, 18, 14, 0, 0, Math.PI * 2); g.fill();
      }
      g.fillStyle = '#7a6a4a'; g.fillRect(0, 0, p.W * 0.22, p.H / 2); g.fillRect(p.W * 0.78, 0, p.W * 0.22, p.H / 2);
      p.blotch(60, 1, 4, ['rgba(220,210,180,0.4)', 'rgba(40,30,20,0.4)']);
      g.fillStyle = '#e8dcc0'; g.fillRect(0, p.H / 2, p.W, p.H / 2);
    },
    tex: [256, 256],
    count: 3, groups: 3, behavior: 'solo', region: [-150, 150, -20, 300], speed: 0.6, flee: 2, curious: true, flap: [0.55, 0.22, 0.5], photoRange: 18,
  },
  // ======================================================== サンゴ礁
  {
    id: 'clownfish', name: 'カクレクマノミ', sci: 'Amphiprion ocellaris', zone: 'reef', depth: [3, 15], size: 0.1, rarity: 1,
    desc: 'イソギンチャクと共生する小さな魚。体表の粘液で刺胞から身を守り、外敵から守ってもらう。',
    hint: 'サンゴ礁のイソギンチャクを探そう。',
    kind: 'fish', fish: { H: 0.42, W: 0.2, peak: 0.58, nose: 0.55, ped: 0.24, tail: 'round', tailL: 0.22, tailH: 0.38, dorsal: [{ a: 0.2, b: 0.7, h: 0.13 }], anal: [{ a: 0.18, b: 0.4, h: 0.12 }], pect: { t: 0.7, len: 0.1, wid: 0.07, down: 0.4 }, pelvic: true, eyes: 0.14 },
    paint: (p) => { fins(p, '#f07018'); p.g.fillStyle = '#111'; p.g.fillRect(0, 0, p.U(-0.47), p.H); p.shade('#f06010', '#f87a18', '#f89040'); p.bar(0.3, 0.07, '#fafafa', '#111'); p.bar(0.03, 0.09, '#fafafa', '#111'); p.bar(-0.38, 0.06, '#fafafa', '#111'); p.eye(0.14, '#f06010'); },
    count: 18, groups: 9, behavior: 'anemone', region: 'anemones', speed: 0.35, flee: 0, swim: [5, 0.05, 6], photoRange: 6,
  },
  {
    id: 'bluetang', name: 'ナンヨウハギ', sci: 'Paracanthurus hepatus', zone: 'reef', depth: [2, 40], size: 0.25, rarity: 1,
    desc: '鮮やかな青に黒いパレット模様、黄色い尾が目印。尾の付け根に鋭い棘を隠している。',
    hint: '枝サンゴのまわりを群れで泳ぐ。',
    kind: 'fish', fish: { H: 0.5, W: 0.12, peak: 0.55, nose: 0.6, ped: 0.12, tail: 'truncate', tailL: 0.2, tailH: 0.42, dorsal: [{ a: 0.12, b: 0.78, h: 0.08, sweep: 0.1 }], anal: [{ a: 0.12, b: 0.55, h: 0.07 }], pect: { t: 0.68, len: 0.12, wid: 0.06, down: 0.6 }, eyes: 0.11 },
    paint: (p) => {
      fins(p, '#1a3cc0'); p.g.fillStyle = '#f8d020'; p.g.fillRect(0, 0, p.U(-0.48), p.H);
      p.shade('#1640d8', '#2050e0', '#3a70e8');
      p.clipBody(() => { p.g.fillStyle = '#0a0a20'; p.g.beginPath(); p.g.moveTo(p.U(0.38), p.V(0.12)); p.g.quadraticCurveTo(p.U(0.0), p.V(0.26), p.U(-0.3), p.V(0.05)); p.g.quadraticCurveTo(p.U(-0.38), p.V(-0.06), p.U(-0.3), p.V(-0.09)); p.g.quadraticCurveTo(p.U(-0.0), p.V(0.05), p.U(0.2), p.V(0.0)); p.g.quadraticCurveTo(p.U(0.35), p.V(-0.02), p.U(0.38), p.V(0.12)); p.g.fill(); p.g.fillStyle = '#f8d020'; p.g.fillRect(p.U(-0.5), p.V(0.04), p.U(-0.4) - p.U(-0.5), p.V(-0.04) - p.V(0.04)); });
      p.eye(0.11, '#222');
    },
    hab: 'coralHover', count: 30, groups: 5, behavior: 'school', region: 'coralTops', speed: 0.6, flee: 3, swim: [3.5, 0.05, 5], spread: 2.5,
  },
  {
    id: 'moorishidol', name: 'ツノダシ', sci: 'Zanclus cornutus', zone: 'reef', depth: [3, 60], size: 0.2, rarity: 2,
    desc: '長く伸びた背ビレの糸と、白・黒・黄の縞模様が美しい。つがいや小さな群れで行動する。',
    hint: 'サンゴ礁の根のまわりをペアで泳ぐ。',
    kind: 'fish', fish: { H: 0.95, W: 0.1, peak: 0.6, nose: 0.15, ped: 0.08, tail: 'truncate', tailL: 0.16, tailH: 0.3, dorsal: [{ a: 0.25, b: 0.62, h: 0.3, sweep: 0.6 }], anal: [{ a: 0.2, b: 0.5, h: 0.22, }], filament: 0.7, pect: { t: 0.65, len: 0.1, wid: 0.05, down: 0.5 }, eyes: 0.07 },
    paint: (p) => {
      fins(p, '#f4f2ea'); p.g.fillStyle = '#111'; p.g.fillRect(0, 0, p.U(-0.5), p.H);
      p.shade('#f6f4ee', '#f8f6f0', '#f0eee6');
      p.clipBody(() => { p.g.fillStyle = '#f2d24a'; p.g.fillRect(p.U(-0.2), 0, p.U(0.18) - p.U(-0.2), p.H); });
      p.bar(0.28, 0.16, '#111'); p.bar(-0.28, 0.12, '#111');
      p.g.fillStyle = '#f08030'; p.g.beginPath(); p.g.ellipse(p.U(0.46), p.V(0.02), 5, 3, 0, 0, Math.PI * 2); p.g.fill();
      p.g.fillStyle = '#f4f2ea'; p.g.fillRect(p.U(-0.6), p.V(1.2), p.U(-0.1) - p.U(-0.6), p.V(0.5) - p.V(1.2));
      p.eye(0.07, '#333');
    },
    hab: 'coralPick', count: 10, groups: 5, behavior: 'solo', region: 'coralTops', speed: 0.5, flee: 3, swim: [2.4, 0.04, 4], spread: 1.2,
  },
  {
    id: 'butterfly', name: 'トゲチョウチョウウオ', sci: 'Chaetodon auriga', zone: 'reef', depth: [1, 30], size: 0.18, rarity: 1,
    desc: '白い体に斜めの線、後ろ半分が黄色。背ビレの黒い眼状斑で天敵の目をあざむく。',
    hint: 'サンゴの上をついばむようにペアで泳ぐ。',
    kind: 'fish', fish: { H: 0.72, W: 0.1, peak: 0.55, nose: 0.25, ped: 0.15, tail: 'round', tailL: 0.17, tailH: 0.4, dorsal: [{ a: 0.12, b: 0.72, h: 0.12, sweep: 0.2 }], anal: [{ a: 0.12, b: 0.45, h: 0.12 }], pect: { t: 0.66, len: 0.1, wid: 0.06, down: 0.5 }, eyes: 0.08 },
    paint: (p) => {
      fins(p, '#f2c830'); p.shade('#f8f6ee', '#fbfaf5', '#f2f0e8');
      p.clipBody(() => {
        p.g.strokeStyle = 'rgba(60,60,60,0.55)'; p.g.lineWidth = 1.2;
        for (let i = -8; i < 12; i++) { p.g.beginPath(); p.g.moveTo(p.U(-0.2 + i * 0.05), p.V(0.5)); p.g.lineTo(p.U(-0.2 + i * 0.05 - 0.25), p.V(-0.5)); p.g.stroke(); }
        const gr = p.g.createLinearGradient(p.U(0.05), 0, p.U(-0.3), 0); gr.addColorStop(0, 'rgba(245,200,40,0)'); gr.addColorStop(1, 'rgba(245,200,40,1)');
        p.g.fillStyle = gr; p.g.fillRect(p.U(-0.55), 0, p.U(0.05) - p.U(-0.55), p.H);
        p.g.fillStyle = '#111'; p.g.fillRect(p.U(0.36), 0, p.U(0.42) - p.U(0.36), p.H);
      });
      p.g.fillStyle = '#111'; p.g.beginPath(); p.g.arc(p.U(-0.22), p.V(0.4), 4, 0, Math.PI * 2); p.g.fill();
      p.eye(0.08, '#111');
    },
    hab: 'coralPick', count: 14, groups: 7, behavior: 'solo', region: 'coralTops', speed: 0.4, flee: 2.8, swim: [2.8, 0.04, 4], spread: 1,
  },
  {
    id: 'parrotfish', name: 'ナンヨウブダイ', sci: 'Chlorurus microrhinos', zone: 'reef', depth: [2, 30], size: 0.65, rarity: 2,
    desc: 'くちばしのような歯でサンゴをかじり、消化できない骨格を白い砂として排出する。サンゴ礁の砂の多くは彼らが作る。',
    hint: 'サンゴ礁の底近くを悠々と泳ぐ。',
    kind: 'fish', fish: { H: 0.34, W: 0.18, peak: 0.6, nose: 0.75, ped: 0.15, tail: 'lunate', tailL: 0.2, tailH: 0.36, dorsal: [{ a: 0.18, b: 0.74, h: 0.06, sweep: 0.1 }], anal: [{ a: 0.15, b: 0.4, h: 0.06 }], pect: { t: 0.7, len: 0.12, wid: 0.06, down: 0.4 }, pelvic: true, eyes: 0.1 },
    paint: (p) => {
      fins(p, '#2aa890'); p.shade('#147a70', '#24a090', '#58c0a8'); p.scales(0.2, 5);
      p.clipBody(() => { p.g.fillStyle = 'rgba(240,120,150,0.55)'; for (let i = 0; i < 12; i++) p.g.fillRect(p.U(-0.4 + i * 0.065), p.V(0.12), 3, p.V(-0.12) - p.V(0.12)); });
      p.g.fillStyle = '#e8f0e0'; p.g.beginPath(); p.g.ellipse(p.U(0.49), p.V(-0.01), 5, 4, 0, 0, Math.PI * 2); p.g.fill();
      p.eye(0.1, '#e8a020');
    },
    hab: 'reefRoam', count: 6, groups: 3, behavior: 'school', region: [-180, 160, 140, 335], speed: 0.7, flee: 4, swim: [2.2, 0.06, 4], spread: 3,
  },
  {
    id: 'chromis', name: 'デバスズメダイ', sci: 'Chromis viridis', zone: 'reef', depth: [1, 12], size: 0.08, rarity: 1,
    desc: '青緑色に輝く小さな魚。枝サンゴの上に群れで浮かび、危険が迫るとサンゴの枝の間へ一斉に逃げ込む。',
    hint: '枝サンゴの真上に雲のように群れている。',
    kind: 'fish', fish: { H: 0.38, W: 0.14, peak: 0.6, nose: 0.5, ped: 0.14, tail: 'fork', tailL: 0.28, tailH: 0.46, dorsal: [{ a: 0.2, b: 0.7, h: 0.1 }], anal: [{ a: 0.18, b: 0.42, h: 0.1 }], pect: { t: 0.7, len: 0.1, wid: 0.05, down: 0.4 }, eyes: 0.13, rings: 8, segs: 12 },
    paint: (p) => { fins(p, 'rgba(140,230,220,1)'); p.shade('#40b8c0', '#78e0d8', '#c8f4ee'); p.eye(0.13, '#2a6060'); },
    hab: 'coralHover', count: 200, groups: 16, behavior: 'school', region: 'coralTops', speed: 0.5, flee: 2.5, swim: [6, 0.05, 6], spread: 1.6, mat: { metal: 0.3, rough: 0.35 }, photoRange: 8,
  },
  {
    id: 'lionfish', name: 'ハナミノカサゴ', sci: 'Pterois volitans', zone: 'reef', depth: [2, 50], size: 0.3, rarity: 2,
    desc: '扇のように広がる胸ビレと、毒をもつ長い背ビレの棘。ゆっくりと獲物に近づき、一瞬で吸い込む。',
    hint: 'サンゴや岩の陰にふわりと浮かんでいる。',
    kind: 'fish', fish: { H: 0.32, W: 0.16, peak: 0.6, nose: 0.5, ped: 0.15, tail: 'round', tailL: 0.2, tailH: 0.3, dorsal: [{ a: 0.35, b: 0.82, h: 0.38, jag: 0.6, sweep: 0.25 }, { a: 0.12, b: 0.32, h: 0.14 }], anal: [{ a: 0.15, b: 0.35, h: 0.12 }], pect: { t: 0.7, len: 0.42, wid: 0.32, down: 0.9, out: 0.8 }, eyes: 0.1 },
    paint: (p) => {
      p.fill('#e8d0c0');
      p.g.strokeStyle = '#8a2a18'; p.g.lineWidth = 3;
      for (let i = 0; i < 30; i++) { p.g.beginPath(); p.g.moveTo(i * 10, 0); p.g.lineTo(i * 10 - 30, p.H); p.g.stroke(); }
      p.shade('#a83018', '#d86040', '#f0e0d0');
      p.clipBody(() => { p.g.fillStyle = '#f6eee4'; for (let i = 0; i < 16; i++) p.g.fillRect(p.U(-0.45 + i * 0.06), 0, 2.5, p.H); });
      p.eye(0.1, '#a02010');
    },
    hab: 'under', count: 5, groups: 5, behavior: 'solo', region: 'underTables', speed: 0.12, flee: 1.5, swim: [1.5, 0.02, 3], photoRange: 10,
  },
  // ======================================================== 岩礁
  {
    id: 'moray', name: 'ドクウツボ', sci: 'Gymnothorax javanicus', zone: 'rocky', depth: [3, 50], size: 1.3, rarity: 2,
    desc: '岩の隙間から頭を出し、口を開け閉めして呼吸する。見た目は怖いが、普段は臆病で岩穴から出てこない。',
    hint: '岩礁の大きな岩の隙間をのぞき込もう。',
    kind: 'fish', fish: { H: 0.08, W: 0.07, peak: 0.6, nose: 0.6, ped: 0.4, tail: 'none', dorsal: [{ a: 0.0, b: 0.82, h: 0.025, sweep: 0 }], anal: [{ a: 0.0, b: 0.5, h: 0.02 }], eyes: 0.18, eyeT: 0.93, segs: 30, rings: 8 },
    paint: (p) => { fins(p, '#6a5a2a'); p.shade('#5a4a20', '#7a6a30', '#a09048'); p.blotch(160, 2, 5, ['rgba(20,15,5,0.7)'], true); p.eye(0.18, '#e0c060'); p.mouth('rgba(20,10,5,0.9)', 0.05); },
    count: 5, groups: 5, behavior: 'crevice', region: 'crevices', speed: 0, flee: 0, swim: [0.8, 0.015, 8], photoRange: 9,
  },
  {
    id: 'lobster', name: 'イセエビ', sci: 'Panulirus japonicus', zone: 'rocky', depth: [5, 30], size: 0.35, rarity: 2,
    desc: '長い触角をもつ大型のエビ。昼間は岩穴に潜み、夜になると出てきて貝などを食べる。',
    hint: '岩の隙間から長い触角がのぞいている。',
    kind: 'lobster',
    paint: (p) => { p.fill('#8a3a20'); p.blotch(80, 2, 6, ['rgba(250,200,120,0.4)', 'rgba(60,20,10,0.5)']); for (let i = 0; i < 8; i++) { p.g.fillStyle = 'rgba(240,220,160,0.6)'; p.g.fillRect(0, i * 32 + 12, p.W, 3); } },
    tex: [128, 256],
    count: 6, groups: 6, behavior: 'crevice', region: 'crevices', speed: 0, flee: 0, swim: [1.2, 0.04, 3], photoRange: 7,
  },
  {
    id: 'octopus', name: 'マダコ', sci: 'Octopus sinensis', zone: 'rocky', depth: [2, 40], size: 0.6, rarity: 2,
    desc: '高い知能をもち、皮膚の色や質感を一瞬で変えて岩に溶け込む。危険を感じると墨を吐いて逃げる。',
    hint: '岩礁の岩の上。擬態しているのでよく見て。',
    kind: 'octopus',
    paint: (p) => { p.fill('#7a5a40'); p.blotch(160, 3, 10, ['rgba(160,110,70,0.6)', 'rgba(50,30,20,0.5)', 'rgba(200,170,130,0.4)']); },
    tex: [256, 256],
    count: 3, groups: 3, behavior: 'static', region: 'rockSpots', speed: 0, flee: 2.5, swim: [0.7, 0.05, 1], photoRange: 8,
  },
  {
    id: 'knifejaw', name: 'イシダイ', sci: 'Oplegnathus fasciatus', zone: 'rocky', depth: [3, 30], size: 0.45, rarity: 1,
    desc: '白地に7本の黒い横縞。硬いくちばし状の歯でウニや貝を噛み砕く、磯の王者。',
    hint: '岩礁の中層を小さな群れで泳ぐ。',
    kind: 'fish', fish: { H: 0.5, W: 0.15, peak: 0.6, nose: 0.6, ped: 0.15, tail: 'truncate', tailL: 0.18, tailH: 0.36, dorsal: [{ a: 0.18, b: 0.72, h: 0.12, jag: 0.3 }], anal: [{ a: 0.15, b: 0.38, h: 0.12 }], pect: { t: 0.7, len: 0.12, wid: 0.07, down: 0.5 }, pelvic: true, eyes: 0.09 },
    paint: (p) => { fins(p, '#3a3a3a'); p.shade('#c8c8c0', '#e0e0d8', '#f0f0e8'); for (let i = 0; i < 7; i++) p.bar(0.38 - i * 0.12, 0.045, '#1c1c1c'); p.scales(0.15, 4); p.eye(0.09, '#d0b040'); },
    hab: 'rockyRoam', count: 9, groups: 3, behavior: 'school', region: [60, 200, 50, 330], speed: 0.6, flee: 3.5, swim: [2.6, 0.05, 4], spread: 2,
  },
  {
    id: 'nudibranch', name: 'アオウミウシ', sci: 'Hypselodoris festiva', zone: 'rocky', depth: [1, 25], size: 0.06, rarity: 2,
    desc: '鮮やかな青に黄色の縁取り。派手な色は「毒があるぞ」という警告。カイメンを食べて暮らす。',
    hint: 'とても小さい。岩の表面をじっくり探そう。',
    kind: 'nudi',
    paint: (p) => { p.fill('#2040d0'); p.g.fillStyle = '#f8d020'; p.g.fillRect(0, 0, p.W * 0.12, p.H); p.g.fillRect(p.W * 0.88, 0, p.W * 0.12, p.H); p.g.fillRect(p.W * 0.47, 0, p.W * 0.06, p.H); p.g.fillStyle = '#101010'; p.g.fillRect(p.W * 0.3, 0, p.W * 0.04, p.H); p.g.fillRect(p.W * 0.66, 0, p.W * 0.04, p.H); p.g.fillStyle = '#f08020'; p.g.fillRect(0, 0, p.W, p.H * 0.08); },
    tex: [64, 128],
    count: 10, groups: 10, behavior: 'static', region: 'rockSpots', speed: 0, flee: 0, swim: [0.5, 0.05, 2], photoRange: 3.2, mat: { rough: 0.3 },
  },
  {
    id: 'whitetip', name: 'ネムリブカ', sci: 'Triaenodon obesus', zone: 'rocky', depth: [8, 40], size: 1.5, rarity: 2,
    desc: '昼間は岩陰や砂地でじっと休んでいることが多い、おとなしいサメ。ヒレの先が白い。夜に狩りをする。',
    hint: '岩礁のまわりの砂地近くをゆっくり泳ぐ。',
    kind: 'fish', fish: { H: 0.15, W: 0.15, peak: 0.6, nose: 0.6, ped: 0.15, tail: 'hetero', tailL: 0.25, tailH: 0.3, dorsal: [{ a: 0.5, b: 0.66, h: 0.11, sweep: 0.6 }, { a: 0.18, b: 0.24, h: 0.05 }], anal: [{ a: 0.18, b: 0.25, h: 0.04 }], pect: { t: 0.64, len: 0.2, wid: 0.1, down: 0.35, out: 0.7 }, eyes: 0.06, eyeT: 0.9 },
    paint: (p) => {
      fins(p, '#7a7e80'); p.g.fillStyle = '#f4f4f2'; p.g.fillRect(p.U(-0.75), p.V(0.3), p.U(-0.62) - p.U(-0.75), p.V(0.18) - p.V(0.3));
      p.g.fillRect(p.U(0.08), p.V(0.21), p.U(0.12) - p.U(0.08), 5);
      p.shade('#6e7274', '#868a8c', '#e8e8e6', 0.55); p.noise(0.15); p.eye(0.06, '#555'); p.gill('rgba(0,0,0,0.3)', 0.78);
    },
    count: 3, groups: 3, behavior: 'solo', region: [50, 200, 60, 340], speed: 0.6, flee: 2.5, swim: [1.2, 0.06, 3], photoRange: 16,
  },
  // ======================================================== 沖
  {
    id: 'sardine', name: 'マイワシ', sci: 'Sardinops melanostictus', zone: 'offshore', depth: [4, 30], size: 0.2, rarity: 1,
    desc: '銀色に輝く体の側面に黒い点が並ぶ。巨大な群れ「ベイトボール」をつくり、捕食者から身を守る。',
    hint: '沖の中層。キラキラ光る大群を探せ。',
    kind: 'fish', fish: { H: 0.2, W: 0.12, peak: 0.6, nose: 0.4, ped: 0.08, tail: 'fork', tailL: 0.26, tailH: 0.3, dorsal: [{ a: 0.42, b: 0.56, h: 0.07 }], pect: { t: 0.72, len: 0.08, wid: 0.03, down: 0.6 }, eyes: 0.16, rings: 8, segs: 12 },
    paint: (p) => { fins(p, 'rgba(160,180,190,1)'); p.shade('#1e4a6a', '#a8c0cc', '#eef4f6', 0.4); p.clipBody(() => { for (let i = 0; i < 9; i++) { p.g.fillStyle = '#10202a'; p.g.beginPath(); p.g.arc(p.U(0.3 - i * 0.07), p.V(0.0), 2, 0, Math.PI * 2); p.g.fill(); } }); p.eye(0.16, '#c0c8d0'); },
    count: 260, groups: 2, behavior: 'school', region: [-120, 120, 360, 700], speed: 1.6, flee: 5, swim: [7, 0.04, 6], spread: 7, mat: { metal: 0.65, rough: 0.25 }, photoRange: 20,
  },
  {
    id: 'tuna', name: 'クロマグロ', sci: 'Thunnus orientalis', zone: 'offshore', depth: [5, 60], size: 2.0, rarity: 2,
    desc: '時速80kmにもなる海の超特急。体温を水温より高く保つ特殊な仕組みをもち、大海原を回遊する。',
    hint: '沖の群れ（イワシ）を狙って高速で現れる。',
    kind: 'fish', fish: { H: 0.26, W: 0.2, peak: 0.55, nose: 0.3, ped: 0.04, tail: 'lunate', tailL: 0.2, tailH: 0.5, dorsal: [{ a: 0.48, b: 0.62, h: 0.1, sweep: 0.3 }, { a: 0.3, b: 0.38, h: 0.1, sweep: 0.5 }], anal: [{ a: 0.3, b: 0.38, h: 0.09 }], pect: { t: 0.7, len: 0.16, wid: 0.04, down: 0.3, out: 0.7 }, eyes: 0.1 },
    paint: (p) => {
      fins(p, '#2a3448'); p.shade('#0c1a38', '#506a88', '#e8eef2', 0.45); p.noise(0.08, false);
      p.clipBody(() => { for (let i = 0; i < 7; i++) { p.g.fillStyle = '#f0c020'; p.g.fillRect(p.U(-0.45 + i * 0.035), p.V(0.06), 3, 3); p.g.fillRect(p.U(-0.45 + i * 0.035), p.V(-0.06), 3, 3); } });
      p.eye(0.1, '#888'); p.gill('rgba(0,0,0,0.25)', 0.78);
    },
    count: 7, groups: 1, behavior: 'pelagic', region: [-150, 150, 380, 720], speed: 3.2, flee: 6, swim: [3.5, 0.03, 3], spread: 4, mat: { metal: 0.5, rough: 0.3 }, photoRange: 22,
  },
  {
    id: 'manta', name: 'オニイトマキエイ', sci: 'Mobula birostris', zone: 'dropoff', depth: [5, 40], size: 4.2, rarity: 3,
    desc: '翼を広げると5mを超える世界最大級のエイ。プランクトンを頭の前の頭鰭で口へ流し込んで食べる。',
    hint: 'ドロップオフの壁沿い、浅めの中層を舞うように泳ぐ。',
    kind: 'ray', ray: { span: 1.0, len: 0.42, thick: 0.05, manta: true },
    paint: (p) => {
      p.fill('#f0f0ee'); p.g.fillStyle = '#16181c'; p.g.fillRect(0, 0, p.W, p.H / 2);
      p.g.fillStyle = 'rgba(240,240,240,0.7)'; p.g.beginPath(); p.g.ellipse(p.W * 0.62, p.H * 0.12, 20, 9, 0.4, 0, Math.PI * 2); p.g.fill(); p.g.beginPath(); p.g.ellipse(p.W * 0.62, p.H * 0.38, 20, 9, -0.4, 0, Math.PI * 2); p.g.fill();
      p.g.fillStyle = '#f4f4f2'; p.g.fillRect(0, p.H / 2, p.W, p.H / 2);
      p.blotch(14, 3, 8, ['rgba(30,30,35,0.7)']);
      p.g.fillStyle = '#26282c'; p.g.fillRect(0, p.H * 0.5, p.W, 6); p.g.fillRect(0, p.H - 6, p.W, 6);
    },
    tex: [256, 256],
    count: 2, groups: 2, behavior: 'pelagic', region: [-160, 160, 330, 470], speed: 1.1, flee: 0, curious: true, flap: [0.32, 0.2, 2.5], photoRange: 30,
  },
  {
    id: 'whaleshark', name: 'ジンベエザメ', sci: 'Rhincodon typus', zone: 'offshore', depth: [3, 40], size: 9, rarity: 3,
    desc: '全長10mを超える世界最大の魚。大きな口で海水ごとプランクトンを吸い込む、おだやかな巨人。',
    hint: '沖の浅い中層。大きな影を探そう。',
    kind: 'fish', fish: { H: 0.17, W: 0.2, headW: 1.45, peak: 0.62, nose: 0.95, ped: 0.08, belly: 0.02, tail: 'hetero', tailL: 0.22, tailH: 0.36, dorsal: [{ a: 0.42, b: 0.6, h: 0.1, sweep: 0.5 }, { a: 0.18, b: 0.24, h: 0.04 }], anal: [{ a: 0.18, b: 0.24, h: 0.035 }], pect: { t: 0.66, len: 0.2, wid: 0.08, down: 0.25, out: 0.7 }, eyes: 0.04, eyeT: 0.93 },
    paint: (p) => {
      fins(p, '#2c3a48'); p.shade('#243444', '#3a4c5c', '#d8dcdc', 0.58);
      p.clipBody(() => {
        p.g.fillStyle = 'rgba(235,240,240,0.9)';
        for (let i = 0; i < 260; i++) { const z = p.rnd() - 0.5, y = p.rnd() * 0.09; p.g.beginPath(); p.g.arc(p.U(z), p.V(y), 1.4 + p.rnd() * 1.2, 0, Math.PI * 2); p.g.fill(); }
        p.g.strokeStyle = 'rgba(220,225,225,0.6)'; p.g.lineWidth = 1;
        for (let i = 0; i < 16; i++) { p.g.beginPath(); p.g.moveTo(p.U(-0.4 + i * 0.05), p.V(0.09)); p.g.lineTo(p.U(-0.4 + i * 0.05), p.V(0.0)); p.g.stroke(); }
        p.g.fillStyle = '#101418'; p.g.fillRect(p.U(0.47), p.V(0.0), p.U(0.5) - p.U(0.47), 3);
      });
      p.eye(0.04, '#333'); for (let i = 0; i < 5; i++) p.gill('rgba(0,0,0,0.35)', 0.72 + i * 0.025);
    },
    count: 1, groups: 1, behavior: 'pelagic', region: [-100, 100, 400, 680], speed: 0.9, flee: 0, curious: true, swim: [0.45, 0.06, 2.4], photoRange: 45,
  },
  {
    id: 'hammerhead', name: 'アカシュモクザメ', sci: 'Sphyrna lewini', zone: 'dropoff', depth: [15, 60], size: 2.6, rarity: 3,
    desc: 'T字型の頭部「頭翼」で獲物の電気を感じ取る。時には数百匹もの大群をつくることがある。',
    hint: 'ドロップオフの深め。群れで回遊している。',
    kind: 'fish', fish: { H: 0.14, W: 0.13, peak: 0.6, nose: 0.6, ped: 0.08, tail: 'hetero', tailL: 0.26, tailH: 0.32, dorsal: [{ a: 0.5, b: 0.64, h: 0.14, sweep: 0.6 }, { a: 0.18, b: 0.24, h: 0.04 }], anal: [{ a: 0.18, b: 0.25, h: 0.04 }], pect: { t: 0.64, len: 0.18, wid: 0.08, down: 0.35, out: 0.7 }, ceph: 0.32, eyes: 0, eyeT: 0.9 },
    paint: (p) => { fins(p, '#6a7480'); p.shade('#5a6672', '#7a8692', '#e4e8ea', 0.55); p.noise(0.1); for (let i = 0; i < 5; i++) p.gill('rgba(0,0,0,0.3)', 0.74 + i * 0.02); },
    count: 9, groups: 1, behavior: 'pelagic', region: [-140, 140, 360, 520], speed: 1.2, flee: 7, swim: [1.1, 0.06, 3], spread: 5, photoRange: 28,
  },
  {
    id: 'dolphin', name: 'ミナミハンドウイルカ', sci: 'Tursiops aduncus', zone: 'offshore', depth: [0, 25], size: 2.3, rarity: 2,
    desc: '高い知能と好奇心をもつ海の哺乳類。群れで暮らし、ダイバーに近づいて遊ぶこともある。息継ぎのため水面へ。',
    hint: '沖の水面近く。好奇心旺盛でこちらに寄ってくる。',
    kind: 'fish', fish: { H: 0.2, W: 0.2, peak: 0.55, nose: 0.2, ped: 0.06, tail: 'flukes', tailL: 0.14, tailH: 0.32, dorsal: [{ a: 0.42, b: 0.56, h: 0.13, sweep: 0.8 }], pect: { t: 0.72, len: 0.14, wid: 0.06, down: 0.6, out: 0.6 }, eyes: 0.06, eyeT: 0.85, bendY: true },
    paint: (p) => { fins(p, '#5a646e'); p.shade('#4a545e', '#7a8690', '#e2e6e8', 0.55); p.clipBody(() => { p.g.fillStyle = '#3a4048'; p.g.fillRect(p.U(0.42), p.V(0.06), p.U(0.5) - p.U(0.42), p.V(-0.02) - p.V(0.06)); }); p.eye(0.06, '#222'); },
    count: 5, groups: 1, behavior: 'pelagic', region: [-150, 150, 380, 700], speed: 2.6, flee: 0, curious: true, swim: [1.5, 0.08, 2], spread: 4, mat: { rough: 0.3 }, photoRange: 26,
  },
  {
    id: 'humpback', name: 'ザトウクジラ', sci: 'Megaptera novaeangliae', zone: 'offshore', depth: [5, 45], size: 13, rarity: 3,
    desc: '長い胸ビレと複雑な「歌」で知られる大型のクジラ。冬になると暖かい海へ子育てにやってくる。',
    hint: '沖の深い青の中。遠くから歌声が聞こえたら近い。',
    kind: 'fish', fish: { H: 0.2, W: 0.22, peak: 0.58, nose: 0.85, ped: 0.06, belly: 0.12, tail: 'flukes', tailL: 0.14, tailH: 0.3, dorsal: [{ a: 0.32, b: 0.38, h: 0.03 }], pect: { t: 0.66, len: 0.33, wid: 0.05, down: 0.6, out: 0.6 }, eyes: 0.04, eyeT: 0.8, bendY: true },
    paint: (p) => {
      fins(p, '#e8eaea'); p.shade('#14181c', '#1e2428', '#2e3236', 0.7); p.noise(0.15, false);
      p.clipBody(() => { p.g.strokeStyle = 'rgba(220,220,220,0.5)'; p.g.lineWidth = 1; for (let i = 0; i < 12; i++) { p.g.beginPath(); p.g.moveTo(p.U(0.48), p.V(-0.03 - i * 0.006)); p.g.lineTo(p.U(0.02), p.V(-0.06 - i * 0.004)); p.g.stroke(); } p.g.fillStyle = 'rgba(30,30,30,0.8)'; for (let i = 0; i < 18; i++) { p.g.beginPath(); p.g.arc(p.U(0.38 + p.rnd() * 0.11), p.V(0.04 + p.rnd() * 0.05), 1.6, 0, Math.PI * 2); p.g.fill(); } });
      p.blotch(30, 2, 5, ['rgba(200,200,200,0.4)'], true); p.eye(0.04, '#111');
    },
    count: 1, groups: 1, behavior: 'pelagic', region: [-120, 120, 520, 715], speed: 1.3, flee: 0, curious: true, swim: [0.3, 0.05, 1.6], photoRange: 70,
  },
  {
    id: 'moonjelly', name: 'ミズクラゲ', sci: 'Aurelia coerulea', zone: 'offshore', depth: [1, 20], size: 0.3, rarity: 1,
    desc: '透きとおった傘に4つの輪（生殖腺）が見える。泳ぐ力は弱く、海流にのって漂う。',
    hint: 'ドロップオフから沖の浅い所をふわふわ漂う。',
    kind: 'jelly', jelly: { tentacles: 28, tentLen: 0.2, oral: true, flat: 0.45 },
    paint: (p) => {
      p.fill('rgba(220,235,245,0.9)'); const g = p.g;
      for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2 + 0.4; g.strokeStyle = 'rgba(230,140,200,0.95)'; g.lineWidth = 5; g.beginPath(); g.ellipse(p.W / 2 + Math.cos(a) * 26, p.H / 2 + Math.sin(a) * 26, 14, 9, a, 0, Math.PI * 2); g.stroke(); }
      g.strokeStyle = 'rgba(255,255,255,0.6)'; g.lineWidth = 1; for (let i = 0; i < 32; i++) { const a = (i / 32) * Math.PI * 2; g.beginPath(); g.moveTo(p.W / 2, p.H / 2); g.lineTo(p.W / 2 + Math.cos(a) * 128, p.H / 2 + Math.sin(a) * 128); g.stroke(); }
    },
    tex: [256, 256],
    count: 40, groups: 4, behavior: 'drift', region: [-150, 150, 330, 640], speed: 0.1, flee: 0, pulse: [1.1, 0.12], swim: [0.8, 0.08, 2], spread: 9, mat: { translucent: 0.42, rough: 0.2 }, photoRange: 9,
  },
  // ======================================================== 深海
  {
    id: 'atolla', name: 'ムラサキカムリクラゲ', sci: 'Atolla wyvillei', zone: 'deep', depth: [200, 430], size: 0.18, rarity: 2,
    desc: '深海に暮らす赤いクラゲ。襲われると青い光を傘の縁にぐるぐると走らせ「警報」を発する。',
    hint: '深海の中層。暗闇に灯る青い光の輪。',
    kind: 'jelly', jelly: { tentacles: 22, tentLen: 0.35, flat: 0.5, glowRim: true },
    paint: (p) => { p.fill('#6a0a18'); const gr = p.g.createRadialGradient(p.W / 2, p.H / 2, 4, p.W / 2, p.H / 2, 110); gr.addColorStop(0, '#300408'); gr.addColorStop(0.6, '#8a1020'); gr.addColorStop(1, '#a02030'); p.g.fillStyle = gr; p.g.fillRect(0, 0, p.W, p.H); },
    tex: [256, 256],
    count: 14, groups: 6, behavior: 'drift', region: [-150, 150, 730, 1060], speed: 0.12, flee: 0, pulse: [0.7, 0.1], swim: [0.6, 0.08, 2], spread: 10, mat: { translucent: 0.8, glow: 0x3a8cff, rough: 0.3 }, photoRange: 12,
  },
  {
    id: 'angler', name: 'チョウチンアンコウ', sci: 'Himantolophus groenlandicus', zone: 'deep', depth: [250, 430], size: 0.3, rarity: 3,
    desc: '頭から伸びた「誘引突起」の先端を発光細菌で光らせ、近寄ってきた獲物を大きな口で丸のみにする。',
    hint: '深海の底近く。暗闇でゆらめく小さな光をたどれ。',
    kind: 'fish', fish: { H: 0.75, W: 0.62, peak: 0.55, nose: 0.95, ped: 0.2, tail: 'round', tailL: 0.22, tailH: 0.3, dorsal: [{ a: 0.12, b: 0.25, h: 0.08 }], anal: [{ a: 0.12, b: 0.22, h: 0.08 }], pect: { t: 0.5, len: 0.12, wid: 0.08, down: 0.3 }, lure: true, eyes: 0.05, eyeT: 0.8, rings: 12 },
    paint: (p) => { fins(p, '#1a1614'); p.shade('#1e1a18', '#2a2420', '#3a302a'); p.noise(0.4); p.clipBody(() => { p.g.fillStyle = '#0a0808'; p.g.beginPath(); p.g.ellipse(p.U(0.48), p.V(-0.05), 12, 10, 0, 0, Math.PI * 2); p.g.fill(); p.g.fillStyle = '#e8e0d0'; for (let i = 0; i < 9; i++) { p.g.beginPath(); p.g.moveTo(p.U(0.42) + i * 2.6, p.V(0.04)); p.g.lineTo(p.U(0.42) + i * 2.6 + 1, p.V(-0.04)); p.g.lineTo(p.U(0.42) + i * 2.6 + 2, p.V(0.04)); p.g.fill(); } }); p.eye(0.05, '#334'); },
    count: 3, groups: 3, behavior: 'solo', region: [-120, 140, 860, 1060], speed: 0.15, flee: 0, swim: [1.3, 0.03, 3], mat: { glow: 0x9fe6ff, rough: 0.5 }, photoRange: 9,
  },
  {
    id: 'giantsquid', name: 'ダイオウイカ', sci: 'Architeuthis dux', zone: 'deep', depth: [250, 420], size: 9, rarity: 3,
    desc: '全長10mを超える伝説の巨大イカ。直径30cmにもなる巨大な目で、暗闇の中の天敵マッコウクジラを見張る。',
    hint: '深海の中層の奥深く。めったに出会えない。',
    kind: 'squid', squid: { armLen: 0.35, tentLen: 0.8, finSize: 0.12 },
    paint: (p) => { p.fill('#8a2818'); p.blotch(200, 2, 6, ['rgba(220,100,70,0.5)', 'rgba(60,10,5,0.4)']); p.g.fillStyle = '#c8d0d8'; p.g.beginPath(); p.g.arc(p.W * 0.62, p.H * 0.52, 7, 0, Math.PI * 2); p.g.fill(); },
    tex: [256, 128],
    count: 1, groups: 1, behavior: 'solo', region: [-100, 120, 820, 1050], speed: 0.6, flee: 0, swim: [0.4, 0.06, 4], flap: [0.5, 0.1, 1], photoRange: 36,
  },
  {
    id: 'oarfish', name: 'リュウグウノツカイ', sci: 'Regalecus russelii', zone: 'deep', depth: [150, 320], size: 5.5, rarity: 3,
    desc: '銀色の帯のような体に赤いたてがみ状の背ビレ。体を垂直に立てて漂う姿が目撃されている。',
    hint: '深海の入口。銀の帯がゆっくり立ち泳ぎしている。',
    kind: 'fish', fish: { H: 0.05, W: 0.012, peak: 0.85, nose: 0.6, ped: 0.15, tail: 'none', dorsal: [{ a: 0.0, b: 0.97, h: 0.03, sweep: 0 }, { a: 0.92, b: 0.99, h: 0.12, sweep: 0.3 }], pect: { t: 0.92, len: 0.03, wid: 0.01, down: 0.3 }, eyes: 0.3, eyeT: 0.97, segs: 40, rings: 8 },
    paint: (p) => { fins(p, '#e02a30'); p.shade('#a8b4c0', '#dfe6ec', '#c8d0d8'); p.clipBody(() => { p.g.fillStyle = 'rgba(60,70,90,0.5)'; for (let i = 0; i < 160; i++) p.g.fillRect(p.rnd() * p.W, p.V(-0.02 + p.rnd() * 0.04), 2, 1); }); p.eye(0.3, '#ccc'); },
    count: 2, groups: 2, behavior: 'solo', region: [-140, 140, 720, 900], speed: 0.3, flee: 0, swim: [0.6, 0.05, 6], mat: { metal: 0.7, rough: 0.25 }, photoRange: 30,
  },
  {
    id: 'dumbo', name: 'メンダコ', sci: 'Opisthoteuthis depressa', zone: 'deep', depth: [200, 430], size: 0.25, rarity: 2,
    desc: 'ひらべったい体と耳のようなヒレがかわいい深海のタコ。ヒレをぱたぱた動かして海底近くを泳ぐ。',
    hint: '深海の海底近く。オレンジ色の小さな影。',
    kind: 'dumbo',
    paint: (p) => { p.fill('#e06a30'); p.blotch(60, 3, 9, ['rgba(255,150,90,0.5)', 'rgba(160,50,20,0.4)']); },
    tex: [128, 128],
    count: 5, groups: 5, behavior: 'bottom', region: [-140, 160, 820, 1060], speed: 0.15, flee: 0, pulse: [0.8, 0.06], flap: [1.0, 0.1, 0], mat: { rough: 0.5 }, photoRange: 9,
  },
  {
    id: 'isopod', name: 'ダイオウグソクムシ', sci: 'Bathynomus giganteus', zone: 'deep', depth: [250, 430], size: 0.4, rarity: 2,
    desc: 'ダンゴムシの仲間で最大級。海底に落ちてくる死骸を食べる深海の掃除屋。何年も絶食できるという。',
    hint: '深海の海底、熱水噴出孔の近くを這っている。',
    kind: 'isopod',
    paint: (p) => { p.fill('#c8b8a0'); for (let i = 0; i < 9; i++) { p.g.fillStyle = 'rgba(120,100,80,0.6)'; p.g.fillRect(0, i * 28 + 22, p.W, 4); } p.noise(0.25, true, false); },
    tex: [128, 256],
    count: 6, groups: 6, behavior: 'bottom', region: 'vent', speed: 0.06, flee: 0, swim: [1.5, 0.02, 3], photoRange: 8,
  },
  {
    id: 'tubeworm', name: 'ハオリムシ', sci: 'Lamellibrachia satsuma', zone: 'deep', depth: [300, 430], size: 1.2, rarity: 2,
    desc: '口も消化管もなく、体内の共生細菌が熱水の硫化水素からつくる栄養で生きる。熱水噴出孔に群生する。',
    hint: '深海の熱水噴出孔（ブラックスモーカー）のまわり。',
    kind: 'none',
    count: 1, groups: 1, behavior: 'static', region: 'vent', speed: 0, flee: 0, photoRange: 18,
  },
];

import { MORE_SPECIES } from './species2';
import { INVERTS } from './species3';
import { MORE_FISH } from './species4';
import { FISH_300 } from './species5';
import { INVERTS_2 } from './species6';
import { COLD_SPECIES } from './species7';
import { WILD_SPECIES } from './species8';
import { SITE_SPECIES } from './species9';
import { KELP_SPECIES } from './species10';
import { MORE_600 } from './species11';
SPECIES.push(...MORE_SPECIES, ...MORE_FISH, ...FISH_300, ...INVERTS, ...INVERTS_2, ...COLD_SPECIES, ...WILD_SPECIES, ...SITE_SPECIES, ...KELP_SPECIES, ...MORE_600);

export const SPECIES_BY_ID = new Map(SPECIES.map((s) => [s.id, s]));
export const ZONE_ORDER: ZoneId[] = ['lagoon', 'reef', 'rocky', 'dropoff', 'offshore', 'deep'];
