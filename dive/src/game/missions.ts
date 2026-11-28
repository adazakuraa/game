import * as THREE from 'three';
import { chestModel } from './gearModels';
import { PROP_VIEW } from './render';
import { buildUrchin } from '../life/models';
import type { SpeciesDef } from '../life/species';
import type { ZoneId } from '../world/layout';
import { surfaceAt, surfaceFootAt } from '../world/surface';

/**
 * Occasional in-dive requests (mini-games). At most a couple per dive, never a penalty for ignoring or
 * failing one: they are a burst of tension ("ギュッと") with a clear payoff ("パッと").
 * All tuning lives in MISSION.
 */
export const MISSION = {
  /** 【最初の依頼までの潜水時間】s */
  firstAfter: 40,
  /** 【依頼の最短間隔】s */
  gap: 120,
  /** 【1ダイブの依頼上限】 */
  maxPerDive: 1,
  /** 【発生判定の間隔】s and 【発生確率】per check */
  checkEvery: 10,
  chance: 0.3,
  /** 【ウニ漁】points needed (ムラサキウニ 1, アカウニ 2), bonus yen per high-grade アカウニ */
  urchin: { need: 8, time: 150, reward: 1500, coldReward: 2200, akaBonus: 400 },
  trash: { spawn: 8, need: 6, time: 80, reward: 1200 },
  photo: { time: 90, rewardMult: 4, minGrade: ['S', 'A', 'B'] },
  lost: { time: 100, reward: 2500, radius: 22 },
  treasure: { time: 120, reward: 4500, radius: 30 },
  /** 【ウミガメ救出】Phase 3: rarer (after 60 s, 5 % per check, never two dives in a row); tap within reach to cut the net (cutTime s of knife strokes) */
  rescue: { time: 120, reward: 3500, radius: 28, after: 60, chance: 0.05, restDives: 1, reach: 2.4, cutTime: 1.8, strokes: 3 },
  /** 【生き物調査】different species, grade B or better */
  survey: { time: 100, need: 3, reward: 2200 },
  /** 【標識の読み取り】keep a large animal in the viewfinder within this distance for this long */
  tag: { time: 100, dist: 4, hold: 2, reward: 3000, minSize: 0.8 },
  /** 【依頼の返事を待つ時間】s: ignoring an offer simply lets it lapse */
  offerTime: 15,
  /** 【バールではがす】presses needed, reach (m) */
  pry: { hits: 3, reach: 1.8 },
  /** 【拾える距離】m */
  pickR: 1.15,
  /** 【マップの範囲の円】radius (m) of the area drawn for one hidden target; the target is somewhere inside, never at the centre */
  area: { r: 18, offset: 0.7 },
};

/**
 * Four urchins on the same rocks. Two are eaten (the purple is the everyday one, the red-brown one is the
 * prized grade and only a little shorter-spined and warmer in colour); two must not be touched.
 */
export const URCHINS = [
  { id: 'murasaki', name: 'ムラサキウニ', edible: true, pts: 1, n: 12, geo: { spine: 0.62, n: 90, thin: 0.03 }, color: 0x2a1832, emissive: 0x12061a, scale: 0.16, sting: 0, text: '' },
  { id: 'aka', name: 'アカウニ', edible: true, pts: 2, n: 6, geo: { spine: 0.46, n: 110, thin: 0.03 }, color: 0x4e2422, emissive: 0x1a0806, scale: 0.17, sting: 0, text: '' },
  { id: 'gangaze', name: 'ガンガゼ', edible: false, pts: 0, n: 5, geo: { spine: 1.7, n: 70, thin: 0.016 }, color: 0x141018, emissive: 0x06040a, scale: 0.15, sting: 10, text: 'ガンガゼの長いトゲが刺さった！ 痛い…（エア -10）' },
  { id: 'rappa', name: 'ラッパウニ', edible: false, pts: 0, n: 4, geo: { spine: 0.2, n: 170, thin: 0.045 }, color: 0xc8a0ac, emissive: 0x2a1418, scale: 0.17, sting: 14, text: 'ラッパウニの毒でしびれる！（エア -14）' },
] as const;

export type Kind = 'urchin' | 'trash' | 'photo' | 'lost' | 'treasure' | 'rescue' | 'survey' | 'tag';

export type MissionCtx = {
  dt: number;
  time: number;
  diveTime: number;
  player: THREE.Vector3;
  forward: THREE.Vector3;
  zone: ZoneId;
  /** a species with an individual within ~25 m, for photo requests */
  nearbySpecies: () => SpeciesDef | null;
  toast: (text: string, kind?: '' | 'warn' | 'danger', dur?: number) => void;
  chime: (big: boolean) => void;
  reward: (yen: number, label: string) => void;
  /** touched something that stings: lose air, shake */
  sting: (bar: number, text: string) => void;
  /** a large animal near the diver (for tag reading) */
  nearbyBig: () => SpeciesDef | null;
  /** what the viewfinder is on right now */
  aim: () => { id: string; dist: number } | null;
  /** pose a creature in place (the netted turtle), or release it */
  stage: (id: string, pose: { p: THREE.Vector3; yaw: number; pitch: number } | null) => void;
  /** the rescued animal frees itself and swims with the diver for the rest of the dive */
  companion: (id: string, from: THREE.Vector3) => void;
};

type Active = { kind: Kind; t: number; time: number; need: number; got: number; reward: number; aka?: number; hold?: number; seen?: Set<string>; title: string; target?: SpeciesDef; spot?: THREE.Vector3; lastHint?: number; area?: Area; inside?: boolean; cut?: number };
/** a circle (world m) drawn on the map: the goal is somewhere inside it */
export type Area = { x: number; z: number; r: number };

export class Missions {
  readonly group = new THREE.Group();
  active: Active | null = null;
  /** called when a request or happening is finished (ok) or runs out of time */
  onEnd: ((kind: string, ok: boolean) => void) | null = null;
  /** where a request taken on land takes place */
  private startAt: THREE.Vector3 | null = null;

  /** Begin a request at its place (the diver has just arrived there). */
  begin(kind: Kind, c: MissionCtx, at: THREE.Vector3, sp?: SpeciesDef, reward?: number): void {
    if (this.active) return;
    this.startAt = at.clone();
    this.start(c, kind, sp, true);
    this.startAt = null;
    const act = this.active as Active | null;
    if (act && reward) { act.reward = reward; this.renderHud(); }
  }

  /** called when a staged animal must be let go (mission ended) */
  onRelease: (() => void) | null = null;
  /** test hook: start this kind at the next update */
  force: Kind | null = null;
  /** A request waiting for the player's yes/no. Nothing starts until they accept. */
  offer: { kind: Kind; t: number; sp?: SpeciesDef } | null = null;
  private answer: 'yes' | 'no' | null = null;
  /** test hook: make the next update propose a request */
  forceOffer = false;
  private count = 0;
  /** dives since the last netted turtle (Phase 3: never two in a row) */
  private restDives = 99;
  private rescuedThisDive = false;
  private lastEnd = -1e9;
  private nextCheck = 0;
  private items: THREE.Vector3[] = [];
  private taken: boolean[] = [];
  private urchinMeshes: THREE.InstancedMesh[] = [];
  /** per collected item: urchin type, instance slot, sting cooldown */
  private itemType: number[] = [];
  private itemSlot: number[] = [];
  private stingT: number[] = [];
  private pried: number[] = [];
  private trashMesh: THREE.InstancedMesh;
  private camMesh: THREE.Mesh;
  private chestMesh: THREE.Mesh;
  private netMesh: THREE.LineSegments;
  /** Phase 10: the ropes that bind the turtle (one per knife stroke): each snaps at its stroke and the halves fly apart */
  private ropes = new THREE.Group();
  private ropeData: { a: THREE.Vector3; b: THREE.Vector3; m: THREE.Vector3; snapT: number; up: number; ra: THREE.Mesh; rb: THREE.Mesh }[] = [];
  private _m = new THREE.Matrix4();
  private _q = new THREE.Quaternion();
  private el = {
    root: document.getElementById('mission')!,
    title: document.getElementById('ms-title')!,
    prog: document.getElementById('ms-prog')!,
    bar: document.getElementById('ms-bar-fill')!,
    ask: document.getElementById('ms-ask')!,
  };

  constructor() {
    for (const id of ['ms-yes', 'ms-no']) for (const ev of ['pointerdown', 'touchstart']) document.getElementById(id)!.addEventListener(ev, (e) => e.stopPropagation());
    document.getElementById('ms-yes')!.addEventListener('click', (e) => { e.stopPropagation(); this.answer = 'yes'; });
    document.getElementById('ms-no')!.addEventListener('click', (e) => { e.stopPropagation(); this.answer = 'no'; });
    for (const u of URCHINS) {
      const ug = buildUrchin({ ...u.geo });
      ug.scale(u.scale, u.scale, u.scale);
      const m = new THREE.InstancedMesh(ug, new THREE.MeshStandardMaterial({ color: u.color, roughness: u.id === 'rappa' ? 0.8 : 0.5, emissive: u.emissive }), u.n);
      this.urchinMeshes.push(m);
    }
    // litter: a crumpled plastic bottle shape
    const tg = new THREE.CylinderGeometry(0.07, 0.08, 0.36, 8, 3);
    const tp = tg.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < tp.count; i++) tp.setX(i, tp.getX(i) * (1 + 0.35 * Math.sin(tp.getY(i) * 30 + i)));
    tg.computeVertexNormals();
    this.trashMesh = new THREE.InstancedMesh(tg, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, emissive: 0x303030, transparent: true, opacity: 0.9 }), MISSION.trash.spawn);
    for (let i = 0; i < MISSION.trash.spawn; i++) this.trashMesh.setColorAt(i, new THREE.Color().setHSL([0.55, 0.1, 0.0, 0.33][i % 4], 0.6, 0.6));
    const cg = new THREE.BoxGeometry(0.22, 0.14, 0.11);
    this.camMesh = new THREE.Mesh(cg, new THREE.MeshStandardMaterial({ color: 0xf2c400, roughness: 0.4, emissive: 0x2a2000 }));
    // treasure chest: the shared model (Phase 5: chests.ts uses the same one)
    this.chestMesh = chestModel().mesh;
    // ghost net: a tangle of torn mesh draped over a turtle
    const np: number[] = [];
    const nr = (k: number) => Math.sin(k * 12.9898) * 43758.5453 % 1;
    for (let i = 0; i < 260; i++) {
      const a1 = nr(i) * Math.PI * 2, b1 = Math.abs(nr(i + 7)) * Math.PI * 0.6;
      const a2 = a1 + (nr(i + 3) - 0.5) * 0.9, b2 = b1 + (nr(i + 5) - 0.5) * 0.6;
      const R1 = 0.75 + nr(i + 9) * 0.15, R2 = 0.75 + nr(i + 11) * 0.15;
      np.push(Math.cos(a1) * Math.sin(b1) * R1, Math.cos(b1) * R1 * 0.6, Math.sin(a1) * Math.sin(b1) * R1, Math.cos(a2) * Math.sin(b2) * R2, Math.cos(b2) * R2 * 0.6, Math.sin(a2) * Math.sin(b2) * R2);
    }
    const ng = new THREE.BufferGeometry();
    ng.setAttribute('position', new THREE.Float32BufferAttribute(np, 3));
    this.netMesh = new THREE.LineSegments(ng, new THREE.LineBasicMaterial({ color: 0x5a8a6a, transparent: true }));
    for (const m of [this.netMesh, ...this.urchinMeshes, this.trashMesh, this.camMesh, this.chestMesh]) { m.visible = false; m.frustumCulled = false; this.group.add(m); }
    // ropes: thin tan cylinders (unit length along Y), two halves per strand so the cut can open the middle
    const rg = new THREE.CylinderGeometry(0.026, 0.026, 1, 6, 1, true);
    for (let i = 0; i < MISSION.rescue.strokes; i++) {
      const mk = () => { const m = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ color: 0xc9b27a, transparent: true })); m.frustumCulled = false; this.ropes.add(m); return m; };
      this.ropeData.push({ a: new THREE.Vector3(), b: new THREE.Vector3(), m: new THREE.Vector3(), snapT: -1, up: 0, ra: mk(), rb: mk() });
    }
    this.ropes.visible = false;
    this.group.add(this.ropes);
    this.chestMesh.frustumCulled = true; // one mesh with its own bounds: it can be culled like any other
  }

  /** A new dive begins (Phase 3: a netted turtle never turns up two dives in a row). */
  newDive(): void {
    if (this.rescuedThisDive) this.restDives = 0;
    else this.restDives++;
    this.rescuedThisDive = false;
  }

  /** Within reach of the netted turtle, before the cutting has begun: the shutter button cuts. */
  cutReady(player: THREE.Vector3): boolean {
    const a = this.active;
    return a?.kind === 'rescue' && !!a.spot && a.cut === undefined && a.got < a.need && a.spot.distanceTo(player) < MISSION.rescue.reach;
  }

  /** Tap: the knife comes out and the strokes begin (the motion runs on its own). */
  startCut(): void {
    const a = this.active;
    if (a?.kind !== 'rescue' || a.cut !== undefined) return;
    a.cut = 0;
    a.hold = 0;
  }

  /** 0..1 through the cutting motion, or null when not cutting. */
  cutProgress(): number | null {
    const a = this.active;
    return a?.kind === 'rescue' && a.cut !== undefined ? Math.min(1, a.cut / MISSION.rescue.cutTime) : null;
  }

  reset(): void {
    this.end(false, true);
    this.offer = null;
    this.answer = null;
    this.count = 0;
    this.lastEnd = -1e9;
    this.nextCheck = 0;
  }

  /** Areas to show on the minimap while a request is running: a circle, with the goal somewhere inside (never a pin). */
  marks(): { x: number; z: number; rare: boolean; r: number }[] {
    const a = this.active;
    return a?.area ? [{ ...a.area, rare: true }] : [];
  }

  /** A circle around one hidden spot, its centre pushed off the spot so the circle says "around here", not "here". */
  private areaAround(p: THREE.Vector3): Area {
    const A = MISSION.area;
    const ang = Math.random() * Math.PI * 2, d = A.r * A.offset * (0.45 + 0.55 * Math.random());
    return { x: p.x + Math.cos(ang) * d, z: p.z + Math.sin(ang) * d, r: A.r };
  }

  /** The smallest-ish circle around scattered items (urchin rocks, trash patch), with a margin. */
  private areaOver(ps: THREE.Vector3[]): Area | undefined {
    if (!ps.length) return undefined;
    const x = ps.reduce((s, p) => s + p.x, 0) / ps.length, z = ps.reduce((s, p) => s + p.z, 0) / ps.length;
    const r = Math.max(10, ...ps.map((p) => Math.hypot(p.x - x, p.z - z))) + 4;
    return { x, z, r };
  }

  /** Phase 10: tie the strands from the seabed around the spot to the turtle's shell. */
  private placeRopes(spot: THREE.Vector3): void {
    const n = this.ropeData.length;
    this.ropeData.forEach((r, i) => {
      const ang = (i / n) * Math.PI * 2 + 0.6;
      r.a.set(spot.x + Math.cos(ang) * 1.5, spot.y - 0.45, spot.z + Math.sin(ang) * 1.5);
      r.b.set(spot.x + Math.cos(ang) * 0.25, spot.y + 0.3, spot.z + Math.sin(ang) * 0.25);
      r.m.lerpVectors(r.a, r.b, 0.55);
      r.snapT = -1;
      r.up = 0;
    });
    this.ropes.visible = true;
    this.drawRopes(0);
  }

  private static seg(mesh: THREE.Mesh, p: THREE.Vector3, q: THREE.Vector3, op: number): void {
    const d = new THREE.Vector3().subVectors(q, p), L = d.length();
    mesh.visible = op > 0.02 && L > 0.01;
    if (!mesh.visible) return;
    mesh.position.copy(p).addScaledVector(d, 0.5);
    mesh.scale.set(1, L, 1);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.divideScalar(L));
    (mesh.material as THREE.MeshBasicMaterial).opacity = op;
  }

  /** Snapped halves: the turtle side springs back and up, the seabed side drops; both fade within ~0.8 s. */
  private drawRopes(dt: number): void {
    for (const r of this.ropeData) {
      if (r.snapT >= 0) r.snapT += dt;
      const t = r.snapT;
      if (t < 0) {
        Missions.seg(r.ra, r.a, r.m, 1);
        Missions.seg(r.rb, r.m, r.b, 1);
      } else {
        const k = Math.min(1, t / 0.8), ease = 1 - (1 - k) * (1 - k);
        const op = Math.max(0, 1 - k * k);
        const ma = new THREE.Vector3(r.m.x, r.m.y - ease * 0.9, r.m.z);          // seabed half sinks
        const mb = new THREE.Vector3().copy(r.m).lerp(r.b, 0.55 * ease);         // shell half recoils toward the turtle
        mb.y += ease * 0.35;
        Missions.seg(r.ra, r.a, ma, op);
        Missions.seg(r.rb, mb, r.b, op);
      }
    }
  }

  /** Ropes snapped so far (probe / test hook) and the net's current opacity. */
  cutFx(): { k: number | null; snapped: number; ropesVisible: boolean; net: number } {
    return { k: this.cutProgress(), snapped: this.ropeData.filter((r) => r.snapT >= 0).length, ropesVisible: this.ropes.visible, net: (this.netMesh.material as THREE.LineBasicMaterial).opacity };
  }

  update(c: MissionCtx): void {
    if (this.ropes.visible) { this.drawRopes(c.dt); if (!this.active && this.ropeData.every((r) => r.snapT > 1)) this.ropes.visible = false; }
    if (!this.active && this.force) { const k = this.force; this.force = null; this.offer = null; this.start(c, k); return; }
    if (!this.active && this.offer) {
      const o = this.offer;
      o.t -= c.dt;
      const ans = this.answer;
      this.answer = null;
      if (ans === 'yes') { this.offer = null; this.el.ask.classList.add('hidden'); this.start(c, o.kind, o.sp, true); return; }
      if (ans === 'no' || o.t <= 0) {
        this.offer = null;
        this.lastEnd = c.time;
        this.end(false, true);
        if (ans === 'no') c.toast('依頼を断った', '', 1.5);
        return;
      }
      this.el.bar.style.width = `${Math.max(0, (o.t / MISSION.offerTime) * 100)}%`;
      return;
    }
    if (!this.active && this.forceOffer) { this.forceOffer = false; this.propose(c); return; }
    if (!this.active) {
      this.answer = null;
      this.nextCheck -= c.dt;
      if (this.count >= MISSION.maxPerDive || c.diveTime < Math.max(MISSION.firstAfter, MISSION.rescue.after) || c.time - this.lastEnd < MISSION.gap || this.nextCheck > 0) return;
      this.nextCheck = MISSION.checkEvery;
      // only happenings start by themselves at sea (requests are taken on land); Phase 3: rarer, never two dives in a row
      if (this.restDives < MISSION.rescue.restDives) return;
      if (Math.random() < MISSION.rescue.chance && (c.zone === 'lagoon' || c.zone === 'reef' || c.zone === 'rocky')) this.start(c, 'rescue');
      return;
    }
    const a = this.active;
    // Phase 3: the clock runs (and shows) only inside the circle; outside it the diver is just on the way
    a.inside = !a.area || Math.hypot(c.player.x - a.area.x, c.player.z - a.area.z) <= a.area.r;
    if (a.inside && a.cut === undefined) a.t -= c.dt;
    // collect by swimming close
    if (a.kind === 'urchin' || a.kind === 'trash') {
      for (let i = 0; i < this.items.length; i++) {
        if (this.taken[i]) continue;
        const p = this.items[i];
        if (a.kind === 'trash') { p.y += Math.sin(c.time * 0.8 + i) * 0.002; }
        if (a.kind === 'urchin') {
          this.stingT[i] = Math.max(0, (this.stingT[i] ?? 0) - c.dt);
          const u = URCHINS[this.itemType[i]];
          // swimming into a spiny one hurts; edible ones are taken with the bar (see pry)
          if (!u.edible && p.distanceTo(c.player) < 0.7 + u.geo.spine * u.scale && this.stingT[i] <= 0) { this.stingT[i] = 3; c.sting(u.sting, u.text); }
          continue;
        }
        if (p.distanceTo(c.player) < MISSION.pickR) {
          this.taken[i] = true;
          a.got++;
          this.trashMesh.setMatrixAt(i, this._m.makeScale(0, 0, 0));
          this.trashMesh.instanceMatrix.needsUpdate = true;
          c.chime(false);
        }
      }
      if (a.kind === 'trash') this.writeTrash(c.time);
    }
    if ((a.kind === 'lost' || a.kind === 'treasure') && a.spot) {
      const d = a.spot.distanceTo(c.player);
      (a.kind === 'lost' ? this.camMesh : this.chestMesh).visible = d < PROP_VIEW;
      if ((a.lastHint ?? 0) <= c.time - 6) {
        a.lastHint = c.time;
        const what = a.kind === 'lost' ? 'カメラはすぐ近く！ 黄色い箱を探そう' : '宝箱はすぐ近く！ 石の陰もよく見て';
        c.toast(d < 6 ? what : d < 14 ? '近づいている…' : 'まだ遠い。マップの金色の円の中のどこか', 'warn', 2);
      }
      if (d < MISSION.pickR + 0.3) a.got = 1;
    }
    if (a.kind === 'rescue' && a.spot) {
      const R = MISSION.rescue;
      const d = a.spot.distanceTo(c.player);
      if (a.cut !== undefined) {
        // the knife strokes: each one tears the net open a little more, the last one sets the turtle free
        a.cut += c.dt;
        const k = Math.min(1, a.cut / R.cutTime);
        const stroke = Math.min(R.strokes, Math.floor(k * R.strokes + 0.35));
        if (stroke > (a.hold ?? 0)) { a.hold = stroke; c.chime(stroke >= R.strokes); }
        this.ropeData.forEach((r, i) => { if (r.snapT < 0 && k >= (i + 0.5) / R.strokes - 0.02) { r.snapT = 0; c.chime(false); } });
        const torn = (a.hold ?? 0) / R.strokes;
        const sc = 1 + torn * 0.9 + Math.max(0, k - 0.8) * 2;
        this.netMesh.scale.set(sc, 1 + torn * 0.4, sc);
        this.netMesh.position.y = a.spot.y + torn * 0.5;
        this.netMesh.rotation.y += c.dt * torn * 0.8;
        (this.netMesh.material as THREE.LineBasicMaterial).opacity = Math.max(0, 1 - torn * 0.55 - Math.max(0, k - 0.8) * 2.2);
        if (a.cut >= R.cutTime) {
          a.got = 1;
          this.netMesh.visible = false;
          c.companion('turtle', a.spot);
        }
      } else if (d < R.reach) {
        if ((a.lastHint ?? 0) <= c.time - 5) { a.lastHint = c.time; c.toast('ボタンをタップして、ナイフで網を切ろう', 'warn', 2.5); }
      } else if ((a.lastHint ?? 0) <= c.time - 7) {
        a.lastHint = c.time;
        c.toast(d < 8 ? '網に絡まったウミガメがいる！ すぐそばまで近づこう' : d < 18 ? '近づいている…' : 'マップの金色の円の中のどこか', 'warn', 2);
      }
    }
    if (a.kind === 'tag' && a.target) {
      const aim = c.aim();
      if (aim && aim.id === a.target.id && aim.dist <= MISSION.tag.dist) {
        a.hold = (a.hold ?? 0) + c.dt;
        if (a.hold >= MISSION.tag.hold) a.got = 1;
      } else a.hold = Math.max(0, (a.hold ?? 0) - c.dt * 0.5);
    }
    this.renderHud();
    if (a.got >= a.need) {
      c.reward(a.reward, a.title);
      c.toast(a.kind === 'rescue' ? `ウミガメがついてくる！（このダイブの間いっしょに泳ぐ） 漁協からお礼 ¥${a.reward.toLocaleString('ja-JP')}` : `依頼達成！ ${a.title}　報酬 ¥${a.reward.toLocaleString('ja-JP')}`, '', 3.5);
      c.chime(true);
      const k = a.kind;
      this.end(true);
      this.lastEnd = c.time;
      this.onEnd?.(k, true);
    } else if (a.t <= 0) {
      c.toast(a.kind === 'rescue' ? 'ウミガメを見失ってしまった…' : `時間切れ… 「${a.title}」はまた挑戦できる`, 'warn', 3);
      const k = a.kind;
      this.end(false);
      this.lastEnd = c.time;
      this.onEnd?.(k, false);
    }
  }

  /** The urchin in front of the diver within reach of the bar, if any. */
  pryTarget(player: THREE.Vector3, fwd: THREE.Vector3): number | null {
    const a = this.active;
    if (a?.kind !== 'urchin') return null;
    let best: number | null = null, bd = Infinity;
    const v = new THREE.Vector3();
    for (let i = 0; i < this.items.length; i++) {
      if (this.taken[i]) continue;
      v.copy(this.items[i]).sub(player);
      const d = v.length();
      if (d > MISSION.pry.reach || v.normalize().dot(fwd) < 0.55) continue;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  /** Presses left before the urchin comes off the rock. */
  pryLeft(i: number): number {
    return MISSION.pry.hits - (this.pried[i] ?? 0);
  }

  /** One push of the bar. Edible urchins come off after a few; the spiny ones fight back. */
  pry(i: number, c: Pick<MissionCtx, 'chime' | 'toast' | 'sting'>): void {
    const a = this.active;
    if (a?.kind !== 'urchin' || this.taken[i]) return;
    const u = URCHINS[this.itemType[i]];
    if (!u.edible) { c.sting(u.sting, `${u.name}はバールではがしても食べられない… ${u.text}`); return; }
    this.pried[i] = (this.pried[i] ?? 0) + 1;
    if (this.pried[i] < MISSION.pry.hits) { c.chime(false); return; }
    this.taken[i] = true;
    a.got += u.pts;
    if (u.id === 'aka') { a.aka = (a.aka ?? 0) + 1; a.reward += MISSION.urchin.akaBonus; }
    const mesh = this.urchinMeshes[this.itemType[i]];
    mesh.setMatrixAt(this.itemSlot[i], this._m.makeScale(0, 0, 0));
    mesh.instanceMatrix.needsUpdate = true;
    c.chime(u.id === 'aka');
    c.toast(u.id === 'aka' ? '高級なアカウニがとれた！（2点）' : 'ムラサキウニがとれた！（1点）', '', 1.4);
  }

  /** Called on every in-range shot. */
  onPhoto(id: string, grade: string): void {
    const a = this.active;
    if (a?.kind === 'photo' && a.target?.id === id && MISSION.photo.minGrade.includes(grade)) a.got = 1;
    if (a?.kind === 'survey' && MISSION.photo.minGrade.includes(grade)) {
      (a.seen ??= new Set()).add(id);
      a.got = a.seen.size;
    }
  }

  /** Ask first: show what the request is and let the player accept or decline. */
  private propose(c: MissionCtx): void {
    const opts: Kind[] = ['photo'];
    if (c.zone === 'rocky' || c.zone === 'cold' || c.zone === 'kelp') opts.push('urchin', 'urchin');
    if (c.zone === 'lagoon' || c.zone === 'reef' || c.zone === 'estuary') opts.push('trash', 'trash');
    if (c.zone === 'river') opts.push('trash');
    if (c.zone === 'reef' || c.zone === 'dropoff') opts.push('lost');
    if (c.zone === 'ruins') opts.push('treasure', 'treasure', 'treasure');
    if (c.zone === 'lagoon' || c.zone === 'reef' || c.zone === 'rocky') opts.push('rescue');
    opts.push('survey');
    if (c.zone === 'dropoff' || c.zone === 'offshore' || c.zone === 'reef' || c.zone === 'kelp' || c.zone === 'cold') opts.push('tag');
    let kind = opts[Math.floor(Math.random() * opts.length)];
    if (kind === 'tag' && !c.nearbyBig()) kind = 'survey';
    let sp: SpeciesDef | undefined;
    let text: string, time: number, reward: number;
    if (kind === 'photo') {
      sp = c.nearbySpecies() ?? undefined;
      if (!sp) return;
      time = MISSION.photo.time; reward = [0, 300, 900, 2400, 8000][sp.rarity] * MISSION.photo.rewardMult;
      text = `雑誌から：${sp.name}の写真がほしい`;
    } else if (kind === 'urchin') {
      time = MISSION.urchin.time; reward = c.zone === 'cold' ? MISSION.urchin.coldReward : MISSION.urchin.reward;
      text = `漁協から：食べられるウニを${MISSION.urchin.need}点ぶん獲って`;
    } else if (kind === 'trash') {
      time = MISSION.trash.time; reward = MISSION.trash.reward; text = `海のごみを${MISSION.trash.need}個拾って`;
    } else if (kind === 'treasure') {
      time = MISSION.treasure.time; reward = MISSION.treasure.reward; text = '遺跡に沈んだ宝箱を探して';
    } else if (kind === 'rescue') {
      time = MISSION.rescue.time; reward = MISSION.rescue.reward; text = '漁師から：網に絡まったウミガメを助けて';
    } else if (kind === 'survey') {
      time = MISSION.survey.time; reward = MISSION.survey.reward; text = `研究所から：ちがう生き物を${MISSION.survey.need}種類、B評価以上で撮って`;
    } else if (kind === 'tag' && (sp = c.nearbyBig() ?? undefined)) {
      time = MISSION.tag.time; reward = MISSION.tag.reward; text = `研究所から：${sp.name}の標識番号を読み取って`;
    } else {
      time = MISSION.lost.time; reward = MISSION.lost.reward; text = '落とした水中カメラを探して';
    }
    this.offer = { kind, t: MISSION.offerTime, sp };
    this.answer = null;
    this.count++;
    this.el.title.textContent = `依頼が来た！ ${text}`;
    this.el.prog.textContent = `${time}秒・報酬 ¥${reward.toLocaleString('ja-JP')}`;
    this.el.bar.style.width = '100%';
    (this.el.bar.parentElement as HTMLElement).style.visibility = '';
    this.el.ask.classList.remove('hidden');
    this.el.root.classList.remove('hidden');
    c.chime(false);
  }

  private start(c: MissionCtx, forced?: Kind, sp0?: SpeciesDef, fromOffer = false): void {
    const kind = forced ?? 'photo';
    const ahead = this.startAt ? this.startAt.clone() : c.player.clone().addScaledVector(c.forward.clone().setY(0).normalize(), 8);
    const near = this.startAt ?? c.player;
    this.items = [];
    this.taken = [];
    if (kind === 'photo') {
      const sp = sp0 ?? c.nearbySpecies();
      if (!sp) { this.end(false, true); return; }
      const base = [0, 300, 900, 2400, 8000][sp.rarity];
      this.active = { kind, t: MISSION.photo.time, time: MISSION.photo.time, need: 1, got: 0, reward: base * MISSION.photo.rewardMult, title: `雑誌の依頼：${sp.name}をB以上で撮影`, target: sp };
      c.toast(`【依頼】海洋雑誌から「${sp.name}の写真がほしい！」 ${MISSION.photo.time}秒以内にB評価以上で撮ろう`, 'warn', 4.5);
    } else if (kind === 'urchin') {
      const U = MISSION.urchin;
      this.itemType = [];
      this.itemSlot = [];
      this.stingT = [];
      this.pried = [];
      URCHINS.forEach((u, ti) => {
        for (let k = 0; k < u.n; k++) {
          // scattered over the rocks, a few metres apart
          let x = ahead.x, z = ahead.z, a = 0;
          for (let tr = 0; tr < 40; tr++) {
            a = Math.random() * Math.PI * 2;
            const d = 3 + Math.sqrt(Math.random()) * 32;
            x = ahead.x + Math.cos(a) * d; z = ahead.z + Math.sin(a) * d;
            if (this.items.every((q) => Math.hypot(q.x - x, q.z - z) > 3.2)) break;
          }
          const pos = new THREE.Vector3(x, surfaceFootAt(x, z) + 0.05, z);
          this.pried.push(0);
          this.items.push(pos);
          this.taken.push(false);
          this.itemType.push(ti);
          this.itemSlot.push(k);
          this.stingT.push(0);
          this.urchinMeshes[ti].setMatrixAt(k, this._m.compose(pos, this._q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), a), new THREE.Vector3(1, 1, 1)));
        }
        this.urchinMeshes[ti].instanceMatrix.needsUpdate = true;
        this.urchinMeshes[ti].visible = true;
      });
      const reward = c.zone === 'cold' ? U.coldReward : U.reward;
      this.active = { kind, t: U.time, time: U.time, need: U.need, got: 0, reward, aka: 0, title: 'ウニ漁（磯焼け対策）', area: this.areaOver(this.items) };
      c.toast(`ウニ漁の場所に着いた。ウニに近づいてバールで3回突いてはがそう。ムラサキウニ（黒紫・トゲ長め）は1点、アカウニ（赤茶色・トゲ少し短め・高級）は2点。トゲがとても長いガンガゼと、花のような桃色のラッパウニは触ると痛い！ ${U.time}秒で${U.need}点`, 'warn', 8);
    } else if (kind === 'trash') {
      const T = MISSION.trash;
      for (let i = 0; i < T.spawn; i++) {
        let x = ahead.x, z = ahead.z, g = surfaceAt(x, z);
        // the estuary's flats and the river's banks are shallow or dry: keep the rubbish in the water (Phase 9 S6)
        for (let tr = 0; tr < 30; tr++) {
          const a = Math.random() * Math.PI * 2, d = 2 + Math.random() * 12;
          x = ahead.x + Math.cos(a) * d; z = ahead.z + Math.sin(a) * d; g = surfaceAt(x, z);
          if (c.zone !== 'estuary' && c.zone !== 'river' || g < -1.2) break;
        }
        this.items.push(new THREE.Vector3(x, Math.min(-0.8, g + 0.3 + Math.random() * Math.max(0, -g - 1.5)), z));
        this.taken.push(false);
      }
      this.writeTrash(c.time);
      this.trashMesh.visible = true;
      this.active = { kind, t: T.time, time: T.time, need: T.need, got: 0, reward: T.reward, title: '海のごみ拾い', area: this.areaOver(this.items) };
      c.toast(`ごみがたまっている場所に着いた。${T.time}秒で${T.need}個拾おう（近づくと拾える）`, 'warn', 4.5);
    } else if (kind === 'rescue') {
      const T = MISSION.rescue;
      let spot: THREE.Vector3 | null = null;
      for (let k = 0; k < 30 && !spot; k++) {
        const a = Math.random() * Math.PI * 2, d = 12 + Math.random() * T.radius;
        const x = c.player.x + Math.cos(a) * d, z = c.player.z + Math.sin(a) * d;
        const g = surfaceAt(x, z);
        if (g < -30 || g > -2) continue;
        spot = new THREE.Vector3(x, g + 0.55, z);
      }
      if (!spot) { this.end(false, true); return; }
      this.netMesh.position.copy(spot);
      this.netMesh.scale.set(1, 1, 1);
      this.netMesh.rotation.set(0, 0, 0);
      (this.netMesh.material as THREE.LineBasicMaterial).opacity = 1;
      this.netMesh.visible = true;
      this.placeRopes(spot);
      this.rescuedThisDive = true;
      c.stage('turtle', { p: spot.clone(), yaw: Math.random() * 6, pitch: 0.15 });
      this.active = { kind, t: T.time, time: T.time, need: 1, got: 0, reward: T.reward, title: '網に絡まったウミガメ', spot, hold: 0, area: this.areaAround(spot) };
      c.toast('近くでウミガメが捨てられた網に絡まって動けなくなっている！ マップの金色の円の中のどこか。そばでボタンをタップして、ナイフで網を切ってあげよう', 'warn', 5);
    } else if (kind === 'survey') {
      const T = MISSION.survey;
      this.active = { kind, t: T.time, time: T.time, need: T.need, got: 0, reward: T.reward, title: '生き物調査', seen: new Set() };
      c.toast(`【依頼】研究所の生き物調査。${T.time}秒以内に、ちがう種類の生き物を${T.need}種類、B評価以上で撮ろう（撮ったことのある種でもOK）`, 'warn', 4.5);
    } else if (kind === 'tag') {
      const T = MISSION.tag;
      const sp = sp0 ?? c.nearbyBig();
      if (!sp) { this.end(false, true); return; }
      // Phase 3: a circle around the place (taken on land), so the clock shows and runs only there
      this.active = { kind, t: T.time, time: T.time, need: 1, got: 0, reward: T.reward, title: `${sp.name}の標識読み取り`, target: sp, hold: 0, area: this.startAt ? { x: near.x, z: near.z, r: 22 } : undefined };
      c.toast(`このあたりに標識のついた${sp.name}がいる。${T.dist}m以内まで近づいて、照準に${T.hold}秒収め続けて番号を読み取ろう`, 'warn', 4.5);
    } else if (kind === 'treasure') {
      const T = MISSION.treasure;
      const a = Math.random() * Math.PI * 2, d = 4 + Math.random() * 12;
      const x = near.x + Math.cos(a) * d, z = near.z + Math.sin(a) * d;
      const spot = new THREE.Vector3(x, surfaceAt(x, z) + 0.2, z);
      this.chestMesh.position.copy(spot);
      this.chestMesh.rotation.set(0.15, a, 0.1);
      this.chestMesh.visible = true;
      this.active = { kind, t: T.time, time: T.time, need: 1, got: 0, reward: T.reward, title: '遺跡の宝探し', spot, area: this.areaAround(spot) };
      c.toast(`このあたりに宝箱が沈んでいるはず。${T.time}秒以内に探し出そう（石の陰もよく見て）`, 'warn', 4.5);
    } else {
      const L = MISSION.lost;
      const a = Math.random() * Math.PI * 2, d = 4 + Math.random() * 12;
      const x = near.x + Math.cos(a) * d, z = near.z + Math.sin(a) * d;
      const spot = new THREE.Vector3(x, surfaceAt(x, z) + 0.06, z);
      this.camMesh.position.copy(spot);
      this.camMesh.rotation.set(0.3, a, 0.2);
      this.camMesh.visible = true;
      this.active = { kind, t: L.time, time: L.time, need: 1, got: 0, reward: L.reward, title: '落とし物のカメラ探し', spot, area: this.areaAround(spot) };
      c.toast(`このあたりに黄色い水中カメラが落ちているはず。${L.time}秒以内に見つけよう`, 'warn', 4.5);
    }
    if (!fromOffer) this.count++;
    this.el.ask.classList.add('hidden');
    this.el.root.classList.remove('hidden');
    this.renderHud();
  }

  private writeTrash(time: number): void {
    for (let i = 0; i < this.items.length; i++) {
      if (this.taken[i]) continue;
      this._q.setFromEuler(new THREE.Euler(Math.sin(time * 0.5 + i) * 0.6, i * 1.3 + time * 0.2, 1.2 + Math.cos(time * 0.4 + i) * 0.4));
      this.trashMesh.setMatrixAt(i, this._m.compose(this.items[i], this._q, new THREE.Vector3(1, 1, 1)));
    }
    this.trashMesh.instanceMatrix.needsUpdate = true;
  }

  private renderHud(): void {
    const a = this.active!;
    this.el.title.textContent = a.title;
    // time first: on a narrow screen the tail may be cut, the countdown never is
    // Phase 3: the countdown (text and bar) only while inside the circle
    const inside = a.inside ?? true;
    const left = inside ? `残り${Math.ceil(a.t)}秒` : '金色の円の中へ';
    (this.el.bar.parentElement as HTMLElement).style.visibility = inside ? '' : 'hidden';
    const pct = (v: number, of: number) => `${Math.min(100, Math.round((v / of) * 100))}%`;
    const detail = a.kind === 'rescue' ? (a.cut !== undefined ? `網を切っている… ${pct(a.cut, MISSION.rescue.cutTime)}` : '')
      : a.kind === 'survey' ? `${a.got} / ${a.need}種類`
      : a.kind === 'tag' ? `読み取り ${pct(a.hold ?? 0, MISSION.tag.hold)}`
      : a.kind === 'urchin' ? `${Math.min(a.got, a.need)} / ${a.need}点${a.aka ? `（アカウニ×${a.aka}）` : ''}`
      : a.kind === 'trash' ? `${a.got} / ${a.need}個` : '';
    this.el.prog.textContent = detail ? `${left}　${detail}` : left;
    this.el.bar.style.width = `${Math.max(0, (a.t / a.time) * 100)}%`;
  }

  private end(_ok: boolean, silent = false): void {
    this.active = null;
    this.items = [];
    this.taken = [];
    for (const m of this.urchinMeshes) m.visible = false;
    if (this.netMesh.visible) { this.netMesh.visible = false; this.ropes.visible = false; this.onRelease?.(); }
    this.trashMesh.visible = false;
    this.camMesh.visible = false;
    this.chestMesh.visible = false;
    if (!silent || this.el.root) this.el.root.classList.add('hidden');
    this.el.ask.classList.add('hidden');
  }
}
