import * as THREE from 'three';
import { bez, finGrid, finalize, fishEnvelope, fishTop, fishWidthEnvelope, resample, setAttr, type FinTrace, type FishLayout, type FishShape } from './models';
import { angles, capK, limb, sstep, surfX, tube, type Part, type Prof, type Pts, type V3 } from './mammals';

/**
 * サメの専用の体（修正バッチ2 F12b、項目 (18)）。今までは魚の共通の体（buildFish）に「hetero」の尾を付けていた。ここでは
 *  - ①上下非対称の尾びれ（上葉が長い。ジンベエ・ウバザメ・アオザメは半月形、ニタリは細く長い上葉、ネムリブカ類は低く長い）
 *  - ②頭の形：とがった吻（cone）・平たく横に広いジンベエ（whale）・円錐でかさばるウバザメ（basking）・横に張り出したシュモク（hammer）・
 *    太い頭（broad：メガロドン・イタチザメ・オオメジロ）・丸い鼻（blunt）・平たい底生（flat）・刃のような吻（goblin：ミツクリザメ）
 *  - ③鰓孔 5 本（6 本）：体の溝（法線）と画像の暗い線（paint.ts の paintSharkExtras）
 *  - ④胸びれは体の下側から水平に張り出す鎌形（または丸いパドル）、腹びれ
 *  - ⑤第 1・第 2 背びれ（後ろに反った三角）としりびれ
 *  - ⑥模様（ジンベエの斑点・イタチザメの縞・ヨゴレなどのひれの白い縁）は paint.ts の paintSharkExtras
 * 体は buildFish と同じ約束：長さ 1（z = −0.5 … 0.5。尾びれは後ろへ はみ出す）、+z が前、横から見た投影の画像。
 * 水平のひれ（胸・腹）は横から見ると体に重なって色が決まらないので、画像の下端の「ひれの帯」に UV を向ける
 * （付け根 → 先で上から下へ。paintSharkExtras がひれの色から先の色へグラデーションを塗る）。
 */

export type SharkHead = 'cone' | 'whale' | 'basking' | 'hammer' | 'broad' | 'blunt' | 'flat' | 'goblin';
export type SharkTail = 'hetero' | 'crescent' | 'long' | 'low';
export type SharkPattern = 'whale' | 'tiger' | 'tips';
export type SharkSpec = {
  head: SharkHead;
  /** 鰓孔の数（既定 5）と長さ（1＝普通、ウバザメは体を一周する長さ） */
  gills?: number;
  gillLen?: number;
  tail?: SharkTail;
  /** 胸びれ：sickle＝鎌形（既定）、paddle＝丸いパドル */
  pect?: 'sickle' | 'paddle';
  /** 模様。tips＝ひれの先を tip の色で縁取る */
  pat?: SharkPattern;
  tip?: string;
  /** 先の色の範囲（ひれの高さのうち先の何割か）。既定 0.4 */
  tipK?: number;
  /** シュモクザメの頭翼の幅（体長に対する比） */
  span?: number;
  /** 背びれの上書き（単独の背びれなど） */
  dorsal?: { a: number; b: number; h: number; sweep?: number }[];
  /** 目を画像に描き足す（シュモクザメ：頭翼の先の目） */
  drawEye?: boolean;
};

export type SharkLayout = {
  spec: SharkSpec;
  /** ひれの帯：付け根（y0）→ 先（y1）の画像の高さ（モデルの y） */
  strip: { y0: number; y1: number };
  /** 鰓孔の位置 t */
  gills: number[];
  /** 背びれ・しりびれの付け根と高さ（先の色を塗る位置） */
  dorsals: { a: number; b: number; h: number; y: number }[];
  /** 尾びれ：後端の z と上葉・下葉の先 */
  tail: { tl: number; upper: [number, number]; lower: [number, number] };
  mouthT: number;
};

// --------------------------------------------------------------------------- 種ごとの指定

const W = '#f2f0e6';
/** id → 体の指定。ここに無い種は今までの魚の体のまま（写真テクスチャの種もここには入れない） */
export const SHARK_SPEC: Record<string, SharkSpec> = {
  whaleshark: { head: 'whale', gills: 5, gillLen: 1.6, tail: 'crescent', pect: 'paddle', pat: 'whale' },
  ubazame: { head: 'basking', gills: 5, gillLen: 2.5, tail: 'crescent', pect: 'paddle', dorsal: [{ a: 0.5, b: 0.64, h: 0.17, sweep: 0.5 }, { a: 0.2, b: 0.26, h: 0.045 }] },
  hammerhead: { head: 'hammer', span: 0.26, drawEye: true },
  itachizame: { head: 'broad', pat: 'tiger', pect: 'paddle' },
  yogore: { head: 'blunt', pect: 'paddle', pat: 'tips', tip: W, tipK: 0.5 },
  silvertip: { head: 'cone', pat: 'tips', tip: W },
  tsumaguro: { head: 'cone', pat: 'tips', tip: '#1a1c1e' },
  oomejirozame: { head: 'broad' },
  megalodon: { head: 'broad', gillLen: 1.3 },
  yoshikiri: { head: 'cone', pect: 'sickle' },
  aozame: { head: 'cone', tail: 'crescent' },
  shirowani: { head: 'cone' },
  dochizame: { head: 'blunt' },
  leopardshark: { head: 'blunt' },
  kagurazame: { head: 'blunt', gills: 6, dorsal: [{ a: 0.24, b: 0.37, h: 0.075, sweep: 0.5 }] },
  ondenzame: { head: 'blunt', tail: 'low', pect: 'paddle' },
  darumazame: { head: 'blunt', tail: 'low' },
  yoroizame: { head: 'blunt' },
  nitari: { head: 'cone', tail: 'long' },
  mitsukurizame: { head: 'goblin', pect: 'paddle' },
  hornshark: { head: 'blunt', tail: 'low', pect: 'paddle' },
  nekozame: { head: 'blunt', tail: 'low', pect: 'paddle' },
  ootenjiku: { head: 'flat', tail: 'low', pect: 'paddle' },
  torafuzame: { head: 'flat', tail: 'low', pect: 'paddle' },
  oose: { head: 'flat', tail: 'low', pect: 'paddle' },
};

// --------------------------------------------------------------------------- 部品

const smooth = (a: number, b: number, x: number) => sstep(a, b, x);

/** 頭の種類ごとの倍率：vh＝高さ、hw＝幅、cy＝中心線の持ち上げ、box＝断面の角 */
function headMod(spec: SharkSpec, shape: FishShape, t: number): { vh: number; hw: number; cy: number } {
  const k = smooth;
  switch (spec.head) {
    case 'whale': {
      const w = shape.headW ?? 1.4;
      return { vh: 1 - 0.36 * k(0.8, 0.98, t), hw: 1 + (w - 1) * k(0.6, 0.93, t), cy: 0 };
    }
    case 'basking':
      return { vh: 1 + 0.14 * k(0.55, 0.78, t) * (1 - k(0.86, 1, t)), hw: 1 + 0.05 * k(0.6, 0.85, t), cy: 0.008 * k(0.9, 1, t) };
    case 'hammer':
      return { vh: 1 - 0.1 * k(0.86, 1, t), hw: 1 - 0.4 * k(0.8, 0.95, t), cy: 0 };
    case 'broad':
      return { vh: 1 + 0.1 * k(0.6, 0.85, t), hw: 1 + 0.2 * k(0.55, 0.9, t), cy: 0 };
    case 'blunt':
      return { vh: 1, hw: 1 + 0.1 * k(0.7, 0.95, t), cy: 0 };
    case 'flat':
      return { vh: 1 - 0.3 * k(0.78, 0.97, t), hw: 1 + 0.28 * k(0.65, 0.95, t), cy: 0 };
    case 'goblin':
      return { vh: 1 - 0.1 * k(0.8, 0.95, t), hw: 1 - 0.55 * k(0.8, 0.93, t), cy: 0 };
    default:
      return { vh: 1, hw: 1, cy: 0 };
  }
}

/** 平らなレンズ形の板（頭翼・刃の吻）。planform(u, v)→ 前縁からの z のずれ（0..1 の v で前→後）。x = u·span/2、厚さは縁で 0 */
function plate(o: { zF: (u: number) => number; chord: (u: number) => number; span: number; th: number; nu: number; nv: number; y: number }): Part {
  const { nu, nv } = o;
  const pos: number[] = [];
  const idx: number[] = [];
  for (const sg of [1, -1]) {
    for (let i = 0; i <= nu; i++) {
      const u = -1 + (2 * i) / nu;
      const au = Math.abs(u);
      for (let j = 0; j <= nv; j++) {
        const v = j / nv;
        const th = o.th * Math.pow(Math.max(0, 1 - Math.pow(au, 1.8)), 0.6) * Math.pow(Math.max(0, Math.sin(Math.PI * Math.min(1, v * 0.96 + 0.02))), 0.55);
        pos.push((u * o.span) / 2, o.y + (sg * th) / 2, o.zF(u) - v * o.chord(u));
      }
    }
  }
  const nvv = (nu + 1) * (nv + 1);
  for (let s = 0; s < 2; s++)
    for (let i = 0; i < nu; i++)
      for (let j = 0; j < nv; j++) {
        const a = s * nvv + i * (nv + 1) + j, b = a + nv + 1;
        if (s === 0) idx.push(a, b, a + 1, a + 1, b, b + 1);
        else idx.push(a, a + 1, b, a + 1, b + 1, b);
      }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** 目の球の外側だけ（70% 埋める）。極は +x。x は体の表面の位置、c は画像の目の位置からのずれを測る中心 */
function eyeBall(x: number, y: number, z: number, r: number, side: number, detail: number): Part {
  const e = new THREE.SphereGeometry(r, detail ? 6 : 10, detail ? 3 : 5, 0, Math.PI * 2, 0, (117 * Math.PI) / 180);
  e.rotateZ(-Math.PI / 2);
  if (side < 0) e.rotateY(Math.PI);
  e.translate(x, y, z);
  e.userData.eye = true;
  e.userData.c = [y, z];
  return e;
}

// --------------------------------------------------------------------------- 組み立て

export function buildShark(spec: SharkSpec, shape: FishShape, detail: 0 | 1 = 0, fixed?: FishLayout): { geo: THREE.BufferGeometry; layout: FishLayout } {
  const H = shape.H, Wd = shape.W;
  const env0 = fishEnvelope(shape), wEnv = fishWidthEnvelope(shape), topK = fishTop(shape);
  const pect0 = shape.pect ?? { t: 0.64, len: 0.2, wid: 0.1, down: 0.3, out: 0.7 };
  const hm = (t: number) => headMod(spec, shape, t);
  const P: Prof = {
    top: (t) => (H / 2) * env0(t) * topK(t) * hm(t).vh,
    bot: (t) => (H / 2) * env0(t) * hm(t).vh * (spec.head === 'flat' ? 0.9 : 0.96),
    w: (t) => (Wd / 2) * wEnv(t) * hm(t).hw,
    cy: (t) => hm(t).cy,
    t0: 0, t1: 1, cap0: 0.03, cap1: spec.head === 'whale' ? 0.012 : spec.head === 'goblin' ? 0.03 : 0.02,
    box: spec.head === 'whale' || spec.head === 'flat' ? 2.5 : 2,
  };
  const parts: Part[] = [];
  const fins: FinTrace[] = [];

  // ---- 鰓孔：5 本（6 本）の溝
  const ng = spec.gills ?? 5;
  const gsp = spec.head === 'basking' ? 0.032 : spec.head === 'whale' ? 0.03 : 0.024;
  const gT0 = Math.min(0.8, pect0.t + 0.035);
  const gills: number[] = [];
  for (let i = 0; i < ng; i++) gills.push(gT0 + i * gsp);
  const gLen = (spec.gillLen ?? 1) * 0.55;
  const keel = spec.tail === 'crescent' || (spec.tail === undefined && shape.tail === 'lunate') ? 0.3 : 0;
  const rm = (t: number, a: number) => {
    let r = 1;
    const af = Math.min(a, Math.PI * 2 - a);
    if (!detail) {
      const lat = smooth(Math.PI / 2 - gLen - 0.25, Math.PI / 2 - gLen + 0.1, af) * (1 - smooth(Math.PI / 2 + gLen - 0.1, Math.PI / 2 + gLen + 0.25, af));
      if (lat > 0 && t > gT0 - 0.012 && t < gT0 + gsp * ng) for (const g of gills) r -= 0.07 * lat * Math.exp(-(((t - g) / 0.0055) ** 2));
    }
    if (keel && t < 0.2) r *= 1 + keel * Math.exp(-((Math.cos(af) / 0.28) ** 2)) * (1 - smooth(0.04, 0.2, t)) * 0.6;
    return r;
  };
  let ts: number[];
  if (detail) ts = Array.from({ length: 13 }, (_, i) => i / 12);
  else {
    ts = [0];
    let t = 0;
    const g0 = gT0 - 0.02, g1 = gT0 + gsp * ng + 0.01;
    while (t < 1) {
      const d = t > g0 && t < g1 ? 0.0075 : t > 0.9 ? 0.016 : 0.026;
      t = Math.min(1, t + d);
      ts.push(t);
    }
  }
  const body = tube(P, { S: ts.length - 1, ang: angles(detail ? 10 : 22), rm, ts });
  parts.push(body);

  // ---- 尾びれ（上下非対称）
  const z0 = -0.5, rz = z0 + 0.03;
  const tl = shape.tailL ?? 0.22;
  const th = shape.tailH ?? H * 1.1;
  const style: SharkTail = spec.tail ?? (shape.tail === 'lunate' ? 'crescent' : 'hetero');
  const pT = Math.max(0.012, P.top(0.04) * capK(P, 0.04)), pB = Math.max(0.012, P.bot(0.04) * capK(P, 0.04));
  const T: [number, number] = [rz, pT], Bm: [number, number] = [rz, -pB];
  let upper: [number, number], lower: [number, number];
  let edge: Pts;
  switch (style) {
    case 'crescent': {
      // 半月形：上葉がわずかに長い。ジンベエ・ウバザメ・アオザメ
      upper = [z0 - tl, th * 0.52];
      lower = [z0 - tl * 0.9, -th * 0.46];
      const N: [number, number] = [z0 - tl * 0.45, 0.01];
      edge = [T, ...bez(T, [z0 - tl * 0.36, th * 0.46], upper), ...bez(upper, [z0 - tl * 0.66, th * 0.1], N), ...bez(N, [z0 - tl * 0.62, -th * 0.1], lower), ...bez(lower, [z0 - tl * 0.36, -th * 0.42], Bm)];
      break;
    }
    case 'long': {
      // 長いむち（ニタリ）：上葉が体の半分近くまで細く伸びる
      upper = [z0 - tl, th * 0.3];
      lower = [z0 - tl * 0.18, -th * 0.2];
      const V: [number, number] = [z0 - tl * 0.12, 0.0];
      edge = [T, ...bez(T, [z0 - tl * 0.5, th * 0.18], upper), ...bez(upper, [z0 - tl * 0.55, th * 0.12], V, 5), ...bez(V, [z0 - tl * 0.14, -th * 0.1], lower, 3), ...bez(lower, [z0 - tl * 0.05, -th * 0.12], Bm, 3)];
      break;
    }
    case 'low': {
      // 低く長い（底生・深海のサメ）：下葉はほとんど無い
      upper = [z0 - tl, th * 0.4];
      lower = [z0 - tl * 0.36, -th * 0.2];
      const V: [number, number] = [z0 - tl * 0.3, 0.0];
      edge = [T, ...bez(T, [z0 - tl * 0.5, th * 0.34], upper), ...bez(upper, [z0 - tl * 0.8, th * 0.16], V), ...bez(V, [z0 - tl * 0.32, -th * 0.1], lower, 3), ...bez(lower, [z0 - tl * 0.12, -th * 0.12], Bm, 3)];
      break;
    }
    default: {
      // 異尾（標準）：上葉が長く、先に切れ込み。下葉は短い
      upper = [z0 - tl, th * 0.66];
      lower = [z0 - tl * 0.52, -th * 0.34];
      const V: [number, number] = [z0 - tl * 0.34, 0.0];
      const nt: [number, number] = [z0 - tl * 0.84, th * 0.5];
      edge = [T, ...bez(T, [z0 - tl * 0.5, th * 0.5], upper), ...bez(upper, [z0 - tl * 0.88, th * 0.6], nt, 2), ...bez(nt, [z0 - tl * 0.7, th * 0.2], V), ...bez(V, [z0 - tl * 0.5, -th * 0.12], lower, 3), ...bez(lower, [z0 - tl * 0.16, -th * 0.26], Bm, 3)];
    }
  }
  {
    const cols = detail ? 5 : 9;
    const e = resample(edge, cols);
    const root = e.map((_, k) => [rz, pT - (pT + pB) * (k / cols)] as [number, number]);
    const rootT = Math.max(0.006, P.w(0.04) * capK(P, 0.04) * 0.8);
    parts.push(finGrid({ root, edge: e, rows: detail ? 1 : 3, map: (a, b) => [0, b, a], half: () => rootT }));
    fins.push({ root, edge: e });
  }

  // ---- 背びれ（第 1・第 2）としりびれ：後ろに反った三角。先が後ろへ流れる
  const dorsalList = spec.dorsal ?? shape.dorsal ?? [];
  const finInfo: SharkLayout['dorsals'] = [];
  const sharkFin = (a: number, b: number, h: number, sweep: number, top: boolean, pk: number) => {
    const n = detail ? 3 : 7;
    const root: Pts = [], edgeP: Pts = [];
    for (let k = 0; k <= n; k++) {
      const u = k / n;
      const t = a + (b - a) * u;
      const y0 = (top ? P.top(t) : -P.bot(t)) * capK(P, t) * 0.93;
      const hh = h * (u <= pk ? Math.pow(u / pk, 0.85) : Math.pow((1 - u) / (1 - pk), 1.7));
      root.push([t - 0.5, y0]);
      edgeP.push([t - 0.5 - sweep * hh, y0 + (top ? hh : -hh)]);
    }
    parts.push(finGrid({ root, edge: edgeP, rows: detail ? 1 : 3, map: (p, q) => [0, q, p], half: () => Math.max(0.003, h * 0.06) }));
    fins.push({ root, edge: edgeP });
    finInfo.push({ a, b, h, y: (top ? P.top((a + b) / 2) : -P.bot((a + b) / 2)) * capK(P, (a + b) / 2) });
  };
  dorsalList.forEach((d, i) => { if (!detail || i === 0) sharkFin(d.a, d.b, d.h, d.sweep ?? 0.6, true, i === 0 ? 0.3 : 0.4); });
  if (!detail) for (const d of shape.anal ?? []) sharkFin(d.a, d.b, d.h, 0.35, false, 0.4);

  // ---- 胸びれ：体の下側から水平に張り出す。鎌形（先がとがり後縁がえぐれる）かパドル
  const strips: Part[] = [];
  const pk = pect0;
  const sizeK = pk.len / 0.2;
  {
    const L = pk.len, wd = pk.wid;
    const sick: Pts = [[0, 0], ...bez([0, 0], [L * 0.5, wd * 0.05], [L, -wd * 0.55], 4), ...bez([L, -wd * 0.55], [L * 0.5, -wd * 0.62], [0.012, -wd * 1.0], 5)];
    const padl: Pts = [[0, 0], ...bez([0, 0], [L * 0.55, wd * 0.08], [L * 0.96, -wd * 0.4], 4), ...bez([L * 0.96, -wd * 0.4], [L * 1.04, -wd * 0.9], [L * 0.6, -wd * 1.05], 4), ...bez([L * 0.6, -wd * 1.05], [L * 0.25, -wd * 1.05], [0.012, -wd * 0.95], 3)];
    const outline = spec.pect === 'paddle' ? padl : sick;
    const y0 = P.cy(pk.t) - 0.42 * P.bot(pk.t) * capK(P, pk.t);
    const down = Math.min(0.42, pk.down);
    for (const side of [-1, 1]) {
      const origin: V3 = [side * surfX(P, pk.t, y0) * 0.92, y0, pk.t - 0.5];
      const dir: V3 = [side * Math.cos(down), -Math.sin(down), -0.38];
      const g = limb(origin, dir, outline, detail ? 3 : 6, detail ? 1 : 2, side, detail ? 0 : 0.005, 'y');
      g.userData.strip = { x0: Math.abs(origin[0]), len: L * Math.cos(down) };
      strips.push(g);
      parts.push(g);
    }
    // 腹びれ（小さい）
    if (!detail) {
      const tp = 0.4;
      const yp = P.cy(tp) - 0.72 * P.bot(tp) * capK(P, tp);
      const Lp = 0.06 * sizeK, wp = 0.04 * sizeK;
      const pel: Pts = [[0, 0], ...bez([0, 0], [Lp * 0.5, wp * 0.05], [Lp, -wp * 0.5], 3), ...bez([Lp, -wp * 0.5], [Lp * 0.5, -wp * 0.6], [0.01, -wp], 3)];
      for (const side of [-1, 1]) {
        const origin: V3 = [side * surfX(P, tp, yp) * 0.9, yp, tp - 0.5];
        const g = limb(origin, [side * 0.93, -0.3, -0.3], pel, 3, 1, 0, 0.004, 'y');
        g.userData.strip = { x0: Math.abs(origin[0]), len: Lp * 0.93 };
        strips.push(g);
        parts.push(g);
      }
    }
  }

  // ---- 頭翼（シュモク）・刃の吻（ミツクリザメ）
  const eyes: Part[] = [];
  const eT = shape.eyeT ?? 0.9;
  const er = Math.max(0.003, (shape.eyes ?? 0.06) * H);
  if (spec.head === 'hammer') {
    const span = spec.span ?? 0.26;
    const yc = P.cy(0.93);
    parts.push(plate({
      zF: (u) => 0.5 - 0.004 - 0.012 * u * u + 0.008 * Math.exp(-((u / 0.12) ** 2)), chord: (u) => 0.15 - 0.095 * Math.pow(Math.abs(u), 1.3),
      span, th: H * 0.34, nu: detail ? 8 : 16, nv: detail ? 2 : 4, y: yc,
    }));
    if (!detail) for (const side of [-1, 1]) {
      const e = eyeBall(side * (span / 2 * 0.93), yc + H * 0.02, 0.5 - 0.035, er, side, detail);
      eyes.push(e); parts.push(e);
    }
  } else if (spec.head === 'goblin') {
    parts.push(plate({
      zF: (u) => 0.5 - 0.15 * Math.pow(Math.abs(u), 0.85), chord: (u) => 0.1 * (1 - Math.abs(u) * 0.6),
      span: 0.07, th: H * 0.14, nu: detail ? 4 : 8, nv: detail ? 2 : 3, y: P.cy(0.9) - H * 0.02,
    }));
    if (!detail) for (const side of [-1, 1]) {
      const y = (H / 2) * env0(eT) * 0.2;
      const e = eyeBall(side * (surfX(P, eT, y) - 0.4 * er), y, eT - 0.5, er, side, detail);
      eyes.push(e); parts.push(e);
    }
  } else if (!detail) {
    const topAt = (t: number) => P.top(t) * capK(P, t), botAt = (t: number) => P.bot(t) * capK(P, t);
    const y = (topAt(eT) / Math.max(1e-4, botAt(eT))) * (botAt(eT) * 0.22);
    for (const side of [-1, 1]) {
      const e = eyeBall(side * (surfX(P, eT, y) - 0.4 * er), y, eT - 0.5, er, side, detail);
      eyes.push(e); parts.push(e);
    }
  }

  // ---- 画像の範囲（横から見た投影）と UV
  let yTop = 0, yLow = 0, zMin = 0, zMax = 0.5;
  for (const g of parts) {
    if (g.userData.strip) continue;
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) { yTop = Math.max(yTop, p.getY(i)); yLow = Math.max(yLow, -p.getY(i)); zMin = Math.min(zMin, p.getZ(i)); zMax = Math.max(zMax, p.getZ(i)); }
  }
  // ひれの帯（画像の下端：高さの 2〜14%）は体・しりびれ・尾びれの下葉より下にとる
  let yMax = Math.max(yTop, yLow) * 1.02;
  yMax = Math.max(yMax, (yLow + 0.012) / 0.72);
  zMax += 0.005;
  if (fixed) { yMax = fixed.yMax; zMin = fixed.zMin; zMax = fixed.zMax; }
  const vOf = (y: number) => (y + yMax) / (2 * yMax);
  const sv = (s: number) => 0.14 - 0.12 * Math.min(1, Math.max(0, s));
  const eyeY = (() => { const topAt = P.top(eT) * capK(P, eT), botAt = P.bot(eT) * capK(P, eT); return (topAt / Math.max(1e-4, botAt)) * botAt * 0.22 + 0; })();
  for (const g of parts) {
    const p = g.attributes.position as THREE.BufferAttribute;
    const uv = new Float32Array(p.count * 2);
    const st = g.userData.strip as { x0: number; len: number } | undefined;
    const ec = g.userData.c as [number, number] | undefined;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      let u: number, v: number;
      if (st) { u = (z - zMin) / (zMax - zMin); v = sv((Math.abs(x) - st.x0) / st.len); }
      else if (ec) { u = (eT - 0.5 + (z - ec[1]) * 1.25 - zMin) / (zMax - zMin); v = vOf(eyeY + (y - ec[0]) * 1.25); }
      else { u = (z - zMin) / (zMax - zMin); v = vOf(y); }
      uv[i * 2] = u; uv[i * 2 + 1] = v;
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    if (!g.attributes.aBend) setAttr(g, 'aBend', (_x, _y, zz) => Math.pow(Math.min(1, Math.max(0, (0.5 - zz) / 1.0)), 1.6) * 0.95 + 0.05);
    if (!g.attributes.aFin) setAttr(g, 'aFin', () => (g.userData.eye ? 2 : 0));
  }
  const geo = finalize(parts);

  // ---- 画像用の体の輪郭
  const n = 64;
  let hMax = 0;
  for (let i = 0; i <= n; i++) { const t = i / n; const k = capK(P, t); hMax = Math.max(hMax, P.top(t) * k, P.bot(t) * k); }
  const Hs = 2 * hMax;
  const botAt = (t: number) => P.bot(t) * capK(P, t);
  const topAt = (t: number) => P.top(t) * capK(P, t);
  const env = (t: number) => Math.max(1e-4, botAt(t)) / (Hs / 2);
  const top = (t: number) => (topAt(t) + 1e-4) / (botAt(t) + 1e-4);
  const shk: SharkLayout = {
    spec,
    strip: { y0: -yMax + 2 * yMax * sv(0), y1: -yMax + 2 * yMax * sv(1) },
    gills,
    dorsals: finInfo,
    tail: { tl, upper, lower },
    mouthT: 0.93,
  };
  const eyeRel = (shape.eyes ?? 0.06) * H / Hs;
  const layout: FishLayout = {
    zMin, zMax, yMax, env, top, mid: P.cy, v2: true, fins,
    shape: { ...shape, H: Hs, belly: 0, eyes: eyeRel },
    gillT: gills[0] - 0.012,
    mouthY: spec.head === 'whale' || spec.head === 'basking' ? -0.12 * botAt(0.97) : -0.5 * botAt(0.97),
    shk,
  };
  return { geo, layout };
}
