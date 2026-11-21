// CPU ドライバー: 理想速度プロファイル × ペースでレーシングラインを走り、追い越し・回避を行う
import { DRIFT } from './car.js';
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

// AI の車両特性（加速・減速・回転数）。既定は GT カー
export const CAR_AI = {
  accel: (v, grip) => Math.min(9.5 * grip, 395000 / (1320 * Math.max(v, 4))) - (0.5 * 1.2 * 0.78 * v * v) / 1320,
  brake: (grip) => 22 * grip, // 理想速度の減速カーブ（プレイヤーの車で約 1.5〜2.2G）に沿えるだけの強さ
  dragK: (0.5 * 1.2 * 0.78) / 1320, // 空気抵抗 / 質量（スリップストリームの計算用）
  rpm: null,
  wheelR: 0.335,
};

export class AICar {
  constructor(track, pace, seed, spec = CAR_AI) {
    this.spec = spec;
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
    // ドリフトターボ（プレイヤーと同じ段階・同じ加速）。driftSkill = ドリフトを使うコーナーの割合
    this.driftSkill = 0;
    this.drift = 0; this.driftT = 0; this.driftLvl = 0;
    this.boostT = 0; this.boostLvl = 0; this.lastZone = null; this.boostFired = 0;
  }

  // ドリフトに向くコーナー（減速の大きいコーナー）: ターンイン〜立ち上がりの区間
  static driftZones(tr) {
    if (tr.driftZones) return tr.driftZones;
    const prof = tr.aiProfile || tr.profile;
    const zones = [];
    for (const c of tr.corners) {
      if (c.vEntry - c.vApex < 12) continue;
      const apexS = c.apex * tr.ds;
      let exit = apexS + 120;
      for (let o = 2; o < 120; o += 2) if (tr.sampleArr(prof, apexS + o) > c.vApex * 1.18) { exit = apexS + o; break; }
      zones.push({ entry: apexS - 28, exit, dir: Math.sign(tr.kappa[c.apex]) || 1 });
    }
    return (tr.driftZones = zones);
  }

  zoneAt(s) {
    const L = this.track.length;
    for (const z of AICar.driftZones(this.track)) {
      const a = ((s - z.entry) % L + L) % L;
      if (a <= z.exit - z.entry) return z;
    }
    return null;
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
    return tr.sampleArr(tr.aiProfile || tr.profile, s) * this.pace * (1 + this.noise[seg]);
  }

  // others: 他車の配列（{progress, d, v, x, z}）
  // forceVt: 指定すると目標速度をこの値にする
  update(dt, others, myProgress, started, forceVt = null) {
    const tr = this.track;
    if (!started) { this.updatePose(dt); this.prevMainS = this.s; return; }
    // ショートカット: 分岐の手前で使うか決める（scChance の割合で）
    if (this.sc) { this.updateShortcut(dt); return; }
    if (tr.shortcuts && this.prevMainS != null && forceVt == null) {
      for (const sc of tr.shortcuts) {
        if (this.prevMainS < sc.sA0 && this.s >= sc.sA0 && this.s < sc.sA0 + 30) {
          if (this.rng() < (this.scChance || 0)) {
            this.sc = sc; this.scS = 0; this.scD = this.d - sc.side * tr.halfW * 0.3;
            this.drift = 0; this.driftLvl = 0;
            this.updateShortcut(dt);
            return;
          }
        }
      }
    }
    this.prevMainS = this.s;
    // 目標速度はすぐ先で見る（先を見すぎると、コーナーの手前から必要以上に遅くなる）
    let vt = Math.min(this.targetSpeed(this.s + 2), this.targetSpeed(this.s + 2 + this.v * 0.05));
    if (forceVt != null) vt = forceVt;
    const lineD = tr.sampleArr(tr.line, this.s + 8) + this.lineBias;
    const hw = tr.halfW - 1.2;
    let wantD = lineD;

    // 前方の車を確認（スリップストリームも同じ範囲で判定）
    let blocker = null, bgap = 1e9;
    let draft = 0;
    for (const o of others) {
      if (o.self === this) continue;
      let gap = o.progress - myProgress;
      if (gap <= 0 || gap > 30) continue;
      if (gap > 4 && Math.abs(o.d - this.d) < 1.6) draft = Math.max(draft, 1 - (gap - 4) / 26);
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
        // 抜けないときは前の車に合わせる（車間 5m で同じ速さ。必要以上に下げて後ろへ渋滞を連鎖させない）
        if (!sideClear && bgap < 10) vt = Math.min(vt, blocker.v + (bgap - 5) * 0.35);
      }
    }
    if (this.passTimer > 0) this.passTimer -= dt;
    // ドリフト: コーナーに入るときに使うか決め、立ち上がりでターボ
    this.boostFired = 0;
    const zone = this.driftSkill > 0 ? this.zoneAt(this.s) : null;
    if (!this.drift && zone && zone !== this.lastZone) {
      this.lastZone = zone;
      if (this.rng() < this.driftSkill && this.v > DRIFT.minSpeed) { this.drift = zone.dir; this.driftT = 0; this.driftLvl = 0; }
    }
    if (this.drift) {
      this.driftT += dt;
      while (this.driftLvl < 3 && this.driftT >= DRIFT.levels[this.driftLvl]) this.driftLvl++;
      vt *= 0.985; // 滑らせているぶん少し遅い
      if (!zone) {
        if (this.driftLvl > 0) { this.boostLvl = this.driftLvl; this.boostT = DRIFT.boostTime[this.driftLvl - 1]; this.boostFired = this.driftLvl; }
        this.drift = 0; this.driftLvl = 0; this.driftT = 0;
      }
    }
    let boostA = 0;
    if (this.boostT > 0) {
      this.boostT -= dt;
      boostA = DRIFT.boostAccel * (0.85 + 0.15 * this.boostLvl);
      vt += 4;
    }
    // 直線（目標速度が高い所）では、スリップストリームで少しだけ伸びる
    this.draft = draft;
    if (draft > 0 && vt > 50) vt += draft * 1.2;
    wantD = Math.max(-hw, Math.min(hw, wantD));

    // 横方向
    const dErr = wantD - this.d;
    const latTarget = Math.max(-3.5, Math.min(3.5, dErr * 1.6));
    this.latV += (latTarget - this.latV) * Math.min(1, dt * 3);
    this.d += this.latV * dt;
    this.d = Math.max(-tr.halfW - 0.5, Math.min(tr.halfW + 0.5, this.d));

    // 縦方向
    if (this.v < vt) {
      // スリップストリームはプレイヤーと同じく「空気抵抗が最大 40% 減る」ぶんだけ
      const a = this.spec.accel(this.v, tr.grip) + (this.spec.dragK || 0) * 0.4 * (this.draft || 0) * this.v * this.v + boostA;
      this.v = Math.min(vt, this.v + Math.max(a, 0) * dt);
      this.throttle = 1;
      this.braking = 0;
    } else {
      const dec = this.spec.brake(tr.grip);
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

  // ショートカットを走る（その道の理想速度 × ペース。終点で本線に戻る）
  updateShortcut(dt) {
    const sc = this.sc, main = this.track;
    const prof = sc.aiProfile || sc.profile;
    const vt = Math.min(sc.sampleArr(prof, this.scS + 2), sc.sampleArr(prof, this.scS + 2 + this.v * 0.05)) * this.pace;
    if (this.v < vt) { this.v = Math.min(vt, this.v + Math.max(0, this.spec.accel(this.v, sc.grip * 0.85)) * dt); this.throttle = 1; this.braking = 0; }
    else { this.v = Math.max(vt, this.v - this.spec.brake(sc.grip) * dt); this.throttle = 0; this.braking = 1; }
    if (this.boostT > 0) this.boostT -= dt;
    this.scS += this.v * dt;
    this.scD += (0 - this.scD) * Math.min(1, dt * 1.5);
    // 見た目はショートカットの道の上
    const ms = this.s, md = this.d;
    this.track = sc; this.s = this.scS; this.d = this.scD;
    this.updatePose(dt);
    this.track = main; this.s = sc.toMain(this.scS); this.d = md;
    void ms;
    if (this.scS >= sc.stageEnd - 2) {
      // 本線に合流
      this.sc = null;
      this.s = sc.sB0;
      this.d = sc.side * main.halfW * 0.3;
      this.latV = 0;
    }
    this.prevMainS = this.s;
  }

  updatePose(dt) {
    const tr = this.track;
    const p = tr.pointAt(this.s, this.d, tmp);
    const ox = this.x, oz = this.z;
    this.x = p.x; this.z = p.z;
    // ジャンプ台では宙に浮く（プレイヤーと同じ判定）。谷は飛び越えられる速さで走る前提
    const gy = tr.jumpArr && tr.jumpArr[p.i] === 2 ? p.y : tr.groundY(p.i, p.y);
    if (dt > 0) {
      if (this.air) {
        this.vy -= 9.81 * dt;
        this.y += this.vy * dt;
        if (this.y <= gy) { this.air = false; this.y = gy; this.vy = 0; this.vyG = 0; }
      } else {
        const vyG = (gy - this.y) / dt;
        if (this.v > 8 && this.vyG != null && vyG < this.vyG - 9.81 * dt * 3 && this.y - gy > 0.05) { this.air = true; this.vy = this.vyG; this.y += this.vy * dt; }
        else { this.y = gy; this.vyG = Math.max(-20, Math.min(20, vyG)); }
      }
    } else { this.y = gy; this.vyG = 0; this.air = false; }
    const latAngle = Math.atan2(this.latV, Math.max(this.v, 3));
    const k = tr.sampleArr(tr.kappa, this.s);
    // 横G に応じたわずかなスリップアングル（見た目）
    this.slip = Math.max(-0.08, Math.min(0.08, k * this.v * this.v * 0.0018));
    // ドリフト中は車体を大きく内側へ向ける（見た目）
    this.driftAng = (this.driftAng || 0) + ((this.drift ? this.drift * Math.min(0.06, 0.02 + this.driftT * 0.1) : 0) - (this.driftAng || 0)) * Math.min(1, dt * 6);
    this.slip += this.driftAng;
    this.psi = p.hd - latAngle + this.slip;
    this.vx = (this.x - ox) / Math.max(dt, 1e-3);
    this.vz = (this.z - oz) / Math.max(dt, 1e-3);
    if (dt === 0) { this.vx = 0; this.vz = 0; }
    this.wheelRot += (this.v / this.spec.wheelR) * dt;
    // 疑似エンジン回転
    if (this.spec.rpm) {
      this.rpm = this.spec.rpm(this);
    } else {
      const gears = [3.1, 2.22, 1.72, 1.39, 1.16, 0.98];
      let g = this.gear;
      let rpm = (this.v / 0.335) * gears[g - 1] * 3.45 * 9.549;
      if (rpm > 7600 && g < 6) g++;
      else if (rpm < 4300 && g > 1) g--;
      this.gear = g;
      this.rpm = Math.max(1100, (this.v / 0.335) * gears[g - 1] * 3.45 * 9.549);
    }
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
