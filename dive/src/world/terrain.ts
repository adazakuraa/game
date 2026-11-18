import * as THREE from 'three';
import { bottomMaterial, heightAt, WORLD } from './layout';
import { PBR_FUNCS, underwaterMaterial } from '../render/underwater';
import { baked, pbr } from '../render/baked';

const CHUNK = 40;

/** Streams heightfield chunks around the camera. Normals come from the analytic height so seams match. */
export class Terrain {
  readonly group = new THREE.Group();
  private chunks = new Map<string, THREE.Mesh>();
  private materials: THREE.MeshStandardMaterial[] = [];
  private queue: string[] = [];
  readonly radius = 95;

  /** HARD: 0 = reef framework only, 1 = rock only, 2 = both (transition chunks). */
  private makeMaterial(hard: number): THREE.MeshStandardMaterial {
    const P = pbr();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, envMapIntensity: 0.25 });
    mat.defines = { HARD: String(hard) };
    return underwaterMaterial(mat, {
      key: 'terrain-pbr',
      uniforms: {
        tSandA: { value: P.sand.a }, tSandN: { value: P.sand.n },
        tRubA: { value: P.rubble.a }, tRubN: { value: P.rubble.n },
        tReefA: { value: P.reef.a }, tReefN: { value: P.reef.n },
        tRockA: { value: P.rock.a }, tRockN: { value: P.rock.n },
        tGrain: { value: baked().sand },
      },
      vertexHead: 'attribute float aSand;\nattribute vec3 aMat;\nvarying float vSand;\nvarying vec3 vMat;',
      vertexBody: 'vSand = aSand; vMat = aMat;',
      fragHead: `varying float vSand; varying vec3 vMat;
        uniform sampler2D tSandA, tSandN, tRubA, tRubN, tReefA, tReefN, tRockA, tRockN, tGrain;`,
      fragFuncs: PBR_FUNCS,
      fragDiffuse: `
  vec3 tN0 = normalize( vUwNrm );
  vec3 tW = pbrW( tN0 );
  vec3 P = vUwPos;
  // --- sand: two rotated scales blended by noise kill visible tiling, plus fine baked grain
  vec2 uvS = P.xz * 0.21;
  vec2 uvS2 = vec2( P.x * 0.6 - P.z * 0.8, P.x * 0.8 + P.z * 0.6 ) * 0.083 + 0.37;
  float mS = smoothstep( 0.3, 0.7, uwNoise( P * 0.05 ) );
  vec3 aS = mix( texture2D( tSandA, uvS ).rgb, texture2D( tSandA, uvS2 ).rgb, mS );
  vec3 nS = normalize( mix( pbrTopN( tSandN, uvS, tN0, 1.2 ), pbrTopN( tSandN, uvS2, tN0, 1.2 ), mS ) );
  vec4 gr = texture2D( tGrain, P.xz * 1.6 );
  aS *= 0.82 + gr.a * 0.3;
  nS = normalize( nS + vec3( gr.x - 0.5, 0.0, gr.y - 0.5 ) * 0.35 );
  // --- coral rubble
  vec2 uvR = P.xz * 0.32;
  vec3 aR = texture2D( tRubA, uvR ).rgb;
  vec3 nR = pbrTopN( tRubN, uvR, tN0, 1.4 );
  // --- hard substrate (triplanar)
  vec3 aH = vec3( 0.5 ); vec3 nH = tN0;
  float rockMix = clamp( vMat.y / max( 0.001, vMat.x + vMat.y ), 0.0, 1.0 );
  #if HARD == 0 || HARD == 2
    vec3 aF = pbrTriA( tReefA, P, tW, 0.26 );
    vec3 nF = pbrTriN( tReefN, P, tN0, tW, 0.26, 1.5 );
  #endif
  #if HARD == 1 || HARD == 2
    vec3 aK = mix( pbrTriA( tRockA, P, tW, 0.2 ), pbrTriA( tRockA, P.zxy + 3.1, tW.zxy, 0.071 ), smoothstep( 0.3, 0.7, uwNoise( P * 0.11 ) ) );
    vec3 nK = pbrTriN( tRockN, P, tN0, tW, 0.2, 1.6 );
  #endif
  #if HARD == 0
    aH = aF; nH = nF;
  #elif HARD == 1
    aH = aK; nH = nK;
  #else
    aH = mix( aF, aK, rockMix ); nH = normalize( mix( nF, nK, rockMix ) );
  #endif
  // --- height-aware blending: the coarser material shows through in its high spots
  float hJit = ( uwNoise( P * 0.9 ) - 0.5 ) * 0.5;
  float wHard = clamp( ( vMat.x + vMat.y ) + hJit * 0.6 + ( dot( aH, vec3( 0.33 ) ) - 0.5 ) * 0.6, 0.0, 1.0 );
  wHard = smoothstep( 0.35, 0.65, wHard );
  float wRub = clamp( vMat.z + hJit * 0.5 + ( dot( aR, vec3( 0.33 ) ) - 0.5 ) * 0.5, 0.0, 1.0 );
  wRub = smoothstep( 0.35, 0.65, wRub ) * ( 1.0 - wHard );
  float wSa = max( 0.0, 1.0 - wHard - wRub );
  vec3 tAlb = aS * wSa + aR * wRub + aH * wHard;
  vec3 terrN = normalize( nS * wSa + nR * wRub + nH * wHard );
  diffuseColor.rgb *= tAlb * 2.0;
  // large-scale tonal variation
  float big = uwNoise( P * 0.045 ) * 0.6 + uwNoise( P * 0.17 ) * 0.4;
  diffuseColor.rgb *= 0.84 + big * 0.3;`,
      fragBeforeLights: `
  normal = normalize( mat3( viewMatrix ) * terrN );
  {
    // broad current ripples on open sand (geometry-scale, derivative bump)
    vec2 p = vUwPos.xz;
    float warp = sin( p.y * 0.21 + sin( p.x * 0.13 ) * 1.7 ) * 1.6;
    float rip = sin( p.x * 2.4 + warp + sin( p.y * 0.9 ) * 0.6 );
    rip = rip * 0.5 + 0.5; rip = pow( rip, 1.6 );
    normal = uwBump( normal, rip * wSa * vSand * 0.035 );
  }`,
    });
  }

  constructor() {
    for (let i = 0; i < 3; i++) this.materials.push(this.makeMaterial(i));
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
    const matw = new Float32Array(n * n * 3);
    const m = [0, 0, 0, 0, 0, 0];
    let maxReef = 0, maxRock = 0;
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
        const steep = Math.min(1, slope * 3);
        let wReef = m[4], wRock = Math.max(m[5], steep * (1 - m[4]));
        const hard = Math.min(1, wReef + wRock);
        if (wReef + wRock > 1) { wReef /= wReef + wRock; wRock = 1 - wReef; }
        matw[k * 3] = wReef;
        matw[k * 3 + 1] = wRock;
        matw[k * 3 + 2] = Math.max(0, 1 - m[3] - hard) * (z > 100 && z < 470 ? 1 : 0.3);
        maxReef = Math.max(maxReef, wReef);
        maxRock = Math.max(maxRock, wRock);
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
    g.setAttribute('aMat', new THREE.BufferAttribute(matw, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    const hard = maxRock < 0.02 ? 0 : maxReef < 0.02 ? 1 : 2;
    const mesh = new THREE.Mesh(g, this.materials[hard]);
    mesh.matrixAutoUpdate = false;
    mesh.receiveShadow = true;
    mesh.castShadow = true;
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
