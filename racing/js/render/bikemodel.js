// ロードバイクと選手の手続き的モデル。ペダルの回転に合わせて脚を動かす（2関節の IK）
import * as THREE from 'three';
import { mergeGeos } from './carmodel.js';
import { numberTexture } from './textures.js';

const UP = new THREE.Vector3(0, 1, 0);
const tmpV = new THREE.Vector3();

// p1 → p2 をつなぐ円柱
function tube(p1, p2, r) {
  const a = new THREE.Vector3(...p1), b = new THREE.Vector3(...p2);
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(r, r, len, 8);
  const q = new THREE.Quaternion().setFromUnitVectors(UP, b.clone().sub(a).normalize());
  g.applyQuaternion(q);
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g;
}

const WR = 0.34; // ホイール半径
const RA = [0, WR, -0.5], FA = [0, WR, 0.5];
const BB = [0, 0.29, -0.06];

let shared = null;
function getShared() {
  if (shared) return shared;
  const S = [0, 0.86, -0.2], H = [0, 0.82, 0.37], Hb = [0, 0.66, 0.41];
  const frameParts = [
    tube(S, BB, 0.018), tube(BB, RA, 0.012), tube(S, RA, 0.01), tube(S, H, 0.018), tube(BB, Hb, 0.022), tube(Hb, H, 0.02),
    tube(Hb, FA, 0.012),
  ];
  // ハンドル（ドロップハンドル）
  frameParts.push(tube([0, 0.84, 0.38], [0, 0.86, 0.47], 0.012));
  frameParts.push(tube([-0.2, 0.86, 0.47], [0.2, 0.86, 0.47], 0.012));
  for (const s of [1, -1]) {
    frameParts.push(tube([s * 0.2, 0.86, 0.47], [s * 0.2, 0.78, 0.55], 0.011));
    frameParts.push(tube([s * 0.2, 0.78, 0.55], [s * 0.2, 0.72, 0.48], 0.011));
  }
  const frame = mergeGeos(frameParts);
  const saddle = new THREE.BoxGeometry(0.1, 0.04, 0.26);
  saddle.translate(0, 0.89, -0.22);
  // ホイール: タイヤ・リム・スポーク
  const tire = new THREE.TorusGeometry(WR - 0.012, 0.014, 8, 40);
  tire.rotateY(Math.PI / 2);
  const rimParts = [];
  const rim = new THREE.TorusGeometry(WR - 0.035, 0.012, 6, 40);
  rim.rotateY(Math.PI / 2);
  rimParts.push(rim);
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    rimParts.push(tube([0, 0, 0], [0, Math.cos(a) * (WR - 0.04), Math.sin(a) * (WR - 0.04)], 0.0025));
  }
  const hub = new THREE.CylinderGeometry(0.03, 0.03, 0.1, 10);
  hub.rotateZ(Math.PI / 2);
  rimParts.push(hub);
  const wheel = mergeGeos(rimParts);
  // クランク（左右）とチェーンリング
  const ring = new THREE.TorusGeometry(0.1, 0.008, 6, 24);
  ring.rotateY(Math.PI / 2);
  ring.translate(0.05, 0, 0);
  const crankArm = mergeGeos([tube([0.06, 0, 0], [0.06, -0.17, 0], 0.012), tube([-0.06, 0, 0], [-0.06, 0.17, 0], 0.012)]);
  // 選手
  const torso = new THREE.CapsuleGeometry(0.15, 0.36, 4, 10);
  const head = new THREE.SphereGeometry(0.11, 14, 10);
  const helmet = new THREE.SphereGeometry(0.125, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55);
  helmet.scale(1, 1, 1.35);
  const limb = new THREE.CapsuleGeometry(0.055, 1, 4, 8); // 長さ 1 を基準に伸縮
  limb.translate(0, 0.5, 0);
  const upperArm = new THREE.CapsuleGeometry(0.045, 1, 4, 8);
  upperArm.translate(0, 0.5, 0);
  shared = {
    frame, saddle, tire, wheel, ring, crankArm, torso, head, helmet, limb, upperArm,
    mats: {
      tire: new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.85 }),
      rim: new THREE.MeshStandardMaterial({ color: 0x1a1a1e, metalness: 0.7, roughness: 0.3 }),
      metal: new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 1, roughness: 0.3 }),
      black: new THREE.MeshStandardMaterial({ color: 0x111114, roughness: 0.6 }),
      skin: new THREE.MeshStandardMaterial({ color: 0xc89a78, roughness: 0.8 }),
      shorts: new THREE.MeshStandardMaterial({ color: 0x15151a, roughness: 0.7 }),
    },
    shadowGeo: new THREE.PlaneGeometry(0.9, 1.9).rotateX(-Math.PI / 2),
  };
  return shared;
}

// 2 関節の IK: 腰 hip から足先 foot へ、膝は前方に出る
function solveKnee(hip, foot, l1, l2, out) {
  const dx = foot.z - hip.z, dy = foot.y - hip.y;
  let d = Math.hypot(dx, dy);
  d = Math.min(d, l1 + l2 - 1e-3);
  const a = Math.acos(Math.max(-1, Math.min(1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d))));
  const base = Math.atan2(dy, dx);
  const ang = base + a; // 膝を前に
  out.set(hip.x, hip.y + Math.sin(ang) * l1, hip.z + Math.cos(ang) * l1);
  return out;
}

function place(mesh, a, b) {
  tmpV.copy(b).sub(a);
  const len = tmpV.length();
  mesh.position.copy(a);
  mesh.quaternion.setFromUnitVectors(UP, tmpV.normalize());
  mesh.scale.set(1, len, 1);
}

export function buildBike({ jersey = 0xd0101c, frameColor = 0xffffff, num = 1, quality = 2 }) {
  const S = getShared();
  const own = [];
  const root = new THREE.Group();
  const lean = new THREE.Group(); // 傾き用
  root.add(lean);
  const frameMat = quality >= 2
    ? new THREE.MeshPhysicalMaterial({ color: frameColor, metalness: 0.4, roughness: 0.25, clearcoat: 1 })
    : new THREE.MeshStandardMaterial({ color: frameColor, metalness: 0.4, roughness: 0.25 });
  const jerseyMat = new THREE.MeshStandardMaterial({ color: jersey, roughness: 0.65 });
  const helmetMat = new THREE.MeshStandardMaterial({ color: jersey, roughness: 0.3, metalness: 0.2 });
  own.push(frameMat, jerseyMat, helmetMat);
  const frame = new THREE.Mesh(S.frame, frameMat);
  frame.castShadow = true;
  lean.add(frame);
  lean.add(new THREE.Mesh(S.saddle, S.mats.black));
  const wheels = [];
  for (const p of [RA, FA]) {
    const g = new THREE.Group();
    g.position.set(...p);
    const t = new THREE.Mesh(S.tire, S.mats.tire);
    t.castShadow = true;
    g.add(t, new THREE.Mesh(S.wheel, S.mats.rim));
    lean.add(g);
    wheels.push(g);
  }
  const crank = new THREE.Group();
  crank.position.set(...BB);
  crank.add(new THREE.Mesh(S.ring, S.mats.metal), new THREE.Mesh(S.crankArm, S.mats.metal));
  lean.add(crank);
  // 選手（前傾）
  const torso = new THREE.Mesh(S.torso, jerseyMat);
  torso.castShadow = true;
  const hipC = new THREE.Vector3(0, 0.95, -0.2), sh = new THREE.Vector3(0, 1.24, 0.24);
  place(torso, hipC, sh);
  torso.scale.set(1, 1, 1);
  torso.position.copy(hipC).add(sh).multiplyScalar(0.5);
  lean.add(torso);
  const head = new THREE.Mesh(S.head, S.mats.skin);
  head.position.set(0, 1.36, 0.34);
  lean.add(head);
  const helmet = new THREE.Mesh(S.helmet, helmetMat);
  helmet.position.set(0, 1.38, 0.32);
  helmet.rotation.x = -0.35;
  helmet.castShadow = true;
  lean.add(helmet);
  // ゼッケン（背中）
  const numTex = numberTexture(num);
  const bib = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), new THREE.MeshStandardMaterial({ map: numTex, transparent: true }));
  own.push(bib.material, numTex);
  bib.position.set(0, 1.1, -0.06);
  bib.rotation.x = Math.PI + 0.95;
  lean.add(bib);
  // 腕
  for (const s of [1, -1]) {
    const arm = new THREE.Mesh(S.upperArm, jerseyMat);
    place(arm, new THREE.Vector3(s * 0.17, 1.22, 0.22), new THREE.Vector3(s * 0.2, 0.9, 0.48));
    lean.add(arm);
  }
  // 脚（毎フレーム IK）
  const legs = [];
  for (const s of [1, -1]) {
    const thigh = new THREE.Mesh(S.limb, S.mats.shorts);
    const shin = new THREE.Mesh(S.limb, S.mats.skin);
    thigh.castShadow = shin.castShadow = true;
    lean.add(thigh, shin);
    legs.push({ s, thigh, shin });
  }
  const hip = new THREE.Vector3(), foot = new THREE.Vector3(), knee = new THREE.Vector3();
  const sh2 = new THREE.Mesh(S.shadowGeo, new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
  own.push(sh2.material);
  sh2.position.y = 0.03;
  root.add(sh2);

  return {
    root,
    body: lean,
    wheels: [],
    jerseyMat,
    helmetMat,
    setJersey(c) { jerseyMat.color.setHex(c); helmetMat.color.setHex(c); },
    setShadows(on) { frame.castShadow = on; torso.castShadow = on; for (const l of legs) { l.thigh.castShadow = on; l.shin.castShadow = on; } },
    update(st) {
      root.position.set(st.x, st.y, st.z);
      root.rotation.set(-(st.slopePitch || 0), st.psi, 0, 'YXZ');
      lean.rotation.z = -(st.lean || 0);
      const crankA = st.crank || 0;
      crank.rotation.x = crankA;
      const spin = (st.dist || 0) / WR;
      for (const w of wheels) w.rotation.x = spin;
      for (const l of legs) {
        const a = crankA + (l.s > 0 ? 0 : Math.PI);
        hip.set(l.s * 0.1, 0.92, -0.2);
        foot.set(l.s * 0.1, BB[1] - Math.cos(a) * 0.17, BB[2] - Math.sin(a) * 0.17);
        solveKnee(hip, foot, 0.42, 0.42, knee);
        place(l.thigh, hip, knee);
        place(l.shin, knee, foot);
      }
    },
    dispose() { for (const o of own) o.dispose && o.dispose(); },
  };
}
