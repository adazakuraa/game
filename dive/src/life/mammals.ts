import * as THREE from 'three';
import { bez, finGrid, finalize, resample, setAttr, spow, type FishLayout, type FishShape } from './models';

/**
 * 海生哺乳類の専用の体（修正バッチ2 F12a、項目 (18)）。
 * 今までは魚の共通の体（buildFish）に水平の尾びれだけ付けていた。ここでは
 *  - buildCetacean：クジラ・イルカ・シャチ・ジュゴン。上下に細る尾柄と水平の尾びれ、パドル形の胸びれ、種ごとの背びれ、
 *    イルカのくちばしとメロン、マッコウの四角い頭、ヒゲクジラの平たい頭と下あごの畝、噴気孔のくぼみ。
 *  - buildPinniped：アザラシ・アシカ・オットセイ・トド・ラッコ。首と丸い頭、前肢、左右に開く後肢、ひげ、耳、ラッコは仰向け。
 * 体は長さ 1（z = −0.5 … 0.5。尾びれの端まで含む）、+z が前。横から見た投影で UV を決める（魚と同じ。paint.ts の paintMammal が描く）。
 * ひれ・肢・ひげは横から見ると体に重なって色が決まらないので、UV を「色見本」（画像の左上隅の小さな四角）に向ける。
 */

export type CetKind = 'dolphin' | 'orca' | 'humpback' | 'minke' | 'blue' | 'sperm' | 'dugong';
/** beak：イルカのくちばしの長さ 0..1（既定 0.6）、melon：メロン（額）の膨らみの倍率（既定 1） */
export type CetSpec = { kind: CetKind; beak?: number; melon?: number };
export type PinKind = 'seal' | 'sealion' | 'furseal' | 'steller' | 'otter';
export type PinSpec = { kind: PinKind };

export type MamLayout = {
  kind: CetKind | PinKind;
  eye: { t: number; y: number; r: number };
  mouth: { t1: number; y: (t: number) => number };
  blow?: { t: number; y: number };
  nose?: { t: number; y: number };
  /** 腹の畝（ヒゲクジラ）の範囲 t */
  groove?: [number, number];
  /** 体の断面の高さ（上・下）と中心線（t = 0 尾 … 1 吻端）。模様を描くときに使う */
  body: { top: (t: number) => number; bot: (t: number) => number; cy: (t: number) => number; t0: number };
  /** 色見本（limb・fluke・pale）の中心の UV。Paint.patch(k) の四角と同じ位置 */
  patch: { limb: [number, number]; fluke: [number, number]; pale: [number, number] };
  /** ラッコ：仰向けで作ってある（画像は立った姿勢のまま描く） */
  supine?: boolean;
};

/** 色見本：画像の左上隅に横 3% × 縦 7% の四角を 3 つ並べる（k = 0 limb, 1 fluke, 2 pale） */
export const MAM_PATCH = { w: 0.03, h: 0.07 };
const patchUV = (k: number): [number, number] => [MAM_PATCH.w * (k + 0.5), 1 - MAM_PATCH.h / 2];

// --------------------------------------------------------------------------- helpers

type Part = THREE.BufferGeometry;
type Pts = [number, number][];
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const sstep = (a: number, b: number, x: number) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

/** 単調な 3 次補間（PCHIP）：制御点の間でふくらみすぎない */
function pchip(pts: Pts): (x: number) => number {
  const n = pts.length;
  const h: number[] = [], d: number[] = [], m: number[] = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) { h[i] = pts[i + 1][0] - pts[i][0]; d[i] = (pts[i + 1][1] - pts[i][1]) / h[i]; }
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) m[i] = 0;
    else { const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1]; m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]); }
  }
  return (x: number) => {
    if (x <= pts[0][0]) return pts[0][1];
    if (x >= pts[n - 1][0]) return pts[n - 1][1];
    let i = 0;
    while (i < n - 2 && x > pts[i + 1][0]) i++;
    const t = (x - pts[i][0]) / h[i], t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * pts[i][1] + (t3 - 2 * t2 + t) * h[i] * m[i] + (-2 * t3 + 3 * t2) * pts[i + 1][1] + (t3 - t2) * h[i] * m[i + 1];
  };
}

type Prof = {
  top: (t: number) => number; bot: (t: number) => number; w: (t: number) => number; cy: (t: number) => number;
  t0: number; t1: number; cap0: number; cap1: number; box: number;
};

/** 端の丸め（半楕円）：吻端と尾の付け根を閉じる */
function capK(P: Prof, t: number): number {
  let f = 1;
  if (P.cap1 > 0 && t > P.t1 - P.cap1) { const u = (t - (P.t1 - P.cap1)) / P.cap1; f = Math.min(f, Math.sqrt(Math.max(0, 1 - u * u))); }
  if (P.cap0 > 0 && t < P.t0 + P.cap0) { const u = (P.t0 + P.cap0 - t) / P.cap0; f = Math.min(f, Math.sqrt(Math.max(0, 1 - u * u))); }
  return Math.max(0.03, f);
}

/** 高さ y（体の中心線からの上下）での体の半幅 */
function surfX(P: Prof, t: number, y: number): number {
  const k = capK(P, t);
  const ym = y - P.cy(t);
  const h = Math.max(1e-4, (ym >= 0 ? P.top(t) : P.bot(t)) * k);
  const f = Math.min(1, Math.abs(ym) / h);
  return P.w(t) * k * Math.pow(Math.max(0, 1 - Math.pow(f, P.box)), 1 / P.box);
}

/** 周りの角度の並び：腹側（a = π のまわり）だけ細かくできる。最後は 2π（継ぎ目の重複） */
function angles(R: number, vent?: { half: number; nv: number }): number[] {
  const out: number[] = [];
  if (!vent) { for (let j = 0; j <= R; j++) out.push((j / R) * Math.PI * 2); return out; }
  const nA = Math.max(3, Math.round((R - vent.nv) / 2));
  const a1 = Math.PI - vent.half;
  for (let i = 0; i < nA; i++) out.push((i / nA) * a1);
  for (let i = 0; i < vent.nv; i++) out.push(a1 + (i / vent.nv) * 2 * vent.half);
  for (let i = 0; i < nA; i++) out.push(Math.PI + vent.half + (i / nA) * a1);
  out.push(Math.PI * 2);
  return out;
}

type TubeOpts = { S: number; ang: number[]; rm?: (t: number, a: number) => number };

/** 断面がスーパー楕円の管。z = t − 0.5。aAO（腹側を暗く）を持つ */
function tube(P: Prof, o: TubeOpts): Part {
  const { S, ang } = o;
  const R = ang.length - 1;
  const ex = 2 / P.box;
  const pos: number[] = [];
  const ao: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= S; i++) {
    const t = P.t0 + (P.t1 - P.t0) * (0.5 - 0.5 * Math.cos((Math.PI * i) / S));
    const k = capK(P, t);
    const cy = P.cy(t);
    const top = P.top(t) * k, bot = P.bot(t) * k, w = P.w(t) * k;
    for (let j = 0; j <= R; j++) {
      const a = ang[j];
      const c = Math.cos(a), s = Math.sin(a);
      const rm = o.rm ? o.rm(t, a) : 1;
      pos.push(w * spow(s, ex) * rm, cy + (c >= 0 ? top : bot) * spow(c, ex) * rm, t - 0.5);
      ao.push(Math.max(0.55, 1 - 0.3 * Math.pow(Math.max(0, -c), 1.3)));
    }
  }
  for (let i = 0; i < S; i++)
    for (let j = 0; j < R; j++) {
      const a = i * (R + 1) + j, b = a + R + 1;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aAO', new THREE.Float32BufferAttribute(ao, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  // 背の継ぎ目（j = 0 と j = R は別の頂点）：法線をそろえて筋が出ないように
  const n = g.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i <= S; i++) {
    const a = i * (R + 1), b = a + R;
    const nx = n.getX(a) + n.getX(b), ny = n.getY(a) + n.getY(b), nz = n.getZ(a) + n.getZ(b);
    const l = Math.hypot(nx, ny, nz) || 1;
    n.setXYZ(a, nx / l, ny / l, nz / l);
    n.setXYZ(b, nx / l, ny / l, nz / l);
  }
  return g;
}

/** ひれの輪郭（パドル）。a = 付け根から先へ、b = 前縁から後ろへ（後ろは負）。最後の点が付け根の後縁 */
function paddle(len: number, wid: number, base: number, lean: number, n = 4): Pts {
  const tip: [number, number] = [len, -wid * lean];
  return [[0, 0], ...bez([0, 0], [len * 0.45, wid * 0.18], tip, n), ...bez(tip, [len * 0.8, -wid * 1.05], [len * 0.45, -wid * 0.95], n), ...bez([len * 0.45, -wid * 0.95], [len * 0.2, -wid * 0.85], [0.01, -base], n)];
}

/** 後肢（水かきのある扇）：先がつま先の数だけ波打つ。外側が +b、内側が −b */
function fan(len: number, wid: number, toes: number): Pts {
  const out: Pts = [[0, wid * 0.3]];
  out.push([len * 0.55, wid * 0.42]);
  for (let k = 0; k <= toes; k++) {
    const u = k / toes;
    const a = len * (0.8 + 0.2 * (k % 2 === 0 ? 1 : 0.84) * (1 - 0.18 * u));
    out.push([a, wid * 0.3 - u * wid * 1.3]);
  }
  out.push([0.01, -wid]);
  return out;
}

type V3 = [number, number, number];
const norm3 = (v: V3): V3 => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
/** 肢の向き d（付け根から先）と、それに直交して前向き（+z）側の e */
function frame(d: V3): { d: V3; e: V3 } {
  const dd = norm3(d);
  const dot = dd[2];
  return { d: dd, e: norm3([-dot * dd[0], -dot * dd[1], 1 - dot * dd[2]]) };
}

/** 付け根 origin から d 方向に伸びる板状の肢（ひれ）。flapSign = ±1 で胸びれの羽ばたき（aFlap）の向き */
function limb(origin: V3, d: V3, outline: Pts, cols: number, rows: number, flapSign: number, thick = 0): Part {
  const { d: dd, e } = frame(d);
  const e0 = resample(outline, cols);
  const rEnd = outline[outline.length - 1];
  const root = e0.map((_, k) => [(rEnd[0] * k) / cols, (rEnd[1] * k) / cols] as [number, number]);
  return finGrid({
    root, edge: e0, rows, flap: flapSign,
    map: (a, b) => [origin[0] + dd[0] * a + e[0] * b, origin[1] + dd[1] * a + e[1] * b, origin[2] + dd[2] * a + e[2] * b],
    half: thick > 0 ? () => thick : undefined,
  });
}

/** 細い板（ひげ・耳の先など）：2 三角形 */
function strip(p0: V3, dir: V3, len: number, wd: number): Part {
  const d = norm3(dir);
  const up: V3 = Math.abs(d[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const n = norm3([d[1] * up[2] - d[2] * up[1], d[2] * up[0] - d[0] * up[2], d[0] * up[1] - d[1] * up[0]]);
  const a: V3 = [p0[0] - n[0] * wd / 2, p0[1] - n[1] * wd / 2, p0[2] - n[2] * wd / 2];
  const b: V3 = [p0[0] + n[0] * wd / 2, p0[1] + n[1] * wd / 2, p0[2] + n[2] * wd / 2];
  const c: V3 = [p0[0] + d[0] * len + n[0] * wd * 0.15, p0[1] + d[1] * len + n[1] * wd * 0.15, p0[2] + d[2] * len + n[2] * wd * 0.15];
  const e: V3 = [p0[0] + d[0] * len - n[0] * wd * 0.15, p0[1] + d[1] * len - n[1] * wd * 0.15, p0[2] + d[2] * len - n[2] * wd * 0.15];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c, ...a, ...c, ...e], 3));
  g.computeVertexNormals();
  return g;
}

function setUV(g: Part, fn: (x: number, y: number, z: number) => [number, number]) {
  const g2 = g;
  const p = g2.attributes.position as THREE.BufferAttribute;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) { const [u, v] = fn(p.getX(i), p.getY(i), p.getZ(i)); uv[i * 2] = u; uv[i * 2 + 1] = v; }
  g2.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

function finishParts(parts: Part[]) {
  for (const g of parts) {
    const gg = g;
    if (!gg.attributes.aBend) setAttr(gg, 'aBend', (_x, _y, z) => Math.pow(Math.min(1, Math.max(0, (0.5 - z) / 1.0)), 1.6) * 0.95 + 0.05);
    setAttr(gg, 'aFin', () => (gg.userData.eye ? 2 : 0));
  }
}

/** 目：球の外側だけ（70% 埋める）。極は +x。横から見た画像の目の位置に UV を合わせる */
function eyeCap(P: Prof, t: number, y: number, r: number, side: number, detail: number): Part {
  const e = new THREE.SphereGeometry(r, detail ? 6 : 10, detail ? 3 : 5, 0, Math.PI * 2, 0, (117 * Math.PI) / 180);
  e.rotateZ(-Math.PI / 2);
  if (side < 0) e.rotateY(Math.PI);
  e.translate(side * (surfX(P, t, y) - 0.4 * r), y, t - 0.5);
  e.userData.eye = true;
  return e;
}

// --------------------------------------------------------------------------- cetaceans

type CetPre = {
  top: Pts; bot: Pts; w: Pts; cy?: Pts; box?: number; t0: number; cap0: number; cap1: number;
  dorsal?: { a: number; b: number; h: number; pk: number; conc: number; sweep: number };
  pect: { t: number; len: number; wid: number; base: number; down: number; sw: number; lean: number; yk?: number };
  fluke: { span: number; notch: number; root: number };
  groove?: { tA: number; tB: number; ng: number; amp: number };
  eye: { t: number; k: number; r: number };
  mouth: { t1: number; k0: number; k1: number };
  blow: { t: number; dep: number };
  tub?: number;
};

function cetPreset(spec: CetSpec): CetPre {
  const beak = spec.beak ?? 0.6, mel = spec.melon ?? 1;
  switch (spec.kind) {
    case 'dolphin': {
      const lb = 0.035 + 0.075 * beak, tr = 1 - lb, tm = tr - 0.07, tq = tr - 0.025;
      const head = (a: number, b: number, c: number, d: number, e: number) => [a * mel, b * mel, c, d, e];
      const [t1, t2] = [head(0.082, 0.052, 0.026, 0.02, 0.016), head(0.06, 0.03, 0.014, 0.011, 0.009)];
      return {
        top: [[0.08, 0.028], [0.18, 0.044], [0.32, 0.07], [0.48, 0.092], [0.62, 0.1], [0.72, 0.098], [0.8, 0.09], [tm, t1[0]], [tq, t1[1]], [tr, t1[2]], [1 - lb * 0.5, t1[3]], [1, t1[4]]],
        bot: [[0.08, 0.026], [0.18, 0.04], [0.32, 0.064], [0.48, 0.084], [0.62, 0.092], [0.72, 0.09], [0.8, 0.08], [tm, t2[0]], [tq, t2[1]], [tr, t2[2]], [1 - lb * 0.5, t2[3]], [1, t2[4]]],
        w: [[0.08, 0.013], [0.18, 0.026], [0.32, 0.048], [0.48, 0.068], [0.62, 0.078], [0.72, 0.076], [0.8, 0.068], [tm, 0.05], [tq, 0.034], [tr, 0.02], [1 - lb * 0.5, 0.016], [1, 0.012]],
        cy: [[0.08, 0], [tm, 0], [tr, -0.012], [1, -0.016]], t0: 0.08, cap0: 0.035, cap1: 0.012,
        dorsal: { a: 0.46, b: 0.6, h: 0.075, pk: 0.5, conc: 1.5, sweep: 0.9 },
        pect: { t: 0.7, len: 0.17, wid: 0.055, base: 0.025, down: 0.9, sw: 0.35, lean: 0.5 },
        fluke: { span: 0.23, notch: 0.04, root: 0.012 },
        eye: { t: tr - 0.09, k: 0.12, r: 0.0085 }, mouth: { t1: tr - 0.075, k0: -0.3, k1: -0.2 }, blow: { t: tr - 0.12, dep: 0.1 },
      };
    }
    case 'orca':
      return {
        top: [[0.08, 0.03], [0.18, 0.05], [0.32, 0.082], [0.46, 0.102], [0.56, 0.106], [0.7, 0.1], [0.82, 0.086], [0.92, 0.062], [0.975, 0.034], [1, 0.016]],
        bot: [[0.08, 0.028], [0.18, 0.046], [0.32, 0.078], [0.46, 0.098], [0.56, 0.102], [0.7, 0.092], [0.82, 0.074], [0.92, 0.048], [0.975, 0.024], [1, 0.01]],
        w: [[0.08, 0.014], [0.18, 0.03], [0.32, 0.06], [0.46, 0.082], [0.56, 0.088], [0.7, 0.082], [0.82, 0.068], [0.92, 0.046], [0.975, 0.026], [1, 0.014]],
        t0: 0.08, cap0: 0.035, cap1: 0.02,
        dorsal: { a: 0.4, b: 0.55, h: 0.15, pk: 0.42, conc: 1.2, sweep: 0.35 },
        pect: { t: 0.68, len: 0.16, wid: 0.085, base: 0.04, down: 1.0, sw: 0.25, lean: 0.1 },
        fluke: { span: 0.25, notch: 0.04, root: 0.014 },
        eye: { t: 0.905, k: 0.1, r: 0.0085 }, mouth: { t1: 0.885, k0: -0.3, k1: -0.2 }, blow: { t: 0.8, dep: 0.1 },
      };
    case 'humpback':
      return {
        top: [[0.08, 0.03], [0.18, 0.05], [0.3, 0.08], [0.45, 0.105], [0.55, 0.112], [0.68, 0.108], [0.8, 0.095], [0.9, 0.068], [0.97, 0.04], [1, 0.016]],
        bot: [[0.08, 0.028], [0.18, 0.046], [0.3, 0.075], [0.45, 0.1], [0.55, 0.108], [0.68, 0.104], [0.8, 0.092], [0.9, 0.074], [0.97, 0.048], [1, 0.026]],
        w: [[0.08, 0.014], [0.18, 0.032], [0.3, 0.065], [0.45, 0.092], [0.55, 0.1], [0.68, 0.1], [0.8, 0.095], [0.9, 0.09], [0.97, 0.07], [1, 0.035]],
        t0: 0.08, cap0: 0.035, cap1: 0.02,
        dorsal: { a: 0.3, b: 0.4, h: 0.035, pk: 0.5, conc: 1.4, sweep: 0.5 },
        pect: { t: 0.7, len: 0.3, wid: 0.045, base: 0.03, down: 0.9, sw: 0.55, lean: 0.4 },
        fluke: { span: 0.3, notch: 0.05, root: 0.016 },
        groove: { tA: 0.5, tB: 0.95, ng: 12, amp: 0.05 },
        eye: { t: 0.865, k: -0.1, r: 0.0065 }, mouth: { t1: 0.85, k0: -0.3, k1: 0.05 }, blow: { t: 0.8, dep: 0.1 }, tub: 14,
      };
    case 'minke':
      return {
        top: [[0.08, 0.026], [0.18, 0.04], [0.3, 0.062], [0.45, 0.08], [0.58, 0.088], [0.72, 0.084], [0.84, 0.07], [0.93, 0.042], [1, 0.012]],
        bot: [[0.08, 0.024], [0.18, 0.037], [0.3, 0.058], [0.45, 0.074], [0.58, 0.08], [0.72, 0.076], [0.84, 0.06], [0.93, 0.034], [1, 0.01]],
        w: [[0.08, 0.013], [0.2, 0.03], [0.35, 0.052], [0.5, 0.068], [0.62, 0.072], [0.74, 0.068], [0.86, 0.052], [0.95, 0.026], [1, 0.008]],
        t0: 0.08, cap0: 0.035, cap1: 0.012,
        dorsal: { a: 0.3, b: 0.38, h: 0.05, pk: 0.4, conc: 1.6, sweep: 0.8 },
        pect: { t: 0.74, len: 0.13, wid: 0.035, base: 0.02, down: 0.9, sw: 0.4, lean: 0.45 },
        fluke: { span: 0.24, notch: 0.04, root: 0.012 },
        groove: { tA: 0.55, tB: 0.92, ng: 9, amp: 0.04 },
        eye: { t: 0.87, k: -0.08, r: 0.0055 }, mouth: { t1: 0.86, k0: -0.25, k1: 0 }, blow: { t: 0.8, dep: 0.1 },
      };
    case 'blue':
      return {
        top: [[0.08, 0.02], [0.18, 0.036], [0.3, 0.06], [0.45, 0.08], [0.55, 0.085], [0.68, 0.083], [0.8, 0.076], [0.9, 0.062], [0.97, 0.04], [1, 0.016]],
        bot: [[0.08, 0.019], [0.18, 0.034], [0.3, 0.056], [0.45, 0.074], [0.55, 0.079], [0.68, 0.077], [0.8, 0.07], [0.9, 0.058], [0.97, 0.04], [1, 0.02]],
        w: [[0.08, 0.012], [0.18, 0.026], [0.3, 0.048], [0.45, 0.066], [0.55, 0.072], [0.68, 0.072], [0.8, 0.07], [0.9, 0.066], [0.97, 0.05], [1, 0.03]],
        t0: 0.08, cap0: 0.035, cap1: 0.018,
        dorsal: { a: 0.2, b: 0.27, h: 0.016, pk: 0.4, conc: 1.8, sweep: 0.6 },
        pect: { t: 0.74, len: 0.11, wid: 0.025, base: 0.016, down: 0.95, sw: 0.45, lean: 0.4 },
        fluke: { span: 0.27, notch: 0.035, root: 0.012 },
        groove: { tA: 0.52, tB: 0.93, ng: 12, amp: 0.04 },
        eye: { t: 0.885, k: -0.05, r: 0.005 }, mouth: { t1: 0.87, k0: -0.2, k1: 0 }, blow: { t: 0.82, dep: 0.1 },
      };
    case 'sperm':
      return {
        top: [[0.08, 0.028], [0.18, 0.046], [0.3, 0.07], [0.42, 0.088], [0.55, 0.1], [0.66, 0.108], [0.78, 0.115], [0.9, 0.118], [0.975, 0.108], [1, 0.07]],
        bot: [[0.08, 0.026], [0.18, 0.042], [0.3, 0.066], [0.42, 0.08], [0.55, 0.086], [0.66, 0.08], [0.78, 0.062], [0.88, 0.04], [0.96, 0.022], [1, 0.012]],
        w: [[0.08, 0.013], [0.18, 0.026], [0.3, 0.05], [0.42, 0.066], [0.55, 0.076], [0.66, 0.082], [0.78, 0.086], [0.9, 0.086], [0.975, 0.074], [1, 0.052]],
        box: 2.4, t0: 0.08, cap0: 0.035, cap1: 0.03,
        dorsal: { a: 0.3, b: 0.4, h: 0.028, pk: 0.35, conc: 2.0, sweep: 0.2 },
        pect: { t: 0.68, len: 0.07, wid: 0.05, base: 0.035, down: 1.1, sw: 0.1, lean: 0.1, yk: -0.5 },
        fluke: { span: 0.25, notch: 0.02, root: 0.014 },
        eye: { t: 0.84, k: -0.5, r: 0.0055 }, mouth: { t1: 0.8, k0: -1, k1: -0.5 }, blow: { t: 0.95, dep: 0.1 },
      };
    case 'dugong':
      return {
        top: [[0.08, 0.026], [0.18, 0.05], [0.32, 0.09], [0.48, 0.112], [0.62, 0.116], [0.76, 0.108], [0.86, 0.092], [0.94, 0.07], [0.985, 0.04], [1, 0.02]],
        bot: [[0.08, 0.024], [0.18, 0.046], [0.32, 0.082], [0.48, 0.102], [0.62, 0.105], [0.76, 0.1], [0.86, 0.094], [0.94, 0.085], [0.985, 0.07], [1, 0.05]],
        w: [[0.08, 0.014], [0.18, 0.034], [0.32, 0.068], [0.48, 0.092], [0.62, 0.098], [0.76, 0.092], [0.86, 0.08], [0.94, 0.068], [0.985, 0.056], [1, 0.048]],
        cy: [[0.08, 0], [0.62, 0], [0.8, -0.012], [0.92, -0.04], [1, -0.075]], t0: 0.08, cap0: 0.035, cap1: 0.02,
        pect: { t: 0.78, len: 0.1, wid: 0.035, base: 0.025, down: 0.8, sw: 0.5, lean: 0.3 },
        fluke: { span: 0.27, notch: 0.065, root: 0.014 },
        eye: { t: 0.9, k: 0.2, r: 0.0055 }, mouth: { t1: 0.94, k0: -0.7, k1: -0.5 }, blow: { t: 0.965, dep: 0.1 },
      };
  }
}

export function buildCetacean(spec: CetSpec, shape: FishShape, detail: 0 | 1 = 0, fixed?: FishLayout): { geo: THREE.BufferGeometry; layout: FishLayout } {
  const pre = cetPreset(spec);
  const P: Prof = {
    top: pchip(pre.top), bot: pchip(pre.bot), w: pchip(pre.w), cy: pre.cy ? pchip(pre.cy) : () => 0,
    t0: pre.t0, t1: 1, cap0: pre.cap0, cap1: pre.cap1, box: pre.box ?? 2,
  };
  const ng = pre.groove;
  const vent = ng && !detail ? { half: 1.0, nv: 32 } : undefined;
  const ang = detail ? angles(10) : angles(vent ? 52 : 24, vent);
  const S = detail ? 14 : vent ? 36 : 38;
  const bt = pre.blow.t;
  const rm = (t: number, a: number) => {
    let r = 1;
    if (ng && vent && Math.abs(a - Math.PI) < vent.half) {
      const phi = (a - (Math.PI - vent.half)) / (2 * vent.half);
      const env = sstep(ng.tA, ng.tA + 0.07, t) * (1 - sstep(ng.tB - 0.07, ng.tB, t)) * Math.pow(Math.sin(Math.PI * phi), 0.6);
      r += ng.amp * env * (0.5 + 0.5 * Math.cos(2 * Math.PI * ng.ng * phi));
    }
    // 噴気孔のくぼみ（背の中央、頭の後ろ）
    const an = Math.min(a, Math.PI * 2 - a);
    if (!detail && an < 0.5) r -= pre.blow.dep * Math.exp(-(((t - bt) / 0.016) ** 2)) * Math.exp(-((an / 0.22) ** 2));
    return r;
  };
  const parts: Part[] = [];
  const noUV: Part[] = []; // 色見本に向ける部分
  const body = tube(P, { S, ang, rm });
  parts.push(body);

  // ---- 尾びれ（水平）：付け根から後ろへ広がる扇。尾びれの端が z = −0.5
  const fl = pre.fluke;
  const zr = P.t0 + P.cap0 - 0.5, tipZ = -0.5 + 0.004;
  const nZ = -0.5 + fl.notch;
  const L: [number, number] = [-fl.span / 2, tipZ];
  const N: [number, number] = [0, nZ];
  const left = [L, ...bez(L, [-fl.span * 0.22, tipZ + (nZ - tipZ) * 0.1], N, 5)];
  const edge = [...left, ...left.slice(0, -1).reverse().map(([a, b]) => [-a, b] as [number, number])];
  {
    const cols = detail ? 4 : 10;
    const e = resample(edge, cols);
    const root = e.map((_, k) => [-fl.root + (2 * fl.root * k) / cols, zr] as [number, number]);
    const y0 = P.cy(P.t0 + P.cap0);
    const g = finGrid({ root, edge: e, rows: detail ? 1 : 3, map: (a, b) => [a, y0, b], half: detail ? undefined : () => 0.011, axis: 'y' });
    g.userData.patch = 'fluke';
    noUV.push(g);
    parts.push(g);
  }

  // ---- 背びれ（種ごとに形を変える）
  const dz = pre.dorsal;
  if (dz) {
    const n = detail ? 3 : 8;
    const rootP: Pts = [], edgeP: Pts = [];
    for (let k = 0; k <= n; k++) {
      const u = k / n;
      const t = dz.a + (dz.b - dz.a) * u;
      const y0 = P.cy(t) + P.top(t) * capK(P, t) * 0.96;
      const h = dz.h * (u <= dz.pk ? Math.pow(u / dz.pk, 0.9) : Math.pow((1 - u) / (1 - dz.pk), dz.conc));
      rootP.push([t - 0.5, y0]);
      edgeP.push([t - 0.5 - dz.sweep * h, y0 + h]);
    }
    parts.push(finGrid({ root: rootP, edge: edgeP, rows: detail ? 1 : 3, map: (p, q) => [0, q, p], half: detail ? undefined : (u) => P.w(dz.a + (dz.b - dz.a) * u) * 0.1 }));
  }

  // ---- 胸びれ（前肢）：付け根が細いパドル形
  {
    const p = pre.pect;
    const y = P.cy(p.t) + (p.yk ?? -0.35) * P.bot(p.t);
    for (const side of [-1, 1]) {
      const origin: V3 = [side * surfX(P, p.t, y) * 0.95, y, p.t - 0.5];
      const d: V3 = [side * Math.cos(p.down), -Math.sin(p.down), -Math.sin(p.down) * 0 - p.sw * 0.6];
      const g = limb(origin, d, paddle(p.len, p.wid, p.base, p.lean, detail ? 2 : 4), detail ? 3 : 6, detail ? 1 : 2, side);
      g.userData.patch = 'limb';
      noUV.push(g);
      parts.push(g);
    }
  }

  // ---- ザトウクジラのこぶ（頭の上と下あご）
  if (pre.tub && !detail) {
    for (let k = 0; k < pre.tub; k++) {
      const u = k % 2 === 0 ? (k / pre.tub) : 0.5 + (k / pre.tub) * 0.4;
      const t = 0.9 + 0.09 * (k / pre.tub);
      const onTop = k % 3 !== 2;
      const sx = ((k * 7) % 5 - 2) * 0.012 * (u > 0.5 ? 0.6 : 1);
      const k0 = capK(P, t);
      const yy = P.cy(t) + (onTop ? P.top(t) * k0 * 0.97 : -P.bot(t) * k0 * 0.97);
      const b = new THREE.SphereGeometry(0.0065, 5, 3);
      b.scale(1, 0.8, 1);
      b.translate(onTop ? sx : sx * 0.7, yy, t - 0.5);
      parts.push(b);
    }
  }

  // ---- 目
  const eyeY = P.cy(pre.eye.t) + (pre.eye.k >= 0 ? pre.eye.k * P.top(pre.eye.t) : pre.eye.k * P.bot(pre.eye.t));
  const eyes: Part[] = [];
  if (!detail) for (const side of [-1, 1]) { const e = eyeCap(P, pre.eye.t, eyeY, pre.eye.r, side, detail); eyes.push(e); parts.push(e); }

  return assemble(parts, noUV, eyes, P, shape, fixed, {
    kind: spec.kind,
    eye: { t: pre.eye.t, y: eyeY, r: pre.eye.r },
    mouth: { t1: pre.mouth.t1, y: (t: number) => P.cy(t) + (() => { const k = pre.mouth.k0 + (pre.mouth.k1 - pre.mouth.k0) * clamp01((1 - t) / Math.max(1e-3, 1 - pre.mouth.t1)); return k >= 0 ? k * P.top(t) : k * P.bot(t); })() },
    blow: { t: bt, y: P.cy(bt) + P.top(bt) },
    groove: ng ? [ng.tA, ng.tB] : undefined,
  });
}

// --------------------------------------------------------------------------- pinnipeds

type PinPre = {
  top: Pts; bot: Pts; w: Pts; cy?: Pts; t0: number; cap0: number; cap1: number;
  fore: { t: number; len: number; wid: number; base: number; down: number; sw: number; lean: number; claws: number };
  hind: { t: number; len: number; wid: number; toes: number; phi: number; yk: number };
  eye: { t: number; k: number; r: number };
  mouth: { t1: number; k0: number; k1: number };
  ear: boolean;
  whisk: number;
  supine?: boolean;
};

function pinPreset(kind: PinKind): PinPre {
  switch (kind) {
    case 'seal':
      return {
        top: [[0.14, 0.02], [0.24, 0.062], [0.38, 0.095], [0.5, 0.108], [0.62, 0.108], [0.72, 0.098], [0.8, 0.082], [0.86, 0.074], [0.91, 0.074], [0.955, 0.062], [0.985, 0.04], [1, 0.024]],
        bot: [[0.14, 0.018], [0.24, 0.056], [0.38, 0.09], [0.5, 0.1], [0.62, 0.1], [0.72, 0.09], [0.8, 0.074], [0.86, 0.066], [0.91, 0.064], [0.955, 0.048], [0.985, 0.03], [1, 0.018]],
        w: [[0.14, 0.026], [0.24, 0.064], [0.38, 0.092], [0.5, 0.104], [0.62, 0.104], [0.72, 0.092], [0.8, 0.074], [0.86, 0.07], [0.91, 0.07], [0.955, 0.056], [0.985, 0.04], [1, 0.028]],
        cy: [[0.14, 0], [0.8, 0], [0.95, 0.004], [1, -0.006]], t0: 0.14, cap0: 0.04, cap1: 0.02,
        fore: { t: 0.76, len: 0.075, wid: 0.04, base: 0.025, down: 0.55, sw: 0.9, lean: 0.4, claws: 4 },
        hind: { t: 0.15, len: 0.17, wid: 0.075, toes: 5, phi: 0.2, yk: 0 },
        eye: { t: 0.93, k: 0.2, r: 0.014 }, mouth: { t1: 0.94, k0: -0.3, k1: -0.2 }, ear: false, whisk: 6,
      };
    case 'sealion':
      return {
        top: [[0.14, 0.016], [0.24, 0.048], [0.36, 0.078], [0.5, 0.094], [0.62, 0.098], [0.7, 0.094], [0.77, 0.078], [0.82, 0.064], [0.87, 0.062], [0.92, 0.066], [0.965, 0.04], [1, 0.018]],
        bot: [[0.14, 0.014], [0.24, 0.044], [0.36, 0.074], [0.5, 0.088], [0.62, 0.09], [0.7, 0.08], [0.77, 0.064], [0.82, 0.054], [0.87, 0.05], [0.92, 0.044], [0.965, 0.03], [1, 0.014]],
        w: [[0.14, 0.022], [0.24, 0.05], [0.36, 0.072], [0.5, 0.084], [0.62, 0.088], [0.7, 0.08], [0.77, 0.062], [0.82, 0.05], [0.87, 0.048], [0.92, 0.044], [0.965, 0.03], [1, 0.02]],
        cy: [[0.14, 0], [0.7, 0], [0.9, 0.008], [1, -0.002]], t0: 0.14, cap0: 0.04, cap1: 0.018,
        fore: { t: 0.74, len: 0.22, wid: 0.055, base: 0.035, down: 0.7, sw: 0.7, lean: 0.5, claws: 0 },
        hind: { t: 0.17, len: 0.15, wid: 0.06, toes: 4, phi: 1.9, yk: 0 },
        eye: { t: 0.925, k: 0.2, r: 0.012 }, mouth: { t1: 0.9, k0: -0.3, k1: -0.2 }, ear: true, whisk: 6,
      };
    case 'furseal':
      return {
        top: [[0.14, 0.018], [0.24, 0.054], [0.36, 0.084], [0.5, 0.098], [0.62, 0.1], [0.7, 0.096], [0.77, 0.082], [0.83, 0.07], [0.88, 0.068], [0.93, 0.062], [0.97, 0.042], [1, 0.02]],
        bot: [[0.14, 0.016], [0.24, 0.05], [0.36, 0.08], [0.5, 0.092], [0.62, 0.092], [0.7, 0.084], [0.77, 0.068], [0.83, 0.058], [0.88, 0.054], [0.93, 0.048], [0.97, 0.032], [1, 0.016]],
        w: [[0.14, 0.024], [0.24, 0.056], [0.36, 0.078], [0.5, 0.09], [0.62, 0.092], [0.7, 0.084], [0.77, 0.066], [0.83, 0.056], [0.88, 0.054], [0.93, 0.048], [0.97, 0.034], [1, 0.022]],
        cy: [[0.14, 0], [0.7, 0], [0.9, 0.006], [1, -0.004]], t0: 0.14, cap0: 0.04, cap1: 0.02,
        fore: { t: 0.74, len: 0.26, wid: 0.06, base: 0.035, down: 0.75, sw: 0.6, lean: 0.5, claws: 0 },
        hind: { t: 0.17, len: 0.14, wid: 0.06, toes: 4, phi: 1.9, yk: 0 },
        eye: { t: 0.92, k: 0.2, r: 0.014 }, mouth: { t1: 0.91, k0: -0.3, k1: -0.2 }, ear: true, whisk: 6,
      };
    case 'steller':
      return {
        top: [[0.14, 0.022], [0.24, 0.06], [0.36, 0.098], [0.5, 0.118], [0.62, 0.126], [0.7, 0.122], [0.78, 0.106], [0.84, 0.094], [0.9, 0.09], [0.95, 0.07], [0.985, 0.044], [1, 0.024]],
        bot: [[0.14, 0.02], [0.24, 0.056], [0.36, 0.092], [0.5, 0.11], [0.62, 0.116], [0.7, 0.11], [0.78, 0.092], [0.84, 0.078], [0.9, 0.07], [0.95, 0.056], [0.985, 0.034], [1, 0.018]],
        w: [[0.14, 0.026], [0.24, 0.064], [0.36, 0.1], [0.5, 0.118], [0.62, 0.124], [0.7, 0.116], [0.78, 0.098], [0.84, 0.086], [0.9, 0.08], [0.95, 0.064], [0.985, 0.044], [1, 0.03]],
        cy: [[0.14, 0], [0.7, 0], [0.9, 0.006], [1, -0.004]], t0: 0.14, cap0: 0.04, cap1: 0.02,
        fore: { t: 0.74, len: 0.2, wid: 0.06, base: 0.04, down: 0.7, sw: 0.7, lean: 0.5, claws: 0 },
        hind: { t: 0.17, len: 0.15, wid: 0.065, toes: 4, phi: 1.9, yk: 0 },
        eye: { t: 0.93, k: 0.2, r: 0.011 }, mouth: { t1: 0.9, k0: -0.3, k1: -0.2 }, ear: true, whisk: 7,
      };
    case 'otter':
      return {
        top: [[0.1, 0.018], [0.18, 0.03], [0.26, 0.05], [0.34, 0.068], [0.46, 0.082], [0.6, 0.084], [0.72, 0.078], [0.8, 0.072], [0.86, 0.074], [0.92, 0.074], [0.97, 0.06], [1, 0.034]],
        bot: [[0.1, 0.016], [0.18, 0.026], [0.26, 0.044], [0.34, 0.062], [0.46, 0.078], [0.6, 0.08], [0.72, 0.074], [0.8, 0.066], [0.86, 0.066], [0.92, 0.064], [0.97, 0.05], [1, 0.028]],
        w: [[0.1, 0.034], [0.18, 0.04], [0.26, 0.056], [0.34, 0.07], [0.46, 0.084], [0.6, 0.088], [0.72, 0.08], [0.8, 0.07], [0.86, 0.07], [0.92, 0.07], [0.97, 0.056], [1, 0.036]],
        t0: 0.1, cap0: 0.03, cap1: 0.02,
        fore: { t: 0.78, len: 0.07, wid: 0.035, base: 0.025, down: 0.5, sw: -1, lean: 0.3, claws: 0 },
        hind: { t: 0.3, len: 0.14, wid: 0.07, toes: 4, phi: 0.5, yk: 0 },
        eye: { t: 0.925, k: 0.2, r: 0.0095 }, mouth: { t1: 0.94, k0: -0.3, k1: -0.2 }, ear: false, whisk: 5, supine: true,
      };
  }
}

export function buildPinniped(spec: PinSpec, shape: FishShape, detail: 0 | 1 = 0, fixed?: FishLayout): { geo: THREE.BufferGeometry; layout: FishLayout } {
  const pre = pinPreset(spec.kind);
  const P: Prof = {
    top: pchip(pre.top), bot: pchip(pre.bot), w: pchip(pre.w), cy: pre.cy ? pchip(pre.cy) : () => 0,
    t0: pre.t0, t1: 1, cap0: pre.cap0, cap1: pre.cap1, box: 2,
  };
  const parts: Part[] = [];
  const noUV: Part[] = [];
  parts.push(tube(P, { S: detail ? 14 : 34, ang: detail ? angles(10) : angles(22) }));
  const surfPt = (t: number, k: number): V3 => { const y = P.cy(t) + (k >= 0 ? k * P.top(t) : k * P.bot(t)); return [surfX(P, t, y), y, t - 0.5]; };

  // ---- 後肢：左右に開く 2 枚のひれ（アザラシは後ろへそろえ、アシカ類は前へ折れて横に出る）
  {
    const h = pre.hind;
    const outline = fan(h.len, h.wid, h.toes);
    for (const side of [-1, 1]) {
      const [, y] = surfPt(h.t, h.yk);
      const origin: V3 = [side * 0.016, y, h.t - 0.5];
      const d: V3 = [side * Math.sin(h.phi), 0, -Math.cos(h.phi)];
      const g = limb(origin, d, outline, detail ? 4 : 8, detail ? 1 : 2, 0);
      g.userData.patch = 'limb';
      noUV.push(g);
      parts.push(g);
    }
  }

  // ---- 前肢
  {
    const f = pre.fore;
    const k = -0.4;
    for (const side of [-1, 1]) {
      const [sx, y, z] = surfPt(f.t, k);
      const origin: V3 = [side * sx * 0.95, y, z];
      // ラッコ（sw < 0）：胸の前で前足を合わせる（短く、前向きで内側）
      const d: V3 = f.sw < 0 ? [-side * 0.2, -0.6, 0.75] : [side * Math.cos(f.down), -Math.sin(f.down), -f.sw];
      const g = limb(origin, d, paddle(f.len, f.wid, f.base, f.lean, detail ? 2 : 4), detail ? 3 : 6, detail ? 1 : 2, side);
      g.userData.patch = 'limb';
      noUV.push(g);
      parts.push(g);
      if (f.claws && !detail) {
        // アザラシの前肢の爪：先の縁に小さな円すい
        const { d: dd, e } = frame(d);
        for (let c = 0; c < f.claws; c++) {
          const b = -f.wid * (0.15 + c * 0.2);
          const a = f.len * 0.98;
          const claw = new THREE.ConeGeometry(0.004, 0.018, 4);
          claw.rotateX(Math.PI / 2); // +z 向き → dd へ
          const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(...dd));
          claw.applyQuaternion(q);
          claw.translate(origin[0] + dd[0] * a + e[0] * b, origin[1] + dd[1] * a + e[1] * b, origin[2] + dd[2] * a + e[2] * b);
          claw.userData.patch = 'limb';
          noUV.push(claw);
          parts.push(claw);
        }
      }
      if (f.sw < 0 && !detail) {
        const paw = new THREE.SphereGeometry(0.014, 6, 4);
        const { d: dd } = frame(d);
        paw.translate(origin[0] + dd[0] * f.len, origin[1] + dd[1] * f.len, origin[2] + dd[2] * f.len);
        paw.userData.patch = 'limb';
        noUV.push(paw);
        parts.push(paw);
      }
    }
  }

  // ---- 耳（アシカ・オットセイ・トドの小さな耳介）とひげ
  if (!detail) {
    if (pre.ear) {
      const t = pre.eye.t - 0.045;
      for (const side of [-1, 1]) {
        const [sx, y, z] = surfPt(t, 0.55);
        const c = new THREE.ConeGeometry(0.008, 0.028, 5);
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...norm3([side * 0.6, 0.6, -0.6])));
        c.applyQuaternion(q);
        c.translate(side * sx * 0.97, y, z);
        c.userData.patch = 'limb';
        noUV.push(c);
        parts.push(c);
      }
    }
    for (const side of [-1, 1]) {
      for (let k = 0; k < pre.whisk; k++) {
        const row = k % 2, col = Math.floor(k / 2);
        const [sx, y, z] = surfPt(0.975 - col * 0.012, -0.05 - row * 0.2);
        const w = strip([side * sx * 0.9, y, z], [side * (0.5 + col * 0.25), -0.25 - row * 0.2 - col * 0.1, 0.55], 0.04 + col * 0.006, 0.0035);
        w.userData.patch = 'pale';
        noUV.push(w);
        parts.push(w);
      }
    }
  }

  // ---- 目
  const eyeY = P.cy(pre.eye.t) + (pre.eye.k >= 0 ? pre.eye.k * P.top(pre.eye.t) : pre.eye.k * P.bot(pre.eye.t));
  const eyes: Part[] = [];
  if (!detail) for (const side of [-1, 1]) { const e = eyeCap(P, pre.eye.t, eyeY, pre.eye.r, side, detail); eyes.push(e); parts.push(e); }

  return assemble(parts, noUV, eyes, P, shape, fixed, {
    kind: spec.kind,
    eye: { t: pre.eye.t, y: eyeY, r: pre.eye.r },
    mouth: { t1: pre.mouth.t1, y: (t: number) => P.cy(t) + (() => { const k = pre.mouth.k0 + (pre.mouth.k1 - pre.mouth.k0) * clamp01((1 - t) / Math.max(1e-3, 1 - pre.mouth.t1)); return k >= 0 ? k * P.top(t) : k * P.bot(t); })() },
    nose: { t: 1, y: P.cy(0.99) + P.top(0.99) * 0.1 },
    supine: pre.supine,
  });
}

// --------------------------------------------------------------------------- common

/** UV（横から見た投影・色見本）と属性をそろえて 1 つにまとめ、塗装用のレイアウトを返す */
function assemble(parts: Part[], limbs: Part[], eyes: Part[], P: Prof, shape: FishShape, fixed: FishLayout | undefined, info: Omit<MamLayout, 'patch' | 'body'>): { geo: THREE.BufferGeometry; layout: FishLayout } {
  const patch = { limb: patchUV(0), fluke: patchUV(1), pale: patchUV(2) };
  const isPatch = new Set(limbs);
  // 画像の範囲：色見本に向ける部分（肢・ひげ・耳・爪）は含めない
  let yMax = 0, zMin = 0.5, zMax = -0.5;
  for (const g of parts) {
    if (isPatch.has(g) && g.userData.patch !== 'fluke') continue;
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) { yMax = Math.max(yMax, Math.abs(p.getY(i))); zMin = Math.min(zMin, p.getZ(i)); zMax = Math.max(zMax, p.getZ(i)); }
  }
  yMax *= 1.02;
  zMax += 0.005;
  if (fixed) { yMax = fixed.yMax; zMin = fixed.zMin; zMax = fixed.zMax; }
  const uvFn = (_x: number, y: number, z: number): [number, number] => [(z - zMin) / (zMax - zMin), (y + yMax) / (2 * yMax)];
  const eyeInfo = info.eye;
  for (const g of parts) {
    if (isPatch.has(g)) {
      const k = g.userData.patch as 'limb' | 'fluke' | 'pale';
      setUV(g, () => patch[k]);
    } else if (eyes.includes(g)) {
      // 目の球：描いた目の位置を中心に 1.25 倍に広げて、見える面に瞳と虹彩が収まるようにする
      const ez = eyeInfo.t - 0.5;
      setUV(g, (_x, y, z) => uvFn(0, eyeInfo.y + (y - eyeInfo.y) * 1.25, ez + (z - ez) * 1.25));
    } else setUV(g, uvFn);
  }
  finishParts(parts);
  const geo = finalize(parts);
  // ラッコ：仰向け。画像は立った姿勢のまま（UV は回す前の位置から決めてある）
  if (info.supine) { geo.rotateZ(Math.PI); geo.rotateX(-0.22); geo.computeBoundingSphere(); }

  // 画像用の体の輪郭（Paint.body）：上は env × top、下は env（belly = 0）
  const n = 64;
  let hMax = 0;
  for (let i = 0; i <= n; i++) { const t = i / n; if (t < P.t0) continue; const k = capK(P, t); hMax = Math.max(hMax, P.top(t) * k, P.bot(t) * k); }
  const Hs = 2 * hMax;
  const botAt = (t: number) => (t < P.t0 || t > P.t1 ? 0 : P.bot(t) * capK(P, t));
  const topAt = (t: number) => (t < P.t0 || t > P.t1 ? 0 : P.top(t) * capK(P, t));
  const env = (t: number) => Math.max(1e-4, botAt(t)) / (Hs / 2);
  const top = (t: number) => (topAt(t) + 1e-4) / (botAt(t) + 1e-4);
  const layout: FishLayout = {
    zMin, zMax, yMax, env, top, mid: P.cy, v2: false,
    shape: { ...shape, H: Hs, belly: 0 },
    mam: { ...info, patch, body: { top: topAt, bot: botAt, cy: P.cy, t0: P.t0 } },
  };
  return { geo, layout };
}
