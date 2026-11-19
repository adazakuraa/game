import * as THREE from 'three';
import type { MountainDef } from '../game/Mountains';
import { createSeededRandom } from '../utils/random';

/** Fractal puff texture for the plume sprites. */
function plumeTexture(): THREE.CanvasTexture {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const img = g.createImageData(S, S);
  const rng = createSeededRandom(77);
  const grid = Array.from({ length: 16 * 16 }, () => rng());
  const vn = (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const fx = x - xi, fy = y - yi;
    const a = grid[((yi & 15) * 16 + (xi & 15))], b = grid[((yi & 15) * 16 + ((xi + 1) & 15))];
    const cc = grid[(((yi + 1) & 15) * 16 + (xi & 15))], d = grid[(((yi + 1) & 15) * 16 + ((xi + 1) & 15))];
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    return (a + (b - a) * sx) * (1 - sy) + (cc + (d - cc) * sx) * sy;
  };
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S - 0.5, v = y / S - 0.5;
      const r = Math.hypot(u, v) * 2;
      let n = 0, amp = 0.5, f = 4;
      for (let o = 0; o < 4; o++) { n += vn(x / S * f + o * 3.1, y / S * f + o * 1.7) * amp; amp *= 0.5; f *= 2; }
      const a = Math.max(0, 1 - r) ** 1.6 * Math.max(0, n * 1.6 - 0.35);
      const o = (y * S + x) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = 255;
      img.data[o + 3] = Math.min(255, a * 255 * 1.4);
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Spindrift banner streaming off the highest summit of the leg in strong wind. */
export class Plume {
  readonly group = new THREE.Group();
  private readonly sprites: { s: THREE.Sprite; t: number; off: THREE.Vector3; spin: number }[] = [];
  private peak = new THREE.Vector3();
  private readonly tex = plumeTexture();

  constructor() {
    this.group.name = 'summitPlume';
    for (let i = 0; i < 28; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, transparent: true, depthWrite: false, opacity: 0, fog: true }));
      this.group.add(s);
      this.sprites.push({ s, t: i / 28, off: new THREE.Vector3((Math.random() - 0.5) * 30, (Math.random() - 0.5) * 20, (Math.random() - 0.5) * 30), spin: Math.random() * 6 });
    }
  }

  setStage(def: MountainDef): void {
    let best: [number, number, number] = [0, 0, -1e9];
    for (const r of def.ridges) for (const p of r) if (p[2] > best[2]) best = p;
    this.peak.set(best[0], best[2] + 6, best[1]);
  }

  update(dt: number, wind: THREE.Vector3, windKmh: number, storm: number, sunColor: THREE.Color, light: number): void {
    const strength = THREE.MathUtils.clamp((windKmh - 18) / 40, 0, 1) * (1 - storm * 0.8);
    this.group.visible = strength > 0.02;
    if (!this.group.visible) return;
    const dir = wind.clone().setY(0).normalize();
    const len = 380 + strength * 520;
    const col = new THREE.Color(0.55, 0.6, 0.7).multiplyScalar(0.4 + light * 0.6).lerp(sunColor, 0.35 * light);
    for (const p of this.sprites) {
      p.t += dt * (0.025 + strength * 0.03);
      if (p.t > 1) { p.t -= 1; p.off.set((Math.random() - 0.5) * 30, (Math.random() - 0.5) * 20, (Math.random() - 0.5) * 30); }
      const t = p.t;
      const pos = this.peak.clone().addScaledVector(dir, t * len).add(p.off.clone().multiplyScalar(0.4 + t * 2.2));
      pos.y += Math.sin(t * Math.PI) * 25 - t * 50;
      p.s.position.copy(pos);
      p.s.scale.setScalar(30 + t * 150);
      const mat = p.s.material as THREE.SpriteMaterial;
      mat.opacity = Math.min(1, t * 10) * Math.pow(1 - t, 1.4) * 0.55 * strength;
      mat.rotation = p.spin + t * 0.8;
      mat.color.copy(col);
    }
  }
}
