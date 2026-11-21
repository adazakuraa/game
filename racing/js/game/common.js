// 各モードのゲームクラスが共有するもの（ DOM ヘルパー、実行時の共有オブジェクト、ミニマップ描画）
export const $ = (s) => document.querySelector(s);
export const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

// main.js が起動時に renderer / camera / input / audio などを入れる
export const C = {
  renderer: null,
  camera: null,
  input: null,
  audio: null,
  applyQuality: () => {},
  game: () => null,
};

export function fmt(t) {
  if (!isFinite(t) || t <= 0) return '--:--.---';
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}

// コースを真上から見た図。opts.range = [開始 index, 終了 index] で一部だけ（一本道のステージ用）
export function drawTrackMap(cv, track, opts = {}) {
  const ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  ctx.clearRect(0, 0, W, H);
  const [i0, i1] = opts.range || [0, track.N];
  const open = !!opts.range;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = i0; i <= i1; i++) {
    const j = i % track.N;
    minX = Math.min(minX, track.x[j]); maxX = Math.max(maxX, track.x[j]);
    minZ = Math.min(minZ, track.z[j]); maxZ = Math.max(maxZ, track.z[j]);
  }
  const pad = opts.pad ?? 10;
  const sc = Math.min((W - pad * 2) / (maxX - minX || 1), (H - pad * 2) / (maxZ - minZ || 1));
  const ox = W / 2 - ((minX + maxX) / 2) * sc, oz = H / 2 - ((minZ + maxZ) / 2) * sc;
  // 真上から見た向き（x は右、z は下。3D ビューの左右と一致する）
  const P = (x, z) => [ox + x * sc, oz + z * sc];
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const path = () => {
    ctx.beginPath();
    for (let i = i0; i <= i1; i += 2) {
      const j = i % track.N;
      const [a, b] = P(track.x[j], track.z[j]);
      if (i === i0) ctx.moveTo(a, b); else ctx.lineTo(a, b);
    }
    if (open) {
      const j = i1 % track.N;
      const [a, b] = P(track.x[j], track.z[j]);
      ctx.lineTo(a, b);
    } else ctx.closePath();
  };
  ctx.strokeStyle = opts.edge ?? 'rgba(0,0,0,0.6)';
  ctx.lineWidth = (opts.w ?? 4) + 3;
  path(); ctx.stroke();
  ctx.strokeStyle = opts.color ?? '#e9edf2';
  ctx.lineWidth = opts.w ?? 4;
  path(); ctx.stroke();
  // ショートカット（点線）
  for (const sc of track.shortcuts || []) {
    ctx.save();
    ctx.setLineDash([Math.max(3, (opts.w ?? 4)), Math.max(3, (opts.w ?? 4))]);
    ctx.strokeStyle = 'rgba(255,170,60,0.95)';
    ctx.lineWidth = Math.max(2, (opts.w ?? 4) * 0.6);
    ctx.beginPath();
    for (let i = 0; i <= sc.stageN; i += 2) { const [a, b] = P(sc.x[i], sc.z[i]); if (i === 0) ctx.moveTo(a, b); else ctx.lineTo(a, b); }
    ctx.stroke();
    ctx.restore();
  }
  const [sx, sy] = P(track.x[i0 % track.N], track.z[i0 % track.N]);
  ctx.fillStyle = '#ff3b2f';
  ctx.fillRect(sx - 3, sy - 3, 6, 6);
  if (open) {
    const [fx, fy] = P(track.x[i1 % track.N], track.z[i1 % track.N]);
    ctx.fillStyle = '#3ddc84';
    ctx.fillRect(fx - 3, fy - 3, 6, 6);
  }
  return P;
}
