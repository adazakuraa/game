import * as THREE from 'three';
import type { Intents } from '../core/Input';
import type { MountainField } from '../world/Terrain';
import type { Route, RopeSegment } from '../world/Route';
import type { Ladder } from '../world/Props';
import { clamp } from '../utils/noise';

export type PlayerMode = 'walk' | 'slide' | 'transfer' | 'clipping' | 'dead';

export interface PlayerContext {
  hypoxia: number;
  stamina: number;
  collapsed: boolean;
  frostbite: number;
  gust: number;
  windDir: THREE.Vector3;
  rng: () => number;
  deepSnow: boolean;
  drift: number;
}

export type PlayerEvent =
  | { type: 'step'; surface: 'snow' | 'rock'; heavy: number }
  | { type: 'slip'; caught: boolean }
  | { type: 'arrest' }
  | { type: 'axe' }
  | { type: 'fallDeath' }
  | { type: 'clipped' }
  | { type: 'unclipped' }
  | { type: 'transferred' }
  | { type: 'anchorBlock' }
  | { type: 'tooSteep' }
  | { type: 'gustKnock' }
  | { type: 'crevasseDeath' }
  | { type: 'crevasseCaught' }
  | { type: 'ladderWobble' }
  | { type: 'actionCancelled' };

const UP = new THREE.Vector3(0, 1, 0);

export class Player {
  readonly pos = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  mode: PlayerMode = 'walk';
  clip: RopeSegment | null = null;
  routeS = 0;
  routeDist = 0;
  private routeHint = 0;
  speed = 0;
  exertion = 0;
  resting = false;
  stepPhase = 0;
  slopeDeg = 0;
  slideVel = new THREE.Vector3();
  slideStartY = 0;
  arresting = false;
  actionT = 0;
  /** total length of the current clip/transfer/unclip action (s) */
  actionDur = 1;
  actionKind: 'clip' | 'unclip' | 'transfer' | null = null;
  /** the stick was let go during the action (a fresh push cancels it) */
  private actionReleased = false;
  /** where on the rope the hand is working (world) */
  readonly actionTarget = new THREE.Vector3();
  /** for transfers: the anchor being passed */
  readonly actionAnchor = new THREE.Vector3();
  private pendingClip: RopeSegment | null = null;
  private pendingUnclip = false;
  shake = 0;
  bob = 0;
  atAnchor = 0; // -1 lower, +1 upper, 0 none
  private lastBlockMsg = 0;
  private lastGust = 0;
  readonly events: PlayerEvent[] = [];
  private readonly tmp = new THREE.Vector3();
  private readonly nrm = new THREE.Vector3();
  descending = false;
  onLadder = false;
  ladders: Ladder[] = [];

  constructor(private readonly field: MountainField, private readonly route: Route) {}

  /** Ground height including ladder decks over crevasses. */
  groundAt(x: number, z: number): { y: number; ladder: Ladder | null; lat: number } {
    for (const l of this.ladders) {
      const px = x - l.cx;
      const pz = z - l.cz;
      const along = px * l.ux + pz * l.uz;
      if (Math.abs(along) > l.halfLen) continue;
      const lat = px * -l.uz + pz * l.ux;
      if (Math.abs(lat) > 0.55) continue;
      const t = (along + l.halfLen) / (2 * l.halfLen);
      return { y: l.y0 + (l.y1 - l.y0) * t + 0.04, ladder: l, lat };
    }
    return { y: this.field.height(x, z), ladder: null, lat: 0 };
  }

  reset(s: number, yawTowardsRoute = true): void {
    const p = this.route.pointAt(s);
    this.pos.set(p.x, this.groundAt(p.x, p.z).y, p.z);
    const d = this.route.directionAt(s + 2);
    if (yawTowardsRoute) this.yaw = Math.atan2(-d.x, -d.z);
    this.pitch = 0.05;
    this.mode = 'walk';
    this.clip = null;
    this.routeHint = -1;
    this.updateRoute();
    this.slideVel.set(0, 0, 0);
    this.speed = 0;
    this.actionT = 0;
    this.shake = 0;
    this.pendingClip = null;
    this.pendingUnclip = false;
  }

  private updateRoute(): void {
    const n = this.route.nearest(this.pos.x, this.pos.z, this.routeHint, 80);
    this.routeHint = n.i;
    this.routeS = n.s;
    this.routeDist = n.dist;
  }

  /** Closest rope segment within reach (for clipping in). */
  nearestRope(maxDist = 2.6): RopeSegment | null {
    let best: RopeSegment | null = null;
    let bd = maxDist;
    for (const r of this.route.ropes) {
      if (this.routeS < r.sA - 30 || this.routeS > r.sB + 30) continue;
      const seg = this.distToSegment(r);
      if (seg.t < -0.08 || seg.t > 1.08) continue; // must be alongside the rope, not beyond an anchor
      if (seg.dist < bd) { bd = seg.dist; best = r; }
    }
    return best;
  }

  private distToSegment(r: RopeSegment): { dist: number; t: number; px: number; pz: number } {
    const dx = r.b.x - r.a.x;
    const dz = r.b.z - r.a.z;
    const l2 = dx * dx + dz * dz || 1;
    const t = ((this.pos.x - r.a.x) * dx + (this.pos.z - r.a.z) * dz) / l2;
    const tc = clamp(t, 0, 1);
    const px = r.a.x + dx * tc;
    const pz = r.a.z + dz * tc;
    return { dist: Math.hypot(this.pos.x - px, this.pos.z - pz), t, px, pz };
  }

  /** Point where the carabiner rides on the rope (world). */
  attachPoint(out: THREE.Vector3): THREE.Vector3 | null {
    if (!this.clip) return null;
    return this.route.ropePoint(this.clip, this.ropeT(), out);
  }

  /** Where the left hand holds the jumar: on the rope a little ahead in the direction of travel. */
  gripPoint(out: THREE.Vector3): THREE.Vector3 | null {
    if (!this.clip) return null;
    const seg = this.clip;
    const len = Math.max(1, Math.hypot(seg.b.x - seg.a.x, seg.b.z - seg.a.z));
    const t = clamp(this.ropeT() + ((this.descending ? -1 : 1) * 0.75) / len, 0, 1);
    return this.route.ropePoint(seg, t, out);
  }

  /** 0..1 progress through the current rope action. */
  get actionProgress(): number {
    return this.actionKind ? 1 - Math.max(0, this.actionT) / this.actionDur : 0;
  }

  ropeT(): number {
    if (!this.clip) return 0;
    return clamp(this.distToSegment(this.clip).t, 0, 1);
  }

  update(dt: number, input: Intents, ctx: PlayerContext): void {
    this.events.length = 0;
    if (this.mode === 'dead') return;

    // Look
    this.yaw += input.lookX;
    this.pitch = clamp(this.pitch + input.lookY, -1.35, 1.2);
    if (ctx.drift > 0) this.yaw += Math.sin(performance.now() * 0.0007) * 0.0025 * ctx.drift;

    const g0 = this.groundAt(this.pos.x, this.pos.z);
    this.onLadder = !!g0.ladder;
    if (this.onLadder) {
      this.nrm.set(0, 1, 0);
      this.slopeDeg = 5;
    } else {
      this.field.normal(this.pos.x, this.pos.z, this.nrm);
      this.slopeDeg = THREE.MathUtils.radToDeg(Math.acos(clamp(this.nrm.y, -1, 1)));
    }

    if (this.mode === 'slide') {
      this.updateSlide(dt, input);
      this.updateRoute();
      return;
    }

    if (this.mode === 'transfer' || this.mode === 'clipping') {
      // Pushing the stick abandons the rope work (e.g. to get out from under falling ice);
      // you stay clipped to whatever you were already on.
      const push = Math.max(Math.abs(input.moveX), Math.abs(input.moveY));
      if (push < 0.2) this.actionReleased = true;
      if (this.actionReleased && push > 0.5) {
        this.pendingClip = null;
        this.pendingUnclip = false;
        this.actionKind = null;
        this.actionT = 0;
        this.mode = 'walk';
        this.events.push({ type: 'actionCancelled' });
        return;
      }
      this.actionT -= dt;
      this.speed = 0;
      this.exertion = 0.05;
      this.resting = false;
      if (this.actionT <= 0) {
        if (this.pendingUnclip) {
          this.clip = null;
          this.events.push({ type: 'unclipped' });
        } else if (this.pendingClip) {
          const was = this.mode;
          this.clip = this.pendingClip;
          this.events.push({ type: was === 'transfer' ? 'transferred' : 'clipped' });
        }
        this.pendingClip = null;
        this.pendingUnclip = false;
        this.actionKind = null;
        this.mode = 'walk';
      }
      return;
    }

    // Clip / transfer / unclip
    this.atAnchor = 0;
    if (this.clip) {
      const d = this.distToSegment(this.clip);
      // Transfers follow the direction of travel: up the rope while ascending, down while descending.
      if (!this.descending && d.t > 0.97) this.atAnchor = 1;
      else if (this.descending && d.t < 0.03) this.atAnchor = -1;
    }
    if (input.clipPressed) this.handleClipAction();

    this.resting = input.rest || ctx.collapsed;
    const wantMove = !this.resting && (Math.abs(input.moveX) > 0.05 || Math.abs(input.moveY) > 0.05);
    let moved = 0;
    if (wantMove) {
      const fwd = this.tmp.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
      const dir = new THREE.Vector3().addScaledVector(fwd, input.moveY).addScaledVector(right, input.moveX * 0.8);
      const mag = Math.min(1, dir.length());
      dir.normalize();
      const probe = 0.8;
      const h0 = this.groundAt(this.pos.x, this.pos.z).y;
      const h1 = this.groundAt(this.pos.x + dir.x * probe, this.pos.z + dir.z * probe).y;
      const grade = (h1 - h0) / probe;
      const up = Math.max(0, grade);
      const down = Math.max(0, -grade);
      // Full stick = a steady mountaineering pace, not a brisk walk.
      let speed = 1.6 * mag;
      speed *= 1 / (1 + up * 1.6) / (1 + down * 0.5);
      speed *= 1 - ctx.hypoxia * 0.45;
      speed *= ctx.stamina < 20 ? 0.55 + ctx.stamina * 0.0225 : 1;
      speed *= ctx.deepSnow ? 0.72 : 1;
      speed *= 1 - ctx.frostbite * 0.002;
      if (input.moveY < -0.2) speed *= 0.6; // stepping backwards

      const climbAngle = THREE.MathUtils.radToDeg(Math.atan(up));
      const ascending = !!this.clip && climbAngle > 30;
      if (ascending) speed *= 0.85; // jumaring
      const maxAngle = this.clip ? 72 : 47;
      if (climbAngle > maxAngle) {
        speed = 0;
        if (performance.now() - this.lastBlockMsg > 2500) {
          this.events.push({ type: 'tooSteep' });
          this.lastBlockMsg = performance.now();
        }
      }

      const nx = this.pos.x + dir.x * speed * dt;
      const nz = this.pos.z + dir.z * speed * dt;
      const prevX = this.pos.x;
      const prevZ = this.pos.z;
      this.pos.x = nx;
      this.pos.z = nz;
      if (this.clip) this.applyTether();
      moved = Math.hypot(this.pos.x - prevX, this.pos.z - prevZ);
      this.speed = moved / Math.max(dt, 1e-4);
      this.exertion = clamp((this.speed / 2.75) * (0.45 + up * 1.4 + (ascending ? 0.3 : 0)), 0, 1);

      // Step cadence
      // ~0.85 m per step: full stick reads as an ordinary walking cadence (~1.9 steps/s on the flat).
      const stride = 0.85;
      const before = Math.floor(this.stepPhase);
      this.stepPhase += moved / stride;
      if (Math.floor(this.stepPhase) !== before) {
        const rock = this.nrm.y < 0.6;
        this.events.push({ type: 'step', surface: rock ? 'rock' : 'snow', heavy: this.exertion });
      }

      // Ladder: crampons on aluminium rungs. A wobble off the rungs is a fall into the crevasse.
      const gl = this.groundAt(this.pos.x, this.pos.z);
      if (gl.ladder) {
        // Balance assist toward the ladder's centre line.
        const k = Math.min(1, dt * 2.5);
        this.pos.x -= -gl.ladder.uz * gl.lat * k;
        this.pos.z -= gl.ladder.ux * gl.lat * k;
        const p = 0.012 * (1 + ctx.hypoxia + ctx.gust * 3 + (ctx.stamina < 25 ? 2 : 0) + ctx.drift * 3);
        if (moved > 0 && ctx.rng() < p * moved) {
          if (this.clip) { this.shake = 1; this.events.push({ type: 'ladderWobble' }); }
          else this.fallIntoCrevasse();
        }
      }
      // Slip risk on steep ground when not clipped.
      const slope = this.slopeDeg;
      if (moved > 0 && slope > 31 && !gl.ladder) {
        const base = Math.pow((slope - 31) / 19, 2) * 0.05;
        const mult = 1 + ctx.hypoxia * 2 + (ctx.stamina < 25 ? 1.5 : 0) + down * 2.5 + ctx.gust * 1.5 + ctx.drift * 2;
        // Kicked steps in the boot track are far more secure than fresh slope.
        const onTrack = this.routeDist < 1.3 ? 0.35 : 1;
        if (ctx.rng() < base * mult * moved * onTrack) this.slip(!!this.clip);
      }
    } else {
      this.speed *= 0.8;
      this.exertion = Math.max(0, this.exertion - dt * 2);
    }
    if (this.mode !== 'walk') { this.updateRoute(); return; }

    // Stepping off the ladder or the lip of a crevasse.
    const gNow = this.groundAt(this.pos.x, this.pos.z);
    if (!gNow.ladder && this.field.crevasseDepth(this.pos.x, this.pos.z) > 1.6) {
      this.fallIntoCrevasse();
      if (this.mode !== 'walk') { this.updateRoute(); return; }
    }

    // Standing on very steep ground: slide unless clipped.
    if (this.slopeDeg > 54 && !this.clip && !gNow.ladder) this.slip(false);

    // Gust knock-down on exposed ground.
    if (ctx.gust > 0.7 && this.lastGust <= 0.7 && !this.resting && this.slopeDeg > 24) {
      if (!this.clip && ctx.rng() < 0.45) {
        this.events.push({ type: 'gustKnock' });
        this.pos.addScaledVector(ctx.windDir, 0.6);
        this.slip(false);
      } else if (this.clip) {
        this.shake = Math.max(this.shake, 0.4);
      }
    }
    this.lastGust = ctx.gust;

    this.pos.y = this.groundAt(this.pos.x, this.pos.z).y;
    this.updateRoute();
    this.bob = Math.sin(this.stepPhase * Math.PI) * Math.min(1, this.speed / 0.8);
    this.shake = Math.max(0, this.shake - dt * 1.5);
  }

  private fallIntoCrevasse(): void {
    if (this.clip) {
      // The handline holds: haul back out onto the near rim.
      const l = this.ladders.reduce<Ladder | null>((best, c) => {
        const d = Math.hypot(c.cx - this.pos.x, c.cz - this.pos.z);
        return !best || d < Math.hypot(best.cx - this.pos.x, best.cz - this.pos.z) ? c : best;
      }, null);
      if (l) {
        const along = (this.pos.x - l.cx) * l.ux + (this.pos.z - l.cz) * l.uz;
        const side = along >= 0 ? 1 : -1;
        this.pos.x = l.cx + l.ux * side * (l.halfLen + 0.4);
        this.pos.z = l.cz + l.uz * side * (l.halfLen + 0.4);
      }
      this.shake = 1;
      this.events.push({ type: 'crevasseCaught' });
      return;
    }
    this.mode = 'dead';
    this.events.push({ type: 'crevasseDeath' });
  }

  /**
   * Direction (+1 up / -1 down) of an anchor you can transfer across right now, else 0.
   * Generous window so the button does what its label said a moment ago.
   */
  transferDir(): number {
    if (!this.clip) return 0;
    const t = this.distToSegment(this.clip).t;
    const dir = !this.descending ? (t > 0.88 ? 1 : 0) : (t < 0.12 ? -1 : 0);
    if (!dir) return 0;
    const next = this.route.ropes[this.clip.index + dir];
    return next && next.sectionId === this.clip.sectionId ? dir : 0;
  }

  private handleClipAction(): void {
    this.actionReleased = false;
    if (this.clip) {
      const anchorDir = this.transferDir();
      if (anchorDir !== 0) {
        const nextIndex = this.clip.index + anchorDir;
        const next = this.route.ropes[nextIndex];
        if (next && next.sectionId === this.clip.sectionId) {
          // Real technique: clip the safety carabiner beyond the anchor first, then move the jumar.
          this.mode = 'transfer';
          this.actionKind = 'transfer';
          this.actionT = this.actionDur = 2.6;
          this.pendingClip = next;
          this.actionAnchor.copy(anchorDir > 0 ? this.clip.b : this.clip.a);
          this.route.ropePoint(next, anchorDir > 0 ? 0.06 : 0.94, this.actionTarget);
          return;
        }
      }
      this.mode = 'clipping';
      this.actionKind = 'unclip';
      this.actionT = this.actionDur = 1.2;
      this.pendingUnclip = true;
      this.attachPoint(this.actionTarget);
      return;
    }
    const r = this.nearestRope();
    if (r) {
      this.mode = 'clipping';
      this.actionKind = 'clip';
      this.actionT = this.actionDur = 1.7;
      this.pendingClip = r;
      const d = this.distToSegment(r);
      this.route.ropePoint(r, Math.min(1, Math.max(0, d.t)), this.actionTarget);
    }
  }

  private applyTether(): void {
    const seg = this.clip!;
    const d = this.distToSegment(seg);
    const dx = seg.b.x - seg.a.x;
    const dz = seg.b.z - seg.a.z;
    const len = Math.hypot(dx, dz) || 1;
    let t = d.t;
    // Cannot slide the carabiner past an anchor.
    // A little slack in the sling and rope: ~3 m past an anchor before it holds you.
    const slack = 3 / len;
    if (t > 1.0 + slack || t < -slack) {
      const dir = t > 1 ? 1 : -1;
      t = clamp(t, -slack, 1 + slack);
      const next = this.route.ropes[seg.index + dir];
      const hasNext = !!next && next.sectionId === seg.sectionId;
      if (hasNext && performance.now() - this.lastBlockMsg > 2000) {
        this.events.push({ type: 'anchorBlock' });
        this.lastBlockMsg = performance.now();
      }
    }
    const px = seg.a.x + dx * t;
    const pz = seg.a.z + dz * t;
    // lateral offset measured from the (slack-limited) point along the rope
    const tc = clamp(d.t, -slack, 1 + slack);
    const lx = this.pos.x - (seg.a.x + dx * tc);
    const lz = this.pos.z - (seg.a.z + dz * tc);
    const lat = Math.hypot(lx, lz);
    const maxLat = 2.8;
    const k = lat > maxLat ? maxLat / lat : 1;
    this.pos.x = px + lx * k;
    this.pos.z = pz + lz * k;
    void len;
  }

  slip(caught: boolean): void {
    if (caught) {
      this.shake = 1;
      this.events.push({ type: 'slip', caught: true });
      return;
    }
    if (this.mode === 'slide') return;
    this.mode = 'slide';
    this.slideStartY = this.pos.y;
    this.slideVel.set(0, 0, 0);
    this.shake = 1;
    this.arresting = false;
    this.events.push({ type: 'slip', caught: false });
  }

  private updateSlide(dt: number, input: Intents): void {
    const n = this.field.normal(this.pos.x, this.pos.z, this.nrm);
    const g = 9.81;
    // Downhill direction projected on surface
    const downhill = new THREE.Vector3(n.x, 0, n.z);
    const steep = downhill.length();
    if (steep > 1e-4) downhill.normalize();
    const sinT = steep; // horizontal component of the normal == sin(theta)
    const cosT = n.y;
    const wasArresting = this.arresting;
    this.arresting = input.rest;
    if (this.arresting && !wasArresting) this.events.push({ type: 'axe' });
    const mu = this.arresting ? (this.slopeDeg < 50 ? 1.05 : 0.45) : 0.12;
    const accel = g * (sinT - mu * cosT * (this.slideVel.length() > 0.05 ? 1 : 1.1));
    this.slideVel.addScaledVector(downhill, Math.max(accel, -999) * dt * (accel > 0 ? 1 : 0));
    if (accel < 0) {
      const spd = this.slideVel.length();
      const ns = Math.max(0, spd + accel * dt);
      if (spd > 0) this.slideVel.multiplyScalar(ns / spd);
    }
    this.slideVel.multiplyScalar(1 - dt * 0.05);
    this.pos.x += this.slideVel.x * dt;
    this.pos.z += this.slideVel.z * dt;
    this.pos.y = this.field.height(this.pos.x, this.pos.z);
    this.speed = this.slideVel.length();
    this.shake = Math.min(1, 0.3 + this.speed * 0.08);
    this.exertion = 1;
    // Rotate view to tumble a little
    this.pitch = clamp(this.pitch - dt * 0.4, -1.2, 1.2);

    if (this.field.crevasseDepth(this.pos.x, this.pos.z) > 1.6) {
      this.mode = 'dead';
      this.events.push({ type: 'crevasseDeath' });
      return;
    }
    const drop = this.slideStartY - this.pos.y;
    if (this.speed > 21 || drop > 70) {
      this.mode = 'dead';
      this.events.push({ type: 'fallDeath' });
      return;
    }
    if (this.speed < 0.25 && (accel < 0 || this.arresting)) {
      this.mode = 'walk';
      this.slideVel.set(0, 0, 0);
      this.events.push({ type: 'arrest' });
    }
  }

  eyePosition(out: THREE.Vector3): THREE.Vector3 {
    const crouch = this.resting ? 0.35 : this.mode === 'slide' ? 1.1 : 0;
    out.copy(this.pos);
    out.y += 1.62 - crouch + this.bob * 0.035;
    return out;
  }

  get up(): THREE.Vector3 {
    return UP;
  }
}
