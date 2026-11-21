// レース進行: スタート、周回・順位・タイム計測、車同士の接触
import { Car } from './car.js';
import { Track, STAGE_START } from './track.js';
import { AICar, CAR_AI } from './ai.js';
import { poly } from './trackdata.js';
import { Recovery } from './recovery.js';
import { BotDriver } from './bot.js';

// factor: トップ CPU の周回タイム ÷ 上手な自動ドライバーの周回タイム
export const DIFFICULTY = {
  // factor: 上手な自動ドライバーの周回タイムに対する、先頭 CPU の速さ（小さいほど速い）
  easy: { label: 'かんたん', factor: 1.03, spread: 0.008, drift: 0.35, shortcut: 0.3 },
  normal: { label: 'ふつう', factor: 0.99, spread: 0.006, drift: 0.7, shortcut: 0.55 }, // drift: ドリフトターボを使うコーナーの割合
  hard: { label: 'むずかしい', factor: 0.97, spread: 0.004, drift: 0.95, shortcut: 0.8 },
};

// コースごとに「上手なドライバー」の周回タイムと CPU の基準タイムを測る
// CPU の加速を、プレイヤーと同じ車（アクセル全開・TCS あり・ギアチェンジ込み）の実測値に合わせる。
// 長い直線で 0 → 最高速まで走らせ、速度ごとの平均加速度の表を作る（シフトでの息つぎも平均に含まれる）
let accelReady = false;
export function matchAIAccel() {
  if (accelReady) return;
  accelReady = true;
  const tr = new Track({ id: 'accel-test', width: 14, runoff: 10, grip: 1, env: {}, points: poly([[-3500, 0, 150, 0], [3500, 0, 150, 0], [3500, 800, 150, 0], [-3500, 800, 150, 0]]) });
  const car = new Car(tr);
  car.assist = true;
  car.noDrift = true; // 基準の走りはドリフトなし
  car.reset(0, 0);
  const dt = 1 / 120;
  const step = 2; // m/s ごと
  const tAt = []; // 速度 k*step に初めて達した時刻
  let t = 0;
  while (t < 60 && car.s < 3200) {
    car.step(dt, { steer: Math.max(-1, Math.min(1, car.d * 0.08 + car.vl * 0.05)), throttle: 1, brake: 0 });
    t += dt;
    const k = Math.floor(car.u / step);
    for (let j = tAt.length; j <= k; j++) tAt[j] = t;
  }
  const n = tAt.length;
  const table = new Float32Array(n + 1);
  for (let j = 0; j < n - 1; j++) table[j] = step / Math.max(1e-3, tAt[j + 1] - tAt[j]);
  table[n - 1] = table[n - 2] * 0.5;
  table[n] = 0;
  const top = n * step;
  CAR_AI.accelTable = table;
  CAR_AI.accel = (v, grip) => {
    if (v >= top) return -0.5;
    const f = Math.max(0, v) / step, i = Math.floor(f), a = f - i;
    const base = table[i] + (table[Math.min(n, i + 1)] - table[i]) * a;
    return Math.min(base, 9.5 * grip);
  };
}

export function calibrate(track) {
  matchAIAccel();
  if (track.calib) return track.calib;
  if (track.stageEnd) return (track.calib = calibrateSection(track));
  const dt = 1 / 120;
  const car = new Car(track);
  car.assist = true;
  car.noDrift = true; // 基準の走りはドリフトなし
  const L = track.length;
  car.reset(L - 300, track.sampleArr(track.line, L - 300));
  const bot = new BotDriver(car, track, 1.0);
  let prev = car.s, t = 0, crosses = [];
  const trace = new Float32Array(track.N).fill(NaN);
  while (t < 600 && crosses.length < 2) {
    car.step(dt, bot.update());
    t += dt;
    if (prev > L * 0.75 && car.s < L * 0.25) crosses.push(t);
    prev = car.s;
    if (crosses.length === 1) recordTrace(track, trace, car);
  }
  setAIProfile(track, trace, 0, track.N);
  const botLap = crosses.length === 2 ? crosses[1] - crosses[0] : track.profileLapTime * 1.08;
  const ai = new AICar(track, 1.0, 1);
  ai.noise.fill(0);
  ai.lineBias = 0;
  ai.place(L - 300, 0);
  ai.v = 30;
  prev = ai.s; t = 0; crosses = [];
  while (t < 600 && crosses.length < 2) {
    ai.update(dt, [], 0, true);
    t += dt;
    if (prev > L * 0.75 && ai.s < L * 0.25) crosses.push(t);
    prev = ai.s;
  }
  const aiLap = crosses.length === 2 ? crosses[1] - crosses[0] : track.profileLapTime;
  track.calib = { botLap, aiLap };
  return track.calib;
}

export { STAGE_START };
const scProj = {};

// CPU の目標速度: 上手な自動ドライバーが実際の車で走った速度の記録（ブレーキの踏み始め・コーナーの速さが人の走りと同じになる）
function recordTrace(track, trace, car) {
  const i = Math.floor(car.s / track.ds) % track.N;
  trace[i] = car.u;
}
function setAIProfile(track, trace, i0, i1) {
  const N = track.N;
  const out = Float32Array.from(track.profile);
  // 記録のない点は前後から補間
  let last = -1;
  for (let i = i0; i < i1; i++) {
    if (Number.isNaN(trace[i])) continue;
    if (last >= 0 && i - last > 1) for (let k = last + 1; k < i; k++) trace[k] = trace[last] + ((trace[i] - trace[last]) * (k - last)) / (i - last);
    last = i;
  }
  // 少しならす（±2 点）
  for (let i = i0; i < i1; i++) {
    let acc = 0, n = 0;
    for (let o = -2; o <= 2; o++) { const v = trace[(i + o + N) % N]; if (!Number.isNaN(v)) { acc += v; n++; } }
    // 自動ドライバーが壁に当たった所などで記録が乱れても、理想速度から大きく外れないように
    if (n) out[i] = Math.max(track.profile[i] * 0.85, Math.min(track.profile[i] * 1.12, acc / n));
  }
  track.aiProfile = out;
}

// セクションコース: スタートライン（走りながら通過）からゴールまでの時間で、上手な自動ドライバーと CPU を比べる
function calibrateSection(track) {
  const dt = 1 / 120;
  const S0 = STAGE_START, end = track.stageEnd;
  const car = new Car(track);
  car.assist = true;
  car.noDrift = true; // 基準の走りはドリフトなし
  car.reset(10, track.sampleArr(track.line, 10));
  const bot = new BotDriver(car, track, 1.0);
  let t = 0, t0 = null;
  const trace = new Float32Array(track.N).fill(NaN);
  while (t < 900 && car.s < end) {
    car.step(dt, bot.update());
    t += dt;
    if (t0 == null && car.s >= S0) t0 = t;
    recordTrace(track, trace, car);
  }
  setAIProfile(track, trace, Math.round(S0 / track.ds), track.stageN);
  const botLap = t - (t0 ?? 0);
  const ai = new AICar(track, 1.0, 1);
  ai.noise.fill(0);
  ai.lineBias = 0;
  ai.place(10, 0);
  t = 0; t0 = null;
  while (t < 900 && ai.s < end) {
    ai.update(dt, [], 0, true);
    t += dt;
    if (t0 == null && ai.s >= S0) t0 = t;
  }
  const aiLap = t - (t0 ?? 0);
  return { botLap, aiLap };
}

export const DRIVERS = [
  { name: 'K. ARATA', color: 0x1f4fd8, num: 7 },
  { name: 'M. VOSS', color: 0xf2f2f2, num: 22 },
  { name: 'L. FERRO', color: 0x0c0c0e, num: 11 },
  { name: 'S. HAYAMI', color: 0xf5b400, num: 3 },
  { name: 'R. OKONJO', color: 0x18a35a, num: 46 },
  { name: 'T. LINDQVIST', color: 0xe86a12, num: 18 },
  { name: 'A. MORENO', color: 0x7b2fd0, num: 5 },
];

class RaceBase {
  progress(e) {
    const s = e.kind === 'player' ? e.car.s : e.ai.s;
    return (e.lap - 1) * this.track.length + s;
  }

  pose(e) {
    return e.kind === 'player' ? e.car : e.ai;
  }

  onCross(e) {
    // レース・タイムアタックとも、スタートシグナルからの時間で計測する（1周目はグリッドからの発進を含む）
    const t = this.raceTime;
    if (this.mode === 'ta') {
      if (e.lap >= 2) {
        const lt = t - e.lapStart;
        e.laps.push(lt);
        const isBest = lt < e.best;
        if (isBest) e.best = lt;
        this.events.push({ type: 'lap', entry: e, time: lt, best: isBest, frames: this.recording });
        e.lapStart = t;
        this.recording = [];
        this.recT = 0;
        // 記録は 1・2 周目の合計。2周走ったら計測終了
        if (e.laps.length === 2 && !e.finished) {
          e.finished = true;
          e.finishTime = t;
          this.events.push({ type: 'taFinish', total: e.laps[0] + e.laps[1] });
        }
      }
      return;
    }
    if (e.lap >= 2) {
      const lt = t - e.lapStart;
      e.laps.push(lt);
      const isBest = lt < e.best;
      if (isBest) e.best = lt;
      if (e.kind === 'player') this.events.push({ type: 'lap', entry: e, time: lt, best: isBest, frames: this.recording });
      e.lapStart = t;
      if (e.kind === 'player') { this.recording = []; this.recT = 0; }
    } else {
      // 1周目の開始（グリッドからの通過）
      e.lapStart = 0;
      if (e.kind === 'player') { this.recording = []; this.recT = 0; }
    }
    if (e.lap > this.laps && !e.finished) {
      e.finished = true;
      e.finishTime = t;
      this.finishOrder.push(e);
      if (e.kind === 'player') {
        this.state = 'finished';
        this.events.push({ type: 'finish', position: this.finishOrder.length });
      }
    }
  }

  standings() {
    const arr = this.entries.slice();
    arr.sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return this.progress(b) - this.progress(a);
    });
    return arr;
  }

  playerPosition() {
    return this.standings().indexOf(this.player) + 1;
  }

  // 結果（未完走の AI は残り距離から推定）
  results() {
    const st = this.standings();
    const L = this.track.length;
    const total = this.stage ? this.track.stageEnd - this.START : this.laps * L;
    return st.map((e, i) => {
      let time = e.finishTime, est = false;
      if (!e.finished) {
        const prog = this.progress(e);
        const v = Math.max(20, prog / Math.max(this.raceTime, 1));
        time = this.raceTime + (total - prog) / v;
        est = true;
      }
      return { pos: i + 1, name: e.name, kind: e.kind, color: e.color, num: e.num, time, est, best: e.best };
    }).sort((a, b) => a.time - b.time).map((r, i) => ({ ...r, pos: i + 1 }));
  }

  collide() {
    const ents = this.entries;
    const R = this.collR ?? 1.0;
    const offs = this.collOffs ?? [-1.45, 0, 1.45];
    for (let i = 0; i < ents.length; i++) {
      for (let j = i + 1; j < ents.length; j++) {
        const A = this.pose(ents[i]), B = this.pose(ents[j]);
        const dx0 = A.x - B.x, dz0 = A.z - B.z;
        if (dx0 * dx0 + dz0 * dz0 > 49) continue;
        const fa = [Math.sin(A.psi), Math.cos(A.psi)], fb = [Math.sin(B.psi), Math.cos(B.psi)];
        let best = null;
        for (const oa of offs) {
          for (const ob of offs) {
            const ax = A.x + fa[0] * oa, az = A.z + fa[1] * oa;
            const bx = B.x + fb[0] * ob, bz = B.z + fb[1] * ob;
            const dx = ax - bx, dz = az - bz;
            const d2 = dx * dx + dz * dz;
            if (d2 < 4 * R * R && (!best || d2 < best.d2)) best = { d2, dx, dz, oa, ob };
          }
        }
        if (!best) continue;
        const dist = Math.sqrt(best.d2) || 0.01;
        const nx = best.dx / dist, nz = best.dz / dist;
        const depth = 2 * R - dist;
        const ea = ents[i], eb = ents[j];
        const va = this.vel(ea), vb = this.vel(eb);
        const vn = (va[0] - vb[0]) * nx + (va[1] - vb[1]) * nz;
        let J = 0;
        if (vn < 0) J = (-(1 + 0.3) * vn) / 2;
        this.push(ea, nx * depth * 0.5, nz * depth * 0.5, nx * J, nz * J, best.oa);
        this.push(eb, -nx * depth * 0.5, -nz * depth * 0.5, -nx * J, -nz * J, best.ob);
        if (J > 1 && (ea.kind === 'player' || eb.kind === 'player')) this.events.push({ type: 'hit', power: J });
      }
    }
  }

  vel(e) {
    if (e.kind === 'player') return [e.car.vx, e.car.vz];
    const a = e.ai;
    const hd = this.track.sampleArr(this.track.hd, a.s);
    return [Math.sin(hd) * a.v + Math.cos(hd) * a.latV, Math.cos(hd) * a.v - Math.sin(hd) * a.latV];
  }

  push(e, dx, dz, dvx, dvz, off) {
    if (e.kind === 'player') {
      const c = e.car;
      c.x += dx; c.z += dz;
      c.vx += dvx; c.vz += dvz;
      const rcx = Math.sin(c.psi) * off, rcz = Math.cos(c.psi) * off;
      c.r += ((rcz * dvx - rcx * dvz) * c.spec.mass) / c.spec.Iz * 0.5;
    } else {
      e.ai.applyPush(dx, dz, dvx, dvz);
    }
  }
}

export { RaceBase };

export class Race extends RaceBase {
  constructor(track, opts) {
    super();
    this.track = track;
    this.opts = opts;
    this.mode = opts.mode;
    // セクションコース（スタートとゴールが別の場所）: 1本走り切ったらゴール
    this.stage = !!track.stageEnd;
    this.START = this.stage ? STAGE_START : 0;
    this.laps = this.stage ? 1 : opts.mode === 'race' ? opts.laps : 999;
    this.time = 0; // 総経過
    this.raceTime = 0; // スタートからの時間
    this.state = 'grid'; // grid -> countdown -> racing -> finished
    this.countdown = 0;
    this.entries = [];
    this.finishOrder = [];
    this.events = [];
    const L = this.stage ? this.START : track.length; // グリッドの基準（スタートラインの位置）
    const player = new Car(track);
    player.assist = opts.assist;
    const pe = { kind: 'player', name: 'YOU', color: opts.playerColor, num: 1, car: player, lap: 0, prevS: 0, lapStart: 0, laps: [], best: Infinity, finished: false, finishTime: 0 };
    if (this.mode === 'race') {
      const diff = DIFFICULTY[opts.difficulty];
      const n = DRIVERS.length;
      const cal = calibrate(track);
      const top = cal.aiLap / (cal.botLap * diff.factor);
      this.aiTop = top;
      // グリッド: 先頭から AI、プレイヤーは最後尾
      const paces = DRIVERS.map((_, i) => top - i * diff.spread);
      // 速い順に並べずに少し混ぜる
      const order = [0, 2, 1, 3, 5, 4, 6];
      // セクションコースは1本勝負なので、プレイヤーは中団（5番手）から
      const pSlot = this.stage ? 4 : n;
      this.gridSlot = pSlot;
      for (let g = 0; g < n; g++) {
        const di = order[g];
        const ai = new AICar(track, paces[di], 1000 + di * 77);
        ai.driftSkill = diff.drift ?? 0;
        ai.scChance = diff.shortcut ?? 0;
        const slot = g < pSlot ? g : g + 1;
        const s = L - 12 - slot * 8;
        ai.place(s, slot % 2 === 0 ? 3 : -3);
        this.entries.push({ kind: 'ai', ...DRIVERS[di], ai, lap: 0, prevS: ai.s, lapStart: 0, laps: [], best: Infinity, finished: false, finishTime: 0 });
      }
      const ps = L - 12 - pSlot * 8;
      player.reset(ps, pSlot % 2 === 0 ? 3 : -3);
      pe.prevS = player.s;
      this.entries.push(pe);
    } else {
      // タイムアタックもレースと同じグリッド位置・スタートシグナルから
      // タイムアタックもレースと同じグリッド位置（セクションコースは5番手の位置）
      const n = this.stage ? 4 : DRIVERS.length;
      player.reset(L - 12 - n * 8, n % 2 === 0 ? 3 : -3);
      pe.prevS = player.s;
      this.entries.push(pe);
    }
    this.player = pe;
    this.bot = null;
    this.lastLap = null;
    this.ghostFrames = [];
    this.recording = [];
    this.recT = 0;
    this.taTiming = false;
  }

  progress(e) {
    if (this.stage) return this.pose(e).s - this.START;
    return super.progress(e);
  }

  // ショートカットへの出入り（プレイヤー）。ショートカット上でも car.s は本線に換算した位置にする
  shortcutSwitch(car) {
    const main = this.track;
    if (!main.shortcuts || !main.shortcuts.length) return;
    car.mainTrack = main;
    const pj = scProj;
    // 今いる道から外へ出て、もう一方の道の上にいたら乗り換える
    if (car.track === main) {
      for (const sc of main.shortcuts) {
        const inWin = (car.s > sc.sA0 && car.s < sc.sA0 + 120) || (car.s > sc.sB0 - 120 && car.s < sc.sB0);
        if (!inWin || sc.side * car.d < main.halfW - 0.3) continue;
        sc.project(car.x, car.z, -1, pj, 1e9);
        if (pj.s > 0 && pj.s < sc.stageEnd && Math.abs(pj.d) < sc.halfW) {
          car.track = sc; car.hint = pj.i;
          car.scS = pj.s; car.d = pj.d;
          car.s = sc.toMain(pj.s);
          this.events.push({ type: 'shortcut' });
          return;
        }
      }
    } else {
      const sc = car.track;
      car.scS = car.s; // Car.step はショートカット上の位置を入れる
      car.s = sc.toMain(car.scS);
      const leftSc = Math.abs(car.d) > sc.halfW - 0.3 || car.scS > sc.stageEnd - 4;
      if (leftSc) {
        main.project(car.x, car.z, -1, pj, 1e9);
        if (Math.abs(pj.d) < main.halfW + 0.5 && Math.abs(pj.s - car.s) < 200) {
          car.track = main; car.hint = pj.i;
          car.s = pj.s; car.d = pj.d;
        }
      }
    }
  }

  // セクションコースのゴール
  finishStage(e) {
    const t = this.raceTime;
    e.finished = true;
    e.finishTime = t;
    e.laps.push(t);
    e.best = t;
    if (this.mode === 'ta') {
      this.events.push({ type: 'lap', entry: e, time: t, best: true, frames: this.recording });
      this.events.push({ type: 'taFinish', total: t });
      return;
    }
    this.finishOrder.push(e);
    if (e.kind === 'player') {
      this.state = 'finished';
      this.events.push({ type: 'finish', position: this.finishOrder.length });
    }
  }

  startCountdown() {
    this.state = 'countdown';
    this.countdown = 0;
  }

  step(dt, input) {
    this.time += dt;
    this.events.length = 0;
    const started = this.state === 'racing' || this.state === 'finished';
    if (this.state === 'countdown') {
      this.countdown += dt;
      // 1秒後から 3・2・1、4秒で GO（シグナルも合わせて点灯→消灯）
      const left = Math.ceil(4 - this.countdown);
      if (left !== this.lastTick && left >= 1 && left <= 3) { this.lastTick = left; this.events.push({ type: 'tick', n: left }); }
      if (this.countdown >= 4) {
        this.state = 'racing';
        this.raceTime = 0;
        this.events.push({ type: 'go' });
        for (const e of this.entries) { e.lapStart = 0; if (this.stage) e.lap = 1; }
        this.recording = [];
        this.recT = 0;
        if (this.mode === 'ta') this.taTiming = true;
      }
    }
    if (started) this.raceTime += dt;

    // プレイヤー
    const p = this.player;
    let inp = input;
    if (p.finished || this.opts.autopilot) {
      if (!this.bot) this.bot = new BotDriver(p.car, this.track, 0.9);
      inp = this.bot.update();
      // セクションコースのゴール後はブレーキで止まる（道はゴールの先 150m まで）
      if (this.stage && p.finished) inp = { ...inp, throttle: 0, brake: 1 };
    }
    // スリップストリーム（前方 30m 以内・横のずれ 1.6m 以内。近いほど効く）
    if (this.mode === 'race') {
      const myP = this.progress(p);
      let k = 0;
      for (const e of this.entries) {
        if (e === p) continue;
        const gap = this.progress(e) - myP;
        if (gap > 4 && gap < 30 && Math.abs(e.ai.d - p.car.d) < 1.6) k = Math.max(k, 1 - (gap - 4) / 26);
      }
      p.car.draft = (p.car.draft || 0) + (k - (p.car.draft || 0)) * Math.min(1, dt * 4);
    } else p.car.draft = 0;
    if (!started) {
      // スタート前: 回転だけ上げられる
      p.car.rpm += ((1100 + input.throttle * 6000) - p.car.rpm) * Math.min(1, dt * 6);
      p.car.throttle = input.throttle;
    } else {
      p.car.step(dt, inp);
      this.shortcutSwitch(p.car);
      if (p.car.impact > 2) this.events.push({ type: 'wall', power: p.car.impact });
      // 動けない・逆走が続いたら自動でコースに戻す
      if (!p.finished) {
        this.recovery ??= new Recovery(this.track);
        const rv = this.recovery.update(dt, p.car, inp);
        if (rv) this.events.push({ type: rv });
      }
    }

    // AI
    if (this.mode === 'race') {
      const others = this.entries.map((e) => {
        const o = this.pose(e);
        return { self: e.kind === 'ai' ? e.ai : e.car, progress: this.progress(e), d: e.kind === 'ai' ? e.ai.d : e.car.d, v: e.kind === 'ai' ? e.ai.v : e.car.u, x: o.x, z: o.z };
      });
      for (const e of this.entries) {
        if (e.kind !== 'ai') continue;
        // セクションコースのゴール後はその場で止まる
        e.ai.update(dt, others, this.progress(e), started, this.stage && e.finished ? 0 : null);
      }
      this.collide();
    }

    // 周回判定（セクションコースはゴール地点の通過）
    const L = this.track.length;
    if (this.stage) {
      if (started) for (const e of this.entries) if (!e.finished && this.pose(e).s >= this.track.stageEnd && this.pose(e).s < this.track.stageEnd + 300) this.finishStage(e);
    } else for (const e of this.entries) {
      const s = this.pose(e).s;
      if (e.prevS > L * 0.75 && s < L * 0.25) {
        e.lap++;
        if (started) this.onCross(e);
      } else if (e.prevS < L * 0.25 && s > L * 0.75) {
        e.lap--;
      }
      e.prevS = s;
    }

    // ゴースト記録（プレイヤー）
    if (started) {
      this.recT += dt;
      if (this.recT >= 1 / 20) {
        this.recT -= 1 / 20;
        const c = p.car;
        this.recording.push(c.x, c.y, c.z, c.psi);
      }
    }
  }

}
