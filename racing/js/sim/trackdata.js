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
    // ショートカット（a: 分岐、b: 合流の位置の割合、side: 1 左 / -1 右）。距離は短いが路面が悪い
    shortcuts: [{ a: 0.284, b: 0.459, side: -1, surface: 'dirt' }],
    // ジャンプ台（at: 先端の位置の割合、gap: 飛び越える谷の長さ m）
    jumps: [{ at: 0.921, len: 30, h: 2.4 }],
    // タイムアタックの目標（1・2周目の合計・秒）: 金・銀・銅
    medals: [151.5, 159.5, 166.0],
    name: 'グリーンヒル・グランプリ',
    en: 'GREENHILL GP',
    desc: '丘陵地帯の高速サーキット。長いストレートと高速S字、最後のヘアピンでのブレーキングが勝負。',
    tags: ['昼', '高速', '初級'],
    width: 17, // 以前は 14
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
    // ショートカット（a: 分岐、b: 合流の位置の割合、side: 1 左 / -1 右）。距離は短いが路面が悪い
    shortcuts: [{ a: 0.477, b: 0.693, side: -1, surface: 'gravel' }],
    // タイムアタックの目標（1・2周目の合計・秒）: 金・銀・銅
    medals: [133.5, 141.5, 148.5],
    name: '霧峰マウンテンサーキット',
    en: 'KIRIMINE MOUNTAIN',
    desc: '朝霧の山岳コース。高低差45m、狭い道幅とブラインドコーナーが続くテクニカルレイアウト。',
    tags: ['朝霧', '高低差', 'テクニカル'],
    width: 14.5, // 以前は 11.5
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
    // ショートカット（a: 分岐、b: 合流の位置の割合、side: 1 左 / -1 右）。距離は短いが路面が悪い
    shortcuts: [{ a: 0.027, b: 0.317, side: -1, surface: 'cobble', width: 9 }],
    // ジャンプ台（at: 先端の位置の割合、gap: 飛び越える谷の長さ m）
    jumps: [{ at: 0.929, len: 26, h: 2.0 }],
    // タイムアタックの目標（1・2周目の合計・秒）: 金・銀・銅
    medals: [161.0, 170.5, 178.5],
    name: 'ベイサイド市街地コース',
    en: 'BAYSIDE STREET',
    desc: '夜の港湾都市を走るストリートコース。ウォールが迫る直角コーナーの連続。一瞬のミスが命取り。',
    tags: ['夜', '市街地', '上級'],
    width: 15, // 以前は 12
    runoff: 0.8,
    grip: 0.98,
    scenery: 'city',
    lineLimit: 5.6, // 壁が近いのでライン取りに余裕を持たせる
    env: { time: 'night', sunElev: -8, sunAzim: 200, fog: 0.0016, exposure: 0.85 },
    points: poly([
      [-300, 0, 16], [350, 0, 20], [350, 250, 16], [180, 250, 14], [180, 150, 14], [60, 150, 14],
      [60, 380, 18], [-180, 380, 25], [-260, 300, 30], [-180, 200, 15], [-300, 150, 18],
    ]),
  },
  {
    id: 'sunset',
    // ジャンプ台（at: 先端の位置の割合、gap: 飛び越える谷の長さ m）
    jumps: [{ at: 0.542, len: 26, h: 2.3, gap: 28 }, { at: 0.911, len: 30, h: 2.4 }],
    // タイムアタックの目標（1・2周目の合計・秒）: 金・銀・銅
    medals: [158.5, 167.0, 173.0],
    name: 'サンセット・デザートレースウェイ',
    en: 'SUNSET DESERT',
    desc: '夕陽に染まる砂漠の超高速コース。道幅は広いが、コースを外れると砂で大きく失速する。',
    tags: ['夕方', '超高速', '中級'],
    width: 18, // 以前は 15
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
    // ショートカット（a: 分岐、b: 合流の位置の割合、side: 1 左 / -1 右）。距離は短いが路面が悪い
    shortcuts: [{ a: 0.699, b: 0.931, side: -1, surface: 'dirt' }],
    // タイムアタックの目標（1・2周目の合計・秒）: 金・銀・銅
    medals: [165.0, 172.0, 179.0],
    name: 'レインフォレスト・リンク',
    en: 'RAINFOREST RING',
    desc: '雨の森林サーキット。濡れた路面はグリップが低く、アクセルとブレーキの繊細なコントロールが必要。',
    tags: ['雨', 'ウェット', '上級'],
    width: 16, // 以前は 13
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
  {
    id: 'frostpeak',
    // ショートカット（a: 分岐、b: 合流の位置の割合、side: 1 左 / -1 右）。距離は短いが路面が悪い
    shortcuts: [{ a: 0.274, b: 0.498, side: -1, surface: 'snow' }],
    // タイムアタックの目標（1・2周目の合計・秒）: 金・銀・銅
    medals: [166.0, 175.0, 182.5],
    name: 'フロストピーク・サーキット',
    en: 'FROSTPEAK CIRCUIT',
    desc: '雪山の小さな周回コース。冷えた路面はグリップが低く、コース外は雪。下りのヘアピンでブレーキを残しすぎると曲がれない。',
    tags: ['雪', '低グリップ', '上級'],
    width: 15, // 以前は 12
    runoff: 8,
    grip: 0.84,
    scenery: 'alpine',
    env: { time: 'snow', sunElev: 16, sunAzim: 120, fog: 0.0032, exposure: 0.62 },
    points: poly([
      [-250, 0, 40, 0], [300, 0, 45, 3], [420, 140, 30, 8], [300, 300, 55, 14], [420, 460, 25, 20], [200, 520, 35, 22],
      [60, 380, 60, 18], [-120, 500, 28, 14], [-300, 360, 45, 9], [-200, 200, 30, 5], [-380, 120, 50, 2],
    ]),
  },
  // ---- セクションコース（スタートとゴールが別の場所。1本走り切ってゴール） ----
  // 内部ではループとして作り、ゴールより先（戻り道）は作らない。stage = 全周に対するゴール位置の割合
  {
    id: 'grandtour',
    // ショートカット（a: 分岐、b: 合流の位置の割合、side: 1 左 / -1 右）。距離は短いが路面が悪い
    shortcuts: [{ a: 0.124, b: 0.229, side: -1, surface: 'gravel' }],
    // ジャンプ台（at: 先端の位置の割合、gap: 飛び越える谷の長さ m）
    jumps: [{ at: 0.349, len: 26, h: 2.3, gap: 30 }],
    // タイムアタックの目標（スタートからゴールまで・秒）: 金・銀・銅
    medals: [113.0, 119.0, 125.0],
    name: 'グランツアー・パス',
    en: 'GRAND TOUR PASS',
    desc: '港町をスタートし、牧草地、森の峠を抜けて雪の山頂でゴールするセクションコース。標高差130m。景色も路面の外側も区間ごとに変わる。',
    tags: ['セクション', '港町→森→雪山', '中級'],
    width: 15, // 以前は 12
    runoff: 8,
    grip: 1.0,
    scenery: 'country',
    terrainAmp: 30,
    zones: [[0, 0.18, 'city'], [0.18, 0.47, 'country'], [0.47, 0.72, 'forest'], [0.72, 1.01, 'alpine']],
    env: { time: 'morning', sunElev: 22, sunAzim: 110, fog: 0.0018, exposure: 0.6 },
    points: poly([
      [-400, 0, 50, 0], [600, 0, 60, 2], [820, 160, 45, 5], [700, 380, 70, 10], [950, 560, 120, 18], [1350, 520, 80, 26],
      [1550, 760, 40, 36], [1400, 980, 30, 48], [1650, 1120, 55, 60], [1500, 1350, 25, 74], [1750, 1500, 60, 88],
      [2050, 1420, 90, 100], [2250, 1650, 35, 112], [2050, 1850, 70, 122], [2300, 2050, 120, 130],
      // ここから先は戻り道（作らない）
      [2700, 2300, 200, 120], [3000, 1200, 300, 70], [2500, -500, 300, 20], [-500, -600, 200, 0],
    ]),
    stage: 0.369,
  },
  {
    id: 'canyon',
    // ショートカット（a: 分岐、b: 合流の位置の割合、side: 1 左 / -1 右）。距離は短いが路面が悪い
    shortcuts: [{ a: 0.332, b: 0.465, side: 1, surface: 'dirt' }],
    // ジャンプ台（at: 先端の位置の割合、gap: 飛び越える谷の長さ m）
    jumps: [{ at: 0.277, len: 30, h: 2.4 }, { at: 0.661, len: 26, h: 2.4, gap: 34 }],
    // タイムアタックの目標（スタートからゴールまで・秒）: 金・銀・銅
    medals: [99.5, 104.5, 110.5],
    name: 'レッドキャニオン・ラン',
    en: 'RED CANYON RUN',
    desc: '夕暮れの砂漠から岩山の峡谷へ。超高速の直線のあと、谷底のタイトなつづら折りを抜け、再び砂漠を全開で駆け抜けるセクションコース。',
    tags: ['セクション', '砂漠→峡谷→砂漠', '上級'],
    width: 16, // 以前は 13
    runoff: 10,
    grip: 0.97,
    scenery: 'desert',
    terrainAmp: 34,
    zones: [[0, 0.33, 'desert'], [0.33, 0.72, 'mountain'], [0.72, 1.01, 'desert']],
    env: { time: 'dusk', sunElev: 6, sunAzim: 250, fog: 0.0014, exposure: 0.62 },
    points: poly([
      [-300, 0, 60, 0], [700, 0, 80, 0], [1100, 200, 150, 4], [1200, 600, 60, 10], [1000, 800, 35, 16], [1250, 1000, 45, 22],
      [1100, 1250, 28, 30], [1350, 1400, 90, 34], [1800, 1350, 140, 30], [2100, 1600, 50, 24], [2000, 1900, 70, 18],
      [2400, 2100, 200, 12],
      // ここから先は戻り道（作らない）
      [2900, 2000, 250, 8], [2900, 600, 300, 4], [2000, -600, 300, 2], [-600, -600, 200, 0],
    ]),
    stage: 0.371,
  },
];
