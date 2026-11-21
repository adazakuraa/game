import * as THREE from 'three';
import { buildUrchin } from '../life/models';
import type { SpeciesDef } from '../life/species';
import type { ZoneId } from '../world/layout';
import { surfaceAt } from '../world/surface';

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
  maxPerDive: 2,
  /** 【発生判定の間隔】s and 【発生確率】per check */
  checkEvery: 10,
  chance: 0.3,
  urchin: { spawn: 14, need: 10, time: 75, reward: 1500, coldReward: 2200 },
  trash: { spawn: 8, need: 6, time: 80, reward: 1200 },
  photo: { time: 90, rewardMult: 4, minGrade: ['S', 'A', 'B'] },
  lost: { time: 100, reward: 2500, radius: 22 },
  treasure: { time: 120, reward: 4500, radius: 30 },
  /** 【拾える距離】m */
  pickR: 1.15,
};

type Kind = 'urchin' | 'trash' | 'photo' | 'lost' | 'treasure';

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
};

type Active = { kind: Kind; t: number; time: number; need: number; got: number; reward: number; title: string; target?: SpeciesDef; spot?: THREE.Vector3; lastHint?: number };

export class Missions {
  readonly group = new THREE.Group();
  active: Active | null = null;
  /** test hook: start this kind at the next update */
  force: Kind | null = null;
  private count = 0;
  private lastEnd = -1e9;
  private nextCheck = 0;
  private items: THREE.Vector3[] = [];
  private taken: boolean[] = [];
  private urchinMesh: THREE.InstancedMesh;
  private trashMesh: THREE.InstancedMesh;
  private camMesh: THREE.Mesh;
  private chestMesh: THREE.Group;
  private _m = new THREE.Matrix4();
  private _q = new THREE.Quaternion();
  private el = {
    root: document.getElementById('mission')!,
    title: document.getElementById('ms-title')!,
    prog: document.getElementById('ms-prog')!,
    bar: document.getElementById('ms-bar-fill')!,
  };

  constructor() {
    const ug = buildUrchin({ spine: 0.6, n: 90, thin: 0.03 });
    ug.scale(0.16, 0.16, 0.16);
    this.urchinMesh = new THREE.InstancedMesh(ug, new THREE.MeshStandardMaterial({ color: 0x4a2050, roughness: 0.5, emissive: 0x2a0c30 }), MISSION.urchin.spawn);
    // litter: a crumpled plastic bottle shape
    const tg = new THREE.CylinderGeometry(0.07, 0.08, 0.36, 8, 3);
    const tp = tg.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < tp.count; i++) tp.setX(i, tp.getX(i) * (1 + 0.35 * Math.sin(tp.getY(i) * 30 + i)));
    tg.computeVertexNormals();
    this.trashMesh = new THREE.InstancedMesh(tg, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, emissive: 0x303030, transparent: true, opacity: 0.9 }), MISSION.trash.spawn);
    for (let i = 0; i < MISSION.trash.spawn; i++) this.trashMesh.setColorAt(i, new THREE.Color().setHSL([0.55, 0.1, 0.0, 0.33][i % 4], 0.6, 0.6));
    const cg = new THREE.BoxGeometry(0.22, 0.14, 0.11);
    this.camMesh = new THREE.Mesh(cg, new THREE.MeshStandardMaterial({ color: 0xf2c400, roughness: 0.4, emissive: 0x2a2000 }));
    // treasure chest: dark wooden box with gold bands
    this.chestMesh = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: 0x4a2e18, roughness: 0.8, emissive: 0x120804 });
    const gold = new THREE.MeshStandardMaterial({ color: 0xe8b830, roughness: 0.3, metalness: 0.8, emissive: 0x3a2800 });
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.4, 0.45), wood);
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.225, 0.225, 0.7, 10, 1, false, 0, Math.PI), wood);
    lid.rotation.z = Math.PI / 2; lid.position.y = 0.2;
    this.chestMesh.add(box, lid);
    for (const x of [-0.25, 0.25]) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.66, 0.47), gold); b.position.set(x, 0.12, 0); this.chestMesh.add(b); }
    for (const m of [this.urchinMesh, this.trashMesh, this.camMesh, this.chestMesh]) { m.visible = false; m.frustumCulled = false; this.group.add(m); }
  }

  reset(): void {
    this.end(false, true);
    this.count = 0;
    this.lastEnd = -1e9;
    this.nextCheck = 0;
  }

  /** Points to show on the minimap while a request is running. */
  marks(): { x: number; z: number; rare: boolean }[] {
    const a = this.active;
    if (!a) return [];
    if ((a.kind === 'lost' || a.kind === 'treasure') && a.spot) return [{ x: a.spot.x + 6, z: a.spot.z - 4, rare: true }]; // rough area only
    if (a.kind === 'urchin' || a.kind === 'trash') return this.items.filter((_, i) => !this.taken[i]).map((p) => ({ x: p.x, z: p.z, rare: false }));
    return [];
  }

  update(c: MissionCtx): void {
    if (!this.active && this.force) { const k = this.force; this.force = null; this.start(c, k); return; }
    if (!this.active) {
      this.nextCheck -= c.dt;
      if (this.count >= MISSION.maxPerDive || c.diveTime < MISSION.firstAfter || c.time - this.lastEnd < MISSION.gap || this.nextCheck > 0) return;
      this.nextCheck = MISSION.checkEvery;
      if (Math.random() < MISSION.chance) this.start(c);
      return;
    }
    const a = this.active;
    a.t -= c.dt;
    // collect by swimming close
    if (a.kind === 'urchin' || a.kind === 'trash') {
      for (let i = 0; i < this.items.length; i++) {
        if (this.taken[i]) continue;
        const p = this.items[i];
        if (a.kind === 'trash') { p.y += Math.sin(c.time * 0.8 + i) * 0.002; }
        if (p.distanceTo(c.player) < MISSION.pickR) {
          this.taken[i] = true;
          a.got++;
          const mesh = a.kind === 'urchin' ? this.urchinMesh : this.trashMesh;
          mesh.setMatrixAt(i, this._m.makeScale(0, 0, 0));
          mesh.instanceMatrix.needsUpdate = true;
          c.chime(false);
        }
      }
      if (a.kind === 'trash') this.writeTrash(c.time);
    }
    if ((a.kind === 'lost' || a.kind === 'treasure') && a.spot) {
      const d = a.spot.distanceTo(c.player);
      if ((a.lastHint ?? 0) <= c.time - 6) {
        a.lastHint = c.time;
        const what = a.kind === 'lost' ? 'カメラはすぐ近く！ 黄色い箱を探そう' : '宝箱はすぐ近く！ 石の陰もよく見て';
        c.toast(d < 6 ? what : d < 14 ? '近づいている…' : 'まだ遠い。マップの金色の印のあたり', 'warn', 2);
      }
      if (d < MISSION.pickR + 0.3) a.got = 1;
    }
    this.renderHud();
    if (a.got >= a.need) {
      c.reward(a.reward, a.title);
      c.toast(`依頼達成！ ${a.title}　報酬 ¥${a.reward.toLocaleString('ja-JP')}`, '', 3.5);
      c.chime(true);
      this.end(true);
      this.lastEnd = c.time;
    } else if (a.t <= 0) {
      c.toast(`時間切れ… 「${a.title}」はまた今度`, 'warn', 3);
      this.end(false);
      this.lastEnd = c.time;
    }
  }

  /** Called on every in-range shot. */
  onPhoto(id: string, grade: string): void {
    const a = this.active;
    if (a?.kind === 'photo' && a.target?.id === id && MISSION.photo.minGrade.includes(grade)) a.got = 1;
  }

  private start(c: MissionCtx, forced?: Kind): void {
    const opts: Kind[] = ['photo'];
    if (c.zone === 'rocky' || c.zone === 'cold' || c.zone === 'kelp') opts.push('urchin', 'urchin');
    if (c.zone === 'lagoon' || c.zone === 'reef') opts.push('trash', 'trash');
    if (c.zone === 'reef' || c.zone === 'dropoff') opts.push('lost');
    if (c.zone === 'ruins') opts.push('treasure', 'treasure', 'treasure');
    const kind = forced ?? opts[Math.floor(Math.random() * opts.length)];
    const ahead = c.player.clone().addScaledVector(c.forward.clone().setY(0).normalize(), 8);
    this.items = [];
    this.taken = [];
    if (kind === 'photo') {
      const sp = c.nearbySpecies();
      if (!sp) return;
      const base = [0, 300, 900, 2400, 8000][sp.rarity];
      this.active = { kind, t: MISSION.photo.time, time: MISSION.photo.time, need: 1, got: 0, reward: base * MISSION.photo.rewardMult, title: `雑誌の依頼：${sp.name}をB以上で撮影`, target: sp };
      c.toast(`【依頼】海洋雑誌から「${sp.name}の写真がほしい！」 ${MISSION.photo.time}秒以内にB評価以上で撮ろう`, 'warn', 4.5);
    } else if (kind === 'urchin') {
      const U = MISSION.urchin;
      for (let i = 0; i < U.spawn; i++) {
        const a = Math.random() * Math.PI * 2, d = 2 + Math.random() * 11;
        const x = ahead.x + Math.cos(a) * d, z = ahead.z + Math.sin(a) * d;
        this.items.push(new THREE.Vector3(x, surfaceAt(x, z) + 0.05, z));
        this.taken.push(false);
        this.urchinMesh.setMatrixAt(i, this._m.compose(this.items[i], this._q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), a), new THREE.Vector3(1, 1, 1)));
      }
      this.urchinMesh.instanceMatrix.needsUpdate = true;
      this.urchinMesh.visible = true;
      const reward = c.zone === 'cold' ? U.coldReward : U.reward;
      this.active = { kind, t: U.time, time: U.time, need: U.need, got: 0, reward, title: 'ウニ駆除（磯焼け対策）' };
      c.toast(`【依頼】漁協から「ウニが増えすぎて海藻が消えている！」 ${U.time}秒でウニを${U.need}個獲ろう（近づくと拾える）`, 'warn', 4.5);
    } else if (kind === 'trash') {
      const T = MISSION.trash;
      for (let i = 0; i < T.spawn; i++) {
        const a = Math.random() * Math.PI * 2, d = 2 + Math.random() * 12;
        const x = ahead.x + Math.cos(a) * d, z = ahead.z + Math.sin(a) * d;
        const g = surfaceAt(x, z);
        this.items.push(new THREE.Vector3(x, Math.min(-0.8, g + 0.3 + Math.random() * Math.max(0, -g - 1.5)), z));
        this.taken.push(false);
      }
      this.writeTrash(c.time);
      this.trashMesh.visible = true;
      this.active = { kind, t: T.time, time: T.time, need: T.need, got: 0, reward: T.reward, title: '海のごみ拾い' };
      c.toast(`【依頼】海のごみが流れてきた！ ${T.time}秒で${T.need}個拾おう（近づくと拾える）`, 'warn', 4.5);
    } else if (kind === 'treasure') {
      const T = MISSION.treasure;
      const a = Math.random() * Math.PI * 2, d = 12 + Math.random() * T.radius;
      const x = c.player.x + Math.cos(a) * d, z = c.player.z + Math.sin(a) * d;
      const spot = new THREE.Vector3(x, surfaceAt(x, z) + 0.2, z);
      this.chestMesh.position.copy(spot);
      this.chestMesh.rotation.set(0.15, a, 0.1);
      this.chestMesh.visible = true;
      this.active = { kind, t: T.time, time: T.time, need: 1, got: 0, reward: T.reward, title: '遺跡の宝探し', spot };
      c.toast(`【依頼】古い地図によると、この遺跡のどこかに宝箱が沈んでいる！ ${T.time}秒以内に探し出そう`, 'warn', 4.5);
    } else {
      const L = MISSION.lost;
      const a = Math.random() * Math.PI * 2, d = 10 + Math.random() * L.radius;
      const x = c.player.x + Math.cos(a) * d, z = c.player.z + Math.sin(a) * d;
      const spot = new THREE.Vector3(x, surfaceAt(x, z) + 0.06, z);
      this.camMesh.position.copy(spot);
      this.camMesh.rotation.set(0.3, a, 0.2);
      this.camMesh.visible = true;
      this.active = { kind, t: L.time, time: L.time, need: 1, got: 0, reward: L.reward, title: '落とし物のカメラ探し', spot };
      c.toast(`【依頼】ダイバーが水中カメラを落とした！ ${L.time}秒以内に見つけて（マップの金色の印のあたり）`, 'warn', 4.5);
    }
    this.count++;
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
    const unit = a.kind === 'urchin' ? '個' : a.kind === 'trash' ? '個' : '';
    this.el.prog.textContent = a.kind === 'urchin' || a.kind === 'trash' ? `${a.got} / ${a.need}${unit}　残り${Math.ceil(a.t)}秒` : `残り${Math.ceil(a.t)}秒`;
    this.el.bar.style.width = `${Math.max(0, (a.t / a.time) * 100)}%`;
  }

  private end(_ok: boolean, silent = false): void {
    this.active = null;
    this.items = [];
    this.taken = [];
    this.urchinMesh.visible = false;
    this.trashMesh.visible = false;
    this.camMesh.visible = false;
    this.chestMesh.visible = false;
    if (!silent || this.el.root) this.el.root.classList.add('hidden');
  }
}
