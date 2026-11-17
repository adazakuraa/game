// ラリー: 一本道のステージをタイムで競うゲーム
import * as THREE from 'three';
import { GameBase } from './base.js';
import { C, $, fmt, drawTrackMap } from './common.js';
import { RallyWorld } from '../render/rallyworld.js';
import { Effects } from '../render/effects.js';
import { buildCar } from '../render/carmodel.js';
import { RallyRun } from '../sim/rally.js';
import { DIFFICULTY } from '../sim/race.js';
import { garage, stageReward } from '../garage.js';
import { store } from '../store.js';

// ペースノートの矢印（左向き。右は反転）
const ARROWS = {
  hairpin: '<path d="M26 36 V14 Q26 6 18 6 Q10 6 10 14 V24" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round"/><polygon points="10,34 4,24 16,24" fill="currentColor"/>',
  medium: '<path d="M22 36 V20 Q22 10 14 10" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round"/><polygon points="4,10 14,4 14,16" fill="currentColor"/>',
  slight: '<path d="M20 36 V24 L14 12" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round"/><polygon points="11,4 19.5,9.8 10.5,14.3" fill="currentColor"/>',
};

function noteHtml(n, dist, first) {
  const shape = n.sev <= 2 ? 'hairpin' : n.sev <= 4 ? 'medium' : 'slight';
  const flip = n.dir === 'R' ? ' style="transform:scaleX(-1)"' : '';
  const d = dist <= 0 ? 'NOW' : Math.round(dist / 10) * 10 + 'm';
  return `<div class="note ${first ? 'n0' : ''} s${n.sev}"><svg class="arrow" viewBox="0 0 40 40"${flip}>${ARROWS[shape]}</svg><span class="sev">${n.sev}</span><span class="dist">${d}</span></div>`;
}

export class RallyGame extends GameBase {
  constructor(track, opts) {
    super(opts);
    this.resetHud();
    this.track = track;
    C.applyQuality();
    this.world = new RallyWorld(C.renderer, track, opts.quality);
    this.scene = this.world.scene;
    C.renderer.toneMappingExposure = track.def.env.exposure;
    this.fx = new Effects(this.scene, track, { rain: false, snow: this.world.snow, quality: opts.quality });
    this.fx.setViewport(innerHeight * C.renderer.getPixelRatio());
    this.look = garage.look();
    this.race = new RallyRun(track, { difficulty: opts.difficulty, assist: opts.assist, playerColor: this.look.color });
    this.model = buildCar({ quality: opts.quality, look: this.look, kit: 'rally' });
    this.scene.add(this.model.root);
    if (this.world.snow) {
      const spot = new THREE.SpotLight(0xfff2dd, 40, 120, 0.42, 0.5, 1.3);
      spot.position.set(0, 0.7, 2.0);
      spot.target.position.set(0, 0, 30);
      this.model.root.add(spot, spot.target);
    }
    this.incidents = 0;
    this.lastIncident = -9;
    this.noteKey = '';
    this.mini = $('#minimap');
    this.miniBg = document.createElement('canvas');
    this.miniBg.width = this.miniBg.height = 200;
    this.miniP = drawTrackMap(this.miniBg, track, { w: 5, pad: 14, color: 'rgba(255,255,255,0.85)', range: [0, track.stageN] });
    // HUD
    $('#hLapBox').textContent = 'STAGE 0%';
    $('#hLastL').textContent = 'SPLIT';
    $('#hBestL').textContent = 'TOP';
    $('#hLast').textContent = '--';
    $('#hBest').textContent = fmt(this.race.leaderTime);
    $('#hTot').textContent = String(this.race.rivals.length + 1);
    $('#hStand').style.display = 'none';
    $('#hNotes').classList.add('show');
    document.body.classList.toggle('force-touch', true);
    this.camYaw = this.race.car.psi;
    this.carCamera(0, true, this.race.car);
  }

  begin() {
    this.subMsg('アクセルで回転を上げて待つ。画面左のペースノートを見て走ろう', 3);
    super.begin();
  }

  stepSim(h, inp) { this.race.step(h, inp); }

  handleEvents() {
    const r = this.race;
    for (const ev of r.events) {
      if (ev.type === 'tick') {
        this.showMsg(String(ev.n), 0.9, '#ffffff');
        C.audio.beep(440, 0.15, 0.2);
      } else if (ev.type === 'go') {
        this.showMsg('GO!', 0.9, '#3ddc84');
        C.audio.beep(880, 0.5, 0.3);
      } else if (ev.type === 'wall') {
        if (ev.power > 3) {
          if (r.time - this.lastIncident > 1.2) this.incidents++;
          this.lastIncident = r.time;
        }
        C.audio.impact(ev.power);
        this.shake = Math.min(1, this.shake + ev.power * 0.06);
        if (ev.power > 6) this.fx.sparks(r.car.x, r.car.y, r.car.z, r.car.vx, r.car.vz, 10);
      } else if (ev.type === 'split') {
        const d = ev.delta;
        $('#hLast').textContent = (d >= 0 ? '+' : '−') + Math.abs(d).toFixed(2);
        this.subMsg(`SPLIT ${ev.n}/4   トップ比 ${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(2)}`, 2.2);
      } else if (ev.type === 'finish') {
        this.onFinish(ev);
      }
    }
  }

  onFinish(ev) {
    const def = this.track.def;
    const p = ev.rank;
    this.showMsg(p === 1 ? 'STAGE WIN!' : `P${p}`, 3.6, p === 1 ? '#ffd000' : '#ffffff');
    this.subMsg(fmt(ev.time), 3.6);
    const rankKey = 'rank.' + def.id + '.' + this.opts.difficulty;
    const prev = store.get(rankKey, null);
    this.reward = stageReward({
      position: p,
      difficulty: this.opts.difficulty,
      clean: this.incidents === 0,
      firstPodium: p <= 3 && (prev == null || prev > 3),
      firstWin: p === 1 && prev !== 1,
    });
    garage.addCoins(this.reward.total);
    this.toastCoins(this.reward.total);
    if (!prev || p < prev) store.set(rankKey, p);
    const best = store.get('rec.' + def.id, null);
    if (!best || ev.time < best.time) store.set('rec.' + def.id, { time: ev.time });
    setTimeout(() => { if (C.game() === this) this.showResults(); }, 3800);
  }

  render(dt) {
    const r = this.race;
    const c = r.car;
    this.model.update(c, c.delta);
    this.model.setShadows(this.opts.quality >= 1);
    if (dt > 0) {
      const slipAmount = Math.max(c.slipR * 3.2 - 0.1, c.slipF * 2.2 - 0.25, 0);
      this.fx.carFx('p', { ...c, slipAmount, lock: c.lock, wheelspin: c.wheelspin, smoke: this.look.smoke, roadSurf: c.roadSurf }, dt);
    }
    this.carCamera(dt, false, c);
    this.world.followLight(c.x, c.y, c.z);
    if (dt > 0) this.fx.update(dt, C.camera.position, this.camVel);
    C.renderer.render(this.scene, C.camera);
    this.updateHUD(dt);
    this.updateAudio();
  }

  updateHUD(dt) {
    const r = this.race;
    const c = r.car;
    $('#hSpd').textContent = Math.round(Math.abs(c.u) * 3.6);
    $('#hGear').textContent = c.reverse ? 'R' : r.state === 'countdown' ? 'N' : c.gear;
    $('#hRpm').style.width = Math.min(100, (c.rpm / 8000) * 100) + '%';
    $('#fTcs').classList.toggle('on', this.opts.assist && c.wheelspin === 0 && c.throttle > 0.5 && c.slipR > 0.08);
    $('#fAbs').classList.toggle('on', this.opts.assist && c.braking > 0.5 && c.slipF > 0.07);
    const t = r.state === 'racing' ? r.time : r.state === 'countdown' ? 0 : r.finishTime;
    $('#hTime').textContent = fmt(t || 0.0001).replace('--:--.---', '0:00.000');
    const pct = Math.max(0, Math.min(100, Math.round((r.progress / r.end) * 100)));
    $('#hLapBox').textContent = `STAGE ${pct}%`;
    if (r.state === 'racing') {
      $('#hPos').textContent = r.provisionalRank();
      const delta = r.time - r.leaderAt(r.progress);
      const el = $('#hDelta');
      el.textContent = 'TOP ' + (delta >= 0 ? '+' : '−') + Math.abs(delta).toFixed(2);
      el.className = 't-delta ' + (delta < 0 ? 'neg' : 'pos');
    }
    // ペースノート: 次の 3 つ
    const up = [];
    for (const n of r.notes) {
      if (n.s + n.len < r.progress) continue;
      if (n.s - r.progress > 800) break;
      up.push(n);
      if (up.length >= 3) break;
    }
    const key = up.map((n) => n.s + n.dir + n.sev + Math.round((n.s - r.progress) / 10)).join('|');
    if (key !== this.noteKey) {
      this.noteKey = key;
      $('#hNotes').innerHTML = up.map((n, i) => noteHtml(n, n.s - r.progress, i === 0)).join('');
    }
    // ミニマップ
    const m = this.mini.getContext('2d');
    m.clearRect(0, 0, 200, 200);
    m.drawImage(this.miniBg, 0, 0);
    const [x, y] = this.miniP(c.x, c.z);
    m.beginPath();
    m.arc(x, y, 7, 0, Math.PI * 2);
    m.fillStyle = '#ffb000';
    m.fill();
    m.lineWidth = 2;
    m.strokeStyle = '#000';
    m.stroke();
    this.tickMessages(dt);
  }

  updateAudio() {
    const c = this.race.car;
    const loose = c.roadSurf === 1 || c.roadSurf === 2 || c.roadSurf === 5;
    const squeal = c.offTrack ? 0 : Math.max(0, Math.max(c.slipR, c.slipF * 0.8) * 5 - 0.5) + c.lock * 0.6 + c.wheelspin * 0.5;
    C.audio.update({
      active: !this.paused,
      rpm: c.rpm,
      throttle: c.throttle,
      speed: c.speed || 0,
      squeal: Math.min(1, squeal) * Math.min(1, (c.speed || 0) / 8) * (loose || c.roadSurf === 3 ? 0.4 : 1),
      rumble: (c.offTrack ? 0.8 : 0) + (loose ? 0.45 : 0),
      rain: false,
      aiRpm: 1000,
      aiNear: 0,
    });
  }

  showResults() {
    const r = this.race;
    const res = r.results();
    const me = res.find((x) => x.kind === 'player');
    const rw = this.reward;
    const rows = res.map((x) => `<tr class="${x.kind === 'player' ? 'me' : ''}"><td class="p">${x.pos}</td><td><span class="sw" style="background:#${x.color.toString(16).padStart(6, '0')}"></span>${x.kind === 'player' ? 'YOU' : x.name}</td><td class="t">${x.pos === 1 ? fmt(x.time) : '+' + (x.time - res[0].time).toFixed(3)}</td></tr>`).join('');
    const coinHtml = rw
      ? `<div class="coin-rows">${rw.rows.map((x) => `<div class="r"><span>${x.label}</span><span><i class="coin"></i>+${x.coins}</span></div>`).join('')}<div class="r total"><span>獲得コイン</span><span><i class="coin"></i>+${rw.total}</span></div></div><div class="res-sub">所持コイン ${garage.coins}。ガレージでパーツを買えます</div>`
      : '';
    const splits = r.splits.map((d, i) => `<span>S${i + 1} ${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(2)}</span>`).join('');
    $('#resTitle').textContent = this.track.def.name;
    $('#resBody').innerHTML = `
      <div class="res-big" style="color:${me.pos === 1 ? '#ffd000' : '#fff'}">${me.pos === 1 ? 'STAGE WIN' : me.pos + '位'}</div>
      <div class="res-sub">${DIFFICULTY[this.opts.difficulty].label} · ステージタイム ${fmt(me.time)}</div>
      <div class="laps-list">${splits}</div>
      ${coinHtml}
      <table class="res-table"><tr><td></td><td style="color:var(--sub);font-size:11px">DRIVER</td><td class="t" style="color:var(--sub);font-size:11px">STAGE TIME</td></tr>${rows}</table>`;
    $('#results').classList.add('show');
  }
}
