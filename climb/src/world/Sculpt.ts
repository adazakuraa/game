import * as THREE from 'three';

/**
 * Small procedural sculpting kit. Organic forms (a dog's body, a tail, a noodle, a cup) are
 * "continuous-sculpt" / "fiber-strand" surfaces: they are swept or lathed from profiles, never
 * stacked out of boxes and spheres. Everything here is code-only and cheap enough for phones.
 */

export interface Section {
  /** centre of the cross-section */
  p: THREE.Vector3;
  /** half-width (sideways) */
  w: number;
  /** half-height above / below the centre (lets a chest be deep and a back flat) */
  up: number;
  down: number;
}

/**
 * Sweep elliptical cross-sections along a spine. Parameters between key sections are
 * Catmull-Rom interpolated so the surface stays smooth (no visible joints). Ends are capped
 * by collapsing to a point when the end section has ~zero size.
 * UVs: u along the spine (0..1), v around the ring (0..1).
 */
export function sweep(keys: Section[], steps: number, radial: number, up = new THREE.Vector3(0, 1, 0)): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(keys.map((k) => k.p), false, 'centripetal');
  const lerpKey = (t: number, f: (k: Section) => number): number => {
    // Catmull-Rom on scalar params, indexed like the curve's points
    const n = keys.length - 1;
    const x = t * n;
    const i = Math.min(n - 1, Math.floor(x));
    const u = x - i;
    const p0 = f(keys[Math.max(0, i - 1)]), p1 = f(keys[i]), p2 = f(keys[i + 1]), p3 = f(keys[Math.min(n, i + 2)]);
    const u2 = u * u, u3 = u2 * u;
    return Math.max(0, 0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (-p0 + 3 * p1 - 3 * p2 + p3) * u3));
  };
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const T = new THREE.Vector3(), N = new THREE.Vector3(), B = new THREE.Vector3(), P = new THREE.Vector3();
  let prevN: THREE.Vector3 | null = null;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    curve.getPointAt(t, P);
    curve.getTangentAt(t, T).normalize();
    // side vector: keep it horizontal-ish and continuous (parallel transport light)
    B.crossVectors(T, up);
    if (B.lengthSq() < 1e-6) B.set(0, 0, 1);
    B.normalize();
    N.crossVectors(B, T).normalize();
    if (prevN && N.dot(prevN) < 0) { N.negate(); B.negate(); }
    prevN = N.clone();
    const w = lerpKey(t, (k) => k.w), hu = lerpKey(t, (k) => k.up), hd = lerpKey(t, (k) => k.down);
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const s = Math.sin(a), c = Math.cos(a);
      const h = s >= 0 ? hu : hd;
      // superellipse-ish: slightly fuller than an ellipse reads more like flesh than a tube
      const sx = Math.sign(c) * Math.pow(Math.abs(c), 0.85) * w;
      const sy = Math.sign(s) * Math.pow(Math.abs(s), 0.9) * h;
      pos.push(P.x + B.x * sx + N.x * sy, P.y + B.y * sx + N.y * sy, P.z + B.z * sx + N.z * sy);
      uv.push(t, j / radial);
    }
  }
  const row = radial + 1;
  for (let i = 0; i < steps; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * row + j, b = a + row;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A round strand along a curve whose radius follows r(t): tails, noodles, chopsticks. */
export function strand(points: THREE.Vector3[], r: (t: number) => number, steps: number, radial: number): THREE.BufferGeometry {
  const n = points.length;
  const keys: Section[] = points.map((p, i) => {
    const rr = r(i / (n - 1));
    return { p, w: rr, up: rr, down: rr };
  });
  return sweep(keys, steps, radial);
}

/** Lathe from a 2D profile (x = radius, y = height), with smooth normals. */
export function lathe(profile: [number, number][], segments: number): THREE.BufferGeometry {
  const g = new THREE.LatheGeometry(profile.map(([x, y]) => new THREE.Vector2(x, y)), segments);
  // v by height (not by profile point index) so printed labels land where they are painted
  const pos = g.getAttribute('position'), uv = g.getAttribute('uv');
  let y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < pos.count; i++) { y0 = Math.min(y0, pos.getY(i)); y1 = Math.max(y1, pos.getY(i)); }
  for (let i = 0; i < pos.count; i++) uv.setY(i, (pos.getY(i) - y0) / Math.max(1e-6, y1 - y0));
  g.computeVertexNormals();
  // Front faces must point away from the axis whatever order the profile was written in
  // (otherwise you see the far wall from inside: mirrored labels, inverted shading).
  const nrm = g.getAttribute('normal');
  let out = 0;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    out += Math.sign(x * nrm.getX(i) + z * nrm.getZ(i));
  }
  if (out < 0) {
    const idx = g.getIndex()!;
    for (let i = 0; i < idx.count; i += 3) { const a = idx.getX(i + 1); idx.setX(i + 1, idx.getX(i + 2)); idx.setX(i + 2, a); }
    idx.needsUpdate = true;
    g.computeVertexNormals();
  }
  return g;
}

/** Paint per-vertex colours from a function of position (coat patterns, soot, stains). */
export function paint(g: THREE.BufferGeometry, f: (p: THREE.Vector3, n: THREE.Vector3, uv: THREE.Vector2) => THREE.Color): THREE.BufferGeometry {
  const pos = g.getAttribute('position'), nrm = g.getAttribute('normal'), uvA = g.getAttribute('uv');
  const col = new Float32Array(pos.count * 3);
  const p = new THREE.Vector3(), n = new THREE.Vector3(), uv = new THREE.Vector2();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    n.fromBufferAttribute(nrm, i);
    if (uvA) uv.fromBufferAttribute(uvA as THREE.BufferAttribute, i); else uv.set(0, 0);
    const c = f(p, n, uv);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

// ---------------------------------------------------------------- textures
const texCache = new Map<string, THREE.Texture>();

function canvasTex(key: string, size: number, draw: (g: CanvasRenderingContext2D, s: number) => void, srgb = true, repeat = true): THREE.Texture {
  const hit = texCache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  draw(g, size);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = 4;
  texCache.set(key, t);
  return t;
}

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/**
 * Fur grain: thousands of short strokes running along u (the spine direction of a sweep),
 * light and dark, so the surface breaks highlights like a coat rather than plastic.
 * Grey-centred so it multiplies the vertex-colour coat pattern without tinting it.
 */
export function furTexture(): THREE.Texture {
  return canvasTex('fur', 512, (g, s) => {
    const r = rng(7);
    g.fillStyle = '#d6d6d6';
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < 9000; i++) {
      const x = r() * s, y = r() * s, len = 6 + r() * 16, v = 150 + r() * 105;
      g.strokeStyle = `rgba(${v},${v},${v},${0.35 + r() * 0.4})`;
      g.lineWidth = 0.8 + r() * 1.3;
      g.beginPath();
      g.moveTo(x, y);
      g.quadraticCurveTo(x + len * 0.5, y + (r() - 0.5) * 3, x + len, y + (r() - 0.5) * 4);
      g.stroke();
    }
  });
}

/** Height map for the fur strokes (independent channel: drives bump, not colour). */
export function furBump(): THREE.Texture {
  return canvasTex('furBump', 256, (g, s) => {
    const r = rng(11);
    g.fillStyle = '#808080';
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < 5000; i++) {
      const x = r() * s, y = r() * s, len = 4 + r() * 9, v = Math.floor(r() * 255);
      g.strokeStyle = `rgb(${v},${v},${v})`;
      g.lineWidth = 1;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + len, y + (r() - 0.5) * 2); g.stroke();
    }
  }, false);
}

export function woodTexture(): THREE.Texture {
  return canvasTex('wood', 256, (g, s) => {
    const r = rng(3);
    const grd = g.createLinearGradient(0, 0, s, 0);
    grd.addColorStop(0, '#d9b98a'); grd.addColorStop(1, '#cfae7c');
    g.fillStyle = grd; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 90; i++) {
      const y = r() * s;
      g.strokeStyle = `rgba(120,80,40,${0.08 + r() * 0.18})`;
      g.lineWidth = 0.5 + r() * 1.5;
      g.beginPath(); g.moveTo(0, y);
      for (let x = 0; x <= s; x += 16) g.lineTo(x, y + Math.sin(x * 0.03 + i) * 2);
      g.stroke();
    }
  });
}

/** Snow pad / packed snow with crystal glints. */
export function snowTexture(): THREE.Texture {
  return canvasTex('campSnow', 256, (g, s) => {
    const r = rng(21);
    g.fillStyle = '#e9eef4'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 2500; i++) {
      const v = 205 + r() * 50;
      g.fillStyle = `rgba(${v},${v + 3},${v + 8},0.5)`;
      g.fillRect(r() * s, r() * s, 1 + r() * 3, 1 + r() * 3);
    }
  });
}

export function makeTexture(key: string, size: number, draw: (g: CanvasRenderingContext2D, s: number) => void, srgb = true, repeat = false): THREE.Texture {
  return canvasTex(key, size, draw, srgb, repeat);
}
