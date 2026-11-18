import * as THREE from 'three';
import { bottomMaterial, heightAt, WORLD } from './layout';
import { underwaterMaterial } from '../render/underwater';
import { makeGroundDetail } from '../render/textures';

const CHUNK = 40;

/** Streams heightfield chunks around the camera. Normals come from the analytic height so seams match. */
export class Terrain {
  readonly group = new THREE.Group();
  private chunks = new Map<string, THREE.Mesh>();
  private material: THREE.MeshStandardMaterial;
  private queue: string[] = [];
  readonly radius = 95;

  constructor() {
    const detail = makeGroundDetail();
    detail.repeat.set(1, 1);
    this.material = underwaterMaterial(
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.93,
        metalness: 0,
        map: detail,
        bumpMap: detail,
        bumpScale: 1.4,
        envMapIntensity: 0.25,
      }),
      {
        key: 'terrain',
        vertexHead: 'attribute float aSand;\nvarying float vSand;',
        vertexBody: 'vSand = aSand;',
        fragHead: 'varying float vSand;',
        // procedural sand ripples via screen-space derivative bump
        fragBeforeLights: `
  {
    vec2 p = vUwPos.xz;
    float warp = sin( p.y * 0.21 + sin( p.x * 0.13 ) * 1.7 ) * 1.6;
    float rip = sin( p.x * 2.4 + warp + sin( p.y * 0.9 ) * 0.6 );
    rip = rip * 0.5 + 0.5; rip = pow( rip, 1.6 );
    float h = rip * vSand * 0.06;
    vec3 dpx = dFdx( -vViewPosition ), dpy = dFdy( -vViewPosition );
    float dhx = dFdx( h ), dhy = dFdy( h );
    vec3 r1 = cross( dpy, normal ), r2 = cross( normal, dpx );
    float det = dot( dpx, r1 );
    vec3 grad = sign( det ) * ( dhx * r1 + dhy * r2 );
    vec3 rn = abs( det ) * normal - grad;
    normal = dot( rn, rn ) > 1e-12 ? normalize( rn ) : normal;
  }`,
        fragDiffuse: `
  {
    // break tiling with a second, larger scale sample of the detail map
    #ifdef USE_MAP
      float big = texture2D( map, vUwPos.xz * 0.013 ).r;
      diffuseColor.rgb *= 0.75 + big * 0.45;
    #endif
  }`,
      },
    );
  }

  private key(cx: number, cz: number) {
    return cx + ',' + cz;
  }

  private build(cx: number, cz: number): THREE.Mesh {
    const x0 = cx * CHUNK;
    const z0 = cz * CHUNK;
    const deep = z0 > 470;
    const wall = z0 > 290 && z0 < 400;
    const seg = deep ? 20 : wall ? 56 : 40;
    const n = seg + 1;
    const step = CHUNK / seg;
    const pos = new Float32Array(n * n * 3);
    const nor = new Float32Array(n * n * 3);
    const col = new Float32Array(n * n * 3);
    const uv = new Float32Array(n * n * 2);
    const sand = new Float32Array(n * n);
    const m = [0, 0, 0, 0];
    const e = 0.6;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = x0 + i * step;
        const z = z0 + j * step;
        const h = heightAt(x, z);
        const k = j * n + i;
        pos[k * 3] = x;
        pos[k * 3 + 1] = h;
        pos[k * 3 + 2] = z;
        const hx = heightAt(x + e, z) - heightAt(x - e, z);
        const hz = heightAt(x, z + e) - heightAt(x, z - e);
        const nx = -hx, ny = 2 * e, nz = -hz;
        const l = Math.hypot(nx, ny, nz);
        nor[k * 3] = nx / l;
        nor[k * 3 + 1] = ny / l;
        nor[k * 3 + 2] = nz / l;
        const slope = 1 - ny / l;
        bottomMaterial(x, z, slope * 2.2, m);
        // baked cavity darkening: concave spots darker
        const lap = heightAt(x + 2, z) + heightAt(x - 2, z) + heightAt(x, z + 2) + heightAt(x, z - 2) - 4 * h;
        const ao = Math.max(0.55, Math.min(1.08, 1 - lap * 0.08));
        col[k * 3] = m[0] * ao;
        col[k * 3 + 1] = m[1] * ao;
        col[k * 3 + 2] = m[2] * ao;
        sand[k] = m[3] * (1 - Math.min(1, slope * 3));
        uv[k * 2] = x / 3.5;
        uv[k * 2 + 1] = z / 3.5;
      }
    }
    const idx = new Uint32Array(seg * seg * 6);
    let p = 0;
    for (let j = 0; j < seg; j++) {
      for (let i = 0; i < seg; i++) {
        const a = j * n + i;
        const b = a + 1;
        const c = a + n;
        const d = c + 1;
        idx[p++] = a; idx[p++] = c; idx[p++] = b;
        idx[p++] = b; idx[p++] = c; idx[p++] = d;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('aSand', new THREE.BufferAttribute(sand, 1));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, this.material);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    return mesh;
  }

  /** Synchronously ensure chunks near a point exist (used at dive start). */
  prime(x: number, z: number, r = 70): void {
    this.update(x, z, r, 999);
  }

  update(x: number, z: number, r = this.radius, budget = 2): void {
    const c0x = Math.floor((x - r) / CHUNK);
    const c1x = Math.floor((x + r) / CHUNK);
    const c0z = Math.floor((z - r) / CHUNK);
    const c1z = Math.floor((z + r) / CHUNK);
    const want: [number, string, number, number][] = [];
    for (let cz = c0z; cz <= c1z; cz++) {
      for (let cx = c0x; cx <= c1x; cx++) {
        if ((cx + 1) * CHUNK < WORLD.minX - 60 || cx * CHUNK > WORLD.maxX + 60) continue;
        if ((cz + 1) * CHUNK < WORLD.minZ - 60 || cz * CHUNK > WORLD.maxZ + 60) continue;
        const k = this.key(cx, cz);
        const dx = (cx + 0.5) * CHUNK - x;
        const dz = (cz + 0.5) * CHUNK - z;
        const d = Math.hypot(dx, dz);
        if (d > r + CHUNK * 0.7) continue;
        if (!this.chunks.has(k)) want.push([d, k, cx, cz]);
      }
    }
    want.sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < Math.min(budget, want.length); i++) {
      const [, k, cx, cz] = want[i];
      const mesh = this.build(cx, cz);
      this.chunks.set(k, mesh);
      this.group.add(mesh);
    }
    // visibility + eviction
    for (const [k, mesh] of this.chunks) {
      const s = mesh.geometry.boundingSphere!;
      const d = Math.hypot(s.center.x - x, s.center.z - z);
      mesh.visible = d < r + CHUNK;
      if (d > r * 2.2) {
        mesh.geometry.dispose();
        this.group.remove(mesh);
        this.chunks.delete(k);
      }
    }
  }
}
