// GTカーの車両物理（2輪モデル + 荷重移動 + 摩擦円 + 簡易パワートレイン）。描画非依存。
const G = 9.81;

export const CAR_SPEC = {
  mass: 1320,
  Iz: 2150,
  a: 1.22, // 重心→前軸
  b: 1.43, // 重心→後軸
  h: 0.47, // 重心高
  trackW: 1.64,
  wheelR: 0.335,
  gears: [3.1, 2.22, 1.72, 1.39, 1.16, 0.98],
  final: 3.45,
  eff: 0.88,
  idle: 1100,
  redline: 7900,
  upshift: 7600,
  downshift: 4300,
  CdA: 0.78,
  ClA: 2.5,
  mu: 1.55,
  B: 9.0,
  C: 1.5,
  brakeMax: 26000,
  brakeBias: 0.66,
  power: 410000, // W（プロファイル計算用の近似）
  topSpeed: 82,
  halfLen: 2.3,
  halfWid: 0.98,
};

function torque(rpm) {
  // おおよそ 4.0L 自然吸気 6気筒 のトルクカーブ (Nm)
  const pts = [[800, 260], [2000, 380], [3500, 470], [5000, 520], [6300, 515], [7200, 480], [7900, 430], [8300, 0]];
  if (rpm <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (rpm <= pts[i][0]) {
      const [r0, t0] = pts[i - 1], [r1, t1] = pts[i];
      return t0 + ((t1 - t0) * (rpm - r0)) / (r1 - r0);
    }
  }
  return 0;
}

const proj = {};
const projF = {}, projR = {};

// ドリフトターボ: 曲がりながらブレーキを軽く踏むとドリフト開始。滑らせている時間でチャージし、
// ハンドルを戻して立ち上がるとターボ（段階が高いほど長く加速）。コース外・壁・スピンでチャージは消える
// ドリフト中に目指すヨーレート: 通常の旋回より少しきつめ（ハンドルに比例）
function rTarget(rRef, rT, dir) {
  return Math.abs(rRef) > 1e-3 ? rRef * 1.18 : -dir * Math.abs(rT) * 0.2;
}

export const DRIFT = {
  minSpeed: 14, // m/s これ未満では始まらない
  startSteer: 0.5, // これ以上ハンドルを切った状態でブレーキをタップすると開始
  rearGrip: 0.8, // ドリフト中の後輪グリップ倍率（テールが出る）
  betaMin: 0.05, // これ以上滑っている間だけチャージ
  levels: [0.4, 0.9, 1.5], // チャージ時間（秒）: 青・オレンジ・紫
  boostTime: [0.6, 1.0, 1.45],
  boostAccel: 7.0, // m/s^2（タイヤのグリップと関係なく押し出す）
};

export class Car {
  constructor(track, spec = CAR_SPEC) {
    this.track = track;
    this.spec = spec;
    this.reset(0, 0);
    this.assist = true;
  }

  reset(s, d) {
    const p = this.track.pointAt(s, d, {});
    this.x = p.x;
    this.z = p.z;
    this.y = p.y;
    this.psi = p.hd;
    this.vx = 0;
    this.vz = 0;
    this.r = 0;
    this.u = 0;
    this.vl = 0;
    this.delta = 0;
    this.gear = 1;
    this.rpm = this.spec.idle;
    this.shiftTimer = 0;
    this.ax = 0;
    this.hint = -1;
    this.pitch = 0;
    this.roll = 0;
    this.slipF = 0;
    this.slipR = 0;
    this.wheelspin = 0;
    this.lock = 0;
    this.surfF = 0;
    this.surfR = 0;
    this.wheelRot = 0;
    this.offTrack = 0;
    this.impact = 0;
    this.braking = 0;
    this.throttle = 0;
    this.reverseTimer = 0;
    this.crashT = 0;
    this.drift = 0; this.driftT = 0; this.driftLvl = 0; this.driftOffT = 0;
    this.air = false; this.vy = 0; this.vyG = 0; this.fell = false; this.landed = 0; this.airT = 0;
    this.boostT = 0; this.boostLvl = 0; this.boostFired = 0;
    this.track.project(this.x, this.z, -1, proj);
    this.hint = proj.i;
    this.s = proj.s;
    this.d = proj.d;
    this.wheelSurf = [0, 0, 0, 0];
  }

  steerMax(u) {
    const v = Math.abs(u);
    return 0.5 / (1 + (v * v) / (21 * 21)) + 0.035;
  }

  // input: { steer: -1(左)..1(右), throttle: 0..1, brake: 0..1 }
  step(dt, input) {
    if (this.air) { this.stepAir(dt, input); return; }
    const c = this.spec;
    const tr = this.track;
    const L = c.a + c.b;
    const sp = Math.sin(this.psi), cp = Math.cos(this.psi);
    const fx = sp, fz = cp, lx = cp, lz = -sp;
    let u = this.vx * fx + this.vz * fz;
    let vl = this.vx * lx + this.vz * lz;
    let r = this.r;

    // コース位置
    tr.project(this.x, this.z, this.hint, proj);
    this.hint = proj.i;
    // 前後軸の路面
    const xf = this.x + fx * c.a, zf = this.z + fz * c.a;
    const xr = this.x - fx * c.b, zr = this.z - fz * c.b;
    tr.project(xf, zf, proj.i, projF, 8);
    tr.project(xr, zr, proj.i, projR, 8);
    // 車体の左右方向を中心線の左法線へ射影
    const latDot = lx * proj.lx + lz * proj.lz;
    const hw = c.trackW / 2;
    const sFL = tr.surfaceAt(projF.d + hw * latDot, projF.curb, projF.i);
    const sFR = tr.surfaceAt(projF.d - hw * latDot, projF.curb, projF.i);
    const sRL = tr.surfaceAt(projR.d + hw * latDot, projR.curb, projR.i);
    const sRR = tr.surfaceAt(projR.d - hw * latDot, projR.curb, projR.i);
    this.wheelSurf[0] = sFL.type; this.wheelSurf[1] = sFR.type;
    this.wheelSurf[2] = sRL.type; this.wheelSurf[3] = sRR.type;
    const baseMu = c.mu * tr.gripArr[proj.i];
    this.roadSurf = tr.surfArr[proj.i]; // 路面の種類（砂煙・雪煙の演出用）
    const muF = (baseMu * (sFL.grip + sFR.grip)) / 2;
    let muR = (baseMu * (sRL.grip + sRR.grip)) / 2;
    if (this.drift) muR *= DRIFT.rearGrip;
    const surfDrag = (sFL.drag + sFR.drag + sRL.drag + sRR.drag) / 4;
    this.offTrack = (sFL.type >= 2) + (sFR.type >= 2) + (sRL.type >= 2) + (sRR.type >= 2);
    this.onCurb = (sFL.type === 1) + (sFR.type === 1) + (sRL.type === 1) + (sRR.type === 1);

    // ステアリング（速度感応 + レート制限）
    const steerIn = Math.max(-1, Math.min(1, input.steer));
    const target = -steerIn * this.steerMax(u);
    const rate = 2.6;
    const dd = target - this.delta;
    this.delta += Math.max(-rate * dt, Math.min(rate * dt, dd));
    const delta = this.delta;

    // 荷重
    const df = 0.5 * 1.2 * c.ClA * u * u;
    const W = c.mass * G;
    const axc = Math.max(-14, Math.min(10, this.ax));
    let Nf = (W * c.b) / L + df * 0.46 - (c.mass * axc * c.h) / L;
    let Nr = (W * c.a) / L + df * 0.54 + (c.mass * axc * c.h) / L;
    Nf = Math.max(Nf, 600);
    Nr = Math.max(Nr, 600);

    // スリップ角
    const ua = Math.max(Math.abs(u), 1.0);
    const sgn = u >= 0 ? 1 : -1;
    const af = Math.atan2(vl + c.a * r, ua) - delta * sgn;
    const ar = Math.atan2(vl - c.b * r, ua);
    const pac = (al) => Math.sin(c.C * Math.atan(c.B * al));
    let Fyf = -muF * Nf * pac(af);
    let Fyr = -muR * Nr * pac(ar);

    // ドリフトの開始・継続・終了
    {
      const beta0 = Math.atan2(vl, Math.max(Math.abs(u), 1));
      const brk0 = Math.max(0, Math.min(1, input.brake));
      // 合図はブレーキの短いタップ（踏んで 0.35 秒以内に離す）。長く踏む普通のブレーキではドリフトしない
      let tapped = false;
      if (brk0 > 0.25) this.brakeHeldT = (this.brakeHeldT || 0) + dt;
      else { if (this.brakeHeldT > 0.02 && this.brakeHeldT < 0.35) tapped = true; this.brakeHeldT = 0; }
      if (!this.drift) {
        if (!this.noDrift && tapped && u > DRIFT.minSpeed && Math.abs(steerIn) > DRIFT.startSteer && !(this.crashT > 0)) {
          this.drift = Math.sign(steerIn);
          this.driftT = 0; this.driftLvl = 0; this.driftOffT = 0;
          this.boostT = 0;
        }
      } else {
        // 曲がる向きにハンドルを残している間（逆ハンドルで当てていてもよい）は続く
        const holding = Math.sign(steerIn) === this.drift && Math.abs(steerIn) > 0.12;
        const sliding = Math.abs(beta0) > DRIFT.betaMin;
        if (sliding) this.driftT += dt;
        while (this.driftLvl < 3 && this.driftT >= DRIFT.levels[this.driftLvl]) this.driftLvl++;
        this.driftOffT = holding || sliding ? 0 : this.driftOffT + dt;
        const fail = this.offTrack >= 3 || Math.abs(beta0) > 0.95 || this.crashT > 0 || (this.scrape && Math.abs(u) < 20);
        if (fail) { this.drift = 0; this.driftLvl = 0; this.driftT = 0; }
        else if (this.driftOffT > 0.12 || u < 9) {
          // 立ち上がり: チャージした段階でターボ
          if (this.driftLvl > 0) {
            this.boostLvl = this.driftLvl;
            this.boostT = DRIFT.boostTime[this.driftLvl - 1];
            this.boostFired = this.driftLvl;
          }
          this.drift = 0; this.driftLvl = 0; this.driftT = 0;
        }
      }
      if (this.boostT > 0) { this.boostT -= dt; if (brk0 > 0.5) this.boostT = 0; }
    }

    // パワートレイン
    let throttle = Math.max(0, Math.min(1, input.throttle));
    this.crashed = false;
    if (this.crashT > 0) { this.crashT -= dt; throttle = 0; }
    let brake = Math.max(0, Math.min(1, input.brake));
    const ratio = c.gears[this.gear - 1] * c.final;
    let rpm = (Math.abs(u) / c.wheelR) * ratio * (60 / (2 * Math.PI));
    if (rpm < c.idle) rpm = c.idle;
    // 自動変速
    if (this.shiftTimer > 0) {
      this.shiftTimer -= dt;
    } else if (rpm > c.upshift && this.gear < c.gears.length) {
      this.gear++;
      this.shiftTimer = 0.16;
    } else if (this.gear > 1) {
      const lower = (Math.abs(u) / c.wheelR) * c.gears[this.gear - 2] * c.final * (60 / (2 * Math.PI));
      if (rpm < c.downshift && lower < c.upshift - 600) {
        this.gear--;
        this.shiftTimer = 0.12;
      }
    }
    // バック（停止付近でブレーキ保持）
    let reverse = false;
    if (brake > 0.5 && throttle < 0.1 && u < 0.8) {
      this.reverseTimer += dt;
      if (this.reverseTimer > 0.45) reverse = true;
    } else {
      this.reverseTimer = 0;
    }
    let Fd = 0;
    if (reverse) {
      Fd = u > -7 ? -5200 * brake : 0;
      brake = 0;
    } else if (this.shiftTimer <= 0 && rpm < c.redline + 250) {
      Fd = (throttle * torque(rpm) * ratio * c.eff) / c.wheelR;
    } else if (this.shiftTimer > 0) {
      Fd = (throttle * torque(rpm) * ratio * c.eff * 0.15) / c.wheelR;
    }
    // エンジンブレーキ
    if (throttle < 0.05 && !reverse && u > 2) Fd -= 380 + rpm * 0.08;

    const capR = muR * Nr;
    const capF = muF * Nf;
    // トラクションコントロール（アシストOFFでは介入が弱い）
    if (Fd > 0) {
      const room = Math.sqrt(Math.max(0, capR * capR * (this.assist ? 0.98 : 1.06) - Fyr * Fyr));
      if (Fd > room) Fd = Math.max(room, capR * 0.12);
    }
    const Fb = brake * c.brakeMax;
    let Fbf = Fb * c.brakeBias, Fbr = Fb * (1 - c.brakeBias);
    {
      // ABS: 横力分を残す
      const roomF = Math.sqrt(Math.max(0, capF * capF * 0.97 - Fyf * Fyf * 0.6));
      const roomR = Math.sqrt(Math.max(0, capR * capR * 0.97 - Fyr * Fyr * 0.6));
      Fbf = Math.min(Fbf, roomF);
      Fbr = Math.min(Fbr, roomR);
    }
    const bs = Math.abs(u) > 0.3 ? sgn : u / 0.3;
    let Fxf = -Fbf * bs;
    let Fxr = Fd - Fbr * bs;
    // 摩擦円
    let tf = Math.hypot(Fxf, Fyf), trr = Math.hypot(Fxr, Fyr);
    this.lock = 0;
    this.wheelspin = 0;
    if (tf > capF) {
      const k = capF / tf;
      // ロック時は横力がより大きく落ちる
      Fxf *= k;
      Fyf *= k * (Fbf > capF * 0.9 ? 0.55 : 1);
      this.lock = Math.min(1, (tf - capF) / capF + 0.3);
    }
    if (trr > capR) {
      const k = capR / trr;
      Fxr *= k;
      Fyr *= k * (Math.abs(Fd) > capR * 0.9 ? 0.7 : 1);
      if (Fd > 0) this.wheelspin = Math.min(1, (trr - capR) / capR + 0.3);
      else this.lock = Math.max(this.lock, 0.5);
    }

    // 抵抗
    // スリップストリーム: 前の車の真後ろでは空気抵抗が減る（draft 0..1 はレース側が設定）
    const Fdrag = 0.5 * 1.2 * c.CdA * (1 - 0.4 * (this.draft || 0)) * u * Math.abs(u);
    const Froll = (0.015 * W + surfDrag * Math.abs(u)) * (Math.abs(u) > 0.2 ? sgn : u / 0.2);
    // 勾配
    const slopeF = proj.slope * Math.cos(this.psi - proj.hd);
    const Fg = -c.mass * G * Math.sin(Math.atan(slopeF));

    const cd = Math.cos(delta), sd = Math.sin(delta);
    let du = (Fxr + Fxf * cd - Fyf * sd - Fdrag - Froll + Fg) / c.mass + vl * r;
    // ドリフト中もアクセルを踏んでいれば大きくは失速しない（タイヤが横に滑る抵抗をやわらげる）
    if (this.drift && throttle > 0.3 && this.assist) du = Math.max(du, -2.2);
    // ターボ（アクセルを踏んでいる間だけ押し出す）
    if (this.boostT > 0 && throttle > 0.3) du += DRIFT.boostAccel * (0.85 + 0.15 * this.boostLvl);
    let dvl = (Fyr + Fyf * cd + Fxf * sd) / c.mass - u * r;
    let dr = (c.a * (Fyf * cd + Fxf * sd) - c.b * Fyr) / c.Iz;

    // 横滑り防止（アシスト）
    if (this.assist && Math.abs(u) > 6) {
      const rRef = (u * delta) / (L * (1 + (u * u) / 900));
      const rLim = (muR * G * 1.05) / Math.abs(u);
      const rt = Math.max(-rLim, Math.min(rLim, rRef));
      const err = r - rt;
      const beta = Math.atan2(vl, Math.abs(u));
      if (this.drift) {
        // ドリフトアシスト: ハンドルの切り具合で、滑る角度と向きの変わる速さが決まる（カウンターステア不要）
        const st = Math.abs(steerIn) * (Math.sign(steerIn) === this.drift ? 1 : -0.6);
        const betaT = this.drift * Math.max(0.08, Math.min(0.38, 0.16 + 0.22 * st));
        const rT = this.drift * Math.abs(u) * Math.max(0, 0.6 + 0.9 * st) / Math.max(18, Math.abs(u) * 2.2) * 1.0;
        dvl += (betaT * Math.abs(u) - vl) * 3.5;
        dr += (-rT - r) * 4.0 * 0 + (rTarget(rRef, rT, this.drift) - r) * 4.0;
      } else if (Math.abs(beta) > 0.06 || Math.abs(err) > 0.12) {
        dr -= err * 3.2;
        dvl -= vl * 0.8;
      }
    }

    u += du * dt;
    vl += dvl * dt;
    r += dr * dt;
    // 低速域: 運動学モデルへブレンド
    const blend = Math.max(0, Math.min(1, (4 - Math.abs(u)) / 4));
    if (blend > 0) {
      const rk = (u * Math.tan(delta)) / L;
      r += (rk - r) * blend * Math.min(1, dt * 20);
      vl -= vl * blend * Math.min(1, dt * 10);
      if (throttle < 0.02 && !reverse && Math.abs(u) < 0.25 && brake > 0) u = 0;
    }
    this.ax += ((du - vl * r) - this.ax) * Math.min(1, dt * 12);

    this.psi += r * dt;
    const sp2 = Math.sin(this.psi), cp2 = Math.cos(this.psi);
    this.vx = u * sp2 + vl * cp2;
    this.vz = u * cp2 - vl * sp2;
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    this.r = r;

    // 壁
    this.collideWalls(tr);
    this.s = proj.s;
    this.d = proj.d;
    this.followGround(dt, tr);

    // 出力値
    const sp3 = Math.sin(this.psi), cp3 = Math.cos(this.psi);
    this.u = this.vx * sp3 + this.vz * cp3;
    this.vl = this.vx * cp3 - this.vz * sp3;
    this.speed = Math.hypot(this.vx, this.vz);
    this.rpm += (((this.shiftTimer > 0 ? rpm * 0.85 : rpm) + (this.wheelspin * 1800)) - this.rpm) * Math.min(1, dt * 15);
    if (this.rpm > c.redline + 200) this.rpm = c.redline + 200;
    this.slipF = Math.abs(af);
    this.slipR = Math.abs(ar);
    this.throttle = throttle;
    this.braking = brake;
    this.reverse = reverse;
    this.wheelRot += (this.u / c.wheelR) * dt + this.wheelspin * 30 * dt;
    // 見た目用のピッチ・ロール
    const latAcc = this.u * r;
    this.slopePitch = Math.atan(proj.slope * Math.cos(this.psi - proj.hd));
    this.pitch += (this.slopePitch + this.ax * 0.0035 - this.pitch) * Math.min(1, dt * 8);
    this.roll += (latAcc * 0.0045 - this.roll) * Math.min(1, dt * 8);
  }

  // 壁との当たり（押し戻し・失速・クラッシュ）
  collideWalls(tr) {
    const c = this.spec;
    tr.project(this.x, this.z, this.hint, proj);
    this.hint = proj.i;
    this.impact = 0;
    const margin = c.halfWid + 0.25;
    const limL = proj.wallL - margin, limR = -(proj.wallR - margin);
    if (proj.d > limL || proj.d < limR) {
      const side = proj.d > limL ? 1 : -1;
      const over = side > 0 ? proj.d - limL : limR - proj.d;
      // 押し戻し
      this.x -= proj.lx * over * side;
      this.z -= proj.lz * over * side;
      // 法線方向の速度を反射
      const vn = (this.vx * proj.lx + this.vz * proj.lz) * side;
      if (vn > 0) {
        const e = 0.25;
        this.vx -= (1 + e) * vn * proj.lx * side;
        this.vz -= (1 + e) * vn * proj.lz * side;
        // 摩擦による減速
        // 壁に当たると大きく失速する（壁に沿って全開で走るのが速くならないように）
        const loss = Math.max(0.45, 0.9 - vn * 0.07);
        this.vx *= loss;
        this.vz *= loss;
        // 車体を壁沿いへ向ける
        const along = this.vx * Math.sin(proj.hd) + this.vz * Math.cos(proj.hd);
        const wantPsi = along >= 0 ? proj.hd : proj.hd + Math.PI;
        let dpsi = wantPsi - this.psi;
        while (dpsi > Math.PI) dpsi -= 2 * Math.PI;
        while (dpsi < -Math.PI) dpsi += 2 * Math.PI;
        this.psi += dpsi * Math.min(0.5, vn * 0.03);
        this.r *= 0.4;
        this.impact = vn;
        // 正面に近い角度で強く当たるとクラッシュ（しばらく走れない）
        if (vn > 11 && this.crashT <= 0) {
          this.crashT = 1.6;
          this.vx *= 0.25;
          this.vz *= 0.25;
          this.r += (Math.random() - 0.5) * 3;
          this.crashed = true;
        }
      }
      this.scrape = true;
      tr.project(this.x, this.z, this.hint, proj);
    } else this.scrape = false;
  }

  // 地面に沿う。地面が重力より速く下がる所（ジャンプ台の先端・急な頂上）では宙に浮く
  followGround(dt, tr) {
    const gy = tr.groundY(proj.i, proj.y);
    const vyG = (gy - this.y) / Math.max(dt, 1e-4);
    if (this.speed > 8 && vyG < this.vyG - G * dt * 3 && this.y - gy > 0.05) {
      // 離陸: 直前の上向きの速さを保って飛ぶ
      this.air = true;
      this.vy = this.vyG;
      this.airT = 0;
      this.y += this.vy * dt;
      return;
    }
    this.y = gy;
    this.vyG = Math.max(-20, Math.min(20, vyG));
  }

  // 空中: タイヤの力はなく、重力と空気抵抗だけ。ハンドルで向きを少しだけ変えられる
  stepAir(dt, input) {
    const c = this.spec;
    const tr = this.track;
    this.airT += dt;
    this.vy -= G * dt;
    this.y += this.vy * dt;
    const sp = Math.hypot(this.vx, this.vz);
    const k = 1 - ((0.5 * 1.2 * c.CdA) / c.mass) * sp * dt;
    this.vx *= k; this.vz *= k;
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    const steerIn = Math.max(-1, Math.min(1, input.steer));
    this.r += (-steerIn * 0.5 - this.r) * Math.min(1, dt * 3);
    this.psi += this.r * dt;
    if (this.boostT > 0) this.boostT -= dt;
    this.drift = 0; this.driftLvl = 0; this.driftT = 0;
    this.collideWalls(tr);
    this.s = proj.s;
    this.d = proj.d;
    const gy = tr.groundY(proj.i, proj.y);
    if (this.y <= gy) {
      // 着地
      const hard = -this.vy;
      this.air = false;
      this.y = gy;
      this.vyG = 0;
      this.landed = hard;
      if (hard > 9) { this.vx *= 0.93; this.vz *= 0.93; }
      if (tr.inHole(proj.s)) this.fell = true; // 谷に落ちた
      this.vy = 0;
    }
    const sp3 = Math.sin(this.psi), cp3 = Math.cos(this.psi);
    this.u = this.vx * sp3 + this.vz * cp3;
    this.vl = this.vx * cp3 - this.vz * sp3;
    this.speed = Math.hypot(this.vx, this.vz);
    this.throttle = Math.max(0, Math.min(1, input.throttle));
    this.braking = 0;
    this.offTrack = 0; this.onCurb = 0;
    this.slipF = 0; this.slipR = 0; this.wheelspin = 0; this.lock = 0;
    this.wheelRot += (this.u / c.wheelR) * dt;
    // 空中では鼻先が少しずつ下がる
    this.pitch += (Math.atan2(this.vy, Math.max(8, this.speed)) * 0.6 - this.pitch) * Math.min(1, dt * 3);
    this.roll *= 1 - Math.min(1, dt * 2);
  }

}
