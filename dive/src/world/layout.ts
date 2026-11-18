import { clamp, fbm2, lerp, ridged2, simplex2, smoothstep } from '../utils/noise';

// World axes: y up (surface y=0), z increases offshore, x along the shore.
export const WORLD = { minX: -210, maxX: 210, minZ: -70, maxZ: 1080 };

export type ZoneId = 'lagoon' | 'reef' | 'rocky' | 'dropoff' | 'offshore' | 'deep';

export const ZONE_NAMES: Record<ZoneId, string> = {
  lagoon: '浅瀬ラグーン',
  reef: 'サンゴ礁',
  rocky: '岩礁',
  dropoff: 'ドロップオフ',
  offshore: '沖の大海原',
  deep: '深海',
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

/** Bottom height (negative = below surface). */
export function heightAt(x: number, z: number): number {
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
    const bom = Math.max(0, fbm2(x * 0.045 + 3, z * 0.045 - 2, 3) - 0.05) * 7.5;
    h += reefW * (bom + r * 1.2 - 0.6 + Math.min(1, bom) * (0.45 * simplex2(x * 0.45, z * 0.45) + 0.2 * simplex2(x * 1.1, z * 1.1)));
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
  // wreck scour pit
  const wd = Math.hypot(x - WRECK.x, z - WRECK.z);
  if (wd < 30) h -= (1 - wd / 30) ** 2 * 1.5;
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
  const reefW = smoothstep(110, 150, z) * (1 - smoothstep(reefEdgeZ(x) + 2, reefEdgeZ(x) + 14, z));
  if (reefW > 0) {
    // reef framework: bommies are dead-coral rock with algal turf and coralline crusts
    const bom = bommieAt(x, z);
    const turf = clamp(smoothstep(0.4, 2.2, bom) + 0.35 * smoothstep(0.1, 0.5, fbm2(x * 0.05 + 7, z * 0.05, 3)), 0, 1) * reefW;
    const pink = smoothstep(0.2, 0.6, simplex2(x * 0.21, z * 0.21));
    r = lerp(r, lerp(0.42, 0.62, pink * 0.6) + 0.08 * n2, turf);
    g = lerp(g, lerp(0.42, 0.4, pink * 0.6) + 0.06 * n2, turf);
    b = lerp(b, lerp(0.3, 0.42, pink * 0.6), turf);
    sand *= 1 - turf;
  }
  const rw = rockyWeight(x, z);
  const rockT = clamp(Math.max(rw * 0.85, smoothstep(0.25, 0.6, slope)), 0, 1);
  if (rockT > 0) {
    const alg = smoothstep(-40, -6, h) * smoothstep(0.0, 0.5, n + 0.3);
    r = lerp(r, lerp(0.36, 0.33, alg) + 0.05 * n2, rockT);
    g = lerp(g, lerp(0.34, 0.4, alg) + 0.05 * n2, rockT);
    b = lerp(b, lerp(0.31, 0.24, alg) + 0.04 * n2, rockT);
    sand *= 1 - rockT;
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
  }
  out[0] = r;
  out[1] = g;
  out[2] = b;
  out[3] = sand;
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
  { id: 'deep', name: '深海', sub: '水深 170–430m・大気圧潜水服が必要', x: 20, z: 900, requires: 'ads' },
];
