import type { ExpeditionDef, MountainDef } from '../game/Mountains';
import type { MountainField } from '../world/Terrain';
import type { Route } from '../world/Route';
import type { Props } from '../world/Props';

interface Bounds { x0: number; z0: number; size: number }

/** Shaded-relief route map of the current leg plus the whole expedition's altitude profile. */
export class MapView {
  private readonly overlay = document.getElementById('map-overlay')!;
  private readonly canvas = document.getElementById('map-canvas') as HTMLCanvasElement;
  private readonly profile = document.getElementById('profile-canvas') as HTMLCanvasElement;
  private readonly title = document.getElementById('map-title')!;
  private base: HTMLCanvasElement | null = null;
  private bounds: Bounds = { x0: 0, z0: 0, size: 1 };
  private route: Route | null = null;
  private exp: ExpeditionDef | null = null;
  private stage = 0;
  open = false;

  constructor(onClose: () => void) {
    document.getElementById('map-close')!.addEventListener('click', (e) => { e.stopPropagation(); onClose(); });
    this.overlay.addEventListener('pointerdown', (e) => {
      if (e.target === this.overlay) onClose();
    });
  }

  build(def: MountainDef, field: MountainField, route: Route, props: Props, exp: ExpeditionDef, stage: number, altitudeAt: (y: number) => number): void {
    this.route = route;
    this.exp = exp;
    this.stage = stage;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of route.points) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    const size = Math.max(maxX - minX, maxZ - minZ) + 160;
    const b: Bounds = { x0: (minX + maxX) / 2 - size / 2, z0: (minZ + maxZ) / 2 - size / 2, size };
    this.bounds = b;

    const N = 150;
    const H = new Float32Array((N + 1) * (N + 1));
    let hMin = Infinity, hMax = -Infinity;
    for (let j = 0; j <= N; j++) {
      for (let i = 0; i <= N; i++) {
        const h = field.height(b.x0 + (i / N) * b.size, b.z0 + (j / N) * b.size);
        H[j * (N + 1) + i] = h;
        hMin = Math.min(hMin, h); hMax = Math.max(hMax, h);
      }
    }
    const R = 512;
    const c = document.createElement('canvas');
    c.width = c.height = R;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(R, R);
    const cell = b.size / N;
    const sample = (u: number, v: number) => {
      const fx = u * N, fz = v * N;
      const i = Math.min(N - 1, Math.floor(fx)), j = Math.min(N - 1, Math.floor(fz));
      const tx = fx - i, tz = fz - j;
      const a = H[j * (N + 1) + i], bb = H[j * (N + 1) + i + 1];
      const cc = H[(j + 1) * (N + 1) + i], d = H[(j + 1) * (N + 1) + i + 1];
      return (a * (1 - tx) + bb * tx) * (1 - tz) + (cc * (1 - tx) + d * tx) * tz;
    };
    const contour = 12; // world units (~36 m)
    for (let y = 0; y < R; y++) {
      for (let x = 0; x < R; x++) {
        const u = x / R, v = y / R;
        const h = sample(u, v);
        const e = 1 / R;
        const dx = (sample(Math.min(1, u + e), v) - sample(Math.max(0, u - e), v)) / (2 * e * b.size);
        const dz = (sample(u, Math.min(1, v + e)) - sample(u, Math.max(0, v - e))) / (2 * e * b.size);
        const slope = Math.hypot(dx, dz);
        // light from the north-west
        const shade = Math.max(0.35, Math.min(1.05, 0.82 + (dx * 0.5 + dz * 0.5) * -0.55));
        const rock = Math.min(1, Math.max(0, (slope - 1.1) * 1.6)) * 0.7;
        const crev = field.cracks.length ? Math.min(1, field.crevasseDepth(b.x0 + u * b.size, b.z0 + v * b.size) / 6) : 0;
        let r = 236 - rock * 150, g = 240 - rock * 150, bl = 246 - rock * 140;
        const t = (h - hMin) / Math.max(1, hMax - hMin);
        r *= 0.86 + t * 0.14; g *= 0.88 + t * 0.12; bl *= 0.92 + t * 0.08;
        r *= shade; g *= shade; bl *= shade;
        if (crev > 0) { r = r * (1 - crev) + 40 * crev; g = g * (1 - crev) + 110 * crev; bl = bl * (1 - crev) + 170 * crev; }
        const ci = Math.abs((h / contour) - Math.round(h / contour));
        if (ci < 0.035) { r *= 0.86; g *= 0.88; bl *= 0.92; }
        const o = (y * R + x) * 4;
        img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = bl; img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    void cell;

    const toPx = (x: number, z: number): [number, number] => [((x - b.x0) / b.size) * R, ((z - b.z0) / b.size) * R];
    // Route
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(20,24,30,0.55)';
    ctx.lineWidth = 9;
    ctx.beginPath();
    route.points.forEach((p, i) => { const [px, pz] = toPx(p.x, p.z); if (i) ctx.lineTo(px, pz); else ctx.moveTo(px, pz); });
    ctx.stroke();
    ctx.strokeStyle = '#ff6a1a';
    ctx.lineWidth = 5;
    ctx.setLineDash([10, 7]);
    ctx.stroke();
    ctx.setLineDash([]);
    // Fixed ropes
    ctx.strokeStyle = '#d6202b';
    ctx.lineWidth = 3;
    for (const r of route.ropes) {
      const [ax, az] = toPx(r.a.x, r.a.z);
      const [bx, bz] = toPx(r.b.x, r.b.z);
      ctx.beginPath(); ctx.moveTo(ax, az); ctx.lineTo(bx, bz); ctx.stroke();
      ctx.fillStyle = '#d6202b';
      ctx.beginPath(); ctx.arc(ax, az, 2.2, 0, Math.PI * 2); ctx.fill();
    }
    // Hazard zones
    for (const hz of props.hazards) {
      ctx.strokeStyle = hz.kind === 'rock' ? 'rgba(120,70,30,0.85)' : 'rgba(40,120,200,0.85)';
      ctx.lineWidth = 12;
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      for (let s = hz.s0; s <= hz.s1; s += 4) {
        const p = route.pointAt(s);
        const [px, pz] = toPx(p.x, p.z);
        if (s === hz.s0) ctx.moveTo(px, pz); else ctx.lineTo(px, pz);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // Ladders
    for (const l of props.ladders) {
      const [ax, az] = toPx(l.cx - l.ux * l.halfLen, l.cz - l.uz * l.halfLen);
      const [bx, bz] = toPx(l.cx + l.ux * l.halfLen, l.cz + l.uz * l.halfLen);
      ctx.strokeStyle = '#1e5fb8';
      ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(ax, az); ctx.lineTo(bx, bz); ctx.stroke();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(ax, az); ctx.lineTo(bx, bz); ctx.stroke();
    }
    // Landmarks
    ctx.font = '700 21px "Noto Sans JP", system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    def.landmarks.forEach((lm, i) => {
      const p = route.pointAt(route.waypointS[lm.routeIndex]);
      const [px, pz] = toPx(p.x, p.z);
      const camp = i === 0 || i === def.landmarks.length - 1;
      ctx.fillStyle = camp ? '#ff6a1a' : '#14181e';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      if (camp) { ctx.moveTo(px, pz - 13); ctx.lineTo(px + 11, pz + 8); ctx.lineTo(px - 11, pz + 8); ctx.closePath(); }
      else ctx.arc(px, pz, 6, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      const alt = Math.round(altitudeAt(p.y));
      const label = camp ? `${lm.name} ${alt.toLocaleString('en-US')}m` : lm.name;
      const tx = px + 10 > R - ctx.measureText(label).width - 6 ? px - 10 - ctx.measureText(label).width : px + 10;
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(255,255,255,0.92)';
      ctx.strokeText(label, tx, pz);
      ctx.fillStyle = '#14181e';
      ctx.fillText(label, tx, pz);
    });
    // North arrow + scale bar
    ctx.fillStyle = 'rgba(20,24,30,0.8)';
    ctx.beginPath(); ctx.moveTo(R - 24, 14); ctx.lineTo(R - 16, 34); ctx.lineTo(R - 32, 34); ctx.closePath(); ctx.fill();
    ctx.font = '700 18px system-ui, sans-serif';
    ctx.fillText('N', R - 30, 50);
    const m100 = (100 / b.size) * R;
    ctx.fillRect(14, R - 18, m100, 5);
    ctx.fillText('100 m', 14, R - 32);
    this.base = c;
    this.title.textContent = `${def.stageName} — ${def.campName} → ${def.goalName}`;
    this.drawProfile(-1);
  }

  private drawProfile(fraction: number): void {
    const exp = this.exp;
    if (!exp) return;
    const c = this.profile;
    const W = c.width = 600;
    const Hh = c.height = 170;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, W, Hh);
    const pts: { name: string; alt: number }[] = [{ name: exp.stages[0].campName, alt: exp.stages[0].campAltitude }];
    for (const st of exp.stages) pts.push({ name: st.goalName, alt: st.summitAltitude });
    const aMin = exp.baseAltitude - 200;
    const aMax = exp.summitAltitude + 150;
    const px = (i: number) => 34 + (i / (pts.length - 1)) * (W - 68);
    const py = (a: number) => Hh - 26 - ((a - aMin) / (aMax - aMin)) * (Hh - 62);
    ctx.fillStyle = 'rgba(238,242,245,0.08)';
    ctx.beginPath();
    ctx.moveTo(px(0), Hh - 10);
    pts.forEach((p, i) => ctx.lineTo(px(i), py(p.alt)));
    ctx.lineTo(px(pts.length - 1), Hh - 10);
    ctx.fill();
    ctx.strokeStyle = 'rgba(238,242,245,0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(px(i), py(p.alt)) : ctx.moveTo(px(i), py(p.alt))));
    ctx.stroke();
    // completed part
    const cur = this.stage + Math.max(0, fraction);
    ctx.strokeStyle = '#ff6a1a';
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let i = 0; i <= Math.floor(cur) && i < pts.length; i++) (i ? ctx.lineTo(px(i), py(pts[i].alt)) : ctx.moveTo(px(i), py(pts[i].alt)));
    const fi = Math.floor(cur);
    if (fi < pts.length - 1) {
      const f = cur - fi;
      ctx.lineTo(px(fi) + (px(fi + 1) - px(fi)) * f, py(pts[fi].alt + (pts[fi + 1].alt - pts[fi].alt) * f));
    }
    ctx.stroke();
    ctx.font = '700 18px "Noto Sans JP", system-ui, sans-serif';
    ctx.textAlign = 'center';
    pts.forEach((p, i) => {
      ctx.fillStyle = i <= this.stage ? '#ff6a1a' : '#9aa6b2';
      ctx.beginPath(); ctx.arc(px(i), py(p.alt), 6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#eef2f5';
      const short = p.name.replace(' サウスコル', '').replace(' ショルダー', '').replace('ベースキャンプ', 'BC');
      ctx.fillText(short, px(i), py(p.alt) - 13);
      ctx.fillStyle = '#9aa6b2';
      ctx.font = '600 16px "Barlow Condensed", system-ui, sans-serif';
      ctx.fillText(p.alt.toLocaleString('en-US'), px(i), Hh - 4);
      ctx.font = '700 18px "Noto Sans JP", system-ui, sans-serif';
    });
    if (fraction >= 0 && fi < pts.length - 1) {
      const f = cur - fi;
      const x = px(fi) + (px(fi + 1) - px(fi)) * f;
      const y = py(pts[fi].alt + (pts[fi + 1].alt - pts[fi].alt) * f);
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#ff6a1a';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
  }

  show(v: boolean): void {
    this.open = v;
    this.overlay.classList.toggle('hidden', !v);
  }

  /** Redraw the player marker. Call each frame while open. */
  update(px: number, pz: number, yaw: number, routeS: number): void {
    if (!this.open || !this.base || !this.route) return;
    const c = this.canvas;
    if (c.width !== 512) { c.width = 512; c.height = 512; }
    const ctx = c.getContext('2d')!;
    ctx.drawImage(this.base, 0, 0);
    const b = this.bounds;
    const x = ((px - b.x0) / b.size) * 512;
    const z = ((pz - b.z0) / b.size) * 512;
    ctx.save();
    ctx.translate(x, z);
    // yaw 0 looks toward -z (north, up on the map)
    ctx.rotate(-yaw);
    ctx.fillStyle = 'rgba(255,106,26,0.18)';
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, 42, -Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ff6a1a';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(0, -12); ctx.lineTo(8, 9); ctx.lineTo(0, 4); ctx.lineTo(-8, 9); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
    this.drawProfile(routeS / this.route.length);
  }
}
