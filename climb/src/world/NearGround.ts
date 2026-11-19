import * as THREE from 'three';
import type { MountainField } from './Terrain';
import { Noise2D, smoothstep } from '../utils/noise';

/**
 * High-resolution ground right around the climber (~0.6 m cells), carrying
 * micro-relief the coarse terrain cannot: wind-carved sastrugi, kicked-up snow
 * lumps and blocky rock where it is steep. Rebuilt a few rows per frame as the
 * player moves so there is no hitch.
 */
export class NearGround {
  readonly mesh: THREE.Mesh;
  private readonly N: number;
  private readonly cell: number;
  private readonly noise: Noise2D;
  private readonly geo: THREE.BufferGeometry;
  private readonly pos: Float32Array;
  private readonly ao: Float32Array;
  private readonly crev: Float32Array;
  private readonly staging: Float32Array;
  private readonly stagingAO: Float32Array;
  private readonly stagingCrev: Float32Array;
  private center = new THREE.Vector2(1e9, 1e9);
  private pending: THREE.Vector2 | null = null;
  private row = 0;
  private field: MountainField | null = null;
  /** Called with the new patch centre and the half-size the coarse terrain should hide. */
  onSwap: (cx: number, cz: number, half: number) => void = () => undefined;

  constructor(material: THREE.Material, mobile: boolean) {
    this.N = mobile ? 72 : 96;
    this.cell = mobile ? 0.7 : 0.6;
    this.noise = new Noise2D(9137);
    const n1 = this.N + 1;
    this.pos = new Float32Array(n1 * n1 * 3);
    this.ao = new Float32Array(n1 * n1).fill(1);
    this.crev = new Float32Array(n1 * n1);
    this.staging = new Float32Array(n1 * n1 * 3);
    this.stagingAO = new Float32Array(n1 * n1);
    this.stagingCrev = new Float32Array(n1 * n1);
    const idx: number[] = [];
    for (let j = 0; j < this.N; j++) {
      for (let i = 0; i < this.N; i++) {
        const a = j * n1 + i, b = a + 1, c = a + n1, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('aAO', new THREE.BufferAttribute(this.ao, 1));
    this.geo.setAttribute('aCrev', new THREE.BufferAttribute(this.crev, 1));
    this.geo.setAttribute('aNear', new THREE.BufferAttribute(new Float32Array(n1 * n1).fill(1), 1));
    this.geo.setIndex(idx);
    this.mesh = new THREE.Mesh(this.geo, material);
    this.mesh.name = 'nearGround';
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    // Draw on top of the coarse terrain it overlaps.
    this.mesh.renderOrder = 0;
  }

  setField(field: MountainField, material: THREE.Material): void {
    this.field = field;
    this.mesh.material = material;
    this.center.set(1e9, 1e9);
    this.pending = null;
    this.mesh.visible = false;
  }

  /** Micro relief in metres, fading to 0 at the patch rim and on the beaten track. */
  private micro(x: number, z: number, routeD: number, steep: number, rim: number): number {
    const n = this.noise;
    const off = smoothstep(0.9, 3.5, routeD);
    // sastrugi: ridges elongated across the prevailing wind (from the west)
    const sas = (1 - Math.abs(n.noise(x * 0.18, z * 0.7))) ** 3 * 0.16;
    const lumps = n.noise(x * 0.9, z * 0.9) * 0.05 + n.noise(x * 2.3, z * 2.3) * 0.02;
    const rock = steep * (Math.abs(n.noise(x * 0.45, z * 0.45)) * 0.35 + n.noise(x * 1.7, z * 1.7) * 0.08);
    return (sas * (1 - steep) + lumps + rock) * (0.25 + 0.75 * off) * rim;
  }

  update(player: THREE.Vector3): void {
    const field = this.field;
    if (!field) return;
    const snap = 6;
    const cx = Math.round(player.x / snap) * snap;
    const cz = Math.round(player.z / snap) * snap;
    if (!this.pending && (Math.abs(cx - this.center.x) > snap * 1.5 || Math.abs(cz - this.center.y) > snap * 1.5 || !this.mesh.visible)) {
      this.pending = new THREE.Vector2(cx, cz);
      this.row = 0;
    }
    if (!this.pending) return;
    const N = this.N, n1 = N + 1, cell = this.cell;
    const half = (N * cell) / 2;
    const first = !this.mesh.visible;
    const rowsPerFrame = first ? n1 : 10;
    const end = Math.min(n1, this.row + rowsPerFrame);
    const nrm = new THREE.Vector3();
    for (let j = this.row; j < end; j++) {
      for (let i = 0; i <= N; i++) {
        const x = this.pending.x - half + i * cell;
        const z = this.pending.y - half + j * cell;
        const h = field.height(x, z);
        const routeD = field.lastRouteDistance;
        const k = j * n1 + i;
        let steep = 0;
        if ((i & 3) === 0 && (j & 3) === 0) {
          field.normal(x, z, nrm, 1.2);
          steep = smoothstep(0.8, 0.55, nrm.y);
          this.stagingAO[k] = steep; // stash coarse steepness, spread below
        } else {
          const ki = (j & ~3) * n1 + (i & ~3);
          steep = this.stagingAO[ki];
        }
        const ex = Math.min(i, N - i, j, N - j) * cell;
        const rim = smoothstep(0, 6, ex);
        const m = this.micro(x, z, routeD, steep, rim);
        const cd = field.cracks.length ? field.crevasseDepth(x, z) : 0;
        this.staging[k * 3] = x;
        this.staging[k * 3 + 1] = h + (cd > 0.3 ? 0 : m);
        this.staging[k * 3 + 2] = z;
        this.stagingCrev[k] = cd / 24;
      }
    }
    this.row = end;
    if (this.row >= n1) {
      // Swap in the finished patch.
      this.pos.set(this.staging);
      this.crev.set(this.stagingCrev);
      // Cavity shading from the micro relief: hollows between sastrugi darker.
      for (let j = 0; j <= N; j++) {
        for (let i = 0; i <= N; i++) {
          const k = j * n1 + i;
          const h = this.pos[k * 3 + 1];
          const l = this.pos[(j * n1 + Math.max(0, i - 1)) * 3 + 1];
          const r = this.pos[(j * n1 + Math.min(N, i + 1)) * 3 + 1];
          const u = this.pos[(Math.max(0, j - 1) * n1 + i) * 3 + 1];
          const d = this.pos[(Math.min(N, j + 1) * n1 + i) * 3 + 1];
          const c = ((l + r + u + d) * 0.25 - h) / cell;
          this.ao[k] = Math.min(1.1, Math.max(0.6, 1 - c * 2.2));
        }
      }
      (this.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      (this.geo.getAttribute('aAO') as THREE.BufferAttribute).needsUpdate = true;
      (this.geo.getAttribute('aCrev') as THREE.BufferAttribute).needsUpdate = true;
      this.geo.computeVertexNormals();
      this.center.copy(this.pending!);
      this.pending = null;
      this.mesh.visible = true;
      this.onSwap(this.center.x, this.center.y, (this.N * this.cell) / 2 - 0.8);
    }
  }
}
