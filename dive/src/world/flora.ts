import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { ARCH, bommieAt, heightAt, reefEdgeZ, rockyWeight, VENT, WRECK, zoneAt, DIVE_POINTS } from './layout';
import { ScatterSet, type ScatterItem } from './scatter';
import { SWAY_VERTEX, underwaterMaterial } from '../render/underwater';
import { baked, pbr } from '../render/baked';
import { makeBlade, makeSeaFan } from '../render/textures';
import { fbm2, mulberry32, simplex2 } from '../utils/noise';

export const GARDEN_EEL_PATCH = { x: 28, z: 78, r: 13 };

type Rng = () => number;

function normalAt(x: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
  const e = 0.7;
  return out.set(heightAt(x - e, z) - heightAt(x + e, z), 2 * e, heightAt(x, z - e) - heightAt(x, z + e)).normalize();
}

const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);
const _n = new THREE.Vector3();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();

function placeMatrix(x: number, z: number, scale: number | THREE.Vector3, r: Rng, alignToNormal = 0, sink = 0): THREE.Matrix4 {
  const y = heightAt(x, z) - sink;
  normalAt(x, z, _n);
  _q.setFromUnitVectors(_up, _n.lerp(_up, 1 - alignToNormal).normalize());
  _q2.setFromAxisAngle(_up, r() * Math.PI * 2);
  _q.multiply(_q2);
  if (typeof scale === 'number') _s.setScalar(scale);
  else _s.copy(scale);
  return new THREE.Matrix4().compose(_p.set(x, y, z), _q, _s);
}

// ---------------------------------------------------------------- geometry factories

function rockGeometry(seed: number, detail = 2, squash = 0.7): THREE.BufferGeometry {
  let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  g = mergeVertices(g);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = 1 + 0.32 * simplex2(x * 1.3 + seed, z * 1.3 + y) + 0.14 * simplex2(x * 3.1 - seed, y * 3.1 + z);
    p.setXYZ(i, x * n, (y * n) * squash + 0.25 * squash, z * n);
  }
  g.computeVertexNormals();
  return g;
}

/** Dome-shaped colony (brain / massive Porites): flat base sunk into the reef, lumpy top. */
function domeColony(seed: number, segs: number, lump: number, freq: number, squash = 0.7): THREE.BufferGeometry {
  let g: THREE.BufferGeometry = new THREE.SphereGeometry(1, segs, Math.max(4, segs >> 1), 0, Math.PI * 2, 0, Math.PI * 0.56);
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  g = mergeVertices(g);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = 1 + lump * (simplex2(x * freq + seed, z * freq + y * freq) * 0.7 + simplex2(x * freq * 2.3 - seed, z * freq * 2.3) * 0.3);
    p.setXYZ(i, x * n, Math.max(-0.12, y * n * squash - 0.08), z * n);
  }
  g.computeVertexNormals();
  return g;
}

/** Cauliflower coral (Pocillopora): a cushion of stubby, round-tipped branches. */
function cauliflowerColony(seed: number): THREE.BufferGeometry {
  const r = mulberry32(seed);
  const parts: THREE.BufferGeometry[] = [];
  const base = new THREE.SphereGeometry(0.55, 12, 5, 0, Math.PI * 2, 0, Math.PI / 2);
  base.scale(1, 0.45, 1);
  parts.push(base);
  for (let i = 0; i < 16; i++) {
    const a = r() * Math.PI * 2;
    const d = Math.sqrt(r()) * 0.5;
    const h = 0.22 + r() * 0.2 - d * 0.15;
    const rad = 0.08 + r() * 0.035;
    const c = new THREE.CylinderGeometry(rad * 1.1, rad * 0.9, h, 6, 1, true);
    c.translate(0, h / 2, 0);
    const cap = new THREE.SphereGeometry(rad * 1.15, 6, 4);
    cap.translate(0, h, 0);
    const tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.sin(a) * d * 1.1, 0, -Math.cos(a) * d * 1.1));
    const y0 = 0.25 * Math.sqrt(Math.max(0, 1 - (d / 0.55) ** 2)) - 0.04;
    for (const q of [c, cap]) {
      q.applyQuaternion(tilt);
      q.translate(Math.cos(a) * d, y0, Math.sin(a) * d);
      parts.push(q);
    }
  }
  const g = mergeGeometries(parts.map((q) => { q.deleteAttribute('uv'); return q.index ? q.toNonIndexed() : q; }))!;
  g.computeVertexNormals();
  return g;
}

/** Foliose / plating coral: overlapping thin plates with upturned edges. */
function plateColony(seed: number): THREE.BufferGeometry {
  const r = mulberry32(seed);
  const parts: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 5; k++) {
    const rad = 0.35 + r() * 0.3;
    const plate = new THREE.CylinderGeometry(rad, rad * 0.95, 0.025, 22, 3);
    const p = plate.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      const rr = Math.hypot(x, z) / rad;
      const ang = Math.atan2(z, x);
      const w = 1 + 0.18 * Math.sin(ang * 3 + k) ;
      p.setXYZ(i, x * w, p.getY(i) + rr * rr * 0.16 + 0.03 * Math.sin(ang * 7), z * w);
    }
    plate.rotateX((r() - 0.5) * 0.6);
    plate.rotateZ((r() - 0.5) * 0.6);
    plate.translate((r() - 0.5) * 0.5, 0.06 + k * 0.09, (r() - 0.5) * 0.5);
    tipColors(plate, (y) => 0.3 + y * 1.5);
    plate.deleteAttribute('uv');
    parts.push(plate.toNonIndexed());
  }
  const g = mergeGeometries(parts)!;
  g.computeVertexNormals();
  return g;
}

function tipColors(geo: THREE.BufferGeometry, f: (y: number, i: number) => number) {
  const n = geo.attributes.position.count;
  const cols = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const t = Math.min(1, Math.max(0, f(geo.attributes.position.getY(i), i)));
    const k = t * t;
    cols[i * 3] = 0.42 + 0.58 * k;
    cols[i * 3 + 1] = 0.4 + 0.6 * k;
    cols[i * 3 + 2] = 0.36 + 0.64 * k;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
}

/** Branching (staghorn-like) Acropora: crooked, tapering branches ending in pale growing tips. */
function branchingCoral(seed: number, levels: number, spread: number, thick: number): THREE.BufferGeometry {
  const r = mulberry32(seed);
  const parts: THREE.BufferGeometry[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  const seg = (start: THREE.Vector3, dir: THREE.Vector3, len: number, r0: number, r1: number, t0: number, t1: number) => {
    const geo = new THREE.CylinderGeometry(r1, r0, len, 6, 1, true);
    geo.translate(0, len / 2, 0);
    geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, dir));
    geo.translate(start.x, start.y, start.z);
    tipColors(geo, (y) => t0 + (t1 - t0) * Math.min(1, Math.max(0, (y - start.y) / Math.max(0.01, len * dir.y))));
    geo.deleteAttribute('uv');
    parts.push(geo);
    return start.clone().addScaledVector(dir, len);
  };
  const grow = (start: THREE.Vector3, dir: THREE.Vector3, len: number, rad: number, lvl: number) => {
    const t = 1 - lvl / (levels + 1);
    // two crooked sub-segments per branch
    const d1 = dir.clone().add(new THREE.Vector3((r() - 0.5) * 0.35, 0, (r() - 0.5) * 0.35)).normalize();
    const mid = seg(start, d1, len * 0.5, rad, rad * 0.86, t, t + 0.08);
    const d2 = dir.clone().add(new THREE.Vector3((r() - 0.5) * 0.35, 0.1, (r() - 0.5) * 0.35)).normalize();
    const end = seg(mid, d2, len * 0.5, rad * 0.86, rad * (lvl <= 0 ? 0.32 : 0.72), t + 0.08, lvl <= 0 ? 1.1 : t + 0.16);
    if (lvl <= 0) return;
    const n = 2 + (r() < 0.3 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const d = d2.clone();
      d.x += (r() - 0.5) * spread;
      d.z += (r() - 0.5) * spread;
      d.y += 0.3;
      d.normalize();
      grow(end, d, len * (0.7 + r() * 0.22), rad * 0.72, lvl - 1);
    }
  };
  const trunks = 3 + Math.floor(r() * 3);
  for (let i = 0; i < trunks; i++) {
    const a = r() * Math.PI * 2;
    const d = new THREE.Vector3(Math.cos(a) * 0.5, 1, Math.sin(a) * 0.5).normalize();
    grow(new THREE.Vector3(Math.cos(a) * 0.12, -0.05, Math.sin(a) * 0.12), d, 0.36 + r() * 0.18, thick, levels);
  }
  return mergeGeometries(parts)!;
}

/** Corymbose / digitate Acropora: a low cushion bristling with short upright fingers. */
function corymboseCoral(seed: number): THREE.BufferGeometry {
  const r = mulberry32(seed);
  const parts: THREE.BufferGeometry[] = [];
  const base = new THREE.SphereGeometry(0.5, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  base.scale(1, 0.32, 1);
  tipColors(base, () => 0.2);
  base.deleteAttribute('uv');
  parts.push(base);
  for (let i = 0; i < 70; i++) {
    const a = r() * Math.PI * 2;
    const d = Math.sqrt(r()) * 0.46;
    const h = 0.12 + r() * 0.14 - d * 0.1;
    const c = new THREE.CylinderGeometry(0.007, 0.018, h, 5, 1, true);
    c.translate(0, h / 2, 0);
    c.applyQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.sin(a) * d * 0.9, 0, -Math.cos(a) * d * 0.9)));
    const y0 = 0.16 * Math.sqrt(Math.max(0, 1 - (d / 0.5) ** 2));
    c.translate(Math.cos(a) * d, y0, Math.sin(a) * d);
    tipColors(c, (y) => 0.25 + (y - y0) / h);
    c.deleteAttribute('uv');
    parts.push(c);
  }
  return mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)))!;
}

function tableCoral(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const tiers: [number, number, number][] = [[1, 0.85, 0], [0.62, 1.12, 0.6]];
  for (const [rad, y, rot] of tiers) {
    const top = new THREE.CylinderGeometry(rad, rad * 0.9, 0.07, 30, 2);
    const p = top.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      const rr = Math.hypot(x, z) / rad;
      const wob = 1 + 0.14 * simplex2(Math.atan2(z, x) * 2 + rot, 1.5) + 0.05 * simplex2(Math.atan2(z, x) * 7, rot);
      p.setXYZ(i, x * wob, p.getY(i) + rr * rr * 0.1 * rad + 0.02 * simplex2(x * 6, z * 6), z * wob);
    }
    top.translate(0.1 * rot, y, 0.05 * rot);
    parts.push(top.toNonIndexed());
  }
  const stalk = new THREE.CylinderGeometry(0.1, 0.2, 1.1, 7, 1, true);
  stalk.translate(0, 0.5, 0);
  parts.push(stalk.toNonIndexed());
  const g = mergeGeometries(parts.map((q) => { q.deleteAttribute('uv'); return q; }))!;
  const pos = g.attributes.position as THREE.BufferAttribute;
  const c = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const rr = Math.hypot(pos.getX(i), pos.getZ(i));
    const t = Math.min(1, rr);
    c[i * 3] = 0.6 + 0.4 * t; c[i * 3 + 1] = 0.6 + 0.4 * t; c[i * 3 + 2] = 0.55 + 0.45 * t;
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  g.computeVertexNormals();
  return g;
}

/** Leather / mushroom soft coral: short stalk with a frilled cap. */
function leatherCoral(): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [new THREE.Vector2(0.12, 0), new THREE.Vector2(0.1, 0.25), new THREE.Vector2(0.14, 0.4), new THREE.Vector2(0.45, 0.5), new THREE.Vector2(0.55, 0.47), new THREE.Vector2(0.5, 0.52), new THREE.Vector2(0.25, 0.56), new THREE.Vector2(0.0, 0.55)];
  const g = new THREE.LatheGeometry(pts, 24);
  const p = g.attributes.position as THREE.BufferAttribute;
  const c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const rr = Math.hypot(x, z);
    const a = Math.atan2(z, x);
    p.setY(i, y + (rr > 0.35 ? Math.sin(a * 7) * 0.05 * (rr - 0.35) * 5 : 0));
    const t = Math.min(1, y / 0.5);
    c[i * 3] = 0.7 + 0.3 * t; c[i * 3 + 1] = 0.7 + 0.3 * t; c[i * 3 + 2] = 0.6 + 0.3 * t;
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  return g;
}

function anemoneGeometry(): THREE.BufferGeometry {
  const r = mulberry32(21);
  const parts: THREE.BufferGeometry[] = [];
  const col = new THREE.CylinderGeometry(0.3, 0.34, 0.14, 14, 1);
  col.translate(0, 0.07, 0);
  parts.push(col);
  for (let i = 0; i < 150; i++) {
    const a = r() * Math.PI * 2;
    const rad = Math.sqrt(r()) * 0.33;
    const len = 0.16 + r() * 0.14;
    const t = new THREE.CylinderGeometry(0.004, 0.012, len, 4, 2, true);
    t.translate(0, len / 2, 0);
    const lean = new THREE.Quaternion().setFromEuler(new THREE.Euler((r() - 0.5) * 1.1 + Math.sin(a) * rad * 2, 0, -Math.cos(a) * rad * 2 + (r() - 0.5) * 0.6));
    t.applyQuaternion(lean);
    t.translate(Math.cos(a) * rad, 0.13, Math.sin(a) * rad);
    parts.push(t);
  }
  parts.forEach((p) => p.deleteAttribute('uv'));
  const g = mergeGeometries(parts.map((p) => p.toNonIndexed()))!;
  const pos = g.attributes.position as THREE.BufferAttribute;
  const c = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const tip = Math.min(1, Math.max(0, (y - 0.13) / 0.28));
    c[i * 3] = 0.45 + 0.55 * tip;
    c[i * 3 + 1] = 0.4 + 0.45 * tip * tip;
    c[i * 3 + 2] = 0.42 + 0.5 * tip;
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  g.computeVertexNormals();
  return g;
}

function bladeTuft(seed: number, count: number, height: number, width: number, segs: number, curve: number): THREE.BufferGeometry {
  const r = mulberry32(seed);
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < count; i++) {
    const h = height * (0.55 + r() * 0.6);
    const b = new THREE.PlaneGeometry(width * (0.7 + r() * 0.6), h, 1, segs);
    b.translate(0, h / 2, 0);
    const p = b.attributes.position as THREE.BufferAttribute;
    const bend = (r() - 0.5) * curve;
    for (let k = 0; k < p.count; k++) {
      const y = p.getY(k) / h;
      p.setZ(k, p.getZ(k) + y * y * bend * h);
      p.setX(k, p.getX(k) * (1 - y * 0.5));
    }
    b.rotateY(r() * Math.PI);
    b.translate((r() - 0.5) * 0.3, 0, (r() - 0.5) * 0.3);
    parts.push(b);
  }
  const g = mergeGeometries(parts)!;
  g.computeVertexNormals();
  return g;
}

function spongeGeometry(): THREE.BufferGeometry {
  const pts = [
    new THREE.Vector2(0.35, 0),
    new THREE.Vector2(0.5, 0.25),
    new THREE.Vector2(0.62, 0.7),
    new THREE.Vector2(0.66, 1.1),
    new THREE.Vector2(0.62, 1.3),
    new THREE.Vector2(0.52, 1.28),
    new THREE.Vector2(0.48, 0.9),
    new THREE.Vector2(0.3, 0.6),
  ];
  const g = new THREE.LatheGeometry(pts, 22);
  g.deleteAttribute('uv');
  return g;
}

function tubeWormCluster(seed: number): THREE.BufferGeometry {
  const r = mulberry32(seed);
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 18; i++) {
    const h = 0.6 + r() * 1.1;
    const t = new THREE.CylinderGeometry(0.035, 0.045, h, 6, 4, true);
    t.translate(0, h / 2, 0);
    const p = t.attributes.position as THREE.BufferAttribute;
    const bx = (r() - 0.5) * 0.4, bz = (r() - 0.5) * 0.4;
    for (let k = 0; k < p.count; k++) {
      const y = p.getY(k) / h;
      p.setX(k, p.getX(k) + bx * y * y);
      p.setZ(k, p.getZ(k) + bz * y * y);
    }
    const plume = new THREE.ConeGeometry(0.07, 0.22, 7, 1, true);
    plume.rotateX(Math.PI);
    plume.translate(bx, h + 0.08, bz);
    const ox = (r() - 0.5) * 0.7, oz = (r() - 0.5) * 0.7;
    t.translate(ox, 0, oz);
    plume.translate(ox, 0, oz);
    const tc = new Float32Array(p.count * 3);
    for (let k = 0; k < p.count; k++) { tc[k * 3] = 0.88; tc[k * 3 + 1] = 0.86; tc[k * 3 + 2] = 0.8; }
    t.setAttribute('color', new THREE.BufferAttribute(tc, 3));
    const pc = new Float32Array(plume.attributes.position.count * 3);
    for (let k = 0; k < plume.attributes.position.count; k++) { pc[k * 3] = 0.85; pc[k * 3 + 1] = 0.06; pc[k * 3 + 2] = 0.05; }
    plume.setAttribute('color', new THREE.BufferAttribute(pc, 3));
    t.deleteAttribute('uv');
    plume.deleteAttribute('uv');
    parts.push(t.toNonIndexed(), plume.toNonIndexed());
  }
  const g = mergeGeometries(parts)!;
  g.computeVertexNormals();
  return g;
}

function chimneyGeometry(seed: number, h: number): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 14; i++) {
    const t = i / 14;
    pts.push(new THREE.Vector2((1.6 - t * 1.1) * (1 + 0.25 * simplex2(t * 6, seed)), t * h));
  }
  pts.push(new THREE.Vector2(0.2, h));
  const g = new THREE.LatheGeometry(pts, 14);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = 1 + 0.22 * simplex2(Math.atan2(z, x) * 2 + seed, y * 0.6);
    p.setX(i, x * n);
    p.setZ(i, z * n);
  }
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  return g;
}

function archGeometry(): THREE.BufferGeometry {
  let g: THREE.BufferGeometry = new THREE.TorusGeometry(9, 3, 12, 30, Math.PI);
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  g = mergeVertices(g);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = 0.9 * fbm2(x * 0.25 + z * 0.2, y * 0.25, 3);
    const len = Math.hypot(x, y);
    p.setXYZ(i, x + (x / len) * n, y + (y / len) * n + 0.5 * simplex2(x, z), z * (1 + 0.3 * simplex2(x * 0.3, y * 0.3)));
  }
  g.computeVertexNormals();
  return g;
}

/** A sunken coastal freighter: hull plates, ribs, deck house, fallen mast. */
function wreckGroup(mat: THREE.Material, darkMat: THREE.Material): THREE.Group {
  const grp = new THREE.Group();
  const L = 34, W = 7.5, H = 5;
  // hull cross-section profile extruded along length with a pointed bow
  const segs = 28, ring = 14;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const z = (t - 0.5) * L;
    const bow = t > 0.78 ? 1 - ((t - 0.78) / 0.22) ** 1.6 : 1;
    const stern = t < 0.08 ? 0.75 + 0.25 * (t / 0.08) : 1;
    const w = (W / 2) * bow * stern;
    for (let j = 0; j <= ring; j++) {
      const a = (j / ring) * Math.PI; // 0..pi : starboard deck -> keel -> port deck
      const x = Math.cos(a) * w;
      let y = -(Math.sin(a) ** 0.7) * H + H * 0.15 + (t > 0.78 ? (t - 0.78) * 4 : 0);
      // collapsed section mid-ship
      if (t > 0.42 && t < 0.55 && j > ring * 0.6) y -= 1.6 * Math.sin(((t - 0.42) / 0.13) * Math.PI);
      pos.push(x + 0.15 * simplex2(i * 0.7, j * 0.9), y, z);
    }
  }
  for (let i = 0; i < segs; i++)
    for (let j = 0; j < ring; j++) {
      const a = i * (ring + 1) + j, b = a + ring + 1;
      if (i > 12 && i < 15 && j > 2 && j < 6) continue; // breach hole
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  const hull = new THREE.BufferGeometry();
  hull.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  hull.setIndex(idx);
  hull.computeVertexNormals();
  const hm = new THREE.Mesh(hull, mat);
  grp.add(hm);
  // ribs / deck beams
  for (let i = 2; i < segs - 4; i += 2) {
    const t = i / segs;
    const z = (t - 0.5) * L;
    const beam = new THREE.Mesh(new THREE.BoxGeometry(W * 0.92, 0.25, 0.3), darkMat);
    beam.position.set(0, H * 0.12, z);
    beam.rotation.z = (simplex2(i, 4) * 0.2);
    if (!(t > 0.42 && t < 0.55)) grp.add(beam);
  }
  // deck house
  const house = new THREE.Mesh(new THREE.BoxGeometry(5, 3.2, 6), mat);
  house.position.set(0.3, H * 0.15 + 1.5, -L * 0.28);
  house.rotation.z = 0.05;
  grp.add(house);
  for (let k = 0; k < 3; k++) {
    const win = new THREE.Mesh(new THREE.BoxGeometry(5.05, 0.6, 0.8), darkMat);
    win.position.set(0.3, H * 0.15 + 2.2, -L * 0.28 - 2 + k * 2);
    grp.add(win);
  }
  // fallen mast
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 14, 8), mat);
  mast.position.set(5.5, -2.2, 4);
  mast.rotation.set(0.15, 0, 1.25);
  grp.add(mast);
  return grp;
}

function boatGroup(): THREE.Group {
  const g = new THREE.Group();
  const shape = new THREE.Shape();
  shape.moveTo(-2, -6);
  shape.lineTo(2, -6);
  shape.lineTo(2.1, 2);
  shape.quadraticCurveTo(1.8, 5.2, 0, 7);
  shape.quadraticCurveTo(-1.8, 5.2, -2.1, 2);
  shape.lineTo(-2, -6);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 1.2, bevelEnabled: true, bevelThickness: 0.5, bevelSize: 0.45, bevelSegments: 3 });
  geo.rotateX(Math.PI / 2);
  geo.translate(0, 0.25, 0);
  const hullMat = new THREE.MeshStandardMaterial({ color: 0x2a3036, roughness: 0.6 });
  const hull = new THREE.Mesh(geo, hullMat);
  g.add(hull);
  const keel = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.6, 11), hullMat);
  keel.position.set(0, -1.5, 0.5);
  g.add(keel);
  const prop = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.08, 6, 12), new THREE.MeshStandardMaterial({ color: 0x8a7a50, metalness: 0.8, roughness: 0.35 }));
  prop.position.set(0, -1.2, -6.2);
  g.add(prop);
  // dive ladder
  const ladder = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.8, 0.06), new THREE.MeshStandardMaterial({ color: 0x9aa4aa, metalness: 0.9, roughness: 0.3 }));
  ladder.position.set(0, -1.2, -6.4);
  g.add(ladder);
  return g;
}

// ---------------------------------------------------------------- flora system

export type Homes = {
  anemones: THREE.Vector3[];
  crevices: THREE.Vector3[];
  creviceR: number[];
  reefSpots: THREE.Vector3[];
  rockSpots: THREE.Vector3[];
  /** top surface of branching coral heads (y = coral top) */
  coralTops: THREE.Vector3[];
  /** shaded space under table corals (y = mid-height under the plate) */
  underTables: THREE.Vector3[];
  /** points just off the drop-off wall face, with outward normal in w-less form */
  wallSpots: THREE.Vector3[];
  /** sand patches inside / beside the reef */
  sandSpots: THREE.Vector3[];
  /** seagrass meadow points */
  grassSpots: THREE.Vector3[];
  /** surfaces of coral colonies on the bommies */
  bommieSpots: THREE.Vector3[];
};

export class Flora {
  readonly group = new THREE.Group();
  private sets: ScatterSet[] = [];
  private mats: THREE.Material[] = [];
  readonly homes: Homes = { anemones: [], crevices: [], creviceR: [], reefSpots: [], rockSpots: [], coralTops: [], underTables: [], wallSpots: [], sandSpots: [], grassSpots: [], bommieSpots: [] };
  boat: THREE.Group;
  carpetCount = 0;
  private landmarks: THREE.Object3D[] = [];
  private smoke!: THREE.Points;
  private smokeData!: Float32Array;

  constructor() {
    const r = mulberry32(2024);

    // ---- materials
    const rockMat = underwaterMaterial(
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 }),
      {
        key: 'rock',
        pbr: { ...pbr().rock, scale: 0.42, k: 1.8, albedo: 1.0 },
        vertexHead: 'varying vec3 vObj;',
        vertexBody: 'vObj = position;',
        fragHead: 'varying vec3 vObj;',
        fragDiffuse: `{ float n = uwNoise( vUwPos * 0.7 ) * 0.6 + uwNoise( vUwPos * 2.3 ) * 0.4;
          float top = smoothstep( 0.2, 0.9, normalize( vUwNrm ).y );
          vec3 algae = vec3( 0.34, 0.42, 0.22 ) * ( 0.7 + n * 0.5 );
          diffuseColor.rgb = mix( diffuseColor.rgb * ( 0.75 + n * 0.5 ), algae, top * smoothstep( -45.0, -8.0, vUwPos.y ) * 0.55 );
          // encrusting coralline patches
          float cor = smoothstep( 0.62, 0.7, uwNoise( vUwPos * 1.3 + 9.0 ) ) * smoothstep( -60.0, -4.0, vUwPos.y );
          diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.55, 0.3, 0.38 ), cor * 0.45 ); }`,
      },
    );
    const coralMat = underwaterMaterial(
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82 }),
      {
        key: 'coral',
        tri: { tex: baked().polyp, scale: 6.0, strength: 1.3, albedo: 0.7 },
      },
    );
    const brainMat = underwaterMaterial(
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.75 }),
      {
        key: 'brain',
        tri: { tex: baked().brain, scale: 1.3, strength: 1.6, albedo: 0.9 },
      },
    );
    const plantMat = (key: string, tex: THREE.Texture, amt: number, rough = 0.7) =>
      underwaterMaterial(
        new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: rough, alphaTest: 0.35, transparent: false }),
        { key, vertexBody: SWAY_VERTEX.replace('SWAY_AMT', amt.toFixed(3)), caustic: 0.8 },
      );
    const grassMat = plantMat('grass', makeBlade('#3f5a1e', '#9fb04a'), 0.12);
    const kelpMat = plantMat('kelp', makeBlade('#4a3a14', '#a08a32'), 0.045);
    const fanMat = plantMat('fan', makeSeaFan('#c8463c'), 0.02);
    const fanMat2 = plantMat('fan2', makeSeaFan('#e9b44a'), 0.02);
    const anemoneMat = underwaterMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, emissive: 0x1a0a10 }), {
      key: 'anemone',
      vertexBody: SWAY_VERTEX.replace('SWAY_AMT', '1.6').replace('uTime * 1.1', 'uTime * 2.3'),
    });
    const spongeMat = underwaterMaterial(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, side: THREE.DoubleSide }), {
      key: 'sponge',
      vertexHead: 'varying vec3 vObj;',
      vertexBody: 'vObj = position;',
      fragHead: 'varying vec3 vObj;',
      fragBeforeLights: `{ float a = atan( vObj.z, vObj.x ); float rib = abs( sin( a * 11.0 ) ); normal = uwBump( normal, rib * 0.05 + uwNoise( vObj * 20.0 ) * 0.01 ); }`,
      fragDiffuse: `{ float a = atan( vObj.z, vObj.x ); diffuseColor.rgb *= 0.75 + 0.35 * abs( sin( a * 11.0 ) ); }`,
    });
    const tubeMat = underwaterMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, emissive: 0x220000, emissiveIntensity: 0.4 }), {
      key: 'tube',
      vertexBody: SWAY_VERTEX.replace('SWAY_AMT', '0.03'),
    });
    const chimneyMat = underwaterMaterial(
      new THREE.MeshStandardMaterial({ color: 0x3a3029, roughness: 0.97, emissive: 0x220800, emissiveIntensity: 0.2 }),
      {
        key: 'chimney',
        pbr: { ...pbr().rock, scale: 0.55, k: 2.0, albedo: 1.0 },
        vertexHead: 'varying vec3 vObj;',
        vertexBody: 'vObj = position;',
        fragHead: 'varying vec3 vObj;',
        fragDiffuse: `{ float s = uwNoise( vObj * 1.5 ); diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.75, 0.55, 0.25 ), smoothstep( 0.6, 0.8, s ) * 0.6 ); }`,
      },
    );
    const rustMat = underwaterMaterial(
      new THREE.MeshStandardMaterial({ color: 0xb89a84, roughness: 0.85, metalness: 0.15, side: THREE.DoubleSide }),
      {
        key: 'rust',
        pbr: { ...pbr().rust, scale: 0.35, k: 1.6, albedo: 1.0 },
        fragDiffuse: `{ float n = uwNoise( vUwPos * 0.9 );
          diffuseColor.rgb *= mix( vec3( 1.0, 0.82, 0.7 ), vec3( 0.62, 0.7, 0.55 ), smoothstep( 0.35, 0.75, n ) );
          float top = smoothstep( 0.3, 0.9, normalize( vUwNrm ).y );
          diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.5, 0.48, 0.4 ) * ( 0.8 + 0.4 * n ), top * 0.55 ); }`,
      },
    );
    const darkMat = underwaterMaterial(new THREE.MeshStandardMaterial({ color: 0x1a1612, roughness: 0.95 }), { key: 'dark' });
    this.mats.push(rockMat, coralMat, brainMat, grassMat, kelpMat, fanMat, fanMat2, anemoneMat, spongeMat, tubeMat, chimneyMat, rustMat, darkMat);

    // ---- scatter helpers
    const sample = (count: number, region: [number, number, number, number], ok: (x: number, z: number) => boolean, tries = 8) => {
      const out: [number, number][] = [];
      for (let i = 0; i < count * tries && out.length < count; i++) {
        const x = region[0] + r() * (region[1] - region[0]);
        const z = region[2] + r() * (region[3] - region[2]);
        if (ok(x, z)) out.push([x, z]);
      }
      return out;
    };
    const color = (h: number, s: number, l: number) => new THREE.Color().setHSL(h, s, l);
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, items: ScatterItem[], view = 58, cell = 40, hi?: THREE.BufferGeometry) => {
      if (!items.length) return;
      const set = new ScatterSet(geo, mat, items, view, cell, hi);
      this.sets.push(set);
      this.group.add(set.group);
    };
    const slopeAt = (x: number, z: number) => 1 - normalAt(x, z, _n).y;

    // ---- seagrass meadows (lagoon)
    const tuftG = bladeTuft(1, 7, 0.75, 0.07, 4, 0.5);
    const grass = sample(2600, [-200, 200, -60, 122], (x, z) => {
      if (Math.hypot(x - GARDEN_EEL_PATCH.x, z - GARDEN_EEL_PATCH.z) < GARDEN_EEL_PATCH.r + 6) return false;
      return fbm2(x * 0.025, z * 0.025, 3) > 0.05 && zoneAt(x, z) === 'lagoon';
    });
    this.homes.grassSpots.push(...grass.filter((_, i) => i % 12 === 0).map(([x, z]) => new THREE.Vector3(x, heightAt(x, z), z)));
    add(tuftG, grassMat, grass.map(([x, z]) => ({ m: placeMatrix(x, z, 0.8 + r() * 0.7, r, 0.5, 0.05), c: color(0.22 + r() * 0.05, 0.4, 0.4 + r() * 0.2) })), 45, 30);

    // ---- reef corals
    const reefOk = (x: number, z: number) => zoneAt(x, z) === 'reef' && slopeAt(x, z) < 0.55 && (bommieAt(x, z) > 0.9 || r() < 0.18);
    const brainG = domeColony(3, 12, 0.12, 1.4, 0.75);
    const brains = sample(420, [-200, 200, 120, 345], reefOk, 30);
    add(brainG, brainMat, brains.map(([x, z]) => {
      const c = [color(0.1, 0.35, 0.55), color(0.28, 0.3, 0.5), color(0.08, 0.45, 0.5), color(0.6, 0.2, 0.55)][Math.floor(r() * 4)];
      return { m: placeMatrix(x, z, 0.5 + r() * 1.1, r, 0.6, 0.15), c };
    }));
    const stagVariants = [branchingCoral(11, 3, 0.9, 0.03), branchingCoral(12, 3, 0.75, 0.026), corymboseCoral(13)];
    const coralPalette = [
      [0.08, 0.5, 0.42], // brown
      [0.82, 0.5, 0.5], // purple
      [0.56, 0.55, 0.55], // blue tip
      [0.16, 0.6, 0.5], // olive yellow
      [0.96, 0.62, 0.6], // pink
      [0.1, 0.45, 0.62], // cream
      [0.03, 0.65, 0.55], // orange-brown
    ];
    stagVariants.forEach((g, vi) => {
      g.computeBoundingBox();
      const topY = g.boundingBox!.max.y;
      const pts = sample(200, [-200, 200, 125, 345], reefOk, 30);
      add(g, coralMat, pts.map(([x, z]) => {
        const p = coralPalette[Math.floor(r() * coralPalette.length)];
        return { m: placeMatrix(x, z, vi === 2 ? 0.9 + r() * 1.2 : 0.55 + r() * 0.6, r, 0.3, 0.05), c: color(p[0], p[1], p[2]) };
      }));
      // dense coral heads on bommies (higher points)
      const heads = sample(60, [-200, 200, 130, 340], (x, z) => reefOk(x, z) && bommieAt(x, z) > 2.2 + vi * 0.3, 40);
      add(g, coralMat, heads.map(([x, z]) => {
        const p = coralPalette[Math.floor(r() * coralPalette.length)];
        const sc = vi === 2 ? 1.0 + r() * 1.2 : 0.7 + r() * 0.6;
        this.homes.coralTops.push(new THREE.Vector3(x, heightAt(x, z) + sc * topY * 0.95, z));
        return { m: placeMatrix(x, z, sc, r, 0.2, 0.05), c: color(p[0], p[1], p[2]) };
      }));
      this.homes.reefSpots.push(...heads.map(([x, z]) => new THREE.Vector3(x, heightAt(x, z), z)));
    });
    const tableG = tableCoral();
    const tables = sample(110, [-200, 200, 140, 340], reefOk, 30);
    add(tableG, coralMat, tables.map(([x, z]) => {
      const sc = 0.9 + r() * 1.4;
      this.homes.underTables.push(new THREE.Vector3(x, heightAt(x, z) + sc * 0.45, z));
      return { m: placeMatrix(x, z, sc, r, 0.1, 0), c: color(0.1 + r() * 0.1, 0.35, 0.55 + r() * 0.15) };
    }));
    // habitat anchors: sand patches between bommies, wall face, seagrass
    for (const [x, z] of sample(160, [-200, 200, 125, 350], (x, z) => (zoneAt(x, z) === 'reef' || zoneAt(x, z) === 'dropoff') && bommieAt(x, z) < 0.4 && slopeAt(x, z) < 0.2, 20))
      this.homes.sandSpots.push(new THREE.Vector3(x, heightAt(x, z), z));
    for (let i = 0; i < 140; i++) {
      const x = -190 + r() * 380;
      const zE = reefEdgeZ(x);
      const z = zE + 2 + r() * 12;
      const n = normalAt(x, z, new THREE.Vector3());
      const off = new THREE.Vector3(n.x, 0, n.z).normalize().multiplyScalar(1.5 + r() * 2);
      if (!isFinite(off.x)) off.set(0, 0, 1.5);
      this.homes.wallSpots.push(new THREE.Vector3(x + off.x, heightAt(x, z) + 1.5, z + off.z));
    }

    // ---- cauliflower (Pocillopora) bushes and leather corals fill the bommies
    const bushMat = underwaterMaterial(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 }), {
      key: 'bush',
      tri: { tex: baked().polyp, scale: 9.0, strength: 1.6, albedo: 0.8 },
      fragDiffuse: '{ float k = uwNoise( vUwPos * 14.0 ); diffuseColor.rgb *= 0.7 + 0.45 * k; }',
    });
    this.mats.push(bushMat);
    const bushG = domeColony(21, 9, 0.35, 3.2, 0.7);
    const bushes = sample(900, [-200, 200, 125, 345], reefOk, 30);
    add(bushG, bushMat, bushes.map(([x, z]) => {
      const p = coralPalette[Math.floor(r() * coralPalette.length)];
      return { m: placeMatrix(x, z, 0.2 + r() * 0.4, r, 0.5, 0.03), c: color(p[0], p[1] * 0.9, p[2] * 0.95) };
    }));
    // ---- dense coral carpet on the bommies (jittered grid, cheap meshes, culled per 40 m cell)
    {
      const carpetBush: ScatterItem[] = [];
      const carpetBrain: ScatterItem[] = [];
      const carpetStag: ScatterItem[] = [];
      const step = 1.5;
      for (let z = 128; z < 348; z += step) {
        for (let x = -198; x < 198; x += step) {
          const px = x + (r() - 0.5) * step, pz = z + (r() - 0.5) * step;
          if (zoneAt(px, pz) !== 'reef') continue;
          const bom = bommieAt(px, pz);
          if (bom < 0.7) continue;
          if (r() > Math.min(0.92, bom * 0.5)) {
            // a free patch of bommie surface between colonies: anchor for clams, sea stars, tube worms
            if (r() < 0.15) this.homes.bommieSpots.push(new THREE.Vector3(px, heightAt(px, pz) + 0.02, pz));
            continue;
          }
          const pc = coralPalette[Math.floor(r() * coralPalette.length)];
          const c = color(pc[0], pc[1] * 0.95, pc[2] * 0.9);
          const t = r();
          if (t < 0.5) carpetBush.push({ m: placeMatrix(px, pz, 0.25 + r() * 0.45, r, 0.7, 0.05), c });
          else if (t < 0.78) carpetBrain.push({ m: placeMatrix(px, pz, 0.3 + r() * 0.5, r, 0.8, 0.12), c });
          else carpetStag.push({ m: placeMatrix(px, pz, 0.35 + r() * 0.45, r, 0.4, 0.03), c });
        }
      }
      const smallBrain = domeColony(31, 9, 0.12, 1.4, 0.7);
      const smallStag = corymboseCoral(41);
      add(bushG, bushMat, carpetBush, 42, 32, cauliflowerColony(21));
      add(smallBrain, brainMat, carpetBrain, 42, 32, domeColony(31, 16, 0.1, 1.4, 0.7));
      // split the branching carpet: half digitate cushions, half foliose plates
      add(smallStag, coralMat, carpetStag.filter((_, i) => i % 2 === 0), 38, 48);
      add(plateColony(51), coralMat, carpetStag.filter((_, i) => i % 2 === 1), 38, 48);
      this.carpetCount = carpetBush.length + carpetBrain.length + carpetStag.length;
      // small colonies don't need to render into the sun shadow map
      for (const set of this.sets.slice(-4)) set.group.traverse((o) => { o.castShadow = false; });
    }
    const softMat = underwaterMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, side: THREE.DoubleSide }), {
      key: 'soft',
      vertexBody: SWAY_VERTEX.replace('SWAY_AMT', '0.12'),
      vertexHead: 'varying vec3 vObj;',
      fragHead: 'varying vec3 vObj;',
      fragDiffuse: '{ float pol = uwNoise( vUwPos * 30.0 ); diffuseColor.rgb *= 0.8 + 0.3 * pol; }',
    });
    this.mats.push(softMat);
    const leatherG = leatherCoral();
    const leathers = sample(160, [-200, 200, 125, 345], reefOk, 30);
    add(leatherG, softMat, leathers.map(([x, z]) => ({ m: placeMatrix(x, z, 0.5 + r() * 0.8, r, 0.5, 0.02), c: [color(0.15, 0.4, 0.62), color(0.12, 0.45, 0.5), color(0.3, 0.25, 0.55)][Math.floor(r() * 3)] })));

    // ---- sea fans on reef edge, wall, rocky zone
    const fanG = new THREE.PlaneGeometry(1.8, 1.8);
    fanG.translate(0, 0.88, 0);
    const fans = sample(260, [-200, 200, 150, 400], (x, z) => {
      const zn = zoneAt(x, z);
      return zn === 'dropoff' || (zn === 'rocky' && r() < 0.5) || (zn === 'reef' && z > reefEdgeZ(x) - 40);
    });
    const fanItems = fans.map(([x, z]) => ({ m: placeMatrix(x, z, 0.8 + r() * 1.5, r, 0.0, 0.05) }));
    add(fanG, fanMat, fanItems.filter((_, i) => i % 2 === 0));
    add(fanG, fanMat2, fanItems.filter((_, i) => i % 2 === 1));

    // ---- anemones (clownfish homes)
    const anG = anemoneGeometry();
    const anem = sample(28, [-150, 90, 150, 330], (x, z) => reefOk(x, z) && heightAt(x, z) > -12.5, 30);
    add(anG, anemoneMat, anem.map(([x, z]) => ({ m: placeMatrix(x, z, 1.1 + r() * 0.5, r, 0.8, 0), c: [color(0.9, 0.55, 0.62), color(0.06, 0.6, 0.66), color(0.78, 0.45, 0.62), color(0.22, 0.45, 0.6)][Math.floor(r() * 4)] })));
    this.homes.anemones = anem.map(([x, z]) => new THREE.Vector3(x, heightAt(x, z) + 0.45, z));

    // ---- rocks
    const rockGs = [rockGeometry(1, 3), rockGeometry(7, 3, 0.55), rockGeometry(13, 2, 0.85)];
    const rockRegions: [number, [number, number, number, number], (x: number, z: number) => boolean, number, number][] = [
      [380, [-10, 210, 30, 350], (x, z) => rockyWeight(x, z) > 0.35, 1.2, 4.2],
      [70, [-200, 200, 120, 345], (x, z) => zoneAt(x, z) === 'reef', 0.6, 2],
      [170, [-200, 200, 325, 400], (x, z) => zoneAt(x, z) === 'dropoff' || z > reefEdgeZ(x) - 6, 0.6, 2.6],
      [25, [-200, 200, -60, 120], (x, z) => zoneAt(x, z) === 'lagoon', 0.4, 1.2],
      [200, [-200, 200, 720, 1080], (x, z) => zoneAt(x, z) === 'deep', 1.2, 5],
    ];
    rockGs.forEach((g, gi) => {
      const items: ScatterItem[] = [];
      for (const [n, reg, ok, s0, s1] of rockRegions) {
        const pts = sample(Math.ceil(n / 3), reg, ok);
        for (const [x, z] of pts) {
          const s = s0 + r() * r() * (s1 - s0);
          const tone = 0.42 + r() * 0.25;
          items.push({ m: placeMatrix(x, z, new THREE.Vector3(s * (0.8 + r() * 0.5), s * (0.6 + r() * 0.5), s), r, 0.7, s * 0.25), c: new THREE.Color(tone, tone * 0.97, tone * 0.92) });
          if (reg[2] === 30) {
            if (s > 2.4) { this.homes.crevices.push(new THREE.Vector3(x, heightAt(x, z) + 0.3, z)); this.homes.creviceR.push(s); }
            this.homes.rockSpots.push(new THREE.Vector3(x, heightAt(x, z) + s * 0.6, z));
          }
        }
      }
      add(g, rockMat, items, 90, 60);
    });

    // ---- kelp / sargassum in rocky zone
    const kelpG = bladeTuft(5, 5, 2.4, 0.16, 7, 0.8);
    const kelp = sample(700, [0, 210, 40, 345], (x, z) => rockyWeight(x, z) > 0.5 && heightAt(x, z) > -22);
    add(kelpG, kelpMat, kelp.map(([x, z]) => ({ m: placeMatrix(x, z, 0.7 + r() * 0.8, r, 0.3, 0.1), c: color(0.12 + r() * 0.04, 0.5, 0.45 + r() * 0.15) })), 50, 30);

    // ---- sponges on wall/shelf/rocky
    const spG = spongeGeometry();
    const sponges = sample(110, [-200, 210, 150, 470], (x, z) => {
      const zn = zoneAt(x, z);
      return (zn === 'dropoff' || zn === 'rocky') && slopeAt(x, z) < 0.75;
    });
    add(spG, spongeMat, sponges.map(([x, z]) => ({ m: placeMatrix(x, z, 0.8 + r() * 1.4, r, 0.4, 0.1), c: [color(0.05, 0.5, 0.45), color(0.75, 0.3, 0.45), color(0.12, 0.6, 0.55)][Math.floor(r() * 3)] })));

    // ---- deep: hydrothermal vent field
    const tubes: ScatterItem[] = [];
    const tg = tubeWormCluster(4);
    for (let i = 0; i < 60; i++) {
      const a = r() * Math.PI * 2;
      const d = 4 + r() * 16;
      const x = VENT.x + Math.cos(a) * d, z = VENT.z + Math.sin(a) * d;
      tubes.push({ m: placeMatrix(x, z, 0.8 + r() * 0.8, r, 0.6, 0.1) });
    }
    add(tg, tubeMat, tubes, 60);
    const chimneyPos: THREE.Vector3[] = [];
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + r();
      const d = i === 0 ? 0 : 6 + r() * 9;
      const x = VENT.x + Math.cos(a) * d, z = VENT.z + Math.sin(a) * d;
      const h = i === 0 ? 14 : 5 + r() * 6;
      const m = new THREE.Mesh(chimneyGeometry(i * 3.1, h), chimneyMat);
      m.position.set(x, heightAt(x, z) - 0.5, z);
      this.group.add(m);
      this.landmarks.push(m);
      chimneyPos.push(new THREE.Vector3(x, heightAt(x, z) - 0.5 + h, z));
    }
    // black smoker plumes
    const SN = 260;
    this.smokeData = new Float32Array(SN * 4);
    const sp = new Float32Array(SN * 3);
    for (let i = 0; i < SN; i++) {
      const c = chimneyPos[i % chimneyPos.length];
      this.smokeData[i * 4] = c.x;
      this.smokeData[i * 4 + 1] = c.y;
      this.smokeData[i * 4 + 2] = c.z;
      this.smokeData[i * 4 + 3] = r() * 10;
    }
    const sgeo = new THREE.BufferGeometry();
    sgeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    sgeo.setAttribute('aOrigin', new THREE.BufferAttribute(this.smokeData, 4));
    const smokeMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uScale: { value: 400 } }]),
      vertexShader: /* glsl */ `attribute vec4 aOrigin; uniform float uTime; uniform float uScale; varying float vA;
        #include <fog_pars_vertex>
        void main(){ float t = mod(uTime*0.6 + aOrigin.w, 10.0);
          vec3 p = aOrigin.xyz + vec3(sin(t*1.3+aOrigin.w)*t*0.25, t*1.6, cos(t*1.1+aOrigin.w*2.0)*t*0.25);
          vec4 mvPosition = viewMatrix*vec4(p,1.0); vA = (1.0 - t/10.0) * smoothstep(0.0, 0.6, t);
          gl_PointSize = (0.6 + t*0.35) * uScale / max(-mvPosition.z, 0.5); gl_Position = projectionMatrix*mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `varying float vA;
        #include <fog_pars_fragment>
        void main(){ vec2 c = gl_PointCoord-0.5; float a = smoothstep(0.5,0.1,length(c))*vA*0.5; gl_FragColor = vec4(vec3(0.03,0.028,0.025), a);
          #include <fog_fragment>
        }`,
    });
    this.smoke = new THREE.Points(sgeo, smokeMat);
    this.smoke.frustumCulled = false;
    this.group.add(this.smoke);
    // vent glow (shimmering hot water hint)
    const glow = new THREE.PointLight(0xff7a30, 6, 22, 1.6);
    glow.position.set(VENT.x, heightAt(VENT.x, VENT.z) + 3, VENT.z);
    this.group.add(glow);
    this.landmarks.push(glow);

    // ---- landmarks: wreck, arch, boat, mooring lines
    const wreck = wreckGroup(rustMat, darkMat);
    wreck.position.set(WRECK.x, heightAt(WRECK.x, WRECK.z) + 2.2, WRECK.z);
    wreck.rotation.set(0.04, 0.6, 0.22);
    this.group.add(wreck);
    this.landmarks.push(wreck);
    const arch = new THREE.Mesh(archGeometry(), rockMat);
    arch.position.set(ARCH.x, heightAt(ARCH.x, ARCH.z) - 3, ARCH.z);
    this.group.add(arch);
    this.landmarks.push(arch);

    this.boat = boatGroup();
    this.group.add(this.boat);
    const lineMat = new THREE.MeshStandardMaterial({ color: 0xd8cfa8, roughness: 0.9 });
    const buoyMat = new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.5 });
    for (const dp of DIVE_POINTS) {
      if (dp.requires) continue;
      const bottom = heightAt(dp.x + 4, dp.z + 4);
      const len = Math.min(-bottom, 60);
      const line = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, len, 5), lineMat);
      line.position.set(dp.x + 4, -len / 2, dp.z + 4);
      this.group.add(line);
      const buoy = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 8), buoyMat);
      buoy.position.set(dp.x + 4, -0.1, dp.z + 4);
      this.group.add(buoy);
      if (len < 59) {
        const block = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.5, 0.8), darkMat);
        block.position.set(dp.x + 4, bottom + 0.2, dp.z + 4);
        this.group.add(block);
      }
    }
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && !(m as unknown as THREE.Points).isPoints) { if (m.userData.noCast !== true && m.castShadow !== false) m.castShadow = true; m.receiveShadow = true; }
    });
  }

  placeBoat(x: number, z: number): void {
    this.boat.position.set(x, 0, z);
    this.boat.rotation.y = 0.4;
  }

  update(cam: THREE.Vector3, time: number): void {
    for (const s of this.sets) s.update(cam.x, cam.y, cam.z);
    for (const l of this.landmarks) l.visible = l.position.distanceTo(cam) < 110;
    const nearVent = Math.hypot(cam.x - VENT.x, cam.z - VENT.z) < 120;
    this.smoke.visible = nearVent;
    if (nearVent) {
      const m = this.smoke.material as THREE.ShaderMaterial;
      m.uniforms.uTime.value = time;
      m.uniforms.uScale.value = innerHeight * 0.6;
    }
  }

  get instanceCount(): number {
    return this.sets.reduce((a, s) => a + s.count, 0);
  }
}
