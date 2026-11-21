import * as THREE from 'three';

/**
 * A Himalayan street dog that joins the climb. Low-poly but readable: a tan body with a
 * white chest and paws, ears, a curled tail that wags, and a trotting gait. It walks a few
 * metres ahead of the climber along the route (so it is in view, like a companion leading
 * the way), waits and looks back when you stop, and sits next to you when you rest.
 */
export class Dog {
  readonly group = new THREE.Group();
  private readonly legs: THREE.Object3D[] = [];
  private readonly tail = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly body: THREE.Mesh;
  private phase = 0;
  private wag = 0;
  private sit = 0;
  private yaw = 0;
  private barkT = 0;
  private readonly lookTarget = new THREE.Vector3();
  private looking = 0;
  readonly pos = new THREE.Vector3();
  private placed = false;

  constructor() {
    const fur = new THREE.MeshStandardMaterial({ color: 0xb4865a, roughness: 0.95 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x5a3d26, roughness: 0.95 });
    const white = new THREE.MeshStandardMaterial({ color: 0xe9e1d4, roughness: 0.95 });
    const nose = new THREE.MeshStandardMaterial({ color: 0x1b1512, roughness: 0.4 });
    const S = 1; // ~0.55 m at the shoulder

    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.17 * S, 0.4 * S, 6, 12), fur);
    body.rotation.z = Math.PI / 2;
    body.position.y = 0.44;
    this.body = body;
    this.group.add(body);
    const chest = new THREE.Mesh(new THREE.SphereGeometry(0.135, 12, 10), white);
    chest.scale.set(0.9, 1.05, 0.95);
    chest.position.set(0.24, 0.42, 0);
    this.group.add(chest);
    // a darker saddle on the back
    const saddle = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.3, 4, 10), dark);
    saddle.rotation.z = Math.PI / 2;
    saddle.scale.set(1, 1, 1.2);
    saddle.position.set(-0.04, 0.55, 0);
    this.group.add(saddle);

    // head
    this.head.position.set(0.37, 0.63, 0);
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.13, 14, 12), fur);
    skull.scale.set(1.1, 0.95, 0.95);
    this.head.add(skull);
    const muzzle = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.09, 4, 8), white);
    muzzle.rotation.z = Math.PI / 2;
    muzzle.position.set(0.12, -0.035, 0);
    this.head.add(muzzle);
    const n = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), nose);
    n.position.set(0.19, -0.02, 0);
    this.head.add(n);
    for (const z of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.11, 6), dark);
      ear.position.set(-0.01, 0.1, z * 0.06);
      ear.rotation.set(z * 0.25, 0, -0.15);
      this.head.add(ear);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.014, 6, 5), nose);
      eye.position.set(0.085, 0.025, z * 0.05);
      this.head.add(eye);
    }
    this.group.add(this.head);

    // legs: pivot at the hip/shoulder so they swing
    const legGeo = new THREE.CapsuleGeometry(0.052, 0.24, 4, 8);
    legGeo.translate(0, -0.16, 0);
    const pawGeo = new THREE.SphereGeometry(0.045, 8, 6);
    for (const [x, z] of [[0.22, 0.09], [0.22, -0.09], [-0.2, 0.09], [-0.2, -0.09]] as const) {
      const pivot = new THREE.Group();
      pivot.position.set(x, 0.4, z);
      const leg = new THREE.Mesh(legGeo, fur);
      pivot.add(leg);
      const paw = new THREE.Mesh(pawGeo, white);
      paw.position.y = -0.33;
      paw.scale.set(1.2, 0.7, 1);
      pivot.add(paw);
      this.legs.push(pivot);
      this.group.add(pivot);
    }

    // curled tail
    this.tail.position.set(-0.33, 0.55, 0);
    const tailGeo = new THREE.TorusGeometry(0.08, 0.03, 6, 12, Math.PI * 1.3);
    const t = new THREE.Mesh(tailGeo, fur);
    t.rotation.set(0, Math.PI / 2, 0.6);
    t.position.set(-0.02, 0.07, 0);
    this.tail.add(t);
    this.group.add(this.tail);

    this.group.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.group.name = 'dog';
    this.group.visible = false;
  }

  /** Snap to a spot (on spawn / after a retry). */
  place(p: THREE.Vector3, yaw: number): void {
    this.pos.copy(p);
    this.yaw = yaw;
    this.placed = true;
  }

  bark(): void {
    this.barkT = 0.6;
    this.wag = 1;
  }

  /** Turn the head toward something (e.g. a cracking serac). */
  lookAt(p: THREE.Vector3, seconds: number): void {
    this.lookTarget.copy(p);
    this.looking = seconds;
  }

  /**
   * @param target where the dog wants to be (already on the ground)
   * @param ground height at x,z
   * @param resting the climber is resting: sit down
   * @param playerPos to look back at while waiting
   * @param fondness 0..1: how happy it is (wag)
   */
  update(dt: number, target: THREE.Vector3, ground: (x: number, z: number) => number, resting: boolean, playerPos: THREE.Vector3, fondness: number): void {
    if (!this.placed) this.place(target, 0);
    const dx = target.x - this.pos.x, dz = target.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    // trot to catch up, amble when close; teleport if left far behind (ladders, retries)
    if (dist > 25) { this.pos.copy(target); }
    const speed = dist > 0.4 ? Math.min(3.2, 0.6 + dist * 1.1) : 0;
    let moving = 0;
    if (speed > 0) {
      const step = Math.min(dist, speed * dt);
      this.pos.x += (dx / dist) * step;
      this.pos.z += (dz / dist) * step;
      moving = step / Math.max(dt, 1e-4);
      const want = Math.atan2(-dz, dx);
      let d = want - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * Math.min(1, dt * 6);
    } else {
      // waiting: face the climber
      const want = Math.atan2(-(playerPos.z - this.pos.z), playerPos.x - this.pos.x);
      let d = want - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * Math.min(1, dt * 2.5);
    }
    this.pos.y = ground(this.pos.x, this.pos.z);

    this.sit += ((resting && moving < 0.1 ? 1 : 0) - this.sit) * Math.min(1, dt * 3);
    this.phase += moving * dt * 5.2;
    const swing = Math.min(1, moving / 1.2) * 0.75;
    this.legs.forEach((l, i) => {
      const ph = this.phase + (i === 0 || i === 3 ? 0 : Math.PI);
      l.rotation.z = Math.sin(ph) * swing * (1 - this.sit);
    });
    // sitting: haunches down, front legs straight
    this.legs[2].rotation.z += this.sit * 1.2;
    this.legs[3].rotation.z += this.sit * 1.2;
    this.body.rotation.y = 0;
    this.group.rotation.set(0, this.yaw, this.sit * 0.45);
    this.group.position.set(this.pos.x, this.pos.y - this.sit * 0.12 + Math.abs(Math.sin(this.phase)) * 0.03 * swing, this.pos.z);

    this.wag = Math.max(0.15 + fondness * 0.6, this.wag - dt * 0.8);
    this.tail.rotation.y = Math.sin(performance.now() * 0.02 * (0.6 + this.wag)) * 0.5 * this.wag;

    // head: look at something, bob when barking
    this.barkT = Math.max(0, this.barkT - dt);
    this.looking = Math.max(0, this.looking - dt);
    let hy = 0, hz = this.barkT > 0 ? Math.sin(this.barkT * 30) * 0.15 + 0.25 : 0;
    if (this.looking > 0) {
      const lx = this.lookTarget.x - this.pos.x, lz = this.lookTarget.z - this.pos.z;
      let d = Math.atan2(-lz, lx) - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      hy = THREE.MathUtils.clamp(d, -1.1, 1.1);
      hz = Math.max(hz, THREE.MathUtils.clamp(Math.atan2(this.lookTarget.y - this.pos.y, Math.hypot(lx, lz)), -0.3, 0.7));
    }
    this.head.rotation.set(0, hy, hz);
  }
}
