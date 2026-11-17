// APEX LINE — メイン（メニュー・ゲームループ・カメラ・HUD・ゴースト）
import * as THREE from 'three';
import { GENRES, genreOf } from './genres.js';
import { Input } from './ui/input.js';
import { Audio } from './audio.js';
import { store } from './store.js';
import { garage } from './garage.js';
import { GarageView } from './ui/garageview.js';
import { C, $, isTouch, fmt, drawTrackMap } from './game/common.js';

window.addEventListener('error', (e) => { $('#err').textContent = 'Error: ' + e.message; });
window.addEventListener('unhandledrejection', (e) => { $('#err').textContent = 'Error: ' + (e.reason && e.reason.message || e.reason); });

const settings = Object.assign({
  genre: 'gt', mode: 'race', difficulty: 'normal',
  steer: 'slide', sens: 1, assist: true, quality: isTouch ? 1 : 2, volume: 0.8,
}, store.get('settings', {}));
// 旧バージョンの保存値からの移行
settings.sel = Object.assign({ gt: settings.track || 0 }, settings.sel || {});
settings.lapsBy = Object.assign({ gt: settings.laps || 3 }, settings.lapsBy || {});
if (!GENRES.some((g) => g.id === settings.genre)) settings.genre = 'gt';
const saveSettings = () => store.set('settings', settings);

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
Object.assign(C, { renderer, camera, input, audio, applyQuality, game: () => game });

// ---------- メニュー ----------
function updateMenuCoins() {
  $('#menuCoins').textContent = String(garage.coins);
}

const genre = () => genreOf(settings.genre);
const selIndex = (g) => Math.min(settings.sel[g.id] ?? 0, g.events.length - 1);
const lapsOf = (g) => settings.lapsBy[g.id] ?? g.defaultLaps;

function buildMenu() {
  const g = genre();
  const list = $('#trackList');
  list.innerHTML = '';
  const cur = selIndex(g);
  g.events.forEach((def, i) => {
    const card = document.createElement('button');
    card.className = 'card' + (i === cur ? ' on' : '');
    const cv = document.createElement('canvas');
    cv.width = 420; cv.height = 200;
    card.appendChild(cv);
    const tr = g.makeTrack(def);
    drawTrackMap(cv, tr, { w: 6, pad: 18, ...g.mapOpts(def, tr) });
    const m = g.meta(def, tr, settings);
    card.insertAdjacentHTML('beforeend', `
      <div class="nm">${def.name}</div>
      <div class="en">${m.sub}</div>
      <div class="tags">${def.tags.map((t) => `<i>${t}</i>`).join('')}</div>
      <div class="desc">${def.desc}</div>
      <div class="rec">${m.rec}</div>`);
    card.onclick = () => {
      settings.sel[g.id] = i;
      saveSettings();
      list.querySelectorAll('.card').forEach((c, k) => c.classList.toggle('on', k === i));
    };
    list.appendChild(card);
  });
  // 周回数の選択肢はジャンルごと
  const lapsSeg = $('#lapsSeg');
  lapsSeg.innerHTML = '';
  for (const n of g.laps || []) {
    const b = document.createElement('button');
    b.dataset.v = String(n);
    b.textContent = String(n);
    b.onclick = () => { settings.lapsBy[g.id] = n; saveSettings(); syncSegs(); };
    lapsSeg.appendChild(b);
  }
  updateMenuCoins();
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
  const g = genre();
  const map = { '#genreSeg': 'genre', '#modeSeg': 'mode', '#diffSeg': 'difficulty', '#steerSeg': 'steer', '#assistSeg': 'assist', '#qualSeg': 'quality' };
  for (const [id, key] of Object.entries(map)) {
    $(id).querySelectorAll('button').forEach((b) => {
      const v = settings[key];
      b.classList.toggle('on', String(typeof v === 'boolean' ? (v ? 1 : 0) : v) === b.dataset.v);
    });
  }
  $('#lapsSeg').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === String(lapsOf(g))));
  const race = !g.hasMode || settings.mode === 'race';
  $('#modeSeg').style.display = g.hasMode ? '' : 'none';
  $('#diffOpt').style.display = race ? '' : 'none';
  $('#lapsOpt').style.display = race && g.laps ? '' : 'none';
  $('#menuHint').textContent = g.hint(settings);
  const notes = {
    slide: '画面左側を指で左右にスライドしてハンドル操作（アナログ）。',
    buttons: '◀ ▶ ボタンでハンドル操作。押している長さで切れ角が増える。',
    tilt: '端末を傾けてハンドル操作。一時停止メニューで中心を合わせられます。',
  };
  $('#steerNote').textContent = notes[settings.steer];
}
seg('#genreSeg', 'genre', (v) => v, buildMenu);
seg('#modeSeg', 'mode', (v) => v, buildMenu);
seg('#diffSeg', 'difficulty', (v) => v, buildMenu);
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

// ---------- ガレージ ----------
let garageView = null;
function openGarage() {
  $('#menu').classList.remove('show');
  if (!garageView || garageView.quality !== settings.quality) garageView = new GarageView(renderer, { onBack: closeGarage, quality: settings.quality });
  garageView.open();
}
function closeGarage() {
  if (garageView) garageView.close();
  buildMenu();
  $('#menu').classList.add('show');
}
$('#garageBtn').onclick = openGarage;

// ---------- ゲーム ----------
async function startGame() {
  audio.init();
  audio.setVolume(settings.volume);
  if (settings.steer === 'tilt') await input.enableTilt();
  const g = genre();
  const def = g.events[selIndex(g)];
  $('#loadTitle').textContent = def.name;
  $('#loadTip').textContent = 'TIP: ' + g.tips[Math.floor(Math.random() * g.tips.length)];
  $('#menu').classList.remove('show');
  $('#loading').classList.add('show');
  if (isTouch && document.documentElement.requestFullscreen && !document.fullscreenElement) {
    document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
  }
  await new Promise((r) => setTimeout(r, 30));
  if (game) disposeGame();
  const tr = g.makeTrack(def);
  g.prepare && g.prepare(tr);
  game = g.create(tr, { ...settings, laps: lapsOf(g), genre: g.id });
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
  game.dispose();
  game = null;
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
$('#resGarageBtn').onclick = () => { toMenu(); openGarage(); };
document.addEventListener('visibilitychange', () => {
  if (document.hidden && game && !game.paused && !$('#results').classList.contains('show')) game.setPaused(true);
});

applyQuality();
buildMenu();
// デバッグ用フック
window.__apex = { get game() { return game; }, settings, genre, startGame, toMenu, camera, renderer, garage, openGarage, get garageView() { return garageView; } };
