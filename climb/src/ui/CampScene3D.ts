import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { buildDog, poseDog, type DogRig } from '../world/DogModel';
import { cupRamen, dalBhat, chocoBar, teaMug, type FoodModel } from '../world/CampModels';
import { lathe, snowTexture, makeTexture } from '../world/Sculpt';
import type { MealId } from './CampScreen';

/**
 * The evening at camp as a small real-time 3D vignette: packed snow and a foam pad, a dome
 * tent glowing from inside, a gas stove with a blue flame, the dog curled up beside you, and
 * whatever you are eating right in front of the camera (which leans in while you eat).
 * Its own renderer, running only while the camp screen is open.
 */
export class CampScene3D {
  private renderer: THREE.WebGLRenderer | null = null;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(34, 1, 0.01, 60);
  private readonly dog: DogRig;
  private host: HTMLElement | null = null;
  private food: FoodModel | null = null;
  private foodId: MealId | null = null;
  private foodFade = 0;
  private biteT = -1;
  private bites = 0;
  private close = 0;
  private t = 0;
  private last = 0;
  private readonly flame: THREE.Mesh;
  private readonly stoveLight: THREE.PointLight;
  private readonly steam: { s: THREE.Sprite; age: number }[] = [];
  private steamAcc = 0;
  private readonly puffTex: THREE.Texture;
  private dogHappy = 0;
  private dogChew = 0;
  private dogLook = 0;
  private readonly treat: THREE.Mesh;
  private readonly tmp = new THREE.Vector3();

  constructor() {
    const s = this.scene;
    s.background = makeTexture('campSky', 512, (g, n) => {
      const grd = g.createLinearGradient(0, 0, 0, n);
      grd.addColorStop(0, '#060b16'); grd.addColorStop(0.55, '#14294a'); grd.addColorStop(0.8, '#2f4d73'); grd.addColorStop(1, '#4a6488');
      g.fillStyle = grd; g.fillRect(0, 0, n, n);
      for (let i = 0; i < 160; i++) {
        const y = Math.random() * n * 0.6;
        g.fillStyle = `rgba(255,255,255,${0.3 + Math.random() * 0.6})`;
        g.fillRect(Math.random() * n, y, Math.random() < 0.1 ? 2 : 1, Math.random() < 0.1 ? 2 : 1);
      }
    });
    (s.background as THREE.Texture).colorSpace = THREE.SRGBColorSpace;
    s.fog = new THREE.Fog(0x24406a, 6, 26);

    // lights: cool moon key, soft sky fill, warm stove and tent glow
    s.add(new THREE.HemisphereLight(0x7d94c8, 0x1d2230, 0.55));
    const moon = new THREE.DirectionalLight(0xbcd0ff, 1.3);
    moon.position.set(-2.5, 4, 2);
    moon.castShadow = true;
    moon.shadow.mapSize.set(1024, 1024);
    const sc = moon.shadow.camera as THREE.OrthographicCamera;
    sc.left = -1.5; sc.right = 1.5; sc.top = 1.5; sc.bottom = -1.5; sc.near = 0.5; sc.far = 10;
    moon.shadow.bias = -0.0008;
    moon.shadow.radius = 4;
    s.add(moon);
    this.stoveLight = new THREE.PointLight(0xffa860, 2.6, 2.4, 1.6);
    this.stoveLight.position.set(0.36, 0.14, -0.12);
    s.add(this.stoveLight);
    const tentGlow = new THREE.PointLight(0xff8a2a, 2.2, 3, 1.5);
    tentGlow.position.set(0.95, 0.45, -1.15);
    s.add(tentGlow);

    // ground: packed snow with gentle wind-sculpted swells
    const groundGeo = new THREE.PlaneGeometry(14, 14, 80, 80);
    groundGeo.rotateX(-Math.PI / 2);
    const gp = groundGeo.getAttribute('position');
    for (let i = 0; i < gp.count; i++) {
      const x = gp.getX(i), z = gp.getZ(i);
      const d = Math.hypot(x, z);
      gp.setY(i, Math.max(0, d - 0.9) * 0.05 * (Math.sin(x * 1.3) * Math.cos(z * 0.9) + 0.6) - (d < 0.9 ? 0.004 : 0));
    }
    groundGeo.computeVertexNormals();
    const snow = snowTexture().clone();
    snow.needsUpdate = true;
    snow.repeat.set(10, 10);
    const ground = new THREE.Mesh(groundGeo, new THREE.MeshStandardMaterial({ color: 0xdfe8f2, map: snow, bumpMap: snow, bumpScale: 0.6, roughness: 0.88 }));
    ground.receiveShadow = true;
    s.add(ground);

    // a far ridge on the horizon (backdrop only)
    const ridge = new THREE.Mesh(new THREE.PlaneGeometry(40, 10), new THREE.MeshBasicMaterial({ transparent: true, fog: false, map: makeTexture('campRidge', 1024, (g, n) => {
      g.clearRect(0, 0, n, n);
      const grd = g.createLinearGradient(0, n * 0.2, 0, n);
      grd.addColorStop(0, '#c9d8ea'); grd.addColorStop(0.5, '#7f97b8'); grd.addColorStop(1, '#4b6286');
      g.fillStyle = grd;
      g.beginPath(); g.moveTo(0, n);
      const pk = [[0, 0.62], [0.12, 0.5], [0.2, 0.56], [0.33, 0.28], [0.41, 0.42], [0.5, 0.36], [0.6, 0.5], [0.72, 0.4], [0.84, 0.55], [1, 0.48]];
      for (const [x, y] of pk) g.lineTo(x * n, y * n);
      g.lineTo(n, n); g.closePath(); g.fill();
      // snow streaks on the faces
      g.strokeStyle = 'rgba(255,255,255,0.25)'; g.lineWidth = 2;
      for (let i = 0; i < 40; i++) { const x = Math.random() * n; g.beginPath(); g.moveTo(x, n * 0.45 + Math.random() * n * 0.2); g.lineTo(x + 20, n * 0.75); g.stroke(); }
    }) }));
    (ridge.material as THREE.MeshBasicMaterial).map!.colorSpace = THREE.SRGBColorSpace;
    ridge.position.set(0, 3.2, -16);
    s.add(ridge);

    // foam sleeping pad (egg-crate ridges) where the food sits
    const padTex = makeTexture('pad', 256, (g, n) => {
      g.fillStyle = '#d9a53a'; g.fillRect(0, 0, n, n);
      for (let y = 0; y < n; y += 16) for (let x = 0; x < n; x += 16) {
        const grd = g.createRadialGradient(x + 8, y + 8, 1, x + 8, y + 8, 9);
        grd.addColorStop(0, '#f1c45a'); grd.addColorStop(1, '#a9781f');
        g.fillStyle = grd; g.fillRect(x, y, 16, 16);
      }
    }, true, true);
    padTex.repeat.set(4, 3);
    const padShape = new THREE.Shape();
    const pw = 0.3, pd = 0.22, pr = 0.04;
    padShape.moveTo(-pw + pr, -pd); padShape.lineTo(pw - pr, -pd); padShape.quadraticCurveTo(pw, -pd, pw, -pd + pr);
    padShape.lineTo(pw, pd - pr); padShape.quadraticCurveTo(pw, pd, pw - pr, pd); padShape.lineTo(-pw + pr, pd);
    padShape.quadraticCurveTo(-pw, pd, -pw, pd - pr); padShape.lineTo(-pw, -pd + pr); padShape.quadraticCurveTo(-pw, -pd, -pw + pr, -pd);
    const padGeo = new THREE.ExtrudeGeometry(padShape, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 2 });
    padGeo.rotateX(-Math.PI / 2);
    const pad = new THREE.Mesh(padGeo, new THREE.MeshStandardMaterial({ map: padTex, bumpMap: padTex, bumpScale: 1.5, roughness: 0.9 }));
    pad.receiveShadow = true;
    pad.castShadow = true;
    pad.position.set(0, 0.0, 0.02);
    s.add(pad);

    s.add(this.buildTent());
    const { stove, flame } = this.buildStove();
    this.flame = flame;
    s.add(stove);

    // the dog, lying by the stove
    this.dog = buildDog();
    this.dog.root.position.set(-0.5, 0.0, -0.62);
    this.dog.root.rotation.y = -0.35;
    this.dog.root.scale.setScalar(0.78);
    this.dog.root.visible = false;
    s.add(this.dog.root);
    // a piece of yak cheese for treats
    this.treat = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.022, 0.022, 2, 2, 2), new THREE.MeshStandardMaterial({ color: 0xe8dcc0, roughness: 0.5 }));
    this.treat.visible = false;
    this.dog.head.add(this.treat);
    this.treat.position.set(0.26, -0.03, 0);

    this.puffTex = makeTexture('steamPuff', 64, (g, n) => {
      const grd = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
      grd.addColorStop(0, 'rgba(255,255,255,0.9)'); grd.addColorStop(0.5, 'rgba(255,255,255,0.35)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd; g.fillRect(0, 0, n, n);
    });
  }

  private buildTent(): THREE.Group {
    const g = new THREE.Group();
    const geo = new THREE.SphereGeometry(1, 48, 20, 0, Math.PI * 2, 0, Math.PI / 2);
    const p = geo.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const a = Math.atan2(z, x);
      // fabric sags between the poles; the hem flares a little
      const sag = 1 - 0.07 * Math.abs(Math.sin(a * 2)) * Math.sin(y * Math.PI) + (1 - y) * 0.03;
      p.setXYZ(i, x * sag * 0.95, y * 0.78, z * sag * 0.8);
    }
    geo.computeVertexNormals();
    const fabric = makeTexture('tentFabric', 512, (c, n) => {
      c.fillStyle = '#e8891c'; c.fillRect(0, 0, n, n);
      c.strokeStyle = 'rgba(120,50,0,0.18)'; c.lineWidth = 1;
      for (let i = 0; i < n; i += 8) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i, n); c.stroke(); c.beginPath(); c.moveTo(0, i); c.lineTo(n, i); c.stroke(); }
      c.strokeStyle = 'rgba(90,30,0,0.45)'; c.lineWidth = 3;
      for (let i = 0; i < 4; i++) { c.beginPath(); c.moveTo((i + 0.5) * n / 4, 0); c.lineTo((i + 0.5) * n / 4, n); c.stroke(); }
    }, true, true);
    fabric.repeat.set(2, 1);
    const tent = new THREE.Mesh(geo, new THREE.MeshPhysicalMaterial({
      map: fabric, roughness: 0.75, sheen: 0.6, sheenColor: new THREE.Color(0xffc27a), emissive: 0xff7a1a, emissiveIntensity: 0.18, side: THREE.DoubleSide,
    }));
    tent.castShadow = true;
    tent.receiveShadow = true;
    g.add(tent);
    // poles
    for (const r of [Math.PI / 4, -Math.PI / 4]) {
      const pole = new THREE.Mesh(new THREE.TorusGeometry(0.97, 0.008, 6, 48, Math.PI), new THREE.MeshStandardMaterial({ color: 0x2a2a2e, roughness: 0.4, metalness: 0.6 }));
      pole.scale.set(0.95, 0.8, 0.8);
      pole.rotation.y = r;
      g.add(pole);
    }
    // the door: a dark opening with warm light spilling out
    const door = new THREE.Mesh(new THREE.CircleGeometry(0.34, 32, 0, Math.PI), new THREE.MeshBasicMaterial({ color: 0x5a2a08 }));
    door.position.set(-0.55, 0.0, 0.45);
    door.rotation.y = -0.85;
    g.add(door);
    g.position.set(1.0, 0, -1.2);
    g.rotation.y = 0.3;
    return g;
  }

  private buildStove(): { stove: THREE.Group; flame: THREE.Mesh } {
    const g = new THREE.Group();
    const can = new THREE.Mesh(lathe([[0, 0], [0.05, 0], [0.055, 0.01], [0.056, 0.05], [0.045, 0.065], [0.016, 0.072], [0.016, 0.078], [0, 0.078]], 40),
      new THREE.MeshStandardMaterial({ color: 0x2b5c8f, roughness: 0.35, metalness: 0.4, map: makeTexture('gasCan', 256, (c, n) => {
        c.fillStyle = '#2b5c8f'; c.fillRect(0, 0, n, n);
        c.fillStyle = '#e9edf2'; c.fillRect(0, n * 0.45, n, n * 0.18);
        c.fillStyle = '#c23a1c'; c.font = `900 ${n * 0.1}px sans-serif`; c.fillText('GAS', n * 0.1, n * 0.6); c.fillText('GAS', n * 0.6, n * 0.6);
      }) }));
    const burner = new THREE.Mesh(lathe([[0.004, 0.078], [0.012, 0.08], [0.022, 0.1], [0.026, 0.104], [0.02, 0.106], [0.004, 0.1]], 24),
      new THREE.MeshStandardMaterial({ color: 0x9aa1a8, metalness: 1, roughness: 0.3 }));
    // pot supports
    for (let i = 0; i < 3; i++) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.004, 0.006), new THREE.MeshStandardMaterial({ color: 0x8a9096, metalness: 1, roughness: 0.4 }));
      arm.position.set(Math.cos(i * 2.094) * 0.03, 0.108, Math.sin(i * 2.094) * 0.03);
      arm.rotation.y = -i * 2.094;
      g.add(arm);
    }
    // the flame: a soft blue teardrop (additive) with a hotter core
    const flame = new THREE.Mesh(lathe([[0.0, 0.0], [0.016, 0.006], [0.014, 0.022], [0.006, 0.04], [0, 0.048]], 20),
      new THREE.MeshBasicMaterial({ color: 0x4aa8ff, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false }));
    flame.position.y = 0.104;
    const core = new THREE.Mesh(lathe([[0, 0], [0.008, 0.004], [0.006, 0.014], [0, 0.022]], 16),
      new THREE.MeshBasicMaterial({ color: 0xd8f0ff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
    flame.add(core);
    g.add(can, burner, flame);
    g.traverse((o) => { if ((o as THREE.Mesh).isMesh && o !== flame && o !== core) { o.castShadow = true; o.receiveShadow = true; } });
    g.position.set(0.36, 0, -0.12);
    return { stove: g, flame };
  }

  // ------------------------------------------------------------ lifecycle
  mount(host: HTMLElement): void {
    this.host = host;
    if (!this.renderer) {
      const r = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
      r.outputColorSpace = THREE.SRGBColorSpace;
      r.toneMapping = THREE.ACESFilmicToneMapping;
      r.toneMappingExposure = 1.15;
      r.shadowMap.enabled = true;
      r.shadowMap.type = THREE.PCFShadowMap;
      const pm = new THREE.PMREMGenerator(r);
      this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
      this.scene.environmentIntensity = 0.28;
      this.renderer = r;
      r.domElement.className = 'camp-canvas';
    }
    host.prepend(this.renderer.domElement);
    this.resize();
    this.last = performance.now();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  unmount(): void {
    this.renderer?.setAnimationLoop(null);
    this.renderer?.domElement.remove();
    this.host = null;
    this.clearFood(true);
  }

  private resize(): void {
    if (!this.renderer || !this.host) return;
    const w = Math.max(1, this.host.clientWidth), h = Math.max(1, this.host.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setDog(on: boolean): void { this.dog.root.visible = on; }

  // ------------------------------------------------------------ food
  showFood(id: MealId): void {
    this.clearFood(true);
    const f = id === 'ramen' ? cupRamen() : id === 'dalbhat' ? dalBhat() : id === 'choco' ? chocoBar() : teaMug();
    f.group.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    f.group.position.set(0, 0.016, 0.03);
    f.group.rotation.y = id === 'choco' ? -0.5 : id === 'tea' ? -0.9 : 0;
    this.scene.add(f.group);
    this.food = f;
    this.foodId = id;
    this.foodFade = 0;
    this.bites = 0;
    this.biteT = -1;
    this.dogLook = 3;
  }

  /** Lift / sip / scoop for a moment, then the level drops. */
  bite(n: number): void {
    this.bites = n;
    this.biteT = 0;
  }

  clearFood(now = false): void {
    if (!this.food) return;
    if (now) {
      this.scene.remove(this.food.group);
      this.food = null;
      this.foodId = null;
      return;
    }
    this.foodFade = -1;
  }

  dogTreat(): void { this.dogChew = 1.6; this.dogHappy = 2.5; this.treat.visible = true; }
  dogPet(): void { this.dogHappy = 2; }

  /** Where the dog's head is on screen (0..1), for floating hearts. */
  dogScreen(): { x: number; y: number } {
    this.dog.head.getWorldPosition(this.tmp);
    this.tmp.project(this.camera);
    return { x: (this.tmp.x + 1) / 2, y: (1 - this.tmp.y) / 2 };
  }

  // ------------------------------------------------------------ frame
  private frame(): void {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.t += dt;
    if (this.host && this.renderer && (this.host.clientWidth !== this.renderer.domElement.clientWidth || this.host.clientHeight !== this.renderer.domElement.clientHeight)) this.resize();

    // camera leans in while you eat
    const want = this.food && this.foodFade >= 0 ? 1 : 0;
    this.close += (want - this.close) * Math.min(1, dt * 2.2);
    const k = this.close * this.close * (3 - 2 * this.close);
    this.camera.position.set(THREE.MathUtils.lerp(0.25, 0.0, k), THREE.MathUtils.lerp(0.95, 0.22, k), THREE.MathUtils.lerp(1.85, 0.33, k));
    this.camera.lookAt(THREE.MathUtils.lerp(-0.12, 0, k), THREE.MathUtils.lerp(0.12, 0.07, k), THREE.MathUtils.lerp(-0.45, 0.02, k));

    // stove flame flicker
    const fl = 1 + Math.sin(this.t * 31) * 0.06 + Math.sin(this.t * 17.3) * 0.08;
    this.flame.scale.set(1, fl, 1);
    this.stoveLight.intensity = 2.4 * fl;

    // food: bite animation (lift / tilt / scoop), then the level drops
    if (this.food) {
      let lift = 0;
      if (this.biteT >= 0) {
        this.biteT += dt;
        lift = Math.sin(Math.min(1, this.biteT / 0.75) * Math.PI);
        if (this.biteT > 0.38) this.food.setBites(this.bites);
        if (this.biteT > 0.75) this.biteT = -1;
      }
      this.food.update?.(this.t, lift);
      if (this.foodId === 'tea') { this.food.group.rotation.x = lift * 0.35; this.food.group.position.y = 0.016 + lift * 0.05; }
      if (this.foodId === 'choco' || this.foodId === 'dalbhat') this.food.group.position.y = 0.016 + lift * 0.012;
      if (this.foodFade < 0) {
        this.foodFade -= dt;
        this.food.group.position.y -= dt * 0.05;
        if (this.foodFade < -0.8) this.clearFood(true);
      }
      // steam
      if (this.food?.steam && this.bites < 3) {
        this.steamAcc += dt;
        while (this.steamAcc > 0.12) {
          this.steamAcc -= 0.12;
          const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.puffTex, transparent: true, depthWrite: false, opacity: 0 }));
          this.food.group.localToWorld(s.position.copy(this.food.steam));
          s.position.x += (Math.random() - 0.5) * 0.04;
          s.position.z += (Math.random() - 0.5) * 0.04;
          s.scale.setScalar(0.03);
          this.scene.add(s);
          this.steam.push({ s, age: 0 });
        }
      }
    }
    for (let i = this.steam.length - 1; i >= 0; i--) {
      const st = this.steam[i];
      st.age += dt;
      st.s.position.y += dt * 0.07;
      st.s.position.x += Math.sin(this.t * 1.7 + i) * dt * 0.01;
      st.s.scale.setScalar(0.03 + st.age * 0.05);
      (st.s.material as THREE.SpriteMaterial).opacity = Math.min(1, st.age * 3) * Math.max(0, 1 - st.age / 1.6) * 0.38;
      if (st.age > 1.6) { this.scene.remove(st.s); (st.s.material as THREE.SpriteMaterial).dispose(); this.steam.splice(i, 1); }
    }

    // dog idle: breathing, ears, tail; looks at food, chews treats, wags when happy
    if (this.dog.root.visible) {
      this.dogHappy = Math.max(0, this.dogHappy - dt);
      this.dogChew = Math.max(0, this.dogChew - dt);
      this.dogLook = Math.max(0, this.dogLook - dt);
      const lie = this.dogHappy > 0.4 ? 0.35 : 1; // sits up when excited
      poseDog(this.dog, 0, 0, 1 - lie, lie);
      this.dog.body.scale.set(1, 1 + Math.sin(this.t * 2.2) * 0.012, 1 + Math.sin(this.t * 2.2) * 0.02);
      const wag = this.dogHappy > 0 ? 0.6 : 0.18;
      this.dog.tail.rotation.x = Math.sin(this.t * (this.dogHappy > 0 ? 16 : 4)) * wag;
      let hz = 0.1 + Math.sin(this.t * 0.7) * 0.04, hy = 0.15 + Math.sin(this.t * 0.31) * 0.2;
      if (this.food || this.dogLook > 0) { hy = 0.55; hz = 0.05; }
      if (this.dogChew > 0) hz += Math.abs(Math.sin(this.t * 14)) * 0.12;
      this.dog.head.rotation.set(Math.sin(this.t * 0.9) * 0.08, hy, hz - (1 - lie) * 0.3);
      this.dog.tongue.visible = this.dogHappy > 0.3 && this.dogChew <= 0;
      this.treat.visible = this.dogChew > 0.3;
    }
    this.renderer?.render(this.scene, this.camera);
  }
}
