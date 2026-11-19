import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * The climber's own body in the world: high-altitude boots with crampons and down-suit
 * legs that walk in step (seen when looking down), plus an invisible silhouette with a
 * backpack that only casts a shadow on the snow.
 */
export class Body {
  readonly group = new THREE.Group();
  private readonly feet: THREE.Group[] = [];
  private readonly shins: THREE.Mesh[] = [];
  private readonly thighs: THREE.Mesh[] = [];
  private readonly shadowRig = new THREE.Group();
  private readonly shadowArms: THREE.Mesh[] = [];
  private readonly tmp = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3();
  private readonly right = new THREE.Vector3();

  constructor() {
    this.group.name = 'climberBody';
    const yellow = new THREE.MeshStandardMaterial({ color: 0xe0b21a, roughness: 0.55 });
    const black = new THREE.MeshStandardMaterial({ color: 0x18191b, roughness: 0.8 });
    const metal = new THREE.MeshStandardMaterial({ color: 0xa9b1b8, metalness: 0.9, roughness: 0.35 });
    const suit = new THREE.MeshStandardMaterial({ color: 0xa3221b, roughness: 0.6 });

    // Boot: double boot with integrated gaiter.
    const upper = mergeGeometries([
      new THREE.CapsuleGeometry(0.075, 0.16, 4, 12).rotateX(Math.PI / 2).scale(1.05, 0.95, 1.2).translate(0, 0.09, 0.03),
      new THREE.CylinderGeometry(0.075, 0.085, 0.24, 12).translate(0, 0.2, -0.02),
    ]);
    const sole = new THREE.BoxGeometry(0.13, 0.04, 0.33).translate(0, 0.02, 0.03);
    const cuff = new THREE.CylinderGeometry(0.08, 0.08, 0.05, 12).translate(0, 0.31, -0.02);
    const spikes: THREE.BufferGeometry[] = [];
    for (const z of [-0.09, 0.0, 0.08, 0.15]) {
      for (const x of [-0.055, 0.055]) spikes.push(new THREE.ConeGeometry(0.008, 0.035, 4).rotateX(Math.PI).translate(x, -0.015, z));
    }
    for (const x of [-0.025, 0.025]) spikes.push(new THREE.ConeGeometry(0.008, 0.05, 4).rotateX(Math.PI / 2 + 0.4).translate(x, 0.0, 0.2));
    spikes.push(new THREE.BoxGeometry(0.12, 0.008, 0.3).translate(0, 0.0, 0.03));
    const crampon = mergeGeometries(spikes.map((g) => g.toNonIndexed()));
    for (let i = 0; i < 2; i++) {
      const f = new THREE.Group();
      f.add(new THREE.Mesh(upper, yellow), new THREE.Mesh(sole, black), new THREE.Mesh(cuff, black), new THREE.Mesh(crampon, metal));
      f.traverse((o) => { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; });
      this.feet.push(f);
      this.group.add(f);
      // Down-suit legs: shin and thigh segments, oriented each frame.
      // Shins also only cast shadows: seen from above their cut tops look wrong.
      const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.085, 1, 8).translate(0, 0.5, 0), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
      void suit;
      // Thighs are right under the eyes and only read as clutter, so they cast a shadow but are not drawn.
      const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 1, 8).translate(0, 0.5, 0), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
      for (const m of [shin, thigh]) { m.castShadow = true; m.frustumCulled = false; this.group.add(m); }
      this.shins.push(shin);
      this.thighs.push(thigh);
    }

    // Shadow-only upper body: torso, head, pack, arms. Invisible to the camera.
    const ghost = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.45, 4, 10), ghost);
    torso.position.y = 1.2;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), ghost);
    head.position.y = 1.68;
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.55, 0.24), ghost);
    pack.position.set(0, 1.25, 0.24);
    const bottle = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.4, 8), ghost);
    bottle.position.set(0.14, 1.62, 0.24);
    this.shadowRig.add(torso, head, pack, bottle);
    for (const side of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.55, 3, 8).translate(0, -0.32, 0), ghost);
      arm.position.set(side * 0.3, 1.45, 0);
      this.shadowArms.push(arm);
      this.shadowRig.add(arm);
    }
    const axe = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.65, 4).translate(0, -0.95, 0), ghost);
    this.shadowArms[1].add(axe);
    this.shadowRig.traverse((o) => { o.castShadow = true; o.frustumCulled = false; });
    this.group.add(this.shadowRig);
  }

  private tether: THREE.Mesh | null = null;

  /** Cow's-tail sling from the harness to the carabiner on the fixed rope (null hides it). */
  setTether(attach: THREE.Vector3 | null, pos: THREE.Vector3, yaw: number): void {
    if (!this.tether) {
      this.tether = new THREE.Mesh(
        new THREE.CylinderGeometry(0.009, 0.009, 1, 6).translate(0, 0.5, 0),
        new THREE.MeshStandardMaterial({ color: 0x2a5bd1, roughness: 0.8 }),
      );
      this.tether.castShadow = true;
      this.tether.frustumCulled = false;
      const biner = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.006, 6, 14), new THREE.MeshStandardMaterial({ color: 0xd8a02a, metalness: 0.85, roughness: 0.35 }));
      biner.name = 'tetherBiner';
      this.group.add(this.tether, biner);
      this.tether.userData.biner = biner;
    }
    const biner = this.tether.userData.biner as THREE.Mesh;
    if (!attach) { this.tether.visible = false; biner.visible = false; return; }
    const fwd = this.fwd.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    const harness = new THREE.Vector3(pos.x + fwd.x * 0.12, pos.y + 0.98, pos.z + fwd.z * 0.12);
    const d = attach.clone().sub(harness);
    const len = Math.min(d.length(), 1.4);
    d.normalize();
    // the sling hangs: shorten the visible straight part and let the carabiner sit on the rope
    this.orient(this.tether, harness, harness.clone().addScaledVector(d, len));
    this.tether.visible = true;
    biner.visible = true;
    biner.position.copy(harness).addScaledVector(d, len);
    biner.lookAt(attach.clone().add(new THREE.Vector3(0, 1, 0)));
  }

  /**
   * pos: point on the ground under the player; yaw: facing; stepPhase: stride counter;
   * ground: height lookup (includes ladders).
   */
  update(pos: THREE.Vector3, yaw: number, stepPhase: number, speed: number, crouch: number, ground: (x: number, z: number) => number): void {
    const fwd = this.fwd.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    const right = this.right.set(-fwd.z, 0, fwd.x);
    const walk = Math.min(1, speed / 0.7);
    const ph = stepPhase * Math.PI;
    const hip = pos.y + 0.95 - crouch * 0.35;
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      const p = ph + (i === 0 ? 0 : Math.PI);
      const stride = Math.cos(p) * 0.3 * walk; // forward/back
      const lift = Math.max(0, Math.sin(p)) * 0.11 * walk;
      const fx = pos.x + fwd.x * (stride + 0.08) + right.x * side * 0.15;
      const fz = pos.z + fwd.z * (stride + 0.08) + right.z * side * 0.15;
      const gy = ground(fx, fz);
      const f = this.feet[i];
      f.position.set(fx, gy + lift, fz);
      // Pitch the boot to the slope along the walking direction.
      const ahead = ground(fx + fwd.x * 0.2, fz + fwd.z * 0.2);
      const pitch = Math.atan2(ahead - gy, 0.2);
      f.rotation.set(0, 0, 0);
      f.rotation.order = 'YXZ';
      f.rotation.y = yaw + Math.PI;
      f.rotation.x = pitch - Math.max(0, Math.sin(p)) * 0.3 * walk;
      // Legs: ankle -> knee -> hip with the knee pushed forward.
      const ankle = this.tmp.set(fx, gy + lift + 0.3, fz);
      const hipP = new THREE.Vector3(pos.x + right.x * side * 0.13 + fwd.x * 0.02, hip, pos.z + right.z * side * 0.13 + fwd.z * 0.02);
      const knee = ankle.clone().lerp(hipP, 0.5).addScaledVector(fwd, 0.12 + lift * 0.8 + crouch * 0.2);
      this.orient(this.shins[i], ankle, ankle.clone().lerp(knee, 0.75));
      this.orient(this.thighs[i], knee, hipP);
    }
    // Shadow rig follows the body with a gentle lean into the slope.
    this.shadowRig.position.set(pos.x, pos.y - crouch * 0.35, pos.z);
    this.shadowRig.rotation.set(0.1 * walk, yaw, 0, 'YXZ');
    this.shadowArms[0].rotation.x = Math.sin(ph) * 0.4 * walk;
    this.shadowArms[1].rotation.x = -Math.sin(ph) * 0.4 * walk - 0.2;
  }

  private orient(m: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3): void {
    const d = b.clone().sub(a);
    const len = d.length();
    m.position.copy(a);
    m.scale.set(1, Math.max(0.01, len), 1);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.divideScalar(len || 1));
  }
}
