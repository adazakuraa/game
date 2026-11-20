// 自動復帰: 壁に引っかかって動けない・逆走が続いたら、その場所のレコードライン上に戻す
// （やられてから操作が戻るまでを短くする。時間のロスはそのままペナルティになる）
const tmp = {};

export const RECOVERY = {
  stuckSpeed: 1.5, // m/s 未満でアクセルを踏み続けたら「動けない」
  stuckTime: 2.5, // 秒
  wrongTime: 2.0, // 逆走がこの秒数続いたら戻す
  wrongWarn: 0.6, // 逆走の警告を出すまで
};

export class Recovery {
  constructor(track) {
    this.track = track;
    this.stuckT = 0;
    this.wrongT = 0;
    this.warned = false;
  }

  // 戻したら 'recover'、逆走の警告を出すときは 'wrongway' を返す
  update(dt, car, input) {
    const R = RECOVERY;
    const tr = this.track;
    const sp = Math.abs(car.u);
    if (sp < R.stuckSpeed && input.throttle > 0.5 && !(car.crashT > 0)) this.stuckT += dt;
    else if (sp > 4) this.stuckT = 0;
    const hd = tr.pointAt(car.s, 0, tmp).hd;
    const along = Math.cos(car.psi - hd);
    const moving = (car.speed || 0) > 3;
    if (along < -0.3 && moving) this.wrongT += dt;
    else if (along > 0) { this.wrongT = 0; this.warned = false; }
    let ev = null;
    if (this.wrongT > R.wrongWarn && !this.warned) { this.warned = true; ev = 'wrongway'; }
    if (this.stuckT > R.stuckTime || this.wrongT > R.wrongTime) {
      const s = car.s;
      const d = tr.line ? tr.sampleArr(tr.line, s) : 0;
      car.reset(s, d);
      this.stuckT = 0;
      this.wrongT = 0;
      this.warned = false;
      ev = 'recover';
    }
    return ev;
  }
}
