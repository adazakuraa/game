import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../utils/noise';

/**
 * Procedural creature geometry. Every builder returns one merged, non-indexed geometry with:
 *  position, normal, uv, aBend (lateral/vertical body-wave weight), aFlap (vertical flap weight),
 *  aPulse (radial pulse weight, jellies), aGlow (bioluminescence mask).
 * Creatures face +Z, length ~1 (instance scale sets real size).
 */

const ATTRS = ['aBend', 'aFlap', 'aPulse', 'aGlow'] as const;
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
  rings?: number;
  segs?: number;
};

export type FishLayout = { zMin: number; zMax: number; yMax: number; env: (t: number) => number; shape: FishShape };

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
      const y = (H / 2) * e * cy - (cy < 0 ? belly * H * e * -cy * 0.4 : 0);
      const x = (W / 2) * e * sy * (1 - 0.15 * cy);
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
  const topAt = (t: number) => (H / 2) * env(t);
  const tl = s.tailL ?? 0.22;
  const th = s.tailH ?? H * 1.1;
  const pedH = Math.max(0.02, topAt(0.02));
  const vert = (a: number, b: number): [number, number, number] => [0, b, a];
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

  // dorsal / anal fin strips
  const strip = (a: number, b: number, h: number, top: boolean, jag = 0, sweep = 0.3) => {
    const n = 12;
    const pts: [number, number][] = [];
    for (let k = 0; k <= n; k++) {
      const t = a + (b - a) * (k / n);
      const y = topAt(t) * (top ? 1 : -1) * 0.9;
      pts.push([t - 0.5, y]);
    }
    for (let k = n; k >= 0; k--) {
      const t = a + (b - a) * (k / n);
      const prof = Math.sin(Math.pow(k / n, 0.7) * Math.PI) * 0.75 + 0.25;
      const jj = jag > 0 ? (k % 2 === 0 ? 1 : 1 - jag) : 1;
      const hh = h * (b - a < 0.25 ? Math.sin((k / n) * Math.PI) : prof) * jj;
      const y = topAt(t) * (top ? 1 : -1) * 0.9 + hh * (top ? 1 : -1);
      pts.push([t - 0.5 - sweep * hh, y]);
    }
    parts.push(flatPoly(pts, vert));
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
  parts.forEach((g) => {
    if (!g.attributes.aBend) setAttr(g, 'aBend', (_x, _y, z) => bendW(z));
  });
  const geo = finalize(parts, uvFn);
  return { geo, layout: { zMin, zMax, yMax, env, shape: s } };
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

export function buildCrustacean(opts: { lobster?: boolean }): THREE.BufferGeometry {
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
