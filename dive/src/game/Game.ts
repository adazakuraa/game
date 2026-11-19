import * as THREE from 'three';
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

type Save = { found: Record<string, { photo: string; depth: number; t: number }>; dives: number; maxDepth: number; muted?: boolean };
type State = 'loading' | 'title' | 'diving' | 'paused' | 'result' | 'dex';

const SAVE_KEY = 'blue-depths-save-v1';
const UNLOCKS = [
  { id: 'fins', need: 5, name: 'ロングフィン', desc: '泳ぐ速さ +30%', icon: '<path d="M7 3h4l1 8 4 8-3 2-5-7z"/>' },
  { id: 'tank', need: 12, name: '大型タンク', desc: 'エア容量 1.5倍', icon: '<rect x="8" y="5" width="8" height="16" rx="3"/><rect x="10.5" y="2" width="3" height="3"/>' },
  { id: 'scooter', need: 22, name: '水中スクーター', desc: '高速移動ボタン', icon: '<path d="M3 12l7-5v3h8l3 2-3 2h-8v3z"/>' },
  { id: 'ads', need: 35, name: '大気圧潜水服', desc: '深海へ潜れる', icon: '<circle cx="12" cy="7" r="4"/><path d="M6 21v-6a6 6 0 0 1 12 0v6z"/>' },
] as const;

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
  private pending = new Map<string, { photo: string; depth: number }>();
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

    this.save = this.loadSave();
    this.audio.muted = !!this.save.muted;
    this.scene.add(this.camera);
    this.env = new Environment(this.scene, this.camera, mobile);
    this.scene.environment = this.makeEnvMap();
    this.scene.environmentIntensity = 0.6;
    this.scene.add(this.terrain.group);
    const t0 = performance.now();
    this.flora = new Flora();
    const t1 = performance.now();
    this.scene.add(this.flora.group);
    this.creatures = new Creatures(this.flora.homes);
    (window as unknown as Record<string, unknown>).__BOOT_MS__ = { flora: Math.round(t1 - t0), creatures: Math.round(performance.now() - t1) };
    this.scene.add(this.creatures.group);
    this.audio.onExhale = () => {
      if (this.state === 'diving') this.env.exhale(this.camera, this.ads ? 0 : 1);
    };

    this.input = new Input($('touch-surface'), $('stick'), $('knob'));
    this.bindUi();
    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.installHooks();
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
      if (raw) return JSON.parse(raw) as Save;
    } catch {
      /* storage unavailable */
    }
    return { found: {}, dives: 0, maxDepth: 0 };
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

  private has(unlock: (typeof UNLOCKS)[number]['id']): boolean {
    const u = UNLOCKS.find((x) => x.id === unlock)!;
    return this.foundCount >= u.need;
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
    const colors: Record<string, string> = { lagoon: '#9fe8d8', reef: '#5fe3f0', rocky: '#a8c8b0', dropoff: '#4aa8e8', deep: '#3a5ab8' };
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
      b.innerHTML = `<span class="ico" style="background:${colors[dp.id]}">${dp.id === 'deep' ? '400m' : dp.id === 'dropoff' ? '15m+' : dp.id === 'lagoon' ? '5m' : '12m'}</span>
        <span><div class="nm">${dp.name}</div><div class="sb">${locked ? `図鑑${UNLOCKS[3].need}種で大気圧潜水服を入手` : dp.sub}</div></span>
        <span class="pr"><b>${got}</b>/${zoneSpecies.length}<span class="go">${locked ? 'ロック中' : '潜る ›'}</span></span>`;
      b.addEventListener('click', () => this.startDive(dp));
      pts.appendChild(b);
    }
    const gear = $('gear');
    gear.innerHTML = UNLOCKS.map((u) => {
      const on = n >= u.need;
      return `<div class="gear-item ${on ? 'on' : ''}"><div class="gi"><svg viewBox="0 0 24 24">${u.icon}</svg></div>${u.name}<span class="req">${on ? '入手済み' : `図鑑 ${u.need}種`}</span></div>`;
    }).join('');
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
    this.titleCamera(0);
    this.terrain.prime(this.camera.position.x, this.camera.position.z, 90);
    $('loading').classList.add('hidden');
    this.state = 'title';
    this.renderTitle();
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
      const startY = this.ads ? -175 : -1.6;
      this.camera.position.set(dp.x, startY, dp.z);
      this.yaw = Math.PI; // face offshore (+z)
      this.pitch = this.ads ? -0.5 : -0.35;
      this.flora.placeBoat(dp.x, dp.z - 3);
      this.ensureMinimap();
      this.flora.boat.visible = !this.ads;
      this.terrain.prime(dp.x, dp.z, 80);
      this.creatures.reshuffle(this.camera.position);
      this.creatures.primeAround(this.camera.position);
      this.env.lightOn = this.ads;
      this.env.lightPower = this.ads ? 1.6 : 1;
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

  private endDive(reason: 'surface' | 'blackout'): void {
    if (this.state !== 'diving' && this.state !== 'paused') return;
    const before = this.foundCount;
    const shots = [...this.pending.entries()];
    if (reason === 'surface') {
      for (const [id, f] of shots) if (!this.save.found[id]) this.save.found[id] = { ...f, t: Date.now() };
    }
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
    $('res-stats').innerHTML = `<div>潜水時間<b>${m}:${String(s).padStart(2, '0')}</b></div><div>最大水深<b>${this.diveMaxDepth.toFixed(1)}m</b></div><div>新種<b>${reason === 'surface' ? after - before : 0}</b></div>`;
    const list = $('res-list');
    list.innerHTML = shots.length
      ? shots.map(([id, f]) => `<div class="res-card ${reason === 'blackout' ? 'lost' : ''}"><img src="${f.photo}" alt=""><div>${SPECIES_BY_ID.get(id)!.name}</div></div>`).join('')
      : `<div class="res-empty">${this.diveShots ? '新しい生き物は撮れませんでした。' : '今回は写真を撮りませんでした。'}</div>`;
    if (reason === 'blackout' && shots.length) list.insertAdjacentHTML('beforeend', '<div class="res-empty">気絶したため、今回の写真は失われました。エア残量に気をつけて早めに浮上しよう。</div>');
    const newly = UNLOCKS.filter((u) => before < u.need && after >= u.need);
    $('res-unlock').innerHTML = newly.map((u) => `新装備「${u.name}」を入手！ ${u.desc}`).join('<br>');
    if (newly.length) this.audio.chime(true);
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
    cam.rotation.set(this.pitch + Math.sin(this.time * 0.5) * 0.006 * sway, this.yaw, roll, 'YXZ');

    // air
    const d = Math.max(0, -p.y);
    const moving = this.vel.length() > 0.5 ? 1.15 : 1;
    const rate = this.ads ? 0.26 : 0.42 * (1 + d / 10) * moving * (boosting ? 1.25 : 1) * (1 + this.narc * 0.5);
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

    // photo target & shutter
    // sharp-photo distance: where water haze stays under ~50 % (FogExp2), shortened by narcosis
    const clear = (0.83 / this.env.fog.density) * (1 - this.narc * 0.3);
    const src = this.renderer.domElement;
    const aspect = src.width / src.height;
    const cropX = Math.min(0.62, (0.8 * 4) / (3 * aspect));
    const cropY = Math.min(0.8, (cropX * aspect * 3) / 4);
    cam.updateMatrixWorld();
    this.target = this.creatures.findTarget(cam, { clear, dark: d > 140, lightOn: this.env.lightOn, cropX, cropY });
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
    const already = this.pending.has(def.id);
    const depth = -t.agent.p.y;
    if (!known && !already) {
      this.pending.set(def.id, { photo, depth });
      this.showDiscover(def.id, photo, true);
      this.audio.chime(def.rarity >= 3);
      this.updateDexChip();
    } else {
      if (already) this.pending.set(def.id, { photo, depth });
      this.showDiscover(def.id, photo, false);
    }
  }

  private showDiscover(id: string, photo: string, isNew: boolean): void {
    const s = SPECIES_BY_ID.get(id)!;
    const el = $('discover');
    el.classList.remove('hidden');
    el.classList.toggle('known', !isNew);
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = '';
    $<HTMLImageElement>('disc-photo').src = photo;
    $('disc-tag').textContent = isNew ? (s.rarity >= 3 ? '★ 激レア発見！' : '新種発見！ 浮上して図鑑に登録') : '撮影成功（登録済み）';
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
    $('depth-warn').classList.toggle('hidden', this.ads || d < 40);
    $('depth-warn').textContent = d > 52 ? '限界深度に接近' : '窒素酔い注意';
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
      const why: Record<string, string> = { small: '小さすぎる・もっと近づく', murky: '濁って霞んでいる・近づく', dark: '暗くて写らない・ライトで照らす', hidden: '岩陰に隠れている', ok: known ? '撮影済み' : '撮影できる！' };
      lab.innerHTML = `${known ? t.rt.def.name : '？？？'}<small>${why[t.reason]}</small>`;
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
    const dt = Math.min(rawDt, 0.05);
    this.frame++;
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
      surface: { x: 0, y: -4, z: 480, yaw: Math.PI, pitch: 0.75 },
      deep: { x: VENT.x - 14, y: heightAt(VENT.x - 14, VENT.z - 22) + 6, z: VENT.z - 22, yaw: Math.PI * 0.8, pitch: -0.15, light: true },
    };
    (window as unknown as Record<string, unknown>).__THREE_GAME_TEST_HOOKS__ = {
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
        return a ? { x: a.p.x, y: a.p.y, z: a.p.z } : null;
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
