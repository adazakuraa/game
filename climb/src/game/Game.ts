import * as THREE from 'three';
import { Input } from '../core/Input';
import { EXPEDITIONS, altitudeToWorldY, type MountainDef } from './Mountains';
import { MountainField, buildTerrainMeshes, createTerrainMaterial, type TerrainUniforms } from '../world/Terrain';
import { Route } from '../world/Route';
import { Environment } from '../world/Environment';
import { Props } from '../world/Props';
import { Snow } from '../world/Snow';
import { Breath } from '../world/Breath';
import { Player } from '../player/Player';
import { Viewmodel } from '../player/Viewmodel';
import { Body } from '../player/Body';
import { Physiology, Weather, BOTTLE_LITERS } from '../systems/Physiology';
import { PostFX } from '../systems/PostFX';
import { Audio } from '../systems/Audio';
import { Hud, formatClock } from '../ui/Hud';
import { MapView } from '../ui/MapView';
import { Tutorial } from '../ui/Tutorial';
import { Radio } from '../ui/Radio';
import { Ambient } from '../world/Ambient';
import { Plume } from '../world/Plume';
import { NearGround } from '../world/NearGround';
import { createSeededRandom } from '../utils/random';
import { clamp, smoothstep } from '../utils/noise';
import { STANDARD, gradeFor, formatDur, bestFor, submitTime, type Grade } from './Scoring';
import { LORE, loreCollected, collectLore, type LoreEntry } from './Lore';
import { CampScreen, MEALS, TREAT, dogTier, type MealId, type DogState, type CampData, type CampActions } from '../ui/CampScreen';
import { Dog } from '../world/Dog';

type GameState = 'title' | 'play' | 'paused' | 'dead' | 'summit' | 'camp' | 'won';
type DeathKind = 'fall' | 'hace' | 'hypothermia' | 'serac' | 'exhaustion' | 'crevasse' | 'rock' | 'icefall';

const TIME_SCALE = 20; // game seconds per real second
const START_HOURS = 3.0;
const TURNAROUND = 14;

const DEATH_TEXT: Record<DeathKind, { title: string; desc: string }> = {
  fall: { title: '滑落', desc: '急斜面で足を取られ、止まることなく斜面を落ちていった。急斜面では必ずフィックスロープに確保し、滑ったら即座にピッケルで制動を。' },
  hace: { title: '高所脳浮腫 (HACE)', desc: '低酸素状態が続き脳がむくんだ。意識が混濁し、やがて動けなくなった。酸素流量を上げる、または下山することでしか防げない。' },
  hypothermia: { title: '低体温症', desc: '風と寒さに体温を奪われ続けた。デスゾーンで長く立ち止まることは死を意味する。動き続けて熱を作れ。' },
  serac: { title: 'セラック崩落', desc: '頭上の巨大な氷塔が崩れ、トラバース中に直撃した。崩落音が聞こえたら落下ラインから即座に離れろ。' },
  exhaustion: { title: '力尽きた', desc: '体力が尽き、立ち上がることができなかった。休息と酸素を管理し、ペースを守れ。' },
  crevasse: { title: 'クレバス転落', desc: 'ハシゴから足を踏み外し、青い闇の底へ落ちた。ハシゴを渡る前には必ず横のロープに確保しろ。' },
  rock: { title: '落石', desc: '頭上から落ちてきた岩が直撃した。落石の音が聞こえたら、落下ラインから横へ逃げろ。' },
  icefall: { title: '氷塔の崩壊', desc: 'アイスフォールの氷塔が崩れ、巻き込まれた。崩壊帯では立ち止まらず、日が高くなる前に抜けろ。' },
};

const SAVE_KEY = 'dz8000-expedition-v1';
interface SaveData {
  exp: 'everest' | 'k2';
  stage: number;
  day: number;
  acclim: number;
  frost: number;
  spares: number;
  money?: number;
  dog?: DogState | null;
  meal?: MealId | null;
}

function readSave(): SaveData | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as SaveData;
    if (!EXPEDITIONS[d.exp] || !EXPEDITIONS[d.exp].stages[d.stage]) return null;
    return d;
  } catch { return null; }
}
function writeSave(d: SaveData | null): void {
  try {
    if (d) localStorage.setItem(SAVE_KEY, JSON.stringify(d));
    else localStorage.removeItem(SAVE_KEY);
  } catch { /* storage unavailable: progress lasts this session only */ }
}

interface IceChunk {
  mesh: THREE.Mesh;
  puff: THREE.Sprite;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
}

/** A point on today's climb to resume from after a death (quick retry). */
interface Checkpoint {
  name: string;
  s: number;
  hours: number;
  descending: boolean;
  summitReached: boolean;
  summitHours: number;
  lastLandmark: number;
  lastDownMark: number;
  spo2: number; stamina: number; coreTemp: number; frostbite: number; hace: number;
  bottle: number; spares: number; flow: number;
  storm: number;
  caches: boolean[];
}

interface LegResult { key: string; time: number; std: number; grade: Grade; isNew: boolean; best: number | null }

interface World {
  def: MountainDef;
  field: MountainField;
  route: Route;
  props: Props;
  root: THREE.Group;
  terrainUniforms: TerrainUniforms;
  triangles: number;
}

export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(72, 1, 0.08, 40000);
  private readonly input: Input;
  private readonly hud = new Hud();
  private readonly audio = new Audio();
  private readonly physio = new Physiology();
  private weather: Weather;
  private readonly post: PostFX;
  private readonly env: Environment;
  private readonly snow: Snow;
  private readonly viewmodel = new Viewmodel();
  private readonly breath = new Breath();
  private readonly body = new Body();
  private readonly radio = new Radio();
  private readonly ambient = new Ambient();
  private readonly plume = new Plume();
  private near!: NearGround;
  private paceChecked = false;
  private lastActionP = -1;
  private lookUp = 0;
  rockSide = 0;
  private readonly attachTmp = new THREE.Vector3();
  private readonly gripTmp = new THREE.Vector3();
  private readonly map = new MapView(() => this.map.show(false));
  private tutorial!: Tutorial;
  private readonly headlamp = new THREE.SpotLight(0xfff1dc, 0, 70, 0.42, 0.5, 1.2);
  private readonly mobile: boolean;
  private world: World | null = null;
  private player: Player | null = null;
  private state: GameState = 'title';
  private selected: 'everest' | 'k2' = 'everest';
  private stageIndex = 0;
  private day = 1;
  private acclim = 5600;
  private frostCarry = 0;
  private spares = 1;
  private builtKey = '';
  private rng = createSeededRandom(1);
  private seed = 1;
  private hours = START_HOURS;
  private realTime = 0;
  private playTime = 0;
  private frame = 0;
  private lastFrame = performance.now();
  private running = false;
  private pausedForScreenshot = false;
  private reducedMotion = false;
  private flash = 0;
  private fade = 0;
  private deathKind: DeathKind | null = null;
  private deathTimer = 0;
  private summitReached = false;
  private summitHours = 0;
  private turnWarned = false;
  private warned = new Set<string>();
  private swapT = 0;
  private collapseT = 0;
  private seracTimer = 12;
  private seracWarn = -1;
  private seracLane = new THREE.Vector3();
  private readonly chunks: IceChunk[] = [];
  private chunkGeo = new THREE.DodecahedronGeometry(1, 0);
  private chunkMat = new THREE.MeshStandardMaterial({ color: 0xa9cde4, roughness: 0.3 });
  private puffTex: THREE.Texture | null = null;
  /** Being struck by ice/rock: thrown, tumbling, buried in powder — not an instant cut. */
  private hitAnim = false;
  private readonly hitDir = new THREE.Vector3();
  private readonly hitEye = new THREE.Vector3();
  private hitYaw = 0;
  private hitPitch = 0;
  /** Where the crack came from: the head turns to it on reflex. */
  private readonly hazSrc = new THREE.Vector3();
  /** Powder billowing up where the serac/tower gave way. */
  private readonly billows: { sprite: THREE.Sprite; age: number; size: number; rise: number }[] = [];
  private rockChunkMat = new THREE.MeshStandardMaterial({ color: 0x4a4541, roughness: 0.9, flatShading: true });
  private chunkKind: 'serac' | 'icefall' | 'rock' = 'serac';
  private titleAngle = 0.6;
  /** Test-only: simulation steps per rendered frame. */
  simSpeed = 1;
  private readonly tmpV = new THREE.Vector3();
  private readonly windDir = new THREE.Vector3(1, 0, 0.25).normalize();
  private lastLandmark = -1;
  /** Descending: last landmark passed on the way down (for checkpoints). */
  private lastDownMark = 99;
  // --- play loop extras (rating, praise, quick retry, assist)
  private legKey = '';
  /** Deaths on the current leg; from two on, base camp offers a weather window. */
  private legDeaths = 0;
  private assistOn = false;
  private retries = 0;
  private nearMisses = 0;
  private nearThisFall = false;
  private hzInside: { kind: 'serac' | 'icefall' | 'rock'; s0: number; s1: number } | null = null;
  private laddersCrossed = 0;
  private ladderEnterS = -1;
  private checkpoint: Checkpoint | null = null;
  private lastNoRopeMsg = 0;
  private legResult: LegResult | null = null;
  // --- camp life: sponsor money, tonight's meal, the dog, relics on the route
  private money = 1000;
  private mealNext: MealId | null = null;
  private ateTonight: MealId | null = null;
  private pettedTonight = false;
  private dog: DogState | null = null;
  private readonly dogObj = new Dog();
  private dogWarned = false;
  private readonly campScreen = new CampScreen();
  private loreItems: { entry: LoreEntry; mesh: THREE.Object3D; glint: THREE.Sprite; pos: THREE.Vector3; taken: boolean }[] = [];
  private reading = false;
  private maxAltitude = 0;
  private dprCap: number;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.mobile = matchMedia('(pointer: coarse)').matches || /Android|iPhone|iPad/i.test(navigator.userAgent);
    this.dprCap = this.mobile ? 1.5 : 2;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.info.autoReset = false;
    this.post = new PostFX(this.renderer, this.mobile);
    this.weather = new Weather(this.rng, 28);

    this.scene.fog = new THREE.FogExp2(0x9fb0c4, 0.00009);
    this.env = new Environment(-330, 4242, this.mobile);
    this.scene.add(this.env.group);
    this.snow = new Snow(this.mobile ? 2200 : 4200);
    this.scene.add(this.snow.points);
    this.scene.add(this.breath.group);
    this.scene.add(this.body.group);
    this.scene.add(this.ambient.group);
    this.scene.add(this.plume.group);
    this.radio.onTransmit = () => this.audio.radio();
    this.ambient.onAvalanche = (dist, delay) => {
      setTimeout(() => this.audio.avalanche(dist), delay * 1000);
      this.radio.say('avalanche', '今の音は雪崩だ！…大丈夫、遠い。こっちには来ない。');
    };
    this.ambient.onIceCrack = () => {
      this.audio.iceCrack();
      if (this.player) this.player.shake = Math.max(this.player.shake, 0.25);
      this.radio.say('icecrack', '氷河が動いた音だ。氷は生きている。気にするな、ただし立ち止まるな。');
    };
    this.headlamp.castShadow = false;
    this.scene.add(this.headlamp, this.headlamp.target);
    this.scene.add(this.dogObj.group);
    this.scene.add(this.camera);

    const surface = document.getElementById('touch-surface')!;
    this.input = new Input(surface, canvas, document.getElementById('touch-stick')!, document.getElementById('touch-knob')!);
    this.input.bindButton(document.getElementById('clip-btn')!, 'clip');
    this.input.bindButton(document.getElementById('rest-btn')!, 'rest');
    this.input.bindButton(document.getElementById('interact-btn')!, 'interact');
    this.input.bindButton(document.getElementById('o2-up')!, 'o2Up');
    this.input.bindButton(document.getElementById('o2-down')!, 'o2Down');
    this.input.bindButton(document.getElementById('pause-btn')!, 'pause');
    this.input.bindButton(document.getElementById('map-btn')!, 'map');

    this.tutorial = new Tutorial(this.mobile);
    this.setupMenus();
    this.buildStage(this.selected, 0);
    this.resize();
    window.addEventListener('resize', () => this.resize());
    document.getElementById('lore-close')!.addEventListener('click', () => this.closeLore());
    this.installTestHooks();
  }

  // ---------------------------------------------------------------- menus
  private setupMenus(): void {
    const cards = document.getElementById('mountain-cards')!;
    for (const m of [EXPEDITIONS.everest, EXPEDITIONS.k2]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'mcard' + (m.id === this.selected ? ' sel' : '');
      b.dataset.id = m.id;
      b.innerHTML = `
        <div class="row"><h3>${m.name}</h3><span class="elev">${m.summitAltitude.toLocaleString('en-US')}m</span></div>
        <div class="sub">${m.subtitle} · ${m.routeName}</div>
        <p>${m.description}</p>
        <div class="meta"><span>BC ${m.baseAltitude.toLocaleString('en-US')}m から ${m.stages.length}区間</span><span>難度 <b>${m.difficulty}</b></span></div>`;
      b.addEventListener('click', () => {
        if (this.selected === m.id) return;
        this.selected = m.id;
        cards.querySelectorAll('.mcard').forEach((c) => c.classList.toggle('sel', (c as HTMLElement).dataset.id === m.id));
        this.withLoading(() => this.buildStage(m.id, 0));
      });
      cards.appendChild(b);
    }
    document.getElementById('start-btn')!.addEventListener('click', () => {
      this.audio.unlock();
      this.audio.setMuted(!(document.getElementById('opt-sound') as HTMLInputElement).checked);
      this.withLoading(() => {
        this.newExpedition(this.selected);
        if (!this.mobile) this.tryPointerLock();
      });
    });
    document.getElementById('continue-btn')!.addEventListener('click', () => {
      const sv = readSave();
      if (!sv) return;
      this.audio.unlock();
      this.audio.setMuted(!(document.getElementById('opt-sound') as HTMLInputElement).checked);
      this.withLoading(() => {
        this.loadSave(sv);
        this.startRun();
        if (!this.mobile) this.tryPointerLock();
      });
    });
    this.refreshContinue();
    document.getElementById('resume-btn')!.addEventListener('click', () => this.setPaused(false));

    document.getElementById('help-btn')!.addEventListener('click', () => {
      this.showScreen(null);
      this.state = 'play';
      this.openTutorial();
    });
    document.getElementById('restart-btn')!.addEventListener('click', () => this.startRun());
    document.getElementById('quit-btn')!.addEventListener('click', () => this.toTitle());
    document.getElementById('result-primary')!.addEventListener('click', () => {
      if (this.state === 'summit') this.beginDescent();
      else if (this.state === 'camp') this.withLoading(() => this.departNextStage());
      else if (this.state === 'won') this.withLoading(() => this.newExpedition(this.selected));
      else if (this.checkpoint) this.resumeCheckpoint();
      else this.startRun();
    });
    document.getElementById('result-camp')!.addEventListener('click', () => this.startRun());
    document.getElementById('result-rest')!.addEventListener('click', () => this.restDay());
    document.getElementById('result-secondary')!.addEventListener('click', () => this.toTitle());
    document.addEventListener('pointerlockchange', () => {
      if (!document.pointerLockElement && this.state === 'play' && !this.mobile) this.setPaused(true);
    });
  }

  private tryPointerLock(): void {
    try {
      const r = this.canvas.requestPointerLock?.() as unknown;
      if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch(() => undefined);
    } catch { /* not available in this frame; drag-to-look still works */ }
  }

  private withLoading(fn: () => void): void {
    const l = document.getElementById('loading')!;
    l.classList.remove('hidden');
    setTimeout(() => {
      fn();
      l.classList.add('hidden');
    }, 30);
  }

  private showScreen(id: 'title' | 'pause' | 'result' | null): void {
    for (const s of ['title', 'pause', 'result']) {
      document.getElementById(s)!.classList.toggle('hidden', s !== id);
    }
  }

  private refreshContinue(): void {
    const sv = readSave();
    const btn = document.getElementById('continue-btn')!;
    btn.classList.toggle('hidden', !sv);
    if (sv) {
      const e = EXPEDITIONS[sv.exp];
      const st = e.stages[sv.stage];
      btn.textContent = `続きから — ${e.name} ${st.campName}（${st.campAltitude.toLocaleString('en-US')}m）· ${sv.day}日目`;
    }
  }

  private loadSave(sv: SaveData): void {
    this.selected = sv.exp;
    this.day = sv.day;
    this.acclim = sv.acclim;
    this.frostCarry = sv.frost;
    this.spares = sv.spares;
    this.money = sv.money ?? 1000;
    this.dog = sv.dog ?? null;
    this.mealNext = sv.meal ?? null;
    this.buildStage(sv.exp, sv.stage);
    document.querySelectorAll('.mcard').forEach((c) => c.classList.toggle('sel', (c as HTMLElement).dataset.id === sv.exp));
  }

  private save(): void {
    writeSave({ exp: this.selected, stage: this.stageIndex, day: this.day, acclim: this.acclim, frost: this.frostCarry, spares: this.spares, money: this.money, dog: this.dog, meal: this.mealNext });
  }

  /** Save as standing at the camp this leg ended at (i.e. the start of the next leg). */
  private saveAtCamp(): void {
    const last = EXPEDITIONS[this.selected].stages.length - 1;
    writeSave({ exp: this.selected, stage: Math.min(last, this.stageIndex + 1), day: this.day, acclim: this.acclim, frost: this.frostCarry, spares: this.spares, money: this.money, dog: this.dog, meal: this.mealNext });
  }

  private newExpedition(exp: 'everest' | 'k2'): void {
    this.selected = exp;
    this.day = 1;
    this.spares = 1;
    this.money = 1000;
    this.dog = null;
    this.mealNext = null;
    this.acclim = EXPEDITIONS[exp].baseAltitude + 300; // acclimatised on the trek in
    this.frostCarry = 0;
    this.buildStage(exp, 0);
    this.save();
    this.startRun();
    if (!Tutorial.seen()) this.openTutorial();
  }

  /** Sleep at camp, then set off on the next leg in the morning. */
  private departNextStage(): void {
    const exp = EXPEDITIONS[this.selected];
    const campAlt = this.world!.def.summitAltitude;
    this.acclim = Math.max(this.acclim, campAlt + 300);
    this.frostCarry = Math.max(0, this.physio.frostbite * 0.8 - 5);
    this.day += 1;
    this.buildStage(this.selected, Math.min(exp.stages.length - 1, this.stageIndex + 1));
    this.save();
    this.startRun();
  }

  /** Stay a day at camp: better acclimatised and rested, but the season moves on. */
  private restDay(): void {
    if (this.state !== 'camp') return;
    const campAlt = this.world!.def.summitAltitude;
    this.acclim = Math.max(this.acclim, campAlt + 300) + 350;
    this.physio.frostbite = Math.max(0, this.physio.frostbite - 15);
    this.frostCarry = Math.max(0, this.frostCarry - 15);
    this.day += 1;
    this.ateTonight = null;
    this.pettedTonight = false;
    this.saveAtCamp();
    this.audio.zip();
    this.showCamp(true);
  }

  private openTutorial(): void {
    if (this.state === 'play' && this.world) this.updatePlay(0.0001); // fill the HUD with live values
    this.input.enabled = false;
    this.hud.root.classList.add('tut');
    if (document.pointerLockElement) document.exitPointerLock();
    this.tutorial.start(() => {
      this.hud.root.classList.remove('tut');
      this.input.enabled = this.state === 'play';
      if (!this.mobile && this.state === 'play') this.tryPointerLock();
    });
  }

  private toTitle(): void {
    this.campScreen.close();
    this.closeLore();
    this.dogObj.group.visible = false;
    this.refreshContinue();
    this.state = 'title';
    this.input.enabled = false;
    this.hud.show(false);
    this.showScreen('title');
    this.fade = 0;
    if (document.pointerLockElement) document.exitPointerLock();
  }

  private setPaused(p: boolean): void {
    if (p && this.state === 'play') {
      this.state = 'paused';
      this.input.enabled = false;
      this.showScreen('pause');
    } else if (!p && this.state === 'paused') {
      this.state = 'play';
      this.input.enabled = true;
      this.showScreen(null);
      if (!this.mobile) this.tryPointerLock();
    }
  }

  // ---------------------------------------------------------------- world
  /** Display altitude, scaled so the camp and summit match the real elevations. */
  private altitudeAt(y: number): number {
    const w = this.world!;
    const pts = w.route.points;
    const y0 = pts[0].y;
    const y1 = pts[pts.length - 1].y;
    const d = w.def;
    return Math.min(d.summitAltitude, d.campAltitude + ((y - y0) / (y1 - y0)) * (d.summitAltitude - d.campAltitude));
  }

  private buildStage(id: 'everest' | 'k2', stage: number): void {
    const key = `${id}-${stage}`;
    this.selected = id;
    this.stageIndex = stage;
    if (this.builtKey === key && this.world) return;
    this.builtKey = key;
    if (this.world) {
      this.scene.remove(this.world.root);
      this.world.root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
      });
    }
    const def = EXPEDITIONS[id].stages[stage];
    const field = new MountainField(def);
    const route = new Route(def, field);
    const { material, uniforms } = createTerrainMaterial(def, this.renderer.capabilities.getMaxAnisotropy());
    const terrain = buildTerrainMeshes(field, material, this.mobile);
    const props = new Props(def, field, route);
    const root = new THREE.Group();
    root.name = `world-${id}`;
    root.add(terrain.group, route.buildMeshes(), props.group);
    this.scene.add(root);
    this.world = { def, field, route, props, root, terrainUniforms: uniforms, triangles: terrain.triangles };
    this.player = new Player(field, route);
    this.player.ladders = props.ladders;
    this.player.reset(0);
    this.weather = new Weather(this.rng, def.baseWind);
    this.env.setCloudY(altitudeToWorldY(def, def.cloudAlt));
    this.plume.setStage(def);
    this.env.setDistantMaterial(material);
    if (!this.near) {
      this.near = new NearGround(material, this.mobile);
      this.scene.add(this.near.mesh);
    }
    this.near.setField(field, material);
    uniforms.uNear.value.set(0, 0, -1);
    this.near.onSwap = (cx, cz, half) => this.world?.terrainUniforms.uNear.value.set(cx, cz, half);
    this.env.cirrus = 0.25 + ((def.seed * 7) % 10) / 14;
    this.buildLore(def, field, route, root);
    this.map.build(def, field, route, props, EXPEDITIONS[id], stage, (y) => this.altitudeAt(y));
    const marks = def.landmarks.slice(1, -1).map((l) => route.waypointS[l.routeIndex] / route.length);
    this.hud.setMarks(marks);
    this.renderer.compile(this.scene, this.camera);
  }

  private startRun(): void {
    if (!this.world || !this.player) return;
    this.rng = createSeededRandom(this.seed);
    const def = this.world.def;
    const legKey = `${this.selected}-${this.stageIndex}`;
    if (legKey !== this.legKey) { this.legKey = legKey; this.legDeaths = 0; }
    // Rescue without humiliation: after two deaths on a leg, base camp waits for a weather window.
    this.assistOn = this.legDeaths >= 2;
    this.weather.stormChance = def.goal === 'summit' ? Math.min(0.9, 0.35 + Math.max(0, this.day - 7) * 0.08) : 0.3;
    this.weather.reset(this.rng);
    if (this.assistOn) this.weather.willStorm = false;
    this.physio.reset(def.o2 === 'summit' ? this.spares + (this.assistOn ? 1 : 0) : 0, {
      o2: def.o2 !== 'none', acclim: this.acclim, frost: this.frostCarry,
    });
    this.retries = 0;
    this.nearMisses = 0;
    this.nearThisFall = false;
    this.hzInside = null;
    this.laddersCrossed = 0;
    this.ladderEnterS = -1;
    this.checkpoint = null;
    this.lastDownMark = 99;
    this.player.rappelling = false;
    // last night's meal
    const m = this.mealNext;
    this.physio.mods = {
      heat: m === 'ramen' ? 0.14 : 0,
      recover: m === 'dalbhat' ? 1.3 : 1,
      drain: m === 'choco' ? 0.88 : 1,
      frost: m === 'tea' ? 0.65 : 1,
    };
    this.physio.extraHeat = 0;
    for (const l of this.loreItems) { l.taken = false; l.mesh.visible = true; }
    this.reading = false;
    // the dog walks every leg except the summit push (it waits in the tent at the top camp)
    this.dogObj.group.visible = !!this.dog && def.goal !== 'summit';
    this.dogWarned = false;
    if (this.dogObj.group.visible) {
      const dp = this.world.route.pointAt(3);
      this.dogObj.place(dp, 0);
    }
    this.player.reset(0);
    this.hours = def.startHours;
    this.playTime = 0;
    this.flash = 0;
    this.fade = 0;
    this.deathKind = null;
    this.deathTimer = 0;
    this.hitAnim = false;
    for (const c of this.chunks) { this.scene.remove(c.mesh); this.scene.remove(c.puff); }
    this.chunks.length = 0;
    for (const b of this.billows) this.scene.remove(b.sprite);
    this.billows.length = 0;
    this.summitReached = false;
    this.player.descending = false;
    this.turnWarned = false;
    this.warned.clear();
    this.swapT = 0;
    this.collapseT = 0;
    this.seracTimer = 6;
    this.seracWarn = -1;
    this.lastLandmark = 0;
    this.maxAltitude = this.world.def.campAltitude;
    for (const c of this.chunks) { this.scene.remove(c.mesh); this.scene.remove(c.puff); }
    this.chunks.length = 0;
    for (const c of this.world.props.caches) { c.taken = false; c.mesh.visible = true; }
    this.map.show(false);
    this.state = 'play';
    this.input.enabled = true;
    this.showScreen(null);
    this.hud.show(true);
    this.radio.reset();
    this.ambient.reset();
    this.paceChecked = false;
    if (this.assistOn) {
      this.radio.say('assist', def.o2 === 'summit'
        ? '無理をするな。今日は天気の窓だ、風も弱い。デポにボンベを1本足しておいた。'
        : '無理をするな。今日は天気の窓だ、崩れる心配はない。落ち着いて行け。');
    }
    if (m) {
      const meal = MEALS.find((x) => x.id === m)!;
      this.radio.say('meal', `昨夜の${meal.name}が効いてるな。${meal.effect.split('。')[1] ?? ''}`, '体');
    }
    if (this.dog && def.goal === 'summit') this.radio.say('dogwait', `${this.dog.name}はテントで待たせてある。帰ってきてやれよ。`);
    this.radio.lore(def.stageKey, 0);
    const deadline = def.goal === 'summit' ? TURNAROUND : 18.5;
    this.radio.say('forecast', this.weather.willStorm && this.weather.stormAt < deadline + 1
      ? `今日の予報：${formatClock(this.weather.stormAt)}ごろから天気が崩れる。それまでに${def.goalName}へ入れ。`
      : '今日の予報：晴れ、風は弱い。いい日だ。');
    const goal = def.goal === 'summit' ? `山頂 ${def.summitAltitude.toLocaleString('en-US')}m · 折返 ${TURNAROUND}:00` : `${def.goalName}（${def.summitAltitude.toLocaleString('en-US')}m）へ`;
    const std = STANDARD[def.stageKey];
    const best = bestFor(def.stageKey + (def.goal === 'summit' ? ':up' : ''));
    const target = std ? `<br>ガイド基準 ${formatDur(std.up)}${best !== null ? `（自己ベスト ${formatDur(best)}）` : ''}` : '';
    this.hud.banner(`${this.day}日目 — ${def.stageName}`, `${formatClock(this.hours)} ${def.campName}出発 · ${goal}${target}`, '', 5000);
  }

  // ---------------------------------------------------------------- quick retry
  private saveCheckpoint(name: string): void {
    const p = this.player, ph = this.physio;
    if (!p || !this.world || this.state !== 'play' || p.mode !== 'walk') return;
    this.checkpoint = {
      name, s: p.routeS, hours: this.hours, descending: p.descending,
      summitReached: this.summitReached, summitHours: this.summitHours,
      lastLandmark: this.lastLandmark, lastDownMark: this.lastDownMark,
      spo2: ph.spo2, stamina: ph.stamina, coreTemp: ph.coreTemp, frostbite: ph.frostbite, hace: ph.hace,
      bottle: ph.bottle, spares: ph.spares, flow: ph.flow,
      storm: this.weather.state.storm,
      caches: this.world.props.caches.map((c) => c.taken),
    };
  }

  /** Back on your feet at the last landmark passed, a minute after the mistake. */
  private resumeCheckpoint(): void {
    const cp = this.checkpoint, p = this.player, w = this.world;
    if (!cp || !p || !w) { this.startRun(); return; }
    const ph = this.physio;
    this.retries += 1;
    p.reset(cp.s);
    p.descending = cp.descending;
    if (cp.descending) p.yaw += Math.PI;
    // never resume unroped on a fixed-rope slope
    const r = p.nearestRope();
    if (r) p.clip = r;
    this.hours = cp.hours;
    this.summitReached = cp.summitReached;
    this.summitHours = cp.summitHours;
    this.lastLandmark = cp.lastLandmark;
    this.lastDownMark = cp.lastDownMark;
    // A breather is part of the retry: no waking into a death already in progress.
    ph.spo2 = cp.spo2; ph.stamina = Math.max(cp.stamina, 70); ph.coreTemp = Math.max(cp.coreTemp, 36.2);
    ph.frostbite = cp.frostbite; ph.hace = Math.min(cp.hace, 30);
    ph.bottle = cp.bottle; ph.spares = cp.spares; ph.flow = cp.flow; ph.collapsed = false;
    this.weather.rewind(cp.hours, cp.storm);
    w.props.caches.forEach((c, i) => { c.taken = cp.caches[i] ?? c.taken; c.mesh.visible = !c.taken; });
    this.flash = 0; this.fade = 0; this.deathKind = null; this.deathTimer = 0; this.hitAnim = false;
    for (const c of this.chunks) { this.scene.remove(c.mesh); this.scene.remove(c.puff); }
    this.chunks.length = 0;
    for (const b of this.billows) this.scene.remove(b.sprite);
    this.billows.length = 0;
    this.seracWarn = -1; this.seracTimer = 10; this.swapT = 0; this.collapseT = 0; this.hzInside = null;
    this.dogWarned = false;
    if (this.dogObj.group.visible) this.dogObj.place(w.route.pointAt(clamp(cp.s + (cp.descending ? -3 : 3), 0, w.route.length)), 0);
    this.map.show(false);
    this.state = 'play';
    this.input.enabled = true;
    this.showScreen(null);
    this.hud.show(true);
    this.radio.interrupt(4);
    this.hud.banner(`${cp.name}から再開`, p.clip ? 'ロープに確保した状態で立て直した' : '息を整えて、もう一度', '', 2600);
    if (!this.mobile) this.tryPointerLock();
  }

  /** Praise for getting through a tense stretch: a breath out, and a little strength back. */
  private hazardCleared(kind: 'serac' | 'icefall' | 'rock'): void {
    const T = {
      icefall: ['崩壊帯を抜けた', 'よし、抜けたな！見事だ。ここから先は少し落ち着ける。'],
      serac: ['セラックの下を抜けた', '抜けた！よくやった、今のが一番危ない場所だった。'],
      rock: ['落石地帯を抜けた', '落石帯を抜けたか。いい判断だった。'],
    } as const;
    const ph = this.physio;
    ph.stamina = Math.min(100, ph.stamina + 20);
    this.audio.cleared();
    this.dogBark();
    this.hud.banner(T[kind][0], '張り詰めた息を吐く — 体力が少し戻った', 'good', 3000);
    this.radio.say(`praise-${kind}-${this.player!.descending ? 'd' : 'u'}`, T[kind][1]);
    this.saveCheckpoint(T[kind][0].replace('を抜けた', 'の先'));
  }

  private legStd(): { std: { up: number; round?: number } | undefined; elapsed: number } {
    const def = this.world!.def;
    return { std: STANDARD[def.stageKey], elapsed: this.hours - def.startHours };
  }

  private rate(key: string, time: number, std: number): LegResult {
    const best = bestFor(key);
    const isNew = submitTime(key, time);
    return { key, time, std, grade: gradeFor(time / std), isNew, best };
  }

  private resultRows(r: LegResult, label: string): [string, string][] {
    const rows: [string, string][] = [
      [label, formatDur(r.time)],
      ['ガイド基準', formatDur(r.std)],
      ['自己ベスト', r.isNew ? (r.best !== null ? `更新！（前回 ${formatDur(r.best)}）` : '初記録') : formatDur(r.best ?? r.time)],
    ];
    if (this.nearMisses > 0) rows.push(['崩落をかわした', `${this.nearMisses}回`]);
    if (this.laddersCrossed > 0) rows.push(['渡ったハシゴ', `${this.laddersCrossed}本`]);
    if (this.retries > 0) rows.push(['やり直し', `${this.retries}回`]);
    return rows;
  }

  private showGrade(r: LegResult, praise: string): void {
    const ex = document.getElementById('result-extra')!;
    ex.innerHTML = `<div class="grade ${r.grade.tone}">${r.grade.name}${r.isNew ? '<span class="new">自己ベスト</span>' : ''}</div><div>${praise}</div>`;
    ex.classList.remove('hidden');
  }

  // ---------------------------------------------------------------- relics
  private buildLore(def: MountainDef, field: MountainField, route: Route, root: THREE.Group): void {
    this.loreItems = [];
    const got = loreCollected();
    const glintTex = this.getPuffTex();
    LORE.filter((l) => l.stage === def.stageKey).forEach((entry, i) => {
      const s = entry.at * route.length;
      const c = route.pointAt(s);
      const d = route.directionAt(s);
      const side = i % 2 ? 1 : -1;
      const x = c.x - d.z * side * 2.6, z = c.z + d.x * side * 2.6;
      const y = field.height(x, z);
      const mesh = Game.loreMesh(entry.look);
      mesh.position.set(x, y, z);
      mesh.rotation.y = i * 1.7;
      root.add(mesh);
      // a glint so it reads at a distance (things you can touch should stand out)
      const glint = new THREE.Sprite(new THREE.SpriteMaterial({ map: glintTex, color: got.has(entry.id) ? 0xc8d4e0 : 0xffe2a0, transparent: true, depthWrite: false, opacity: 0.8 }));
      glint.scale.setScalar(0.9);
      glint.position.set(x, y + 0.7, z);
      root.add(glint);
      this.loreItems.push({ entry, mesh, glint, pos: new THREE.Vector3(x, y, z), taken: false });
    });
  }

  private static loreMesh(look: LoreEntry['look']): THREE.Object3D {
    const g = new THREE.Group();
    const M = (c: number, r = 0.8, m = 0) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m });
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
      const o = new THREE.Mesh(geo, mat); o.position.set(x, y, z); o.rotation.set(rx, ry, rz); o.castShadow = true; g.add(o); return o;
    };
    // a little cairn of stones marks every relic
    for (let k = 0; k < 4; k++) add(new THREE.DodecahedronGeometry(0.16 - k * 0.025, 0), M(0x6d6862, 0.95), (k % 2 ? 0.05 : -0.04), 0.1 + k * 0.17, 0);
    if (look === 'notebook') add(new THREE.BoxGeometry(0.22, 0.04, 0.3), M(0x7a2a22), 0.35, 0.03, 0.1, 0, 0.4, 0.1);
    else if (look === 'bottle') add(new THREE.CylinderGeometry(0.08, 0.08, 0.55, 12), M(0xe4621f, 0.5, 0.3), 0.35, 0.08, 0, Math.PI / 2, 0, 0.3);
    else if (look === 'axe') {
      add(new THREE.CylinderGeometry(0.02, 0.02, 0.75, 8), M(0x8a6a3a), 0.35, 0.3, 0, 0, 0, 0.12);
      add(new THREE.BoxGeometry(0.34, 0.05, 0.05), M(0x9aa0a6, 0.4, 0.8), 0.39, 0.66, 0);
    } else if (look === 'flag') {
      add(new THREE.CylinderGeometry(0.015, 0.015, 1.1, 6), M(0x6b4a2e), 0.3, 0.55, 0);
      add(new THREE.PlaneGeometry(0.34, 0.24), new THREE.MeshStandardMaterial({ color: 0xd8402f, side: THREE.DoubleSide, roughness: 0.9 }), 0.48, 0.95, 0);
    } else if (look === 'photo') add(new THREE.BoxGeometry(0.16, 0.01, 0.12), M(0xf4efe4, 0.6), 0.32, 0.02, 0.05, 0, 0.7, 0);
    else add(new THREE.TorusGeometry(0.06, 0.014, 6, 16), M(0x8f969c, 0.35, 0.9), 0.3, 0.05, 0.05, Math.PI / 2.4, 0, 0);
    return g;
  }

  private openLore(item: Game['loreItems'][number]): void {
    item.taken = true;
    item.mesh.visible = false;
    item.glint.visible = false;
    const first = collectLore(item.entry.id);
    const got = loreCollected().size;
    if (first) this.physio.stamina = Math.min(100, this.physio.stamina + 10);
    document.getElementById('lore-item')!.textContent = `拾った：${item.entry.item}`;
    document.getElementById('lore-title')!.textContent = item.entry.title;
    document.getElementById('lore-body')!.textContent = item.entry.body;
    document.getElementById('lore-note')!.textContent = first
      ? `記録帳に加えた（${got} / ${LORE.length}）。読んで、少し勇気が湧いた — 体力+10`
      : `記録帳にはもうある（${got} / ${LORE.length}）`;
    this.reading = true;
    this.input.enabled = false;
    if (document.pointerLockElement) document.exitPointerLock();
    this.audio.zip();
    document.getElementById('lore')!.classList.remove('hidden');
  }

  closeLore(): void {
    if (!this.reading) return;
    this.reading = false;
    document.getElementById('lore')!.classList.add('hidden');
    this.input.enabled = this.state === 'play';
    if (!this.mobile && this.state === 'play') this.tryPointerLock();
  }

  // ---------------------------------------------------------------- the dog
  private updateDog(dt: number): void {
    const p = this.player!, w = this.world!;
    if (!this.dog || !this.dogObj.group.visible) { this.physio.extraHeat = 0; return; }
    const tier = dogTier(this.dog.affection).hearts;
    const t = new THREE.Vector3();
    if (p.resting) {
      // curl up beside the climber
      t.set(p.pos.x + Math.cos(p.yaw) * 0.9, 0, p.pos.z - Math.sin(p.yaw) * 0.9);
    } else {
      // trot a few metres ahead along the track, a little to the side
      const s = clamp(p.routeS + (p.descending ? -3.4 : 3.4), 0, w.route.length);
      const c = w.route.pointAt(s);
      const d = w.route.directionAt(s);
      t.set(c.x - d.z * 1.2, 0, c.z + d.x * 1.2);
      // if the climber has wandered off the track, stay close to them instead
      if (p.routeDist > 6) t.set(p.pos.x + (c.x - p.pos.x) * 0.3, 0, p.pos.z + (c.z - p.pos.z) * 0.3);
    }
    t.y = p.groundAt(t.x, t.z).y;
    this.dogObj.update(dt, t, (x, z) => p.groundAt(x, z).y, p.resting, p.pos, this.dog.affection / 100);
    const close = this.dogObj.pos.distanceTo(p.pos) < 2.2;
    this.physio.extraHeat = p.resting && tier >= 2 && close ? 0.35 : 0;
    if (p.resting && tier >= 2 && close && !this.warned.has('snuggle')) {
      this.warned.add('snuggle');
      this.hud.banner(`${this.dog.name}が寄り添ってきた`, '温かい。体温が下がりにくい', 'good', 2200);
    }
    if (!p.resting) this.warned.delete('snuggle');
  }

  private dogBark(text?: string, sub = ''): void {
    if (!this.dog || !this.dogObj.group.visible) return;
    this.dogObj.bark();
    const d = this.dogObj.pos.distanceTo(this.player!.pos);
    this.audio.bark(clamp(1.4 - d / 20, 0.3, 1));
    if (text) this.hud.banner(text, sub, 'danger', 1900);
  }

  // ---------------------------------------------------------------- camp
  private campReward(r: LegResult | null): number {
    const base = !r ? 600 : { top: 1500, good: 1100, ok: 800, slow: 500 }[r.grade.tone];
    return base + this.nearMisses * 100;
  }

  private campData(rested: boolean): CampData {
    const w = this.world!;
    const exp = EXPEDITIONS[this.selected];
    const next = exp.stages[this.stageIndex + 1];
    const r = this.legResult;
    const rows: [string, string][] = [
      ...(!rested && r ? this.resultRows(r, '区間タイム') : []),
      ['高度順応', `${Math.round(this.acclim).toLocaleString('en-US')}m`],
      ['遠征日数', `${this.day}日目`],
    ];
    return {
      kicker: `${this.day}日目 · ${formatClock(rested ? 7 : this.hours)}`,
      title: `${w.def.goalName}（${w.def.summitAltitude.toLocaleString('en-US')}m）`,
      desc: rested
        ? `${w.def.goalName}で1日休養した。体が高度に慣れ、指先の感覚も少し戻った。だが、モンスーンは近づいている。`
        : `${w.def.goalName}に到着。テントに潜り込み、雪を溶かして湯を沸かす。明日は「${next?.stageName ?? '山頂'}」。`,
      money: this.money,
      grade: !rested && r ? { name: r.grade.name, tone: r.grade.tone, isNew: r.isNew, praise: Game.praiseFor(r.grade) } : null,
      rows,
      kitchen: this.stageIndex <= 1 ? 'full' : 'basic',
      ateTonight: this.ateTonight,
      dog: this.dog,
      dogMeet: !this.dog,
      pettedTonight: this.pettedTonight,
      loadout: next?.goal === 'summit' ? this.spares : null,
      departLabel: next ? (next.goal === 'summit' ? `今夜23時に出発 — ${next.stageName}` : `翌朝出発 — ${next.stageName}`) : '出発',
      lore: { got: loreCollected(), list: LORE.filter((l) => l.stage.startsWith(this.selected)) },
    };
  }

  private campActions(rested: boolean): CampActions {
    return {
      data: () => this.campData(rested),
      eat: (id) => {
        const m = MEALS.find((x) => x.id === id)!;
        if (this.ateTonight || this.money < m.price) return false;
        this.money -= m.price;
        this.ateTonight = id;
        this.mealNext = id;
        if (id === 'tea') { this.frostCarry = Math.max(0, this.frostCarry - 15); this.physio.frostbite = Math.max(0, this.physio.frostbite - 15); }
        if (id === 'dalbhat') this.acclim += 100;
        this.saveAtCamp();
        return true;
      },
      treat: () => {
        if (!this.dog || this.money < TREAT.price) return false;
        this.money -= TREAT.price;
        this.dog.affection = Math.min(100, this.dog.affection + 20);
        this.saveAtCamp();
        return true;
      },
      pet: () => {
        if (!this.dog || this.pettedTonight) return;
        this.pettedTonight = true;
        this.dog.affection = Math.min(100, this.dog.affection + 5);
        this.saveAtCamp();
      },
      adopt: (name) => {
        this.dog = { name, affection: 10 };
        this.saveAtCamp();
      },
      spares: (n) => { this.spares = n; this.saveAtCamp(); },
      depart: () => { this.campScreen.close(); this.withLoading(() => this.departNextStage()); },
      rest: () => this.restDay(),
      quit: () => { this.campScreen.close(); this.toTitle(); },
      sound: (k) => {
        const a = this.audio;
        ({ slurp: () => a.slurp(), munch: () => a.munch(), gulp: () => a.gulp(), bark: () => a.bark(), coin: () => a.coin(), stamp: () => a.stamp(), fanfare: () => a.fanfare(), clink: () => a.clink() })[k]();
      },
    };
  }

  private static praiseFor(g: Grade): string {
    return {
      top: 'シェルパ並みの速さだ。BCのテントがざわついている。',
      good: 'プロのガイドと同じペース。文句なしだ。',
      ok: '遠征隊員として十分なペース。着実に登った。',
      slow: '時間はかかったが、生きて着いた。それが一番大事だ。',
    }[g.tone];
  }

  private beginDescent(): void {
    if (!this.player) return;
    this.state = 'play';
    this.player.descending = true;
    this.input.enabled = true;
    this.showScreen(null);
    this.hud.show(true);
    this.hud.banner('下山開始', '登頂は折り返し地点にすぎない。C4へ生きて帰れ', '', 4000);
    this.lastDownMark = this.world!.def.landmarks.length - 1;
    this.saveCheckpoint('山頂');
    if (!this.mobile) this.tryPointerLock();
  }

  // ---------------------------------------------------------------- loop
  start(): void {
    this.running = true;
    this.lastFrame = performance.now();
    const tick = (t: number) => {
      if (!this.running) return;
      let dt = (t - this.lastFrame) / 1000;
      this.lastFrame = t;
      dt = Math.min(dt, 0.05);
      for (let i = 0; i < this.simSpeed; i++) this.step(dt);
      // Behind the camp screens the 3D view barely changes: redraw it rarely so the
      // celebration and eating animations stay smooth (and phones stay cool).
      const overlay = this.campScreen.isOpen || this.campScreen.celebrating;
      if (!overlay || this.frame % 12 === 0) this.render();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  dispose(): void {
    this.running = false;
    this.input.dispose();
    this.audio.dispose();
    this.post.dispose();
    this.renderer.dispose();
    window.__THREE_GAME_DIAGNOSTICS__ = undefined;
    window.__THREE_GAME_TEST_HOOKS__ = undefined;
  }

  private step(dt: number): void {
    this.frame++;
    if (this.pausedForScreenshot) { this.publishDiagnostics(); return; }
    this.realTime += this.reducedMotion ? 0 : dt;
    const intents = this.input.poll();
    if (intents.pausePressed) {
      if (this.state === 'play') this.setPaused(true);
      else if (this.state === 'paused') this.setPaused(false);
    }
    if (intents.mapPressed && (this.state === 'play' || this.map.open)) this.map.show(!this.map.open);
    if (this.state !== 'play' && this.map.open) this.map.show(false);
    if (this.map.open && this.player) this.map.update(this.player.pos.x, this.player.pos.z, this.player.yaw, this.player.routeS);
    if (this.state === 'play' && !this.tutorial.open && !this.reading) this.updatePlay(dt);
    else if ((this.tutorial.open || this.reading) && this.player) { this.updateCamera(0); this.updateEnvironment(0, this.weather.state.storm); }
    else if (this.state === 'dead') this.updateDead(dt);
    else if (this.state === 'title') this.updateTitle(dt);
    this.input.consumeEdges();
    this.publishDiagnostics();
  }

  private updateTitle(dt: number): void {
    const w = this.world!;
    this.body.group.visible = false;
    this.titleAngle += dt * 0.012;
    const r = 820;
    const cx = w.def.route[0][0] * 0.3;
    const cz = w.def.route[0][1] * 0.3;
    this.camera.position.set(cx + Math.cos(this.titleAngle) * r, 330, cz + Math.sin(this.titleAngle) * r);
    this.camera.lookAt(cx * 0.4, 170, cz * 0.4);
    this.hours = 5.75;
    this.updateEnvironment(dt, 0);
    this.post.params.hypoxia = 0;
    this.post.params.cold = 0;
    this.post.params.fade = 0;
    this.post.params.drift = 0;
    this.post.params.fatigue = 0;
    this.post.params.whiteout = 0;
    this.headlamp.intensity = 0;
  }

  private updateDead(dt: number): void {
    this.deathTimer += dt;
    if (this.world && this.player) this.updateChunks(dt, false);
    if (this.hitAnim) {
      this.updateHitCamera();
      // powder blast whites the view out, then everything goes dark
      const t = this.deathTimer;
      this.post.params.whiteout = Math.min(1, t / 0.5) * Math.max(0, 1 - (t - 1.6) / 1.8) * 0.95;
      this.flash = Math.max(0, this.flash - dt * 1.5);
      this.post.params.flash = this.flash;
      if (t > 1.8) this.fade = Math.min(1, this.fade + dt * 0.5);
    } else {
      this.fade = Math.min(1, this.fade + dt * 0.45);
    }
    this.post.params.fade = this.fade * 0.85;
    this.updateEnvironment(dt, this.weather.state.storm);
    this.audio.update({
      wind: this.weather.state.windKmh, gust: this.weather.state.gust, storm: this.weather.state.storm, flow: 0,
      breathPhase: 0, breathRate: 10, effort: 0, heartPhase: 0, heartRate: 0, heartLoud: 0, drone: 0,
    });
    if (this.deathTimer > (this.hitAnim ? 3.8 : 2.4) && document.getElementById('result')!.classList.contains('hidden')) this.showDeath();
  }

  private updatePlay(dt: number): void {
    const w = this.world!;
    const p = this.player!;
    const ph = this.physio;
    const intents = this.input.intents;
    this.playTime += dt;
    const gameMinutes = (dt * TIME_SCALE) / 60;
    this.hours += gameMinutes / 60;

    const altitude = this.altitudeAt(p.pos.y);
    this.maxAltitude = Math.max(this.maxAltitude, altitude);
    this.weather.update(dt, this.hours, altitude, this.playTime);
    const ws = this.weather.state;

    // Oxygen flow
    if (intents.o2Up && ph.hasO2) { ph.flow = Math.min(4, ph.flow + 0.5); this.audio.valve(); }
    if (intents.o2Down && ph.hasO2) { ph.flow = Math.max(0, ph.flow - 0.5); this.audio.valve(); }

    // Interactions: cache pickup / bottle swap
    let interact: string | null = null;
    const cache = w.props.caches.find((c) => !c.taken && c.position.distanceTo(p.pos) < 3);
    const relic = this.loreItems.find((l) => !l.taken && l.pos.distanceTo(p.pos) < 2.8);
    if (relic && this.swapT <= 0) {
      interact = '拾う';
      if (intents.interactPressed) this.openLore(relic);
    } else if (this.swapT > 0) {
      this.swapT -= dt;
      if (this.swapT <= 0) {
        ph.spares -= 1;
        ph.bottle = BOTTLE_LITERS;
        this.audio.valve();
        this.hud.banner('ボンベ交換完了', `残り予備 ${ph.spares}本`, 'good');
      }
    } else if (cache) {
      interact = '回収';
      if (intents.interactPressed) {
        cache.taken = true;
        cache.mesh.visible = false;
        ph.spares += 1;
        this.audio.clink();
        this.hud.banner('デポしたボンベを回収', `予備 ${ph.spares}本`, 'good');
      }
    } else if (ph.hasO2 && ph.spares > 0 && ph.bottle < BOTTLE_LITERS * 0.35) {
      interact = '交換';
      if (intents.interactPressed) {
        this.swapT = 3.2;
        this.hud.banner('ボンベ交換中…', 'グローブを外すと指が凍る', '', 3000);
        this.audio.zip();
      }
    }

    // Player
    const deepSnow = w.def.id === 'k2' && p.routeS > w.route.waypointS[7] - 5;
    const swapping = this.swapT > 0;
    if (swapping) intents.rest = true;
    if (ph.collapsed) intents.rest = true;
    p.update(dt, intents, {
      hypoxia: ph.performanceHypoxia,
      stamina: ph.stamina,
      collapsed: ph.collapsed || swapping,
      frostbite: ph.frostbite,
      gust: ws.gust,
      windDir: this.windDir,
      rng: this.rng,
      deepSnow,
      drift: smoothstep(45, 95, ph.hace),
      adrenaline: this.seracWarn > 0 ? 1 : 0,
      // spare bottles are ~3.5 kg each: carrying more is slower (and lighter as you use them)
      load: w.def.o2 === 'summit' && ph.hasO2 ? clamp(1 + 0.06 * (1 - ph.spares), 0.86, 1.08) : 1,
    });
    this.handlePlayerEvents();
    // Ladder crossings: a small "made it" each time.
    if (p.onLadder && this.ladderEnterS < 0) this.ladderEnterS = p.routeS;
    if (!p.onLadder && this.ladderEnterS >= 0) {
      if (p.mode === 'walk' && Math.abs(p.routeS - this.ladderEnterS) > 2) {
        this.laddersCrossed += 1;
        this.audio.cleared();
        this.hud.banner('渡り切った', this.laddersCrossed === 1 ? '最初のハシゴを越えた' : `ハシゴ ${this.laddersCrossed}本目`, 'good', 1500);
        if (this.laddersCrossed === 1) this.radio.say('ladder1', '最初のハシゴを越えたな。下は見るなよ、その調子だ。');
      }
      this.ladderEnterS = -1;
    }

    this.updateDog(dt);
    for (const l of this.loreItems) if (!l.taken) l.glint.position.y = l.pos.y + 0.7 + Math.sin(this.realTime * 2.2 + l.pos.x) * 0.12;

    // Physiology
    const handsExposed = swapping || p.mode === 'transfer';
    const cause = ph.update({
      altitude,
      exertion: p.mode === 'slide' ? 0.6 : p.exertion,
      resting: p.resting,
      windKmh: ws.windKmh * (p.resting ? 0.75 : 1),
      ambientC: ws.ambientC,
      gameMinutes,
      dt,
      handsExposed,
    });
    if (ph.hasO2 && ph.bottle <= 0 && !this.warned.has('o2empty')) {
      this.warned.add('o2empty');
      this.audio.alarm();
      this.hud.banner('酸素ボンベが空', ph.spares > 0 ? '予備ボンベに交換しろ（F / 交換）' : '予備はない。急いで下れ', 'danger', 4500);
    }
    if (ph.bottle > 0) this.warned.delete('o2empty');
    if (ph.collapsed) {
      this.collapseT += dt;
      if (!this.warned.has('collapse')) {
        this.warned.add('collapse');
        this.hud.banner('息が上がった', '動けない。呼吸が戻るまで待て', 'danger');
      }
      if (this.collapseT > 50 && ph.coreTemp < 34.5) this.die('exhaustion');
    } else { this.collapseT = 0; this.warned.delete('collapse'); }
    if (cause) this.die(cause);
    this.vitalWarnings(altitude);

    // Serac fall (K2 traverse)
    this.updateSerac(dt);

    // Base-camp radio and the life of the mountain around you.
    this.radio.update(dt);
    this.ambient.update(dt, p.pos, w.field, {
      altitude, day: this.day, night: this.env.state.dayFactor < 0.3, glacier: !!w.def.valley || !!w.def.crevasses?.length, storm: ws.storm,
    });
    const prog = p.routeS / w.route.length;
    if (!this.paceChecked && prog > 0.5 && !p.descending) {
      this.paceChecked = true;
      const deadline = w.def.goal === 'summit' ? TURNAROUND : 18.5;
      const projected = w.def.startHours + (this.hours - w.def.startHours) / prog;
      this.radio.say('pace', projected > deadline - 0.5
        ? `半分を過ぎた。だがこのペースだと着くのは${formatClock(projected)}ごろだ。休みを短くしろ。`
        : `半分を過ぎた。いいペースだ。この調子なら${formatClock(projected)}ごろには着ける。`);
    }
    if (ph.spo2 < 60) this.radio.say('spo2', ph.hasO2 ? '声がおかしいぞ。酸素が足りていない、流量を上げろ。' : '呼吸が荒いな。無理をするな、休みながら行け。');
    if (ph.coreTemp < 35.6) this.radio.say('cold', '震えているな？止まるな、動いて体を温めろ。');
    if (ws.storm > 0.3) this.radio.say('storm', '雲が上がってきた！急げ。視界がなくなる前にロープを離すな。');
    if (ph.hasO2 && ph.bottle < BOTTLE_LITERS * 0.25) this.radio.say('o2low', 'ボンベの残りを確認しろ。交換の準備だ。');

    // Landmarks, summit, return
    this.updateProgress();

    // Turnaround time
    if (!this.turnWarned && w.def.goal === 'summit' && this.hours >= TURNAROUND && !this.summitReached) {
      this.turnWarned = true;
      this.audio.alarm();
      this.hud.banner('折り返し時刻を過ぎた', '登頂しても、暗くなる前に戻れないかもしれない', 'danger', 5000);
    }
    if (ws.gustWarning > 0 && !this.warned.has('gust')) {
      this.warned.add('gust');
      if (p.slopeDeg > 22 && !p.clip) this.hud.banner('突風が来る', '休むボタンで身を低くして耐えろ', '', 2200);
    }
    if (ws.gustWarning < 0) this.warned.delete('gust');
    if (ws.storm > 0.4 && !this.warned.has('storm')) {
      this.warned.add('storm');
      this.hud.banner('天候悪化', '雲が上がってきた。視界と体温に注意', 'danger', 4500);
    }

    // Camera
    this.updateCamera(dt);
    this.updateEnvironment(dt, ws.storm);
    this.breath.update(dt, ph.breathPhase, this.camera, this.tmpV.copy(this.windDir).multiplyScalar(ws.windKmh / 3.6), 1, 0.25 + this.env.state.dayFactor * 0.75);

    // Post & audio feedback
    const cold = clamp((36.6 - ph.coreTemp) / 4, 0, 1) * 0.7 + ph.frostbite / 250 + ws.storm * 0.15;
    this.flash = Math.max(0, this.flash - dt * 1.8);
    Object.assign(this.post.params, {
      hypoxia: Math.max(ph.hypoxia, smoothstep(40, 100, ph.hace) * 0.6),
      cold: clamp(cold, 0, 0.9),
      fatigue: clamp(1 - ph.stamina / 45, 0, 1),
      pulse: ph.heartPhase,
      flash: this.flash,
      whiteout: ws.storm * 0.9 + ws.gust * 0.2,
      fade: this.fade,
      drift: smoothstep(45, 95, ph.hace),
    });
    this.audio.update({
      wind: ws.windKmh, gust: ws.gust, storm: ws.storm, flow: ph.effectiveFlow,
      breathPhase: ph.breathPhase, breathRate: ph.breathRate, effort: clamp(p.exertion + ph.hypoxia * 0.5, 0, 1),
      heartPhase: ph.heartPhase, heartRate: ph.heartRate,
      heartLoud: clamp(1 - ph.stamina / 40, 0, 1) * 0.8 + ph.hypoxia * 0.6,
      drone: this.summitReached ? 0.5 : this.env.state.dayFactor * 0.15 * smoothstep(5.2, 6.2, this.hours) * (1 - smoothstep(7.5, 8.5, this.hours)),
    });
    this.updateHud(altitude, interact);
  }

  private vitalWarnings(_altitude: number): void {
    const ph = this.physio;
    const warn = (key: string, cond: boolean, title: string, sub: string, clear: boolean) => {
      if (cond && !this.warned.has(key)) { this.warned.add(key); this.hud.banner(title, sub, 'danger', 4200); this.audio.alarm(); }
      if (clear) this.warned.delete(key);
    };
    warn('spo2', ph.spo2 < 58, '血中酸素が危険域', '酸素流量を上げろ', ph.spo2 > 64);
    warn('hace', ph.hace > 45, '頭痛とめまい…視界が揺れる', 'HACEの兆候。酸素を増やすか、下山を', ph.hace < 20);
    warn('cold', ph.coreTemp < 35.2, '体が震えて止まらない', '低体温症の兆候。立ち止まるな', ph.coreTemp > 35.8);
    warn('frost', ph.frostbite > 60, '指の感覚がない', '凍傷が進行している', false);
  }

  private handlePlayerEvents(): void {
    const p = this.player!;
    for (const e of p.events) {
      switch (e.type) {
        case 'step': this.audio.step(e.surface, e.heavy); break;
        case 'slip':
          if (e.caught) {
            this.audio.impact();
            this.audio.clink();
            this.flash = 0.5;
            this.physio.stamina = Math.max(0, this.physio.stamina - 12);
            this.hud.banner('足が滑った — ロープが止めた', '確保していなければ死んでいた', '', 2800);
          } else {
            this.audio.slip();
            this.flash = 0.7;
            this.hud.banner('滑落！', 'ピッケルを打ち込め（休むボタン長押し / Space）', 'danger', 2600);
          }
          break;
        case 'axe': this.audio.axe(); break;
        case 'arrest':
          this.audio.axe();
          this.hud.banner('滑落停止', '生きている。ルートへ戻れ', 'good', 2600);
          break;
        case 'fallDeath':
          this.audio.impact();
          this.die('fall');
          break;
        case 'clipped': this.audio.clink(); this.hud.banner('フィックスロープに確保', '', 'good', 1500); break;
        case 'unclipped': this.audio.clink(); this.hud.banner('ロープから外した', '無確保。足元に注意', '', 1800); break;
        case 'transferred': this.audio.clink(); this.hud.banner('付け替え完了', '', 'good', 1200); break;
        case 'anchorBlock': this.hud.banner('アンカーで止まった', 'カラビナを付け替えろ（クリップ / E）', '', 2200); break;
        case 'unclipRefused': this.hud.banner('ここでは外せない', '急斜面の途中。ロープの終端かアンカーで付け替えろ', '', 2200); break;
        case 'noRope':
          if (performance.now() - this.lastNoRopeMsg > 1800) {
            this.lastNoRopeMsg = performance.now();
            this.audio.clink();
            this.hud.banner('近くにロープがない', '赤いフィックスロープの近くでクリップ', '', 1500);
          }
          break;
        case 'rappel': this.hud.banner('懸垂下降', 'ロープに体重を預けて一気に下る', 'good', 2000); break;
        case 'tooSteep': this.hud.banner('急すぎて登れない', 'フィックスロープに確保すれば登れる', '', 2200); break;
        case 'gustKnock': this.audio.slip(); break;
        case 'crevasseDeath': this.audio.slip(); this.die('crevasse'); break;
        case 'crevasseCaught':
          this.audio.impact(); this.audio.clink(); this.flash = 0.6;
          this.physio.stamina = Math.max(0, this.physio.stamina - 25);
          this.hud.banner('クレバスに落ちた — ロープが止めた', 'ロープを手繰って這い上がった', 'danger', 3200);
          break;
        case 'actionCancelled':
          this.hud.banner('ロープ作業を中断', '元のロープには確保されたまま', '', 1600);
          break;
        case 'ladderWobble':
          this.audio.clink();
          this.hud.banner('ハシゴの上でよろけた', 'ロープに確保していて助かった', '', 2400);
          break;
      }
    }
  }

  private updateSerac(dt: number): void {
    const w = this.world!;
    const p = this.player!;
    const TEXT = {
      serac: { zone: ['セラック直下', '頭上に巨大な氷塔。立ち止まるな'], warn: ['頭上で氷が割れる音！', '落下ラインから離れろ'] },
      icefall: { zone: ['氷塔の崩壊帯', '不安定な氷塔の間を抜ける。急げ'], warn: ['氷塔が崩れる音！', '崩落ラインから離れろ'] },
      rock: { zone: ['落石地帯', '頭上の岩壁から石が落ちてくる'], warn: ['落石！', '音のした方を見て、横へ逃げろ'] },
    } as const;
    let active: (typeof w.props.hazards)[number] | null = null;
    for (const hz of w.props.hazards) {
      if (p.routeS > hz.s0 - 5 && p.routeS < hz.s1 + 5) active = hz;
    }
    if (active) this.hzInside = active;
    else if (this.hzInside && this.state === 'play') {
      const hz = this.hzInside;
      this.hzInside = null;
      if (p.descending ? p.routeS < hz.s0 - 5 : p.routeS > hz.s1 + 5) this.hazardCleared(hz.kind);
    }
    if (active && this.state === 'play') {
      const hz = active;
      const key = `zone-${hz.kind}-${hz.s0}`;
      if (!this.warned.has(key)) {
        this.warned.add(key);
        this.hud.banner(TEXT[hz.kind].zone[0], TEXT[hz.kind].zone[1], 'danger', 3600);
      }
      this.seracTimer -= dt;
      if (this.dog && this.dogObj.group.visible && dogTier(this.dog.affection).hearts >= 3 && !this.dogWarned && this.seracWarn < 0 && this.seracTimer < 1.8) {
        // it hears the ice groan before you do
        this.dogWarned = true;
        this.dogObj.lookAt(hz.origin, 3);
        this.dogBark(`${this.dog.name}が上を見て吠えた！`, '何か来る — 身構えろ');
      }
      if (this.seracTimer <= 0 && this.seracWarn < 0) {
        this.dogWarned = false;
        // the warning stays up until the debris has come through (~5 s to arrive, ~2 s to pass)
        this.seracWarn = 7;
        const isRock = hz.kind === 'rock';
        const offset = (this.rng() - 0.5) * (isRock ? 6 : 10);
        const sLane = clamp(p.routeS + offset, hz.s0, hz.s1);
        w.route.pointAt(sLane, this.seracLane);
        let warnSub: string = TEXT[hz.kind].warn[1];
        if (isRock) {
          // Rocks come down one side of the line; a step or two to the other side (even on the rope) is enough.
          const side = this.rng() < 0.5 ? -1 : 1;
          const d = w.route.directionAt(sLane);
          this.seracLane.x += -d.z * side * 1.4;
          this.seracLane.z += d.x * side * 1.4;
          // (-d.z, d.x) is the climber's right when facing up the route
          warnSub = side > 0 ? 'ルートの右側に落ちてくる — 左へ寄れ' : 'ルートの左側に落ちてくる — 右へ寄れ';
          this.rockSide = side;
        }
        // Which way it falls: always DOWN the slope. Rock comes down the gully the route climbs;
        // ice comes straight across the route from the uphill side.
        const rd0 = w.route.directionAt(sLane);
        const fallDir = new THREE.Vector3();
        if (isRock) fallDir.set(-rd0.x, 0, -rd0.z).normalize();
        else {
          const n = w.field.normal(this.seracLane.x, this.seracLane.z, new THREE.Vector3());
          const down = new THREE.Vector3(n.x, 0, n.z);
          fallDir.set(-rd0.z, 0, rd0.x);
          const k = down.lengthSq() > 1e-6 ? fallDir.dot(down.normalize()) : 0;
          if (Math.abs(k) > 0.12) { if (k < 0) fallDir.multiplyScalar(-1); }
          else if (fallDir.dot(this.tmpV.copy(this.seracLane).sub(hz.origin).setY(0)) < 0) fallDir.multiplyScalar(-1);
        }
        if (!isRock) {
          // Say where it is coming from and which way along the route is clear.
          const rd = rd0;
          const fromRight = -fallDir.x * -rd.z + -fallDir.z * rd.x > 0;
          const ahead = sLane - p.routeS;
          const goingUp = !p.descending;
          const run = Math.abs(ahead) < 1.5 ? '真上だ — 止まるな、走り抜けろ'
            : (ahead > 0) === goingUp ? '崩落ラインは前方 — 下がれ' : '崩落ラインは後方 — 前へ急げ';
          warnSub = `${fromRight ? '右手' : '左手'}から来る。${run}`;
        }
        if (isRock) this.audio.rockfall(); else this.audio.crack();
        this.nearThisFall = false;
        this.radio.interrupt();
        this.hazSrc.copy(hz.origin);
        if (this.dog && this.dogObj.group.visible) this.dogObj.lookAt(hz.origin, 4);
        this.flash = 0.2;
        this.hud.banner(TEXT[hz.kind].warn[0], warnSub, 'danger', 4000);
        this.chunkKind = hz.kind;
        const toLane = this.tmpV.copy(fallDir);
        const laneDir = w.route.directionAt(sLane);
        const rock = hz.kind === 'rock';
        // Falling ice/rock reaches the lane ~5 s after the warning: enough to step clear if you react.
        const dist = hz.kind === 'icefall' ? 32 : 28;
        const n = rock ? 9 : 7;
        for (let i = 0; i < n; i++) {
          const mesh = new THREE.Mesh(this.chunkGeo, rock ? this.rockChunkMat : this.chunkMat);
          const sc = rock ? 0.3 + this.rng() * 0.5 : hz.kind === 'icefall' ? 0.7 + this.rng() * 0.6 : 0.9 + this.rng() * 1.0;
          mesh.scale.setScalar(sc);
          mesh.castShadow = true;
          const start = this.seracLane.clone().addScaledVector(toLane, -dist - this.rng() * 10);
          start.y = Math.max(w.field.height(start.x, start.z), this.seracLane.y) + (rock ? 9 : 14) + this.rng() * 5;
          start.addScaledVector(rock ? hz.along : laneDir, (this.rng() - 0.5) * (rock ? 1.6 : 2));
          this.scene.add(mesh);
          const puff = new THREE.Sprite(new THREE.SpriteMaterial({
            map: this.getPuffTex(), color: rock ? 0xb8aa98 : 0xf4f7fb, transparent: true, opacity: 0, depthWrite: false,
          }));
          puff.scale.setScalar(sc * 3);
          this.scene.add(puff);
          const speed = hz.kind === 'icefall' ? 6 + this.rng() * 1 : 5 + this.rng() * 1.2;
          this.chunks.push({ mesh, puff, pos: start, vel: toLane.clone().multiplyScalar(speed), life: 9 });
        }
        // the collapse itself: a powder cloud boiling up off the source, toward the lane
        for (let i = 0; i < 6; i++) {
          const sp = new THREE.Sprite(new THREE.SpriteMaterial({
            map: this.getPuffTex(), color: isRock ? 0xa89a88 : 0xf2f5fa, transparent: true, opacity: 0, depthWrite: false,
          }));
          const k = i / 5;
          sp.position.copy(this.seracLane).addScaledVector(toLane, -dist * (1 - k * 0.45) - 4).add(new THREE.Vector3((this.rng() - 0.5) * 8, 0, (this.rng() - 0.5) * 8));
          sp.position.y = Math.max(w.field.height(sp.position.x, sp.position.z), this.seracLane.y) + 6 + this.rng() * 6;
          this.scene.add(sp);
          this.billows.push({ sprite: sp, age: -k * 0.8, size: (isRock ? 6 : 10) + this.rng() * 6, rise: 1 + this.rng() * 1.5 });
        }
      }
    }
    if (this.seracWarn >= 0) {
      this.seracWarn -= dt;
      if (this.seracWarn < 0) {
        this.seracTimer = 22 + this.rng() * 18;
        if (this.nearThisFall && this.state === 'play') {
          this.nearMisses += 1;
          this.audio.cleared();
          this.hud.banner('かわした！', this.nearMisses === 1 ? '間一髪。落下ラインから出ていた' : `間一髪 — ${this.nearMisses}回目`, 'good', 2200);
          this.radio.say('nearmiss', '今のは危なかった！いい反応だ。');
        }
        this.nearThisFall = false;
      }
    }
    this.updateChunks(dt, true);
  }

  private getPuffTex(): THREE.Texture {
    if (this.puffTex) return this.puffTex;
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.45, 'rgba(255,255,255,0.55)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
    this.puffTex = new THREE.CanvasTexture(c);
    return this.puffTex;
  }

  /** Falling ice/rock with its powder cloud. Only lethal while playing. */
  private updateChunks(dt: number, lethal: boolean): void {
    const w = this.world!;
    const p = this.player!;
    let nearest = 1e9;
    for (let i = this.chunks.length - 1; i >= 0; i--) {
      const c = this.chunks[i];
      c.life -= dt;
      c.vel.y -= 9.8 * dt;
      const gPrev = w.field.height(c.pos.x, c.pos.z);
      c.pos.addScaledVector(c.vel, dt);
      const g = w.field.height(c.pos.x, c.pos.z) + c.mesh.scale.x * 0.6;
      if (c.pos.y < g) {
        // Rolling into rising ground: it stops, it does not climb.
        if (g - c.mesh.scale.x * 0.6 > gPrev + 0.02) { c.vel.x *= 0.35; c.vel.z *= 0.35; }
        // Bounce vertically only: falling ice and rock keep their line, so the lane in the
        // warning is the lane they actually come down.
        c.pos.y = g;
        if (c.vel.y < 0) c.vel.y = -c.vel.y * 0.45 + 1.5;
      }
      c.mesh.position.copy(c.pos);
      c.mesh.rotation.x += dt * 3;
      c.mesh.rotation.z += dt * 2;
      // powder trails a little behind and swells as the block breaks up
      const age = 9 - c.life;
      c.puff.position.copy(c.pos).addScaledVector(c.vel, -0.12);
      c.puff.scale.setScalar(c.mesh.scale.x * (4 + age * 2.4));
      (c.puff.material as THREE.SpriteMaterial).opacity = Math.min(1, age * 1.5) * Math.min(1, c.life / 2) * 0.62;
      const d = c.pos.distanceTo(this.tmpV.copy(p.pos).setY(p.pos.y + 1));
      nearest = Math.min(nearest, d);
      if (lethal && d < c.mesh.scale.x * 0.8 + 3) this.nearThisFall = true;
      if (lethal && this.state === 'play' && p.mode !== 'dead' && d < c.mesh.scale.x * 0.8 + 0.6) {
        this.flash = 0.8;
        this.audio.impact();
        this.hitDir.copy(c.vel).setY(0).normalize();
        this.startHit();
        this.die(this.chunkKind === 'rock' ? 'rock' : this.chunkKind === 'icefall' ? 'icefall' : 'serac');
      }
      if (c.life <= 0) {
        this.scene.remove(c.mesh);
        this.scene.remove(c.puff);
        (c.puff.material as THREE.SpriteMaterial).dispose();
        this.chunks.splice(i, 1);
      }
    }
    for (let i = this.billows.length - 1; i >= 0; i--) {
      const b = this.billows[i];
      b.age += dt;
      const a = Math.max(0, b.age);
      b.sprite.scale.setScalar(b.size * (0.5 + a * 0.35));
      b.sprite.position.y += b.rise * dt;
      (b.sprite.material as THREE.SpriteMaterial).opacity = Math.min(1, a * 2) * Math.max(0, 1 - a / 9) * 0.75;
      if (a > 9) {
        this.scene.remove(b.sprite);
        (b.sprite.material as THREE.SpriteMaterial).dispose();
        this.billows.splice(i, 1);
      }
    }
    // the ground shudders as it comes through
    if (lethal && nearest < 25) p.shake = Math.max(p.shake, (1 - nearest / 25) * 0.7);
  }

  private startHit(): void {
    const p = this.player!;
    this.hitAnim = true;
    this.hud.show(false);
    this.radio.interrupt(99);
    p.eyePosition(this.hitEye);
    this.hitYaw = p.yaw;
    this.hitPitch = p.pitch;
  }

  /** Thrown off your feet along the debris line, tumbling, then buried in powder. */
  private updateHitCamera(): void {
    const w = this.world!;
    const t = this.deathTimer;
    const fly = 1 - Math.pow(1 - Math.min(1, t / 0.9), 3);
    const cam = this.camera;
    cam.position.copy(this.hitEye).addScaledVector(this.hitDir, fly * 4.5);
    const ground = w.field.height(cam.position.x, cam.position.z);
    const hop = Math.sin(Math.min(1, t / 0.9) * Math.PI) * 0.8;
    const eyeH = THREE.MathUtils.lerp(1.6, 0.3, Math.min(1, t / 1.1)) + hop;
    cam.position.y = Math.max(ground + 0.25, THREE.MathUtils.lerp(this.hitEye.y, ground + eyeH, Math.min(1, t / 0.4)));
    const shake = Math.max(0, 1 - t / 1.4) * (this.reducedMotion ? 0 : 1);
    cam.rotation.order = 'YXZ';
    cam.rotation.y = this.hitYaw + fly * 1.1 + (Math.random() - 0.5) * shake * 0.25;
    cam.rotation.x = this.hitPitch + Math.sin(fly * Math.PI) * -0.9 + fly * 0.5 + (Math.random() - 0.5) * shake * 0.25;
    cam.rotation.z = fly * 1.3 + Math.sin(t * 6) * shake * 0.3;
    cam.updateMatrixWorld();
  }

  private updateProgress(): void {
    const w = this.world!;
    const p = this.player!;
    const lms = w.def.landmarks;
    for (let i = lms.length - 1; i >= 1; i--) {
      if (p.routeS >= w.route.waypointS[lms[i].routeIndex] - 3 && i > this.lastLandmark && p.routeDist < 25) {
        this.lastLandmark = i;
        if (i < lms.length - 1) {
          this.hud.banner(lms[i].name, lms[i].note, 'good', 3600);
          this.saveCheckpoint(lms[i].name);
        }
        this.radio.lore(w.def.stageKey, i);
        break;
      }
    }
    if (p.descending) {
      for (let i = Math.min(this.lastDownMark, lms.length) - 1; i >= 1; i--) {
        if (p.routeS <= w.route.waypointS[lms[i].routeIndex] + 3 && p.routeDist < 25) {
          this.lastDownMark = i;
          this.hud.banner(lms[i].name, `${w.def.campName}まであと${Math.round(p.routeS)}m`, 'good', 2400);
          this.saveCheckpoint(lms[i].name);
          break;
        }
      }
    }
    if (w.def.goal === 'camp') {
      // Reaching the first tents counts: no need to walk to the back of camp.
      if (p.routeS >= w.route.length - 20 && p.routeDist < 14 && this.state === 'play') {
        this.state = 'camp';
        this.input.enabled = false;
        if (document.pointerLockElement) document.exitPointerLock();
        const campAlt = w.def.summitAltitude;
        this.acclim = Math.max(this.acclim, campAlt + 300);
        this.frostCarry = Math.max(0, this.physio.frostbite * 0.8 - 5);
        this.saveAtCamp();
        const { std, elapsed } = this.legStd();
        this.legResult = std ? this.rate(w.def.stageKey, elapsed, std.up) : null;
        this.legDeaths = 0;
        // a new night at camp
        const reward = this.campReward(this.legResult);
        this.money += reward;
        this.mealNext = null;
        this.ateTonight = null;
        this.pettedTonight = false;
        if (this.dog) this.dog.affection = Math.min(100, this.dog.affection + 5);
        this.saveAtCamp();
        this.hud.show(false);
        const r = this.legResult;
        this.campScreen.celebrate({
          kicker: `${this.day}日目 · ${formatClock(this.hours)}`,
          title: `${w.def.goalName} 到着`,
          sub: `${w.def.summitAltitude.toLocaleString('en-US')} m`,
          grade: r ? { name: r.grade.name, tone: r.grade.tone, isNew: r.isNew } : null,
          reward,
          dogName: this.dog?.name ?? null,
        }, this.campActions(false).sound, () => this.showCamp(false));
        this.radio.interrupt(99);
      }
      return;
    }
    if (!this.summitReached && p.routeS >= w.route.length - 2.5 && p.routeDist < 6) {
      this.summitReached = true;
      this.summitHours = this.hours;
      const { std, elapsed } = this.legStd();
      this.legResult = std ? this.rate(`${w.def.stageKey}:up`, elapsed, std.up) : null;
      this.audio.summit();
      this.state = 'summit';
      this.input.enabled = false;
      if (document.pointerLockElement) document.exitPointerLock();
      setTimeout(() => this.showSummit(), 1400);
      this.hud.banner(`${w.def.name} 山頂`, `${w.def.summitAltitude.toLocaleString('en-US')}m`, 'good', 3000);
    }
    if (this.summitReached && p.descending && p.routeS < 10 && p.routeDist < 25) {
      const { std, elapsed } = this.legStd();
      this.legResult = std?.round ? this.rate(`${w.def.stageKey}:round`, elapsed, std.round) : null;
      this.legDeaths = 0;
      this.state = 'won';
      this.input.enabled = false;
      if (document.pointerLockElement) document.exitPointerLock();
      this.showWin();
    }
  }

  private die(kind: DeathKind): void {
    if (this.state !== 'play') return;
    this.deathKind = kind;
    this.legDeaths += 1;
    this.state = 'dead';
    this.deathTimer = 0;
    this.input.enabled = false;
    if (this.player) this.player.mode = 'dead';
    if (document.pointerLockElement) document.exitPointerLock();
    this.hud.clearBanner();
  }

  private statsHtml(extra: [string, string][] = [], compact = false): string {
    const w = this.world!;
    const ph = this.physio;
    // With a rating to show, keep only what the rating doesn't already say.
    const rows: [string, string][] = compact ? [
      ['時刻', formatClock(this.hours)],
      ...(ph.hasO2 ? [['残り酸素', `${Math.round((ph.bottle / BOTTLE_LITERS) * 100)}% +${ph.spares}本`] as [string, string]] : []),
      ...(ph.frostbite > 5 ? [['凍傷', `${Math.round(ph.frostbite)}`] as [string, string]] : []),
      ...extra,
    ] : [
      ['最高到達点', `${Math.round(this.maxAltitude).toLocaleString('en-US')}m`],
      ['時刻', formatClock(this.hours)],
      ['行動時間', (() => { const h = Math.max(0, this.hours - w.def.startHours); return `${Math.floor(h)}時間${Math.floor((h % 1) * 60)}分`; })()],
      ['残り酸素', this.physio.hasO2 ? `${Math.round((this.physio.bottle / BOTTLE_LITERS) * 100)}% +${this.physio.spares}本` : '使用なし'],
      ['凍傷', this.physio.frostbite > 5 ? `${Math.round(this.physio.frostbite)}` : 'なし'],
      ['ルート', w.def.routeName],
      ...extra,
    ];
    return rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
  }

  private showResult(kicker: string, title: string, desc: string, cls: 'dead' | 'win', primary: string, extra: [string, string][] = []): void {
    this.hud.show(false);
    document.getElementById('result-kicker')!.textContent = kicker;
    document.getElementById('result-title')!.textContent = title;
    document.getElementById('result-desc')!.textContent = desc;
    document.getElementById('result-stats')!.innerHTML = this.statsHtml(extra, cls === 'win' && extra.length > 2);
    document.getElementById('result-primary')!.textContent = primary;
    const panel = document.querySelector('.result-panel')!;
    panel.classList.remove('dead', 'win');
    panel.classList.add(cls);
    document.getElementById('result-rest')!.classList.add('hidden');
    document.getElementById('result-camp')!.classList.add('hidden');
    document.getElementById('result-extra')!.classList.add('hidden');
    this.showScreen('result');
  }

  private showDeath(): void {
    const k = this.deathKind ?? 'fall';
    const t = DEATH_TEXT[k];
    const alt = this.altitudeAt(this.player!.pos.y);
    const cp = this.checkpoint;
    const camp = this.world!.def.campName;
    this.showResult(`死亡 · ${Math.round(alt).toLocaleString('en-US')}m · ${formatClock(this.hours)}`, t.title, t.desc, 'dead', cp ? `${cp.name}から再開` : `${camp}から再挑戦`);
    if (cp) {
      const b = document.getElementById('result-camp')!;
      b.textContent = `${camp}から出直す`;
      b.classList.remove('hidden');
    }
    if (this.legDeaths >= 2) {
      const ex = document.getElementById('result-extra')!;
      ex.innerHTML = `<div class="assist">BC「焦るな。${camp}から出直すなら、天気の窓を待ってやる」<br><small>出直すと、嵐の来ない日になる${this.world!.def.o2 === 'summit' ? '（予備ボンベ+1）' : ''}</small></div>`;
      ex.classList.remove('hidden');
    }
  }

  private showSummit(): void {
    const w = this.world!;
    const late = this.summitHours > TURNAROUND;
    this.showResult(
      `登頂 · ${formatClock(this.summitHours)}`,
      `${w.def.name} ${w.def.summitAltitude.toLocaleString('en-US')}m`,
      late ? '頂に立った。だが折り返し時刻を過ぎている。日没までにC4へ戻れるか。' : '世界の屋根に立った。足元には雲海と、遠くヒマラヤの峰々。だが登頂は半分にすぎない。',
      'win',
      '下山を開始する',
      this.legResult ? this.resultRows(this.legResult, '登頂までの時間') : [],
    );
    if (this.legResult) this.showGrade(this.legResult, Game.praiseFor(this.legResult.grade));
  }

  private showCamp(rested: boolean): void {
    this.hud.show(false);
    this.showScreen(null);
    this.campScreen.open(this.campActions(rested));
  }

  private showWin(): void {
    writeSave(null);
    const w = this.world!;
    let desc = 'あなたは頂に立ち、そして生きて帰ってきた。デスゾーンから戻れることこそ、本当の登頂だ。';
    if (this.dog) {
      this.dog.affection = Math.min(100, this.dog.affection + 10);
      desc += `　テントから${this.dog.name}が飛び出してきて、ちぎれそうなほど尻尾を振った。`;
      this.audio.bark();
    }
    this.showResult('生還', `${w.def.name} 登頂・生還`, desc, 'win', 'もう一度登る', [
      ['登頂時刻', formatClock(this.summitHours)],
      ...(this.legResult ? this.resultRows(this.legResult, '往復の時間') : []),
    ]);
    if (this.legResult) this.showGrade(this.legResult, Game.praiseFor(this.legResult.grade));
  }

  // ---------------------------------------------------------------- camera / env
  private updateCamera(dt: number): void {
    const p = this.player!;
    p.eyePosition(this.camera.position);
    const shake = p.shake * (this.reducedMotion ? 0 : 1);
    const t = this.realTime;
    const breath = Math.sin(this.physio.breathPhase * Math.PI * 2) * 0.004 * (0.5 + p.exertion);
    const shiver = this.physio.coreTemp < 35.5 ? (35.5 - this.physio.coreTemp) * 0.004 : 0;
    const roll = (p.mode === 'slide' ? Math.sin(t * 7) * 0.25 : 0) + this.weather.state.gust * Math.sin(t * 2.3) * 0.012 + Math.sin(p.stepPhase * Math.PI) * 0.006;
    this.camera.rotation.set(0, 0, 0);
    this.camera.rotation.order = 'YXZ';
    // While working the rope, the head turns toward the hands (then back).
    let lookYaw = 0, lookPitch = 0;
    if (p.actionKind) {
      const eye = this.camera.position;
      const tgt = p.actionKind === 'transfer' && p.actionProgress > 0.5 ? p.actionAnchor : p.actionTarget;
      const dx = tgt.x - eye.x, dy = tgt.y - eye.y, dz = tgt.z - eye.z;
      const wantYaw = Math.atan2(-dx, -dz);
      const wantPitch = Math.atan2(dy, Math.hypot(dx, dz));
      let dyaw = wantYaw - p.yaw;
      dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
      // ease in quickly, hold while the hands work, ease back at the end
      const ap = p.actionProgress;
      const w = Math.min(1, ap / 0.18, (1 - ap) / 0.18) * 0.92;
      lookYaw = dyaw * w;
      lookPitch = (wantPitch - p.pitch) * w;
    }
    if (this.seracWarn > 0 && this.state === 'play') {
      // You hear the crack and look: a quick reflex toward the source, then control returns.
      const e = 7 - this.seracWarn;
      const w = Math.min(1, e / 0.35) * (1 - THREE.MathUtils.smoothstep(e, 1.6, 2.4)) * (this.reducedMotion ? 0.6 : 0.85);
      if (w > 0) {
        const eye = this.camera.position;
        const dx = this.hazSrc.x - eye.x, dy = this.hazSrc.y - eye.y, dz = this.hazSrc.z - eye.z;
        let dyaw = Math.atan2(-dx, -dz) - p.yaw;
        dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
        const wantPitch = THREE.MathUtils.clamp(Math.atan2(dy, Math.hypot(dx, dz)), -0.3, 0.6);
        lookYaw = dyaw * w;
        lookPitch = (wantPitch - p.pitch) * w;
      }
    }
    this.camera.rotation.y = p.yaw + lookYaw + (Math.random() - 0.5) * shake * 0.03;
    // On steep ground facing uphill, the eyes lift to the route instead of the wall in front.
    const fwdX = -Math.sin(p.yaw), fwdZ = -Math.cos(p.yaw);
    const upH = p.groundAt(p.pos.x + fwdX * 1.5, p.pos.z + fwdZ * 1.5).y - p.groundAt(p.pos.x, p.pos.z).y;
    const steepUp = THREE.MathUtils.clamp((Math.atan2(upH, 1.5) - 0.6) / 0.5, 0, 1);
    this.lookUp += (steepUp * 0.4 - this.lookUp) * Math.min(1, dt * 2);
    this.camera.rotation.x = p.pitch + this.lookUp + lookPitch + breath + (Math.random() - 0.5) * (shake * 0.03 + shiver);
    this.camera.rotation.z = roll;
    this.camera.position.y += Math.sin(t * 9) * shiver * 0.5;
    this.camera.updateMatrixWorld();
    const crouch = p.mode === 'slide' ? 1 : p.resting ? 0.6 : 0;
    this.body.group.visible = p.mode !== 'dead';
    this.body.update(p.pos, p.yaw, p.stepPhase, p.speed, crouch, (x, z) => p.groundAt(x, z).y);
    this.body.setTether(p.actionKind ? null : p.attachPoint(this.attachTmp), p.pos, p.yaw);
    this.viewmodel.update(dt, this.camera, {
      stepPhase: p.stepPhase,
      speed: p.speed,
      resting: p.resting,
      clipped: !!p.clip,
      mode: p.mode,
      actionT: p.actionT,
      arresting: p.arresting,
      breath: this.physio.breathPhase,
      shake,
      shiver: shiver * 100,
      aspect: this.camera.aspect,
      slope: p.onLadder ? 0 : p.slopeDeg,
      actionKind: p.actionKind,
      actionProgress: p.actionProgress,
      target: p.actionTarget,
      anchor: p.actionAnchor,
      grip: p.gripPoint(this.gripTmp),
    });
    // Gate snap sound when the carabiner closes on the rope.
    const ap = p.actionKind ? p.actionProgress : -1;
    const snapAt = p.actionKind === 'transfer' ? 0.36 : 0.6;
    if (this.lastActionP < snapAt && ap >= snapAt) this.audio.clink();
    this.lastActionP = ap;
  }

  private updateEnvironment(dt: number, storm: number): void {
    const w = this.world!;
    const focus = this.player && this.state !== 'title' ? this.player.pos : this.tmpV.set(0, 150, 0);
    this.env.update(this.hours, storm, this.realTime, this.camera, focus);
    const es = this.env.state;
    const fog = this.scene.fog as THREE.FogExp2;
    fog.color.copy(es.horizon);
    const visibility = this.state === 'title' ? 0 : storm;
    fog.density = 0.00014 + visibility * visibility * 0.018 + this.weather.state.gust * 0.0015 * (this.state === 'title' ? 0 : 1);
    this.post.params.exposure = es.exposure;
    w.terrainUniforms.uSparkle.value = es.dayFactor * (1 - storm);
    w.terrainUniforms.uSunDir.value.copy(es.sunDir);
    w.terrainUniforms.uTime.value = this.realTime;
    if (this.state === 'title') {
      this.near.mesh.visible = false;
      w.terrainUniforms.uNear.value.z = -1;
    } else if (this.player) {
      this.near.update(this.player.pos);
    }
    this.plume.update(dt, this.windDir, this.state === 'title' ? 45 : this.weather.state.windKmh, this.state === 'title' ? 0 : storm, es.sunColor, es.dayFactor);
    w.terrainUniforms.uSunCol.value.copy(es.sunColor).multiplyScalar(Math.min(1, es.sunIntensity / 3));
    w.terrainUniforms.uCloudShadow.value = es.dayFactor * (0.45 + storm * 0.35) * (1 - this.weather.state.storm * 0.5);
    w.terrainUniforms.uHazeBase.value = this.env.cloudY;
    w.props.update(this.realTime, this.weather.state.windKmh);
    const night = 1 - es.dayFactor;
    // Headlamp
    const lampOn = this.state === 'title' ? 0 : smoothstep(0.35, 0.8, night);
    this.headlamp.intensity = lampOn * 9;
    this.headlamp.position.copy(this.camera.position);
    this.camera.getWorldDirection(this.headlamp.target.position).multiplyScalar(10).add(this.camera.position);
    this.headlamp.target.updateMatrixWorld();
    this.viewmodel.syncLights(this.env.sun, this.env.hemi, lampOn);
    // Snow / spindrift
    const ws = this.weather.state;
    const windSpeed = ws.windKmh / 3.6;
    const wv = this.tmpV.copy(this.windDir).multiplyScalar(windSpeed * 0.5);
    this.snow.update(this.reducedMotion ? 0 : this.realTime, this.camera.position, wv, this.state === 'title' ? 0.1 : ws.snowfall + ws.gust * 0.4, 0.3 + es.dayFactor * 0.7 + lampOn * 0.2);
    void dt;
  }

  private updateHud(altitude: number, interact: string | null): void {
    const w = this.world!;
    const p = this.player!;
    const ph = this.physio;
    const lms = w.def.landmarks;
    let nextName = '';
    let nextDist = 0;
    if (!p.descending) {
      const next = lms.find((l) => w.route.waypointS[l.routeIndex] > p.routeS + 2) ?? lms[lms.length - 1];
      nextName = next.name;
      nextDist = w.route.waypointS[next.routeIndex] - p.routeS;
    } else {
      nextName = w.def.campName;
      nextDist = p.routeS;
    }
    const roped = w.route.isRoped(p.routeS) && p.routeDist < 6;
    const nearRope = !p.clip ? p.nearestRope() : null;
    let clipState: 'on' | 'off' | 'need' = p.clip ? 'on' : roped && p.slopeDeg > 28 ? 'need' : 'off';
    let clipText = p.clip ? 'ロープ確保中' : clipState === 'need' ? '無確保 — 危険' : '無確保';
    let clipBtn: 'ready' | 'urgent' | 'normal' = 'normal';
    let clipLabel = 'クリップ';
    let prompt = '';
    if (p.mode === 'transfer') {
      prompt = p.actionProgress < 0.5 ? 'アンカーの先のロープに安全環付きカラビナを掛けている…' : 'ユマール（登高器）をアンカーの先へ移している…';
      clipText = '付け替え中'; clipState = 'need';
    } else if (p.mode === 'clipping') {
      prompt = p.actionKind === 'unclip' ? 'ロープからカラビナを外している…' : 'スリングのカラビナをフィックスロープに掛けている…';
    }
    else if (p.clip && (p.atAnchor !== 0 || p.transferDir() !== 0)) {
      if (p.transferDir() !== 0) {
        clipBtn = 'urgent'; clipLabel = '付け替え';
        prompt = 'アンカー：<b>クリップ / E</b> で次のロープへ付け替え';
      } else {
        clipLabel = '外す';
        prompt = 'ロープの終端：<b>クリップ / E</b> で外す';
      }
    } else if (p.clip) { clipLabel = '外す'; }
    else if (nearRope) {
      clipBtn = clipState === 'need' ? 'urgent' : 'ready';
      prompt = 'フィックスロープ：<b>クリップ / E</b> で確保';
    }
    if (interact === '拾う') prompt = '先人の遺した物：<b>拾う / F</b>';
    if (interact === '回収') prompt = 'デポしたボンベ：<b>回収 / F</b>';
    else if (interact === '交換' && !prompt) prompt = 'ボンベ残量わずか：<b>交換 / F</b>';
    if (p.mode === 'slide') prompt = '<b>ピッケル！</b> 休むボタン長押し / Space';
    if (this.physio.collapsed) prompt = '息が上がって動けない…';
    if (this.swapT > 0) prompt = 'ボンベ交換中…';

    this.hud.update({
      altitude,
      hours: this.hours,
      turnaround: w.def.goal === 'summit' ? TURNAROUND : 18.5,
      turnLabel: w.def.goal === 'summit' ? '折返' : '日没',
      hasO2: ph.hasO2,
      nextName,
      nextDist,
      progress: clamp(p.routeS / w.route.length, 0, 1),
      spo2: ph.spo2,
      hr: ph.heartRate,
      stamina: ph.stamina,
      temp: ph.coreTemp,
      frost: ph.frostbite,
      bottle: ph.bottle,
      spares: ph.spares,
      flow: ph.flow,
      wind: this.weather.state.windKmh,
      ambient: this.weather.state.ambientC,
      clipState,
      clipText,
      clipBtn,
      clipLabel,
      restLabel: p.mode === 'slide' ? 'ピッケル' : '休む',
      restAxe: p.mode === 'slide',
      interact,
      prompt,
      ...this.paceInfo(),
    });
  }

  /** Live pace against the guide standard: the target hangs right in front of you. */
  private paceInfo(): { paceText: string; paceTone: '' | 'ahead' | 'behind' } {
    const w = this.world!, p = this.player!;
    const { std, elapsed } = this.legStd();
    const frac = clamp(p.routeS / w.route.length, 0, 1);
    if (!std || (!p.descending && frac < 0.04)) return { paceText: '', paceTone: '' };
    const expected = p.descending && std.round ? std.up + (std.round - std.up) * (1 - frac) : std.up * frac;
    const d = Math.round((elapsed - expected) * 60);
    if (Math.abs(d) < 3) return { paceText: '基準どおり', paceTone: '' };
    return d < 0 ? { paceText: `基準 −${-d}分`, paceTone: 'ahead' } : { paceText: `基準 +${d}分`, paceTone: 'behind' };
  }

  private render(): void {
    this.resize();
    const overlay = this.state === 'title' ? null : this.viewmodel.scene;
    this.renderer.info.reset();
    this.post.render(this.scene, overlay, this.camera, this.realTime);
  }

  private resize(): void {
    const w = Math.max(1, this.canvas.clientWidth);
    const h = Math.max(1, this.canvas.clientHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, this.dprCap);
    const bw = Math.floor(w * dpr);
    const bh = Math.floor(h * dpr);
    if (this.canvas.width !== bw || this.canvas.height !== bh) {
      this.renderer.setPixelRatio(dpr);
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.fov = w < h ? 82 : 72;
      this.camera.updateProjectionMatrix();
      this.post.resize(bw, bh);
    }
  }

  // ---------------------------------------------------------------- tests
  private applyTestState(name: string): void {
    const set = (mountain: 'everest' | 'k2', frac: number, hours: number, storm = 0, stage = EXPEDITIONS[mountain].stages.length - 1) => {
      this.buildStage(mountain, stage);
      this.startRun();
      const p = this.player!;
      const s = this.world!.route.length * frac;
      p.reset(s);
      this.hours = hours;
      this.weather.forceStorm(storm);
      this.hud.clearBanner();
      this.physio.spo2 = 70;
      this.physio.stamina = 70;
      this.lastLandmark = this.world!.def.landmarks.length;
      this.updatePlay(0.016);
    };
    switch (name) {
      case 'title':
        this.toTitle();
        this.updateTitle(0.016);
        break;
      case 'active-play': set('everest', 0.42, 6.1); break;
      case 'night-start': set('everest', 0.0, 3.1); break;
      case 'ridge': set('everest', 0.9, 9.4); break;
      case 'k2-bottleneck': set('k2', 0.38, 7.2); break;
      case 'storm': set('everest', 0.6, 12.5, 0.9); break;
      case 'fail':
        set('everest', 0.5, 8);
        this.die('hace');
        this.deathTimer = 3;
        this.fade = 1;
        this.showDeath();
        break;
      case 'bc-start': set('everest', 0.0, 5.6, 0, 0); this.player!.reset(0); this.updatePlay(0.016); break;
      case 'icefall': set('everest', 0.62, 6.5, 0, 0); break;
      case 'ladder': {
        set('everest', 0.1, 7.5, 0, 0);
        const s = this.world!.route.crevasseS[0] - 4;
        this.player!.reset(s);
        this.updatePlay(0.016);
        break;
      }
      case 'cwm': set('everest', 0.5, 9.5, 0, 1); break;
      case 'lhotse': set('everest', 0.45, 8.5, 0, 2); break;
      case 'yellow-band': set('everest', 0.4, 9, 0, 3); break;
      case 'k2-bc': set('k2', 0.05, 7, 0, 0); break;
      case 'k2-chimney': set('k2', 0.55, 9, 0, 1); break;
      case 'k2-pyramid': set('k2', 0.5, 9, 0, 2); break;
      case 'tutorial': {
        set('everest', 0.0, 5.6, 0, 0);
        this.player!.reset(0);
        this.updatePlay(0.016);
        this.openTutorial();
        break;
      }
      case 'map':
        set('everest', 0.35, 6.5, 0, 0);
        this.map.show(true);
        this.map.update(this.player!.pos.x, this.player!.pos.z, this.player!.yaw, this.player!.routeS);
        break;
      case 'feet':
        set('everest', 0.2, 9.5, 0, 1);
        this.player!.pitch = -1.05;
        this.player!.stepPhase = 0.35;
        this.player!.speed = 1.1;
        this.updateCamera(0.016);
        break;
      case 'shadow':
        set('everest', 0.25, 16.3, 0, 1);
        this.player!.yaw += Math.PI * 0.8;
        this.player!.pitch = -0.55;
        this.player!.stepPhase = 0.5;
        this.player!.speed = 1.1;
        this.updateCamera(0.016);
        break;
      case 'vista': {
        set('everest', 0.55, 6.7, 0, 3);
        const pk = this.world!.def.ridges.flat().reduce((a, b) => (b[2] > a[2] ? b : a));
        const p = this.player!;
        p.yaw = Math.atan2(-(pk[0] - p.pos.x), -(pk[1] - p.pos.z));
        p.pitch = 0.22;
        this.weather.state.windKmh = 60;
        this.updateCamera(0.016);
        break;
      }
      case 'camp':
        set('everest', 0.995, 13, 0, 1);
        this.updatePlay(0.016);
        this.showCamp(false);
        break;
      case 'summit':
        set('everest', 0.999, 9.8);
        this.player!.yaw += Math.PI;
        this.updatePlay(0.016);
        break;
      default:
        throw new Error(`Unknown test state: ${name}`);
    }
  }

  private installTestHooks(): void {
    window.__THREE_GAME_TEST_HOOKS__ = {
      seed: (v: number) => { this.seed = v; this.rng = createSeededRandom(v); },
      setState: (name: string) => {
        this.applyTestState(name);
        this.render();
        this.publishDiagnostics();
        return { state: name };
      },
      setPausedForScreenshot: (paused: boolean) => { this.pausedForScreenshot = paused; },
      setReducedMotion: (enabled: boolean) => { this.reducedMotion = enabled; },
      hideDebugUi: () => undefined,
    };
    (window as unknown as { __CLIMB__: unknown }).__CLIMB__ = {
      stick: (x: number, y: number) => this.input.setVirtualStick(x, y),
      game: this,
    };
  }

  private publishDiagnostics(): void {
    const info = this.renderer.info;
    const p = this.player;
    window.__THREE_GAME_DIAGNOSTICS__ = {
      frame: this.frame,
      elapsed: this.playTime,
      score: p ? Math.round(p.routeS) : 0,
      targetScore: this.world ? Math.round(this.world.route.length) : 0,
      complete: this.state === 'won',
      player: {
        position: { x: p?.pos.x ?? 0, y: p?.pos.y ?? 0, z: p?.pos.z ?? 0 },
        speed: p?.speed ?? 0,
      },
      renderer: {
        calls: info.render.calls,
        triangles: info.render.triangles,
        geometries: info.memory.geometries,
        textures: info.memory.textures,
      },
      canvas: {
        clientWidth: this.canvas.clientWidth,
        clientHeight: this.canvas.clientHeight,
        width: this.canvas.width,
        height: this.canvas.height,
        dpr: Math.min(window.devicePixelRatio || 1, this.dprCap),
      },
    };
    const ext = window.__THREE_GAME_DIAGNOSTICS__ as unknown as Record<string, unknown>;
    ext.state = this.state;
    ext.hours = this.hours;
    ext.mode = p?.mode;
    ext.clipped = !!p?.clip;
    ext.spo2 = this.physio.spo2;
    ext.stamina = this.physio.stamina;
    ext.coreTemp = this.physio.coreTemp;
    ext.altitude = this.world && p ? this.altitudeAt(p.pos.y) : 0;
    ext.routeS = p?.routeS;
    ext.slope = p?.slopeDeg;
    ext.worldTriangles = this.world?.triangles;
  }
}
