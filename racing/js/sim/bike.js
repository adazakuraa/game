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

const PJ = {};
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
    const p = this.track.pointAt(s, d, {});
    this.x = p.x; this.z = p.z; this.y = p.y;
    this.psi = p.hd;
    this.hint = -1;
    this.k = 0;
    this.slipMeter = 0;
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
      if (gap > 0.4 && gap < 10 && Math.abs(o.d - this.d) < 1.4) draft = Math.min(draft, 0.55 + 0.45 * (gap / 10));
    }
    this.draft += (draft - this.draft) * Math.min(1, dt * 4);
    // パワーとスタミナ
    const brake = Math.max(0, Math.min(1, input.brake || 0));
    const thr = Math.max(0, Math.min(1, input.throttle || 0));
    let P = brake > 0.1 ? 0 : this.pcruise + (this.phard - this.pcruise) * thr;
    // スタミナを使い切ると「脚が売り切れ」: 回復するまで巡航より弱い力しか出せない
    if (this.blown) {
      P = Math.min(P, this.cp * 0.62);
      if (this.W > this.wmax * 0.35) this.blown = false;
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
    // ハンドル: 指の量で曲がる強さ（曲率）を決める。速いほど曲がれる限界は小さく、
    // 限界を超えて切り続けるとスリップして大きく失速する
    const grip = tr.gripArr[i];
    const kMax = 1 / 5.5;
    const kDes = -Math.max(-1, Math.min(1, input.steer || 0)) * kMax;
    const kGrip = (c.mu * G * grip) / Math.max(this.v * this.v, 1);
    const over = (Math.abs(kDes) * this.v * this.v) / (c.mu * G * grip);
    this.over = over;
    if (over > (this.isPlayer && this.assist ? 1.25 : 1.12) && this.v > 5) this.slipMeter += dt;
    else this.slipMeter = Math.max(0, this.slipMeter - dt * 2);
    if (this.slipT > 0) this.slipT -= dt;
    let kT = Math.max(-kGrip, Math.min(kGrip, kDes));
    if (this.slipMeter > 0.3 && this.slipT <= 0) {
      this.slipT = 1.4;
      this.slipMeter = 0;
      this.v *= 0.6;
      this.impact = 4;
      this.slipped = true;
    }
    if (this.slipT > 0) kT *= 0.35;
    // 自転車は傾けてから曲がるので、少し遅れて効く
    this.k += (kT - this.k) * Math.min(1, dt * 5);
    this.psi += this.v * this.k * dt;
    this.x += Math.sin(this.psi) * this.v * dt;
    this.z += Math.cos(this.psi) * this.v * dt;
    // コース上の位置
    const pj = tr.project(this.x, this.z, this.hint, PJ);
    this.hint = pj.i;
    const lim2 = tr.halfW - 0.45;
    if (Math.abs(pj.d) > lim2) {
      // 柵・路肩にぶつかる: 押し戻して減速し、向きを道に沿わせる
      const side = Math.sign(pj.d), over2 = Math.abs(pj.d) - lim2;
      this.x -= pj.lx * over2 * side;
      this.z -= pj.lz * over2 * side;
      let dpsi = pj.hd - this.psi;
      while (dpsi > Math.PI) dpsi -= 2 * Math.PI;
      while (dpsi < -Math.PI) dpsi += 2 * Math.PI;
      this.psi += dpsi * 0.25;
      this.v *= 1 - 1.2 * dt;
      if (!this.onEdge) this.impact = Math.max(this.impact, 1.5);
      this.onEdge = true;
    } else this.onEdge = false;
    const prevS = this.s;
    this.s = pj.s;
    this.d = pj.d;
    this.y = pj.y;
    this.adv = wrapDelta(this.s - prevS, tr.length);
    this.throttle = thr;
    this.braking = brake;
    // ペダル: パワーを出しているときだけ回る
    if (P > 20) this.crank += this.v * dt * 0.95;
    this.lean += (Math.atan((this.v * this.v * this.k) / G) - this.lean) * Math.min(1, dt * 8);
    this.updatePose(dt);
  }

  // 横に押す（選手どうしの接触）
  nudge(dd) {
    const i = this.hint >= 0 ? this.hint : 0;
    this.x += this.track.tz[i] * dd;
    this.z -= this.track.tx[i] * dd;
    this.d += dd;
  }

  updatePose() {
    this.vx = Math.sin(this.psi) * this.v;
    this.vz = Math.cos(this.psi) * this.v;
    this.slopePitch = Math.atan(this.track.sampleArr(this.track.slope, this.s));
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
  let gapAhead = 1e9, gapBehind = 1e9;
  const myProg = race.progress(me);
  for (const o of race.entries) {
    if (o === me) continue;
    const g2 = race.progress(o) - myProg;
    if (g2 > 0 && g2 < gapAhead) gapAhead = g2;
    if (g2 < 0 && -g2 < gapBehind) gapBehind = -g2;
  }
  let thr;
  if (remaining < p.sprintDist && r.W > r.wmax * 0.05) thr = 1; // ゴールスプリント
  else if (gapAhead < 30) {
    // 前の選手の 2.5m 後ろに付く（集団の中で脚を貯める）
    thr = Math.max(0, Math.min(0.85, 0.1 + (gapAhead - 2.5) * 0.12));
    if (slope > 0.03) thr = Math.max(thr, p.climb * 0.6);
  } else if (gapAhead < 1e8) thr = p.chase; // 集団から離れた: 追う
  else thr = gapBehind > 14 ? 0.08 : p.solo; // 先頭: 後続を待ちつつ集団を引く
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
  // 目標点を追いかける（ピュアパシュート）
  const look = 5 + r.v * 0.75;
  const p = tr.pointAt(r.s + look, target, {});
  const dx = p.x - r.x, dz = p.z - r.z;
  const lat = dx * Math.cos(r.psi) - dz * Math.sin(r.psi);
  const d2 = dx * dx + dz * dz;
  let k = (2 * lat) / Math.max(d2, 1);
  const kGrip = (BIKE.mu * G * tr.sampleArr(tr.gripArr, r.s) * 0.95) / Math.max(r.v * r.v, 1);
  k = Math.max(-kGrip, Math.min(kGrip, k));
  out.steer = Math.max(-1, Math.min(1, -k * 5.5));
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
const STRENGTH = { easy: 0.8, normal: 0.915, hard: 0.97 };

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
      solo: 0.25,
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
    pr.isPlayer = true;
    pr.assist = opts.assist !== false;
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
        a.nudge(push); b.nudge(-push);
        // 後ろの選手は少し減速
        const back = dp < 0 ? a : b;
        back.v *= 1 - 0.25 / 120; // 接触でわずかに減速（毎ステップ）
        if (ents[i].kind === 'player' || ents[j].kind === 'player') this.events.push({ type: 'hit', power: 0.5 });
      }
    }
  }
}

export { DIFFICULTY };
