// ボートレース（競艇）: 大時計に合わせたフライングスタートから 3 周
import { GameBase } from './base.js';
import { C, $, fmt, drawTrackMap } from './common.js';
import { WaterWorld } from '../render/waterworld.js';
import { Effects } from '../render/effects.js';
import { buildBoat } from '../render/boatmodel.js';
import { BoatRace, LANE_COLORS, START_T } from '../sim/boatrace.js';
import { DIFFICULTY } from '../sim/race.js';
import { garage, raceReward } from '../garage.js';
import { store } from '../store.js';

const css = (n) => '#' + n.toString(16).padStart(6, '0');
const AI_HULLS = [0x2a3442, 0xe8e8e8, 0x3a3f48, 0x1b2a4a, 0x5a5f66, 0x22262c];

export class BoatGame extends GameBase {
  constructor(track, opts) {
    super(opts);
    this.resetHud();
    this.track = track;
    C.applyQuality();
    this.world = new WaterWorld(C.renderer, track, opts.quality);
    this.scene = this.world.scene;
    C.renderer.toneMappingExposure = track.def.env.exposure;
    this.fx = new Effects(this.scene, track, { rain: false, quality: opts.quality });
    this.fx.setViewport(innerHeight * C.renderer.getPixelRatio());
    this.fx.dim = this.world.night ? 0.55 : 1; // 夜は粒子が光って見えないように
    this.look = garage.look();
    this.race = new BoatRace(track, { difficulty: opts.difficulty, laps: opts.laps, playerColor: this.look.color });
    this.race.player.car.assist = opts.assist;
    this.models = new Map();
    for (const e of this.race.entries) {
      const m = buildBoat({
        color: e.kind === 'player' ? this.look.color : AI_HULLS[e.lane - 1],
        finish: e.kind === 'player' ? this.look.finish : 'gloss',
        lane: e.lane,
        laneColor: LANE_COLORS[e.lane - 1],
        quality: opts.quality,
      });
      this.scene.add(m.root);
      this.models.set(e, m);
    }
    this.incidents = 0;
    this.lastIncident = -9;
    this.t = 0;
    this.mini = $('#minimap');
    this.miniBg = document.createElement('canvas');
    this.miniBg.width = this.miniBg.height = 200;
    this.miniP = drawTrackMap(this.miniBg, track, { w: 5, pad: 14, color: 'rgba(255,255,255,0.85)' });
    $('#hLaps').textContent = String(opts.laps);
    $('#hTot').textContent = '6';
    $('#hClock').classList.add('show');
    $('#fTcs').textContent = 'ASSIST';
    $('#fAbs').textContent = 'F';
    document.body.classList.toggle('force-touch', true);
    const c = this.race.player.car;
    this.camYaw = c.psi;
    this.cam(0, true);
  }

  begin() {
    this.subMsg(`${this.race.playerLane}号艇。大時計が 0 になる瞬間にスタートラインを越えよう（早いとフライング）`, 4.5);
    super.begin();
  }

  cam(dt, snap) {
    const c = this.race.player.car;
    const far = this.camMode === 1;
    this.followCamera(dt, snap, c, { dist: far ? 11 : 7.2, hgt: far ? 4.2 : 2.6, lookAhead: 6, lookY: 0.6, fov: 60, fovSpeed: 0.3, follow: 4.5 });
  }

  handleEvents() {
    const r = this.race;
    for (const ev of r.events) {
      if (ev.type === 'go') {
        C.audio.beep(880, 0.5, 0.3);
      } else if (ev.type === 'start' && ev.entry.kind === 'player') {
        const t = ev.timing;
        if (ev.flying) {
          this.showMsg('フライング', 1.6, '#ff3b2f', true);
          this.subMsg(`合図より ${Math.abs(t).toFixed(2)} 秒早かった（+${r.player.penalty} 秒のペナルティ）`, 3);
        } else {
          const label = t < 0.15 ? 'ドンピシャ！' : t < 0.35 ? '好スタート' : t < 0.8 ? 'スタート' : '出遅れ';
          this.showMsg(label, 1.3, t < 0.35 ? '#3ddc84' : '#ffffff', true);
          this.subMsg(`スタートタイミング ${t.toFixed(2)}`, 2.5);
        }
      } else if (ev.type === 'wall' || ev.type === 'hit') {
        if (ev.power > (ev.type === 'wall' ? 3 : 1.5)) {
          if (r.time - this.lastIncident > 1.2) this.incidents++;
          this.lastIncident = r.time;
        }
        C.audio.impact(ev.power * 0.7);
        this.shake = Math.min(1, this.shake + ev.power * 0.05);
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
    this.showMsg(p === 1 ? 'WINNER!' : `${p}着`, 3.6, p === 1 ? '#ffd000' : '#fff');
    this.subMsg('FINISH', 3.6);
    const key = 'rank.' + def.id + '.' + this.opts.difficulty;
    const prev = store.get(key, null);
    const bestAll = Math.min(...r.entries.map((x) => x.best));
    this.reward = raceReward({
      position: p,
      difficulty: this.opts.difficulty,
      laps: this.opts.laps,
      fastestLap: isFinite(r.player.best) && r.player.best <= bestAll + 1e-6,
      clean: this.incidents <= 2 && !r.player.flying,
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
    this.t += dt;
    const pc = r.player.car;
    for (const [e, m] of this.models) {
      const st = r.pose(e);
      const pose = e.kind === 'player' ? st : { x: st.x, y: 0, z: st.z, psi: st.psi, pitch: (st.v / 24) * 0.05, roll: -st.slip * 3, wheelRot: st.wheelRot };
      m.update(pose, 0, this.t);
      if (dt > 0) {
        const d = Math.hypot(st.x - pc.x, st.z - pc.z);
        if (e.kind === 'player') this.fx.boatFx(pc, dt, 1);
        else if (d < 90) this.fx.boatFx({ x: st.x, z: st.z, psi: st.psi, vx: Math.sin(st.psi) * st.v, vz: Math.cos(st.psi) * st.v, throttle: st.throttle, r: st.slip }, dt, 0.6);
      }
    }
    this.cam(dt, false);
    this.world.followLight(pc.x, 0, pc.z);
    this.world.setClock(r.clock);
    this.world.tick(dt);
    if (dt > 0) this.fx.update(dt, C.camera.position, this.camVel);
    C.renderer.render(this.scene, C.camera);
    this.updateHUD(dt);
    this.updateAudio();
  }

  updateHUD(dt) {
    const r = this.race;
    const c = r.player.car;
    $('#hSpd').textContent = Math.round(Math.abs(c.u) * 3.6);
    $('#hGear').textContent = String(r.playerLane);
    $('#hGear').style.color = css(LANE_COLORS[r.playerLane - 1]);
    $('#hRpm').style.width = Math.min(100, ((c.rpm - 2000) / 6400) * 100) + '%';
    $('#fTcs').classList.toggle('on', this.opts.assist && c.throttle > 0.5 && c.slipR > 0.12);
    $('#fAbs').classList.toggle('on', r.player.flying);
    // 大時計
    const el = $('#hClock');
    if (r.player.lap === 0) {
      const remain = r.clock;
      el.querySelector('b').textContent = remain > 0 ? remain.toFixed(1) : '0.0';
      el.querySelector('small').textContent = `スタートラインまで ${Math.max(0, Math.round(r.distToLine()))} m`;
      el.classList.toggle('hot', remain < 3 && remain > 0);
      el.classList.toggle('go', remain <= 0);
    } else if (el.classList.contains('show') && r.raceTime > 3) {
      el.classList.remove('show');
    } else if (r.player.startTiming != null) {
      el.querySelector('b').textContent = (r.player.flying ? 'F ' : '') + r.player.startTiming.toFixed(2);
      el.querySelector('small').textContent = 'スタートタイミング';
      el.classList.toggle('bad', r.player.flying);
    }
    const lap = Math.max(1, Math.min(r.laps, r.player.lap));
    $('#hLap').textContent = lap;
    const t = r.player.finished ? r.player.finishTime : r.raceTime;
    $('#hTime').textContent = fmt(t || 0.0001).replace('--:--.---', '0:00.000');
    const st = r.standings();
    $('#hPos').textContent = st.indexOf(r.player) + 1;
    this._n = (this._n || 0) + 1;
    if (this._n % 10 === 0) {
      $('#hStand').innerHTML = st.map((e, i) => `<div class="${e === r.player ? 'me' : ''}"><b>${i + 1}</b><span class="dot" style="background:${css(LANE_COLORS[e.lane - 1])};outline:1px solid #888"></span>${e.lane}号艇 ${e.kind === 'player' ? 'YOU' : e.name}${e.flying ? ' F' : ''}</div>`).join('');
    }
    // ミニマップ
    const m = this.mini.getContext('2d');
    m.clearRect(0, 0, 200, 200);
    m.drawImage(this.miniBg, 0, 0);
    for (const e of r.entries) {
      const p = r.pose(e);
      const [x, y] = this.miniP(p.x, p.z);
      m.beginPath();
      m.arc(x, y, e.kind === 'player' ? 7 : 5, 0, Math.PI * 2);
      m.fillStyle = css(LANE_COLORS[e.lane - 1]);
      m.fill();
      m.lineWidth = e.kind === 'player' ? 3 : 1.5;
      m.strokeStyle = e.kind === 'player' ? '#ffb000' : '#000';
      m.stroke();
    }
    this.tickMessages(dt);
  }

  updateAudio() {
    const r = this.race;
    const c = r.player.car;
    let near = 0, nearRpm = 3000;
    for (const e of r.entries) {
      if (e.kind !== 'ai') continue;
      const d = Math.hypot(e.ai.x - c.x, e.ai.z - c.z);
      const v = 1 / (1 + (d * d) / 80);
      if (v > near) { near = v; nearRpm = e.ai.rpm; }
    }
    C.audio.update({
      active: !this.paused,
      rpm: c.rpm * 1.25,
      throttle: c.throttle,
      speed: c.speed || 0,
      squeal: 0,
      rumble: Math.min(1, (c.speed || 0) / 30) * 0.35,
      rain: true, // 水しぶきのザーッという音に流用
      aiRpm: nearRpm * 1.25,
      aiNear: near,
    });
  }

  showResults() {
    const r = this.race;
    const res = r.results();
    const me = res.find((x) => x.kind === 'player');
    const rw = this.reward;
    const byName = new Map(r.entries.map((e) => [e.kind === 'player' ? 'YOU' : e.name, e]));
    const rows = res.map((x) => {
      const e = byName.get(x.kind === 'player' ? 'YOU' : x.name);
      return `<tr class="${x.kind === 'player' ? 'me' : ''}"><td class="p">${x.pos}</td><td><span class="sw" style="background:${css(LANE_COLORS[e.lane - 1])};outline:1px solid #888"></span>${e.lane}号艇 ${x.kind === 'player' ? 'YOU' : x.name}${e.flying ? ' <b style="color:#ff3b2f">F</b>' : ''}</td><td class="t">${x.pos === 1 ? fmt(x.time) : '+' + (x.time - res[0].time).toFixed(3)}${x.est ? '*' : ''}</td><td class="t">${e.startTiming != null ? e.startTiming.toFixed(2) : '-'}</td></tr>`;
    }).join('');
    const coinHtml = rw
      ? `<div class="coin-rows">${rw.rows.map((x) => `<div class="r"><span>${x.label}</span><span><i class="coin"></i>+${x.coins}</span></div>`).join('')}<div class="r total"><span>獲得コイン</span><span><i class="coin"></i>+${rw.total}</span></div></div><div class="res-sub">所持コイン ${garage.coins}。ガレージでパーツを買えます</div>`
      : '';
    $('#resTitle').textContent = this.track.def.name;
    $('#resBody').innerHTML = `
      <div class="res-big" style="color:${me.pos === 1 ? '#ffd000' : '#fff'}">${me.pos === 1 ? 'WINNER' : me.pos + '着'}</div>
      <div class="res-sub">${DIFFICULTY[this.opts.difficulty].label} · ${r.laps}周 · ${r.playerLane}号艇${r.player.flying ? ' · フライング +' + r.player.penalty + '秒' : ''}</div>
      <div class="laps-list">${r.player.laps.map((l, i) => `<span>${i + 1}周 ${fmt(l)}</span>`).join('')}</div>
      ${coinHtml}
      <table class="res-table"><tr><td></td><td style="color:var(--sub);font-size:11px">BOAT</td><td class="t" style="color:var(--sub);font-size:11px">TIME</td><td class="t" style="color:var(--sub);font-size:11px">ST</td></tr>${rows}</table>
      <div class="res-sub">ST はスタートタイミング（0 に近いほど良い。マイナスはフライング）</div>`;
    $('#results').classList.add('show');
  }
}
void START_T;
