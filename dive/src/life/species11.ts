import { buildClam, buildCrustacean, buildCucumber, buildSpindle, buildStar, buildTreeWorm, buildUrchin, type FishShape } from './models';
import type { Paint } from './paint';
import { paintLook, type Look } from './paint';
import type { Habitat, Region, SpeciesDef } from './species';
import { F, sh, type FishSpec } from './species2';
import { BLUEHOLE, type ZoneId } from '../world/layout';

// Species 453-600 (generated from a data table by scripts kept outside the repo; edit here directly).
// Spawn region follows zone + habitat so each animal lives where it belongs.

const ZR: Record<ZoneId, Region> = {
  lagoon: [-180, 180, -50, 115], reef: [-190, 190, 135, 335], rocky: [60, 200, 60, 330], dropoff: [-170, 170, 335, 470],
  offshore: [-150, 150, 380, 700], deep: [-150, 150, 730, 1060], cold: [-415, -232, -20, 320], ruins: [-400, -262, 430, 598],
  bluehole: [BLUEHOLE.x - 42, BLUEHOLE.x + 42, BLUEHOLE.z - 40, BLUEHOLE.z + 40], cave: [-372, -292, 860, 975], kelp: [236, 422, 50, 390],
  // Phase 9 (no species yet): estuary and river rectangles from PHASE9-DESIGN §1.2
  estuary: [190, 410, -300, -60], river: [200, 345, -640, -300],
};
const RECT_HABS: Habitat[] = ['reefRoam', 'rockyRoam', 'midwater', 'surface'];

function regionFor(zone: ZoneId, hab: Habitat): Region | undefined {
  if (zone === 'cave') return 'caveSpots';
  if (hab === 'perch' || hab === 'under') {
    if (zone === 'rocky') return 'rockSpots';
    if (zone === 'cold') return 'coldSpots';
    if (zone === 'kelp') return 'kelpSpots';
    if (zone === 'reef' || zone === 'lagoon') return undefined;
    return ZR[zone];
  }
  if (hab === 'sandForage' && zone !== 'reef' && zone !== 'lagoon') return ZR[zone];
  if (RECT_HABS.includes(hab)) return ZR[zone];
  return undefined;
}

type Body = Parameters<typeof sh>[0];
export const b = (k: Body, o: Partial<FishShape> = {}) => sh(k, o);
export const fx = (id: string, name: string, sci: string, zone: ZoneId, d: [number, number], size: number, r: 1 | 2 | 3 | 4, body: FishSpec['body'], hab: Habitat, n: number, look: Look, desc: string, x: Partial<FishSpec> & { region?: Region; glow?: number } = {}): SpeciesDef => {
  const region = x.region ?? regionFor(zone, hab);
  return F({ id, name, sci, zone, d, size, r, body, hab, n, look, desc, ...(region ? { region } : {}), ...x });
};

/** simple painter: base colour, scattered dots, a stripe colour used as rim / bands */
const paint = (pt: [string, string | null, number, string | null]) => (p: Paint) => {
  const [base, dot, nd, stripe] = pt;
  p.fill(base);
  if (stripe) { p.g.fillStyle = stripe; p.g.fillRect(0, 0, p.W * 0.1, p.H); p.g.fillRect(p.W * 0.9, 0, p.W * 0.1, p.H); for (let i = 0; i < 4; i++) p.g.fillRect(0, (i + 0.5) * p.H / 4, p.W, Math.max(1, p.H / 40)); }
  if (dot) { p.g.fillStyle = dot; for (let i = 0; i < (nd || 30); i++) { p.g.beginPath(); p.g.arc(p.rnd() * p.W, p.rnd() * p.H, 1 + p.rnd() * 2.2, 0, Math.PI * 2); p.g.fill(); } }
};

const HAB_TEXT: Record<string, string> = {
  nudi: '岩やサンゴの上をゆっくり這う', star: '岩や砂の上でじっとしている', urchin: '岩の上や隙間にいる', cuke: '海底の砂を食べながらゆっくり動く',
  clam: '岩やサンゴにくっついている', spindle: '海底をゆっくり這う', worm: '岩に管を立てて触手を広げる', shrimp: '岩陰やサンゴの隙間にいる',
  crab: '海底を歩き回る', lobster: '岩の割れ目に隠れる', jelly: '水中をふわふわ漂う', squid: '中層を泳ぐ', octo: '岩や砂の上にじっとしている',
  turtle: 'ゆったり泳ぎ回る', ray: '海底近くを滑るように泳ぐ', cet: '群れで泳ぎ回り、息継ぎに浮上する',
};
const ZONE_TEXT: Record<ZoneId, string> = { lagoon: '浅瀬ラグーン', reef: 'サンゴ礁', rocky: '岩礁', dropoff: 'ドロップオフ', offshore: '沖の大海原', deep: '深海', cold: '流氷の入り江', ruins: '海底遺跡', bluehole: 'ブルーホール', cave: '水中洞窟', kelp: '海藻の森', estuary: '河口', river: '川' };

/** non-fish animal from a compact row */
export function nf(tag: string, id: string, name: string, sci: string, zone: ZoneId, d: [number, number], size: number, r: 1 | 2 | 3 | 4, prm: Record<string, unknown>, pt: [string, string | null, number, string | null], count: number, groups: number, desc: string, xg: Partial<SpeciesDef> & { glow?: number } = {}): SpeciesDef {
  const { glow, ...x } = xg;
  const base = { id, name, sci, zone, depth: d, size, rarity: r, desc, hint: `${ZONE_TEXT[zone]}。${HAB_TEXT[tag]}。`, habLabel: HAB_TEXT[tag] };
  const sessile = zone === 'rocky' ? 'rockSpots' : zone === 'cold' ? 'coldSpots' : zone === 'kelp' ? 'kelpSpots' : zone === 'reef' ? 'bommieSpots' : zone === 'lagoon' ? 'sandSpots' : ZR[zone];
  const def = (o: Partial<SpeciesDef>): SpeciesDef => {
    const d2 = { ...base, paint: paint(pt), count: count || 8, groups: groups || 8, behavior: 'static', region: sessile, speed: 0, flee: 0, photoRange: Math.max(3, size * 12 + 2), ...o, ...x } as SpeciesDef;
    if (glow) d2.mat = { ...(d2.mat ?? {}), glow };
    return d2;
  };
  switch (tag) {
    case 'nudi': return def({ kind: 'nudi', tex: [64, 128], count: 6, groups: 6, photoRange: 3, mat: { rough: 0.3 } });
    case 'star': return def({ kind: 'inv', build: () => buildStar(prm as Parameters<typeof buildStar>[0]), tex: [128, 128] });
    case 'urchin': return def({ kind: 'inv', build: () => buildUrchin(prm as Parameters<typeof buildUrchin>[0]), tex: [64, 128] });
    case 'cuke': return def({ kind: 'inv', build: () => buildCucumber(prm as Parameters<typeof buildCucumber>[0]), tex: [128, 128], behavior: 'bottom', region: ZR[zone], speed: 0.01, spread: 3 });
    case 'clam': return def({ kind: 'inv', build: () => buildClam(prm as Parameters<typeof buildClam>[0]), tex: [128, 128] });
    case 'spindle': return def({ kind: 'inv', build: () => buildSpindle(prm as Parameters<typeof buildSpindle>[0]), tex: [64, 128] });
    case 'worm': return def({ kind: 'inv', build: () => buildTreeWorm(), tex: [64, 64] });
    case 'shrimp': return def({ kind: 'inv', build: () => buildCrustacean({ shrimp: true }), tex: [64, 128], flee: 1 });
    case 'crab': return def({ kind: 'isopod', tex: [128, 256], behavior: 'bottom', region: ZR[zone], speed: 0.06, spread: 2 });
    case 'lobster': return def({ kind: 'lobster', tex: [128, 256], flee: 1.5 });
    case 'jelly': return def({ kind: 'jelly', jelly: prm as SpeciesDef['jelly'], tex: [256, 256], behavior: 'drift', region: ZR[zone], speed: 0.1, pulse: [1.2, 0.12], swim: [0.8, 0.08, 2], spread: 6, mat: { translucent: 0.5, rough: 0.2 } });
    case 'squid': return def({ kind: 'squid', squid: prm as SpeciesDef['squid'], tex: [256, 128], behavior: 'school', region: ZR[zone], speed: 0.4, flee: 2.5, spread: 2 });
    case 'octo': return def({ kind: 'octopus', tex: [256, 256], flee: 2, swim: [0.7, 0.05, 1] });
    case 'turtle': return def({ kind: 'turtle', tex: [256, 256], behavior: 'solo', region: ZR[zone], speed: 0.4, flee: 2, flap: [0.6, 0.22, 0.5] });
    case 'ray': return def({ kind: 'ray', ray: prm as SpeciesDef['ray'], tex: [256, 256], behavior: 'bottom', region: ZR[zone], speed: 0.6, flee: 4, flap: [0.9, 0.06, 4], swim: [0.8, 0.12, 2] });
    case 'cet': {
      const o = prm as { nose?: number; H?: number };
      return def({ kind: 'fish', fish: { H: o.H ?? 0.2, W: 0.21, peak: 0.55, nose: o.nose ?? 0.3, ped: 0.06, tail: 'flukes', tailL: 0.14, tailH: 0.3, dorsal: [{ a: 0.42, b: 0.52, h: 0.08, sweep: 0.6 }], pect: { t: 0.72, len: 0.13, wid: 0.06, down: 0.6, out: 0.6 }, eyes: 0.05, eyeT: 0.86, bendY: true },
        paint: (p: Paint) => paintLook(p, { c: [pt[0], pt[1] ?? pt[0], pt[3] ?? pt[0]], fin: pt[0] }), tex: [512, 256], behavior: 'solo', region: ZR[zone], speed: 1.6, curious: true, swim: [Math.max(0.4, 2 - size * 0.06), 0.05, 2], photoRange: Math.min(40, size * 3 + 6) });
    }
  }
  throw new Error('unknown tag ' + tag);
}

export const MORE_600: SpeciesDef[] = [
  fx("aobasuzu", "アオバスズメダイ", "Chromis atripectoralis", "reef", [1, 20], 0.09, 1, b("damsel", {}), "coralHover", 30, {"c": ["#4ac0c8", "#6ad0d0", "#a8e8e0"], "fin": "#5ac8cc"}, "淡い青緑色のスズメダイ。枝サンゴの上に群れ、危険が迫ると一斉に枝の間へ隠れる。", {}),
  fx("nezusuzu", "ネズスズメダイ", "Chrysiptera glauca", "reef", [0.5, 5], 0.1, 1, b("damsel", {}), "reefRoam", 12, {"c": ["#8a9aa8", "#a8b4c0", "#c8d0d8"], "fin": "#9aa8b4"}, "灰青色の地味なスズメダイ。波の当たる浅いリーフの岩の上を泳ぎ回る。", {}),
  fx("shirikiruri", "シリキルリスズメダイ", "Chrysiptera parasema", "reef", [1, 15], 0.06, 1, b("damsel", {}), "coralHover", 20, {"c": ["#2a6af0", "#3a7af4", "#5a90f4"], "fin": "#3a7af4", "tail": "#f6d21e", "rear": [-0.4, "#f6d21e"]}, "瑠璃色の体に黄色い尾。サンゴの枝の間を出入りする小さなスズメダイ。", {}),
  fx("hirenagasuzu", "ヒレナガスズメダイ", "Neoglyphidodon nigroris", "reef", [2, 25], 0.12, 1, b("damsel", {"H": 0.5}), "coralPick", 8, {"c": ["#3a3a2a", "#4a4a36", "#6a6a50"], "fin": "#2a2a20", "tail": "#e0c040"}, "幼魚は黄色に黒い縦線で、成魚になると黒っぽく地味な色に変わる。", {}),
  fx("shimasuzu", "シマスズメダイ", "Abudefduf sordidus", "reef", [0.5, 6], 0.18, 1, b("damsel", {"H": 0.5}), "reefRoam", 8, {"c": ["#b0a890", "#c8c0a8", "#e0dcc8"], "fin": "#a8a088", "bars": [[0.25, 0.07, "#5a5040"], [0.05, 0.07, "#5a5040"], [-0.15, 0.07, "#5a5040"]], "ocel": [[-0.42, 0.3, 4, "#141414"]]}, "太い褐色の横帯と尾の付け根の黒い点が目印。潮だまりや浅い岩場に多い。", {}),
  fx("sejirokuma", "セジロクマノミ", "Amphiprion sandaracinos", "reef", [2, 20], 0.1, 2, b("clown", {}), "cleaner", 6, {"c": ["#f08a30", "#f49a40", "#f8b060"], "fin": "#f08a20", "hl": [[0.48, 0.08, "#f6f4ee", -0.5, 0.5]]}, "背中に1本の白い線が走るクマノミ。センジュイソギンチャクなどにすむ。", {"behavior": "anemone", "region": "anemones"}),
  fx("touaka", "トウアカクマノミ", "Amphiprion polymnus", "reef", [2, 30], 0.11, 2, b("clown", {}), "cleaner", 6, {"c": ["#3a2418", "#4a2e1e", "#e08a40"], "mid": 0.6, "fin": "#3a2418", "bars": [[0.32, 0.07, "#f6f4ee"], [0.05, 0.08, "#f6f4ee"]]}, "こげ茶色の体に白い鞍状の模様。砂地のイソギンチャクにすむ。", {"behavior": "anemone", "region": "anemones"}),
  fx("sumitsuki", "スミツキトノサマダイ", "Chaetodon plebeius", "reef", [1, 15], 0.12, 1, b("butterfly", {}), "coralPick", 6, {"c": ["#f0d040", "#f4dc60", "#f8e888"], "fin": "#f6d21e", "eyeBar": "#141414", "ocel": [[-0.15, 0.15, 7, "#2a4aa0"]]}, "黄色い体の後半に青黒い大きな斑紋がある。サンゴのポリプを食べる。", {}),
  fx("misujicho", "ミスジチョウチョウウオ", "Chaetodon lunulatus", "reef", [1, 20], 0.13, 1, b("butterfly", {}), "coralPick", 8, {"c": ["#e0b050", "#f0c870", "#f4d890"], "fin": "#e0a030", "eyeBar": "#141414", "lines": {"n": 12, "color": "rgba(140,90,40,0.45)", "ang": 25}}, "斜めに走る細い線が美しいチョウチョウウオ。サンゴ礁でペアで泳ぐ。", {}),
  fx("yarikatagi", "ヤリカタギ", "Chaetodon trifascialis", "reef", [2, 25], 0.12, 1, b("butterfly", {}), "coralPick", 6, {"c": ["#f0ece0", "#f4f2ea", "#fafaf6"], "fin": "#f6d21e", "tail": "#2a2a2a", "eyeBar": "#141414", "lines": {"n": 10, "color": "rgba(60,60,60,0.5)", "ang": 60}}, "白地に山形の模様。テーブルサンゴの縄張りを1匹で守る。", {}),
  fx("shirakodai", "シラコダイ", "Chaetodon nippon", "rocky", [2, 25], 0.15, 1, b("butterfly", {}), "rockyRoam", 6, {"c": ["#d8d4c8", "#e8e4d8", "#f0ece4"], "fin": "#f6d21e", "rear": [-0.15, "#4a4a4a"]}, "温帯の岩礁にすむチョウチョウウオ。体の後半が黒っぽく、ヒレは黄色。", {}),
  fx("murehatatate", "ムレハタタテダイ", "Heniochus diphreutes", "dropoff", [5, 60], 0.18, 1, b("banner", {}), "wall", 30, {"c": ["#f0ece0", "#f6f2ea", "#fafaf6"], "fin": "#f6d21e", "bars": [[0.2, 0.1, "#141414"], [-0.05, 0.1, "#141414"]], "tail": "#f6d21e"}, "背ビレの長いハタタテダイの仲間。ドロップオフの中層に大きな群れをつくる。", {}),
  fx("adeyakko", "アデヤッコ", "Pomacanthus xanthometopon", "reef", [5, 40], 0.35, 2, b("angel", {}), "reefRoam", 3, {"c": ["#2a5a8a", "#3a6a98", "#4a7aa8"], "fin": "#f6d21e", "front": [0.3, "#f6d21e"], "net": "rgba(250,220,100,0.6)"}, "顔が黄色く、体は青い網目模様。洞窟の入り口近くを好む。", {}),
  fx("somewakeyakko", "ソメワケヤッコ", "Centropyge bicolor", "reef", [3, 25], 0.1, 1, b("angel", {}), "coralPick", 6, {"c": ["#f8d820", "#f8d820", "#f8e040"], "fin": "#2a3a90", "rear": [0.0, "#2a3a90"], "tail": "#f6d21e"}, "体の前半が黄色、後半が濃い青の小型ヤッコ。サンゴの隙間を出入りする。", {}),
  fx("nameyakko", "ナメラヤッコ", "Centropyge vrolikii", "reef", [3, 25], 0.1, 1, b("angel", {}), "coralPick", 6, {"c": ["#c8c4b8", "#d8d4c8", "#e0dcd0"], "fin": "#2a2a2a", "rear": [-0.15, "#2a2a2a"]}, "くすんだ灰色の体で、後ろ半分が黒くなる地味なヤッコ。", {}),
  fx("senasuji", "セナスジベラ", "Thalassoma hardwicke", "reef", [1, 15], 0.18, 1, b("wrasse", {}), "reefRoam", 10, {"c": ["#4ab090", "#6ac0a0", "#a8e0c8"], "fin": "#4ab090", "saddle": [[0.25, 0.04, "#141414"], [0.1, 0.04, "#141414"], [-0.05, 0.04, "#141414"], [-0.2, 0.04, "#141414"]]}, "背中に黒い三角形の斑紋が並ぶベラ。浅い礁原で群れる。", {}),
  fx("itohikibera", "イトヒキベラ", "Cirrhilabrus temminckii", "rocky", [5, 40], 0.12, 1, b("wrasse", {"dorsal": [{"a": 0.2, "b": 0.6, "h": 0.12}]}), "midwater", 20, {"c": ["#d04a6a", "#e06a80", "#f0a0b0"], "fin": "#3a5ad0", "hl": [[0.1, 0.03, "#3a5ad0"]]}, "雄は腹ビレが糸のように長く、婚姻色で鮮やかに輝く。", {}),
  fx("kujakubera", "クジャクベラ", "Paracheilinus carpenteri", "reef", [10, 40], 0.08, 2, b("wrasse", {"dorsal": [{"a": 0.2, "b": 0.65, "h": 0.15}]}), "coralHover", 16, {"c": ["#e06a50", "#f08a60", "#f8b080"], "fin": "#e04a80", "hl": [[0.15, 0.03, "#4a8af0"], [-0.05, 0.03, "#4a8af0"]]}, "孔雀のような背ビレを広げて雌にアピールする小型のベラ。", {}),
  fx("akasasanoha", "アカササノハベラ", "Pseudolabrus eoethinus", "rocky", [1, 30], 0.2, 1, b("wrasse", {}), "rockyRoam", 10, {"c": ["#c05a3a", "#d07a50", "#e8b090"], "fin": "#c86a40", "eyeBar": "rgba(80,30,20,0.5)"}, "温帯の岩礁で最もふつうに見られるベラの一つ。好奇心が強い。", {}),
  fx("budai", "ブダイ", "Calotomus japonicus", "rocky", [2, 20], 0.4, 1, b("parrot", {}), "rockyRoam", 6, {"c": ["#9a5a3a", "#b07a54", "#d0a888"], "fin": "#9a5a3a", "blotch": [20, ["rgba(80,40,20,0.4)"]]}, "温帯の岩礁にすむブダイ。くちばしのような歯で海藻をかじる。", {}),
  fx("gomaaigo", "ゴマアイゴ", "Siganus guttatus", "lagoon", [0.5, 10], 0.35, 1, b("tang", {"H": 0.42}), "seagrass", 10, {"c": ["#9a9a7a", "#b0b090", "#d0d0b0"], "fin": "#f6d21e", "spots": [[60, 0.008, 0.014, "rgba(220,170,40,0.8)"]], "ocel": [[-0.3, 0.35, 6, "#f6d21e"]]}, "体中にオレンジ色の点が散らばるアイゴ。マングローブや藻場を群れで泳ぐ。", {}),
  fx("aigo", "アイゴ", "Siganus fuscescens", "rocky", [1, 20], 0.3, 1, b("tang", {"H": 0.38}), "rockyRoam", 20, {"c": ["#6a6a50", "#8a8a6a", "#b0b090"], "fin": "#7a7a5a", "spots": [[50, 0.006, 0.012, "rgba(240,240,220,0.6)"]]}, "背ビレのトゲに毒をもつ。海藻を食べ、磯焼けの原因の一つとされる。", {}),
  fx("moyoufugu", "モヨウフグ", "Arothron stellatus", "reef", [3, 50], 0.6, 2, b("puffer", {}), "reefRoam", 2, {"c": ["#e0d8c8", "#ece4d8", "#f4f0e8"], "fin": "#d0c8b8", "spots": [[160, 0.006, 0.012, "#141414"]]}, "大型のフグ。白っぽい体に黒い小さな点が無数にある。", {}),
  fx("hitozurahari", "ヒトヅラハリセンボン", "Diodon liturosus", "reef", [1, 40], 0.4, 2, b("porcupine", {}), "under", 3, {"c": ["#c0a880", "#d0bc98", "#e8dcc8"], "fin": "#c0a880", "blotch": [10, ["rgba(40,30,20,0.7)"]]}, "人の顔のような黒い模様がある。夜行性で昼は岩陰で休む。", {}),
  fx("akamongara", "アカモンガラ", "Odonus niger", "dropoff", [5, 40], 0.3, 1, b("trigger", {"tail": "lunate"}), "wall", 30, {"c": ["#2a2a6a", "#3a3a80", "#4a4a90"], "fin": "#3a3a80"}, "紺色の体に赤い歯。ドロップオフの中層に群れ、驚くと岩穴に逃げ込む。", {}),
  fx("umazurahagi", "ウマヅラハギ", "Thamnaconus modestus", "rocky", [2, 40], 0.3, 1, b("file", {}), "midwater", 20, {"c": ["#6a7a8a", "#8a98a4", "#b0bcc4"], "fin": "#3a6ad0"}, "馬のように長い顔のカワハギ。群れで泳ぎ、クラゲも食べる。", {}),
  fx("amimehagi", "アミメハギ", "Rudarius ercodes", "rocky", [1, 15], 0.06, 1, b("file", {}), "perch", 6, {"c": ["#8a8a6a", "#a0a080", "#c0c0a0"], "fin": "#8a8a6a", "net": "rgba(50,50,30,0.5)"}, "海藻に口でくわえて眠る、5cmほどの小さなカワハギ。", {}),
  fx("higehagi", "ヒゲハギ", "Chaetodermis penicilligerus", "lagoon", [2, 20], 0.25, 2, b("file", {}), "seagrass", 3, {"c": ["#9a8a5a", "#b0a070", "#c8b890"], "fin": "#9a8a5a", "lines": {"n": 8, "color": "rgba(60,50,30,0.5)", "ang": 0}}, "体中に海藻のようなヒゲが生え、藻場に溶け込んでいる。", {}),
  fx("kokuhanara", "コクハンアラ", "Plectropomus laevis", "reef", [4, 90], 1.0, 3, b("grouper", {}), "reefRoam", 1, {"c": ["#e8e4d8", "#f0ece0", "#f6f4ec"], "fin": "#f6d21e", "saddle": [[0.25, 0.07, "#141414"], [0.08, 0.07, "#141414"], [-0.1, 0.07, "#141414"], [-0.28, 0.06, "#141414"]]}, "白地に黒い鞍模様の大型のハタ。1mを超えることもある。", {}),
  fx("azahata", "アザハタ", "Cephalopholis sonnerati", "reef", [10, 100], 0.5, 2, b("grouper", {}), "under", 3, {"c": ["#c84a3a", "#d85a48", "#e88070"], "fin": "#c84a3a", "spots": [[80, 0.006, 0.012, "rgba(250,240,220,0.7)"]]}, "赤い体に白い点が散らばるハタ。根の周りにキンメモドキなどを従えて暮らす。", {}),
  fx("yaitohata", "ヤイトハタ", "Epinephelus malabaricus", "lagoon", [2, 60], 1.2, 2, b("grouper", {}), "reefRoam", 2, {"c": ["#7a6a4a", "#8a7a58", "#b0a080"], "fin": "#6a5a3a", "bars": [[0.25, 0.08, "rgba(40,30,20,0.4)"], [0.0, 0.08, "rgba(40,30,20,0.4)"], [-0.25, 0.08, "rgba(40,30,20,0.4)"]], "spots": [[60, 0.004, 0.008, "#141414"]]}, "マングローブ域から礁まですむ大型のハタ。沖縄では「アーラミーバイ」。", {}),
  fx("kudagonbe", "クダゴンベ", "Oxycirrhites typus", "dropoff", [10, 100], 0.1, 3, b("hawk", {"nose": 0.15}), "wall", 3, {"c": ["#f0ece4", "#f4f0ea", "#fafaf6"], "fin": "#e04a4a", "net": "rgba(220,60,60,0.85)"}, "長い口と赤い格子模様。ヤギ（ウミウチワ）の上にじっと止まる、ダイバー憧れの魚。", {}),
  fx("bara-fuedai", "バラフエダイ", "Lutjanus bohar", "dropoff", [5, 70], 0.7, 2, b("snapper", {}), "midwater", 4, {"c": ["#8a3a2a", "#a04a34", "#c87050"], "fin": "#6a2a1a"}, "大型のフエダイ。シガテラ毒をもつことがあり食用には注意が必要。", {}),
  fx("manjuishimochi", "マンジュウイシモチ", "Sphaeramia nematoptera", "lagoon", [1, 10], 0.07, 1, b("cardinal", {}), "under", 16, {"c": ["#e8d8a0", "#f0e0b0", "#f4e8c8"], "fin": "#f6d21e", "bars": [[0.05, 0.08, "#2a2a2a"]], "spots": [[20, 0.004, 0.008, "#c05030", [-0.5, -0.05, -0.5, 0.5]]]}, "大きな目の小さなテンジクダイ。枝サンゴの間で群れてじっと浮かぶ。", {}),
  fx("aoyagara", "アオヤガラ", "Fistularia commersonii", "reef", [1, 40], 1.0, 1, b("cornet", {}), "midwater", 3, {"c": ["#5a8a7a", "#7aa090", "#a8c8b8"], "fin": "#5a8a7a"}, "1mを超える細長い魚。筒のような口で小魚を一瞬で吸い込む。", {}),
  fx("akebonohaze", "アケボノハゼ", "Nemateleotris decora", "dropoff", [25, 70], 0.08, 3, b("dartgoby", {"dorsal": [{"a": 0.5, "b": 0.62, "h": 0.2}]}), "burrow", 2, {"c": ["#e8d8c8", "#d080c0", "#a040b0"], "mid": 0.6, "fin": "#a040b0", "tail": "#a040b0"}, "深場にすむ優美なハゼ。紫とクリーム色のグラデーションが美しい。", {"region": "sandSpots"}),
  fx("kobanzame", "コバンザメ", "Echeneis naucrates", "offshore", [0, 40], 0.6, 1, b("mullet", {"H": 0.14}), "midwater", 4, {"c": ["#3a3a3a", "#5a5a5a", "#c8c8c8"], "fin": "#3a3a3a", "hl": [[0.0, 0.06, "#1a1a1a"], [0.1, 0.03, "#f6f4ee"], [-0.1, 0.03, "#f6f4ee"]]}, "頭の上の吸盤で大型の魚やカメに吸いついて移動する。", {}),
  fx("ayameebisu", "アヤメエビス", "Sargocentron rubrum", "reef", [2, 30], 0.2, 1, b("soldier", {}), "under", 8, {"c": ["#c83a3a", "#d85050", "#e88080"], "fin": "#c83a3a", "lines": {"n": 6, "color": "rgba(250,240,240,0.8)", "ang": 0}}, "赤と銀白の縞模様のイットウダイの仲間。昼は岩陰に潜む。", {}),
  fx("kurohoshimanjuu", "クロホシマンジュウダイ", "Scatophagus argus", "lagoon", [0.5, 10], 0.25, 1, b("batfish", {"H": 0.62}), "seagrass", 8, {"c": ["#9a9a7a", "#b0b090", "#d0d0b0"], "fin": "#9a9a7a", "spots": [[40, 0.012, 0.024, "rgba(40,40,30,0.7)"]]}, "汽水域や内湾に群れる。体の黒い点が名前の由来。", {}),
  fx("kotohiki", "コトヒキ", "Terapon jarbua", "lagoon", [0.5, 8], 0.22, 1, b("snapper", {}), "sandForage", 12, {"c": ["#c0c4c8", "#d8dcdc", "#eef0f0"], "fin": "#c0c4c8", "lines": {"n": 3, "color": "rgba(60,60,60,0.7)", "ang": -8}}, "弓なりの3本の黒い線がある。浮き袋を使って「グーグー」と鳴く。", {}),
  fx("nezumigochi", "ネズミゴチ", "Repomucenus curvicornis", "lagoon", [1, 20], 0.15, 1, b("lizard", {"H": 0.1}), "sandForage", 8, {"c": ["#c8b898", "#d8c8a8", "#e8dcc8"], "fin": "#c8b898", "blotch": [20, ["rgba(100,80,50,0.5)"]]}, "砂地にすむ平たい魚。雄は大きな背ビレを広げて求愛する。", {}),
  fx("tatsunootoshigo", "タツノオトシゴ", "Hippocampus coronatus", "lagoon", [1, 10], 0.08, 2, b("cornet", {"H": 0.16, "W": 0.12, "tail": "none", "nose": 0.6, "eyes": 0.18}), "perch", 4, {"c": ["#8a6a3a", "#a08050", "#c0a070"], "fin": "#a08050"}, "馬のような頭で、尾を海草に巻きつけて立つ。雄のお腹の袋で子どもを育てる。", {"pitch": -1.35, "region": "grassSpots"}),
  fx("hanatatsu", "ハナタツ", "Hippocampus sindonis", "rocky", [3, 30], 0.07, 3, b("cornet", {"H": 0.16, "W": 0.12, "tail": "none", "nose": 0.6, "eyes": 0.18}), "perch", 2, {"c": ["#c84a3a", "#d86a50", "#e89070"], "fin": "#d86a50", "spots": [[30, 0.004, 0.008, "#f6f4ee"]]}, "岩礁の海藻やヤギに尾を巻きつけるタツノオトシゴの仲間。体色の変化が大きい。", {"pitch": -1.35}),
  fx("youjiuo", "ヨウジウオ", "Syngnathus schlegeli", "lagoon", [1, 15], 0.25, 1, b("needle", {"H": 0.05}), "seagrass", 6, {"c": ["#6a7a3a", "#8a9a50", "#b0c070"], "fin": "#6a7a3a"}, "細長いタツノオトシゴの仲間。アマモの葉に紛れてほとんど見分けがつかない。", {}),
  fx("oniokoze", "オニオコゼ", "Inimicus japonicus", "rocky", [3, 60], 0.2, 2, b("stone", {}), "perch", 3, {"c": ["#7a5a4a", "#8a6a58", "#a08070"], "fin": "#c08060", "blotch": [24, ["rgba(200,140,100,0.5)", "rgba(40,30,20,0.5)"]]}, "ごつごつした顔の毒魚。砂泥に半分埋もれて獲物を待ち伏せる。", {}),
  fx("umitanago", "ウミタナゴ", "Ditrema temminckii", "rocky", [1, 20], 0.22, 1, b("bream", {}), "midwater", 20, {"c": ["#8a8a90", "#b0b0b4", "#d8d8dc"], "fin": "#9a9aa0"}, "お腹の中で子どもを育て、生まれた稚魚を産む珍しい魚。", {"metal": 0.3}),
  fx("suzuki", "スズキ", "Lateolabrax japonicus", "rocky", [1, 30], 0.7, 1, b("snapper", {"H": 0.24}), "midwater", 8, {"c": ["#4a5a6a", "#9aa8b4", "#e4e8ec"], "mid": 0.45, "fin": "#5a6a78"}, "成長とともにセイゴ、フッコ、スズキと名前が変わる出世魚。", {"metal": 0.4}),
  fx("dainangin", "ダイナンギンポ", "Dictyosoma burgeri", "rocky", [0.5, 10], 0.25, 1, b("blenny", {"H": 0.1}), "perch", 6, {"c": ["#5a4a3a", "#6a5a48", "#8a7a64"], "fin": "#5a4a3a", "spots": [[30, 0.006, 0.01, "rgba(220,200,160,0.6)"]]}, "細長いウナギのような体のギンポ。磯の石の下に潜む。", {}),
  fx("isoginpo", "イソギンポ", "Parablennius yatabei", "rocky", [0.5, 10], 0.07, 1, b("blenny", {}), "perch", 8, {"c": ["#9a8a6a", "#b0a080", "#c8b898"], "fin": "#9a8a6a", "bars": [[0.2, 0.06, "rgba(60,40,30,0.5)"], [0.0, 0.06, "rgba(60,40,30,0.5)"], [-0.2, 0.06, "rgba(60,40,30,0.5)"]]}, "岩の穴から顔だけ出していることが多い。目の上に小さなヒゲがある。", {}),
  fx("hebiginpo", "ヘビギンポ", "Enneapterygius etheostoma", "rocky", [0.5, 10], 0.05, 1, b("blenny", {}), "perch", 10, {"c": ["#c8a888", "#d8bc9c", "#e8d4bc"], "fin": "#c8a888", "bars": [[0.2, 0.05, "rgba(160,60,40,0.6)"], [0.0, 0.05, "rgba(160,60,40,0.6)"], [-0.2, 0.05, "rgba(160,60,40,0.6)"]]}, "潮だまりの岩の上でじっとしている小さな魚。雄は婚姻色で頭が黒くなる。", {}),
  fx("mebaru", "メバル", "Sebastes inermis", "rocky", [1, 30], 0.2, 1, b("snapper", {"H": 0.32}), "midwater", 20, {"c": ["#7a5a3a", "#9a7a5a", "#c0a888"], "fin": "#7a5a3a", "iris": "#2a2a2a"}, "大きな目が特徴。海藻の上で頭を斜め上に向けて群れる。", {}),
  fx("kasagoaka", "ウッカリカサゴ", "Sebastiscus tertius", "rocky", [10, 80], 0.3, 2, b("scorp", {}), "perch", 3, {"c": ["#c8503a", "#d86a50", "#e89070"], "fin": "#c8503a", "spots": [[30, 0.008, 0.014, "rgba(250,240,230,0.7)"]]}, "カサゴとそっくりで「うっかり」見間違えたことから名付けられた。", {}),
  fx("ishigakidai2", "コショウダイ", "Plectorhinchus cinctus", "rocky", [3, 40], 0.5, 1, b("sweetlips", {}), "rockyRoam", 4, {"c": ["#c8c0a8", "#d8d0bc", "#e8e4d4"], "fin": "#c8c0a8", "spots": [[60, 0.006, 0.012, "rgba(40,30,20,0.7)"]], "bars": [[0.2, 0.08, "rgba(40,30,20,0.4)"]]}, "こしょうをまぶしたような黒い点と斜めの帯をもつ。", {}),
  fx("kodai", "ヘダイ", "Rhabdosargus sarba", "rocky", [1, 40], 0.35, 1, b("bream", {}), "rockyRoam", 6, {"c": ["#9aa0a8", "#bcc0c8", "#e0e4e8"], "fin": "#f6d21e", "lines": {"n": 8, "color": "rgba(220,180,60,0.4)", "ang": 0}}, "銀色の体に黄色いヒレのタイの仲間。内湾の岩場に多い。", {"metal": 0.4}),
  fx("hoshikaiwari", "ホシカイワリ", "Carangoides fulvoguttatus", "dropoff", [5, 100], 0.8, 1, b("jack", {}), "midwater", 8, {"c": ["#6a8a9a", "#a8c0c8", "#e8eef0"], "mid": 0.45, "fin": "#8aa8b4", "spots": [[20, 0.006, 0.012, "rgba(230,180,60,0.8)"]]}, "体に黄色い点が散らばるアジ。ドロップオフを群れで回遊する。", {"metal": 0.5}),
  fx("ikegatsuo", "イケカツオ", "Scomberoides lysan", "offshore", [0, 30], 0.6, 1, b("jack", {"H": 0.24}), "surface", 6, {"c": ["#3a5a7a", "#b0c0cc", "#eef2f4"], "mid": 0.4, "fin": "#8aa0b0", "spots": [[8, 0.012, 0.02, "rgba(30,40,50,0.6)", [-0.3, 0.3, 0.15, 0.4]]]}, "水面近くを群れで泳ぐ細長いアジ。うろこは針のように硬い。", {"metal": 0.5}),
  fx("makajiki", "マカジキ", "Kajikia audax", "offshore", [0, 100], 2.5, 3, b("sail", {"dorsal": [{"a": 0.3, "b": 0.5, "h": 0.12}]}), "midwater", 1, {"c": ["#1a2a4a", "#5a7a9a", "#e8eef2"], "mid": 0.45, "fin": "#2a3a5a", "bars": [[0.2, 0.02, "rgba(120,180,240,0.6)"], [0.05, 0.02, "rgba(120,180,240,0.6)"], [-0.1, 0.02, "rgba(120,180,240,0.6)"]]}, "長く鋭い上あごで魚の群れを打ち払って狩る。体に青い縦縞が浮かぶ。", {"speed": 2.4}),
  fx("yoshikiri", "ヨシキリザメ", "Prionace glauca", "offshore", [0, 150], 2.4, 2, b("shark", {"H": 0.14, "pect": {"t": 0.64, "len": 0.3, "wid": 0.06, "down": 0.3, "out": 0.7}}), "midwater", 2, {"c": ["#2a5ab0", "#3a6ac0", "#eef2f8"], "mid": 0.55, "fin": "#2a5ab0"}, "鮮やかな藍色の細身のサメ。長い胸ビレで外洋を長距離回遊する。", {"speed": 1.2}),
  fx("kagurazame", "カグラザメ", "Hexanchus griseus", "deep", [150, 430], 4.0, 3, b("shark", {"H": 0.16, "nose": 0.8}), "midwater", 1, {"c": ["#4a4440", "#5a544e", "#8a847e"], "fin": "#4a4440", "iris": "#3ad0a0"}, "エラ孔が6対ある原始的なサメ。深海を緑色の目を光らせてゆっくり泳ぐ。", {"speed": 0.5, "region": [-150, 150, 730, 1060]}),
  fx("ondenzame", "オンデンザメ", "Somniosus pacificus", "deep", [200, 430], 4.0, 3, b("shark", {"H": 0.2, "nose": 0.9, "tail": "hetero"}), "midwater", 1, {"c": ["#3a3a3a", "#4a4a4a", "#5a5a5a"], "fin": "#3a3a3a"}, "冷たい深海をとてもゆっくり泳ぐ大型のサメ。寿命は数百年ともいわれる。", {"speed": 0.3, "region": [-150, 150, 730, 1060]}),
  fx("darumazame", "ダルマザメ", "Isistius brasiliensis", "deep", [150, 430], 0.45, 2, b("shark", {"H": 0.18, "nose": 0.9}), "midwater", 3, {"c": ["#3a3020", "#4a402e", "#6a5e4a"], "fin": "#2a2418", "spots": [[60, 0.004, 0.008, "rgba(120,220,200,0.6)"]]}, "お腹が光る小さなサメ。大きな魚やクジラの肉を丸くえぐり取って食べる。", {"glow": 7004368, "region": [-150, 150, 730, 1060]}),
  fx("hounenneso", "ホウネンエソ", "Polyipnus spinosus", "deep", [150, 400], 0.06, 2, b("batfish", {"H": 0.6}), "midwater", 20, {"c": ["#9aa8b8", "#c0ccd8", "#e0e8f0"], "fin": "#9aa8b8", "spots": [[14, 0.006, 0.009, "#7ae8ff", [-0.4, 0.4, -0.5, -0.35]]]}, "銀色の手斧のような形の小さな深海魚。お腹の発光器が下向きに光る。", {"glow": 7004415, "region": [-150, 150, 730, 1060], "metal": 0.8}),
  fx("akanamada", "アカナマダ", "Lophotus capellei", "deep", [150, 400], 1.5, 3, b("needle", {"H": 0.14, "dorsal": [{"a": 0.1, "b": 0.95, "h": 0.06}]}), "midwater", 1, {"c": ["#c0c8d0", "#d8dce4", "#eef0f4"], "fin": "#e04a4a"}, "リュウグウノツカイに近い仲間。頭が角のように突き出し、赤い背ビレが全身に伸びる。", {"region": [-150, 150, 730, 1060], "metal": 0.6}),
  fx("aburabouzu", "アブラボウズ", "Erilepis zonifer", "cold", [20, 60], 1.5, 3, b("grouper", {}), "rockyRoam", 1, {"c": ["#3a3a3a", "#4a4a4a", "#6a6a6a"], "fin": "#2a2a2a", "blotch": [16, ["rgba(200,200,200,0.3)"]]}, "体重100kgにもなる北の海の巨大魚。身に脂がとても多い。", {"speed": 0.3}),
  fx("ezomebaru", "エゾメバル", "Sebastes taczanowskii", "cold", [1, 20], 0.2, 1, b("snapper", {"H": 0.32}), "midwater", 20, {"c": ["#4a4a3a", "#6a6a52", "#9a9a80"], "fin": "#4a4a3a"}, "北の海の浅い岩礁にすむメバル。「ガヤ」と呼ばれる。", {}),
  fx("komai", "コマイ", "Eleginus gracilis", "cold", [1, 40], 0.3, 1, b("grouper", {"H": 0.2}), "midwater", 30, {"c": ["#6a6a50", "#8a8a6a", "#d0d0c0"], "mid": 0.5, "fin": "#7a7a5a"}, "タラの仲間。冬に結氷した海の氷の下で群れる。干物にされる。", {}),
  fx("kyuriuo", "キュウリウオ", "Osmerus dentex", "cold", [0, 20], 0.2, 1, b("fusilier", {"H": 0.16}), "midwater", 40, {"c": ["#4a6a5a", "#a0b8a8", "#eef2ee"], "mid": 0.45, "fin": "#8aa098"}, "キュウリのような匂いがすることから名付けられた。春に川をさかのぼって産卵する。", {"metal": 0.4}),
  fx("karafutomasu", "カラフトマス", "Oncorhynchus gorbuscha", "cold", [0, 30], 0.55, 1, b("mullet", {"H": 0.24}), "midwater", 12, {"c": ["#3a5a6a", "#9ab0b8", "#eef2f2"], "mid": 0.45, "fin": "#5a7280", "spots": [[40, 0.008, 0.016, "rgba(20,30,40,0.6)", [-0.5, -0.2, 0.2, 0.5]]]}, "産卵期の雄は背中が大きく盛り上がることから英名はピンクサーモン。", {"metal": 0.4}),
  fx("sakuramasu", "サクラマス", "Oncorhynchus masou", "cold", [0, 30], 0.5, 2, b("mullet", {"H": 0.24}), "midwater", 6, {"c": ["#3a5a6a", "#a8b8c0", "#eef2f2"], "mid": 0.45, "fin": "#5a7280"}, "川に残ったものはヤマメになる。海で大きく育ち、桜の頃に川へ戻る。", {"metal": 0.4}),
  fx("hornshark", "ホーンシャーク", "Heterodontus francisci", "kelp", [2, 30], 0.9, 2, b("nurse", {"H": 0.18}), "sandForage", 2, {"c": ["#7a6a52", "#8a7a62", "#c0b498"], "fin": "#7a6a52", "spots": [[60, 0.008, 0.016, "rgba(40,30,20,0.7)"]]}, "背ビレの前にトゲをもつおとなしいサメ。夜にウニや貝を食べる。", {}),
  fx("kelprockfish", "ケルプロックフィッシュ", "Sebastes atrovirens", "kelp", [2, 30], 0.35, 1, b("scorp", {"H": 0.3}), "perch", 6, {"c": ["#7a6a4a", "#8a7a58", "#b0a080"], "fin": "#7a6a4a", "blotch": [20, ["rgba(40,30,20,0.4)", "rgba(200,180,140,0.3)"]]}, "ケルプの茎や葉の間に止まって休むメバルの仲間。", {}),
  fx("halfmoon", "ハーフムーン", "Medialuna californiensis", "kelp", [2, 30], 0.35, 1, b("bream", {}), "midwater", 16, {"c": ["#3a5a7a", "#4a6a88", "#6a88a0"], "fin": "#3a5a7a"}, "半月形の尾ビレをもつ青灰色の魚。ケルプの葉を食べる。", {}),
  fx("senorita", "セニョリータ", "Oxyjulis californica", "kelp", [1, 40], 0.18, 1, b("wrasse", {"H": 0.2}), "midwater", 40, {"c": ["#e0c060", "#e8d080", "#f0e0a8"], "fin": "#e0c060", "ocel": [[-0.42, 0.0, 4, "#2a2a2a"]]}, "葉巻のような細長いベラ。ほかの魚の体の寄生虫を食べるクリーナー。", {}),
  fx("nagahanadai", "ナガハナダイ", "Pseudanthias elongatus", "bluehole", [20, 55], 0.12, 2, b("anthias", {}), "midwater", 30, {"c": ["#e07a9a", "#f08aa8", "#f8b0c4"], "fin": "#e07a9a"}, "縦穴の深い壁沿いに群れるピンク色のハナダイ。", {}),
  fx("dokutsubeni", "オキナワベニハゼ", "Trimma caudomaculatum", "cave", [10, 30], 0.03, 2, b("goby", {}), "under", 8, {"c": ["#e86a4a", "#f08a60", "#f8b090"], "fin": "#e86a4a", "ocel": [[-0.42, 0.0, 2, "#2a2a2a"]]}, "洞窟や岩の割れ目の天井に逆さまに張りつく、2cmほどの赤いハゼ。", {}),
  fx("kinchakudai2", "タキゲンロクダイ", "Coradion altivelis", "reef", [5, 40], 0.14, 2, b("butterfly", {}), "coralPick", 4, {"c": ["#f0e8d8", "#f4ecdc", "#fafaf4"], "fin": "#c8803a", "bars": [[0.3, 0.06, "#c8803a"], [0.08, 0.08, "#c8803a"], [-0.15, 0.06, "#c8803a"]], "ocel": [[-0.3, 0.4, 4, "#141414"]]}, "オレンジの太い横帯と背ビレの目玉模様をもつチョウチョウウオ。", {}),
  fx("akahochibi", "オオスジイシモチ", "Ostorhinchus doederleini", "reef", [2, 30], 0.09, 1, b("cardinal", {}), "under", 20, {"c": ["#e0a080", "#e8b898", "#f0d0b8"], "fin": "#e0a080", "ocel": [[-0.42, 0.0, 3, "#141414"]]}, "オレンジがかった体で尾の付け根に黒点。岩陰の暗がりに群れる。", {}),
  fx("kobanaji", "コバンアジ", "Trachinotus baillonii", "lagoon", [0, 20], 0.4, 1, b("jack", {"H": 0.24}), "surface", 12, {"c": ["#7a8a98", "#c0ccd4", "#eef2f4"], "mid": 0.4, "fin": "#2a2a2a", "spots": [[5, 0.012, 0.016, "#141414", [-0.2, 0.3, -0.05, 0.05]]]}, "波打ち際の水面近くを群れで泳ぐ。体の中央に黒い点が並ぶ。", {"metal": 0.6}),
  fx("daitoukaji", "ヨコスジカジカ", "Hemilepidotus gilberti", "cold", [5, 40], 0.3, 2, b("scorp", {}), "perch", 3, {"c": ["#a05a3a", "#c07a54", "#e0b090"], "fin": "#e0a050", "blotch": [20, ["rgba(60,30,20,0.5)", "rgba(240,220,180,0.4)"]]}, "大きな胸ビレを蝶のように広げるカジカ。北の岩場にすむ。", {}),
  fx("kuromaguro2", "ナメダンゴ", "Eumicrotremus taranetzi", "cold", [5, 40], 0.06, 3, b("puffer", {"H": 0.85, "W": 0.75}), "perch", 2, {"c": ["#e0c040", "#e8d060", "#f0e090"], "fin": "#e0c040", "spots": [[20, 0.01, 0.02, "rgba(200,120,40,0.6)"]]}, "つるっとした丸い体のダンゴウオの仲間。黄色や赤の個体がいる。", {}),
  fx("ginzake", "ギンザケ", "Oncorhynchus kisutch", "cold", [0, 40], 0.6, 2, b("mullet", {"H": 0.24}), "midwater", 8, {"c": ["#3a5a7a", "#b0c0cc", "#eef2f4"], "mid": 0.45, "fin": "#5a7a90"}, "銀色に輝くサケ。北太平洋を回遊し、秋に川へ戻る。", {"metal": 0.5}),
  fx("ookamiuo2", "ムスジガジ", "Opisthocentrus ocellatus", "cold", [1, 20], 0.15, 1, b("blenny", {"H": 0.14}), "perch", 6, {"c": ["#6a5a3a", "#8a7a54", "#b0a07a"], "fin": "#6a5a3a", "ocel": [[0.2, 0.42, 4, "#141414", "#f6d21e"], [0.0, 0.42, 4, "#141414", "#f6d21e"], [-0.2, 0.42, 4, "#141414", "#f6d21e"]]}, "背ビレに目玉模様が並ぶ細長い魚。北の磯の海藻の間にすむ。", {}),
  fx("kurogutsu", "クロアンコウ", "Lophiodes mutilus", "deep", [150, 400], 0.5, 2, b("stone", {"H": 0.22, "W": 0.5}), "perch", 2, {"c": ["#3a3028", "#4a4034", "#6a5e50"], "fin": "#3a3028"}, "深海の泥の上でじっと待ち伏せするアンコウの仲間。", {"region": [-150, 150, 730, 1060]}),
  fx("blueholeanthias", "フタイロハナゴイ", "Pseudanthias bicolor", "bluehole", [15, 55], 0.1, 2, b("anthias", {}), "midwater", 30, {"c": ["#e8a060", "#f0b878", "#f8d0a0"], "fin": "#c050a0", "ocel": [[0.1, 0.1, 3, "#c050a0"]]}, "ブルーホールの深い壁に群れる、2色に彩られたハナダイ。", {}),
  fx("kelpgreenling", "ペインテッドグリーンリング", "Oxylebius pictus", "kelp", [2, 40], 0.2, 1, b("scorp", {"H": 0.24}), "perch", 6, {"c": ["#c8b090", "#d8c4a8", "#ecdcc8"], "fin": "#c8b090", "bars": [[0.3, 0.05, "#a03a2a"], [0.1, 0.05, "#a03a2a"], [-0.1, 0.05, "#a03a2a"], [-0.3, 0.05, "#a03a2a"]]}, "白地に赤い横縞のアイナメの仲間。ケルプの根元の岩でじっとしている。", {}),
  fx("kelpsurfperch", "ブラックパーチ", "Embiotoca jacksoni", "kelp", [1, 40], 0.3, 1, b("bream", {}), "midwater", 16, {"c": ["#5a4a3a", "#7a6a54", "#a09078"], "fin": "#5a4a3a"}, "子どもを産むウミタナゴの仲間。ケルプの森の岩場を群れで泳ぐ。", {}),
  fx("wolfeel", "ウルフイール", "Anarrhichthys ocellatus", "kelp", [5, 40], 1.5, 3, b("blenny", {"H": 0.1}), "perch", 1, {"c": ["#7a7a7a", "#9a9a9a", "#c0c0c0"], "fin": "#7a7a7a", "spots": [[40, 0.01, 0.02, "rgba(40,40,40,0.7)"]]}, "大きな頭とウナギのような体の魚。岩穴に夫婦で暮らし、ウニを噛み砕く。", {}),
  fx("offshoreflying", "ハマトビウオ", "Cypselurus pinnatibarbatus", "offshore", [0, 5], 0.4, 1, b("flying", {}), "surface", 20, {"c": ["#2a3a6a", "#9ab0c8", "#eef2f6"], "mid": 0.4, "fin": "#3a4a7a"}, "大きな胸ビレを広げて海面を数百メートルも滑空する。", {"metal": 0.5}),
  fx("shiira2", "ツバメコノシロ", "Polydactylus plebeius", "lagoon", [0, 15], 0.35, 1, b("mullet", {"H": 0.22}), "sandForage", 8, {"c": ["#9aa0a8", "#c0c4c8", "#e8eaec"], "fin": "#f6d21e"}, "胸ビレの下に糸のような遊離軟条をもち、砂の中の餌を探る。", {"metal": 0.4}),
  fx("lagoonpipefish", "オイランヨウジ", "Doryrhamphus dactyliophorus", "reef", [2, 40], 0.15, 2, b("needle", {"H": 0.04}), "under", 4, {"c": ["#c83a2a", "#f0e0d0", "#c83a2a"], "fin": "#c83a2a", "bars": [[0.4, 0.03, "#c83a2a"], [0.3, 0.03, "#c83a2a"], [0.2, 0.03, "#c83a2a"], [0.1, 0.03, "#c83a2a"], [0.0, 0.03, "#c83a2a"], [-0.1, 0.03, "#c83a2a"], [-0.2, 0.03, "#c83a2a"]]}, "赤白の縞模様の細長いヨウジウオ。岩陰でほかの魚の掃除もする。", {}),
  fx("reefdragonet", "コウワンテグリ", "Neosynchiropus ijimai", "rocky", [3, 30], 0.08, 2, b("goby", {"H": 0.2}), "sandForage", 4, {"c": ["#c86a3a", "#d8885a", "#e8b08a"], "fin": "#3a6ad0", "net": "rgba(40,60,160,0.6)"}, "温帯の岩礁にすむネズッポの仲間。雄は背ビレを旗のように広げる。", {"region": "sandSpots"}),
  fx("rockyfilefish", "ヨソギ", "Paramonacanthus oblongus", "rocky", [2, 30], 0.2, 1, b("file", {"filament": 0.08}), "rockyRoam", 4, {"c": ["#a09060", "#b8a878", "#d0c4a0"], "fin": "#a09060", "spots": [[40, 0.006, 0.012, "rgba(60,50,30,0.6)"]]}, "雄の背ビレの一部が糸のように長く伸びる。おちょぼ口で砂の中の貝を吹き出して食べる。", {}),
  fx("ishiyouji", "イシヨウジ", "Corythoichthys haematopterus", "reef", [1, 20], 0.15, 1, b("needle", {"H": 0.05}), "sandForage", 6, {"c": ["#c8b090", "#d8c4a8", "#e8dcc8"], "fin": "#c84a3a", "bars": [[0.3, 0.02, "rgba(140,60,40,0.6)"], [0.1, 0.02, "rgba(140,60,40,0.6)"], [-0.1, 0.02, "rgba(140,60,40,0.6)"], [-0.3, 0.02, "rgba(140,60,40,0.6)"]]}, "サンゴのがれ場をくねくねと這うように泳ぐヨウジウオ。", {}),
  fx("kumasasa", "クマササハナムロ", "Caesio cuning", "reef", [1, 40], 0.3, 1, b("fusilier", {}), "midwater", 60, {"c": ["#3a6ac0", "#6a90d0", "#e8eef4"], "mid": 0.5, "fin": "#f6d21e", "tail": "#f6d21e", "rear": [-0.25, "#f6d21e"]}, "青い体に黄色い尾のタカサゴの仲間。礁の縁の中層を大群で泳ぐ。", {}),
  fx("yaitobera", "ヤイトベラ", "Choerodon schoenleinii", "reef", [3, 40], 0.7, 2, b("bigwrasse", {}), "reefRoam", 3, {"c": ["#3a6a8a", "#5a8aa8", "#a8c8d8"], "fin": "#3a6a8a", "spots": [[30, 0.005, 0.012, "#1a3a5a"]]}, "青緑色の大型のベラ。鋭い歯で貝やウニを砕いて食べる。", {}),
  nf("nudi", "mukademino", "ムカデミノウミウシ", "Pteraeolidia semperi", "reef", [1, 30], 0.08, 1, {}, ["#8a6ac0", "#e0d0f0", 40, null], 0, 0, "背中に房状の突起がびっしり並ぶ。体内に褐虫藻をすまわせ光合成でも栄養を得る。", {}),
  nf("nudi", "udefuritsuno", "ウデフリツノザヤウミウシ", "Thecacera pacifica", "rocky", [3, 30], 0.03, 2, {}, ["#f0c020", "#1a1a1a", 30, null], 0, 0, "黄色に黒い点、耳のような突起。「ピカチュウウミウシ」の愛称で人気。", {}),
  nf("nudi", "kiiroumiushi", "キイロウミウシ", "Doriprismatica atromarginata", "reef", [1, 25], 0.08, 1, {}, ["#f4e8a0", null, 0, "#1a1a1a"], 0, 0, "淡い黄色の体のふちが黒く縁取られる。外套膜をひらひらさせて泳ぐこともある。", {}),
  nf("nudi", "nishikiumiushi", "ニシキウミウシ", "Ceratosoma trilobatum", "reef", [2, 40], 0.15, 1, {}, ["#e08a50", "#f0e8e0", 30, "#a060c0"], 0, 0, "大型のウミウシ。オレンジの体に紫の縁取り、背中に角のような突起がある。", {}),
  nf("nudi", "meribeumiushi", "メリベウミウシ", "Melibe viridis", "lagoon", [1, 20], 0.2, 2, {}, ["#9a8a5a", "#c8b880", 50, null], 0, 0, "頭に大きなフード状の口があり、投網のように広げて小さなエビを捕らえる。", {}),
  nf("nudi", "fujitaumiushi", "フジタウミウシ", "Polycera fujitai", "rocky", [1, 20], 0.03, 1, {}, ["#3a3a4a", "#f0c020", 30, null], 0, 0, "黒い体に黄色い点と突起。温帯の岩礁でコケムシを食べる。", {}),
  nf("nudi", "otomeumiushi", "オトメウミウシ", "Dermatobranchus otome", "rocky", [3, 30], 0.03, 2, {}, ["#f0f0f0", null, 0, "#e05a2a"], 0, 0, "白い体に黒い縦線とオレンジの縁。乙女の名にふさわしい可憐なウミウシ。", {}),
  nf("nudi", "komonumiushi", "コモンウミウシ", "Goniobranchus aureopurpureus", "reef", [1, 30], 0.04, 1, {}, ["#f0e8f0", "#e0a030", 50, "#9a4ac0"], 0, 0, "白地に黄色い点が並び、ふちが紫色。浅いサンゴ礁でよく見られる。", {}),
  nf("nudi", "tsunozaya", "ツノザヤウミウシ", "Thecacera pennigera", "rocky", [3, 30], 0.03, 2, {}, ["#f4f0e8", "#f08a20", 40, null], 0, 0, "白地にオレンジと黒の細かい点。角のような突起をもつ小さなウミウシ。", {}),
  nf("nudi", "sakuraumiushi2", "エムラミノウミウシ", "Hermissenda emurai", "cold", [1, 20], 0.04, 1, {}, ["#d0d8e0", "#f08a40", 30, "#3a6ad0"], 0, 0, "青い線とオレンジの突起が美しいミノウミウシ。冷たい海に多い。", {}),
  nf("nudi", "kurumi", "コノハミドリガイ", "Elysia ornata", "reef", [3, 25], 0.1, 2, {}, ["#1a3a1a", "#3ac060", 40, null], 0, 0, "黒緑色の体に明るい緑の点が散らばる。ホヤを食べる大型のウミウシ。", {}),
  nf("nudi", "yamatoumiushi", "ヤマトウミウシ", "Homoiodoris japonica", "rocky", [1, 20], 0.08, 1, {}, ["#e8d8a0", "#c08040", 60, null], 0, 0, "淡黄色の体に茶色の点がある。温帯の潮間帯でカイメンを食べる。", {}),
  nf("star", "jyuzuberi", "ジュズベリヒトデ", "Fromia monilis", "reef", [1, 30], 0.12, 1, {"arms": 5, "arm": 0.4, "core": 0.12, "thick": 0.06, "sharp": 0.7}, ["#e05a2a", "#f0e0c0", 40, null], 10, 10, "赤い体にクリーム色の数珠のような模様。サンゴ礁の岩の上で目立つ。", {}),
  nf("urchin", "rappauni", "ラッパウニ", "Toxopneustes pileolus", "reef", [1, 30], 0.12, 2, {"spine": 0.3, "n": 60, "thin": 0.05}, ["#c8b0d0", "#f0e0f0", 40, null], 6, 6, "ラッパ状の小さなはさみ（叉棘）に強い毒をもつ。海藻のかけらを体にのせて隠れる。", {}),
  nf("urchin", "paipuuni", "パイプウニ", "Heterocentrotus mamillatus", "reef", [1, 20], 0.15, 1, {"spine": 0.7, "n": 26, "thin": 0.12}, ["#a83a2a", "#e8c0a0", 20, null], 6, 6, "鉛筆のように太いトゲをもつウニ。トゲは風鈴などの材料になる。", {}),
  nf("urchin", "bafununi", "バフンウニ", "Hemicentrotus pulcherrimus", "rocky", [0, 10], 0.05, 1, {"spine": 0.35, "n": 120, "thin": 0.02}, ["#3a5a2a", "#6a8a4a", 30, null], 24, 8, "短いトゲが密生した小型のウニ。磯の石の下に多く、高級なウニとして食べられる。", {}),
  nf("cuke", "janome", "ジャノメナマコ", "Bohadschia argus", "reef", [1, 30], 0.4, 1, {"papillae": 0}, ["#d8c8a0", "#5a4a3a", 40, null], 6, 6, "体中に蛇の目のような模様が並ぶナマコ。刺激すると白い糸を吐き出す。", {}),
  nf("cuke", "torafu", "トラフナマコ", "Holothuria pervicax", "reef", [1, 20], 0.3, 1, {"papillae": 40}, ["#c8b890", "#3a3a2a", 30, null], 6, 6, "岩の下から体の半分を出して砂を食べる。ナマコの仲間で虎のような斑紋がある。", {}),
  nf("clam", "himeshako", "ヒメシャコガイ", "Tridacna crocea", "reef", [0.5, 10], 0.12, 1, {"mantle": true}, ["#3a8ab0", "#9ae0f0", 60, null], 12, 12, "サンゴの岩に埋まり、色鮮やかな外套膜を広げる。外套膜の褐虫藻が光合成をする。", {}),
  nf("clam", "kuroawabi", "クロアワビ", "Haliotis discus", "rocky", [1, 20], 0.15, 2, {"mantle": false}, ["#4a4a3a", "#8a7a5a", 30, null], 6, 6, "海藻を食べる大型の巻貝。殻の穴から水を出し入れして呼吸する。", {}),
  nf("spindle", "horagai", "ホラガイ", "Charonia tritonis", "reef", [1, 30], 0.35, 2, {"len": 0.9, "rad": 0.3, "rows": 8, "open": true}, ["#e0c8a0", "#8a5a3a", 60, null], 2, 2, "日本最大級の巻貝。オニヒトデを食べる天敵として知られる。", {}),
  nf("spindle", "hoshidakara", "ホシダカラ", "Cypraea tigris", "reef", [1, 30], 0.1, 1, {"len": 0.6, "rad": 0.4, "rows": 4, "open": false}, ["#e8dcc8", "#3a2a1a", 60, null], 6, 6, "つやつやの殻に黒い斑点のタカラガイ。昼は外套膜を引っ込めて岩陰にいる。", {}),
  nf("spindle", "sazae", "サザエ", "Turbo sazae", "rocky", [0, 20], 0.1, 1, {"len": 0.5, "rad": 0.45, "rows": 6, "open": true}, ["#5a6a4a", "#8a9a70", 40, null], 12, 6, "とげのある殻の巻貝。岩礁で海藻を食べる。", {}),
  nf("spindle", "umiusagi", "ウミウサギガイ", "Ovula ovum", "reef", [1, 20], 0.1, 2, {"len": 0.6, "rad": 0.4, "rows": 4, "open": false}, ["#1a1a1a", "#f0f0e8", 20, null], 4, 4, "真っ白な殻を黒い外套膜で包んでいる。ソフトコーラルの上で暮らす。", {}),
  nf("worm", "keyari", "ケヤリムシ", "Sabellastarte japonica", "rocky", [0, 20], 0.12, 1, {}, ["#a06a3a", "#f0d0a0", 30, null], 12, 6, "羽根ぼうきのような触手を広げてプランクトンを集める。触ると一瞬で管に引っ込む。", {}),
  nf("shrimp", "teppouebi", "テッポウエビ", "Alpheus brevicristatus", "lagoon", [1, 20], 0.05, 1, {}, ["#c8a890", "#8a6a4a", 20, null], 10, 10, "大きなはさみを閉じて「パチン」と衝撃波を出し、獲物を気絶させる。ハゼと共生する。", {}),
  nf("shrimp", "monhanashako", "モンハナシャコ", "Odontodactylus scyllarus", "reef", [2, 30], 0.15, 2, {}, ["#3a9a5a", "#f08a40", 40, null], 3, 3, "虹色に輝くシャコ。ハンマーのような脚で貝殻を叩き割る強烈なパンチをもつ。", {}),
  nf("crab", "gazami", "ガザミ", "Portunus trituberculatus", "lagoon", [1, 30], 0.2, 1, {}, ["#5a6a7a", "#e0e0e8", 40, null], 6, 6, "泳ぐのが得意なカニ。後ろ脚がオールのように平たい。", {}),
  nf("crab", "ishigani", "イシガニ", "Charybdis japonica", "rocky", [0, 20], 0.1, 1, {}, ["#5a4a2a", "#8a7a4a", 30, null], 8, 8, "岩礁の石の下にすむ気の荒いカニ。", {}),
  nf("crab", "takaashigani", "タカアシガニ", "Macrocheira kaempferi", "deep", [150, 400], 2.5, 3, {}, ["#d06a3a", "#f0d0b0", 60, null], 2, 2, "脚を広げると3mを超える世界最大のカニ。日本近海の深海にすむ。", {"region": [-150, 150, 730, 1060]}),
  nf("crab", "sangogani", "サンゴガニ", "Trapezia cymodoce", "reef", [1, 20], 0.03, 1, {}, ["#e8a040", "#c05030", 20, null], 10, 10, "枝サンゴの間にすみ、サンゴをオニヒトデなどから守る共生ガニ。", {}),
  nf("jelly", "hanagasa", "ハナガサクラゲ", "Olindias formosa", "rocky", [1, 20], 0.12, 2, {"tentacles": 40, "tentLen": 0.3, "flat": 0.6}, ["rgba(220,240,230,0.8)", "rgba(240,140,60,0.8)", 0, null], 4, 2, "花笠のように色とりどりの触手を広げる美しいクラゲ。", {}),
  nf("jelly", "andonkurage", "アンドンクラゲ", "Carybdea brevipedalia", "lagoon", [0, 10], 0.04, 1, {"tentacles": 4, "tentLen": 0.6, "flat": 1.3}, ["rgba(230,240,250,0.8)", "rgba(240,180,160,0.6)", 0, null], 10, 3, "行灯（あんどん）のような四角い傘のクラゲ。お盆の頃に浅瀬に増え、刺されると痛い。", {}),
  nf("jelly", "aominoumiushi", "アオミノウミウシ", "Glaucus atlanticus", "offshore", [0, 1], 0.04, 3, {"tentacles": 6, "tentLen": 0.04, "flat": 1.8}, ["rgba(40,110,220,0.95)", "rgba(220,240,250,0.8)", 0, null], 4, 2, "海面に逆さまに浮かぶ青いウミウシ。カツオノエボシを食べてその毒を蓄える。", {"region": [-150, 150, 380, 700]}),
  nf("squid", "hotaruika", "ホタルイカ", "Watasenia scintillans", "deep", [150, 400], 0.07, 1, {"armLen": 0.25, "tentLen": 0.2, "finSize": 0.08}, ["#6a3a4a", "#6ae0ff", 40, null], 40, 6, "全身の発光器で青白く光る小さなイカ。春に富山湾の浅場へ大群で押し寄せる。", {"glow": 7004415, "region": [-150, 150, 730, 1060]}),
  nf("squid", "sodeika", "ソデイカ", "Thysanoteuthis rhombus", "offshore", [0, 60], 0.8, 2, {"armLen": 0.25, "tentLen": 0.15, "finSize": 0.35}, ["#a83a2a", "#e08060", 50, null], 2, 1, "ひし形の大きなヒレで外洋を泳ぐ大型のイカ。ペアで行動する。", {}),
  nf("octo", "mimicoctopus", "ミミックオクトパス", "Thaumoctopus mimicus", "lagoon", [1, 20], 0.5, 3, {}, ["#e8dcc8", "#5a3a2a", 30, "#5a3a2a"], 2, 2, "ミノカサゴやウミヘビなど、毒のある生き物の姿をまねて身を守る。", {}),
  nf("turtle", "osagame", "オサガメ", "Dermochelys coriacea", "offshore", [0, 100], 2.0, 3, {}, ["#2a2a2e", "#c8c8d0", 80, null], 1, 1, "最大のウミガメ。甲羅は硬い板でなく、革のような皮膚に覆われている。クラゲを主食にする。", {}),
  nf("ray", "madaraei", "マダラエイ", "Taeniura meyeni", "reef", [2, 50], 1.6, 2, {"span": 0.85, "len": 0.9, "thick": 0.07, "tail": 0.9}, ["#5a5a52", "#2a2a26", 120, null], 2, 2, "大型のアカエイの仲間。黒と灰色のまだら模様で、砂地でじっと休む。", {}),
  nf("ray", "ushibanatobiei", "ウシバナトビエイ", "Rhinoptera javanica", "offshore", [0, 40], 1.2, 2, {"span": 1.0, "len": 0.5, "thick": 0.05, "tail": 0.8}, ["#6a5a48", "#3a3428", 0, null], 6, 1, "牛の鼻のような頭をしたトビエイ。群れで羽ばたくように泳ぐ。", {"region": [-150, 150, 380, 700]}),
  nf("ray", "batray", "コウモリエイ", "Myliobatis californica", "kelp", [1, 40], 1.0, 1, {"span": 1.0, "len": 0.5, "thick": 0.05, "tail": 0.9}, ["#3a3a34", "#2a2a24", 0, null], 3, 2, "ケルプの森の砂地を羽ばたくように泳ぐトビエイの仲間。", {}),
  nf("cet", "hashinaga", "ハシナガイルカ", "Stenella longirostris", "offshore", [0, 30], 2.0, 2, {"nose": 0.15}, ["#4a5260", "#6a7280", 0, "#e0e4e8"], 8, 1, "空中で何回転もするスピンジャンプが得意なイルカ。大きな群れで暮らす。", {}),
  nf("cet", "hanagondou", "ハナゴンドウ", "Grampus griseus", "offshore", [0, 40], 3.0, 3, {"nose": 0.85}, ["#8a8e94", "#a8acb0", 0, "#d8dadc"], 3, 1, "丸い頭のイルカ。仲間とのけんかでできた白い傷跡が体中に残る。", {}),
  nf("cet", "minkukujira", "ミンククジラ", "Balaenoptera acutorostrata", "offshore", [0, 40], 8.0, 3, {"nose": 0.3}, ["#2a2e34", "#3a3e44", 0, "#e0e2e4"], 1, 1, "ヒゲクジラの中では小型。胸ビレに白い帯がある。", {}),
  nf("cet", "shironagasu", "シロナガスクジラ", "Balaenoptera musculus", "offshore", [0, 60], 24.0, 3, {"nose": 0.4, "H": 0.16}, ["#6a7a88", "#7a8a98", 0, "#a8b4c0"], 1, 1, "地球史上最大の動物。全長30mにもなるが、食べるのは小さなオキアミ。", {}),
  nf("nudi", "hanagasaumiushi", "イボウミウシ", "Phyllidia varicosa", "reef", [5, 40], 0.1, 2, {}, ["#c86a3a", "#f0d0b0", 60, null], 0, 0, "平たい大型のウミウシ。オレンジの地に白い網目模様。", {}),
  nf("nudi", "sarasaumiushi", "サラサウミウシ", "Chromodoris annulata", "reef", [3, 30], 0.05, 2, {}, ["#f4f0f0", "#e08a40", 30, "#6a4ac0"], 0, 0, "白地にオレンジの点と紫の輪。浅いサンゴ礁の岩の上で見られる。", {}),
  nf("star", "akaumi", "コブヒトデ", "Protoreaster nodosus", "lagoon", [0, 20], 0.25, 1, {"arms": 5, "arm": 0.3, "core": 0.2, "thick": 0.12, "sharp": 0.9, "spines": 40}, ["#e08a40", "#2a2a2a", 40, null], 8, 8, "背中に黒い角のようなこぶが並ぶ大型のヒトデ。浅い砂地や藻場に多い。", {}),
  nf("shrimp", "sarasaebi", "サラサエビ", "Rhynchocinetes uritai", "rocky", [1, 30], 0.04, 1, {}, ["#d84a3a", "#f4f0e8", 40, null], 12, 6, "赤と白のまだら模様の小さなエビ。岩の割れ目に群れて目を光らせる。", {}),
  nf("shrimp", "kakurekumanomiebi", "アカホシカクレエビ", "Ancylomenes brevicarpalis", "reef", [1, 30], 0.03, 1, {}, ["rgba(240,240,250,0.8)", "#e04a8a", 20, null], 10, 10, "透明な体に紫の点。イソギンチャクの触手の間で暮らすクリーナー。", {"region": "anemones"}),
  nf("crab", "kurenai", "カイカムリ", "Lauridromia dehaani", "rocky", [5, 50], 0.15, 2, {}, ["#c0a080", "#8a6a4a", 40, null], 3, 3, "背中にカイメンを背負って隠れるカニ。後ろ脚でカイメンを押さえている。", {}),
  nf("crab", "yahazu", "ソメンヤドカリ", "Dardanus pedunculatus", "reef", [3, 30], 0.12, 1, {}, ["#c84a3a", "#f0e0c0", 30, null], 6, 6, "貝殻にイソギンチャクをつけて身を守るヤドカリ。引っ越しのときはイソギンチャクも連れて行く。", {}),
  nf("jelly", "kurageda", "ギヤマンクラゲ", "Tima formosa", "rocky", [0, 20], 0.1, 1, {"tentacles": 16, "tentLen": 0.4, "oral": true, "flat": 0.8}, ["rgba(230,240,250,0.85)", "rgba(220,180,240,0.7)", 0, null], 10, 3, "ギヤマン（ガラス）のように透きとおったクラゲ。春に岩礁の浅場で見られる。", {}),
];
