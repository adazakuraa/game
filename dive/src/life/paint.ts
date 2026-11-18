import type { FishLayout } from './models';
import { mulberry32 } from '../utils/noise';

/** Painting context for a creature texture. U/V map model space to canvas pixels. */
export class Paint {
  readonly c: HTMLCanvasElement;
  readonly g: CanvasRenderingContext2D;
  readonly W: number;
  readonly H: number;
  rnd = mulberry32(42);
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
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const y = (H / 2) * f.env(t) * pad;
      const x = this.U(t - 0.5);
      if (i === 0) p.moveTo(x, this.V(y));
      else p.lineTo(x, this.V(y));
    }
    for (let i = n; i >= 0; i--) {
      const t = i / n;
      const y = -(H / 2) * f.env(t) * pad * (1 + (f.shape.belly ?? 0.08) * 0.4);
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
    const y = this.V((f.shape.H / 2) * f.env(t) * 0.22);
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
    const y = this.V(-f.shape.H * 0.05);
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
