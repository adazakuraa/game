import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../utils/noise';

/**
 * Procedural creature geometry. Every builder returns one merged, non-indexed geometry with:
 *  position, normal, uv, aBend (lateral/vertical body-wave weight), aFlap (vertical flap weight),
 *  aPulse (radial pulse weight, jellies), aGlow (bioluminescence mask).
 * Creatures face +Z, length ~1 (instance scale sets real size).
 */

const ATTRS = ['aBend', 'aFlap', 'aPulse', 'aGlow', 'aFin'] as const;
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
    for (const a of ATTRS) if (!g.attributes[a]) setAttr(g, a, () => 0);
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

/**
 * Give a flat fin real substance: two sheets pushed apart by `half(x,y,z)` along `axis` (thick at the root,
 * paper-thin at the margin) and an aFin value of 1..1.49 that grows towards the margin (used for translucency).
 */
function thickFin(g0: Part, axis: 'x' | 'y', half: (x: number, y: number, z: number) => number, edge: (x: number, y: number, z: number) => number): Part {
  const g = g0.index ? g0.toNonIndexed() : g0;
  const p = g.attributes.position as THREE.BufferAttribute;
  const n = p.count;
  const pos = new Float32Array(n * 6);
  const fin = new Float32Array(n * 2);
  for (let side = 0; side < 2; side++) {
    const sg = side === 0 ? 1 : -1;
    for (let i = 0; i < n; i++) {
      // second sheet: reverse each triangle's winding
      const src = side === 0 ? i : i - (i % 3) + [0, 2, 1][i % 3];
      const x = p.getX(src), y = p.getY(src), z = p.getZ(src);
      const t = half(x, y, z) * sg;
      const o = (side * n + i) * 3;
      pos[o] = axis === 'x' ? x + t : x;
      pos[o + 1] = axis === 'y' ? y + t : y;
      pos[o + 2] = z;
      fin[side * n + i] = 1 + 0.49 * Math.min(1, Math.max(0, edge(x, y, z)));
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('aFin', new THREE.BufferAttribute(fin, 1));
  out.computeVertexNormals();
  return out;
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
};

export type FishLayout = { zMin: number; zMax: number; yMax: number; env: (t: number) => number; top: (t: number) => number; shape: FishShape };

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

export function buildFish(s: FishShape): { geo: THREE.BufferGeometry; layout: FishLayout } {
  const env = fishEnvelope(s);
  const topK = fishTop(s);
  const R = s.rings ?? 14;
  const S = s.segs ?? 22;
  const H = s.H, W = s.W;
  const belly = s.belly ?? 0.08;
  const parts: Part[] = [];
  const bendW = (z: number) => Math.pow(Math.min(1, Math.max(0, (0.5 - z) / 1.0)), 1.6) * 0.95 + 0.05;

  // body tube
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= S; i++) {
    const t = i / S;
    const z = t - 0.5;
    const e = env(t);
    for (let j = 0; j <= R; j++) {
      const a = (j / R) * Math.PI * 2;
      const cy = Math.cos(a);
      const sy = Math.sin(a);
      const y = (H / 2) * e * cy * (cy > 0 ? topK(t) : 1) - (cy < 0 ? belly * H * e * -cy * 0.4 : 0);
      const hw = s.headW ? 1 + (s.headW - 1) * Math.min(1, Math.max(0, (t - 0.55) / 0.35)) ** 2 : 1;
      const x = (W / 2) * e * sy * (1 - 0.15 * cy) * hw;
      pos.push(x, y, z);
    }
  }
  for (let i = 0; i < S; i++)
    for (let j = 0; j < R; j++) {
      const a = i * (R + 1) + j, b = a + R + 1;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  const body = new THREE.BufferGeometry();
  body.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  body.setIndex(idx);
  body.computeVertexNormals();
  parts.push(body);

  const z0 = -0.5;
  const topAt = (t: number) => (H / 2) * env(t) * topK(t);
  const botAt = (t: number) => (H / 2) * env(t);
  const tl = s.tailL ?? 0.22;
  const th = s.tailH ?? H * 1.1;
  const pedH = Math.max(0.02, topAt(0.02));
  const vert = (a: number, b: number): [number, number, number] => [0, b, a];
  const tailStart = parts.length;
  switch (s.tail) {
    case 'fork':
      parts.push(flatPoly([[z0 + 0.03, pedH], [z0 - tl, th / 2], [z0 - tl * 0.78, th / 2 - 0.02], [z0 - tl * 0.42, 0], [z0 - tl * 0.78, -th / 2 + 0.02], [z0 - tl, -th / 2], [z0 + 0.03, -pedH]], vert));
      break;
    case 'lunate':
      parts.push(flatPoly([[z0 + 0.03, pedH], [z0 - tl * 0.75, th / 2], [z0 - tl, th / 2 + 0.01], [z0 - tl * 0.35, 0], [z0 - tl, -th / 2 - 0.01], [z0 - tl * 0.75, -th / 2], [z0 + 0.03, -pedH]], vert));
      break;
    case 'round': {
      const pts: [number, number][] = [[z0 + 0.03, pedH]];
      for (let k = 0; k <= 8; k++) {
        const a = Math.PI / 2 - (k / 8) * Math.PI;
        pts.push([z0 - tl * (0.55 + 0.45 * Math.cos(a)), (th / 2) * Math.sin(a)]);
      }
      pts.push([z0 + 0.03, -pedH]);
      parts.push(flatPoly(pts, vert));
      break;
    }
    case 'truncate':
      parts.push(flatPoly([[z0 + 0.03, pedH], [z0 - tl, th / 2], [z0 - tl * 1.05, 0], [z0 - tl, -th / 2], [z0 + 0.03, -pedH]], vert));
      break;
    case 'hetero':
      parts.push(flatPoly([[z0 + 0.04, pedH], [z0 - tl, th * 0.62], [z0 - tl * 0.86, th * 0.52], [z0 - tl * 0.32, -0.01], [z0 - tl * 0.5, -th * 0.33], [z0 - tl * 0.38, -th * 0.33], [z0 + 0.04, -pedH]], vert));
      break;
    case 'flukes':
      parts.push(flatPoly([[0.04, z0 + 0.04], [th / 2, z0 - tl * 0.8], [th / 2 - 0.02, z0 - tl], [0, z0 - tl * 0.55], [-th / 2 + 0.02, z0 - tl], [-th / 2, z0 - tl * 0.8], [-0.04, z0 + 0.04]], (a, b) => [a, 0, b]));
      break;
    case 'none':
      break;
  }
  {
    const rootZ = z0 + 0.03;
    const rootT = (W / 2) * env(0.03) * 0.85;
    for (let k = tailStart; k < parts.length; k++) {
      if (s.tail === 'flukes') {
        const e = (_x: number, _y: number, z: number) => Math.min(1, Math.max(0, (rootZ - z) / (tl + 0.03)));
        parts[k] = thickFin(parts[k], 'y', (x, y, z) => H * 0.05 * Math.pow(1 - e(x, y, z), 1.6), e);
      } else {
        const e = (_x: number, y: number, z: number) => Math.min(1, Math.max((rootZ - z) / (tl + 0.03), (Math.abs(y) - pedH) / Math.max(0.01, th / 2)));
        parts[k] = thickFin(parts[k], 'x', (x, y, z) => rootT * Math.pow(1 - Math.max(0, e(x, y, z)), 1.6), e);
      }
    }
  }

  // dorsal / anal fin strips
  const strip = (a: number, b: number, h: number, top: boolean, jag = 0, sweep = 0.3) => {
    const n = 12;
    const pts: [number, number][] = [];
    for (let k = 0; k <= n; k++) {
      const t = a + (b - a) * (k / n);
      const y = (top ? topAt(t) : -botAt(t)) * 0.9;
      pts.push([t - 0.5, y]);
    }
    for (let k = n; k >= 0; k--) {
      const t = a + (b - a) * (k / n);
      const prof = Math.sin(Math.pow(k / n, 0.7) * Math.PI) * 0.75 + 0.25;
      const jj = jag > 0 ? (k % 2 === 0 ? 1 : 1 - jag) : 1;
      const hh = h * (b - a < 0.25 ? Math.sin((k / n) * Math.PI) : prof) * jj;
      const y = (top ? topAt(t) : -botAt(t)) * 0.9 + hh * (top ? 1 : -1);
      pts.push([t - 0.5 - sweep * hh, y]);
    }
    const e = (_x: number, y: number, z: number) => {
      const tt = Math.min(1, Math.max(0, z + 0.5));
      return (Math.abs(y) - (y > 0 ? topAt(tt) : botAt(tt)) * 0.9) / Math.max(0.01, h);
    };
    parts.push(thickFin(flatPoly(pts, vert), 'x', (x, y, z) => (W / 2) * env(Math.min(1, Math.max(0, z + 0.5))) * 0.3 * Math.pow(1 - Math.min(1, Math.max(0, e(x, y, z))), 1.5), e));
  };
  for (const d of s.dorsal ?? []) strip(d.a, d.b, d.h, true, d.jag ?? 0, d.sweep ?? 0.3);
  for (const d of s.anal ?? []) strip(d.a, d.b, d.h, false);

  if (s.filament) {
    const d = (s.dorsal ?? [{ a: 0.3, b: 0.6, h: 0.3 }])[0];
    const tz = (d.a + d.b) / 2 - 0.5;
    const ty = topAt((d.a + d.b) / 2) + d.h;
    parts.push(flatPoly([[tz - 0.02, ty - 0.1], [tz - s.filament * 0.9, ty + s.filament * 0.25], [tz - s.filament, ty + s.filament * 0.2], [tz + 0.03, ty - 0.1]], vert));
  }

  // pectoral fins (both sides)
  if (s.pect) {
    const p = s.pect;
    const zt = p.t - 0.5;
    const yb = -topAt(p.t) * 0.25;
    for (const side of [-1, 1]) {
      const xb = (W / 2) * env(p.t) * 0.9 * side;
      const out = p.out ?? 0.6;
      parts.push(
        flatPoly([[0, 0], [p.len * out, -p.wid * 0.4], [p.len, -p.wid * 0.9], [p.len * 0.8, -p.wid * 1.1], [0.02, -p.wid * 0.5]], (a, b) => [
          xb + side * a * Math.cos(p.down),
          yb - a * Math.sin(p.down),
          zt + b,
        ]),
      );
    }
  }
  if (s.pelvic) {
    for (const side of [-1, 1]) {
      const t = 0.55;
      const yb = -topAt(t) * 0.8;
      parts.push(flatPoly([[0, 0], [0.08, -0.04], [0.06, -0.1], [0, -0.06]], (a, b) => [side * (W * 0.15 + a * 0.4), yb - a * 0.6, t - 0.5 + b]));
    }
  }
  if (s.ceph) {
    const c = new THREE.SphereGeometry(1, 16, 6);
    c.scale(s.ceph / 2, H * 0.12, 0.06);
    c.translate(0, H * 0.05, 0.43);
    c.userData.eye = true;
    parts.push(c);
  }
  if (s.lure) {
    const stalk = new THREE.CylinderGeometry(0.008, 0.012, 0.32, 5);
    stalk.rotateX(-0.7);
    stalk.translate(0, H / 2 + 0.1, 0.42);
    parts.push(stalk);
    const bulb = new THREE.SphereGeometry(0.035, 10, 8);
    bulb.translate(0, H / 2 + 0.22, 0.54);
    setAttr(bulb, 'aGlow', () => 1);
    parts.push(bulb);
  }
  // eyes
  const er = (s.eyes ?? 0.09) * H;
  if (er > 0) {
    const et = s.eyeT ?? 0.86;
    for (const side of [-1, 1]) {
      const e = new THREE.SphereGeometry(er, 8, 6);
      e.scale(0.5, 1, 1);
      e.translate((W / 2) * env(et) * 0.92 * side, topAt(et) * 0.22, et - 0.5);
      e.userData.eye = true;
      parts.push(e);
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
  const geo = finalize(parts, uvFn);
  return { geo, layout: { zMin, zMax, yMax, env, top: topK, shape: s } };
}

// --------------------------------------------------------------------------- ray / flatfish

export type RayShape = { span: number; len: number; thick: number; manta?: boolean; tail?: number; flounder?: boolean };

export function buildRay(s: RayShape): { geo: THREE.BufferGeometry; xMax: number; zMin: number; zMax: number } {
  const parts: Part[] = [];
  const NX = 18, NZ = 14;
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
      const e = new THREE.SphereGeometry(0.03, 8, 6);
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

export function buildJelly(opts: { tentacles: number; tentLen: number; oral?: boolean; flat?: number; glowRim?: boolean }): THREE.BufferGeometry {
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
  const bell = new THREE.LatheGeometry(pts, 18);
  setAttr(bell, 'aPulse', (x, y, z) => Math.min(1, Math.hypot(x, z) * 2) * (1 - Math.max(0, y) / (0.5 * flat) * 0.5));
  if (opts.glowRim) setAttr(bell, 'aGlow', (x, y, z) => (Math.hypot(x, z) > 0.4 && y < 0.08 ? 1 : 0));
  parts.push(bell);
  for (let i = 0; i < opts.tentacles; i++) {
    const a = (i / opts.tentacles) * Math.PI * 2;
    const len = opts.tentLen * (0.6 + r() * 0.5);
    const t = new THREE.CylinderGeometry(0.004, 0.008, len, 3, 4, true);
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

export function buildSquid(opts: { armLen: number; tentLen: number; finSize: number }): THREE.BufferGeometry {
  const parts: Part[] = [];
  // mantle points +Z (squid swims mantle-first)
  const prof: THREE.Vector2[] = [];
  for (let i = 0; i <= 14; i++) {
    const t = i / 14;
    prof.push(new THREE.Vector2(Math.max(0.005, 0.11 * Math.pow(Math.sin(Math.PI * (0.5 + t * 0.5)), 0.6) * (t < 0.2 ? 0.8 + t : 1)), t * 0.55));
  }
  const mantle = new THREE.LatheGeometry(prof, 14);
  mantle.rotateX(Math.PI / 2);
  parts.push(mantle);
  for (const side of [-1, 1]) {
    const fin = flatPoly([[0, 0.35], [opts.finSize, 0.5], [0, 0.56]], (a, b) => [side * (0.05 + a), 0, b]);
    setAttr(fin, 'aFlap', (x) => Math.min(1, Math.abs(x) * 4));
    parts.push(fin);
  }
  const head = new THREE.SphereGeometry(0.085, 12, 8);
  head.scale(1, 0.9, 1.2);
  head.translate(0, 0, -0.04);
  parts.push(head);
  for (const side of [-1, 1]) {
    const e = new THREE.SphereGeometry(0.04, 10, 8);
    e.translate(side * 0.075, 0.01, -0.04);
    parts.push(e);
  }
  const arms = 8;
  for (let i = 0; i < arms + 2; i++) {
    const long = i >= arms;
    const a = (i / arms) * Math.PI * 2;
    const len = long ? opts.tentLen : opts.armLen * (0.8 + 0.2 * Math.sin(i));
    const g = new THREE.CylinderGeometry(long ? 0.006 : 0.012, long ? 0.01 : 0.03, len, 5, 10, true);
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
      const club = new THREE.SphereGeometry(0.025, 6, 4);
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

export function buildOctopus(opts: { dumbo?: boolean }): THREE.BufferGeometry {
  const parts: Part[] = [];
  const r = mulberry32(31);
  if (opts.dumbo) {
    const bell = new THREE.SphereGeometry(0.5, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.62);
    bell.scale(1, 0.75, 1);
    setAttr(bell, 'aPulse', (x, y, z) => Math.min(1, Math.hypot(x, z) * 2) * (y < 0.1 ? 1 : 0.3));
    parts.push(bell);
    // web skirt
    const skirt = new THREE.CylinderGeometry(0.42, 0.6, 0.18, 24, 1, true);
    skirt.translate(0, -0.1, 0);
    setAttr(skirt, 'aPulse', () => 1);
    parts.push(skirt);
    for (const side of [-1, 1]) {
      const ear = flatPoly([[0, 0], [0.14, 0.08], [0.16, 0.18], [0.02, 0.12]], (a, b) => [side * (0.32 + a), 0.25 + b, 0]);
      setAttr(ear, 'aFlap', () => 1);
      parts.push(ear);
    }
    for (const side of [-1, 1]) {
      const e = new THREE.SphereGeometry(0.05, 8, 6);
      e.translate(side * 0.22, 0.12, 0.33);
      parts.push(e);
    }
    return finalize(parts, (x, _y, z) => [x + 0.5, z + 0.5]);
  }
  const mantle = new THREE.SphereGeometry(0.18, 16, 12);
  mantle.scale(1, 1.25, 1.1);
  mantle.translate(0, 0.22, -0.12);
  parts.push(mantle);
  const head = new THREE.SphereGeometry(0.12, 12, 10);
  head.translate(0, 0.1, 0.06);
  parts.push(head);
  for (const side of [-1, 1]) {
    const e = new THREE.SphereGeometry(0.035, 8, 6);
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
    const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.03, 5, false);
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

export function buildTurtle(): THREE.BufferGeometry {
  const parts: Part[] = [];
  const shell = new THREE.SphereGeometry(0.5, 22, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  shell.scale(0.8, 0.32, 1);
  parts.push(shell);
  const plastron = new THREE.CircleGeometry(0.5, 22);
  plastron.rotateX(Math.PI / 2);
  plastron.scale(0.78, 1, 0.98);
  plastron.translate(0, -0.02, 0);
  parts.push(plastron);
  const head = new THREE.SphereGeometry(0.11, 12, 8);
  head.scale(0.85, 0.75, 1.3);
  head.translate(0, 0.02, 0.58);
  parts.push(head);
  const neck = new THREE.CylinderGeometry(0.08, 0.1, 0.16, 10);
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

export function buildCrustacean(opts: { lobster?: boolean; shrimp?: boolean }): THREE.BufferGeometry {
  if (opts.shrimp) return buildShrimp();
  const parts: Part[] = [];
  const segs = opts.lobster ? 7 : 8;
  for (let i = 0; i < segs; i++) {
    const t = i / (segs - 1);
    const s = new THREE.SphereGeometry(1, 12, 8);
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
      const ant = new THREE.CylinderGeometry(0.004, 0.018, 1.1, 5);
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
