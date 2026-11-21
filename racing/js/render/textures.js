// 手続き的テクスチャ生成（外部画像なしでリアル寄りの質感を作る）
import * as THREE from 'three';

let seed = 12345;
function rnd() {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// タイル可能なバリューノイズ
function makeNoise(size, cells, s = 1) {
  seed = s * 9973 + 17;
  const g = new Float32Array(cells * cells);
  for (let i = 0; i < g.length; i++) g[i] = rnd();
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * cells, fy = (y / size) * cells;
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const tx = fx - x0, ty = fy - y0;
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const a = g[(y0 % cells) * cells + (x0 % cells)];
      const b = g[(y0 % cells) * cells + ((x0 + 1) % cells)];
      const c = g[((y0 + 1) % cells) * cells + (x0 % cells)];
      const d = g[((y0 + 1) % cells) * cells + ((x0 + 1) % cells)];
      out[y * size + x] = a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
    }
  }
  return out;
}
function fbm(size, base, oct, s) {
  const out = new Float32Array(size * size);
  let amp = 1, tot = 0;
  for (let o = 0; o < oct; o++) {
    const n = makeNoise(size, base << o, s + o * 31);
    for (let i = 0; i < out.length; i++) out[i] += n[i] * amp;
    tot += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= tot;
  return out;
}

// 高さ配列 → 法線マップ
function normalFromHeight(h, w, hh, strength) {
  const c = canvas(w, hh);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, hh);
  for (let y = 0; y < hh; y++) {
    for (let x = 0; x < w; x++) {
      const l = h[y * w + ((x - 1 + w) % w)], r = h[y * w + ((x + 1) % w)];
      const u = h[((y - 1 + hh) % hh) * w + x], d = h[((y + 1) % hh) * w + x];
      let nx = (l - r) * strength, ny = (u - d) * strength, nz = 1;
      const len = Math.hypot(nx, ny, nz);
      const i = (y * w + x) * 4;
      img.data[i] = ((nx / len) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((ny / len) * 0.5 + 0.5) * 255;
      img.data[i + 2] = ((nz / len) * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function tex(c, opts = {}) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = opts.aniso ?? 8;
  if (opts.srgb !== false) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

const cache = {};

// アスファルト路面（幅方向 u=0..1, 長さ方向 1タイル = 32m）
export function roadTextures(wet, scenery) {
  const key = 'road' + wet + scenery;
  if (cache[key]) return cache[key];
  const W = 512, H = 1024;
  const n1 = fbm(256, 8, 5, 3);
  const grain = new Float32Array(W * H);
  seed = 777;
  for (let i = 0; i < grain.length; i++) grain[i] = rnd();
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(W, H);
  const height = new Float32Array(W * H);
  const rough = canvas(W, H);
  const rctx = rough.getContext('2d');
  const rimg = rctx.createImageData(W, H);
  const city = scenery === 'city';
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const macro = n1[((y >> 2) % 256) * 256 + ((x >> 1) % 256)];
      const g = grain[i];
      // 骨材の粒
      let v = 0.27 + macro * 0.1 + (g - 0.5) * 0.12;
      if (g > 0.985) v += 0.15;
      if (g < 0.02) v -= 0.1;
      // 走行ラインのラバー（中央寄りがやや暗い）
      const u = x / W;
      const rubber = Math.exp(-((u - 0.5) ** 2) / 0.03) * 0.05;
      v -= rubber;
      let r = v, gg = v, b = v * 1.03;
      // 白線
      let line = (u > 0.018 && u < 0.035) || (u > 0.965 && u < 0.982);
      if (city) line = line || (u > 0.497 && u < 0.503 && (y % 256) < 120);
      let ro = 0.82 - macro * 0.1 + (g - 0.5) * 0.12;
      if (line) {
        const wear = 0.82 + macro * 0.18;
        r = gg = b = wear;
        ro = 0.55;
      }
      if (wet) {
        r *= 0.55; gg *= 0.56; b *= 0.6;
        ro = 0.42 - macro * 0.22;
        if (macro > 0.6) ro = 0.14 - (macro - 0.6) * 0.2; // 水たまり
      }
      img.data[i * 4] = Math.min(255, r * 255);
      img.data[i * 4 + 1] = Math.min(255, gg * 255);
      img.data[i * 4 + 2] = Math.min(255, b * 255);
      img.data[i * 4 + 3] = 255;
      rimg.data[i * 4] = 0;
      rimg.data[i * 4 + 1] = Math.max(0, Math.min(255, ro * 255));
      rimg.data[i * 4 + 2] = 0;
      rimg.data[i * 4 + 3] = 255;
      height[i] = (wet ? g * 0.25 : g * 0.6) + macro * 0.4 + (line ? 0.3 : 0);
    }
  }
  ctx.putImageData(img, 0, 0);
  rctx.putImageData(rimg, 0, 0);
  // 補修跡・タイヤ痕
  seed = 4242;
  for (let k = 0; k < 7; k++) {
    ctx.fillStyle = `rgba(20,20,22,${0.12 + rnd() * 0.12})`;
    const x = 60 + rnd() * 380, y = rnd() * H;
    ctx.fillRect(x, y, 30 + rnd() * 90, 40 + rnd() * 160);
  }
  ctx.globalCompositeOperation = 'multiply';
  for (let k = 0; k < 18; k++) {
    const x = 150 + rnd() * 220;
    ctx.strokeStyle = `rgba(40,40,40,${0.12 + rnd() * 0.2})`;
    ctx.lineWidth = 6 + rnd() * 6;
    ctx.beginPath();
    const y0 = rnd() * H;
    ctx.moveTo(x, y0);
    ctx.bezierCurveTo(x + (rnd() - 0.5) * 40, y0 + 80, x + (rnd() - 0.5) * 60, y0 + 160, x + (rnd() - 0.5) * 80, y0 + 260);
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';
  const map = tex(c, { aniso: 16 });
  const normal = tex(normalFromHeight(height, W, H, 2.2), { srgb: false, aniso: 16 });
  const roughMap = tex(rough, { srgb: false, aniso: 16 });
  return (cache[key] = { map, normal, rough: roughMap });
}

export function curbTextures() {
  if (cache.curb) return cache.curb;
  const W = 128, H = 256;
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  for (let y = 0; y < H; y++) {
    const red = Math.floor(y / 128) % 2 === 0;
    ctx.fillStyle = red ? '#c4161c' : '#f0f0ea';
    ctx.fillRect(0, y, W, 1);
  }
  // 汚れ
  seed = 99;
  for (let i = 0; i < 2500; i++) {
    ctx.fillStyle = `rgba(30,30,30,${rnd() * 0.15})`;
    ctx.fillRect(rnd() * W, rnd() * H, 2, 2);
  }
  const h = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = x / W;
    h[y * W + x] = Math.sin(u * Math.PI) * 0.6 + ((y % 128) < 6 || (y % 128) > 122 ? -0.3 : 0);
  }
  return (cache.curb = { map: tex(c), normal: tex(normalFromHeight(h, W, H, 3), { srgb: false }) });
}

export function groundTextures(kind) {
  const key = 'ground' + kind;
  if (cache[key]) return cache[key];
  const S = 512;
  const n = fbm(S, 4, 6, kind.length * 13);
  const fine = fbm(S, 64, 2, 5);
  const c = canvas(S, S);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  const h = new Float32Array(S * S);
  seed = 31337;
  const pal = {
    grass: [[0.16, 0.27, 0.08], [0.3, 0.38, 0.14]],
    forest: [[0.1, 0.19, 0.07], [0.2, 0.26, 0.1]],
    mountain: [[0.18, 0.25, 0.1], [0.32, 0.33, 0.18]],
    sand: [[0.62, 0.4, 0.24], [0.78, 0.52, 0.3]],
    city: [[0.33, 0.33, 0.34], [0.42, 0.42, 0.43]],
    snow: [[0.8, 0.85, 0.93], [0.96, 0.98, 1.0]],
  }[kind];
  for (let i = 0; i < S * S; i++) {
    const t = Math.min(1, Math.max(0, n[i] * 1.3 - 0.15 + (fine[i] - 0.5) * 0.5));
    const g = rnd();
    let r = pal[0][0] + (pal[1][0] - pal[0][0]) * t;
    let gg = pal[0][1] + (pal[1][1] - pal[0][1]) * t;
    let b = pal[0][2] + (pal[1][2] - pal[0][2]) * t;
    const blade = (g - 0.5) * (kind === 'sand' ? 0.06 : kind === 'snow' ? 0.04 : 0.16);
    r += blade; gg += blade * 1.3; b += blade * 0.5;
    if (kind === 'sand') {
      const y = Math.floor(i / S), x = i % S;
      const rip = Math.sin((y + n[i] * 80) * 0.35) * 0.03;
      r += rip; gg += rip; b += rip;
      h[i] = rip * 10 + g * 0.2;
    } else {
      h[i] = g * 0.7 + fine[i] * 0.3;
    }
    img.data[i * 4] = Math.max(0, Math.min(255, r * 255));
    img.data[i * 4 + 1] = Math.max(0, Math.min(255, gg * 255));
    img.data[i * 4 + 2] = Math.max(0, Math.min(255, b * 255));
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return (cache[key] = { map: tex(c), normal: tex(normalFromHeight(h, S, S, kind === 'sand' ? 1.5 : 2.5), { srgb: false }) });
}

export function concreteTexture(stripes) {
  const key = 'concrete' + stripes;
  if (cache[key]) return cache[key];
  const W = 256, H = 64;
  const n = fbm(256, 8, 4, 77);
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    const v = 0.62 + (n[(y * 4 % 256) * 256 + x] - 0.5) * 0.25 - (y / H) * 0.08;
    img.data[i * 4] = img.data[i * 4 + 1] = v * 255;
    img.data[i * 4 + 2] = v * 250;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  if (stripes) {
    for (let x = 0; x < W; x += 64) {
      ctx.fillStyle = (x / 64) % 2 ? '#d01818' : '#eeeeee';
      ctx.fillRect(x, 6, 64, 14);
    }
  }
  // 継ぎ目
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(0, 0, 2, H);
  ctx.fillRect(128, 0, 2, H);
  // 下部の汚れ
  const gr = ctx.createLinearGradient(0, H * 0.6, 0, H);
  gr.addColorStop(0, 'rgba(30,25,20,0)');
  gr.addColorStop(1, 'rgba(30,25,20,0.5)');
  ctx.fillStyle = gr;
  ctx.fillRect(0, 0, W, H);
  return (cache[key] = tex(c));
}

const BRANDS = [
  ['APEX', '#0b1d3a', '#ffffff', 'MOTOR OIL'],
  ['KAIZEN', '#c8102e', '#ffffff', 'TYRES'],
  ['NOVA', '#111111', '#ffd200', 'FUEL'],
  ['RAPIDE', '#ffffff', '#1a3a8a', 'BRAKES'],
  ['ZENKO', '#f4f4f4', '#d71920', 'WATCHES'],
  ['STRATOS', '#1b5e20', '#ffffff', 'ENERGY'],
];

export function bannerTexture() {
  if (cache.banner) return cache.banner;
  const W = 1024, H = 128;
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  const bw = W / 4;
  for (let k = 0; k < 4; k++) {
    const [name, bg, fg, sub] = BRANDS[k % BRANDS.length];
    ctx.fillStyle = bg;
    ctx.fillRect(k * bw, 0, bw, H);
    ctx.fillStyle = fg;
    ctx.font = 'italic 900 64px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(name, k * bw + bw / 2, 76);
    ctx.font = '700 22px Arial, sans-serif';
    ctx.fillText(sub, k * bw + bw / 2, 106);
  }
  return (cache.banner = tex(c));
}

export function bannerTexture2() {
  if (cache.banner2) return cache.banner2;
  const W = 1024, H = 128;
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  const bw = W / 2;
  for (let k = 0; k < 2; k++) {
    const [name, bg, fg, sub] = BRANDS[(k + 4) % BRANDS.length];
    ctx.fillStyle = bg;
    ctx.fillRect(k * bw, 0, bw, H);
    ctx.fillStyle = fg;
    ctx.font = 'italic 900 58px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(name + ' ' + sub, k * bw + bw / 2, 84);
  }
  return (cache.banner2 = tex(c));
}

export function windowTexture(night) {
  const key = 'win' + night;
  if (cache[key]) return cache[key];
  const W = 256, H = 512;
  const c = canvas(W, H), e = canvas(W, H);
  const ctx = c.getContext('2d'), ex = e.getContext('2d');
  seed = 2024;
  ctx.fillStyle = '#5d6168';
  ctx.fillRect(0, 0, W, H);
  ex.fillStyle = '#000';
  ex.fillRect(0, 0, W, H);
  for (let y = 0; y < H; y += 32) {
    for (let x = 0; x < W; x += 32) {
      const lit = rnd() < (night ? 0.45 : 0);
      const tone = 0.25 + rnd() * 0.2;
      ctx.fillStyle = `rgb(${tone * 120},${tone * 140},${tone * 170})`;
      ctx.fillRect(x + 4, y + 6, 24, 20);
      if (lit) {
        const warm = rnd() < 0.7;
        ex.fillStyle = warm ? `rgb(255,${190 + rnd() * 40},${110 + rnd() * 50})` : 'rgb(190,220,255)';
        ex.globalAlpha = 0.5 + rnd() * 0.5;
        ex.fillRect(x + 4, y + 6, 24, 20);
        ex.globalAlpha = 1;
      }
    }
  }
  return (cache[key] = { map: tex(c), emissive: tex(e) });
}

export function crowdTexture() {
  if (cache.crowd) return cache.crowd;
  const W = 512, H = 128;
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#2a2d33';
  ctx.fillRect(0, 0, W, H);
  seed = 5;
  const cols = ['#d33', '#eee', '#36c', '#fc3', '#2a2', '#f80', '#222', '#c9c'];
  for (let row = 0; row < 8; row++) {
    for (let x = 0; x < W; x += 6) {
      if (rnd() < 0.15) continue;
      ctx.fillStyle = cols[Math.floor(rnd() * cols.length)];
      ctx.fillRect(x + rnd() * 2, row * 16 + 4, 4, 7);
      ctx.fillStyle = '#e0b090';
      ctx.fillRect(x + 1 + rnd(), row * 16 + 1, 3, 3);
    }
  }
  return (cache.crowd = tex(c));
}

// ジャンプ台の黄黒の縞（進行方向に「く」の字の矢羽根）
export function rampTexture() {
  if (cache.ramp) return cache.ramp;
  const c = canvas(256, 256);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f2c200';
  ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = '#151515';
  for (let k = -1; k < 3; k++) {
    const y = k * 128;
    ctx.beginPath();
    ctx.moveTo(0, y + 64); ctx.lineTo(128, y); ctx.lineTo(256, y + 64);
    ctx.lineTo(256, y + 112); ctx.lineTo(128, y + 48); ctx.lineTo(0, y + 112);
    ctx.closePath();
    ctx.fill();
  }
  const t = tex(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return (cache.ramp = t);
}

export function checkerTexture() {
  if (cache.checker) return cache.checker;
  const c = canvas(256, 32);
  const ctx = c.getContext('2d');
  for (let x = 0; x < 32; x++) for (let y = 0; y < 4; y++) {
    ctx.fillStyle = (x + y) % 2 ? '#111' : '#eee';
    ctx.fillRect(x * 8, y * 8, 8, 8);
  }
  const t = tex(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return (cache.checker = t);
}

export function radialTexture(inner = 'rgba(0,0,0,0.75)', outer = 'rgba(0,0,0,0)', size = 128) {
  const key = 'rad' + inner + outer;
  if (cache[key]) return cache[key];
  const c = canvas(size, size);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return (cache[key] = t);
}

export function smokeTexture() {
  if (cache.smoke) return cache.smoke;
  const S = 128;
  const n = fbm(S, 4, 4, 9);
  const c = canvas(S, S);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x;
    const d = Math.hypot(x - S / 2, y - S / 2) / (S / 2);
    const a = Math.max(0, 1 - d) ** 1.5 * (0.5 + n[i] * 0.8);
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = 255;
    img.data[i * 4 + 3] = Math.min(255, a * 255);
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  return (cache.smoke = t);
}

export function skidTexture() {
  if (cache.skid) return cache.skid;
  const c = canvas(64, 64);
  const ctx = c.getContext('2d');
  for (let x = 0; x < 64; x++) {
    const a = Math.sin((x / 63) * Math.PI) * (0.6 + Math.random() * 0.4);
    ctx.fillStyle = `rgba(255,255,255,${a})`;
    ctx.fillRect(x, 0, 1, 64);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapT = THREE.RepeatWrapping;
  return (cache.skid = t);
}

export function numberTexture(num, color) {
  const c = canvas(256, 256);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(128, 128, 110, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 10;
  ctx.strokeStyle = '#111';
  ctx.stroke();
  ctx.fillStyle = '#111';
  ctx.font = 'italic 900 140px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(num), 128, 136);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function boardTexture(text) {
  const key = 'board' + text;
  if (cache[key]) return cache[key];
  const c = canvas(128, 128);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f5f5f0';
  ctx.fillRect(0, 0, 128, 128);
  ctx.lineWidth = 8;
  ctx.strokeStyle = '#111';
  ctx.strokeRect(4, 4, 120, 120);
  ctx.fillStyle = '#111';
  ctx.font = '900 64px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 64, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return (cache[key] = t);
}

export function fenceTexture() {
  if (cache.fence) return cache.fence;
  const c = canvas(64, 64);
  const ctx = c.getContext('2d');
  ctx.strokeStyle = 'rgba(200,205,210,0.9)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = -64; i < 128; i += 16) {
    ctx.moveTo(i, 0); ctx.lineTo(i + 64, 64);
    ctx.moveTo(i + 64, 0); ctx.lineTo(i, 64);
  }
  ctx.stroke();
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return (cache.fence = t);
}

export function foliageTexture(kind) {
  const key = 'fol' + kind;
  if (cache[key]) return cache[key];
  const S = 256;
  const n = fbm(S, 8, 4, kind === 'pine' ? 3 : 8);
  const c = canvas(S, S);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  seed = 61;
  for (let i = 0; i < S * S; i++) {
    const g = rnd();
    const t = n[i];
    const base = kind === 'pine' ? [0.07, 0.16, 0.08] : [0.12, 0.24, 0.07];
    const k = 0.55 + t * 0.9 + (g - 0.5) * 0.35;
    img.data[i * 4] = Math.min(255, base[0] * k * 255);
    img.data[i * 4 + 1] = Math.min(255, base[1] * k * 255);
    img.data[i * 4 + 2] = Math.min(255, base[2] * k * 255);
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return (cache[key] = tex(c, { aniso: 2 }));
}

export function rockTexture() {
  if (cache.rock) return cache.rock;
  const S = 256;
  const n = fbm(S, 6, 5, 21);
  const c = canvas(S, S);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  for (let i = 0; i < S * S; i++) {
    const v = n[i];
    const y = Math.floor(i / S);
    const strata = Math.sin(y * 0.15 + v * 6) * 0.05;
    img.data[i * 4] = (0.55 + v * 0.3 + strata) * 220;
    img.data[i * 4 + 1] = (0.38 + v * 0.25 + strata) * 220;
    img.data[i * 4 + 2] = (0.26 + v * 0.2 + strata) * 220;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return (cache.rock = { map: tex(c), normal: tex(normalFromHeight(n, S, S, 6), { srgb: false }) });
}

// ラリー用の路面（砂利・土・雪・氷・砂）。幅方向 u、長さ方向 1 タイル = 30m
const SURF_SPEC = {
  gravel: { base: [0.68, 0.59, 0.46], grain: 0.16, rut: 0.22, rough: 0.95, ridge: 0.08, normal: 3.2 },
  dirt: { base: [0.43, 0.3, 0.2], grain: 0.12, rut: 0.2, rough: 0.97, ridge: 0.06, normal: 2.4 },
  sand: { base: [0.95, 0.84, 0.64], grain: 0.07, rut: 0.13, rough: 0.98, ridge: 0.05, normal: 1.6 },
  snow: { base: [0.7, 0.74, 0.82], grain: 0.05, rut: 0.22, rough: 0.75, ridge: 0.05, normal: 1.4, cool: true },
  cobble: { base: [0.5, 0.47, 0.43], grain: 0.08, rut: 0.0, rough: 0.8, ridge: 0.0, normal: 4, stones: true },
  ice: { base: [0.2, 0.24, 0.3], grain: 0.05, rut: 0.05, rough: 0.12, ridge: 0.0, normal: 0.6, cool: true, cracks: true },
};
export function surfaceTextures(kind) {
  const key = 'surf' + kind;
  if (cache[key]) return cache[key];
  const sp = SURF_SPEC[kind];
  const W = 512, H = 1024;
  const n1 = fbm(256, 8, 5, 41 + kind.length);
  const n2 = fbm(256, 32, 3, 77);
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(W, H);
  const height = new Float32Array(W * H);
  const rough = canvas(W, H);
  const rctx = rough.getContext('2d');
  const rimg = rctx.createImageData(W, H);
  seed = 9001 + kind.length * 17;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const u = x / W;
      const macro = n1[((y >> 2) % 256) * 256 + ((x >> 1) % 256)];
      const fine = n2[((y >> 2) % 256) * 256 + ((x >> 1) % 256)];
      const g = rnd();
      // 轍（わだち）は左右 2 本、中央は盛り上がって明るい
      const rutL = Math.exp(-((u - 0.3) ** 2) / 0.0025), rutR = Math.exp(-((u - 0.7) ** 2) / 0.0025);
      const rut = Math.max(rutL, rutR);
      const ridge = Math.exp(-((u - 0.5) ** 2) / 0.006);
      let k = 1 + (macro - 0.5) * 0.35 + (fine - 0.5) * sp.grain * 2 + (g - 0.5) * sp.grain - rut * sp.rut + ridge * sp.ridge;
      if (kind === 'snow') k += rut * 0.0 - (rut > 0.5 ? 0.0 : 0);
      let r = sp.base[0] * k, gg = sp.base[1] * k, b = sp.base[2] * k;
      let ro = sp.rough - rut * (kind === 'snow' || kind === 'ice' ? 0.25 : 0.05);
      if (sp.stones) {
        // 石畳: ずらして並べた石。目地は暗く低い
        const sz = 22, row = Math.floor(y / sz), cx = (x + (row % 2) * (sz / 2)) % sz, cy = y % sz;
        const id = row * 97 + Math.floor((x + (row % 2) * (sz / 2)) / sz);
        const tone = 0.82 + ((Math.sin(id * 12.9898) * 43758.5453) % 1 + 1) % 1 * 0.36;
        const edge = Math.min(cx, sz - cx, cy, sz - cy);
        const gap = edge < 2.2;
        r *= gap ? 0.45 : tone; gg *= gap ? 0.45 : tone; b *= gap ? 0.45 : tone;
        height[i] = gap ? 0 : Math.min(1, edge / 6) + g * 0.1;
        ro = gap ? 0.95 : 0.7;
      }
      if (sp.cracks) {
        const cr = Math.abs(Math.sin((x + macro * 140) * 0.05) * Math.sin((y + fine * 90) * 0.04));
        if (cr < 0.03) { r += 0.35; gg += 0.38; b += 0.45; ro = 0.3; }
      }
      img.data[i * 4] = Math.max(0, Math.min(255, r * 255));
      img.data[i * 4 + 1] = Math.max(0, Math.min(255, gg * 255));
      img.data[i * 4 + 2] = Math.max(0, Math.min(255, b * 255));
      img.data[i * 4 + 3] = 255;
      rimg.data[i * 4 + 1] = Math.max(0, Math.min(255, ro * 255));
      rimg.data[i * 4 + 3] = 255;
      if (!sp.stones) height[i] = g * 0.5 + macro * 0.3 + fine * 0.3 - rut * 0.5 + ridge * 0.2;
    }
  }
  ctx.putImageData(img, 0, 0);
  rctx.putImageData(rimg, 0, 0);
  return (cache[key] = { map: tex(c, { aniso: 16 }), normal: tex(normalFromHeight(height, W, H, sp.normal), { srgb: false, aniso: 16 }), rough: tex(rough, { srgb: false, aniso: 16 }) });
}

export function bannerTextureText(text, bg = '#d01818', fg = '#ffffff') {
  const key = 'bt' + text + bg + fg;
  if (cache[key]) return cache[key];
  const c = canvas(1024, 160);
  const ctx = c.getContext('2d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 1024, 160);
  // 縁取りのチェッカー
  for (let x = 0; x < 1024; x += 32) {
    ctx.fillStyle = (x / 32) % 2 ? '#111' : '#fff';
    ctx.fillRect(x, 0, 32, 14);
    ctx.fillStyle = (x / 32) % 2 ? '#fff' : '#111';
    ctx.fillRect(x, 146, 32, 14);
  }
  ctx.fillStyle = fg;
  ctx.font = 'italic 900 96px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 512, 84);
  return (cache[key] = tex(c));
}

