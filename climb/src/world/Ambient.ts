import * as THREE from 'three';
import type { MountainField } from './Terrain';

/** Life around the climber: distant avalanches, alpine choughs, shooting stars. */
export class Ambient {
  readonly group = new THREE.Group();
  private readonly puffs: { s: THREE.Sprite; vel: THREE.Vector3; life: number; max: number }[] = [];
  private readonly birds: { g: THREE.Group; wings: THREE.Mesh[]; phase: number; r: number; h: number; speed: number }[] = [];
  private readonly star: THREE.Line;
  private starT = -1;
  private birdT = -1;
  private birdCenter = new THREE.Vector3();
  private nextAvalanche = 40;
  private nextBirds = 25;
  private nextStar = 20;
  private nextCrack = 30;
  onAvalanche: (distance: number, delay: number) => void = () => undefined;
  onIceCrack: () => void = () => undefined;

  constructor() {
    this.group.name = 'ambient';
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(32, 32, 2, 32, 32, 31);
    grad.addColorStop(0, 'rgba(255,255,255,0.9)');
    grad.addColorStop(0.6, 'rgba(255,255,255,0.35)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    for (let i = 0; i < 46; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0, fog: true }));
      s.visible = false;
      this.group.add(s);
      this.puffs.push({ s, vel: new THREE.Vector3(), life: 0, max: 1 });
    }
    // Alpine choughs: black birds with yellow beaks that follow climbers very high.
    const body = new THREE.MeshStandardMaterial({ color: 0x0c0c0e, roughness: 0.6, side: THREE.DoubleSide });
    for (let i = 0; i < 3; i++) {
      const b = new THREE.Group();
      const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.22, 3, 6).rotateX(Math.PI / 2), body);
      b.add(torso);
      const beak = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.07, 5).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xe8c21b }));
      beak.position.z = -0.2;
      b.add(beak);
      const wings: THREE.Mesh[] = [];
      for (const side of [-1, 1]) {
        const shape = new THREE.Shape();
        shape.moveTo(0, -0.08); shape.lineTo(side * 0.42, -0.02); shape.lineTo(side * 0.36, 0.1); shape.lineTo(0, 0.08);
        const w = new THREE.Mesh(new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2), body);
        b.add(w);
        wings.push(w);
      }
      b.visible = false;
      this.group.add(b);
      this.birds.push({ g: b, wings, phase: i * 2.1, r: 9 + i * 3, h: 7 + i * 2.5, speed: 0.35 + i * 0.08 });
    }
    const sg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, 1)]);
    this.star = new THREE.Line(sg, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 }));
    this.star.frustumCulled = false;
    this.group.add(this.star);
  }

  reset(): void {
    this.nextAvalanche = 35 + Math.random() * 40;
    this.nextBirds = 20 + Math.random() * 30;
    this.nextStar = 10 + Math.random() * 20;
    this.nextCrack = 25 + Math.random() * 30;
    for (const p of this.puffs) { p.life = 0; p.s.visible = false; }
    for (const b of this.birds) b.g.visible = false;
    this.birdT = -1;
  }

  update(dt: number, player: THREE.Vector3, field: MountainField, opts: { altitude: number; day: number; night: boolean; glacier: boolean; storm: number }): void {
    // --- Distant avalanche: a powder cloud pouring down a far face; its roar arrives later.
    this.nextAvalanche -= dt;
    if (this.nextAvalanche <= 0) {
      this.nextAvalanche = 70 + Math.random() * 80;
      for (let tries = 0; tries < 20; tries++) {
        const a = Math.random() * Math.PI * 2;
        const d = 260 + Math.random() * 520;
        const x = player.x + Math.cos(a) * d;
        const z = player.z + Math.sin(a) * d;
        const h = field.height(x, z);
        const n = field.normal(x, z, new THREE.Vector3(), 4);
        if (h < player.y + 30 || n.y > 0.8) continue;
        const down = new THREE.Vector3(n.x, 0, n.z).normalize();
        let k = 0;
        for (const p of this.puffs) {
          if (k > 40) break;
          p.life = p.max = 10 + Math.random() * 6;
          p.s.position.set(x + (Math.random() - 0.5) * 20, h + 5 + Math.random() * 6, z + (Math.random() - 0.5) * 20);
          const spd = 6 + Math.random() * 10;
          p.vel.copy(down).multiplyScalar(spd).add(new THREE.Vector3(0, -spd * 0.9, 0));
          p.s.userData.delay = k * 0.12;
          p.s.visible = true;
          k++;
        }
        this.onAvalanche(d, d / 343);
        break;
      }
    }
    for (const p of this.puffs) {
      if (p.life <= 0) continue;
      if (p.s.userData.delay > 0) { p.s.userData.delay -= dt; continue; }
      p.life -= dt;
      p.s.position.addScaledVector(p.vel, dt);
      const g = field.height(p.s.position.x, p.s.position.z) + 3;
      if (p.s.position.y < g) { p.s.position.y = g; p.vel.y = 0; p.vel.multiplyScalar(0.98); }
      const age = 1 - p.life / p.max;
      p.s.scale.setScalar(8 + age * 40);
      (p.s.material as THREE.SpriteMaterial).opacity = Math.min(1, age * 8) * (1 - age) * 0.55;
      if (p.life <= 0) p.s.visible = false;
    }

    // --- Choughs circling nearby on calm days below ~8,000 m.
    this.nextBirds -= dt;
    if (this.nextBirds <= 0 && this.birdT < 0 && opts.altitude < 8000 && !opts.night && opts.storm < 0.3) {
      this.birdT = 30 + Math.random() * 15;
      this.birdCenter.copy(player).add(new THREE.Vector3((Math.random() - 0.5) * 30, 0, (Math.random() - 0.5) * 30));
      this.nextBirds = 90 + Math.random() * 90;
    }
    if (this.birdT >= 0) {
      this.birdT -= dt;
      const t = performance.now() / 1000;
      this.birdCenter.lerp(player, dt * 0.05);
      for (const b of this.birds) {
        b.g.visible = this.birdT > 0;
        const ang = t * b.speed + b.phase;
        const x = this.birdCenter.x + Math.cos(ang) * b.r;
        const z = this.birdCenter.z + Math.sin(ang) * b.r;
        const y = Math.max(field.height(x, z) + 3, player.y + b.h + Math.sin(t * 0.7 + b.phase) * 2);
        b.g.position.set(x, y, z);
        b.g.rotation.set(0, -ang, Math.sin(t + b.phase) * 0.3);
        const flap = Math.sin(t * 9 + b.phase) * 0.6 * (Math.sin(t * 0.5 + b.phase) > 0 ? 1 : 0.15);
        b.wings[0].rotation.z = flap;
        b.wings[1].rotation.z = -flap;
      }
    }

    // --- Ice settling under the glacier: a sharp crack nearby.
    if (opts.glacier) {
      this.nextCrack -= dt;
      if (this.nextCrack <= 0) {
        this.nextCrack = 35 + Math.random() * 45;
        this.onIceCrack();
      }
    }

    // --- Shooting stars at night.
    this.nextStar -= dt;
    if (opts.night && this.nextStar <= 0 && this.starT < 0) {
      this.nextStar = 25 + Math.random() * 40;
      this.starT = 0.7;
      const a = Math.random() * Math.PI * 2;
      const start = new THREE.Vector3(Math.cos(a) * 4000, 2500 + Math.random() * 1500, Math.sin(a) * 4000).add(player);
      const dir = new THREE.Vector3(-Math.sin(a), -0.35, Math.cos(a)).normalize().multiplyScalar(900);
      this.star.userData = { start, dir };
    }
    if (this.starT >= 0) {
      this.starT -= dt;
      const { start, dir } = this.star.userData as { start: THREE.Vector3; dir: THREE.Vector3 };
      const k = 1 - this.starT / 0.7;
      const head = start.clone().addScaledVector(dir, k);
      const tail = start.clone().addScaledVector(dir, Math.max(0, k - 0.3));
      const pos = this.star.geometry.getAttribute('position') as THREE.BufferAttribute;
      pos.setXYZ(0, tail.x, tail.y, tail.z);
      pos.setXYZ(1, head.x, head.y, head.z);
      pos.needsUpdate = true;
      (this.star.material as THREE.LineBasicMaterial).opacity = Math.sin(k * Math.PI);
      if (this.starT < 0) (this.star.material as THREE.LineBasicMaterial).opacity = 0;
    }
  }
}
