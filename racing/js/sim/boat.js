// ボート（競艇）の物理。水面を滑る小さな艇: 横滑りしやすく、スロットルを開けるとスターン（後ろ）が流れる。
const G = 9.81;

export const BOAT = {
  mass: 330,
  Iz: 340,
  a: 1.05, // 重心→艇首
  b: 0.95, // 重心→スターン
  T0: 2400, // 推力（停止時）
  kT: 45, // 速度による推力の低下
  cDrag: 2.29, // 水の抵抗
  brakeF: 1900,
  mu: 1.3,
  B: 8,
  C: 1.45,
  halfLen: 1.5,
  halfWid: 0.55,
  topSpeed: 24,
};

// コース側（理想速度の計算）に渡す特性
export const BOAT_TRACK_SPEC = {
  mu: 1.12, ClA: 0, CdA: 3.8, mass: 330, power: 31500, topSpeed: 24, tractionK: 0.85, brakeK: 0.55,
};

const accelAt = (v) => (BOAT.T0 - BOAT.kT * v - BOAT.cDrag * v * v) / BOAT.mass;

// CPU 艇（運動学的に動く）の特性
export const BOAT_AI = {
  accel: (v) => Math.max(0.3, accelAt(v) * 0.97),
  brake: () => 6.2,
  rpm: (ai) => 2200 + (ai.v / 24) * 6200,
  wheelR: 0.3,
};

const proj = {};
const pac = (al, B, C) => Math.sin(C * Math.atan(B * al));

export class Boat {
  constructor(track, spec = BOAT) {
    this.track = track;
    this.spec = spec;
    this.assist = true;
    this.reset(0, 0, 0);
  }

  reset(s, d, speed = 0) {
    const p = this.track.pointAt(s, d, {});
    this.x = p.x; this.z = p.z; this.y = 0;
    this.psi = p.hd;
    this.vx = Math.sin(p.hd) * speed;
    this.vz = Math.cos(p.hd) * speed;
    this.r = 0;
    this.u = speed;
    this.vl = 0;
    this.delta = 0;
    this.rpm = 2200;
    this.gear = 1;
    this.ax = 0;
    this.pitch = 0;
    this.roll = 0;
    this.slopePitch = 0;
    this.slipF = 0; this.slipR = 0;
    this.wheelspin = 0; this.lock = 0;
    this.offTrack = 0; this.onCurb = 0;
    this.impact = 0;
    this.braking = 0;
    this.throttle = 0;
    this.wheelRot = 0;
    this.speed = speed;
    this.wheelSurf = [0, 0, 0, 0];
    this.track.project(this.x, this.z, -1, proj);
    this.hint = proj.i;
    this.s = proj.s;
    this.d = proj.d;
    this.time = 0;
  }

  steerMax(u) {
    return 0.36 / (1 + (Math.abs(u) / 9) ** 2) + 0.05;
  }

  step(dt, input) {
    const c = this.spec;
    const tr = this.track;
    this.time += dt;
    const L = c.a + c.b;
    const sp = Math.sin(this.psi), cp = Math.cos(this.psi);
    let u = this.vx * sp + this.vz * cp;
    let vl = this.vx * cp - this.vz * sp;
    let r = this.r;
    tr.project(this.x, this.z, this.hint, proj);
    this.hint = proj.i;

    // 舵
    const steerIn = Math.max(-1, Math.min(1, input.steer));
    const target = -steerIn * this.steerMax(u);
    const dd = target - this.delta;
    this.delta += Math.max(-3 * dt, Math.min(3 * dt, dd));
    const delta = this.delta;

    let thr = Math.max(0, Math.min(1, input.throttle));
    const brk = Math.max(0, Math.min(1, input.brake));

    // 横方向の力: 艇首と艇尾の2点モデル。スロットルを開けるとスターンのグリップが落ちる
    const ua = Math.max(Math.abs(u), 1);
    const sgn = u >= 0 ? 1 : -1;
    const af = Math.atan2(vl + c.a * r, ua) - delta * sgn;
    const ar = Math.atan2(vl - c.b * r, ua);
    // アシスト（横滑り防止）: スターンが流れ始めたらスロットルを自動で絞る
    const thrIn = thr;
    if (this.assist) thr *= 1 - Math.max(0, Math.min(0.4, Math.abs(ar) * 2.2 - 0.15));
    const N = (c.mass * G) / 2;
    const muF = c.mu * (0.92 + 0.08 * (1 - thr));
    const muR = c.mu * (1 - 0.38 * thr * Math.min(1, ua / 9));
    let Fyf = -muF * N * pac(af, c.B, c.C);
    let Fyr = -muR * N * pac(ar, c.B, c.C);
    // 水面のうねり（潮流）
    const cur = (tr.def.current || 0) * Math.sin(this.time * 0.6 + this.x * 0.015 + this.z * 0.011);
    Fyr += cur * c.mass * 0.5;
    Fyf += cur * c.mass * 0.5;

    // 前後: 推力 - 水の抵抗 - ブレーキ。低速では抵抗が山になる（滑走に入る前）
    const hump = 700 * Math.exp(-(((Math.abs(u) - 5) / 2.6) ** 2));
    const Fthrust = thr * Math.max(0, c.T0 - c.kT * Math.max(u, 0));
    const Fdrag = c.cDrag * u * Math.abs(u) + hump * sgn;
    const Fbrake = brk * c.brakeF * (Math.abs(u) > 0.4 ? sgn : u / 0.4);
    let Fx = Fthrust - Fdrag - Fbrake;
    // 止まっているときにブレーキを踏み続けると後退できる（ブイに引っかかったとき用）
    if (brk > 0.3 && u < 0.8 && u > -5 && thrIn < 0.1) Fx -= 800 * brk;

    const cd = Math.cos(delta), sd = Math.sin(delta);
    const du = (Fx - Fyf * sd) / c.mass + vl * r;
    const dvl = (Fyr + Fyf * cd) / c.mass - u * r;
    const dr = (c.a * Fyf * cd - c.b * Fyr) / c.Iz - r * 0.9;

    u += du * dt;
    vl += dvl * dt;
    r += dr * dt;
    // 低速では運動学モデルへ
    const blend = Math.max(0, Math.min(1, (3.5 - Math.abs(u)) / 3.5));
    if (blend > 0) {
      const rk = (u * Math.tan(delta)) / L;
      r += (rk - r) * blend * Math.min(1, dt * 12);
      vl -= vl * blend * Math.min(1, dt * 8);
    }
    this.ax += (du - this.ax) * Math.min(1, dt * 10);

    this.psi += r * dt;
    const sp2 = Math.sin(this.psi), cp2 = Math.cos(this.psi);
    this.vx = u * sp2 + vl * cp2;
    this.vz = u * cp2 - vl * sp2;
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    this.r = r;

    // ブイ・ネットとの接触
    tr.project(this.x, this.z, this.hint, proj);
    this.hint = proj.i;
    this.impact = 0;
    const margin = c.halfWid + 0.2;
    const limL = proj.wallL - margin, limR = -(proj.wallR - margin);
    if (proj.d > limL || proj.d < limR) {
      const side = proj.d > limL ? 1 : -1;
      const over = side > 0 ? proj.d - limL : limR - proj.d;
      this.x -= proj.lx * over * side;
      this.z -= proj.lz * over * side;
      const vn = (this.vx * proj.lx + this.vz * proj.lz) * side;
      if (vn > 0) {
        this.vx -= 1.2 * vn * proj.lx * side;
        this.vz -= 1.2 * vn * proj.lz * side;
        const loss = Math.max(0.55, 1 - vn * 0.05);
        this.vx *= loss;
        this.vz *= loss;
        const along = this.vx * Math.sin(proj.hd) + this.vz * Math.cos(proj.hd);
        const wantPsi = along >= 0 ? proj.hd : proj.hd + Math.PI;
        let dpsi = wantPsi - this.psi;
        while (dpsi > Math.PI) dpsi -= 2 * Math.PI;
        while (dpsi < -Math.PI) dpsi += 2 * Math.PI;
        this.psi += dpsi * Math.min(0.5, vn * 0.03);
        this.r *= 0.4;
        this.impact = vn;
      }
      tr.project(this.x, this.z, this.hint, proj);
    }
    this.s = proj.s;
    this.d = proj.d;

    const sp3 = Math.sin(this.psi), cp3 = Math.cos(this.psi);
    this.u = this.vx * sp3 + this.vz * cp3;
    this.vl = this.vx * cp3 - this.vz * sp3;
    this.speed = Math.hypot(this.vx, this.vz);
    this.throttle = thrIn;
    this.braking = brk;
    this.slipF = Math.abs(af);
    this.slipR = Math.abs(ar);
    // 見た目用: 加速で艇首が上がり、旋回で内側に傾く。プロペラの回転は rpm に連動
    this.pitch += ((this.speed / 24) * 0.05 + this.ax * 0.004 - this.pitch) * Math.min(1, dt * 6);
    this.roll += (-this.u * r * 0.014 - this.roll) * Math.min(1, dt * 6);
    this.rpm += ((2200 + thr * 2600 + (Math.min(this.speed, 26) / 24) * 3400) - this.rpm) * Math.min(1, dt * 10);
    this.wheelRot += (this.u / 0.3) * dt;
  }
}
