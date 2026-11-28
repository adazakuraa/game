import type { FishLayout } from './models';

import { mulberry32 } from '../utils/noise';

/** Painting context for a creature texture. U/V map model space to canvas pixels. */
export class Paint {
  readonly c: HTMLCanvasElement;
  readonly g: CanvasRenderingContext2D;
  readonly W: number;
  readonly H: number;
  rnd = mulberry32(42);
  /** Look.sheen, kept for buildMesh (applied by sheenMask after the species' painter has run) */
  sheen?: number;
  constructor(w: number, h: number, public fish?: FishLayout) {
    this.c = document.createElement('canvas');
    this.c.width = this.W = w;
    this.c.height = this.H = h;
    this.g = this.c.getContext('2d')!;
  }
  // ---- fish side projection
  U(z: number): number {
    const f = this.fish!;
    return ((z - f.zMin) / (f.zMax - f.zMin)) * this.W;
  }
  V(y: number): number {
    const f = this.fish!;
    return (1 - (y + f.yMax) / (2 * f.yMax)) * this.H;
  }
  /** Body silhouette path (fish). Pad expands slightly to avoid seams. */
  body(pad = 1.04): Path2D {
    const f = this.fish!;
    const p = new Path2D();
    const H = f.shape.H;
    const n = 40;
    const mid = f.mid ?? (() => 0);
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const y = (H / 2) * f.env(t) * f.top(t) * pad + mid(t);
      const x = this.U(t - 0.5);
      if (i === 0) p.moveTo(x, this.V(y));
      else p.lineTo(x, this.V(y));
    }
    for (let i = n; i >= 0; i--) {
      const t = i / n;
      const y = -(H / 2) * f.env(t) * pad * (1 + (f.shape.belly ?? 0.08) * 0.4) + mid(t);
      p.lineTo(this.U(t - 0.5), this.V(y));
    }
    p.closePath();
    return p;
  }
  fill(color: string) {
    this.g.fillStyle = color;
    this.g.fillRect(0, 0, this.W, this.H);
  }
  /** Countershaded body: dark back -> light belly. */
  shade(top: string, mid: string, belly: string, midAt = 0.5) {
    const f = this.fish!;
    const gr = this.g.createLinearGradient(0, this.V(f.shape.H / 2), 0, this.V(-f.shape.H / 2));
    gr.addColorStop(0, top);
    gr.addColorStop(midAt, mid);
    gr.addColorStop(1, belly);
    this.g.save();
    this.g.clip(this.body());
    this.g.fillStyle = gr;
    this.g.fillRect(0, 0, this.W, this.H);
    this.g.restore();
  }
  clipBody(fn: () => void) {
    this.g.save();
    this.g.clip(this.body());
    fn();
    this.g.restore();
  }
  /** Vertical band between z0..z1 (model space), optional soft edges. */
  band(z0: number, z1: number, color: string, edge?: string, edgeW = 0.012) {
    this.clipBody(() => {
      if (edge) {
        this.g.fillStyle = edge;
        this.g.fillRect(this.U(z0 - edgeW), 0, this.U(z1 + edgeW) - this.U(z0 - edgeW), this.H);
      }
      this.g.fillStyle = color;
      this.g.fillRect(this.U(z0), 0, this.U(z1) - this.U(z0), this.H);
    });
  }
  /** Curved band following body height (like clownfish bars). */
  bar(z: number, w: number, color: string, edge?: string, bow = 0.03) {
    this.clipBody(() => {
      const draw = (ww: number, col: string) => {
        this.g.fillStyle = col;
        this.g.beginPath();
        const yT = this.V(0.6), yB = this.V(-0.6);
        this.g.moveTo(this.U(z - ww / 2), yT);
        this.g.quadraticCurveTo(this.U(z - ww / 2 + bow), (yT + yB) / 2, this.U(z - ww / 2), yB);
        this.g.lineTo(this.U(z + ww / 2), yB);
        this.g.quadraticCurveTo(this.U(z + ww / 2 + bow), (yT + yB) / 2, this.U(z + ww / 2), yT);
        this.g.fill();
      };
      if (edge) draw(w + 0.025, edge);
      draw(w, color);
    });
  }
  spots(n: number, r0: number, r1: number, color: string, region?: [number, number, number, number], clip = true) {
    const doit = () => {
      for (let i = 0; i < n; i++) {
        const z = region ? region[0] + this.rnd() * (region[1] - region[0]) : this.rnd() - 0.5;
        const y = region ? region[2] + this.rnd() * (region[3] - region[2]) : (this.rnd() - 0.5) * 0.6;
        const r = (r0 + this.rnd() * (r1 - r0)) * this.W;
        this.g.fillStyle = color;
        this.g.beginPath();
        this.g.arc(this.U(z), this.V(y), r, 0, Math.PI * 2);
        this.g.fill();
      }
    };
    if (clip && this.fish) this.clipBody(doit);
    else doit();
  }
  /** Fine scale texture (lighten/darken crosshatch). */
  scales(alpha = 0.12, size = 4) {
    this.clipBody(() => {
      this.g.globalAlpha = alpha;
      this.g.strokeStyle = '#000';
      this.g.lineWidth = 0.6;
      for (let y = 0; y < this.H; y += size) {
        for (let x = (y / size) % 2 ? size / 2 : 0; x < this.W; x += size) {
          this.g.beginPath();
          this.g.arc(x, y, size * 0.55, 0.2 * Math.PI, 0.8 * Math.PI);
          this.g.stroke();
        }
      }
      this.g.globalAlpha = 1;
    });
  }
  eye(rel = 0.09, iris = '#c8a030') {
    const f = this.fish!;
    const t = f.shape.eyeT ?? 0.86;
    const x = this.U(t - 0.5);
    // v2: the painted eye sits where the eye cap is (the old painter ignored the hump)
    const y = this.V((f.shape.H / 2) * f.env(t) * (f.v2 ? f.top(t) : 1) * 0.22 + (f.mid?.(t) ?? 0));
    const r = Math.max(2.5, ((f.shape.eyes ?? rel) * f.shape.H * this.H) / (2 * f.yMax));
    this.g.fillStyle = iris;
    this.g.beginPath();
    this.g.arc(x, y, r * 1.25, 0, Math.PI * 2);
    this.g.fill();
    this.g.fillStyle = '#050505';
    this.g.beginPath();
    this.g.arc(x, y, r * 0.85, 0, Math.PI * 2);
    this.g.fill();
    this.g.fillStyle = 'rgba(255,255,255,0.85)';
    this.g.beginPath();
    this.g.arc(x + r * 0.3, y - r * 0.3, r * 0.25, 0, Math.PI * 2);
    this.g.fill();
  }
  mouth(color = 'rgba(40,20,20,0.7)', len = 0.04) {
    const f = this.fish!;
    const y = this.V(f.mouthY ?? -f.shape.H * 0.05);
    this.g.strokeStyle = color;
    this.g.lineWidth = 1.5;
    this.g.beginPath();
    this.g.moveTo(this.U(0.5), y);
    this.g.lineTo(this.U(0.5 - len), y + 1);
    this.g.stroke();
  }
  gill(color = 'rgba(0,0,0,0.25)', t = 0.76) {
    const f = this.fish!;
    const x = this.U(t - 0.5);
    const h = (f.shape.H / 2) * f.env(t);
    this.g.strokeStyle = color;
    this.g.lineWidth = 1.4;
    this.g.beginPath();
    this.g.moveTo(x, this.V(h * 0.7));
    this.g.quadraticCurveTo(x - 6, this.V(0), x, this.V(-h * 0.7));
    this.g.stroke();
  }
  noise(alpha: number, dark = true, clip = true) {
    const doit = () => {
      for (let i = 0; i < this.W * this.H * 0.04; i++) {
        this.g.fillStyle = dark ? `rgba(0,0,0,${this.rnd() * alpha})` : `rgba(255,255,255,${this.rnd() * alpha})`;
        this.g.fillRect(this.rnd() * this.W, this.rnd() * this.H, 1 + this.rnd() * 2, 1 + this.rnd() * 2);
      }
    };
    if (clip && this.fish) this.clipBody(doit);
    else doit();
  }
  /**
   * §3.4: silver parts (lower flank and belly) marked in the alpha channel, 1 − 0.5 × sheen (kept ≥ 0.5 so the colour
   * survives the canvas's premultiplied alpha). The material is opaque; the §5.2 sheen term reads it.
   */
  sheenMask(k: number) {
    if (!this.fish || k <= 0) return;
    const f = this.fish;
    const g = this.g;
    g.save();
    g.clip(this.body());
    g.globalCompositeOperation = 'destination-out';
    const gr = g.createLinearGradient(0, this.V(f.shape.H * 0.15), 0, this.V(-f.shape.H * 0.4));
    gr.addColorStop(0, 'rgba(0,0,0,0)');
    gr.addColorStop(1, `rgba(0,0,0,${(0.5 * Math.min(1, k)).toFixed(3)})`);
    g.fillStyle = gr;
    g.fillRect(0, 0, this.W, this.H);
    g.restore();
  }
  /** Mottled blotches anywhere. */
  blotch(n: number, r0: number, r1: number, colors: string[], clip = false) {
    const doit = () => {
      for (let i = 0; i < n; i++) {
        this.g.fillStyle = colors[Math.floor(this.rnd() * colors.length)];
        this.g.beginPath();
        this.g.ellipse(this.rnd() * this.W, this.rnd() * this.H, r0 + this.rnd() * (r1 - r0), (r0 + this.rnd() * (r1 - r0)) * 0.7, this.rnd() * 3, 0, Math.PI * 2);
        this.g.fill();
      }
    };
    if (clip && this.fish) this.clipBody(doit);
    else doit();
  }
}

/** Declarative fish livery, painted over the side-projection texture. y values are fractions of body height H. */
export type Look = {
  c: [string, string, string]; // back, flank, belly
  mid?: number; // where the flank colour sits (0..1, top->belly)
  fin?: string; // all fins
  tail?: string; // caudal fin colour
  dorsal?: string; // tint for everything above the body (dorsal fins)
  anal?: string; // tint for everything below the body
  front?: [number, string]; // head region (z > value) colour
  rear?: [number, string]; // body behind z
  bars?: [number, number, string, string?][]; // vertical bands: z, width, colour, edge
  hl?: [number, number, string, number?, number?][]; // horizontal stripes: y, height, colour, z0, z1
  lines?: { n: number; color: string; w?: number; ang?: number; y0?: number; y1?: number };
  spots?: [number, number, number, string, [number, number, number, number]?][]; // n, r0, r1 (fraction of W), colour, region
  ocel?: [number, number, number, string, string?][]; // eye-spots: z, y, radius(px), colour, ring
  eyeBar?: string;
  net?: string; // reticulated network
  saddle?: [number, number, string][]; // dorsal saddles z, w, colour
  scales?: number;
  noise?: number;
  iris?: string;
  snout?: string;
  blotch?: [number, string[]];
  /** §3.4 (model v2): lateral line (default: body plans with scaleN ≥ 40), fin margin colour, silver sheen 0..1
   *  (default from the material's metalness) */
  lateral?: boolean;
  finEdge?: string;
  sheen?: number;
};

export function paintLook(p: Paint, L: Look): void {
  const f = p.fish!;
  const H = f.shape.H;
  const g = p.g;
  const v2 = !!f.v2;
  p.fill(L.fin ?? L.c[1]);
  if (L.dorsal) { g.fillStyle = L.dorsal; g.fillRect(0, 0, p.W, p.V(H * 0.3)); }
  if (L.anal) { g.fillStyle = L.anal; g.fillRect(0, p.V(-H * 0.3), p.W, p.H); }
  if (L.tail) { g.fillStyle = L.tail; g.fillRect(0, 0, p.U(-0.47), p.H); }
  if (v2) {
    // §3.4: soft rays along each fin's grid columns and the margin colour (the body paints over the roots)
    const lw = Math.max(1, p.W / 256);
    for (const fin of f.fins ?? []) {
      g.strokeStyle = 'rgba(0,0,0,0.13)';
      g.lineWidth = lw;
      for (let k = 0; k < fin.root.length; k++) {
        g.beginPath();
        g.moveTo(p.U(fin.root[k][0]), p.V(fin.root[k][1]));
        g.lineTo(p.U(fin.edge[k][0]), p.V(fin.edge[k][1]));
        g.stroke();
      }
      if (L.finEdge) {
        g.strokeStyle = L.finEdge;
        g.lineWidth = lw * 3;
        g.beginPath();
        fin.edge.forEach(([z, y], k) => (k ? g.lineTo(p.U(z), p.V(y)) : g.moveTo(p.U(z), p.V(y))));
        g.stroke();
      }
    }
  }
  p.shade(L.c[0], L.c[1], L.c[2], L.mid ?? 0.5);
  p.clipBody(() => {
    if (L.front) { g.fillStyle = L.front[1]; g.fillRect(p.U(L.front[0]), 0, p.W, p.H); }
    if (L.rear) {
      const gr = g.createLinearGradient(p.U(L.rear[0] + 0.04), 0, p.U(L.rear[0] - 0.04), 0);
      gr.addColorStop(0, 'rgba(0,0,0,0)');
      gr.addColorStop(1, L.rear[1]);
      g.fillStyle = gr;
      g.fillRect(0, 0, p.U(L.rear[0] + 0.04), p.H);
    }
    if (L.net) {
      g.strokeStyle = L.net; g.lineWidth = 1.6;
      for (let i = 0; i < 120; i++) {
        const x = p.rnd() * p.W, y = p.rnd() * p.H, r = 4 + p.rnd() * 5;
        g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke();
      }
    }
    if (L.lines) {
      const l = L.lines;
      g.strokeStyle = l.color; g.lineWidth = l.w ?? 1.6;
      const ang = ((l.ang ?? 0) * Math.PI) / 180;
      const y0 = l.y0 ?? 0.45, y1 = l.y1 ?? -0.45;
      for (let i = 0; i < l.n; i++) {
        const y = p.V(H * (y0 + ((y1 - y0) * (i + 0.5)) / l.n));
        g.beginPath();
        g.moveTo(-20, y + Math.tan(ang) * (p.W / 2 + 20));
        g.lineTo(p.W + 20, y - Math.tan(ang) * (p.W / 2 + 20));
        g.stroke();
      }
    }
    for (const [y, h, col, z0, z1] of L.hl ?? []) {
      g.fillStyle = col;
      const a = p.U(z0 ?? -0.55), b = p.U(z1 ?? 0.55);
      g.fillRect(a, p.V(H * (y + h / 2)), b - a, p.V(H * (y - h / 2)) - p.V(H * (y + h / 2)));
    }
  });
  for (const [z, w, col, edge] of L.bars ?? []) p.bar(z, w, col, edge);
  for (const [z, w, col] of L.saddle ?? []) {
    p.clipBody(() => { g.fillStyle = col; g.beginPath(); g.ellipse(p.U(z), p.V(H * 0.5), (p.U(w) - p.U(0)), p.V(0) - p.V(H * 0.32), 0, 0, Math.PI * 2); g.fill(); });
  }
  for (const [n, r0, r1, col, reg] of L.spots ?? []) {
    p.spots(n, r0, r1, col, reg ? [reg[0], reg[1], reg[2] * H, reg[3] * H] : [-0.5, 0.5, -H * 0.5, H * 0.5]);
  }
  if (L.blotch) p.blotch(L.blotch[0], 2, 7, L.blotch[1], true);
  for (const [z, y, r, col, ring] of L.ocel ?? []) {
    if (ring) { g.fillStyle = ring; g.beginPath(); g.arc(p.U(z), p.V(H * y), r * 1.45, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = col; g.beginPath(); g.arc(p.U(z), p.V(H * y), r, 0, Math.PI * 2); g.fill();
  }
  if (L.eyeBar) {
    const t = f.shape.eyeT ?? 0.86;
    p.bar(t - 0.5, 0.05, L.eyeBar, undefined, 0.01);
  }
  if (L.snout) p.clipBody(() => { g.fillStyle = L.snout!; g.fillRect(p.U(0.42), 0, p.W, p.H); });
  if (v2) {
    // §3.4: pattern edges blur a little (0.3 % of the texture width), as real markings do — one blurred copy of the
    // body over itself (cheaper than a filter on every band and spot); scales, noise and the eye stay sharp
    p.clipBody(() => {
      g.filter = `blur(${Math.max(0.6, p.W * 0.003).toFixed(2)}px)`;
      g.drawImage(p.c, 0, 0);
      g.filter = 'none';
    });
  }
  p.scales(Math.min(L.scales ?? 0.035, 0.06), Math.max(4, Math.round(p.W / 64)));
  p.noise(L.noise ?? 0.05);
  if (v2) {
    // §3.4 lateral line: a fine pale line following the back's curve, from the gill cover to the tail root
    if (L.lateral ?? (f.shape.scaleN ?? 48) >= 40) {
      p.clipBody(() => {
        g.strokeStyle = 'rgba(255,255,255,0.2)';
        g.lineWidth = Math.max(1, p.W / 300);
        g.beginPath();
        const t1 = f.gillT ?? 0.76;
        for (let i = 0; i <= 24; i++) {
          const t = 0.04 + ((t1 - 0.04) * i) / 24;
          const y = (H / 2) * f.env(t) * f.top(t) * (0.42 + 0.2 * (t / t1)) + (f.mid?.(t) ?? 0);
          if (i) g.lineTo(p.U(t - 0.5), p.V(y)); else g.moveTo(p.U(t - 0.5), p.V(y));
        }
        g.stroke();
      });
    }
    // §3.3: the gill cover edge and the mouth line
    p.gill('rgba(0,0,0,0.17)', f.gillT ?? 0.76);
    p.mouth('rgba(30,15,15,0.55)', 0.035);
  }
  p.eye(f.shape.eyes ?? 0.1, L.iris ?? '#2a2a20');
  if (L.sheen !== undefined) p.sheen = L.sheen;
}

// --------------------------------------------------------------------------- 海生哺乳類（F12a、mammals.ts の体用）

/**
 * 海生哺乳類の塗り。横から見た投影の画像に、背→脇→腹のグラデーション（カウンターシェーディング）と種ごとの模様を描く。
 * ひれ・肢・ひげは画像の左上隅の「色見本」（MAM_PATCH）に UV を向けてあるので、その色もここで塗る。
 */
export type MammalLook = {
  back: string; flank?: string; belly: string; mid?: number;
  /** 胸びれ・肢・耳・ひげの色見本：limb、尾びれ：fluke、ひげ：pale */
  limb: string; fluke?: string; pale?: string; iris?: string;
  noise?: number;
  /** 背の濃い色の帯（イルカのケープ）：色。脇の下がりは背びれの後ろで深くなる */
  cape?: string;
  /** 目から胸びれへの濃い筋（イルカ） */
  stripe?: string;
  /** 腹の白（シャチ・ザトウ・ミンク）：境界線の高さ（体の中心線から、上は top × k、下は bot × k）と尾側のこぶ */
  white?: { color: string; k: number; lobe?: number; t0?: number; soft?: boolean };
  /** シャチの目の白い斑とサドルパッチ */
  eyePatch?: string;
  saddle?: string;
  /** 小さな点・傷・しわ：n, 半径（画像の幅比）、色 */
  spots?: [number, number, string][];
  scars?: [number, string];
  wrinkles?: string;
  /** ヒゲクジラの腹の畝（色） */
  pleats?: string;
  /** 頭だけの色（ラッコの白っぽい頭）：t 以降 */
  head?: [number, string];
  mouthColor?: string;
};

export function paintMammal(p: Paint, L: MammalLook): void {
  const f = p.fish!;
  const m = f.mam!;
  const g = p.g;
  const B = m.body;
  const yAt = (t: number, k: number) => B.cy(t) + (k >= 0 ? k * B.top(t) : k * B.bot(t));
  p.fill(L.back);
  p.shade(L.back, L.flank ?? L.back, L.belly, L.mid ?? 0.55);
  const zOf = (t: number) => p.U(t - 0.5);
  const poly = (pts: [number, number][]) => { g.beginPath(); pts.forEach(([t, y], i) => (i ? g.lineTo(zOf(t), p.V(y)) : g.moveTo(zOf(t), p.V(y)))); g.closePath(); g.fill(); };
  const tt = (a: number, b: number, n = 24) => Array.from({ length: n + 1 }, (_, i) => a + ((b - a) * i) / n);
  p.clipBody(() => {
    if (L.head) { g.fillStyle = L.head[1]; g.fillRect(zOf(L.head[0]), 0, p.W, p.H); }
    if (L.cape) {
      for (const [w, al] of [[0.08, 0.35], [0.0, 0.55]] as const) {
        g.fillStyle = L.cape; g.globalAlpha = al;
        const kb = (t: number) => 0.3 - 0.5 * Math.exp(-(((t - 0.32) / 0.15) ** 2)) - w;
        poly([...tt(B.t0, 1).map((t) => [t, yAt(t, 1.2)] as [number, number]), ...tt(1, B.t0).map((t) => [t, yAt(t, kb(t))] as [number, number])]);
        g.globalAlpha = 1;
      }
    }
    if (L.white) {
      const w = L.white;
      const kb = (t: number) => w.k + (w.lobe ?? 0) * Math.exp(-(((t - 0.28) / 0.09) ** 2));
      const ts = tt(w.t0 ?? B.t0, 1);
      const draw = (dk: number, al: number) => {
        g.fillStyle = w.color; g.globalAlpha = al;
        poly([...ts.map((t) => [t, yAt(t, kb(t) + dk)] as [number, number]), [1, yAt(1, -2)], [w.t0 ?? B.t0, yAt(w.t0 ?? B.t0, -2)]]);
        g.globalAlpha = 1;
      };
      if (w.soft) { draw(0.12, 0.3); draw(0.05, 0.5); }
      draw(0, 1);
    }
    if (L.saddle) { g.fillStyle = L.saddle; g.beginPath(); g.ellipse(zOf(0.34), p.V(yAt(0.34, 0.75)), p.U(0.04) - p.U(0), p.V(0) - p.V(B.top(0.34) * 0.5), 0, 0, Math.PI * 2); g.fill(); }
    if (L.eyePatch) { g.fillStyle = L.eyePatch; g.beginPath(); g.ellipse(zOf(m.eye.t - 0.045), p.V(m.eye.y + 0.012), p.U(0.04) - p.U(0), p.V(0) - p.V(0.011), -0.25, 0, Math.PI * 2); g.fill(); }
    if (L.stripe) {
      g.strokeStyle = L.stripe; g.lineWidth = Math.max(2, p.H * 0.02); g.lineCap = 'round';
      g.beginPath(); g.moveTo(zOf(m.eye.t), p.V(m.eye.y - 0.004));
      g.quadraticCurveTo(zOf(m.eye.t - 0.12), p.V(m.eye.y - 0.025), zOf(0.72), p.V(yAt(0.72, -0.3)));
      g.stroke();
    }
    for (const [n, r, col] of L.spots ?? []) {
      g.fillStyle = col;
      for (let i = 0; i < n; i++) {
        const t = B.t0 + p.rnd() * (1 - B.t0);
        const y = yAt(t, (p.rnd() * 2 - 1) * 0.95);
        g.beginPath(); g.ellipse(zOf(t), p.V(y), r * p.W * (0.6 + p.rnd() * 0.8), r * p.W * (0.5 + p.rnd() * 0.7), p.rnd() * 3, 0, Math.PI * 2); g.fill();
      }
    }
    if (L.scars) {
      g.strokeStyle = L.scars[1]; g.lineWidth = Math.max(1, p.W / 400);
      for (let i = 0; i < L.scars[0]; i++) {
        const t = 0.25 + p.rnd() * 0.7, k = (p.rnd() * 2 - 1) * 0.7, a = p.rnd() * Math.PI;
        const x = zOf(t), y = p.V(yAt(t, k)), l = p.W * (0.012 + p.rnd() * 0.03);
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l * 0.5); g.stroke();
      }
    }
    if (L.wrinkles) {
      g.strokeStyle = L.wrinkles; g.lineWidth = Math.max(1, p.W / 500);
      for (let i = 0; i < 70; i++) {
        const t = 0.1 + p.rnd() * 0.88, k = (p.rnd() * 2 - 1) * 0.9;
        const x = zOf(t), y = p.V(yAt(t, k)), l = p.W * (0.015 + p.rnd() * 0.04);
        g.beginPath(); g.moveTo(x, y); g.bezierCurveTo(x + l * 0.3, y - 3, x + l * 0.6, y + 3, x + l, y); g.stroke();
      }
    }
    if (L.pleats && m.groove) {
      g.strokeStyle = L.pleats; g.lineWidth = Math.max(1, p.H / 180); g.globalAlpha = 0.55;
      for (let i = 0; i < 9; i++) {
        const k = -0.25 - i * 0.085;
        g.beginPath();
        tt(m.groove[0], m.groove[1], 20).forEach((t, j) => (j ? g.lineTo(zOf(t), p.V(yAt(t, k))) : g.moveTo(zOf(t), p.V(yAt(t, k)))));
        g.stroke();
      }
      g.globalAlpha = 1;
    }
  });
  p.noise(L.noise ?? 0.08);
  // 目：描いた位置に球の見える面が合う（mammals.ts の eyeCap の UV）
  {
    const e = m.eye;
    const rx = e.r * 1.25 * (p.W / (f.zMax - f.zMin)), ry = e.r * 1.25 * (p.H / (2 * f.yMax));
    const ex = p.U(e.t - 0.5), ey = p.V(e.y);
    g.fillStyle = L.iris ?? '#2a1c14';
    g.beginPath(); g.ellipse(ex, ey, rx, ry, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#050505';
    g.beginPath(); g.ellipse(ex, ey, rx * 0.68, ry * 0.68, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.beginPath(); g.ellipse(ex + rx * 0.25, ey - ry * 0.25, rx * 0.18, ry * 0.18, 0, 0, Math.PI * 2); g.fill();
  }
  // 口の線と噴気孔・鼻
  p.clipBody(() => {
    g.strokeStyle = L.mouthColor ?? 'rgba(25,15,15,0.7)'; g.lineWidth = Math.max(1.4, p.H / 150); g.lineCap = 'round';
    g.beginPath();
    tt(m.mouth.t1, 1, 12).forEach((t, i) => (i ? g.lineTo(zOf(t), p.V(m.mouth.y(t))) : g.moveTo(zOf(t), p.V(m.mouth.y(t)))));
    g.stroke();
    if (m.blow) { g.fillStyle = 'rgba(10,10,12,0.8)'; g.beginPath(); g.ellipse(zOf(m.blow.t), p.V(m.blow.y - 0.003), p.W * 0.012, p.H * 0.014, 0, 0, Math.PI * 2); g.fill(); }
    if (m.nose) { g.fillStyle = '#16120f'; g.beginPath(); g.ellipse(zOf(0.992), p.V(m.nose.y), p.W * 0.014, p.H * 0.04, 0, 0, Math.PI * 2); g.fill(); }
  });
  // 色見本：ひれ・肢・尾びれ・ひげ（左上隅）
  const cols = [L.limb, L.fluke ?? L.back, L.pale ?? '#d8d4c8'];
  cols.forEach((c, k) => { g.fillStyle = c; g.fillRect(Math.floor(p.W * MAM_PATCH_W * k), 0, Math.ceil(p.W * MAM_PATCH_W), Math.ceil(p.H * MAM_PATCH_H)); });
}
const MAM_PATCH_W = 0.03;
const MAM_PATCH_H = 0.07;

/** 種類ごとの標準の塗り。species 側は kind と、色などの上書きだけ渡す */
export const MAM_LOOK: Record<string, MammalLook> = {
  dolphin: { back: '#4a545e', flank: '#7a8690', belly: '#e2e6e8', mid: 0.55, limb: '#5a646e', fluke: '#4a545e', cape: '#3a4248', stripe: 'rgba(40,46,52,0.75)', noise: 0.05 },
  orca: { back: '#0e0e10', flank: '#121214', belly: '#161618', mid: 0.6, limb: '#101012', fluke: '#101012', white: { color: '#f2f2ee', k: -0.42, lobe: 0.7, t0: 0.12 }, eyePatch: '#f2f2ee', saddle: 'rgba(160,160,160,0.6)', noise: 0.04 },
  humpback: { back: '#14181c', flank: '#1e2428', belly: '#2e3236', mid: 0.7, limb: '#e4e8e8', fluke: '#2a2e32', white: { color: '#dadede', k: -0.5, soft: true, t0: 0.4 }, spots: [[40, 0.004, 'rgba(210,210,210,0.55)']], pleats: 'rgba(40,44,48,0.8)', noise: 0.12 },
  minke: { back: '#2a2e34', flank: '#3a3e44', belly: '#e0e2e4', mid: 0.62, limb: '#4a4e54', fluke: '#2a2e34', pleats: 'rgba(120,124,130,0.6)', noise: 0.06 },
  blue: { back: '#5e6e7c', flank: '#7a8a98', belly: '#a8b4c0', mid: 0.55, limb: '#7a8a98', fluke: '#5e6e7c', spots: [[160, 0.006, 'rgba(180,196,208,0.4)'], [90, 0.005, 'rgba(60,76,90,0.35)']], pleats: 'rgba(100,112,124,0.6)', noise: 0.06 },
  sperm: { back: '#3a3634', flank: '#46423e', belly: '#5a5652', mid: 0.6, limb: '#3a3634', fluke: '#3a3634', wrinkles: 'rgba(20,18,16,0.35)', mouthColor: 'rgba(210,204,196,0.8)', noise: 0.12 },
  dugong: { back: '#7a7468', flank: '#948e82', belly: '#b0aaa0', mid: 0.5, limb: '#7a7468', fluke: '#6e685c', spots: [[24, 0.003, 'rgba(60,54,46,0.4)']], noise: 0.1 },
  seal: { back: '#8a8c86', flank: '#a8aaa4', belly: '#c8c8c0', mid: 0.55, limb: '#6a6c66', fluke: '#8a8c86', spots: [[150, 0.006, 'rgba(40,42,40,0.7)']], noise: 0.06 },
  sealion: { back: '#4a3624', flank: '#5a4430', belly: '#7a6448', mid: 0.55, limb: '#3a2a1c', fluke: '#4a3624', noise: 0.07 },
  furseal: { back: '#3a2e24', flank: '#4a3c2e', belly: '#6a5a46', mid: 0.55, limb: '#2a2018', fluke: '#3a2e24', noise: 0.07 },
  steller: { back: '#7a5a34', flank: '#8e6a40', belly: '#a88458', mid: 0.55, limb: '#5a4024', fluke: '#7a5a34', noise: 0.07 },
  otter: { back: '#4a3626', flank: '#5a4430', belly: '#6a5238', mid: 0.7, limb: '#3a2a1c', fluke: '#4a3626', head: [0.82, '#cdbca2'], pale: '#e0d6c4', noise: 0.08 },
};
