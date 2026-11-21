// ロードバイクのコース（グラン・ツール風のステージ）
import { poly } from './trackdata.js';

export const BIKE_COURSES = [
  {
    id: 'boulevard',
    kind: 'bike',
    name: 'グラン・ブールヴァール 最終ステージ',
    en: 'GRAND BOULEVARD FINALE',
    desc: '三週間の旅を締めくくる、都の大通りの周回コース。平坦で、最後は大集団のゴールスプリント。脚をどこまで温存できるかが勝負。',
    tags: ['平坦', 'スプリント', '初級'],
    width: 10, runoff: 1.2, grip: 1, curbs: false, scenery: 'city',
    env: { time: 'dusk', sunElev: 8, sunAzim: 250, fog: 0.0012, exposure: 0.62 },
    points: poly([[-470, 0, 18], [470, 0, 22], [490, 95, 22], [-450, 100, 18]]),
  },
  {
    id: 'alpe',
    kind: 'bike',
    name: 'アルプ・ヘアピン 山岳ステージ',
    en: 'ALPE HAIRPINS',
    desc: '山頂ゴールの名物ステージ。下りで勢いをつけ、つづら折りのヘアピンが続く急坂を登り返す。登りでのアタックと、下りのブレーキングが鍵。',
    tags: ['山岳', 'ヘアピン', '上級'],
    width: 8, runoff: 1.2, grip: 1, curbs: false, scenery: 'mountain',
    env: { time: 'day', sunElev: 48, sunAzim: 140, fog: 0.0016, exposure: 0.6 },
    points: poly([
      [-60, 0, 20, 58], [60, 0, 30, 58], [300, 60, 60, 48], [520, 40, 80, 33], [640, 160, 60, 18], [560, 300, 50, 4],
      [420, 330, 14, 8], [360, 250, 14, 15], [260, 320, 14, 22], [200, 230, 14, 29], [110, 300, 14, 36], [50, 210, 14, 43],
      [-40, 260, 14, 50], [-110, 160, 20, 55],
    ]),
  },
  {
    id: 'pave',
    kind: 'bike',
    name: 'ノール・パヴェ クラシック',
    en: 'NORD PAVE CLASSIC',
    desc: '北の平原を走る石畳のクラシックレース。ガタガタの石畳区間は転がりが重く、グリップも低い。集団の位置取りと体力配分が試される。',
    tags: ['石畳', '平坦', '中級'],
    width: 7.5, runoff: 1.2, grip: 1, curbs: false, scenery: 'country',
    env: { time: 'rain', sunElev: 28, sunAzim: 160, fog: 0.0034, exposure: 0.52 },
    surfaces: [[0.12, 0.3, 'cobble'], [0.45, 0.6, 'cobble'], [0.74, 0.88, 'cobble']],
    points: poly([[-500, 0, 30], [400, 0, 25], [520, 260, 40], [100, 320, 35], [-300, 420, 30], [-560, 220, 30]]),
  },
];
