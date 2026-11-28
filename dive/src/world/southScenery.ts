import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { DRIFTWOOD, estuaryCentreX, estuaryHalfWidth, estuaryU, heightAt, riverDist, riverWeight, zoneAt, type RiverInfo } from './layout';
import { mulberry32 } from '../utils/noise';

/**
 * Phase 9 S3 (PHASE9-DESIGN §2.4・§2.5・§3.1・§3.5): where the estuary's and the river's scenery stands and where
 * their animals will live. Pure placement data (deterministic, no rendering): flora.ts turns it into ScatterSets and
 * colliders, creatures.ts reads the `homes` lists. The terrain is not touched.
 */

export type XYZ = [number, number, number];
export type SouthHomeName = 'estChannel' | 'estFlat' | 'mangrove' | 'reed' | 'riverLow' | 'riverRiffle' | 'riverPool' | 'riverUp' | 'riverStones';
export const SOUTH_HOME_NAMES: SouthHomeName[] = ['estChannel', 'estFlat', 'mangrove', 'reed', 'riverLow', 'riverRiffle', 'riverPool', 'riverUp', 'riverStones'];
/** the target counts of the design tables (§2.5 / §3.5); reed = 100 (estuary) + 60 (river's lower reach). `riverSand` is the tenth list. */
export const SOUTH_HOME_TARGET: Record<SouthHomeName | 'riverSand', number> = {
  estChannel: 120, estFlat: 160, mangrove: 140, reed: 160, riverLow: 120, riverRiffle: 120, riverPool: 100, riverUp: 80, riverStones: 160, riverSand: 100,
};

export type Tree = { x: number; y: number; z: number; s: number; rot: number };
export type Reed = { x: number; z: number; y: number; h: number; w: number; rot: number };
export type Stone = { x: number; y: number; z: number; sx: number; sy: number; sz: number; rot: number; tone: number; solid: boolean; r: number };
export type Weed = { x: number; y: number; z: number; s: number; flow: number };
export type SouthPlan = {
  mangroves: Tree[];
  reeds: Reed[];
  /** matrices of driftwood logs (estuary piles and the river's lower reach) and their collision spheres */
  logs: { m: THREE.Matrix4; tone: number; spheres: { x: number; y: number; z: number; r: number }[] }[];
  boat: { m: THREE.Matrix4; spheres: { x: number; y: number; z: number; r: number }[] };
  stones: Stone[];
  boulders: Stone[];
  weeds: Weed[];
  /** F10 river-bed dressing (own RNG, so everything above and the homes are unchanged): cobble bands + bedrock slabs, sunken trees (3 shapes), leaf litter, plant colonies */
  cobbles: Stone[];
  trees: { m: THREE.Matrix4; tone: number }[][];
  leaves: { m: THREE.Matrix4; tone: number }[];
  plants: Weed[];
  homes: Record<SouthHomeName | 'riverSand', XYZ[]>;
};

const SURFACE_MAX = -0.9; // a home point must stand over a floor at least this deep (the design's "underwater" rule)

/** coarse spatial hash: has any point been taken within `d` of (x, z)? */
class Spacing {
  private g = new Map<string, [number, number][]>();
  constructor(private cell: number) {}
  private k(ix: number, iz: number) { return ix + ',' + iz; }
  near(x: number, z: number, d: number): boolean {
    const c = this.cell, ix = Math.floor(x / c), iz = Math.floor(z / c), n = Math.ceil(d / c);
    for (let a = -n; a <= n; a++) for (let b = -n; b <= n; b++) {
      const l = this.g.get(this.k(ix + a, iz + b));
      if (l) for (const [px, pz] of l) if (Math.hypot(px - x, pz - z) < d) return true;
    }
    return false;
  }
  add(x: number, z: number) {
    const k = this.k(Math.floor(x / this.cell), Math.floor(z / this.cell));
    let l = this.g.get(k);
    if (!l) this.g.set(k, (l = []));
    l.push([x, z]);
  }
}

export function planSouth(): SouthPlan {
  const r = mulberry32(9009);
  const rr = (a: number, b: number) => a + r() * (b - a);
  const homes = {} as Record<SouthHomeName | 'riverSand', XYZ[]>;
  for (const k of [...SOUTH_HOME_NAMES, 'riverSand'] as (SouthHomeName | 'riverSand')[]) homes[k] = [];
  const ri: RiverInfo = { d: 0, w: 0, D: 0, t: 0, tx: 0, tz: 0 };
  const river = (x: number, z: number) => riverDist(x, z, ri);
  // a point on the river water (riverWeight > 0.6) with its info, or null
  const riverPt = (tMin: number, tMax: number, dFrac: number, zA: number, zB: number): { x: number; z: number; h: number; w: number; d: number; t: number } | null => {
    for (let i = 0; i < 60; i++) {
      const x = rr(190, 350), z = rr(zA, zB);
      if (riverWeight(x, z) < 0.6) continue;
      river(x, z);
      if (ri.t < tMin || ri.t > tMax || ri.d > ri.w * dFrac) continue;
      return { x, z, h: heightAt(x, z), w: ri.w, d: ri.d, t: ri.t };
    }
    return null;
  };

  // ---- mangroves: west bank of the estuary, on the tidal flat (design §2.4: ~260)
  const mangroves: Tree[] = [];
  {
    const sp = new Spacing(6);
    for (let i = 0; i < 90000 && mangroves.length < 260; i++) {
      const x = rr(190, 410), z = rr(-262, -92);
      if (x > estuaryCentreX(z)) continue;
      const u = estuaryU(x, z);
      if (u < 0.55 || u > 0.95) continue;
      const h = heightAt(x, z);
      if (h > -0.95 || h < -1.4 || zoneAt(x, z) !== 'estuary') continue;
      if (sp.near(x, z, 3.4 + r() * 1.4)) continue;
      sp.add(x, z);
      mangroves.push({ x, z, y: h, s: rr(0.8, 1.35), rot: r() * Math.PI * 2 });
    }
  }

  // ---- reeds: east bank bundles (40 x 150) plus the river's lower reach (25 x 60)
  const reeds: Reed[] = [];
  const reedBundles: [number, number][] = [];
  const addReed = (cx: number, cz: number, n: number, rad: number, ok: (x: number, z: number, h: number) => boolean) => {
    let got = 0;
    for (let i = 0; i < n * 6 && got < n; i++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * rad;
      const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d, h = heightAt(x, z);
      if (!ok(x, z, h)) continue;
      const top = rr(1.5, 2.6);
      reeds.push({ x, z, y: h - 0.1, h: top - h + 0.1, w: rr(0.9, 1.5), rot: r() * Math.PI });
      got++;
    }
    return got;
  };
  {
    let bundles = 0;
    for (let i = 0; i < 4000 && bundles < 40; i++) {
      const x = rr(190, 410), z = rr(-300, -200);
      if (x < estuaryCentreX(z)) continue;
      const u = estuaryU(x, z);
      if (u < 0.6 || u > 0.92) continue;
      if (addReed(x, z, 150, 3.2, (px, pz, h) => h < 0.3 && h > -1.35 && estuaryU(px, pz) > 0.55 && estuaryU(px, pz) < 0.97 && px >= estuaryCentreX(pz)) > 60) { reedBundles.push([x, z]); bundles++; }
    }
    bundles = 0;
    for (let i = 0; i < 4000 && bundles < 25; i++) {
      const p = riverPt(0, 0.33, 1.0, -420, -302);
      if (!p || p.d < p.w * 0.72) continue; // the bank side
      if (addReed(p.x, p.z, 60, 2.4, (px, pz, h) => { if (h > 0.4 || h < -1.4 || riverWeight(px, pz) < 0.05) return false; river(px, pz); return ri.t < 0.35 && ri.d > ri.w * 0.7; }) > 25) { reedBundles.push([p.x, p.z]); bundles++; }
    }
  }

  // ---- driftwood: 12 piles in the estuary channel (the pits of layout's DRIFTWOOD) and 8 on the river's lower reach
  const logs: SouthPlan['logs'] = [];
  const logAt = (x: number, z: number, len: number) => {
    const h = heightAt(x, z), s = rr(0.7, 1.15) * len;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rr(-0.12, 0.12), r() * Math.PI * 2, rr(-0.2, 0.2), 'YXZ'));
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, h + 0.12 * s, z), q, new THREE.Vector3(s, s, s));
    const spheres = [-1.4, 0, 1.4].map((a) => { const v = new THREE.Vector3(a, 0, 0).applyMatrix4(m); return { x: v.x, y: v.y, z: v.z, r: 0.42 * s }; });
    logs.push({ m, tone: rr(0.8, 1.15), spheres });
  };
  const piles: [number, number][] = [];
  for (const p of DRIFTWOOD) {
    const cx = estuaryCentreX(p.z) + p.dx;
    piles.push([cx, p.z]);
    const n = 3 + Math.floor(r() * 3);
    for (let i = 0; i < n; i++) { const a = r() * Math.PI * 2, d = r() * p.r * 0.55; logAt(cx + Math.cos(a) * d, p.z + Math.sin(a) * d, 1); }
  }
  const riverPiles: [number, number][] = [];
  for (let i = 0; i < 400 && riverPiles.length < 8; i++) {
    const p = riverPt(0.02, 0.33, 0.55, -415, -306);
    if (!p || p.h > -2.4 || riverPiles.some(([qx, qz]) => Math.hypot(qx - p.x, qz - p.z) < 9)) continue;
    if (Math.hypot(p.x - 300, p.z + 340) < 8) continue; // keep the dive point clear
    riverPiles.push([p.x, p.z]);
    const n = 2 + Math.floor(r() * 3);
    for (let k = 0; k < n; k++) { const a = r() * Math.PI * 2, d = r() * 2; logAt(p.x + Math.cos(a) * d, p.z + Math.sin(a) * d, 0.9); }
  }
  piles.push(...riverPiles);

  // ---- the sunken boat on the lower river's pool bed, off the dive point's line
  let boat: SouthPlan['boat'];
  {
    const bx = 279, bz = -372, h = heightAt(bx, bz);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.05, 0.9, 0.28, 'YXZ'));
    const m = new THREE.Matrix4().compose(new THREE.Vector3(bx, h + 0.1, bz), q, new THREE.Vector3(1, 1, 1));
    const spheres = [-1.5, 0, 1.5].map((a) => { const v = new THREE.Vector3(0, 0.25, a).applyMatrix4(m); return { x: v.x, y: v.y, z: v.z, r: 0.6 }; });
    boat = { m, spheres };
    piles.push([bx, bz]);
  }

  // ---- stones (middle reach, 0.3–1.2 m; denser in the shallow riffles) and boulders (upper reach, 1.5–4 m)
  const stones: Stone[] = [], boulders: Stone[] = [];
  const mkStone = (p: { x: number; z: number; h: number; w: number; d: number }, s: number, sink: number, solid: boolean): Stone => ({
    x: p.x, z: p.z, y: p.h - s * sink, sx: s * rr(0.85, 1.3), sy: s * rr(0.6, 1.0), sz: s * rr(0.85, 1.25), rot: r() * Math.PI * 2, tone: rr(0.42, 0.7), solid, r: s,
  });
  for (let i = 0; i < 6000 && stones.length < 400; i++) {
    const p = riverPt(0.35, 0.78, 0.97, -580, -405);
    if (!p || p.h > -0.95) continue;
    if (r() > Math.min(1, 1.8 / -p.h) * 0.9) continue; // shallow riffle: more stones
    const s = 0.3 + r() * r() * 0.9;
    const solid = s > 0.6 && p.d > p.w * 0.3 + s;
    stones.push(mkStone(p, s, 0.22, solid));
  }
  for (let i = 0; i < 9000 && boulders.length < 60; i++) {
    const p = riverPt(0.6, 1, 1.0, -640, -520);
    if (!p || p.h > -1.2) continue;
    const s = 1.5 + r() * r() * 2.5;
    if (p.d - s * 1.25 < p.w * 0.3) continue; // keep a swimmable lane along the centre line
    if (p.d > p.w * 0.97) continue;
    boulders.push(mkStone(p, s, 0.3, true));
  }

  // ---- water weeds on the middle reach, leaning with the current (flow = downstream angle)
  const weeds: Weed[] = [];
  for (let i = 0; i < 9000 && weeds.length < 500; i++) {
    const p = riverPt(0.33, 0.8, 0.9, -590, -400);
    if (!p || p.h > -0.95 || p.h < -2.8) continue;
    river(p.x, p.z);
    weeds.push({ x: p.x, y: p.h - 0.05, z: p.z, s: rr(0.6, 1.2), flow: Math.atan2(ri.tx, ri.tz) });
  }

  // ---------------------------------------------------------------- homes (§2.5・§3.5)
  const put = (name: SouthHomeName | 'riverSand', x: number, y: number, z: number, zone: 'estuary' | 'river'): boolean => {
    const h = heightAt(x, z);
    if (h > SURFACE_MAX || y < h || y > -0.3 || zoneAt(x, z) !== zone) return false;
    homes[name].push([x, y, z]);
    return true;
  };
  const fill = (name: SouthHomeName | 'riverSand', n: number, gen: () => void) => { for (let i = 0; i < n * 80 && homes[name].length < n; i++) gen(); };

  // estChannel: channel floor + 1–3 m, half of them by the driftwood piles
  fill('estChannel', 120, () => {
    if (homes.estChannel.length < 60) {
      const p = DRIFTWOOD[Math.floor(r() * DRIFTWOOD.length)];
      const a = r() * Math.PI * 2, d = 1 + r() * (p.r + 2);
      const x = estuaryCentreX(p.z) + p.dx + Math.cos(a) * d, z = p.z + Math.sin(a) * d;
      put('estChannel', x, heightAt(x, z) + rr(0.5, 1.8), z, 'estuary');
    } else {
      const z = rr(-290, -90), x = estuaryCentreX(z) + rr(-0.26, 0.26) * estuaryHalfWidth(z);
      put('estChannel', x, heightAt(x, z) + rr(1, 3), z, 'estuary');
    }
  });
  // estFlat: the flat and its slope, 0.1–0.5 m over the floor
  fill('estFlat', 160, () => {
    const z = rr(-285, -85), W = estuaryHalfWidth(z), x = estuaryCentreX(z) + (r() < 0.5 ? -1 : 1) * rr(0.3, 0.9) * W;
    put('estFlat', x, heightAt(x, z) + rr(0.1, 0.5), z, 'estuary');
  });
  // mangrove: between the prop roots
  fill('mangrove', 140, () => {
    const t = mangroves[Math.floor(r() * mangroves.length)];
    if (!t) return;
    const a = r() * Math.PI * 2, d = rr(0.6, 1.5) * t.s;
    const x = t.x + Math.cos(a) * d, z = t.z + Math.sin(a) * d;
    put('mangrove', x, heightAt(x, z) + rr(0.35, 1.0), z, 'estuary');
  });
  // reed: the water's edge in the bundles (100 estuary, 60 river)
  const estReed = reedBundles.filter(([x, z]) => z > -301 && zoneAt(x, z) === 'estuary');
  const rivReed = reedBundles.filter(([x, z]) => zoneAt(x, z) === 'river' || riverWeight(x, z) > 0);
  const reedAt = (b: [number, number][], zone: 'estuary' | 'river', n: number, base: number) => {
    if (!b.length) return;
    for (let i = 0; i < n * 80 && homes.reed.length < base + n; i++) {
      const [cx, cz] = b[Math.floor(r() * b.length)];
      const a = r() * Math.PI * 2, d = rr(0.5, 3.5);
      const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
      put('reed', x, heightAt(x, z) + rr(0.2, 0.8), z, zone);
    }
  };
  reedAt(estReed, 'estuary', 100, 0);
  reedAt(rivReed, 'river', 60, homes.reed.length);

  // river reaches
  const riverZone = (x: number, z: number) => { river(x, z); return { t: ri.t, d: ri.d, w: ri.w }; };
  // riverLow: lower reach pools, near logs / reeds / the boat first
  fill('riverLow', 120, () => {
    if (homes.riverLow.length < 60 && piles.length + reedBundles.length) {
      const pool = [...riverPiles, ...rivReed, piles[piles.length - 1]];
      const [cx, cz] = pool[Math.floor(r() * pool.length)];
      const a = r() * Math.PI * 2, d = rr(0.5, 3);
      const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
      if (riverZone(x, z).t < 0.35) put('riverLow', x, heightAt(x, z) + rr(0.5, 2), z, 'river');
    } else {
      const p = riverPt(0.02, 0.34, 0.85, -418, -304);
      if (p) put('riverLow', p.x, p.h + rr(0.5, 2), p.z, 'river');
    }
  });
  // riverRiffle: on the stones of the shallow runs (floor 1.2–2.5 m deep)
  fill('riverRiffle', 120, () => {
    const s = stones[Math.floor(r() * stones.length)];
    if (!s) return;
    const h = heightAt(s.x, s.z);
    if (h > -1.2 || h < -2.5) return;
    put('riverRiffle', s.x + rr(-0.3, 0.3), s.y + s.sy * 0.9 + 0.15, s.z + rr(-0.3, 0.3), 'river');
  });
  // riverPool: mid-water over the deep pools (floor 3–5.5 m)
  fill('riverPool', 100, () => {
    const p = riverPt(0.35, 0.76, 0.8, -580, -405);
    if (p && p.h <= -3 && p.h >= -5.6) put('riverPool', p.x, p.h * rr(0.35, 0.7), p.z, 'river');
  });
  // riverUp: in the shade of the big rocks and over the plunge pool
  fill('riverUp', 80, () => {
    if (homes.riverUp.length < 50 && boulders.length) {
      const b = boulders[Math.floor(r() * boulders.length)];
      const a = r() * Math.PI * 2, d = b.r * rr(0.8, 1.3);
      const x = b.x + Math.cos(a) * d, z = b.z + Math.sin(a) * d;
      put('riverUp', x, heightAt(x, z) + rr(0.3, 1.5), z, 'river');
    } else {
      const p = riverPt(0.8, 1, 0.9, -640, -590);
      if (p && p.h < -3.5) put('riverUp', p.x, p.h + rr(0.5, 3), p.z, 'river');
    }
  });
  // riverStones: the gaps under stones and boulders
  fill('riverStones', 160, () => {
    const pool = r() < 0.65 ? stones : boulders;
    const s = pool[Math.floor(r() * pool.length)];
    if (!s) return;
    const a = r() * Math.PI * 2, d = s.r * rr(0.5, 0.9);
    const x = s.x + Math.cos(a) * d, z = s.z + Math.sin(a) * d;
    put('riverStones', x, heightAt(x, z) + rr(0.08, 0.3), z, 'river');
  });
  // riverSand: open sand of the lower and middle reaches, away from stones
  const stoneSp = new Spacing(4);
  for (const s of [...stones, ...boulders]) stoneSp.add(s.x, s.z);
  fill('riverSand', 100, () => {
    const p = riverPt(0.02, 0.74, 0.85, -570, -304);
    if (p && p.h < -1.2 && !stoneSp.near(p.x, p.z, 2.5)) put('riverSand', p.x, p.h + rr(0.1, 0.35), p.z, 'river');
  });

  const bed = planRiverBed();
  return { mangroves, reeds, logs, boat, stones, boulders, weeds, cobbles: bed.cobbles, trees: bed.trees, leaves: bed.leaves, plants: bed.plants, homes };
}

/**
 * F10: less bare sand on the river floor. (1) bands of cobbles (玉石) in the shallow runs and flat bedrock slabs,
 * (2) sunken trees of three shapes, (3) leaf litter on the pools' floors, (4) plant colonies where the water is slow.
 * Uses its own RNG and never touches the height field.
 */
function planRiverBed() {
  const r = mulberry32(10101);
  const rr = (a: number, b: number) => a + r() * (b - a);
  const ri: RiverInfo = { d: 0, w: 0, D: 0, t: 0, tx: 0, tz: 0 };
  type P = { x: number; z: number; h: number; w: number; d: number; t: number; D: number };
  const pick = (tMin: number, tMax: number, dFrac: number, zA: number, zB: number, ok?: (p: P) => boolean): P | null => {
    for (let i = 0; i < 80; i++) {
      const x = rr(190, 350), z = rr(zA, zB);
      if (riverWeight(x, z) < 0.6) continue;
      riverDist(x, z, ri);
      if (ri.t < tMin || ri.t > tMax || ri.d > ri.w * dFrac) continue;
      const p = { x, z, h: heightAt(x, z), w: ri.w, d: ri.d, t: ri.t, D: ri.D };
      if (p.h > -0.9) continue;
      if (!ok || ok(p)) return p;
    }
    return null;
  };
  const clear = (p: P) => Math.hypot(p.x - 300, p.z + 340) > 7; // keep the dive point's landing clear
  // (1) cobble bands: clusters in the shallow runs (floor 0.9–3 m), plus a few big round stones
  const cobbles: Stone[] = [];
  const mk = (x: number, z: number, s: number, flat: number, tone: number): Stone => ({ x, z, y: heightAt(x, z) - s * 0.3, sx: s * rr(0.9, 1.3), sy: s * flat * rr(0.8, 1.1), sz: s * rr(0.9, 1.3), rot: r() * 6.28, tone, solid: false, r: s });
  for (let c = 0; c < 40; c++) {
    const p = pick(0.05, 0.95, 0.95, -620, -310, (q) => q.h > -3.2 && clear(q));
    if (!p) continue;
    const rad = rr(3.5, 7), n = Math.round(rr(18, 30));
    for (let i = 0; i < n; i++) {
      const a = r() * 6.28, d = Math.sqrt(r()) * rad, x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d;
      if (riverWeight(x, z) < 0.6 || heightAt(x, z) > -0.9) continue;
      cobbles.push(mk(x, z, r() < 0.12 ? rr(0.45, 0.8) : rr(0.12, 0.4), 0.7, rr(0.45, 0.78)));
    }
  }
  // bedrock showing through: wide flat pale slabs
  for (let c = 0, got = 0; c < 400 && got < 45; c++) {
    const p = pick(0.3, 1, 0.9, -640, -420, (q) => q.h > -3 && clear(q));
    if (!p) continue;
    const s = rr(1.3, 3), sl = mk(p.x, p.z, s, 0.16, rr(0.62, 0.8));
    sl.y = p.h - s * 0.1;
    cobbles.push(sl); got++;
  }
  // (2) sunken trees: 3 shapes (long forked / thin with branches / root-ball stump), mostly in the middle and lower reach
  const trees: { m: THREE.Matrix4; tone: number }[][] = [[], [], []];
  const want = [6, 5, 4];
  for (let k = 0; k < 3; k++) for (let c = 0; c < 300 && trees[k].length < want[k]; c++) {
    const p = pick(0.08, 0.8, 0.8, -580, -320, (q) => q.h < -1.3 && q.h > -5 && clear(q));
    if (!p) continue;
    const s = rr(0.8, 1.2);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rr(-0.1, 0.1), r() * 6.28, rr(-0.18, 0.18), 'YXZ'));
    trees[k].push({ m: new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.h + 0.12 * s, p.z), q, new THREE.Vector3(s, s, s)), tone: rr(0.8, 1.15) });
  }
  // (3) leaf litter on the pools' floors (floor >= 3 m)
  const leaves: { m: THREE.Matrix4; tone: number }[] = [];
  for (let c = 0; c < 60 && leaves.length < 24; c++) {
    const p = pick(0.05, 0.97, 0.85, -640, -310, (q) => q.h < -3 && clear(q));
    if (!p) continue;
    for (let i = 0, n = 1 + Math.floor(r() * 3); i < n; i++) {
      const x = p.x + rr(-2.5, 2.5), z = p.z + rr(-2.5, 2.5), h = heightAt(x, z);
      if (riverWeight(x, z) < 0.6 || h > -2.6) continue;
      const s = rr(0.9, 1.6);
      leaves.push({ m: new THREE.Matrix4().compose(new THREE.Vector3(x, h + 0.04, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * 6.28), new THREE.Vector3(s, 1, s)), tone: rr(0.75, 1.2) });
    }
  }
  // (4) plant colonies where the flow is slow (v = 0.35 * 3.5 / D < 0.3 m/s, i.e. pools D > 4)
  const plants: Weed[] = [];
  for (let c = 0; c < 60 && plants.length < 330; c++) {
    const p = pick(0.05, 0.97, 0.7, -640, -310, (q) => q.D > 4 && q.h < -1.6 && q.h > -5 && clear(q));
    if (!p) continue;
    riverDist(p.x, p.z, ri);
    const flow = Math.atan2(ri.tx, ri.tz);
    for (let i = 0, n = Math.round(rr(10, 18)); i < n; i++) {
      const x = p.x + rr(-2.2, 2.2), z = p.z + rr(-2.2, 2.2), h = heightAt(x, z);
      if (riverWeight(x, z) < 0.6 || h > -1.4) continue;
      plants.push({ x, y: h - 0.05, z, s: rr(0.7, 1.4), flow });
    }
  }
  return { cobbles, trees, leaves, plants };
}

// ---------------------------------------------------------------- geometry

const paint = (g: THREE.BufferGeometry, f: (x: number, y: number, z: number) => [number, number, number]): THREE.BufferGeometry => {
  const p = g.attributes.position as THREE.BufferAttribute;
  const c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) { const col = f(p.getX(i), p.getY(i), p.getZ(i)); c[i * 3] = col[0]; c[i * 3 + 1] = col[1]; c[i * 3 + 2] = col[2]; }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  g.deleteAttribute('uv');
  return g;
};
const tri = (g: THREE.BufferGeometry) => (g.index ? g.index.count : g.attributes.position.count) / 3;

/**
 * A red-mangrove-like tree (ヤエヤマヒルギ風), base at y = 0: trunk 3 m tall (the top stands 2 m out of the water) and
 * 10 arching prop roots, 6-sided tubes (L0, ~544 triangles). L1 (far): 4 roots, 4-sided (~80). Vertex colours: brown, an
 * algae-green foot, and an off-white oyster band on 30% of the roots.
 */
export function mangroveGeometry(lod: 0 | 1): THREE.BufferGeometry {
  const r = mulberry32(lod ? 5 : 3);
  const parts: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(0.16, 0.22, 3, lod ? 4 : 8, lod ? 2 : 4, false);
  trunk.translate(0, 1.5, 0);
  parts.push(paint(trunk, (_x, y) => [0.34 - y * 0.02, 0.24 - y * 0.015, 0.16]));
  const n = lod ? 4 : 10;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + r() * 0.5;
    const out = 1.2 + r() * 0.7, y0 = 1.3 + r() * 0.5;
    const ca = Math.cos(a), sa = Math.sin(a);
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(ca * 0.1, y0, sa * 0.1),
      new THREE.Vector3(ca * out * 0.35, y0 - 0.25, sa * out * 0.35),
      new THREE.Vector3(ca * out * 0.75, y0 - 0.85, sa * out * 0.75),
      new THREE.Vector3(ca * out, -0.3, sa * out),
    ]);
    const root = new THREE.TubeGeometry(curve, lod ? 2 : 4, lod ? 0.07 : 0.055, lod ? 4 : 6, false);
    const oyster = r() < 0.3;
    parts.push(paint(root, (_x, y) => {
      if (y < 0.45) return [0.3, 0.4, 0.2];
      if (oyster && y < 1.25) return [0.72, 0.7, 0.64];
      return [0.3, 0.21, 0.14];
    }));
  }
  return mergeGeometries(parts)!;
}

/** A driftwood log lying along +x (4 m, ~0.28 m radius) with two broken branch stubs: ~110 triangles. Vertex-coloured grey-brown. */
export function driftwoodGeometry(): THREE.BufferGeometry {
  const log = new THREE.CylinderGeometry(0.24, 0.3, 4, 8, 4, false);
  log.rotateZ(Math.PI / 2);
  const parts: THREE.BufferGeometry[] = [paint(log, (x) => [0.3 - Math.abs(x) * 0.02, 0.24 - Math.abs(x) * 0.015, 0.18])];
  for (const [x, tilt, dir] of [[0.5, 0.9, 1], [-0.9, 1.0, -1]] as const) {
    const b = new THREE.CylinderGeometry(0.05, 0.1, 1.1, 5, 1, false);
    b.translate(0, 0.55, 0);
    b.rotateZ(-tilt * dir);
    b.rotateX(dir * 0.35);
    b.translate(x, 0.1, 0);
    parts.push(paint(b, () => [0.27, 0.21, 0.16]));
  }
  return mergeGeometries(parts)!;
}

/** The old wooden rowboat, ~4.4 m long (along z), sunk: bottom, two flared sides, a stem post, two thwarts. ~120 triangles. */
export function sunkenBoatGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, rz = 0, rx = 0, col: XYZ = [0.3, 0.22, 0.15]) => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.rotateZ(rz); g.rotateX(rx);
    g.translate(x, y, z);
    const ng = g.toNonIndexed();
    parts.push(paint(ng, (_x, y2) => [col[0] * (0.85 + y2 * 0.2), col[1] * (0.85 + y2 * 0.2), col[2]]));
  };
  box(0.95, 0.07, 4.2, 0, 0.04, 0);
  box(0.06, 0.55, 4.0, 0.58, 0.32, 0, -0.38);
  box(0.06, 0.55, 4.0, -0.58, 0.32, 0, 0.38);
  box(0.9, 0.55, 0.07, 0, 0.35, 2.05, 0, -0.35, [0.27, 0.2, 0.14]);
  box(1.0, 0.05, 0.28, 0, 0.5, 0.5, 0, 0, [0.36, 0.27, 0.18]);
  box(1.0, 0.05, 0.28, 0, 0.5, -0.8, 0, 0, [0.36, 0.27, 0.18]);
  return mergeGeometries(parts)!;
}

/** A reed: two crossed tapered strips, 1 m tall, 0.2 m wide (keeps uv for the blade texture): 8 triangles */
export function reedGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const rot of [0, Math.PI / 2]) {
    const g = new THREE.PlaneGeometry(0.2, 1, 1, 2);
    g.translate(0, 0.5, 0);
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) { const y = p.getY(i); p.setX(i, p.getX(i) * (1 - y * 0.65)); p.setZ(i, p.getZ(i) + y * y * 0.12); }
    g.rotateY(rot);
    parts.push(g);
  }
  const g = mergeGeometries(parts)!;
  g.computeVertexNormals();
  return g;
}

/** limb from a to b (tapered, 5-sided), vertex-coloured bark */
function limb(a: XYZ, b: XYZ, r0: number, r1: number, col: XYZ): THREE.BufferGeometry {
  const v = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const g = new THREE.CylinderGeometry(r1, r0, v.length(), 5, 1, false);
  g.translate(0, v.length() / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), v.normalize()));
  g.translate(a[0], a[1], a[2]);
  return paint(g.toNonIndexed(), (_x, y) => [col[0] * (0.9 + y * 0.1), col[1] * (0.9 + y * 0.1), col[2]]);
}
/** F10 sunken trees (along +x, ~4–5 m, base at y 0): 0 = trunk with 4 branches, 1 = thin forked trunk, 2 = root-ball stump with up-turned roots. 90–230 triangles. */
export function sunkenTreeGeometry(kind: 0 | 1 | 2): THREE.BufferGeometry {
  const bark: XYZ = [0.3, 0.23, 0.17], wet: XYZ = [0.26, 0.24, 0.18];
  const p: THREE.BufferGeometry[] = [];
  if (kind === 0) {
    p.push(limb([-2.4, 0.3, 0], [2.4, 0.2, 0], 0.32, 0.12, bark));
    for (const [x, up, side, len] of [[-1.2, 0.9, 0.5, 1.5], [-0.2, 1.1, -0.4, 1.3], [0.9, 0.9, 0.6, 1.1], [1.6, 0.6, -0.4, 0.8]] as const)
      p.push(limb([x, 0.28, 0], [x + 0.45, 0.28 + up * len * 0.7, side * len * 0.7], 0.07, 0.03, wet));
  } else if (kind === 1) {
    p.push(limb([-2.0, 0.2, 0], [0.4, 0.45, 0], 0.18, 0.1, wet));
    p.push(limb([0.4, 0.45, 0], [2.4, 0.9, 0.7], 0.1, 0.04, bark));
    p.push(limb([0.4, 0.45, 0], [2.0, 0.4, -0.9], 0.1, 0.04, bark));
    p.push(limb([-0.8, 0.3, 0], [-0.4, 1.1, 0.5], 0.06, 0.02, wet));
    p.push(limb([1.4, 0.7, 0.4], [1.9, 1.3, 0.6], 0.04, 0.015, wet));
  } else {
    const ball = new THREE.IcosahedronGeometry(0.55, 0);
    ball.scale(1, 0.75, 1); ball.translate(-1.6, 0.4, 0);
    p.push(paint(ball.toNonIndexed(), () => [0.27, 0.2, 0.15]));
    p.push(limb([-1.4, 0.4, 0], [1.4, 0.25, 0.1], 0.24, 0.12, bark));
    for (let i = 0; i < 6; i++) { const a = (i / 6) * 6.28 + 0.4; p.push(limb([-1.6, 0.45, 0], [-1.6 - Math.cos(a) * 0.9, 0.5 + Math.abs(Math.sin(a)) * 0.9 + 0.4, Math.sin(a) * 0.9], 0.09, 0.02, wet)); }
  }
  return mergeGeometries(p)!;
}

/** F10 leaf litter: a 1.2 m patch of ~26 small tilted leaves, ochre / brown / olive vertex colours: ~52 triangles, lying at y 0 */
export function leafLitterGeometry(): THREE.BufferGeometry {
  const r = mulberry32(77);
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 26; i++) {
    const g = new THREE.PlaneGeometry(0.13 + r() * 0.1, 0.07 + r() * 0.05);
    g.rotateX(-Math.PI / 2 + (r() - 0.5) * 0.5);
    g.rotateY(r() * 6.28);
    const a = r() * 6.28, d = Math.sqrt(r()) * 0.6;
    g.translate(Math.cos(a) * d, 0.01 + r() * 0.05, Math.sin(a) * d);
    const t = r(), col: XYZ = t < 0.4 ? [0.42, 0.3, 0.12] : t < 0.75 ? [0.3, 0.2, 0.1] : [0.27, 0.3, 0.12];
    parts.push(paint(g.toNonIndexed(), () => col));
  }
  const g = mergeGeometries(parts)!;
  g.computeVertexNormals();
  return g;
}

export const SOUTH_TRIS = { mangroveL0: () => tri(mangroveGeometry(0)), mangroveL1: () => tri(mangroveGeometry(1)), log: () => tri(driftwoodGeometry()), boat: () => tri(sunkenBoatGeometry()), reed: () => tri(reedGeometry()) };
