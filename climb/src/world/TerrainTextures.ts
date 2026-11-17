import * as THREE from 'three';
import { createSeededRandom } from '../utils/random';

/** Periodic value-noise lattice so generated textures tile seamlessly. */
class PeriodicNoise {
  private readonly table: Float32Array;
  constructor(seed: number, private readonly size = 256) {
    const rng = createSeededRandom(seed);
    this.table = new Float32Array(size * size);
    for (let i = 0; i < this.table.length; i++) this.table[i] = rng();
  }
  sample(x: number, y: number, period: number): number {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const fx = x - xi;
    const fy = y - yi;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const p = period;
    const s = this.size;
    const v = (ix: number, iy: number) => {
      const a = ((ix % p) + p) % p;
      const b = ((iy % p) + p) % p;
      return this.table[(b % s) * s + (a % s)];
    };
    const a = v(xi, yi);
    const b = v(xi + 1, yi);
    const c = v(xi, yi + 1);
    const d = v(xi + 1, yi + 1);
    return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
  }
}

function heightToNormalTexture(h: Float32Array, size: number, strength: number): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const l = h[y * size + ((x - 1 + size) % size)];
      const r = h[y * size + ((x + 1) % size)];
      const u = h[((y - 1 + size) % size) * size + x];
      const d = h[((y + 1) % size) * size + x];
      let nx = (l - r) * strength;
      let ny = (u - d) * strength;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len; ny /= len; nz /= len;
      const o = (y * size + x) * 4;
      data[o] = (nx * 0.5 + 0.5) * 255;
      data[o + 1] = (ny * 0.5 + 0.5) * 255;
      data[o + 2] = (nz * 0.5 + 0.5) * 255;
      data[o + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

export interface TerrainTextureSet {
  snowNormal: THREE.DataTexture;
  rockNormal: THREE.DataTexture;
  rockAlbedo: THREE.DataTexture;
}
const cache = new Map<number, TerrainTextureSet>();

export function createTerrainTextures(seed: number): TerrainTextureSet {
  const hit = cache.get(seed);
  if (hit) return hit;
  const set = buildTextures(seed);
  cache.set(seed, set);
  return set;
}

function buildTextures(seed: number): TerrainTextureSet {
  const size = 256;
  const noise = new PeriodicNoise(seed + 11);

  // Snow: anisotropic wind ripples (sastrugi) + soft lumps.
  const snowH = new Float32Array(size * size);
  // Rock: ridged fractal cracks.
  const rockH = new Float32Array(size * size);
  const rockC = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      let s = 0;
      // ripples: stretched noise, periodic with period counts
      s += noise.sample(u * 6, v * 22, 6) * 0.6;
      s += noise.sample(u * 12 + 3, v * 40 + 1, 12) * 0.3;
      s += noise.sample(u * 4 + 9, v * 4 + 2, 4) * 0.8;
      s += noise.sample(u * 32, v * 32, 32) * 0.12;
      snowH[y * size + x] = s;

      let r = 0;
      let amp = 1;
      let f = 4;
      for (let o = 0; o < 5; o++) {
        const n = 1 - Math.abs(noise.sample(u * f + o * 5.3, v * f + o * 1.7, f) * 2 - 1);
        r += n * n * amp;
        amp *= 0.5;
        f *= 2;
      }
      rockH[y * size + x] = r;
      const c = noise.sample(u * 8 + 20, v * 8 + 20, 8) * 0.6 + noise.sample(u * 32 + 4, v * 32, 32) * 0.4;
      const o2 = (y * size + x) * 4;
      const g = Math.min(255, Math.max(0, (c * 0.7 + r * 0.25) * 255));
      rockC[o2] = g;
      rockC[o2 + 1] = g * 0.97;
      rockC[o2 + 2] = g * 0.93;
      rockC[o2 + 3] = 255;
    }
  }
  const snowNormal = heightToNormalTexture(snowH, size, 3.5);
  const rockNormal = heightToNormalTexture(rockH, size, 6);
  const rockAlbedo = new THREE.DataTexture(rockC, size, size, THREE.RGBAFormat);
  rockAlbedo.wrapS = rockAlbedo.wrapT = THREE.RepeatWrapping;
  rockAlbedo.minFilter = THREE.LinearMipmapLinearFilter;
  rockAlbedo.generateMipmaps = true;
  rockAlbedo.needsUpdate = true;
  return { snowNormal, rockNormal, rockAlbedo };
}
