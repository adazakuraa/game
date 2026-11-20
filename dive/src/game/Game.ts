import * as THREE from 'three';
import { Missions } from './missions';
import { evaluateShot, LEGACY_NEED, PHOTO, SHOP, yen, type GearId } from './photoScore';
import { patchFogChunks, UW } from '../render/underwater';
import { Terrain } from '../world/terrain';
import { Environment } from '../world/environment';
import { Flora } from '../world/flora';
import { Creatures, type PhotoTarget } from '../life/creatures';
import { SPECIES, SPECIES_BY_ID, ZONE_ORDER } from '../life/species';
import { DIVE_POINTS, heightAt, VENT, WORLD, WRECK, zoneAt, ZONE_NAMES, type DivePoint } from '../world/layout';
import { Input } from '../core/input';
import { Audio } from '../core/audio';
import { clamp, lerp } from '../utils/noise';
import { Minimap } from '../ui/minimap';
import { colliderCount, insideAny, resolveSphere } from '../world/colliders';

type Save = { found: Record<string, { photo: string; depth: number; t: number; score?: number }>; dives: number; maxDepth: number; muted?: boolean; money?: number; owned?: string[]; earned?: number };
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
    this.audio.onExhale = () => {
      if (this.state === 'diving') this.env.exhale(this.camera, this.ads || this.has('rebreather') ? 0 : 1);
    };

    this.input = new Input($('touch-surface'), $('stick'), $('knob'));
    this.bindUi();
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
        return sv;
      }
    } catch {
      /* storage unavailable */
    }
    return { found: {}, dives: 0, maxDepth: 0, money: 0, owned: [], earned: 0 };
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
    return !!this.save.owned?.includes(id);
  }

  /** Dex completion in percent. */
  private get dexPct(): number {
    return (this.foundCount / SPECIES.length) * 100;
  }

  /** Species still needed before an item comes into stock. */
  private stockGap(g: (typeof SHOP)[number]): number {
    return Math.max(0, Math.ceil((g.need / 100) * SPECIES.length) - this.foundCount);
  }

  /** Next gear the player can aim for, and how far away it is (the reward hanging in front of them). */
  private nextGoal(): { name: string; need: number; species: number } | null {
    const money = this.save.money ?? 0;
    const g = SHOP.find((x) => !this.has(x.id));
    return g ? { name: g.name, need: Math.max(0, g.price - money), species: this.stockGap(g) } : null;
  }

  private buy(id: GearId): void {
    const g = SHOP.find((x) => x.id === id)!;
    if (this.has(id) || (this.save.money ?? 0) < g.price || this.stockGap(g) > 0) return;
    this.save.money = (this.save.money ?? 0) - g.price;
    (this.save.owned ??= []).push(id);
    this.writeSave();
    this.audio.chime(true);
    this.toast(`「${g.name}」を購入！ ${g.desc}`, '', 3);
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
    $('btn-pause').addEventListener('click', () => this.setPaused(true));
    $('resume').addEventListener('click', () => this.setPaused(false));
    $('abort').addEventListener('click', () => this.endDive('surface'));
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
    const colors: Record<string, string> = { lagoon: '#9fe8d8', reef: '#5fe3f0', rocky: '#a8c8b0', dropoff: '#4aa8e8', deep: '#3a5ab8', cold: '#d6eef6' };
    const pts = $('points');
    pts.innerHTML = '';
    for (const dp of DIVE_POINTS) {
      const zoneSpecies = SPECIES.filter((s) => (dp.id === 'dropoff' ? s.zone === 'dropoff' || s.zone === 'offshore' : s.zone === dp.id));
      const got = zoneSpecies.filter((s) => this.save.found[s.id]).length;
      const locked = dp.requires === 'ads' && !this.has('ads');
      const b = document.createElement('button');
      b.className = 'pt';
      b.type = 'button';
      b.disabled = locked;
      b.innerHTML = `<span class="ico" style="background:${colors[dp.id]}">${dp.id === 'deep' ? '400m' : dp.id === 'dropoff' ? '15m+' : dp.id === 'lagoon' ? '5m' : dp.id === 'cold' ? '2℃' : '12m'}</span>
        <span><div class="nm">${dp.name}</div><div class="sb">${locked ? `写真の稼ぎで「大気圧潜水服」を買うと行ける` : dp.sub}</div></span>
        <span class="pr"><b>${got}</b>/${zoneSpecies.length}<span class="go">${locked ? 'ロック中' : '潜る ›'}</span></span>`;
      b.addEventListener('click', () => this.startDive(dp));
      pts.appendChild(b);
    }
    const gear = $('gear');
    const money = this.save.money ?? 0;
    const goal = this.nextGoal();
    const goalText = (gl: NonNullable<ReturnType<Game['nextGoal']>>) =>
      gl.species > 0
        ? `「${gl.name}」入荷まで図鑑あと <b>${gl.species}種</b>${gl.need > 0 ? `・<b>${yen(gl.need)}</b>` : ''}`
        : gl.need > 0
          ? `「${gl.name}」まであと <b>${yen(gl.need)}</b>`
          : `<span class="ok">「${gl.name}」が買える！ 下のショップへ</span>`;
    $('t-goal').innerHTML = `所持金 <b>${yen(money)}</b>　図鑑 <b>${this.dexPct.toFixed(1)}%</b><br>` + (goal ? goalText(goal) : '装備コンプリート');
    gear.innerHTML =
      `<div class="shop-head"><span>ダイブショップ　所持金 <b>${yen(money)}</b></span><span class="goal">図鑑 ${this.dexPct.toFixed(1)}%</span></div>` +
      SHOP.map((u) => {
        const on = this.has(u.id);
        const gap = this.stockGap(u);
        const stocked = gap === 0;
        const can = !on && stocked && money >= u.price;
        const req = on ? '入手済み' : !stocked ? `図鑑${u.need}%で入荷<br>（あと${gap}種）` : can ? `購入 ${yen(u.price)}` : yen(u.price);
        return `<button type="button" class="gear-item ${on ? 'on' : ''} ${can ? 'can' : ''} ${stocked ? '' : 'locked'}" data-buy="${u.id}" ${on || !can ? 'aria-disabled="true"' : ''}><div class="gi"><svg viewBox="0 0 24 24">${u.icon}</svg></div>${stocked || on ? u.name : '？？？'}<span class="req">${req}</span><span class="gdesc">${stocked || on ? u.desc : '図鑑を埋めると入荷する'}</span></button>`;
      }).join('');
    gear.querySelectorAll<HTMLButtonElement>('[data-buy]').forEach((b) =>
      b.addEventListener('click', () => {
        const id = b.dataset.buy as GearId;
        if (this.has(id)) return;
        const g = SHOP.find((x) => x.id === id)!;
        if (this.stockGap(g) > 0) { this.toast(`図鑑をあと${this.stockGap(g)}種埋めると入荷する`); return; }
        if ((this.save.money ?? 0) < g.price) { this.toast('写真で稼いで買おう。いい写真ほど高く売れる'); return; }
        this.buy(id);
      }),
    );
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
        const stars = '★'.repeat(s.rarity);
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
    $('dd-zone').textContent = `${ZONE_NAMES[s.zone]}・水深 ${s.depth[0]}–${s.depth[1]}m・${'★'.repeat(s.rarity)}`;
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
    this.renderTitle();
    mark('firstRender');
    this.renderer.setAnimationLoop(() => this.tick());
    // build the bathymetric chart while the player is on the title screen
    window.setTimeout(() => this.ensureMinimap(), 1200);
  }

  private ensureMinimap(): Minimap {
    if (!this.minimap) this.minimap = new Minimap($<HTMLCanvasElement>('minimap'), $<HTMLCanvasElement>('bigmap'));
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

  private startDive(dp: DivePoint): void {
    this.audio.unlock();
    const fade = $('fade');
    fade.classList.add('on');
    window.setTimeout(() => {
      this.point = dp;
      this.ads = dp.requires === 'ads';
      this.airMax = this.ads ? 220 : this.has('tank') ? 300 : 200;
      this.air = this.airMax;
      this.diveTime = 0;
      this.diveMaxDepth = 0;
      this.diveShots = 0;
      this.pending.clear();
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
      this.creatures.shield = this.has('shield');
      if (this.minimap) this.minimap.blips = [];
      this.coldWarned = -100;
      this.missions.reset();
      this.bonuses = [];
      $('btn-light').classList.toggle('on', this.env.lightOn);
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
      if (!this.helpShown) {
        this.helpShown = true;
        $('help').classList.remove('hidden');
        window.setTimeout(() => $('help').classList.add('hidden'), 7000);
      }
      this.toast(this.ads ? '大気圧潜水服で深海へ降下中…' : `${dp.name}にエントリー`, '', 3);
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

  /** Warnings, charges and bites from territorial triggerfish / curious sharks. */
  private handleEncounters(): void {
    const ev = this.creatures.events;
    while (ev.length) {
      const e = ev.shift()!;
      const name = e.def.name;
      const shark = e.def.aggro?.kind === 'shark';
      if (e.type === 'warn') {
        if (this.time - this.lastEncounter < 4) continue;
        this.lastEncounter = this.time;
        this.toast(shark ? `${name}がこちらの周りを回り始めた…` : `${name}の縄張りに入った！ 威嚇されている`, 'warn', 3);
      } else if (e.type === 'repel') {
        this.toast(`シャークシールドが作動！ ${name}が向きを変えた`, 'warn', 2.5);
        this.shake = Math.max(this.shake, 0.3);
        continue;
      } else if (e.type === 'charge') {
        this.audio.warn();
        this.toast(shark ? `${name}が突っ込んでくる！` : `${name}が突進してくる！ 離れて！`, 'danger', 2.5);
      } else {
        const bite = e.def.aggro?.bite ?? 5;
        this.air = Math.max(1, this.air - bite);
        const push = this.camera.position.clone().sub(e.p).setY(0.3).normalize();
        this.vel.addScaledVector(push, shark ? 4.5 : 3);
        this.shake = 1;
        this.audio.warn();
        this.toast(shark ? `${name}にぶつかられた！ エア −${bite}bar` : `${name}に噛まれた！ エア −${bite}bar`, 'danger', 3);
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
    this.save.maxDepth = Math.max(this.save.maxDepth, this.diveMaxDepth);
    this.writeSave();
    const after = this.foundCount;
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
    if (this.bonuses.length) list.insertAdjacentHTML('beforeend', this.bonuses.map((b) => `<div class="res-bonus">依頼達成：${b.label}<b>${yen(b.value)}</b></div>`).join(''));
    this.missions.reset();
    if (reason === 'blackout' && shots.length) list.insertAdjacentHTML('beforeend', `<div class="res-empty">気絶して救助された。図鑑の記録は残ったが、救助費用で売上は${Math.round(PHOTO.blackoutKeep * 100)}%に（${yen(gross)} → ${yen(earn)}）。エアに気をつけて早めに浮上しよう。</div>`);
    const stockedNow = SHOP.filter((g) => !this.has(g.id) && Math.ceil((g.need / 100) * SPECIES.length) > before && this.stockGap(g) === 0);
    const affordable = SHOP.filter((g) => !this.has(g.id) && this.stockGap(g) === 0 && this.save.money! >= g.price && (moneyBefore < g.price || stockedNow.includes(g)));
    const goal = this.nextGoal();
    $('res-unlock').innerHTML = [
      ...stockedNow.map((g) => `ダイブショップに「${g.name}」が入荷した！（${g.desc}）`),
      ...affordable.map((g) => `「${g.name}」が買えるようになった！ ボートのショップへ`),
    ].join('<br>') || (goal ? `<span class="res-goal">所持金 ${yen(this.save.money!)}　次の目標「${goal.name}」${goal.species > 0 ? `入荷まで図鑑あと${goal.species}種` : `まであと${yen(goal.need)}`}</span>` : '');
    if (affordable.length || stockedNow.length || earn > 0) this.audio.chime(affordable.length + stockedNow.length > 0);
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
    const inp = this.input;
    inp.poll();
    const [lx, ly] = inp.takeLook();
    this.yaw -= lx;
    this.pitch = clamp(this.pitch - ly, -1.45, 1.45);
    if (inp.consume('light')) {
      this.env.lightOn = !this.env.lightOn;
      $('btn-light').classList.toggle('on', this.env.lightOn);
    }
    if (inp.consume('dex')) this.openDex();
    if (inp.consume('map')) this.toggleMap(!this.minimap?.open);
    if (inp.consume('menu')) this.setPaused(true);
    if (inp.consume('surface') && this.canSurface()) this.endDive('surface');

    const cam = this.camera;
    const fwd = new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const boosting = inp.boost && this.has('scooter');
    let speed = (this.ads ? 2.3 : 2.4) * (this.has('fins') ? 1.3 : 1);
    if (boosting) speed = 6;
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

    // air
    const d = Math.max(0, -p.y);
    const moving = this.vel.length() > 0.5 ? 1.15 : 1;
    // cold cove without a drysuit: shivering triples air use
    const inCold = !this.ads && zoneAt(p.x, p.z) === 'cold';
    this.cold = inCold && !this.has('drysuit') ? 1 : 0;
    if (this.cold && this.time - this.coldWarned > 15) {
      this.coldWarned = this.time;
      this.audio.warn();
      this.toast('水温2℃！ 寒さで震えてエアの減りが3倍に（ドライスーツがあれば平気）', 'danger', 3.5);
    }
    const rate = this.ads ? 0.26 : 0.42 * (1 + d / 10) * moving * (boosting ? 1.25 : 1) * (1 + this.narc * 0.5) * (1 + this.currentF * 0.8) * (this.cold ? 3 : 1);
    this.air = Math.max(0, this.air - rate * dt);
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

    // occasional requests (mini-games)
    this.missions.update({
      dt, time: this.time, diveTime: this.diveTime, player: p, forward: this.tmpDir.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).clone(),
      zone: zoneAt(p.x, p.z),
      nearbySpecies: () => this.creatures.randomNear(p, 25),
      toast: (t, k, d) => this.toast(t, k ?? '', d),
      chime: (big) => this.audio.chime(big),
      reward: (v, label) => { this.bonuses.push({ label, value: v }); this.shake = Math.max(this.shake, 0.4); this.freezeT = 0.15; this.updateDexChip(); },
    });

    // photo target & shutter
    // sharp-photo distance: where water haze stays under ~50 % (FogExp2), shortened by narcosis
    const clear = (0.83 / this.env.fog.density) * (1 - this.narc * 0.3);
    this.lastClear = clear;
    const src = this.renderer.domElement;
    const aspect = src.width / src.height;
    const cropX = Math.min(0.62, (0.8 * 4) / (3 * aspect));
    const cropY = Math.min(0.8, (cropX * aspect * 3) / 4);
    cam.updateMatrixWorld();
    this.target = this.creatures.findTarget(cam, { clear, dark: d > 140, lightOn: this.env.lightOn, cropX, cropY, beam: this.has('light') ? 1.6 : 1, macro: this.has('macro'), wide: this.has('wide') });
    if (inp.consume('shutter')) {
      this.captureReq = this.target;
      this.audio.shutter();
      const f = $('flash');
      f.classList.remove('go');
      void f.offsetWidth;
      f.classList.add('go');
    }
  }

  private canSurface(): boolean {
    return this.ads || this.camera.position.y > -1.6;
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
    if (!t) {
      this.toast('何も写っていない…');
      return;
    }
    const def = t.rt.def;
    if (!t.inRange) {
      const msg: Record<string, string> = { small: '小さすぎて写っていない — もっと近づこう', murky: '濁りで霞んでしまった — もっと近づこう', dark: '暗くて写らなかった — ライトで照らそう', hidden: '岩陰に隠れて写らなかった', ok: '' };
      this.toast(msg[t.reason], 'warn');
      return;
    }
    const known = !!this.save.found[def.id];
    const depth = -t.agent.p.y;
    const ev = evaluateShot(t, this.lastClear, depth, this.currentF > 0.2);
    this.missions.onPhoto(def.id, ev.grade.g);
    // a known species pays a share unless this beats the best photo on record
    const best = this.save.found[def.id]?.score ?? -1;
    const value = known && ev.score <= best ? Math.round((ev.value * PHOTO.repeatShare) / 10) * 10 : ev.value;
    const prev = this.pending.get(def.id);
    const shot: Shot = { photo, depth, score: ev.score, grade: ev.grade.g, value, isNew: !known };
    const kept = !prev || shot.value > prev.value;
    if (kept) this.pending.set(def.id, shot);
    this.showDiscover(def.id, photo, !known && !prev, ev, kept ? value : 0, prev && !kept ? prev : undefined, known && ev.score > best && best >= 0);
    if (!known && !prev) this.audio.chime(def.rarity >= 3);
    else if (ev.grade.g === 'S') this.audio.chime(true);
    this.updateDexChip();
    // hit-stop + small kick: the shot "lands"
    this.freezeT = ev.grade.g === 'S' ? 0.2 : ev.grade.g === 'A' ? 0.13 : 0.07;
    this.shake = Math.max(this.shake, ev.grade.g === 'S' ? 0.5 : 0.25);
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
    $('disc-tag').textContent = isNew ? (s.rarity >= 3 ? '★ 激レア発見！' : '新種発見！') : record ? '自己ベスト更新！' : '撮影成功（登録済み）';
    const gEl = $('disc-grade');
    if (ev) {
      gEl.className = 'disc-grade g' + ev.grade.g;
      gEl.innerHTML = `<b>${ev.grade.g}</b><span>${ev.grade.word}</span>`;
      gEl.classList.remove('hidden');
      $('disc-pay').textContent = paid > 0 ? `+${yen(paid)}${ev.bonus.length ? '　' + ev.bonus.join(' ') : ''}` : better ? `今回の${better.grade}判定の方が高値` : '';
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
    const rate = this.ads ? 0.26 : 0.42 * (1 + d / 10);
    const secs = Math.max(0, (this.air - 0) / rate);
    $('air-time').textContent = `${Math.floor(secs / 60)}:${String(Math.floor(secs % 60)).padStart(2, '0')}`;
    $('narc').style.opacity = String(this.narc * 0.8);
    if (this.minimap && this.frame % 10 === 0) {
      if (this.has('sonar') && this.frame % 20 === 0) this.sonarBlips = this.creatures.sonar(p, 45, (id) => !!this.save.found[id] || this.pending.has(id));
      this.minimap.blips = [...(this.has('sonar') ? this.sonarBlips : []), ...this.missions.marks()];
    }
    this.minimap?.update(p.x, p.z, this.yaw, this.boatPos());
    if (this.minimap?.open && this.frame % 6 === 0) this.minimap.drawBig(p.x, p.z, this.yaw, this.boatPos());

    const sb = $('surface-btn');
    const can = this.canSurface();
    sb.classList.toggle('hidden', !can);
    $('surface-text').textContent = this.ads ? 'ウインチで回収してもらう' : '浮上してボートに戻る';

    // reticle
    const ret = $('reticle');
    const lab = $('ret-label');
    const t = this.target;
    ret.classList.toggle('lock', !!t && t.inRange);
    ret.classList.toggle('far', !!t && !t.inRange);
    $('btn-shutter').classList.toggle('ready', !!t && t.inRange && !this.save.found[t.rt.def.id] && !this.pending.has(t.rt.def.id));
    if (t) {
      const known = this.save.found[t.rt.def.id] || this.pending.has(t.rt.def.id);
      const why: Record<string, string> = { small: '小さすぎる・もっと近づく', murky: '濁って霞んでいる・近づく', dark: '暗くて写らない・ライトで照らす', hidden: '岩陰に隠れている', ok: '' };
      let sub = why[t.reason];
      if (t.inRange) {
        // live grade: the player sees closer / side-on / centred pays more before pressing the shutter
        const ev = evaluateShot(t, this.lastClear, -t.agent.p.y, this.currentF > 0.2);
        const hint = t.side < 0.6 ? '横から狙うと↑' : t.frac < 0.2 ? '寄ると↑' : t.centred < 0.6 ? '中央で↑' : '';
        sub = `<span class="g${ev.grade.g}">評価 ${ev.grade.g}</span>${t.danger ? ' <span class="gS">危険手当！</span>' : ''}${hint ? '　' + hint : ''}`;
      }
      lab.innerHTML = `${known ? t.rt.def.name : '？？？'}<small>${sub}</small>`;
    } else lab.textContent = '';

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
      this.creatures.update(dt, cp, this.vel, this.camera.getWorldDirection(this.tmpDir));
    }
    this.flora.update(cp, this.time);
    this.env.update(dt, this.camera, this.renderer, this.time);
    // image-based fill only adds sheen near the surface; it must not flatten the sun/shade contrast
    this.scene.environmentIntensity = 0.22 * Math.exp(Math.min(0, this.camera.position.y) / 25) + 0.01;
    if (this.state === 'diving' && !this.paused) this.updateHud(dt);

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
      surface: { x: 0, y: -4, z: 480, yaw: Math.PI, pitch: 0.75 },
      deep: { x: VENT.x - 14, y: heightAt(VENT.x - 14, VENT.z - 22) + 6, z: VENT.z - 22, yaw: Math.PI * 0.8, pitch: -0.15, light: true },
    };
    (window as unknown as Record<string, unknown>).__THREE_GAME_TEST_HOOKS__ = {
      game: this,
      startMission: (k: 'urchin' | 'trash' | 'photo' | 'lost') => { this.missions.force = k; },
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
