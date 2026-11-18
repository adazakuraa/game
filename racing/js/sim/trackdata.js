// コース定義。points は [x, z, 標高y] の制御点（閉じたループ、centripetal Catmull-Rom で補間）。
// 座標はメートル。スタートラインは最初の制御点付近（s=0）。

// 多角形の頂点 [x, z, コーナー半径, 標高] を円弧でつないだコース。
// 半径が大きすぎる場合は辺の長さに合わせて自動で縮める。始点は最初の辺の中間。
export function poly(verts, step = 5) {
  const n = verts.length;
  const V = verts.map((v) => ({ x: v[0], z: v[1], R: v[2] ?? 30, y: v[3] ?? 0 }));
  const fil = V.map((v, i) => {
    const p = V[(i - 1 + n) % n], q = V[(i + 1) % n];
    const d1 = nrm(v.x - p.x, v.z - p.z), d2 = nrm(q.x - v.x, q.z - v.z);
    const l1 = Math.hypot(v.x - p.x, v.z - p.z), l2 = Math.hypot(q.x - v.x, q.z - v.z);
    const cross = d1[0] * d2[1] - d1[1] * d2[0];
    const dot = d1[0] * d2[0] + d1[1] * d2[1];
    const phi = Math.atan2(cross, dot); // 曲がる角度（符号付き）
    let R = v.R;
    let t = R * Math.tan(Math.abs(phi) / 2);
    const tmax = 0.48 * Math.min(l1, l2);
    if (t > tmax) { t = tmax; R = t / Math.tan(Math.abs(phi) / 2); }
    const A = [v.x - d1[0] * t, v.z - d1[1] * t];
    const B = [v.x + d2[0] * t, v.z + d2[1] * t];
    const sg = phi >= 0 ? 1 : -1;
    const C = [A[0] - d1[1] * R * sg, A[1] + d1[0] * R * sg];
    return { A, B, C, R, phi, y: v.y, a0: Math.atan2(A[1] - C[1], A[0] - C[0]) };
  });
  const pts = [];
  const pushLine = (P, Q, y0, y1, skipFirst) => {
    const L = Math.hypot(Q[0] - P[0], Q[1] - P[1]);
    const k = Math.max(1, Math.round(L / step));
    for (let j = skipFirst ? 1 : 0; j <= k; j++) {
      const t = j / k;
      pts.push([P[0] + (Q[0] - P[0]) * t, P[1] + (Q[1] - P[1]) * t, y0 + (y1 - y0) * t]);
    }
  };
  for (let i = 0; i < n; i++) {
    const f = fil[i], g = fil[(i + 1) % n];
    // 円弧
    const k = Math.max(2, Math.round((Math.abs(f.phi) * f.R) / step));
    for (let j = 1; j < k; j++) {
      const an = f.a0 + f.phi * (j / k);
      pts.push([f.C[0] + Math.cos(an) * f.R, f.C[1] + Math.sin(an) * f.R, f.y]);
    }
    pushLine(f.B, g.A, f.y, g.y, false);
  }
  // 最初の直線の中間から始める
  const first = fil[0], second = fil[1];
  const mid = [(first.B[0] + second.A[0]) / 2, (first.B[1] + second.A[1]) / 2];
  let best = 0, bd = Infinity;
  pts.forEach((p, i) => {
    const d = (p[0] - mid[0]) ** 2 + (p[1] - mid[1]) ** 2;
    if (d < bd) { bd = d; best = i; }
  });
  const out = pts.slice(best).concat(pts.slice(0, best));
  // 重複点を除去し [x, z, y] 形式に
  const res = [];
  for (const p of out) {
    const l = res[res.length - 1];
    if (!l || Math.hypot(p[0] - l[0], p[1] - l[1]) > 1.5) res.push([p[0], p[1], p[2]]);
  }
  return res;
}
function nrm(x, z) {
  const l = Math.hypot(x, z) || 1;
  return [x / l, z / l];
}

export const TRACKS = [
  {
    id: 'greenhill',
    name: 'グリーンヒル・グランプリ',
    en: 'GREENHILL GP',
    desc: '丘陵地帯の高速サーキット。長いストレートと高速S字、最後のヘアピンでのブレーキングが勝負。',
    tags: ['昼', '高速', '初級'],
    width: 14,
    runoff: 14,
    grip: 1.0,
    scenery: 'country',
    env: { time: 'day', sunElev: 38, sunAzim: 140, fog: 0.0011, exposure: 0.62 },
    points: poly([
      [-350, 0, 60, 0], [450, 0, 55, 2], [520, 180, 120, 6], [380, 330, 90, 10], [420, 470, 40, 13],
      [250, 520, 30, 14], [180, 380, 60, 11], [40, 400, 70, 8], [-60, 560, 25, 7], [-200, 420, 110, 5],
      [-420, 380, 50, 3], [-480, 200, 80, 1],
    ]),
  },
  {
    id: 'kirimine',
    name: '霧峰マウンテンサーキット',
    en: 'KIRIMINE MOUNTAIN',
    desc: '朝霧の山岳コース。高低差45m、狭い道幅とブラインドコーナーが続くテクニカルレイアウト。',
    tags: ['朝霧', '高低差', 'テクニカル'],
    width: 11.5,
    runoff: 7,
    grip: 0.97,
    scenery: 'mountain',
    env: { time: 'morning', sunElev: 12, sunAzim: 80, fog: 0.0042, exposure: 0.55 },
    points: poly([
      [-150, 0, 40, 0], [250, 0, 35, 4], [330, 120, 30, 10], [220, 200, 45, 16], [300, 300, 22, 24],
      [200, 380, 28, 30], [60, 300, 50, 36], [-40, 420, 20, 42], [-180, 340, 35, 38], [-120, 220, 30, 28],
      [-260, 160, 26, 16], [-280, 40, 40, 6],
    ]),
  },
  {
    id: 'bayside',
    name: 'ベイサイド市街地コース',
    en: 'BAYSIDE STREET',
    desc: '夜の港湾都市を走るストリートコース。ウォールが迫る直角コーナーの連続。一瞬のミスが命取り。',
    tags: ['夜', '市街地', '上級'],
    width: 12,
    runoff: 0.8,
    grip: 0.98,
    scenery: 'city',
    lineLimit: 4.1, // 壁が近いのでライン取りに余裕を持たせる
    env: { time: 'night', sunElev: -8, sunAzim: 200, fog: 0.0016, exposure: 0.85 },
    points: poly([
      [-300, 0, 16], [350, 0, 20], [350, 250, 16], [180, 250, 14], [180, 150, 14], [60, 150, 14],
      [60, 380, 18], [-180, 380, 25], [-260, 300, 30], [-180, 200, 15], [-300, 150, 18],
    ]),
  },
  {
    id: 'sunset',
    name: 'サンセット・デザートレースウェイ',
    en: 'SUNSET DESERT',
    desc: '夕陽に染まる砂漠の超高速コース。道幅は広いが、コースを外れると砂で大きく失速する。',
    tags: ['夕方', '超高速', '中級'],
    width: 15,
    runoff: 16,
    grip: 0.96,
    scenery: 'desert',
    env: { time: 'dusk', sunElev: 4, sunAzim: 255, fog: 0.0012, exposure: 0.6 },
    points: poly([
      [-500, 0, 80, 0], [600, 0, 70, 2], [700, 250, 150, 5], [500, 500, 60, 9], [250, 420, 35, 8],
      [100, 560, 100, 10], [-200, 560, 45, 8], [-260, 380, 30, 5], [-450, 330, 60, 2],
    ]),
  },
  {
    id: 'rainforest',
    name: 'レインフォレスト・リンク',
    en: 'RAINFOREST RING',
    desc: '雨の森林サーキット。濡れた路面はグリップが低く、アクセルとブレーキの繊細なコントロールが必要。',
    tags: ['雨', 'ウェット', '上級'],
    width: 13,
    runoff: 9,
    grip: 0.74,
    scenery: 'forest',
    env: { time: 'rain', sunElev: 30, sunAzim: 160, fog: 0.0055, exposure: 0.5 },
    points: poly([
      [-250, 0, 40, 0], [300, 0, 45, 2], [380, 150, 60, 5], [280, 260, 30, 8], [380, 400, 50, 12],
      [220, 520, 35, 14], [60, 430, 60, 11], [-60, 540, 30, 9], [-220, 450, 70, 7], [-160, 300, 25, 5],
      [-330, 220, 45, 2],
    ]),
  },
];
