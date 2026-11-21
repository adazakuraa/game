// GT サーキットのゲーム（レース / タイムアタック）
import * as THREE from 'three';
import { Race, DIFFICULTY } from '../sim/race.js';
import { World } from '../render/world.js';
import { buildCar } from '../render/carmodel.js';
import { Effects } from '../render/effects.js';
import { store } from '../store.js';
import { garage, raceReward, TA_LAP_COINS, TA_BEST_COINS, MEDALS, medalOf } from '../garage.js';
import { GameBase } from './base.js';
import { C, $, fmt, drawTrackMap, isTouch } from './common.js';

export class CircuitGame extends GameBase {
  constructor(track, opts) {
    super(opts);
    this.resetHud();
    this.track = track;
    C.applyQuality();
    this.world = new World(C.renderer, track, opts.quality);
    this.scene = this.world.scene;
    C.renderer.toneMappingExposure = track.def.env.exposure;
    this.fx = new Effects(this.scene, track, { rain: this.world.rain, quality: opts.quality });
    this.fx.setViewport(innerHeight * C.renderer.getPixelRatio());
    this.race = new Race(track, {
      mode: opts.mode,
      difficulty: opts.difficulty,
      laps: opts.laps,
      playerColor: garage.look().color,
      assist: opts.assist,
    });
    // 車のモデル（プレイヤーはガレージで選んだ見た目）
    this.look = garage.look();
    this.models = new Map();
    this.incidents = 0;
    this.lastIncident = -9;
    this.reward = null;
    for (const e of this.race.entries) {
      const m = e.kind === 'player'
        ? buildCar({ quality: opts.quality, look: this.look })
        : buildCar({ color: e.color, num: e.num, quality: opts.quality, rimDark: e.num % 2 === 0 });
      this.scene.add(m.root);
      this.models.set(e, m);
    }
    // プレイヤーのヘッドライト（夜・雨）
    const pm = this.models.get(this.race.player);
    if (this.world.night || this.world.rain) {
      const spot = new THREE.SpotLight(0xfff2dd, this.world.night ? 60 : 25, 140, 0.42, 0.5, 1.3);
      spot.position.set(0, 0.7, 2.0);
      spot.target.position.set(0, 0, 30);
      pm.root.add(spot, spot.target);
      // CPU のヘッドライトは光の円錐で表現
      const coneGeo = new THREE.ConeGeometry(2.4, 14, 16, 1, true);
      coneGeo.translate(0, -7, 0);
      coneGeo.rotateX(-Math.PI / 2 - 0.04);
      const coneMat = new THREE.MeshBasicMaterial({ color: 0xfff0d0, transparent: true, opacity: 0.05, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      for (const [e, m] of this.models) {
        const c = new THREE.Mesh(coneGeo, coneMat);
        c.position.set(0, 0.6, 2.2);
        if (e.kind === 'player') c.visible = false;
        m.root.add(c);
      }
    }
    // ゴースト
    this.ghost = null;
    // タイムアタックの記録は「1・2周目の合計」。ゴーストもその2周を再生する
    this.taKey = 'ta12.' + track.def.id;
    this.ghostData = opts.mode === 'ta' ? store.get(this.taKey, null) : null;
    this.prevLap = null; // 1周目 { time, frames }
    if (this.ghostData) this.ghostProgress();
    if (this.ghostData) this.makeGhost();
    // カメラ
    this.camMode = store.get('cam2', 2);
    this.camYaw = this.race.player.car.psi;
    this.camPos = new THREE.Vector3();
    this.camVel = new THREE.Vector3();
    this.shake = 0;
    this.paused = false;
    this.acc = 0;
    this.msgTimer = 0;
    this.finishedAt = 0;
    this.lastLightN = -1;
    this.mini = $('#minimap');
    this.miniBg = document.createElement('canvas');
    this.miniBg.width = this.miniBg.height = 200;
    this.miniP = drawTrackMap(this.miniBg, track, { w: 5, pad: 14, color: 'rgba(255,255,255,0.85)', ...(track.stageEnd ? { range: [0, track.stageN] } : {}) });
    this.resetCamera();
    $('#hLaps').textContent = opts.mode === 'race' ? opts.laps : '∞';
    $('#hTot').textContent = this.race.entries.length;
    $('#hud .pos').style.display = opts.mode === 'race' ? '' : 'none';
    $('#hStand').style.display = opts.mode === 'race' ? '' : 'none';
    this.bestLap = Infinity;
    this.best2 = opts.mode === 'ta' && this.ghostData ? this.ghostData.time : Infinity;
    $('#hBest').textContent = fmt(opts.mode === 'ta' ? this.best2 : Infinity);
    $('#hLast').textContent = fmt(0);
    if (opts.mode === 'ta') { $('#hBestL').textContent = this.race.stage ? 'BEST' : '2周BEST'; $('#hLaps').textContent = '2'; this.updateTarget(); }
    if (this.race.stage) $('#hLapBox').innerHTML = 'SECTION <span id="hLap">1</span>/<span id="hLaps">3</span>';
    C.input.setMode(opts.steer);
    C.input.sens = opts.sens;
    $('#hMsg').classList.remove('show');
    $('#hSubMsg').classList.remove('show');
    $('#hDelta').textContent = '';
    $('#hStand').innerHTML = '';
    $('#steerHint').classList.remove('hide');
    document.body.classList.toggle('force-touch', isTouch);
  }

  // ゴーストの各フレームが計測区間の始まり（コントロールライン）から何 m 進んだ位置か
  ghostProgress() {
    const f = this.ghostData.frames, n = f.length / 4, L = this.track.length;
    const out = new Float32Array(n), pj = {};
    let hint = -1, prev = 0, acc = 0;
    for (let i = 0; i < n; i++) {
      this.track.project(f[i * 4], f[i * 4 + 2], hint, pj);
      hint = pj.i;
      if (i === 0) acc = pj.s > L / 2 ? pj.s - L : pj.s; // グリッド発進ならラインの手前（マイナス）
      else { let d = pj.s - prev; if (d < -L / 2) d += L; if (d > L / 2) d -= L; acc += d; }
      prev = pj.s;
      out[i] = acc;
    }
    this.ghostProg = out;
  }

  makeGhost() {
    const g = buildCar({ color: 0x66ccff, num: 0, quality: 0 });
    const mat = new THREE.MeshBasicMaterial({ color: 0x8fd8ff, transparent: true, opacity: 0.28, depthWrite: false });
    g.root.traverse((o) => { if (o.isMesh) { o.material = mat; o.castShadow = false; } });
    g.shadow.visible = false;
    this.scene.add(g.root);
    this.ghost = g;
    g.root.visible = false;
  }

  begin() {
    // タイムアタックもレースと同じくスタートシグナルから計測
    this.race.startCountdown();
    this.showMsg('', 0);
    this.subMsg('アクセルで回転を上げて待て', 3);
    super.begin();
  }

  resetCamera() {
    const c = this.race.player.car;
    this.camYaw = c.psi;
    this.updateCamera(0, true);
  }



  handleEvents() {
    const r = this.race;
    for (const ev of r.events) {
      if (ev.type === 'tick') {
        this.countdown(ev.n);
      } else if (ev.type === 'go') {
        this.world.setStartLights(0, false);
        this.countdown(0);
      } else if (ev.type === 'wall' || ev.type === 'hit') {
        // 強い接触は 1.2 秒以上あけて 1 回と数える（クリーンレース判定用）
        if (ev.power > (ev.type === 'wall' ? 3 : 1.5)) {
          if (r.time - this.lastIncident > 1.2) this.incidents++;
          this.lastIncident = r.time;
        }
        C.audio.impact(ev.power);
        this.shake = Math.min(1, this.shake + ev.power * 0.06);
        if (ev.power > 6) {
          const c = r.player.car;
          this.fx.sparks(c.x, c.y, c.z, c.vx, c.vz, 10);
        }
      } else if (ev.type === 'shortcut') {
        this.subMsg('ショートカット！ 路面に注意', 1.6);
      } else if (ev.type === 'fell') {
        this.showMsg('谷に落ちた！', 1.3, '#ff3b2f', true);
        this.subMsg('ジャンプ台には十分な速さで', 2);
        this.resetCamera?.();
        C.audio.impact(5);
      } else if (ev.type === 'recover') {
        this.showMsg('コースに戻ります', 1.2, '#fff', true);
        this.resetCamera?.();
        C.audio.beep(520, 0.15, 0.2);
      } else if (ev.type === 'wrongway') {
        this.showMsg('逆走！', 1.4, '#ff3b2f', true);
        this.subMsg('このまま続くとコースに戻します', 2);
      } else if (ev.type === 'lap') {
        this.onLap(ev);
      } else if (ev.type === 'taFinish') {
        this.finishedAt = performance.now();
        const res = this.taResult;
        // メダル（初めて届いた段階ぶんのコイン）
        const md = this.track.def.medals;
        if (res && md) {
          const m = medalOf(ev.total, md);
          const pk = 'medalPaid.' + this.track.def.id;
          const paid = store.get(pk, 3);
          let bonus = 0;
          if (m >= 0) for (let i = m; i < paid; i++) bonus += MEDALS[i].coins;
          if (m >= 0 && m < paid) store.set(pk, m);
          res.medal = m;
          res.medalBonus = bonus;
          if (bonus) { garage.addCoins(bonus); this.taCoins = (this.taCoins || 0) + bonus; setTimeout(() => this.toastCoins(bonus), 900); }
          if (m >= 0) { C.audio.beep(1047, 0.12, 0.22); setTimeout(() => C.audio.beep(1568, 0.35, 0.24), 120); }
          this.updateTarget();
        }
        if (this.ghost) this.ghost.root.visible = false;
        $('#hDelta').textContent = '';
        const mm = res && res.medal >= 0 ? MEDALS[res.medal] : null;
        this.showMsg(mm ? `${mm.name} MEDAL!` : res && res.newBest ? 'NEW RECORD!' : 'FINISH', 4, mm ? mm.color : res && res.newBest ? '#ffd000' : '#fff');
        this.subMsg('2周 ' + fmt(ev.total), 4);
        setTimeout(() => { if (C.game() === this) this.showResults(); }, 3500);
      } else if (ev.type === 'finish') {
        this.finishedAt = performance.now();
        const p = ev.position;
        this.showMsg(p === 1 ? 'WINNER!' : `P${p}`, 4, p === 1 ? '#ffd000' : '#fff');
        this.subMsg('FINISH', 4);
        const key = 'rank.' + this.track.def.id + '.' + this.opts.difficulty;
        const prev = store.get(key, null);
        // コイン報酬
        const me = r.player;
        const bestAll = Math.min(...r.entries.map((x) => x.best));
        this.reward = raceReward({
          position: p,
          difficulty: this.opts.difficulty,
          laps: this.opts.laps,
          fastestLap: isFinite(me.best) && me.best <= bestAll + 1e-6,
          clean: this.incidents <= 2,
          firstPodium: p <= 3 && (prev == null || prev > 3),
          firstWin: p === 1 && prev !== 1,
        });
        garage.addCoins(this.reward.total);
        this.toastCoins(this.reward.total);
        if (!prev || p < prev) store.set(key, p);
        setTimeout(() => { if (C.game() === this) this.showResults(); }, 3500);
      }
    }
  }

  onLap(ev) {
    const r = this.race;
    const isTA = this.opts.mode === 'ta';
    if (ev.time < this.bestLap) this.bestLap = ev.time;
    if (!isTA) {
      // レースのラップは記録として残さない
      $('#hLast').textContent = fmt(ev.time);
      $('#hBest').textContent = fmt(this.bestLap);
      if (r.player.lap === r.laps) this.showMsg('FINAL LAP', 1.1, '#ffb000', true);
      return;
    }
    // タイムアタック: 1・2周目の合計で記録する
    $('#hLast').textContent = fmt(ev.time);
    let newBest = false;
    // セクションコースは1本で記録（前の周を 0 秒・空として扱う）
    if (r.stage && !this.prevLap) this.prevLap = { time: 0, frames: [], stage: true };
    if (!this.prevLap) {
      this.prevLap = { time: ev.time, frames: ev.frames };
      this.showMsg('FINAL LAP', 1.1, '#ffb000', true);
      this.subMsg(`1周目 ${fmt(ev.time)}`, 3);
    } else {
      const prev = this.prevLap;
      const total = prev.time + ev.time;
      const saved = store.get(this.taKey, null);
      const laps = prev.stage ? [ev.time] : [prev.time, ev.time];
      this.taResult = { laps, total, prevBest: saved ? saved.time : null };
      if (!saved || total < saved.time) {
        newBest = true;
        const frames = prev.frames.concat(ev.frames).map((v) => Math.round(v * 100) / 100);
        store.set(this.taKey, { time: total, laps, frames });
        this.ghostData = { time: total, frames };
        this.ghostProgress();
        if (!this.ghost) this.makeGhost();
        this.best2 = total;
        $('#hBest').textContent = fmt(total);
      }
      this.taResult.newBest = newBest;
    }
    const coins = TA_LAP_COINS + (newBest ? TA_BEST_COINS : 0);
    this.taCoins = (this.taCoins || 0) + coins;
    garage.addCoins(coins);
    this.toastCoins(coins);
  }

  // タイムアタックの次の目標（まだ取っていない一つ上のメダル）を右上に出す
  updateTarget() {
    const md = this.track.def.medals;
    const el = $('#hTarget');
    if (!md) { el.className = 't-sub t-target'; return; }
    const b = medalOf(this.best2, md);
    const i = b < 0 ? 2 : Math.max(0, b - 1);
    const M = MEDALS[i];
    el.innerHTML = `<span>${b === 0 ? '獲得済' : '目標'}</span><i class="medal m${i}"></i><b style="color:${M.color}">${fmt(md[i])}</b>`;
    el.className = 't-sub t-target show';
  }

  // 追い抜きをほめる: 順位が 0.6 秒続いたら確定し、上がっていれば演出
  praiseOvertake(dt, pos) {
    const r = this.race;
    if (r.state !== 'racing' || r.player.finished) { this.posAck = pos; return; }
    if (this.posAck == null) this.posAck = pos;
    if (pos !== this.posCand) { this.posCand = pos; this.posHold = 0; }
    this.posHold += dt;
    if (this.posHold < 0.6 || pos === this.posAck) return;
    const gained = this.posAck - pos;
    this.posAck = pos;
    if (gained <= 0) return;
    if (pos === 1) {
      this.showMsg('トップ浮上！', 1.6, '#ffd000', true);
      C.audio.beep(784, 0.12, 0.22); setTimeout(() => C.audio.beep(1047, 0.12, 0.22), 110); setTimeout(() => C.audio.beep(1319, 0.3, 0.24), 220);
    } else {
      this.showMsg(gained > 1 ? `${gained}台抜き！ P${pos}` : `OVERTAKE！ P${pos}`, 1.2, '#3ddc84', true);
      C.audio.beep(660, 0.1, 0.2); setTimeout(() => C.audio.beep(990, 0.22, 0.22), 100);
    }
    const el = $('#hud .pos');
    el.classList.remove('up'); void el.offsetWidth; el.classList.add('up');
  }

  updateCamera(dt, snap = false) {
    this.carCamera(dt, snap, this.race.player.car);
  }

  render(dt) {
    const r = this.race;
    const pc = r.player.car;
    // 車
    for (const [e, m] of this.models) {
      const st = e.kind === 'player' ? e.car : e.ai;
      const steer = e.kind === 'player' ? st.delta : Math.max(-0.3, Math.min(0.3, this.track.sampleArr(this.track.kappa, st.s + 3) * 2.8 + st.latV * 0.02));
      m.update(st, steer);
      const dist = Math.hypot(st.x - pc.x, st.z - pc.z);
      m.setShadows(dist < 45 && this.opts.quality >= 1);
      if (dt > 0) {
        if (e.kind === 'player') {
          const slipAmount = Math.max(pc.slipR * 3.2 - 0.1, pc.slipF * 2.2 - 0.25, 0);
          this.fx.carFx('p', { ...pc, slipAmount, lock: pc.lock, wheelspin: pc.wheelspin, smoke: this.look.smoke }, dt);
          this.fx.driftFx(pc, dt);
        } else if (dist < 120) {
          this.fx.carFx('a' + e.num, { x: st.x, y: st.y, z: st.z, psi: st.psi, vx: st.vx, vz: st.vz, slipAmount: Math.abs(st.slip) * 6 - 0.15, wheelSurf: null }, dt);
          this.fx.driftFx(st, dt);
        }
      }
    }
    // ゴースト
    if (this.ghost && this.ghostData && r.taTiming && !r.player.finished) {
      const t = r.raceTime;
      const f = this.ghostData.frames;
      const n = f.length / 4;
      const k = t * 20;
      const i = Math.floor(k);
      if (i + 1 < n) {
        const a = k - i;
        const o = i * 4, o2 = o + 4;
        let dp = f[o2 + 3] - f[o + 3];
        while (dp > Math.PI) dp -= 2 * Math.PI;
        while (dp < -Math.PI) dp += 2 * Math.PI;
        this.ghost.root.visible = true;
        this.ghost.update({ x: f[o] + (f[o2] - f[o]) * a, y: f[o + 1] + (f[o2 + 1] - f[o + 1]) * a, z: f[o + 2] + (f[o2 + 2] - f[o + 2]) * a, psi: f[o + 3] + dp * a, wheelRot: t * 60 }, 0);
      } else this.ghost.root.visible = false;
    }
    if (this.race.state !== 'countdown') this.carFeel(dt, pc);
    this.updateCamera(dt);
    this.world.followLight(pc.x, pc.y, pc.z);
    if (dt > 0) this.fx.update(dt, C.camera.position, this.camVel);
    // スタートシグナル
    if (r.state === 'countdown') {
      // 3 → 2灯、2 → 4灯、1 → 5灯、GO で消灯
      const n = [0, 2, 4, 5][Math.min(3, Math.floor(r.countdown))];
      if (n !== this.lastLightN) {
        this.lastLightN = n;
        this.world.setStartLights(n, true);
      }
    }
    C.renderer.render(this.scene, C.camera);
    this.updateHUD(dt);
    this.updateAudio();
  }

  updateHUD(dt) {
    const r = this.race;
    const c = r.player.car;
    const kmh = Math.round(Math.abs(c.u) * 3.6);
    $('#hSpd').textContent = kmh;
    $('#hGear').textContent = c.reverse ? 'R' : r.state === 'countdown' || r.state === 'grid' ? 'N' : c.gear;
    $('#hRpm').style.width = Math.min(100, (c.rpm / 8000) * 100) + '%';
    $('#fTcs').classList.toggle('on', this.opts.assist && c.wheelspin === 0 && c.throttle > 0.5 && c.slipR > 0.08);
    $('#fAbs').classList.toggle('on', this.opts.assist && c.braking > 0.5 && c.slipF > 0.07);
    const isRace = this.opts.mode === 'race';
    const lap = Math.max(1, Math.min(r.laps, r.player.lap));
    if (r.stage) {
      // セクションコースは全長を3区間に分けて表示
      const f = Math.max(0, r.progress(r.player)) / (this.track.stageEnd - r.START);
      const sec = Math.min(3, 1 + Math.floor(f * 3));
      $('#hLap').textContent = sec;
      if (sec !== this.lastSec && this.lastSec && r.state === 'racing' && !r.player.finished) this.showMsg(sec === 3 ? 'FINAL SECTION' : `SECTION ${sec}`, 1.1, sec === 3 ? '#ffb000' : '#fff', true);
      this.lastSec = sec;
    } else $('#hLap').textContent = isRace ? lap : Math.min(2, Math.max(1, r.player.laps.length + 1));
    let t = 0;
    if (isRace) t = r.state === 'racing' || r.state === 'finished' ? (r.player.finished ? r.player.finishTime : r.raceTime) : 0;
    else t = r.player.finished ? r.player.finishTime : r.taTiming ? r.raceTime : 0;
    $('#hTime').textContent = fmt(t || 0.0001).replace('--:--.---', '0:00.000');
    if (isRace) {
      const st = r.standings();
      const pos = st.indexOf(r.player) + 1;
      $('#hPos').textContent = pos;
      this.praiseOvertake(dt, pos);
      // 上位と自分の周辺
      const rows = st.map((e, i) => {
        const col = '#' + e.color.toString(16).padStart(6, '0');
        return `<div class="${e === r.player ? 'me' : ''}"><b>${i + 1}</b><span class="dot" style="background:${col}"></span>${e.kind === 'player' ? 'YOU' : e.name}</div>`;
      });
      this._standCount = (this._standCount || 0) + 1;
      if (this._standCount % 10 === 0) $('#hStand').innerHTML = rows.join('');
    } else if (this.ghostData && r.taTiming && !r.player.finished) {
      // ゴーストとの差: 計測区間（連続2周）の中で、同じ距離を進んだ時刻を比べる
      const tw = r.raceTime;
      const my = r.stage ? r.player.car.s : r.progress(r.player);
      const g = this.ghostProg;
      if (g && g.length > 1 && my >= g[0] && my <= g[g.length - 1]) {
        let lo = 0, hi = g.length - 1;
        while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (g[mid] < my) lo = mid; else hi = mid; }
        const a = g[hi] > g[lo] ? (my - g[lo]) / (g[hi] - g[lo]) : 0;
        const delta = tw - (lo + a) / 20;
        const el = $('#hDelta');
        el.textContent = (delta >= 0 ? '+' : '−') + Math.abs(delta).toFixed(2);
        el.className = 't-delta ' + (delta < 0 ? 'neg' : 'pos');
      } else $('#hDelta').textContent = '';
    }
    // ミニマップ
    const m = this.mini.getContext('2d');
    m.clearRect(0, 0, 200, 200);
    m.drawImage(this.miniBg, 0, 0);
    // 自分は車のボディ色に白い縁取り。ほかの車より上に描く
    for (const e of [...r.entries.filter((x) => x !== r.player), r.player]) {
      const p = r.pose(e);
      const [x, y] = this.miniP(p.x, p.z);
      m.beginPath();
      m.arc(x, y, e.kind === 'player' ? 7 : 5, 0, Math.PI * 2);
      m.fillStyle = '#' + e.color.toString(16).padStart(6, '0');
      m.fill();
      m.lineWidth = e.kind === 'player' ? 2.5 : 2;
      m.strokeStyle = e.kind === 'player' ? '#fff' : '#000';
      m.stroke();
    }
    this.tickMessages(dt);
  }

  updateAudio() {
    const r = this.race;
    const c = r.player.car;
    let near = 0, nearRpm = 2000;
    for (const e of r.entries) {
      if (e.kind !== 'ai') continue;
      const d = Math.hypot(e.ai.x - c.x, e.ai.z - c.z);
      const v = 1 / (1 + d * d / 60);
      if (v > near) { near = v; nearRpm = e.ai.rpm; }
    }
    const squeal = c.surfR >= 2 ? 0 : Math.max(0, Math.max(c.slipR, c.slipF * 0.8) * 5 - 0.5) + c.lock * 0.6 + c.wheelspin * 0.5;
    C.audio.update({
      active: !this.paused,
      rpm: c.rpm,
      throttle: c.throttle,
      speed: c.speed || 0,
      squeal: c.offTrack ? 0 : Math.min(1, squeal) * Math.min(1, (c.speed || 0) / 8),
      rumble: (c.offTrack ? 0.8 : 0) + (c.onCurb ? 0.5 : 0),
      rain: this.world.rain,
      aiRpm: nearRpm,
      aiNear: near,
    });
  }

  showResults() {
    const r = this.race;
    if (this.opts.mode === 'ta') {
      const x = this.taResult;
      if (!x) return;
      const md = this.track.def.medals || [];
      let medalHtml = '';
      if (md.length) {
        const m = x.medal ?? -1;
        const got = m >= 0 ? `<div class="medal-big" style="color:${MEDALS[m].color}"><i class="medal m${m}"></i>${MEDALS[m].name} MEDAL${x.medalBonus ? `<span style="font-size:14px;color:#ffd24a"> 初獲得 +${x.medalBonus}</span>` : ''}</div>` : '';
        const nx = m < 0 ? 2 : m - 1;
        const next = m === 0 ? 'すべてのメダルを獲得！' : `次の目標 ${MEDALS[nx].jp}（${fmt(md[nx])}）まで あと ${(x.total - md[nx]).toFixed(3)} 秒`;
        medalHtml = got + `<div class="res-sub">${next}</div>`;
      }
      const diff = x.prevBest == null ? '初記録' : x.newBest ? `自己ベスト更新（−${(x.prevBest - x.total).toFixed(3)}）` : `自己ベスト ${fmt(x.prevBest)}（+${(x.total - x.prevBest).toFixed(3)}）`;
      $('#resTitle').textContent = this.track.def.name;
      $('#resBody').innerHTML = `
        <div class="res-big" style="color:${x.newBest ? '#ffd000' : '#fff'}">${fmt(x.total)}</div>
        ${medalHtml}
        <div class="res-sub">タイムアタック · ${r.stage ? 'スタートからゴールまで' : '1・2周目の合計'} · ${diff}</div>
        <div class="laps-list">${x.laps.map((l, i) => `<span>L${i + 1} ${fmt(l)}</span>`).join('')}</div>
        <div class="coin-rows"><div class="r total"><span>獲得コイン</span><span><i class="coin"></i>+${this.taCoins || 0}</span></div></div>
        <div class="res-sub">所持コイン ${garage.coins}</div>`;
      $('#results').classList.add('show');
      return;
    }
    const res = r.results();
    const me = res.find((x) => x.kind === 'player');
    const laps = r.player.laps;
    const bestIdx = laps.indexOf(Math.min(...laps));
    const rows = res.map((x) => `<tr class="${x.kind === 'player' ? 'me' : ''}"><td class="p">${x.pos}</td><td><span class="sw" style="background:#${x.color.toString(16).padStart(6, '0')}"></span>${x.kind === 'player' ? 'YOU' : x.name}</td><td class="t">${x.pos === 1 ? fmt(x.time) : '+' + (x.time - res[0].time).toFixed(3)}${x.est ? '*' : ''}</td><td class="t">${fmt(x.best)}</td></tr>`).join('');
    const rw = this.reward;
    const coinHtml = rw
      ? `<div class="coin-rows">${rw.rows.map((x) => `<div class="r"><span>${x.label}</span><span><i class="coin"></i>+${x.coins}</span></div>`).join('')}<div class="r total"><span>獲得コイン</span><span><i class="coin"></i>+${rw.total}</span></div></div><div class="res-sub">所持コイン ${garage.coins}。ガレージでパーツを買えます</div>`
      : '';
    $('#resTitle').textContent = this.track.def.name;
    $('#resBody').innerHTML = `
      <div class="res-big" style="color:${me.pos === 1 ? '#ffd000' : '#fff'}">${me.pos === 1 ? 'WINNER' : me.pos + '位'}</div>
      <div class="res-sub">${DIFFICULTY[this.opts.difficulty].label} · ${r.laps}周 · 合計 ${fmt(me.time)}</div>
      <div class="laps-list">${laps.map((l, i) => `<span class="${i === bestIdx ? 'best' : ''}">L${i + 1} ${fmt(l)}</span>`).join('')}</div>
      ${coinHtml}
      <table class="res-table"><tr><td></td><td style="color:var(--sub);font-size:11px">DRIVER</td><td class="t" style="color:var(--sub);font-size:11px">TIME</td><td class="t" style="color:var(--sub);font-size:11px">BEST LAP</td></tr>${rows}</table>
      <div class="res-sub">* はゴール時点からの推定タイム</div>`;
    $('#results').classList.add('show');
  }

}
