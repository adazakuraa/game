// Seeded RNG + 2D simplex noise helpers (deterministic, allocation-free hot paths).

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;
const grad2 = new Float32Array([1, 1, -1, 1, 1, -1, -1, -1, 1, 0, -1, 0, 0, 1, 0, -1]);
const perm = new Uint8Array(512);
{
  const r = mulberry32(1337);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    const t = p[i];
    p[i] = p[j];
    p[j] = t;
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
}

export function simplex2(xin: number, yin: number): number {
  const s = (xin + yin) * F2;
  const i = Math.floor(xin + s);
  const j = Math.floor(yin + s);
  const t = (i + j) * G2;
  const x0 = xin - (i - t);
  const y0 = yin - (j - t);
  const i1 = x0 > y0 ? 1 : 0;
  const j1 = x0 > y0 ? 0 : 1;
  const x1 = x0 - i1 + G2;
  const y1 = y0 - j1 + G2;
  const x2 = x0 - 1 + 2 * G2;
  const y2 = y0 - 1 + 2 * G2;
  const ii = i & 255;
  const jj = j & 255;
  let n = 0;
  let t0 = 0.5 - x0 * x0 - y0 * y0;
  if (t0 > 0) {
    const g = (perm[ii + perm[jj]] & 7) * 2;
    t0 *= t0;
    n += t0 * t0 * (grad2[g] * x0 + grad2[g + 1] * y0);
  }
  let t1 = 0.5 - x1 * x1 - y1 * y1;
  if (t1 > 0) {
    const g = (perm[ii + i1 + perm[jj + j1]] & 7) * 2;
    t1 *= t1;
    n += t1 * t1 * (grad2[g] * x1 + grad2[g + 1] * y1);
  }
  let t2 = 0.5 - x2 * x2 - y2 * y2;
  if (t2 > 0) {
    const g = (perm[ii + 1 + perm[jj + 1]] & 7) * 2;
    t2 *= t2;
    n += t2 * t2 * (grad2[g] * x2 + grad2[g + 1] * y2);
  }
  return 70 * n; // ~[-1,1]
}

export function fbm2(x: number, y: number, oct = 4, lac = 2.03, gain = 0.5): number {
  let a = 1;
  let f = 1;
  let s = 0;
  let n = 0;
  for (let o = 0; o < oct; o++) {
    s += a * simplex2(x * f + o * 17.3, y * f - o * 9.1);
    n += a;
    a *= gain;
    f *= lac;
  }
  return s / n;
}

export function ridged2(x: number, y: number, oct = 4): number {
  let a = 1;
  let f = 1;
  let s = 0;
  let n = 0;
  for (let o = 0; o < oct; o++) {
    const v = 1 - Math.abs(simplex2(x * f + o * 31.7, y * f + o * 7.7));
    s += a * v * v;
    n += a;
    a *= 0.5;
    f *= 2.1;
  }
  return s / n;
}

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}
