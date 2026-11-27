import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../utils/noise';
import type { SwimMode } from './swim';

/**
 * Procedural creature geometry. Every builder returns one merged, non-indexed geometry with:
 *  position, normal, uv, aBend (lateral/vertical body-wave weight), aFlap (vertical flap weight),
 *  aPulse (radial pulse weight, jellies), aGlow (bioluminescence mask), aFin (0 body / 1..1.49 fin membrane / 2 eye),
 *  aAO (baked ambient occlusion 0.55..1, 1 where a builder does not compute it).
 * Creatures face +Z, length ~1 (instance scale sets real size).
 */

const ATTRS = ['aBend', 'aFlap', 'aPulse', 'aGlow', 'aFin', 'aAO'] as const;
/** value of an attribute a part does not set: aAO (baked occlusion, PHASE8-DESIGN §5.2) is 1 = unshaded */
const ATTR_DEFAULT: Record<string, number> = { aAO: 1 };
type Part = THREE.BufferGeometry;

export function setAttr(g: Part, name: string, fn: (x: number, y: number, z: number) => number) {
  const p = g.attributes.position as THREE.BufferAttribute;
  const a = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) a[i] = fn(p.getX(i), p.getY(i), p.getZ(i));
  g.setAttribute(name, new THREE.BufferAttribute(a, 1));
  return g;
}

function finalize(parts: Part[], uvFn?: (x: number, y: number, z: number) => [number, number]): THREE.BufferGeometry {
  const list = parts.map((g0) => {
    let g = g0.index ? g0.toNonIndexed() : g0;
    if (!g.attributes.normal) g.computeVertexNormals();
    const p = g.attributes.position as THREE.BufferAttribute;
    if (uvFn || !g.attributes.uv) {
      const uv = new Float32Array(p.count * 2);
      for (let i = 0; i < p.count; i++) {
        const [u, v] = uvFn ? uvFn(p.getX(i), p.getY(i), p.getZ(i)) : [0.5, 0.5];
        uv[i * 2] = u;
        uv[i * 2 + 1] = v;
      }
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    }
    for (const a of ATTRS) if (!g.attributes[a]) { const v = ATTR_DEFAULT[a] ?? 0; setAttr(g, a, () => v); }
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', ...ATTRS].includes(k)) g.deleteAttribute(k);
    return g;
  });
  const out = mergeGeometries(list)!;
  out.computeBoundingSphere();
  return out;
}

/** Flat polygon in a plane. pts in (a,b); map(a,b) -> xyz. Triangulated as fan via ShapeGeometry. */
function flatPoly(pts: [number, number][], map: (a: number, b: number) => [number, number, number]): Part {
  const shape = new THREE.Shape(pts.map(([a, b]) => new THREE.Vector2(a, b)));
  const g = new THREE.ShapeGeometry(shape, 4);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const [x, y, z] = map(p.getX(i), p.getY(i));
    p.setXYZ(i, x, y, z);
  }
  g.deleteAttribute('normal');
  g.computeVertexNormals();
  return g;
}

// --------------------------------------------------------------------------- fish

export type TailType = 'fork' | 'round' | 'lunate' | 'hetero' | 'flukes' | 'none' | 'truncate';
export type FishShape = {
  H: number;
  W: number;
  peak?: number;
  nose?: number;
  ped?: number;
  belly?: number;
  tail: TailType;
  tailH?: number;
  tailL?: number;
  dorsal?: { a: number; b: number; h: number; jag?: number; sweep?: number }[];
  anal?: { a: number; b: number; h: number }[];
  pect?: { t: number; len: number; wid: number; down: number; out?: number };
  pelvic?: boolean;
  filament?: number;
  ceph?: number;
  lure?: boolean;
  eyes?: number; // eye radius relative to H
  eyeT?: number;
  bendY?: boolean;
  /** lateral width multiplier at the head (broad-headed sharks, whale shark) */
  headW?: number;
  /** raises the dorsal profile over the forehead / nape (wrasses, jacks, parrotfish) */
  hump?: number;
  rings?: number;
  segs?: number;
  /** 泳ぎ方の型（PHASE8-DESIGN §4.2）。省略時は swimModeOf() が kind・体型・名前から決める */
  swimMode?: SwimMode;
  // ---- 生成モデル v2（PHASE8-DESIGN §3）。すべて省略可、省略時は体型ごとの既定値（species2.ts の B）か下の既定
  /** 最大幅の位置（t：0 尾 … 1 吻端）。既定 0.65 */
  wPeak?: number;
  /** 尾柄の幅（最大幅に対する比）。既定 min(0.3, ped) */
  pedW?: number;
  /** 断面のかど（スーパー楕円の指数）。2＝楕円、2.4〜2.8＝体側が平ら（側扁）。既定 2 */
  xs?: number;
  /** 断面の上半分・下半分の指数（既定 xsTop = max(1.8, xs − 0.3)：背は少し稜、xsBot = xs：腹は丸い） */
  xsTop?: number;
  xsBot?: number;
  /** 尾柄の横の隆起（マグロ・アジ、0〜0.3） */
  keel?: number;
  /** 口の位置：端位・上向き・下向き（既定 'term'） */
  mouth?: 'term' | 'sup' | 'inf';
  /** 鱗の列数（体長 1 あたり）。0 で鱗の凹凸なし。既定 48 */
  scaleN?: number;
};

/** One fin's grid in the texture's side view (z, y), for painting its margin and soft rays (§3.4). */
export type FinTrace = { root: [number, number][]; edge: [number, number][] };
export type FishLayout = {
  zMin: number; zMax: number; yMax: number; env: (t: number) => number; top: (t: number) => number; shape: FishShape;
  /** vertical offset of the body centre line (the mouth shifts the snout up or down, §3.3) */
  mid?: (t: number) => number;
  /** generated model v2 (§3): the painter adds the gill line, soft edges, lateral line, fin margins and rays */
  v2?: boolean;
  /** fins in the side view (v2) */
  fins?: FinTrace[];
  /** gill cover edge (t) and mouth line height at the snout (model y) */
  gillT?: number;
  mouthY?: number;
};

/** Dorsal-profile multiplier for FishShape.hump (1 = symmetric). */
export function fishTop(s: FishShape): (t: number) => number {
  const h = s.hump ?? 0;
  if (!h) return () => 1;
  return (t: number) => 1 + h * Math.pow(Math.sin(Math.PI * Math.min(1, Math.max(0, (t - 0.38) / 0.58))), 1.4);
}

export function fishEnvelope(s: FishShape) {
  const peak = s.peak ?? 0.62;
  const nose = s.nose ?? 0.4;
  const ped = s.ped ?? 0.1;
  return (t: number) => {
    if (t <= peak) {
      const u = t / peak;
      return ped + (1 - ped) * Math.pow(Math.sin((u * Math.PI) / 2), 1.25);
    }
    const u = (t - peak) / (1 - peak);
    return Math.pow(Math.max(0, 1 - Math.pow(u, 2 + nose * 4)), 0.5 + 0.35 * (1 - nose));
  };
}

/** §3.1: lateral (width) envelope, its own peak and a peduncle that narrows quickly to pedW. */
export function fishWidthEnvelope(s: FishShape) {
  const wPeak = s.wPeak ?? 0.65;
  const nose = s.nose ?? 0.4;
  const pedW = s.pedW ?? Math.min(0.3, s.ped ?? 0.1);
  return (t: number) => {
    if (t <= wPeak) {
      const u = t / wPeak;
      return pedW + (1 - pedW) * (1 - Math.pow(1 - u, 1.8));
    }
    const u = (t - wPeak) / (1 - wPeak);
    return Math.pow(Math.max(0, 1 - Math.pow(u, 2 + nose * 4)), 0.5 + 0.35 * (1 - nose));
  };
}

/** Mouth offset of the body centre line (§3.3): only the last 10 % of the length (the snout) moves. */
export function fishMid(s: FishShape): (t: number) => number {
  const k = s.mouth === 'sup' ? 0.22 : s.mouth === 'inf' ? -0.22 : 0;
  if (!k) return () => 0;
  return (t: number) => {
    const q = Math.max(0, (t - 0.9) / 0.1);
    return k * (s.H / 2) * q * q;
  };
}

const spow = (v: number, e: number) => Math.sign(v) * Math.pow(Math.abs(v), e);

/** Polyline resampled by arc length to n + 1 points. */
function resample(pts: [number, number][], n: number): [number, number][] {
  const L = [0];
  for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const tot = L[L.length - 1] || 1;
  const out: [number, number][] = [];
  let j = 1;
  for (let k = 0; k <= n; k++) {
    const d = (k / n) * tot;
    while (j < pts.length - 1 && L[j] < d) j++;
    const f = Math.min(1, Math.max(0, (d - L[j - 1]) / ((L[j] - L[j - 1]) || 1)));
    out.push([pts[j - 1][0] + (pts[j][0] - pts[j - 1][0]) * f, pts[j - 1][1] + (pts[j][1] - pts[j - 1][1]) * f]);
  }
  return out;
}

/** Quadratic Bézier from p0 to p2 through control c, as n segments (p0 excluded). */
function bez(p0: [number, number], c: [number, number], p2: [number, number], n = 6): [number, number][] {
  const out: [number, number][] = [];
  for (let k = 1; k <= n; k++) {
    const t = k / n, a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, d = t * t;
    out.push([a * p0[0] + b * c[0] + d * p2[0], a * p0[1] + b * c[1] + d * p2[1]]);
  }
  return out;
}

type FinSpec = {
  root: [number, number][]; // cols + 1 points on the attached line, in the fin plane (a, b)
  edge: [number, number][]; // cols + 1 points on the outer edge
  rows: number;
  map: (a: number, b: number) => [number, number, number];
  /** half thickness at the root for each column (0: one sheet, drawn double-sided) */
  half?: (u: number) => number;
  axis?: 'x' | 'y';
  /** pectoral rowing: aFlap = flap × (0 at the root .. 1 at the edge); its sign marks the side */
  flap?: number;
};

/**
 * §3.2: a fin as a grid between the attached root line and the outer edge (rows from root to edge, one column per
 * edge point), so it bends smoothly with the swim wave and turns paler towards the margin. With a root thickness the
 * fin is two sheets pushed apart (thick at the root, paper-thin at the margin), as the old flat fins were.
 */
function finGrid(f: FinSpec): Part {
  const cols = f.root.length - 1, rows = f.rows;
  const sheets = f.half ? 2 : 1;
  const nv = (rows + 1) * (cols + 1);
  const pos = new Float32Array(nv * sheets * 3);
  const fin = new Float32Array(nv * sheets);
  const flap = new Float32Array(nv * sheets);
  const ao = new Float32Array(nv * sheets);
  const idx: number[] = [];
  for (let sh = 0; sh < sheets; sh++) {
    const sg = sh === 0 ? 1 : -1;
    for (let i = 0; i <= cols; i++) {
      const u = i / cols;
      const hr = f.half ? f.half(u) : 0;
      for (let r = 0; r <= rows; r++) {
        const v = r / rows;
        const a = f.root[i][0] + (f.edge[i][0] - f.root[i][0]) * v;
        const b = f.root[i][1] + (f.edge[i][1] - f.root[i][1]) * v;
        const [x, y, z] = f.map(a, b);
        const t = hr * Math.pow(1 - v, 1.6) * sg;
        const k = sh * nv + i * (rows + 1) + r;
        pos[k * 3] = f.axis === 'y' ? x : x + t;
        pos[k * 3 + 1] = f.axis === 'y' ? y + t : y;
        pos[k * 3 + 2] = z;
        fin[k] = 1 + 0.49 * v;
        flap[k] = (f.flap ?? 0) * v;
        ao[k] = 0.7 + 0.3 * v;
      }
    }
    for (let i = 0; i < cols; i++)
      for (let r = 0; r < rows; r++) {
        const a = sh * nv + i * (rows + 1) + r, b = a + rows + 1;
        if (sh === 0) idx.push(a, b, a + 1, a + 1, b, b + 1);
        else idx.push(a, a + 1, b, a + 1, b + 1, b);
      }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aFin', new THREE.BufferAttribute(fin, 1));
  g.setAttribute('aFlap', new THREE.BufferAttribute(flap, 1));
  g.setAttribute('aAO', new THREE.BufferAttribute(ao, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Level of detail for buildFish: 0 = L0 (near), 1 = L1 (middle distance, PHASE8-DESIGN §1.1). */
export type FishDetail = 0 | 1;
/** Fin grid density; buildGeometry lowers it (then the body rings) when a species is over its triangle budget. */
export type FishBuildOpts = { detail?: FishDetail; v2?: boolean; finK?: number };

/**
 * Procedural fish. v2 (PHASE8-DESIGN §3): super-ellipse cross-section with its own width envelope (narrow peduncle,
 * keel), mouth position, fins as grids with curved outlines, eyes as embedded caps, baked occlusion (aAO).
 * Without `v2` (sea mammals, penguins: kept as they were) the cross-section and fin outlines are the old ones.
 * The side silhouette (height envelope) is the same in both, so the painted side-projection textures still fit.
 */
export function buildFish(s: FishShape, o: FishBuildOpts = {}): { geo: THREE.BufferGeometry; layout: FishLayout } {
  const detail = o.detail ?? 0;
  const v2 = !!o.v2;
  const finK = o.finK ?? 1;
  const env = fishEnvelope(s);
  const topK = fishTop(s);
  const wEnv = v2 ? fishWidthEnvelope(s) : env;
  const mid = v2 ? fishMid(s) : () => 0;
  const R = Math.max(3, s.rings ?? 14);
  const S = Math.max(4, s.segs ?? 22);
  const H = s.H, W = s.W;
  const belly = s.belly ?? 0.08;
  const xs = v2 ? s.xs ?? 2 : 2;
  const eT = 2 / (v2 ? s.xsTop ?? Math.max(1.8, xs - 0.3) : 2);
  const eB = 2 / (v2 ? s.xsBot ?? xs : 2);
  const keel = v2 ? s.keel ?? 0 : 0;
  const parts: Part[] = [];
  const bendW = (z: number) => Math.pow(Math.min(1, Math.max(0, (0.5 - z) / 1.0)), 1.6) * 0.95 + 0.05;
  const hwAt = (t: number) => (s.headW ? 1 + (s.headW - 1) * Math.min(1, Math.max(0, (t - 0.55) / 0.35)) ** 2 : 1);
  const topAt = (t: number) => (H / 2) * env(t) * topK(t);
  const botAt = (t: number) => (H / 2) * env(t);
  // mouth line (§3.3): a little below the centre for a terminal mouth, near the top / bottom for upturned / underslung
  const mouthK = s.mouth === 'sup' ? 0.45 : s.mouth === 'inf' ? -0.6 : -0.15;
  const mouthY = (t: number) => mid(t) + mouthK * botAt(t);

  // ---- body tube
  const pos: number[] = [];
  const aoB: number[] = [];
  const idx: number[] = [];
  const pt = s.pect?.t ?? 0.7;
  for (let i = 0; i <= S; i++) {
    const t = i / S;
    const z = t - 0.5;
    const e = env(t);
    const we = wEnv(t) * hwAt(t);
    const m = mid(t);
    for (let j = 0; j <= R; j++) {
      const a = (j / R) * Math.PI * 2;
      const cy = Math.cos(a);
      const sy = Math.sin(a);
      const ce = spow(cy, cy > 0 ? eT : eB);
      const se = spow(sy, cy > 0 ? eT : eB);
      const y = (H / 2) * e * ce * (cy > 0 ? topK(t) : 1) - (cy < 0 ? belly * H * e * -cy * 0.4 : 0) + m;
      let x = (W / 2) * we * se * (1 - (v2 ? 0.1 : 0.15) * cy);
      if (keel) x += Math.sign(sy) * keel * (W / 2) * Math.exp(-((cy / 0.3) ** 2)) * Math.max(0, 1 - t / 0.22);
      if (v2 && t > 0.92) x *= 1 - 0.3 * Math.exp(-(((y - mouthY(t)) / Math.max(0.004, 0.035 * H)) ** 2)) * Math.min(1, (t - 0.92) / 0.06);
      pos.push(x, y, z);
      // §5.2 baked occlusion: the underside, and the flank under the pectoral fin
      const under = Math.max(0, -cy);
      aoB.push(Math.max(0.55, 1 - 0.3 * Math.pow(under, 1.3) - 0.14 * Math.exp(-(((t - pt + 0.04) / 0.07) ** 2)) * Math.max(0, -cy + 0.3)));
    }
  }
  for (let i = 0; i < S; i++)
    for (let j = 0; j < R; j++) {
      const a = i * (R + 1) + j, b = a + R + 1;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  const body = new THREE.BufferGeometry();
  body.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  body.setAttribute('aAO', new THREE.Float32BufferAttribute(aoB, 1));
  body.setIndex(idx);
  body.computeVertexNormals();
  {
    // the seam along the back (j = 0 and j = R are separate vertices): share their normals so no line shows
    const n = body.attributes.normal as THREE.BufferAttribute;
    for (let i = 0; i <= S; i++) {
      const a = i * (R + 1), b = a + R;
      const nx = n.getX(a) + n.getX(b), ny = n.getY(a) + n.getY(b), nz = n.getZ(a) + n.getZ(b);
      const l = Math.hypot(nx, ny, nz) || 1;
      n.setXYZ(a, nx / l, ny / l, nz / l);
      n.setXYZ(b, nx / l, ny / l, nz / l);
    }
  }
  parts.push(body);
  {
    // close the open tube at the peduncle (seen from behind, past a thin or missing caudal fin): own vertices,
    // so the tube's normals there are not bent backwards
    const cp: number[] = [];
    const cy0 = mid(0) + ((H / 2) * env(0) * (topK(0) - 1)) / 2;
    for (let j = 0; j < R; j++) cp.push(0, cy0, -0.5, pos[(j + 1) * 3], pos[(j + 1) * 3 + 1], -0.5, pos[j * 3], pos[j * 3 + 1], -0.5);
    const cap = new THREE.BufferGeometry();
    cap.setAttribute('position', new THREE.Float32BufferAttribute(cp, 3));
    cap.setAttribute('normal', new THREE.Float32BufferAttribute(cp.map((_, k) => (k % 3 === 2 ? -1 : 0)), 3));
    setAttr(cap, 'aFin', () => 0);
    setAttr(cap, 'aAO', () => 0.8);
    parts.push(cap);
  }

  /** half width of the body surface at height y (relative to the centre line) at t */
  const surfX = (t: number, y: number) => {
    const ym = y - mid(t);
    const top = ym >= 0;
    const b = top ? topAt(t) : botAt(t) * (1 + belly * 0.4);
    const c = Math.min(1, Math.abs(ym) / Math.max(1e-4, b));
    const ex = top ? eT : eB;
    const cc = Math.pow(c, 1 / ex);
    const ss = Math.sqrt(Math.max(0, 1 - cc * cc));
    return (W / 2) * wEnv(t) * hwAt(t) * Math.pow(ss, ex) * (1 - (v2 ? 0.1 : 0.15) * (top ? cc : -cc));
  };

  const fins: FinTrace[] = [];
  const rowsMain = detail ? 2 : 4;
  const colsOf = (n: number) => Math.max(detail ? 2 : 3, Math.round(n * (detail ? 0.45 : 1) * finK));

  // ---- caudal fin
  const z0 = -0.5;
  const tl = s.tailL ?? 0.22;
  const th = s.tailH ?? H * 1.1;
  const pedH = Math.max(0.02, topAt(0.02));
  const vert = (a: number, b: number): [number, number, number] => [0, b + mid(0), a];
  if (s.tail !== 'none') {
    const rz = z0 + 0.03;
    let edge: [number, number][];
    const T: [number, number] = [rz, pedH], Bm: [number, number] = [rz, -pedH];
    const mirror = (p: [number, number][]) => p.map(([a, b]) => [a, -b] as [number, number]).reverse();
    if (!v2 || s.tail === 'flukes') {
      // old polygon outlines (kept as they were for the animals that are not on the v2 model)
      const old: Record<string, [number, number][]> = {
        fork: [[z0 - tl, th / 2], [z0 - tl * 0.78, th / 2 - 0.02], [z0 - tl * 0.42, 0], [z0 - tl * 0.78, -th / 2 + 0.02], [z0 - tl, -th / 2]],
        lunate: [[z0 - tl * 0.75, th / 2], [z0 - tl, th / 2 + 0.01], [z0 - tl * 0.35, 0], [z0 - tl, -th / 2 - 0.01], [z0 - tl * 0.75, -th / 2]],
        truncate: [[z0 - tl, th / 2], [z0 - tl * 1.05, 0], [z0 - tl, -th / 2]],
        hetero: [[z0 - tl, th * 0.62], [z0 - tl * 0.86, th * 0.52], [z0 - tl * 0.32, -0.01], [z0 - tl * 0.5, -th * 0.33], [z0 - tl * 0.38, -th * 0.33]],
        flukes: [[th / 2, z0 - tl * 0.8], [th / 2 - 0.02, z0 - tl], [0, z0 - tl * 0.55], [-th / 2 + 0.02, z0 - tl], [-th / 2, z0 - tl * 0.8]],
      };
      if (s.tail === 'round') {
        edge = [];
        for (let k = 0; k <= 8; k++) { const a = Math.PI / 2 - (k / 8) * Math.PI; edge.push([z0 - tl * (0.55 + 0.45 * Math.cos(a)), (th / 2) * Math.sin(a)]); }
      } else edge = old[s.tail];
      if (s.tail === 'flukes') edge = [[0.04, z0 + 0.04], ...edge, [-0.04, z0 + 0.04]];
      else edge = [T, ...edge, Bm];
    } else {
      // §3.2: curved outlines (bowed lobes, a thin-tipped crescent, gently rounded margins)
      const tip: [number, number] = [z0 - tl, th / 2];
      switch (s.tail) {
        case 'fork': {
          const notch: [number, number] = [z0 - tl * 0.42, 0];
          const up = [T, ...bez(T, [z0 - tl * 0.45, th * 0.5], tip), ...bez(tip, [z0 - tl * 0.62, th * 0.1], notch)];
          edge = [...up, ...mirror(up).slice(1)];
          break;
        }
        case 'lunate': {
          const tp: [number, number] = [z0 - tl, th / 2 + 0.01];
          const c: [number, number] = [z0 - tl * 0.38, 0];
          const up = [T, ...bez(T, [z0 - tl * 0.3, th * 0.5], tp), ...bez(tp, [z0 - tl * 0.5, th * 0.15], c)];
          edge = [...up, ...mirror(up).slice(1)];
          break;
        }
        case 'round': {
          edge = [T];
          for (let k = 0; k <= 16; k++) { const a = Math.PI / 2 - (k / 16) * Math.PI; edge.push([z0 - tl * (0.55 + 0.45 * Math.cos(a)), (th / 2) * Math.sin(a)]); }
          edge.push(Bm);
          break;
        }
        case 'truncate': {
          const up = [T, ...bez(T, [z0 - tl * 0.5, th * 0.5], tip), ...bez(tip, [z0 - tl * 1.06, th * 0.2], [z0 - tl * 1.04, 0], 4)];
          edge = [...up, ...mirror(up).slice(1)];
          break;
        }
        default: {
          // hetero (sharks): long upper lobe, small lower lobe
          const up: [number, number] = [z0 - tl, th * 0.62];
          const lo: [number, number] = [z0 - tl * 0.5, -th * 0.33];
          edge = [T, ...bez(T, [z0 - tl * 0.5, th * 0.5], up), ...bez(up, [z0 - tl * 0.85, th * 0.3], [z0 - tl * 0.32, -0.01]), ...bez([z0 - tl * 0.32, -0.01], [z0 - tl * 0.48, -th * 0.12], lo, 3), ...bez(lo, [z0 - tl * 0.15, -th * 0.25], Bm, 3)];
        }
      }
    }
    const cols = colsOf(s.tail === 'round' ? 11 : 8);
    const e = resample(edge, cols);
    if (s.tail === 'flukes') {
      const r0: [number, number] = [0.04, z0 + 0.04], r1: [number, number] = [-0.04, z0 + 0.04];
      const root = e.map((_, k) => [r0[0] + (r1[0] - r0[0]) * (k / cols), r0[1]] as [number, number]);
      parts.push(finGrid({ root, edge: e, rows: rowsMain, map: (a, b) => [a, mid(0), b], half: () => H * 0.05, axis: 'y' }));
    } else {
      const root = e.map((_, k) => [rz, pedH - 2 * pedH * (k / cols)] as [number, number]);
      const rootT = (W / 2) * wEnv(0.03) * 0.85;
      parts.push(finGrid({ root, edge: e, rows: rowsMain, map: vert, half: () => rootT }));
      fins.push({ root: root.map(([a, b]) => [a, b + mid(0)]), edge: e.map(([a, b]) => [a, b + mid(0)]) });
    }
  }

  // ---- dorsal / anal fins
  const strip = (a: number, b: number, h: number, top: boolean, jag = 0, sweep = 0.3) => {
    const n = jag > 0 && v2 && !detail ? Math.max(colsOf((b - a) / 0.06), Math.round(12 * finK)) : colsOf((b - a) / 0.06);
    // spines: one every two columns, so the dips between them are always resolved
    const nsp = Math.max(2, Math.floor(n / 2));
    const root: [number, number][] = [], edge: [number, number][] = [];
    for (let k = 0; k <= n; k++) {
      const u = k / n;
      const t = a + (b - a) * u;
      const y0 = (top ? topAt(t) : -botAt(t)) * 0.9;
      const prof = b - a < 0.25 ? Math.sin(u * Math.PI) : Math.sin(Math.pow(u, 0.7) * Math.PI) * 0.75 + 0.25;
      // spiny fins: the membrane dips between the spine tips (v2), the old ones alternated the height
      const jj = jag <= 0 ? 1 : v2 ? 1 - jag * 0.8 * Math.pow(Math.abs(Math.sin(Math.PI * nsp * u)), 0.7) : k % 2 === 0 ? 1 : 1 - jag;
      const hh = Math.max(0.002, h * prof * jj);
      root.push([t - 0.5, y0 + mid(t)]);
      edge.push([t - 0.5 - sweep * hh, y0 + hh * (top ? 1 : -1) + mid(t)]);
    }
    parts.push(finGrid({ root, edge, rows: detail ? 2 : 3, map: (p, q) => [0, q, p], half: (u) => (W / 2) * wEnv(a + (b - a) * u) * 0.3 }));
    fins.push({ root, edge });
  };
  for (const d of s.dorsal ?? []) strip(d.a, d.b, d.h, true, d.jag ?? 0, d.sweep ?? 0.3);
  for (const d of s.anal ?? []) strip(d.a, d.b, d.h, false);

  if (s.filament && !detail) {
    const d = (s.dorsal ?? [{ a: 0.3, b: 0.6, h: 0.3 }])[0];
    const tz = (d.a + d.b) / 2 - 0.5;
    const ty = topAt((d.a + d.b) / 2) + d.h + mid((d.a + d.b) / 2);
    parts.push(flatPoly([[tz - 0.02, ty - 0.1], [tz - s.filament * 0.9, ty + s.filament * 0.25], [tz - s.filament, ty + s.filament * 0.2], [tz + 0.03, ty - 0.1]], vert));
  }

  // ---- pectoral fins: a fan (narrow root, round tip) that rows about its root (aFlap, §3.2 / §4.2)
  if (s.pect) {
    const p = s.pect;
    const zt = p.t - 0.5;
    const yb = -topAt(p.t) * 0.25 + mid(p.t);
    const out = p.out ?? 0.6;
    const L = p.len, Wd = p.wid;
    const outline: [number, number][] = v2
      ? [[0, 0], ...bez([0, 0], [L * out * 0.7, -Wd * 0.05], [L * 0.92, -Wd * 0.4], 4), ...bez([L * 0.92, -Wd * 0.4], [L * 1.05, -Wd * 0.85], [L * 0.7, -Wd * 1.05], 4), ...bez([L * 0.7, -Wd * 1.05], [L * 0.3, -Wd * 1.0], [0.015, -Wd * 0.45], 3)]
      : [[0, 0], [L * out, -Wd * 0.4], [L, -Wd * 0.9], [L * 0.8, -Wd * 1.1], [0.02, -Wd * 0.5]];
    const cols = colsOf(5);
    const e = resample(outline, cols);
    const rEnd = outline[outline.length - 1];
    const root = e.map((_, k) => [(rEnd[0] * k) / cols, (rEnd[1] * k) / cols] as [number, number]);
    for (const side of [-1, 1]) {
      const xb = (v2 ? surfX(p.t, yb) * 0.95 : (W / 2) * env(p.t) * 0.9) * side;
      parts.push(finGrid({ root, edge: e, rows: detail ? 1 : 2, map: (a, b) => [xb + side * a * Math.cos(p.down), yb - a * Math.sin(p.down), zt + b], flap: v2 ? side : 0 }));
    }
  }
  if (s.pelvic) {
    const t = 0.55;
    const yb = -topAt(t) * 0.8 + mid(t);
    const outline: [number, number][] = v2
      ? [[0, 0], ...bez([0, 0], [0.06, -0.01], [0.08, -0.05], 3), ...bez([0.08, -0.05], [0.075, -0.1], [0.04, -0.1], 3), [0, -0.055]]
      : [[0, 0], [0.08, -0.04], [0.06, -0.1], [0, -0.06]];
    const cols = colsOf(3);
    const e = resample(outline, cols);
    const rEnd = outline[outline.length - 1];
    const root = e.map((_, k) => [(rEnd[0] * k) / cols, (rEnd[1] * k) / cols] as [number, number]);
    for (const side of [-1, 1]) {
      const x0 = v2 ? Math.min(W * 0.15, surfX(t, yb) * 0.8) : W * 0.15;
      parts.push(finGrid({ root, edge: e, rows: detail ? 1 : 2, map: (a, b) => [side * (x0 + a * 0.4), yb - a * 0.6, t - 0.5 + b] }));
    }
  }
  if (s.ceph) {
    const c = new THREE.SphereGeometry(1, detail ? 8 : 16, detail ? 3 : 6);
    c.scale(s.ceph / 2, H * 0.12, 0.06);
    c.translate(0, H * 0.05 + mid(0.93), 0.43);
    c.userData.eye = true;
    parts.push(c);
  }
  if (s.lure) {
    // the illicium: v2 roots it on the forehead and runs it to the bulb (the old stalk floated beside it)
    let stalk: Part;
    if (v2) {
      const base = new THREE.Vector3(0, topAt(0.86) * 0.95 + mid(0.86), 0.36);
      const tip = new THREE.Vector3(0, H / 2 + 0.2, 0.53);
      const len = base.distanceTo(tip);
      stalk = new THREE.CylinderGeometry(0.007, 0.012, len, 5);
      stalk.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), tip.clone().sub(base).normalize()));
      stalk.translate((base.x + tip.x) / 2, (base.y + tip.y) / 2, (base.z + tip.z) / 2);
    } else {
      stalk = new THREE.CylinderGeometry(0.008, 0.012, 0.32, 5);
      stalk.rotateX(-0.7);
      stalk.translate(0, H / 2 + 0.1, 0.42);
    }
    parts.push(stalk);
    const bulb = new THREE.SphereGeometry(0.035, detail ? 6 : 10, detail ? 4 : 8);
    bulb.translate(0, H / 2 + 0.22, 0.54);
    setAttr(bulb, 'aGlow', () => 1);
    parts.push(bulb);
  }
  // ---- eyes (§3.3): a sphere sunk 70 % into the head, only the exposed cap is built; L1 has none (painted)
  const er = (s.eyes ?? 0.09) * H;
  const et = s.eyeT ?? 0.86;
  const eyeY = topAt(et) * 0.22 + mid(et);
  const eyeParts: Part[] = [];
  if (er > 0 && detail === 0) {
    for (const side of [-1, 1]) {
      let e: Part;
      if (v2) {
        // pole along +x: thetaLength 117° keeps the part outside the plane 0.45 r behind the centre
        e = new THREE.SphereGeometry(er, 10, 5, 0, Math.PI * 2, 0, (117 * Math.PI) / 180);
        e.rotateZ(-Math.PI / 2);
        if (side < 0) e.rotateY(Math.PI);
        e.translate(side * (surfX(et, eyeY) - 0.4 * er), eyeY, et - 0.5);
      } else {
        e = new THREE.SphereGeometry(er, 8, 6);
        e.scale(0.5, 1, 1);
        e.translate((W / 2) * env(et) * 0.92 * side, topAt(et) * 0.22, et - 0.5);
      }
      e.userData.eye = true;
      parts.push(e);
      eyeParts.push(e);
    }
  }

  // layout for painting: planar (z,y) side projection
  let yMax = H / 2;
  let zMin = -0.5;
  for (const g of parts) {
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      yMax = Math.max(yMax, Math.abs(p.getY(i)));
      zMin = Math.min(zMin, p.getZ(i));
    }
  }
  yMax *= 1.02;
  const zMax = 0.5 + (s.lure ? 0.08 : 0.01);
  const uvFn = (x: number, y: number, z: number): [number, number] => [(z - zMin) / (zMax - zMin), (y + yMax) / (2 * yMax)];
  parts.forEach((g, i) => {
    if (!g.attributes.aBend) setAttr(g, 'aBend', (_x, _y, z) => bendW(z));
    // 0 = scaled body, 1 = fin (rays), 2 = eye / smooth parts
    if (!g.attributes.aFin) setAttr(g, 'aFin', () => (i === 0 ? 0 : g.userData.eye ? 2 : 1));
  });
  // the eye caps get the painted eye spread over them (side projection, enlarged so the cap shows pupil and iris)
  const eyeUV = (g: Part) => {
    const p = g.attributes.position as THREE.BufferAttribute;
    const uv = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++) {
      const [u, v] = uvFn(0, eyeY + (p.getY(i) - eyeY) * 1.25, et - 0.5 + (p.getZ(i) - (et - 0.5)) * 1.25);
      uv[i * 2] = u; uv[i * 2 + 1] = v;
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  };
  const geo = finalize(parts.map((g) => {
    if (eyeParts.includes(g) && v2) { const n = g.index ? g.toNonIndexed() : g; eyeUV(n); return n; }
    const n = g.index ? g.toNonIndexed() : g;
    const p = n.attributes.position as THREE.BufferAttribute;
    const uv = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++) { const [u, v] = uvFn(p.getX(i), p.getY(i), p.getZ(i)); uv[i * 2] = u; uv[i * 2 + 1] = v; }
    n.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    return n;
  }));
  return { geo, layout: { zMin, zMax, yMax, env, top: topK, shape: s, mid, v2, fins, gillT: et - 0.1, mouthY: mouthY(0.97) } };
}

// --------------------------------------------------------------------------- ray / flatfish

export type RayShape = { span: number; len: number; thick: number; manta?: boolean; tail?: number; flounder?: boolean };

export function buildRay(s: RayShape, detail: 0 | 1 = 0): { geo: THREE.BufferGeometry; xMax: number; zMin: number; zMax: number } {
  const parts: Part[] = [];
  // detail 1 = L1 (PHASE8-DESIGN §1.2): the same outline and uv on a coarser grid
  const NX = detail ? 8 : 18, NZ = detail ? 7 : 14;
  const halfW = s.span / 2;
  // outline half-width as function of z in [-len/2, len/2]
  const outline = (t: number) => {
    // t 0 tail -> 1 nose
    if (s.flounder) return Math.pow(Math.sin(Math.PI * Math.pow(t, 0.9)), 0.7) * halfW;
    if (s.manta) {
      const w = t < 0.55 ? Math.pow(t / 0.55, 0.8) : Math.pow(1 - (t - 0.55) / 0.45, 1.6);
      return Math.max(0.02, w) * halfW;
    }
    const w = t < 0.6 ? t / 0.6 : 1 - (t - 0.6) / 0.4;
    return Math.max(0.02, Math.pow(Math.max(0, w), 0.75)) * halfW;
  };
  for (const top of [true, false]) {
    const pos: number[] = [];
    const idx: number[] = [];
    for (let j = 0; j <= NZ; j++) {
      const t = j / NZ;
      const z = (t - 0.5) * s.len;
      const hw = outline(t);
      for (let i = 0; i <= NX; i++) {
        const u = (i / NX) * 2 - 1;
        const x = u * hw;
        const dome = Math.pow(Math.max(0, 1 - u * u), 1.2) * Math.sin(Math.PI * Math.min(1, t * 1.1)) * s.thick;
        const y = top ? dome : -dome * 0.35;
        pos.push(x, y, z);
      }
    }
    for (let j = 0; j < NZ; j++)
      for (let i = 0; i < NX; i++) {
        const a = j * (NX + 1) + i, b = a + NX + 1;
        if (top) idx.push(a, b, a + 1, a + 1, b, b + 1);
        else idx.push(a, a + 1, b, a + 1, b + 1, b);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    g.userData.top = top;
    parts.push(g);
  }
  if (s.tail) {
    const t = new THREE.ConeGeometry(0.02 * s.len, s.tail, 5);
    t.rotateX(-Math.PI / 2);
    t.translate(0, 0.01, -s.len / 2 - s.tail / 2 + 0.02);
    t.userData.top = true;
    parts.push(t);
  }
  if (s.manta) {
    for (const side of [-1, 1]) {
      const c = flatPoly([[0, 0], [0.05, 0.2], [0.02, 0.22], [-0.03, 0.02]], (a, b) => [side * (0.12 + a * 0.4) * s.span * 0.5, -0.02, s.len / 2 - 0.05 + b * s.len * 0.6]);
      c.userData.top = false;
      parts.push(c);
    }
    const tailFin = new THREE.ConeGeometry(0.012, s.len * 0.5, 4);
    tailFin.rotateX(-Math.PI / 2);
    tailFin.translate(0, 0, -s.len * 0.72);
    tailFin.userData.top = true;
    parts.push(tailFin);
  }
  if (s.flounder) {
    // tail fan
    const f = flatPoly([[0, -0.06], [-0.18, -0.12], [-0.2, 0.12], [0, 0.06]], (a, b) => [b * s.span, 0, -s.len / 2 + a * s.len * 0.5]);
    f.userData.top = true;
    parts.push(f);
    // eyes on top
    for (const sx of [-0.06, 0.02]) {
      const e = new THREE.SphereGeometry(0.03, detail ? 5 : 8, detail ? 3 : 6);
      e.translate(sx * s.span, s.thick * 0.9, s.len * 0.3);
      e.userData.top = true;
      parts.push(e);
    }
  }
  const xMax = halfW * 1.05;
  const zMin = -s.len / 2 - (s.tail ?? 0) - (s.manta ? s.len * 0.5 : 0) - (s.flounder ? s.len * 0.1 : 0);
  const zMax = s.len / 2 + (s.manta ? s.len * 0.2 : 0.01);
  parts.forEach((g) => {
    setAttr(g, 'aFlap', (x) => Math.pow(Math.min(1, Math.abs(x) / halfW), 1.5));
    setAttr(g, 'aBend', (_x, _y, z) => (z < -s.len / 2 ? Math.min(1, (-s.len / 2 - z) / (s.tail ?? 0.3)) : 0));
    // pack top/bottom into the uv mapping by tagging y slightly
    const top = g.userData.top;
    const p = g.attributes.position as THREE.BufferAttribute;
    const uv = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++) {
      const u = (p.getZ(i) - zMin) / (zMax - zMin);
      const v = (p.getX(i) / xMax) * 0.25 + 0.25 + (top ? 0.5 : 0);
      uv[i * 2] = u;
      uv[i * 2 + 1] = v;
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  });
  return { geo: finalize(parts), xMax, zMin, zMax };
}

// --------------------------------------------------------------------------- jellies

export function buildJelly(opts: { tentacles: number; tentLen: number; oral?: boolean; flat?: number; glowRim?: boolean }, detail: 0 | 1 = 0): THREE.BufferGeometry {
  const r = mulberry32(17);
  const parts: Part[] = [];
  const pts: THREE.Vector2[] = [];
  const flat = opts.flat ?? 0.55;
  for (let i = 0; i <= 8; i++) {
    const a = (i / 8) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.sin(a) * 0.5 + (i === 8 ? 0.02 : 0), Math.cos(a) * 0.5 * flat));
  }
  // inner subumbrella back up
  for (let i = 8; i >= 0; i -= 2) {
    const a = (i / 8) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.sin(a) * 0.44, Math.cos(a) * 0.4 * flat - 0.04));
  }
  const bell = new THREE.LatheGeometry(detail ? pts.filter((_, i) => i % 2 === 0 || i === 8) : pts, detail ? 10 : 18);
  setAttr(bell, 'aPulse', (x, y, z) => Math.min(1, Math.hypot(x, z) * 2) * (1 - Math.max(0, y) / (0.5 * flat) * 0.5));
  if (opts.glowRim) setAttr(bell, 'aGlow', (x, y, z) => (Math.hypot(x, z) > 0.4 && y < 0.08 ? 1 : 0));
  parts.push(bell);
  for (let i = 0; i < opts.tentacles; i++) {
    const a = (i / opts.tentacles) * Math.PI * 2;
    const len = opts.tentLen * (0.6 + r() * 0.5);
    const t = new THREE.CylinderGeometry(0.004, 0.008, len, 3, detail ? 2 : 4, true);
    t.translate(0, -len / 2, 0);
    t.translate(Math.cos(a) * 0.48, 0, Math.sin(a) * 0.48);
    setAttr(t, 'aBend', (_x, y) => Math.min(1, -y / opts.tentLen) * 1.5);
    setAttr(t, 'aPulse', () => 1);
    parts.push(t);
  }
  if (opts.oral) {
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      const o = flatPoly([[0, 0], [0.06, -0.3], [0.02, -0.6], [-0.05, -0.32]], (u, v) => [Math.cos(a) * u, v, Math.sin(a) * u]);
      setAttr(o, 'aBend', (_x, y) => Math.min(1, -y * 1.4));
      parts.push(o);
    }
  }
  // uv: top-down planar, plus vertical for tentacles
  return finalize(parts, (x, y, z) => (y < -0.06 ? [0.5 + x * 0.2, 0.05] : [x + 0.5, z + 0.5]));
}

// --------------------------------------------------------------------------- cephalopods

export function buildSquid(opts: { armLen: number; tentLen: number; finSize: number }, detail: 0 | 1 = 0): THREE.BufferGeometry {
  const parts: Part[] = [];
  // mantle points +Z (squid swims mantle-first)
  const prof: THREE.Vector2[] = [];
  const NP = detail ? 7 : 14;
  for (let i = 0; i <= NP; i++) {
    const t = i / NP;
    prof.push(new THREE.Vector2(Math.max(0.005, 0.11 * Math.pow(Math.sin(Math.PI * (0.5 + t * 0.5)), 0.6) * (t < 0.2 ? 0.8 + t : 1)), t * 0.55));
  }
  const mantle = new THREE.LatheGeometry(prof, detail ? 8 : 14);
  mantle.rotateX(Math.PI / 2);
  parts.push(mantle);
  for (const side of [-1, 1]) {
    const fin = flatPoly([[0, 0.35], [opts.finSize, 0.5], [0, 0.56]], (a, b) => [side * (0.05 + a), 0, b]);
    setAttr(fin, 'aFlap', (x) => Math.min(1, Math.abs(x) * 4));
    parts.push(fin);
  }
  const head = new THREE.SphereGeometry(0.085, detail ? 7 : 12, detail ? 5 : 8);
  head.scale(1, 0.9, 1.2);
  head.translate(0, 0, -0.04);
  parts.push(head);
  for (const side of [-1, 1]) {
    const e = new THREE.SphereGeometry(0.04, detail ? 6 : 10, detail ? 4 : 8);
    e.translate(side * 0.075, 0.01, -0.04);
    parts.push(e);
  }
  const arms = 8;
  for (let i = 0; i < arms + 2; i++) {
    const long = i >= arms;
    const a = (i / arms) * Math.PI * 2;
    const len = long ? opts.tentLen : opts.armLen * (0.8 + 0.2 * Math.sin(i));
    const g = new THREE.CylinderGeometry(long ? 0.006 : 0.012, long ? 0.01 : 0.03, len, detail ? 3 : 5, detail ? 4 : 10, true);
    g.translate(0, -len / 2, 0);
    g.rotateX(-Math.PI / 2);
    const sp = long ? 0.02 : 0.05;
    g.translate(Math.cos(a) * sp, Math.sin(a) * sp, -0.1);
    // flare outward
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let k = 0; k < p.count; k++) {
      const d = -0.1 - p.getZ(k);
      p.setX(k, p.getX(k) + Math.cos(a) * d * (long ? 0.04 : 0.12));
      p.setY(k, p.getY(k) + Math.sin(a) * d * (long ? 0.04 : 0.12));
    }
    if (long) {
      const club = new THREE.SphereGeometry(0.025, detail ? 4 : 6, detail ? 3 : 4);
      club.scale(1, 0.6, 3);
      club.translate(Math.cos(a) * 0.04, Math.sin(a) * 0.04, -0.1 - len);
      setAttr(club, 'aBend', () => 1);
      parts.push(club);
    }
    setAttr(g, 'aBend', (_x, _y, z) => Math.min(1, Math.max(0, (-0.1 - z) / len)) * 1.2);
    parts.push(g);
  }
  return finalize(parts, (x, y, z) => [(z + 0.1 + opts.tentLen) / (0.56 + 0.1 + opts.tentLen), (y + 0.15) / 0.3]);
}

export function buildOctopus(opts: { dumbo?: boolean }, detail: 0 | 1 = 0): THREE.BufferGeometry {
  const parts: Part[] = [];
  const r = mulberry32(31);
  if (opts.dumbo) {
    const bell = new THREE.SphereGeometry(0.5, detail ? 10 : 20, detail ? 6 : 12, 0, Math.PI * 2, 0, Math.PI * 0.62);
    bell.scale(1, 0.75, 1);
    setAttr(bell, 'aPulse', (x, y, z) => Math.min(1, Math.hypot(x, z) * 2) * (y < 0.1 ? 1 : 0.3));
    parts.push(bell);
    // web skirt
    const skirt = new THREE.CylinderGeometry(0.42, 0.6, 0.18, detail ? 12 : 24, 1, true);
    skirt.translate(0, -0.1, 0);
    setAttr(skirt, 'aPulse', () => 1);
    parts.push(skirt);
    for (const side of [-1, 1]) {
      const ear = flatPoly([[0, 0], [0.14, 0.08], [0.16, 0.18], [0.02, 0.12]], (a, b) => [side * (0.32 + a), 0.25 + b, 0]);
      setAttr(ear, 'aFlap', () => 1);
      parts.push(ear);
    }
    for (const side of [-1, 1]) {
      const e = new THREE.SphereGeometry(0.05, detail ? 5 : 8, detail ? 3 : 6);
      e.translate(side * 0.22, 0.12, 0.33);
      parts.push(e);
    }
    return finalize(parts, (x, _y, z) => [x + 0.5, z + 0.5]);
  }
  const mantle = new THREE.SphereGeometry(0.18, detail ? 9 : 16, detail ? 6 : 12);
  mantle.scale(1, 1.25, 1.1);
  mantle.translate(0, 0.22, -0.12);
  parts.push(mantle);
  const head = new THREE.SphereGeometry(0.12, detail ? 7 : 12, detail ? 5 : 10);
  head.translate(0, 0.1, 0.06);
  parts.push(head);
  for (const side of [-1, 1]) {
    const e = new THREE.SphereGeometry(0.035, detail ? 5 : 8, detail ? 3 : 6);
    e.translate(side * 0.09, 0.17, 0.11);
    parts.push(e);
  }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + r() * 0.3;
    const L = 0.45 + r() * 0.15;
    const curl = (r() - 0.5) * 3;
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k <= 10; k++) {
      const t = k / 10;
      const ang = a + curl * t * t;
      const d = 0.06 + t * L;
      pts.push(new THREE.Vector3(Math.cos(ang) * d, 0.04 * (1 - t) + 0.02 * Math.sin(t * 9 + i), Math.sin(ang) * d + 0.04));
    }
    const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), detail ? 7 : 16, 0.03, detail ? 3 : 5, false);
    const p = tube.attributes.position as THREE.BufferAttribute;
    // taper toward tip
    const c = pts[0];
    for (let k = 0; k < p.count; k++) {
      const v = new THREE.Vector3(p.getX(k), p.getY(k), p.getZ(k));
      const d = Math.hypot(v.x - c.x, v.z - c.z) / L;
      // nearest centre point approx
      const idxC = Math.min(10, Math.round(d * 10));
      const cc = pts[idxC];
      const tap = 1 - Math.min(1, d) * 0.85;
      v.sub(cc).multiplyScalar(tap).add(cc);
      p.setXYZ(k, v.x, Math.max(0.005, v.y), v.z);
    }
    tube.computeVertexNormals();
    setAttr(tube, 'aBend', (x, _y, z) => Math.min(1, Math.hypot(x, z) / L) * 0.5);
    parts.push(tube);
  }
  return finalize(parts, (x, _y, z) => [x * 0.9 + 0.5, z * 0.9 + 0.5]);
}

// --------------------------------------------------------------------------- turtle

export function buildTurtle(detail: 0 | 1 = 0): THREE.BufferGeometry {
  const parts: Part[] = [];
  const shell = new THREE.SphereGeometry(0.5, detail ? 12 : 22, detail ? 5 : 12, 0, Math.PI * 2, 0, Math.PI / 2);
  shell.scale(0.8, 0.32, 1);
  parts.push(shell);
  const plastron = new THREE.CircleGeometry(0.5, detail ? 12 : 22);
  plastron.rotateX(Math.PI / 2);
  plastron.scale(0.78, 1, 0.98);
  plastron.translate(0, -0.02, 0);
  parts.push(plastron);
  const head = new THREE.SphereGeometry(0.11, detail ? 7 : 12, detail ? 5 : 8);
  head.scale(0.85, 0.75, 1.3);
  head.translate(0, 0.02, 0.58);
  parts.push(head);
  const neck = new THREE.CylinderGeometry(0.08, 0.1, 0.16, detail ? 6 : 10);
  neck.rotateX(Math.PI / 2);
  neck.translate(0, 0.01, 0.47);
  parts.push(neck);
  for (const side of [-1, 1]) {
    const f = flatPoly([[0, 0.05], [0.35, 0.02], [0.62, -0.12], [0.6, -0.18], [0.3, -0.1], [0, -0.06]], (a, b) => [side * (0.34 + a), -0.02, 0.26 + b]);
    setAttr(f, 'aFlap', (x) => Math.min(1, (Math.abs(x) - 0.3) * 2.2));
    parts.push(f);
    const rf = flatPoly([[0, 0.04], [0.16, -0.02], [0.18, -0.1], [0, -0.06]], (a, b) => [side * (0.25 + a), -0.03, -0.38 + b]);
    setAttr(rf, 'aFlap', (x) => Math.min(1, (Math.abs(x) - 0.24) * 1.5) * 0.4);
    parts.push(rf);
  }
  return finalize(parts, (x, y, z) => [Math.min(0.98, Math.max(0.02, x * 0.8 + 0.5)), Math.min(0.99, (z * 0.8 + 0.5) * 0.5 + (y > 0.005 || Math.abs(x) > 0.36 || z > 0.42 ? 0.5 : 0))]);
}

// --------------------------------------------------------------------------- crustaceans / slugs / eels

export function buildCrustacean(opts: { lobster?: boolean; shrimp?: boolean; fiddler?: boolean }, detail: 0 | 1 = 0): THREE.BufferGeometry {
  if (opts.shrimp) return buildShrimp();
  const parts: Part[] = [];
  const segs = opts.lobster ? 7 : 8;
  for (let i = 0; i < segs; i++) {
    const t = i / (segs - 1);
    const s = new THREE.SphereGeometry(1, detail ? 7 : 12, detail ? 4 : 8);
    const w = opts.lobster ? (i < 2 ? 0.16 : 0.13 * (1 - t * 0.4)) : 0.22 * Math.sin(Math.PI * (0.2 + t * 0.7));
    s.scale(w, opts.lobster ? 0.1 : 0.09, opts.lobster ? (i < 2 ? 0.16 : 0.07) : 0.075);
    const z = opts.lobster ? 0.4 - (i < 2 ? i * 0.2 : 0.2 + i * 0.11) : 0.42 - t * 0.84;
    s.translate(0, 0.08, z);
    parts.push(s);
  }
  if (opts.lobster) {
    const tail = flatPoly([[-0.12, 0], [0.12, 0], [0.16, -0.12], [-0.16, -0.12]], (a, b) => [a, 0.06, -0.5 + b]);
    parts.push(tail);
    for (const side of [-1, 1]) {
      const ant = new THREE.CylinderGeometry(0.004, 0.018, 1.1, detail ? 3 : 5);
      ant.rotateX(Math.PI / 2 - 0.2);
      ant.rotateY(side * 0.35);
      ant.translate(side * 0.2, 0.16, 0.92);
      setAttr(ant, 'aBend', () => 0.3);
      parts.push(ant);
    }
  }
  for (let i = 0; i < (opts.lobster ? 5 : 7); i++) {
    for (const side of [-1, 1]) {
      const z = 0.3 - i * (opts.lobster ? 0.1 : 0.1);
      const leg = new THREE.CylinderGeometry(0.008, 0.012, 0.22, 4);
      leg.rotateZ(side * 1.0);
      leg.translate(side * (opts.lobster ? 0.18 : 0.22), 0.02, z);
      setAttr(leg, 'aBend', () => 0.15);
      parts.push(leg);
    }
  }
  if (opts.fiddler) {
    // fiddler crab (Phase 9 S4): one claw as big as the body, the other a small one
    for (const [side, k] of [[1, 1], [-1, 0.28]] as const) {
      const arm = new THREE.CylinderGeometry(0.014 * (1 + k), 0.02 * (1 + k), 0.2, 5);
      arm.rotateX(Math.PI / 2 - 0.3);
      arm.translate(side * 0.18, 0.1, 0.5);
      parts.push(arm);
      const claw = new THREE.SphereGeometry(1, detail ? 7 : 10, detail ? 4 : 6);
      claw.scale(0.05 + 0.1 * k, 0.04 + 0.05 * k, 0.07 + 0.2 * k);
      claw.translate(side * 0.2, 0.12, 0.66 + 0.08 * k);
      parts.push(claw);
    }
  }
  return finalize(parts, (x, _y, z) => [x * 1.6 + 0.5, z * 0.9 + 0.5]);
}

export function buildNudibranch(): THREE.BufferGeometry {
  const parts: Part[] = [];
  const body = new THREE.SphereGeometry(0.5, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  body.scale(0.32, 0.28, 1);
  const p = body.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), y = p.getY(i);
    if (y < 0.03) p.setX(i, x * (1 + 0.15 * Math.sin(z * 40)));
  }
  body.computeVertexNormals();
  parts.push(body);
  for (const side of [-1, 1]) {
    const rh = new THREE.ConeGeometry(0.025, 0.16, 6);
    rh.translate(side * 0.06, 0.2, 0.32);
    parts.push(rh);
  }
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const g = new THREE.ConeGeometry(0.02, 0.14, 4);
    g.rotateZ(Math.cos(a) * 0.6);
    g.rotateX(Math.sin(a) * 0.6);
    g.translate(Math.cos(a) * 0.04, 0.18, -0.3 + Math.sin(a) * 0.04);
    setAttr(g, 'aBend', () => 0.3);
    parts.push(g);
  }
  return finalize(parts, (x, _y, z) => [x * 1.4 + 0.5, z + 0.5]);
}

// --------------------------------------------------------------------------- invertebrates

/** Sea cucumber: bumpy flattened sausage along Z. Optional swimming skirt (aFlap). */
export function buildCucumber(opts: { papillae?: number; skirt?: boolean; legs?: boolean } = {}): THREE.BufferGeometry {
  const parts: Part[] = [];
  const prof: THREE.Vector2[] = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    prof.push(new THREE.Vector2(Math.max(0.004, Math.sin(Math.PI * t) ** 0.6 * 0.11), (t - 0.5) * 1.0));
  }
  const body = new THREE.LatheGeometry(prof, 14);
  body.rotateX(Math.PI / 2);
  const p = body.attributes.position as THREE.BufferAttribute;
  const pap = opts.papillae ?? 0.25;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const bump = 1 + pap * Math.max(0, Math.sin(z * 37 + Math.atan2(y, x) * 5)) * Math.max(0, Math.sin(z * 23 - Math.atan2(y, x) * 3));
    p.setXYZ(i, x * bump, (y > 0 ? y * 0.85 * bump : y * 0.35) + 0.06, z);
  }
  body.computeVertexNormals();
  parts.push(body);
  if (opts.skirt) {
    for (const side of [-1, 1]) {
      const sk = flatPoly([[0.0, -0.4], [0.12, -0.3], [0.14, 0.2], [0.0, 0.42]], (a, b) => [side * (0.08 + a), 0.05, b]);
      setAttr(sk, 'aFlap', (x) => Math.min(1, Math.abs(x) * 6));
      parts.push(sk);
    }
  }
  if (opts.legs) {
    for (let i = 0; i < 10; i++) {
      for (const side of [-1, 1]) {
        const l = new THREE.CylinderGeometry(0.008, 0.014, 0.07, 4);
        l.translate(side * 0.09, 0.02, -0.38 + i * 0.08);
        setAttr(l, 'aBend', () => 0.2);
        parts.push(l);
      }
    }
    for (let i = 0; i < 4; i++) {
      const l = new THREE.CylinderGeometry(0.006, 0.012, 0.12, 4);
      l.rotateX(-0.5);
      l.translate((i - 1.5) * 0.04, 0.18, 0.3);
      parts.push(l);
    }
  }
  return finalize(parts, (x, _y, z) => [x * 2.2 + 0.5, z + 0.5]);
}

/** Sea star. arms 5..16; spines adds crown-of-thorns style cones. */
export function buildStar(opts: { arms: number; arm: number; core: number; thick: number; sharp?: number; spines?: number; curl?: number }): THREE.BufferGeometry {
  const parts: Part[] = [];
  const A = opts.arms;
  const R = (t: number) => opts.core + opts.arm * Math.pow(Math.abs(Math.cos((A * t) / 2)), opts.sharp ?? 1.6);
  const NR = 7, NT = A * 10;
  const pos: number[] = [];
  const idx: number[] = [];
  pos.push(0, opts.thick, 0);
  for (let i = 1; i <= NR; i++) {
    for (let j = 0; j < NT; j++) {
      const t = (j / NT) * Math.PI * 2;
      const rr = (i / NR) * R(t);
      const f = i / NR;
      const y = opts.thick * (1 - f * f) * (0.6 + 0.4 * (R(t) / (opts.core + opts.arm))) + (opts.curl ?? 0) * f * f * (rr / (opts.core + opts.arm));
      pos.push(Math.cos(t) * rr, y, Math.sin(t) * rr);
    }
  }
  for (let j = 0; j < NT; j++) idx.push(0, 1 + ((j + 1) % NT), 1 + j);
  for (let i = 1; i < NR; i++)
    for (let j = 0; j < NT; j++) {
      const a = 1 + (i - 1) * NT + j, b = 1 + (i - 1) * NT + ((j + 1) % NT);
      const c = a + NT, d = b + NT;
      idx.push(a, b, c, b, d, c);
    }
  const top = new THREE.BufferGeometry();
  top.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  top.setIndex(idx);
  top.computeVertexNormals();
  parts.push(top);
  const r = mulberry32(A * 7);
  for (let k = 0; k < (opts.spines ?? 0); k++) {
    const t = r() * Math.PI * 2;
    const rr = Math.sqrt(r()) * R(t) * 0.9;
    const s = new THREE.ConeGeometry(0.008, 0.06, 4);
    s.rotateX((r() - 0.5) * 0.8);
    s.rotateZ((r() - 0.5) * 0.8);
    s.translate(Math.cos(t) * rr, opts.thick * (1 - (rr / R(t)) ** 2) + 0.025, Math.sin(t) * rr);
    parts.push(s);
  }
  const M = opts.core + opts.arm;
  return finalize(parts, (x, _y, z) => [x / (2 * M) + 0.5, z / (2 * M) + 0.5]);
}

/** Sea urchin: squashed test with radiating spines. */
export function buildUrchin(opts: { spine: number; n: number; thin?: number }): THREE.BufferGeometry {
  const parts: Part[] = [];
  const body = new THREE.SphereGeometry(0.5, 14, 10);
  body.scale(1, 0.62, 1);
  body.translate(0, 0.28, 0);
  parts.push(body);
  const r = mulberry32(5);
  for (let i = 0; i < opts.n; i++) {
    const u = r() * 2 - 0.35;
    const th = r() * Math.PI * 2;
    const dir = new THREE.Vector3(Math.cos(th) * Math.sqrt(1 - Math.min(1, u * u)), u, Math.sin(th) * Math.sqrt(1 - Math.min(1, u * u))).normalize();
    if (dir.y < -0.2) continue;
    const len = opts.spine * (0.7 + r() * 0.5);
    const c = new THREE.ConeGeometry(opts.thin ?? 0.025, len, 3);
    c.translate(0, len / 2, 0);
    c.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
    c.translate(dir.x * 0.45, 0.28 + dir.y * 0.28, dir.z * 0.45);
    setAttr(c, 'aBend', (_x, y) => Math.max(0, y - 0.5) * 0.15);
    parts.push(c);
  }
  return finalize(parts, (x, y, z) => [x * 0.5 + 0.5, Math.min(1, y)]);
}

/** Giant clam: fluted shell bowl with a zig-zag gape; colourful mantle bulging out of the top. */
export function buildClam(opts: { mantle: boolean }): THREE.BufferGeometry {
  const parts: Part[] = [];
  const NZ = 24, NA = 16;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j <= NZ; j++) {
    const t = j / NZ;
    const z = (t - 0.5) * 1.0;
    const half = Math.sin(Math.PI * t) ** 0.6;
    const rim = 0.36 * half + 0.05 * Math.sin(t * Math.PI * 14) * half; // zig-zag gape
    for (let i = 0; i <= NA; i++) {
      const a = (i / NA) * Math.PI; // 0..pi around the bottom
      const flute = 1 + 0.09 * Math.cos(a * 9);
      const x = Math.cos(a) * 0.3 * half * flute;
      const y = rim - Math.sin(a) * 0.36 * half * flute;
      pos.push(x, y, z);
    }
  }
  for (let j = 0; j < NZ; j++)
    for (let i = 0; i < NA; i++) {
      const a = j * (NA + 1) + i, b2 = a + NA + 1;
      idx.push(a, b2, a + 1, a + 1, b2, b2 + 1);
    }
  const shell = new THREE.BufferGeometry();
  shell.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  shell.setIndex(idx);
  shell.computeVertexNormals();
  parts.push(shell);
  if (opts.mantle) {
    const m = new THREE.SphereGeometry(0.5, 22, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    m.scale(0.36, 0.1, 0.92);
    const p = m.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      p.setX(i, x * (1 + 0.18 * Math.sin(z * 26)));
    }
    m.translate(0, 0.3, 0);
    m.computeVertexNormals();
    setAttr(m, 'aPulse', () => 0.4);
    parts.push(m);
  }
  return finalize(parts, (x, y, z) => [z + 0.5, y > 0.3 ? 0.62 + x * 1.3 : 0.1 + Math.max(0, y + 0.1) * 0.8]);
}

/** Christmas tree worm: two spiral plumes. */
export function buildTreeWorm(): THREE.BufferGeometry {
  const parts: Part[] = [];
  for (const side of [-1, 1]) {
    for (let k = 0; k < 6; k++) {
      const r0 = 0.3 - k * 0.045;
      const ring = new THREE.ConeGeometry(r0, 0.16, 10, 1, true);
      ring.translate(side * 0.28, 0.1 + k * 0.13, 0);
      setAttr(ring, 'aBend', (_x, y) => y * 0.2);
      parts.push(ring);
    }
  }
  return finalize(parts, (x, y) => [x * 0.5 + 0.5, y]);
}

/** Feather star / crinoid / basket star: arms radiating from a cup, optional stalk. */
export function buildFeather(opts: { arms: number; len: number; stalk?: number; curl?: number; width?: number }): THREE.BufferGeometry {
  const parts: Part[] = [];
  const st = opts.stalk ?? 0;
  if (st > 0) {
    const s = new THREE.CylinderGeometry(0.02, 0.03, st, 6);
    s.translate(0, st / 2, 0);
    parts.push(s);
  }
  const cup = new THREE.SphereGeometry(0.08, 8, 6);
  cup.translate(0, st + 0.04, 0);
  parts.push(cup);
  const r = mulberry32(opts.arms * 13 + st * 100);
  for (let i = 0; i < opts.arms; i++) {
    const a = (i / opts.arms) * Math.PI * 2 + r() * 0.2;
    const len = opts.len * (0.8 + r() * 0.3);
    const segs = 8;
    const pts: [number, number][] = [];
    const w = opts.width ?? 0.035;
    for (let k = 0; k <= segs; k++) pts.push([k / segs, w * (1 - (k / segs) * 0.7)]);
    for (let k = segs; k >= 0; k--) pts.push([k / segs, -w * (1 - (k / segs) * 0.7)]);
    const arm = flatPoly(pts, (u, v) => {
      const t = u;
      const elev = 0.9 - t * (opts.curl ?? 1.6);
      const d = len * t;
      return [Math.cos(a) * d * Math.cos(elev * 0.6) + Math.sin(a) * v, st + 0.06 + Math.sin(elev) * d * 0.6, Math.sin(a) * d * Math.cos(elev * 0.6) - Math.cos(a) * v];
    });
    setAttr(arm, 'aBend', (x, y, z) => Math.min(1, Math.hypot(x, z) / len) * 0.8);
    parts.push(arm);
  }
  return finalize(parts, (x, y, z) => [Math.hypot(x, z) / (opts.len + 0.1), (Math.atan2(z, x) / (Math.PI * 2) + 0.5)]);
}

/** Hermit crab in a spiral shell. */
export function buildHermit(): THREE.BufferGeometry {
  const parts: Part[] = [];
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    pts.push(new THREE.Vector2(0.28 * Math.sin(Math.PI * Math.min(1, t * 1.1)) * (1 - t * 0.5) + 0.01, t * 0.7));
  }
  const shell = new THREE.LatheGeometry(pts, 12);
  const p = shell.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const tw = y * 5;
    const x = p.getX(i), z = p.getZ(i);
    p.setXYZ(i, x * Math.cos(tw) - z * Math.sin(tw) * 0.3, y, z * Math.cos(tw) + x * Math.sin(tw) * 0.3);
  }
  shell.rotateX(-Math.PI / 2 + 0.3);
  shell.translate(0, 0.25, -0.15);
  shell.computeVertexNormals();
  parts.push(shell);
  for (const side of [-1, 1]) {
    const claw = new THREE.SphereGeometry(0.07, 8, 6);
    claw.scale(0.8, 0.6, 1.4);
    claw.translate(side * 0.08, 0.08, 0.32);
    parts.push(claw);
    for (let k = 0; k < 2; k++) {
      const leg = new THREE.CylinderGeometry(0.012, 0.018, 0.22, 4);
      leg.rotateZ(side * 0.9);
      leg.translate(side * 0.14, 0.06, 0.2 - k * 0.08);
      setAttr(leg, 'aBend', () => 0.3);
      parts.push(leg);
    }
    const ant = new THREE.CylinderGeometry(0.003, 0.006, 0.25, 3);
    ant.rotateX(Math.PI / 2 - 0.5);
    ant.translate(side * 0.03, 0.2, 0.42);
    parts.push(ant);
  }
  return finalize(parts, (x, y, z) => [x + 0.5, y > 0.12 || z < 0.1 ? 0.5 + y * 0.6 : 0.2]);
}

/** Comb jelly / pyrosome / tunicate: translucent spindle with glow meridians. */
export function buildSpindle(opts: { len: number; rad: number; rows: number; open?: boolean }): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 14; i++) {
    const t = i / 14;
    const r = Math.sin(Math.PI * t) ** 0.7 * opts.rad + (opts.open && t > 0.9 ? opts.rad * 0.5 : 0);
    pts.push(new THREE.Vector2(Math.max(0.004, r), (t - 0.5) * opts.len));
  }
  const g = new THREE.LatheGeometry(pts, Math.max(16, opts.rows * 3));
  setAttr(g, 'aGlow', (x, _y, z) => {
    const a = Math.atan2(z, x);
    return Math.pow(Math.max(0, Math.cos(a * opts.rows)), 12);
  });
  setAttr(g, 'aPulse', (x, _y, z) => Math.min(1, Math.hypot(x, z) / opts.rad) * 0.5);
  return finalize([g], (x, y, z) => [Math.atan2(z, x) / (Math.PI * 2) + 0.5, y / opts.len + 0.5]);
}

function buildShrimp(): THREE.BufferGeometry {
  const parts: Part[] = [];
  for (let i = 0; i < 7; i++) {
    const t = i / 6;
    const s = new THREE.SphereGeometry(1, 10, 6);
    s.scale(0.07 * (1 - t * 0.4), 0.08 * (1 - t * 0.5), 0.09);
    const arch = Math.sin(t * Math.PI) * 0.06;
    s.translate(0, 0.1 + arch, 0.3 - t * 0.55);
    parts.push(s);
  }
  const tail = flatPoly([[-0.06, 0], [0.06, 0], [0.09, -0.12], [-0.09, -0.12]], (a, b) => [a, 0.1, -0.28 + b]);
  parts.push(tail);
  for (const side of [-1, 1]) {
    const ant = new THREE.CylinderGeometry(0.002, 0.005, 0.8, 3);
    ant.rotateX(Math.PI / 2 - 0.35);
    ant.rotateY(side * 0.3);
    ant.translate(side * 0.12, 0.28, 0.65);
    setAttr(ant, 'aBend', () => 0.4);
    parts.push(ant);
    const claw = new THREE.CylinderGeometry(0.012, 0.016, 0.3, 4);
    claw.rotateX(Math.PI / 2 - 0.2);
    claw.rotateY(side * 0.5);
    claw.translate(side * 0.1, 0.1, 0.42);
    parts.push(claw);
    for (let k = 0; k < 4; k++) {
      const leg = new THREE.CylinderGeometry(0.005, 0.008, 0.16, 3);
      leg.rotateZ(side * 1.0);
      leg.translate(side * 0.08, 0.04, 0.2 - k * 0.07);
      setAttr(leg, 'aBend', () => 0.2);
      parts.push(leg);
    }
  }
  return finalize(parts, (x, _y, z) => [x * 2 + 0.5, z + 0.5]);
}

// --------------------------------------------------------------------------- photo fish

/**
 * Fish built from a photo silhouette (scripts/photo_fish.py). prof[i] = [top, bottom, coreTop, coreBottom]
 * in 0..1 image space, columns tail -> head. Two lofted sheets (left / right) whose lateral bulge follows the
 * fin-less core; fins stay as thin membranes and the exact outline comes from the texture alpha.
 */
export function buildPhotoFish(prof: number[][], aspect: number, widthRatio = 0.42, len = 1.12): THREE.BufferGeometry {
  const N = prof.length - 1;
  const M = 14;
  // smooth the fin-less core outline so the lateral bulge has no kinks (photo masks are noisy)
  const core = prof.map((r) => [r[2], r[3]]);
  for (let pass = 0; pass < 3; pass++) {
    const c0 = core.map((r) => [...r]);
    for (let i = 1; i < N; i++) for (const k of [0, 1]) core[i][k] = (c0[i - 1][k] + 2 * c0[i][k] + c0[i + 1][k]) / 4;
  }
  const Hh = len / aspect;
  const pos: number[] = [];
  const uv: number[] = [];
  const fin: number[] = [];
  const bend: number[] = [];
  const idx: number[] = [];
  const bendW = (z: number) => Math.pow(Math.min(1, Math.max(0, (0.5 - z) / 1.0)), 1.6) * 0.95 + 0.05;
  for (const side of [-1, 1]) {
    const base = pos.length / 3;
    for (let i = 0; i <= N; i++) {
      const [top, bot] = prof[i];
      const ct = Math.min(top, core[i][0]), cb = Math.max(bot, core[i][1]);
      const u = i / N;
      const z = 0.5 - len + u * len;
      const cm = (ct + cb) / 2;
      const cr = Math.max(1e-3, (ct - cb) / 2);
      const halfW = (ct - cb) * Hh * widthRatio * 0.5;
      // pad the column slightly so alpha, not geometry, defines the outline
      const t2 = Math.min(1, top + 0.01), b2 = Math.max(0, bot - 0.01);
      for (let j = 0; j <= M; j++) {
        const v = b2 + ((t2 - b2) * j) / M;
        const q = (v - cm) / cr;
        const inCore = Math.abs(q) < 1;
        const bulge = inCore ? halfW * Math.pow(1 - q * q, 0.5) : 0;
        pos.push(side * (bulge + 0.002), (v - 0.5) * Hh, z);
        uv.push(u, v);
        fin.push(inCore ? 0 : 1);
        bend.push(bendW(z));
      }
    }
    for (let i = 0; i < N; i++)
      for (let j = 0; j < M; j++) {
        const a = base + i * (M + 1) + j, b = a + M + 1;
        if (side > 0) idx.push(a, a + 1, b, a + 1, b + 1, b);
        else idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aFin', new THREE.Float32BufferAttribute(fin, 1));
  g.setAttribute('aBend', new THREE.Float32BufferAttribute(bend, 1));
  for (const a of ['aFlap', 'aPulse', 'aGlow']) setAttr(g, a, () => 0);
  setAttr(g, 'aAO', () => 1);
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

// --------------------------------------------------------------------------- prehistoric (legendary)

/** Ammonite: coiled, ribbed shell (planispiral, in the y-z plane) with a tuft of arms at the aperture (+z). */
export function buildAmmonite(): THREE.BufferGeometry {
  const parts: Part[] = [];
  const turns = 3.2, N = 140, R = 10;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const th = t * turns * Math.PI * 2;
    const r = 0.035 * Math.exp(t * 2.1); // growing radius of the coil
    const tube = r * 0.55 * (1 + 0.06 * Math.max(0, Math.sin(th * 7))); // ribs
    const cy = Math.sin(th) * r, cz = -Math.cos(th) * r;
    for (let j = 0; j <= R; j++) {
      const a = (j / R) * Math.PI * 2;
      const nx = Math.cos(a), nr = Math.sin(a);
      pos.push(nx * tube * 0.75, cy + Math.sin(th) * nr * tube, cz - Math.cos(th) * nr * tube);
    }
  }
  for (let i = 0; i < N; i++)
    for (let j = 0; j < R; j++) {
      const a = i * (R + 1) + j, b = a + R + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  const shell = new THREE.BufferGeometry();
  shell.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  shell.setIndex(idx);
  shell.computeVertexNormals();
  const s = 0.5 / 0.3;
  shell.scale(s, s, s);
  parts.push(shell);
  // arms from the aperture (the last ring sits at the bottom-front of the coil)
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2;
    const arm = new THREE.CylinderGeometry(0.004, 0.012, 0.22, 4);
    arm.rotateX(Math.PI / 2 + 0.5);
    arm.translate(Math.cos(a) * 0.04, -0.38 + Math.sin(a) * 0.04, 0.16);
    setAttr(arm, 'aBend', () => 1);
    parts.push(arm);
  }
  return finalize(parts, (x, y, z) => [Math.min(0.99, Math.max(0.01, z + 0.5)), Math.min(0.99, Math.max(0.01, y + 0.5))]);
}

/** Plesiosaur (Futabasaurus-like): barrel body, long neck and small head forward (+z), four paddles that flap. */
export function buildPlesiosaur(): THREE.BufferGeometry {
  const parts: Part[] = [];
  const body = new THREE.SphereGeometry(0.5, 20, 14);
  body.scale(0.32, 0.22, 0.42);
  body.translate(0, 0, -0.12);
  parts.push(body);
  // neck: tapering tube along a gentle upward curve
  const neckPts: THREE.Vector3[] = [];
  for (let i = 0; i <= 10; i++) { const t = i / 10; neckPts.push(new THREE.Vector3(0, 0.02 + t * t * 0.06, 0.06 + t * 0.42)); }
  const neck = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(neckPts), 20, 0.035, 8);
  const np = neck.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < np.count; i++) {
    const t = Math.min(1, Math.max(0, (np.getZ(i) - 0.06) / 0.42));
    const sc = 1.9 - t * 1.1;
    np.setX(i, np.getX(i) * sc);
    np.setY(i, (np.getY(i) - (0.02 + t * t * 0.06)) * sc + 0.02 + t * t * 0.06);
  }
  neck.computeVertexNormals();
  setAttr(neck, 'aBend', (_x, _y, z) => Math.max(0, z - 0.1) * 0.6);
  parts.push(neck);
  const head = new THREE.SphereGeometry(0.04, 10, 8);
  head.scale(0.8, 0.7, 1.6);
  head.translate(0, 0.085, 0.53);
  setAttr(head, 'aBend', () => 0.26);
  parts.push(head);
  const tail = new THREE.ConeGeometry(0.06, 0.26, 10);
  tail.rotateX(-Math.PI / 2);
  tail.translate(0, 0, -0.44);
  setAttr(tail, 'aBend', () => 0.6);
  parts.push(tail);
  for (const side of [-1, 1])
    for (const [zc, len] of [[0.04, 0.3], [-0.24, 0.26]] as const) {
      const f = flatPoly([[0, 0.05], [len * 0.5, 0.03], [len, -0.04], [len * 0.92, -0.08], [len * 0.4, -0.05], [0, -0.05]], (a, b) => [side * (0.12 + a), -0.04 - a * 0.12, zc + b]);
      setAttr(f, 'aFlap', (x) => Math.min(1, (Math.abs(x) - 0.1) * 3) * (zc > 0 ? 1 : 0.8));
      parts.push(f);
    }
  return finalize(parts, (x, y, z) => [Math.min(0.99, Math.max(0.01, z + 0.5)), Math.min(0.99, Math.max(0.01, y * 2 + 0.5))]);
}

/** Anomalocaris: flat segmented body with rows of side lobes (flap), fan tail, and two spiny frontal appendages (+z). */
export function buildAnomalocaris(): THREE.BufferGeometry {
  const parts: Part[] = [];
  const body = new THREE.SphereGeometry(0.5, 18, 10);
  body.scale(0.2, 0.08, 0.8);
  parts.push(body);
  const head = new THREE.SphereGeometry(0.1, 12, 8);
  head.scale(1.2, 0.7, 1);
  head.translate(0, 0.01, 0.38);
  parts.push(head);
  for (const side of [-1, 1]) {
    const eye = new THREE.SphereGeometry(0.03, 8, 6);
    eye.translate(side * 0.11, 0.05, 0.36);
    eye.userData.eye = true;
    parts.push(eye);
    for (let k = 0; k < 11; k++) {
      const z = 0.3 - k * 0.062;
      const w = 0.16 * (1 - Math.abs(k - 3) / 13);
      const lobe = flatPoly([[0, 0.028], [w, 0.03], [w * 1.08, -0.02], [0, -0.03]], (a, b) => [side * (0.08 + a), 0, z + b]);
      setAttr(lobe, 'aFlap', (x) => Math.min(1, (Math.abs(x) - 0.07) * 6));
      parts.push(lobe);
    }
    // frontal appendage: curled, segmented, with spines
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 8; i++) { const t = i / 8; pts.push(new THREE.Vector3(side * (0.05 + 0.02 * t), -0.02 - Math.sin(t * 2.6) * 0.1, 0.45 + Math.sin(t * 1.8) * 0.16)); }
    parts.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 12, 0.013, 6));
  }
  const fan = flatPoly([[0, 0.02], [0.14, -0.1], [0.06, -0.14], [0, -0.06], [-0.06, -0.14], [-0.14, -0.1]], (a, b) => [a, 0, -0.4 + b]);
  setAttr(fan, 'aBend', () => 1);
  parts.push(fan);
  return finalize(parts, (x, _y, z) => [Math.min(0.99, Math.max(0.01, x + 0.5)), Math.min(0.99, Math.max(0.01, z * 0.9 + 0.5))]);
}
