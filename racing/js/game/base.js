// ゲームクラスの共通部分: 固定ステップのループ、メッセージ、追従カメラ、一時停止
import * as THREE from 'three';
import { store } from '../store.js';
import { C, $ } from './common.js';

export class GameBase {
  constructor(opts) {
    this.opts = opts;
    this.paused = false;
    this.acc = 0;
    this.msgTimer = 0;
    this.subTimer = 0;
    this.shake = 0;
    this.camMode = store.get('cam2', 2); // 標準は一人称（ボンネット／ライダー目線）
    this.camYaw = 0;
    this.camPos = new THREE.Vector3();
    this.camVel = new THREE.Vector3();
    this.reward = null;
    this.latS = 0;
    this.feel = { gear: 1, thr: 0, heat: 0, curbT: 0, flameCd: 0 };
    this.speedCv = $('#speedfx');
    this.speedCtx = this.speedCv ? this.speedCv.getContext('2d') : null;
    this.streaks = Array.from({ length: 34 }, () => ({ a: Math.random() * Math.PI * 2, r: Math.random(), w: 0.5 + Math.random() }));
  }

  begin() {
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  // 1 ステップのシミュレーション。モードごとに差し替え可
  stepSim(h, inp) { this.race.step(h, inp); }

  frame(t) {
    if (C.game() !== this) return;
    requestAnimationFrame((tt) => this.frame(tt));
    const dt = Math.min(0.1, (t - this.last) / 1000);
    this.last = t;
    if (this.paused) { this.render(0); return; }
    const inp = C.input.update(dt);
    // 固定ステップ
    this.acc += dt;
    const h = 1 / 120;
    let steps = 0;
    while (this.acc >= h && steps < 14) {
      this.stepSim(h, inp);
      this.handleEvents();
      this.acc -= h;
      steps++;
    }
    if (steps >= 14) this.acc = 0;
    this.render(dt);
  }

  // small: 画面中央の大きな表示ではなく、上寄りの小さめの表示にする
  showMsg(text, dur = 1.5, color = '', small = false) {
    const el = $('#hMsg');
    el.textContent = text;
    el.style.color = color;
    el.classList.toggle('small', small);
    el.classList.toggle('show', !!text);
    this.msgTimer = dur;
  }

  // スタートのカウントダウン表示（n: 3,2,1 / 0 で GO!）
  countdown(n) {
    const el = $('#hCount');
    el.className = 'count';
    void el.offsetWidth; // アニメーションをやり直す
    el.textContent = n > 0 ? String(n) : 'GO!';
    el.className = 'count anim ' + (n > 0 ? 'n' + n : 'go');
    if (n > 0) C.audio.beep(440, 0.15, 0.25);
    else C.audio.beep(880, 0.55, 0.32);
  }

  subMsg(text, dur = 2) {
    const el = $('#hSubMsg');
    el.textContent = text;
    el.classList.toggle('show', !!text);
    this.subTimer = dur;
  }

  tickMessages(dt) {
    if (this.msgTimer > 0) {
      this.msgTimer -= dt;
      if (this.msgTimer <= 0) $('#hMsg').classList.remove('show');
    }
    if (this.subTimer > 0) {
      this.subTimer -= dt;
      if (this.subTimer <= 0) $('#hSubMsg').classList.remove('show');
    }
  }

  toastCoins(n) {
    const t = $('#coinToast');
    t.querySelector('b').textContent = '+' + n;
    t.classList.remove('show');
    void t.offsetWidth;
    t.classList.add('show');
  }

  // 共通の HUD 初期化（メッセージ・順位表・ヒントを空に）
  resetHud() {
    $('#hLapBox').innerHTML = 'LAP <span id="hLap">1</span>/<span id="hLaps">3</span>';
    $('#hLastL').textContent = 'LAST';
    $('#hLast').textContent = '--:--.---';
    $('#hBest').textContent = '--:--.---';
    $('#hDelta').className = 't-delta';
    $('#hBestL').textContent = 'BEST';
    $('#hCount').className = 'count';
    $('#hTarget').className = 't-sub t-target';
    $('#hDraft').classList.remove('on');
    $('#hNotes').classList.remove('show');
    $('#fTcs').textContent = 'TCS';
    $('#fAbs').textContent = 'ABS';
    $('#hGear').style.color = '';
    $('#btnGas span').textContent = 'ACCEL';
    $('#hRpm').style.background = '';
    $('#btnBrake span').textContent = 'BRAKE';
    $('#hNotes').innerHTML = '';
    $('#hud .pos').style.display = '';
    $('#hStand').style.display = '';
    $('#hMsg').classList.remove('show', 'small');
    $('#hSubMsg').classList.remove('show');
    $('#hDelta').textContent = '';
    $('#hStand').innerHTML = '';
    $('#steerHint').classList.remove('hide');
    C.input.setMode(this.opts.steer);
    C.input.sens = this.opts.sens;
  }

  // 追従カメラ。p: { x, y, z, psi, speed, slopePitch, rough }
  // cfg: { dist, hgt, lookAhead, lookY, fov, fovSpeed, follow }
  followCamera(dt, snap, p, cfg) {
    const camera = C.camera;
    let d = 0;
    if (!snap) {
      d = p.psi - this.camYaw;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
    }
    this.camYaw = snap ? p.psi : this.camYaw + d * Math.min(1, dt * (cfg.follow ?? 5.5));
    const fx = Math.sin(this.camYaw), fz = Math.cos(this.camYaw);
    const sp = p.speed || 0;
    // コーナーでは少し外側へ振られる（前後の距離は一定に保ち、車の見た目の大きさを変えない）
    const k3 = snap ? 1 : Math.min(1, dt * 3);
    this.latS += (Math.max(-16, Math.min(16, p.latG || 0)) - this.latS) * k3;
    const dist = cfg.dist;
    const side = -this.latS * 0.045;
    const lx = Math.cos(this.camYaw), lz = -Math.sin(this.camYaw);
    const pos = new THREE.Vector3(p.x - fx * dist + lx * side, p.y + cfg.hgt, p.z - fz * dist + lz * side);
    const look = new THREE.Vector3(p.x + fx * (cfg.lookAhead ?? 4), p.y + (cfg.lookY ?? 0.95), p.z + fz * (cfg.lookAhead ?? 4));
    let fov = (cfg.fov ?? 58) + sp * (cfg.fovSpeed ?? 0.16);
    if (camera.userData.portrait) fov += 22;
    // 車からの相対位置をなめらかにする（絶対位置で後追いすると、速度が変わるたびに車との距離が伸び縮みする）
    const off = pos.sub(new THREE.Vector3(p.x, p.y, p.z));
    const prev = this.camPos.clone();
    if (!snap && this.camOff) this.camOff.lerp(off, Math.min(1, dt * (cfg.smooth ?? 14)));
    else this.camOff = off.clone();
    this.camPos.set(p.x, p.y, p.z).add(this.camOff);
    if (!snap) this.camVel.copy(this.camPos).sub(prev).divideScalar(Math.max(dt, 1e-3));
    camera.position.copy(this.camPos);
    if (this.shake > 0) {
      camera.position.x += (Math.random() - 0.5) * this.shake * 0.3;
      camera.position.y += (Math.random() - 0.5) * this.shake * 0.3;
      this.shake = Math.max(0, this.shake - dt * 2.5);
    }
    if (p.rough) camera.position.y += (Math.random() - 0.5) * 0.04 * Math.min(1, sp / 20) * p.rough;
    camera.lookAt(look);
    camera.rotateZ(-this.latS * 0.0028); // 横Gで少し傾く
    camera.fov += (fov - camera.fov) * (snap ? 1 : Math.min(1, dt * 3));
    camera.updateProjectionMatrix();
  }

  // 速度感: 画面の外周に流れる線と周辺の減光（約 110km/h から）
  speedFx(dt, speed, boost = 0) {
    const cv = this.speedCv, g = this.speedCtx;
    if (!g) return;
    const W = Math.round(innerWidth / 2), H = Math.round(innerHeight / 2);
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    g.clearRect(0, 0, W, H);
    const k = Math.max(0, Math.min(1, (speed - 30) / 38)) + boost;
    if (k <= 0.01 || this.paused) return;
    const cx = W / 2, cy = H * 0.46, R = Math.hypot(W, H) / 2;
    const vg = g.createRadialGradient(cx, cy, R * 0.45, cx, cy, R);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, `rgba(0,0,0,${0.42 * k})`);
    g.fillStyle = vg;
    g.fillRect(0, 0, W, H);
    g.strokeStyle = `rgba(255,255,255,${0.26 * k})`;
    for (const s of this.streaks) {
      s.r += dt * (1.6 + speed * 0.04) * s.w;
      if (s.r > 1) { s.r = 0; s.a = Math.random() * Math.PI * 2; s.w = 0.5 + Math.random(); }
      const r0 = R * (0.55 + s.r * 0.5), r1 = r0 + R * 0.12 * k * s.w;
      g.lineWidth = 1 + s.w;
      g.beginPath();
      g.moveTo(cx + Math.cos(s.a) * r0, cy + Math.sin(s.a) * r0);
      g.lineTo(cx + Math.cos(s.a) * r1, cy + Math.sin(s.a) * r1);
      g.stroke();
    }
  }

  clearSpeedFx() {
    if (this.speedCtx) this.speedCtx.clearRect(0, 0, this.speedCv.width, this.speedCv.height);
  }

  // 車の走りの演出: ブレーキの熱、シフトアップとアクセルオフの炎・音、縁石や接触の振動
  carFeel(dt, c) {
    const f = this.feel;
    if (dt <= 0) return;
    f.heat = Math.max(0, f.heat + (c.braking * Math.min(1, (c.speed || 0) / 30) * 0.9 - 0.22) * dt);
    f.heat = Math.min(1.4, f.heat);
    c.discHeat = f.heat;
    f.flameCd -= dt;
    const upshift = c.gear > f.gear && c.gear >= 3;
    const lift = f.thr > 0.8 && c.throttle < 0.15 && c.rpm > 5600;
    if ((upshift || lift) && f.flameCd <= 0) {
      this.fx.flame(c);
      C.audio.pop(upshift ? 0.3 : 0.4);
      f.flameCd = 0.25;
      if (upshift) this.shake = Math.max(this.shake, 0.12);
    }
    f.gear = c.gear;
    f.thr = c.throttle;
    // 振動（対応端末のみ）
    f.curbT -= dt;
    if ((c.onCurb || c.offTrack) && (c.speed || 0) > 8 && f.curbT <= 0) { this.vibrate(c.offTrack ? 18 : 10); f.curbT = 0.12; }
    if (c.impact > 3) this.vibrate(Math.min(80, c.impact * 8));
    this.speedFx(dt, c.speed || 0, (c.draft || 0) * 0.35);
    const dEl = $('#hDraft');
    const dk = c.draft || 0;
    dEl.classList.toggle('on', dk > 0.15 && (c.speed || 0) > 20);
    dEl.style.setProperty('--k', dk.toFixed(2));
  }

  vibrate(ms) {
    try { if (navigator.vibrate) navigator.vibrate(ms); } catch { /* 非対応 */ }
  }

  // 車用カメラ（0: 追従 / 1: 引き / 2: ボンネット）
  carCamera(dt, snap, c) {
    const camera = C.camera;
    const mode = this.camMode;
    if (mode === 2) {
      let d = 0;
      if (!snap) {
        d = c.psi - this.camYaw;
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
      }
      this.camYaw = snap ? c.psi : this.camYaw + d * Math.min(1, dt * 30);
      const hx = Math.sin(c.psi), hz = Math.cos(c.psi);
      const pos = new THREE.Vector3(c.x + hx * 0.2, c.y + 1.12, c.z + hz * 0.2);
      const look = new THREE.Vector3(c.x + hx * 20, c.y + 0.9 + Math.sin(c.slopePitch || 0) * 20, c.z + hz * 20);
      let fov = 68 + (c.speed || 0) * 0.08;
      if (camera.userData.portrait) fov += 22;
      if (!snap) {
        this.camVel.copy(pos).sub(this.camPos).divideScalar(Math.max(dt, 1e-3));
        this.camPos.lerp(pos, Math.min(1, dt * 60));
      } else this.camPos.copy(pos);
      camera.position.copy(this.camPos);
      camera.lookAt(look);
      camera.fov += (fov - camera.fov) * (snap ? 1 : Math.min(1, dt * 3));
      camera.updateProjectionMatrix();
      return;
    }
    this.followCamera(dt, snap, { ...c, latG: c.u * c.r, longG: c.ax, rough: c.onCurb || c.offTrack ? 1 : 0 }, { dist: mode === 1 ? 9.5 : 6.4, hgt: mode === 1 ? 3.3 : 2.05, lookAhead: 4, lookY: 0.95, fov: 58, fovSpeed: 0.16 });
  }

  setPaused(p) {
    this.paused = p;
    $('#pause').classList.toggle('show', p);
    if (p) C.audio.suspend(); else { C.audio.resume(); this.last = performance.now(); }
  }

  dispose() {
    this.clearSpeedFx();
    if (this.world && this.world.scene) {
      this.world.scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    }
  }
}
