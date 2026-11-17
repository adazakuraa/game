// APEX LINE — メイン（メニュー・ゲームループ・カメラ・HUD・ゴースト）
import * as THREE from 'three';
import { TRACKS } from './sim/trackdata.js';
import { Track } from './sim/track.js';
import { Race, DIFFICULTY, calibrate } from './sim/race.js';
import { World } from './render/world.js';
import { buildCar } from './render/carmodel.js';
import { Effects } from './render/effects.js';
import { Input } from './ui/input.js';
import { Audio } from './audio.js';

const $ = (s) => document.querySelector(s);
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

window.addEventListener('error', (e) => { $('#err').textContent = 'Error: ' + e.message; });
window.addEventListener('unhandledrejection', (e) => { $('#err').textContent = 'Error: ' + (e.reason && e.reason.message || e.reason); });

// ---------- 保存 ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem('apexline.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('apexline.' + k, JSON.stringify(v)); } catch { /* 容量不足など */ } },
};

const COLORS = [0xd0101c, 0x1450c8, 0xf0f0f0, 0x101012, 0xffb300, 0x13a05a, 0xff5f1f, 0x8e44ff];
const settings = Object.assign({
  mode: 'race', track: 0, difficulty: 'normal', laps: 3, color: 0,
  steer: 'slide', sens: 1, assist: true, quality: isTouch ? 1 : 2, volume: 0.8,
}, store.get('settings', {}));
const saveSettings = () => store.set('settings', settings);

function fmt(t) {
  if (!isFinite(t) || t <= 0) return '--:--.---';
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}

// ---------- レンダラー ----------
const canvas = $('#gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 6000);

function applyQuality() {
  const q = settings.quality;
  const dpr = window.devicePixelRatio || 1;
  const cap = q >= 2 ? (isTouch ? 1.6 : 2) : q === 1 ? (isTouch ? 1.25 : 1.5) : 1;
  renderer.setPixelRatio(Math.min(dpr, cap));
  renderer.shadowMap.enabled = q >= 1;
  resize();
}
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // 縦持ちでは視野を広げる
  camera.userData.portrait = h > w;
  camera.updateProjectionMatrix();
  if (game && game.fx) game.fx.setViewport(h * renderer.getPixelRatio());
}
addEventListener('resize', resize);

const input = new Input($('#hud'));
const audio = new Audio();
let game = null;

// ---------- メニュー ----------
function drawTrackMap(cv, track, opts = {}) {
  const ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  ctx.clearRect(0, 0, W, H);
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < track.N; i++) {
    minX = Math.min(minX, track.x[i]); maxX = Math.max(maxX, track.x[i]);
    minZ = Math.min(minZ, track.z[i]); maxZ = Math.max(maxZ, track.z[i]);
  }
  const pad = opts.pad ?? 10;
  const sc = Math.min((W - pad * 2) / (maxX - minX), (H - pad * 2) / (maxZ - minZ));
  const ox = W / 2 - ((minX + maxX) / 2) * sc, oz = H / 2 - ((minZ + maxZ) / 2) * sc;
  // 真上から見た向き（x は右、z は下。3D ビューの左右と一致する）
  const P = (x, z) => [ox + x * sc, oz + z * sc];
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const path = () => {
    ctx.beginPath();
    for (let i = 0; i <= track.N; i += 2) {
      const j = i % track.N;
      const [a, b] = P(track.x[j], track.z[j]);
      if (i === 0) ctx.moveTo(a, b); else ctx.lineTo(a, b);
    }
    ctx.closePath();
  };
  ctx.strokeStyle = opts.edge ?? 'rgba(0,0,0,0.6)';
  ctx.lineWidth = (opts.w ?? 4) + 3;
  path(); ctx.stroke();
  ctx.strokeStyle = opts.color ?? '#e9edf2';
  ctx.lineWidth = opts.w ?? 4;
  path(); ctx.stroke();
  const [sx, sy] = P(track.x[0], track.z[0]);
  ctx.fillStyle = '#ff3b2f';
  ctx.fillRect(sx - 3, sy - 3, 6, 6);
  return P;
}

const trackCache = {};
function getTrack(i) {
  if (!trackCache[i]) trackCache[i] = new Track(TRACKS[i]);
  return trackCache[i];
}

function buildMenu() {
  const list = $('#trackList');
  list.innerHTML = '';
  TRACKS.forEach((def, i) => {
    const card = document.createElement('button');
    card.className = 'card' + (i === settings.track ? ' on' : '');
    const cv = document.createElement('canvas');
    cv.width = 420; cv.height = 200;
    card.appendChild(cv);
    const tr = getTrack(i);
    drawTrackMap(cv, tr, { w: 6, pad: 18 });
    const best = store.get('best.' + def.id, null);
    const rank = store.get('rank.' + def.id + '.' + settings.difficulty, null);
    const recTxt = settings.mode === 'ta'
      ? `ベストラップ ${best ? fmt(best.time) : '--:--.---'}`
      : `最高順位 ${rank ? rank + '位' : '—'}（${DIFFICULTY[settings.difficulty].label}）`;
    card.insertAdjacentHTML('beforeend', `
      <div class="nm">${def.name}</div>
      <div class="en">${def.en} · ${(tr.length / 1000).toFixed(2)} km</div>
      <div class="tags">${def.tags.map((t) => `<i>${t}</i>`).join('')}</div>
      <div class="desc">${def.desc}</div>
      <div class="rec">${recTxt}</div>`);
    card.onclick = () => {
      settings.track = i;
      saveSettings();
      list.querySelectorAll('.card').forEach((c, k) => c.classList.toggle('on', k === i));
    };
    list.appendChild(card);
  });
  const sw = $('#colorSw');
  sw.innerHTML = '';
  COLORS.forEach((c, i) => {
    const b = document.createElement('button');
    b.style.background = '#' + c.toString(16).padStart(6, '0');
    b.className = i === settings.color ? 'on' : '';
    b.onclick = () => {
      settings.color = i;
      saveSettings();
      sw.querySelectorAll('button').forEach((x, k) => x.classList.toggle('on', k === i));
    };
    sw.appendChild(b);
  });
  syncSegs();
}

function seg(id, key, conv = (v) => v, after) {
  const el = $(id);
  el.querySelectorAll('button').forEach((b) => {
    b.onclick = () => {
      settings[key] = conv(b.dataset.v);
      saveSettings();
      syncSegs();
      after && after();
    };
  });
}
function syncSegs() {
  const map = { '#modeSeg': 'mode', '#diffSeg': 'difficulty', '#lapsSeg': 'laps', '#steerSeg': 'steer', '#assistSeg': 'assist', '#qualSeg': 'quality' };
  for (const [id, key] of Object.entries(map)) {
    $(id).querySelectorAll('button').forEach((b) => {
      const v = settings[key];
      b.classList.toggle('on', String(typeof v === 'boolean' ? (v ? 1 : 0) : v) === b.dataset.v);
    });
  }
  const race = settings.mode === 'race';
  $('#diffOpt').style.display = race ? '' : 'none';
  $('#lapsOpt').style.display = race ? '' : 'none';
  $('#menuHint').textContent = race
    ? '最後尾スタート。CPU 7台を抜いて優勝を目指そう。ブレーキングとライン取りが鍵。'
    : 'ひとりで走り込み。自己ベストのゴーストと競える。コントロールラインを越えると計測開始。';
  const notes = {
    slide: '画面左側を指で左右にスライドしてハンドル操作（アナログ）。',
    buttons: '◀ ▶ ボタンでハンドル操作。押している長さで切れ角が増える。',
    tilt: '端末を傾けてハンドル操作。一時停止メニューで中心を合わせられます。',
  };
  $('#steerNote').textContent = notes[settings.steer];
}
seg('#modeSeg', 'mode', (v) => v, buildMenu);
seg('#diffSeg', 'difficulty', (v) => v, buildMenu);
seg('#lapsSeg', 'laps', (v) => parseInt(v, 10));
seg('#steerSeg', 'steer', (v) => v, async () => {
  if (settings.steer === 'tilt') {
    const ok = await input.enableTilt();
    if (!ok) { settings.steer = 'slide'; syncSegs(); }
  }
});
seg('#assistSeg', 'assist', (v) => v === '1');
seg('#qualSeg', 'quality', (v) => parseInt(v, 10), applyQuality);
$('#sensRange').value = settings.sens;
$('#sensRange').oninput = (e) => { settings.sens = parseFloat(e.target.value); saveSettings(); };
$('#volRange').value = settings.volume;
$('#volRange').oninput = (e) => { settings.volume = parseFloat(e.target.value); audio.setVolume(settings.volume); saveSettings(); };
$('#settingsBtn').onclick = () => $('#settings').classList.add('show');
$('#settingsClose').onclick = () => $('#settings').classList.remove('show');
$('#startBtn').onclick = () => startGame();

// ---------- ゲーム ----------
const TIPS = [
  'コーナーの手前の 150 / 100 / 50 の看板がブレーキの目安。',
  'アウト・イン・アウト。コーナーの出口でアクセルを早く踏めるラインを。',
  '芝や砂に出ると大きく失速する。縁石まではセーフ。',
  'ブレーキはまっすぐのうちに。曲がりながらの強いブレーキはアンダーステアの元。',
  'アシストOFFでは自分でアクセルを調整しないと後輪が滑る。',
  'CPU にはそれぞれ得意・不得意なコーナーがある。抜きどころを探そう。',
];

async function startGame() {
  audio.init();
  audio.setVolume(settings.volume);
  if (settings.steer === 'tilt') await input.enableTilt();
  const def = TRACKS[settings.track];
  $('#loadTitle').textContent = def.name;
  $('#loadTip').textContent = 'TIP: ' + TIPS[Math.floor(Math.random() * TIPS.length)];
  $('#menu').classList.remove('show');
  $('#loading').classList.add('show');
  if (isTouch && document.documentElement.requestFullscreen && !document.fullscreenElement) {
    document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
  }
  await new Promise((r) => setTimeout(r, 30));
  if (game) disposeGame();
  const track = getTrack(settings.track);
  calibrate(track);
  game = new Game(track, { ...settings });
  await new Promise((r) => setTimeout(r, 30));
  // 1フレーム描画してシェーダーをコンパイル
  game.render(0);
  renderer.compile(game.world.scene, camera);
  $('#loading').classList.remove('show');
  $('#hud').classList.add('show');
  document.body.classList.add('playing');
  game.begin();
}

function disposeGame() {
  if (!game) return;
  game.world.scene.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
  });
  game = null;
}

class Game {
  constructor(track, opts) {
    this.track = track;
    this.opts = opts;
    applyQuality();
    this.world = new World(renderer, track, opts.quality);
    this.scene = this.world.scene;
    renderer.toneMappingExposure = track.def.env.exposure;
    this.fx = new Effects(this.scene, track, { rain: this.world.rain, quality: opts.quality });
    this.fx.setViewport(innerHeight * renderer.getPixelRatio());
    this.race = new Race(track, {
      mode: opts.mode,
      difficulty: opts.difficulty,
      laps: opts.laps,
      playerColor: COLORS[opts.color],
      assist: opts.assist,
    });
    // 車のモデル
    this.models = new Map();
    for (const e of this.race.entries) {
      const m = buildCar({ color: e.color, num: e.num, quality: opts.quality, rimDark: e.kind === 'ai' && e.num % 2 === 0 });
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
    this.ghostData = opts.mode === 'ta' ? store.get('best.' + track.def.id, null) : null;
    if (this.ghostData) this.makeGhost();
    // カメラ
    this.camMode = store.get('cam', 0);
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
    this.miniP = drawTrackMap(this.miniBg, track, { w: 5, pad: 14, color: 'rgba(255,255,255,0.85)' });
    this.resetCamera();
    $('#hLaps').textContent = opts.mode === 'race' ? opts.laps : '∞';
    $('#hTot').textContent = this.race.entries.length;
    $('#hud .pos').style.display = opts.mode === 'race' ? '' : 'none';
    $('#hStand').style.display = opts.mode === 'race' ? '' : 'none';
    this.bestLap = opts.mode === 'ta' && this.ghostData ? this.ghostData.time : Infinity;
    $('#hBest').textContent = fmt(this.bestLap);
    $('#hLast').textContent = fmt(0);
    input.setMode(opts.steer);
    input.sens = opts.sens;
    $('#hMsg').classList.remove('show');
    $('#hSubMsg').classList.remove('show');
    $('#hDelta').textContent = '';
    $('#hStand').innerHTML = '';
    $('#steerHint').classList.remove('hide');
    document.body.classList.toggle('force-touch', isTouch);
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
    if (this.opts.mode === 'race') {
      this.race.startCountdown();
      this.showMsg('', 0);
      this.subMsg('アクセルで回転を上げて待て', 3);
    } else {
      this.race.state = 'racing';
      this.subMsg('コントロールラインを越えると計測開始', 4);
    }
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  resetCamera() {
    const c = this.race.player.car;
    this.camYaw = c.psi;
    this.updateCamera(0, true);
  }

  showMsg(text, dur = 1.5, color = '') {
    const el = $('#hMsg');
    el.textContent = text;
    el.style.color = color;
    el.classList.toggle('show', !!text);
    this.msgTimer = dur;
  }
  subMsg(text, dur = 2) {
    const el = $('#hSubMsg');
    el.textContent = text;
    el.classList.toggle('show', !!text);
    this.subTimer = dur;
  }

  frame(t) {
    if (game !== this) return;
    requestAnimationFrame((tt) => this.frame(tt));
    let dt = Math.min(0.1, (t - this.last) / 1000);
    this.last = t;
    if (this.paused) { this.render(0); return; }
    const inp = input.update(dt);
    // 固定ステップ
    this.acc += dt;
    const h = 1 / 120;
    let steps = 0;
    while (this.acc >= h && steps < 14) {
      this.race.step(h, inp);
      this.handleEvents();
      this.acc -= h;
      steps++;
    }
    if (steps >= 14) this.acc = 0;
    this.render(dt);
  }

  handleEvents() {
    const r = this.race;
    for (const ev of r.events) {
      if (ev.type === 'go') {
        this.world.setStartLights(0, false);
        this.showMsg('GO!', 1.0, '#3ddc84');
        audio.beep(880, 0.5, 0.3);
      } else if (ev.type === 'wall' || ev.type === 'hit') {
        audio.impact(ev.power);
        this.shake = Math.min(1, this.shake + ev.power * 0.06);
        if (ev.power > 6) {
          const c = r.player.car;
          this.fx.sparks(c.x, c.y, c.z, c.vx, c.vz, 10);
        }
      } else if (ev.type === 'lap') {
        this.onLap(ev);
      } else if (ev.type === 'finish') {
        this.finishedAt = performance.now();
        const p = ev.position;
        this.showMsg(p === 1 ? 'WINNER!' : `P${p}`, 4, p === 1 ? '#ffd000' : '#fff');
        this.subMsg('FINISH', 4);
        const key = 'rank.' + this.track.def.id + '.' + this.opts.difficulty;
        const prev = store.get(key, null);
        if (!prev || p < prev) store.set(key, p);
        setTimeout(() => { if (game === this) this.showResults(); }, 3500);
      }
    }
  }

  onLap(ev) {
    const r = this.race;
    $('#hLast').textContent = fmt(ev.time);
    const isTA = this.opts.mode === 'ta';
    const prevBest = this.bestLap;
    if (ev.time < this.bestLap) {
      this.bestLap = ev.time;
      $('#hBest').textContent = fmt(ev.time);
    }
    // ゴースト保存（自己ベスト更新時）
    const key = 'best.' + this.track.def.id;
    const saved = store.get(key, null);
    if (!saved || ev.time < saved.time) {
      const frames = ev.frames.map((v) => Math.round(v * 100) / 100);
      store.set(key, { time: ev.time, frames });
      if (isTA) {
        this.ghostData = { time: ev.time, frames };
        if (!this.ghost) this.makeGhost();
      }
      if (saved) this.subMsg('自己ベスト更新！ ' + fmt(ev.time), 3);
    } else if (isTA && isFinite(prevBest)) {
      const d = ev.time - prevBest;
      this.subMsg(`${fmt(ev.time)}  (+${d.toFixed(3)})`, 3);
    }
    if (!isTA) {
      const lapNow = r.player.lap;
      if (lapNow === r.laps) this.showMsg('FINAL LAP', 2, '#ffb000');
    }
  }

  updateCamera(dt, snap = false) {
    const c = this.race.player.car;
    const mode = this.camMode;
    let d = 0;
    if (!snap) {
      d = c.psi - this.camYaw;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
    }
    this.camYaw = snap ? c.psi : this.camYaw + d * Math.min(1, dt * (mode === 2 ? 30 : 5.5));
    const fx = Math.sin(this.camYaw), fz = Math.cos(this.camYaw);
    const sp = c.speed || 0;
    const portrait = camera.userData.portrait;
    let pos = new THREE.Vector3(), look = new THREE.Vector3();
    let fov;
    if (mode === 2) {
      // ボンネット視点
      const hx = Math.sin(c.psi), hz = Math.cos(c.psi);
      pos.set(c.x + hx * 0.2, c.y + 1.12, c.z + hz * 0.2);
      look.set(c.x + hx * 20, c.y + 0.9 + Math.sin(c.slopePitch || 0) * 20, c.z + hz * 20);
      fov = 68 + sp * 0.08;
    } else {
      const dist = mode === 1 ? 9.5 : 6.4;
      const hgt = mode === 1 ? 3.3 : 2.05;
      pos.set(c.x - fx * dist, c.y + hgt, c.z - fz * dist);
      look.set(c.x + fx * 4, c.y + 0.95, c.z + fz * 4);
      fov = 58 + sp * 0.16;
    }
    if (portrait) fov += 22;
    // 地面にめり込まない
    if (!snap) {
      const k = Math.min(1, dt * (mode === 2 ? 60 : 14));
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
    // 縁石・芝の振動
    if (c.onCurb || c.offTrack) this.camPos.y += (Math.random() - 0.5) * 0.04 * Math.min(1, sp / 20);
    camera.position.copy(this.camPos);
    camera.lookAt(look);
    camera.fov += (fov - camera.fov) * (snap ? 1 : Math.min(1, dt * 3));
    camera.updateProjectionMatrix();
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
          this.fx.carFx('p', { ...pc, slipAmount, lock: pc.lock, wheelspin: pc.wheelspin }, dt);
        } else if (dist < 120) {
          this.fx.carFx('a' + e.num, { x: st.x, y: st.y, z: st.z, psi: st.psi, vx: st.vx, vz: st.vz, slipAmount: Math.abs(st.slip) * 6 - 0.15, wheelSurf: null }, dt);
        }
      }
    }
    // ゴースト
    if (this.ghost && this.ghostData && r.taTiming) {
      const t = r.time - r.player.lapStart;
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
    this.updateCamera(dt);
    this.world.followLight(pc.x, pc.y, pc.z);
    if (dt > 0) this.fx.update(dt, camera.position, this.camVel);
    // スタートシグナル
    if (r.state === 'countdown') {
      const n = Math.min(5, Math.floor(r.countdown));
      if (n !== this.lastLightN) {
        this.lastLightN = n;
        this.world.setStartLights(n, true);
        if (n > 0) audio.beep(440, 0.15, 0.2);
      }
    }
    renderer.render(this.scene, camera);
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
    $('#hLap').textContent = isRace ? lap : Math.max(1, r.player.laps.length + 1);
    let t = 0;
    if (isRace) t = r.state === 'racing' || r.state === 'finished' ? (r.player.finished ? r.player.finishTime : r.raceTime) : 0;
    else t = r.taTiming ? r.time - r.player.lapStart : 0;
    $('#hTime').textContent = fmt(t || 0.0001).replace('--:--.---', '0:00.000');
    if (isRace) {
      const st = r.standings();
      const pos = st.indexOf(r.player) + 1;
      $('#hPos').textContent = pos;
      // 上位と自分の周辺
      const rows = st.map((e, i) => {
        const col = '#' + e.color.toString(16).padStart(6, '0');
        return `<div class="${e === r.player ? 'me' : ''}"><b>${i + 1}</b><span class="dot" style="background:${col}"></span>${e.kind === 'player' ? 'YOU' : e.name}</div>`;
      });
      this._standCount = (this._standCount || 0) + 1;
      if (this._standCount % 10 === 0) $('#hStand').innerHTML = rows.join('');
    } else if (this.ghostData && r.taTiming) {
      // ゴーストとの差（同じ地点を通過した時刻の比較）
      const f = this.ghostData.frames;
      const n = f.length / 4;
      let best = -1, bd = Infinity;
      const start = Math.max(0, Math.floor(t * 20) - 60), end = Math.min(n, Math.floor(t * 20) + 60);
      for (let i = start; i < end; i++) {
        const d = (f[i * 4] - c.x) ** 2 + (f[i * 4 + 2] - c.z) ** 2;
        if (d < bd) { bd = d; best = i; }
      }
      if (best >= 0 && bd < 400) {
        const delta = t - best / 20;
        const el = $('#hDelta');
        el.textContent = (delta >= 0 ? '+' : '−') + Math.abs(delta).toFixed(2);
        el.className = 't-delta ' + (delta < 0 ? 'neg' : 'pos');
      }
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
      m.fillStyle = e.kind === 'player' ? '#ffb000' : '#' + e.color.toString(16).padStart(6, '0');
      m.fill();
      m.lineWidth = 2;
      m.strokeStyle = '#000';
      m.stroke();
    }
    if (this.msgTimer > 0) {
      this.msgTimer -= dt;
      if (this.msgTimer <= 0) $('#hMsg').classList.remove('show');
    }
    if (this.subTimer > 0) {
      this.subTimer -= dt;
      if (this.subTimer <= 0) $('#hSubMsg').classList.remove('show');
    }
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
    audio.update({
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
    const res = r.results();
    const me = res.find((x) => x.kind === 'player');
    const laps = r.player.laps;
    const bestIdx = laps.indexOf(Math.min(...laps));
    const rows = res.map((x) => `<tr class="${x.kind === 'player' ? 'me' : ''}"><td class="p">${x.pos}</td><td><span class="sw" style="background:#${x.color.toString(16).padStart(6, '0')}"></span>${x.kind === 'player' ? 'YOU' : x.name}</td><td class="t">${x.pos === 1 ? fmt(x.time) : '+' + (x.time - res[0].time).toFixed(3)}${x.est ? '*' : ''}</td><td class="t">${fmt(x.best)}</td></tr>`).join('');
    $('#resTitle').textContent = this.track.def.name;
    $('#resBody').innerHTML = `
      <div class="res-big" style="color:${me.pos === 1 ? '#ffd000' : '#fff'}">${me.pos === 1 ? 'WINNER' : me.pos + '位'}</div>
      <div class="res-sub">${DIFFICULTY[this.opts.difficulty].label} · ${r.laps}周 · 合計 ${fmt(me.time)}</div>
      <div class="laps-list">${laps.map((l, i) => `<span class="${i === bestIdx ? 'best' : ''}">L${i + 1} ${fmt(l)}</span>`).join('')}</div>
      <table class="res-table"><tr><td></td><td style="color:var(--sub);font-size:11px">DRIVER</td><td class="t" style="color:var(--sub);font-size:11px">TIME</td><td class="t" style="color:var(--sub);font-size:11px">BEST LAP</td></tr>${rows}</table>
      <div class="res-sub">* はゴール時点からの推定タイム</div>`;
    $('#results').classList.add('show');
  }

  setPaused(p) {
    this.paused = p;
    $('#pause').classList.toggle('show', p);
    if (p) audio.suspend(); else { audio.resume(); this.last = performance.now(); }
  }
}

// ---------- ボタン ----------
input.onCamera = () => {
  if (!game) return;
  game.camMode = (game.camMode + 1) % 3;
  store.set('cam', game.camMode);
};
input.onPause = () => { if (game && !$('#results').classList.contains('show')) game.setPaused(!game.paused); };
$('#camBtn').onclick = () => input.onCamera();
$('#pauseBtn').onclick = () => input.onPause();
$('#resumeBtn').onclick = () => game && game.setPaused(false);
$('#calibBtn').onclick = () => { input.calibrateTilt(); };
$('#restartBtn').onclick = () => { $('#pause').classList.remove('show'); audio.resume(); startGame(); };
$('#againBtn').onclick = () => { $('#results').classList.remove('show'); startGame(); };
function toMenu() {
  $('#pause').classList.remove('show');
  $('#results').classList.remove('show');
  $('#hud').classList.remove('show');
  document.body.classList.remove('playing');
  if (game) { game.setPaused(false); disposeGame(); }
  audio.update({ active: false, rpm: 1000, throttle: 0, speed: 0, squeal: 0, rumble: 0, rain: false, aiRpm: 1000, aiNear: 0 });
  buildMenu();
  $('#menu').classList.add('show');
  renderer.clear();
}
$('#quitBtn').onclick = toMenu;
$('#menuBtn').onclick = toMenu;
document.addEventListener('visibilitychange', () => {
  if (document.hidden && game && !game.paused && !$('#results').classList.contains('show')) game.setPaused(true);
});

applyQuality();
buildMenu();
// デバッグ用フック
window.__apex = { get game() { return game; }, settings, startGame, toMenu, camera, renderer };
