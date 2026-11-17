// ボートレース（競艇）の進行: 6艇、フライングスタート、3周、順位
import { Boat, BOAT_AI } from './boat.js';
import { AICar, mulberry32 } from './ai.js';
import { BotDriver } from './bot.js';
import { RaceBase, DIFFICULTY } from './race.js';

export const START_T = 11; // 大時計がゼロになるまでの秒数（スタートの合図）
export const APPROACH = 175; // 艇がスタートラインの手前から助走を始める距離 (m)
export const FLYING_PENALTY = 6; // フライング（合図前にラインを越える）のペナルティ秒
// 1〜6号艇のカラー（実際の競艇と同じ: 白・黒・赤・青・黄・緑）
export const LANE_COLORS = [0xf2f2f2, 0x15151a, 0xd8201c, 0x1a56c8, 0xffcc00, 0x18a050];
export const BOAT_DRIVERS = ['K. ARATA', 'M. VOSS', 'L. FERRO', 'S. HAYAMI', 'R. OKONJO', 'T. LINDQVIST'];

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// 上手な自動操縦での周回タイムと、CPU 艇のペース基準を測る
export function calibrateBoat(track) {
  if (track.boatCalib) return track.boatCalib;
  const dt = 1 / 120;
  const L = track.length;
  // 自動操縦の速さを少しずつ変えて走り、いちばん速かった周回を「上手な人」の基準にする
  let botLap = Infinity;
  for (const pace of [1.0, 0.96, 0.92]) {
    const boat = new Boat(track);
    boat.reset(L - 300, track.sampleArr(track.line, L - 300), 18);
    const bot = new BotDriver(boat, track, pace);
    let prev = boat.s, t = 0;
    const crosses = [];
    while (t < 300 && crosses.length < 4) {
      boat.step(dt, bot.update());
      t += dt;
      if (prev > L * 0.75 && boat.s < L * 0.25) crosses.push(t);
      prev = boat.s;
    }
    for (let i = 2; i < crosses.length; i++) botLap = Math.min(botLap, crosses[i] - crosses[i - 1]);
  }
  if (!isFinite(botLap)) botLap = track.profileLapTime * 1.15;
  let prev, t;
  const ai = new AICar(track, 1.0, 1, BOAT_AI);
  ai.noise.fill(0);
  ai.lineBias = 0;
  ai.place(L - 300, 0);
  ai.v = 18;
  prev = ai.s; t = 0;
  const ac = [];
  while (t < 300 && ac.length < 3) {
    ai.update(dt, [], 0, true);
    t += dt;
    if (prev > L * 0.75 && ai.s < L * 0.25) ac.push(t);
    prev = ai.s;
  }
  const aiLap = ac.length >= 3 ? ac[2] - ac[1] : track.profileLapTime;
  track.boatCalib = { botLap, aiLap };
  return track.boatCalib;
}

export class BoatRace extends RaceBase {
  constructor(track, opts) {
    super();
    this.track = track;
    this.opts = opts;
    this.mode = 'race';
    this.laps = opts.laps;
    this.time = 0;
    this.raceTime = 0;
    this.state = 'approach'; // approach -> racing -> finished
    this.clock = START_T;
    this.entries = [];
    this.finishOrder = [];
    this.events = [];
    this.collR = 0.75;
    this.collOffs = [-0.9, 0, 0.9];
    this.recording = [];
    const diff = DIFFICULTY[opts.difficulty] || DIFFICULTY.normal;
    const cal = calibrateBoat(track);
    const top = cal.aiLap / (cal.botLap * diff.factor);
    const L = track.length;
    const hw = track.halfW;
    const laneD = (k) => hw - 2.4 - (k - 1) * ((2 * hw - 4.8) / 5);
    this.playerLane = opts.lane || { easy: 1, normal: 3, hard: 5 }[opts.difficulty] || 3;
    const rng = mulberry32(7);
    let ai = 0;
    for (let k = 1; k <= 6; k++) {
      const s0 = L - APPROACH + (k % 2 ? 1 : -1) * 1.2;
      const d0 = laneD(k);
      const base = { lane: k, num: k, color: LANE_COLORS[k - 1], lap: 0, lapStart: 0, laps: [], best: Infinity, finished: false, finishTime: 0, flying: false, startTiming: null, penalty: 0 };
      if (k === this.playerLane) {
        const car = new Boat(track);
        car.reset(s0, d0, 11);
        this.player = { kind: 'player', name: 'YOU', ...base, color: opts.playerColor ?? base.color, laneColor: base.color, car, prevS: car.s };
        this.entries.push(this.player);
      } else {
        const a = new AICar(track, top - ai * diff.spread, 500 + k * 31, BOAT_AI);
        a.place(s0, d0);
        a.v = 11;
        ai++;
        // 合図からのスタートのずれ。ときどき大きく出遅れる艇がいる
        const off = 0.06 + rng() * 0.34 + (k === 6 ? 0.5 : 0);
        this.entries.push({ kind: 'ai', name: BOAT_DRIVERS[k - 1], ...base, ai: a, prevS: a.s, startOffset: off });
      }
    }
    this.bot = null;
  }

  // スタートラインまでの距離（プレイヤー）
  distToLine() {
    const c = this.player.car;
    return this.player.lap === 0 ? this.track.length - c.s : 0;
  }

  step(dt, input) {
    this.time += dt;
    this.events.length = 0;
    this.clock = START_T - this.time;
    if (this.state === 'approach' && this.clock <= 0) {
      this.state = 'racing';
      this.events.push({ type: 'go' });
    }
    this.raceTime = Math.max(0, this.time - START_T);
    const L = this.track.length;
    // プレイヤー
    const p = this.player;
    let inp = input;
    if (p.finished) {
      if (!this.bot) this.bot = new BotDriver(p.car, this.track, 0.6);
      inp = this.bot.update();
    }
    p.car.step(dt, inp);
    if (p.car.impact > 2) this.events.push({ type: 'wall', power: p.car.impact });
    // CPU 艇
    const others = this.entries.map((e) => {
      const o = this.pose(e);
      return { self: e.kind === 'ai' ? e.ai : e.car, progress: this.progress(e), d: o.d, v: e.kind === 'ai' ? e.ai.v : e.car.u, x: o.x, z: o.z };
    });
    for (const e of this.entries) {
      if (e.kind !== 'ai') continue;
      let force = null;
      if (e.lap === 0) {
        // 合図ちょうどにラインを越えるよう、残りの距離と時間から速度を決める
        const D = L - e.ai.s;
        force = clamp(D / Math.max(START_T + e.startOffset - this.time, 0.35), 7, 25);
      }
      e.ai.update(dt, others, this.progress(e), true, force);
    }
    this.collide();
    // 周回
    for (const e of this.entries) {
      const s = this.pose(e).s;
      if (e.prevS > L * 0.75 && s < L * 0.25) {
        e.lap++;
        this.cross(e);
      } else if (e.prevS < L * 0.25 && s > L * 0.75) e.lap--;
      e.prevS = s;
    }
  }

  cross(e) {
    if (e.lap === 1) {
      // 最初にラインを越えた瞬間がスタートのタイミング。合図より前ならフライング
      const timing = this.time - START_T;
      e.startTiming = timing;
      if (timing < 0) { e.flying = true; e.penalty = FLYING_PENALTY; }
      e.lapStart = Math.max(0, this.raceTime);
      this.events.push({ type: 'start', entry: e, timing, flying: e.flying });
      return;
    }
    if (e.lap < 1) return;
    const lt = this.raceTime - e.lapStart;
    e.laps.push(lt);
    const isBest = lt < e.best;
    if (isBest) e.best = lt;
    e.lapStart = this.raceTime;
    if (e.kind === 'player') this.events.push({ type: 'lap', entry: e, time: lt, best: isBest });
    if (e.lap > this.laps && !e.finished) {
      e.finished = true;
      e.finishTime = this.raceTime + e.penalty;
      this.finishOrder.push(e);
      if (e.kind === 'player') {
        this.state = 'finished';
        this.events.push({ type: 'finish', position: this.standings().indexOf(e) + 1 });
      }
    }
  }
}
