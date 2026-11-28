import * as THREE from 'three';
import { MISSION, Missions, type MissionCtx } from './missions';
import { BOARD_DAY, Kitchen, type LandSave, type Morning } from './kitchen';
import { CHAPTERS, ENDING, SCENES, TUTORIAL, type SceneId, type StoryState } from './story';
import { SCENE_AT, SCENE_CLUE, Scenes } from './scenes';
import { JOURNALS, JOURNAL_END } from './journals';
import { SPOT, SPOTS, spotFocus, spotHintDist, spotInView, spotOpen, type SpotDef } from './spots';
import { RENDER } from './render';
import { setUwMobile } from '../render/underwater';
import { Diag } from '../ui/diag';
import { makeQuest, QUEST, type Quest } from './quests';
import { FIND_NAME, FINDS, Finds, openFind, type FindKind } from './finds';
import { buildHandSpear, buildKnife, buildSpeargun } from './gearModels';
import { BIG_KG, DISH, FISHING, PENALTY, STORY, edibleInfo, isFugu, isGoodCatch, repelTier, fmtKg, nightOf, repLevel, timeLabel, weightOf, type Catch, type DishId } from './fishing';
import { AIR_TANK, evaluateShot, sAdvice, LEGACY_NEED, LEGACY_NEED_PCT, PHOTO, SHOP, yen, type GearId } from './photoScore';
import { patchFogChunks, UW } from '../render/underwater';
import { Terrain } from '../world/terrain';
import { ESTUARY_WEDGE, Environment, RIVER_WATER, ZONE_WATER } from '../world/environment';
import { Waterfall } from '../world/waterfall';
import { Flora } from '../world/flora';
import { Creatures, CURIOUS, OCTO, type PhotoTarget } from '../life/creatures';
import { BAIT, dietOf, eatsBait, type BaitId } from './bait';
import { CHEST, CHEST_GEAR, CHESTS, Chests, type ChestGearId } from './chests';
import { WEATHER, weatherMult as weatherMultOf, weatherOf, type WeatherId } from './weather';
import { SPECIES, SPECIES_BY_ID, ZONE_ORDER } from '../life/species';
import { surfaceAt } from '../world/surface';
import { BLUEHOLE, caveRoofAt, DIVE_POINTS, flowAt, FLOW_MIN_DEPTH, GATE, gateWeight, heightAt, RUINS, riverDist, SHORE_BLOCK, VENT, WATERFALL, WORLD, WRECK, zoneAt, ZONE_NAMES, type DivePoint } from '../world/layout';
import { Input } from '../core/input';
import { Audio } from '../core/audio';
import { clamp, lerp } from '../utils/noise';
import { BoatTravel, Dawn, PORT, travelSeconds } from '../ui/transit';
import { Minimap } from '../ui/minimap';
import { areaIconSvg } from '../ui/areaIcons';
import { TalkUI, type TalkLine } from '../ui/talk';
import { ITEM_ORDER, ITEM_TIPS, NIGHT_REST, NO_LIGHT, albumLines, baitLines, boardLines, claimLines, deepChartLines, introLines, kitchenLines, praiseLines, replayLines, shopOpenLines, tankUpLines } from './talks';
import { colliderCount, insideAny, resolveSphere } from '../world/colliders';
// DEBUG-PANEL:BEGIN（テスト用。完成版で削除）
import { installDebugPanel } from './debug';
// DEBUG-PANEL:END

export type Save = LandSave & {
  /** dive points known (reached while diving, or from a chart) */
  discovered?: string[];
  /** current main-story chapter, and the last one whose briefing was read */
  storyMain?: number; storyRead?: number;
  /** special sights photographed */
  scenes?: Partial<Record<SceneId, { photo: string; t: number }>>;
  tutorial?: boolean;
  /** 修正バッチ2 F4：見た吹き出しの台本 ID（一度きり） */
  talked?: string[];
  /** 修正バッチ2 F5：機能解放・新アイテムの台本の既読移行（1 で移行済み） */
  talkMig?: number;
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
  stocked?: string[]; announced?: string[]; p1?: 1; p2?: 1;
  /** Phase 3: chapters cleared whose reward has not been received yet; dive points swum into; photo spots already paid */
  storyClaim?: number[]; visited?: string[]; spots?: string[];
  /** Phase 5: treasure chests opened, and sights named by a chest's notebook page */
  chests?: string[]; sceneHints?: SceneId[];
  /** 修正バッチ2 F8 (3)：拾った手記（拾った順）。sceneHints から読み込み時に作る（sceneHints も残す） */
  journals?: { scene: SceneId; t: number }[];
  /** 修正バッチ2 (1): HUD button sizes (device preference; progress resets keep it) */
  ui?: { shutter: number; ctl: number; base?: number };
 found: Record<string, { photo: string; depth: number; t: number; score?: number }>; dives: number; maxDepth: number; muted?: boolean; money?: number; owned?: string[]; earned?: number };
type Shot = { photo: string; depth: number; score: number; grade: string; value: number; isNew: boolean };
/** F8 (20)：光景に出会えたときの表示。主役が画面内・dist m 以内に入った瞬間に帯を bannerSec 秒。編集長のひとこと（初回の光景だけ別の文） */
const SCENE_SEE = { dist: 25, bannerSec: 3, lines: ['いい光景だ。落ち着いて、フレームに収めよう。', 'めったに見られない光景だよ。逃さずに撮ろう。', 'これは撮っておきたい。いい構図を探して。'] };

type State = 'loading' | 'title' | 'diving' | 'paused' | 'result' | 'dex';

const SAVE_KEY = 'blue-depths-save-v1';
/** F6：拾い物の箱の海図に出さないエリア：入手元がほかにある（流氷＝ショップ・ブルーホール＝ショップ・水中洞窟＝しおさい亭・深海＝大気圧潜水服） */
const CHART_ONLY = new Set<string>([...GATE.areas, 'deep']);

/** 修正バッチ2 (8): air warnings — each shows once per dive (half-tank, then the last stretch), no constant blinking */
export const AIR_WARN = { halfFrac: 0.35, lastBar: 20, lastSec: 30 };
/** 修正バッチ2 (34): nitrogen narcosis — seconds spent below ~55 m before the diver blacks out */
export const NARCOSIS = { blackoutSec: 60, warnLeftSec: 20 };
/** 修正バッチ2 (1): HUD size settings (device preference, kept across progress resets) */
export const UI_SCALE = { min: 0.7, max: 1.3, step: 0.05, def: 1 };
/** (41) 基準サイズの改定（ui.base = 2）：旧 80%／75% がちょうどよかったので、これを新しい 100% にした（CSS 側の基準 px を ×0.8／×0.75 済み）。旧セーブは 新倍率 = 旧倍率 × 旧基準 ÷ 新基準 で換算 */
export const UI_REBASE = { ver: 2, shutter: 0.8, ctl: 0.75 };

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
/** 漁協から借りるウニ用の銛（F7 (36)）。魚には使えない */
const LOAN_SPEAR = { ...FISHING.tools.hand, name: '漁協のヤス' };

/** 修正バッチ2 F2 (31): スティックの前後が縦にも進み始める視線の傾き（ラジアン） */
const STICK = { vertFrom: (50 * Math.PI) / 180, vertFull: (70 * Math.PI) / 180 };

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
  /** chapters whose S has already been shot on this dive: no more S advice for them (reset at dive start) */
  private sDoneCh = new Set<number>();
  private point: DivePoint = DIVE_POINTS[1];
  private flowTmp = { x: 0, z: 0 };
  /** Phase 9 S2: air-use multiplier while swimming against the river's flow (1 .. 1.4), the toast flag, and the last flow felt */
  private flowAir = 1;
  private flowWarned = false;
  /** Phase 9 S6: the diver is in the river (spear button hidden), and the one-time toast was shown this dive */
  private riverBan = false;
  private riverToasted = false;
  private waterfall!: Waterfall;
  private ads = false;
  private captureReq: PhotoTarget | null | undefined = undefined;
  private target: PhotoTarget | null = null;
  private toastTimer = 0;
  private discoverTimer = 0;
  private time = 0;
  private frame = 0;
  private titleT = 0;
  private narc = 0;
  /** Phase 6: seconds spent in the narcosis blackout band (narc >= 0.83) */
  private narcDeepT = 0;
  /** (12) the dex page was opened straight from a photo (discover card / result card) */
  private dexDirect = false;
  /** (8) which air warnings this dive has shown (1 = half, 2 = last) */
  private airWarned = 0;
  private airRate = 0.4;
  /** Phase 6: narcosis stage-2 disorientation: time left of the current instrument blur, and until the next */
  private narcBlur = 0;
  private narcBlurT = 0;
  private lastWarn = 0;
  /** Phase 9: last time the shore said "no further" */
  private lastShoreWarn = -99;
  /** Phase 5: last time the world's edge said "no further" */
  private lastEdgeWarn = -100;
  /** F6：海図のないエリアのゲート。この潜水の開始地点がもうエリアの中にあるとき（デバッグなど）は、その潜水だけゲートしない */
  private gateFree = new Set<string>();
  private lastGateWarn = -100;
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
  /** F8 (4)：このダイブで「見どころが近い…」が出たスポット（円はそこから出す） */
  private spotHinted = new Set<string>();
  /** F8 (20)：このダイブで「特別な光景」の帯を出した光景。帯が出ている残り秒 */
  private sceneAnnounced = new Set<SceneId>();
  private bannerT = 0;
  /** F8 (4)：章の光景の場所の手がかりを潜り始めに言ったか */
  private clueSaid = false;
  /** F8 (3)：浮上後に読む手記（拾った順）。結果画面を閉じたあとに 1 枚ずつ */
  private journalQueue: SceneId[] = [];
  /** F8 (22)：初めて助けるときの操作チュートリアルを出しているか */
  private turtleTut = false;
  /** first-person gear in hand */
  private vmHand!: THREE.Group;
  private vmGun!: THREE.Group;
  private vmGunShaft!: THREE.Mesh;
  /** the diver's knife (Phase 3: cutting the net off a turtle) */
  private vmKnife!: THREE.Group;
  private cutReady = false;
  /** Phase 5: permanent treasure chests, and the one within reach right now */
  private chests = new Chests();
  private chestReady: string | null = null;
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
  /** adaptive pixel ratio asked for by the frame-time controller (Infinity = as sharp as the caps allow) */
  private dprWant = Infinity;
  /** consecutive fast checks, needed before the resolution is raised again */
  private dprFast = 0;
  /** on-screen performance readout (?diag or the debug row) */
  private diag: Diag;
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
    // phones: single-sample shadows (no PCF) and one caustic layer (PHASE8-DESIGN §6.3-③)
    this.renderer.shadowMap.type = mobile ? THREE.BasicShadowMap : THREE.PCFShadowMap;
    setUwMobile(mobile);
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.setPixelRatio(this.targetDpr());
    this.diag = new Diag($('diag'), document.getElementById('diag-toggle') as HTMLButtonElement | null, this.renderer);
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
    this.waterfall = new Waterfall(this.env.pointScale);
    this.scene.add(this.waterfall.group);
    this.creatures = new Creatures(this.flora.homes);
    this.creatures.renderer = this.renderer; // draws the L2 atlas cells (PHASE8-DESIGN §1.3)
    mark('creatures');
    this.scene.add(this.creatures.group);
    this.missions = new Missions();
    this.scene.add(this.missions.group);
    this.scene.add(this.chests.group);
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
    this.vmKnife = buildKnife();
    for (const m of [this.vmHand, this.vmGun, this.vmKnife]) {
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
      dawn: (r) => this.playDawn(r),
      hasTorch: () => this.hasTorch(),
      progress: () => ({ found: this.foundCount, chapter: this.save.storyMain ?? 0, spear: this.has('spear') }),
    });
    this.kitchen.ensureOrders();
    this.audio.onExhale = () => {
      if (this.state === 'diving') this.env.exhale(this.camera, this.ads || this.has('rebreather') ? 0 : 1);
    };

    this.input = new Input($('touch-surface'), $('stick'), $('knob'));
    this.bindUi();
    this.talk = new TalkUI($('toast').parentElement!);
    this.dawnUI = new Dawn($('dawn'));
    this.travelUI = new BoatTravel($('travel'), $<HTMLCanvasElement>('tv-canvas'), () => this.ensureMinimap(), (sec) => this.audio.travel(sec));
    // しおさい亭で料理してから閉じたとき、夜に潜った後なら朝にする
    $('k-close').addEventListener('click', () => { if (this.morningDue && !this.dawning) this.playDawn(this.kitchen.nextMorning()); });
    $('open-kitchen').addEventListener('click', () => { this.audio.unlock(); if (!this.save.tutorial) { this.toast('しおさい亭は、最初のダイブを終えると開く', '', 2.6); return; } this.kitchen.open(); });
    // DEBUG-PANEL:BEGIN（テスト用。完成版で削除。リセット・最大・各種デバッグ操作は game/debug.ts）
    installDebugPanel({ save: this.save, write: () => this.writeSave() });
    // DEBUG-PANEL:END
    $('open-quests').addEventListener('click', () => { if (!this.save.boardOn) { this.toast(`依頼の掲示板は、${BOARD_DAY}日目に出る`, '', 2.6); return; } $('quests').classList.remove('hidden'); this.renderQuests(); });
    $('hb-bell').addEventListener('click', () => this.onTodoTap());
    $('story-card').addEventListener('click', (e) => { if (!(e.target as HTMLElement).closest('button, summary, details')) this.onTodoTap(); });
    $('quests-close').addEventListener('click', () => { $('quests').classList.add('hidden'); this.renderTitle(); });
    $('open-album').addEventListener('click', () => { $('album').classList.remove('hidden'); this.renderAlbum(); });
    $('album-close').addEventListener('click', () => $('album').classList.add('hidden'));
    $('open-shop').addEventListener('click', () => { this.audio.unlock(); $('shop').classList.remove('hidden'); this.renderShop(); });
    $('shop-close').addEventListener('click', () => { $('shop').classList.add('hidden'); this.renderTitle(); });
    $('res-kitchen').addEventListener('click', () => { this.toTitle(); this.kitchen.open(); this.flushJournals(); });
    $('jr-ok').addEventListener('click', () => this.closeJournal());
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
        if (!sv.p1) {
          if (sv.dives > 0) { sv.boardOn ??= true; sv.okami ??= { lore: 1 }; }
          sv.p1 = 1;
        }
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
        // 修正バッチ2 F8 (3)：手記。sceneHints から作る（なければ空）
        if (!sv.journals) sv.journals = (sv.sceneHints ?? []).map((scene, i) => ({ scene, t: i }));
        // 修正バッチ2 F4：吹き出しの既読。今までのプレイヤー（もう潜った人）は夜の休み方を見たことにする
        if (!sv.talked) sv.talked = sv.dives > 0 && sv.tutorial ? ['nightRest'] : [];
        if (sv.airLv === undefined) sv.airLv = sv.owned?.includes('tank') ? 4 : sv.dives > 0 ? 2 : 0;
        // 修正バッチ2 F5：もう機能を使っている人には解放の台本を出さない（読み込み時に 1 回だけ既読に）
        if ((sv.talkMig ?? 0) < 1) {
          const t = new Set(sv.talked ?? []);
          if (sv.dives > 0 && sv.tutorial) {
            const own = new Set<string>(sv.owned ?? []);
            if (SHOP.some((g) => own.has(g.id))) t.add('shopOpen');
            if ((sv.airLv ?? 0) >= 1) t.add('tankUp');
            if (sv.boardIntro) t.add('board');
            if (Object.keys(sv.scenes ?? {}).length) t.add('album');
            if (own.has('spear') && (sv.orders !== undefined || (sv.story ?? 0) > 0 || (sv.rep ?? 0) > 0)) t.add('kitchen');
            if (Object.values(sv.bait ?? {}).some((n) => (n ?? 0) > 0)) { t.add('bait'); t.add('item:bait'); }
            for (const id of Object.keys(ITEM_TIPS)) if (own.has(id)) t.add(`item:${id}`);
          }
          sv.talked = [...t];
          sv.talkMig = 1;
        }
        if (!sv.discovered) {
          // earlier saves: every place where something was already photographed counts as found
          const zones = new Set(Object.keys(sv.found).map((id) => SPECIES_BY_ID.get(id)?.zone));
          sv.discovered = DIVE_POINTS.filter((dp) => dp.id === 'lagoon' || zones.has(dp.id as never) || (dp.id === 'dropoff' && zones.has('offshore'))).map((dp) => dp.id);
          sv.tutorial = sv.dives > 0;
          if (sv.owned?.length || Object.keys(sv.found).length) (sv.owned ??= []).push('spear');
        }
        // 修正バッチ2 F6：海図の入手元の整理。①ゲートの 3 つは、すでに泳いで入った（そこの生き物を撮った）人は海図を持っている扱い
        //   ②しおさい亭の話 Lv2 は水中洞窟の海図に変わったので、もう読んだ人には洞窟を渡す ③大気圧潜水服を持っている人は深海を知っている
        {
          const d = new Set(sv.discovered ?? ['lagoon']);
          const zones = new Set(Object.keys(sv.found).map((id) => SPECIES_BY_ID.get(id)?.zone as string | undefined));
          for (const a of GATE.areas) if (zones.has(a)) d.add(a);
          if ((sv.story ?? 0) >= 2) d.add('cave');
          if (sv.owned?.includes('ads')) { d.add('deep'); sv.talked = [...new Set([...(sv.talked ?? []), 'deepChart'])]; }
          if (d.size > (sv.discovered ?? ['lagoon']).length) sv.discovered = [...d];
        }
        // (41) HUD ボタン基準の改定：見た目の大きさを変えずに倍率を換算（ui.base が付いたら移行済み）
        if (sv.ui && (sv.ui.base ?? 1) < UI_REBASE.ver) {
          const r = (v: number, f: number) => Math.round(clamp(Number.isFinite(v) ? v / f : 1, UI_SCALE.min, UI_SCALE.max) * 100) / 100;
          sv.ui = { shutter: r(sv.ui.shutter, UI_REBASE.shutter), ctl: r(sv.ui.ctl, UI_REBASE.ctl), base: UI_REBASE.ver };
        } else if (sv.ui) sv.ui.base = UI_REBASE.ver;
        return sv;
      }
    } catch {
      /* storage unavailable */
    }
    return { found: {}, dives: 0, maxDepth: 0, money: 0, owned: [], earned: 0, discovered: ['lagoon'], visited: ['lagoon'], storyMain: 0, storyRead: -1, airLv: 0, p1: 1, p2: 1, talked: [], talkMig: 1 };
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

  private has(id: GearId | ChestGearId): boolean {
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
  private discover(id: string): boolean {
    if (this.discovered.has(id)) return false;
    (this.save.discovered ??= ['lagoon']).push(id);
    this.writeSave();
    if (this.minimap) this.minimap.known = this.discovered;
    return true;
  }

  private grantMap(id: string): void {
    this.discover(id);
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

  /** 修正バッチ2 F4：この起動でクリアした章（褒め言葉の吹き出し用） */
  private clearedIdx: number[] = [];
  talk!: TalkUI;
  private talking = false;
  /** F7：夜明けの演出（寝たとき・夜の潜水の後）と、ボートで向かう演出 */
  private dawnUI!: Dawn;
  private travelUI!: BoatTravel;
  private dawning = false;
  private traveling = false;
  /** ボートがいま浮かんでいる所（さっき潜った地点）。null は港。朝になると港に戻る */
  private boatAt: { x: number; z: number } | null = null;
  /** 夜に始めた潜水の後は朝にする：結果画面を閉じた時点で朝にする（(26)） */
  private diveNight = false;
  private morningDue = false;
  private boatTalks = 0;
  /** このボート画面で夜の休み方を出した（同じ訪問では noLight を出さない） */
  private visitRest = false;
  private talkTimer = 0;

  /** Finish every chapter whose goal is met: hand over charts and move on. The reward waits on the chapter card until received (Phase 3). */
  private advanceStory(): void {
    const st = this.storyState();
    while ((this.save.storyMain ?? 0) < CHAPTERS.length && CHAPTERS[this.save.storyMain ?? 0].done(st)) {
      const ch = CHAPTERS[this.save.storyMain ?? 0];
      if (ch.reward) (this.save.storyClaim ??= []).push(this.save.storyMain ?? 0);
      if (ch.map) this.grantMap(ch.map);
      this.clearedIdx.push(this.save.storyMain ?? 0);
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
  private albumTab: 'scenes' | 'journals' = 'scenes';

  private renderAlbum(): void {
    const all = Object.keys(SCENES) as SceneId[];
    const jr = this.save.journals ?? [];
    const tabs = `<div class="al-tabs" role="tablist"><button type="button" class="al-tab${this.albumTab === 'scenes' ? ' on' : ''}" data-altab="scenes" role="tab">光景・スポット</button><button type="button" class="al-tab${this.albumTab === 'journals' ? ' on' : ''}" data-altab="journals" role="tab">手記（${jr.length}）</button></div>`;
    if (this.albumTab === 'journals') {
      // F8 (3)：拾った順に一覧。タップで本文。光景を撮った後は「◯◯に出会えた」の印
      $('album-body').innerHTML = tabs + (jr.length
        ? `<div class="al-journals">${jr.map((j, i) => `<button type="button" class="al-journal${this.save.scenes?.[j.scene] ? ' met' : ''}" data-jr="${j.scene}"><b>古い手記の切れはし　その${i + 1}</b><span>${this.save.scenes?.[j.scene] ? `◎ ${SCENES[j.scene].name}に出会えた` : 'タップで読む'}</span></button>`).join('')}</div>`
        : '<p class="al-count">まだ手記を拾っていない。<small>海底の宝箱に、古い手記の切れはしが入っていることがある。</small></p>');
      this.bindAlbumTabs();
      return;
    }
    const got = all.filter((id) => this.save.scenes?.[id]);
    $('album-body').innerHTML = `<div class="al-count">出会えた光景 <b>${got.length}</b> / ${all.length}</div><div class="sc-photos">${all.map((id) => this.save.scenes?.[id]
      ? `<figure><img src="${this.save.scenes[id]!.photo}" alt=""><figcaption><b>${SCENES[id].name}</b>${SCENES[id].desc}</figcaption></figure>`
      : (this.save.sceneHints ?? []).includes(id)
        ? `<figure class="locked"><div>？</div><figcaption><b>${SCENES[id].name}</b>手記のヒント：${SCENES[id].note}</figcaption></figure>`
        : `<figure class="locked"><div>？</div><figcaption><b>？？？</b>${SCENES[id].hint}<br>出会えるかは運しだい</figcaption></figure>`).join('')}</div>`
      // Phase 3: photo spots (pay once, the first time)
      + `<div class="al-count">写真スポット <b>${SPOTS.filter((s) => this.save.spots?.includes(s.id)).length}</b> / ？<small>（見どころが近いと気配が出て、マップに水色の円が出る。円の中で見どころに向けて撮る。時間帯や天気で撮れない所もある。報酬は各スポット最初の1回だけ）</small></div><div class="al-spots">${SPOTS.filter((s) => this.save.spots?.includes(s.id) || this.discovered.has(s.point)).map((s) => this.save.spots?.includes(s.id)
        ? `<div class="al-spot done"><b>${s.name}</b><span>${DIVE_POINTS.find((d) => d.id === s.point)?.name ?? ''}・撮影済み</span></div>`
        : `<div class="al-spot"><b>？？？</b><span>${DIVE_POINTS.find((d) => d.id === s.point)?.name ?? ''}・${yen(s.pay)}</span></div>`).join('')}</div>`;
    $('album-body').insertAdjacentHTML('afterbegin', tabs);
    this.bindAlbumTabs();
  }

  private bindAlbumTabs(): void {
    $('album-body').querySelectorAll<HTMLElement>('[data-altab]').forEach((b) => b.addEventListener('click', () => { this.albumTab = b.dataset.altab as 'scenes' | 'journals'; this.renderAlbum(); }));
    $('album-body').querySelectorAll<HTMLElement>('[data-jr]').forEach((b) => b.addEventListener('click', () => this.openJournal(b.dataset.jr as SceneId)));
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

  /**
   * 修正バッチ2 (39): 「今やること」カード（章の目標・報酬の受け取り・夜でライトがないときの案内）。
   * 常に同じ位置・金色の縁。報酬があるときは光る。
   */
  private renderStory(): void {
    const el = $('story-card');
    const i = this.save.storyMain ?? 0;
    const ch = CHAPTERS[i];
    const claims = (this.save.storyClaim ?? []).map((k) => `<div class="sc-claim"><span>第${k + 1}章「${CHAPTERS[k].title}」クリア！ 編集長からの報酬</span><button type="button" class="btn pri" data-claim="${k}">報酬 ${yen(CHAPTERS[k].reward)} を受け取る</button></div>`).join('');
    el.classList.toggle('glow', !!this.save.storyClaim?.length);
    const cleared = claims;
    // 夜でライトがないときは、潜れない理由と次の行き先がこのカードに出る
    const dark = this.save.tutorial && nightOf(this.save.clock ?? 0) >= 0.5 && !this.hasTorch();
    const alert = dark ? '<div class="td-alert">夜の海はライトがないと潜れない → <b>しおさい亭で休む</b></div>' : '';
    const goal = this.nextGoal();
    const next = goal ? `<div class="td-next">${goal.species > 0 ? `次の入荷：「？」まで図鑑あと <b>${goal.species}種</b>` : goal.need > 0 ? `次の目標：「？」まであと <b>${yen(goal.need)}</b>` : `<span class="ok">「${goal.name}」が買える！ ショップへ</span>`}</div>` : '';
    if (!ch) {
      el.innerHTML = `<div class="td-kick"><b>今やること</b><span>写真家の評価：表紙の写真家</span></div>${alert}${cleared}<div class="sc-intro">${ENDING}</div>${next}`;
      this.bindClaims(el);
      return;
    }
    const st = this.storyState();
    // F4：章カードは「第◯章 目標：… 進み具合」の短い表示。編集長の話（依頼）は吹き出しで、タップするともう一度読める
    el.innerHTML = `<div class="td-kick"><b>今やること</b><span>第${i + 1}章　${i > 0 ? `写真家の評価：${CHAPTERS[i - 1].title2}` : '駆け出しの海中写真家'}</span></div>${alert}${cleared}<div class="sc-title">${ch.title}</div>` +
      `<div class="sc-goal">目標：${ch.goal}${ch.progress ? `　<b>${ch.progress(st)}</b>` : ''}${ch.needsLight && !this.hasTorch() ? `<small class="sc-wait">${this.stockGap(SHOP.find((x) => x.id === 'torch')!) > 0 ? 'ライトがまだない（図鑑を増やすと入荷する）' : 'ライトがない（ボートのショップで買える）'}</small>` : ''}${ch.reward ? `<span class="sc-pay">報酬 ${yen(ch.reward)}</span>` : ''}</div>${next}${ch.tips ? `<details class="sc-tips"><summary>編集長の「Sを取るコツ」</summary><ul>${ch.tips.map((t) => `<li>${t}</li>`).join('')}</ul></details>` : ''}`;
    el.insertAdjacentHTML('beforeend', '<small class="sc-hint">タップで編集長の話をもう一度</small>');
    this.bindClaims(el);
  }

  /**
   * 「今やること」カード（と右上のお知らせ）のタップ（F4）：
   * 受け取れる報酬があればその「受け取る」の吹き出し、なければ今の依頼の吹き出しをもう一度。
   */
  private onTodoTap(): void {
    const el = $('story-card');
    el.scrollIntoView({ block: 'nearest' });
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
    if (this.talk.active || this.talking || !this.talkOk()) return;
    const k = this.save.storyClaim?.[0];
    if (k !== undefined) { void this.playTalk(null, claimLines(k, yen(CHAPTERS[k].reward)), k); return; }
    const i = this.save.storyMain ?? 0;
    void this.playTalk(null, replayLines(i, CHAPTERS[i]?.progress?.(this.storyState()) ?? ''));
  }

  /** 吹き出しを出せる状態か：ボート画面で、ほかの画面・暗転が出ていない */
  private talkOk(): boolean {
    if (this.state !== 'title' || !this.save.tutorial) return false;
    if ($('title').classList.contains('hidden') || this.kitchen.isOpen) return false;
    for (const id of ['shop', 'quests', 'album', 'settings', 'map', 'dex', 'result', 'prologue']) if (!$(id).classList.contains('hidden')) return false;
    return !$('fade').classList.contains('on') && !this.dawning && !this.traveling;
  }

  /** F5 ④新アイテム：潜水中の小型吹き出し（#coach と同じ場所・暗くしない）。id の台本を一度きり */
  private itemTip(id: string): void {
    const talked = (this.save.talked ??= []);
    const key = `item:${id}`;
    const lines = ITEM_TIPS[id];
    if (!lines || talked.includes(key) || this.state !== 'diving' || this.talk.miniOpen) return;
    talked.push(key);
    this.writeSave();
    this.tipUntil = this.time + 6 * lines.length;
    this.talk.showMiniSeq(lines, 6);
  }

  /** 潜水開始直後：持っていて説明が要る道具のうち、まだ説明していない最初の 1 つ（残りは次の潜水） */
  private itemTips(): void {
    if (this.ads || !this.save.tutorial || this.tut.step >= 0) return;
    const talked = this.save.talked ?? [];
    const id = ITEM_ORDER.find((k) => !talked.includes(`item:${k}`) && (k === 'bait' ? this.heldBaits().length > 0 : this.has(k as GearId)));
    if (id) this.itemTip(id);
  }

  /** 台本を 1 本出す。id があれば一度きり（見終わる／スキップで記録）。claim は報酬の受け取り */
  private async playTalk(id: string | null, lines: TalkLine[], claimIdx?: number, after?: () => void): Promise<void> {
    this.talking = true;
    try {
      const r = await this.talk.run(lines, { closeKitchen: () => { if (!this.dawning && this.kitchen.isOpen) this.kitchen.close(); },
        // F5：女将さんの第 1 話を吹き出しで読んだので既読に（海図つきの話ならここで渡す）
        readStory: () => { const n = this.save.story ?? 0; if (n < 1) { const ch = STORY[n]; if (ch?.map) this.grantMap(ch.map); this.save.story = n + 1; this.writeSave(); this.kitchen.render(); } },
        // F5：掲示板の使い方カードは吹き出しで済んだので畳む
        boardSeen: () => { this.save.boardIntro = true; this.writeSave(); this.renderQuests(); },
        // F6：大気圧潜水服を買ったとき、編集長が深海の場所を教える（ここで深海を発見済みにしてダイブポイントに出す）
        grantDeep: () => { this.grantMap('deep'); this.renderTitle(); } });
      if (r.choice === 'claim' && claimIdx !== undefined) this.claimStory(claimIdx);
      if (id) { const t = (this.save.talked ??= []); if (!t.includes(id)) t.push(id); }
      after?.();
      this.writeSave();
    } finally { this.talking = false; }
  }

  /** ボート画面に戻ったとき／画面が整ったときに、キューの先頭から 1 つずつ（1 回のボート画面で最大 3 本） */
  private pumpTalks(): void {
    if (this.talking || this.talk.active || this.boatTalks >= 3) return;
    window.clearTimeout(this.talkTimer);
    this.talkTimer = window.setTimeout(() => void this.runTalks(), 450);
  }

  private async runTalks(): Promise<void> {
    let played = 0;
    while (this.boatTalks < 3 && !this.talking && this.talkOk()) {
      const t = this.nextTalk();
      if (!t) break;
      this.boatTalks++;
      played++;
      await this.playTalk(t.id, t.lines, t.claim, t.after);
    }
    if (played && this.state === 'title') this.renderTitle();
  }

  /** 割り込みの順番：①章の報酬・褒め言葉 → ②次の章の依頼 → ③機能の解放 → ④新アイテムの説明 →（⑤入荷の知らせはトースト）。F5 は ③④に足す */
  private nextTalk(): { id: string; lines: TalkLine[]; claim?: number; after?: () => void } | null {
    const talked = this.save.talked ??= [];
    const seen = (id: string) => talked.includes(id);
    // ① 章の報酬・褒め言葉
    const done = [...new Set([...(this.save.storyClaim ?? []), ...this.clearedIdx])].sort((a, b) => a - b);
    for (const k of done) {
      if (seen(`praise:${k}`) || k >= (this.save.storyMain ?? 0)) continue;
      const ch = CHAPTERS[k];
      const mapName = ch.map ? DIVE_POINTS.find((d) => d.id === ch.map)?.name : '';
      return { id: `praise:${k}`, lines: praiseLines(k, yen(ch.reward), mapName), claim: this.save.storyClaim?.includes(k) ? k : undefined };
    }
    // ② 次の章の依頼
    const i = this.save.storyMain ?? 0;
    if (i >= 1 && i < CHAPTERS.length && (this.save.storyRead ?? -1) < i && !seen(`intro:${i}`)) {
      return { id: `intro:${i}`, lines: introLines(i), after: () => { this.save.storyRead = i; } };
    }
    // ③ 機能の解放：夜の休み方（初回のダイブの後）／ライトがまだないとき
    const night = nightOf(this.save.clock ?? 0) >= 0.5;
    if (night && !this.hasTorch() && !seen('nightRest')) { this.visitRest = true; return { id: 'nightRest', lines: NIGHT_REST }; }
    const torchGap = this.stockGap(SHOP.find((x) => x.id === 'torch')!) > 0;
    if (!seen('noLight') && torchGap && !this.hasTorch() && (night || i >= 3) && seen('nightRest') && !this.visitRest) return { id: 'noLight', lines: NO_LIGHT };
    // F5 ③機能の解放（夜の休み方と同じ訪問では重ねない）。④新アイテム（item:<id>）は潜水開始時の小型吹き出し（itemTips）
    if (this.visitRest) return null;
    if (!seen('deepChart') && this.has('ads')) return { id: 'deepChart', lines: deepChartLines() };
    const money = this.save.money ?? 0;
    const fins = SHOP.find((x) => x.id === 'fins')!;
    if (!seen('shopOpen') && this.stockGap(fins) === 0 && !this.owns(fins)) return { id: 'shopOpen', lines: shopOpenLines(money >= fins.price, yen(fins.price)) };
    const nextTank = AIR_TANK[(this.save.airLv ?? 0) + 1];
    if (!seen('tankUp') && nextTank && money >= nextTank.price) return { id: 'tankUp', lines: tankUpLines() };
    if (!seen('board') && this.save.boardOn && !this.save.boardIntro) return { id: 'board', lines: boardLines() };
    if (!seen('album') && Object.keys(this.save.scenes ?? {}).length > 0) return { id: 'album', lines: albumLines() };
    if (!seen('kitchen') && this.has('spear') && (this.save.story ?? 0) < 1) return { id: 'kitchen', lines: kitchenLines() };
    const baitCost = Math.min(...BAIT.kinds.map((k) => k.price));
    if (!seen('bait') && this.has('spear') && repLevel(this.save.rep ?? 0) >= 2 && this.heldBaits().length === 0) return { id: 'bait', lines: baitLines(money >= baitCost) };
    return null;
  }

  private bindClaims(el: HTMLElement): void {
    el.querySelectorAll<HTMLButtonElement>('[data-claim]').forEach((b) => b.addEventListener('click', () => { this.audio.unlock(); this.claimStory(Number(b.dataset.claim)); }));
  }

  /** Species still needed before an item comes into stock (an absolute count: never divided by the dex size). */
  private stockGap(g: (typeof SHOP)[number]): number {
    if (g.rep) return repLevel(this.save.rep ?? 0) >= g.rep ? 0 : 1;
    if (this.save.stocked?.includes(g.id)) return 0;
    // F6：解放順の改定で入荷の種数が増えても、すでに入荷を知らせた物は引っ込めない
    if (this.save.announced?.includes(g.id)) return 0;
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
    this.toast(id === 'light' ? '「水中ライト」を強化した！ 強力ライトで、もっと遠くまで明るく照らせる' : id === 'spear' ? '「手銛」を購入！ 港の食堂「しおさい亭」の女将さんが話があるらしい（ボートの「しおさい亭」へ）' : g.map ? `「${g.name}」を購入！ ボートから直接行けるようになった` : `「${g.name}」を購入！ ${g.desc}`, '', 4);
    this.renderTitle();
  }

  /** Pixel-ratio range for the current window: device / platform cap and the pixel-count cap, with a floor. */
  private dprRange(): { min: number; max: number } {
    const area = Math.max(1, window.innerWidth * window.innerHeight);
    const max = Math.min(devicePixelRatio, this.dprCap, Math.sqrt(RENDER.maxPixels / area));
    return { min: Math.min(max, Math.sqrt(RENDER.minPixels / area)), max };
  }

  /** The pixel ratio to render at: what the frame-time controller asks for, kept inside the range. */
  private targetDpr(): number {
    const r = this.dprRange();
    return clamp(this.dprWant, r.min, r.max);
  }

  /** Called every RENDER.checkFrames frames: step the resolution down when slow, up only after staying fast. */
  private adaptResolution(): void {
    const cur = this.renderer.getPixelRatio();
    let next = cur;
    if (this.frameAvg > RENDER.slowMs) {
      this.dprFast = 0;
      next = cur - RENDER.step;
    } else if (this.frameAvg < RENDER.fastMs) {
      if (++this.dprFast >= RENDER.fastChecks) {
        this.dprFast = 0;
        next = cur + RENDER.step;
      }
    } else this.dprFast = 0;
    if (next === cur) return;
    const r = this.dprRange();
    this.dprWant = clamp(next, r.min, r.max);
    if (Math.abs(this.dprWant - cur) > 1e-4) this.renderer.setPixelRatio(this.dprWant);
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setPixelRatio(this.targetDpr());
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.fov = w < h ? 74 : 64;
    this.camera.updateProjectionMatrix();
    // creature LOD (§1.1): on-screen size in px at the device's top resolution (the adaptive steps do not move it)
    this.creatures.lodFocal = (h * this.dprRange().max) / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
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
    $('dex-chip').addEventListener('click', () => this.openDex());
    $('open-dex').addEventListener('click', () => this.openDex());
    $('dex-close').addEventListener('click', () => this.closeDex());
    // (45) the card itself lets touches through (the stick works under it); only its buttons take taps
    const openFromCard = () => {
      const id = $('discover').dataset.dex;
      if (!id) return;
      $('discover').classList.add('hidden');
      this.openDex(id);
    };
    $('discover').addEventListener('click', openFromCard);
    $('disc-dex').addEventListener('click', (e) => { e.stopPropagation(); openFromCard(); });
    $('disc-x').addEventListener('click', (e) => { e.stopPropagation(); $('discover').classList.add('hidden'); this.discoverTimer = 0; });
    // (12) opened straight from a photo → closing the page goes back to the dive / result; opened from the list → back to the list
    $('dd-close').addEventListener('click', () => {
      $('dex-detail').classList.add('hidden');
      if (this.dexDirect) this.closeDex();
    });
    $('surface-btn').addEventListener('click', () => this.endDive('surface'));
    $('res-ok').addEventListener('click', () => this.closeResult());
    $('minimap-btn').addEventListener('click', () => this.toggleMap(true));
    $('map').addEventListener('click', () => this.toggleMap(false));
    $('toggle-sound').addEventListener('click', () => {
      this.save.muted = !this.save.muted;
      this.audio.setMuted(!!this.save.muted);
      $('snd-wave').style.opacity = this.save.muted ? '0.15' : '1';
      this.writeSave();
    });
    $('snd-wave').style.opacity = this.save.muted ? '0.15' : '1';
    this.bindSettings();
  }

  /** 修正バッチ2 (1): the settings screen — HUD button sizes through the CSS variables --shutter-k / --ctl-k */
  private settingsFromPause = false;
  private applyUi(): void {
    const k = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, UI_SCALE.min, UI_SCALE.max) : UI_SCALE.def);
    const ui = this.save.ui;
    const root = document.documentElement.style;
    root.setProperty('--shutter-k', String(k(ui?.shutter)));
    root.setProperty('--ctl-k', String(k(ui?.ctl)));
    const pct = (v: unknown) => `${Math.round(k(v) * 100)}%`;
    ($('set-shutter') as HTMLInputElement).value = String(Math.round(k(ui?.shutter) * 100));
    ($('set-ctl') as HTMLInputElement).value = String(Math.round(k(ui?.ctl) * 100));
    $('set-shutter-val').textContent = pct(ui?.shutter);
    $('set-ctl-val').textContent = pct(ui?.ctl);
  }
  private bindSettings(): void {
    this.applyUi();
    const set = (key: 'shutter' | 'ctl', v: number) => {
      const ui = (this.save.ui ??= { shutter: UI_SCALE.def, ctl: UI_SCALE.def, base: UI_REBASE.ver });
      ui[key] = clamp(v / 100, UI_SCALE.min, UI_SCALE.max);
      this.applyUi();
    };
    $('set-shutter').addEventListener('input', (e) => set('shutter', Number((e.target as HTMLInputElement).value)));
    $('set-ctl').addEventListener('input', (e) => set('ctl', Number((e.target as HTMLInputElement).value)));
    $('set-shutter').addEventListener('change', () => this.writeSave());
    $('set-ctl').addEventListener('change', () => this.writeSave());
    $('set-reset').addEventListener('click', () => { this.save.ui = { shutter: UI_SCALE.def, ctl: UI_SCALE.def, base: UI_REBASE.ver }; this.applyUi(); this.writeSave(); });
    const open = (fromPause: boolean) => {
      this.settingsFromPause = fromPause;
      if (fromPause) $('pause').classList.add('hidden');
      $('settings').classList.remove('hidden');
    };
    $('open-settings').addEventListener('click', () => open(false));
    $('pause-settings').addEventListener('click', () => open(true));
    $('set-close').addEventListener('click', () => {
      $('settings').classList.add('hidden');
      if (this.settingsFromPause && this.state === 'paused') $('pause').classList.remove('hidden');
      this.settingsFromPause = false;
      this.writeSave();
    });
  }

  /** Stock notices go by "announced", not by dex-count deltas, so players who already met a threshold are told once too (Fix batch 1, P2-3). */
  private announceStock(): string[] {
    const ann = (this.save.announced ??= []);
    const fresh = SHOP.filter((g) => !g.rep && !g.map && !this.has(g.id as GearId) && this.stockGap(g) === 0 && !ann.includes(g.id));
    if (!fresh.length) return [];
    ann.push(...fresh.map((g) => g.id));
    this.writeSave();
    return fresh.map((g) => g.name);
  }

  /** バッジの意味を統一：赤＝新しいこと（new）・数字＝件数（num）・緑＝いま使える（ok） */
  private setBadge(id: string, text: string, kind: 'new' | 'num' | 'ok' = 'ok'): void {
    const el = $(id);
    el.textContent = text;
    el.className = `bdg ${kind}${text ? '' : ' empty'}`;
  }

  private renderTitle(): void {
    this.advanceStory();
    this.renderStory();
    const colors: Record<string, string> = { lagoon: '#9fe8d8', reef: '#5fe3f0', rocky: '#a8c8b0', dropoff: '#4aa8e8', deep: '#3a5ab8', cold: '#d6eef6', ruins: '#c8b890', bluehole: '#2a6ad8', cave: '#5a6a70', kelp: '#8ab060', estuary: '#8a9a60', river: '#5aa8b8' };
    const pts = $('points');
    pts.innerHTML = '';
    const known = this.discovered;
    const dark = !!this.save.tutorial && nightOf(this.save.clock ?? 0) >= 0.5 && !this.hasTorch();
    for (const dp of DIVE_POINTS) {
      if (!known.has(dp.id)) continue;
      const locked = dp.requires === 'ads' && !this.has('ads');
      const b = document.createElement('button');
      b.className = 'pt' + (dark && !locked ? ' dim' : '') + (locked ? ' lockd' : '');
      b.type = 'button';
      b.dataset.dp = dp.id;
      b.disabled = locked;
      b.innerHTML = `<span class="ico" style="--ico-bg:${colors[dp.id]};background:${colors[dp.id]}">${areaIconSvg(dp.id)}</span>
        <span class="pt-tx"><span class="nm">${dp.name}</span><span class="sb">${locked ? '大気圧潜水服が必要' : dp.sub}</span></span>`;
      b.addEventListener('click', () => this.startDive(dp));
      pts.appendChild(b);
    }
    {
      // always shown, and never with a count: the sea may always hide one more place (§1.4)
      const d = document.createElement('div');
      d.className = 'pt unknown';
      d.innerHTML = `<span class="ico" style="--ico-bg:#2a3a44;background:#2a3a44;color:#9fb6c0">？</span><span class="pt-tx"><span class="nm">未発見のポイント</span><span class="sb">海は広い。まだ何かあるかもしれない</span></span>`;
      pts.appendChild(d);
    }
    this.renderDaytime();
    const spear = this.has('spear');
    // ドックの施設は消さずに、まだ使えないものは鍵つきで同じ位置に置く
    const lock = (id: string, on: boolean) => { $(id).classList.toggle('locked', on); $(id).setAttribute('aria-disabled', on ? 'true' : 'false'); };
    lock('open-kitchen', !this.save.tutorial);
    lock('open-quests', !this.save.boardOn);
    this.setBadge('quest-badge', this.save.boardOn && (!this.save.boardIntro || (this.save.board ?? []).some((q) => q.fresh)) ? 'NEW' : '', 'new');
    if (!this.save.tutorial) this.setBadge('k-badge', '');
    else if (!spear) this.setBadge('k-badge', nightOf(this.save.clock ?? 0) >= 0.5 ? '休む' : '', 'ok');
    else {
      const ready = this.kitchen.readyCount();
      const lv = repLevel(this.save.rep ?? 0);
      if ((this.save.story ?? 0) < lv) this.setBadge('k-badge', 'NEW', 'new');
      else this.setBadge('k-badge', ready ? '作れる' : '', 'ok');
    }
    const money = this.save.money ?? 0;
    const buyable = SHOP.filter((g) => !this.owns(g) && this.stockGap(g) === 0 && money >= g.price && (!g.req || this.has(g.req))).length;
    this.setBadge('shop-badge', buyable ? '買える' : '', 'ok');
    const scenes = Object.keys(this.save.scenes ?? {}).length;
    this.setBadge('album-badge', '', 'num');
    $('open-album').title = `特別な光景 ${scenes} / ${Object.keys(SCENES).length}`;
    this.setBadge('dex-badge', '', 'new');
    const claims = this.save.storyClaim?.length ?? 0;
    this.setBadge('hb-bell-n', claims ? String(claims) : '', 'num');
    $('t-goal').innerHTML = `<b>${yen(money)}</b>`;
    $('hb-dex').innerHTML = `図鑑 <b>${this.foundCount}</b>種`;
    // ロゴとキャッチコピーは、最初のダイブの前だけ大きく出す
    $('home-brand').classList.toggle('hidden', !!this.save.tutorial);
    if (!$('shop').classList.contains('hidden')) this.renderShop();
    if (this.state === 'title' && this.save.tutorial) {
      const names = this.announceStock();
      if (names.length) this.toast(`ダイブショップに${names.length > 2 ? `「${names[0]}」ほか${names.length - 1}点` : names.map((n) => `「${n}」`).join('と')}が入荷している`, '', 4.5);
    }
    if (this.state === 'title' && this.save.tutorial) this.pumpTalks();
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
    const upgrades = new Set(SHOP.filter((x) => x.upgrade).map((x) => x.upgrade));
    gear.innerHTML = SHOP.filter((u) => (!u.rep || this.has('spear')) && !upgrades.has(u.id)).map((u) => {
      const on = this.owns(u);
      const gap = this.stockGap(u);
      const stocked = gap === 0;
      const needReq = !!u.req && !this.has(u.req);
      const can = !on && stocked && money >= u.price && !needReq;
      const req = on ? (u.map ? '場所は分かっている' : '入手済み') : !stocked ? (u.rep ? `食堂の評判Lv${u.rep}で入荷` : `図鑑${u.need}種で入荷<br>（あと${gap}種）`) : needReq ? `先に${SHOP.find((x) => x.id === u.req)!.name}` : can ? `購入 ${yen(u.price)}` : yen(u.price);
      const show = stocked || on || !!u.rep;
      const up = u.upgrade ? SHOP.find((x) => x.id === u.upgrade) : undefined;
      const upOn = !!up && this.has(up.id);
      const icon = upOn && u.iconUp ? u.iconUp : u.icon;
      const main = `<button type="button" class="gear-item ${on ? 'on' : ''} ${can ? 'can' : ''} ${stocked ? '' : 'locked'}${upOn ? ' upgraded' : ''}" data-buy="${u.id}" ${on || !can ? 'aria-disabled="true"' : ''}><div class="gi"><svg viewBox="0 0 24 24"${show ? '' : ' class="sil" aria-hidden="true"'}>${icon}</svg></div>${show ? u.name : '？？？'}<span class="req">${req}</span><span class="gdesc">${show ? u.desc : ''}</span></button>`;
      if (!up || !show) return main;
      // F6：強化（強力ライト）は水中ライトの枠の中に出す。買うと水中ライトのアイコンが強化済みの印に変わる
      const upGap = this.stockGap(up);
      const upCan = !upOn && upGap === 0 && on && money >= up.price;
      const upText = upOn ? '強化済み：強力ライト' : upGap > 0 ? `強化：${up.name}（図鑑${up.need}種で入荷・${yen(up.price)}・あと${upGap}種）` : !on ? `強化：${up.name}（${yen(up.price)}・水中ライトを買うと強化できる）` : upCan ? `強化する：${up.name} ${yen(up.price)}` : `強化：${up.name}（${yen(up.price)}）`;
      return `<div class="gear-cell${upOn ? ' upgraded' : ''}">${main}<button type="button" class="gear-upg ${upOn ? 'on' : ''} ${upCan ? 'can' : ''}" data-buy="${up.id}" ${upOn || !upCan ? 'aria-disabled="true"' : ''}>${upText}</button></div>`;
    }).join('');
    const tg = $('treasure-gear');
    const mine = (Object.keys(CHEST_GEAR) as ChestGearId[]).filter((id) => this.has(id));
    tg.classList.toggle('hidden', mine.length === 0);
    tg.innerHTML = mine.length ? `<div class="tg-head">宝箱で見つけた装備</div>` + mine.map((id) => `<div class="tg-item"><b>${CHEST_GEAR[id].name}</b><span>${CHEST_GEAR[id].desc}</span></div>`).join('') : '';
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
    const now = `<span class="hb-chip dt-now">${this.save.day ?? 1}日目・<b>${timeLabel(c)}</b>・${w.icon}${w.name}</span>`;
    const night = nightOf(c) >= 0.5;
    const buff = this.save.buff ? `<span class="hb-chip dt-buff" title="次のダイブに効く">まかない：${DISH[this.save.buff].name}</span>` : '';
    const inn = night && this.save.tutorial ? '<button type="button" class="btn pri dt-inn" data-inn="1">しおさい亭へ帰る</button>' : '';
    el.innerHTML = `${now}${buff}${inn}`;
    el.querySelector<HTMLButtonElement>('[data-inn]')?.addEventListener('click', () => { this.audio.unlock(); this.kitchen.open(); });
  }

  private toast(text: string, kind: '' | 'warn' | 'danger' = '', dur = 2.2): void {
    const t = $('toast');
    t.textContent = text;
    t.className = 'show ' + kind;
    this.toastTimer = dur;
  }

  private openDex(at?: string): void {
    if (this.state === 'dex') return;
    this.stateBeforeDex = this.state;
    if (this.state === 'diving') this.paused = true;
    this.state = 'dex';
    $('pause').classList.add('hidden');
    $('dex').classList.remove('hidden');
    const grid = $('dex-grid');
    grid.innerHTML = '';
    const zones = ZONE_ORDER;
    for (const z of zones) {
      const list = SPECIES.filter((s) => s.zone === z);
      if (!list.length) continue;
      const got = list.filter((s) => this.save.found[s.id] || this.pending.has(s.id)).length;
      const title = document.createElement('div');
      title.className = 'dz-title';
      title.innerHTML = `${ZONE_NAMES[z]}`;
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
        c.addEventListener('click', () => { this.dexDirect = false; this.showDetail(s.id); });
        g.appendChild(c);
      }
      grid.appendChild(g);
    }
    // Phase 7: opened from a photo (result card / discover card) — go straight to the page
    this.dexDirect = false;
    if (at && (this.save.found[at] || this.pending.has(at))) { this.dexDirect = true; this.showDetail(at); }
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
    this.dexDirect = false;
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
      this.minimap.drawBig(p.x, p.z, this.displayYaw(), this.boatPos());
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

  private startDive(dp: DivePoint, quick = false, prologue = false, instant = false): void {
    if (dp.requires !== 'ads' && this.nightBlocked()) {
      this.toast('夜の海はライトがないと潜れない。しおさい亭で休んで朝を待とう', 'warn', 3.5);
      return;
    }
    if (!quick) this.quick = null;
    this.audio.unlock();
    const fade = $('fade');
    if (prologue || instant) {
      fade.classList.add('on');
      window.setTimeout(() => this.beginDive(dp, quick, prologue, fade, Promise.resolve()), 650);
      return;
    }
    if (this.traveling || this.dawning) return;
    // F7 (17)(29)：ボートで向かう演出。潜水の準備（生き物の生成・シェーダの事前コンパイル）はこの演出の裏で進める
    this.traveling = true;
    const from = quick ? PORT : this.boatAt ?? PORT;
    const depth = Math.max(1, Math.round(-heightAt(dp.x, dp.z)));
    let done: Promise<void> = Promise.resolve();
    done = this.travelUI.play({ from, to: dp, name: dp.name, depth, sec: travelSeconds(from, dp, quick), urchin: quick }, () => {
      fade.classList.add('on');
      this.beginDive(dp, quick, prologue, fade, done);
    }).then(() => { this.traveling = false; });
  }

  /** 暗転のあいだに潜水を始める（旧 startDive の本体）。hold が終わるまで暗転を解かない */
  private beginDive(dp: DivePoint, quick: boolean, prologue: boolean, fade: HTMLElement, hold: Promise<void>): void {
    {
      this.point = dp;
      this.boatAt = quick ? this.boatAt : { x: dp.x, z: dp.z };
      this.ads = dp.requires === 'ads';
      // the dish eaten in the diner powers up this one dive
      this.buff = this.ads ? null : this.save.buff ?? null;
      if (this.buff) { this.save.buff = null; this.writeSave(); }
      this.airMax = (this.ads ? 220 : AIR_TANK[this.save.airLv ?? 0].cap) * (this.buff === 'nabe' ? 1.2 : 1);
      this.air = this.airMax;
      this.diveTime = 0;
      this.clearMapFound();
      this.sDoneCh.clear();
      this.flowWarned = false; this.flowAir = 1; this.riverBan = false; this.riverToasted = false;
      this.narcDeepT = 0;
      this.airWarned = 0;
      this.narcBlur = 0;
      this.narcBlurT = 0;
      this.diveMaxDepth = 0;
      this.diveShots = 0;
      this.pending.clear();
      this.creatures.companion = null;
      this.vel.set(0, 0, 0);
      // a few metres down after the giant-stride entry, clear of the boat's keel (~1.8 m draft)
      const startY = this.ads ? -175 : -3.2;
      this.camera.position.set(dp.x, startY, dp.z);
      this.gateFree = new Set(GATE.areas.filter((a) => gateWeight(a, dp.x, dp.z) >= GATE.edge));
      this.yaw = dp.yaw ?? Math.PI; // face offshore (+z); the estuary / river face upstream (-z)
      this.pitch = this.ads ? -0.5 : -0.35;
      // moored ~12 m up-current behind the diver, stern (ladder) facing the diver
      if (dp.yaw === 0) this.flora.placeBoat(dp.x + 2, dp.z + 12, 0.15); // upstream-facing dive: the boat is downstream (+z)
      else this.flora.placeBoat(dp.x - 2, dp.z - 12);
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
      this.spotHinted.clear();
      this.sceneAnnounced.clear();
      this.bannerT = 0;
      $('scene-banner').classList.remove('show');
      this.clueSaid = false;
      this.sceneLine = null;
      this.turtleTut = false;
      this.activeQuest = null;
      this.surveySeen.clear();
      this.spearFx.visible = false;
      $('hud').classList.remove('spear');
      this.toolBtnHidden = !this.has('spear') || this.ads;
      $('btn-tool').classList.toggle('hidden', this.toolBtnHidden);
      this.vmHand.visible = this.vmGun.visible = false;
      // special sights: staged for the chapter that asks for them, later left to chance
      const ch = this.chapter;
      const nightNow = nightOf(this.save.clock ?? 0) >= 0.5;
      const sceneIds: SceneId[] = [];
      if (!this.ads && !quick && ch?.scene && !this.save.scenes?.[ch.scene]) sceneIds.push(ch.scene);
      // F7 (40)：ウニ漁（しおさい亭の仕込み）の間は光景などのイベントの抽選を止める（ウニ漁に集中できるように）
      if (!this.ads && !quick) {
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
      this.chests.build(new Set(this.save.chests ?? []));
      this.bonuses = [];
      $('btn-light').classList.toggle('on', this.env.lightOn);
      $('btn-light').classList.toggle('dim', !this.ads && !this.hasTorch());
      $('btn-boost').classList.toggle('hidden', !this.has('scooter'));
      $('title').classList.add('hidden');
      $('result').classList.add('hidden');
      $('hud').classList.remove('hidden');
      $('mask').classList.add('on');
      this.updateDexChip();
      this.state = 'diving';
      this.paused = false;
      this.clock.getDelta();
      // the screen stays black until this dive's shaders are compiled (never longer than RENDER.warmMaxMs)
      this.diveNight = !this.ads && !quick && !prologue && nightOf(this.save.clock ?? 0) >= 0.5;
      void Promise.all([Promise.race([this.warmShaders(), new Promise((r) => window.setTimeout(r, RENDER.warmMaxMs))]), hold])
        .finally(() => { fade.classList.remove('on'); });
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
      if (!prologue) window.setTimeout(() => this.itemTips(), 1800);
      this.toast(this.ads ? '大気圧潜水服で深海へ降下中…' : `${dp.name}にエントリー${this.env.night >= 0.5 ? '（夜の海）' : ''}　天気：${WEATHER[this.weather].icon}${WEATHER[this.weather].name}${this.buff ? `　まかないの${DISH[this.buff].name}：${DISH[this.buff].short}` : ''}`, '', 3);
    }
  }

  /** stand-ins for materials that only appear during a dive; kept so that their programs stay compiled */
  private warm: THREE.Group | null = null;

  /**
   * Compile, while the screen is still black, every shader a dive can meet, so that nothing is compiled
   * (and stutters) when a new creature first appears (PHASE8-DESIGN §6.3-⑧).
   */
  private warmShaders(): Promise<unknown> {
    const first = !this.warm;
    if (!this.warm) {
      this.warm = new THREE.Group();
      const bait = new THREE.Points(
        new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3)),
        new THREE.PointsMaterial({ size: 0.09, transparent: true, opacity: 0.9, depthWrite: false }),
      );
      bait.frustumCulled = false;
      this.warm.add(...this.creatures.warmupObjects(), ...this.terrain.warmupObjects(), this.finds.warmupObject(), bait);
      // the atlas cells are drawn into a render target: those shaders are compiled by drawing a blank cell
      this.creatures.imp.warm(this.renderer);
    }
    const warm = this.warm;
    // species meshes may be disposed while the compile is being waited for: leave them out of this pass
    // (the stand-ins cover their shaders)
    this.scene.remove(this.creatures.group);
    this.scene.add(warm);
    // the vent's glow comes and goes with distance, and only the pressure-suit dive gets that close:
    // that dive builds the shaders for both light counts (the current one last)
    const glow = this.flora.ventLight;
    const lit = glow.visible;
    const done = Promise.all((this.ads ? [!lit, lit] : [lit]).map((v) => {
      glow.visible = v;
      return this.renderer.compileAsync(this.scene, this.camera);
    }));
    this.scene.remove(warm);
    this.scene.add(this.creatures.group);
    if (!first) return done;
    return done.then(() => {
      // compile() does not cover the shadow-depth shaders: draw the stand-ins once, unseen behind the fade
      warm.position.copy(this.camera.position);
      warm.scale.setScalar(1e-4);
      this.scene.add(warm);
      this.renderer.shadowMap.needsUpdate = true;
      this.renderer.render(this.scene, this.camera);
      this.scene.remove(warm);
    });
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

  private baitLabelPrev: string | null = null;
  private baitColorPrev = '';
  /** Bait buttons: shown while diving after the tutorial (never in the ADS), with kind and uses left. */
  private refreshBaitUi(): void {
    const held = this.heldBaits();
    const show = this.state === 'diving' && !this.ads && !!this.save.tutorial && held.length > 0;
    $('btn-bait').classList.toggle('hidden', !show);
    $('btn-bait-kind').classList.toggle('hidden', !(show && held.length > 1));
    if (held.length && !held.some((k) => k.id === this.baitKind)) this.baitKind = held[0].id;
    const kind = BAIT.kinds.find((k) => k.id === this.baitKind);
    // write the DOM only when a value changed (P4-5)
    const label = kind && show ? `${kind.name}×${this.save.bait?.[kind.id] ?? 0}` : '';
    if (label !== this.baitLabelPrev) { $('bait-label').textContent = label; this.baitLabelPrev = label; }
    const col = kind ? kind.color : '';
    if (col && col !== this.baitColorPrev) { $('btn-bait').style.color = col; this.baitColorPrev = col; }
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
      } else if (e.type === 'charge' && e.def.aggro?.bite === 0) {
        // harmless display (the river's ayu guarding its rock): no alarm, no damage
        if (this.time - this.lastEncounter >= 4) { this.lastEncounter = this.time; this.toast(`${name}が縄張りの石から体当たりのしぐさをしている`, 'warn', 2.5); }
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
      } else if (e.def.aggro?.bite === 0) {
        this.vel.addScaledVector(this.camera.position.clone().sub(e.p).setY(0.1).normalize(), 0.8);
        continue;
      } else {
        const bite = e.def.aggro?.bite ?? 5;
        const lethal = !!e.def.aggro?.lethal;
        // Phase 11: an aggro hit may empty the tank (the 1 bar floor stays only for the octopus and the haul)
        this.air = lethal ? 0 : Math.max(0, this.air - bite);
        const push = this.camera.position.clone().sub(e.p).setY(0.3).normalize();
        this.vel.addScaledVector(push, shark ? 4.5 : 3);
        this.shake = 1;
        this.audio.warn();
        this.toast(lethal ? `${name}の一撃！ エアが一気に抜けた…` : light ? `${name}のくちばしが刺さった！ エア −${bite}bar` : shark ? `${name}にぶつかられた！ エア −${bite}bar` : `${name}に噛まれた！ エア −${bite}bar`, 'danger', 3);
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

  private endDive(reason: 'surface' | 'blackout' | 'narcosis'): void {
    if (this.state !== 'diving' && this.state !== 'paused') return;
    const before = this.foundCount;
    const shots = [...this.pending.entries()];
    this.creatures.companion = null;
    this.creatures.clearBait();
    this.clearBaitVisual();
    this.clearMapFound();
    // F8：光景の帯・小型吹き出しは潜水が終わったら消す（結果画面に残さない）
    this.bannerT = 0;
    this.sceneLine = null;
    $('scene-banner').classList.remove('show');
    this.talk.hideMini();
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
    // F7 (26)：夜に始めた潜水の後は、結果画面を閉じたときに朝にする（ウニ漁の短い潜水は時間を変えない）
    this.morningDue = this.diveNight && !this.quick;
    this.diveNight = false;
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
      const unknown = this.chartCandidates();
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
    $('res-kicker').textContent = reason === 'surface' ? 'SURFACED' : reason === 'narcosis' ? 'NARCOSIS' : 'BLACKOUT';
    $('res-title').textContent = reason === 'surface' ? '無事に浮上しました' : reason === 'narcosis' ? '窒素酔いで意識を失った… 救助されました' : 'エア切れで気絶… 救助されました';
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
      ? shots.map(([id, f]) => `<div class="res-card" data-dex="${id}"><img src="${f.photo}" alt=""><i class="rg g${f.grade}">${f.grade}</i>${f.isNew ? '<i class="rnew">NEW</i>' : ''}<div>${SPECIES_BY_ID.get(id)!.name}<small>${yen(f.value)}</small></div></div>`).join('')
      : `<div class="res-empty">${this.diveShots ? '新しい生き物は撮れませんでした。' : '今回は写真を撮りませんでした。'}</div>`;
    if (this.bonuses.length) list.insertAdjacentHTML('beforeend', this.bonuses.map((b) => `<div class="res-bonus">${b.label}<b>${yen(b.value)}</b></div>`).join(''));
    // Phase 3: the editor's chapter was cleared on this dive — the reward is received on the boat
    {
      const st = this.storyState();
      const clearedNow: { title: string; reward: number }[] = [];
      for (let k = this.save.storyMain ?? 0; k < CHAPTERS.length && CHAPTERS[k].done(st); k++) if (CHAPTERS[k].reward) clearedNow.push({ title: CHAPTERS[k].title, reward: CHAPTERS[k].reward! });
      if (clearedNow.length) list.insertAdjacentHTML('beforeend', `<div class="res-find"><span class="open">編集長の依頼${clearedNow.map((c) => `「${c.title}」`).join('')}をクリア！</span>ボートの章カードで報酬 <b>${clearedNow.map((c) => yen(c.reward)).join(' + ')}</b> を受け取ろう</div>`);
    }
    if (this.diveCatch.length) {
      list.insertAdjacentHTML('beforeend', reason === 'surface'
        ? caught.map((c) => `<div class="res-catch">獲物：${SPECIES_BY_ID.get(c.id)!.name}<b>${fmtKg(c.kg)}</b></div>`).join('')
        : `<div class="res-empty">気絶したときに獲物（${this.diveCatch.length}匹）は海に流されてしまった。</div>`);
    }
    if (seized.length) list.insertAdjacentHTML('beforeend', `<div class="res-empty">漁協の見回りに見つかった！ 保護されている${seized.map((c) => SPECIES_BY_ID.get(c.id)!.name).join('・')}は没収、罰金 ${yen(fine)}。しおさい亭の評判も下がってしまった…</div>`);
    for (const { k, loot } of opened) list.insertAdjacentHTML('beforeend', `<div class="res-find">拾った「${FIND_NAME[k]}」を開けてみると…<span class="open">${loot.text}${loot.yen ? `　<b>+${yen(loot.yen)}</b>` : ''}</span></div>`);
    if (reason !== 'surface' && this.diveFinds.length) list.insertAdjacentHTML('beforeend', `<div class="res-empty">拾った物は気絶したときに落としてしまった。</div>`);
    this.diveCatch = [];
    this.diveFinds = [];
    const ready = this.kitchen.readyCount();
    $('res-kitchen').classList.toggle('hidden', !caught.length);
    $('res-kitchen').textContent = ready ? `しおさい亭で料理する（${ready}件の注文が作れる！）` : 'しおさい亭で料理する';
    if (!shots.length && !this.bonuses.length && caught.length) list.querySelector('.res-empty')?.remove();
    list.querySelectorAll<HTMLElement>('.res-card').forEach((c) => c.addEventListener('click', () => this.openDex(c.dataset.dex)));
    this.missions.reset();
    if (reason === 'narcosis' && shots.length) list.insertAdjacentHTML('beforeend', `<div class="res-empty">窒素酔いで意識を失い、救助された。図鑑の記録は残ったが、救助費用で売上は${Math.round(PHOTO.blackoutKeep * 100)}%に（${yen(gross)} → ${yen(earn)}）。55mより深く長く潜りすぎないようにしよう。</div>`);
    if (reason === 'blackout' && shots.length) list.insertAdjacentHTML('beforeend', `<div class="res-empty">気絶して救助された。図鑑の記録は残ったが、救助費用で売上は${Math.round(PHOTO.blackoutKeep * 100)}%に（${yen(gross)} → ${yen(earn)}）。エアに気をつけて早めに浮上しよう。</div>`);
    const stockedNow = SHOP.filter((g) => !this.has(g.id) && !g.rep && !this.save.stocked?.includes(g.id) && g.need > before && this.stockGap(g) === 0);
    if (stockedNow.length) { (this.save.announced ??= []).push(...stockedNow.map((g) => g.id)); this.writeSave(); }
    const affordable = SHOP.filter((g) => !this.has(g.id) && this.stockGap(g) === 0 && this.save.money! >= g.price && (moneyBefore < g.price || stockedNow.includes(g)));
    const goal = this.nextGoal();
    $('res-unlock').innerHTML = [
      ...stockedNow.map((g) => `ダイブショップに「${g.name}」が入荷した！`),
      ...affordable.map((g) => `「${g.name}」が買えるようになった！ ボートのショップへ`),
    ].join('<br>') || (goal ? `<span class="res-goal">所持金 ${yen(this.save.money!)}　次の目標${goal.species > 0 ? `「？」入荷まで図鑑あと${goal.species}種` : `「${goal.name}」まであと${yen(goal.need)}`}</span>` : '');
    if (affordable.length || stockedNow.length || earn > 0) this.audio.chime(affordable.length + stockedNow.length > 0);
    if (this.quick) {
      // the diner's harvest: no result screen, straight back to the shop. After a
      // harvest, changing the time of day leaves the diner for the menu (Phase 6).
      const ok = !!this.quick.ok;
      this.quick = null;
      if (ok) { this.save.rep = (this.save.rep ?? 0) + 1; this.writeSave(); }
      $('result').classList.add('hidden');
      this.toTitle();
      this.kitchen.open();
      this.kitchen.harvestResult(ok, earn);
      this.kitchen.leaveOnTimeChange = true;
    }
  }

  /** 浮上の結果画面を閉じる。夜に潜った後は、寝たのと同じ処理（朝にする）と夜明けの演出へ */
  private closeResult(): void {
    // F8 (3)：拾った手記は、結果画面のあとに 1 枚ずつ読む
    if (this.journalQueue.length) { this.flushJournals(() => this.closeResult()); return; }
    if (this.morningDue && !this.dawning) { this.playDawn(this.kitchen.nextMorning()); return; }
    this.toTitle();
  }

  /**
   * F7 (10)：夜明けの演出。0.6 秒で暗転 → 「◯日目の朝」と天気を 1.2 秒 → 明けてボート画面へ（しおさい亭・結果画面は暗転のあいだに閉じる）。
   * 女将さんの朝のひとこと（天気・残りの魚の売上）はボート画面の吹き出しで 1 段だけ。タップで早送り。
   */
  private playDawn(r: Morning): void {
    if (this.dawning) return;
    this.dawning = true;
    this.morningDue = false;
    this.boatAt = null;
    this.audio.unlock();
    this.audio.dawn();
    const w = WEATHER[weatherOf(r.day)];
    void this.dawnUI.play({ day: r.day, icon: w.icon, weather: w.name }, () => {
      $('kitchen').classList.add('hidden');
      this.toTitle();
    }).then(async () => {
      this.dawning = false;
      // 吹き出しの台本の途中（初回の夜の休み方など）なら、その台本が「おはよう」を言う
      if (!this.talking && !this.talk.active && this.talkOk()) {
        await this.playTalk(null, [{ who: 'okami', text: r.line }]);
      }
      this.pumpTalks();
    });
  }

  private journalAfter: (() => void) | null = null;

  /** F8 (3)：浮上後に読む手記（拾った順）を 1 枚ずつ出す。終わったら after */
  private flushJournals(after?: () => void): void {
    const id = this.journalQueue.shift();
    if (!id) { after?.(); return; }
    this.openJournal(id, this.journalQueue.length > 0, () => this.flushJournals(after));
  }

  /** F8 (3)：手記の画面（紙の質感の 1 枚）。本文（2〜3 行）＋最後に意味深な一文。光景を撮った後は「◯◯に出会えた」の印 */
  private openJournal(scene: SceneId, more = false, onClose?: () => void): void {
    const n = (this.save.journals ?? []).findIndex((j) => j.scene === scene) + 1;
    $('jr-kicker').textContent = `古い手記の切れはし${n > 0 ? `　その${n}` : ''}`;
    $('jr-body').innerHTML = JOURNALS[scene].map((l) => `<p>${l}</p>`).join('');
    $('jr-end').textContent = JOURNAL_END;
    const met = !!this.save.scenes?.[scene];
    $('jr-met').classList.toggle('hidden', !met);
    $('jr-met').textContent = `◎ ${SCENES[scene].name}に出会えた`;
    $('jr-ok').textContent = more ? '次の手記へ' : '閉じる';
    this.journalAfter = onClose ?? null;
    $('journal').classList.remove('hidden');
    $('journal').scrollTop = 0;
    this.audio.chime(false);
  }

  private closeJournal(): void {
    $('journal').classList.add('hidden');
    const f = this.journalAfter;
    this.journalAfter = null;
    f?.();
  }

  private toTitle(): void {
    $('result').classList.add('hidden');
    $('title').classList.remove('hidden');
    $('title').scrollTop = 0; // F7 (37)：ボート画面に戻るときは一番上から
    this.state = 'title';
    this.env.lightOn = false;
    this.boatTalks = 0;
    this.visitRest = false;
    this.renderTitle();
  }

  private updateDexChip(): void {
    const newOnes = [...this.pending.keys()].filter((k) => !this.save.found[k]).length;
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
    // Phase 9 S6: no spearfishing in the river (the estuary follows the sea's rules). The button hides while the diver is in the river.
    const riverNow = this.camera.position.z < -60 && zoneAt(this.camera.position.x, this.camera.position.z) === 'river';
    if (riverNow !== this.riverBan) this.riverBan = riverNow;
    if (riverNow && this.tool === 'spear') this.setTool('camera');
    if (inp.consume('tool') && !riverNow && !this.toolBtnHidden) this.setTool(this.tool === 'camera' ? 'spear' : 'camera');
    else if (riverNow && this.has('spear') && !this.ads && !this.riverToasted) {
      this.riverToasted = true;
      this.toast('川では銛は使えない（川の漁は漁協の決まりで禁止）', 'warn', 4);
    }
    if (inp.consume('baitKind')) this.cycleBaitKind();
    if (inp.consume('bait')) this.scatterBait();

    const cam = this.camera;
    const fwd = new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const boosting = inp.boost && this.has('scooter');
    let speed = (this.ads ? 2.3 : 2.4) * (this.has('fins') ? 1.3 : 1) * (this.has('goldfins') ? 1.1 : 1) * (this.buff === 'shioyaki' ? 1.15 : this.buff === 'fugu' ? 1.1 : 1) * (1 - Math.min(0.3, this.carryKg / 120));
    if (boosting) speed = 6;
    if (this.creatures.grab) speed *= 0.25; // Phase 4: an octopus on the arms — barely able to swim
    // 修正バッチ2 F2 (31): スティックの前後は水平に進む（開始時の約 20° 下向きで勝手に沈まない）。真上・真下を見ているとき
    // （|pitch| が STICK.vertFrom を超えたら）だけ、STICK.vertFull までに滑らかに見ている向きへ縦にも進む
    const vk = THREE.MathUtils.smoothstep(Math.abs(this.pitch), STICK.vertFrom, STICK.vertFull);
    const flat = new THREE.Vector3(fwd.x, 0, fwd.z).normalize();
    const dir = flat.multiplyScalar(1 - vk).addScaledVector(fwd, vk);
    const want = new THREE.Vector3().addScaledVector(dir, inp.moveY * speed).addScaledVector(right, inp.moveX * speed * 0.7);
    if (inp.up) want.y += speed * 0.75;
    if (inp.down) want.y -= speed * (this.ads ? 1.3 : 0.75);
    // neutral buoyancy drift + breathing bob
    want.y += Math.sin(this.time * (Math.PI * 2) / 5.2) * 0.06;
    this.vel.lerp(want, 1 - Math.exp(-dt * (boosting ? 2.4 : 1.6)));
    const prevX = cam.position.x, prevZ = cam.position.z;
    cam.position.addScaledVector(this.vel, dt);
    // Phase 9 S1/S2: the estuary channel's (0.15 m/s) and the river's (0.2–0.8 m/s) flow carries the diver — but only below
    // FLOW_MIN_DEPTH: at the surface nothing pushes (same rule for both). Swimming against the river costs air (flowAir).
    this.flowAir = 1;
    if (!this.ads && cam.position.z < -60 && -cam.position.y >= FLOW_MIN_DEPTH) {
      flowAt(cam.position.x, cam.position.z, this.flowTmp, cam.position.y);
      const fx = this.flowTmp.x, fz = this.flowTmp.z, fm = Math.hypot(fx, fz);
      cam.position.x += fx * dt;
      cam.position.z += fz * dt;
      // S6 (S2 review Low-1): swimming against the flow costs air in the river zone only (the estuary's 0.15 m/s never does)
      if (zoneAt(cam.position.x, cam.position.z) === 'river') {
        if (this.vel.x * fx + this.vel.z * fz < 0 && Math.hypot(this.vel.x, this.vel.z) > 0.3) this.flowAir = 1 + 0.4 * Math.min(1, fm / 0.8);
        if (fm > 0.5 && !this.flowWarned) {
          this.flowWarned = true;
          this.toast('流れが速い（瀬）。流れに逆らうとエアが減りやすい', 'warn', 3.5);
        }
      }
    }
    // Phase 9: the island's shore (south): where the floor is shallower than SHORE_BLOCK.diver the diver cannot go.
    // Undo the horizontal step and cancel the velocity toward the land (the uphill direction), so he slides along the shore.
    if (cam.position.z < -60 && heightAt(cam.position.x, cam.position.z) > SHORE_BLOCK.diver) {
      cam.position.x = prevX; cam.position.z = prevZ;
      let gx = heightAt(prevX + 1, prevZ) - heightAt(prevX - 1, prevZ), gz = heightAt(prevX, prevZ + 1) - heightAt(prevX, prevZ - 1);
      const gl = Math.hypot(gx, gz);
      if (gl > 1e-6) {
        gx /= gl; gz /= gl;
        const into = this.vel.x * gx + this.vel.z * gz;
        if (into > 0) { this.vel.x -= into * gx; this.vel.z -= into * gz; }
      } else { this.vel.x = 0; this.vel.z = 0; }
      if (this.time - this.lastShoreWarn > 8) {
        this.lastShoreWarn = this.time;
        this.toast(this.shoreText(cam.position.x, cam.position.z), 'warn', 3);
      }
    }
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
    // Phase 5: near the edge the current pushes back; touching it says why (design §1.5c)
    const edgeD = Math.min(p.x - WORLD.minX, WORLD.maxX - p.x, p.z - WORLD.minZ, WORLD.maxZ - p.z);
    let edgePushed = false, edgeShore = false;
    if (edgeD < 12) {
      const k = Math.max(0.05, edgeD / 12);
      // the message follows the closest wall the player is actually pushing on
      let best = Infinity;
      if (p.x - WORLD.minX < 12 && this.vel.x < 0) { this.vel.x *= k; edgePushed = true; if (p.x - WORLD.minX < best) { best = p.x - WORLD.minX; edgeShore = false; } }
      if (WORLD.maxX - p.x < 12 && this.vel.x > 0) { this.vel.x *= k; edgePushed = true; if (WORLD.maxX - p.x < best) { best = WORLD.maxX - p.x; edgeShore = false; } }
      if (p.z - WORLD.minZ < 12 && this.vel.z < 0) { this.vel.z *= k; edgePushed = true; if (p.z - WORLD.minZ < best) { best = p.z - WORLD.minZ; edgeShore = true; } }
      if (WORLD.maxZ - p.z < 12 && this.vel.z > 0) { this.vel.z *= k; edgePushed = true; if (WORLD.maxZ - p.z < best) { edgeShore = false; } }
    }
    // F6：海図のないエリア（流氷・ブルーホール・水中洞窟）は、縁の「流れが押し返す壁」で入れない。ゾーン判定（0.5）の手前（0.2）で止まる
    this.gateStep(p);
    const preX = p.x, preZ = p.z;
    p.x = clamp(p.x, WORLD.minX, WORLD.maxX);
    p.z = clamp(p.z, WORLD.minZ, WORLD.maxZ);
    // the pushback alone stops the player asymptotically, so the clamp rarely
    // bites: being held at the wall by the pushback counts as touching it too
    if (((p.x !== preX || p.z !== preZ) || (edgePushed && edgeD < 3)) && this.time - this.lastEdgeWarn > 4) {
      this.lastEdgeWarn = this.time;
      this.toast(edgeShore || preZ < WORLD.minZ ? 'ここから先は浜。これ以上は進めない' : '潮の流れが強い。これ以上は進めない（ボートに戻れなくなる）', 'warn', 3);
    }
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
    this.env.plankton = zoneAt(this.camera.position.x, this.camera.position.z) === 'river' ? 0 : Math.min(1, this.vel.length() / 1.5); // no night-sparkle in fresh water
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
    const d = this.bodyDepth();
    const moving = this.vel.length() > 0.5 ? 1.15 : 1;
    // cold cove without a drysuit: shivering triples air use
    const inCold = !this.ads && zoneAt(p.x, p.z) === 'cold';
    this.cold = inCold && !this.has('drysuit') ? 1 : 0;
    if (this.cold && this.time - this.coldWarned > 15) {
      this.coldWarned = this.time;
      this.audio.warn();
      this.toast(this.buff === 'nitsuke' ? '水温2℃！ まかないの煮付けのおかげで少しはましだが、エアの減りが1.5倍に' : '水温2℃！ 寒さで震えてエアの減りが3倍に（ドライスーツがあれば平気）', 'danger', 3.5);
    }
    const rate = this.ads ? 0.26 : 0.42 * (1 + d / 10) * moving * (boosting ? 1.25 : 1) * (1 + this.narc * 0.5) * (1 + this.currentF * 0.8) * this.flowAir * (this.cold ? (this.buff === 'nitsuke' ? 1.5 : 3) : 1) * (this.buff === 'sashimi' ? 0.85 : this.buff === 'fugu' ? 0.9 : 1)
      * (1 + Math.min(PENALTY.carryAirMax, this.carryKg * PENALTY.carryAirPerKg)) * (this.tut.step >= 0 ? 0.5 : 1) * (!this.ads && this.has('oldreg') ? 0.9 : 1);
    this.air = Math.max(0, this.air - rate * dt);
    this.airRate = rate;
    if (this.frame % 10 === 0) this.exploreCheck(p);
    const picked = this.finds.update(this.time, p);
    if (picked) {
      this.diveFinds.push(picked);
      this.audio.chime(true);
      this.freezeT = 0.12;
      this.toast(`「${FIND_NAME[picked]}」を拾った！ 中身はボートに戻ってから開けてみよう（持って泳ぐと少し息が上がる）`, '', 3.5);
    }
    this.scenes.update(dt, this.env.night, p, this.vel.length(), this.camera.getWorldDirection(this.tmpDir), this.env.lightOn);
    // F7 (40)：ウニ漁の間は光景の気配も出さない（掲示板のウニ漁も同じ）
    const sensed = this.frame % 15 === 0 && this.missions.active?.kind !== 'urchin' ? this.scenes.senseNear(p) : null;
    if (sensed && (!SCENES[sensed].night || this.env.night >= 0.5)) { this.audio.chime(false); this.toast(SCENES[sensed].sense, 'warn', 4); }
    if (this.tut.step < 0) this.updateEvents(dt, p);
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
    // Phase 6: stage 2 — the instruments lie briefly (disorientation); stage 3 — blackout
    if (!this.ads && this.narc >= 0.55) {
      this.narcBlurT -= dt;
      if (this.narcBlurT <= 0) { this.narcBlur = 0.4; this.narcBlurT = 2.2 + Math.random() * 1.6; }
    }
    if (this.narcBlur > 0) this.narcBlur -= dt;
    if (!this.ads && this.narc >= 0.83) {
      this.narcDeepT += dt;
      if (this.narcDeepT >= NARCOSIS.blackoutSec) { this.narcDeepT = 0; this.endDive('narcosis'); }
    } else this.narcDeepT = Math.max(0, this.narcDeepT - 2 * dt);
    if (this.air <= 0) this.endDive('blackout');
    else this.airWarnings(dt);

    // occasional requests (mini-games), not during the tutorial
    if (this.tut.step < 0) {
      this.missions.update(this.missionCtx());
      this.questT -= dt;
      if (this.questT <= 0) { this.questT = 0.5; this.questCheck(p); }
    }
    // F7 (36)：初めてのウニ漁では、持ち替えボタンを小型吹き出しで指す（一度きり）
    if (this.missions.active?.kind === 'urchin' && this.frame % 6 === 0) this.itemTip('urchin');
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
    // F7 (36)：ウニを取るのは銛（持ち替えボタンで銛に替えた状態）のときだけ。前方 1.8m 以内にウニがあるとき、銛のボタンが「突いてはがす」になる
    this.pryIdx = this.tool === 'spear' ? this.missions.pryTarget(p, this.tmpDir.set(0, 0, -1).applyQuaternion(cam.quaternion).clone()) : null;
    this.barJab = Math.max(0, this.barJab - dt);
    this.syncToolBtn();
    // the netted turtle: within reach the shutter button cuts; the knife then makes its strokes on its own (Phase 3)
    this.cutReady = this.tool === 'camera' && this.pryIdx === null && this.missions.cutReady(p);
    // Phase 5: treasure chests — the shutter button opens one within reach
    const nearChest = this.chests.update(p, dt);
    this.chestReady = this.tool === 'camera' && this.pryIdx === null && !this.cutReady ? nearChest : null;
    const cutK = this.missions.cutProgress();
    this.vmKnife.visible = cutK !== null || this.cutReady;
    if (cutK !== null) {
      // three diagonal slashes: raise, sweep down and across, back
      const n = MISSION.rescue.strokes, ph = (cutK * n) % 1, s = Math.sin(ph * Math.PI);
      // Phase 10: the tap thrusts the knife out toward the turtle first (lunge), then each stroke sweeps across the view
      const lunge = Math.max(0, 1 - cutK / 0.1);
      this.vmKnife.position.set(0.16 - s * 0.22 - lunge * 0.1, -0.1 + s * 0.04 + (1 - s) * 0.04, -0.3 - s * 0.26 - lunge * 0.14);
      this.vmKnife.rotation.set(0.35 - s * 0.9 - lunge * 0.3, 0.1 + s * 0.25, -0.5 + s * 1.3);
      if (ph > 0.4 && ph < 0.6) this.shake = Math.max(this.shake, 0.22); // the rope parts mid-stroke
      else if (ph < 0.5) this.shake = Math.max(this.shake, 0.08);
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
      this.spearT = this.urchinLoan ? null : this.creatures.findSpearTarget(cam, this.spearTool.range);
      this.updateSpearFx(dt);
      // 突いてはがす（ウニの判定は魚を突く fireSpear より先。手銛の reload は使わない）
      if (this.pryIdx !== null && this.spearAnim < 0 && this.barJab > 0 && this.vmHand.visible) this.vmHand.position.z = -0.28 - Math.sin((this.barJab / 0.25) * Math.PI) * 0.18;
      if (inp.consume('shutter')) {
        if (this.pryIdx !== null) this.pryUrchin();
        else if (this.urchinLoan) this.toast('借りたヤスはウニ専用。魚は獲れない', 'warn', 1.8);
        else this.fireSpear();
      }
    } else if (this.cutReady && inp.consume('shutter')) {
      this.missions.startCut();
      this.audio.chime(false);
    } else if (this.chestReady && inp.consume('shutter')) {
      this.openChest(this.chestReady);
    } else if (cutK !== null && inp.consume('shutter')) {
      // the strokes are already under way
    } else if (inp.consume('shutter')) {
      this.captureReq = this.target;
      this.audio.shutter();
      const f = $('flash');
      f.classList.remove('go');
      void f.offsetWidth;
      f.classList.add('go');
    }
  }

  /** テスト用：画面に映っているウニの数（取っていないもの。dist m 以内。縁の光は問わない） */
  private urchinOnScreen(dist = 1e9): number {
    const m = this.missions as unknown as { items: THREE.Vector3[]; taken: boolean[] };
    this.camera.updateMatrixWorld();
    const v = new THREE.Vector3();
    let n = 0;
    m.items.forEach((p, i) => {
      if (m.taken[i] || p.distanceTo(this.camera.position) > dist) return;
      v.copy(p).project(this.camera);
      if (v.z < 1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1) n++;
    });
    return n;
  }

  /** F7 (36)：銛でウニを 1 回突く */
  private pryUrchin(): void {
    if (this.pryIdx === null) return;
    this.audio.shutter();
    this.missions.pry(this.pryIdx, { chime: (b) => this.audio.chime(b), toast: (t, k, d) => this.toast(t, k ?? '', d), sting: (bar, text) => { this.air = Math.max(1, this.air - bar); this.shake = Math.max(this.shake, 0.7); this.audio.warn(); this.toast(text, 'danger', 2.5); } });
    this.barJab = 0.25;
    this.shake = Math.max(this.shake, 0.15);
  }

  private toolBtnHidden = true;
  /** 持ち替えボタン：手銛を持っている人は常に（川と深海を除く）、持っていない人はウニ漁の間だけ（借りた銛）。ウニ漁が終わったらカメラに戻す */
  private syncToolBtn(): void {
    const hidden = this.riverBan || this.ads || !(this.has('spear') || this.urchinLoan);
    if (hidden !== this.toolBtnHidden) { this.toolBtnHidden = hidden; $('btn-tool').classList.toggle('hidden', hidden); }
    if (this.tool === 'spear' && !this.has('spear') && !this.urchinLoan) this.setTool('camera');
  }

  /** What a request or happening needs from the dive. */
  private missionCtx(): MissionCtx {
    const p = this.camera.position;
    return {
      dt: this.lastDt, time: this.time, diveTime: this.diveTime, player: p, forward: this.tmpDir.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).clone(),
      zone: zoneAt(p.x, p.z),
      night: this.env.night >= 0.5,
      blocked: (x, z) => this.gateBlocked(x, z),
      nearbySpecies: () => this.creatures.randomNear(p, 25),
      toast: (t, k, d) => this.toast(t, k ?? '', d),
      chime: (big) => this.audio.chime(big),
      nearbyBig: () => this.creatures.randomNear(p, 30, 0.8),
      aim: () => (this.target && this.target.inRange ? { id: this.target.rt.def.id, dist: this.target.dist } : null),
      stage: (id, pose) => { if (pose) this.creatures.stage.set(id, [pose]); else this.creatures.stage.delete(id); },
      askRescue: () => this.askTurtle(),
      rescueTip: (step) => this.rescueTip(step),
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
  /** F6：その地点が、海図のないゲートの内側か（依頼の置き場所の確認用） */
  private gateBlocked(x: number, z: number): boolean {
    const known = this.discovered;
    return GATE.areas.some((a) => !known.has(a) && !this.gateFree.has(a) && gateWeight(a, x, z) >= GATE.edge);
  }

  /** F6：海図がない（discovered にない）ゲート対象のエリアに近づくと、壁に向かう速度を弱め、壁に触れたらトースト。壁の内側に入っていたら押し戻す */
  private gateStep(p: THREE.Vector3): void {
    const known = this.discovered;
    for (const a of GATE.areas) {
      if (known.has(a) || this.gateFree.has(a)) continue;
      const w = gateWeight(a, p.x, p.z);
      if (w < GATE.soft) continue;
      let gx = gateWeight(a, p.x + 1, p.z) - gateWeight(a, p.x - 1, p.z);
      let gz = gateWeight(a, p.x, p.z + 1) - gateWeight(a, p.x, p.z - 1);
      const gl = Math.hypot(gx, gz);
      if (gl < 1e-6) continue;
      gx /= gl; gz /= gl; // 壁の内側（重みが増える向き）
      const inward = this.vel.x * gx + this.vel.z * gz;
      let touched = false;
      if (w >= GATE.edge) {
        for (let i = 0; i < 80 && gateWeight(a, p.x, p.z) >= GATE.edge; i++) { p.x -= gx * 0.5; p.z -= gz * 0.5; }
        touched = true;
        if (inward > 0) { this.vel.x -= gx * inward; this.vel.z -= gz * inward; }
      } else if (inward > 0) {
        const k = clamp((GATE.edge - w) / (GATE.edge - GATE.soft), 0.03, 1);
        this.vel.x -= gx * inward * (1 - k); this.vel.z -= gz * inward * (1 - k);
        touched = w > GATE.edge * 0.75;
      }
      if (touched && this.time - this.lastGateWarn > GATE.toastEvery) {
        this.lastGateWarn = this.time;
        this.toast(GATE.text, 'warn', 3);
      }
    }
  }

  private exploreCheck(p: THREE.Vector3): void {
    const z = zoneAt(p.x, p.z);
    const id = z === 'offshore' ? 'dropoff' : z;
    const dp = DIVE_POINTS.find((d) => d.id === id);
    if (!dp) return;
    const fromChart = this.discovered.has(id);
    if (!this.ads && id !== 'deep') this.discover(id);
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
  /** Hide the new-map banner and drop what is queued (dive start / end: the banner is only updated while diving). */
  private clearMapFound(): void {
    this.mapFoundQ.length = 0;
    this.mapFoundT = 0;
    $('map-found').classList.add('hidden');
  }
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
  /** F7 (36)：手銛を持っていない人は、ウニ漁の間だけ漁協から借りたウニ用の銛（ヤス）を持つ。魚は獲れない */
  private get urchinLoan(): boolean {
    return !this.has('spear') && this.missions.active?.kind === 'urchin';
  }
  private get spearTool() {
    if (this.urchinLoan) return LOAN_SPEAR;
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
    if (t === 'spear' && this.urchinLoan) this.toast('漁協のヤスに持ち替えた。ウニに近づいて3回突いてはがそう（魚は獲れない）', '', 3);
    else if (t === 'spear' && !this.diveCatch.length && !this.save.cooler?.length) this.toast(`${this.spearTool.name}に持ち替えた。魚に${this.spearTool.range}mまで近づいて突こう`, '', 3);
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

  /**
   * Phase 11: a thrust at a charging aggro animal. Returns true when the thrust was resolved here (repelled,
   * or a miss with a hint); the animal is never taken. Window and tiers: FISHING.repel / repelTier.
   */
  /** The repel window for a charging aggro animal: tier, whether it is inside the window, already reached, or in the "just" band. */
  private repelInfo(t: NonNullable<Game['spearT']>): { tierOk: boolean; reached: boolean; inReach: boolean; just: boolean } {
    const T = this.spearTool;
    const R = FISHING.repel;
    const def = t.rt.def;
    const hitD = def.size * 0.45 + R.hitBase;
    const d = t.agent.p.distanceTo(this.camera.position);
    const band = Math.min(R.justBand, (def.aggro?.speed ?? 3) * R.justSec);
    return { tierOk: T.tier >= repelTier(def), reached: d < hitD, inReach: d - def.size * 0.45 <= T.repelReach, just: d <= hitD + band };
  }

  /** Can this target be repelled right now? (a territory animal still posturing, modeT > 0, is not charging yet) */
  private repelling(t: NonNullable<Game['spearT']>): boolean {
    const ag = t.rt.def.aggro;
    return !!ag && !!t.agent.aggro && t.agent.mode === 2 && !(ag.kind === 'territory' && (t.agent.modeT ?? 0) > 0);
  }

  private tryRepel(t: NonNullable<Game['spearT']>): boolean {
    const T = this.spearTool;
    const R = FISHING.repel;
    const def = t.rt.def;
    const a = t.agent;
    const w = this.repelInfo(t);
    if (!w.tierOk) {
      this.spearTo.copy(a.p);
      this.toast(T.tier === 0 ? `${T.name}ではサメに効かない！` : `${T.name}では${def.name}を退けられない！ 大物用水中銃が要る`, 'warn', 2.2);
      return true;
    }
    if (w.reached || !w.inReach) {
      // out of the window (too far / already reached): an ordinary miss, the reload stays spent
      this.spearTo.copy(a.p);
      this.toast(w.reached ? '間に合わなかった…' : '突きが届かない… もっと引きつけてから突こう', 'warn', 1.8);
      return true;
    }
    const just = w.just;
    this.spearTo.copy(a.p);
    this.creatures.repel(a, just ? R.justCooldown : R.cooldown);
    this.toast(just ? `ジャスト！ 突きが届いた！ ${def.name}が退いた` : `突きが届いた！ ${def.name}が退いた`, '', 2.4);
    this.audio.chime(just);
    this.freezeT = 0.1;
    this.shake = Math.max(this.shake, just ? 0.5 : 0.3);
    try { navigator.vibrate?.(just ? 60 : 35); } catch { /* not supported */ }
    return true;
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
    if (this.repelling(t) && this.tryRepel(t)) return;
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
    const chIdx = this.save.storyMain ?? 0;
    if (this.chapter?.tips && this.tut.step < 0 && !this.sDoneCh.has(chIdx)) {
      const tip = sAdvice(ev);
      this.toast(tip ? `Sまであと少し！ ${tip}` : '編集長「これがSだ！」', tip ? 'warn' : '', 3);
      if (!tip) this.sDoneCh.add(chIdx);
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
    delete el.dataset.dex;
    el.classList.remove('hidden', 'known');
    const dp = $('disc-photo') as HTMLImageElement; dp.style.display = ''; dp.src = photo;
    $('disc-tag').textContent = first ? '実績解除！ 特別な光景' : '特別な光景';
    $('disc-name').textContent = SCENES[id].name;
    $('disc-sci').textContent = first ? 'めったに見られない瞬間を撮った！' : 'また出会えた！';
    $('disc-pay').textContent = `+${yen(pay)}`;
    $('disc-grade').classList.add('hidden');
    this.discoverTimer = 4.5;
  }

  /** F8 (4)：今の時間帯・天気でこのスポットが撮れるか（条件に合わない日は気配も円も出ず、撮っても写らない） */
  private spotNow(s: SpotDef): boolean {
    return spotOpen(s, this.weather, this.env.night);
  }

  private evV = new THREE.Vector3();

  /**
   * F8 (4)(20)：潜水中のイベントの見せ方。①章の光景の場所の手がかり（潜り始め）②写真スポットの「見どころが近い…」③光景の主役が視界に入った帯。
   * ウニ漁の間は光景の気配と同じく出さない（F7 (40)）。
   */
  private updateEvents(dt: number, p: THREE.Vector3): void {
    if (this.bannerT > 0) {
      this.bannerT -= dt;
      if (this.bannerT <= 0) $('scene-banner').classList.remove('show');
    }
    if (this.frame % 6 !== 0 || this.state !== 'diving') return;
    if (this.sceneLine) {
      if (this.time > this.sceneLine.until) this.sceneLine = null;
      else if (this.time >= this.tipUntil && !this.talk.active) { this.talk.showMini('editor', this.sceneLine.text, 5); this.sceneLine = null; }
    }
    const urchin = this.missions.active?.kind === 'urchin';
    // ① 章の光景は円を最初から出さない代わりに、編集長が場所の手がかりを言う（章の intro と同じ内容）
    const st = this.stagedScene;
    if (!this.clueSaid && st && this.diveTime > 4 && !this.talk.miniOpen && !this.talk.active && !urchin) {
      this.clueSaid = true;
      const clue = SCENE_CLUE[st];
      if (clue && !this.save.scenes?.[st]) this.talk.showMini('editor', clue, 9);
    }
    if (urchin) return;
    // ② 写真スポット：45m 以内に近づくと気配が出て、そこから円を出す
    const done = new Set([...(this.save.spots ?? []), ...this.pendingSpots]);
    for (const s of SPOTS) {
      if (this.spotHinted.has(s.id) || done.has(s.id) || !this.spotNow(s)) continue;
      if (!(this.discovered.has(s.point) || (s.point === 'deep' && this.ads))) continue;
      if (Math.hypot(p.x - s.x, p.z - s.z) > spotHintDist(s)) continue;
      this.spotHinted.add(s.id);
      this.audio.chime(false);
      const text = `${s.name}の見どころが近い…`;
      if (!this.talk.miniOpen && !this.talk.active) this.talk.showMini('editor', text, 4); else this.toast(text, 'warn', 3.5);
      break;
    }
    // ③ 光景の主役（star の個体、または粒子の演出）が画面内・25m 以内に入った瞬間
    for (const id of this.scenes.active) {
      if (this.sceneAnnounced.has(id) || this.pendingScenes.has(id)) continue;
      const S = SCENES[id];
      if (S.night && this.env.night < 0.5) continue;
      let seen = false;
      if (S.star) {
        for (const q of this.scenes.starPositions(id)) {
          if (q.distanceTo(this.camera.position) > SCENE_SEE.dist) continue;
          this.evV.copy(q).project(this.camera);
          if (this.evV.z < 1 && Math.abs(this.evV.x) < 1 && Math.abs(this.evV.y) < 1) { seen = true; break; }
        }
      } else seen = this.scenes.particlesInView(this.camera) === id;
      if (seen) { this.announceScene(id); break; }
    }
  }

  /** F8 (20)：専用の帯（上部・金色の縁・「特別な光景 ◯◯」を 3 秒）＋チャイム＋小型吹き出しで編集長のひとこと。操作は止めない */
  private announceScene(id: SceneId): void {
    this.sceneAnnounced.add(id);
    $('sb-name').textContent = SCENES[id].name;
    $('scene-banner').classList.add('show');
    this.bannerT = SCENE_SEE.bannerSec;
    this.audio.chime(true);
    const talked = (this.save.talked ??= []);
    const first = !talked.includes('sceneFirst') && !Object.keys(this.save.scenes ?? {}).length;
    if (first) { talked.push('sceneFirst'); this.writeSave(); }
    const line = first ? 'これはすごい…！ 撮影しよう' : SCENE_SEE.lines[(this.save.dives + this.sceneAnnounced.size) % SCENE_SEE.lines.length];
    // 道具の説明などの小型吹き出しが出ている間は、それが閉じてから（12 秒以内）言う。帯とチャイムは先に出す
    if (this.time >= this.tipUntil && !this.talk.active) this.talk.showMini('editor', line, 5);
    else this.sceneLine = { text: line, until: this.time + 12 };
  }

  /** F8 (20)：先に出ている小型吹き出しがあって言えなかった編集長のひとこと */
  private sceneLine: { text: string; until: number } | null = null;
  /** 道具の説明・ウミガメの操作の説明の小型吹き出しを出している間は、そのゲーム内の時刻まで、光景のひとことで上書きしない */
  private tipUntil = 0;

  /** F8 (22)：ウミガメが見つかった。潜水を止めて漁師の吹き出し（選ぶ段・暗くする）。true＝助ける */
  private async askTurtle(): Promise<boolean> {
    this.paused = true;
    this.input.reset();
    this.talk.hideMini();
    let ok = false;
    try {
      const r = await this.talk.run([{ who: 'gen', text: '網に絡まったウミガメがいる！ 助けてくれないか？', choices: [{ id: 'help', label: '助ける' }, { id: 'skip', label: '今はやめる' }] }]);
      ok = !r.skipped && r.choice === 'help';
    } finally {
      if (this.state === 'diving') { this.paused = false; this.clock.getDelta(); this.input.reset(); }
    }
    return ok;
  }

  /** F8 (22)：初めて［助ける］を選んだときだけ、操作のチュートリアル（小型吹き出し 3 段：円の中 → ナイフのボタン → ついてくる） */
  private rescueTip(step: 1 | 2 | 3): void {
    const talked = (this.save.talked ??= []);
    if (step === 1) {
      if (talked.includes('turtleHow')) return;
      talked.push('turtleHow');
      this.writeSave();
      this.turtleTut = true;
      this.tipUntil = this.time + 7;
      this.talk.showMini('gen', 'マップの金色の円の中にいる。そこまで泳ごう。', 7, '#minimap-btn');
    } else if (!this.turtleTut) return;
    else if (step === 2) { this.tipUntil = this.time + 6; this.talk.showMini('gen', '近づいて、ナイフのボタンをタップ。', 8, '#btn-shutter'); }
    else { this.turtleTut = false; this.tipUntil = this.time + 6; this.talk.showMini('gen', '助けたウミガメは、このダイブの間ついてくる。', 6); }
  }

  /** Circles for the sights of this dive: the staged one from the start, lucky ones once sensed; gone once photographed. */
  private sceneMarks(): { x: number; z: number; rare: boolean; r: number }[] {
    const out: { x: number; z: number; rare: boolean; r: number }[] = [];
    if (this.missions.active?.kind === 'urchin') return out; // F7 (40)：ウニ漁の間は光景の円も出さない
    for (const [id, c] of this.scenes.centre) {
      if (!this.scenes.active.has(id) || this.pendingScenes.has(id)) continue;
      // F8 (4)：章の光景も、最初から円は出さない。近づいて気配の表示が出てから（章の光景が最初の 1 回は必ず出る決まりは startDive のまま）
      if (!this.scenes.sensed.has(id)) continue;
      out.push({ x: c.x, z: c.z, rare: true, r: SCENE_AT[id]?.r ?? 30 });
    }
    return out;
  }

  /** Aqua circles for the photo spots not yet shot, on known maps only. */
  private spotMarks(): { x: number; z: number; rare: boolean; r: number; spot: boolean }[] {
    const known = this.discovered;
    const done = new Set([...(this.save.spots ?? []), ...this.pendingSpots]);
    // F8 (4)：ヒント（「見どころが近い…」）が出たスポットだけ円を出す。撮った所・今日の時間帯と天気で撮れない所は出さない
    return SPOTS.filter((s) => !done.has(s.id) && this.spotHinted.has(s.id) && this.spotNow(s) && (known.has(s.point) || (s.point === 'deep' && this.ads))).map((s) => ({ x: s.x, z: s.z, rare: false, r: s.r ?? SPOT.r, spot: true }));
  }

  /** A shot framing a photo spot: pays once, the first time (Phase 3). Returns whether a spot was in the frame. */
  private spotShot(photo: string, creature: boolean): boolean {
    if (this.tut.step >= 0) return false;
    const s = spotInView(this.camera, (q) => this.spotNow(q));
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
    const dp = $('disc-photo') as HTMLImageElement; dp.style.display = ''; dp.src = photo;
    delete el.dataset.dex;
    $('disc-tag').textContent = '写真スポット';
    $('disc-name').textContent = s.name;
    $('disc-sci').textContent = s.desc;
    $('disc-pay').textContent = `+${yen(s.pay)}`;
    $('disc-grade').classList.add('hidden');
    this.discoverTimer = 4;
    return true;
  }

  /** Phase 9 S6: charts a found box can hold — maps not yet known, and only maps where creatures live. */
  /** F6：拾い物の海図は、入手元がほかにあるエリア（ゲートの 3 つと深海）からは出さない（海図の入手元は 1 つだけ） */
  private chartCandidates(): { id: string; name: string }[] {
    return DIVE_POINTS.filter((d) => !this.discovered.has(d.id) && d.id !== 'lagoon' && !CHART_ONLY.has(d.id) && SPECIES.some((sp) => sp.zone === d.id || (d.id === 'dropoff' && sp.zone === 'offshore'))).map((d) => ({ id: d.id, name: d.name }));
  }

  /** Phase 5: open a permanent treasure chest. Saved at once, like sights and the dex. */
  private openChest(id: string): void {
    const def = CHESTS.find((c) => c.id === id);
    if (!def || (this.save.chests ?? []).includes(id)) return;
    this.save.chests = [...(this.save.chests ?? []), id];
    this.chests.open(id);
    this.audio.chime(true);
    this.freezeT = 0.25;
    this.shake = Math.max(this.shake, 0.4);
    if (def.gear) {
      this.save.owned = [...new Set([...(this.save.owned ?? []), def.gear])];
      const g = CHEST_GEAR[def.gear];
      this.chestCard('宝箱で見つけた装備', g.name, g.desc, '');
      // F5：結果カードの後に 1 段
      window.setTimeout(() => this.itemTip(def.gear!), 5400);
    } else {
      // a page of an old notebook: an unphotographed sight, this map's first, unhinted first
      const unshot = (Object.keys(SCENES) as SceneId[]).filter((x) => !this.save.scenes?.[x]);
      const hinted = new Set(this.save.sceneHints ?? []);
      const pick = unshot.find((x) => SCENES[x].points.includes(def.map) && !hinted.has(x))
        ?? unshot.find((x) => SCENES[x].points.includes(def.map))
        ?? unshot.find((x) => !hinted.has(x))
        ?? unshot[0];
      if (pick) {
        this.save.sceneHints = [...new Set([...hinted, pick])];
        // F8 (3)：潜水中は短く（読むのは浮上してから）。手記はセーブの journals に拾った順で残す
        const jr = (this.save.journals ??= []);
        if (!jr.some((j) => j.scene === pick)) jr.push({ scene: pick, t: Date.now() });
        if (!this.journalQueue.includes(pick)) this.journalQueue.push(pick);
        this.talk.showMini('editor', '古い手記の切れはしを拾った…（浮上してから読もう）', 6);
      } else {
        this.save.money = (this.save.money ?? 0) + CHEST.silver;
        this.chestCard('宝箱', '古い銀貨', '手記はもう残っていなかった。代わりに古い銀貨が入っていた', `+${yen(CHEST.silver)}`);
      }
    }
    this.writeSave();
  }

  /** The discover card, without a photo (treasure contents). */
  private chestCard(tag: string, name: string, text: string, pay: string): void {
    const el = $('discover');
    delete el.dataset.dex;
    el.classList.remove('hidden', 'known');
    ($('disc-photo') as HTMLImageElement).style.display = 'none';
    $('disc-tag').textContent = tag;
    $('disc-name').textContent = name;
    $('disc-sci').textContent = text;
    $('disc-pay').textContent = pay;
    $('disc-grade').classList.add('hidden');
    this.discoverTimer = 5;
  }

  private showDiscover(id: string, photo: string, isNew: boolean, ev?: ReturnType<typeof evaluateShot>, paid = 0, better?: Shot, record = false): void {
    const s = SPECIES_BY_ID.get(id)!;
    const el = $('discover');
    el.dataset.dex = id;
    el.classList.remove('hidden');
    el.classList.toggle('known', !isNew);
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = '';
    const dp2 = $<HTMLImageElement>('disc-photo'); dp2.style.display = ''; dp2.src = photo;
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

  private static readonly _fwd = new THREE.Vector3();
  /** Phase 6: the depth of the centre of the (horizontal, ~1.7 m) body, not the head:
      the centre sits 0.85 m behind the eyes along the look axis. */
  /** Phase 9: what the shore says: the waterfall's cliff, the river's bank, or the beach */
  private shoreText(x: number, z: number): string {
    if (Math.hypot(x - WATERFALL.x, z - WATERFALL.z) < 15) return '滝の上へは登れない';
    if (z < -285 && z > -660) { const r = riverDist(x, z); if (r.d < r.w + 8) return 'ここから先は川岸。陸には上がれない'; }
    return 'ここから先は浜。これ以上は進めない';
  }
  private bodyDepth(): number {
    const p = this.camera.position;
    this.camera.getWorldDirection(Game._fwd);
    return Math.max(0, -p.y + Game._fwd.y * 0.85);
  }
  /** Phase 6: the heading the instruments show — narcosis stage 2 falsifies it briefly. */
  private displayYaw(): number { return this.yaw + (this.narcBlur > 0 ? 2.2 : 0); }

  /** (8) at most two warnings per dive: the tank is half gone, and the last stretch (few bar or ~30 s of air left) */
  private airWarnings(_dt: number): void {
    if (this.airWarned >= 2) return;
    const left = this.air / Math.max(0.01, this.airRate);
    if (this.air < AIR_WARN.lastBar || left < AIR_WARN.lastSec) {
      this.airWarned = 2;
      this.audio.warn(true);
      this.toast('エアがあとわずか！ すぐに浮上しよう', 'danger', 3);
    } else if (this.airWarned < 1 && this.air / this.airMax < AIR_WARN.halfFrac) {
      this.airWarned = 1;
      this.audio.warn();
      this.toast('エアが半分を切った… 戻り始めよう', 'warn', 3);
    }
  }

  private updateHud(dt: number): void {
    const p = this.camera.position;
    const d = this.bodyDepth();
    // (13) narcosis stage 2: the depth readout flickers (the old heading read-out is gone)
    $('depth-value').textContent = this.narcBlur > 0 ? Math.max(0, d + (Math.sin(this.time * 41) > 0 ? 1 : -1) * (1.5 + 6 * ((this.time * 7) % 1))).toFixed(1) : d.toFixed(1);
    $('zone-name').textContent = ZONE_NAMES[zoneAt(p.x, p.z)];
    $('depth-warn').classList.toggle('hidden', this.ads || (d < 40 && this.currentF < 0.1 && !this.cold));
    $('depth-warn').textContent = this.narcDeepT > 0 ? (NARCOSIS.blackoutSec - this.narcDeepT <= NARCOSIS.warnLeftSec ? '窒素酔い：もうすぐ意識を失う！ 浅い所へ' : '窒素酔い：このままでは意識を失う') : this.currentF >= 0.1 ? 'ダウンカレント' : this.cold ? '低水温' : d > 52 ? '限界深度に接近' : '窒素酔い：エア消費増・視界が揺れる';
    const frac = this.air / this.airMax;
    $('air-value').textContent = String(Math.ceil(this.air));
    $('air-ring').style.strokeDashoffset = String(169.6 * (1 - frac));
    const air = $('air');
    air.classList.toggle('crit', this.airWarned >= 2);
    air.classList.toggle('low', frac < AIR_WARN.halfFrac && this.airWarned < 2);
    $('narc').style.opacity = String(this.narc * 0.8);
    $('narc').classList.toggle('deep', this.narcDeepT >= NARCOSIS.blackoutSec * 0.5);
    if (this.minimap && this.frame % 10 === 0) {
      if (this.has('sonar') && this.frame % 20 === 0) this.sonarBlips = this.creatures.sonar(p, 45, (id) => !!this.save.found[id] || this.pending.has(id));
      this.minimap.blips = [...(this.has('sonar') ? this.sonarBlips : []), ...this.missions.marks(), ...this.sceneMarks(), ...this.spotMarks(), ...(this.save.quests ?? []).filter((q) => q.kind !== 'photo' && q.id !== this.activeQuest).map((q) => ({ x: q.x, z: q.z, rare: true, r: QUEST.arrive }))];
    }
    this.minimap?.update(p.x, p.z, this.displayYaw(), this.boatPos(), false, this.has('compass'));
    if (this.minimap?.open && this.frame % 6 === 0) this.minimap.drawBig(p.x, p.z, this.displayYaw(), this.boatPos());

    this.refreshBaitUi();
    const sb = $('surface-btn');
    const can = this.canSurface();
    sb.classList.toggle('hidden', !can);
    $('surface-text').textContent = this.ads ? 'ウインチで回収してもらう' : '浮上してボートに戻る';

    // reticle
    const ret = $('reticle');
    ret.classList.remove('idle');
    const lab = $('ret-label');
    const t = this.target;
    const cc = $('catch-chip');
    cc.classList.toggle('hidden', this.urchinLoan ? true : this.tool !== 'spear' && !this.diveCatch.length);
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
    if (this.chestReady) {
      ret.classList.add('lock');
      ret.classList.remove('far');
      lab.innerHTML = `宝箱<small>タップで開ける</small>`;
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
      lab.innerHTML = `ウニ<small>銛で突いてはがす（あと${this.missions.pryLeft(this.pryIdx)}回突く）</small>`;
      $('btn-shutter').classList.add('ready');
      return this.updateToasts(dt);
    }
    if (this.tool === 'spear') {
      const st = this.spearT;
      // Phase 11: a charging aggro animal is judged by the repel window, not by the catch rules
      const rep = st && this.repelling(st) ? this.repelInfo(st) : null;
      const block = rep ? (!rep.tierOk ? `${this.spearTool.name}では退けられない` : rep.reached ? '間に合わない…' : !rep.inReach ? '引きつけてから突く（撃退）' : null) : st ? this.spearBlock(st) : null;
      ret.classList.toggle('lock', !!st && !block);
      ret.classList.toggle('far', !!st && !!block);
      ret.classList.toggle('idle', !st); // (43) 魚が枠にいないときは薄く
      $('btn-shutter').classList.toggle('ready', !!st && !block && this.reload <= 0);
      if (st) {
        const def = st.rt.def;
        const known = this.save.found[def.id] || this.pending.has(def.id);
        const kg = weightOf(def, st.agent.s);
        const sub = rep ? (block ?? `<span class="gA">${rep.just ? 'ジャスト！ 今だ（撃退）' : '突け！（撃退）'}</span>`) : (block ?? `<span class="gA">命中 ${Math.round(this.hitChance(st) * 100)}%</span>　約${fmtKg(kg)}${st.speed > 0.6 ? '　動きが速い' : st.ang > 0.12 ? '　中心で狙う↑' : ''}`) + this.spearWarn(st);
        lab.innerHTML = `${known ? def.name : '？？？'}<small>${sub}</small>`;
      } else lab.innerHTML = this.urchinLoan ? `<small>${this.spearTool.name}（ウニ専用）— ウニに近づいて突く</small>` : `<small>${this.spearTool.name}（射程${this.spearTool.range}m）— 魚に近づいて中央で狙う</small>`;
      return this.updateToasts(dt);
    }
    ret.classList.toggle('lock', !!t && t.inRange);
    ret.classList.toggle('far', !!t && !t.inRange);
    ret.classList.toggle('idle', !t); // (43)
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
    if (this.frame % RENDER.checkFrames === 0) this.adaptResolution();
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
      this.creatures.focus = this.state === 'diving' ? this.target?.agent ?? null : null;
      this.creatures.update(dt, cp, this.vel, this.camera.getWorldDirection(this.tmpDir));
    }
    if (this.state === 'diving' && !this.paused) this.updateBaitVisual(dt);
    this.flora.update(cp, this.time);
    this.env.update(dt, this.camera, this.renderer, this.time);
    this.waterfall.update(dt, this.camera, this.time);
    // image-based fill only adds sheen near the surface; it must not flatten the sun/shade contrast
    this.scene.environmentIntensity = (0.22 * Math.exp(Math.min(0, this.camera.position.y) / 25) + 0.01) * (1 - this.env.darkness * 0.95);
    if (this.state === 'diving' && !this.paused) this.updateHud(dt);
    else this.updateToasts(rawDt);

    // ambience
    const reefNear = ['reef', 'rocky', 'lagoon'].includes(zoneAt(cp.x, cp.z)) ? clamp(1 - -cp.y / 40, 0, 1) * 0.25 : 0;
    // whale song fades with the square of the distance falloff (Phase 10): a linear fade still
    // reads as loud halfway across the 160 m range, the square puts 80 m at a quarter volume
    const whaleLin = clamp(1 - this.creatures.nearestOf('humpback', cp) / 160, 0, 1);
    const whale = whaleLin * whaleLin;
    const deep = clamp((-cp.y - 120) / 150, 0, 1);
    this.audio.update(dt, { diving: this.state === 'diving' && !this.paused, depth: -cp.y, reef: this.state === 'diving' ? reefNear : reefNear * 0.4, whale, deep, air: this.air });

    this.diag.beforeRender();
    this.renderer.render(this.scene, this.camera);
    this.diag.afterRender(this.creatures);
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
      creatures: { ...this.creatures.stats(), ...this.creatures.lodCounts() },
      diag: this.diag.values(this.creatures),
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
      bluehole: { x: BLUEHOLE.x, y: -9, z: BLUEHOLE.z - 55, yaw: Math.PI, pitch: -0.45 },
      cave: { x: -326, y: -20, z: 856, yaw: Math.PI * 0.82, pitch: -0.05 },
      kelp: { x: 330, y: -8, z: 150, yaw: Math.PI, pitch: 0.1 },
      surface: { x: 0, y: -4, z: 480, yaw: Math.PI, pitch: 0.75 },
      deep: { x: VENT.x - 14, y: heightAt(VENT.x - 14, VENT.z - 22) + 6, z: VENT.z - 22, yaw: Math.PI * 0.8, pitch: -0.15, light: true },
    };
    (window as unknown as Record<string, unknown>).__THREE_GAME_TEST_HOOKS__ = {
      game: this,
      /** Phase 9: seabed / land height at (x, z) and its zone */
      heightAt: (x: number, z: number) => heightAt(x, z),
      /** 修正バッチ2 F2: 足元の高さ（岩・サンゴ頭の上面を含む） */
      surfaceAt: (x: number, z: number) => surfaceAt(x, z),
      zoneAt: (x: number, z: number) => zoneAt(x, z),
      /** F6：ゲートの重み（'cold' | 'bluehole' | 'cave'）と、その地点が海図のないゲートの内側か */
      gateWeight: (a: 'cold' | 'bluehole' | 'cave', x: number, z: number) => gateWeight(a, x, z),
      gateBlocked: (x: number, z: number) => this.gateBlocked(x, z),
      riverDist: (x: number, z: number) => { const r = riverDist(x, z); return { d: r.d, w: r.w }; },
      /** Phase 9 S1: the estuary's water table (zone base + salt-wedge layers) */
      estuaryWater: () => ({ base: ZONE_WATER.estuary, wedge: ESTUARY_WEDGE }),
      /** Phase 9 S1: water flow (m/s) at (x, z) */
      flowAt: (x: number, z: number, y?: number) => { const o = { x: 0, z: 0 }; flowAt(x, z, o, y); return o; },
      /** Phase 9 S2: the river's water table, the camera's river position / foam, the waterfall, the last air multiplier from flow */
      riverWater: () => ({ table: RIVER_WATER, zone: ZONE_WATER.river, t: this.env.riverT, foam: this.env.foamK, fall: WATERFALL, flowAir: this.flowAir, shore: (x: number, z: number) => this.shoreText(x, z) }),
      /** Phase 9 S3: number of points in a Homes list (estChannel, estFlat, mangrove, reed, riverLow, riverRiffle, riverPool, riverUp, riverStones, riverSand), the points themselves, and the scenery's instance counts */
      homesCount: (name: string) => ((this.flora.homes as unknown as Record<string, unknown[] | undefined>)[name] ?? []).length,
      homesList: (name: string) => ((this.flora.homes as unknown as Record<string, THREE.Vector3[] | undefined>)[name] ?? []).map((v) => [v.x, v.y, v.z]),
      offerMission: () => { this.missions.forceOffer = true; },
      /** Phase 3: photo spots with their focus points */
      spots: () => SPOTS.map((sp) => { const f = spotFocus(sp); return { id: sp.id, x: f.x, y: f.y, z: f.z, r: sp.r ?? SPOT.r, when: sp.when ?? null, open: this.spotNow(sp) }; }),
      startMission: (k: 'urchin' | 'trash' | 'photo' | 'lost' | 'treasure' | 'rescue' | 'survey' | 'tag') => { this.missions.force = k; },
      /** F7：ウニ漁の状態（群れの中心・各ウニの位置と種類・取った印・報酬・夜か・持ち替え状態） */
      urchinInfo: () => {
        const m = this.missions as unknown as { items: THREE.Vector3[]; taken: boolean[]; itemType: number[] };
        const a = this.missions.active;
        return a?.kind === 'urchin' ? {
          clusters: this.missions.clusters, reward: a.reward, need: a.need, got: a.got, time: a.t, loan: this.urchinLoan, tool: this.tool,
          pryIdx: this.pryIdx, btnToolHidden: this.toolBtnHidden, glow: this.missions.glowNow(), clear: this.lastClear, onScreen: this.urchinOnScreen(), onScreen15: this.urchinOnScreen(15), items: m.items.map((v, i) => ({ x: v.x, y: v.y, z: v.z, type: m.itemType[i], taken: m.taken[i] })),
        } : null;
      },
      /** F7：ウニ漁の最中に、カメラの正面 d m・高さそのままの位置へ（ウニの真上ではなく手前）移動して向きをウニに向ける */
      faceUrchin: (i: number, back = 1.2) => {
        const m = this.missions as unknown as { items: THREE.Vector3[] };
        const u = m.items[i];
        this.camera.position.set(u.x, u.y + 0.45, u.z + back);
        this.yaw = 0;
        this.pitch = -0.3;
        return true;
      },
      press: (n: string) => this.input.press(n),
      /** F7：ボートで向かう演出の 1 コマを描いて見せる（スクリーンショット用）。e は進み具合 0〜1 */
      travelPreview: (id: string, e: number) => {
        const dp = DIVE_POINTS.find((d) => d.id === id) ?? DIVE_POINTS[1];
        $('travel').classList.remove('hidden');
        $('tv-name').textContent = dp.name;
        $('tv-depth').textContent = `水深 ${Math.max(1, Math.round(-heightAt(dp.x, dp.z)))}m`;
        $('tv-name').parentElement!.classList.add('show');
        this.ensureMinimap().drawRoute($<HTMLCanvasElement>('tv-canvas'), PORT, dp, e, { dark: 0, name: dp.name, port: true });
        return true;
      },
      travelPreviewOff: () => { $('travel').classList.add('hidden'); },
      /** F7：掲示板のウニ漁を、いまの位置の 8m 前で始める（報酬は掲示板の値） */
      beginUrchin: (reward: number) => { const at = this.camera.position.clone().addScaledVector(new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)), 6); at.y = heightAt(at.x, at.z); this.missions.begin('urchin', this.missionCtx(), at, undefined, reward); return true; },
      missionReset: () => this.missions.reset(),
      scenesInfo: () => ({ active: this.scenes.active.size, marks: this.sceneMarks().length }),
      me: () => ({ x: this.camera.position.x, y: this.camera.position.y, z: this.camera.position.z }),
      setToolHook: (t: 'camera' | 'spear') => this.setTool(t),
      /** F7：ウニ漁を終えて店に戻る（ok=達成扱い） */
      finishUrchin: (ok = true) => { if (this.quick) { this.quick.ok = ok; this.quick.done = true; this.endDive('surface'); } },
      /** F7：演出の状態（夜明け・移動）と、ボートの位置 */
      transit: () => ({ dawning: this.dawning, traveling: this.traveling, boatAt: this.boatAt, morningDue: this.morningDue, diveNight: this.diveNight, state: this.state }),
      currents: () => this.currents,
      /** Phase 5: treasure chests (id, position, opened) */
      /** Phase 9 S6: chart candidates of a found box, the kitchen's order pool, a board request from a seeded generator */
      chartCandidates: () => this.chartCandidates().map((d) => d.id),
      orderPool: () => (this.kitchen as unknown as { pool: (l: number) => { zone: string; name: string }[] }).pool(99).map((d) => ({ zone: d.zone, name: d.name })),
      makeQuest: (known: string[], seed: number) => {
        let st = seed >>> 0; // mulberry32
        const q = makeQuest(new Set(known), () => { st = (st + 0x6d2b79f5) >>> 0; let t = Math.imul(st ^ (st >>> 15), 1 | st); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; });
        return q ? { kind: q.kind, zone: q.zone, x: q.x, z: q.z, title: q.title } : null;
      },
      chests: () => this.chests.list(),
      openChest: (id: string) => { this.openChest(id); },
      goChest: (id: string) => {
        const c = this.chests.list().find((x) => x.id === id);
        if (!c) return null;
        this.camera.position.set(c.x + 1.2, c.y + 0.7, c.z);
        this.terrain.prime(c.x, c.z, 80);
        return c;
      },
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
          this.startDive(DIVE_POINTS.find((d) => d.id === (name === 'deep' ? 'deep' : 'reef')) ?? DIVE_POINTS[1], false, false, true);
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
      /** Phase 10: the cutting motion's state (progress, ropes snapped, net opacity) */
      cutFx: () => this.missions.cutFx(),
      curiousConsts: () => ({ ...CURIOUS }),
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
      /** Fix batch 1 (P4-1): the diet the bait system infers for a species id */
      /** Phase 9 S4: what happens if this species is speared (protected / poison / category) */
      edible: (id: string) => { const d = SPECIES_BY_ID.get(id); return d ? edibleInfo(d) : undefined; },
      dietOf: (id: string) => { const d = SPECIES_BY_ID.get(id); return d ? dietOf(d) : undefined; },
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
