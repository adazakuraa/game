import * as THREE from 'three';
import { mulberry32, simplex2, fbm2 } from '../utils/noise';

function canvas(w: number, h = w): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function tex(c: HTMLCanvasElement, srgb = true, repeat = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

/** Tileable grayscale detail (sand grain + pebbles) used as albedo modulation and bump. */
export function makeGroundDetail(): THREE.CanvasTexture {
  const S = 256;
  const [c, g] = canvas(S);
  const img = g.createImageData(S, S);
  const r = mulberry32(7);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      // tileable via torus mapping
      const a = (x / S) * Math.PI * 2;
      const b = (y / S) * Math.PI * 2;
      const nx = Math.cos(a) * 2.2;
      const ny = Math.sin(a) * 2.2;
      const nz = Math.cos(b) * 2.2;
      const nw = Math.sin(b) * 2.2;
      const n1 = simplex2(nx + nz * 0.7, ny + nw * 0.7) * 0.5 + simplex2(nx * 3 + nw, ny * 3 + nz) * 0.3;
      const grain = (r() - 0.5) * 0.35;
      let v = 0.62 + n1 * 0.22 + grain;
      v = Math.max(0, Math.min(1, v));
      const i = (y * S + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v * 255;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  // pebbles / shell bits
  for (let k = 0; k < 140; k++) {
    const x = r() * S;
    const y = r() * S;
    const rad = 0.8 + r() * 2.6;
    const l = 120 + r() * 120;
    g.fillStyle = `rgba(${l},${l},${l},${0.35 + r() * 0.4})`;
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
      g.beginPath();
      g.ellipse(x + ox, y + oy, rad, rad * (0.6 + r() * 0.4), r() * 3, 0, Math.PI * 2);
      g.fill();
    }
  }
  const t = tex(c, false);
  return t;
}

/** Rock / coral surface detail with pits and crust. */
export function makeRockTexture(): THREE.CanvasTexture {
  const S = 256;
  const [c, g] = canvas(S);
  const img = g.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const a = (x / S) * Math.PI * 2;
      const b = (y / S) * Math.PI * 2;
      const u = Math.cos(a) * 1.6, v = Math.sin(a) * 1.6, w = Math.cos(b) * 1.6, q = Math.sin(b) * 1.6;
      const n = fbm2(u + w * 0.8, v + q * 0.8, 4) * 0.6 + Math.abs(simplex2(u * 4 + q, v * 4 + w)) * 0.5;
      const val = Math.max(0, Math.min(1, 0.55 + n * 0.45));
      const i = (y * S + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = val * 255;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return tex(c, false);
}

/** Radial soft sprite for glows, bubbles, particles. */
export function makeSoftDot(inner = 'rgba(255,255,255,1)', mid = 'rgba(255,255,255,0.35)'): THREE.CanvasTexture {
  const [c, g] = canvas(64);
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, inner);
  gr.addColorStop(0.35, mid);
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  return tex(c, true, false);
}

export function makeBubble(): THREE.CanvasTexture {
  const [c, g] = canvas(64);
  const gr = g.createRadialGradient(32, 32, 18, 32, 32, 31);
  gr.addColorStop(0, 'rgba(255,255,255,0.05)');
  gr.addColorStop(0.75, 'rgba(220,245,255,0.35)');
  gr.addColorStop(0.92, 'rgba(255,255,255,0.95)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.beginPath();
  g.arc(32, 32, 31, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = 'rgba(255,255,255,0.9)';
  g.beginPath();
  g.ellipse(23, 22, 5, 3, -0.6, 0, Math.PI * 2);
  g.fill();
  return tex(c, true, false);
}

/** Sea-fan lattice with alpha (branching gorgonian). */
export function makeSeaFan(color: string): THREE.CanvasTexture {
  const [c, g] = canvas(256);
  const r = mulberry32(99);
  g.clearRect(0, 0, 256, 256);
  g.strokeStyle = color;
  g.lineCap = 'round';
  const branch = (x: number, y: number, ang: number, len: number, w: number, depth: number) => {
    if (depth <= 0 || len < 4) return;
    const x2 = x + Math.cos(ang) * len;
    const y2 = y + Math.sin(ang) * len;
    g.lineWidth = w;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo((x + x2) / 2 + (r() - 0.5) * 8, (y + y2) / 2, x2, y2);
    g.stroke();
    const n = 2 + (r() < 0.3 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      branch(x2, y2, ang + (r() - 0.5) * 1.3, len * (0.68 + r() * 0.2), Math.max(1, w * 0.72), depth - 1);
    }
  };
  branch(128, 254, -Math.PI / 2, 46, 7, 7);
  // fine mesh between branches
  g.globalAlpha = 0.35;
  g.lineWidth = 1;
  for (let i = 0; i < 260; i++) {
    const x = 30 + r() * 196;
    const y = 20 + r() * 200;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (r() - 0.5) * 18, y + (r() - 0.5) * 18);
    g.stroke();
  }
  return tex(c, true, false);
}

/** Seagrass / kelp blade texture with veins and translucency. */
export function makeBlade(base: string, tip: string): THREE.CanvasTexture {
  const [c, g] = canvas(32, 128);
  const gr = g.createLinearGradient(0, 128, 0, 0);
  gr.addColorStop(0, base);
  gr.addColorStop(1, tip);
  g.fillStyle = gr;
  g.fillRect(0, 0, 32, 128);
  g.strokeStyle = 'rgba(255,255,255,0.18)';
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(16, 128);
  g.lineTo(16, 0);
  g.stroke();
  const r = mulberry32(3);
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(30,20,0,${r() * 0.15})`;
    g.fillRect(r() * 32, r() * 128, 2 + r() * 3, 1 + r() * 4);
  }
  return tex(c, true, false);
}
