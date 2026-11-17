// ロードバイク: 集団で走り、スリップストリームで脚を貯め、最後にスプリントする
import { GameBase } from './base.js';
import { C, $, fmt, drawTrackMap } from './common.js';
import { BikeWorld } from '../render/bikeworld.js';
import { Effects } from '../render/effects.js';
import { buildBike } from '../render/bikemodel.js';
import { BikeRace } from '../sim/bike.js';
import { DIFFICULTY } from '../sim/race.js';
import { garage, raceReward } from '../garage.js';
import { store } from '../store.js';

const css = (n) => '#' + n.toString(16).padStart(6, '0');
const YELLOW = 0xffd200; // 首位の選手のジャージ

export class BikeGame extends GameBase {
  constructor(track, opts) {
    super(opts);
    this.resetHud();
    this.track = track;
    C.applyQuality();
    this.world = new BikeWorld(C.renderer, track, opts.quality);
    this.scene = this.world.scene;
    C.renderer.toneMappingExposure = track.def.env.exposure;
    this.fx = new Effects(this.scene, track, { rain: this.world.rain, quality: opts.quality });
    this.fx.setViewport(innerHeight * C.renderer.getPixelRatio());
    this.look = garage.look();
    this.race = new BikeRace(track, { difficulty: opts.difficulty, laps: opts.laps, playerColor: this.look.color });
    this.models = new Map();
    for (const e of this.race.entries) {
      const me = e.kind === 'player';
      const m = buildBike({ jersey: me ? this.look.color : e.color, frameColor: me ? this.look.wheelColor : 0x202226, num: e.num, quality: opts.quality });
      m.baseColor = me ? this.look.color : e.color;
      this.scene.add(m.root);
      this.models.set(e, m);
    }
    this.leader = null;
    this.incidents = 0;
    this.mini = $('#minimap');
    this.miniBg = document.createElement('canvas');
    this.miniBg.width = this.miniBg.height = 200;
    this.miniP = drawTrackMap(this.miniBg, track, { w: 5, pad: 14, color: 'rgba(255,255,255,0.85)' });
    $('#hLaps').textContent = String(opts.laps);
    $('#hTot').textContent = String(this.race.entries.length);
    $('#fTcs').textContent = 'DRAFT';
    $('#fAbs').textContent = 'SPRINT';
    $('#hLastL').textContent = 'LAST';
    $('#btnGas span').textContent = '全力';
    $('#btnBrake span').textContent = 'ブレーキ';
    document.body.classList.toggle('force-touch', true);
    const r = this.race.player.car;
    this.camYaw = r.psi;
    this.cam(0, true);
  }

  begin() {
    this.subMsg('「全力」でペースアップ（スタミナを使う）。前の選手の真後ろに付くと楽に走れる', 4);
    super.begin();
  }

  cam(dt, snap) {
    const r = this.race.player.car;
    const far = this.camMode === 1;
    this.followCamera(dt, snap, { x: r.x, y: r.y, z: r.z, psi: r.psi, speed: r.v, rough: r.surf === 'cobble' ? 1.5 : 0 }, { dist: far ? 8 : 4.4, hgt: far ? 3.2 : 1.85, lookAhead: 5, lookY: 1.0, fov: 60, fovSpeed: 0.5, follow: 6 });
  }

  handleEvents() {
    const r = this.race;
    for (const ev of r.events) {
      if (ev.type === 'tick') { this.showMsg(String(ev.n), 0.9, '#fff'); C.audio.beep(440, 0.15, 0.2); }
      else if (ev.type === 'go') { this.showMsg('GO!', 0.9, '#3ddc84'); C.audio.beep(880, 0.5, 0.3); }
      else if (ev.type === 'slip') {
        this.incidents++;
        this.showMsg('スリップ！', 1.0, '#ff3b2f', true);
        this.subMsg('コーナーの手前でブレーキを', 2);
        C.audio.impact(4);
        this.shake = 0.8;
      } else if (ev.type === 'wall' || ev.type === 'hit') {
        this.shake = Math.min(0.4, this.shake + 0.05);
      } else if (ev.type === 'lap') {
        $('#hLast').textContent = fmt(ev.time);
        if (ev.best) $('#hBest').textContent = fmt(ev.time);
        if (r.player.lap === r.laps) this.showMsg('FINAL LAP', 1.1, '#ffb000', true);
      } else if (ev.type === 'finish') {
        this.onFinish(ev.position);
      }
    }
  }

  onFinish(p) {
    const r = this.race;
    const def = this.track.def;
    this.showMsg(p === 1 ? 'STAGE WIN!' : `${p}位`, 3.6, p === 1 ? '#ffd000' : '#fff');
    this.subMsg('FINISH', 3.6);
    const key = 'rank.' + def.id + '.' + this.opts.difficulty;
    const prev = store.get(key, null);
    this.reward = raceReward({
      position: p,
      difficulty: this.opts.difficulty,
      laps: this.opts.laps * 1.6,
      fastestLap: false,
      clean: this.incidents === 0,
      firstPodium: p <= 3 && (prev == null || prev > 3),
      firstWin: p === 1 && prev !== 1,
    });
    garage.addCoins(this.reward.total);
    this.toastCoins(this.reward.total);
    if (!prev || p < prev) store.set(key, p);
    setTimeout(() => { if (C.game() === this) this.showResults(); }, 3600);
  }

  render(dt) {
    const r = this.race;
    const pr = r.player.car;
    // 首位の選手は黄色いジャージ
    const st = r.standings();
    if (st[0] !== this.leader) {
      if (this.leader) this.models.get(this.leader).setJersey(this.models.get(this.leader).baseColor);
      this.leader = st[0];
      this.models.get(this.leader).setJersey(YELLOW);
    }
    for (const [e, m] of this.models) {
      const rd = r.pose(e);
      rd.dist = (rd.dist || 0) + (dt > 0 ? rd.v * dt : 0);
      m.update(rd);
      const d = Math.hypot(rd.x - pr.x, rd.z - pr.z);
      m.setShadows(d < 40 && this.opts.quality >= 1);
    }
    this.cam(dt, false);
    this.world.followLight(pr.x, pr.y, pr.z);
    if (dt > 0) this.fx.update(dt, C.camera.position, this.camVel);
    C.renderer.render(this.scene, C.camera);
    this.updateHUD(dt, st);
    this.updateAudio();
  }

  updateHUD(dt, st) {
    const r = this.race;
    const c = r.player.car;
    $('#hSpd').textContent = Math.round(c.v * 3.6);
    $('#hGear').textContent = Math.round(c.power) + 'W';
    const w = c.W / c.wmax;
    const bar = $('#hRpm');
    bar.style.width = Math.max(2, w * 100) + '%';
    bar.style.background = c.blown ? '#ff3b2f' : w < 0.3 ? 'linear-gradient(90deg,#ff3b2f,#ffb000)' : 'linear-gradient(90deg,#ffb000,#3ddc84)';
    $('#fTcs').classList.toggle('on', c.draft < 0.85);
    $('#fAbs').classList.toggle('on', c.throttle > 0.5 && !c.blown);
    const lap = Math.max(1, Math.min(r.laps, r.player.lap));
    $('#hLap').textContent = lap;
    const t = r.player.finished ? r.player.finishTime : r.state === 'countdown' ? 0 : r.raceTime;
    $('#hTime').textContent = fmt(t || 0.0001).replace('--:--.---', '0:00.000');
    const rem = Math.max(0, r.remaining(r.player));
    const el = $('#hDelta');
    el.textContent = c.blown ? '脚が売り切れ！' : `ゴールまで ${(rem / 1000).toFixed(1)} km`;
    el.className = 't-delta ' + (c.blown ? 'pos' : '');
    $('#hPos').textContent = st.indexOf(r.player) + 1;
    this._n = (this._n || 0) + 1;
    if (this._n % 10 === 0) {
      $('#hStand').innerHTML = st.map((e, i) => `<div class="${e === r.player ? 'me' : ''}"><b>${i + 1}</b><span class="dot" style="background:${i === 0 ? '#ffd200' : css(e.color)}"></span>${e.kind === 'player' ? 'YOU' : e.name}</div>`).join('');
    }
    const m = this.mini.getContext('2d');
    m.clearRect(0, 0, 200, 200);
    m.drawImage(this.miniBg, 0, 0);
    for (const e of r.entries) {
      const p = r.pose(e);
      const [x, y] = this.miniP(p.x, p.z);
      m.beginPath();
      m.arc(x, y, e.kind === 'player' ? 7 : 4, 0, Math.PI * 2);
      m.fillStyle = e.kind === 'player' ? '#ffb000' : css(e.color);
      m.fill();
      m.lineWidth = 1.5;
      m.strokeStyle = '#000';
      m.stroke();
    }
    this.tickMessages(dt);
  }

  updateAudio() {
    const c = this.race.player.car;
    C.audio.update({
      active: !this.paused,
      engine: 0,
      rpm: 1000,
      throttle: 0,
      speed: c.v * 1.3,
      squeal: c.braking > 0.3 ? Math.min(0.5, c.v / 30) : 0,
      rumble: c.surf === 'cobble' ? Math.min(1, c.v / 10) : 0,
      rain: this.world.rain,
      aiRpm: 1000,
      aiNear: 0,
    });
  }

  showResults() {
    const r = this.race;
    const res = r.results();
    const me = res.find((x) => x.kind === 'player');
    const rw = this.reward;
    const rows = res.map((x) => `<tr class="${x.kind === 'player' ? 'me' : ''}"><td class="p">${x.pos}</td><td><span class="sw" style="background:${x.pos === 1 ? '#ffd200' : css(x.color)}"></span>${x.kind === 'player' ? 'YOU' : x.name}</td><td class="t">${x.pos === 1 ? fmt(x.time) : '+' + (x.time - res[0].time).toFixed(3)}${x.est ? '*' : ''}</td></tr>`).join('');
    const coinHtml = rw
      ? `<div class="coin-rows">${rw.rows.map((x) => `<div class="r"><span>${x.label}</span><span><i class="coin"></i>+${x.coins}</span></div>`).join('')}<div class="r total"><span>獲得コイン</span><span><i class="coin"></i>+${rw.total}</span></div></div><div class="res-sub">所持コイン ${garage.coins}。ガレージでパーツを買えます</div>`
      : '';
    $('#resTitle').textContent = this.track.def.name;
    $('#resBody').innerHTML = `
      <div class="res-big" style="color:${me.pos === 1 ? '#ffd000' : '#fff'}">${me.pos === 1 ? 'STAGE WIN' : me.pos + '位'}</div>
      <div class="res-sub">${DIFFICULTY[this.opts.difficulty].label} · ${r.laps}周 · タイム ${fmt(me.time)}</div>
      ${coinHtml}
      <table class="res-table"><tr><td></td><td style="color:var(--sub);font-size:11px">RIDER</td><td class="t" style="color:var(--sub);font-size:11px">TIME</td></tr>${rows}</table>`;
    $('#results').classList.add('show');
  }
}
