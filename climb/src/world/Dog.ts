import * as THREE from 'three';
import { buildDog, poseDog, type DogRig } from './DogModel';

/**
 * The dog on the mountain. It walks a few metres ahead of the climber along the route (so it is
 * in view, leading the way), waits and looks back when you stop, and sits next to you when you
 * rest. The model and its pose come from DogModel (sculpted, rigged in code).
 */
export class Dog {
  readonly group = new THREE.Group();
  private readonly rig: DogRig;
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
    this.rig = buildDog();
    this.rig.root.scale.setScalar(0.85); // a compact Himalayan street dog, ~45 cm at the shoulder
    this.group.add(this.rig.root);
    this.group.name = 'dog';
    this.group.visible = false;
  }

  place(p: THREE.Vector3, yaw: number): void {
    this.pos.copy(p);
    this.yaw = yaw;
    this.placed = true;
  }

  bark(): void {
    this.barkT = 0.6;
    this.wag = 1;
  }

  lookAt(p: THREE.Vector3, seconds: number): void {
    this.lookTarget.copy(p);
    this.looking = seconds;
  }

  update(dt: number, target: THREE.Vector3, ground: (x: number, z: number) => number, resting: boolean, playerPos: THREE.Vector3, fondness: number): void {
    if (!this.placed) this.place(target, 0);
    const dx = target.x - this.pos.x, dz = target.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 25) this.pos.copy(target);
    const speed = dist > 0.4 ? Math.min(3.2, 0.6 + dist * 1.1) : 0;
    let moving = 0;
    if (speed > 0) {
      const step = Math.min(dist, speed * dt);
      this.pos.x += (dx / dist) * step;
      this.pos.z += (dz / dist) * step;
      moving = step / Math.max(dt, 1e-4);
      let d = Math.atan2(-dz, dx) - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * Math.min(1, dt * 6);
    } else {
      let d = Math.atan2(-(playerPos.z - this.pos.z), playerPos.x - this.pos.x) - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * Math.min(1, dt * 2.5);
    }
    this.pos.y = ground(this.pos.x, this.pos.z);

    this.sit += ((resting && moving < 0.1 ? 1 : 0) - this.sit) * Math.min(1, dt * 3);
    // trot cadence follows speed; a long stride at a trot, short steps when ambling
    this.phase += moving * dt * 6.5;
    const walk = Math.min(1, moving / 1.0);
    poseDog(this.rig, this.phase, walk * (1 - this.sit), this.sit);
    this.group.rotation.set(0, this.yaw, 0);
    this.group.position.copy(this.pos);

    this.wag = Math.max(0.15 + fondness * 0.6, this.wag - dt * 0.8);
    this.rig.tail.rotation.x = Math.sin(performance.now() * 0.02 * (0.6 + this.wag)) * 0.35 * this.wag;

    this.barkT = Math.max(0, this.barkT - dt);
    this.looking = Math.max(0, this.looking - dt);
    let hy = 0, hz = this.barkT > 0 ? Math.sin(this.barkT * 30) * 0.12 + 0.2 : 0;
    if (this.looking > 0) {
      const lx = this.lookTarget.x - this.pos.x, lz = this.lookTarget.z - this.pos.z;
      let d = Math.atan2(-lz, lx) - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      hy = THREE.MathUtils.clamp(d, -1.0, 1.0);
      hz = Math.max(hz, THREE.MathUtils.clamp(Math.atan2(this.lookTarget.y - this.pos.y, Math.hypot(lx, lz)), -0.3, 0.6));
    }
    // sitting lifts the chest; keep the head level by countering the body pitch
    this.rig.head.rotation.set(0, hy, hz - this.sit * 0.35);
    this.rig.tongue.visible = this.sit > 0.5 || moving > 1.4;
  }
}
