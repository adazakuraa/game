import * as THREE from 'three';
import type { MountainDef } from '../game/Mountains';
import type { MountainField } from './Terrain';

export interface RoutePoint {
  x: number; y: number; z: number; s: number;
}

export interface RopeSegment {
  index: number;
  sectionId: number;
  a: THREE.Vector3; // lower anchor (closer to camp)
  b: THREE.Vector3; // upper anchor
  sA: number;
  sB: number;
}

export interface NearestResult {
  s: number;
  dist: number;
  i: number;
  px: number; pz: number; py: number;
}

/** Densely sampled walking line plus fixed ropes and landmark positions. */
export class Route {
  readonly points: RoutePoint[] = [];
  readonly waypointS: number[] = [];
  readonly length: number;
  readonly ropes: RopeSegment[] = [];
  readonly ropeSectionsS: [number, number][] = [];
  readonly crevasseS: number[] = [];

  /** Arc length at a fractional waypoint index. */
  sAtIndex(at: number): number {
    const i = Math.min(Math.floor(at), this.waypointS.length - 2);
    const f = at - i;
    return this.waypointS[i] + (this.waypointS[i + 1] - this.waypointS[i]) * f;
  }

  constructor(readonly def: MountainDef, readonly field: MountainField) {
    const wp = def.route;
    let s = 0;
    this.waypointS.push(0);
    for (let i = 0; i < wp.length - 1; i++) {
      const [ax, az] = wp[i];
      const [bx, bz] = wp[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.max(1, Math.ceil(len / 1.0));
      for (let k = 0; k < n; k++) {
        const t = k / n;
        // Slight sinuous wander like a real boot track.
        const x0 = ax + (bx - ax) * t;
        const z0 = az + (bz - az) * t;
        let wob = Math.sin((s + k) * 0.07) * 0.9 * Math.min(1, Math.min(t, 1 - t) * 6);
        // Straight approach onto ladders.
        for (const c of field.cracks) {
          const dc = Math.hypot(x0 - c.cx, z0 - c.cz);
          if (dc < 16) wob *= Math.max(0, (dc - 4) / 12);
        }
        const nx = -(bz - az) / len;
        const nz = (bx - ax) / len;
        const x = x0 + nx * wob;
        const z = z0 + nz * wob;
        if (this.points.length) {
          const p = this.points[this.points.length - 1];
          s += Math.hypot(x - p.x, z - p.z);
        }
        this.points.push({ x, z, y: field.surfaceHeight(x, z), s });
      }
      this.waypointS.push(s + len / n);
    }
    const last = wp[wp.length - 1];
    const p = this.points[this.points.length - 1];
    s += Math.hypot(last[0] - p.x, last[1] - p.z);
    this.points.push({ x: last[0], z: last[1], y: field.surfaceHeight(last[0], last[1]), s });
    this.waypointS[this.waypointS.length - 1] = s;
    this.length = s;

    // Fixed ropes with anchors every ~20-26 m; every ladder gets its own handline.
    const sections: [number, number][] = def.ropeSections.map(([from, to]) => [
      Math.max(1, this.waypointS[from] - 6),
      Math.min(this.length - 3, this.waypointS[to] + 2),
    ]);
    for (const c of def.crevasses ?? []) {
      const sc = this.sAtIndex(c.at);
      this.crevasseS.push(sc);
      if (!sections.some(([a, b]) => sc > a + 3 && sc < b - 3)) sections.push([sc - 9, sc + 9]);
    }
    sections.sort((a, b) => a[0] - b[0]);
    sections.forEach(([s0, s1], sectionId) => {
      this.ropeSectionsS.push([s0, s1]);
      const count = Math.max(1, Math.round((s1 - s0) / 23));
      for (let k = 0; k < count; k++) {
        const sA = s0 + ((s1 - s0) * k) / count;
        const sB = s0 + ((s1 - s0) * (k + 1)) / count;
        this.ropes.push({
          index: this.ropes.length,
          sectionId,
          sA,
          sB,
          a: this.anchorPosition(sA),
          b: this.anchorPosition(sB),
        });
      }
    });
  }

  pointAt(s: number, out = new THREE.Vector3()): THREE.Vector3 {
    const pts = this.points;
    if (s <= 0) return out.set(pts[0].x, pts[0].y, pts[0].z);
    if (s >= this.length) {
      const l = pts[pts.length - 1];
      return out.set(l.x, l.y, l.z);
    }
    let lo = 0;
    let hi = pts.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (pts[mid].s < s) lo = mid; else hi = mid;
    }
    const a = pts[lo];
    const b = pts[hi];
    const t = (s - a.s) / Math.max(1e-6, b.s - a.s);
    return out.set(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
  }

  /** Horizontal direction of travel (towards summit) at s. */
  directionAt(s: number, out = new THREE.Vector3()): THREE.Vector3 {
    const a = this.pointAt(Math.max(0, s - 2), new THREE.Vector3());
    const b = this.pointAt(Math.min(this.length, s + 2), new THREE.Vector3());
    out.set(b.x - a.x, 0, b.z - a.z);
    if (out.lengthSq() < 1e-6) out.set(-1, 0, -1);
    return out.normalize();
  }

  private anchorPosition(s: number): THREE.Vector3 {
    const p = this.pointAt(s);
    const d = this.directionAt(s);
    // Rope runs ~0.9 m to the right of the boot track.
    const x = p.x - d.z * 0.9;
    const z = p.z + d.x * 0.9;
    return new THREE.Vector3(x, this.field.surfaceHeight(x, z) + 0.55, z);
  }

  nearest(x: number, z: number, hint = -1, window = 60): NearestResult {
    const pts = this.points;
    let lo = 0;
    let hi = pts.length - 1;
    if (hint >= 0) {
      lo = Math.max(0, hint - window);
      hi = Math.min(pts.length - 1, hint + window);
    }
    let best = 1e12;
    let bi = lo;
    for (let i = lo; i <= hi; i++) {
      const dx = pts[i].x - x;
      const dz = pts[i].z - z;
      const d = dx * dx + dz * dz;
      if (d < best) { best = d; bi = i; }
    }
    // Refine on adjacent segment.
    let s = pts[bi].s;
    let px = pts[bi].x;
    let pz = pts[bi].z;
    let py = pts[bi].y;
    let dist = Math.sqrt(best);
    for (const j of [bi - 1, bi]) {
      if (j < 0 || j + 1 >= pts.length) continue;
      const a = pts[j];
      const b = pts[j + 1];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const l2 = dx * dx + dz * dz || 1;
      let t = ((x - a.x) * dx + (z - a.z) * dz) / l2;
      t = Math.max(0, Math.min(1, t));
      const qx = a.x + dx * t;
      const qz = a.z + dz * t;
      const d = Math.hypot(qx - x, qz - z);
      if (d < dist) {
        dist = d;
        s = a.s + (b.s - a.s) * t;
        px = qx; pz = qz; py = a.y + (b.y - a.y) * t;
      }
    }
    return { s, dist, i: bi, px, pz, py };
  }

  ropeAtS(s: number): RopeSegment | null {
    for (const r of this.ropes) {
      if (s >= r.sA - 0.5 && s <= r.sB + 0.5) return r;
    }
    return null;
  }

  isRoped(s: number): boolean {
    return this.ropeSectionsS.some(([a, b]) => s >= a && s <= b);
  }

  /** Closest point on a rope segment's sagging line, used for the clip tether. */
  ropePoint(seg: RopeSegment, t: number, out = new THREE.Vector3()): THREE.Vector3 {
    out.lerpVectors(seg.a, seg.b, t);
    const sag = Math.sin(t * Math.PI) * Math.min(0.9, seg.a.distanceTo(seg.b) * 0.025);
    const ground = this.field.surfaceHeight(out.x, out.z) + 0.18;
    out.y = Math.max(ground, out.y - sag);
    return out;
  }

  buildMeshes(): THREE.Group {
    const group = new THREE.Group();
    group.name = 'route';
    group.add(this.buildTrail());
    group.add(this.buildRopes());
    return group;
  }

  private buildTrail(): THREE.Mesh {
    // Boot track ribbon: trampled darker snow with footprint pockets.
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, 64, 256);
    const grad = ctx.createLinearGradient(0, 0, 64, 0);
    grad.addColorStop(0, 'rgba(120,130,150,0)');
    grad.addColorStop(0.25, 'rgba(105,118,140,0.55)');
    grad.addColorStop(0.75, 'rgba(105,118,140,0.55)');
    grad.addColorStop(1, 'rgba(120,130,150,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 256);
    for (let i = 0; i < 8; i++) {
      const y = i * 32 + 8;
      const x = i % 2 ? 40 : 22;
      ctx.fillStyle = 'rgba(60,72,98,0.75)';
      ctx.beginPath();
      ctx.ellipse(x, y, 6, 11, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(40,48,66,0.5)';
      for (let k = 0; k < 4; k++) ctx.fillRect(x - 5 + k * 3, y - 8, 1.5, 2);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;

    const pts = this.points;
    const width = 1.5;
    const positions: number[] = [];
    const uvs: number[] = [];
    const idx: number[] = [];
    const dir = new THREE.Vector3();
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      this.directionAt(p.s, dir);
      const nx = -dir.z;
      const nz = dir.x;
      for (let side = -1; side <= 1; side += 2) {
        const x = p.x + nx * width * 0.5 * side;
        const z = p.z + nz * width * 0.5 * side;
        positions.push(x, this.field.surfaceHeight(x, z) + 0.06 - (this.field.crevasseDepth(x, z) > 0.5 ? 0.6 : 0), z);
        uvs.push(side < 0 ? 0 : 1, p.s / 3.2);
      }
      if (i < pts.length - 1) {
        const a = i * 2;
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      roughness: 0.95,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'bootTrack';
    mesh.receiveShadow = true;
    mesh.renderOrder = 1;
    return mesh;
  }

  private buildRopes(): THREE.Group {
    const group = new THREE.Group();
    group.name = 'fixedRopes';
    const ropeMat = new THREE.MeshStandardMaterial({ color: 0xc8202a, roughness: 0.7 });
    const oldRopeMat = new THREE.MeshStandardMaterial({ color: 0x6a4a7a, roughness: 0.9 });
    const metal = new THREE.MeshStandardMaterial({ color: 0xaab2b8, roughness: 0.35, metalness: 0.9 });
    const stakeGeo = new THREE.CylinderGeometry(0.025, 0.035, 0.9, 6);
    const ringGeo = new THREE.TorusGeometry(0.06, 0.012, 6, 12);
    const tmp = new THREE.Vector3();

    for (const seg of this.ropes) {
      const curvePts: THREE.Vector3[] = [];
      const oldPts: THREE.Vector3[] = [];
      const n = 14;
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        curvePts.push(this.ropePoint(seg, t, new THREE.Vector3()));
        const o = this.ropePoint(seg, t, new THREE.Vector3());
        o.x += 0.35; o.z += 0.2;
        o.y = Math.max(this.field.surfaceHeight(o.x, o.z) + 0.05, o.y - 0.25);
        oldPts.push(o);
      }
      const curve = new THREE.CatmullRomCurve3(curvePts);
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 28, 0.011, 5, false), ropeMat);
      tube.castShadow = true;
      group.add(tube);
      const oldCurve = new THREE.CatmullRomCurve3(oldPts);
      group.add(new THREE.Mesh(new THREE.TubeGeometry(oldCurve, 20, 0.009, 4, false), oldRopeMat));

      // Snow picket / ice screw anchor at the lower end.
      const stake = new THREE.Mesh(stakeGeo, metal);
      tmp.copy(seg.a);
      stake.position.set(tmp.x, tmp.y - 0.25, tmp.z);
      stake.rotation.z = 0.25;
      stake.castShadow = true;
      group.add(stake);
      const ring = new THREE.Mesh(ringGeo, metal);
      ring.position.copy(seg.a);
      group.add(ring);
    }
    // Top anchor of each section
    const last = this.ropes[this.ropes.length - 1];
    if (last) {
      const stake = new THREE.Mesh(stakeGeo, metal);
      stake.position.set(last.b.x, last.b.y - 0.25, last.b.z);
      group.add(stake);
    }
    return group;
  }
}
