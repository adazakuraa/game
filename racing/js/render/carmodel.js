// 手続き的 GT カーモデル（断面ロフトでボディを生成）
import * as THREE from 'three';
import { numberTexture, radialTexture } from './textures.js';

const FA = 1.3; // 前軸 z
const RA = -1.36; // 後軸 z
const WR = 0.335; // タイヤ半径

function smooth(t) { return t * t * (3 - 2 * t); }
function lerpKeys(keys, z) {
  if (z <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (z <= keys[i][0]) {
      const t = (z - keys[i - 1][0]) / (keys[i][0] - keys[i - 1][0]);
      return keys[i - 1][1] + (keys[i][1] - keys[i - 1][1]) * smooth(t);
    }
  }
  return keys[keys.length - 1][1];
}

// 断面ロフト: stations = [{z, hw, yb, yt, n, nb}]
function loft(stations, seg = 28, capFront = true, capRear = true) {
  const pos = [], idx = [], uv = [];
  const ring = seg + 1;
  stations.forEach((st, si) => {
    for (let k = 0; k <= seg; k++) {
      const th = (k / seg) * Math.PI * 2;
      const c = Math.cos(th), s = Math.sin(th);
      const top = s >= 0;
      const ex = 2 / (top ? st.n : st.nb ?? st.n);
      const x = st.hw * Math.sign(c) * Math.abs(c) ** ex;
      const mid = st.ym ?? (st.yb + st.yt) / 2;
      const hh = top ? st.yt - mid : mid - st.yb;
      const y = mid + hh * Math.sign(s) * Math.abs(s) ** ex;
      pos.push(x, y, st.z);
      uv.push(k / seg, si / (stations.length - 1));
    }
  });
  for (let si = 0; si < stations.length - 1; si++) {
    for (let k = 0; k < seg; k++) {
      const a = si * ring + k, b = a + 1, c = a + ring, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const addCap = (si, flip) => {
    const st = stations[si];
    const ci = pos.length / 3;
    pos.push(0, st.ym ?? (st.yb + st.yt) / 2, st.z);
    uv.push(0.5, 0.5);
    for (let k = 0; k < seg; k++) {
      const a = si * ring + k, b = a + 1;
      if (flip) idx.push(ci, a, b); else idx.push(ci, b, a);
    }
  };
  if (capFront) addCap(stations.length - 1, true);
  if (capRear) addCap(0, false);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function bodyGeometry() {
  const halfW = [[-2.32, 0.9], [-2.1, 0.97], [-1.7, 1.0], [-1.36, 1.0], [-0.9, 0.95], [0, 0.93], [0.9, 0.95], [1.3, 0.985], [1.75, 0.95], [2.1, 0.86], [2.36, 0.72]];
  const topY = [[-2.32, 0.86], [-2.1, 0.92], [-1.6, 0.9], [-1.1, 0.86], [-0.6, 0.84], [0.0, 0.82], [0.7, 0.8], [1.2, 0.72], [1.8, 0.62], [2.2, 0.52], [2.36, 0.42]];
  const st = [];
  const zs = [];
  for (let z = -2.32; z <= 2.361; z += 0.06) zs.push(Math.min(z, 2.36));
  for (const z of zs) {
    let yb = 0.13;
    for (const za of [FA, RA]) {
      const t = (z - za) / 0.43;
      if (Math.abs(t) < 1) yb = Math.max(yb, 0.13 + 0.4 * Math.sqrt(1 - t * t));
    }
    // ノーズ・テールの持ち上げ
    if (z > 2.0) yb += (z - 2.0) * 0.4;
    if (z < -2.1) yb += (-2.1 - z) * 0.6;
    const yt = lerpKeys(topY, z);
    st.push({ z, hw: lerpKeys(halfW, z), yb, yt, ym: yb + (yt - yb) * 0.42, n: 3.2, nb: 6 });
  }
  return loft(st, 32);
}

function cabinGeometry() {
  // z: 後端(-1.3)〜前端(0.78)
  const st = [];
  const roof = 1.2;
  for (let i = 0; i <= 24; i++) {
    const z = -1.32 + (i / 24) * 2.12;
    let yt;
    if (z > 0.05) yt = roof - (z - 0.05) ** 1.35 * 0.62; // フロントガラス
    else if (z < -0.55) yt = roof - (-0.55 - z) ** 1.25 * 0.48; // リアガラス
    else yt = roof;
    const base = lerpKeys([[-1.32, 0.86], [-0.6, 0.83], [0, 0.81], [0.8, 0.78]], z) - 0.02;
    yt = Math.max(yt, base + 0.02);
    const hw = lerpKeys([[-1.32, 0.74], [-0.6, 0.72], [0.1, 0.72], [0.8, 0.78]], z) * (0.74 + 0.26 * Math.min(1, (roof - yt) * 3 + 0.15));
    st.push({ z, hw, yb: base - 0.25, yt, ym: base, n: 2.6, nb: 8 });
  }
  const g = loft(st, 28).toNonIndexed();
  g.computeVertexNormals();
  // 窓の部分だけガラス、それ以外（ピラー・ルーフ）は塗装
  const p = g.attributes.position, nrm = g.attributes.normal;
  const paintIdx = [], glassIdx = [];
  const tri = p.count / 3;
  const quadTris = 24 * 28 * 2; // ロフト側面の三角形数（2枚で1枚の四角形）
  for (let t = 0; t < tri; t++) {
    let cx = 0, cy = 0, cz = 0, nx = 0, ny = 0, nz = 0;
    const t0 = t < quadTris ? t - (t % 2) : t, nt = t < quadTris ? 2 : 1;
    for (let q = 0; q < nt; q++) for (let k = 0; k < 3; k++) {
      const i = (t0 + q) * 3 + k;
      const w = 1 / (3 * nt);
      cx += p.getX(i) * w; cy += p.getY(i) * w; cz += p.getZ(i) * w;
      nx += nrm.getX(i) * w; ny += nrm.getY(i) * w; nz += nrm.getZ(i) * w;
    }
    const base = lerpKeys([[-1.32, 0.84], [-0.6, 0.81], [0, 0.79], [0.8, 0.76]], cz);
    const wind = nz > 0.3 && ny > 0.25 && Math.abs(cx) < 0.5 && cy > base + 0.04 && cz > 0.12 && cz < 0.74;
    const rear = nz < -0.3 && ny > 0.25 && Math.abs(cx) < 0.46 && cy > base + 0.05 && cz < -0.62;
    const side = Math.abs(nx) > 0.55 && cy > base + 0.07 && cy < 1.13 && cz > -1.0 && cz < 0.55 && !(cz > -0.42 && cz < -0.3);
    (wind || rear || side ? glassIdx : paintIdx).push(t * 3, t * 3 + 1, t * 3 + 2);
  }
  g.setIndex([...paintIdx, ...glassIdx]);
  g.clearGroups();
  g.addGroup(0, paintIdx.length, 0);
  g.addGroup(paintIdx.length, glassIdx.length, 1);
  return g;
}

function wheelGeometries() {
  // タイヤ: 回転体（断面は角の丸い長方形）
  const prof = [];
  const w = 0.15, rIn = 0.235, rOut = WR;
  const steps = 8;
  prof.push(new THREE.Vector2(rIn, -w));
  for (let i = 0; i <= steps; i++) {
    const a = -Math.PI / 2 + (i / steps) * (Math.PI / 2);
    prof.push(new THREE.Vector2(rOut - 0.04 + Math.cos(a) * 0.04, -w + 0.04 + Math.sin(a) * 0.04 + 0.0));
  }
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * (Math.PI / 2);
    prof.push(new THREE.Vector2(rOut - 0.04 + Math.cos(a) * 0.04, w - 0.04 + Math.sin(a) * 0.04));
  }
  prof.push(new THREE.Vector2(rIn, w));
  const tire = new THREE.LatheGeometry(prof, 36);
  tire.rotateZ(Math.PI / 2);
  // ホイール（ディスク + スポーク）
  const rim = new THREE.CylinderGeometry(0.235, 0.235, 0.2, 32, 1, true);
  rim.rotateZ(Math.PI / 2);
  const face = new THREE.RingGeometry(0.2, 0.236, 32);
  face.rotateY(Math.PI / 2);
  face.translate(0.1, 0, 0);
  const spoke = new THREE.BoxGeometry(0.03, 0.2, 0.045);
  const spokes = [];
  for (let i = 0; i < 10; i++) {
    const g = spoke.clone();
    g.translate(0, 0.11, (i % 2 ? 1 : -1) * 0.018);
    g.rotateX((Math.floor(i / 2) / 5) * Math.PI * 2);
    g.translate(0.085, 0, 0);
    spokes.push(g);
  }
  const hub = new THREE.CylinderGeometry(0.045, 0.05, 0.05, 12);
  hub.rotateZ(Math.PI / 2);
  hub.translate(0.09, 0, 0);
  const rimAll = mergeGeos([rim, face, hub, ...spokes]);
  const disc = new THREE.CylinderGeometry(0.19, 0.19, 0.03, 28);
  disc.rotateZ(Math.PI / 2);
  disc.translate(-0.02, 0, 0);
  const caliper = new THREE.BoxGeometry(0.06, 0.12, 0.09);
  caliper.translate(0.0, 0.13, 0.08);
  return { tire, rim: rimAll, disc, caliper };
}

export function mergeGeos(geos) {
  let total = 0, itotal = 0;
  const gs = geos.map((g) => (g.index ? g : g.toNonIndexed()));
  for (const g of geos) {
    total += g.attributes.position.count;
    itotal += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), uv = new Float32Array(total * 2);
  const idx = new Uint32Array(itotal);
  let vo = 0, io = 0;
  for (const g of geos) {
    if (!g.attributes.normal) g.computeVertexNormals();
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array, vo * 3);
    nor.set(g.attributes.normal.array, vo * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, vo * 2);
    if (g.index) {
      for (let i = 0; i < g.index.count; i++) idx[io + i] = g.index.array[i] + vo;
      io += g.index.count;
    } else {
      for (let i = 0; i < n; i++) idx[io + i] = i + vo;
      io += n;
    }
    vo += n;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  gs.length = 0;
  return out;
}

function trimGeometry() {
  const parts = [];
  // フロントスプリッター
  const sp = new THREE.BoxGeometry(1.9, 0.035, 0.32);
  sp.translate(0, 0.1, 2.22);
  parts.push(sp);
  // サイドスカート
  for (const s of [1, -1]) {
    const sk = new THREE.BoxGeometry(0.06, 0.1, 1.7);
    sk.translate(s * 0.96, 0.17, -0.03);
    parts.push(sk);
  }
  // ディフューザー
  const df = new THREE.BoxGeometry(1.6, 0.12, 0.4);
  df.translate(0, 0.16, -2.18);
  parts.push(df);
  for (let i = -3; i <= 3; i++) {
    const fin = new THREE.BoxGeometry(0.02, 0.16, 0.42);
    fin.translate(i * 0.22, 0.2, -2.2);
    parts.push(fin);
  }
  // リアウイング
  const wingShape = new THREE.Shape();
  wingShape.moveTo(0, 0);
  wingShape.bezierCurveTo(0.08, 0.06, 0.25, 0.05, 0.36, -0.01);
  wingShape.lineTo(0.36, -0.03);
  wingShape.bezierCurveTo(0.22, 0.0, 0.08, 0.0, 0, -0.02);
  const wing = new THREE.ExtrudeGeometry(wingShape, { depth: 1.86, bevelEnabled: false, steps: 1 });
  wing.translate(0, 0, -0.93);
  wing.rotateY(Math.PI / 2);
  wing.translate(0, 1.2, -1.82);
  parts.push(wing);
  for (const s of [1, -1]) {
    const ep = new THREE.BoxGeometry(0.02, 0.24, 0.46);
    ep.translate(s * 0.94, 1.17, -2.0);
    parts.push(ep);
    const st = new THREE.BoxGeometry(0.03, 0.3, 0.1);
    st.translate(s * 0.45, 1.02, -2.02);
    parts.push(st);
    // ミラー
    const mr = new THREE.BoxGeometry(0.16, 0.08, 0.1);
    mr.translate(s * 0.83, 0.9, 0.55);
    parts.push(mr);
  }

  // フロントグリル
  const gr = new THREE.BoxGeometry(1.0, 0.12, 0.04);
  gr.translate(0, 0.3, 2.31);
  parts.push(gr);
  return mergeGeos(parts);
}

function wellGeometry() {
  const parts = [];
  for (const s of [1, -1]) {
    for (const za of [FA, RA]) {
      const wh = new THREE.BoxGeometry(0.5, 0.3, 0.86);
      wh.translate(s * 0.5, 0.42, za);
      parts.push(wh);
    }
  }
  const ub = new THREE.BoxGeometry(1.8, 0.04, 4.2);
  ub.translate(0, 0.14, 0);
  parts.push(ub);
  return mergeGeos(parts);
}

let shared = null;
function getShared(quality) {
  if (shared) return shared;
  const w = wheelGeometries();
  const headGeo = new THREE.SphereGeometry(1, 16, 10);
  headGeo.scale(0.2, 0.045, 0.11);
  const tailGeo = new THREE.BoxGeometry(0.42, 0.06, 0.04);
  const exhaust = new THREE.CylinderGeometry(0.05, 0.05, 0.12, 12);
  exhaust.rotateX(Math.PI / 2);
  const bodyG = bodyGeometry();
  // 左右のライト・マフラーをまとめる
  const heads = [], tails = [], exs = [], nums = [], stripes = [];
  for (const s of [1, -1]) {
    const h = headGeo.clone();
    h.rotateX(-0.45); h.rotateY(s * 0.45); h.translate(s * 0.6, 0.5, 2.06);
    heads.push(h);
    const t = tailGeo.clone();
    t.translate(s * 0.66, 0.78, -2.31);
    tails.push(t);
    const e = exhaust.clone();
    e.translate(s * 0.3, 0.22, -2.36);
    exs.push(e);
    const n = new THREE.PlaneGeometry(0.46, 0.46);
    n.rotateY((s * Math.PI) / 2); n.translate(s * 0.952, 0.52, -0.15);
    nums.push(n);
    const st = new THREE.PlaneGeometry(1.9, 0.05);
    st.rotateY((s * Math.PI) / 2); st.translate(s * 0.955, 0.36, -0.1);
    stripes.push(st);
  }
  const hood = new THREE.PlaneGeometry(0.42, 0.42);
  hood.rotateX(-Math.PI / 2 - 0.18); hood.translate(0, 0.725, 1.45);
  nums.push(hood);
  shared = {
    body: bodyG,
    heads: mergeGeos(heads),
    tails: mergeGeos(tails),
    exhausts: mergeGeos(exs),
    nums: mergeGeos(nums),
    stripes: mergeGeos(stripes),
    cabin: cabinGeometry(),
    trim: trimGeometry(),
    well: wellGeometry(),
    ...w,
    headGeo,
    tailGeo,
    exhaust,
    shadowGeo: new THREE.PlaneGeometry(2.5, 5.2).rotateX(-Math.PI / 2),
    mats: {
      glass: new THREE.MeshPhysicalMaterial({ color: 0x141c26, metalness: 0.1, roughness: 0.03, clearcoat: 1, envMapIntensity: 2.0 }),
      carbon: new THREE.MeshStandardMaterial({ color: 0x0e0e10, metalness: 0.4, roughness: 0.45 }),
      well: new THREE.MeshBasicMaterial({ color: 0x050505 }),
      tire: new THREE.MeshStandardMaterial({ color: 0x141414, metalness: 0, roughness: 0.92 }),
      rim: new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 1, roughness: 0.28 }),
      rimDark: new THREE.MeshStandardMaterial({ color: 0x2a2c30, metalness: 0.9, roughness: 0.35 }),
      disc: new THREE.MeshStandardMaterial({ color: 0x55585c, metalness: 0.9, roughness: 0.5, emissive: 0x000000 }),
      caliper: new THREE.MeshStandardMaterial({ color: 0xc8a000, metalness: 0.3, roughness: 0.4 }),
      head: new THREE.MeshStandardMaterial({ color: 0x9aa4ad, emissive: 0xfff3dd, emissiveIntensity: 0.7, roughness: 0.05, metalness: 0.5 }),
      exhaust: new THREE.MeshStandardMaterial({ color: 0x777777, metalness: 1, roughness: 0.3 }),
      stripe: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.2, polygonOffset: true, polygonOffsetFactor: -2 }),
      shadow: new THREE.MeshBasicMaterial({ map: radialTexture('rgba(0,0,0,0.85)', 'rgba(0,0,0,0)'), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }),
    },
  };
  shared.mats.shadow.map.center.set(0.5, 0.5);
  return shared;
}

// 車1台を構築
export function buildCar({ color = 0xd01020, num = 1, quality = 2, rimDark = false }) {
  const S = getShared(quality);
  const root = new THREE.Group();
  const body = new THREE.Group(); // ロール・ピッチ用
  root.add(body);
  const paint = quality >= 2
    ? new THREE.MeshPhysicalMaterial({ color, metalness: 0.55, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.2 })
    : new THREE.MeshStandardMaterial({ color, metalness: 0.5, roughness: 0.3, envMapIntensity: 1.2 });
  const bodyMesh = new THREE.Mesh(S.body, paint);
  bodyMesh.castShadow = true;
  body.add(bodyMesh);
  const cabin = new THREE.Mesh(S.cabin, [paint, S.mats.glass]);
  cabin.castShadow = true;
  body.add(cabin);
  body.add(new THREE.Mesh(S.well, S.mats.well));
  const trim = new THREE.Mesh(S.trim, S.mats.carbon);
  trim.castShadow = true;
  body.add(trim);
  // ゼッケン・ストライプ・ライト
  const numMat = new THREE.MeshStandardMaterial({ map: numberTexture(num), roughness: 0.4, transparent: true, polygonOffset: true, polygonOffsetFactor: -2 });
  body.add(new THREE.Mesh(S.nums, numMat));
  body.add(new THREE.Mesh(S.stripes, S.mats.stripe));
  const tailMat = new THREE.MeshStandardMaterial({ color: 0x400000, emissive: 0xff1010, emissiveIntensity: 0.6, roughness: 0.2 });
  body.add(new THREE.Mesh(S.heads, S.mats.head));
  body.add(new THREE.Mesh(S.tails, tailMat));
  body.add(new THREE.Mesh(S.exhausts, S.mats.exhaust));
  // ホイール
  const wheels = [];
  const rimMat = rimDark ? S.mats.rimDark : S.mats.rim;
  for (const [x, z, front] of [[0.82, FA, 1], [-0.82, FA, 1], [0.82, RA, 0], [-0.82, RA, 0]]) {
    const pivot = new THREE.Group();
    pivot.position.set(x, WR, z);
    const spin = new THREE.Group();
    const side = x > 0 ? 1 : -1;
    const tire = new THREE.Mesh(S.tire, S.mats.tire);
    tire.castShadow = true;
    const rim = new THREE.Mesh(S.rim, rimMat);
    rim.scale.x = side;
    const disc = new THREE.Mesh(S.disc, S.mats.disc);
    disc.scale.x = side;
    spin.add(tire, rim, disc);
    const cal = new THREE.Mesh(S.caliper, S.mats.caliper);
    cal.scale.x = side;
    pivot.add(spin, cal);
    root.add(pivot);
    wheels.push({ pivot, spin, front });
  }
  // 接地影
  const sh = new THREE.Mesh(S.shadowGeo, S.mats.shadow);
  sh.position.y = 0.03;
  sh.renderOrder = 1;
  root.add(sh);

  return {
    root,
    body,
    wheels,
    paint,
    tailMat,
    shadow: sh,
    setShadows(on) {
      bodyMesh.castShadow = on;
      cabin.castShadow = on;
      trim.castShadow = on;
      for (const w of wheels) w.spin.children[0].castShadow = on;
    },
    // 姿勢更新
    update(state, steerAngle) {
      root.position.set(state.x, state.y, state.z);
      root.rotation.set(-(state.slopePitch || 0), state.psi, 0, 'YXZ');
      body.rotation.x = -((state.pitch || 0) - (state.slopePitch || 0)) * 0.6;
      body.rotation.z = state.roll || 0;
      body.position.y = 0.02;
      for (const w of wheels) {
        w.spin.rotation.x = state.wheelRot || 0;
        if (w.front) w.pivot.rotation.y = steerAngle || 0;
      }
      const br = state.braking || 0;
      tailMat.emissiveIntensity = 0.6 + br * 3.5;
    },
  };
}
