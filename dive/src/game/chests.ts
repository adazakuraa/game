import * as THREE from 'three';
import { BLUEHOLE, heightAt, RUINS, VENT, WRECK } from '../world/layout';
import { chestModel } from './gearModels';
import { PROP_VIEW } from './render';

/**
 * Phase 5: permanent treasure chests, one per map, never shown on the chart or the sonar.
 * Three hold limited gear (not sold in the shop); the rest hold a page of an old notebook
 * that names an unphotographed sight. Their number is never displayed anywhere.
 */
export const CHEST = { openR: 1.8, glintR: 12, openTime: 0.8, silver: 1000 };

export type ChestGearId = 'oldreg' | 'goldfins' | 'compass';
export const CHEST_GEAR: Record<ChestGearId, { name: string; desc: string }> = {
  oldreg: { name: '年代物のレギュレーター', desc: '沈没船の船倉に眠っていた年代物。呼吸が驚くほど楽で、エアの減りが1割少なくなる（大気圧潜水服では効かない）' },
  goldfins: { name: '古代の黄金のフィン', desc: '遺跡の神殿に奉納されていた黄金のフィン。泳ぐ速さが1割上がる（ロングフィンと重なる）' },
  compass: { name: '探検家のコンパス', desc: '洞窟の奥に残されていた探検家のコンパス。ボートがミニマップの外にあるとき、縁に方向の矢印が出る' },
};

export type ChestDef = {
  id: string;
  /** dive-point id of the map the chest belongs to (for scene-hint preference) */
  map: string;
  x: number;
  z: number;
  gear?: ChestGearId;
  /** place inside the dive-point wreck, in the wreck's local frame (same pose as flora's placeWreck) */
  wreckLocal?: [number, number, number];
};

export const CHESTS: ChestDef[] = [
  { id: 'c_lagoon', map: 'lagoon', x: 95, z: 20 },
  { id: 'c_reef', map: 'reef', x: -150, z: 300 },
  { id: 'c_rocky', map: 'rocky', x: 175, z: 300 },
  { id: 'c_wreck', map: 'dropoff', x: WRECK.x, z: WRECK.z, gear: 'oldreg', wreckLocal: [0.4, -1.0, -6] },
  { id: 'c_cold', map: 'cold', x: -390, z: 60 },
  { id: 'c_ruins', map: 'ruins', x: RUINS.x, z: RUINS.z, gear: 'goldfins' },
  { id: 'c_bluehole', map: 'bluehole', x: BLUEHOLE.x + 23 * Math.cos(2.2), z: BLUEHOLE.z + 23 * Math.sin(2.2) },
  { id: 'c_cave', map: 'cave', x: -360, z: 968, gear: 'compass' },
  { id: 'c_kelp', map: 'kelp', x: 380, z: 330 },
  { id: 'c_deep', map: 'deep', x: VENT.x + 30, z: VENT.z + 20 },
];

type Item = { def: ChestDef; pos: THREE.Vector3; mesh: THREE.Mesh; setLid: (angle: number) => void; opened: boolean; openT: number };

export class Chests {
  readonly group = new THREE.Group();
  private items: Item[] = [];
  private glint: THREE.Points;
  private glintPos: Float32Array;
  private time = 0;

  constructor() {
    this.glintPos = new Float32Array(CHESTS.length * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.glintPos, 3));
    this.glint = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffd76a, size: 0.45, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.glint.frustumCulled = false;
    this.glint.visible = false;
  }

  /** (Re)place every chest for a dive; opened ones stand open and empty. */
  build(opened: Set<string>): void {
    for (const it of this.items) it.mesh.geometry.dispose();
    this.group.clear();
    this.items = [];
    const wreckM = new THREE.Matrix4().compose(
      new THREE.Vector3(WRECK.x, heightAt(WRECK.x, WRECK.z) + 2.2, WRECK.z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0.04, 0.6, 0.22)),
      new THREE.Vector3(1, 1, 1),
    );
    for (const def of CHESTS) {
      const { mesh, setLid } = chestModel();
      let pos: THREE.Vector3;
      if (def.wreckLocal) {
        pos = new THREE.Vector3(...def.wreckLocal).applyMatrix4(wreckM);
        mesh.position.copy(pos);
        mesh.rotation.set(0.04, 0.6, 0.22);
      } else {
        pos = new THREE.Vector3(def.x, heightAt(def.x, def.z) + 0.22, def.z);
        mesh.position.copy(pos);
        mesh.rotation.y = (def.x * 12.9898 + def.z * 78.233) % Math.PI;
      }
      const isOpen = opened.has(def.id);
      if (isOpen) setLid(-1.85);
      this.group.add(mesh);
      this.items.push({ def, pos: pos.clone(), mesh, setLid, opened: isOpen, openT: isOpen ? 1 : 0 });
    }
    if (!this.group.children.includes(this.glint)) this.group.add(this.glint);
  }

  /** Swing a chest's lid open (the contents are decided by the caller). */
  open(id: string): void {
    const it = this.items.find((i) => i.def.id === id);
    if (it && !it.opened) { it.opened = true; it.openT = 0; }
  }

  /**
   * Per-frame: animate lids, refresh the gold glints of unopened chests near the
   * player, and return the id of an unopened chest within opening reach.
   */
  update(player: THREE.Vector3, dt: number): string | null {
    this.time += dt;
    let near: string | null = null;
    let nearD = CHEST.openR;
    let n = 0;
    for (const it of this.items) {
      if (it.opened && it.openT < 1) {
        it.openT = Math.min(1, it.openT + dt / CHEST.openTime);
        const t = it.openT;
        it.setLid(-1.85 * (1 - (1 - t) ** 3));
      }
      const d = it.pos.distanceTo(player);
      it.mesh.visible = d < PROP_VIEW;
      if (it.opened) continue;
      if (d < nearD) { nearD = d; near = it.def.id; }
      if (d < CHEST.glintR) {
        this.glintPos[n * 3] = it.pos.x;
        this.glintPos[n * 3 + 1] = it.pos.y + 1.1 + Math.sin(this.time * 2.4 + n) * 0.15;
        this.glintPos[n * 3 + 2] = it.pos.z;
        n++;
      }
    }
    (this.glint.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    this.glint.geometry.setDrawRange(0, n);
    this.glint.visible = n > 0;
    (this.glint.material as THREE.PointsMaterial).opacity = 0.65 + 0.35 * Math.sin(this.time * 3);
    return near;
  }

  list(): { id: string; x: number; y: number; z: number; opened: boolean }[] {
    return this.items.map((i) => ({ id: i.def.id, x: i.pos.x, y: i.pos.y, z: i.pos.z, opened: i.opened }));
  }
}
