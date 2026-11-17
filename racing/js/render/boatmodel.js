// 競艇用のボート（モーターボート）の手続き的モデル
import * as THREE from 'three';
import { loft, mergeGeos, FINISH } from './carmodel.js';
import { numberTexture } from './textures.js';

const css = (n) => '#' + n.toString(16).padStart(6, '0');

let shared = null;
function getShared() {
  if (shared) return shared;
  // 船体: z が前後（+z が艇首）
  const st = [];
  for (let i = 0; i <= 26; i++) {
    const t = i / 26;
    const z = -1.55 + t * 3.1;
    const bow = Math.max(0, (z - 0.55) / 0.95); // 艇首の絞り込み
    const hw = (0.5 - 0.06 * Math.max(0, -z - 0.6)) * Math.sqrt(Math.max(0.01, 1 - bow * bow * 0.97));
    const deck = 0.3 + 0.08 * Math.pow(bow, 1.5) - 0.03 * Math.max(0, -z - 1.0);
    const keel = 0.04 + 0.1 * Math.pow(bow, 2);
    st.push({ z, hw: Math.max(0.03, hw), yb: keel, yt: deck, ym: keel + (deck - keel) * 0.55, n: 2.6, nb: 3.2 });
  }
  const hull = loft(st, 20);
  // カウル（操縦席の前のふくらみ）とウインドシールド
  const cowlSt = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    const z = 0.1 + t * 0.9;
    const k = Math.sin(Math.PI * Math.min(1, t * 1.05)) ** 0.6;
    cowlSt.push({ z, hw: 0.3 * (1 - t * 0.5) + 0.04, yb: 0.28, yt: 0.28 + 0.2 * (1 - t * 0.55) * k + 0.01, ym: 0.3, n: 2.4, nb: 6 });
  }
  const cowl = loft(cowlSt, 16);
  const shield = new THREE.PlaneGeometry(0.5, 0.26);
  shield.rotateX(-0.9);
  shield.translate(0, 0.52, 0.28);
  // エンジン（スターン）
  const engParts = [];
  const eng = new THREE.BoxGeometry(0.46, 0.4, 0.42);
  eng.translate(0, 0.5, -1.45);
  engParts.push(eng);
  const cowlE = new THREE.CylinderGeometry(0.2, 0.26, 0.3, 14);
  cowlE.translate(0, 0.78, -1.45);
  engParts.push(cowlE);
  const leg = new THREE.BoxGeometry(0.1, 0.5, 0.18);
  leg.translate(0, 0.14, -1.62);
  engParts.push(leg);
  const torp = new THREE.CylinderGeometry(0.08, 0.08, 0.34, 10);
  torp.rotateX(Math.PI / 2);
  torp.translate(0, -0.1, -1.72);
  engParts.push(torp);
  const engine = mergeGeos(engParts);
  const prop = new THREE.TorusGeometry(0.17, 0.02, 6, 14);
  prop.rotateY(Math.PI / 2);
  prop.translate(0, -0.1, -1.92);
  // サイドのフロート（スポンソン）
  const sp = [];
  for (const s of [1, -1]) {
    const f = new THREE.BoxGeometry(0.05, 0.1, 1.2);
    f.translate(s * 0.5, 0.12, -0.4);
    sp.push(f);
  }
  const sponsons = mergeGeos(sp);
  // 艇旗のポール
  const pole = new THREE.CylinderGeometry(0.012, 0.012, 0.9, 6);
  pole.translate(0, 1.05, -1.35);
  // ドライバー
  const torso = new THREE.CapsuleGeometry(0.17, 0.32, 4, 10);
  torso.rotateX(-0.45);
  torso.translate(0, 0.66, -0.35);
  const head = new THREE.SphereGeometry(0.14, 14, 10);
  head.translate(0, 0.98, -0.12);
  const visor = new THREE.SphereGeometry(0.145, 12, 8, -0.9, 1.8, 0.9, 1.0);
  visor.rotateY(0);
  visor.translate(0, 0.98, -0.1);
  const arms = [];
  for (const s of [1, -1]) {
    const a = new THREE.CapsuleGeometry(0.045, 0.34, 3, 6);
    a.rotateX(Math.PI / 2 - 0.35);
    a.translate(s * 0.17, 0.66, -0.02);
    arms.push(a);
  }
  const armsG = mergeGeos(arms);
  shared = {
    hull, cowl, shield, engine, prop, sponsons, pole, torso, head, visor, armsG,
    flagGeo: new THREE.PlaneGeometry(0.34, 0.24),
    shadowGeo: new THREE.PlaneGeometry(2.4, 4.6).rotateX(-Math.PI / 2),
    mats: {
      dark: new THREE.MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.5, metalness: 0.5 }),
      glass: new THREE.MeshPhysicalMaterial({ color: 0x223040, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.55, clearcoat: 1 }),
      metal: new THREE.MeshStandardMaterial({ color: 0xaaaaaa, metalness: 1, roughness: 0.3 }),
      helmetVisor: new THREE.MeshStandardMaterial({ color: 0x0a0c10, roughness: 0.1, metalness: 0.6 }),
    },
  };
  return shared;
}

// color: 船体の色。lane: 1〜6 号艇、laneColor: ウェアと旗の色
export function buildBoat({ color = 0xd0101c, lane = 1, laneColor = 0xffffff, quality = 2, finish = 'metallic', num }) {
  const S = getShared();
  const own = [];
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const F = FINISH[finish] || FINISH.metallic;
  const paint = quality >= 2
    ? new THREE.MeshPhysicalMaterial({ color, metalness: F.m, roughness: F.r, clearcoat: F.cc, clearcoatRoughness: F.ccr, envMapIntensity: F.env })
    : new THREE.MeshStandardMaterial({ color, metalness: F.m, roughness: F.r, envMapIntensity: F.env });
  own.push(paint);
  const hull = new THREE.Mesh(S.hull, paint);
  hull.castShadow = true;
  body.add(hull);
  const cowl = new THREE.Mesh(S.cowl, paint);
  body.add(cowl);
  body.add(new THREE.Mesh(S.shield, S.mats.glass));
  const eng = new THREE.Mesh(S.engine, S.mats.dark);
  eng.castShadow = true;
  body.add(eng);
  body.add(new THREE.Mesh(S.sponsons, S.mats.dark));
  // プロペラ
  const prop = new THREE.Mesh(S.prop, S.mats.metal);
  body.add(prop);
  // ウェア（号艇カラー）
  const suit = new THREE.MeshStandardMaterial({ color: laneColor, roughness: 0.7 });
  const helmet = new THREE.MeshStandardMaterial({ color: laneColor === 0x15151a ? 0x2a2a30 : laneColor, roughness: 0.3, metalness: 0.2 });
  own.push(suit, helmet);
  const torso = new THREE.Mesh(S.torso, suit);
  torso.castShadow = true;
  body.add(torso);
  body.add(new THREE.Mesh(S.armsG, suit));
  const head = new THREE.Mesh(S.head, helmet);
  head.castShadow = true;
  body.add(head);
  // 号艇番号と旗
  const numTex = numberTexture(num ?? lane);
  const numMat = new THREE.MeshStandardMaterial({ map: numTex, transparent: true, roughness: 0.4, polygonOffset: true, polygonOffsetFactor: -2 });
  own.push(numMat, numTex);
  for (const s of [1, -1]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3), numMat);
    p.position.set(s * 0.502, 0.2, 0.2);
    p.rotation.y = (s * Math.PI) / 2;
    body.add(p);
  }
  body.add(new THREE.Mesh(S.pole, S.mats.dark));
  const flagMat = new THREE.MeshStandardMaterial({ color: laneColor, roughness: 0.6, side: THREE.DoubleSide });
  own.push(flagMat);
  const flag = new THREE.Mesh(S.flagGeo, flagMat);
  flag.position.set(0, 1.4, -1.52);
  body.add(flag);
  // 号艇カラーのストライプ（船体の中央）
  const stripe = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 2.2), new THREE.MeshStandardMaterial({ color: laneColor, roughness: 0.4, polygonOffset: true, polygonOffsetFactor: -2 }));
  own.push(stripe.material);
  stripe.rotation.x = -Math.PI / 2 + 0.03;
  stripe.position.set(0, 0.36, 0.6);
  body.add(stripe);
  // 接地影はスプレーと波が代わりになるので省略
  return {
    root,
    body,
    wheels: [],
    paint,
    setShadows(on) { hull.castShadow = on; eng.castShadow = on; torso.castShadow = on; head.castShadow = on; },
    update(st, steer, t = 0) {
      // 艇は水面に浮かんでいる。うねりで上下・前後にゆれる
      const bob = Math.sin(t * 2.3 + lane) * 0.025 + Math.sin(t * 5.1 + lane * 2) * 0.012;
      root.position.set(st.x, (st.y || 0) + bob, st.z);
      root.rotation.set(0, st.psi, 0, 'YXZ');
      body.rotation.x = -(st.pitch || 0) + Math.sin(t * 1.9 + lane) * 0.01;
      body.rotation.z = (st.roll || 0) + Math.sin(t * 2.6 + lane * 3) * 0.012;
      prop.rotation.x = (st.wheelRot || 0) * 1.5;
      flag.rotation.y = Math.sin(t * 9 + lane) * 0.25;
    },
    dispose() { for (const o of own) o.dispose && o.dispose(); },
  };
}

void css;
