import * as THREE from 'three';
import { Input } from '../core/Input';
import { MOUNTAINS, type MountainDef } from './Mountains';
import { MountainField, buildTerrainMeshes, createTerrainMaterial, type TerrainUniforms } from '../world/Terrain';
import { Route } from '../world/Route';
import { Environment } from '../world/Environment';
import { Props } from '../world/Props';
import { Snow } from '../world/Snow';
import { Breath } from '../world/Breath';
import { Player } from '../player/Player';
import { Viewmodel } from '../player/Viewmodel';
import { Physiology, Weather, BOTTLE_LITERS } from '../systems/Physiology';
import { PostFX } from '../systems/PostFX';
import { Audio } from '../systems/Audio';
import { Hud, formatClock } from '../ui/Hud';
import { createSeededRandom } from '../utils/random';
import { clamp, smoothstep } from '../utils/noise';

type GameState = 'title' | 'play' | 'paused' | 'dead' | 'summit' | 'won';
type DeathKind = 'fall' | 'hace' | 'hypothermia' | 'serac' | 'exhaustion';

const TIME_SCALE = 40; // game seconds per real second
const START_HOURS = 3.0;
const TURNAROUND = 14;

const DEATH_TEXT: Record<DeathKind, { title: string; desc: string }> = {
  fall: { title: '滑落', desc: '急斜面で足を取られ、止まることなく斜面を落ちていった。急斜面では必ずフィックスロープに確保し、滑ったら即座にピッケルで制動を。' },
  hace: { title: '高所脳浮腫 (HACE)', desc: '低酸素状態が続き脳がむくんだ。意識が混濁し、やがて動けなくなった。酸素流量を上げる、または下山することでしか防げない。' },
  hypothermia: { title: '低体温症', desc: '風と寒さに体温を奪われ続けた。デスゾーンで長く立ち止まることは死を意味する。動き続けて熱を作れ。' },
  serac: { title: 'セラック崩落', desc: '頭上の巨大な氷塔が崩れ、トラバース中に直撃した。崩落音が聞こえたら落下ラインから即座に離れろ。' },
  exhaustion: { title: '力尽きた', desc: '体力が尽き、立ち上がることができなかった。休息と酸素を管理し、ペースを守れ。' },
};

interface IceChunk {
  mesh: THREE.Mesh;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
}

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
  private readonly headlamp = new THREE.SpotLight(0xfff1dc, 0, 70, 0.42, 0.5, 1.2);
  private readonly mobile: boolean;
  private world: World | null = null;
  private player: Player | null = null;
  private state: GameState = 'title';
  private selected: 'everest' | 'k2' = 'everest';
  private spares = 1;
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
  private titleAngle = 0.6;
  /** Test-only: simulation steps per rendered frame. */
  simSpeed = 1;
  private readonly tmpV = new THREE.Vector3();
  private readonly windDir = new THREE.Vector3(1, 0, 0.25).normalize();
  private lastLandmark = -1;
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
    this.headlamp.castShadow = false;
    this.scene.add(this.headlamp, this.headlamp.target);
    this.scene.add(this.camera);

    const surface = document.getElementById('touch-surface')!;
    this.input = new Input(surface, canvas, document.getElementById('touch-stick')!, document.getElementById('touch-knob')!);
    this.input.bindButton(document.getElementById('clip-btn')!, 'clip');
    this.input.bindButton(document.getElementById('rest-btn')!, 'rest');
    this.input.bindButton(document.getElementById('interact-btn')!, 'interact');
    this.input.bindButton(document.getElementById('o2-up')!, 'o2Up');
    this.input.bindButton(document.getElementById('o2-down')!, 'o2Down');
    this.input.bindButton(document.getElementById('pause-btn')!, 'pause');

    this.setupMenus();
    this.buildWorld(this.selected);
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.installTestHooks();
  }

  // ---------------------------------------------------------------- menus
  private setupMenus(): void {
    const cards = document.getElementById('mountain-cards')!;
    for (const m of [MOUNTAINS.everest, MOUNTAINS.k2]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'mcard' + (m.id === this.selected ? ' sel' : '');
      b.dataset.id = m.id;
      b.innerHTML = `
        <div class="row"><h3>${m.name}</h3><span class="elev">${m.summitAltitude.toLocaleString('en-US')}m</span></div>
        <div class="sub">${m.subtitle} · ${m.routeName}</div>
        <p>${m.description}</p>
        <div class="meta"><span>出発 ${m.campName}</span><span>難度 <b>${m.difficulty}</b></span></div>`;
      b.addEventListener('click', () => {
        if (this.selected === m.id) return;
        this.selected = m.id;
        cards.querySelectorAll('.mcard').forEach((c) => c.classList.toggle('sel', (c as HTMLElement).dataset.id === m.id));
        this.withLoading(() => this.buildWorld(m.id));
      });
      cards.appendChild(b);
    }
    document.getElementById('start-btn')!.addEventListener('click', () => {
      this.audio.unlock();
      this.audio.setMuted(!(document.getElementById('opt-sound') as HTMLInputElement).checked);
      this.spares = Number((document.getElementById('opt-bottles') as HTMLSelectElement).value);
      this.startRun();
      if (!this.mobile) this.canvas.requestPointerLock?.();
    });
    document.getElementById('resume-btn')!.addEventListener('click', () => this.setPaused(false));
    document.getElementById('restart-btn')!.addEventListener('click', () => this.startRun());
    document.getElementById('quit-btn')!.addEventListener('click', () => this.toTitle());
    document.getElementById('result-primary')!.addEventListener('click', () => {
      if (this.state === 'summit') this.beginDescent();
      else this.startRun();
    });
    document.getElementById('result-secondary')!.addEventListener('click', () => this.toTitle());
    document.addEventListener('pointerlockchange', () => {
      if (!document.pointerLockElement && this.state === 'play' && !this.mobile) this.setPaused(true);
    });
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

  private toTitle(): void {
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
      if (!this.mobile) this.canvas.requestPointerLock?.();
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

  private buildWorld(id: 'everest' | 'k2'): void {
    if (this.world) {
      this.scene.remove(this.world.root);
      this.world.root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
      });
    }
    const def = MOUNTAINS[id];
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
    this.player.reset(0);
    this.weather = new Weather(this.rng, def.baseWind);
    const marks = def.landmarks.slice(1, -1).map((l) => route.waypointS[l.routeIndex] / route.length);
    this.hud.setMarks(marks);
    this.renderer.compile(this.scene, this.camera);
  }

  private startRun(): void {
    if (!this.world || !this.player) return;
    this.rng = createSeededRandom(this.seed);
    this.weather.reset(this.rng);
    this.physio.reset(this.spares);
    this.player.reset(0);
    this.hours = START_HOURS;
    this.playTime = 0;
    this.flash = 0;
    this.fade = 0;
    this.deathKind = null;
    this.deathTimer = 0;
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
    for (const c of this.chunks) this.scene.remove(c.mesh);
    this.chunks.length = 0;
    for (const c of this.world.props.caches) { c.taken = false; c.mesh.visible = true; }
    this.state = 'play';
    this.input.enabled = true;
    this.showScreen(null);
    this.hud.show(true);
    this.hud.banner(`${this.world.def.campName} 出発`, `${formatClock(this.hours)} · 目標 ${this.world.def.summitAltitude.toLocaleString('en-US')}m · 折返 ${TURNAROUND}:00`, '', 4200);
  }

  private beginDescent(): void {
    if (!this.player) return;
    this.state = 'play';
    this.player.descending = true;
    this.input.enabled = true;
    this.showScreen(null);
    this.hud.show(true);
    this.hud.banner('下山開始', '登頂は折り返し地点にすぎない。C4へ生きて帰れ', '', 4000);
    if (!this.mobile) this.canvas.requestPointerLock?.();
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
      this.render();
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
    if (this.state === 'play') this.updatePlay(dt);
    else if (this.state === 'dead') this.updateDead(dt);
    else if (this.state === 'title') this.updateTitle(dt);
    this.input.consumeEdges();
    this.publishDiagnostics();
  }

  private updateTitle(dt: number): void {
    const w = this.world!;
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
    this.fade = Math.min(1, this.fade + dt * 0.45);
    this.post.params.fade = this.fade * 0.85;
    this.updateEnvironment(dt, this.weather.state.storm);
    this.audio.update({
      wind: this.weather.state.windKmh, gust: this.weather.state.gust, storm: this.weather.state.storm, flow: 0,
      breathPhase: 0, breathRate: 10, effort: 0, heartPhase: 0, heartRate: 0, heartLoud: 0, drone: 0,
    });
    if (this.deathTimer > 2.4 && document.getElementById('result')!.classList.contains('hidden')) this.showDeath();
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
    if (intents.o2Up) { ph.flow = Math.min(4, ph.flow + 0.5); this.audio.valve(); }
    if (intents.o2Down) { ph.flow = Math.max(0, ph.flow - 0.5); this.audio.valve(); }

    // Interactions: cache pickup / bottle swap
    let interact: string | null = null;
    const cache = w.props.caches.find((c) => !c.taken && c.position.distanceTo(p.pos) < 3);
    if (this.swapT > 0) {
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
    } else if (ph.spares > 0 && ph.bottle < BOTTLE_LITERS * 0.35) {
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
    });
    this.handlePlayerEvents();

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
    if (ph.bottle <= 0 && !this.warned.has('o2empty')) {
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

    // Landmarks, summit, return
    this.updateProgress();

    // Turnaround time
    if (!this.turnWarned && this.hours >= TURNAROUND && !this.summitReached) {
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
        case 'tooSteep': this.hud.banner('急すぎて登れない', 'フィックスロープに確保すれば登れる', '', 2200); break;
        case 'gustKnock': this.audio.slip(); break;
      }
    }
  }

  private updateSerac(dt: number): void {
    const w = this.world!;
    const p = this.player!;
    const serac = w.props.serac;
    if (serac && w.def.seracZone) {
      const s0 = w.route.waypointS[w.def.seracZone[0]];
      const s1 = w.route.waypointS[w.def.seracZone[1]];
      const inZone = p.routeS > s0 - 5 && p.routeS < s1 + 5;
      if (inZone) {
        if (!this.warned.has('seracZone')) {
          this.warned.add('seracZone');
          this.hud.banner('セラック直下', '頭上に巨大な氷塔。立ち止まるな', 'danger', 3600);
        }
        this.seracTimer -= dt;
        if (this.seracTimer <= 0 && this.seracWarn < 0) {
          this.seracWarn = 4.5;
          const offset = (this.rng() - 0.5) * 10;
          const s = clamp(p.routeS + offset, s0, s1);
          w.route.pointAt(s, this.seracLane);
          this.audio.crack();
          this.flash = 0.2;
          this.hud.banner('頭上で氷が割れる音！', '落下ラインから離れろ', 'danger', 3500);
          // Spawn falling chunks at the serac lip above the lane.
          const toLane = this.tmpV.copy(this.seracLane).sub(serac.origin).setY(0).normalize();
          for (let i = 0; i < 7; i++) {
            const mesh = new THREE.Mesh(this.chunkGeo, this.chunkMat);
            const sc = 1 + this.rng() * 2.2;
            mesh.scale.setScalar(sc);
            mesh.castShadow = true;
            const start = this.seracLane.clone().addScaledVector(toLane, -55 - this.rng() * 10);
            start.y = w.field.height(start.x, start.z) + 18 + this.rng() * 8;
            start.addScaledVector(serac.along, (this.rng() - 0.5) * 7);
            this.scene.add(mesh);
            this.chunks.push({ mesh, pos: start, vel: toLane.clone().multiplyScalar(4 + this.rng() * 3), life: 9 });
          }
        }
      }
      if (this.seracWarn >= 0) {
        this.seracWarn -= dt;
        if (this.seracWarn < 0) this.seracTimer = 22 + this.rng() * 18;
      }
    }
    // Chunk physics
    for (let i = this.chunks.length - 1; i >= 0; i--) {
      const c = this.chunks[i];
      c.life -= dt;
      c.vel.y -= 9.8 * dt;
      c.pos.addScaledVector(c.vel, dt);
      const g = w.field.height(c.pos.x, c.pos.z) + c.mesh.scale.x * 0.6;
      if (c.pos.y < g) {
        c.pos.y = g;
        const n = w.field.normal(c.pos.x, c.pos.z);
        c.vel.addScaledVector(n, -1.6 * c.vel.dot(n));
        c.vel.x += n.x * 6 * dt * 10;
        c.vel.z += n.z * 6 * dt * 10;
      }
      c.mesh.position.copy(c.pos);
      c.mesh.rotation.x += dt * 3;
      c.mesh.rotation.z += dt * 2;
      if (this.state === 'play' && p.mode !== 'dead' && c.pos.distanceTo(this.tmpV.copy(p.pos).setY(p.pos.y + 1)) < c.mesh.scale.x + 0.9) {
        this.flash = 1;
        this.audio.impact();
        this.die('serac');
      }
      if (c.life <= 0) {
        this.scene.remove(c.mesh);
        this.chunks.splice(i, 1);
      }
    }
  }

  private updateProgress(): void {
    const w = this.world!;
    const p = this.player!;
    const lms = w.def.landmarks;
    for (let i = lms.length - 1; i >= 1; i--) {
      if (p.routeS >= w.route.waypointS[lms[i].routeIndex] - 3 && i > this.lastLandmark && p.routeDist < 25) {
        this.lastLandmark = i;
        if (i < lms.length - 1) this.hud.banner(lms[i].name, lms[i].note, 'good', 3600);
        break;
      }
    }
    if (!this.summitReached && p.routeS >= w.route.length - 2.5 && p.routeDist < 6) {
      this.summitReached = true;
      this.summitHours = this.hours;
      this.audio.summit();
      this.state = 'summit';
      this.input.enabled = false;
      if (document.pointerLockElement) document.exitPointerLock();
      setTimeout(() => this.showSummit(), 1400);
      this.hud.banner(`${w.def.name} 山頂`, `${w.def.summitAltitude.toLocaleString('en-US')}m`, 'good', 3000);
    }
    if (this.summitReached && p.descending && p.routeS < 10 && p.routeDist < 25) {
      this.state = 'won';
      this.input.enabled = false;
      if (document.pointerLockElement) document.exitPointerLock();
      this.showWin();
    }
  }

  private die(kind: DeathKind): void {
    if (this.state !== 'play') return;
    this.deathKind = kind;
    this.state = 'dead';
    this.deathTimer = 0;
    this.input.enabled = false;
    if (this.player) this.player.mode = 'dead';
    if (document.pointerLockElement) document.exitPointerLock();
    this.hud.clearBanner();
  }

  private statsHtml(extra: [string, string][] = []): string {
    const w = this.world!;
    const rows: [string, string][] = [
      ['最高到達点', `${Math.round(this.maxAltitude).toLocaleString('en-US')}m`],
      ['時刻', formatClock(this.hours)],
      ['行動時間', `${Math.floor((this.hours - START_HOURS))}時間${Math.floor(((this.hours - START_HOURS) % 1) * 60)}分`],
      ['残り酸素', `${Math.round((this.physio.bottle / BOTTLE_LITERS) * 100)}% +${this.physio.spares}本`],
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
    document.getElementById('result-stats')!.innerHTML = this.statsHtml(extra);
    document.getElementById('result-primary')!.textContent = primary;
    const panel = document.querySelector('.result-panel')!;
    panel.classList.remove('dead', 'win');
    panel.classList.add(cls);
    this.showScreen('result');
  }

  private showDeath(): void {
    const k = this.deathKind ?? 'fall';
    const t = DEATH_TEXT[k];
    const alt = this.altitudeAt(this.player!.pos.y);
    this.showResult(`死亡 · ${Math.round(alt).toLocaleString('en-US')}m · ${formatClock(this.hours)}`, t.title, t.desc, 'dead', `${this.world!.def.campName}から再挑戦`);
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
    );
  }

  private showWin(): void {
    const w = this.world!;
    this.showResult('生還', `${w.def.name} 登頂・生還`, 'あなたは頂に立ち、そして生きて帰ってきた。デスゾーンから戻れることこそ、本当の登頂だ。', 'win', 'もう一度登る', [
      ['登頂時刻', formatClock(this.summitHours)],
    ]);
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
    this.camera.rotation.y = p.yaw + (Math.random() - 0.5) * shake * 0.03;
    this.camera.rotation.x = p.pitch + breath + (Math.random() - 0.5) * (shake * 0.03 + shiver);
    this.camera.rotation.z = roll;
    this.camera.position.y += Math.sin(t * 9) * shiver * 0.5;
    this.camera.updateMatrixWorld();
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
    });
  }

  private updateEnvironment(dt: number, storm: number): void {
    const w = this.world!;
    const focus = this.player && this.state !== 'title' ? this.player.pos : this.tmpV.set(0, 150, 0);
    this.env.update(this.hours, storm, this.realTime, this.camera, focus);
    const es = this.env.state;
    const fog = this.scene.fog as THREE.FogExp2;
    fog.color.copy(es.horizon);
    const visibility = this.state === 'title' ? 0 : storm;
    fog.density = 0.00008 + visibility * visibility * 0.018 + this.weather.state.gust * 0.0015 * (this.state === 'title' ? 0 : 1);
    this.post.params.exposure = es.exposure;
    w.terrainUniforms.uSparkle.value = es.dayFactor * (1 - storm);
    w.terrainUniforms.uSunDir.value.copy(es.sunDir);
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
    if (p.mode === 'transfer') { prompt = 'カラビナを付け替えている…'; clipText = '付け替え中'; clipState = 'need'; }
    else if (p.mode === 'clipping') prompt = '…';
    else if (p.clip && p.atAnchor !== 0) {
      const next = w.route.ropes[p.clip.index + p.atAnchor];
      if (next && next.sectionId === p.clip.sectionId) {
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
    if (interact === '回収') prompt = 'デポしたボンベ：<b>回収 / F</b>';
    else if (interact === '交換' && !prompt) prompt = 'ボンベ残量わずか：<b>交換 / F</b>';
    if (p.mode === 'slide') prompt = '<b>ピッケル！</b> 休むボタン長押し / Space';
    if (this.physio.collapsed) prompt = '息が上がって動けない…';
    if (this.swapT > 0) prompt = 'ボンベ交換中…';

    this.hud.update({
      altitude,
      hours: this.hours,
      turnaround: TURNAROUND,
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
    });
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
    const set = (mountain: 'everest' | 'k2', frac: number, hours: number, storm = 0) => {
      if (this.selected !== mountain || !this.world) {
        this.selected = mountain;
        this.buildWorld(mountain);
      }
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
