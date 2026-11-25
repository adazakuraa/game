import * as THREE from 'three';
import { MISSION, Missions, type MissionCtx } from './missions';
import { Kitchen, type LandSave } from './kitchen';
import { CHAPTERS, ENDING, SCENES, TUTORIAL, type SceneId, type StoryState } from './story';
import { SCENE_AT, Scenes } from './scenes';
import { SPOT, SPOTS, spotFocus, spotInView } from './spots';
import { makeQuest, QUEST, type Quest } from './quests';
import { FIND_NAME, FINDS, Finds, openFind, type FindKind } from './finds';
import { buildBar, buildHandSpear, buildKnife, buildSpeargun } from './gearModels';
import { BIG_KG, DISH, FISHING, PENALTY, STORY, edibleInfo, isFugu, isGoodCatch, fmtKg, nightOf, repLevel, timeLabel, weightOf, type Catch, type DishId } from './fishing';
import { AIR_TANK, evaluateShot, sAdvice, LEGACY_NEED, LEGACY_NEED_PCT, PHOTO, SHOP, yen, type GearId } from './photoScore';
import { patchFogChunks, UW } from '../render/underwater';
import { Terrain } from '../world/terrain';
import { Environment } from '../world/environment';
import { Flora } from '../world/flora';
import { Creatures, OCTO, type PhotoTarget } from '../life/creatures';
import { BAIT, eatsBait, type BaitId } from './bait';
import { WEATHER, weatherMult as weatherMultOf, weatherOf, type WeatherId } from './weather';
import { SPECIES, SPECIES_BY_ID, ZONE_ORDER } from '../life/species';
import { caveRoofAt, DIVE_POINTS, heightAt, VENT, WORLD, WRECK, zoneAt, ZONE_NAMES, type DivePoint } from '../world/layout';
import { Input } from '../core/input';
import { Audio } from '../core/audio';
import { clamp, lerp } from '../utils/noise';
import { Minimap } from '../ui/minimap';
import { colliderCount, insideAny, resolveSphere } from '../world/colliders';

type Save = LandSave & {
  /** dive points known (reached while diving, or from a chart) */
  discovered?: string[];
  /** current main-story chapter, and the last one whose briefing was read */
  storyMain?: number; storyRead?: number;
  /** special sights photographed */
  scenes?: Partial<Record<SceneId, { photo: string; t: number }>>;
  tutorial?: boolean;
  /** the night-dive hint (needlefish rush at the light) has been shown */
  nightHint?: boolean;
  /** air tank upgrade level (AIR_TANK) */
  airLv?: number;
  /** requests on the notice board, and the ones taken */
  board?: Quest[];
  quests?: Quest[];
  /** the notice board has been mentioned by the landlady (shown on the boat), and its how-to has been read */
  boardOn?: boolean; boardIntro?: boolean;
  questsDone?: number;
  /** Phase 2: gear already in stock under the old dex-share (%) rule, kept in stock; and the migration mark */
  stocked?: string[]; p2?: 1;
  /** Phase 3: chapters cleared whose reward has not been received yet; dive points swum into; photo spots already paid */
  storyClaim?: number[]; visited?: string[]; spots?: string[];
 found: Record<string, { photo: string; depth: number; t: number; score?: number }>; dives: number; maxDepth: number; muted?: boolean; money?: number; owned?: string[]; earned?: number };
type Shot = { photo: string; depth: number; score: number; grade: string; value: number; isNew: boolean };
type State = 'loading' | 'title' | 'diving' | 'paused' | 'result' | 'dex';

const SAVE_KEY = 'blue-depths-save-v1';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(68, 1, 0.08, 1000);
  private terrain = new Terrain();
  private env: Environment;
  private flora: Flora;
  private creatures: Creatures;
  private input: Input;
  private audio = new Audio();
  private clock = new THREE.Clock();
  private state: State = 'loading';
  private save: Save;
  private yaw = 0;
  private pitch = 0;
  private vel = new THREE.Vector3();
  private air = 200;
  private airMax = 200;
  private diveTime = 0;
  private diveMaxDepth = 0;
  private pending = new Map<string, Shot>();
  private diveShots = 0;
  private point: DivePoint = DIVE_POINTS[1];
  private ads = false;
  private captureReq: PhotoTarget | null | undefined = undefined;
  private target: PhotoTarget | null = null;
  private toastTimer = 0;
  private discoverTimer = 0;
  private time = 0;
  private frame = 0;
  private titleT = 0;
  private narc = 0;
  private lastWarn = 0;
  /** down-current cells for this dive (drop-off / blue water): centre, radius, sink speed m/s */
  private currents: { x: number; z: number; r: number; s: number }[] = [];
  private currentF = 0;
  private currentWarned = -100;
  private shake = 0;
  private lastClear = 20;
  private sonarBlips: { x: number; z: number; rare: boolean }[] = [];
  /** hit-stop: world freezes for a beat after a good shot */
  private freezeT = 0;
  private lastEncounter = -100;
  private coldWarned = -100;
  /** camera or spear in hand */
  private tool: 'camera' | 'spear' = 'camera';
  /** Phase 4: the day's weather on this dive, the bait selected, and its visible cloud */
  private weather: WeatherId = 'sunny';
  private baitKind: BaitId = 'krill';
  private baitPts: THREE.Points | null = null;
  private baitPtsT = 0;
  private reload = 0;
  private diveCatch: Catch[] = [];
  private spearT: ReturnType<Creatures['findSpearTarget']> = null;
  private spearFx!: THREE.Mesh;
  private spearAnim = -1;
  private spearTo = new THREE.Vector3();
  /** dish eaten before this dive */
  private buff: DishId | null = null;
  private kitchen!: Kitchen;
  private scenes!: Scenes;
  private finds = new Finds();
  private diveFinds: FindKind[] = [];
  private pendingScenes = new Map<SceneId, { photo: string; pay: number }>();
  /** the sight the story staged for this dive (its circle shows from the start; lucky ones only once sensed) */
  private stagedScene: SceneId | null = null;
  /** photo spots shot this dive (paid on surfacing, first time only) */
  private pendingSpots = new Set<string>();
  /** first-person gear in hand */
  private vmHand!: THREE.Group;
  private vmGun!: THREE.Group;
  private vmGunShaft!: THREE.Mesh;
  private vmBar!: THREE.Group;
  /** the diver's knife (Phase 3: cutting the net off a turtle) */
  private vmKnife!: THREE.Group;
  private cutReady = false;
  private pryIdx: number | null = null;
  private barJab = 0;
  /** first-dive tutorial: current step (-1 = off) */
  private tut = { step: -1, t: 0, moved: 0, looked: 0, praise: 0, down: 0, depth0: 0, repeat: 0, from: new THREE.Vector3() };
  private nightAnnounced = 0;
  private lastDt = 0;
  private questT = 0;
  /** the request whose task is running right now */
  private activeQuest: string | null = null;
  /** species photographed (B or better) in each zone this dive, for surveys */
  private surveySeen = new Map<string, Set<string>>();
  /** diner urchin harvest: a short dive that returns straight to the diner */
  private quick: { kind: 'urchin'; started: boolean; done?: boolean; ok?: boolean } | null = null;
  private missions!: Missions;
  /** request rewards earned this dive */
  private bonuses: { label: string; value: number }[] = [];
  private cold = 0;
  private dprCap = 1.5;
  private frameAvg = 16;
  private paused = false;
  private reducedMotion = false;
  private helpShown = false;
  private stateBeforeDex: State = 'title';
  private photoCanvas = document.createElement('canvas');
  private fpsSamples: number[] = [];
  private minimap: Minimap | null = null;
  private tmpDir = new THREE.Vector3();

  constructor(private canvas: HTMLCanvasElement) {
    patchFogChunks();
    const mobile = matchMedia('(pointer: coarse)').matches;
    this.dprCap = mobile ? 1.5 : 2;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !mobile, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, this.dprCap));
    this.photoCanvas.width = 320;
    this.photoCanvas.height = 240;

    const B: Record<string, number> = ((window as unknown as Record<string, unknown>).__BOOT_MS__ = {}) as Record<string, number>;
    let tm = performance.now();
    const mark = (k: string) => { const n = performance.now(); B[k] = Math.round(n - tm); tm = n; };
    mark('renderer');
    this.save = this.loadSave();
    this.audio.muted = !!this.save.muted;
    this.scene.add(this.camera);
    this.env = new Environment(this.scene, this.camera, mobile);
    this.scene.environment = this.makeEnvMap();
    this.scene.environmentIntensity = 0.6;
    mark('env');
    this.scene.add(this.terrain.group);
    this.flora = new Flora();
    mark('flora');
    this.scene.add(this.flora.group);
    this.creatures = new Creatures(this.flora.homes);
    mark('creatures');
    this.scene.add(this.creatures.group);
    this.missions = new Missions();
    this.scene.add(this.missions.group);
    this.missions.onRelease = () => this.creatures.stage.delete('turtle');
    this.missions.onEnd = (_kind, ok) => {
      if (this.activeQuest) {
        if (ok) this.completeQuest(this.activeQuest);
        this.activeQuest = null;
      }
      if (this.quick) {
        // back to the diner as soon as the harvest is over
        this.quick.done = true;
        this.quick.ok = ok;
        window.setTimeout(() => { if (this.state === 'diving' || this.state === 'paused') this.endDive('surface'); }, 1600);
      }
    };
    this.spearFx = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0035, 1, 6).rotateX(Math.PI / 2).translate(0, 0, -0.5), new THREE.MeshStandardMaterial({ color: 0xc8ccd0, metalness: 0.9, roughness: 0.28 }));
    this.spearFx.visible = false;
    this.spearFx.frustumCulled = false;
    this.scene.add(this.spearFx);
    this.scene.add(this.finds.group);
    this.scenes = new Scenes(this.creatures, this.flora.homes.coralTops);
    this.scene.add(this.scenes.group);
    // gear held in front of the mask (children of the camera)
    this.vmHand = buildHandSpear();
    const gun = buildSpeargun();
    this.vmGun = gun.gun;
    this.vmGunShaft = gun.shaft;
    this.vmBar = buildBar();
    this.vmKnife = buildKnife();
    for (const m of [this.vmHand, this.vmGun, this.vmBar, this.vmKnife]) {
      m.position.set(0.14, -0.15, -0.28);
      m.rotation.set(0.05, 0.08, 0);
      m.visible = false;
      m.traverse((o) => { o.frustumCulled = false; });
      this.camera.add(m);
    }
    $('coach-skip').addEventListener('click', () => this.endTutorial());
    $('pr-go').addEventListener('click', () => {
      this.audio.unlock();
      $('prologue').classList.add('hidden');
      this.save.storyRead = Math.max(this.save.storyRead ?? -1, 0);
      this.writeSave();
      this.paused = false;
      this.clock.getDelta();
      this.showCoach();
    });
    this.kitchen = new Kitchen({
      save: this.save,
      write: () => this.writeSave(),
      toast: (t, k, d) => this.toast(t, k ?? '', d),
      chime: (big) => this.audio.chime(big),
      changed: () => this.renderTitle(),
      known: (id) => !!this.save.found[id],
      grantMap: (id) => this.grantMap(id),
      urchinDive: () => this.quickUrchin(),
      hasTorch: () => this.hasTorch(),
      progress: () => ({ found: this.foundCount, chapter: this.save.storyMain ?? 0, spear: this.has('spear') }),
    });
    this.kitchen.ensureOrders();
    this.audio.onExhale = () => {
      if (this.state === 'diving') this.env.exhale(this.camera, this.ads || this.has('rebreather') ? 0 : 1);
    };

    this.input = new Input($('touch-surface'), $('stick'), $('knob'));
    this.bindUi();
    $('open-kitchen').addEventListener('click', () => { this.audio.unlock(); this.kitchen.open(); });
    $('reset-save').addEventListener('click', () => {
      if (!window.confirm('図鑑・お金・装備・ストーリーなど、すべての進行度を消して最初からやり直します。よろしいですか？')) return;
      try { localStorage.removeItem(SAVE_KEY); } catch { /* storage unavailable */ }
      window.location.reload();
    });
    $('unlock-all').addEventListener('click', () => {
      if (!window.confirm('デバッグ用：装備・漁具・海図・免許・ストーリー・評判・タンクをすべて解禁した状態にします（図鑑と実績はそのまま）。よろしいですか？')) return;
      const sv = this.save;
      sv.owned = [...new Set([...(sv.owned ?? []), ...SHOP.map((g) => g.id), 'fugulicense'])];
      sv.discovered = DIVE_POINTS.map((d) => d.id);
      sv.money = Math.max(sv.money ?? 0, 999999);
      sv.rep = Math.max(sv.rep ?? 0, FISHING.repLevels[FISHING.repLevels.length - 1]);
      sv.story = STORY.length;
      sv.storyMain = CHAPTERS.length;
      sv.storyRead = CHAPTERS.length;
      sv.airLv = AIR_TANK.length - 1;
      sv.tutorial = true;
      sv.boardOn = true;
      sv.dives = Math.max(sv.dives, 1);
      this.writeSave();
      window.location.reload();
    });
    $('open-quests').addEventListener('click', () => { $('quests').classList.remove('hidden'); this.renderQuests(); });
    $('quests-close').addEventListener('click', () => { $('quests').classList.add('hidden'); this.renderTitle(); });
    $('open-album').addEventListener('click', () => { $('album').classList.remove('hidden'); this.renderAlbum(); });
    $('album-close').addEventListener('click', () => $('album').classList.add('hidden'));
    $('open-shop').addEventListener('click', () => { this.audio.unlock(); $('shop').classList.remove('hidden'); this.renderShop(); });
    $('shop-close').addEventListener('click', () => { $('shop').classList.add('hidden'); this.renderTitle(); });
    $('res-kitchen').addEventListener('click', () => { this.toTitle(); this.kitchen.open(); });
    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.installHooks();
    mark('ui');
  }

  // ------------------------------------------------------------------ setup
  private makeEnvMap(): THREE.Texture {
    const s = new THREE.Scene();
    const geo = new THREE.SphereGeometry(10, 32, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: `varying vec3 vP; void main(){ float h = normalize(vP).y;
        vec3 c = mix(vec3(0.02,0.08,0.12), vec3(0.25,0.6,0.75), smoothstep(-0.4, 0.6, h));
        c += vec3(1.0,1.0,0.95) * pow(max(h,0.0), 18.0) * 2.0; gl_FragColor = vec4(c,1.0); }`,
    });
    s.add(new THREE.Mesh(geo, mat));
    const pm = new THREE.PMREMGenerator(this.renderer);
    const t = pm.fromScene(s, 0.02).texture;
    pm.dispose();
    return t;
  }

  private loadSave(): Save {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) {
        const sv = JSON.parse(raw) as Save;
        if (!sv.owned) {
          // saves from the species-count unlock era keep the gear they had
          const n = Object.keys(sv.found).length;
          sv.owned = SHOP.filter((g) => n >= (LEGACY_NEED[g.id] ?? 1e9)).map((g) => g.id);
          sv.money = 0;
        }
        // Phase 1: saves from before the inn and the board intro keep the board, and skip the landlady's first hello
        if (sv.dives > 0) { sv.boardOn ??= true; sv.okami ??= { lore: 1 }; }
        // Phase 2: stock moved from a dex share (%) to a species count; what was already in stock stays in stock
        if (!sv.p2) {
          if (sv.dives > 0) {
            const n = Object.keys(sv.found).length;
            const old = SHOP.filter((g) => LEGACY_NEED_PCT[g.id] !== undefined && Math.ceil((LEGACY_NEED_PCT[g.id]! / 100) * SPECIES.length) <= n).map((g) => g.id);
            sv.stocked = [...new Set([...(sv.stocked ?? []), ...old])];
          }
          sv.p2 = 1;
        }
        // Phase 3: maps actually swum in (for the new-map banner): places where something was photographed, and the lagoon
        if (!sv.visited) {
          const zones = new Set(Object.keys(sv.found).map((id) => SPECIES_BY_ID.get(id)?.zone as string | undefined));
          sv.visited = DIVE_POINTS.filter((dp) => dp.id === 'lagoon' || zones.has(dp.id) || (dp.id === 'dropoff' && zones.has('offshore'))).map((dp) => dp.id);
        }
        if (sv.airLv === undefined) sv.airLv = sv.owned?.includes('tank') ? 4 : sv.dives > 0 ? 2 : 0;
        if (!sv.discovered) {
          // earlier saves: every place where something was already photographed counts as found
          const zones = new Set(Object.keys(sv.found).map((id) => SPECIES_BY_ID.get(id)?.zone));
          sv.discovered = DIVE_POINTS.filter((dp) => dp.id === 'lagoon' || zones.has(dp.id as never) || (dp.id === 'dropoff' && zones.has('offshore'))).map((dp) => dp.id);
          sv.tutorial = sv.dives > 0;
          if (sv.owned?.length || Object.keys(sv.found).length) (sv.owned ??= []).push('spear');
        }
        return sv;
      }
    } catch {
      /* storage unavailable */
    }
    return { found: {}, dives: 0, maxDepth: 0, money: 0, owned: [], earned: 0, discovered: ['lagoon'], visited: ['lagoon'], storyMain: 0, storyRead: -1, airLv: 0, p2: 1 };
  }

  private writeSave(): void {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(this.save));
    } catch {
      /* quota or private mode: progress lives for this session only */
    }
  }

  private get foundCount(): number {
    return Object.keys(this.save.found).length;
  }

  private has(id: GearId): boolean {
    // the strong light implies a torch (old saves bought it before the torch existed)
    if (id === 'torch') return !!this.save.owned?.includes('torch') || !!this.save.owned?.includes('light');
    return !!this.save.owned?.includes(id);
  }

  /** can the diver switch a light on (ADS suits carry their own) */
  private hasTorch(): boolean {
    return this.has('torch');
  }

  /** dusk has fallen on land and there is no torch: diving is not allowed until morning */
  private nightBlocked(): boolean {
    return nightOf(this.save.clock ?? 0) >= 0.5 && !this.hasTorch();
  }

  /** a shop item already in hand (a chart counts once its place is known) */
  private owns(g: (typeof SHOP)[number]): boolean {
    return this.has(g.id) || (!!g.map && this.discovered.has(g.map));
  }

  private get discovered(): Set<string> {
    return new Set(this.save.discovered ?? ['lagoon']);
  }

  /** A dive point becomes known: from now on the boat can go straight there. */
  private discover(id: string, how: 'swim' | 'chart'): boolean {
    if (this.discovered.has(id)) return false;
    (this.save.discovered ??= ['lagoon']).push(id);
    this.writeSave();
    if (this.minimap) this.minimap.known = this.discovered;
    const dp = DIVE_POINTS.find((d) => d.id === id);
    void how; void dp; // the banner comes from exploreCheck (Phase 3)
    return true;
  }

  private grantMap(id: string): void {
    this.discover(id, 'chart');
  }

  // ------------------------------------------------------------------ story (photographer)
  private storyState(): StoryState {
    const f = Object.entries(this.save.found);
    return {
      dives: this.save.dives,
      found: f.length,
      sCount: f.filter(([, v]) => (v.score ?? 0) >= PHOTO.grades[0].min).length,
      // 「夜の魚」: fish-like kinds only (Phase 3)
      nightFound: f.filter(([id]) => { const d = SPECIES_BY_ID.get(id); return d?.when === 'night' && (d.kind === 'fish' || d.kind === 'ray' || d.kind === 'gardenEel'); }).length,
      scenes: this.save.scenes ?? {},
      rare3S: f.filter(([id, v]) => SPECIES_BY_ID.get(id)?.rarity === 3 && (v.score ?? 0) >= PHOTO.grades[0].min).length,
    };
  }

  private get chapter() {
    return CHAPTERS[this.save.storyMain ?? 0];
  }

  private storyCleared: string[] = [];

  /** Finish every chapter whose goal is met: hand over charts and move on. The reward waits on the chapter card until received (Phase 3). */
  private advanceStory(): void {
    const st = this.storyState();
    while ((this.save.storyMain ?? 0) < CHAPTERS.length && CHAPTERS[this.save.storyMain ?? 0].done(st)) {
      const ch = CHAPTERS[this.save.storyMain ?? 0];
      if (ch.reward) (this.save.storyClaim ??= []).push(this.save.storyMain ?? 0);
      if (ch.map) this.grantMap(ch.map);
      const mapName = ch.map ? DIVE_POINTS.find((d) => d.id === ch.map)?.name : '';
      this.storyCleared.push(`第${(this.save.storyMain ?? 0) + 1}章「${ch.title}」クリア！ 写真家の評価：<b>${ch.title2}</b>${mapName ? `　海図「${mapName}」をもらった` : ''}${ch.praise ? `<div class="sc-praise">${ch.praise}</div>` : ''}`);
      this.save.storyMain = (this.save.storyMain ?? 0) + 1;
      this.writeSave();
      this.audio.chime(true);
    }
  }

  // ------------------------------------------------------------------ requests (taken on land)
  /** Board + held make QUEST.board slots: only a cleared request frees one, and one new request is put up for it (Phase 3). */
  private fillBoard(): void {
    const b = (this.save.board ??= []);
    const held = this.save.quests ?? [];
    const taken = [...b, ...held].map((q) => q.kind);
    const first = !b.length && !held.length;
    for (let k = 0; b.length + held.length < QUEST.board && k < 10; k++) {
      const q = makeQuest(this.discovered, Math.random, taken);
      if (q) { if (!first) q.fresh = true; b.push(q); taken.push(q.kind); }
    }
  }

  private renderQuests(): void {
    this.fillBoard();
    this.writeSave();
    const held = this.save.quests ?? [];
    const intro = $('q-intro');
    intro.classList.toggle('hidden', !!this.save.boardIntro);
    if (!this.save.boardIntro) {
      intro.innerHTML = `<b>依頼の掲示板</b>しおさい亭の女将さんが貼ってくれた、島の人からの頼みごと。<ul><li>「受ける」と、潜ったときのマップに場所が金色の円で出る</li><li>円の中に入ると依頼が始まる（写真や調査の依頼は、条件どおりに撮れば達成）</li><li>同時に受けられるのは${QUEST.maxHeld}件まで。達成すると、浮上したときに報酬がもらえる</li><li>依頼を1つ達成すると、新しい依頼が1つ貼り出される。「やめる」と掲示板に戻る</li></ul><button type="button" class="btn sec" id="q-intro-ok">わかった</button>`;
      $('q-intro-ok').addEventListener('click', () => { this.save.boardIntro = true; this.writeSave(); this.renderQuests(); });
    }
    const card = (q: Quest, act: string) => `<div class="k-item"><div><div class="who">${q.fresh ? '<span class="q-new">NEW</span>' : ''}${q.giver}　<span class="q-place">${ZONE_NAMES[q.zone]}</span></div><div class="what">${q.title}</div><div class="hint">${q.desc}</div><div class="pay">報酬 ${yen(q.reward)}</div></div><div class="acts">${act}</div></div>`;
    $('q-held').innerHTML = held.length ? held.map((q) => card(q, `<button type="button" class="btn sec" data-drop="${q.id}">やめる</button>`)).join('') : '<div class="k-empty">まだ依頼を受けていない。受けた依頼の場所は、潜ったときのマップに金色の円で出る。円に入ると始まる。</div>';
    const full = held.length >= QUEST.maxHeld;
    const board = this.save.board ?? [];
    $('q-board').innerHTML = (board.length ? board.map((q) => card(q, `<button type="button" class="btn ${full ? 'sec' : 'pri'}" data-take="${q.id}" ${full ? 'disabled' : ''}>${full ? `同時に${QUEST.maxHeld}件まで` : '受ける'}</button>`)).join('') : '<div class="k-empty">いま貼られている依頼はない。受けている依頼を達成すると、新しい依頼が貼り出される。</div>')
      // Phase 3 (§9-B): the diner's orders are requests too — once the spear is in hand, show them here
      + (this.has('spear') ? `<div class="k-item q-inn"><div><div class="who">しおさい亭</div><div class="what">しおさい亭の注文 ${this.save.orders?.length ?? 0}件</div><div class="hint">銛で獲った魚で料理を作る依頼。しおさい亭で受ける</div></div><div class="acts"><button type="button" class="btn sec" id="q-to-inn">しおさい亭へ</button></div></div>` : '');
    document.getElementById('q-to-inn')?.addEventListener('click', () => { $('quests').classList.add('hidden'); this.audio.unlock(); this.kitchen.open(); });
    // NEW marks last until the board has been seen once
    if (board.some((q) => q.fresh)) { for (const q of board) delete q.fresh; this.writeSave(); }
    document.querySelectorAll<HTMLButtonElement>('[data-take]').forEach((b) => b.addEventListener('click', () => {
      const q = this.save.board!.find((x) => x.id === b.dataset.take);
      if (!q || (this.save.quests ?? []).length >= QUEST.maxHeld) return;
      this.save.board = this.save.board!.filter((x) => x !== q);
      (this.save.quests ??= []).push(q);
      this.writeSave();
      this.audio.chime(false);
      this.renderQuests();
    }));
    document.querySelectorAll<HTMLButtonElement>('[data-drop]').forEach((b) => b.addEventListener('click', () => {
      // Phase 3: dropping a request puts it back on the board as it was (it never vanishes)
      const q = (this.save.quests ?? []).find((x) => x.id === b.dataset.drop);
      if (!q) return;
      this.save.quests = this.save.quests!.filter((x) => x !== q);
      (this.save.board ??= []).unshift(q);
      this.surveySeen.delete(q.id);
      this.writeSave();
      this.toast('依頼を掲示板に戻した', '', 1.8);
      this.renderQuests();
    }));
  }

  /** Arriving at a request's place starts it (with how-to text); photo and survey requests finish on their own. */
  private questCheck(p: THREE.Vector3): void {
    if (this.ads || this.missions.active || this.tut.step >= 0) return;
    for (const q of this.save.quests ?? []) {
      if (q.kind === 'photo' || q.kind === 'survey') continue;
      if (Math.hypot(p.x - q.x, p.z - q.z) > QUEST.arrive) continue;
      const at = new THREE.Vector3(q.x, heightAt(q.x, q.z), q.z);
      const sp = q.species ? SPECIES_BY_ID.get(q.species) : undefined;
      if (q.kind === 'tag' && sp) this.creatures.placeNear(sp.id, new THREE.Vector3(q.x + 4, Math.max(at.y + 2, -12), q.z + 4));
      this.activeQuest = q.id;
      this.missions.begin(q.kind, this.missionCtx(), at, sp, q.reward);
      this.audio.chime(false);
      return;
    }
  }

  private completeQuest(id: string, label?: string): void {
    const q = (this.save.quests ?? []).find((x) => x.id === id);
    if (!q) return;
    this.save.quests = this.save.quests!.filter((x) => x !== q);
    this.save.questsDone = (this.save.questsDone ?? 0) + 1;
    // one cleared, one new on the board (Phase 3)
    this.fillBoard();
    if (label !== undefined) {
      this.bonuses.push({ label: `依頼達成：${label}`, value: q.reward });
      this.updateDexChip();
      this.toast(`依頼達成！ ${q.title}　報酬 ${yen(q.reward)}`, '', 3.5);
      this.audio.chime(true);
    }
    this.writeSave();
  }

  /** A photo may finish a magazine request or count toward a survey. */
  private questPhoto(id: string, grade: string, zone: string): void {
    if (!['S', 'A', 'B'].includes(grade)) return;
    for (const q of [...(this.save.quests ?? [])]) {
      if (q.kind === 'photo' && q.species === id) this.completeQuest(q.id, q.title);
      if (q.kind === 'survey' && q.zone === zone) {
        const set = this.surveySeen.get(q.id) ?? new Set();
        set.add(id);
        this.surveySeen.set(q.id, set);
        if (set.size >= QUEST.surveyNeed) this.completeQuest(q.id, q.title);
        else this.toast(`${q.title}：${set.size} / ${QUEST.surveyNeed}種類`, '', 1.6);
      }
    }
  }

  /** Achievements: the special sights, on their own screen. */
  private renderAlbum(): void {
    const all = Object.keys(SCENES) as SceneId[];
    const got = all.filter((id) => this.save.scenes?.[id]);
    $('album-body').innerHTML = `<div class="al-count">出会えた光景 <b>${got.length}</b> / ${all.length}</div><div class="sc-photos">${all.map((id) => this.save.scenes?.[id]
      ? `<figure><img src="${this.save.scenes[id]!.photo}" alt=""><figcaption><b>${SCENES[id].name}</b>${SCENES[id].desc}</figcaption></figure>`
      : `<figure class="locked"><div>？</div><figcaption><b>？？？</b>${SCENES[id].hint}</figcaption></figure>`).join('')}</div>`
      // Phase 3: photo spots (pay once, the first time)
      + `<div class="al-count">写真スポット <b>${SPOTS.filter((s) => this.save.spots?.includes(s.id)).length}</b> / ${SPOTS.length}<small>（マップの水色の円の中で、見どころに向けて撮る。報酬は各スポット最初の1回だけ）</small></div><div class="al-spots">${SPOTS.map((s) => this.save.spots?.includes(s.id)
        ? `<div class="al-spot done"><b>${s.name}</b><span>${DIVE_POINTS.find((d) => d.id === s.point)?.name ?? ''}・撮影済み</span></div>`
        : `<div class="al-spot"><b>？？？</b><span>${this.discovered.has(s.point) ? DIVE_POINTS.find((d) => d.id === s.point)?.name ?? '' : '未発見のマップ'}・${yen(s.pay)}</span></div>`).join('')}</div>`;
  }

  /** Receive the editor's reward for a cleared chapter (Phase 3). */
  private claimStory(idx: number): void {
    const list = this.save.storyClaim ?? [];
    if (!list.includes(idx)) return;
    const ch = CHAPTERS[idx];
    this.save.storyClaim = list.filter((x) => x !== idx);
    this.save.money = (this.save.money ?? 0) + ch.reward;
    this.writeSave();
    this.audio.chime(true);
    this.toast(`編集長から報酬 ${yen(ch.reward)} を受け取った！`, '', 3);
    this.renderTitle();
    const pop = document.createElement('div');
    pop.className = 'money-pop';
    pop.textContent = `+${yen(ch.reward)}`;
    $('t-goal').appendChild(pop);
    setTimeout(() => pop.remove(), 1600);
  }

  private renderStory(): void {
    const el = $('story-card');
    const i = this.save.storyMain ?? 0;
    const ch = CHAPTERS[i];
    const claims = (this.save.storyClaim ?? []).map((k) => `<div class="sc-claim"><span>第${k + 1}章「${CHAPTERS[k].title}」クリア！ 編集長からの報酬</span><button type="button" class="btn pri" data-claim="${k}">報酬 ${yen(CHAPTERS[k].reward)} を受け取る</button></div>`).join('');
    const cleared = (this.storyCleared.length ? `<div class="sc-clear">${this.storyCleared.join('<br>')}</div>` : '') + claims;
    const album = '';
    if (!ch) {
      el.innerHTML = `<div class="sc-kicker">写真家の評価：表紙の写真家</div>${cleared}<div class="sc-intro">${ENDING}</div>${album}`;
      this.bindClaims(el);
      return;
    }
    const st = this.storyState();
    const unread = (this.save.storyRead ?? -1) < i;
    el.innerHTML = `<div class="sc-kicker">第${i + 1}章　${i > 0 ? `写真家の評価：${CHAPTERS[i - 1].title2}` : '駆け出しの海中写真家'}</div>${cleared}<div class="sc-title">${ch.title}</div>` +
      (unread ? `<div class="sc-intro">${ch.intro}</div><button type="button" class="btn sec" id="sc-ok">了解</button>` : '') +
      `<div class="sc-goal">目標：${ch.goal}${ch.progress ? `　<b>${ch.progress(st)}</b>` : ''}${ch.needsLight && !this.hasTorch() ? '<small class="sc-wait">ライトがまだない（図鑑を増やすと入荷する）</small>' : ''}${ch.reward ? `<span class="sc-pay">報酬 ${yen(ch.reward)}</span>` : ''}</div>${ch.tips ? `<details class="sc-tips"><summary>編集長の「Sを取るコツ」</summary><ul>${ch.tips.map((t) => `<li>${t}</li>`).join('')}</ul></details>` : ''}${album}`;
    this.bindClaims(el);
    if (unread) document.getElementById('sc-ok')!.addEventListener('click', () => { this.save.storyRead = i; this.storyCleared = []; this.writeSave(); this.renderStory(); });
  }

  private bindClaims(el: HTMLElement): void {
    el.querySelectorAll<HTMLButtonElement>('[data-claim]').forEach((b) => b.addEventListener('click', () => { this.audio.unlock(); this.claimStory(Number(b.dataset.claim)); }));
  }

  /** Species still needed before an item comes into stock (an absolute count: never divided by the dex size). */
  private stockGap(g: (typeof SHOP)[number]): number {
    if (g.rep) return repLevel(this.save.rep ?? 0) >= g.rep ? 0 : 1;
    if (this.save.stocked?.includes(g.id)) return 0;
    return Math.max(0, g.need - this.foundCount);
  }

  /** Next gear the player can aim for, and how far away it is (the reward hanging in front of them). */
  private nextGoal(): { name: string; need: number; species: number } | null {
    const money = this.save.money ?? 0;
    const g = SHOP.find((x) => !this.owns(x) && !x.rep && !x.map);
    return g ? { name: g.name, need: Math.max(0, g.price - money), species: this.stockGap(g) } : null;
  }

  private buy(id: GearId): void {
    const g = SHOP.find((x) => x.id === id)!;
    if (this.owns(g) || (this.save.money ?? 0) < g.price || this.stockGap(g) > 0 || (g.req && !this.has(g.req))) return;
    this.save.money = (this.save.money ?? 0) - g.price;
    (this.save.owned ??= []).push(id);
    if (g.map) this.grantMap(g.map);
    this.writeSave();
    this.audio.chime(true);
    this.toast(id === 'spear' ? '「手銛」を購入！ 港の食堂「しおさい亭」の女将さんが話があるらしい（ボートの「しおさい亭」へ）' : g.map ? `「${g.name}」を購入！ ボートから直接行けるようになった` : `「${g.name}」を購入！ ${g.desc}`, '', 4);
    this.renderTitle();
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.fov = w < h ? 74 : 64;
    this.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------------ UI
  private bindUi(): void {
    const unlockAudio = () => this.audio.unlock();
    window.addEventListener('pointerdown', unlockAudio, { capture: true });
    window.addEventListener('keydown', unlockAudio, { capture: true });
    this.input.bindButton($('btn-up'), 'up', true);
    this.input.bindButton($('btn-down'), 'down', true);
    this.input.bindButton($('btn-boost'), 'boost', true);
    this.input.bindButton($('btn-shutter'), 'shutter');
    this.input.bindButton($('btn-light'), 'light');
    this.input.bindButton($('btn-tool'), 'tool');
    this.input.bindButton($('btn-bait'), 'bait');
    this.input.bindButton($('btn-bait-kind'), 'baitKind');
    $('btn-pause').addEventListener('click', () => this.setPaused(true));
    $('resume').addEventListener('click', () => this.setPaused(false));
    $('abort').addEventListener('click', () => { if (this.surfaceAnywhere()) this.endDive('surface'); });
    $('pause-dex').addEventListener('click', () => this.openDex());
    $('dex-chip').addEventListener('click', () => this.openDex());
    $('open-dex').addEventListener('click', () => this.openDex());
    $('dex-close').addEventListener('click', () => this.closeDex());
    $('dd-close').addEventListener('click', () => $('dex-detail').classList.add('hidden'));
    $('surface-btn').addEventListener('click', () => this.endDive('surface'));
    $('res-ok').addEventListener('click', () => this.toTitle());
    $('minimap-btn').addEventListener('click', () => this.toggleMap(true));
    $('map').addEventListener('click', () => this.toggleMap(false));
    $('toggle-sound').addEventListener('click', () => {
      this.save.muted = !this.save.muted;
      this.audio.setMuted(!!this.save.muted);
      $('snd-wave').style.opacity = this.save.muted ? '0.15' : '1';
      this.writeSave();
    });
    $('snd-wave').style.opacity = this.save.muted ? '0.15' : '1';
  }

  private renderTitle(): void {
    const n = this.foundCount;
    $('t-dex').textContent = `${n}/${SPECIES.length}`;
    this.advanceStory();
    this.renderStory();
    const colors: Record<string, string> = { lagoon: '#9fe8d8', reef: '#5fe3f0', rocky: '#a8c8b0', dropoff: '#4aa8e8', deep: '#3a5ab8', cold: '#d6eef6', ruins: '#c8b890', bluehole: '#2a6ad8', cave: '#5a6a70', kelp: '#8ab060' };
    const pts = $('points');
    pts.innerHTML = '';
    const known = this.discovered;
    let hiddenN = 0;
    for (const dp of DIVE_POINTS) {
      if (!known.has(dp.id)) { hiddenN++; continue; }
      const zoneSpecies = SPECIES.filter((s) => (dp.id === 'dropoff' ? s.zone === 'dropoff' || s.zone === 'offshore' : s.zone === dp.id));
      const got = zoneSpecies.filter((s) => this.save.found[s.id]).length;
      const locked = dp.requires === 'ads' && !this.has('ads');
      const b = document.createElement('button');
      b.className = 'pt';
      b.type = 'button';
      b.disabled = locked;
      b.innerHTML = `<span class="ico" style="background:${colors[dp.id]}">${dp.id === 'deep' ? '400m' : dp.id === 'dropoff' ? '15m+' : dp.id === 'lagoon' ? '5m' : dp.id === 'cold' ? '2℃' : dp.id === 'ruins' ? '遺跡' : dp.id === 'bluehole' ? '55m' : dp.id === 'cave' ? '洞窟' : dp.id === 'kelp' ? '森' : '12m'}</span>
        <span><div class="nm">${dp.name}</div><div class="sb">${locked ? `写真の稼ぎで「大気圧潜水服」を買うと行ける` : dp.sub}</div></span>
        <span class="pr"><b>${got}</b>/${zoneSpecies.length}<span class="go">${locked ? 'ロック中' : '潜る ›'}</span></span>`;
      b.addEventListener('click', () => this.startDive(dp));
      pts.appendChild(b);
    }
    if (hiddenN) {
      const d = document.createElement('div');
      d.className = 'pt unknown';
      d.innerHTML = `<span class="ico" style="background:#2a3a44;color:#8aa">？</span><span><div class="nm">未発見のポイント ×${hiddenN}</div><div class="sb">まだ知らない海がある</div></span><span></span>`;
      pts.appendChild(d);
    }
    this.renderDaytime();
    const spear = this.has('spear');
    $('open-kitchen').classList.toggle('hidden', !this.save.tutorial);
    $('open-quests').classList.toggle('hidden', !this.save.boardOn);
    $('quest-badge').textContent = this.save.boardOn && (!this.save.boardIntro || (this.save.board ?? []).some((q) => q.fresh)) ? 'NEW' : '';
    if (!spear) $('k-badge').textContent = nightOf(this.save.clock ?? 0) >= 0.5 ? '休む' : '';
    if (spear) {
      const ready = this.kitchen.readyCount();
      const lv = repLevel(this.save.rep ?? 0);
      $('k-badge').textContent = `${(this.save.story ?? 0) < lv ? '新しい話！ ' : ''}${ready ? `${ready}件 作れる` : `注文${this.save.orders?.length ?? 0}件`}`;
    }
    const money = this.save.money ?? 0;
    const buyable = SHOP.filter((g) => !this.owns(g) && this.stockGap(g) === 0 && money >= g.price && (!g.req || this.has(g.req))).length;
    $('shop-badge').textContent = buyable ? `${buyable}個 買える！` : '';
    $('album-badge').textContent = `${Object.keys(this.save.scenes ?? {}).length} / ${Object.keys(SCENES).length}`;
    const goal = this.nextGoal();
    const goalText = (gl: NonNullable<ReturnType<Game['nextGoal']>>) =>
      gl.species > 0
        ? `「？」入荷まで図鑑あと <b>${gl.species}種</b>`
        : gl.need > 0
          ? `「${gl.name}」まであと <b>${yen(gl.need)}</b>`
          : `<span class="ok">「${gl.name}」が買える！ ショップへ</span>`;
    $('t-goal').innerHTML = `所持金 <b>${yen(money)}</b>　図鑑 <b>${this.foundCount}種</b><br>` + (goal ? goalText(goal) : '装備コンプリート') + (this.save.storyClaim?.length ? '<br><span class="ok">編集長の報酬を受け取っていない（下の章カードで受け取れる）</span>' : '');
    if (!$('shop').classList.contains('hidden')) this.renderShop();
  }

  /** Fish in the cooler that the shop takes as material (good catches, lightest first). */
  private fishFor(kg: number): number[] | null {
    const list = (this.save.cooler ?? []).map((c, i) => ({ c, i })).filter(({ c }) => isGoodCatch(SPECIES_BY_ID.get(c.id)!)).sort((a, b) => a.c.kg - b.c.kg);
    const out: number[] = [];
    let sum = 0;
    for (const { c, i } of list) { if (sum >= kg) break; out.push(i); sum += c.kg; }
    return sum >= kg ? out : null;
  }

  /** The air tank: one tank, upgraded step by step. */
  private renderTank(): void {
    const lv = this.save.airLv ?? 0;
    const cur = AIR_TANK[lv], next = AIR_TANK[lv + 1];
    const money = this.save.money ?? 0;
    const el = $('tank');
    if (!next) { el.innerHTML = `<div class="tk-head">エアタンク Lv${lv + 1}（最大）<b>${cur.cap} bar</b></div>`; return; }
    const fish = this.has('spear') ? this.fishFor(next.kg) : null;
    const half = Math.round(next.price / 2 / 100) * 100;
    const coolerKg = (this.save.cooler ?? []).filter((c) => isGoodCatch(SPECIES_BY_ID.get(c.id)!)).reduce((a, c) => a + c.kg, 0);
    el.innerHTML = `<div class="tk-head">エアタンク Lv${lv + 1}　<b>${cur.cap} bar</b></div>
      <div class="tk-next">強化すると Lv${lv + 2}：<b>${next.cap} bar</b></div>
      <div class="tk-acts"><button type="button" class="btn ${money >= next.price ? 'pri' : 'sec'}" id="tk-money" ${money >= next.price ? '' : 'disabled'}>お金で強化 ${yen(next.price)}</button>
      ${this.has('spear') ? `<button type="button" class="btn ${fish && money >= half ? 'pri' : 'sec'}" id="tk-fish" ${fish && money >= half ? '' : 'disabled'}>魚${next.kg}kg＋${yen(half)}で強化</button>` : ''}</div>
      ${this.has('spear') ? `<small class="tk-note">店の親父は魚が大好き。クーラーの魚（食べられる魚 ${coolerKg.toFixed(1)}kg）を素材として受け取ってくれる</small>` : '<small class="tk-note">手銛を手に入れると、魚を素材にして安く強化できるようになる</small>'}`;
    document.getElementById('tk-money')?.addEventListener('click', () => this.upgradeTank(false));
    document.getElementById('tk-fish')?.addEventListener('click', () => this.upgradeTank(true));
  }

  private upgradeTank(withFish: boolean): void {
    const lv = this.save.airLv ?? 0;
    const next = AIR_TANK[lv + 1];
    if (!next) return;
    const price = withFish ? Math.round(next.price / 2 / 100) * 100 : next.price;
    if ((this.save.money ?? 0) < price) return;
    if (withFish) {
      const idx = this.fishFor(next.kg);
      if (!idx) return;
      this.save.cooler = this.save.cooler!.filter((_, i) => !idx.includes(i));
    }
    this.save.money = (this.save.money ?? 0) - price;
    this.save.airLv = lv + 1;
    this.writeSave();
    this.audio.chime(true);
    this.toast(`エアタンクを強化！ ${AIR_TANK[lv].cap} → ${next.cap} bar`, '', 3);
    this.renderShop();
    this.renderTitle();
  }

  /** Gear, fishing tackle and charts: bought on their own screen. */
  private renderShop(): void {
    const gear = $('gear');
    const money = this.save.money ?? 0;
    $('shop-status').innerHTML = `<span>所持金 <b>${yen(money)}</b></span><span>図鑑 <b>${this.foundCount}種</b></span>${this.has('spear') ? `<span>しおさい亭の評判 Lv<b>${repLevel(this.save.rep ?? 0)}</b></span>` : ''}`;
    this.renderTank();
    gear.innerHTML = SHOP.filter((u) => !u.rep || this.has('spear')).map((u) => {
      const on = this.owns(u);
      const gap = this.stockGap(u);
      const stocked = gap === 0;
      const needReq = !!u.req && !this.has(u.req);
      const can = !on && stocked && money >= u.price && !needReq;
      const req = on ? (u.map ? '場所は分かっている' : '入手済み') : !stocked ? (u.rep ? `食堂の評判Lv${u.rep}で入荷` : `図鑑${u.need}種で入荷<br>（あと${gap}種）`) : needReq ? `先に${SHOP.find((x) => x.id === u.req)!.name}` : can ? `購入 ${yen(u.price)}` : yen(u.price);
      const show = stocked || on || !!u.rep;
      return `<button type="button" class="gear-item ${on ? 'on' : ''} ${can ? 'can' : ''} ${stocked ? '' : 'locked'}" data-buy="${u.id}" ${on || !can ? 'aria-disabled="true"' : ''}><div class="gi">${show ? `<svg viewBox="0 0 24 24">${u.icon}</svg>` : '<b class="gq">？</b>'}</div>${show ? u.name : '？？？'}<span class="req">${req}</span><span class="gdesc">${show ? u.desc : '図鑑を埋めると入荷する'}</span></button>`;
    }).join('');
    gear.querySelectorAll<HTMLButtonElement>('[data-buy]').forEach((b) =>
      b.addEventListener('click', () => {
        const id = b.dataset.buy as GearId;
        const g = SHOP.find((x) => x.id === id)!;
        if (this.owns(g)) return;
        if (this.stockGap(g) > 0) { this.toast(g.rep ? `しおさい亭の評判がLv${g.rep}になると入荷する` : `図鑑をあと${this.stockGap(g)}種埋めると入荷する`); return; }
        if (g.req && !this.has(g.req)) { this.toast(`先に「${SHOP.find((x) => x.id === g.req)!.name}」が必要`); return; }
        if ((this.save.money ?? 0) < g.price) { this.toast('写真で稼いで買おう。いい写真ほど高く売れる'); return; }
        this.buy(id);
      }),
    );
  }

  /** Time of day on the boat: shown here, changed in the diner (sleep till morning / go out at night). */
  private renderDaytime(): void {
    const c = this.save.clock ?? 0;
    const el = $('daytime');
    const w = WEATHER[weatherOf(this.save.day ?? 1)];
    const now = `<span class="dt-now">${this.save.day ?? 1}日目・<b>${timeLabel(c)}</b>・${w.icon}${w.name}</span>`;
    const night = nightOf(c) >= 0.5;
    const torch = this.hasTorch();
    const buff = this.save.buff ? `<small>まかない：${DISH[this.save.buff].name}（${DISH[this.save.buff].short}）が次のダイブに効く</small>` : '';
    const note = night
      ? torch ? '<small>夜の海。しおさい亭で休むと朝になる</small>' : '<small>夜の海はライトがないと潜れない。しおさい亭で休むと朝になる</small>'
      : torch ? '<small>しおさい亭で「夜にする」と、夜の海に潜れる</small>' : '';
    const inn = night && this.save.tutorial ? '<button type="button" class="btn sec" data-inn="1">しおさい亭へ帰る</button>' : '';
    el.innerHTML = `${now}${buff}${note}${inn}`;
    el.querySelector<HTMLButtonElement>('[data-inn]')?.addEventListener('click', () => { this.audio.unlock(); this.kitchen.open(); });
  }

  private toast(text: string, kind: '' | 'warn' | 'danger' = '', dur = 2.2): void {
    const t = $('toast');
    t.textContent = text;
    t.className = 'show ' + kind;
    this.toastTimer = dur;
  }

  private openDex(): void {
    if (this.state === 'dex') return;
    this.stateBeforeDex = this.state;
    if (this.state === 'diving') this.paused = true;
    this.state = 'dex';
    $('pause').classList.add('hidden');
    $('dex').classList.remove('hidden');
    $('dx-count').textContent = String(this.foundCount + [...this.pending.keys()].filter((k) => !this.save.found[k]).length);
    $('dx-total').textContent = String(SPECIES.length);
    const grid = $('dex-grid');
    grid.innerHTML = '';
    const zones = ZONE_ORDER;
    for (const z of zones) {
      const list = SPECIES.filter((s) => s.zone === z);
      if (!list.length) continue;
      const got = list.filter((s) => this.save.found[s.id] || this.pending.has(s.id)).length;
      const title = document.createElement('div');
      title.className = 'dz-title';
      title.innerHTML = `${ZONE_NAMES[z]} <small>${got}/${list.length}</small>`;
      grid.appendChild(title);
      const g = document.createElement('div');
      g.className = 'dz-grid';
      for (const s of list) {
        const f = this.save.found[s.id] ?? this.pending.get(s.id);
        const c = document.createElement('button');
        c.type = 'button';
        c.className = 'dcard' + (f ? '' : ' unk');
        const stars = s.rarity >= 4 ? '伝説' : '★'.repeat(s.rarity);
        c.innerHTML = `<div class="ph" style="${f ? `background-image:url(${f.photo})` : ''}">${f ? '' : '?'}</div><div class="nm"><span class="stars">${stars}</span>${f ? s.name : '？？？'}</div>`;
        c.addEventListener('click', () => this.showDetail(s.id));
        g.appendChild(c);
      }
      grid.appendChild(g);
    }
  }

  private showDetail(id: string): void {
    const s = SPECIES_BY_ID.get(id)!;
    const f = this.save.found[id] ?? this.pending.get(id);
    const img = $<HTMLImageElement>('dd-photo');
    img.src = f ? f.photo : 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
    img.classList.toggle('none', !f);
    $('dd-zone').textContent = `${ZONE_NAMES[s.zone]}・水深 ${s.depth[0]}–${s.depth[1]}m・${s.rarity >= 4 ? '伝説級（古生物）' : '★'.repeat(s.rarity)}`;
    $('dd-name').textContent = f ? s.name : '？？？';
    $('dd-sci').textContent = f ? s.sci : '';
    $('dd-meta').textContent = f ? `大きさ 約${s.size >= 1 ? s.size.toFixed(1) + 'm' : Math.round(s.size * 100) + 'cm'}　撮影水深 ${f.depth.toFixed(1)}m${this.pending.has(id) && !this.save.found[id] ? '　（未保存：浮上で登録）' : ''}` : '';
    $('dd-desc').textContent = f ? s.desc + (s.habLabel ? `\n【くらし】${s.habLabel}。` : '') : `ヒント：${s.hint}`;
    $('dex-detail').classList.remove('hidden');
  }

  private closeDex(): void {
    $('dex').classList.add('hidden');
    $('dex-detail').classList.add('hidden');
    this.state = this.stateBeforeDex;
    if (this.state === 'diving') {
      this.paused = false;
      this.clock.getDelta();
    } else if (this.state === 'paused') {
      $('pause').classList.remove('hidden');
    }
  }

  private boatPos(): { x: number; z: number } | null {
    return this.ads ? null : { x: this.flora.boat.position.x, z: this.flora.boat.position.z };
  }

  private toggleMap(open: boolean): void {
    if (!this.minimap) return;
    $('map').classList.toggle('hidden', !open);
    this.minimap.open = open;
    if (open) {
      this.input.reset();
      const p = this.camera.position;
      this.minimap.drawBig(p.x, p.z, this.yaw, this.boatPos());
    }
  }

  private setPaused(p: boolean): void {
    if (this.state !== 'diving' && this.state !== 'paused') return;
    this.state = p ? 'paused' : 'diving';
    this.paused = p;
    $('pause').classList.toggle('hidden', !p);
    // Phase 2: surfacing from the pause menu only with the signal float (or the ADS winch)
    const anywhere = this.surfaceAnywhere();
    $('abort').classList.toggle('hidden', !anywhere);
    $('pause-note').textContent = anywhere ? '途中で終了しても、浮上するので写真は保存されます。' : '浮上するには水面近く（水深1.6mより浅く）まで上がろう。';
    this.input.reset();
    this.clock.getDelta();
  }

  // ------------------------------------------------------------------ flow
  start(): void {
    const B = (window as unknown as Record<string, Record<string, number>>).__BOOT_MS__;
    let tm = performance.now();
    const mark = (k: string) => { const n = performance.now(); B[k] = Math.round(n - tm); tm = n; };
    this.titleCamera(0);
    this.terrain.prime(this.camera.position.x, this.camera.position.z, 90);
    mark('terrainPrime');
    $('loading').classList.add('hidden');
    this.state = 'title';
    // a new game opens under water in the shallow lagoon (the test dive), without the boat screen first
    const fresh = this.save.dives === 0 && !this.save.tutorial;
    if (fresh) {
      $('title').classList.add('hidden');
      this.startDive(DIVE_POINTS.find((d) => d.id === 'lagoon')!, false, true);
    } else this.renderTitle();
    mark('firstRender');
    this.renderer.setAnimationLoop(() => this.tick());
    // build the bathymetric chart while the player is on the title screen
    window.setTimeout(() => this.ensureMinimap(), 1200);
  }

  private ensureMinimap(): Minimap {
    if (!this.minimap) this.minimap = new Minimap($<HTMLCanvasElement>('minimap'), $<HTMLCanvasElement>('bigmap'));
    this.minimap.known = this.discovered;
    return this.minimap;
  }

  private titleCamera(t: number): void {
    // slow drift over the reef
    const x = -20 + Math.sin(t * 0.03) * 14;
    const z = 205 + t * 0.6 % 40;
    const ground = heightAt(x, z);
    this.camera.position.set(x, Math.max(ground + 4.5, -9), z);
    this.camera.rotation.set(-0.12 + Math.sin(t * 0.1) * 0.03, Math.PI + 0.4 + Math.sin(t * 0.05) * 0.25, 0, 'YXZ');
  }

  /** The diner's urchin harvest: straight to the rocks, straight back afterwards. */
  private quickUrchin(): void {
    const dp = DIVE_POINTS.find((d) => d.id === 'rocky')!;
    $('kitchen').classList.add('hidden');
    this.quick = { kind: 'urchin', started: false };
    this.startDive(dp, true);
  }

  private startDive(dp: DivePoint, quick = false, prologue = false): void {
    if (dp.requires !== 'ads' && this.nightBlocked()) {
      this.toast('夜の海はライトがないと潜れない。しおさい亭で休んで朝を待とう（ライトがあれば夜も潜れる）', 'warn', 3.5);
      return;
    }
    if (!quick) this.quick = null;
    this.audio.unlock();
    const fade = $('fade');
    fade.classList.add('on');
    window.setTimeout(() => {
      this.point = dp;
      this.ads = dp.requires === 'ads';
      // the dish eaten in the diner powers up this one dive
      this.buff = this.ads ? null : this.save.buff ?? null;
      if (this.buff) { this.save.buff = null; this.writeSave(); }
      this.airMax = (this.ads ? 220 : AIR_TANK[this.save.airLv ?? 0].cap) * (this.buff === 'nabe' ? 1.2 : 1);
      this.air = this.airMax;
      this.diveTime = 0;
      this.diveMaxDepth = 0;
      this.diveShots = 0;
      this.pending.clear();
      this.creatures.companion = null;
      this.vel.set(0, 0, 0);
      // a few metres down after the giant-stride entry, clear of the boat's keel (~1.8 m draft)
      const startY = this.ads ? -175 : -3.2;
      this.camera.position.set(dp.x, startY, dp.z);
      this.yaw = Math.PI; // face offshore (+z)
      this.pitch = this.ads ? -0.5 : -0.35;
      // moored ~12 m up-current behind the diver, stern (ladder) facing the diver
      this.flora.placeBoat(dp.x - 2, dp.z - 12);
      this.ensureMinimap();
      this.flora.boat.visible = !this.ads;
      this.terrain.prime(dp.x, dp.z, 80);
      this.creatures.night = !this.ads && nightOf(this.save.clock ?? 0) >= 0.5;
      // Phase 4: the day's weather shapes this dive (ADS dives are always calm and clear)
      this.weather = this.ads ? 'sunny' : weatherOf(this.save.day ?? 1);
      const wNow = WEATHER[this.weather];
      this.creatures.weatherMult = (def) => weatherMultOf(def, this.weather);
      this.creatures.ads = this.ads;
      this.env.weatherLight = wNow.light;
      this.env.weatherFog = wNow.fog;
      this.creatures.clearBait();
      this.creatures.grab = null;
      this.clearBaitVisual();
      this.refreshBaitUi();
      this.creatures.reshuffle(this.camera.position);
      this.creatures.events.length = 0;
      this.placeCurrents();
      if (this.save.dives === 0 && !this.ads) {
        // first dive: something showy within the first minute (a sea turtle just ahead, 5-6 m down)
        const tz = dp.z + 11, tx = dp.x + 2;
        this.creatures.placeNear('turtle', new THREE.Vector3(tx, Math.max(heightAt(tx, tz) + 1.5, -6), tz));
      }
      // the new site's species are built while the screen is still fading in
      this.creatures.buildBudgetMs = 40;
      window.setTimeout(() => (this.creatures.buildBudgetMs = 6), 2500);
      this.creatures.primeAround(this.camera.position);
      this.env.lightOn = this.ads;
      this.env.lightPower = this.ads || this.has('light') ? 1.6 : 1;
      this.creatures.stealth = this.has('rebreather') ? 0.5 : 1;
      this.env.night = this.ads ? 0 : nightOf(this.save.clock ?? 0);
      this.creatures.night = this.env.night >= 0.5;
      this.nightAnnounced = this.env.night >= 0.5 ? 2 : (this.save.clock ?? 0) >= FISHING.duskAt ? 1 : 0;
      this.tool = 'camera';
      this.reload = 0;
      this.diveCatch = [];
      this.diveFinds = [];
      this.pendingScenes.clear();
      this.activeQuest = null;
      this.surveySeen.clear();
      this.spearFx.visible = false;
      $('hud').classList.remove('spear');
      $('btn-tool').classList.toggle('hidden', !this.has('spear') || this.ads);
      this.vmHand.visible = this.vmGun.visible = false;
      // special sights: staged for the chapter that asks for them, later left to chance
      const ch = this.chapter;
      const nightNow = nightOf(this.save.clock ?? 0) >= 0.5;
      const sceneIds: SceneId[] = [];
      if (!this.ads && ch?.scene && !this.save.scenes?.[ch.scene]) sceneIds.push(ch.scene);
      if (!this.ads) {
        // at most one sight left to luck per dive; the story ones only after the story has shown them
        const luck = (Object.keys(SCENES) as SceneId[]).filter((id) => {
          const S = SCENES[id];
          if (sceneIds.includes(id) || !S.points.includes(dp.id) || !!S.night !== nightNow && id !== 'spawning') return false;
          if (CHAPTERS.some((c) => c.scene === id) && !this.save.scenes?.[id]) return false;
          return true;
        }).sort(() => Math.random() - 0.5);
        const hit = luck.find((id) => Math.random() < SCENES[id].chance);
        if (hit) sceneIds.push(hit);
      }
      this.scenes.start(sceneIds, new THREE.Vector3(dp.x, 0, dp.z));
      const fixed = ch?.scene ? SCENE_AT[ch.scene] : undefined;
      this.stagedScene = fixed && sceneIds.includes(ch!.scene!) ? ch!.scene! : null;
      this.pendingSpots.clear();
      // now and then something lies on the floor
      if (this.ads || !this.save.tutorial) this.finds.clear();
      else this.finds.spawn(new THREE.Vector3(dp.x, 0, dp.z), (x, z) => !(zoneAt(x, z) === 'cave') && caveRoofAt(x, z) === null);
      // the first dive is the tutorial
      this.tut.step = this.save.tutorial || this.ads ? -1 : 0;
      this.tut.t = 0; this.tut.moved = 0; this.tut.looked = 0; this.tut.praise = 0; this.tut.down = 0; this.tut.repeat = 0; this.tut.depth0 = -this.camera.position.y;
      this.tut.from.copy(this.camera.position);
      $('coach').classList.toggle('hidden', this.tut.step < 0);
      $('hud').classList.remove('hl-air', 'hl-surface');
      if (this.env.night && this.hasTorch()) { this.env.lightOn = true; $('btn-light').classList.add('on'); }
      if (this.env.night && !this.ads && !this.save.nightHint) {
        this.save.nightHint = true;
        this.writeSave();
        window.setTimeout(() => this.toast('夜はオキザヨリがライトに突進してくることがある。危ないときはライトを消そう', 'warn', 5), 2500);
      }
      this.creatures.shield = this.has('shield');
      if (this.minimap) this.minimap.blips = [];
      this.coldWarned = -100;
      this.missions.reset();
      this.missions.newDive();
      this.bonuses = [];
      $('btn-light').classList.toggle('on', this.env.lightOn);
      $('btn-light').classList.toggle('dim', !this.ads && !this.hasTorch());
      $('btn-boost').classList.toggle('hidden', !this.has('scooter'));
      $('title').classList.add('hidden');
      $('result').classList.add('hidden');
      $('hud').classList.remove('hidden');
      $('mask').classList.add('on');
      $('dex-total').textContent = String(SPECIES.length);
      this.updateDexChip();
      this.state = 'diving';
      this.paused = false;
      this.clock.getDelta();
      fade.classList.remove('on');
      if (prologue) {
        // the opening story sits over the first view of the sea; the dive (and the tutorial) waits for a tap
        this.paused = true;
        $('coach').classList.add('hidden');
        $('pr-text').textContent = CHAPTERS[0].intro;
        $('zone-name').textContent = ZONE_NAMES[zoneAt(dp.x, dp.z)];
        $('prologue').classList.remove('hidden');
      }
      if (!this.helpShown && this.tut.step < 0) {
        this.helpShown = true;
        $('help').classList.remove('hidden');
        window.setTimeout(() => $('help').classList.add('hidden'), 7000);
      }
      this.toast(this.ads ? '大気圧潜水服で深海へ降下中…' : `${dp.name}にエントリー${this.env.night >= 0.5 ? '（夜の海）' : ''}　天気：${WEATHER[this.weather].icon}${WEATHER[this.weather].name}${this.buff ? `　まかないの${DISH[this.buff].name}：${DISH[this.buff].short}` : ''}`, '', 3);
    }, 650);
  }

  /** 2-3 down-current cells at the drop-off edge and in the blue, different on every dive. */
  private placeCurrents(): void {
    this.currents = [];
    const want = 2 + (Math.random() < 0.5 ? 1 : 0);
    for (let k = 0; k < 200 && this.currents.length < want; k++) {
      const x = -150 + Math.random() * 300, z = 330 + Math.random() * 320;
      const zone = zoneAt(x, z);
      if (zone !== 'dropoff' && zone !== 'offshore') continue;
      if (this.currents.some((c) => Math.hypot(c.x - x, c.z - z) < 60)) continue;
      this.currents.push({ x, z, r: 14 + Math.random() * 10, s: 0.8 + Math.random() * 0.6 });
    }
  }

  /** Bait kinds the diver actually holds, in shelf order. */
  private heldBaits(): typeof BAIT.kinds {
    return BAIT.kinds.filter((k) => (this.save.bait?.[k.id] ?? 0) > 0);
  }

  private cycleBaitKind(): void {
    const held = this.heldBaits();
    if (held.length < 2) return;
    const i = held.findIndex((k) => k.id === this.baitKind);
    this.baitKind = held[(i + 1) % held.length].id;
    this.refreshBaitUi();
  }

  /** Scatter the selected bait 1.5 m ahead: a sinking cloud of particles that lures fish in. */
  private scatterBait(): void {
    if (this.ads || !this.save.tutorial) return;
    const held = this.heldBaits();
    if (!held.length) return;
    if (!held.some((k) => k.id === this.baitKind)) this.baitKind = held[0].id;
    const kind = BAIT.kinds.find((k) => k.id === this.baitKind)!;
    const s = this.save;
    s.bait![kind.id] = (s.bait?.[kind.id] ?? 0) - 1;
    this.writeSave();
    const fwd = this.tmpDir.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const p = this.camera.position.clone().addScaledVector(fwd, 1.5);
    const gy = heightAt(p.x, p.z) + 0.5;
    if (p.y < gy) p.y = gy;
    this.creatures.dropBait(p, kind.id, (def) => eatsBait(def, kind.id), BAIT.life);
    // the visible cloud: soft particles that sink slowly and fade out in the last seconds
    this.clearBaitVisual();
    const N = 60;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = p.x + (Math.random() - 0.5) * 0.7;
      pos[i * 3 + 1] = p.y + (Math.random() - 0.5) * 0.7;
      pos[i * 3 + 2] = p.z + (Math.random() - 0.5) * 0.7;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const m = new THREE.PointsMaterial({ color: kind.color, size: 0.09, transparent: true, opacity: 0.9, depthWrite: false });
    this.baitPts = new THREE.Points(g, m);
    this.baitPts.frustumCulled = false;
    this.scene.add(this.baitPts);
    this.baitPtsT = 0;
    this.audio.chime(false);
    this.toast(`「${kind.name}」をまいた`, '', 1.6);
    this.refreshBaitUi();
  }

  private clearBaitVisual(): void {
    if (!this.baitPts) return;
    this.scene.remove(this.baitPts);
    this.baitPts.geometry.dispose();
    (this.baitPts.material as THREE.Material).dispose();
    this.baitPts = null;
  }

  /** Per-frame: the cloud sinks with time and fades out over its last seconds. */
  private updateBaitVisual(dt: number): void {
    if (!this.baitPts) return;
    if (!this.creatures.bait) { this.clearBaitVisual(); return; }
    this.baitPtsT += dt;
    const pos = this.baitPts.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) pos.setY(i, pos.getY(i) - dt * 0.05);
    pos.needsUpdate = true;
    const left = BAIT.life - this.creatures.bait.t;
    (this.baitPts.material as THREE.PointsMaterial).opacity = left < 8 ? Math.max(0, left / 8) * 0.9 : 0.9;
  }

  /** Bait buttons: shown while diving after the tutorial (never in the ADS), with kind and uses left. */
  private refreshBaitUi(): void {
    const held = this.heldBaits();
    const show = this.state === 'diving' && !this.ads && !!this.save.tutorial && held.length > 0;
    $('btn-bait').classList.toggle('hidden', !show);
    $('btn-bait-kind').classList.toggle('hidden', !(show && held.length > 1));
    if (held.length && !held.some((k) => k.id === this.baitKind)) this.baitKind = held[0].id;
    const kind = BAIT.kinds.find((k) => k.id === this.baitKind);
    $('bait-label').textContent = kind && show ? `${kind.name}×${this.save.bait?.[kind.id] ?? 0}` : '';
    if (kind) $('btn-bait').style.color = kind.color;
  }

  /** Warnings, charges and bites from territorial triggerfish / curious sharks. */
  private handleEncounters(): void {
    const ev = this.creatures.events;
    while (ev.length) {
      const e = ev.shift()!;
      const name = e.def.name;
      const shark = e.def.aggro?.kind === 'shark';
      const light = e.def.aggro?.kind === 'light';
      if (e.type === 'warn') {
        if (this.time - this.lastEncounter < 4) continue;
        this.lastEncounter = this.time;
        this.toast(light ? '水面近くで何かがライトに反応した…' : shark ? `${name}がこちらの周りを回り始めた…` : `${name}の縄張りに入った！ 威嚇されている`, 'warn', 3);
      } else if (e.type === 'repel') {
        this.toast(`シャークシールドが作動！ ${name}が向きを変えた`, 'warn', 2.5);
        this.shake = Math.max(this.shake, 0.3);
        continue;
      } else if (e.type === 'charge') {
        this.audio.warn();
        this.toast(light ? `${name}がライトめがけて突っ込んでくる！ ライトを消して！` : shark ? `${name}が突っ込んでくる！` : `${name}が突進してくる！ 離れて！`, 'danger', 2.5);
      } else if (e.type === 'octoWarn') {
        this.toast(`${name}の腕がこちらに伸びてきた… 近づきすぎ注意（ゆっくり離れよう）`, 'warn', 3);
      } else if (e.type === 'grab') {
        const dmg = Math.round(OCTO.first * (e.def.size >= 1 ? OCTO.big : 1));
        this.air = Math.max(1, this.air - dmg);
        this.shake = Math.max(this.shake, 0.8);
        this.audio.warn();
        try { navigator.vibrate?.(160); } catch { /* not supported */ }
        this.toast(`${name}に吸盤で絡まれた！ エア −${dmg}bar　シャッター連打で振りほどこう`, 'danger', 3.5);
      } else {
        const bite = e.def.aggro?.bite ?? 5;
        this.air = Math.max(1, this.air - bite);
        const push = this.camera.position.clone().sub(e.p).setY(0.3).normalize();
        this.vel.addScaledVector(push, shark ? 4.5 : 3);
        this.shake = 1;
        this.audio.warn();
        this.toast(light ? `${name}のくちばしが刺さった！ エア −${bite}bar` : shark ? `${name}にぶつかられた！ エア −${bite}bar` : `${name}に噛まれた！ エア −${bite}bar`, 'danger', 3);
        const f = $('flash');
        f.classList.remove('go');
        f.classList.add('hurt');
        void f.offsetWidth;
        f.classList.add('go');
        window.setTimeout(() => f.classList.remove('hurt'), 500);
        try { navigator.vibrate?.(shark ? [80, 40, 160] : 120); } catch { /* not supported */ }
      }
    }
  }

  private endDive(reason: 'surface' | 'blackout'): void {
    if (this.state !== 'diving' && this.state !== 'paused') return;
    const before = this.foundCount;
    const shots = [...this.pending.entries()];
    this.creatures.companion = null;
    // discoveries are never lost (being rescued costs money instead: the penalty fits the mistake)
    for (const [id, f] of shots) {
      const old = this.save.found[id];
      if (!old || f.score > (old.score ?? -1)) this.save.found[id] = { photo: f.photo, depth: f.depth, score: f.score, t: Date.now() };
    }
    const gross = shots.reduce((a, [, f]) => a + f.value, 0) + this.bonuses.reduce((a, b) => a + b.value, 0);
    const earn = reason === 'surface' ? gross : Math.round((gross * PHOTO.blackoutKeep) / 10) * 10;
    const moneyBefore = this.save.money ?? 0;
    this.save.money = moneyBefore + earn;
    this.save.earned = (this.save.earned ?? 0) + earn;
    this.save.dives += 1;
    if (!this.quick) {
      this.save.clock = Math.max(this.save.clock ?? 0, FISHING.duskAt + FISHING.duskLen);
      (this.save.okami ??= { lore: 0 }).ev = 'back';
    }
    this.save.maxDepth = Math.max(this.save.maxDepth, this.diveMaxDepth);
    // the catch goes into the cooler at the diner; a blackout loses it to the sea
    let caught = reason === 'surface' ? this.diveCatch : [];
    // protected animals are found on the boat by the fisheries patrol: confiscated, fined, and the diner's name suffers
    const seized = caught.filter((c) => { const e = edibleInfo(SPECIES_BY_ID.get(c.id)!); return e.ok && e.protected; });
    let fine = 0;
    if (seized.length) {
      caught = caught.filter((c) => !seized.includes(c));
      fine = seized.length * PENALTY.protectedFine;
      this.save.money = Math.max(0, (this.save.money ?? 0) - fine);
      this.save.rep = Math.max(0, (this.save.rep ?? 0) - seized.length * PENALTY.protectedRep);
    }
    (this.save.cooler ??= []).push(...caught);
    // boxes picked up are opened on the boat
    const opened = reason === 'surface' ? this.diveFinds.map((k) => {
      const unknown = DIVE_POINTS.filter((d) => !this.discovered.has(d.id) && d.id !== 'lagoon').map((d) => ({ id: d.id, name: d.name }));
      const loot = openFind(k, unknown);
      this.save.money = (this.save.money ?? 0) + loot.yen;
      if (loot.map) this.grantMap(loot.map);
      return { k, loot };
    }) : [];
    // special sights are kept even after a blackout, like the dex
    for (const [id, v] of this.pendingScenes) (this.save.scenes ??= {})[id] = { photo: v.photo, t: Date.now() };
    // photo spots pay only the first time: kept even after a blackout, like the sights
    if (this.pendingSpots.size) this.save.spots = [...new Set([...(this.save.spots ?? []), ...this.pendingSpots])];
    if (this.tut.step >= 0) this.endTutorial();
    this.save.tutorial = true;
    this.scenes.stop();
    this.finds.clear();
    this.stagedScene = null;
    this.writeSave();
    this.setTool('camera');
    const after = this.foundCount;
    this.kitchen.newToday = after > before;
    this.state = 'result';
    this.paused = true;
    $('pause').classList.add('hidden');
    $('hud').classList.add('hidden');
    $('map').classList.add('hidden');
    if (this.minimap) this.minimap.open = false;
    $('mask').classList.remove('on');
    $('result').classList.remove('hidden');
    $('res-kicker').textContent = reason === 'surface' ? 'SURFACED' : 'BLACKOUT';
    $('res-title').textContent = reason === 'surface' ? '無事に浮上しました' : 'エア切れで気絶… 救助されました';
    const m = Math.floor(this.diveTime / 60);
    const s = Math.floor(this.diveTime % 60);
    $('res-stats').innerHTML = `<div>潜水時間<b>${m}:${String(s).padStart(2, '0')}</b></div><div>新種<b>${after - before}</b></div><div>写真の売上<b id="res-earn">¥0</b></div>`;
    // count the earnings up quickly (praise the result)
    const t0 = performance.now();
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / 900);
      const el = document.getElementById('res-earn');
      if (el) el.textContent = yen(earn * (1 - (1 - k) ** 3));
      if (k < 1 && this.state === 'result') requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    const list = $('res-list');
    list.innerHTML = shots.length
      ? shots.map(([id, f]) => `<div class="res-card"><img src="${f.photo}" alt=""><i class="rg g${f.grade}">${f.grade}</i>${f.isNew ? '<i class="rnew">NEW</i>' : ''}<div>${SPECIES_BY_ID.get(id)!.name}<small>${yen(f.value)}</small></div></div>`).join('')
      : `<div class="res-empty">${this.diveShots ? '新しい生き物は撮れませんでした。' : '今回は写真を撮りませんでした。'}</div>`;
    if (this.bonuses.length) list.insertAdjacentHTML('beforeend', this.bonuses.map((b) => `<div class="res-bonus">${b.label}<b>${yen(b.value)}</b></div>`).join(''));
    // Phase 3: the editor's chapter was cleared on this dive — the reward is received on the boat
    const chNow = this.chapter;
    if (chNow && chNow.reward && chNow.done(this.storyState())) list.insertAdjacentHTML('beforeend', `<div class="res-find"><span class="open">編集長の依頼「${chNow.title}」をクリア！</span>ボートの章カードで報酬 <b>${yen(chNow.reward)}</b> を受け取ろう</div>`);
    if (this.diveCatch.length) {
      list.insertAdjacentHTML('beforeend', reason === 'surface'
        ? caught.map((c) => `<div class="res-catch">獲物：${SPECIES_BY_ID.get(c.id)!.name}<b>${fmtKg(c.kg)}</b></div>`).join('')
        : `<div class="res-empty">気絶したときに獲物（${this.diveCatch.length}匹）は海に流されてしまった。</div>`);
    }
    if (seized.length) list.insertAdjacentHTML('beforeend', `<div class="res-empty">漁協の見回りに見つかった！ 保護されている${seized.map((c) => SPECIES_BY_ID.get(c.id)!.name).join('・')}は没収、罰金 ${yen(fine)}。しおさい亭の評判も下がってしまった…</div>`);
    for (const { k, loot } of opened) list.insertAdjacentHTML('beforeend', `<div class="res-find">拾った「${FIND_NAME[k]}」を開けてみると…<span class="open">${loot.text}${loot.yen ? `　<b>+${yen(loot.yen)}</b>` : ''}</span></div>`);
    if (reason === 'blackout' && this.diveFinds.length) list.insertAdjacentHTML('beforeend', `<div class="res-empty">拾った物は気絶したときに落としてしまった。</div>`);
    this.diveCatch = [];
    this.diveFinds = [];
    const ready = this.kitchen.readyCount();
    $('res-kitchen').classList.toggle('hidden', !caught.length);
    $('res-kitchen').textContent = ready ? `しおさい亭で料理する（${ready}件の注文が作れる！）` : 'しおさい亭で料理する';
    if (!shots.length && !this.bonuses.length && caught.length) list.querySelector('.res-empty')?.remove();
    this.missions.reset();
    if (reason === 'blackout' && shots.length) list.insertAdjacentHTML('beforeend', `<div class="res-empty">気絶して救助された。図鑑の記録は残ったが、救助費用で売上は${Math.round(PHOTO.blackoutKeep * 100)}%に（${yen(gross)} → ${yen(earn)}）。エアに気をつけて早めに浮上しよう。</div>`);
    const stockedNow = SHOP.filter((g) => !this.has(g.id) && !g.rep && !this.save.stocked?.includes(g.id) && g.need > before && this.stockGap(g) === 0);
    const affordable = SHOP.filter((g) => !this.has(g.id) && this.stockGap(g) === 0 && this.save.money! >= g.price && (moneyBefore < g.price || stockedNow.includes(g)));
    const goal = this.nextGoal();
    $('res-unlock').innerHTML = [
      ...stockedNow.map((g) => `ダイブショップに「${g.name}」が入荷した！（${g.desc}）`),
      ...affordable.map((g) => `「${g.name}」が買えるようになった！ ボートのショップへ`),
    ].join('<br>') || (goal ? `<span class="res-goal">所持金 ${yen(this.save.money!)}　次の目標${goal.species > 0 ? `「？」入荷まで図鑑あと${goal.species}種` : `「${goal.name}」まであと${yen(goal.need)}`}</span>` : '');
    if (affordable.length || stockedNow.length || earn > 0) this.audio.chime(affordable.length + stockedNow.length > 0);
    if (this.quick) {
      // the diner's harvest: no result screen, straight back to the shop
      const ok = !!this.quick.ok;
      this.quick = null;
      if (ok) { this.save.rep = (this.save.rep ?? 0) + 1; this.writeSave(); }
      $('result').classList.add('hidden');
      this.toTitle();
      this.kitchen.open();
      this.kitchen.harvestResult(ok, earn);
    }
  }

  private toTitle(): void {
    $('result').classList.add('hidden');
    $('title').classList.remove('hidden');
    this.state = 'title';
    this.env.lightOn = false;
    this.renderTitle();
  }

  private updateDexChip(): void {
    const newOnes = [...this.pending.keys()].filter((k) => !this.save.found[k]).length;
    $('dex-count').textContent = String(this.foundCount + newOnes);
    const earn = [...this.pending.values()].reduce((a, f) => a + f.value, 0) + this.bonuses.reduce((a, b) => a + b.value, 0);
    $('cash-val').textContent = yen(earn);
    const n = $('dex-new');
    n.textContent = '+' + newOnes;
    n.classList.toggle('hidden', newOnes === 0);
  }

  // ------------------------------------------------------------------ simulation
  private updateDiver(dt: number): void {
    this.lastDt = dt;
    const inp = this.input;
    inp.poll();
    const [lx, ly] = inp.takeLook();
    if (this.tut.step >= 0) this.tut.looked += Math.abs(lx) + Math.abs(ly);
    this.yaw -= lx;
    this.pitch = clamp(this.pitch - ly, -1.45, 1.45);
    if (inp.consume('light')) {
      if (!this.ads && !this.hasTorch()) this.toast('ライトを持っていない', 'warn', 2.5);
      else this.env.lightOn = !this.env.lightOn;
      $('btn-light').classList.toggle('on', this.env.lightOn);
    }
    if (inp.consume('dex')) this.openDex();
    if (inp.consume('map')) this.toggleMap(!this.minimap?.open);
    if (inp.consume('menu')) this.setPaused(true);
    if (inp.consume('surface') && this.canSurface()) this.endDive('surface');
    if (inp.consume('tool')) this.setTool(this.tool === 'camera' ? 'spear' : 'camera');
    if (inp.consume('baitKind')) this.cycleBaitKind();
    if (inp.consume('bait')) this.scatterBait();

    const cam = this.camera;
    const fwd = new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const boosting = inp.boost && this.has('scooter');
    let speed = (this.ads ? 2.3 : 2.4) * (this.has('fins') ? 1.3 : 1) * (this.buff === 'shioyaki' ? 1.15 : this.buff === 'fugu' ? 1.1 : 1) * (1 - Math.min(0.3, this.carryKg / 120));
    if (boosting) speed = 6;
    if (this.creatures.grab) speed *= 0.25; // Phase 4: an octopus on the arms — barely able to swim
    const want = new THREE.Vector3().addScaledVector(fwd, inp.moveY * speed).addScaledVector(right, inp.moveX * speed * 0.7);
    if (inp.up) want.y += speed * 0.75;
    if (inp.down) want.y -= speed * (this.ads ? 1.3 : 0.75);
    // neutral buoyancy drift + breathing bob
    want.y += Math.sin(this.time * (Math.PI * 2) / 5.2) * 0.06;
    this.vel.lerp(want, 1 - Math.exp(-dt * (boosting ? 2.4 : 1.6)));
    cam.position.addScaledVector(this.vel, dt);
    // down-current: the water itself sinks and spills seaward; escape by swimming sideways out of the cell
    this.currentF = 0;
    if (!this.ads) {
      for (const c of this.currents) {
        const d = Math.hypot(cam.position.x - c.x, cam.position.z - c.z);
        const f = clamp((c.r - d) / (c.r * 0.45), 0, 1) * clamp((-cam.position.y - 1.5) / 4, 0, 1);
        if (f <= 0) continue;
        this.currentF = Math.max(this.currentF, f);
        cam.position.y -= c.s * f * f * dt;
        cam.position.z += c.s * 0.3 * f * dt;
        cam.position.x += Math.sin(this.time * 0.7 + c.x) * c.s * 0.15 * f * dt;
      }
      if (this.currentF > 0.2 && this.time - this.currentWarned > 12) {
        this.currentWarned = this.time;
        this.audio.warn();
        this.toast('ダウンカレントに捕まった！ 横へ泳いで流れから抜けよう', 'danger', 3.5);
      }
      this.shake = Math.max(this.shake, this.currentF * 0.25);
    }
    const p = cam.position;
    // depth limits
    const depth = -p.y;
    if (!this.ads && depth > 58) {
      this.vel.y = Math.max(this.vel.y, (depth - 58) * 0.8);
      if (this.time - this.lastWarn > 4) {
        this.toast('スキューバの限界深度です。これ以上は潜れません', 'danger');
        this.lastWarn = this.time;
      }
    }
    p.x = clamp(p.x, WORLD.minX, WORLD.maxX);
    p.z = clamp(p.z, WORLD.minZ, WORLD.maxZ);
    // corals, rocks and sponges are solid: slide around or over them instead of swimming through
    resolveSphere(p, 0.4, this.vel);
    this.flora.collideDynamic(p, 0.4, this.vel);
    this.creatures.collideBig(p, 0.4, this.vel);
    const ground = heightAt(p.x, p.z) + 0.7;
    if (p.y < ground) {
      p.y = ground;
      this.vel.y = Math.max(0, this.vel.y);
    }
    if (p.y > -0.35) {
      p.y = -0.35;
      this.vel.y = Math.min(0, this.vel.y);
    }
    // cave roof: stay under it inside the passage, on top of it above (the rock slab is ~2.3 m deep)
    const roof = caveRoofAt(p.x, p.z);
    if (roof !== null && p.y > roof - 0.55 && p.y < -1.8) {
      if (p.y - roof < -1.8 - p.y) { p.y = roof - 0.55; this.vel.y = Math.min(0, this.vel.y); }
      else { p.y = -1.8; this.vel.y = Math.max(0, this.vel.y); }
    }
    this.env.shade = roof !== null && p.y < roof ? 1 : 0;
    this.env.plankton = Math.min(1, this.vel.length() / 1.5);
    // camera orientation with subtle sway
    const sway = this.reducedMotion ? 0 : 1;
    const roll = Math.sin(this.time * 0.7) * 0.012 * sway + clamp(-inp.moveX * 0.06, -0.06, 0.06) + Math.sin(this.time * 1.9) * this.narc * 0.08;
    this.shake = Math.max(0, this.shake - dt * 1.6);
    const sk = this.reducedMotion ? 0 : this.shake * this.shake;
    cam.rotation.set(
      this.pitch + Math.sin(this.time * 0.5) * 0.006 * sway + Math.sin(this.time * 37) * 0.03 * sk,
      this.yaw + Math.sin(this.time * 29) * 0.03 * sk,
      roll + Math.sin(this.time * 23) * 0.04 * sk,
      'YXZ',
    );
    this.handleEncounters();

    // Phase 4: held by an octopus — air drains until the diver shakes free or it lets go
    const gr = this.creatures.grab;
    if (gr) {
      gr.t += dt;
      this.air = Math.max(1, this.air - OCTO.perSec * (gr.rt.def.size >= 1 ? OCTO.big : 1) * dt);
      this.shake = Math.max(this.shake, 0.25);
      if (gr.t >= OCTO.maxHold) {
        this.creatures.releaseGrab(this.camera.position);
        this.toast(`${gr.rt.def.name}は腕をほどいて離れていった`, '', 2.5);
      }
    }

    // air
    const d = Math.max(0, -p.y);
    const moving = this.vel.length() > 0.5 ? 1.15 : 1;
    // cold cove without a drysuit: shivering triples air use
    const inCold = !this.ads && zoneAt(p.x, p.z) === 'cold';
    this.cold = inCold && !this.has('drysuit') ? 1 : 0;
    if (this.cold && this.time - this.coldWarned > 15) {
      this.coldWarned = this.time;
      this.audio.warn();
      this.toast(this.buff === 'nitsuke' ? '水温2℃！ まかないの煮付けのおかげで少しはましだが、エアの減りが1.5倍に' : '水温2℃！ 寒さで震えてエアの減りが3倍に（ドライスーツがあれば平気）', 'danger', 3.5);
    }
    const rate = this.ads ? 0.26 : 0.42 * (1 + d / 10) * moving * (boosting ? 1.25 : 1) * (1 + this.narc * 0.5) * (1 + this.currentF * 0.8) * (this.cold ? (this.buff === 'nitsuke' ? 1.5 : 3) : 1) * (this.buff === 'sashimi' ? 0.85 : this.buff === 'fugu' ? 0.9 : 1)
      * (1 + Math.min(PENALTY.carryAirMax, this.carryKg * PENALTY.carryAirPerKg)) * (this.tut.step >= 0 ? 0.5 : 1);
    this.air = Math.max(0, this.air - rate * dt);
    if (this.frame % 10 === 0) this.exploreCheck(p);
    const picked = this.finds.update(this.time, p);
    if (picked) {
      this.diveFinds.push(picked);
      this.audio.chime(true);
      this.freezeT = 0.12;
      this.toast(`「${FIND_NAME[picked]}」を拾った！ 中身はボートに戻ってから開けてみよう（持って泳ぐと少し息が上がる）`, '', 3.5);
    }
    this.scenes.update(dt, this.env.night, p, this.vel.length(), this.camera.getWorldDirection(this.tmpDir), this.env.lightOn);
    const sensed = this.frame % 15 === 0 ? this.scenes.senseNear(p) : null;
    if (sensed && (!SCENES[sensed].night || this.env.night >= 0.5)) { this.audio.chime(false); this.toast(SCENES[sensed].sense, 'warn', 4); }
    if (this.tut.step >= 0) this.updateTutorial(dt);
    // the day goes on while diving: dusk, then night
    if (!this.ads) {
      this.save.clock = (this.save.clock ?? 0) + dt;
      const n = nightOf(this.save.clock);
      this.env.night = n;
      if (this.nightAnnounced === 0 && this.save.clock >= FISHING.duskAt) {
        this.nightAnnounced = 1;
        this.toast(this.hasTorch() ? '日が傾いてきた… 海が暗くなっていく' : 'ライトがない…暗くなる前に浮上しよう', 'warn', 3.5);
      } else if (this.nightAnnounced === 1 && n >= 0.5) {
        this.nightAnnounced = 2;
        this.creatures.nightFall(p);
        this.audio.chime(true);
        this.toast('夜の海になった。ライトをつけよう — 夜行性の生き物が動き出す', 'warn', 4);
      }
    }
    this.audio.breathRate = this.ads ? 0.8 : 1 + (this.air < 50 ? 0.4 : 0) + (boosting ? 0.3 : 0);
    this.diveTime += dt;
    this.diveMaxDepth = Math.max(this.diveMaxDepth, d);
    this.narc = this.ads ? 0 : clamp((d - 40) / 18, 0, 1);
    this.env.narcosis = this.narc;
    if (this.air <= 0) this.endDive('blackout');
    else if (this.air < 50 && this.time - this.lastWarn > 6) {
      this.audio.warn();
      this.toast('エア残量わずか！ すぐに浮上しよう', 'danger', 3);
      this.lastWarn = this.time;
    }

    // occasional requests (mini-games), not during the tutorial
    if (this.tut.step < 0) {
      this.missions.update(this.missionCtx());
      this.questT -= dt;
      if (this.questT <= 0) { this.questT = 0.5; this.questCheck(p); }
    }
    if (this.quick && !this.quick.started && this.diveTime > 0.6) {
      // diner urchin harvest: the urchins are right there when the diver arrives
      this.quick.started = true;
      const at = p.clone().addScaledVector(new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)), 6);
      at.y = heightAt(at.x, at.z);
      this.missions.begin('urchin', this.missionCtx(), at);
    }

    // photo target & shutter
    // sharp-photo distance: where water haze stays under ~50 % (FogExp2), shortened by narcosis
    const clear = (0.83 / this.env.fog.density) * (1 - this.narc * 0.3);
    this.lastClear = clear;
    const src = this.renderer.domElement;
    const aspect = src.width / src.height;
    const cropX = Math.min(0.62, (0.8 * 4) / (3 * aspect));
    const cropY = Math.min(0.8, (cropX * aspect * 3) / 4);
    cam.updateMatrixWorld();
    this.target = this.creatures.findTarget(cam, { clear, dark: d > 140 || this.env.night >= 0.5 || this.env.shade > 0, lightOn: this.env.lightOn, cropX, cropY, beam: this.has('light') ? 1.6 : 1, macro: this.has('macro'), wide: this.has('wide') });
    this.reload = Math.max(0, this.reload - dt);
    // the pry bar comes out when an urchin is within reach in front of the mask
    this.pryIdx = this.tool === 'camera' ? this.missions.pryTarget(p, this.tmpDir.set(0, 0, -1).applyQuaternion(cam.quaternion).clone()) : null;
    this.vmBar.visible = this.pryIdx !== null;
    this.barJab = Math.max(0, this.barJab - dt);
    this.vmBar.position.z = -0.28 - Math.sin((this.barJab / 0.25) * Math.PI) * 0.18;
    // the netted turtle: within reach the shutter button cuts; the knife then makes its strokes on its own (Phase 3)
    this.cutReady = this.tool === 'camera' && this.pryIdx === null && this.missions.cutReady(p);
    const cutK = this.missions.cutProgress();
    this.vmKnife.visible = cutK !== null || this.cutReady;
    if (cutK !== null) {
      // three diagonal slashes: raise, sweep down and across, back
      const n = MISSION.rescue.strokes, ph = (cutK * n) % 1, s = Math.sin(ph * Math.PI);
      this.vmKnife.position.set(0.16 - s * 0.14, -0.1 - s * 0.08 + (1 - s) * 0.04, -0.3 - s * 0.12);
      this.vmKnife.rotation.set(0.35 - s * 0.9, 0.1, -0.5 + s * 1.3);
      if (ph < 0.5) this.shake = Math.max(this.shake, 0.08);
    } else {
      this.vmKnife.position.set(0.15, -0.14, -0.28);
      this.vmKnife.rotation.set(0.1, 0.1, -0.3 + Math.sin(this.time * 2) * 0.03);
    }
    if (this.creatures.grab) {
      // Phase 4: while grabbed, the shutter button is the shake-free button
      if (inp.consume('shutter')) {
        const g2 = this.creatures.grab!;
        g2.taps++;
        this.audio.shutter();
        this.shake = Math.max(this.shake, 0.35);
        if (g2.taps >= g2.need) {
          this.creatures.releaseGrab(this.camera.position);
          this.toast('振りほどいた！', '', 2);
        }
      }
    } else if (this.tool === 'spear') {
      this.spearT = this.creatures.findSpearTarget(cam, this.spearTool.range);
      this.updateSpearFx(dt);
      if (inp.consume('shutter')) this.fireSpear();
    } else if (this.cutReady && inp.consume('shutter')) {
      this.missions.startCut();
      this.audio.chime(false);
    } else if (cutK !== null && inp.consume('shutter')) {
      // the strokes are already under way
    } else if (this.pryIdx !== null && inp.consume('shutter')) {
      // urchin harvest: the shutter button works the pry bar
      const fw = this.tmpDir.set(0, 0, -1).applyQuaternion(cam.quaternion);
      void fw;
      this.missions.pry(this.pryIdx, { chime: (b) => this.audio.chime(b), toast: (t, k, d) => this.toast(t, k ?? '', d), sting: (bar, text) => { this.air = Math.max(1, this.air - bar); this.shake = Math.max(this.shake, 0.7); this.audio.warn(); this.toast(text, 'danger', 2.5); } });
      this.barJab = 0.25;
      this.shake = Math.max(this.shake, 0.15);
    } else if (inp.consume('shutter')) {
      this.captureReq = this.target;
      this.audio.shutter();
      const f = $('flash');
      f.classList.remove('go');
      void f.offsetWidth;
      f.classList.add('go');
    }
  }

  /** What a request or happening needs from the dive. */
  private missionCtx(): MissionCtx {
    const p = this.camera.position;
    return {
      dt: this.lastDt, time: this.time, diveTime: this.diveTime, player: p, forward: this.tmpDir.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).clone(),
      zone: zoneAt(p.x, p.z),
      nearbySpecies: () => this.creatures.randomNear(p, 25),
      toast: (t, k, d) => this.toast(t, k ?? '', d),
      chime: (big) => this.audio.chime(big),
      nearbyBig: () => this.creatures.randomNear(p, 30, 0.8),
      aim: () => (this.target && this.target.inRange ? { id: this.target.rt.def.id, dist: this.target.dist } : null),
      stage: (id, pose) => { if (pose) this.creatures.stage.set(id, [pose]); else this.creatures.stage.delete(id); },
      companion: (id, from) => { this.creatures.stage.delete(id); this.creatures.companion = { id, p: from.clone(), v: new THREE.Vector3(), yaw: this.yaw }; },
      sting: (bar, text) => { this.air = Math.max(1, this.air - bar); this.shake = Math.max(this.shake, 0.7); this.audio.warn(); this.toast(text, 'danger', 2.5); },
      reward: (v, label) => { this.bonuses.push({ label: label === '網に絡まったウミガメ' ? 'ウミガメを助けた（漁協からお礼）' : `依頼達成：${label}`, value: v }); this.shake = Math.max(this.shake, 0.4); this.freezeT = 0.15; this.updateDexChip(); },
    };
  }

  /** weight carried: the catch and anything picked up */
  private get carryKg(): number {
    return this.bagKg + this.diveFinds.length * FINDS.kg;
  }

  /**
   * Reaching a place while diving makes it a dive point the boat can go to. Phase 3: the first time the diver is
   * actually in a map (even one known only from a chart, and the deep sea) always gets its own banner (never a toast,
   * which the next toast would overwrite).
   */
  private exploreCheck(p: THREE.Vector3): void {
    const z = zoneAt(p.x, p.z);
    const id = z === 'offshore' ? 'dropoff' : z;
    const dp = DIVE_POINTS.find((d) => d.id === id);
    if (!dp) return;
    const fromChart = this.discovered.has(id);
    if (!this.ads && id !== 'deep') this.discover(id, 'swim');
    const v = (this.save.visited ??= ['lagoon']);
    if (v.includes(id)) return;
    v.push(id);
    this.writeSave();
    this.audio.chime(true);
    this.mapFoundQ.push({ name: dp.name, sub: fromChart ? '海図で知っていた場所に、はじめて来た' : id === 'deep' ? '大気圧潜水服で来られる場所' : '次からボートで直接行ける' });
  }

  /** banners waiting to be shown, and how long the current one stays */
  private mapFoundQ: { name: string; sub: string }[] = [];
  private mapFoundT = 0;
  private updateMapFound(dt: number): void {
    if (this.mapFoundT > 0) {
      this.mapFoundT -= dt;
      if (this.mapFoundT <= 0) $('map-found').classList.add('hidden');
      return;
    }
    const n = this.mapFoundQ.shift();
    if (!n) return;
    $('mf-name').textContent = `「${n.name}」`;
    $('mf-sub').textContent = n.sub;
    const el = $('map-found');
    el.classList.remove('hidden');
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = '';
    this.mapFoundT = 3.8;
  }

  // ------------------------------------------------------------------ tutorial
  private updateTutorial(dt: number): void {
    const T = this.tut;
    const step = TUTORIAL[T.step];
    if (!step) return;
    const p = this.camera.position;
    T.moved = Math.max(T.moved, Math.hypot(p.x - T.from.x, p.z - T.from.z));
    if (T.praise > 0) {
      T.praise -= dt;
      if (T.praise <= 0) {
        T.step++;
        T.t = 0;
        T.down = 0;
        T.depth0 = -p.y;
        T.repeat = 0;
        if (T.step >= TUTORIAL.length) { this.endTutorial(); return; }
        this.showCoach();
      }
      return;
    }
    T.t += dt;
    if (this.input.down) T.down += dt;
    const ctx = { moved: T.moved, looked: T.looked, depth: -p.y, depth0: T.depth0, down: T.down, repeat: T.repeat, airShown: T.t, shots: [...this.pending.values()].length, species: this.pending.size, surfaceNear: this.canSurface(), t: T.t, alt: p.y - heightAt(p.x, p.z) };
    this.showCoach();
    if (step.done(ctx)) {
      T.praise = 1.4;
      $('coach').classList.add('praise');
      $('coach-text').textContent = step.praise;
      this.audio.chime(false);
    }
  }

  private showCoach(): void {
    const T = this.tut;
    const step = TUTORIAL[T.step];
    if (!step || T.praise > 0) return;
    $('coach').classList.remove('praise', 'hidden');
    $('coach-step').textContent = `チュートリアル ${T.step + 1}/${TUTORIAL.length}`;
    if ($('coach-text').textContent !== step.text) $('coach-text').textContent = step.text;
    $('hud').classList.toggle('hl-air', step.hl === 'air');
    $('hud').classList.toggle('hl-surface', step.hl === 'surface');
  }

  private endTutorial(): void {
    this.tut.step = -1;
    this.save.tutorial = true;
    this.writeSave();
    $('coach').classList.add('hidden');
    $('hud').classList.remove('hl-air', 'hl-surface');
  }

  // ------------------------------------------------------------------ spearfishing
  private get spearTool() {
    return this.has('powerhead') ? FISHING.tools.big : this.has('speargun') ? FISHING.tools.gun : FISHING.tools.hand;
  }
  private get bagCap(): number {
    return FISHING.bag[this.has('bigcooler') ? 2 : this.has('cooler') ? 1 : 0];
  }
  private get bagKg(): number {
    return this.diveCatch.reduce((a, c) => a + c.kg, 0);
  }

  private setTool(t: 'camera' | 'spear'): void {
    this.tool = t;
    $('hud').classList.toggle('spear', t === 'spear');
    $('tool-label').textContent = t === 'spear' ? 'カメラ' : '銛';
    $('btn-shutter').setAttribute('aria-label', t === 'spear' ? '銛を突く' : 'シャッター');
    if (t === 'spear' && !this.diveCatch.length && !this.save.cooler?.length) this.toast(`${this.spearTool.name}に持ち替えた。魚に${this.spearTool.range}mまで近づいて突こう`, '', 3);
    this.spearFx.visible = false;
    const gun = this.has('speargun') || this.has('powerhead');
    this.vmHand.visible = t === 'spear' && !gun;
    this.vmGun.visible = t === 'spear' && gun;
    this.vmGunShaft.visible = true;
    this.vmHand.position.z = -0.28;
  }

  /** Why the current spear target cannot be taken, or null if it can. */
  private spearBlock(t: NonNullable<Game['spearT']>): string | null {
    const def = t.rt.def;
    const e = edibleInfo(def);
    if (!e.ok) return e.reason;
    const kg = weightOf(def, t.agent.s);
    const T = this.spearTool;
    if (e.shark && !this.has('powerhead')) return 'サメは手強い。大物用の水中銃でないと歯が立たない';
    if (kg < FISHING.minKg) return '小さすぎる。逃がしてあげよう';
    if (kg > T.maxKg) return `${fmtKg(kg)}の大物。${T.name}では仕留めきれない`;
    if (this.bagKg + kg > this.bagCap) return `クーラーに入らない（あと${fmtKg(Math.max(0, this.bagCap - this.bagKg))}）`;
    if (t.dist > T.range) return `届かない — あと${(t.dist - T.range).toFixed(1)}m近づく`;
    return null;
  }

  /** What the diner taught: shown for species the player has identified (photographed) before. */
  private spearWarn(t: NonNullable<Game['spearT']>): string {
    const def = t.rt.def;
    if (!this.save.found[def.id] && !this.pending.has(def.id)) return '';
    const e = edibleInfo(def);
    if (!e.ok) return '';
    if (e.protected) return '　<span class="gC">獲ってはいけない生き物</span>';
    if (e.poison && this.has('fugulicense') && isFugu(def)) return '　<span class="gA">ふぐ：免許でさばける</span>';
    return '';
  }

  private hitChance(t: NonNullable<Game['spearT']>): number {
    const T = this.spearTool;
    const p = 0.95 - (t.ang / 0.3) * 0.4 - (t.dist / T.range) * 0.3 - Math.min(1, t.speed) * 0.3 + (this.buff === 'karaage' ? 0.15 : 0);
    return clamp(p, 0.05, 0.95);
  }

  private fireSpear(): void {
    if (this.reload > 0) return;
    const T = this.spearTool;
    const cam = this.camera;
    const t = this.spearT;
    const fwd = this.tmpDir.set(0, 0, -1).applyQuaternion(cam.quaternion);
    this.spearTo.copy(cam.position).addScaledVector(fwd, T.range);
    this.spearAnim = 0;
    this.reload = T.reload;
    this.audio.shutter();
    if (!t) return;
    const block = this.spearBlock(t);
    if (block) { this.toast(block, 'warn'); this.reload = 0.4; this.spearAnim = -1; return; }
    this.spearTo.copy(t.agent.p);
    const def = t.rt.def;
    if (Math.random() > this.hitChance(t)) {
      this.creatures.startle(t.agent, cam.position);
      this.toast('外れた… 魚が逃げていく', 'warn', 1.6);
      return;
    }
    const kg = weightOf(def, t.agent.s);
    this.creatures.take(t.rt, t.agent, cam.position);
    this.diveCatch.push({ id: def.id, kg });
    // hauling the fish in on the line and holding it while it struggles costs breath
    const haul = PENALTY.haulBar + kg * PENALTY.haulBarPerKg;
    this.air = Math.max(1, this.air - haul);
    const known = !!this.save.found[def.id] || this.pending.has(def.id);
    this.toast(`${known ? def.name : '見たことのない魚'}を獲った！ ${fmtKg(kg)}${kg >= BIG_KG ? '　大物だ！' : ''}（引き寄せてエア -${Math.round(haul)}）`, '', 2.8);
    this.audio.chime(kg >= BIG_KG);
    this.freezeT = kg >= BIG_KG ? 0.22 : 0.12;
    this.shake = Math.max(this.shake, kg >= BIG_KG ? 0.6 : 0.3);
    // blood in the water: sharks nearby may come to see
    if (this.creatures.bloodIn(cam.position, FISHING.bloodRange, FISHING.bloodChance) > 0) {
      window.setTimeout(() => { if (this.state === 'diving') this.toast('血の匂いでサメが寄ってきた！', 'danger', 3); }, 1200);
    }
  }

  /** Thrust of the hand spear / flight of the gun's shaft and its retrieval on the line. */
  private updateSpearFx(dt: number): void {
    const fx = this.spearFx;
    if (this.spearAnim < 0) { fx.visible = false; this.vmGunShaft.visible = true; this.vmHand.position.z = -0.28; return; }
    this.spearAnim += dt;
    const cam = this.camera;
    const out = this.spearAnim < 0.1 ? this.spearAnim / 0.1 : Math.max(0, 1 - (this.spearAnim - 0.2) / 0.4);
    if (this.vmHand.visible) {
      // the sling launches the whole spear forward along the aim line, then the hand pulls it back
      const reach = Math.min(this.spearTool.range, this.spearTo.distanceTo(cam.position) + 0.2);
      this.vmHand.position.z = -0.28 - reach * out;
      fx.visible = false;
    } else {
      const from = this.tmpDir.set(0.14, -0.12, -1.0).applyQuaternion(cam.quaternion).add(cam.position);
      const len = from.distanceTo(this.spearTo) * out;
      fx.visible = len > 0.05;
      this.vmGunShaft.visible = !fx.visible;
      fx.position.copy(from);
      fx.lookAt(this.spearTo);
      fx.rotateY(Math.PI);
      fx.scale.set(1, 1, Math.max(0.01, len));
    }
    if (this.spearAnim > 0.65) this.spearAnim = -1;
  }

  private canSurface(): boolean {
    return this.surfaceAnywhere() || this.camera.position.y > -1.6;
  }

  /** The ADS is winched up, and the signal float calls the boat: both surface from anywhere. */
  private surfaceAnywhere(): boolean {
    return this.ads || this.has('float');
  }

  private takePhoto(t: PhotoTarget | null): void {
    // capture center crop of the freshly rendered frame
    const src = this.renderer.domElement;
    const pc = this.photoCanvas;
    const ctx = pc.getContext('2d')!;
    const aspect = pc.width / pc.height;
    let sw = src.width * 0.62;
    let sh = sw / aspect;
    if (sh > src.height * 0.8) {
      sh = src.height * 0.8;
      sw = sh * aspect;
    }
    ctx.drawImage(src, (src.width - sw) / 2, (src.height - sh) / 2, sw, sh, 0, 0, pc.width, pc.height);
    const photo = pc.toDataURL('image/jpeg', 0.72);
    this.diveShots++;
    // special sights: the sleeping whales (any in-range shot of a staged one) or coral spawn filling the lens
    const particle = this.scenes.particlesInView(this.camera);
    const staged = t && t.inRange ? this.scenes.sceneOf(t.rt.def.id, t.rt.agents.indexOf(t.agent)) : null;
    if (particle) this.sceneShot(particle, photo);
    else if (staged) this.sceneShot(staged, photo);
    const spot = particle || staged ? false : this.spotShot(photo, !!t && t.inRange);
    if (!t) {
      if (!this.pendingScenes.size && !spot) this.toast('何も写っていない…');
      return;
    }
    const def = t.rt.def;
    if (!t.inRange) {
      if (spot) return;
      const msg: Record<string, string> = { small: '小さすぎて写っていない — もっと近づこう', murky: '濁りで霞んでしまった — もっと近づこう', dark: '暗くて写らなかった — ライトで照らそう', hidden: '岩陰に隠れて写らなかった', ok: '' };
      this.toast(msg[t.reason], 'warn');
      return;
    }
    const known = !!this.save.found[def.id];
    const depth = -t.agent.p.y;
    const ev = evaluateShot(t, this.lastClear, depth, this.currentF > 0.2, this.env.night >= 0.5);
    // the editor's advice while the chapter asks for an S (Phase 3)
    if (this.chapter?.tips && this.tut.step < 0) {
      const tip = sAdvice(ev);
      this.toast(tip ? `Sまであと少し！ ${tip}` : '編集長「これがSだ！」', tip ? 'warn' : '', 3);
    }
    this.missions.onPhoto(def.id, ev.grade.g);
    this.questPhoto(def.id, ev.grade.g, zoneAt(this.camera.position.x, this.camera.position.z));
    // a known species pays a share unless this beats the best photo on record
    const best = this.save.found[def.id]?.score ?? -1;
    const value = known && ev.score <= best ? Math.round((ev.value * PHOTO.repeatShare) / 10) * 10 : ev.value;
    const prev = this.pending.get(def.id);
    if (prev && this.tut.step >= 0) this.tut.repeat++;
    // one sale per species per dive (PHOTO.oncePerDive): the first shot's value is final; a later, better shot only
    // upgrades the photo kept in the dex. Diving again resets it (pending is cleared at the start of a dive).
    const shot: Shot = { photo, depth, score: ev.score, grade: ev.grade.g, value, isNew: !known };
    let record = known && ev.score > best && best >= 0;
    if (!prev) this.pending.set(def.id, shot);
    else if (ev.score > prev.score) { this.pending.set(def.id, { ...shot, value: prev.value, isNew: prev.isNew }); record = true; }
    this.showDiscover(def.id, photo, !known && !prev, ev, prev ? 0 : value, prev, record);
    if (!known && !prev) this.audio.chime(def.rarity >= 3);
    else if (ev.grade.g === 'S') this.audio.chime(true);
    this.updateDexChip();
    // hit-stop + small kick: the shot "lands"
    this.freezeT = ev.grade.g === 'S' ? 0.2 : ev.grade.g === 'A' ? 0.13 : 0.07;
    this.shake = Math.max(this.shake, ev.grade.g === 'S' ? 0.5 : 0.25);
  }

  private sceneShot(id: SceneId, photo: string): void {
    if (this.pendingScenes.has(id)) return;
    const first = !this.save.scenes?.[id];
    // Phase 3: the first photo of a sight is an achievement (1/3); repeats stay small (1/7 × repeatShare)
    const pay = Math.round((first ? SCENES[id].pay * PHOTO.sceneFirstShare : SCENES[id].pay * PHOTO.sceneShare * PHOTO.repeatShare) / 10) * 10;
    this.pendingScenes.set(id, { photo, pay });
    this.bonuses.push({ label: `特別な光景「${SCENES[id].name}」`, value: pay });
    this.updateDexChip();
    this.audio.chime(true);
    this.freezeT = 0.3;
    this.shake = Math.max(this.shake, 0.5);
    const el = $('discover');
    el.classList.remove('hidden', 'known');
    ($('disc-photo') as HTMLImageElement).src = photo;
    $('disc-tag').textContent = first ? '実績解除！ 特別な光景' : '特別な光景';
    $('disc-name').textContent = SCENES[id].name;
    $('disc-sci').textContent = first ? 'めったに見られない瞬間を撮った！' : 'また出会えた！';
    $('disc-pay').textContent = `+${yen(pay)}`;
    $('disc-grade').classList.add('hidden');
    this.discoverTimer = 4.5;
  }

  /** Circles for the sights of this dive: the staged one from the start, lucky ones once sensed; gone once photographed. */
  private sceneMarks(): { x: number; z: number; rare: boolean; r: number }[] {
    const out: { x: number; z: number; rare: boolean; r: number }[] = [];
    for (const [id, c] of this.scenes.centre) {
      if (!this.scenes.active.has(id) || this.pendingScenes.has(id)) continue;
      if (id !== this.stagedScene && !this.scenes.sensed.has(id)) continue;
      out.push({ x: c.x, z: c.z, rare: true, r: SCENE_AT[id]?.r ?? 30 });
    }
    return out;
  }

  /** Aqua circles for the photo spots not yet shot, on known maps only. */
  private spotMarks(): { x: number; z: number; rare: boolean; r: number; spot: boolean }[] {
    const known = this.discovered;
    const done = new Set([...(this.save.spots ?? []), ...this.pendingSpots]);
    return SPOTS.filter((s) => !done.has(s.id) && (known.has(s.point) || (s.point === 'deep' && this.ads))).map((s) => ({ x: s.x, z: s.z, rare: false, r: s.r ?? SPOT.r, spot: true }));
  }

  /** A shot framing a photo spot: pays once, the first time (Phase 3). Returns whether a spot was in the frame. */
  private spotShot(photo: string, creature: boolean): boolean {
    if (this.tut.step >= 0) return false;
    const s = spotInView(this.camera);
    if (!s) return false;
    if (this.save.spots?.includes(s.id) || this.pendingSpots.has(s.id)) {
      if (!creature) this.toast(`撮影済みの写真スポット「${s.name}」（報酬は最初の1回だけ）`, '', 2.2);
      return true;
    }
    this.pendingSpots.add(s.id);
    this.bonuses.push({ label: `写真スポット「${s.name}」`, value: s.pay });
    this.updateDexChip();
    this.audio.chime(true);
    if (creature) { this.toast(`写真スポット「${s.name}」も撮れた！ +${yen(s.pay)}（浮上すると受け取れる）`, '', 3.2); return true; }
    this.freezeT = 0.2;
    const el = $('discover');
    el.classList.remove('hidden', 'known');
    ($('disc-photo') as HTMLImageElement).src = photo;
    $('disc-tag').textContent = '写真スポット';
    $('disc-name').textContent = s.name;
    $('disc-sci').textContent = s.desc;
    $('disc-pay').textContent = `+${yen(s.pay)}`;
    $('disc-grade').classList.add('hidden');
    this.discoverTimer = 4;
    return true;
  }

  private showDiscover(id: string, photo: string, isNew: boolean, ev?: ReturnType<typeof evaluateShot>, paid = 0, better?: Shot, record = false): void {
    const s = SPECIES_BY_ID.get(id)!;
    const el = $('discover');
    el.classList.remove('hidden');
    el.classList.toggle('known', !isNew);
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = '';
    $<HTMLImageElement>('disc-photo').src = photo;
    $('disc-tag').textContent = isNew ? (s.rarity >= 4 ? '◆ 伝説の生き物を発見！！' : s.rarity >= 3 ? '★ 激レア発見！' : '新種発見！') : record ? '自己ベスト更新！' : '撮影成功（登録済み）';
    const gEl = $('disc-grade');
    if (ev) {
      gEl.className = 'disc-grade g' + ev.grade.g;
      gEl.innerHTML = `<b>${ev.grade.g}</b><span>${ev.grade.word}</span>`;
      gEl.classList.remove('hidden');
      $('disc-pay').textContent = paid > 0 ? `+${yen(paid)}${ev.bonus.length ? '　' + ev.bonus.join(' ') : ''}` : better ? '売上済み（1ダイブ1種1回）' : '';
    } else gEl.classList.add('hidden');
    $('disc-name').textContent = s.name;
    $('disc-sci').textContent = s.sci;
    this.discoverTimer = isNew ? 4.5 : 2.5;
  }

  private updateHud(dt: number): void {
    const p = this.camera.position;
    const d = Math.max(0, -p.y);
    $('depth-value').textContent = d.toFixed(1);
    $('max-depth').textContent = this.diveMaxDepth.toFixed(0);
    $('zone-name').textContent = ZONE_NAMES[zoneAt(p.x, p.z)];
    const hdg = ((-this.yaw * 180) / Math.PI + 180 + 720) % 360; // 0 = offshore(+z)
    const dirs = ['沖', '沖東', '東', '岸東', '岸', '岸西', '西', '沖西'];
    $('heading').textContent = `${dirs[Math.round(hdg / 45) % 8]} ${Math.round(hdg)}°`;
    $('depth-warn').classList.toggle('hidden', this.ads || (d < 40 && this.currentF < 0.1 && !this.cold));
    $('depth-warn').textContent = this.currentF >= 0.1 ? 'ダウンカレント' : this.cold ? '低水温' : d > 52 ? '限界深度に接近' : '窒素酔い注意';
    const frac = this.air / this.airMax;
    $('air-value').textContent = String(Math.ceil(this.air));
    $('air-ring').style.strokeDashoffset = String(169.6 * (1 - frac));
    const air = $('air');
    air.classList.toggle('low', frac < 0.35 && this.air >= 50);
    air.classList.toggle('crit', this.air < 50);
    $('narc').style.opacity = String(this.narc * 0.8);
    if (this.minimap && this.frame % 10 === 0) {
      if (this.has('sonar') && this.frame % 20 === 0) this.sonarBlips = this.creatures.sonar(p, 45, (id) => !!this.save.found[id] || this.pending.has(id));
      this.minimap.blips = [...(this.has('sonar') ? this.sonarBlips : []), ...this.missions.marks(), ...this.sceneMarks(), ...this.spotMarks(), ...(this.save.quests ?? []).filter((q) => q.kind !== 'photo' && q.id !== this.activeQuest).map((q) => ({ x: q.x, z: q.z, rare: true, r: QUEST.arrive }))];
    }
    this.minimap?.update(p.x, p.z, this.yaw, this.boatPos());
    if (this.minimap?.open && this.frame % 6 === 0) this.minimap.drawBig(p.x, p.z, this.yaw, this.boatPos());

    this.refreshBaitUi();
    const sb = $('surface-btn');
    const can = this.canSurface();
    sb.classList.toggle('hidden', !can);
    $('surface-text').textContent = this.ads ? 'ウインチで回収してもらう' : '浮上してボートに戻る';

    // reticle
    const ret = $('reticle');
    const lab = $('ret-label');
    const t = this.target;
    const cc = $('catch-chip');
    cc.classList.toggle('hidden', this.tool !== 'spear' && !this.diveCatch.length);
    $('catch-val').textContent = `${this.bagKg.toFixed(1)}/${this.bagCap}kg`;
    cc.classList.toggle('full', this.bagKg >= this.bagCap - 0.05);
    $('btn-shutter').classList.toggle('reload', this.tool === 'spear' && this.reload > 0);
    if (this.creatures.grab) {
      const g = this.creatures.grab;
      ret.classList.add('lock');
      ret.classList.remove('far');
      lab.innerHTML = `${g.rt.def.name}に絡まれた！<small>シャッター連打で振りほどく（あと${Math.max(0, g.need - g.taps)}回）</small>`;
      $('btn-shutter').classList.add('ready');
      return this.updateToasts(dt);
    }
    if (this.cutReady || this.missions.cutProgress() !== null) {
      ret.classList.add('lock');
      ret.classList.remove('far');
      lab.innerHTML = `網に絡まったウミガメ<small>${this.cutReady ? 'タップで網を切る' : 'ナイフで網を切っている…'}</small>`;
      $('btn-shutter').classList.toggle('ready', this.cutReady);
      return this.updateToasts(dt);
    }
    if (this.pryIdx !== null) {
      ret.classList.add('lock');
      ret.classList.remove('far');
      lab.innerHTML = `ウニ<small>バールではがす（あと${this.missions.pryLeft(this.pryIdx)}回押す）</small>`;
      $('btn-shutter').classList.add('ready');
      return this.updateToasts(dt);
    }
    if (this.tool === 'spear') {
      const st = this.spearT;
      const block = st ? this.spearBlock(st) : null;
      ret.classList.toggle('lock', !!st && !block);
      ret.classList.toggle('far', !!st && !!block);
      $('btn-shutter').classList.toggle('ready', !!st && !block && this.reload <= 0);
      if (st) {
        const def = st.rt.def;
        const known = this.save.found[def.id] || this.pending.has(def.id);
        const kg = weightOf(def, st.agent.s);
        const sub = (block ?? `<span class="gA">命中 ${Math.round(this.hitChance(st) * 100)}%</span>　約${fmtKg(kg)}${st.speed > 0.6 ? '　動きが速い' : st.ang > 0.12 ? '　中心で狙う↑' : ''}`) + this.spearWarn(st);
        lab.innerHTML = `${known ? def.name : '？？？'}<small>${sub}</small>`;
      } else lab.innerHTML = `<small>${this.spearTool.name}（射程${this.spearTool.range}m）— 魚に近づいて中央で狙う</small>`;
      return this.updateToasts(dt);
    }
    ret.classList.toggle('lock', !!t && t.inRange);
    ret.classList.toggle('far', !!t && !t.inRange);
    $('btn-shutter').classList.toggle('ready', !!t && t.inRange && !this.save.found[t.rt.def.id] && !this.pending.has(t.rt.def.id));
    if (t) {
      const known = this.save.found[t.rt.def.id] || this.pending.has(t.rt.def.id);
      const why: Record<string, string> = { small: '小さすぎる・もっと近づく', murky: '濁って霞んでいる・近づく', dark: '暗くて写らない・ライトで照らす', hidden: '岩陰に隠れている', ok: '' };
      let sub = why[t.reason];
      if (t.inRange) {
        // live grade: the player sees closer / side-on / centred pays more before pressing the shutter
        const ev = evaluateShot(t, this.lastClear, -t.agent.p.y, this.currentF > 0.2, this.env.night >= 0.5);
        const hint = t.fit < 0.99 ? 'はみ出している・少し離れる' : t.fill > PHOTO.fillMax ? '近すぎ・少し離れる' : t.side < 0.6 ? '横から狙うと↑' : t.frac < 0.2 ? '寄ると↑' : t.centred < 0.6 ? '中央で↑' : '';
        sub = `<span class="g${ev.grade.g}">評価 ${ev.grade.g}</span>${t.danger ? ' <span class="gS">危険手当！</span>' : ''}${hint ? '　' + hint : ''}`;
      }
      lab.innerHTML = `${known ? t.rt.def.name : '？？？'}<small>${sub}</small>`;
    } else lab.textContent = '';
    this.updateToasts(dt);
  }

  private updateToasts(dt: number): void {
    this.updateMapFound(dt);
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) $('toast').className = '';
    }
    if (this.discoverTimer > 0) {
      this.discoverTimer -= dt;
      if (this.discoverTimer <= 0) $('discover').classList.add('hidden');
    }
  }

  private tick(): void {
    const rawDt = this.clock.getDelta();
    let dt = Math.min(rawDt, 0.05);
    if (this.freezeT > 0) { this.freezeT -= rawDt; dt = 0; }
    this.frame++;
    if (this.frame <= 6) ((window as unknown as Record<string, Record<string, number>>).__BOOT_MS__)['f' + this.frame] = Math.round(rawDt * 1000);
    // adaptive resolution
    this.frameAvg = lerp(this.frameAvg, rawDt * 1000, 0.05);
    if (this.frame % 90 === 0) {
      const dpr = this.renderer.getPixelRatio();
      if (this.frameAvg > 38 && dpr > 0.8) this.renderer.setPixelRatio(Math.max(0.75, dpr - 0.25));
      else if (this.frameAvg < 20 && dpr < Math.min(devicePixelRatio, this.dprCap)) this.renderer.setPixelRatio(Math.min(this.dprCap, dpr + 0.25));
    }
    if (!this.paused) this.time += dt;

    if (this.state === 'title' || this.state === 'result' || (this.state === 'dex' && this.stateBeforeDex === 'title')) {
      this.titleT += dt;
      this.titleCamera(this.titleT);
    } else if (this.state === 'diving' && !this.paused) {
      this.updateDiver(dt);
    }
    const cp = this.camera.position;
    this.terrain.update(cp.x, cp.z, this.terrain.radius, this.state === 'diving' ? 1 : 2);
    if (!this.paused || this.state === 'title') {
      this.creatures.lightOn = this.env.lightOn;
      this.creatures.update(dt, cp, this.vel, this.camera.getWorldDirection(this.tmpDir));
    }
    if (this.state === 'diving' && !this.paused) this.updateBaitVisual(dt);
    this.flora.update(cp, this.time);
    this.env.update(dt, this.camera, this.renderer, this.time);
    // image-based fill only adds sheen near the surface; it must not flatten the sun/shade contrast
    this.scene.environmentIntensity = (0.22 * Math.exp(Math.min(0, this.camera.position.y) / 25) + 0.01) * (1 - this.env.darkness * 0.95);
    if (this.state === 'diving' && !this.paused) this.updateHud(dt);
    else this.updateToasts(rawDt);

    // ambience
    const reefNear = ['reef', 'rocky', 'lagoon'].includes(zoneAt(cp.x, cp.z)) ? clamp(1 - -cp.y / 40, 0, 1) * 0.25 : 0;
    const whale = clamp(1 - this.creatures.nearestOf('humpback', cp) / 160, 0, 1);
    const deep = clamp((-cp.y - 120) / 150, 0, 1);
    this.audio.update(dt, { diving: this.state === 'diving' && !this.paused, depth: -cp.y, reef: this.state === 'diving' ? reefNear : reefNear * 0.4, whale, deep, air: this.air });

    this.renderer.render(this.scene, this.camera);
    if (this.captureReq !== undefined) {
      const t = this.captureReq;
      this.captureReq = undefined;
      this.takePhoto(t);
    }
    this.publishDiagnostics();
  }

  // ------------------------------------------------------------------ test hooks
  private publishDiagnostics(): void {
    if (this.frame % 10 !== 0) return;
    const info = this.renderer.info;
    const c = this.renderer.domElement;
    (window as unknown as Record<string, unknown>).__THREE_GAME_DIAGNOSTICS__ = {
      frame: this.frame,
      elapsed: this.time,
      state: this.state,
      score: this.foundCount,
      targetScore: SPECIES.length,
      complete: this.foundCount >= SPECIES.length,
      air: this.air,
      depth: -this.camera.position.y,
      target: this.target ? { id: this.target.rt.def.id, inRange: this.target.inRange, dist: this.target.dist } : null,
      pending: [...this.pending.keys()],
      player: { position: { x: this.camera.position.x, y: this.camera.position.y, z: this.camera.position.z }, speed: this.vel.length() },
      renderer: { calls: info.render.calls, triangles: info.render.triangles, geometries: info.memory.geometries, textures: info.memory.textures, programs: info.programs?.length ?? 0 },
      creatures: this.creatures.stats(),
      flora: this.flora.instanceCount,
      frameMs: this.frameAvg,
      canvas: { clientWidth: c.clientWidth, clientHeight: c.clientHeight, width: c.width, height: c.height, dpr: this.renderer.getPixelRatio() },
    };
  }

  private installHooks(): void {
    const places: Record<string, { x: number; y: number; z: number; yaw: number; pitch: number; light?: boolean }> = {
      lagoon: { x: 22, y: -3.2, z: 64, yaw: Math.PI * 0.85, pitch: -0.2 },
      reef: { x: -30, y: -6.5, z: 230, yaw: Math.PI, pitch: -0.25 },
      reefdown: { x: -24, y: -5.5, z: 236, yaw: Math.PI * 0.8, pitch: -0.75 },
      rocky: { x: 118, y: -9, z: 232, yaw: Math.PI, pitch: -0.1 },
      wall: { x: 0, y: -16, z: 330, yaw: Math.PI, pitch: -0.45 },
      wreck: { x: WRECK.x - 12, y: -32, z: WRECK.z - 22, yaw: Math.PI * 0.85, pitch: -0.3 },
      offshore: { x: 0, y: -12, z: 520, yaw: Math.PI, pitch: 0.05 },
      cold: { x: -300, y: -7, z: 170, yaw: Math.PI * 0.9, pitch: -0.2 },
      ruins: { x: -330, y: -12, z: 445, yaw: Math.PI, pitch: -0.15 },
      bluehole: { x: -330, y: -9, z: 652, yaw: Math.PI, pitch: -0.45 },
      cave: { x: -326, y: -20, z: 856, yaw: Math.PI * 0.82, pitch: -0.05 },
      kelp: { x: 330, y: -8, z: 150, yaw: Math.PI, pitch: 0.1 },
      surface: { x: 0, y: -4, z: 480, yaw: Math.PI, pitch: 0.75 },
      deep: { x: VENT.x - 14, y: heightAt(VENT.x - 14, VENT.z - 22) + 6, z: VENT.z - 22, yaw: Math.PI * 0.8, pitch: -0.15, light: true },
    };
    (window as unknown as Record<string, unknown>).__THREE_GAME_TEST_HOOKS__ = {
      game: this,
      offerMission: () => { this.missions.forceOffer = true; },
      /** Phase 3: photo spots with their focus points */
      spots: () => SPOTS.map((sp) => { const f = spotFocus(sp); return { id: sp.id, x: f.x, y: f.y, z: f.z, r: sp.r ?? SPOT.r }; }),
      startMission: (k: 'urchin' | 'trash' | 'photo' | 'lost' | 'treasure' | 'rescue' | 'survey' | 'tag') => { this.missions.force = k; },
      currents: () => this.currents,
      currentF: () => this.currentF,
      showcase: (id: string, dist = 2, side = 1) => {
        const cam = this.camera;
        cam.updateMatrixWorld();
        const f = new THREE.Vector3();
        cam.getWorldDirection(f);
        const pos = cam.position.clone().addScaledVector(f, dist);
        const rt = this.creatures.list.find((r) => r.def.id === id);
        if (rt) rt.active = true;
        this.creatures.pin = { id, p: pos, yaw: Math.atan2(f.x, f.z) + (side * Math.PI) / 2 };
        return !!rt;
      },
      seed: () => undefined,
      setState: (name: string) => {
        if (name === 'title') {
          this.toTitle();
          return { state: name };
        }
        if (name === 'dex') {
          this.openDex();
          return { state: name };
        }
        const pl = places[name];
        if (!pl) throw new Error('unknown state ' + name);
        if (this.state !== 'diving' || (name === 'deep') !== this.ads) {
          this.state = 'title';
          this.startDive(name === 'deep' ? DIVE_POINTS[4] : DIVE_POINTS[1]);
          return new Promise((res) => window.setTimeout(() => res(this.applyPlace(pl, name)), 900));
        }
        return this.applyPlace(pl, name);
      },
      setPausedForScreenshot: (p: boolean) => {
        this.paused = p;
      },
      setReducedMotion: (v: boolean) => {
        this.reducedMotion = v;
      },
      hideDebugUi: () => undefined,
      look: (yaw: number, pitch: number) => {
        this.yaw = yaw;
        this.pitch = pitch;
      },
      teleport: (x: number, y: number, z: number) => {
        this.camera.position.set(x, y, z);
        this.terrain.prime(x, z, 80);
      },
      findSpecies: (id: string) => {
        const rt = this.creatures.list.find((r) => r.def.id === id);
        const a = rt?.agents[0];
        if (!a) return null;
        const f = new THREE.Vector3(0, 0, 1).applyQuaternion(a.q);
        return { x: a.p.x, y: a.p.y, z: a.p.z, fx: f.x, fz: f.z, s: a.s };
      },
      triReport: () => {
        const out: Record<string, number> = {};
        this.scene.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh || !m.visible) return;
          let vis = true;
          o.traverseAncestors((a) => { if (!a.visible) vis = false; });
          if (!vis) return;
          const g = m.geometry;
          const tris = (g.index ? g.index.count : g.attributes.position.count) / 3;
          const n = (m as unknown as THREE.InstancedMesh).isInstancedMesh ? (m as unknown as THREE.InstancedMesh).count : 1;
          const key = (m.material as THREE.Material & { customProgramCacheKey?: () => string }).customProgramCacheKey?.() ?? m.name ?? 'mesh';
          out[key] = (out[key] ?? 0) + tris * n;
        });
        return out;
      },
      portrait: (id: string) => {
        const rt = this.creatures.list.find((r) => r.def.id === id);
        if (!rt || !rt.agents.length) return false;
        const a = rt.agents[0];
        this.paused = false;
        const s = rt.def.size;
        const d = Math.max(0.35, s * 1.6);
        // side view: camera to the fish's right
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(a.q);
        const cx = a.p.x + right.x * d, cy = a.p.y + s * 0.15, cz = a.p.z + right.z * d;
        this.camera.position.set(cx, cy, cz);
        this.terrain.prime(cx, cz, 40);
        const dx = a.p.x - cx, dy = a.p.y - cy, dz = a.p.z - cz;
        this.yaw = Math.atan2(-dx, -dz);
        this.pitch = Math.atan2(dy, Math.hypot(dx, dz));
        this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
        this.camera.updateMatrixWorld();
        this.creatures.update(0, this.camera.position, this.vel, this.camera.getWorldDirection(this.tmpDir));
        this.paused = true;
        return true;
      },
      aimAt: (id: string) => {
        const rt = this.creatures.list.find((r) => r.def.id === id);
        const a = rt?.agents[0];
        if (!a) return false;
        const c = this.camera.position;
        const dx = a.p.x - c.x, dy = a.p.y - c.y, dz = a.p.z - c.z;
        this.yaw = Math.atan2(-dx, -dz);
        this.pitch = Math.atan2(dy, Math.hypot(dx, dz));
        return true;
      },
      shadowInfo: () => {
        const sh = this.env.sun.shadow;
        return { map: !!sh.map, size: sh.mapSize.x, int: sh.intensity, en: this.renderer.shadowMap.enabled, pos: this.env.sun.position.toArray().map((v) => Math.round(v)), tgt: this.env.sun.target.position.toArray().map((v) => Math.round(v)), sunI: this.env.sun.intensity, hemi: this.env.hemi.intensity };
      },
      probe: (id: string, dist: number) => {
        const rt = this.creatures.list.find((r) => r.def.id === id);
        const a = rt?.agents[0];
        if (!a) return null;
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(a.q);
        this.camera.position.set(a.p.x + right.x * dist, a.p.y + 0.05, a.p.z + right.z * dist);
        this.yaw = Math.atan2(right.x, right.z);
        this.pitch = 0;
        this.camera.rotation.set(0, this.yaw, 0, 'YXZ');
        this.camera.updateMatrixWorld();
        this.creatures.update(0, this.camera.position, this.vel, this.camera.getWorldDirection(this.tmpDir));
        const d = Math.max(0, -this.camera.position.y);
        const clear = (0.83 / this.env.fog.density);
        const t = this.creatures.findTarget(this.camera, { clear, dark: d > 140, lightOn: this.env.lightOn, cropX: 0.6, cropY: 0.8 });
        this.paused = true;
        return t ? { id: t.rt.def.id, reason: t.reason, frac: +t.frac.toFixed(3), dist: +t.dist.toFixed(1), clear: +clear.toFixed(1) } : null;
      },
      collisionTest: (i: number) => {
        // drop the diver onto a coral head; the solver must push it out within a few frames
        const top = this.flora.homes.coralTops[i % this.flora.homes.coralTops.length];
        this.camera.position.set(top.x, top.y - 0.3, top.z);
        this.vel.set(0, -1, 0);
        return { colliders: colliderCount(), insideBefore: insideAny(this.camera.position, 0.4) };
      },
      insideNow: () => insideAny(this.camera.position, 0.4),
      aimAndShoot: (id: string) => {
        const rt = this.creatures.list.find((r) => r.def.id === id);
        const a = rt?.agents[0];
        if (!a) return false;
        const c = this.camera.position;
        const dx = a.p.x - c.x, dy = a.p.y - c.y, dz = a.p.z - c.z;
        this.yaw = Math.atan2(-dx, -dz);
        this.pitch = Math.atan2(dy, Math.hypot(dx, dz));
        this.input.press('shutter');
        return true;
      },
      targetDebug: (id: string) => {
        const rt = this.creatures.list.find((r) => r.def.id === id);
        const a = rt?.agents[0];
        if (!a) return null;
        this.camera.updateMatrixWorld();
        const v = a.p.clone().project(this.camera);
        const src = this.renderer.domElement;
        return { ndc: [+v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(3)], w: src.width, h: src.height, yaw: this.yaw, pitch: this.pitch, t: this.target ? this.target.reason : null, paused: this.paused, active: rt!.active };
      },
      drawStats: () => {
        let creatures = 0, flora = 0, terrain = 0, other = 0, casters = 0;
        this.scene.traverseVisible((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh && !(o as THREE.Points).isPoints) return;
          if ((m as unknown as THREE.InstancedMesh).isInstancedMesh && (m as unknown as THREE.InstancedMesh).count === 0) return;
          if (m.castShadow) casters++;
          let p: THREE.Object3D | null = o;
          while (p && p !== this.creatures.group && p !== this.flora.group && p !== this.terrain.group) p = p.parent;
          if (p === this.creatures.group) creatures++; else if (p === this.flora.group) flora++; else if (p === this.terrain.group) terrain++; else other++;
        });
        return { creatures, flora, terrain, other, casters };
      },
      nearFish: (r = 25) => {
        const c = this.camera.position;
        const out: Record<string, number> = {};
        for (const rt of this.creatures.list) for (const a of rt.agents) if (a.p.distanceTo(c) < r) out[rt.def.id] = (out[rt.def.id] ?? 0) + 1;
        return out;
      },
      unlockAll: () => {
        for (const s of SPECIES.slice(0, 40)) this.save.found[s.id] = this.save.found[s.id] ?? { photo: '', depth: 0, t: 0 };
      },
      /** Phase 4: distribution metrics around the diver (cf. PHASE4-DESIGN §0) */
      spreadStats: (R = 40) => {
        const c = this.camera.position;
        const corals = [...this.flora.homes.coralTops, ...this.flora.homes.coralAll].filter((p) => Math.hypot(p.x - c.x, p.z - c.z) < R);
        const agents: { x: number; y: number; z: number; id: string; swim: boolean }[] = [];
        for (const rt of this.creatures.list) {
          const swim = rt.def.kind === 'fish' || rt.def.kind === 'ray' || rt.def.kind === 'squid' || rt.def.kind === 'turtle';
          for (const a of rt.agents) if (!rt.groups[a.g].absent && !a.taken) agents.push({ x: a.p.x, y: a.p.y, z: a.p.z, id: rt.def.id, swim });
        }
        let empty = 0;
        for (const p of corals) {
          let has = false;
          for (const a of agents) { if (Math.abs(a.x - p.x) < 2.5 && Math.abs(a.z - p.z) < 2.5 && Math.abs(a.y - p.y) < 2.5) { has = true; break; } }
          if (!has) empty++;
        }
        const cells = new Map<string, Set<string>>();
        for (const a of agents) {
          if (!a.swim || Math.hypot(a.x - c.x, a.z - c.z) > R) continue;
          const k = Math.floor(a.x / 5) + ',' + Math.floor(a.z / 5);
          let s = cells.get(k);
          if (!s) cells.set(k, (s = new Set()));
          s.add(a.id);
        }
        let cells4 = 0, maxSp = 0;
        for (const s of cells.values()) { if (s.size >= 4) cells4++; maxSp = Math.max(maxSp, s.size); }
        return { corals: corals.length, emptyPct: corals.length ? Math.round((empty / corals.length) * 100) : 0, cells4plus: cells4, cells: cells.size, maxSpecies: maxSp };
      },
      /** Phase 4: how tightly fish near the diver bunch up (max neighbours within 1.5 m) */
      clump: (r = 8) => {
        const c = this.camera.position;
        const near: THREE.Vector3[] = [];
        for (const rt of this.creatures.list) for (const a of rt.agents) if (!rt.groups[a.g].absent && a.p.distanceTo(c) < r) near.push(a.p);
        let max = 0;
        for (const p of near) { let n = 0; for (const q of near) if (p.distanceTo(q) < 1.5) n++; max = Math.max(max, n); }
        return { fish: near.length, maxClump: max };
      },
      curiousState: (id: string) => {
        const rt = this.creatures.list.find((r) => r.def.id === id);
        if (!rt) return null;
        return rt.groups.map((g) => ({ cur: g.cur ?? 0, curT: Math.round((g.curT ?? 0) * 10) / 10, absent: !!g.absent }));
      },
      callCurious: (id: string) => {
        const rt = this.creatures.list.find((r) => r.def.id === id);
        if (!rt) return false;
        const g = rt.groups[0];
        const c = this.camera.position;
        g.absent = false; g.cur = 0; g.curT = 0;
        g.c.set(c.x + 12, c.y - 1, c.z); g.t.copy(g.c); g.home.copy(g.c);
        for (const a of rt.agents) if (a.g === 0) a.p.copy(g.c).add(a.off);
        return true;
      },
      giveBait: (n = 3) => {
        this.save.bait = { krill: n, chunk: n, weed: n };
        this.writeSave();
        this.refreshBaitUi();
      },
      dropBait: (kind: string) => {
        this.baitKind = kind as BaitId;
        this.scatterBait();
        return this.creatures.baitInfo();
      },
      baitInfo: () => this.creatures.baitInfo(),
      placeOcto: (id: string) => {
        const rt = this.creatures.list.find((r) => r.def.id === id);
        const a = rt?.agents[0];
        if (!rt || !a) return false;
        rt.groups[a.g].absent = false;
        rt.active = true;
        const f = new THREE.Vector3();
        this.camera.getWorldDirection(f);
        const x = this.camera.position.x + f.x * 2.5, z = this.camera.position.z + f.z * 2.5;
        a.p.set(x, heightAt(x, z) + 0.1, z);
        a.gx = undefined; a.alarm = 0; a.octCd = 0; a.octT = 0; a.v.set(0, 0, 0);
        return true;
      },
      octo: () => {
        const g = this.creatures.grab;
        return { grab: !!g, id: g?.rt.def.id ?? null, taps: g?.taps ?? 0, need: g?.need ?? 0, t: g ? Math.round(g.t * 10) / 10 : 0, air: Math.round(this.air) };
      },
      weather: () => this.weather,
      setWeather: (w: string) => {
        this.weather = w as WeatherId;
        this.creatures.weatherMult = (def) => weatherMultOf(def, this.weather);
        this.env.weatherLight = WEATHER[this.weather].light;
        this.env.weatherFog = WEATHER[this.weather].fog;
        return this.weather;
      },
      weatherMult: (id: string, w: string) => {
        const def = SPECIES_BY_ID.get(id);
        return def ? weatherMultOf(def, w as WeatherId) : null;
      },
      targetInfo: () => this.target ? { id: this.target.rt.def.id, reason: this.target.reason, inRange: this.target.inRange, fit: Math.round(this.target.fit * 100) / 100, dist: Math.round(this.target.dist * 10) / 10 } : null,
    };
  }

  private applyPlace(pl: { x: number; y: number; z: number; yaw: number; pitch: number; light?: boolean }, name: string) {
    this.camera.position.set(pl.x, pl.y, pl.z);
    this.yaw = pl.yaw;
    this.pitch = pl.pitch;
    this.vel.set(0, 0, 0);
    this.terrain.prime(pl.x, pl.z, 90);
    this.creatures.primeAround(this.camera.position);
    if (pl.light) {
      this.env.lightOn = true;
      this.env.lightPower = 1.6;
    }
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    $('help').classList.add('hidden');
    return { state: name };
  }
}
