import * as THREE from 'three';
import type { Creatures } from '../life/creatures';
import { heightAt } from '../world/layout';
import type { SceneId } from './story';

/** Where the special sights happen. */
export const SCENE_AT: Record<SceneId, { x: number; z: number; r: number }> = {
  // a pod resting in the blue beyond the drop-off, about 15 m down
  whalesleep: { x: 14, z: 590, r: 30 },
  // the reef flat: coral heads release their bundles together
  spawning: { x: -30, z: 225, r: 55 },
};

/**
 * Staging for the special sights. Sleeping sperm whales hang head-up and still; coral spawn rises like
 * pink snow from the coral heads after dark.
 */
export class Scenes {
  readonly group = new THREE.Group();
  active = new Set<SceneId>();
  private spawn: THREE.Points;
  private seeds: THREE.Vector3[] = [];
  private vel: Float32Array;
  private life: Float32Array;

  constructor(private creatures: Creatures, coralTops: THREE.Vector3[]) {
    const c = SCENE_AT.spawning;
    this.seeds = coralTops.filter((p) => Math.hypot(p.x - c.x, p.z - c.z) < c.r);
    // plus the reef floor around them, so the whole reef flat is releasing at once
    for (let k = 0; k < 500; k++) {
      const r = Math.sqrt(Math.random()) * c.r, t = Math.random() * Math.PI * 2;
      const x = c.x + Math.cos(t) * r, z = c.z + Math.sin(t) * r;
      this.seeds.push(new THREE.Vector3(x, heightAt(x, z) + 0.3, z));
    }
    const N = 6000;
    const pos = new Float32Array(N * 3);
    this.vel = new Float32Array(N);
    this.life = new Float32Array(N);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    for (let i = 0; i < N; i++) this.respawn(pos, i, Math.random() * 30);
    const dot = document.createElement('canvas');
    dot.width = dot.height = 32;
    const x = dot.getContext('2d')!;
    const gr = x.createRadialGradient(16, 16, 0, 16, 16, 16);
    gr.addColorStop(0, 'rgba(255,235,240,1)');
    gr.addColorStop(0.4, 'rgba(255,150,180,0.8)');
    gr.addColorStop(1, 'rgba(255,120,160,0)');
    x.fillStyle = gr;
    x.fillRect(0, 0, 32, 32);
    this.spawn = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.16, map: new THREE.CanvasTexture(dot), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xffc8d8, fog: true }));
    this.spawn.frustumCulled = false;
    this.spawn.visible = false;
    this.group.add(this.spawn);
  }

  private respawn(pos: Float32Array, i: number, age = 0): void {
    const s = this.seeds[(Math.random() * this.seeds.length) | 0];
    pos[i * 3] = s.x + (Math.random() - 0.5) * 1.2;
    pos[i * 3 + 1] = s.y + Math.random() * 0.2 + age * 0.05;
    pos[i * 3 + 2] = s.z + (Math.random() - 0.5) * 1.2;
    this.vel[i] = 0.08 + Math.random() * 0.12;
    this.life[i] = age;
  }

  /** Set up the sights for this dive. */
  start(ids: SceneId[]): void {
    this.stop();
    for (const id of ids) this.active.add(id);
    if (this.active.has('whalesleep')) {
      const c = SCENE_AT.whalesleep;
      const ground = heightAt(c.x, c.z);
      const y = Math.max(-15, ground + 9);
      this.creatures.stage.set('makkou', [
        { p: new THREE.Vector3(c.x, y, c.z), yaw: 0.4, pitch: -Math.PI / 2 + 0.06 },
        { p: new THREE.Vector3(c.x + 7, y - 1.5, c.z + 4), yaw: 2.1, pitch: -Math.PI / 2 + 0.1 },
        { p: new THREE.Vector3(c.x - 5, y + 1, c.z + 8), yaw: -1.2, pitch: -Math.PI / 2 + 0.04 },
      ]);
    }
  }

  stop(): void {
    this.active.clear();
    this.creatures.stage.delete('makkou');
    this.spawn.visible = false;
  }

  /** Coral spawning shows only at night. */
  update(dt: number, night: number): void {
    const on = this.active.has('spawning') && night >= 0.5;
    this.spawn.visible = on;
    if (!on) return;
    const pos = this.spawn.geometry.attributes.position as THREE.BufferAttribute;
    const a = pos.array as Float32Array;
    for (let i = 0; i < this.vel.length; i++) {
      this.life[i] += dt;
      a[i * 3 + 1] += this.vel[i] * dt;
      a[i * 3] += Math.sin(this.life[i] * 0.7 + i) * 0.02 * dt;
      if (this.life[i] > 40 || a[i * 3 + 1] > -0.5) this.respawn(a, i);
    }
    pos.needsUpdate = true;
  }

  /** Is the coral spawning in view of this camera (near enough to fill the frame with it)? */
  spawningInView(cam: THREE.Camera): boolean {
    if (!this.spawn.visible) return false;
    const c = SCENE_AT.spawning;
    if (Math.hypot(cam.position.x - c.x, cam.position.z - c.z) > c.r) return false;
    // count rising spawn particles in front of the lens within a few metres
    const a = (this.spawn.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array;
    const v = new THREE.Vector3();
    let n = 0;
    for (let i = 0; i < a.length; i += 3) {
      v.set(a[i], a[i + 1], a[i + 2]);
      if (v.distanceTo(cam.position) > 8) continue;
      v.project(cam);
      if (Math.abs(v.x) < 0.6 && Math.abs(v.y) < 0.6 && v.z < 1) n++;
    }
    return n >= 10;
  }
}
