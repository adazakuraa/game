// ロードバイク: パワー（W）とスタミナ（W' = 無酸素で使える貯金）で走る。
// 前の選手の真後ろに付くと空気抵抗が減り（スリップストリーム）、少ない力で同じ速さを保てる。
import { RaceBase, DIFFICULTY } from './race.js';
import { mulberry32 } from './ai.js';
import { SURFACE_KINDS } from './track.js';

const G = 9.81;
export const BIKE = {
  mass: 75, // 選手 + 自転車
  CdA: 0.32,
  crr: 0.0045,
  CP: 300, // 限界パワー（これ以下ならスタミナは回復）
  Wmax: 24000, // スタミナ（J）
  Phard: 640, // 全力
  Pcruise: 250, // 巡航
  mu: 0.85, // タイヤのグリップ
  brakeDec: 5.5,
  latSpeed: 3.4,
};

const wrapDelta = (d, L) => (d > L / 2 ? d - L : d < -L / 2 ? d + L : d);

export class Rider {
  constructor(track, strength = 1, seed = 1) {
    this.track = track;
    this.strength = strength;
    this.cp = BIKE.CP * strength;
    this.wmax = BIKE.Wmax * (0.85 + 0.3 * strength - 0.15);
    this.phard = BIKE.Phard * strength;
    this.pcruise = BIKE.Pcruise * strength;
    this.rng = mulberry32(seed);
    this.place(0, 0);
  }

  place(s, d, v = 0) {
    this.s = s; this.d = d; this.v = v;
    this.latV = 0;
    this.W = this.wmax;
    this.blown = false;
    this.power = 0;
    this.draft = 1;
    this.crank = this.rng() * 6;
    this.slipT = 0;
    this.lean = 0;
    this.throttle = 0;
    this.braking = 0;
    this.impact = 0;
    this.updatePose(0);
  }

  get speed() { return this.v; }
  get u() { return this.v; }

  // others: [{ self, prog, d }], myProg: 自分の進行距離
  step(dt, input, others, myProg) {
    const tr = this.track;
    const c = BIKE;
    this.impact = 0;
    // スリップストリーム: 前 0.5〜7m、横 1m 以内に選手がいると空気抵抗が減る
    let draft = 1;
    for (const o of others) {
      if (o.self === this) continue;
      const gap = o.prog - myProg;
      if (gap > 0.4 && gap < 7 && Math.abs(o.d - this.d) < 1.0) draft = Math.min(draft, 0.56 + 0.44 * (gap / 7));
    }
    this.draft += (draft - this.draft) * Math.min(1, dt * 4);
    // パワーとスタミナ
    const brake = Math.max(0, Math.min(1, input.brake || 0));
    const thr = Math.max(0, Math.min(1, input.throttle || 0));
    let P = brake > 0.1 ? 0 : this.pcruise + (this.phard - this.pcruise) * thr;
    // スタミナを使い切ると「脚が売り切れ」: 回復するまで巡航より弱い力しか出せない
    if (this.blown) {
      P = Math.min(P, this.cp * 0.72);
      if (this.W > this.wmax * 0.3) this.blown = false;
    }
    if (P > this.cp) {
      this.W -= (P - this.cp) * dt;
      if (this.W <= 0) { this.W = 0; this.blown = true; }
    } else {
      this.W = Math.min(this.wmax, this.W + (this.cp - P) * 0.6 * dt);
    }
    this.power = P;
    // 力
    const i = Math.floor((((this.s % tr.length) + tr.length) % tr.length) / tr.ds) % tr.N;
    const surf = SURFACE_KINDS[tr.surfArr[i]];
    this.surf = surf;
    const crr = c.crr * (surf === 'cobble' ? 2.8 : 1);
    const slope = tr.slope[i];
    const v = this.v;
    const F = P / Math.max(v, 2.5) - 0.5 * 1.2 * c.CdA * this.draft * v * v - crr * c.mass * G - c.mass * G * Math.sin(Math.atan(slope)) - brake * c.mass * c.brakeDec * (v > 0.3 ? 1 : 0);
    this.v = Math.max(0, v + (F / c.mass) * dt);
    // コーナー: 曲がりきれない速さだと滑って大きく失速する
    const kc = tr.kappa[i];
    const kp = kc / Math.max(0.3, 1 - kc * this.d);
    const lat = this.v * this.v * Math.abs(kp);
    const lim = c.mu * G * tr.gripArr[i];
    if (this.slipT > 0) this.slipT -= dt;
    if (lat > lim && this.slipT <= 0 && this.v > 6) {
      this.slipT = 1.4;
      this.v *= 0.62;
      this.latV -= Math.sign(kp) * 2.5;
      this.impact = 4;
      this.slipped = true;
    }
    // 横移動（ハンドル）
    const target = Math.max(-1, Math.min(1, input.steer || 0)) * -c.latSpeed;
    this.latV += (target - this.latV) * Math.min(1, dt * 6);
    this.d += this.latV * dt;
    const lim2 = tr.halfW - 0.45;
    if (Math.abs(this.d) > lim2) {
      this.d = Math.sign(this.d) * lim2;
      this.latV = 0;
      this.v *= 1 - 0.8 * dt; // 柵や路肩にこすれる
    }
    // 前進
    const adv = (this.v * dt) / Math.max(0.3, 1 - kc * this.d);
    this.s += adv;
    if (this.s >= tr.length) this.s -= tr.length;
    if (this.s < 0) this.s += tr.length;
    this.adv = adv;
    this.throttle = thr;
    this.braking = brake;
    // ペダル: パワーを出しているときだけ回る
    if (P > 20) this.crank += this.v * dt * 0.95;
    this.lean += (Math.atan((this.v * this.v * kp) / G) - this.lean) * Math.min(1, dt * 6);
    this.updatePose(dt);
  }

  updatePose() {
    const tr = this.track;
    const p = tr.pointAt(this.s, this.d, {});
    this.x = p.x; this.y = p.y; this.z = p.z;
    this.psi = p.hd - Math.atan2(this.latV, Math.max(this.v, 3));
    this.vx = Math.sin(this.psi) * this.v;
    this.vz = Math.cos(this.psi) * this.v;
    this.slopePitch = Math.atan(tr.sampleArr(tr.slope, this.s));
  }
}

// 選手の判断（CPU と、テスト用の自動操縦で共通）
export function brain(r, race, me) {
  const tr = race.track;
  const L = tr.length;
  const remaining = race.laps * L - race.progress(me);
  const out = { steer: 0, throttle: 0, brake: 0 };
  // コーナーの手前で減速
  let vlim = 99;
  for (let a = 0; a < 70; a += 4) {
    const k = Math.abs(tr.sampleArr(tr.kappa, r.s + a + r.v * 0.6));
    const g = tr.sampleArr(tr.gripArr, r.s + a);
    if (k > 1e-4) vlim = Math.min(vlim, Math.sqrt((BIKE.mu * G * g * 0.8) / k) + a * 0.12);
  }
  if (r.v > vlim + 0.4) {
    out.brake = Math.min(1, (r.v - vlim) * 0.5);
    return withSteer(out, r, race, me);
  }
  const slope = tr.sampleArr(tr.slope, r.s);
  const p = me.plan;
  // 前の集団との差
  let gapAhead = 1e9;
  const myProg = race.progress(me);
  for (const o of race.entries) {
    if (o === me) continue;
    const g2 = race.progress(o) - myProg;
    if (g2 > 0 && g2 < gapAhead) gapAhead = g2;
  }
  let thr;
  if (remaining < p.sprintDist && r.W > r.wmax * 0.05) thr = 1; // ゴールスプリント
  else if (slope > 0.03) thr = p.climb;
  else if (gapAhead < 6) thr = p.sit; // 集団の中で脚を貯める
  else if (gapAhead < 40) thr = p.chase;
  else thr = p.solo;
  // アタック: 登りで時々ペースを上げる（クライマー）
  if (p.attackT > 0) { p.attackT -= 1 / 120; thr = Math.max(thr, 0.85); }
  else if (slope > 0.05 && p.climber && r.W > r.wmax * 0.6 && race.rng() < 0.0006) p.attackT = 12;
  if (r.W < r.wmax * 0.15 && remaining > p.sprintDist) thr = Math.min(thr, 0.15);
  out.throttle = thr;
  return withSteer(out, r, race, me);
}

function withSteer(out, r, race, me) {
  const tr = race.track;
  const myProg = race.progress(me);
  // 前の選手の真後ろに付く。速くて詰まっているなら横に出る
  let target = tr.sampleArr(tr.line, r.s + 20) * 0.6 + me.plan.offset;
  let best = null, bg = 12;
  for (const o of race.entries) {
    if (o === me) continue;
    const g = race.progress(o) - myProg;
    if (g > 0.5 && g < bg) { bg = g; best = o; }
  }
  if (best) {
    const od = race.pose(best).d;
    target = od;
    if (bg < 2.2 && r.v > race.pose(best).v + 0.3) target = od + (od > 0 ? -1.3 : 1.3);
  }
  const lim = tr.halfW - 0.8;
  target = Math.max(-lim, Math.min(lim, target));
  out.steer = Math.max(-1, Math.min(1, -(target - r.d) * 0.7));
  return out;
}

export const RIDERS = [
  { name: 'P. LEMAIRE', color: 0x1f4fd8, num: 11, type: 'sprinter' },
  { name: 'J. ORTIZ', color: 0xffffff, num: 21, type: 'climber' },
  { name: 'K. ARATA', color: 0x101012, num: 31, type: 'rouleur' },
  { name: 'S. HAYAMI', color: 0xf5b400, num: 41, type: 'climber' },
  { name: 'R. OKONJO', color: 0x18a35a, num: 51, type: 'sprinter' },
  { name: 'T. LINDQVIST', color: 0xe86a12, num: 61, type: 'rouleur' },
  { name: 'A. MORENO', color: 0x7b2fd0, num: 71, type: 'climber' },
];

// CPU の強さ（プレイヤー = 1.0 に対する倍率）
const STRENGTH = { easy: 0.8, normal: 0.935, hard: 0.985 };

export class BikeRace extends RaceBase {
  constructor(track, opts) {
    super();
    this.track = track;
    this.opts = opts;
    this.mode = 'race';
    this.laps = opts.laps;
    this.time = 0;
    this.raceTime = 0;
    this.state = 'countdown';
    this.cd = 0;
    this.entries = [];
    this.finishOrder = [];
    this.events = [];
    this.recording = [];
    this.recT = 0;
    this.rng = mulberry32(99);
    const L = track.length;
    const base = STRENGTH[opts.difficulty] ?? STRENGTH.normal;
    const plan = (type, k) => ({
      sprintDist: type === 'sprinter' ? 380 : type === 'rouleur' ? 650 : 520,
      climb: type === 'climber' ? 0.55 : 0.32,
      sit: 0.05,
      chase: type === 'rouleur' ? 0.55 : 0.4,
      solo: 0.35,
      climber: type === 'climber',
      offset: ((k % 3) - 1) * 0.9,
      attackT: 0,
    });
    // グリッド: 2列。プレイヤーは最後尾
    RIDERS.forEach((d, k) => {
      const str = base * (d.type === 'sprinter' ? 1.0 : 0.985) * (1 - k * 0.004);
      const r = new Rider(track, str, 300 + k * 7);
      // 得意分野: スプリンターは最後の全力が強く、クライマーは登りの限界パワーが高い
      if (d.type === 'sprinter') r.phard *= 1.12;
      if (d.type === 'climber') r.cp *= 1.03;
      r.place(L - 6 - Math.floor(k / 2) * 3, k % 2 ? 1.2 : -1.2);
      this.entries.push({ kind: 'ai', ...d, ai: r, plan: plan(d.type, k), lap: 0, prevS: r.s, lapStart: 0, laps: [], best: Infinity, finished: false, finishTime: 0 });
    });
    const pr = new Rider(track, 1, 1);
    const k = RIDERS.length;
    pr.place(L - 6 - Math.floor(k / 2) * 3, k % 2 ? 1.2 : -1.2);
    this.player = { kind: 'player', name: 'YOU', color: opts.playerColor, num: 1, car: pr, plan: plan('rouleur', 1), lap: 0, prevS: pr.s, lapStart: 0, laps: [], best: Infinity, finished: false, finishTime: 0 };
    this.entries.push(this.player);
  }

  // 自分のペースの目安（ゴールまでの距離など）
  remaining(e) { return this.laps * this.track.length - this.progress(e); }

  step(dt, input) {
    this.time += dt;
    this.events.length = 0;
    if (this.state === 'countdown') {
      this.cd += dt;
      const left = Math.ceil(3 - this.cd);
      if (left !== this.lastTick && left >= 1 && left <= 3) { this.lastTick = left; this.events.push({ type: 'tick', n: left }); }
      if (this.cd >= 3) { this.state = 'racing'; this.raceTime = 0; this.events.push({ type: 'go' }); }
      return;
    }
    this.raceTime += dt;
    const others = this.entries.map((e) => ({ self: this.pose(e), prog: this.progress(e), d: this.pose(e).d }));
    for (const e of this.entries) {
      const r = this.pose(e);
      let inp = e.kind === 'player' && !e.finished && !this.opts.autopilot ? input : brain(r, this, e);
      if (e.finished && e.kind === 'player') inp = { ...inp, throttle: 0 };
      r.slipped = false;
      r.step(dt, inp, others, this.progress(e));
      if (e.kind === 'player' && r.slipped) this.events.push({ type: 'slip' });
      if (e.kind === 'player' && r.impact > 0 && !r.slipped) this.events.push({ type: 'wall', power: r.impact });
    }
    this.collideRiders();
    const L = this.track.length;
    for (const e of this.entries) {
      const s = this.pose(e).s;
      if (e.prevS > L * 0.75 && s < L * 0.25) { e.lap++; this.onCross(e); }
      else if (e.prevS < L * 0.25 && s > L * 0.75) e.lap--;
      e.prevS = s;
    }
  }

  // 選手どうしが重ならないように横へ押し合う
  collideRiders() {
    const ents = this.entries;
    for (let i = 0; i < ents.length; i++) {
      for (let j = i + 1; j < ents.length; j++) {
        const a = this.pose(ents[i]), b = this.pose(ents[j]);
        const dp = wrapDelta(this.progress(ents[i]) - this.progress(ents[j]), 1e9);
        if (Math.abs(dp) > 1.8) continue;
        const dd = a.d - b.d;
        if (Math.abs(dd) > 0.7) continue;
        const push = (0.7 - Math.abs(dd)) * 0.5 * (dd >= 0 ? 1 : -1);
        a.d += push; b.d -= push;
        // 後ろの選手は少し減速
        const back = dp < 0 ? a : b;
        back.v *= 0.995;
        if (ents[i].kind === 'player' || ents[j].kind === 'player') this.events.push({ type: 'hit', power: 0.5 });
      }
    }
  }
}

export { DIFFICULTY };
