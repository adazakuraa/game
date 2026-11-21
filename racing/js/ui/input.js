// 入力: タッチ（スライド / ボタン / 傾き）・キーボード・ゲームパッド
// スライド操作: 指を何 px ずらすと全開か
export const SLIDE_RANGE = 115;
export function slideCurve(dx, range) {
  const dead = 5;
  const a = Math.max(0, Math.abs(dx) - dead) / (range - dead);
  return Math.sign(dx) * Math.min(1, a) ** 1.55;
}

export class Input {
  constructor(root) {
    this.root = root;
    this.state = { steer: 0, throttle: 0, brake: 0 };
    this.mode = 'slide';
    this.sens = 1;
    this.keys = new Set();
    this.touchSteer = null; // {id, x0, x}
    this.btnL = false;
    this.btnR = false;
    this.gas = false;
    this.brk = false;
    this.tilt = 0;
    this.tiltZero = 0;
    this.kbSteer = 0;
    this.btnSteer = 0;
    this.onCamera = null;
    this.onPause = null;
    this.enabled = false;
    this.bind();
  }

  bind() {
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'KeyC' && this.onCamera) this.onCamera();
      if ((e.code === 'Escape' || e.code === 'KeyP') && this.onPause) this.onPause();
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());

    const zone = this.root.querySelector('#steerZone');
    const knob = this.root.querySelector('#steerKnob');
    const base = this.root.querySelector('#steerBase');
    this.knob = knob;
    this.base = base;
    zone.addEventListener('pointerdown', (e) => {
      if (this.mode !== 'slide') return;
      e.preventDefault();
      try { zone.setPointerCapture(e.pointerId); } catch { /* 取得できなくても操作は続ける */ }
      this.touchSteer = { id: e.pointerId, x0: e.clientX, x: e.clientX, y0: e.clientY };
      this.root.querySelector('#steerHint')?.classList.add('hide');
      base.style.display = 'block';
      base.style.left = e.clientX + 'px';
      base.style.top = e.clientY + 'px';
      this.updateKnob();
    });
    zone.addEventListener('pointermove', (e) => {
      if (this.touchSteer && e.pointerId === this.touchSteer.id) {
        this.touchSteer.x = e.clientX;
        this.updateKnob();
      }
    });
    const end = (e) => {
      if (this.touchSteer && e.pointerId === this.touchSteer.id) {
        this.touchSteer = null;
        base.style.display = 'none';
      }
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);

    const hold = (id, on, off) => {
      const el = this.root.querySelector(id);
      const down = (e) => { e.preventDefault(); try { el.setPointerCapture(e.pointerId); } catch { /* 無視 */ } el.classList.add('on'); on(); };
      const up = (e) => { e.preventDefault(); el.classList.remove('on'); off(); };
      el.addEventListener('pointerdown', down);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('lostpointercapture', up);
      el.addEventListener('contextmenu', (e) => e.preventDefault());
    };
    hold('#btnGas', () => (this.gas = true), () => (this.gas = false));
    hold('#btnBrake', () => (this.brk = true), () => (this.brk = false));
    hold('#btnLeft', () => (this.btnL = true), () => (this.btnL = false));
    hold('#btnRight', () => (this.btnR = true), () => (this.btnR = false));

    addEventListener('deviceorientation', (e) => {
      if (e.beta == null) return;
      const ang = (screen.orientation && screen.orientation.angle) ?? window.orientation ?? 0;
      let v;
      if (ang === 90) v = e.beta;
      else if (ang === -90 || ang === 270) v = -e.beta;
      else v = e.gamma;
      this.tilt = v;
    });
  }

  updateKnob() {
    const t = this.touchSteer;
    if (!t) return;
    const R = SLIDE_RANGE;
    const dx = Math.max(-R, Math.min(R, t.x - t.x0));
    this.knob.style.transform = `translate(${dx}px, 0)`;
  }

  async enableTilt() {
    try {
      if (typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) {
        const r = await DeviceOrientationEvent.requestPermission();
        return r === 'granted';
      }
      return true;
    } catch {
      return false;
    }
  }

  calibrateTilt() {
    this.tiltZero = this.tilt;
  }

  setMode(mode) {
    this.mode = mode;
    this.root.dataset.steer = mode;
  }

  update(dt) {
    const k = this.keys;
    const left = k.has('ArrowLeft') || k.has('KeyA');
    const right = k.has('ArrowRight') || k.has('KeyD');
    let gas = this.gas || k.has('ArrowUp') || k.has('KeyW');
    let brk = this.brk || k.has('ArrowDown') || k.has('KeyS') || k.has('Space');
    // キーボードのステア: 押している時間で徐々に切れる
    const kt = (right ? 1 : 0) - (left ? 1 : 0);
    if (kt !== 0) this.kbSteer += Math.sign(kt - this.kbSteer) * Math.min(Math.abs(kt - this.kbSteer), dt * (Math.sign(kt) !== Math.sign(this.kbSteer) ? 7 : 3.2));
    else this.kbSteer -= Math.sign(this.kbSteer) * Math.min(Math.abs(this.kbSteer), dt * 6);
    let steer = this.kbSteer;
    let throttle = gas ? 1 : 0, brake = brk ? 1 : 0;

    if (this.mode === 'slide' && this.touchSteer) {
      const dx = this.touchSteer.x - this.touchSteer.x0;
      // 小さなずらしは小さく効く（不感帯 + 曲線）。端までで全開
      steer = slideCurve(dx, SLIDE_RANGE / this.sens);
    } else if (this.mode === 'buttons') {
      const bt = (this.btnR ? 1 : 0) - (this.btnL ? 1 : 0);
      if (bt !== 0) this.btnSteer += Math.sign(bt - this.btnSteer) * Math.min(Math.abs(bt - this.btnSteer), dt * 3.5);
      else this.btnSteer -= Math.sign(this.btnSteer) * Math.min(Math.abs(this.btnSteer), dt * 7);
      if (bt !== 0 || this.btnSteer !== 0) steer = this.btnSteer;
    } else if (this.mode === 'tilt') {
      const v = (this.tilt - this.tiltZero) / (28 / this.sens);
      steer = Math.max(-1, Math.min(1, v));
      if (Math.abs(steer) < 0.03) steer = 0;
    }

    // ゲームパッド
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p) continue;
      const ax = p.axes[0] || 0;
      if (Math.abs(ax) > 0.08) steer = Math.sign(ax) * ((Math.abs(ax) - 0.08) / 0.92) ** 1.3;
      const rt = p.buttons[7] ? p.buttons[7].value : 0;
      const lt = p.buttons[6] ? p.buttons[6].value : 0;
      if (rt > 0.02 || (p.buttons[0] && p.buttons[0].pressed)) throttle = Math.max(throttle, rt || 1);
      if (lt > 0.02 || (p.buttons[1] && p.buttons[1].pressed)) brake = Math.max(brake, lt || 1);
      if (p.buttons[3] && p.buttons[3].pressed && !this.padCam) { this.padCam = true; this.onCamera && this.onCamera(); }
      if (p.buttons[3] && !p.buttons[3].pressed) this.padCam = false;
      if (p.buttons[9] && p.buttons[9].pressed && !this.padPause) { this.padPause = true; this.onPause && this.onPause(); }
      if (p.buttons[9] && !p.buttons[9].pressed) this.padPause = false;
    }
    // ペダルを少しなめらかに
    const s = this.state;
    s.steer = steer;
    s.throttle += (throttle - s.throttle) * Math.min(1, dt * 14);
    s.brake += (brake - s.brake) * Math.min(1, dt * 18);
    if (throttle === 0 && s.throttle < 0.02) s.throttle = 0;
    if (brake === 0 && s.brake < 0.02) s.brake = 0;
    return s;
  }
}
