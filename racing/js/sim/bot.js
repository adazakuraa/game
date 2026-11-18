// 車両物理を実際に操作する自動ドライバー（ゴール後の自動走行・難易度の検証に使用）
const tmp = {};

export class BotDriver {
  constructor(car, track, pace = 1.0) {
    this.car = car;
    this.track = track;
    this.pace = pace;
    this.input = { steer: 0, throttle: 0, brake: 0 };
  }
  update() {
    const c = this.car, tr = this.track;
    // 壁に引っかかって止まったら少しバックする
    this.stuckT = (this.stuckT || 0);
    if (this.backT > 0) {
      this.backT -= 1 / 120;
      this.input.steer = this.backSteer;
      this.input.throttle = 0;
      this.input.brake = 1;
      return this.input;
    }
    if (Math.abs(c.u) < 1.5 && this.input.throttle > 0.5 && !(c.crashT > 0)) this.stuckT += 1 / 120; else this.stuckT = 0;
    if (this.stuckT > 1.2) {
      this.stuckT = 0;
      this.backT = 1.2;
      this.backSteer = c.d > 0 ? 1 : -1;
    }
    const u = Math.max(c.u, 3);
    const look = 7 + u * 0.42;
    const s = c.s + look;
    const off = tr.sampleArr(tr.line, s);
    const p = tr.pointAt(s, off, tmp);
    const dx = p.x - c.x, dz = p.z - c.z;
    const fx = Math.sin(c.psi), fz = Math.cos(c.psi);
    const lx = Math.cos(c.psi), lz = -Math.sin(c.psi);
    const fwd = dx * fx + dz * fz, lat = dx * lx + dz * lz;
    const alpha = Math.atan2(lat, Math.max(fwd, 0.1));
    const Lw = c.spec.a + c.spec.b;
    const deltaWant = Math.atan((2 * Lw * Math.sin(alpha)) / Math.hypot(dx, dz));
    let steer = -deltaWant / c.steerMax(c.u);
    // ヨー減衰
    steer += c.r * 0.08;
    this.input.steer = Math.max(-1, Math.min(1, steer));
    // 速度
    const vt = Math.min(tr.sampleArr(tr.profile, c.s + 4 + u * 0.12), tr.sampleArr(tr.profile, c.s + 2)) * this.pace;
    const err = vt - c.u;
    if (err > 0) {
      this.input.throttle = Math.min(1, 0.35 + err * 0.6);
      this.input.brake = 0;
    } else if (err > -1.2) {
      this.input.throttle = 0.25;
      this.input.brake = 0;
    } else {
      this.input.throttle = 0;
      this.input.brake = Math.min(1, -err * 0.35);
    }
    return this.input;
  }
}
