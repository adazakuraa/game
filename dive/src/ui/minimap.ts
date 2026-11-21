import { ARCH, DIVE_POINTS, heightAt, rockyWeight, VENT, WORLD, WRECK, zoneAt } from '../world/layout';

const RES = 2.5; // meters per map pixel
const LANDMARKS = [
  { x: WRECK.x, z: WRECK.z, label: '沈没船' },
  { x: ARCH.x, z: ARCH.z, label: '岩のアーチ' },
  { x: VENT.x, z: VENT.z, label: '熱水噴出孔' },
];
const ZONE_LABELS = [
  { x: 0, z: 30, label: '浅瀬ラグーン' },
  { x: -70, z: 235, label: 'サンゴ礁' },
  { x: 130, z: 170, label: '岩礁' },
  { x: 0, z: 410, label: 'ドロップオフ' },
  { x: 0, z: 600, label: '沖の大海原' },
  { x: 0, z: 840, label: '深海' },
  { x: -320, z: 180, label: '流氷の入り江' },
  { x: -330, z: 520, label: '海底遺跡' },
  { x: -330, z: 700, label: 'ブルーホール' },
  { x: -330, z: 900, label: '水中洞窟' },
  { x: 330, z: 220, label: '海藻の森' },
];

/**
 * Bathymetric chart rendered once from the terrain function. Offshore (+z) is up, so the
 * map's right is world -x (as seen when facing offshore).
 */
export class Minimap {
  private chart: HTMLCanvasElement;
  private W: number;
  private H: number;
  private mini: HTMLCanvasElement;
  private big: HTMLCanvasElement;
  private frame = 0;
  open = false;

  constructor(mini: HTMLCanvasElement, big: HTMLCanvasElement) {
    this.mini = mini;
    this.big = big;
    this.W = Math.ceil((WORLD.maxX - WORLD.minX) / RES);
    this.H = Math.ceil((WORLD.maxZ - WORLD.minZ) / RES);
    this.chart = document.createElement('canvas');
    this.chart.width = this.W;
    this.chart.height = this.H;
    this.buildChart();
  }

  /** map pixel for a world point */
  px(x: number, z: number): [number, number] {
    return [(WORLD.maxX - x) / RES, (WORLD.maxZ - z) / RES];
  }

  private buildChart(): void {
    const { W, H } = this;
    const hts = new Float32Array(W * H);
    for (let j = 0; j < H; j++) {
      const z = WORLD.maxZ - j * RES;
      for (let i = 0; i < W; i++) hts[j * W + i] = heightAt(WORLD.maxX - i * RES, z);
    }
    const g = this.chart.getContext('2d')!;
    const img = g.createImageData(W, H);
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const h = hts[j * W + i];
        const d = -h;
        // depth tint: turquoise shallows -> blue -> navy -> near black
        const t = Math.min(1, Math.log(1 + d) / Math.log(440));
        let r = 120 * (1 - t) ** 2 + 6;
        let gg = 215 * (1 - t) ** 1.3 + 14;
        let b = 205 * (1 - t * 0.75) + 20;
        const x = WORLD.maxX - i * RES;
        const z = WORLD.maxZ - j * RES;
        if (d < 8) { r += 60 * (1 - d / 8); gg += 30 * (1 - d / 8); b += 10 * (1 - d / 8); } // sand
        const rw = rockyWeight(x, z);
        if (rw > 0.4) { r -= 20; gg -= 25; b -= 35; }
        if (zoneAt(x, z) === 'reef') { r += 8; gg += 6; b -= 18; }
        // hillshade from neighbors (light from upper-left)
        const hl = hts[j * W + Math.max(0, i - 1)];
        const hu = hts[Math.max(0, j - 1) * W + i];
        const shade = Math.max(-0.5, Math.min(0.5, (h - hl + h - hu) * 0.18));
        const k = 1 + shade;
        // contour every 10 m (50 m in deep water)
        const step = d > 60 ? 50 : 10;
        const c0 = Math.floor(d / step);
        const cr = Math.floor(-hts[j * W + Math.min(W - 1, i + 1)] / step);
        const cd = Math.floor(-hts[Math.min(H - 1, j + 1) * W + i] / step);
        const line = c0 !== cr || c0 !== cd ? 0.78 : 1;
        const o = (j * W + i) * 4;
        img.data[o] = Math.max(0, Math.min(255, r * k * line));
        img.data[o + 1] = Math.max(0, Math.min(255, gg * k * line));
        img.data[o + 2] = Math.max(0, Math.min(255, b * k * line));
        img.data[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
  }

  private arrow(g: CanvasRenderingContext2D, x: number, y: number, ang: number, s: number) {
    g.save();
    g.translate(x, y);
    g.rotate(ang);
    g.fillStyle = 'rgba(95,227,240,0.22)';
    g.beginPath();
    g.moveTo(0, 0);
    g.arc(0, 0, s * 3.2, -Math.PI / 2 - 0.45, -Math.PI / 2 + 0.45);
    g.closePath();
    g.fill();
    g.fillStyle = '#ffffff';
    g.strokeStyle = '#03202c';
    g.lineWidth = s * 0.25;
    g.beginPath();
    g.moveTo(0, -s);
    g.lineTo(s * 0.7, s * 0.75);
    g.lineTo(0, s * 0.35);
    g.lineTo(-s * 0.7, s * 0.75);
    g.closePath();
    g.stroke();
    g.fill();
    g.restore();
  }

  /** heading angle on the map (clockwise from map-up) for a camera yaw */
  static angle(yaw: number): number {
    return Math.atan2(Math.sin(yaw), -Math.cos(yaw));
  }

  /** fish-finder blips, set by the game when the sonar is owned */
  blips: { x: number; z: number; rare: boolean }[] = [];

  update(x: number, z: number, yaw: number, boat: { x: number; z: number } | null, force = false): void {
    if (!force && this.frame++ % 4 !== 0) return;
    const c = this.mini;
    const dpr = Math.min(2, devicePixelRatio || 1);
    const size = Math.round(c.clientWidth * dpr);
    if (!size) return;
    if (c.width !== size) { c.width = size; c.height = size; }
    const g = c.getContext('2d')!;
    const span = 150 / RES; // map pixels shown across (150 m)
    const [px, py] = this.px(x, z);
    g.clearRect(0, 0, size, size);
    g.save();
    g.beginPath();
    g.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = '#020c14';
    g.fillRect(0, 0, size, size);
    g.imageSmoothingEnabled = true;
    const sc = size / span;
    g.drawImage(this.chart, px - span / 2, py - span / 2, span, span, 0, 0, size, size);
    if (boat) {
      const [bx, by] = this.px(boat.x, boat.z);
      const sx = (bx - px) * sc + size / 2, sy = (by - py) * sc + size / 2;
      g.fillStyle = '#ff9a3c';
      g.beginPath();
      g.arc(sx, sy, size * 0.035, 0, Math.PI * 2);
      g.fill();
    }
    // fish-finder blips (sonar gear): unphotographed species nearby
    for (const b of this.blips) {
      const [lx, ly] = this.px(b.x, b.z);
      const sx = (lx - px) * sc + size / 2, sy = (ly - py) * sc + size / 2;
      g.fillStyle = b.rare ? 'rgba(255,200,60,0.95)' : 'rgba(120,255,170,0.85)';
      g.beginPath();
      g.arc(sx, sy, size * (b.rare ? 0.03 : 0.022), 0, Math.PI * 2);
      g.fill();
    }
    for (const l of LANDMARKS) {
      const [lx, ly] = this.px(l.x, l.z);
      const sx = (lx - px) * sc + size / 2, sy = (ly - py) * sc + size / 2;
      g.strokeStyle = 'rgba(255,255,255,0.8)';
      g.lineWidth = dpr;
      g.strokeRect(sx - size * 0.025, sy - size * 0.025, size * 0.05, size * 0.05);
    }
    g.restore();
    this.arrow(g, size / 2, size / 2, Minimap.angle(yaw), size * 0.075);
    g.strokeStyle = 'rgba(150,230,245,0.45)';
    g.lineWidth = 1.5 * dpr;
    g.beginPath();
    g.arc(size / 2, size / 2, size / 2 - dpr, 0, Math.PI * 2);
    g.stroke();
  }

  drawBig(x: number, z: number, yaw: number, boat: { x: number; z: number } | null): void {
    const c = this.big;
    const dpr = Math.min(2, devicePixelRatio || 1);
    const cw = c.clientWidth, ch = c.clientHeight;
    c.width = Math.round(cw * dpr);
    c.height = Math.round(ch * dpr);
    const g = c.getContext('2d')!;
    g.scale(dpr, dpr);
    const sc = Math.min(cw / this.W, ch / this.H);
    const ox = (cw - this.W * sc) / 2, oy = (ch - this.H * sc) / 2;
    const P = (wx: number, wz: number): [number, number] => {
      const [mx, my] = this.px(wx, wz);
      return [ox + mx * sc, oy + my * sc];
    };
    g.imageSmoothingEnabled = true;
    g.drawImage(this.chart, ox, oy, this.W * sc, this.H * sc);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `700 ${Math.max(11, sc * 6)}px "Zen Kaku Gothic New", sans-serif`;
    for (const l of ZONE_LABELS) {
      const [sx, sy] = P(l.x, l.z);
      g.fillStyle = 'rgba(0,0,0,0.45)';
      g.fillText(l.label, sx + 1, sy + 1);
      g.fillStyle = 'rgba(235,250,255,0.9)';
      g.fillText(l.label, sx, sy);
    }
    g.font = `500 ${Math.max(10, sc * 4.6)}px "Zen Kaku Gothic New", sans-serif`;
    for (const l of LANDMARKS) {
      const [sx, sy] = P(l.x, l.z);
      g.strokeStyle = '#fff';
      g.lineWidth = 1.5;
      g.strokeRect(sx - 4, sy - 4, 8, 8);
      g.fillStyle = 'rgba(255,255,255,0.85)';
      g.fillText(l.label, sx, sy + 13);
    }
    for (const dp of DIVE_POINTS) {
      const [sx, sy] = P(dp.x, dp.z);
      g.fillStyle = '#ff9a3c';
      g.beginPath();
      g.arc(sx, sy, 3.5, 0, Math.PI * 2);
      g.fill();
    }
    if (boat) {
      const [sx, sy] = P(boat.x, boat.z);
      g.fillStyle = '#ff9a3c';
      g.strokeStyle = '#fff';
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(sx, sy, 6, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
    const [sx, sy] = P(x, z);
    this.arrow(g, sx, sy, Minimap.angle(yaw), 9);
    // orientation hints
    g.font = `700 12px "Zen Kaku Gothic New", sans-serif`;
    g.fillStyle = 'rgba(220,240,248,0.75)';
    g.fillText('▲ 沖', cw / 2, oy + 12);
    g.fillText('岸 ▼', cw / 2, oy + this.H * sc - 12);
  }
}
