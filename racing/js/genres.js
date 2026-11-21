// ジャンル（GT・ラリー・ロードバイク）の一覧。メニューとゲーム起動はここを通る。
import { TRACKS } from './sim/trackdata.js';
import { Track } from './sim/track.js';
import { DIFFICULTY, calibrate } from './sim/race.js';
import { CircuitGame } from './game/circuit.js';
import { RALLY_STAGES } from './sim/rallydata.js';
import { calibrateStage, paceNotes } from './sim/rally.js';
import { RallyGame } from './game/rally.js';
import { BIKE_COURSES } from './sim/bikedata.js';
import { BikeGame } from './game/bike.js';
import { store } from './store.js';
import { fmt } from './game/common.js';
import { MEDALS, medalOf } from './garage.js';

const trackCache = {};
function track(def) {
  if (!trackCache[def.id]) trackCache[def.id] = new Track(def);
  return trackCache[def.id];
}

// タイムアタックの記録とメダル（コースカード用）
function taRec(def) {
  const rec = store.get('ta12.' + def.id, null);
  const t = rec ? rec.time : Infinity;
  const m = medalOf(t, def.medals);
  const icon = m >= 0 ? `<i class="medal m${m}"></i>` : '';
  const goal = def.medals ? ` · 金 ${fmt(def.medals[0])}` : '';
  return `${icon}ベスト ${isFinite(t) ? fmt(t) : '--:--.---'}${goal}`;
}

export const GENRES = [
  {
    id: 'gt',
    name: 'GTレース',
    short: 'GT',
    events: TRACKS,
    hasMode: true, // レース / タイムアタック
    laps: [2, 3, 5],
    defaultLaps: 3,
    makeTrack: track,
    mapOpts: (def, tr) => (tr.stageEnd ? { range: [0, tr.stageN] } : {}),
    meta: (def, tr, s) => ({
      sub: tr.stageEnd ? `${def.en} · セクション ${((tr.stageEnd - 130) / 1000).toFixed(2)} km` : `${def.en} · 1周 ${(tr.length / 1000).toFixed(2)} km`,
      rec: s.mode === 'ta'
        ? taRec(def)
        : `最高順位 ${store.get('rank.' + def.id + '.' + s.difficulty, null) ? store.get('rank.' + def.id + '.' + s.difficulty, null) + '位' : '—'}（${DIFFICULTY[s.difficulty].label}）`,
    }),
    hint: (s) => (s.mode === 'race'
      ? '周回コースは最後尾、セクションコース（スタートとゴールが別）は5番手からスタート。CPU 7台を抜いて優勝を目指そう。'
      : 'ひとりで走る。周回コースは1・2周目の合計、セクションコースはゴールまでのタイムが記録。自己ベストの走りがゴーストになる。'),
    tips: [
      'ハンドルを切りながらブレーキを押すとドリフト。押している間ターボが溜まり、離すと加速する。',
      'コーナーの手前の 150 / 100 / 50 の看板がブレーキの目安。',
      'アウト・イン・アウト。コーナーの出口でアクセルを早く踏めるラインを。',
      '芝や砂に出ると大きく失速する。縁石まではセーフ。',
      'ブレーキはまっすぐのうちに。曲がりながらの強いブレーキはアンダーステアの元。',
      'アシストOFFでは自分でアクセルを調整しないと後輪が滑る。',
      'CPU にはそれぞれ得意・不得意なコーナーがある。抜きどころを探そう。',
    ],
    prepare: (tr) => calibrate(tr),
    create: (tr, opts) => new CircuitGame(tr, opts),
  },
  {
    id: 'rally',
    name: 'ラリー',
    short: 'ラリー',
    events: RALLY_STAGES,
    hasMode: false,
    laps: null,
    defaultLaps: 1,
    makeTrack: track,
    mapOpts: (def, tr) => ({ range: [0, tr.stageN] }),
    meta: (def, tr, s) => {
      const best = store.get('rec.' + def.id, null);
      const rank = store.get('rank.' + def.id + '.' + s.difficulty, null);
      return {
        sub: `${def.en} · ${(tr.stageEnd / 1000).toFixed(1)} km`,
        rec: `ベスト ${best ? fmt(best.time) : '--:--.---'} / 最高 ${rank ? rank + '位' : '—'}（${DIFFICULTY[s.difficulty].label}）`,
      };
    },
    hint: () => 'ひとりでステージを走り、ライバルたちのタイムと競う。ペースノート（左の矢印と数字）を見て、路面の変化に備えよう。',
    tips: [
      'ペースノートの数字が小さいほどきついコーナー。1 はヘアピン、6 はほぼ直線。',
      '雪や砂利ではブレーキを早めに、ハンドルは丁寧に。無理に曲げるとかえって外へ膨らむ。',
      '凍結路面はほとんどグリップしない。手前で十分に減速しておこう。',
      '壁に当たると大きく失速する。攻めすぎたら一度立て直そう。',
      '画面右上の「TOP」の差で、トップのライバルより速いか遅いかが分かる。',
    ],
    prepare: (tr) => { calibrateStage(tr); paceNotes(tr); },
    create: (tr, opts) => new RallyGame(tr, opts),
  },
  {
    id: 'bike',
    name: 'ロードバイク',
    short: 'バイク',
    events: BIKE_COURSES,
    hasMode: false,
    laps: [1, 2, 3],
    defaultLaps: 1,
    makeTrack: track,
    mapOpts: () => ({}),
    meta: (def, tr, s) => {
      const rank = store.get('rank.' + def.id + '.' + s.difficulty, null);
      let up = 0;
      for (let i = 0; i < tr.N; i++) up += Math.max(0, tr.y[(i + 1) % tr.N] - tr.y[i]);
      return {
        sub: `${def.en} · ${(tr.length / 1000).toFixed(1)} km${up > 10 ? ` · 登り ${Math.round(up)} m` : ''}`,
        rec: `最高 ${rank ? rank + '位' : '—'}（${DIFFICULTY[s.difficulty].label}）`,
      };
    },
    hint: () => '8人の集団で走るロードレース。「全力」で速くなるがスタミナを使う。前の選手の真後ろ（スリップストリーム）で脚を貯め、最後のスプリントで勝負。',
    tips: [
      '前の選手の真後ろに付くと空気抵抗が減り、少ない力で付いていける（DRAFT 表示）。',
      'スタミナを使い切ると「脚が売り切れ」。しばらく力が出ない。',
      'ゴール前 500m からの全力スプリントが勝負どころ。それまで脚を貯めよう。',
      '下りのヘアピンでは手前でブレーキ。速すぎるとスリップして大きく失速する。',
      '石畳は転がりが重く滑りやすい。集団の後ろで耐えるのも作戦。',
      '首位の選手は黄色いジャージを着る。',
    ],
    create: (tr, opts) => new BikeGame(tr, opts),
  },
];

export const genreOf = (id) => GENRES.find((g) => g.id === id) || GENRES[0];
