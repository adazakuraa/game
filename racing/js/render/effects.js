// スキッドマーク・タイヤスモーク・砂ぼこり・水しぶき・雨・火花
import * as THREE from 'three';
import { smokeTexture, skidTexture } from './textures.js';

export class Effects {
  constructor(scene, track, opts) {
    this.scene = scene;
    this.track = track;
    this.rain = opts.rain;
    this.snow = !!opts.snow;
    this.quality = opts.quality;
    this._tc = new THREE.Color();
    this.buildSkids();
    this.buildParticles();
    if (this.rain || this.snow) this.buildRain();
  }

  // ---- スキッドマーク（リングバッファ） ----
  buildSkids() {
    const MAX = this.quality >= 2 ? 3000 : 1500;
    this.skidMax = MAX;
    const g = new THREE.BufferGeometry();
    this.skidPos = new Float32Array(MAX * 4 * 3);
    this.skidAlpha = new Float32Array(MAX * 4);
    const uv = new Float32Array(MAX * 4 * 2);
    const idx = new Uint32Array(MAX * 6);
    for (let i = 0; i < MAX; i++) {
      uv.set([0, 0, 1, 0, 0, 1, 1, 1], i * 8);
      idx.set([i * 4, i * 4 + 2, i * 4 + 1, i * 4 + 1, i * 4 + 2, i * 4 + 3], i * 6);
    }
    g.setAttribute('position', new THREE.BufferAttribute(this.skidPos, 3));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.skidAlpha, 1));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: skidTexture() }, color: { value: new THREE.Color(this.rain ? 0x0d0d0d : 0x111111) } },
      vertexShader: `attribute float alpha; varying float vA; varying vec2 vUv;
        void main(){ vA = alpha; vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform sampler2D map; uniform vec3 color; varying float vA; varying vec2 vUv;
        void main(){ float a = texture2D(map, vUv).a * vA; if (a < 0.01) discard; gl_FragColor = vec4(color, a * 0.75); }`,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
    });
    this.skidMesh = new THREE.Mesh(g, mat);
    this.skidMesh.frustumCulled = false;
    this.skidMesh.renderOrder = 3;
    this.scene.add(this.skidMesh);
    this.skidIdx = 0;
    this.lastSkid = new Map();
  }

  // key: 車+タイヤ, p: 位置, side: 横ベクトル, a: 濃さ
  addSkid(key, x, y, z, sx, sz, a) {
    const last = this.lastSkid.get(key);
    const w = 0.13;
    if (!last || a <= 0.02) {
      this.lastSkid.set(key, a > 0.02 ? { x, y, z, sx, sz, a } : null);
      return;
    }
    const d = Math.hypot(x - last.x, z - last.z);
    if (d < 0.35) return;
    if (d > 3) { this.lastSkid.set(key, { x, y, z, sx, sz, a }); return; }
    const i = this.skidIdx;
    const P = this.skidPos, A = this.skidAlpha;
    const o = i * 12;
    P[o] = last.x - last.sx * w; P[o + 1] = last.y + 0.03; P[o + 2] = last.z - last.sz * w;
    P[o + 3] = last.x + last.sx * w; P[o + 4] = last.y + 0.03; P[o + 5] = last.z + last.sz * w;
    P[o + 6] = x - sx * w; P[o + 7] = y + 0.03; P[o + 8] = z - sz * w;
    P[o + 9] = x + sx * w; P[o + 10] = y + 0.03; P[o + 11] = z + sz * w;
    A[i * 4] = A[i * 4 + 1] = last.a;
    A[i * 4 + 2] = A[i * 4 + 3] = a;
    this.skidIdx = (i + 1) % this.skidMax;
    this.skidDirty = true;
    this.lastSkid.set(key, { x, y, z, sx, sz, a });
  }

  // ---- パーティクル（煙・砂・しぶき・火花） ----
  buildParticles() {
    const MAX = this.quality >= 2 ? 500 : 250;
    this.pMax = MAX;
    const g = new THREE.BufferGeometry();
    this.pPos = new Float32Array(MAX * 3);
    this.pCol = new Float32Array(MAX * 4);
    this.pSize = new Float32Array(MAX);
    this.pVel = new Float32Array(MAX * 3);
    this.pLife = new Float32Array(MAX);
    this.pMaxLife = new Float32Array(MAX);
    this.pGrow = new Float32Array(MAX);
    this.pBase = new Float32Array(MAX * 4);
    g.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.pCol, 4));
    g.setAttribute('size', new THREE.BufferAttribute(this.pSize, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: smokeTexture() }, scale: { value: 600 } },
      vertexShader: `attribute float size; attribute vec4 color; varying vec4 vC;
        uniform float scale;
        void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0);
          gl_PointSize = size * scale / max(0.1, -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D map; varying vec4 vC;
        void main(){ vec4 t = texture2D(map, gl_PointCoord); float a = t.a * vC.a; if (a < 0.01) discard; gl_FragColor = vec4(vC.rgb, a); }`,
      transparent: true,
      depthWrite: false,
    });
    this.pMat = mat;
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
    this.scene.add(this.points);
    this.pNext = 0;
  }

  emit(x, y, z, vx, vy, vz, size, grow, life, r, g, b, a) {
    const i = this.pNext;
    this.pNext = (i + 1) % this.pMax;
    this.pPos[i * 3] = x; this.pPos[i * 3 + 1] = y; this.pPos[i * 3 + 2] = z;
    this.pVel[i * 3] = vx; this.pVel[i * 3 + 1] = vy; this.pVel[i * 3 + 2] = vz;
    this.pSize[i] = size;
    this.pGrow[i] = grow;
    this.pLife[i] = life;
    this.pMaxLife[i] = life;
    this.pBase.set([r, g, b, a], i * 4);
  }

  sparks(x, y, z, vx, vz, n = 12) {
    for (let k = 0; k < n; k++) {
      this.emit(x, y + 0.4, z, vx * 0.3 + (Math.random() - 0.5) * 8, 2 + Math.random() * 4, vz * 0.3 + (Math.random() - 0.5) * 8, 0.12, -0.05, 0.25 + Math.random() * 0.3, 1.0, 0.75, 0.3, 1);
    }
  }

  // 車の状態に応じて煙・砂ぼこりを出す
  carFx(key, st, dt) {
    const sp = Math.hypot(st.vx || 0, st.vz || 0);
    const fx = Math.sin(st.psi), fz = Math.cos(st.psi);
    const lx = Math.cos(st.psi), lz = -Math.sin(st.psi);
    const wheels = [[0.82, 1.3], [-0.82, 1.3], [0.82, -1.36], [-0.82, -1.36]];
    const slip = st.slipAmount || 0;
    // スモークの色（ガレージのカスタム。null なら標準の白）
    let sr, sg, sb;
    if (st.smoke != null) {
      if (st.smoke === 'rainbow') this._tc.setHSL((performance.now() / 1500) % 1, 0.9, 0.62);
      else this._tc.set(st.smoke);
      // Color は線形値なので、そのまま出力される粒子用に sRGB へ戻す
      sr = this._tc.r ** (1 / 2.2); sg = this._tc.g ** (1 / 2.2); sb = this._tc.b ** (1 / 2.2);
    } else {
      sr = sg = sb = this.rain ? 0.75 : 0.82;
    }
    for (let w = 0; w < 4; w++) {
      const [ox, oz] = wheels[w];
      const x = st.x + lx * ox + fx * oz, z = st.z + lz * ox + fz * oz;
      const surf = st.wheelSurf ? st.wheelSurf[w] : 0;
      const rear = w >= 2;
      let a = 0;
      if (surf <= 1) {
        a = Math.max(0, (rear ? slip : slip * 0.7) - 0.25);
        if (st.lock && !rear) a = Math.max(a, st.lock * 0.8);
        if (st.wheelspin && rear) a = Math.max(a, st.wheelspin * 0.8);
      }
      const rs = st.roadSurf || 0; // 0 舗装 1 砂利 2 土 3 雪 4 氷 5 砂
      this.addSkid(key + w, x, st.y, z, lx, lz, rs === 0 ? Math.min(1, a * 1.4) : 0);
      if (rs !== 0 && rs !== 4 && surf <= 1 && sp > 5 && (rear || sp > 20) && Math.random() < dt * (rear ? 46 : 20) * Math.min(1.4, sp / 28)) {
        const col = [[0.66, 0.6, 0.52], [0.52, 0.4, 0.3], [0.97, 0.98, 1.0], null, [0.82, 0.68, 0.46]][rs === 5 ? 4 : rs - 1];
        if (col) this.emit(x, st.y + 0.2, z, -st.vx * 0.12 + (Math.random() - 0.5) * 1.6, 0.7 + Math.random() * 1.4, -st.vz * 0.12 + (Math.random() - 0.5) * 1.6, 1.1, 4.2, 1.7 + Math.random() * 1.2, col[0], col[1], col[2], rs === 3 ? 0.5 : 0.42);
      }
      if (a > 0.15 && sp > 3 && Math.random() < dt * 40 * a) {
        this.emit(x, st.y + 0.25, z, -st.vx * 0.15 + (Math.random() - 0.5), 0.6 + Math.random(), -st.vz * 0.15 + (Math.random() - 0.5), 0.9, 2.8, 1.6 + Math.random(), sr, sg, sb, this.rain ? 0.25 : 0.4);
      }
      if (surf >= 2 && sp > 4 && Math.random() < dt * 30) {
        const sand = surf === 3;
        const r = sand ? 0.75 : 0.45, g = sand ? 0.6 : 0.38, b = sand ? 0.45 : 0.25;
        this.emit(x, st.y + 0.2, z, -st.vx * 0.2 + (Math.random() - 0.5) * 2, 1 + Math.random() * 1.5, -st.vz * 0.2 + (Math.random() - 0.5) * 2, 1.2, 3.5, 1.5, r, g, b, 0.5);
      }
      if (this.rain && rear && sp > 12 && Math.random() < dt * 25 * (sp / 50)) {
        this.emit(x - fx * 0.5, st.y + 0.3, z - fz * 0.5, -fx * sp * 0.15 + (Math.random() - 0.5) * 2, 0.6 + Math.random(), -fz * sp * 0.15 + (Math.random() - 0.5) * 2, 1.4, 4, 0.9, 0.82, 0.85, 0.9, 0.22);
      }
    }
  }

  // ---- 雨 ----
  // ボート: 艇首の水しぶき・スターンの噴き上げ・白い航跡
  boatFx(st, dt, rate = 1) {
    const sp = Math.hypot(st.vx || 0, st.vz || 0);
    if (sp < 2) return;
    const fx = Math.sin(st.psi), fz = Math.cos(st.psi);
    const lx = Math.cos(st.psi), lz = -Math.sin(st.psi);
    const k = Math.min(1.5, sp / 18) * rate;
    const br0 = this.dim ?? 1;
    // 航跡（泡）
    if (Math.random() < dt * 34 * k) {
      const x = st.x - fx * 1.7, z = st.z - fz * 1.7;
      this.emit(x + (Math.random() - 0.5) * 0.6, 0.05, z + (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.4, 0.05, (Math.random() - 0.5) * 0.4, 0.8, 1.4, 2.6, 0.95 * br0, 0.97 * br0, br0, 0.28);
    }
    // スターンの噴き上げ（ルースターテール）
    const br = this.dim ?? 1;
    if (Math.random() < dt * 30 * k * (0.4 + (st.throttle || 0))) {
      const x = st.x - fx * 2.0, z = st.z - fz * 2.0;
      this.emit(x, 0.2, z, -fx * sp * 0.3 + (Math.random() - 0.5) * 1.2, 1.6 + Math.random() * 2, -fz * sp * 0.3 + (Math.random() - 0.5) * 1.2, 0.25, 0.9, 0.8, 0.92 * br, 0.95 * br, br, 0.3);
    }
    // 艇首の左右に飛ぶしぶき（旋回中は外側が強い）
    const lean = Math.max(-1, Math.min(1, (st.r || 0) * 1.4));
    for (const side of [1, -1]) {
      const w = 1 + side * -lean * 0.8;
      if (Math.random() < dt * 20 * k * w) {
        const x = st.x + fx * 0.6 + lx * side * 0.5, z = st.z + fz * 0.6 + lz * side * 0.5;
        this.emit(x, 0.15, z, lx * side * (1.5 + Math.random() * 2) - fx * sp * 0.1, 0.9 + Math.random() * 1.2, lz * side * (1.5 + Math.random() * 2) - fz * sp * 0.1, 0.22, 0.8, 0.6, 0.92 * br, 0.95 * br, br, 0.32);
      }
    }
  }

  buildRain() {
    const N = this.quality >= 2 ? 5000 : 2500;
    const g = new THREE.BufferGeometry();
    const p = new Float32Array(N * 6);
    this.rainBase = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      this.rainBase[i * 3] = (Math.random() - 0.5) * 70;
      this.rainBase[i * 3 + 1] = Math.random() * 30;
      this.rainBase[i * 3 + 2] = (Math.random() - 0.5) * 70;
    }
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    this.rainPos = p;
    this.rainN = N;
    const mat = new THREE.LineBasicMaterial({ color: this.snow ? 0xffffff : 0xaab4c0, transparent: true, opacity: this.snow ? 0.8 : 0.35, depthWrite: false });
    this.rainLines = new THREE.LineSegments(g, mat);
    this.rainLines.frustumCulled = false;
    this.scene.add(this.rainLines);
    this.rainT = 0;
  }

  update(dt, cam, camVel) {
    // パーティクル
    const P = this.pPos, V = this.pVel, C = this.pCol;
    for (let i = 0; i < this.pMax; i++) {
      if (this.pLife[i] <= 0) { C[i * 4 + 3] = 0; continue; }
      this.pLife[i] -= dt;
      const t = Math.max(0, this.pLife[i] / this.pMaxLife[i]);
      P[i * 3] += V[i * 3] * dt;
      P[i * 3 + 1] += V[i * 3 + 1] * dt;
      P[i * 3 + 2] += V[i * 3 + 2] * dt;
      if (this.pGrow[i] < 0) V[i * 3 + 1] -= 12 * dt; // 火花は重力
      else { V[i * 3] *= 1 - dt * 1.5; V[i * 3 + 2] *= 1 - dt * 1.5; V[i * 3 + 1] *= 1 - dt * 0.5; }
      this.pSize[i] = Math.max(0.02, this.pSize[i] + this.pGrow[i] * dt);
      C[i * 4] = this.pBase[i * 4];
      C[i * 4 + 1] = this.pBase[i * 4 + 1];
      C[i * 4 + 2] = this.pBase[i * 4 + 2];
      C[i * 4 + 3] = this.pBase[i * 4 + 3] * (this.pGrow[i] < 0 ? t : Math.min(1, t * 1.5) * Math.min(1, (1 - t) * 6 + 0.2));
    }
    const ga = this.points.geometry.attributes;
    ga.position.needsUpdate = true;
    ga.color.needsUpdate = true;
    ga.size.needsUpdate = true;
    if (this.skidDirty) {
      this.skidMesh.geometry.attributes.position.needsUpdate = true;
      this.skidMesh.geometry.attributes.alpha.needsUpdate = true;
      this.skidDirty = false;
    }
    // 雨: カメラの周りの箱で循環
    if (this.rain || this.snow) {
      this.rainT += dt;
      const fall = this.snow ? 2.6 : 22;
      const seg = this.snow ? 0.16 : 0.7;
      const sx = (camVel ? camVel.x : 0) * 0.03, sz = (camVel ? camVel.z : 0) * 0.03;
      for (let i = 0; i < this.rainN; i++) {
        const bx = this.rainBase[i * 3], bz = this.rainBase[i * 3 + 2];
        let y = (this.rainBase[i * 3 + 1] - this.rainT * fall) % 30;
        if (y < 0) y += 30;
        const x = cam.x + ((((bx - cam.x) % 70) + 105) % 70) - 35;
        const z = cam.z + ((((bz - cam.z) % 70) + 105) % 70) - 35;
        const yy = cam.y - 10 + y;
        const o = i * 6;
        const sway = this.snow ? Math.sin(this.rainT * 0.9 + i) * 0.6 : 0;
        this.rainPos[o] = x + sway; this.rainPos[o + 1] = yy; this.rainPos[o + 2] = z;
        this.rainPos[o + 3] = x + sway - sx * (this.snow ? 0.15 : 1); this.rainPos[o + 4] = yy - seg; this.rainPos[o + 5] = z - sz * (this.snow ? 0.15 : 1);
      }
      this.rainLines.geometry.attributes.position.needsUpdate = true;
    }
  }

  setViewport(h) {
    this.pMat.uniforms.scale.value = h * 0.9;
  }
}
