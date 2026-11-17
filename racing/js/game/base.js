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
    this.camMode = store.get('cam', 0);
    this.camYaw = 0;
    this.camPos = new THREE.Vector3();
    this.camVel = new THREE.Vector3();
    this.reward = null;
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
    $('#hBestL').textContent = 'BEST';
    $('#hNotes').classList.remove('show');
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
    const pos = new THREE.Vector3(p.x - fx * cfg.dist, p.y + cfg.hgt, p.z - fz * cfg.dist);
    const look = new THREE.Vector3(p.x + fx * (cfg.lookAhead ?? 4), p.y + (cfg.lookY ?? 0.95), p.z + fz * (cfg.lookAhead ?? 4));
    let fov = (cfg.fov ?? 58) + sp * (cfg.fovSpeed ?? 0.16);
    if (camera.userData.portrait) fov += 22;
    if (!snap) {
      const k = Math.min(1, dt * (cfg.smooth ?? 14));
      this.camVel.copy(pos).sub(this.camPos).divideScalar(Math.max(dt, 1e-3));
      this.camPos.lerp(pos, k);
    } else {
      this.camPos.copy(pos);
    }
    if (this.shake > 0) {
      this.camPos.x += (Math.random() - 0.5) * this.shake * 0.3;
      this.camPos.y += (Math.random() - 0.5) * this.shake * 0.3;
      this.shake = Math.max(0, this.shake - dt * 2.5);
    }
    if (p.rough) this.camPos.y += (Math.random() - 0.5) * 0.04 * Math.min(1, sp / 20) * p.rough;
    camera.position.copy(this.camPos);
    camera.lookAt(look);
    camera.fov += (fov - camera.fov) * (snap ? 1 : Math.min(1, dt * 3));
    camera.updateProjectionMatrix();
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
    this.followCamera(dt, snap, { ...c, rough: c.onCurb || c.offTrack ? 1 : 0 }, { dist: mode === 1 ? 9.5 : 6.4, hgt: mode === 1 ? 3.3 : 2.05, lookAhead: 4, lookY: 0.95, fov: 58, fovSpeed: 0.16 });
  }

  setPaused(p) {
    this.paused = p;
    $('#pause').classList.toggle('show', p);
    if (p) C.audio.suspend(); else { C.audio.resume(); this.last = performance.now(); }
  }

  dispose() {
    if (this.world && this.world.scene) {
      this.world.scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    }
  }
}
