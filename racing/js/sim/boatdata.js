// ボートレース（競艇）の水面コース。艇は左回り（反時計回り）に周回し、インコース（内側）が有利。
import { poly } from './trackdata.js';
import { BOAT_TRACK_SPEC } from './boat.js';

// 角丸の長方形（スタジアム型）。左回りになるよう頂点の順序をそろえる
function pond(L, W, R) {
  const v = [[-L / 2, W / 2, R], [L / 2, W / 2, R], [L / 2, -W / 2, R], [-L / 2, -W / 2, R]];
  return poly(v, 4);
}

export const BOAT_COURSES = [
  {
    id: 'bay',
    kind: 'boat',
    name: 'ベイエリア・グランプリ水面',
    en: 'BAY GRAND PRIX',
    desc: '港湾都市の海水面に作られた、年末の大一番を想わせる広い水面。夜の照明の下、第1ターンマークの攻防が勝負を決める。',
    tags: ['夜', '海水面', '初級'],
    width: 30, runoff: 5, grip: 1, curbs: false, scenery: 'bay', spec: BOAT_TRACK_SPEC, lineLimit: 17.5,
    env: { time: 'night', sunElev: -8, sunAzim: 200, fog: 0.0016, exposure: 0.95 },
    water: { color: 0x0a2a3c, wave: 0.5 },
    points: pond(340, 100, 48),
  },
  {
    id: 'river',
    kind: 'boat',
    name: 'リバーサイド・ナローコース',
    en: 'RIVERSIDE NARROW',
    desc: '川沿いに造られた狭い水面。直線が短く、ターンマークが次々に迫る。スタート直後の1マークで前に出られるかが鍵。',
    tags: ['昼', '淡水', '中級'],
    width: 24, runoff: 4, grip: 1, curbs: false, scenery: 'river', spec: BOAT_TRACK_SPEC, lineLimit: 13.5,
    env: { time: 'day', sunElev: 42, sunAzim: 130, fog: 0.0012, exposure: 0.62 },
    water: { color: 0x2f5b4a, wave: 0.35 },
    points: pond(300, 80, 38),
  },
  {
    id: 'tide',
    kind: 'boat',
    name: 'うず潮・ツイスト水面',
    en: 'WHIRLPOOL TIDE',
    desc: '潮の流れが強い外洋の水面。うねりと潮流で艇が横へ流され、一定のラインを保つのが難しい。夕焼けの中の荒れた水面。',
    tags: ['夕方', '潮流', '上級'],
    width: 28, runoff: 5, grip: 1, curbs: false, scenery: 'tide', spec: BOAT_TRACK_SPEC, lineLimit: 16.5, current: 1.5,
    env: { time: 'dusk', sunElev: 5, sunAzim: 250, fog: 0.0015, exposure: 0.62 },
    water: { color: 0x123a55, wave: 1.1 },
    points: pond(360, 96, 46),
  },
];
