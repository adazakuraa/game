import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { heightAt } from './layout';
import type { ScatterItem } from './scatter';

/**
 * 修正バッチ2 F9 (30)：鯨骨生物群集（クジラの死骸が沈んだ深海の骨）。
 * 地形の高さは変えない。骨・バクテリアマット・赤いホネクイハナムシの群れは、地形の上に置くだけ。
 * 場所は heightAt で探した：深海（z > 720）・水深 430m・噴出孔 VENT (28, 965) から 64m・宝箱 c_deep (58, 985) から 80m・
 * 軸の方向に 16m の範囲で高低差が最も小さい（2.3m）所。
 */
export const WHALE = {
  x: -32,
  z: 988,
  /** 骨格の軸（頭の向き）。ワールドの x 軸から z 軸へ測った角度（rad） */
  yaw: 0.262,
  /** 骨格の長さ（頭の先〜尾）のおよその半径 (m)：写真スポットの円・生き物の置き場所の範囲 */
  spineFrom: -9.4,
  spineTo: 4.6,
  vertebrae: 36,
  ribPairs: 12,
  /** バクテリアマットの斑点の数 */
  mats: 64,
  /** 赤いホネクイハナムシの飾りの房の数（生き物の個体とは別。景色） */
  tufts: 90,
};

const ca = Math.cos(WHALE.yaw), sa = Math.sin(WHALE.yaw);
/** 骨格の局所座標（lx＝軸、lz＝横）→ ワールド */
export function whaleWorld(lx: number, lz: number): [number, number] {
  return [WHALE.x + lx * ca - lz * sa, WHALE.z + lx * sa + lz * ca];
}

function rngOf(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

const qYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -WHALE.yaw);
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();

function compose(x: number, y: number, z: number, rx: number, ry: number, rz: number, sx: number, sy = sx, sz = sx): THREE.Matrix4 {
  _q.setFromEuler(_e.set(rx, ry, rz)).premultiply(qYaw);
  return new THREE.Matrix4().compose(_v.set(x, y, z), _q, _s.set(sx, sy, sz));
}

// ---------------------------------------------------------------- geometry

/** 脊椎骨 1 個（軸は x）：円盤状の椎体＋上の棘突起＋横の突起。1 m 前後に収まる単位 */
export function vertebraGeometry(): THREE.BufferGeometry {
  const body = new THREE.CylinderGeometry(0.34, 0.34, 0.3, 12, 1);
  body.rotateZ(Math.PI / 2);
  const spine = new THREE.BoxGeometry(0.12, 0.7, 0.07);
  spine.translate(-0.02, 0.5, 0);
  const wing = new THREE.BoxGeometry(0.1, 0.07, 0.8);
  wing.translate(0, 0.08, 0);
  const arch = new THREE.TorusGeometry(0.2, 0.05, 5, 10, Math.PI);
  arch.rotateY(Math.PI / 2);
  arch.translate(0, 0.2, 0);
  return finish(mergeGeometries([body, spine, wing, arch].map((g) => g.toNonIndexed()))!);
}

/** 肋骨 1 本：背骨から +z へ張り出し、先が下へ曲がる弧（y-z 面、x=0）。長さ約 2.4 m の単位 */
export function ribGeometry(): THREE.BufferGeometry {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    const psi = t * 1.7;
    pts.push(new THREE.Vector3(0, 0.95 * (1 - Math.cos(psi)) * 0.35 - t * t * 0.3, 1.5 * Math.sin(psi) * 0.95 + t * 0.4));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  // 太さは根元が太く先が細い：チューブを作って半径を詰める
  const tube = new THREE.TubeGeometry(curve, 14, 0.07, 6, false);
  const p = tube.attributes.position as THREE.BufferAttribute;
  const c = new THREE.Vector3(), q = new THREE.Vector3();
  const rings = 15;
  for (let r = 0; r < rings; r++) {
    const t = r / (rings - 1);
    curve.getPointAt(t, c);
    const k = 1.35 - 0.95 * t;
    for (let j = 0; j <= 6; j++) {
      const idx = r * 7 + j;
      q.set(p.getX(idx), p.getY(idx), p.getZ(idx)).sub(c).multiplyScalar(k).add(c);
      p.setXYZ(idx, q.x, q.y, q.z);
    }
  }
  tube.computeVertexNormals();
  return finish(tube.toNonIndexed());
}

/** 頭骨＋下あご 2 本（軸は x。頭の先が +x）。長さ約 4.4 m */
export function skullGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const cran = new THREE.SphereGeometry(1, 20, 14);
  const cp = cran.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < cp.count; i++) {
    const x = cp.getX(i), y = cp.getY(i), z = cp.getZ(i);
    // 後ろ（-x）は丸く幅広、前（+x）は細い吻に向かって絞る
    const u = (x + 1) / 2;
    const w = 1.15 - 0.85 * u * u;
    cp.setXYZ(i, x * 2.2, y * (0.55 - 0.25 * u) * 1.0 + 0.05, z * 1.15 * w);
  }
  cran.computeVertexNormals();
  parts.push(cran.toNonIndexed());
  // 吻（上あごの先）
  const rost = new THREE.CylinderGeometry(0.16, 0.34, 1.9, 9);
  rost.rotateZ(-Math.PI / 2);
  rost.translate(2.7, 0.0, 0);
  parts.push(rost.toNonIndexed());
  // 下あご：左右 2 本の長い弧
  for (const side of [-1, 1]) {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      pts.push(new THREE.Vector3(-1.5 + t * 4.4, -0.45 + Math.sin(t * Math.PI) * 0.08, side * (1.0 - 0.45 * t * t + 0.12 * Math.sin(t * Math.PI))));
    }
    const jaw = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 18, 0.13, 7, false);
    parts.push(jaw.toNonIndexed());
  }
  return finish(mergeGeometries(parts)!);
}

function finish(g: THREE.BufferGeometry): THREE.BufferGeometry {
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  return g;
}

/** バクテリアマットの斑点：不規則な縁の薄い円盤（半径 1） */
export function matGeometry(): THREE.BufferGeometry {
  const r = rngOf(77);
  const g = new THREE.CircleGeometry(1, 18);
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 1; i < p.count; i++) {
    const k = 0.72 + r() * 0.45;
    p.setXYZ(i, p.getX(i) * k, 0, p.getZ(i) * k);
  }
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  return g;
}

/** 赤い毛のような房（ホネクイハナムシの飾り）：白い管＋赤い羽毛状の先。tubeMat（頂点色・ゆらぎ）で描く */
export function boneTuftGeometry(): THREE.BufferGeometry {
  const r = rngOf(31);
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 16; i++) {
    const h = 0.18 + r() * 0.28;
    const t = new THREE.CylinderGeometry(0.012, 0.016, h, 5, 2, true);
    t.translate(0, h / 2, 0);
    const bx = (r() - 0.5) * 0.18, bz = (r() - 0.5) * 0.18;
    const tp = t.attributes.position as THREE.BufferAttribute;
    for (let k = 0; k < tp.count; k++) {
      const y = tp.getY(k) / h;
      tp.setX(k, tp.getX(k) + bx * y * y);
      tp.setZ(k, tp.getZ(k) + bz * y * y);
    }
    const plume = new THREE.ConeGeometry(0.045, 0.16, 6, 1, true);
    plume.rotateX(Math.PI);
    plume.translate(bx, h + 0.06, bz);
    const ox = (r() - 0.5) * 0.4, oz = (r() - 0.5) * 0.4;
    t.translate(ox, 0, oz);
    plume.translate(ox, 0, oz);
    const col = (g: THREE.BufferGeometry, rr: number, gg: number, bb: number) => {
      const a = new Float32Array(g.attributes.position.count * 3);
      for (let k = 0; k < a.length; k += 3) { a[k] = rr; a[k + 1] = gg; a[k + 2] = bb; }
      g.setAttribute('color', new THREE.BufferAttribute(a, 3));
      g.deleteAttribute('uv');
    };
    col(t, 0.9, 0.84, 0.78);
    col(plume, 0.9, 0.08, 0.06);
    parts.push(t.toNonIndexed(), plume.toNonIndexed());
  }
  const g = mergeGeometries(parts)!;
  g.computeVertexNormals();
  return g;
}

/** 図鑑のホネクイハナムシのモデル（kind 'inv'、単位 1）：赤い羽毛状の房が骨から生えている */
export function buildOsedax(): THREE.BufferGeometry {
  const r = rngOf(5);
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 12; i++) {
    const h = 0.45 + r() * 0.5;
    const ox = (r() - 0.5) * 0.9, oz = (r() - 0.5) * 0.9;
    const stalk = new THREE.CylinderGeometry(0.02, 0.03, h, 6, 3, true);
    stalk.translate(0, h / 2, 0);
    const bx = (r() - 0.5) * 0.3, bz = (r() - 0.5) * 0.3;
    const sp = stalk.attributes.position as THREE.BufferAttribute;
    for (let k = 0; k < sp.count; k++) {
      const y = sp.getY(k) / h;
      sp.setX(k, sp.getX(k) + bx * y * y);
      sp.setZ(k, sp.getZ(k) + bz * y * y);
    }
    stalk.translate(ox, 0, oz);
    parts.push(stalk);
    // 羽毛状の鰓（先端の扇）
    for (let f = 0; f < 4; f++) {
      const feather = new THREE.ConeGeometry(0.035, 0.28, 5, 1, true);
      feather.translate(0, 0.14, 0);
      feather.rotateZ((f - 1.5) * 0.45);
      feather.rotateY(f * 1.57 + i);
      feather.translate(ox + bx, h, oz + bz);
      parts.push(feather);
    }
  }
  const g = mergeGeometries(parts)!;
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------- placement

export type WhaleLayout = {
  skull: ScatterItem[];
  vertebrae: ScatterItem[];
  ribs: ScatterItem[];
  mats: ScatterItem[];
  tufts: ScatterItem[];
  /** 生き物の住みか（骨のそば、地面の高さ） */
  homes: THREE.Vector3[];
  /** 頭骨の当たり判定（中心と半径、y の範囲） */
  skullBox: { x: number; z: number; r: number; y0: number; y1: number };
};

/** 骨の下の地面の高さ（足元 5 点の最小。骨が浮かない） */
function footY(x: number, z: number, c: number): number {
  let y = heightAt(x, z);
  for (const [dx, dz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) y = Math.min(y, heightAt(x + dx * c, z + dz * c));
  return y;
}

let cached: WhaleLayout | null = null;

export function whaleLayout(): WhaleLayout {
  if (cached) return cached;
  const r = rngOf(2024);
  const out: WhaleLayout = { skull: [], vertebrae: [], ribs: [], mats: [], tufts: [], homes: [], skullBox: { x: 0, z: 0, r: 0, y0: 0, y1: 0 } };
  const bonePts: { x: number; y: number; z: number }[] = [];
  const tuftPts: { x: number; y: number; z: number }[] = [];

  // 頭骨：背骨の前端のすぐ先、少し横向きに倒れている
  {
    const lx = WHALE.spineTo + 2.6, lz = 0.4;
    const [x, z] = whaleWorld(lx, lz);
    const y = footY(x, z, 1.3) + 0.2;
    out.skull.push({ m: compose(x, y, z, 0.12, 0.08, 0.1, 1) });
    out.skullBox = { x, z, r: 1.9, y0: y - 0.4, y1: y + 0.9 };
    for (let k = 0; k < 7; k++) { const t = -1.6 + k * 0.55; const [tx, tz] = whaleWorld(lx + t, lz + (r() - 0.5) * 1.6); tuftPts.push({ x: tx, y: heightAt(tx, tz) + 0.6 + r() * 0.3, z: tz }); }
    bonePts.push({ x, y, z });
    out.homes.push(new THREE.Vector3(x, heightAt(x, z), z));
  }

  // 背骨：軸に沿って少しくねらせ、尾に向かって小さくなる
  const spineXY: { lx: number; lz: number; sc: number }[] = [];
  for (let i = 0; i < WHALE.vertebrae; i++) {
    const t = i / (WHALE.vertebrae - 1);
    const lx = WHALE.spineTo - t * (WHALE.spineTo - WHALE.spineFrom);
    const lz = Math.sin(lx * 0.28) * 0.7 + (r() - 0.5) * 0.12;
    const sc = 1.0 - 0.62 * t * t;
    spineXY.push({ lx, lz, sc });
    const [x, z] = whaleWorld(lx, lz);
    const y = footY(x, z, 0.4 * sc) + 0.3 * sc;
    out.vertebrae.push({ m: compose(x, y, z, (r() - 0.5) * 0.3, (r() - 0.5) * 0.4, (r() - 0.5) * 0.15, sc) });
    bonePts.push({ x, y: y + 0.4 * sc, z });
    if (i % 3 === 0) out.homes.push(new THREE.Vector3(x, heightAt(x, z), z));
    if (i % 2 === 0) tuftPts.push({ x, y: y + 0.45 * sc, z });
  }

  // 肋骨：背骨の前寄り 12 か所から左右へ。外へ倒れて半分は地面に埋まっている
  for (let i = 0; i < WHALE.ribPairs; i++) {
    const s = spineXY[3 + i];
    const len = 1.0 - Math.abs(i - 3.5) * 0.045;
    for (const side of [1, -1]) {
      const [x, z] = whaleWorld(s.lx, s.lz);
      const y = footY(x, z, 0.5) + 0.35;
      const roll = (side > 0 ? 1 : -1) * (0.15 + r() * 0.8) * -1;
      // side=-1 は y 軸まわりに π 回して鏡像にする（スケールの符号反転は面の向きを裏返すので使わない）
      out.ribs.push({ m: compose(x, y, z, roll, side > 0 ? 0 : Math.PI, 0, len * (0.9 + r() * 0.2)) });
      const ex = s.lx, ez = s.lz + side * 1.7 * len;
      const [wx, wz] = whaleWorld(ex, ez);
      tuftPts.push({ x: wx, y: heightAt(wx, wz) + 0.25, z: wz });
      if (i % 2 === 0) out.homes.push(new THREE.Vector3(wx, heightAt(wx, wz), wz));
    }
  }

  // バクテリアマット：骨の近くに多く、その外へまばらに
  for (let i = 0; i < WHALE.mats; i++) {
    const near = i < WHALE.mats * 0.7 && bonePts.length;
    let x: number, z: number;
    if (near) {
      const b = bonePts[Math.floor(r() * bonePts.length)];
      const a = r() * Math.PI * 2, d = 0.3 + r() * 2.2;
      x = b.x + Math.cos(a) * d; z = b.z + Math.sin(a) * d;
    } else {
      const [wx, wz] = whaleWorld(WHALE.spineFrom - 2 + r() * (WHALE.spineTo - WHALE.spineFrom + 8), (r() - 0.5) * 9);
      x = wx; z = wz;
    }
    const rad = 0.35 + r() * 0.9;
    let y = heightAt(x, z);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) y = Math.max(y, heightAt(x + dx * rad * 0.7, z + dz * rad * 0.7));
    out.mats.push({ m: new THREE.Matrix4().compose(_v.set(x, y + 0.025, z), _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * 6.28), _s.set(rad, 1, rad * (0.7 + r() * 0.5))) });
  }

  // 赤い房：骨の上と、骨のすぐそばの地面
  for (let i = 0; i < WHALE.tufts; i++) {
    const p = tuftPts[i % tuftPts.length];
    const j = i < tuftPts.length ? 0 : 0.5;
    const x = p.x + (r() - 0.5) * j, z = p.z + (r() - 0.5) * j;
    const y = i < tuftPts.length ? p.y : Math.max(heightAt(x, z) + 0.05, p.y - 0.4);
    const sc = 0.4 + r() * 0.5;
    out.tufts.push({ m: new THREE.Matrix4().compose(_v.set(x, y, z), _q.setFromEuler(_e.set((r() - 0.5) * 0.6, r() * 6.28, (r() - 0.5) * 0.6)), _s.setScalar(sc)) });
  }

  cached = out;
  return out;
}

/** 生き物の住みかの点（地面の高さ）。クローンを返す */
export function whaleHomes(): THREE.Vector3[] {
  return whaleLayout().homes.map((v) => v.clone());
}
