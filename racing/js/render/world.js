// コース・地形・空・ライティング・背景オブジェクトの構築
import * as THREE from 'three';
import { Sky } from '../../vendor/Sky.js';
import * as T from './textures.js';
import { mergeGeos } from './carmodel.js';

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 2D ノイズ（地形用）
function hash2(x, z) {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function vnoise(x, z) {
  const x0 = Math.floor(x), z0 = Math.floor(z);
  const tx = x - x0, tz = z - z0;
  const sx = tx * tx * (3 - 2 * tx), sz = tz * tz * (3 - 2 * tz);
  const a = hash2(x0, z0), b = hash2(x0 + 1, z0), c = hash2(x0, z0 + 1), d = hash2(x0 + 1, z0 + 1);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}
function fbm2(x, z, oct = 5) {
  let v = 0, amp = 0.5, f = 1;
  for (let i = 0; i < oct; i++) {
    v += vnoise(x * f, z * f) * amp;
    f *= 2.03;
    amp *= 0.5;
  }
  return v;
}

const ENV = {
  day: { sun: 0xfff1dc, sunI: 3.2, hemiSky: 0xbcd7ff, hemiGround: 0x4a5a32, hemiI: 0.55, envI: 0.9, fogColor: 0xbcd0e2, turbidity: 2.2, rayleigh: 1.2, mie: 0.004, mieG: 0.8 },
  morning: { sun: 0xffd8a8, sunI: 2.0, hemiSky: 0xc8d4e4, hemiGround: 0x4a5040, hemiI: 0.7, envI: 0.8, fogColor: 0xc9cdd2, turbidity: 6, rayleigh: 2.0, mie: 0.01, mieG: 0.85 },
  dusk: { sun: 0xff9a52, sunI: 2.6, hemiSky: 0x9fb2d8, hemiGround: 0x6a4a30, hemiI: 0.55, envI: 0.75, fogColor: 0xe6a87a, turbidity: 8, rayleigh: 2.6, mie: 0.006, mieG: 0.9 },
  night: { sun: 0x8fa8ff, sunI: 0.35, hemiSky: 0x29324a, hemiGround: 0x15120f, hemiI: 0.5, envI: 0.25, fogColor: 0x10141d, turbidity: 1, rayleigh: 0.2, mie: 0.002, mieG: 0.7 },
  rain: { sun: 0xdfe6ee, sunI: 1.1, hemiSky: 0xa7b0ba, hemiGround: 0x2f3a2c, hemiI: 0.95, envI: 0.8, fogColor: 0x8d969e, turbidity: 18, rayleigh: 0.4, mie: 0.02, mieG: 0.6 },
};

export class World {
  constructor(renderer, track, quality) {
    this.renderer = renderer;
    this.track = track;
    this.def = track.def;
    this.quality = quality;
    this.scene = new THREE.Scene();
    this.rand = rng(track.def.id.length * 1013);
    this.night = this.def.env.time === 'night';
    this.rain = this.def.env.time === 'rain';
    this.updatables = [];
    this.buildSky();
    this.buildLights();
    this.buildRoad();
    this.buildWalls();
    this.buildTerrain();
    this.buildStartArea();
    this.buildBoards();
    this.buildScenery();
    if (this.night) this.buildStreetLights();
  }

  // ---------- 空・光 ----------
  buildSky() {
    const env = ENV[this.def.env.time];
    this.env = env;
    const sky = new Sky();
    sky.scale.setScalar(9000);
    const u = sky.material.uniforms;
    u.turbidity.value = env.turbidity;
    u.rayleigh.value = env.rayleigh;
    u.mieCoefficient.value = env.mie;
    u.mieDirectionalG.value = env.mieG;
    const phi = THREE.MathUtils.degToRad(90 - this.def.env.sunElev);
    const theta = THREE.MathUtils.degToRad(this.def.env.sunAzim);
    this.sunDir = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
    u.sunPosition.value.copy(this.sunDir);
    this.scene.add(sky);
    this.sky = sky;
    // 環境マップ（反射用）
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    const sky2 = new Sky();
    sky2.scale.setScalar(1000);
    Object.assign(sky2.material.uniforms.turbidity, { value: env.turbidity });
    sky2.material.uniforms.rayleigh.value = env.rayleigh;
    sky2.material.uniforms.mieCoefficient.value = env.mie;
    sky2.material.uniforms.mieDirectionalG.value = env.mieG;
    sky2.material.uniforms.sunPosition.value.copy(this.sunDir);
    envScene.add(sky2);
    // 地面の照り返し
    const gnd = new THREE.Mesh(new THREE.CircleGeometry(900, 16).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: this.night ? 0x050608 : 0x2c3326 }));
    gnd.position.y = -5;
    envScene.add(gnd);
    if (this.night) {
      // 夜: 街明かりの帯
      for (let i = 0; i < 24; i++) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(120, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.75, 0.45).multiplyScalar(0.8), side: THREE.DoubleSide }));
        const a = (i / 24) * Math.PI * 2;
        m.position.set(Math.cos(a) * 400, 20, Math.sin(a) * 400);
        m.lookAt(0, 20, 0);
        envScene.add(m);
      }
    }
    const rt = pmrem.fromScene(envScene, 0, 1, 2000);
    this.scene.environment = rt.texture;
    this.scene.environmentIntensity = env.envI;
    pmrem.dispose();
    // 霧
    const fogCol = new THREE.Color(env.fogColor);
    this.scene.fog = new THREE.FogExp2(fogCol, this.def.env.fog);
    if (this.night) {
      this.scene.background = null;
      // 星
      const g = new THREE.BufferGeometry();
      const p = [];
      for (let i = 0; i < 1500; i++) {
        const v = new THREE.Vector3().setFromSphericalCoords(4000, Math.acos(this.rand() * 0.9), this.rand() * Math.PI * 2);
        p.push(v.x, Math.abs(v.y) + 200, v.z);
      }
      g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
      const stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.8 }));
      this.scene.add(stars);
    }
  }

  buildLights() {
    const env = this.env;
    const sun = new THREE.DirectionalLight(env.sun, env.sunI);
    const dir = this.sunDir.clone();
    if (dir.y < 0.25) dir.y = 0.25; // 低い太陽でも影が伸びすぎないように
    if (this.night) dir.set(0.3, 1, 0.2);
    this.lightDir = dir.normalize();
    sun.castShadow = this.quality >= 1;
    const ms = this.quality >= 2 ? 2048 : 1024;
    sun.shadow.mapSize.set(ms, ms);
    const sc = sun.shadow.camera;
    sc.left = -45; sc.right = 45; sc.top = 45; sc.bottom = -45;
    sc.near = 1; sc.far = 400;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.04;
    this.scene.add(sun, sun.target);
    this.sun = sun;
    const hemi = new THREE.HemisphereLight(env.hemiSky, env.hemiGround, env.hemiI);
    this.scene.add(hemi);
  }

  followLight(x, y, z) {
    const d = this.lightDir;
    this.sun.position.set(x + d.x * 150, y + d.y * 150, z + d.z * 150);
    this.sun.target.position.set(x, y, z);
  }

  // ---------- 路面 ----------
  buildRoad() {
    const tr = this.track;
    const N = tr.N;
    const tiles = Math.max(1, Math.round(tr.length / 30));
    const vScale = tiles / tr.length;
    const across = 6;
    const pos = [], uv = [], idx = [], col = [];
    for (let i = 0; i <= N; i++) {
      const j = i % N;
      const lx = tr.tz[j], lz = -tr.tx[j];
      for (let k = 0; k <= across; k++) {
        const u = k / across;
        const d = tr.halfW * (1 - 2 * u);
        // わずかなカント（排水勾配）
        const crown = (1 - Math.abs(1 - 2 * u)) * 0.06;
        pos.push(tr.x[j] + lx * d, tr.y[j] + 0.02 + crown, tr.z[j] + lz * d);
        uv.push(u, i * tr.ds * vScale);
        col.push(1, 1, 1);
      }
    }
    for (let i = 0; i < N; i++) {
      for (let k = 0; k < across; k++) {
        const a = i * (across + 1) + k, b = a + 1, c = a + across + 1, d = c + 1;
        idx.push(a, b, c, b, d, c);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    this.roadGeo = g;
    const tx = T.roadTextures(this.rain, this.def.scenery);
    const mat = new THREE.MeshStandardMaterial({
      map: tx.map,
      normalMap: tx.normal,
      normalScale: this.rain ? new THREE.Vector2(0.25, 0.25) : new THREE.Vector2(0.6, 0.6),
      roughnessMap: tx.rough,
      roughness: 1,
      metalness: 0,
      envMapIntensity: this.rain ? 1.3 : 0.6,
    });
    const road = new THREE.Mesh(g, mat);
    road.receiveShadow = true;
    this.scene.add(road);
    this.road = road;

    // 縁石
    const ctex = T.curbTextures();
    const cmat = new THREE.MeshStandardMaterial({ map: ctex.map, normalMap: ctex.normal, roughness: this.rain ? 0.35 : 0.6 });
    const cp = [], cu = [], ci = [];
    for (const side of [1, -1]) {
      let run = null;
      for (let i = 0; i <= N; i++) {
        const j = i % N;
        const on = tr.curb[j] && i < N;
        if (on) {
          const lx = tr.tz[j], lz = -tr.tx[j];
          const base = cp.length / 3;
          const d0 = side * tr.halfW, d1 = side * (tr.halfW + 1.25);
          cp.push(tr.x[j] + lx * d0, tr.y[j] + 0.045, tr.z[j] + lz * d0);
          cp.push(tr.x[j] + lx * d1, tr.y[j] + 0.0, tr.z[j] + lz * d1);
          cu.push(0, (i * tr.ds) / 4, 1, (i * tr.ds) / 4);
          if (run !== null) {
            const a = base - 2, b = base - 1, c = base, d = base + 1;
            if (side > 0) ci.push(a, c, b, b, c, d);
            else ci.push(a, b, c, b, d, c);
          }
          run = j;
        } else run = null;
      }
    }
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.Float32BufferAttribute(cp, 3));
    cg.setAttribute('uv', new THREE.Float32BufferAttribute(cu, 2));
    cg.setIndex(ci);
    cg.computeVertexNormals();
    const curbs = new THREE.Mesh(cg, cmat);
    curbs.receiveShadow = true;
    this.scene.add(curbs);
  }

  // 路肩の外側の帯（舗装 or 砂利）
  edgeStrip(dFrom, dTo, mat, yOff = 0.01) {
    const tr = this.track;
    const N = tr.N;
    const pos = [], uv = [], idx = [];
    for (const side of [1, -1]) {
      const base0 = pos.length / 3;
      for (let i = 0; i <= N; i++) {
        const j = i % N;
        const lx = tr.tz[j], lz = -tr.tx[j];
        const wl = side > 0 ? tr.wallL[j] : tr.wallR[j];
        const a = side * Math.min(dFrom, wl), b = side * Math.min(typeof dTo === 'function' ? dTo(wl) : dTo, wl);
        pos.push(tr.x[j] + lx * a, tr.y[j] + yOff, tr.z[j] + lz * a);
        pos.push(tr.x[j] + lx * b, tr.y[j] + yOff, tr.z[j] + lz * b);
        uv.push(0, (i * tr.ds) / 8, Math.abs(b - a) / 8, (i * tr.ds) / 8);
      }
      for (let i = 0; i < N; i++) {
        const a = base0 + i * 2, b = a + 1, c = a + 2, d = a + 3;
        if (side > 0) idx.push(a, c, b, b, c, d);
        else idx.push(a, b, c, b, d, c);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true;
    this.scene.add(m);
    return m;
  }

  // ---------- 壁・ガードレール ----------
  buildWalls() {
    const tr = this.track;
    const N = tr.N;
    const city = this.def.scenery === 'city';
    if (city) {
      // 舗装されたランオフ
      const tx = T.roadTextures(this.rain, 'city');
      const m = new THREE.MeshStandardMaterial({ color: 0x8a8a8a, map: tx.map, roughnessMap: tx.rough, normalMap: tx.normal, envMapIntensity: this.rain ? 1.5 : 0.5 });
      this.edgeStrip(tr.halfW + 1.25, 99, m, 0.015);
    } else {
      // 縁石外側のエイプロン（舗装 1.5m）
      const tx = T.roadTextures(this.rain, 'apron');
      const m = new THREE.MeshStandardMaterial({ color: 0xb0aaa0, map: tx.map, roughnessMap: tx.rough, normalMap: tx.normal });
      this.edgeStrip(tr.halfW, tr.halfW + 1.25, m, 0.012);
    }
    const h = city ? 1.15 : 0.82;
    const pos = [], uv = [], idx = [];
    const posF = [], uvF = [], idxF = [];
    for (const side of [1, -1]) {
      const base0 = pos.length / 3;
      const baseF = posF.length / 3;
      let u = 0;
      let px = null, pz = null;
      for (let i = 0; i <= N; i++) {
        const j = i % N;
        const lx = tr.tz[j], lz = -tr.tx[j];
        const w = (side > 0 ? tr.wallL[j] : tr.wallR[j]) * side;
        const x = tr.x[j] + lx * w, z = tr.z[j] + lz * w, y = tr.y[j];
        if (px !== null) u += Math.hypot(x - px, z - pz);
        px = x; pz = z;
        if (city) {
          pos.push(x, y - 0.3, z, x, y + h, z);
          uv.push(u / 8, 0, u / 8, 1);
          posF.push(x, y + h, z, x, y + h + 2.6, z);
          uvF.push(u / 1.6, 0, u / 1.6, 2.6 / 1.6);
        } else {
          // ガードレール: 下段レールと上段レール
          pos.push(x, y + 0.42, z, x, y + h, z);
          uv.push(u / 4, 0, u / 4, 1);
        }
      }
      for (let i = 0; i < N; i++) {
        const a = base0 + i * 2, b = a + 1, c = a + 2, d = a + 3;
        if (side > 0) idx.push(a, b, c, b, d, c);
        else idx.push(a, c, b, b, c, d);
        if (city) {
          const a2 = baseF + i * 2, b2 = a2 + 1, c2 = a2 + 2, d2 = a2 + 3;
          idxF.push(a2, b2, c2, b2, d2, c2);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    let mat;
    if (city) {
      const t = T.concreteTexture(true);
      mat = new THREE.MeshStandardMaterial({ map: t, roughness: 0.85 });
    } else {
      mat = new THREE.MeshStandardMaterial({ color: 0xc9ced3, metalness: 0.85, roughness: 0.32, side: THREE.DoubleSide });
    }
    const wall = new THREE.Mesh(g, mat);
    wall.castShadow = false;
    wall.receiveShadow = true;
    this.scene.add(wall);
    if (city) {
      const fg = new THREE.BufferGeometry();
      fg.setAttribute('position', new THREE.Float32BufferAttribute(posF, 3));
      fg.setAttribute('uv', new THREE.Float32BufferAttribute(uvF, 2));
      fg.setIndex(idxF);
      fg.computeVertexNormals();
      const fmat = new THREE.MeshStandardMaterial({ map: T.fenceTexture(), alphaTest: 0.5, side: THREE.DoubleSide, metalness: 0.6, roughness: 0.5 });
      this.scene.add(new THREE.Mesh(fg, fmat));
    } else {
      // 支柱
      const postGeo = new THREE.BoxGeometry(0.12, 0.85, 0.12);
      postGeo.translate(0, 0.42, 0);
      const count = Math.floor((tr.N * tr.ds * 2) / 4);
      const posts = new THREE.InstancedMesh(postGeo, new THREE.MeshStandardMaterial({ color: 0x8c9196, metalness: 0.7, roughness: 0.45 }), count);
      const m = new THREE.Matrix4();
      let n = 0;
      const step = Math.max(1, Math.round(4 / tr.ds));
      for (const side of [1, -1]) {
        for (let i = 0; i < tr.N && n < count; i += step) {
          const w = (side > 0 ? tr.wallL[i] : tr.wallR[i]) * side + side * 0.1;
          m.makeRotationY(tr.hd[i]);
          m.setPosition(tr.x[i] + tr.tz[i] * w, tr.y[i], tr.z[i] - tr.tx[i] * w);
          posts.setMatrixAt(n++, m);
        }
      }
      posts.count = n;
      this.scene.add(posts);
      // タイヤバリア: きついコーナーの外側
      this.buildTireWalls();
    }
  }

  buildTireWalls() {
    const tr = this.track;
    const geo = new THREE.TorusGeometry(0.3, 0.13, 6, 12);
    geo.rotateX(Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({ color: 0x18181a, roughness: 0.9 });
    const max = 1600;
    const inst = new THREE.InstancedMesh(geo, mat, max);
    const m = new THREE.Matrix4();
    const col = new THREE.Color();
    let n = 0;
    for (const c of tr.corners) {
      if (c.vEntry - c.vApex < 15) continue;
      const side = -c.side; // 外側
      for (let o = -30; o <= 10 && n < max - 3; o++) {
        const i = (c.apex + o * 2 + tr.N) % tr.N;
        const w = (side > 0 ? tr.wallL[i] : tr.wallR[i]) * side + side * 0.55;
        for (let k = 0; k < 3; k++) {
          m.makeTranslation(tr.x[i] + tr.tz[i] * w, tr.y[i] + 0.14 + k * 0.26, tr.z[i] - tr.tx[i] * w);
          inst.setMatrixAt(n, m);
          col.set((o + k) % 4 === 0 ? 0xd0d0d0 : 0x1a1a1a);
          inst.setColorAt(n, col);
          n++;
        }
      }
    }
    inst.count = n;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    this.scene.add(inst);
  }

  // ---------- 地形 ----------
  buildTerrain() {
    const tr = this.track;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, avgY = 0;
    for (let i = 0; i < tr.N; i++) {
      minX = Math.min(minX, tr.x[i]); maxX = Math.max(maxX, tr.x[i]);
      minZ = Math.min(minZ, tr.z[i]); maxZ = Math.max(maxZ, tr.z[i]);
      avgY += tr.y[i];
    }
    avgY /= tr.N;
    const margin = 520;
    this.bounds = { minX: minX - margin, maxX: maxX + margin, minZ: minZ - margin, maxZ: maxZ + margin };
    this.center = new THREE.Vector3((minX + maxX) / 2, avgY, (minZ + maxZ) / 2);
    this.radius = Math.max(maxX - minX, maxZ - minZ) / 2 + margin;
    const W = this.bounds.maxX - this.bounds.minX, H = this.bounds.maxZ - this.bounds.minZ;
    const res = this.quality >= 2 ? 6 : 9;
    const nx = Math.ceil(W / res), nz = Math.ceil(H / res);
    const sc = this.def.scenery;
    const amp = { country: 18, mountain: 70, city: 0, desert: 14, forest: 22 }[sc];
    // 各頂点から最寄りのコース点（半径 RAD 内）をスタンプ方式で求める
    const RAD = 140;
    const nv = (nx + 1) * (nz + 1);
    const bestD = new Float32Array(nv).fill(Infinity);
    const bestI = new Int32Array(nv).fill(-1);
    const r = Math.ceil(RAD / res);
    for (let k = 0; k < tr.N; k += 1) {
      const ci = Math.round((tr.x[k] - this.bounds.minX) / res), cj = Math.round((tr.z[k] - this.bounds.minZ) / res);
      for (let j = Math.max(0, cj - r); j <= Math.min(nz, cj + r); j++) {
        const z = this.bounds.minZ + j * res;
        const dz = z - tr.z[k];
        for (let i = Math.max(0, ci - r); i <= Math.min(nx, ci + r); i++) {
          const x = this.bounds.minX + i * res;
          const dx = x - tr.x[k];
          const d2 = dx * dx + dz * dz;
          const v = j * (nx + 1) + i;
          if (d2 < bestD[v]) { bestD[v] = d2; bestI[v] = k; }
        }
      }
    }
    const pos = new Float32Array(nv * 3);
    const col = new Float32Array(nv * 3);
    const uv = new Float32Array(nv * 2);
    const hts = new Float32Array(nv);
    let p = 0;
    for (let j = 0; j <= nz; j++) {
      for (let i = 0; i <= nx; i++) {
        const x = this.bounds.minX + i * res, z = this.bounds.minZ + j * res;
        const y = this.terrainHeight(x, z, avgY, amp, bestI[p], Math.sqrt(bestD[p]));
        hts[p] = y;
        pos[p * 3] = x; pos[p * 3 + 1] = y; pos[p * 3 + 2] = z;
        uv[p * 2] = x / 9; uv[p * 2 + 1] = z / 9;
        const v = 0.78 + fbm2(x * 0.004, z * 0.004, 3) * 0.45;
        const dry = fbm2(x * 0.01 + 50, z * 0.01, 2);
        col[p * 3] = v * (1 + dry * 0.25);
        col[p * 3 + 1] = v;
        col[p * 3 + 2] = v * (1 - dry * 0.15);
        p++;
      }
    }
    // 任意地点の高さ（メッシュと一致する双線形補間）
    const b0 = this.bounds;
    this.heightAt = (x, z) => {
      const fx = Math.max(0, Math.min(nx - 1e-3, (x - b0.minX) / res)), fz = Math.max(0, Math.min(nz - 1e-3, (z - b0.minZ) / res));
      const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
      const a = hts[j * (nx + 1) + i], b = hts[j * (nx + 1) + i + 1], c = hts[(j + 1) * (nx + 1) + i], d = hts[(j + 1) * (nx + 1) + i + 1];
      return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
    };
    const idx = [];
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const kind = { country: 'grass', mountain: 'mountain', city: 'city', desert: 'sand', forest: 'forest' }[sc];
    const gt = T.groundTextures(kind);
    const mat = new THREE.MeshStandardMaterial({ map: gt.map, normalMap: gt.normal, vertexColors: true, roughness: kind === 'city' ? 0.8 : 0.95, envMapIntensity: this.rain ? 0.9 : 0.4 });
    const terrain = new THREE.Mesh(g, mat);
    terrain.receiveShadow = true;
    this.scene.add(terrain);

    // 遠景の山並み
    if (sc !== 'city') {
      const ring = new THREE.CylinderGeometry(1, 1, 1, 160, 6, true);
      const rp = ring.attributes.position;
      const R = this.radius + 900;
      for (let k = 0; k < rp.count; k++) {
        const x = rp.getX(k), y = rp.getY(k), z = rp.getZ(k);
        const a = Math.atan2(z, x);
        const t = y + 0.5;
        const hh = sc === 'desert' ? 90 + fbm2(Math.cos(a) * 3 + 9, Math.sin(a) * 3, 4) * 260 : 120 + fbm2(Math.cos(a) * 2.5, Math.sin(a) * 2.5, 5) * (sc === 'mountain' ? 700 : 380);
        const r = R * (1 + (1 - t) * 0.08);
        rp.setXYZ(k, Math.cos(a) * r, avgY - 30 + t * hh, Math.sin(a) * r);
      }
      ring.computeVertexNormals();
      const mcol = { country: 0x56704a, mountain: 0x4a5a48, desert: 0xa5643e, forest: 0x2e4430 }[sc];
      const mm = new THREE.MeshStandardMaterial({ color: mcol, roughness: 1, side: THREE.BackSide });
      const mtn = new THREE.Mesh(ring, mm);
      mtn.position.set(this.center.x, 0, this.center.z);
      this.scene.add(mtn);
    }
  }

  terrainHeight(x, z, avgY, amp, i, dist) {
    const tr = this.track;
    const noise = avgY - 2 + (fbm2(x * 0.0025, z * 0.0025, 5) - 0.45) * amp * 2;
    if (i < 0) return noise;
    const nr = { dist };
    const lx = tr.tz[i], lz = -tr.tx[i];
    const d = (x - tr.x[i]) * lx + (z - tr.z[i]) * lz;
    const wall = d > 0 ? tr.wallL[i] : tr.wallR[i];
    const flat = tr.y[i] - 0.04;
    const t = Math.min(1, Math.max(0, (nr.dist - wall - 4) / 110));
    const s = t * t * (3 - 2 * t);
    return flat + (noise - flat) * s;
  }

  // ---------- スタート周辺 ----------
  buildStartArea() {
    const tr = this.track;
    const hw = tr.halfW;
    // スタートライン（チェッカー）
    const p0 = tr.pointAt(0, 0, {});
    const line = new THREE.Mesh(new THREE.PlaneGeometry(hw * 2, 1.4), new THREE.MeshStandardMaterial({ map: T.checkerTexture(), roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 }));
    line.rotation.x = -Math.PI / 2;
    const lineGroup = new THREE.Group();
    lineGroup.add(line);
    lineGroup.position.set(p0.x, p0.y + 0.09, p0.z);
    lineGroup.rotation.y = p0.hd;
    this.scene.add(lineGroup);
    // グリッド枠
    const gm = new THREE.MeshBasicMaterial({ color: 0xe8e8e8, polygonOffset: true, polygonOffsetFactor: -2 });
    for (let g = 0; g < 8; g++) {
      const s = tr.length - 12 - g * 8 + 2.6;
      const d = g % 2 === 0 ? 3 : -3;
      const p = tr.pointAt(s, d, {});
      const grp = new THREE.Group();
      const bar = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.18).rotateX(-Math.PI / 2), gm);
      grp.add(bar);
      for (const sx of [1.15, -1.15]) {
        const side = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 1.2).rotateX(-Math.PI / 2), gm);
        side.position.set(sx, 0, -0.6);
        grp.add(side);
      }
      grp.position.set(p.x, p.y + 0.09, p.z);
      grp.rotation.y = p.hd;
      this.scene.add(grp);
    }
    // ガントリー（スタートシグナル）
    const gp = tr.pointAt(4, 0, {});
    const gantry = new THREE.Group();
    const metal = new THREE.MeshStandardMaterial({ color: 0x30343a, metalness: 0.7, roughness: 0.4 });
    const span = Math.min(tr.wallL[0], tr.wallR[0]) + 0.6;
    for (const sx of [span, -span]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 7.2, 0.5), metal);
      post.position.set(sx, 3.6, 0);
      post.castShadow = true;
      gantry.add(post);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(span * 2 + 0.5, 1.1, 0.7), metal);
    beam.position.y = 6.8;
    beam.castShadow = true;
    gantry.add(beam);
    const ban = new THREE.Mesh(new THREE.PlaneGeometry(span * 2 - 2, 1.0), new THREE.MeshStandardMaterial({ map: T.bannerTexture2(), roughness: 0.5 }));
    ban.position.set(0, 6.8, -0.36);
    ban.rotation.y = Math.PI;
    gantry.add(ban);
    this.startLights = [];
    for (let k = 0; k < 5; k++) {
      const pod = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.9, 0.4), new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.6 }));
      pod.position.set((k - 2) * 0.95, 5.75, -0.2);
      gantry.add(pod);
      const lamps = [];
      for (const ly of [0.2, -0.2]) {
        const lm = new THREE.Mesh(new THREE.CircleGeometry(0.15, 16), new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff0000, emissiveIntensity: 0 }));
        lm.position.set((k - 2) * 0.95, 5.75 + ly, -0.41);
        lm.rotation.y = Math.PI;
        gantry.add(lm);
        lamps.push(lm);
      }
      this.startLights.push(lamps);
    }
    gantry.position.set(gp.x, gp.y, gp.z);
    gantry.rotation.y = gp.hd;
    this.scene.add(gantry);

    // ピットビル・グランドスタンド（ループの外側に配置）
    const sMid = 60;
    const pm = tr.pointAt(sMid, 0, {});
    let outside = 1;
    for (const side of [1, -1]) {
      const q = tr.pointAt(sMid, side * 70, {});
      const nr = tr.nearest(q.x, q.z, 55);
      if (!nr) { outside = side; break; }
    }
    this.pitSide = outside;
    const wallO = (outside > 0 ? tr.wallL : tr.wallR);
    const building = new THREE.Group();
    const wt = T.windowTexture(this.night);
    const pitMat = new THREE.MeshStandardMaterial({ color: 0xdedede, roughness: 0.7 });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x223040, metalness: 0.3, roughness: 0.1, emissive: this.night ? 0xffe0b0 : 0x000000, emissiveIntensity: this.night ? 0.5 : 0 });
    // 各区画をコースに沿わせて配置
    for (let k = -6; k < 10; k++) {
      const s = sMid + k * 14;
      const p = tr.pointAt(s, 0, {});
      const i = p.i;
      const w = (outside > 0 ? tr.wallL[i] : tr.wallR[i]) + 14;
      const q = tr.pointAt(s, outside * w, {});
      const blk = new THREE.Group();
      const base = new THREE.Mesh(new THREE.BoxGeometry(14, 6, 16), pitMat);
      base.position.y = 3;
      base.castShadow = true;
      base.receiveShadow = true;
      blk.add(base);
      const gl = new THREE.Mesh(new THREE.BoxGeometry(13, 1.6, 0.08), glassMat);
      gl.position.set(0, 4.6, 8.03);
      blk.add(gl);
      // ピットガレージのシャッター
      const sh = new THREE.Mesh(new THREE.PlaneGeometry(10, 3.6), new THREE.MeshStandardMaterial({ color: 0x2b2f36, metalness: 0.5, roughness: 0.4 }));
      sh.position.set(0, 1.8, 8.02);
      blk.add(sh);
      // 2階: グランドスタンド
      const st = new THREE.Mesh(new THREE.BoxGeometry(14, 0.6, 14), pitMat);
      st.position.set(0, 6.3, 0);
      blk.add(st);
      const seats = new THREE.Mesh(new THREE.PlaneGeometry(14, 9), new THREE.MeshStandardMaterial({ map: T.crowdTexture(), roughness: 0.9 }));
      seats.rotation.x = -0.65;
      seats.position.set(0, 9.6, -1.5);
      blk.add(seats);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(14.5, 0.3, 12), new THREE.MeshStandardMaterial({ color: 0xf2f2f2, metalness: 0.4, roughness: 0.5 }));
      roof.position.set(0, 15.2, -0.5);
      roof.rotation.x = 0.08;
      roof.castShadow = true;
      blk.add(roof);
      for (const sx of [-6.8, 6.8]) {
        const col = new THREE.Mesh(new THREE.BoxGeometry(0.3, 9, 0.3), metal);
        col.position.set(sx, 10.8, -6);
        blk.add(col);
      }
      blk.position.set(q.x, q.y, q.z);
      // 正面（+z）がコースを向く
      blk.rotation.y = p.hd + (outside > 0 ? -Math.PI / 2 : Math.PI / 2);
      building.add(blk);
    }
    this.scene.add(building);
    void wallO; void wt; void pm;
  }

  // ---------- ブレーキング看板 ----------
  buildBoards() {
    const tr = this.track;
    const postMat = new THREE.MeshStandardMaterial({ color: 0x777777, metalness: 0.6, roughness: 0.5 });
    for (const c of tr.corners) {
      if (c.vEntry - c.vApex < 14) continue;
      // ターンイン地点: 頂点から手前で速度が頂点+20% になる位置
      let ti = c.apex;
      for (let o = 0; o < 200; o++) {
        const k = (c.apex - o + tr.N) % tr.N;
        if (tr.profile[k] > c.vApex * 1.18) { ti = k; break; }
      }
      const side = -c.side;
      for (const dist of [150, 100, 50]) {
        const s = ti * tr.ds - dist;
        const p = tr.pointAt(s, 0, {});
        const w = (side > 0 ? tr.wallL[p.i] : tr.wallR[p.i]) + 1.2;
        const q = tr.pointAt(s, side * w, {});
        const g = new THREE.Group();
        const board = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.3), new THREE.MeshStandardMaterial({ map: T.boardTexture(String(dist)), roughness: 0.6 }));
        board.position.y = 1.9;
        board.rotation.y = Math.PI;
        g.add(board);
        const back = new THREE.Mesh(new THREE.BoxGeometry(1.34, 1.34, 0.05), postMat);
        back.position.set(0, 1.9, 0.03);
        g.add(back);
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.3, 0.1), postMat);
        post.position.y = 0.65;
        g.add(post);
        g.position.set(q.x, q.y, q.z);
        g.rotation.y = p.hd;
        this.scene.add(g);
      }
    }
  }

  // ---------- 背景オブジェクト ----------
  scatter(count, minDist, maxDist, fn) {
    const tr = this.track;
    const b = this.bounds;
    let placed = 0, tries = 0;
    while (placed < count && tries < count * 30) {
      tries++;
      const x = b.minX + this.rand() * (b.maxX - b.minX);
      const z = b.minZ + this.rand() * (b.maxZ - b.minZ);
      const nr = tr.nearest(x, z, Math.min(maxDist, 110));
      const dist = nr ? nr.dist : Infinity;
      if (dist === Infinity && maxDist < 110) continue;
      if (nr) {
        const i = nr.i;
        const lx = tr.tz[i], lz = -tr.tx[i];
        const d = (x - tr.x[i]) * lx + (z - tr.z[i]) * lz;
        const wall = d > 0 ? tr.wallL[i] : tr.wallR[i];
        if (dist < wall + minDist) continue;
        // スタート付近の建物と重ならないように
        if ((i * tr.ds < 210 || i * tr.ds > tr.length - 120) && Math.sign(d) === this.pitSide && dist < wall + 50) continue;
      }
      fn(x, this.heightAt(x, z), z, nr);
      placed++;
    }
  }

  buildScenery() {
    const sc = this.def.scenery;
    const q = this.quality;
    const m4 = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    const pv = new THREE.Vector3();
    const col = new THREE.Color();
    if (sc === 'country' || sc === 'forest' || sc === 'mountain') {
      const pine = sc !== 'country';
      const count = { country: 700, forest: 2600, mountain: 1800 }[sc] * (q >= 2 ? 1 : 0.55);
      // 木: 幹 + 葉（円錐 or 球の集合）
      const trunkGeo = new THREE.CylinderGeometry(0.18, 0.3, 4, 6);
      trunkGeo.translate(0, 2, 0);
      let leafGeo;
      if (pine) {
        const parts = [];
        for (let k = 0; k < 3; k++) {
          const c = new THREE.ConeGeometry(2.6 - k * 0.6, 4.2 - k * 0.6, 8);
          c.translate(0, 3.6 + k * 2.4, 0);
          parts.push(c);
        }
        leafGeo = mergeGeos(parts);
      } else {
        const parts = [];
        for (let k = 0; k < 4; k++) {
          const c = new THREE.IcosahedronGeometry(1.9 - k * 0.2, 1);
          c.translate(Math.cos(k * 2.1) * 1.0, 5 + k * 0.7, Math.sin(k * 2.1) * 1.0);
          parts.push(c);
        }
        leafGeo = mergeGeos(parts);
      }
      // 頂点を少し揺らして自然に
      const lp = leafGeo.attributes.position;
      for (let k = 0; k < lp.count; k++) {
        lp.setXYZ(k, lp.getX(k) * (0.9 + hash2(k, 1) * 0.25), lp.getY(k) + (hash2(k, 2) - 0.5) * 0.4, lp.getZ(k) * (0.9 + hash2(k, 3) * 0.25));
      }
      leafGeo.computeVertexNormals();
      const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3626, roughness: 0.95 });
      const leafMat = new THREE.MeshStandardMaterial({ map: T.foliageTexture(pine ? 'pine' : 'leaf'), roughness: 0.9, flatShading: false });
      const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, count);
      const leaves = new THREE.InstancedMesh(leafGeo, leafMat, count);
      let n = 0;
      this.scatter(count, 6, 1e9, (x, y, z) => {
        const s = 0.8 + this.rand() * 0.9;
        quat.setFromAxisAngle(pv.set(0, 1, 0), this.rand() * 6.28);
        scl.set(s, s * (0.85 + this.rand() * 0.4), s);
        m4.compose(pv.set(x, y - 0.2, z), quat, scl);
        trunks.setMatrixAt(n, m4);
        leaves.setMatrixAt(n, m4);
        const v = 0.75 + this.rand() * 0.5;
        col.setRGB(v * (0.9 + this.rand() * 0.2), v, v * (0.85 + this.rand() * 0.2));
        if (sc === 'country' && this.rand() < 0.15) col.setRGB(1.2, 1.0, 0.6);
        leaves.setColorAt(n, col);
        n++;
      });
      trunks.count = leaves.count = n;
      leaves.castShadow = q >= 2;
      leaves.receiveShadow = true;
      this.scene.add(trunks, leaves);
      // 岩
      this.buildRocks(sc === 'mountain' ? 260 : 80, 0x8a8a84);
    }
    if (sc === 'desert') {
      this.buildRocks(420, 0xb07850, true);
      // サボテン
      const parts = [];
      const c1 = new THREE.CylinderGeometry(0.35, 0.4, 5, 8);
      c1.translate(0, 2.5, 0);
      parts.push(c1);
      const c2 = new THREE.CylinderGeometry(0.25, 0.25, 1.8, 8);
      c2.translate(0.9, 3.2, 0);
      parts.push(c2);
      const c3 = new THREE.CylinderGeometry(0.25, 0.25, 0.9, 8);
      c3.rotateZ(Math.PI / 2);
      c3.translate(0.45, 2.4, 0);
      parts.push(c3);
      const cg = mergeGeos(parts);
      const cmat = new THREE.MeshStandardMaterial({ color: 0x4e6b34, roughness: 0.8 });
      const cnt = 220;
      const cac = new THREE.InstancedMesh(cg, cmat, cnt);
      let n = 0;
      this.scatter(cnt, 8, 1e9, (x, y, z) => {
        const s = 0.6 + this.rand() * 0.8;
        quat.setFromAxisAngle(pv.set(0, 1, 0), this.rand() * 6.28);
        m4.compose(pv.set(x, y, z), quat, scl.set(s, s, s));
        cac.setMatrixAt(n++, m4);
      });
      cac.count = n;
      cac.castShadow = true;
      this.scene.add(cac);
    }
    if (sc === 'city') this.buildCity();
    // 広告看板（コース沿い）
    this.buildBillboards();
  }

  buildRocks(count, color, big = false) {
    const geo = new THREE.IcosahedronGeometry(1, 2);
    const p = geo.attributes.position;
    for (let k = 0; k < p.count; k++) {
      const x = p.getX(k), y = p.getY(k), z = p.getZ(k);
      const n = 0.7 + vnoise(x * 2 + 5, z * 2 + y * 3) * 0.6;
      p.setXYZ(k, x * n, y * n * 0.7, z * n);
    }
    geo.computeVertexNormals();
    const rt = T.rockTexture();
    const mat = new THREE.MeshStandardMaterial({ color, map: rt.map, normalMap: rt.normal, roughness: 0.95 });
    const inst = new THREE.InstancedMesh(geo, mat, count);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), v = new THREE.Vector3(), e = new THREE.Euler();
    let n = 0;
    this.scatter(count, 5, 1e9, (x, y, z) => {
      const sz = big && this.rand() < 0.2 ? 6 + this.rand() * 14 : 0.6 + this.rand() * 2.5;
      q.setFromEuler(e.set(this.rand(), this.rand() * 6, this.rand()));
      m4.compose(v.set(x, y + sz * 0.1, z), q, s.set(sz, sz * (0.6 + this.rand() * 0.6), sz));
      inst.setMatrixAt(n++, m4);
    });
    inst.count = n;
    inst.castShadow = true;
    inst.receiveShadow = true;
    this.scene.add(inst);
  }

  buildCity() {
    const tr = this.track;
    const wt = T.windowTexture(this.night);
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0);
    // UV を高さに応じてリピートさせるため、マテリアルの repeat はインスタンス共通 → 縦横比が近いビルを多めに
    const mat = new THREE.MeshStandardMaterial({ map: wt.map, emissiveMap: wt.emissive, emissive: this.night ? 0xffffff : 0x000000, emissiveIntensity: this.night ? 1.2 : 0, roughness: 0.55, metalness: 0.3 });
    mat.map.repeat.set(2, 3);
    wt.emissive.repeat.set(2, 3);
    const count = this.quality >= 2 ? 520 : 300;
    const inst = new THREE.InstancedMesh(geo, mat, count);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), v = new THREE.Vector3();
    const col = new THREE.Color();
    let n = 0;
    this.scatter(count, 9, 1e9, (x, y, z, nr) => {
      const near = nr && nr.dist < 60;
      const h = near ? 10 + this.rand() * 30 : 20 + this.rand() * 110;
      const w = 14 + this.rand() * 22, d = 14 + this.rand() * 22;
      const ang = nr ? tr.hd[nr.i] : this.rand() * 6;
      q.setFromAxisAngle(v.set(0, 1, 0), ang);
      m4.compose(v.set(x, y, z), q, s.set(w, h, d));
      inst.setMatrixAt(n, m4);
      const t = 0.55 + this.rand() * 0.6;
      col.setRGB(t, t * (0.95 + this.rand() * 0.1), t * (0.95 + this.rand() * 0.15));
      inst.setColorAt(n, col);
      n++;
    });
    inst.count = n;
    inst.castShadow = true;
    inst.receiveShadow = true;
    this.scene.add(inst);
    // 遠景のスカイライン
    const sky = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0x1b2230, emissiveMap: wt.emissive, emissive: this.night ? 0xffffff : 0, emissiveIntensity: this.night ? 0.8 : 0, roughness: 0.8 }), 160);
    for (let k = 0; k < 160; k++) {
      const a = (k / 160) * Math.PI * 2 + this.rand() * 0.03;
      const r = this.radius + 300 + this.rand() * 500;
      const h = 60 + this.rand() * 260;
      q.setFromAxisAngle(v.set(0, 1, 0), -a);
      m4.compose(v.set(this.center.x + Math.cos(a) * r, -2, this.center.z + Math.sin(a) * r), q, s.set(40 + this.rand() * 40, h, 40 + this.rand() * 40));
      sky.setMatrixAt(k, m4);
    }
    this.scene.add(sky);
    // 海（港）
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x0a1622, metalness: 0.1, roughness: 0.15, envMapIntensity: 1.5 }));
    sea.position.set(this.center.x, -1.5, this.center.z);
    this.scene.add(sea);
  }

  buildBillboards() {
    const tr = this.track;
    const mat = new THREE.MeshStandardMaterial({ map: T.bannerTexture(), roughness: 0.55 });
    const frame = new THREE.MeshStandardMaterial({ color: 0x3a3d42, metalness: 0.6, roughness: 0.5 });
    const city = this.def.scenery === 'city';
    const every = city ? 70 : 110;
    for (let s = 150; s < tr.length - 60; s += every + this.rand() * 60) {
      const p = tr.pointAt(s, 0, {});
      const i = p.i;
      const side = this.rand() < 0.5 ? 1 : -1;
      const w = (side > 0 ? tr.wallL[i] : tr.wallR[i]) + (city ? 0.25 : 2.5);
      const q = tr.pointAt(s, side * w, {});
      const g = new THREE.Group();
      const len = 16;
      const b = new THREE.Mesh(new THREE.PlaneGeometry(len, 1.6), mat);
      b.position.y = city ? 1.95 : 1.4;
      if (city) b.position.y = 0.6;
      b.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
      b.position.x = -side * 0.08;
      g.add(b);
      if (!city) {
        const back = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1.7, len + 0.2), frame);
        back.position.y = 1.4;
        g.add(back);
        for (const zz of [-len / 2, 0, len / 2]) {
          const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.6, 0.12), frame);
          leg.position.set(0, 0.3, zz);
          g.add(leg);
        }
      }
      g.position.set(q.x, q.y, q.z);
      g.rotation.y = p.hd;
      this.scene.add(g);
    }
  }

  // ---------- 夜間照明 ----------
  buildStreetLights() {
    const tr = this.track;
    const poleGeo = new THREE.CylinderGeometry(0.1, 0.16, 9, 8);
    poleGeo.translate(0, 4.5, 0);
    const armGeo = new THREE.BoxGeometry(0.12, 0.12, 2.6);
    armGeo.translate(0, 9, 1.2);
    const headGeo = new THREE.BoxGeometry(0.5, 0.18, 0.9);
    headGeo.translate(0, 8.9, 2.3);
    const poleG = mergeGeos([poleGeo, armGeo]);
    const spacing = 34;
    const n = Math.floor(tr.length / spacing);
    const poles = new THREE.InstancedMesh(poleG, new THREE.MeshStandardMaterial({ color: 0x3a3e44, metalness: 0.7, roughness: 0.4 }), n);
    const heads = new THREE.InstancedMesh(headGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffd9a0, emissiveIntensity: 3 }), n);
    const m4 = new THREE.Matrix4();
    const lamps = [];
    const glowMat = new THREE.SpriteMaterial({ map: T.radialTexture('rgba(255,220,160,0.9)', 'rgba(255,200,120,0)'), blending: THREE.AdditiveBlending, depthWrite: false, fog: true });
    for (let k = 0; k < n; k++) {
      const s = k * spacing + 10;
      const p = tr.pointAt(s, 0, {});
      const side = k % 2 ? 1 : -1;
      const w = (side > 0 ? tr.wallL[p.i] : tr.wallR[p.i]) + 0.6;
      const q = tr.pointAt(s, side * w, {});
      m4.makeRotationY(p.hd + (side > 0 ? -Math.PI / 2 : Math.PI / 2));
      m4.setPosition(q.x, q.y, q.z);
      poles.setMatrixAt(k, m4);
      heads.setMatrixAt(k, m4);
      const lp = tr.pointAt(s, side * (w - 2.3), {});
      lamps.push([lp.x, lp.y + 8.8, lp.z]);
      const spr = new THREE.Sprite(glowMat);
      spr.position.set(lp.x, lp.y + 8.7, lp.z);
      spr.scale.set(5, 5, 5);
      this.scene.add(spr);
    }
    this.scene.add(poles, heads);
    // 路面の光だまり（頂点カラー × 路面テクスチャを加算合成）
    const g = this.roadGeo.clone();
    const pos = g.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    for (let k = 0; k < pos.count; k++) {
      const x = pos.getX(k), y = pos.getY(k), z = pos.getZ(k);
      let L = 0;
      for (const l of lamps) {
        const d2 = (x - l[0]) ** 2 + (z - l[2]) ** 2;
        if (d2 > 900) continue;
        L += 1 / (1 + d2 / 60);
      }
      L = Math.min(1.3, L) * 0.55;
      colors[k * 3] = L;
      colors[k * 3 + 1] = L * 0.85;
      colors[k * 3 + 2] = L * 0.62;
      void y;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const tx = T.roadTextures(this.rain, this.def.scenery);
    const pool = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: tx.map, vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }));
    pool.renderOrder = 2;
    this.scene.add(pool);
  }

  setStartLights(n, on) {
    if (!this.startLights) return;
    this.startLights.forEach((lamps, k) => {
      for (const l of lamps) l.material.emissiveIntensity = on && k < n ? 4 : 0;
    });
  }
}
