// ラリー: 一本道のステージをタイムで競う。ライバルは「走った時間」だけが記録として存在する（実際の車は走らない）
import { Car } from './car.js';
import { Recovery } from './recovery.js';
import { BotDriver } from './bot.js';
import { DRIVERS } from './race.js';

export const RALLY_DIFF = {
  easy: { factor: 1.14, spread: 0.014 },
  normal: { factor: 1.06, spread: 0.01 },
  hard: { factor: 1.02, spread: 0.007 }, // GT の「むずかしい」（金メダル並み）と同じくらいの手ごたえ
};

const wrapDelta = (d, L) => (d > L / 2 ? d - L : d < -L / 2 ? d + L : d);

// 上手なドライバー（自動操縦）でステージを走り、基準タイムと「各地点までの経過時間」を記録する
export function calibrateStage(track) {
  if (track.stageCalib) return track.stageCalib;
  const dt = 1 / 120;
  const L = track.length, end = track.stageEnd;
  const car = new Car(track);
  car.assist = true;
  car.reset(0, track.sampleArr(track.line, 0));
  const bot = new BotDriver(car, track, 1.0);
  const timeAt = new Float32Array(track.stageN + 2).fill(NaN);
  let t = 0, prog = 0, prev = car.s;
  const step = track.ds;
  while (t < 600 && prog < end) {
    car.step(dt, bot.update());
    t += dt;
    prog += wrapDelta(car.s - prev, L);
    prev = car.s;
    const i = Math.floor(prog / step);
    if (i >= 0 && i < timeAt.length && Number.isNaN(timeAt[i])) timeAt[i] = t;
  }
  // 欠けたところは線形補間
  let last = 0, lastT = 0;
  for (let i = 0; i < timeAt.length; i++) {
    if (!Number.isNaN(timeAt[i])) {
      for (let j = last + 1; j < i; j++) timeAt[j] = lastT + ((timeAt[i] - lastT) * (j - last)) / (i - last);
      last = i; lastT = timeAt[i];
    }
  }
  for (let j = last + 1; j < timeAt.length; j++) timeAt[j] = lastT;
  track.stageCalib = { time: t, timeAt };
  return track.stageCalib;
}

// ペースノート: 曲率からコーナーを拾う。severity は 1（ヘアピン）〜 6（ほぼ直線）
export function paceNotes(track) {
  if (track.paceNotes) return track.paceNotes;
  const ds = track.ds, end = track.stageEnd;
  const notes = [];
  let i = 0;
  const lim = Math.floor(end / ds);
  while (i < lim) {
    const k = track.kappa[i];
    if (Math.abs(k) > 1 / 170) {
      const sign = Math.sign(k);
      let j = i, minR = 1e9, ang = 0;
      while (j < lim && Math.abs(track.kappa[j]) > 1 / 260 && Math.sign(track.kappa[j]) === sign) {
        minR = Math.min(minR, 1 / Math.abs(track.kappa[j]));
        ang += Math.abs(track.kappa[j]) * ds;
        j++;
      }
      if (ang > 0.25) {
        const sev = minR < 20 ? 1 : minR < 32 ? 2 : minR < 50 ? 3 : minR < 80 ? 4 : minR < 120 ? 5 : 6;
        notes.push({ s: i * ds, len: (j - i) * ds, dir: sign > 0 ? 'L' : 'R', sev, radius: minR, angle: ang });
      }
      i = Math.max(j, i + 1);
    } else i++;
  }
  // 近すぎる同方向の連続は「S字」などにまとめず、そのまま並べる（間隔が詰まって見えるのは実際にそう）
  track.paceNotes = notes;
  return notes;
}

export class RallyRun {
  constructor(track, opts) {
    this.track = track;
    this.opts = opts;
    this.end = track.stageEnd;
    const cal = calibrateStage(track);
    this.cal = cal;
    const diff = RALLY_DIFF[opts.difficulty] || RALLY_DIFF.normal;
    this.leaderTime = cal.time * diff.factor;
    this.rivals = DRIVERS.map((d, i) => ({ name: d.name, color: d.color, num: d.num, time: this.leaderTime * (1 + i * diff.spread + ((i * 37) % 7) * 0.0012) }));
    const car = new Car(track, opts.spec || undefined);
    car.assist = opts.assist;
    car.reset(0, 0);
    this.car = car;
    this.player = { kind: 'player', name: 'YOU', color: opts.playerColor, num: 1, car };
    this.state = 'countdown'; // countdown -> racing -> finishing -> done
    this.cd = 0;
    this.time = 0; // GO からの経過
    this.progress = 0;
    this.prevS = car.s;
    this.events = [];
    this.finishTime = 0;
    this.splits = [];
    this.nextSplit = 0;
    this.bot = null;
    this.stopT = 0;
    this.lastTick = 4;
    this.notes = paceNotes(track);
  }

  // 現在の進行距離でのライバルの時間（基準タイムを同じ割合で配分）
  rivalTimeAt(i, p) {
    const idx = Math.max(0, Math.min(this.cal.timeAt.length - 1, Math.floor(p / this.track.ds)));
    return this.rivals[i].time * (this.cal.timeAt[idx] / this.cal.time);
  }
  leaderAt(p) { return this.rivalTimeAt(0, p); }

  // 暫定順位（今の地点で、ライバルより早い／遅い）
  provisionalRank() {
    let r = 1;
    for (let i = 0; i < this.rivals.length; i++) if (this.rivalTimeAt(i, this.progress) < this.time) r++;
    return r;
  }

  step(dt, input) {
    this.events.length = 0;
    const c = this.car;
    if (this.state === 'countdown') {
      this.cd += dt;
      const left = Math.ceil(3 - this.cd);
      if (left !== this.lastTick && left >= 1 && left <= 3) { this.lastTick = left; this.events.push({ type: 'tick', n: left }); }
      // スタート前は回転数だけ上げられる
      c.rpm += ((1100 + input.throttle * 6000) - c.rpm) * Math.min(1, dt * 6);
      c.throttle = input.throttle;
      if (this.cd >= 3) { this.state = 'racing'; this.time = 0; this.events.push({ type: 'go' }); }
      return;
    }
    let inp = input;
    if (this.state !== 'racing') {
      if (!this.bot) this.bot = new BotDriver(c, this.track, 0);
      inp = this.bot.update();
      inp.throttle = 0;
      inp.brake = 1;
    }
    c.step(dt, inp);
    if (c.impact > 2) this.events.push({ type: 'wall', power: c.impact });
    if (this.state === 'racing') {
      this.recovery ??= new Recovery(this.track);
      const rv = this.recovery.update(dt, c, inp);
      if (rv) this.events.push({ type: rv });
    }
    this.progress += wrapDelta(c.s - this.prevS, this.track.length);
    this.prevS = c.s;
    if (this.state === 'racing') {
      this.time += dt;
      const frac = this.progress / this.end;
      while (this.nextSplit < 3 && frac >= (this.nextSplit + 1) / 4) {
        const delta = this.time - this.leaderAt(this.progress);
        this.splits.push(delta);
        this.events.push({ type: 'split', n: this.nextSplit + 1, delta });
        this.nextSplit++;
      }
      if (this.progress >= this.end) {
        this.state = 'finishing';
        this.finishTime = this.time;
        this.events.push({ type: 'finish', time: this.time, rank: this.rankFor(this.time) });
      }
    } else if (this.state === 'finishing') {
      if (c.speed < 0.6) this.stopT += dt; else this.stopT = 0;
      this.finishT = (this.finishT || 0) + dt;
      if (this.stopT > 1.2 || this.finishT > 14) this.state = 'done';
    }
  }

  rankFor(t) {
    let r = 1;
    for (const rv of this.rivals) if (rv.time < t) r++;
    return r;
  }

  results() {
    const rows = this.rivals.map((r) => ({ kind: 'ai', name: r.name, color: r.color, time: r.time }));
    rows.push({ kind: 'player', name: 'YOU', color: this.player.color, time: this.finishTime });
    rows.sort((a, b) => a.time - b.time);
    return rows.map((r, i) => ({ ...r, pos: i + 1 }));
  }
}
