// CPU ドライバー: 理想速度プロファイル × ペースでレーシングラインを走り、追い越し・回避を行う
const tmp = {}, tmp2 = {};

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class AICar {
  constructor(track, pace, seed) {
    this.track = track;
    this.pace = pace;
    this.rng = mulberry32(seed);
    this.s = 0;
    this.d = 0;
    this.v = 0;
    this.latV = 0;
    this.x = 0; this.y = 0; this.z = 0; this.psi = 0;
    this.passSide = 0;
    this.passTimer = 0;
    this.braking = 0;
    this.throttle = 0;
    this.slip = 0;
    this.wheelRot = 0;
    this.rpm = 1000;
    this.gear = 1;
    this.impact = 0;
    // コーナーごとの微妙なペースのばらつき（人間らしさ）
    this.noise = new Float32Array(64);
    for (let i = 0; i < 64; i++) this.noise[i] = (this.rng() - 0.5) * 0.03;
    this.lineBias = (this.rng() - 0.5) * 0.8;
  }

  place(s, d) {
    this.s = s;
    this.d = d;
    this.v = 0;
    this.updatePose(0);
  }

  targetSpeed(s) {
    const tr = this.track;
    const seg = Math.floor((((s % tr.length) + tr.length) % tr.length) / (tr.length / 64));
    return tr.sampleArr(tr.profile, s) * this.pace * (1 + this.noise[seg]);
  }

  // others: 他車の配列（{progress, d, v, x, z}）
  update(dt, others, myProgress, started) {
    const tr = this.track;
    if (!started) { this.updatePose(dt); return; }
    let vt = Math.min(this.targetSpeed(this.s + 3), this.targetSpeed(this.s + 3 + this.v * 0.25));
    const lineD = tr.sampleArr(tr.line, this.s + 8) + this.lineBias;
    const hw = tr.halfW - 1.2;
    let wantD = lineD;

    // 前方の車を確認
    let blocker = null, bgap = 1e9;
    for (const o of others) {
      if (o.self === this) continue;
      let gap = o.progress - myProgress;
      if (gap <= 0 || gap > 30) continue;
      if (Math.abs(o.d - this.d) < 2.3 && gap < bgap) { bgap = gap; blocker = o; }
    }
    if (blocker) {
      const closing = this.v - blocker.v;
      if (closing > -0.5 || bgap < 9) {
        if (this.passTimer <= 0) {
          // 余裕のある側へ
          const roomL = hw - blocker.d, roomR = blocker.d + hw;
          this.passSide = roomL > roomR ? 1 : -1;
          if (Math.max(roomL, roomR) < 2.6) this.passSide = 0;
          this.passTimer = 2.5;
        }
        if (this.passSide !== 0) {
          wantD = blocker.d + this.passSide * 3.0;
        }
        // 抜けないときは追従
        const sideClear = this.passSide !== 0 && Math.abs(this.d - blocker.d) > 2.0;
        if (!sideClear && bgap < 12) vt = Math.min(vt, blocker.v - 0.3 + (bgap - 7) * 0.4);
      }
    }
    if (this.passTimer > 0) this.passTimer -= dt;
    wantD = Math.max(-hw, Math.min(hw, wantD));

    // 横方向
    const dErr = wantD - this.d;
    const latTarget = Math.max(-3.5, Math.min(3.5, dErr * 1.6));
    this.latV += (latTarget - this.latV) * Math.min(1, dt * 3);
    this.d += this.latV * dt;
    this.d = Math.max(-tr.halfW - 0.5, Math.min(tr.halfW + 0.5, this.d));

    // 縦方向
    const P = 395000, m = 1320;
    const drag = (0.5 * 1.2 * 0.78 * this.v * this.v) / m;
    if (this.v < vt) {
      const a = Math.min(9.5 * tr.grip, P / (m * Math.max(this.v, 4))) - drag;
      this.v = Math.min(vt, this.v + Math.max(a, 0) * dt);
      this.throttle = 1;
      this.braking = 0;
    } else {
      const dec = 13 * tr.grip;
      this.v = Math.max(vt, this.v - dec * dt);
      this.throttle = 0;
      this.braking = this.v - vt > 0.5 ? 1 : 0;
    }
    if (this.v < 0) this.v = 0;
    // 中心線上の進み（ライン上を走るので中心線の進みに換算）
    const i = Math.floor((((this.s % tr.length) + tr.length) % tr.length) / tr.ds) % tr.N;
    const k = tr.kappa[i];
    const ratio = 1 - k * this.d; // オフセット走行による距離差
    this.s += (this.v * dt) / Math.max(0.5, ratio);
    if (this.s >= tr.length) this.s -= tr.length;
    if (this.s < 0) this.s += tr.length;
    this.updatePose(dt);
  }

  updatePose(dt) {
    const tr = this.track;
    const p = tr.pointAt(this.s, this.d, tmp);
    const ox = this.x, oz = this.z;
    this.x = p.x; this.y = p.y; this.z = p.z;
    const latAngle = Math.atan2(this.latV, Math.max(this.v, 3));
    const k = tr.sampleArr(tr.kappa, this.s);
    // 横G に応じたわずかなスリップアングル（見た目）
    this.slip = Math.max(-0.08, Math.min(0.08, k * this.v * this.v * 0.0018));
    this.psi = p.hd - latAngle + this.slip;
    this.vx = (this.x - ox) / Math.max(dt, 1e-3);
    this.vz = (this.z - oz) / Math.max(dt, 1e-3);
    if (dt === 0) { this.vx = 0; this.vz = 0; }
    this.wheelRot += (this.v / 0.335) * dt;
    // 疑似エンジン回転
    const gears = [3.1, 2.22, 1.72, 1.39, 1.16, 0.98];
    let g = this.gear;
    let rpm = (this.v / 0.335) * gears[g - 1] * 3.45 * 9.549;
    if (rpm > 7600 && g < 6) g++;
    else if (rpm < 4300 && g > 1) g--;
    this.gear = g;
    this.rpm = Math.max(1100, (this.v / 0.335) * gears[g - 1] * 3.45 * 9.549);
    this.slopePitch = Math.atan(tr.sampleArr(tr.slope, this.s));
    this.pitch = this.slopePitch;
    this.roll = k * this.v * this.v * 0.004;
  }

  // 衝突応答（ワールド座標の押し出しと速度変化）
  applyPush(dx, dz, dvx, dvz) {
    const tr = this.track;
    const p = tr.pointAt(this.s, 0, tmp2);
    const tx = Math.sin(p.hd), tz = Math.cos(p.hd);
    const lx = Math.cos(p.hd), lz = -Math.sin(p.hd);
    this.s += dx * tx + dz * tz;
    this.d += dx * lx + dz * lz;
    this.v = Math.max(0, this.v + dvx * tx + dvz * tz);
    this.latV += (dvx * lx + dvz * lz) * 0.8;
    const lim = Math.min(tr.sampleArr(tr.wallL, this.s), tr.sampleArr(tr.wallR, this.s)) - 1.2;
    this.d = Math.max(-lim, Math.min(lim, this.d));
  }
}
