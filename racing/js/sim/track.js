// コースの中心線・道幅・壁・レーシングライン・速度プロファイル（描画には依存しない）
import { CAR_SPEC } from './car.js';

const G = 9.81;

function catmull(p0, p1, p2, p3, u) {
  // centripetal Catmull-Rom (Barry-Goldman)
  const d = (a, b) => Math.max(1e-4, Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])));
  const t0 = 0, t1 = t0 + d(p0, p1), t2 = t1 + d(p1, p2), t3 = t2 + d(p2, p3);
  const t = t1 + u * (t2 - t1);
  const L = (A, B, ta, tb) => {
    const k = (t - ta) / (tb - ta);
    return [A[0] + (B[0] - A[0]) * k, A[1] + (B[1] - A[1]) * k, A[2] + (B[2] - A[2]) * k];
  };
  const A1 = L(p0, p1, t0, t1), A2 = L(p1, p2, t1, t2), A3 = L(p2, p3, t2, t3);
  const B1 = L(A1, A2, t0, t2), B2 = L(A2, A3, t1, t3);
  return L(B1, B2, t1, t2);
}

function wrap(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

export class Track {
  constructor(def) {
    this.def = def;
    this.halfW = def.width / 2;
    this.grip = def.grip ?? 1;
    this.build(def);
    this.buildSurfaces(def);
    this.buildRacingLine();
    this.buildSpeedProfile(def.spec || CAR_SPEC);
    this.buildHash();
  }

  build(def) {
    const P = def.points.map((p) => [p[0], p[2] || 0, p[1]]); // [x, y, z]
    const n = P.length;
    const dense = [];
    const SUB = 60;
    for (let i = 0; i < n; i++) {
      const p0 = P[(i - 1 + n) % n], p1 = P[i], p2 = P[(i + 1) % n], p3 = P[(i + 2) % n];
      for (let k = 0; k < SUB; k++) dense.push(catmull(p0, p1, p2, p3, k / SUB));
    }
    // 弧長
    const m = dense.length;
    const cum = new Float64Array(m + 1);
    for (let i = 0; i < m; i++) {
      const a = dense[i], b = dense[(i + 1) % m];
      cum[i + 1] = cum[i] + Math.hypot(b[0] - a[0], b[2] - a[2]);
    }
    const total = cum[m];
    const N = Math.round(total / 2);
    this.N = N;
    this.length = total;
    this.ds = total / N;
    const X = (this.x = new Float32Array(N));
    const Y = (this.y = new Float32Array(N));
    const Z = (this.z = new Float32Array(N));
    let j = 0;
    for (let i = 0; i < N; i++) {
      const s = i * this.ds;
      while (cum[j + 1] < s) j++;
      const k = (s - cum[j]) / (cum[j + 1] - cum[j]);
      const a = dense[j], b = dense[(j + 1) % m];
      X[i] = a[0] + (b[0] - a[0]) * k;
      Y[i] = a[1] + (b[1] - a[1]) * k;
      Z[i] = a[2] + (b[2] - a[2]) * k;
    }
    // 標高をなめらかに
    const ys = Float32Array.from(Y);
    for (let it = 0; it < 3; it++) {
      for (let i = 0; i < N; i++) {
        let acc = 0;
        for (let o = -6; o <= 6; o++) acc += ys[(i + o + N) % N];
        Y[i] = acc / 13;
      }
      ys.set(Y);
    }
    // 接線・左法線・方位・曲率・勾配
    this.tx = new Float32Array(N);
    this.tz = new Float32Array(N);
    this.hd = new Float32Array(N); // heading psi: forward = (sin psi, cos psi)
    this.kappa = new Float32Array(N);
    this.slope = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = (i - 1 + N) % N, b = (i + 1) % N;
      let dx = X[b] - X[a], dz = Z[b] - Z[a];
      const l = Math.hypot(dx, dz);
      dx /= l; dz /= l;
      this.tx[i] = dx;
      this.tz[i] = dz;
      this.hd[i] = Math.atan2(dx, dz);
      this.slope[i] = (Y[b] - Y[a]) / (2 * this.ds);
    }
    const kr = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = (i - 2 + N) % N, b = (i + 2) % N;
      kr[i] = wrap(this.hd[b] - this.hd[a]) / (4 * this.ds);
    }
    for (let i = 0; i < N; i++) {
      let acc = 0;
      for (let o = -4; o <= 4; o++) acc += kr[(i + o + N) % N];
      this.kappa[i] = acc / 9;
    }
    // 壁までの距離（内側はコーナー半径で制限）
    const hw = this.halfW;
    const ro = def.runoff;
    const wl = new Float32Array(N), wr = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      // 周辺で最も急な曲率を見る
      let kmaxL = 0, kmaxR = 0;
      for (let o = -12; o <= 12; o++) {
        const k = this.kappa[(i + o + N) % N];
        if (k > kmaxL) kmaxL = k;
        if (-k > kmaxR) kmaxR = -k;
      }
      let l = hw + ro, r = hw + ro;
      if (kmaxL > 0) l = Math.min(l, Math.max(hw + 0.8, 0.82 / kmaxL - 1));
      if (kmaxR > 0) r = Math.min(r, Math.max(hw + 0.8, 0.82 / kmaxR - 1));
      wl[i] = l;
      wr[i] = r;
    }
    // なめらかに（最小値フィルタ→平均）
    this.wallL = smoothMin(wl, N);
    this.wallR = smoothMin(wr, N);
    // 縁石（曲率がある区間）
    this.curb = new Uint8Array(N);
    const kTh = 1 / 230;
    for (let i = 0; i < N && def.curbs !== false; i++) {
      if (Math.abs(this.kappa[i]) > kTh) {
        for (let o = -10; o <= 10; o++) this.curb[(i + o + N) % N] = 1;
      }
    }
  }

  // 路面の種類ごとのグリップ（ラリー）。def.surfaces = [[開始割合, 終了割合, 種類], ...]（ステージ長に対する割合）
  buildSurfaces(def) {
    const N = this.N;
    this.surfArr = new Uint8Array(N);
    this.gripArr = new Float32Array(N).fill(this.grip);
    this.stageEnd = def.stage ? def.stage * this.length : null; // 一本道のゴール位置 (m)
    this.stageN = this.stageEnd ? Math.min(N - 1, Math.round(this.stageEnd / this.ds)) : N;
    if (!def.surfaces) return;
    const len = this.stageEnd || this.length;
    for (const [a, b, kind] of def.surfaces) {
      const k = SURFACE_KINDS.indexOf(kind);
      if (k < 0) continue;
      const i0 = Math.floor(((a * len) / this.length) * N), i1 = Math.ceil(((b * len) / this.length) * N);
      for (let i = i0; i < i1 && i < N; i++) {
        this.surfArr[i] = k;
        this.gripArr[i] = SURFACE_GRIP[kind] * (def.grip ?? 1);
      }
    }
    // 境目をなめらかに（路面が変わる瞬間にグリップが急変しないように）
    const g = Float32Array.from(this.gripArr);
    for (let i = 0; i < N; i++) {
      let acc = 0;
      for (let o = -6; o <= 6; o++) acc += g[(i + o + N) % N];
      this.gripArr[i] = acc / 13;
    }
  }

  gripAt(i) { return this.gripArr[i]; }

  // レーシングライン: 最小曲率に近いラインを反復スムージングで求める
  buildRacingLine() {
    const N = this.N;
    const lim = this.def.lineLimit ?? this.halfW - 1.15;
    const o = new Float32Array(N);
    const px = new Float32Array(N), pz = new Float32Array(N);
    const lx = (i) => this.tz[i];
    const lz = (i) => -this.tx[i];
    const upd = () => {
      for (let i = 0; i < N; i++) {
        px[i] = this.x[i] + o[i] * lx(i);
        pz[i] = this.z[i] + o[i] * lz(i);
      }
    };
    for (const [m, iters] of [[30, 120], [18, 150], [10, 150], [5, 150], [3, 100]]) {
      for (let it = 0; it < iters; it++) {
        upd();
        for (let i = 0; i < N; i++) {
          const a = (i - m + N) % N, b = (i + m) % N;
          const mx = (px[a] + px[b]) / 2, mz = (pz[a] + pz[b]) / 2;
          const want = (mx - this.x[i]) * lx(i) + (mz - this.z[i]) * lz(i);
          let v = o[i] + 0.6 * (want - o[i]);
          if (v > lim) v = lim;
          if (v < -lim) v = -lim;
          o[i] = v;
        }
      }
    }
    // 軽い平滑化
    const t = Float32Array.from(o);
    for (let i = 0; i < N; i++) {
      let acc = 0;
      for (let k = -3; k <= 3; k++) acc += t[(i + k + N) % N];
      o[i] = Math.max(-lim, Math.min(lim, acc / 7));
    }
    this.line = o;
    upd();
    this.lineX = px;
    this.lineZ = pz;
    // ライン上の区間長と曲率
    this.lineDs = new Float32Array(N);
    this.lineK = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const b = (i + 1) % N;
      this.lineDs[i] = Math.hypot(px[b] - px[i], pz[b] - pz[i]);
    }
    const kr = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = (i - 3 + N) % N, b = (i + 3) % N;
      const h1 = Math.atan2(px[i] - px[a], pz[i] - pz[a]);
      const h2 = Math.atan2(px[b] - px[i], pz[b] - pz[i]);
      const len = Math.hypot(px[b] - px[i], pz[b] - pz[i]) + Math.hypot(px[i] - px[a], pz[i] - pz[a]);
      kr[i] = (2 * wrap(h2 - h1)) / Math.max(len, 0.1);
    }
    for (let i = 0; i < N; i++) {
      let acc = 0;
      for (let k = -2; k <= 2; k++) acc += kr[(i + k + N) % N];
      this.lineK[i] = acc / 5;
    }
  }

  // 理想速度プロファイル（摩擦円・ダウンフォース・パワーを考慮）
  buildSpeedProfile(spec = CAR_SPEC, muScale = 0.92) {
    const N = this.N;
    const c = spec;
    const muOf = (i) => c.mu * this.gripArr[i] * muScale;
    const dfk = (0.5 * 1.2 * c.ClA) / c.mass; // a_down = dfk * v^2
    const dragk = (0.5 * 1.2 * c.CdA) / c.mass;
    const vmax = c.topSpeed;
    const v = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const k = Math.abs(this.lineK[i]);
      const mu = muOf(i);
      const den = k - mu * dfk;
      let vi = den <= 1e-6 ? vmax : Math.sqrt((mu * G) / den);
      v[i] = Math.min(vi, vmax);
    }
    const latUse = (vi, i) => vi * vi * Math.abs(this.lineK[i]);
    const avail = (vi, i) => muOf(i) * (G + dfk * vi * vi);
    // 前進（加速制限）
    for (let pass = 0; pass < 2; pass++) {
      for (let k = 0; k < N; k++) {
        const i = k, b = (k + 1) % N;
        const vi = v[i];
        const lat = latUse(vi, i);
        const tot = avail(vi, i);
        const longAvail = Math.sqrt(Math.max(0, tot * tot - lat * lat)) * (c.tractionK ?? 0.55); // 後輪駆動なのでトラクション控えめ
        const pw = c.power / (c.mass * Math.max(vi, 5));
        const acc = Math.min(longAvail, pw) - dragk * vi * vi;
        const vn = Math.sqrt(Math.max(0, vi * vi + 2 * Math.max(acc, 0) * this.lineDs[i]));
        if (vn < v[b]) v[b] = vn;
      }
    }
    // 後退（減速制限）
    for (let pass = 0; pass < 2; pass++) {
      for (let k = N - 1; k >= 0; k--) {
        const i = k, a = (k - 1 + N) % N;
        const vi = v[i];
        const lat = latUse(vi, i);
        const tot = avail(vi, i);
        const dec = Math.sqrt(Math.max(0, tot * tot - lat * lat)) * (c.brakeK ?? 0.92) + dragk * vi * vi;
        const vp = Math.sqrt(vi * vi + 2 * dec * this.lineDs[a]);
        if (vp < v[a]) v[a] = vp;
      }
    }
    this.profile = v;
    let t = 0;
    for (let i = 0; i < N; i++) t += this.lineDs[i] / Math.max(v[i], 1);
    this.profileLapTime = t;
    this.findCorners();
  }

  // ブレーキングポイント（看板配置用）
  findCorners() {
    const N = this.N, v = this.profile;
    const corners = [];
    for (let i = 0; i < N; i++) {
      let isMin = true;
      for (let o = -40; o <= 40; o++) {
        if (o && v[(i + o + N) % N] < v[i]) { isMin = false; break; }
      }
      if (!isMin) continue;
      // 手前の最高速
      let vmaxBefore = v[i], j = i, brakeStart = i;
      for (let o = 1; o < 250; o++) {
        const k = (i - o + N) % N;
        if (v[k] >= vmaxBefore) { vmaxBefore = v[k]; brakeStart = k; } else break;
      }
      if (vmaxBefore - v[i] > 9) {
        corners.push({ apex: i, brakeStart, vApex: v[i], vEntry: vmaxBefore, side: this.kappa[i] > 0 ? 1 : -1 });
      }
      j = j;
    }
    this.corners = corners;
  }

  buildHash() {
    this.cell = 24;
    this.hash = new Map();
    const lim = this.stageEnd ? Math.min(this.N, this.stageN + Math.ceil(160 / this.ds)) : this.N;
    for (let i = 0; i < lim; i++) {
      const k = this.key(Math.floor(this.x[i] / this.cell), Math.floor(this.z[i] / this.cell));
      if (!this.hash.has(k)) this.hash.set(k, []);
      this.hash.get(k).push(i);
    }
  }
  key(cx, cz) { return cx * 73856093 ^ cz * 19349663; }

  // 最寄りの中心線サンプル（シーナリー配置用、radius内になければ -1）
  nearest(x, z, radius = 60) {
    const c = this.cell;
    const r = Math.ceil(radius / c);
    const cx = Math.floor(x / c), cz = Math.floor(z / c);
    let best = -1, bd = radius * radius;
    for (let a = -r; a <= r; a++) {
      for (let b = -r; b <= r; b++) {
        const arr = this.hash.get(this.key(cx + a, cz + b));
        if (!arr) continue;
        for (const i of arr) {
          const d = (this.x[i] - x) ** 2 + (this.z[i] - z) ** 2;
          if (d < bd) { bd = d; best = i; }
        }
      }
    }
    return best >= 0 ? { i: best, dist: Math.sqrt(bd) } : null;
  }

  // ワールド座標→コース座標 (s, d)。hint 付近を探索。out に書き込む
  project(x, z, hint, out, range = 30) {
    const N = this.N;
    let best = hint, bd = Infinity;
    if (hint < 0) {
      for (let i = 0; i < N; i++) {
        const d = (this.x[i] - x) ** 2 + (this.z[i] - z) ** 2;
        if (d < bd) { bd = d; best = i; }
      }
    } else {
      for (let o = -range; o <= range; o++) {
        const i = (hint + o + N) % N;
        const d = (this.x[i] - x) ** 2 + (this.z[i] - z) ** 2;
        if (d < bd) { bd = d; best = i; }
      }
    }
    // 前後どちらのセグメントか
    let i0 = best;
    const fx = this.tx[best], fz = this.tz[best];
    if ((x - this.x[best]) * fx + (z - this.z[best]) * fz < 0) i0 = (best - 1 + N) % N;
    const i1 = (i0 + 1) % N;
    const sx = this.x[i1] - this.x[i0], sz = this.z[i1] - this.z[i0];
    let t = ((x - this.x[i0]) * sx + (z - this.z[i0]) * sz) / (sx * sx + sz * sz);
    t = Math.max(0, Math.min(1, t));
    const cx = this.x[i0] + sx * t, cz = this.z[i0] + sz * t;
    const lxx = this.tz[i0] * (1 - t) + this.tz[i1] * t;
    const lzz = -(this.tx[i0] * (1 - t) + this.tx[i1] * t);
    out.i = best;
    out.i0 = i0;
    out.t = t;
    out.s = (i0 + t) * this.ds;
    out.d = (x - cx) * lxx + (z - cz) * lzz;
    out.y = this.y[i0] * (1 - t) + this.y[i1] * t;
    out.slope = this.slope[i0] * (1 - t) + this.slope[i1] * t;
    out.hd = this.hd[i0] + wrap(this.hd[i1] - this.hd[i0]) * t;
    out.wallL = this.wallL[i0] * (1 - t) + this.wallL[i1] * t;
    out.wallR = this.wallR[i0] * (1 - t) + this.wallR[i1] * t;
    out.curb = this.curb[best];
    out.lx = lxx;
    out.lz = lzz;
    return out;
  }

  // s（中心線上の距離）と横オフセット d からワールド座標
  pointAt(s, d, out) {
    const N = this.N;
    s = ((s % this.length) + this.length) % this.length;
    const f = s / this.ds;
    const i0 = Math.floor(f) % N, i1 = (i0 + 1) % N, t = f - Math.floor(f);
    const cx = this.x[i0] + (this.x[i1] - this.x[i0]) * t;
    const cz = this.z[i0] + (this.z[i1] - this.z[i0]) * t;
    const lxx = this.tz[i0] * (1 - t) + this.tz[i1] * t;
    const lzz = -(this.tx[i0] * (1 - t) + this.tx[i1] * t);
    out.x = cx + lxx * d;
    out.z = cz + lzz * d;
    out.y = this.y[i0] + (this.y[i1] - this.y[i0]) * t;
    out.hd = this.hd[i0] + wrap(this.hd[i1] - this.hd[i0]) * t;
    out.i = i0;
    out.t = t;
    return out;
  }

  sampleArr(arr, s) {
    const N = this.N;
    s = ((s % this.length) + this.length) % this.length;
    const f = s / this.ds;
    const i0 = Math.floor(f) % N, i1 = (i0 + 1) % N, t = f - Math.floor(f);
    return arr[i0] + (arr[i1] - arr[i0]) * t;
  }

  surfaceAt(d, curbHere) {
    // 返り値: grip倍率, 抵抗係数, 種別
    const a = Math.abs(d);
    if (a <= this.halfW) return SURF.asphalt;
    if (curbHere && a <= this.halfW + 1.3) return SURF.curb;
    if (this.def.scenery === 'city') return SURF.asphalt;
    if (this.def.scenery === 'desert') return SURF.sand;
    if (this.def.scenery === 'alpine') return SURF.snow;
    return SURF.grass;
  }
}

// 路面の種類（ラリー）とグリップ
export const SURFACE_KINDS = ['tarmac', 'gravel', 'dirt', 'snow', 'ice', 'sand'];
export const SURFACE_GRIP = { tarmac: 1, gravel: 0.74, dirt: 0.8, snow: 0.5, ice: 0.3, sand: 0.64 };

export const SURF = {
  snow: { grip: 0.5, drag: 260, type: 3 },
  asphalt: { grip: 1, drag: 0, type: 0 },
  curb: { grip: 0.93, drag: 30, type: 1 },
  grass: { grip: 0.58, drag: 230, type: 2 },
  sand: { grip: 0.52, drag: 300, type: 3 },
};

function smoothMin(a, N) {
  const m = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    let v = Infinity;
    for (let o = -6; o <= 6; o++) v = Math.min(v, a[(i + o + N) % N]);
    m[i] = v;
  }
  const out = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    let acc = 0;
    for (let o = -6; o <= 6; o++) acc += m[(i + o + N) % N];
    out[i] = acc / 13;
  }
  return out;
}
