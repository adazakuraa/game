import * as THREE from 'three';
import { heightAt } from '../world/layout';
import { surfaceAt } from '../world/surface';

/**
 * Things lying on the sea floor: now and then (not every dive) an old box or case is down there.
 * You pick it up by swimming close; what is inside is only known back on the boat.
 */
export const FINDS = {
  /** 【拾い物が出る確率】per dive */
  chance: 0.4,
  /** distance from the entry point (m) */
  near: 25, far: 110,
  pickR: 1.4,
  /** weight carried (kg): it tires the diver like a catch */
  kg: 2.5,
};

export type FindKind = 'box' | 'case' | 'jar';
export const FIND_NAME: Record<FindKind, string> = { box: '古い木箱', case: '錆びた金属ケース', jar: '口の閉じた壺' };

export type Loot = { kind: 'coins' | 'pearl' | 'map' | 'junk'; text: string; yen: number; map?: string };

/** What is inside: decided when it is opened on the boat. */
export function openFind(kind: FindKind, unknownMaps: { id: string; name: string }[]): Loot {
  const r = Math.random();
  if (r < 0.22 && unknownMaps.length) {
    const m = unknownMaps[Math.floor(Math.random() * unknownMaps.length)];
    return { kind: 'map', text: `古い海図が出てきた！「${m.name}」の場所が描いてある`, yen: 0, map: m.id };
  }
  if (r < 0.5) {
    const y = Math.round((3000 + Math.random() * 9000) / 100) * 100;
    return { kind: 'coins', text: kind === 'jar' ? '古い銀貨がぎっしり！' : '昔の硬貨が出てきた！ 骨董屋が買い取ってくれた', yen: y };
  }
  if (r < 0.66) {
    const y = Math.round((8000 + Math.random() * 14000) / 100) * 100;
    return { kind: 'pearl', text: '大粒の真珠が入っていた！', yen: y };
  }
  const junk = ['中は空っぽだった…', '錆びたスパナが1本', 'ボトルメールが入っていた。「この手紙を拾った人に、いいことがありますように」', '貝殻とサンゴのかけらだけ', '泥がつまっていた…'];
  return { kind: 'junk', text: junk[Math.floor(Math.random() * junk.length)], yen: 0 };
}

export class Finds {
  readonly group = new THREE.Group();
  item: { kind: FindKind; p: THREE.Vector3; mesh: THREE.Object3D } | null = null;
  private glint: THREE.Sprite;

  constructor() {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,250,220,0.9)');
    gr.addColorStop(0.25, 'rgba(255,230,160,0.35)');
    gr.addColorStop(1, 'rgba(255,220,150,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
    this.glint = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.glint.scale.setScalar(0.9);
    this.glint.visible = false;
    this.group.add(this.glint);
  }

  private model(kind: FindKind): THREE.Object3D {
    const grp = new THREE.Group();
    if (kind === 'box') {
      const wood = new THREE.MeshStandardMaterial({ color: 0x5a4028, roughness: 0.9 });
      const band = new THREE.MeshStandardMaterial({ color: 0x6a5a40, roughness: 0.5, metalness: 0.6 });
      grp.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.34), wood));
      for (const x of [-0.17, 0.17]) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.32, 0.36), band); b.position.x = x; grp.add(b); }
    } else if (kind === 'case') {
      const metal = new THREE.MeshStandardMaterial({ color: 0x6a5040, roughness: 0.75, metalness: 0.5 });
      grp.add(new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.12, 0.32), metal));
      const h = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.012, 6, 12, Math.PI), metal);
      h.position.set(0, 0.06, 0.16); grp.add(h);
    } else {
      const clay = new THREE.MeshStandardMaterial({ color: 0x8a6a4a, roughness: 0.95 });
      const pts = [0, 0.1, 0.16, 0.17, 0.14, 0.08, 0.07, 0.09].map((r, i) => new THREE.Vector2(r, i * 0.05));
      grp.add(new THREE.Mesh(new THREE.LatheGeometry(pts, 14), clay));
    }
    grp.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return grp;
  }

  /** Maybe place one item for this dive somewhere around the entry point. */
  spawn(from: THREE.Vector3, ok: (x: number, z: number) => boolean): void {
    this.clear();
    if (Math.random() > FINDS.chance) return;
    for (let k = 0; k < 40; k++) {
      const a = Math.random() * Math.PI * 2, d = FINDS.near + Math.random() * (FINDS.far - FINDS.near);
      const x = from.x + Math.cos(a) * d, z = from.z + Math.sin(a) * d;
      const g = heightAt(x, z);
      if (g < -45 || g > -2 || !ok(x, z)) continue;
      const kinds: FindKind[] = ['box', 'case', 'jar'];
      const kind = kinds[Math.floor(Math.random() * kinds.length)];
      const mesh = this.model(kind);
      const y = surfaceAt(x, z);
      mesh.position.set(x, y + (kind === 'jar' ? 0 : 0.1), z);
      mesh.rotation.set(kind === 'jar' ? 1.3 : 0.12, Math.random() * 6, 0.08);
      this.group.add(mesh);
      this.item = { kind, p: new THREE.Vector3(x, y + 0.15, z), mesh };
      this.glint.position.copy(this.item.p).y += 0.25;
      this.glint.visible = true;
      return;
    }
  }

  clear(): void {
    if (this.item) this.group.remove(this.item.mesh);
    this.item = null;
    this.glint.visible = false;
  }

  /** A slow glint so it can be spotted from a distance; returns the kind when the diver picks it up. */
  update(time: number, player: THREE.Vector3): FindKind | null {
    if (!this.item) return null;
    const m = this.glint.material as THREE.SpriteMaterial;
    m.opacity = 0.35 + 0.65 * Math.max(0, Math.sin(time * 1.7)) ** 6;
    if (this.item.p.distanceTo(player) < FINDS.pickR) {
      const k = this.item.kind;
      this.clear();
      return k;
    }
    return null;
  }
}
