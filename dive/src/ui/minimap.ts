import { ARCH, bottomMaterial, chartHeightAt, DIVE_POINTS, kelpWeight, VENT, WORLD, WRECK, zoneAt } from '../world/layout';
import { simplex2 } from '../utils/noise';

const RES = 2.5; // meters per map pixel
/** chart margin (m) around the world: the sea (and the island to the south) continues,
 * so the map never shows a black edge (PHASE5-DESIGN §1.5) */
const M = 120;
// landmarks are not drawn on the chart (the player finds them); kept for reference
export const LANDMARKS = [
  { x: WRECK.x, z: WRECK.z, label: '沈没船', id: 'dropoff' },
  { x: ARCH.x, z: ARCH.z, label: '岩のアーチ', id: 'rocky' },
  { x: VENT.x, z: VENT.z, label: '熱水噴出孔', id: 'deep' },
];
// each label belongs to a dive point; it is written on the chart once that point is known
const ZONE_LABELS = [
  { x: 0, z: 30, label: '浅瀬ラグーン', id: 'lagoon' },
  { x: -70, z: 235, label: 'サンゴ礁', id: 'reef' },
  { x: 130, z: 170, label: '岩礁', id: 'rocky' },
  { x: 0, z: 410, label: 'ドロップオフ', id: 'dropoff' },
  { x: 0, z: 600, label: '沖の大海原', id: 'dropoff' },
  { x: 0, z: 840, label: '深海', id: 'deep' },
  { x: -320, z: 180, label: '流氷の入り江', id: 'cold' },
  { x: -330, z: 520, label: '海底遺跡', id: 'ruins' },
  { x: 300, z: 610, label: 'ブルーホール', id: 'bluehole' },
  { x: -330, z: 900, label: '水中洞窟', id: 'cave' },
  { x: 330, z: 220, label: '海藻の森', id: 'kelp' },
  { x: 300, z: -160, label: '河口', id: 'estuary' },
  { x: 262, z: -470, label: '川', id: 'river' },
];

/**
 * Bathymetric chart rendered once from the terrain function. Offshore (+z) is up, so the
 * map's right is world -x (as seen when facing offshore).
 */
export class Minimap {
  /** dive points the player knows about */
  known: Set<string> = new Set(['lagoon']);
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
    this.W = Math.ceil((WORLD.maxX - WORLD.minX + 2 * M) / RES);
    this.H = Math.ceil((WORLD.maxZ - WORLD.minZ + 2 * M) / RES);
    this.chart = document.createElement('canvas');
    this.chart.width = this.W;
    this.chart.height = this.H;
    this.buildChart();
  }

  /** map pixel for a world point */
  px(x: number, z: number): [number, number] {
    return [(WORLD.maxX + M - x) / RES, (WORLD.maxZ + M - z) / RES];
  }

  private buildChart(): void {
    const t0 = performance.now();
    const { W, H } = this;
    // world-only height grid (natural terrain: no ruins, no cave trench, no wreck pit)
    const WW = Math.ceil((WORLD.maxX - WORLD.minX) / RES);
    const WH = Math.ceil((WORLD.maxZ - WORLD.minZ) / RES);
    const hts = new Float32Array(WW * WH);
    // Phase 9 S7 (CF): the island far from the river and the estuary (z < -100, x outside 140..460) is smooth
    // land, so it is sampled on a 5 m grid (10 m beyond x < 100 / > 500) and copied (the south made the grid 51% larger)
    for (let j = 0; j < WH; j++) {
      const z = WORLD.maxZ - j * RES;
      const farLand = z < -100;
      for (let i = 0; i < WW; i++) {
        const x = WORLD.maxX - i * RES;
        if (z < -120 && (x < 100 || x > 500) && ((i | j) & 3)) { hts[j * WW + i] = hts[(j & ~3) * WW + (i & ~3)]; continue; } // 10 m
        if (farLand && (x < 140 || x > 460) && ((i | j) & 1)) { hts[j * WW + i] = hts[(j & ~1) * WW + (i & ~1)]; continue; }
        hts[j * WW + i] = chartHeightAt(x, z);
      }
    }
    const tGrid = performance.now() - t0;
    // water colour by depth (aerial photo: the deeper, the more the water hides the bottom)
    const STOPS: [number, [number, number, number]][] = [
      [0, [0xa8, 0xea, 0xdf]], [6, [0x4f, 0xc6, 0xcf]], [15, [0x1f, 0x97, 0xc2]],
      [40, [0x0f, 0x62, 0xa8]], [120, [0x0a, 0x3f, 0x86]], [400, [0x08, 0x2c, 0x6a]],
    ];
    const water = (d: number): [number, number, number] => {
      for (let k = 1; k < STOPS.length; k++) {
        if (d <= STOPS[k][0]) {
          const [d0, c0] = STOPS[k - 1], [d1, c1] = STOPS[k];
          const t = (d - d0) / (d1 - d0);
          return [c0[0] + (c1[0] - c0[0]) * t, c0[1] + (c1[1] - c0[1]) * t, c0[2] + (c1[2] - c0[2]) * t];
        }
      }
      return STOPS[STOPS.length - 1][1];
    };
    // Phase 9: the island to the south. Above the waterline the chart shows land: beach -> green with height
    const LAND = -0.3;
    // Phase 9 S7 (CF, chart build time): the island's mottling noise is sampled once per 2 x 2 px block (5 m; its
    // wavelength is 20 m+), because the south made land a third of the chart and simplex2 per pixel dominated
    const LBW = Math.ceil(W / 2), LBH = Math.ceil(H / 2);
    const landNoise = new Float32Array(LBW * LBH).fill(NaN);
    const land = (h: number, x: number, z: number): [number, number, number] => {
      const bi = Math.min(LBW - 1, (WORLD.maxX + M - x) / RES / 2 | 0), bj = Math.min(LBH - 1, (WORLD.maxZ + M - z) / RES / 2 | 0);
      let nz = landNoise[bj * LBW + bi];
      if (nz !== nz) landNoise[bj * LBW + bi] = nz = simplex2(x * 0.05, z * 0.05);
      const t = Math.min(1, Math.max(0, (h - LAND) / 1.6)) + 0.05 * nz;
      return [0xe8 + (0x5f - 0xe8) * t, 0xdc + (0x8a - 0xdc) * t, 0xc0 + (0x4a - 0xc0) * t];
    };
    const bm = [0, 0, 0, 0, 0, 0];
    // bottom colours are sampled every 2 px (5 m) and shared with the neighbour
    // pixel: bottomMaterial is the expensive part of the build (design §1.6)
    const BW = Math.ceil(W / 2), BH = Math.ceil(H / 2);
    const bmGrid = new Float32Array(BW * BH * 3).fill(-1);
    const bottomRGB = (i: number, j: number, x: number, z: number, h: number): [number, number, number] => {
      const bi = Math.min(BW - 1, Math.round(i / 2)), bj = Math.min(BH - 1, Math.round(j / 2));
      const o = (bj * BW + bi) * 3;
      if (bmGrid[o] < 0) {
        const ii = Math.round((WORLD.maxX - x) / RES), jj = Math.round((WORLD.maxZ - z) / RES);
        const hl = hts[jj * WW + Math.max(0, ii - 1)];
        const hd = hts[Math.min(WH - 1, jj + 1) * WW + ii];
        const slope = Math.min(1, (Math.abs(h - hl) + Math.abs(h - hd)) / RES * 0.5);
        bottomMaterial(x, z, slope, bm);
        bmGrid[o] = (bm[0] * 0.9 + 0.1) * 255;
        bmGrid[o + 1] = (bm[1] * 0.9 + 0.1) * 255;
        bmGrid[o + 2] = (bm[2] * 0.9 + 0.1) * 255;
      }
      return [bmGrid[o], bmGrid[o + 1], bmGrid[o + 2]];
    };
    const g = this.chart.getContext('2d')!;
    const img = g.createImageData(W, H);
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const x = WORLD.maxX + M - i * RES;
        const z = WORLD.maxZ + M - j * RES;
        const o = (j * W + i) * 4;
        let r: number, gg: number, b: number;
        if (x < WORLD.minX || x > WORLD.maxX || z < WORLD.minZ || z > WORLD.maxZ) {
          // --- margin: the world goes on. South is the island (beach -> green),
          // elsewhere the sea deepens slowly away from the edge.
          const dxOut = Math.max(WORLD.minX - x, x - WORLD.maxX, 0);
          const dzOut = Math.max(WORLD.minZ - z, z - WORLD.maxZ, 0);
          if (z < WORLD.minZ && dzOut >= dxOut) {
            // the world's south edge is already inland: keep the land colour going
            [r, gg, b] = land(2, x, z);
          } else {
            const cx = Math.max(WORLD.minX, Math.min(WORLD.maxX, x));
            const cz = Math.max(WORLD.minZ, Math.min(WORLD.maxZ, z));
            const ei = Math.round((WORLD.maxX - cx) / RES), ej = Math.round((WORLD.maxZ - cz) / RES);
            const eh = hts[Math.max(0, Math.min(WH - 1, ej)) * WW + Math.max(0, Math.min(WW - 1, ei))];
            if (eh > LAND) {
              [r, gg, b] = land(eh, x, z); // east/west margin beside the island
            } else {
              const d = Math.min(425, -eh + 0.3 * Math.hypot(dxOut, dzOut) + 6 * simplex2(x * 0.02, z * 0.02));
              [r, gg, b] = water(Math.max(0.5, d));
            }
          }
        } else {
          const ii = Math.min(WW - 1, Math.round((WORLD.maxX - x) / RES)), jj = Math.min(WH - 1, Math.round((WORLD.maxZ - z) / RES));
          const h = hts[jj * WW + ii];
          if (h > LAND) {
            [r, gg, b] = land(h, x, z); // island: no water colour, no bottom material
          } else {
            const d = -h;
            const wc = water(d);
            const detail = Math.exp(-d / 9);
            if (detail > 0.02) {
              const bc = bottomRGB(i, j, x, z, h);
              r = wc[0] + (bc[0] - wc[0]) * detail;
              gg = wc[1] + (bc[1] - wc[1]) * detail;
              b = wc[2] + (bc[2] - wc[2]) * detail;
            } else {
              [r, gg, b] = wc;
            }
            // kelp canopy seen from above: dark gold-brown patches
            const kw = kelpWeight(x, z);
            if (kw > 0.15) {
              const a = 0.45 * kw * kw * (0.6 + 0.4 * simplex2(x * 0.05 + 9, z * 0.05));
              r = r + (0x5a - r) * a; gg = gg + (0x5a - gg) * a; b = b + (0x30 - b) * a;
            }
            // drift ice in the cold cove: irregular white fragments
            if (zoneAt(x, z) === 'cold' && simplex2(x * 0.11 + 4, z * 0.11) > 0.25) {
              r = r + (0xe8 - r) * 0.8; gg = gg + (0xf4 - gg) * 0.8; b = b + (0xf8 - b) * 0.8;
            }
            const rip = 1 + 0.06 * simplex2(x * 0.03 + 2, z * 0.03);
            r *= rip; gg *= rip; b *= rip;
          }
        }
        img.data[o] = Math.max(0, Math.min(255, r));
        img.data[o + 1] = Math.max(0, Math.min(255, gg));
        img.data[o + 2] = Math.max(0, Math.min(255, b));
        img.data[o + 3] = 255;
      }
    }
    const tLoop = performance.now() - t0;
    g.putImageData(img, 0, 0);
    try {
      g.filter = 'blur(0.6px)';
      g.drawImage(this.chart, 0, 0);
      g.filter = 'none';
    } catch { /* filter unsupported: keep the sharp chart */ }
    console.info(`[minimap] chart built in ${Math.round(performance.now() - t0)} ms (grid ${Math.round(tGrid)}, loop ${Math.round(tLoop)})`);
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

  /** fish-finder blips and request marks; with `r` (m) a mark is an area (the goal is somewhere inside), not a point */
  blips: { x: number; z: number; rare: boolean; r?: number; spot?: boolean }[] = [];

  /** a request area: soft fill, dashed rim, so it reads as "somewhere in here" */
  private area(g: CanvasRenderingContext2D, sx: number, sy: number, rad: number, lw: number, t: number, spot = false): void {
    g.save();
    // photo spots (Phase 3) are aqua so they never read as a request
    g.fillStyle = spot ? 'rgba(90,230,255,0.13)' : 'rgba(255,200,60,0.16)';
    g.strokeStyle = spot ? 'rgba(120,235,255,0.9)' : 'rgba(255,205,80,0.9)';
    g.lineWidth = lw;
    g.setLineDash([lw * 3, lw * 2.2]);
    g.lineDashOffset = -t * lw * 4;
    g.beginPath();
    g.arc(sx, sy, rad, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.restore();
  }

  update(x: number, z: number, yaw: number, boat: { x: number; z: number } | null, force = false, compass = false): void {
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
    g.fillStyle = '#0b3a78';
    g.fillRect(0, 0, size, size);
    g.imageSmoothingEnabled = true;
    const sc = size / span;
    g.drawImage(this.chart, px - span / 2, py - span / 2, span, span, 0, 0, size, size);
    if (boat) {
      const [bx, by] = this.px(boat.x, boat.z);
      const sx = (bx - px) * sc + size / 2, sy = (by - py) * sc + size / 2;
      const dc = Math.hypot(sx - size / 2, sy - size / 2);
      if (dc <= size / 2) {
        g.fillStyle = '#ff9a3c';
        g.beginPath();
        g.arc(sx, sy, size * 0.035, 0, Math.PI * 2);
        g.fill();
      } else if (compass) {
        // explorer's compass (treasure gear): an orange triangle on the rim points to the boat
        const ang = Math.atan2(sy - size / 2, sx - size / 2);
        const rx = size / 2 + Math.cos(ang) * (size / 2 - size * 0.055), ry = size / 2 + Math.sin(ang) * (size / 2 - size * 0.055);
        g.save();
        g.translate(rx, ry);
        g.rotate(ang + Math.PI / 2);
        g.fillStyle = '#ff9a3c';
        g.beginPath();
        g.moveTo(0, -size * 0.05);
        g.lineTo(size * 0.034, size * 0.04);
        g.lineTo(-size * 0.034, size * 0.04);
        g.closePath();
        g.fill();
        g.restore();
      }
    }
    // request areas under everything else
    const t = performance.now() / 1000;
    for (const b of this.blips) {
      if (!b.r) continue;
      const [lx, ly] = this.px(b.x, b.z);
      this.area(g, (lx - px) * sc + size / 2, (ly - py) * sc + size / 2, Math.max(size * 0.07, (b.r / RES) * sc), 1.6 * dpr, t, b.spot);
    }
    // fish-finder blips (sonar gear): unphotographed species nearby
    for (const b of this.blips) {
      if (b.r) continue;
      const [lx, ly] = this.px(b.x, b.z);
      const sx = (lx - px) * sc + size / 2, sy = (ly - py) * sc + size / 2;
      g.fillStyle = b.rare ? 'rgba(255,200,60,0.95)' : 'rgba(120,255,170,0.85)';
      g.beginPath();
      g.arc(sx, sy, size * (b.rare ? 0.03 : 0.022), 0, Math.PI * 2);
      g.fill();
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
    const WW = (WORLD.maxX - WORLD.minX) / RES, WH = (WORLD.maxZ - WORLD.minZ) / RES;
    // Phase 9 S7 (要確認事項 CF): the world is 860 x 1740 m, so fitting all of it makes the map small on a landscape
    // screen. Zoom to the part the player knows (known dive points, the boat, the diver) plus a margin, never smaller
    // than the whole-world fit; once everything is known this is the whole world again.
    const m0 = M / RES; // the world's corner in chart pixels
    const pts: [number, number][] = [this.px(x, z)];
    if (boat) pts.push(this.px(boat.x, boat.z));
    for (const dp of DIVE_POINTS) if (this.known.has(dp.id)) pts.push(this.px(dp.x, dp.z));
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [mx, my] of pts) { x0 = Math.min(x0, mx); x1 = Math.max(x1, mx); y0 = Math.min(y0, my); y1 = Math.max(y1, my); }
    const PAD = 200 / RES;
    const sc = Math.max(Math.min(cw / WW, ch / WH), Math.min(cw / (x1 - x0 + 2 * PAD), ch / (y1 - y0 + 2 * PAD)));
    const centre = (c: number, lo: number, hi: number, half: number): number => (hi - lo <= 2 * half ? (lo + hi) / 2 : Math.min(hi - half, Math.max(lo + half, c)));
    const cx = centre((x0 + x1) / 2, m0, m0 + WW, cw / 2 / sc), cy = centre((y0 + y1) / 2, m0, m0 + WH, ch / 2 / sc);
    const ox = cw / 2 - cx * sc, oy = ch / 2 - cy * sc; // where the chart's pixel (0, 0) goes on screen
    // backdrop in the margin colours (deep navy above, island green below)
    const grad = g.createLinearGradient(0, 0, 0, ch);
    grad.addColorStop(0, '#082c6a');
    grad.addColorStop(0.85, '#0a3f86');
    grad.addColorStop(1, '#5f8a4a');
    g.fillStyle = grad;
    g.fillRect(0, 0, cw, ch);
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
      if (!this.known.has(l.id)) continue;
      const [sx, sy] = P(l.x, l.z);
      g.fillStyle = 'rgba(0,0,0,0.45)';
      g.fillText(l.label, sx + 1, sy + 1);
      g.fillStyle = 'rgba(235,250,255,0.9)';
      g.fillText(l.label, sx, sy);
    }
    for (const dp of DIVE_POINTS) {
      if (!this.known.has(dp.id)) continue;
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
    for (const b of this.blips) {
      if (!b.r) continue;
      const [ax, ay] = P(b.x, b.z);
      this.area(g, ax, ay, Math.max(7, (b.r / RES) * sc), 1.5, performance.now() / 1000, b.spot);
    }
    const [sx, sy] = P(x, z);
    this.arrow(g, sx, sy, Minimap.angle(yaw), 9);
    // orientation hints
    g.font = `700 12px "Zen Kaku Gothic New", sans-serif`;
    g.fillStyle = 'rgba(220,240,248,0.75)';
    g.fillText('▲ 沖', cw / 2, Math.max(12, oy + m0 * sc + 12));
    g.fillText('岸 ▼', cw / 2, Math.min(ch - 12, oy + (m0 + WH) * sc - 12));
  }
}
