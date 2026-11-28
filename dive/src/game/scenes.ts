import * as THREE from 'three';
import type { Creatures } from '../life/creatures';
import { heightAt, riverDist } from '../world/layout';
import { SCENES, type SceneId } from './story';

/** Fixed places for the sights the story points to; the others happen near where the diver goes in. */
export const SCENE_AT: Partial<Record<SceneId, { x: number; z: number; r: number }>> = {
  // a pod resting in the blue beyond the drop-off, about 15 m down
  whalesleep: { x: 14, z: 590, r: 30 },
  // the reef flat: coral heads release their bundles together
  spawning: { x: -30, z: 225, r: 55 },
  // Phase 9: a driftwood pile deep in the estuary channel (night) and a riffle of the river (day)
  akameeyes: { x: 318, z: -240, r: 25 },
  ayurun: { x: 258, z: -420, r: 25 },
};

/** F8 (4)：章の光景の場所の手がかり（潜り始めの小型吹き出し）。円は出さず、近づいて気配が出てから円を出す */
export const SCENE_CLUE: Partial<Record<SceneId, string>> = {
  whalesleep: '沖の大海原で、マッコウクジラが縦になって眠っているらしい。ドロップオフの先、水深15mあたりだ。',
  spawning: '夜のサンゴ礁だ。サンゴの上の、礁の真ん中あたりを探してみて。',
};

type Pose = { p: THREE.Vector3; yaw: number; pitch: number; s?: number; still?: boolean; k?: number[] };

/** A soft round sprite for glowing particles. */
function dotTexture(inner: string, mid: string, outer: string): THREE.CanvasTexture {
  const dot = document.createElement('canvas');
  dot.width = dot.height = 32;
  const x = dot.getContext('2d')!;
  const gr = x.createRadialGradient(16, 16, 0, 16, 16, 16);
  gr.addColorStop(0, inner);
  gr.addColorStop(0.4, mid);
  gr.addColorStop(1, outer);
  x.fillStyle = gr;
  x.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(dot);
}

/**
 * Staging for the special sights: posed or choreographed animals (sleeping whales, a bait ball, a manta
 * train, a jack tornado, …) and particle effects (coral spawn, glowing plankton).
 */
export class Scenes {
  readonly group = new THREE.Group();
  active = new Set<SceneId>();
  /** where each active sight is centred this dive */
  centre = new Map<SceneId, THREE.Vector3>();
  /** sights the diver has been told about ("something is out there…") */
  sensed = new Set<SceneId>();
  private t = 0;
  /** loop radius of the night manta (grows when the light goes out) */
  private mantaR = 2.5;
  private spawn: THREE.Points;
  private seeds: THREE.Vector3[] = [];
  private vel: Float32Array;
  private life: Float32Array;
  private noct: THREE.Points;
  private noctBase: Float32Array;
  private poses = new Map<SceneId, Pose[]>();
  private origScale = new Map<string, number[]>();

  constructor(private creatures: Creatures, coralTops: THREE.Vector3[]) {
    const c = SCENE_AT.spawning!;
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
    this.spawn = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.16, map: dotTexture('rgba(255,235,240,1)', 'rgba(255,150,180,0.8)', 'rgba(255,120,160,0)'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xffc8d8, fog: true }));
    this.spawn.frustumCulled = false;
    this.spawn.visible = false;
    this.group.add(this.spawn);
    // glowing plankton: a cloud that travels with the diver and lights up when the water is stirred
    const M = 1800;
    this.noctBase = new Float32Array(M * 3);
    for (let i = 0; i < M; i++) {
      this.noctBase[i * 3] = (Math.random() - 0.5) * 12;
      this.noctBase[i * 3 + 1] = (Math.random() - 0.5) * 7;
      this.noctBase[i * 3 + 2] = (Math.random() - 0.5) * 12;
    }
    const ng = new THREE.BufferGeometry();
    ng.setAttribute('position', new THREE.BufferAttribute(new Float32Array(M * 3), 3));
    this.noct = new THREE.Points(ng, new THREE.PointsMaterial({ size: 0.07, map: dotTexture('rgba(220,250,255,1)', 'rgba(90,200,255,0.8)', 'rgba(40,140,255,0)'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0x9ae8ff, fog: false }));
    this.noct.frustumCulled = false;
    this.noct.visible = false;
    this.group.add(this.noct);
  }

  private respawn(pos: Float32Array, i: number, age = 0): void {
    const s = this.seeds[(Math.random() * this.seeds.length) | 0];
    pos[i * 3] = s.x + (Math.random() - 0.5) * 1.2;
    pos[i * 3 + 1] = s.y + Math.random() * 0.2 + age * 0.05;
    pos[i * 3 + 2] = s.z + (Math.random() - 0.5) * 1.2;
    this.vel[i] = 0.08 + Math.random() * 0.12;
    this.life[i] = age;
  }

  /** Set up the sights for this dive around the entry point. */
  start(ids: SceneId[], entry: THREE.Vector3): void {
    this.stop();
    this.t = 0;
    for (const id of ids) {
      this.active.add(id);
      const fixed = SCENE_AT[id];
      const c = fixed ? new THREE.Vector3(fixed.x, 0, fixed.z) : new THREE.Vector3(entry.x, 0, entry.z + 40);
      if (!fixed) {
        // 30-55 m away in a random direction, over water deep enough for the animals
        for (let k = 0; k < 30; k++) {
          const a = Math.random() * Math.PI * 2, d = 30 + Math.random() * 25;
          const x = entry.x + Math.cos(a) * d, z = entry.z + Math.sin(a) * d;
          if (heightAt(x, z) < (id === 'dolphins' || id === 'noctiluca' ? -4 : -12)) { c.set(x, 0, z); break; }
        }
      }
      c.y = heightAt(c.x, c.z);
      this.centre.set(id, c);
      this.setup(id, c);
    }
  }

  private setup(id: SceneId, c: THREE.Vector3): void {
    const S = SCENES[id];
    if (!S.star || !S.n) return;
    const rt = this.creatures.list.find((r) => r.def.id === S.star);
    if (!rt) return;
    const n = Math.min(S.n, rt.agents.length);
    this.origScale.set(S.star, rt.agents.slice(0, n).map((a) => a.s));
    const poses: Pose[] = [];
    for (let i = 0; i < n; i++) poses.push({ p: new THREE.Vector3(c.x, -10, c.z), yaw: 0, pitch: 0, k: [Math.random(), Math.random(), Math.random()] });
    if (id === 'whalesleep') {
      const y = Math.max(-15, c.y + 9);
      const at = [[0, 0, 0, 0.4], [7, -1.5, 4, 2.1], [-5, 1, 8, -1.2]];
      poses.forEach((p, i) => { const q = at[i % 3]; p.p.set(c.x + q[0], y + q[1], c.z + q[2]); p.yaw = q[3]; p.pitch = -Math.PI / 2 + 0.06; p.still = true; });
    }
    if (id === 'whaleshark') {
      poses[0].p.set(c.x, -3.2, c.z);
      poses[0].pitch = -1.15;
      poses[0].still = true;
    }
    // young mantas that come to the light are smaller than the grown ones of the manta train
    if (id === 'mantanight') poses.forEach((p) => { p.s = (this.origScale.get(S.star!)![0] ?? 4) * 0.5; });
    if (id === 'humpback' && poses[1]) poses[1].s = (this.origScale.get(S.star)![0] ?? 12) * 0.38;
    this.poses.set(id, poses);
    this.creatures.stage.set(S.star, poses);
  }

  stop(): void {
    for (const id of this.active) {
      const star = SCENES[id].star;
      if (!star) continue;
      this.creatures.stage.delete(star);
      const rt = this.creatures.list.find((r) => r.def.id === star);
      const orig = this.origScale.get(star);
      if (rt && orig) orig.forEach((s, i) => { if (rt.agents[i]) rt.agents[i].s = s; });
    }
    this.active.clear();
    this.centre.clear();
    this.sensed.clear();
    this.poses.clear();
    this.origScale.clear();
    this.spawn.visible = false;
    this.noct.visible = false;
  }

  /** Move the choreographed animals and particles. */
  update(dt: number, night: number, player: THREE.Vector3, speed: number, fwd?: THREE.Vector3, lightOn = false): void {
    this.t += dt;
    const T = this.t;
    for (const [id, poses] of this.poses) {
      const c = this.centre.get(id)!;
      poses.forEach((p, i) => {
        const k = p.k ?? [0, 0, 0];
        let a: number, R: number, y: number;
        switch (id) {
          case 'baitball': { // a tight spinning ball a few metres across
            const h = (k[2] - 0.5) * 2;
            R = (0.5 + Math.sqrt(k[0]) * 1.7) * Math.sqrt(Math.max(0.15, 1 - h * h));
            a = k[1] * 6.28 + T * (1.7 - k[0] * 0.5);
            y = Math.max(c.y + 5, -12) + h * 2.0 * Math.sqrt(k[0]);
            break;
          }
          case 'tornado': // a tall column
            R = 1.8 + k[0] * 2.2; a = k[1] * 6.28 + T * 0.55; y = Math.max(c.y + 3, -18) + k[2] * 8; break;
          case 'hammers': // a slow oval loop over the deep
            R = 11 + k[0] * 3; a = T * 0.07 + i * 0.16; y = Math.max(c.y + 6, -26) + k[2] * 3; break;
          case 'mantatrain': // nose to tail, looping
            R = 7; a = T * 0.16 - i * 0.42; y = Math.max(c.y + 3, -9) + Math.sin(T * 0.4 - i * 0.6) * 0.8; break;
          case 'orcas': // a family passing in line
            R = 16; a = T * 0.11 - i * 0.16; y = -5 - i * 0.6; break;
          case 'humpback': // mother with the calf at her side
            R = 22 - i * 3.5; a = T * 0.035; y = -8 + i * 2.5; break;
          case 'dolphins': { // circling the diver, curious
            R = 4 + k[0] * 2.5; a = T * (0.45 + k[1] * 0.2) + i * 1.25;
            const yy = player.y + Math.sin(T * 0.8 + i) * 1.5 + (k[2] - 0.5) * 2;
            p.p.set(player.x + Math.cos(a) * R, Math.min(-0.8, Math.max(heightAt(player.x, player.z) + 1, yy)), player.z + Math.sin(a) * R);
            p.yaw = -a;
            p.pitch = -Math.cos(T * 0.8 + i) * 0.25;
            return;
          }
          case 'mantanight': { // somersaulting in the diver's light; the light going out sends it away
            if (i === 0) this.mantaR += ((lightOn ? 2.5 : 10) - this.mantaR) * Math.min(1, dt * 0.6);
            const away = Math.max(0, this.mantaR - 2.5);
            if (!this.sensed.has(id)) { p.p.set(c.x, -10, c.z); return; } // still out in the dark
            let fx = fwd ? fwd.x : 0, fz = fwd ? fwd.z : 1;
            const fl = Math.hypot(fx, fz) || 1;
            fx /= fl; fz /= fl;
            const ring = this.mantaR * (1 + i * 0.25);
            const ph = T * 0.75 + i * Math.PI + k[0] * 0.5;
            const cx = player.x + fx * (4 + away * 1.5), cz = player.z + fz * (4 + away * 1.5);
            const cy = Math.min(-2.5, Math.max(heightAt(cx, cz) + ring + 0.5, player.y + 0.3));
            const fwdC = Math.cos(ph), upS = Math.sin(ph);
            p.p.set(cx + fx * fwdC * ring, Math.min(-0.8, cy + upS * ring), cz + fz * fwdC * ring);
            // tangent of the loop (d/dph): backwards over the top, up at the near side
            const dF = -upS, dU = fwdC;
            const back = dF < 0;
            p.yaw = Math.atan2(fx, fz) + (back ? Math.PI : 0);
            p.pitch = -Math.atan2(dU, Math.abs(dF));
            return;
          }
          case 'lanternrise': { // a column of lights rising from the deep, then starting over at the bottom
            const ph = (k[2] + T * 0.03) % 1;
            const r = Math.sqrt(k[0]) * 4, ang = k[1] * 6.28 + T * 0.25;
            const lo = Math.max(c.y + 1, -30);
            p.p.set(c.x + Math.cos(ang) * r, Math.min(-8, lo + ph * (-8 - lo)), c.z + Math.sin(ang) * r);
            p.yaw = -ang;
            p.pitch = -0.7;
            return;
          }
          case 'flashlight': { // a loose ball of fish drifting round a rock
            const u = k[0] * 2 - 1, th = k[1] * 6.28 + T * 0.18 + k[2];
            const rr = 2.5 * Math.cbrt(k[2]) * Math.sqrt(1 - u * u);
            p.p.set(c.x + Math.cos(th) * rr, Math.min(-0.8, c.y + 2.6 + u * 1.6 + Math.sin(T * 0.4 + i) * 0.15), c.z + Math.sin(th) * rr);
            p.yaw = -th;
            p.pitch = 0;
            return;
          }
          case 'whaleshark':
            p.yaw = Math.sin(T * 0.1) * 0.3;
            return;
          case 'akameeyes': // one fish hanging in the shade of the driftwood, facing the diver's way in
            p.p.set(c.x + 1.2, Math.min(-1.2, c.y + 1.3), c.z + 1.5);
            p.yaw = Math.PI * 0.05; p.pitch = 0;
            return;
          case 'ayurun': { // a loose shoal holding against the current over the riffle, facing upstream
            const rv = riverDist(c.x, c.z);
            const ux = -rv.tx, uz = -rv.tz; // upstream
            const al = (k[0] - 0.5) * 9 + Math.sin(T * 0.5 + i) * 0.4;
            const cr = (k[1] - 0.5) * 7;
            const x = c.x + ux * al - uz * cr, z = c.z + uz * al + ux * cr;
            p.p.set(x, Math.min(-0.8, heightAt(x, z) + 0.45 + k[2] * 0.4), z);
            p.yaw = Math.atan2(ux, uz); p.pitch = 0;
            return;
          }
          default:
            return;
        }
        p.p.set(c.x + Math.cos(a) * R, Math.min(-0.8, y), c.z + Math.sin(a) * R);
        p.yaw = -a;
        p.pitch = 0;
      });
    }
    // coral spawn rises from the reef after dark
    const on = this.active.has('spawning') && night >= 0.5;
    this.spawn.visible = on;
    if (on) {
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
    // glowing plankton around the diver at night: brighter the more the water is stirred
    const nOn = this.active.has('noctiluca') && night >= 0.5;
    this.noct.visible = nOn;
    if (nOn) {
      const pos = this.noct.geometry.attributes.position as THREE.BufferAttribute;
      const a = pos.array as Float32Array;
      for (let i = 0; i < a.length; i += 3) {
        a[i] = player.x + this.noctBase[i] + Math.sin(T * 0.3 + i) * 0.2;
        a[i + 1] = Math.min(-0.3, player.y + this.noctBase[i + 1]);
        a[i + 2] = player.z + this.noctBase[i + 2] + Math.cos(T * 0.25 + i) * 0.2;
      }
      pos.needsUpdate = true;
      (this.noct.material as THREE.PointsMaterial).opacity = 0.25 + Math.min(1, speed / 1.2) * 0.75 * (0.6 + 0.4 * Math.sin(T * 9));
    }
  }

  /** A sight announces itself once when the diver comes near. */
  senseNear(player: THREE.Vector3): SceneId | null {
    for (const [id, c] of this.centre) {
      if (this.sensed.has(id)) continue;
      const near = id === 'dolphins' || id === 'noctiluca' ? 60 : 45;
      if (Math.hypot(player.x - c.x, player.z - c.z) < near) {
        this.sensed.add(id);
        return id;
      }
    }
    return null;
  }

  /** F8 (20)：主役の個体（star）が今いる位置。粒子の光景は空 */
  starPositions(id: SceneId): THREE.Vector3[] {
    return (this.poses.get(id) ?? []).map((q) => q.p);
  }

  /** Is a particle sight (coral spawn / glowing plankton) filling this camera's view? */
  particlesInView(cam: THREE.Camera): SceneId | null {
    const v = new THREE.Vector3();
    const count = (pts: THREE.Points, maxD: number) => {
      const a = (pts.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array;
      let n = 0;
      for (let i = 0; i < a.length; i += 3) {
        v.set(a[i], a[i + 1], a[i + 2]);
        if (v.distanceTo(cam.position) > maxD) continue;
        v.project(cam);
        if (Math.abs(v.x) < 0.6 && Math.abs(v.y) < 0.6 && v.z < 1) n++;
      }
      return n;
    };
    if (this.spawn.visible) {
      const c = SCENE_AT.spawning!;
      if (Math.hypot(cam.position.x - c.x, cam.position.z - c.z) < c.r && count(this.spawn, 8) >= 10) return 'spawning';
    }
    if (this.noct.visible && (this.noct.material as THREE.PointsMaterial).opacity > 0.45 && count(this.noct, 6) >= 25) return 'noctiluca';
    return null;
  }

  /** The sight a photo of this creature belongs to (one of the staged individuals), if any. */
  sceneOf(speciesId: string, agentIndex: number): SceneId | null {
    for (const id of this.active) {
      const S = SCENES[id];
      if (S.star === speciesId && agentIndex < (this.poses.get(id)?.length ?? 0)) return id;
    }
    return null;
  }
}
