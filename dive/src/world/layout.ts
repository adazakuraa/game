import { clamp, fbm2, lerp, ridged2, simplex2, smoothstep } from '../utils/noise';

// World axes: y up (surface y=0), z increases offshore, x along the shore.
export const WORLD = { minX: -430, maxX: 430, minZ: -70, maxZ: 1080 };

export type ZoneId = 'lagoon' | 'reef' | 'rocky' | 'dropoff' | 'offshore' | 'deep' | 'cold' | 'ruins' | 'bluehole' | 'cave' | 'kelp';

export const ZONE_NAMES: Record<ZoneId, string> = {
  lagoon: '浅瀬ラグーン',
  reef: 'サンゴ礁',
  rocky: '岩礁',
  dropoff: 'ドロップオフ',
  offshore: '沖の大海原',
  deep: '深海',
  cold: '流氷の入り江',
  ruins: '海底遺跡',
  bluehole: 'ブルーホール',
  cave: '水中洞窟',
  kelp: '海藻の森',
};

export const VENT = { x: 28, z: 965 };
export const WRECK = { x: -55, z: 396 };
export const ARCH = { x: 120, z: 250 };

/** Rocky-zone weight (east side of the reef flats). */
export function rockyWeight(x: number, z: number): number {
  const edge = 55 + 14 * simplex2(z * 0.012, 3.1);
  return smoothstep(edge - 18, edge + 12, x) * smoothstep(30, 70, z) * (1 - smoothstep(320, 345, z));
}

export function reefEdgeZ(x: number): number {
  return 338 + 12 * simplex2(x * 0.018, 5.5) + 5 * simplex2(x * 0.07, 1.2);
}

/**
 * Cold cove weight: a separate northern bay west of the reef (x < -220), reached by its own dive point.
 * Water about 2 C: a drysuit is needed or the air runs out fast.
 */
export function coldWeight(x: number, z: number): number {
  return (1 - smoothstep(-238, -212, x)) * (1 - smoothstep(330, 390, z));
}

// ----------------------------------------------------------------------------- western sites
// Three special dive sites west of the drop-off (x < -220, z > 400): underwater ruins + ship graveyard,
// a blue hole, and a cenote-style cave. They replace the open-ocean profile there.
export const RUINS = { x: -330, z: 505 };
export const BLUEHOLE = { x: 300, z: 600, r: 27, depth: 55 };
export const CENOTE = { x: -330, z: 850, r: 9, depth: 22 };
/** Cave passage: from the cenote pit through a winding tunnel to a chamber. [x, z, half-width] */
export const CAVE_PATH: [number, number, number][] = [
  [-330, 850, 4], [-318, 866, 3.6], [-304, 884, 3.4], [-296, 904, 3.6], [-300, 926, 3.4], [-314, 944, 3.6],
  [-332, 956, 4.2], [-350, 962, 7.5], [-362, 970, 8],
];
export const WRECKS_WEST: { x: number; z: number; rot: number; tilt: number }[] = [
  { x: -390, z: 560, rot: 1.9, tilt: 0.3 },
  { x: -275, z: 585, rot: -0.7, tilt: -0.18 },
  { x: -365, z: 455, rot: 0.4, tilt: 0.12 },
];

/** Giant-kelp forest east of the rocky reef (x > 230). */
export const KELP = { x: 330, z: 215 };
export function kelpWeight(x: number, z: number): number {
  return smoothstep(212, 238, x) * smoothstep(20, 50, z) * (1 - smoothstep(380, 405, z));
}
function kelpHeight(x: number, z: number): number {
  // rocky bottom 9-20 m: boulders, ledges and sand channels between them
  const base = -9 - 11 * smoothstep(40, 380, z) - 3 * smoothstep(240, 420, x);
  const rr = ridged2(x * 0.04 + 11, z * 0.04, 4);
  const big = fbm2(x * 0.012 + 5, z * 0.012, 3);
  const chan = smoothstep(0.15, 0.45, Math.abs(simplex2(x * 0.02, z * 0.02 + 3)));
  return base + (rr * 4.5 + big * 3 - 1.5) * chan + 0.6 * simplex2(x * 0.3, z * 0.3);
}

export function westWeight(x: number, z: number): number {
  const xw = 1 - smoothstep(-238, -212, x);
  const ruinsBand = smoothstep(388, 412, z) * (1 - smoothstep(640, 665, z));
  const caveBand = smoothstep(765, 790, z);
  return xw * Math.max(ruinsBand, caveBand);
}

/** Blue-hole plateau weight (Phase 5: the hole moved east onto a seamount). */
export function blueWeight(x: number, z: number): number {
  const dist = Math.hypot(x - BLUEHOLE.x, z - BLUEHOLE.z);
  const wob = 8 * simplex2(Math.atan2(z - BLUEHOLE.z, x - BLUEHOLE.x) * 2.5, 3.3);
  return 1 - smoothstep(70, 105, dist + wob);
}

function blueHeight(x: number, z: number): number {
  // shallow white-sand plateau with a sheer circular hole
  let hb = -7 + 0.8 * fbm2(x * 0.05, z * 0.05, 3);
  const rr = Math.hypot(x - BLUEHOLE.x, z - BLUEHOLE.z) + 1.5 * simplex2(Math.atan2(z - BLUEHOLE.z, x - BLUEHOLE.x) * 3, 1);
  const wall = smoothstep(BLUEHOLE.r + 2, BLUEHOLE.r - 2, rr);
  const bowl = (1 - clamp(rr / BLUEHOLE.r, 0, 1)) ** 2 * 4;
  hb = lerp(hb, -BLUEHOLE.depth - bowl + 1.5 * fbm2(x * 0.1, z * 0.1, 2), wall);
  // rim ledge where the stalactites hang
  hb -= smoothstep(BLUEHOLE.r + 6, BLUEHOLE.r + 2, rr) * (1 - wall) * 3;
  return hb;
}

/** Plateau height above the cave roof (the sand divers and sand fish stand on), or null where there is no roof. */
export function caveTopAt(x: number, z: number): number | null {
  if (caveRoofAt(x, z) === null) return null;
  return -2.6 + 0.6 * ridged2(x * 0.06, z * 0.06, 3);
}

/** distance from (x,z) to the cave path, and the interpolated half-width there */
export function caveDist(x: number, z: number): { d: number; w: number; t: number } {
  let best = 1e9, bw = 3, bt = 0;
  for (let i = 0; i < CAVE_PATH.length - 1; i++) {
    const [ax, az, aw] = CAVE_PATH[i], [bx, bz, bw2] = CAVE_PATH[i + 1];
    const dx = bx - ax, dz = bz - az;
    const L2 = dx * dx + dz * dz;
    const u = clamp(((x - ax) * dx + (z - az) * dz) / L2, 0, 1);
    const px = ax + dx * u, pz = az + dz * u;
    const d = Math.hypot(x - px, z - pz);
    if (d < best) { best = d; bw = lerp(aw, bw2, u); bt = (i + u) / (CAVE_PATH.length - 1); }
  }
  return { d: best, w: bw, t: bt };
}

/** Underside of the cave roof at (x,z), or null where there is no roof (open water / cenote shaft). */
export function caveRoofAt(x: number, z: number): number | null {
  if (x > -240 || x < -425 || z < 820 || z > 1000) return null;
  if (Math.hypot(x - CENOTE.x, z - CENOTE.z) < CENOTE.r + 1.5) return null;
  const c = caveDist(x, z);
  if (c.d > c.w + 3.2) return null;
  const floor = -(CENOTE.depth + c.t * 6);
  const tall = c.w > 6 ? 9 : 5.5;
  return floor + tall + 0.7 * simplex2(x * 0.35, z * 0.35) - 0.8 * Math.max(0, simplex2(x * 1.1 + 4, z * 1.1)) ** 2 * 2;
}

// Phase 5: the ruins become a square five-tier "pyramid of the sun" (Teotihuacan-like):
// square base, sloping walls (talud) with flat terraces, a straight grand staircase on the
// north face and a flat top platform. H(r) is the height above the -22 m base as a function
// of the square radius r = max(|dx|, |dz|).
const PYR_W = [30, 24, 18.5, 13.5, 9]; // half-width at the foot of each tier's wall
const PYR_H = [4.5, 8.5, 11.5, 14, 16]; // cumulative height at the top of each tier
function pyramidAt(dx: number, dz: number): number {
  const r = Math.max(Math.abs(dx), Math.abs(dz));
  // grand staircase: a straight ramp on the north face, cutting through the tiers
  if (Math.abs(dx) < 3.5 && dz >= 7.5 && dz <= 30) return PYR_H[4] * (30 - dz) / 22.5;
  if (r >= PYR_W[0]) return 0;
  for (let i = 0; i < 5; i++) {
    const wTop = PYR_W[i] - 1.5; // every wall leans in by 1.5 m (design §2.1)
    const hPrev = i === 0 ? 0 : PYR_H[i - 1];
    if (r > PYR_W[i]) return hPrev; // terrace of the tier below (or the base plain)
    if (r >= wTop) {
      const t = (PYR_W[i] - r) / (PYR_W[i] - wTop);
      return hPrev + (PYR_H[i] - hPrev) * smoothstep(0, 1, t); // the sloping wall
    }
    if (i === 4) return PYR_H[4]; // top platform
  }
  return PYR_H[4];
}

function westHeight(x: number, z: number): number {
  // --- ruins + ship graveyard (z 410..665) and cave plateau (z 765..)
  const ruinsW = 1 - smoothstep(640, 665, z);
  const caveW = smoothstep(765, 790, z);
  let h = 0;
  if (ruinsW > 0) {
    let hr = -22 + 1.2 * fbm2(x * 0.04, z * 0.04, 3);
    if (MODE !== 2) {
      // the pyramid, its staircase slope and the road trench are man-made: the chart
      // (MODE 2) must not show them (PHASE5-DESIGN §1.3)
      hr += pyramidAt(x - RUINS.x, z - RUINS.z) + 0.15 * simplex2(x * 0.8, z * 0.8);
      // a straight "road" trench and plaza to the north of the monument
      if (Math.abs(x - RUINS.x) < 4 && z > RUINS.z + 31 && z < RUINS.z + 70) hr -= 1.2;
    }
    h += ruinsW * hr;
  }
  if (caveW > 0) {
    // rock plateau just under the surface; cenote pit and the cave trench (roofed separately)
    let hc = -2.6 + 0.6 * ridged2(x * 0.06, z * 0.06, 3);
    const rc = Math.hypot(x - CENOTE.x, z - CENOTE.z);
    hc = lerp(hc, -CENOTE.depth - 1.5 * fbm2(x * 0.2, z * 0.2, 2), smoothstep(CENOTE.r + 3, CENOTE.r - 1, rc));
    const c = caveDist(x, z);
    const floor = -(CENOTE.depth + c.t * 6) + 0.6 * fbm2(x * 0.3, z * 0.3, 2);
    // the trench is carved only for the real floor (MODE 0); the visible surface
    // (MODE 1) and the chart (MODE 2) keep the plateau whole, except at the cenote
    // shaft and its mouth, where the opening is real (PHASE5-DESIGN §2.3)
    if (MODE === 0 || rc < CENOTE.r + 2) {
      hc = Math.min(hc, lerp(floor, hc, smoothstep(c.w - 0.5, c.w + 2.5, c.d)));
    }
    h += caveW * hc;
  }
  return h;
}

/** Which "truth" heightCore reports: 0 = the real floor (collision, creatures),
 * 1 = the visible surface (terrain mesh: the cave trench is roofed over),
 * 2 = the chart's natural terrain (no ruins, no trench, no wreck pit). */
let MODE: 0 | 1 | 2 = 0;

/** Bottom height (negative = below surface). */
export function heightAt(x: number, z: number): number {
  return heightCore(x, z);
}

/** The height of the ground as seen from above (terrain mesh). */
export function surfaceTopAt(x: number, z: number): number {
  const m = MODE; MODE = 1;
  const h = heightCore(x, z);
  MODE = m;
  return h;
}

/** Natural terrain only, for the sea chart: man-made shapes are not drawn. */
export function chartHeightAt(x: number, z: number): number {
  const m = MODE; MODE = 2;
  const h = heightCore(x, z);
  MODE = m;
  return h;
}

function heightCore(x: number, z: number): number {
  const edge = reefEdgeZ(x);
  // --- base profile (depth, positive)
  let d: number;
  if (z < 120) {
    d = lerp(1.6, 6.5, smoothstep(-70, 120, z));
  } else if (z < edge) {
    d = lerp(6.5, 13.5, smoothstep(120, edge, z));
  } else if (z < 432) {
    // reef wall then sandy shelf with the wreck
    const wall = smoothstep(edge, edge + 16, z);
    d = lerp(13.5, 34, wall) + (z - edge) * 0.11;
  } else if (z < 720) {
    const s2 = smoothstep(432, 480, z);
    const shelf = 34 + (432 - (reefEdgeZ(x))) * 0.11;
    d = lerp(shelf, 118, s2) + Math.max(0, z - 480) * 0.22;
  } else {
    const base = 118 + (720 - 480) * 0.22;
    d = lerp(base, 425, smoothstep(720, 900, z));
  }

  // --- zone detail
  let h = -d;
  if (z < 130) {
    // lagoon dunes
    h += 0.55 * fbm2(x * 0.03, z * 0.03, 3) + 0.25 * simplex2(x * 0.11, z * 0.09);
  }
  if (z > 100 && z < edge + 4) {
    // coral bommies and sand channels
    const reefW = smoothstep(100, 140, z) * (1 - smoothstep(edge - 4, edge + 4, z));
    const r = ridged2(x * 0.035, z * 0.035, 3);
    const bom = Math.max(0, fbm2(x * 0.065 + 3, z * 0.065 - 2, 3) - 0.06) * 6.5;
    // coral colonies make bommie surfaces lumpy at 1-3 m scale
    const lumps = Math.max(0, simplex2(x * 0.42, z * 0.42)) * 0.7 + Math.max(0, simplex2(x * 0.9 + 5, z * 0.9)) * 0.35;
    h += reefW * (bom + r * 1.2 - 0.6 + Math.min(1, bom) * (lumps + 0.15 * simplex2(x * 1.6, z * 1.6)));
  }
  const rw = rockyWeight(x, z);
  if (rw > 0) {
    const rr = ridged2(x * 0.05, z * 0.05, 4);
    const big = fbm2(x * 0.015, z * 0.015, 3);
    h += rw * (rr * 7.5 + big * 5 - 2.5 + 0.9 * simplex2(x * 0.3, z * 0.3));
    // rock arch landmark base pillars
    const ax = x - ARCH.x;
    const az = z - ARCH.z;
    const a1 = Math.hypot(ax - 9, az);
    const a2 = Math.hypot(ax + 9, az);
    h += rw * (Math.max(0, 6 - a1) * 1.6 + Math.max(0, 6 - a2) * 1.6);
  }
  if (z >= edge - 4 && z < 470) {
    // wall roughness
    const wallBand = smoothstep(edge - 6, edge + 4, z) * (1 - smoothstep(edge + 12, edge + 26, z));
    h += wallBand * (3.2 * ridged2(x * 0.08, z * 0.12, 3) + 1.3 * ridged2(x * 0.3, z * 0.3 + h * 0.2, 2) + 0.5 * simplex2(x * 0.9, z * 0.9));
    // shelf sand ripples
    h += 0.4 * fbm2(x * 0.05, z * 0.05, 2);
  }
  if (z > 470) {
    h += 9 * fbm2(x * 0.008, z * 0.008, 3) * smoothstep(470, 560, z);
  }
  if (z > 760) {
    // abyss ridges + vent mound
    const t = smoothstep(760, 880, z);
    h += t * (14 * ridged2(x * 0.012, z * 0.02, 3) - 7);
    const vd = Math.hypot(x - VENT.x, z - VENT.z);
    h += Math.max(0, 1 - vd / 45) ** 2 * 18;
  }
  // wreck scour pit (a man-made hollow: the chart does not show it)
  const wd = Math.hypot(x - WRECK.x, z - WRECK.z);
  if (wd < 30 && MODE !== 2) h -= (1 - wd / 30) ** 2 * 1.5;
  const ww = westWeight(x, z);
  if (ww > 0) h = lerp(h, westHeight(x, z), ww);
  const kw = kelpWeight(x, z);
  if (kw > 0) h = lerp(h, kelpHeight(x, z), kw);
  const bw = blueWeight(x, z);
  if (bw > 0) h = lerp(h, blueHeight(x, z), bw);
  const cw = coldWeight(x, z);
  if (cw > 0) {
    // cold cove: boulder field sloping from a cobble shore (west) and the bay mouth (north) to ~26 m
    const shore = smoothstep(-425, -330, x);
    const d0 = lerp(2.5, 24, smoothstep(-10, 320, z)) * (0.35 + 0.65 * shore) + 1.5;
    const rr = ridged2(x * 0.045 + 7, z * 0.045, 4);
    const big = fbm2(x * 0.012 + 2, z * 0.012, 3);
    const hc = -d0 + rr * 6 + big * 4 - 2 + 0.8 * simplex2(x * 0.28, z * 0.28);
    h = lerp(h, hc, cw);
  }
  return Math.min(h, -0.9);
}

/** Height of reef "bommies" above the surrounding reef flat (0 outside the reef). */
export function bommieAt(x: number, z: number): number {
  const edge = reefEdgeZ(x);
  if (z < 110 || z > edge + 2) return 0;
  const d0 = lerp(6.5, 13.5, smoothstep(120, edge, z));
  return Math.max(0, heightAt(x, z) + d0);
}

export function zoneAt(x: number, z: number): ZoneId {
  if (coldWeight(x, z) > 0.5) return 'cold';
  if (kelpWeight(x, z) > 0.5) return 'kelp';
  if (blueWeight(x, z) > 0.5) return 'bluehole';
  if (westWeight(x, z) > 0.5) return z < 700 ? 'ruins' : 'cave';
  const edge = reefEdgeZ(x);
  if (z > 720) return 'deep';
  if (z > 480) return 'offshore';
  if (z > edge - 2) return 'dropoff';
  if (rockyWeight(x, z) > 0.5) return 'rocky';
  if (z > 125) return 'reef';
  return 'lagoon';
}

/** Surface color of the bottom (linear-ish RGB 0..1), plus sandiness for ripple shading. */
export function bottomMaterial(x: number, z: number, slope: number, out: number[]): void {
  const h = heightAt(x, z);
  const n = fbm2(x * 0.06, z * 0.06, 3);
  const n2 = simplex2(x * 0.4, z * 0.4);
  // sand
  let r = 0.8 + 0.05 * n;
  let g = 0.74 + 0.05 * n;
  let b = 0.6 + 0.04 * n;
  let sand = 1;
  let reefHard = 0;
  let rockHard = 0;
  const reefW = smoothstep(110, 150, z) * (1 - smoothstep(reefEdgeZ(x) + 2, reefEdgeZ(x) + 14, z));
  if (reefW > 0) {
    // reef framework: bommies are dead-coral rock with algal turf and coralline crusts
    const bom = bommieAt(x, z);
    const turf = clamp(smoothstep(0.4, 2.2, bom) + 0.35 * smoothstep(0.1, 0.5, fbm2(x * 0.05 + 7, z * 0.05, 3)), 0, 1) * reefW;
    // living coral colonies: patchy palette (brown, olive, purple, pink, cream, blue-grey)
    const pal = [[0.5, 0.4, 0.3], [0.46, 0.42, 0.3], [0.48, 0.34, 0.44], [0.62, 0.42, 0.46], [0.64, 0.58, 0.48], [0.42, 0.44, 0.5]];
    const ci = Math.floor((simplex2(x * 0.33 + 11, z * 0.33) * 0.5 + 0.5) * 5.99);
    const ci2 = Math.floor((simplex2(x * 0.71, z * 0.71 + 4) * 0.5 + 0.5) * 5.99);
    const mixc = smoothstep(-0.1, 0.3, simplex2(x * 0.5, z * 0.5));
    const cc = pal[Math.max(0, Math.min(5, mixc > 0.5 ? ci : ci2))];
    const live = smoothstep(0.6, 1.6, bom);
    r = lerp(r, lerp(0.54, cc[0], live) + 0.06 * n2, turf);
    g = lerp(g, lerp(0.48, cc[1], live) + 0.05 * n2, turf);
    b = lerp(b, lerp(0.42, cc[2], live), turf);
    sand *= 1 - turf;
    reefHard = turf;
  }
  const rw = Math.max(rockyWeight(x, z), coldWeight(x, z) * 0.9, kelpWeight(x, z) * 0.8);
  const rockT = clamp(Math.max(rw * (0.35 + 0.6 * smoothstep(-0.25, 0.25, fbm2(x * 0.04 + 3, z * 0.04, 2))), smoothstep(0.25, 0.6, slope)), 0, 1);
  if (rockT > 0) {
    const alg = smoothstep(-40, -6, h) * smoothstep(0.0, 0.5, n + 0.3);
    r = lerp(r, lerp(0.36, 0.33, alg) + 0.05 * n2, rockT);
    g = lerp(g, lerp(0.34, 0.4, alg) + 0.05 * n2, rockT);
    b = lerp(b, lerp(0.31, 0.24, alg) + 0.04 * n2, rockT);
    sand *= 1 - rockT;
    rockHard = rockT;
    reefHard *= 1 - rockT;
  }
  const deepT = smoothstep(460, 760, z);
  if (deepT > 0) {
    r = lerp(r, 0.42 + 0.04 * n, deepT);
    g = lerp(g, 0.4 + 0.04 * n, deepT);
    b = lerp(b, 0.37 + 0.03 * n, deepT);
  }
  const vd = Math.hypot(x - VENT.x, z - VENT.z);
  if (vd < 40) {
    const t = (1 - vd / 40) ** 1.5;
    r = lerp(r, 0.25, t);
    g = lerp(g, 0.21, t);
    b = lerp(b, 0.17, t);
    sand *= 1 - t;
    rockHard = Math.max(rockHard, t);
  }
  out[0] = r;
  out[1] = g;
  out[2] = b;
  out[3] = sand;
  out[4] = reefHard;
  out[5] = rockHard;
}

export type DivePoint = {
  id: string;
  name: string;
  sub: string;
  x: number;
  z: number;
  requires?: 'ads';
};

export const DIVE_POINTS: DivePoint[] = [
  { id: 'lagoon', name: '浅瀬ラグーン', sub: '水深 2–7m・砂地と海草', x: -10, z: 40 },
  { id: 'reef', name: 'サンゴ礁', sub: '水深 6–15m・色とりどりの魚', x: -30, z: 215 },
  { id: 'rocky', name: '岩礁', sub: '水深 8–25m・岩の隙間に潜む', x: 112, z: 200 },
  { id: 'dropoff', name: 'ドロップオフ／沖', sub: '水深 15m〜・大物と出会う', x: 0, z: 470 },
  { id: 'cold', name: '流氷の入り江', sub: '水温2℃・ドライスーツが無いとエアがすぐ尽きる', x: -300, z: 130 },
  { id: 'ruins', name: '海底遺跡', sub: '水深 6–24m・石の階段と沈船の墓場', x: -330, z: 440 },
  { id: 'bluehole', name: 'ブルーホール', sub: '水深 7→55m・浅瀬に開いた底なしの青い穴', x: 300, z: 545 },
  { id: 'cave', name: '水中洞窟', sub: '水深 22–28m・セノーテから暗い洞窟へ（ライト必須）', x: -330, z: 850 },
  { id: 'kelp', name: '海藻の森', sub: '水深 9–20m・水面まで伸びるジャイアントケルプの森', x: 330, z: 120 },
  { id: 'deep', name: '深海', sub: '水深 170–430m・大気圧潜水服が必要', x: 20, z: 900, requires: 'ads' },
];

// ---- fast seabed height for the many creatures: a lazily filled 1 m grid, bilinear between samples
const HF_RES = 1;
const HF_X0 = WORLD.minX - 20, HF_Z0 = WORLD.minZ - 20;
const HF_W = Math.ceil((WORLD.maxX - WORLD.minX + 40) / HF_RES) + 2;
const HF_H = Math.ceil((WORLD.maxZ - WORLD.minZ + 40) / HF_RES) + 2;
const hfGrid = new Float32Array(HF_W * HF_H).fill(NaN);
const hfAt = (ix: number, iz: number) => {
  const k = iz * HF_W + ix;
  let v = hfGrid[k];
  if (v !== v) v = hfGrid[k] = heightAt(HF_X0 + ix * HF_RES, HF_Z0 + iz * HF_RES);
  return v;
};
/** heightAt for things that only need the floor within a few centimetres (creatures); much cheaper. */
export function heightFast(x: number, z: number): number {
  const fx = (x - HF_X0) / HF_RES, fz = (z - HF_Z0) / HF_RES;
  const ix = Math.floor(fx), iz = Math.floor(fz);
  if (ix < 0 || iz < 0 || ix >= HF_W - 1 || iz >= HF_H - 1) return heightAt(x, z);
  const tx = fx - ix, tz = fz - iz;
  const a = hfAt(ix, iz), b = hfAt(ix + 1, iz), c = hfAt(ix, iz + 1), d = hfAt(ix + 1, iz + 1);
  return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
}
