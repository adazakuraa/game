import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import type { MountainDef } from '../game/Mountains';
import type { MountainField } from './Terrain';
import type { Route } from './Route';
import { createSeededRandom } from '../utils/random';
import { Noise2D } from '../utils/noise';
import { createTerrainTextures } from './TerrainTextures';

/** Weld duplicate vertices so displaced rocks stay watertight. */
function BufferGeometryUtilsMerge(g: THREE.BufferGeometry): THREE.BufferGeometry {
  return mergeVertices(g, 1e-4);
}

export interface WindUniforms {
  uTime: { value: number };
  uWind: { value: number };
}

/** Adds a wind-flap vertex displacement to a standard material. */
function flapMaterial(mat: THREE.MeshStandardMaterial, wind: WindUniforms, mode: 'flag' | 'tent'): THREE.MeshStandardMaterial {
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, wind);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uTime; uniform float uWind;`)
      .replace('#include <begin_vertex>', mode === 'flag'
        ? `#include <begin_vertex>
          float iid = 0.0;
          #ifdef USE_INSTANCING
            iid = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.21;
          #endif
          float k = uv.x;
          float w = 0.25 + uWind * 0.012;
          transformed.z += sin(uTime * (6.0 + uWind*0.08) + k * 7.0 + iid) * 0.07 * k * w;
          transformed.y += cos(uTime * 5.0 + k * 5.0 + iid) * 0.03 * k * w;`
        : `#include <begin_vertex>
          float fl = sin(uTime * (4.0 + uWind*0.05) + position.x * 3.0 + position.z * 2.0) * 0.012 * (0.5 + uWind*0.03);
          transformed += normal * fl * smoothstep(0.1, 0.8, position.y);`);
  };
  mat.customProgramCacheKey = () => `flap-${mode}`;
  return mat;
}

export interface Hazard {
  kind: 'serac' | 'icefall' | 'rock';
  /** route arc-length range where the hazard threatens */
  s0: number;
  s1: number;
  origin: THREE.Vector3;
  along: THREE.Vector3;
}

export interface Ladder {
  cx: number; cz: number;
  ux: number; uz: number;
  halfLen: number;
  y0: number; y1: number;
  s: number;
}

export interface OxygenCache {
  position: THREE.Vector3;
  mesh: THREE.Object3D;
  taken: boolean;
  routeS: number;
}

export class Props {
  readonly group = new THREE.Group();
  readonly wind: WindUniforms = { uTime: { value: 0 }, uWind: { value: 20 } };
  readonly hazards: Hazard[] = [];
  readonly ladders: Ladder[] = [];
  readonly caches: OxygenCache[] = [];
  private readonly rng: () => number;

  constructor(
    private readonly def: MountainDef,
    private readonly field: MountainField,
    private readonly route: Route,
  ) {
    this.group.name = 'props';
    this.rng = createSeededRandom(def.seed + 5);
    const base = def.campAltitude < 5600;
    this.buildCamp(0, base ? 14 : 6, base);
    if (def.goal === 'camp') this.buildCamp(route.length, 6, false);
    else this.buildSummit();
    if (base) this.buildChorten();
    this.buildRocks();
    if (def.campAltitude >= 7000) this.buildLitter();
    if (def.goal === 'summit') this.buildCache();
    this.buildLadders();
    if (def.seracField) this.buildIceTowers();
    this.buildHazards();
  }

  /** Ice-axe point of each crevasse crossing: an aluminium ladder bridge. */
  private buildLadders(): void {
    const metal = new THREE.MeshStandardMaterial({ color: 0xc4ccd2, metalness: 0.85, roughness: 0.35 });
    const lash = new THREE.MeshStandardMaterial({ color: 0x2a5bd1, roughness: 0.8 });
    for (const c of this.field.cracks) {
      const cosA = Math.max(0.5, Math.abs(c.nx * c.routeX + c.nz * c.routeZ));
      const len = (c.half * 2) / cosA + 2.8;
      const half = len / 2;
      const ax = c.cx - c.routeX * half, az = c.cz - c.routeZ * half;
      const bx = c.cx + c.routeX * half, bz = c.cz + c.routeZ * half;
      const y0 = this.field.surfaceHeight(ax, az) + 0.05;
      const y1 = this.field.surfaceHeight(bx, bz) + 0.05;
      const g = new THREE.Group();
      g.name = 'ladderBridge';
      const railGeo = new THREE.BoxGeometry(0.035, 0.07, len);
      for (const side of [-0.22, 0.22]) {
        const rail = new THREE.Mesh(railGeo, metal);
        rail.position.set(side, 0, 0);
        rail.castShadow = true;
        g.add(rail);
      }
      const rungGeo = new THREE.CylinderGeometry(0.014, 0.014, 0.44, 6).rotateZ(Math.PI / 2);
      for (let r = -half + 0.15; r < half; r += 0.3) {
        const rung = new THREE.Mesh(rungGeo, metal);
        rung.position.set(0, 0.0, r);
        g.add(rung);
      }
      // Lashings where ladder sections are tied together.
      for (let k = -1; k <= 1; k += 2) {
        const l = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.09, 0.08), lash);
        l.position.set(0, 0, k * half * 0.33);
        g.add(l);
      }
      const ry = Math.atan2(c.routeX, c.routeZ);
      g.position.set(c.cx, (y0 + y1) / 2, c.cz);
      g.rotation.order = 'YXZ';
      g.rotation.y = ry;
      g.rotation.x = -Math.atan2(y1 - y0, len);
      this.group.add(g);
      const near = this.route.nearest(c.cx, c.cz);
      this.ladders.push({ cx: c.cx, cz: c.cz, ux: c.routeX, uz: c.routeZ, halfLen: half, y0, y1, s: near.s });
    }
  }

  /** Icefall seracs: tumbled towers of blue ice either side of the route. */
  private buildIceTowers(): void {
    const geo = new THREE.BoxGeometry(1, 1, 1, 4, 6, 4);
    const n = new Noise2D(this.def.seed + 31);
    const pos = geo.getAttribute('position');
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const k = 1 + n.noise(x * 2.1 + y * 1.3, z * 2.1) * 0.22;
      pos.setXYZ(i, x * k, y + (y > 0.4 ? n.noise(x * 3, z * 3) * 0.12 : 0), z * k);
    }
    geo.computeVertexNormals();
    const nrm = geo.getAttribute('normal');
    for (let i = 0; i < pos.count; i++) {
      const top = nrm.getY(i) > 0.6 ? 1 : 0;
      col[i * 3] = top ? 0.95 : 0.62;
      col[i * 3 + 1] = top ? 0.97 : 0.8;
      col[i * 3 + 2] = top ? 1.0 : 0.92;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, emissive: 0x061422 });
    const count = 120;
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    let used = 0;
    for (let i = 0; i < count * 3 && used < count; i++) {
      const sAt = this.rng() * this.route.length;
      if (this.route.crevasseS.some((cs) => Math.abs(cs - sAt) < 10)) continue;
      const p = this.route.pointAt(sAt);
      const d = this.route.directionAt(sAt);
      const lat = (this.rng() < 0.5 ? -1 : 1) * (7 + Math.pow(this.rng(), 1.3) * 55);
      const x = p.x - d.z * lat, z = p.z + d.x * lat;
      const w = 3 + this.rng() * 7;
      const h = 4 + this.rng() * 12 * Math.min(1, Math.abs(lat) / 20);
      q.setFromEuler(new THREE.Euler((this.rng() - 0.5) * 0.3, this.rng() * 6, (this.rng() - 0.5) * 0.3));
      m4.compose(new THREE.Vector3(x, this.ground(x, z) + h * 0.4, z), q, new THREE.Vector3(w, h, w * (0.6 + this.rng() * 0.6)));
      mesh.setMatrixAt(used++, m4);
    }
    mesh.count = used;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    mesh.name = 'iceTowers';
    this.group.add(mesh);
  }

  private buildHazards(): void {
    const def = this.def;
    const r = this.route;
    if (def.seracZone && def.goal === 'summit') {
      this.buildSerac();
    } else if (def.seracZone) {
      const s0 = r.waypointS[def.seracZone[0]], s1 = r.waypointS[def.seracZone[1]];
      const mid = r.pointAt((s0 + s1) / 2);
      const d = r.directionAt((s0 + s1) / 2);
      const origin = mid.clone().add(new THREE.Vector3(-d.z * 45, 18, d.x * 45));
      this.hazards.push({ kind: 'icefall', s0, s1, origin, along: d.clone() });
    }
    if (def.rockfallZone) {
      const s0 = r.waypointS[def.rockfallZone[0]], s1 = r.waypointS[def.rockfallZone[1]];
      const mid = r.pointAt((s0 + s1) / 2);
      const ahead = r.pointAt(Math.min(r.length, s1 + 60));
      const up = ahead.clone().sub(mid).setY(0).normalize();
      const origin = mid.clone().addScaledVector(up, 60);
      origin.y = mid.y + 40;
      const along = new THREE.Vector3(-up.z, 0, up.x);
      this.hazards.push({ kind: 'rock', s0, s1, origin, along });
    }
  }

  /** Base camp chorten: a stone altar with prayer-flag lines radiating out. */
  private buildChorten(): void {
    const camp = this.route.pointAt(0);
    const dir = this.route.directionAt(4);
    const x = camp.x + dir.x * 4 - dir.z * 9;
    const z = camp.z + dir.z * 4 + dir.x * 9;
    const y = this.ground(x, z);
    const stone = new THREE.MeshStandardMaterial({ color: 0x8a8580, roughness: 0.95 });
    const white = new THREE.MeshStandardMaterial({ color: 0xe9e6df, roughness: 0.9 });
    const g = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.9, 2.4, 3, 2, 3), stone);
    base.position.y = 0.45;
    g.add(base);
    const mid = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 1.0, 1.0, 10), white);
    mid.position.y = 1.4;
    g.add(mid);
    const top = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1.0, 10), white);
    top.position.y = 2.4;
    g.add(top);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 5.5, 6), new THREE.MeshStandardMaterial({ color: 0x6b4a2e }));
    pole.position.y = 3.2;
    g.add(pole);
    g.traverse((o) => { o.castShadow = true; o.receiveShadow = true; });
    g.position.set(x, y, z);
    g.name = 'pujaChorten';
    this.group.add(g);
    this.buildFlags(new THREE.Vector3(x, y + 5.8, z), 9, 12, 18, 26);
  }

  private ground(x: number, z: number): number {
    return this.field.height(x, z);
  }

  private buildCamp(atS: number, count: number, wide: boolean): void {
    const camp = this.route.pointAt(atS);
    const dir = this.route.directionAt(Math.min(this.route.length, Math.max(0, atS + (atS > 0 ? -4 : 4))));
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    const colors = [0xf2a516, 0xe8531d, 0xf2c014, 0x2a6fc4, 0xe8531d, 0xf2a516];
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.4, metalness: 0.6 });
    const snowMat = new THREE.MeshStandardMaterial({ color: 0xf1f4f8, roughness: 0.9 });
    const lineMat = new THREE.LineBasicMaterial({ color: 0xd0d0d0 });
    const tentGeo = new THREE.SphereGeometry(1.25, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2);
    // Fabric sag between poles
    const pos = tentGeo.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i); const y = pos.getY(i); const z = pos.getZ(i);
      const a = Math.atan2(z, x);
      const sag = 1 - 0.07 * Math.abs(Math.sin(a * 2)) * Math.sin((y / 1.25) * Math.PI);
      pos.setXYZ(i, x * sag * 1.25, y * 0.82, z * sag);
    }
    tentGeo.computeVertexNormals();
    const spread = wide ? 2.2 : 1;
    for (let i = 0; i < count; i++) {
      // Tents line both sides of the track, ahead of and behind the start point.
      const along = (atS > 0 ? -16 : -14) + (i / count) * (atS > 0 ? 24 : 30) * spread + (this.rng() - 0.5) * 3;
      const lat = (i % 2 ? 1 : -1) * (4.5 + this.rng() * 5 * spread);
      const x = camp.x + dir.x * along + side.x * lat;
      const z = camp.z + dir.z * along + side.z * lat;
      const y = this.ground(x, z);
      const tent = new THREE.Group();
      tent.name = 'campTent';
      const mat = flapMaterial(new THREE.MeshStandardMaterial({ color: colors[i % colors.length], roughness: 0.65 }), this.wind, 'tent');
      const body = new THREE.Mesh(tentGeo, mat);
      body.castShadow = true;
      body.receiveShadow = true;
      tent.add(body);
      for (let p = 0; p < 2; p++) {
        const arc = new THREE.Mesh(new THREE.TorusGeometry(1.26, 0.018, 4, 24, Math.PI), poleMat);
        arc.rotation.y = Math.PI / 4 + p * Math.PI / 2;
        arc.scale.set(1.25, 0.82, 1);
        tent.add(arc);
      }
      const drift = new THREE.Mesh(new THREE.SphereGeometry(1.6, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2), snowMat);
      drift.scale.set(1.25, 0.12, 1.1);
      drift.position.y = -0.05;
      drift.receiveShadow = true;
      tent.add(drift);
      // Guy lines
      const pts: THREE.Vector3[] = [];
      for (let g = 0; g < 4; g++) {
        const a = g * Math.PI / 2 + 0.6;
        pts.push(new THREE.Vector3(Math.cos(a) * 1.1, 0.75, Math.sin(a) * 1.0));
        pts.push(new THREE.Vector3(Math.cos(a) * 2.6, 0.0, Math.sin(a) * 2.4));
      }
      tent.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), lineMat));
      tent.position.set(x, y - 0.05, z);
      tent.rotation.y = this.rng() * Math.PI;
      const n = this.field.normal(x, z);
      tent.quaternion.premultiply(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n.lerp(new THREE.Vector3(0, 1, 0), 0.6).normalize()));
      this.group.add(tent);
    }
  }

  private buildSummit(): void {
    const top = this.route.pointAt(this.route.length);
    this.buildFlags(new THREE.Vector3(top.x, top.y + 1.3, top.z), 7, 14, 4, 7);
    // Summit marker: small survey pole wrapped in khata scarves.
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.05, 1.5, 6),
      new THREE.MeshStandardMaterial({ color: 0x9a9fa5, metalness: 0.7, roughness: 0.4 }),
    );
    pole.position.set(top.x, top.y + 0.7, top.z);
    this.group.add(pole);
  }

  private buildFlags(origin: THREE.Vector3, lines: number, perLine: number, lenMin: number, lenMax: number): void {
    const colors = [0x1f5fd1, 0xf3f3f3, 0xd62b2b, 0x1f9b4a, 0xf2c51a];
    const flagGeo = new THREE.PlaneGeometry(0.28, 0.2, 6, 1).translate(0.14, -0.1, 0);
    const mats = colors.map((c) =>
      flapMaterial(new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, side: THREE.DoubleSide }), this.wind, 'flag'),
    );
    const meshes = mats.map((m) => new THREE.InstancedMesh(flagGeo, m, Math.ceil((lines * perLine) / 5) + 2));
    const counts = new Array(5).fill(0);
    const lineMat = new THREE.LineBasicMaterial({ color: 0x8a7a60 });
    const linePts: THREE.Vector3[] = [];
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    for (let l = 0; l < lines; l++) {
      const a = (l / lines) * Math.PI * 2 + this.rng() * 0.4;
      const len = lenMin + this.rng() * (lenMax - lenMin);
      const ex = origin.x + Math.cos(a) * len;
      const ez = origin.z + Math.sin(a) * len;
      const end = new THREE.Vector3(ex, this.ground(ex, ez) + 0.15, ez);
      linePts.push(origin.clone(), end.clone());
      const dir = end.clone().sub(origin);
      const yaw = Math.atan2(-dir.z, dir.x);
      for (let f = 0; f < perLine; f++) {
        const t = (f + 0.5) / perLine;
        const p = origin.clone().lerp(end, t);
        p.y -= Math.sin(t * Math.PI) * (0.35 + len * 0.04);
        const ci = f % 5;
        q.setFromEuler(new THREE.Euler(0, yaw, -0.2));
        m4.compose(p, q, new THREE.Vector3(1, 1, 1));
        meshes[ci].setMatrixAt(counts[ci]++, m4);
      }
    }
    meshes.forEach((m, i) => {
      m.count = counts[i];
      m.instanceMatrix.needsUpdate = true;
      m.name = 'prayerFlags';
      m.frustumCulled = false;
      this.group.add(m);
    });
    this.group.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(linePts), lineMat));
  }

  private makeRockGeometry(seed: number, detail = 2): THREE.BufferGeometry {
    const g0 = new THREE.IcosahedronGeometry(1, detail);
    g0.deleteAttribute('normal');
    const g = BufferGeometryUtilsMerge(g0);
    const n = new Noise2D(seed);
    const pos = g.getAttribute('position');
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i); const y = pos.getY(i); const z = pos.getZ(i);
      // Fractured blocky rock: quantised planes + noise
      let d = 1 + n.noise(x * 1.3 + y, z * 1.3) * 0.3 + n.noise(x * 3.5, y * 3.5 + z) * 0.1 + n.noise(x * 9, z * 9 + y) * 0.03;
      const facet = Math.max(Math.abs(x) * 0.95, Math.abs(y) * 1.1, Math.abs(z));
      d *= 0.75 + 0.25 / Math.max(0.6, facet);
      pos.setXYZ(i, x * d * 1.2, y * d * 0.75, z * d);
    }
    g.computeVertexNormals();
    const nrm = g.getAttribute('normal');
    for (let i = 0; i < pos.count; i++) {
      const snow = Math.min(1, Math.max(0, (nrm.getY(i) - 0.5) * 5));
      const c = 0.42 + n.noise(pos.getX(i) * 2, pos.getY(i) * 2) * 0.08;
      colors[i * 3] = c + (1.9 - c) * snow;
      colors[i * 3 + 1] = c * 0.95 + (1.95 - c * 0.95) * snow;
      colors[i * 3 + 2] = c * 0.9 + (2.05 - c * 0.9) * snow;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return g;
  }

  private buildRocks(): void {
    const tex = createTerrainTextures(this.def.seed);
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.92, map: tex.rockAlbedo, normalMap: tex.rockNormal,
      normalScale: new THREE.Vector2(1.4, 1.4),
    });
    const geos = [this.makeRockGeometry(3), this.makeRockGeometry(17)];
    const count = 150;
    const meshes = geos.map((g) => new THREE.InstancedMesh(g, mat, count));
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const used = [0, 0];
    for (let i = 0; i < count * 2; i++) {
      const s = this.rng() * this.route.length;
      const p = this.route.pointAt(s);
      const d = this.route.directionAt(s);
      const side = this.rng() < 0.5 ? -1 : 1;
      const lat = side * (3.5 + Math.pow(this.rng(), 1.6) * 30);
      const x = p.x - d.z * lat;
      const z = p.z + d.x * lat;
      const n = this.field.normal(x, z);
      if (n.y > 0.93 && this.rng() < 0.7) continue; // rocks protrude where slopes steepen
      const k = i % 2;
      if (used[k] >= count) continue;
      const scale = 0.35 + Math.pow(this.rng(), 2.2) * 2.6;
      q.setFromEuler(new THREE.Euler(this.rng() * 0.5, this.rng() * Math.PI * 2, this.rng() * 0.5));
      m4.compose(new THREE.Vector3(x, this.ground(x, z) - scale * 0.25, z), q, new THREE.Vector3(scale, scale, scale));
      meshes[k].setMatrixAt(used[k]++, m4);
    }
    meshes.forEach((m, i) => {
      m.count = used[i];
      m.instanceMatrix.needsUpdate = true;
      m.castShadow = true;
      m.receiveShadow = true;
      m.name = 'routeRocks';
      m.computeBoundingSphere();
      this.group.add(m);
    });

    // Hillary-step style rock band on Everest just below the summit.
    if (this.def.stageKey === 'everest-summit') {
      const g = this.makeRockGeometry(41, 3);
      for (let k = 0; k < 7; k++) {
        const s = this.route.waypointS[9] - 6 + k * 1.6;
        const p = this.route.pointAt(s);
        const d = this.route.directionAt(s);
        const lat = (k % 2 ? 1 : -1) * (2.2 + this.rng() * 1.5);
        const x = p.x - d.z * lat;
        const z = p.z + d.x * lat;
        const rock = new THREE.Mesh(g, mat);
        const sc = 1.6 + this.rng() * 1.6;
        rock.scale.set(sc, sc * 1.6, sc);
        rock.position.set(x, this.ground(x, z) + sc * 0.3, z);
        rock.rotation.y = this.rng() * 6;
        rock.castShadow = true;
        rock.receiveShadow = true;
        rock.name = 'hillaryStepRock';
        this.group.add(rock);
      }
    }
  }

  private bottleMesh(color: number): THREE.Group {
    const g = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.06, 0.42, 4, 10),
      new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.3 }),
    );
    g.add(body);
    const valve = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.03, 0.08, 8),
      new THREE.MeshStandardMaterial({ color: 0xc9c9c9, metalness: 0.9, roughness: 0.3 }),
    );
    valve.position.y = 0.3;
    g.add(valve);
    g.traverse((o) => { o.castShadow = true; });
    return g;
  }

  private buildLitter(): void {
    // Spent oxygen bottles: a grim but real feature of high camps.
    const camp = this.route.pointAt(0);
    for (let i = 0; i < 9; i++) {
      const x = camp.x + (this.rng() - 0.5) * 30;
      const z = camp.z + (this.rng() - 0.5) * 30;
      const b = this.bottleMesh(i % 3 ? 0xd9601e : 0x8a8f96);
      b.position.set(x, this.ground(x, z) + 0.05, z);
      b.rotation.set(Math.PI / 2, this.rng() * 6, 0.2);
      this.group.add(b);
    }
  }

  private buildCache(): void {
    const idx = this.def.id === 'everest' ? 4 : 3;
    const s = this.route.waypointS[idx] + 2;
    const p = this.route.pointAt(s);
    const d = this.route.directionAt(s);
    const x = p.x - d.z * -1.6;
    const z = p.z + d.x * -1.6;
    const group = new THREE.Group();
    group.name = 'oxygenCache';
    const b1 = this.bottleMesh(0xe8601c);
    b1.rotation.z = 1.2;
    b1.position.y = 0.1;
    group.add(b1);
    const wand = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.012, 1.2, 5),
      new THREE.MeshStandardMaterial({ color: 0x2b6b2f }),
    );
    wand.position.set(0.3, 0.6, 0);
    group.add(wand);
    const tag = new THREE.Mesh(
      new THREE.PlaneGeometry(0.18, 0.12),
      new THREE.MeshStandardMaterial({ color: 0xff3a2a, emissive: 0x551008, side: THREE.DoubleSide }),
    );
    tag.position.set(0.39, 1.1, 0);
    group.add(tag);
    const y = this.ground(x, z);
    group.position.set(x, y, z);
    this.group.add(group);
    this.caches.push({ position: new THREE.Vector3(x, y, z), mesh: group, taken: false, routeS: s });
  }

  private buildSerac(): void {
    const [from, to] = this.def.seracZone!;
    const a = this.route.pointAt(this.route.waypointS[from]);
    const b = this.route.pointAt(this.route.waypointS[to]);
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const toSummit = new THREE.Vector3(-mid.x, 0, -mid.z).normalize();
    const center = mid.clone().addScaledVector(toSummit, 48);
    const along = new THREE.Vector3().subVectors(b, a).setY(0).normalize();
    const width = a.distanceTo(b) * 1.5;
    const geo = new THREE.BoxGeometry(width, 34, 22, 40, 14, 6);
    const n = new Noise2D(77);
    const pos = geo.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i); const y = pos.getY(i); const z = pos.getZ(i);
      const k = n.noise(x * 0.08, y * 0.12) * 2.5 + n.noise(x * 0.3, y * 0.3) * 0.7;
      const overhang = Math.max(0, y) * 0.12;
      pos.setXYZ(i, x + n.noise(y * 0.1, z * 0.1) * 1.5, y + (y > 10 ? n.noise(x * 0.05, 3) * 4 : 0), z + k + (z > 0 ? overhang : 0));
    }
    geo.computeVertexNormals();
    const ice = new THREE.MeshStandardMaterial({ color: 0x8fbad6, roughness: 0.22, metalness: 0.0, emissive: 0x0a1a28 });
    const mesh = new THREE.Mesh(geo, ice);
    mesh.name = 'seracWall';
    const groundY = this.ground(center.x, center.z);
    mesh.position.set(center.x, groundY + 14, center.z);
    mesh.lookAt(new THREE.Vector3(mid.x, groundY + 14, mid.z));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    const cap = new THREE.Mesh(
      new THREE.BoxGeometry(width * 1.02, 4, 24, 20, 1, 4),
      new THREE.MeshStandardMaterial({ color: 0xf2f5f9, roughness: 0.85 }),
    );
    cap.position.set(0, 18, 1);
    mesh.add(cap);
    this.hazards.push({
      kind: 'serac',
      s0: this.route.waypointS[from],
      s1: this.route.waypointS[to],
      origin: new THREE.Vector3(center.x, groundY + 4, center.z).addScaledVector(toSummit, -12),
      along,
    });
  }

  update(time: number, wind: number): void {
    this.wind.uTime.value = time;
    this.wind.uWind.value = wind;
  }
}
