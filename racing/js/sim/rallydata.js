// ラリーのステージ定義。一本道（スタート → ゴール）で、路面が途中で変わる。
// 内部ではループとして作り、ゴールより先の道は作らない（Track の def.stage = 全周に対するゴール位置の割合）
import { poly } from './trackdata.js';
import { mulberry32 } from './ai.js';

// 星形のループ（自己交差しない）。radii は各コーナーの半径の候補
function twisty(seed, { n, R, rx = 1, rz = 1, jitter = 0.3, radii, ampY = 20, h3 = 0, phase = 0 }) {
  const rng = mulberry32(seed);
  const out = [];
  for (let k = 0; k < n; k++) {
    const a = (2 * Math.PI * k) / n + (rng() - 0.5) * 0.16;
    const rr = R * (1 + (rng() - 0.5) * 2 * jitter);
    const x = Math.cos(a) * rr * rx, z = Math.sin(a) * rr * rz;
    const radius = radii[Math.floor(rng() * radii.length)];
    const y = ampY * (Math.sin(a + phase) + 0.45 * Math.sin(2 * a + phase * 2.3) + h3 * Math.sin(5 * a + phase));
    out.push([x, z, radius, y]);
  }
  return out;
}

export const RALLY_STAGES = [
  {
    id: 'alpen',
    kind: 'rally',
    name: 'アルペン・スノー ステージ',
    en: 'ALPEN SNOW STAGE',
    desc: '雪の山岳路。乾いた舗装から圧雪、凍結路へと路面が変わる。路面ごとのグリップ差を読んで走る、冬のラリーの名物ステージ。',
    tags: ['雪', '舗装→圧雪→凍結', '上級'],
    width: 7.6,
    runoff: 3.2,
    grip: 1,
    curbs: false,
    scenery: 'alpine',
    env: { time: 'snow', sunElev: 14, sunAzim: 95, fog: 0.0034, exposure: 0.62 },
    stage: 0.9,
    surfaces: [[0, 0.22, 'tarmac'], [0.22, 0.52, 'snow'], [0.52, 0.62, 'ice'], [0.62, 0.84, 'snow'], [0.84, 1, 'tarmac']],
    points: poly(twisty(11, { n: 26, R: 560, rx: 1.15, rz: 0.85, jitter: 0.34, radii: [16, 22, 30, 42, 60, 90], ampY: 34, phase: 0.6 })),
  },
  {
    id: 'nordic',
    kind: 'rally',
    name: 'ノルディック・クレスト ステージ',
    en: 'NORDIC CREST STAGE',
    desc: '北欧の森を抜ける超高速のグラベル。うねる路面と長い高速コーナーが続き、思い切りのよいライン取りが問われる。',
    tags: ['砂利', '高速', '中級'],
    width: 8.4,
    runoff: 3.4,
    grip: 1,
    curbs: false,
    scenery: 'forest',
    env: { time: 'day', sunElev: 32, sunAzim: 150, fog: 0.0022, exposure: 0.6 },
    stage: 0.9,
    surfaces: [[0, 0.4, 'gravel'], [0.4, 0.55, 'dirt'], [0.55, 1, 'gravel']],
    points: poly(twisty(23, { n: 22, R: 640, rx: 1.0, rz: 1.0, jitter: 0.28, radii: [34, 48, 64, 90, 120, 150], ampY: 18, h3: 0.35, phase: 1.7 })),
  },
  {
    id: 'savanna',
    kind: 'rally',
    name: 'サバンナ・ダスト ステージ',
    en: 'SAVANNA DUST STAGE',
    desc: '赤土の大地を駆け抜ける砂塵のステージ。道幅は広いが、深い砂と土でテールが流れやすく、前走車の巻き上げる砂煙も視界を奪う。',
    tags: ['砂・土', '砂塵', '初級'],
    width: 10,
    runoff: 5,
    grip: 1,
    curbs: false,
    scenery: 'desert',
    env: { time: 'hot', sunElev: 34, sunAzim: 230, fog: 0.0018, exposure: 0.58 },
    stage: 0.9,
    surfaces: [[0, 0.3, 'dirt'], [0.3, 0.62, 'sand'], [0.62, 1, 'dirt']],
    points: poly(twisty(37, { n: 20, R: 680, rx: 1.25, rz: 0.8, jitter: 0.25, radii: [45, 60, 80, 110, 150], ampY: 8, phase: 2.4 })),
  },
];
