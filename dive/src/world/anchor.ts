import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { heightAt } from './layout';

/**
 * 修正バッチ2 F2 (14): ボートの錨。船首から海底まで錨綱を垂らし、海底に手続きモデルの錨を置く。
 * 錨は潜水開始のボート位置ごとに置き直す（place）。ボートの揺れに合わせて綱の上端だけ動かす（follow）。
 * 描画は錨 1 + 綱 1 の 2 ドローコール、三角形は 1k 以下。ミニマップには出さない。
 */
export const ANCHOR = {
  /** 船首の綱の取り付け位置（ボートのローカル座標） */
  bow: new THREE.Vector3(0, 0.1, 7.4),
  /** 錨を船首の前方に置く水平距離 = 水深 × この値（上限 maxAhead） */
  ahead: 0.55,
  maxAhead: 14,
  /** 綱の長さ = 直線距離 × (1 + この値)。余った分は海底側にたるむ */
  slack: 0.12,
  /** 綱の太さ（半径、m） */
  rope: 0.03,
  /** 錨の大きさ（倍率） */
  scale: 1.0,
};

const SIDES = 5;
const SEGS = 3;

function anchorGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, rz = 0) => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.rotateZ(rz);
    g.translate(x, y, z);
    parts.push(g);
  };
  box(0.1, 1.3, 0.1, 0, 0.65, 0); // シャンク（柱）
  box(0.8, 0.09, 0.09, 0, 1.15, 0); // ストック（横木）
  box(0.2, 0.2, 0.12, 0, 1.38, 0); // 環の付け根
  box(0.5, 0.1, 0.1, -0.22, 0.12, 0, -0.55); // 左のアーム
  box(0.5, 0.1, 0.1, 0.22, 0.12, 0, 0.55); // 右のアーム
  box(0.14, 0.14, 0.14, 0, 0.02, 0); // クラウン
  const g = mergeGeometries(parts.map((p) => p.toNonIndexed()))!;
  g.computeVertexNormals();
  return g;
}

export class BoatAnchor {
  readonly group = new THREE.Group();
  readonly model: THREE.Mesh;
  readonly rope: THREE.Mesh;
  private readonly pts = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  private readonly top = new THREE.Vector3();
  private readonly ringTop = new THREE.Vector3();
  private placed = false;

  constructor() {
    this.model = new THREE.Mesh(anchorGeometry(), new THREE.MeshStandardMaterial({ color: 0x33383c, roughness: 0.7, metalness: 0.6 }));
    this.model.scale.setScalar(ANCHOR.scale);
    this.model.castShadow = false;
    const verts = (SEGS + 1) * SIDES;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts * 3), 3));
    const idx: number[] = [];
    for (let s = 0; s < SEGS; s++) for (let k = 0; k < SIDES; k++) {
      const a = s * SIDES + k, b = s * SIDES + ((k + 1) % SIDES), c = a + SIDES, d = b + SIDES;
      idx.push(a, c, b, b, c, d);
    }
    geo.setIndex(idx);
    this.rope = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xd8cfa8, roughness: 0.9, side: THREE.DoubleSide }));
    this.rope.frustumCulled = false;
    this.rope.castShadow = false;
    this.group.add(this.model, this.rope);
    this.group.visible = false;
  }

  /** 潜水開始のボート位置ごとに、船首の前方の海底へ錨を置き直す */
  place(boat: THREE.Object3D): void {
    boat.updateMatrixWorld(true);
    const bow = boat.localToWorld(ANCHOR.bow.clone());
    const fwd = new THREE.Vector3(0, 0, 1).transformDirection(boat.matrixWorld).setY(0).normalize();
    const depth = -heightAt(bow.x, bow.z);
    const off = Math.min(ANCHOR.maxAhead, Math.max(2, depth * ANCHOR.ahead));
    const x = bow.x + fwd.x * off, z = bow.z + fwd.z * off;
    // 足元の 3 点の最小値に着ける（斜面で片側が浮かない）
    const y = Math.min(heightAt(x, z), heightAt(x + 0.3, z), heightAt(x - 0.3, z), heightAt(x, z + 0.3), heightAt(x, z - 0.3)) + 0.02;
    this.model.position.set(x, y, z);
    // 倒れて海底に横たわる（シャンクが綱の向きへ傾く）
    this.model.rotation.set(0.25, Math.atan2(fwd.x, fwd.z), 1.1 + (x * 7.31 + z * 3.17) % 0.4, 'YXZ');
    this.ringTop.set(x, y + 0.5 * ANCHOR.scale, z);
    this.placed = true;
    this.follow(boat);
  }

  /** ボートの揺れに合わせて綱の上端（船首）だけ動かす。潜水中は毎フレーム呼ぶ */
  follow(boat: THREE.Object3D): void {
    this.group.visible = this.placed && boat.visible;
    if (!this.group.visible) return;
    this.top.copy(ANCHOR.bow);
    boat.localToWorld(this.top);
    const A = this.top, B = this.ringTop;
    const p = this.pts;
    p[0].copy(A);
    p[3].copy(B);
    const len = A.distanceTo(B);
    // 余った綱は海底側にたるむ。中間 2 点は直線から下へ（slack に比例）
    const sag = len * ANCHOR.slack;
    p[1].lerpVectors(A, B, 0.38);
    p[2].lerpVectors(A, B, 0.72);
    p[1].y -= sag * 0.25;
    p[2].y -= sag * 0.55;
    const pos = this.rope.geometry.attributes.position as THREE.BufferAttribute;
    const ax = new THREE.Vector3(), n1 = new THREE.Vector3(), n2 = new THREE.Vector3(), t = new THREE.Vector3();
    for (let i = 0; i <= SEGS; i++) {
      const a = p[Math.max(0, i - 1)], b = p[Math.min(SEGS, i + 1)];
      t.subVectors(b, a).normalize();
      ax.set(Math.abs(t.y) > 0.9 ? 1 : 0, Math.abs(t.y) > 0.9 ? 0 : 1, 0);
      n1.crossVectors(t, ax).normalize();
      n2.crossVectors(t, n1).normalize();
      for (let k = 0; k < SIDES; k++) {
        const th = (k / SIDES) * Math.PI * 2;
        pos.setXYZ(i * SIDES + k, p[i].x + (n1.x * Math.cos(th) + n2.x * Math.sin(th)) * ANCHOR.rope, p[i].y + (n1.y * Math.cos(th) + n2.y * Math.sin(th)) * ANCHOR.rope, p[i].z + (n1.z * Math.cos(th) + n2.z * Math.sin(th)) * ANCHOR.rope);
      }
    }
    pos.needsUpdate = true;
  }
}
