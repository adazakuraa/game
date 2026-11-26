import * as THREE from 'three';
import { mergeProp, propMaterial, type PropPart } from '../render/prop';

/**
 * First-person models of the spearfishing gear, built along -Z (pointing where the camera looks).
 * Hand spear: a Japanese 手銛 / pole spear — a long aluminium shaft, stainless three-prong paralyser
 * tip and a surgical-rubber loop at the back. Speargun: a band-powered wooden gun — teak barrel with
 * pistol grip and trigger guard, two rubber bands stretched to the notched steel shaft, a line reel.
 */
const steel = () => new THREE.MeshStandardMaterial({ color: 0xc8cdd2, metalness: 0.9, roughness: 0.28 });

export function buildHandSpear(): THREE.Group {
  const g = new THREE.Group();
  const alu = new THREE.MeshStandardMaterial({ color: 0x3a4a5a, metalness: 0.7, roughness: 0.35 });
  const L = 1.7;
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, L, 10).rotateX(Math.PI / 2), alu);
  shaft.position.z = -L / 2 + 0.25;
  g.add(shaft);
  // three-prong paralyser tip
  const st = steel();
  const tipZ = -L + 0.25;
  const ferrule = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.009, 0.06, 10).rotateX(Math.PI / 2), st);
  ferrule.position.z = tipZ - 0.02;
  g.add(ferrule);
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    const prong = new THREE.Mesh(new THREE.CylinderGeometry(0.0018, 0.003, 0.16, 6).rotateX(Math.PI / 2), st);
    prong.position.set(Math.cos(a) * 0.012, Math.sin(a) * 0.012, tipZ - 0.12);
    prong.rotation.set(Math.sin(a) * 0.08, -Math.cos(a) * 0.08, 0);
    g.add(prong);
    const barb = new THREE.Mesh(new THREE.ConeGeometry(0.004, 0.02, 5).rotateX(-Math.PI / 2), st);
    barb.position.set(Math.cos(a) * 0.02, Math.sin(a) * 0.02, tipZ - 0.2);
    g.add(barb);
  }
  // rubber loop at the rear (held stretched along the shaft by the hand)
  const rubber = new THREE.MeshStandardMaterial({ color: 0xc8b070, roughness: 0.6 });
  const loop = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.006, 6, 18), rubber);
  loop.scale.set(1, 1, 3.2);
  loop.rotation.y = Math.PI / 2;
  loop.position.set(0, 0, 0.18);
  g.add(loop);
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.14, 10).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 }));
  grip.position.z = 0.04;
  g.add(grip);
  return g;
}

export function buildSpeargun(): { gun: THREE.Group; shaft: THREE.Mesh } {
  const g = new THREE.Group();
  const teak = new THREE.MeshStandardMaterial({ color: 0x7a4a26, roughness: 0.55 });
  const black = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.7 });
  const L = 0.95;
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.05, L), teak);
  barrel.position.z = -L / 2 + 0.12;
  g.add(barrel);
  // pistol grip and trigger guard
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.12, 0.045), black);
  grip.position.set(0, -0.075, 0.09);
  grip.rotation.x = -0.25;
  g.add(grip);
  const guard = new THREE.Mesh(new THREE.TorusGeometry(0.025, 0.004, 6, 12, Math.PI), black);
  guard.position.set(0, -0.03, 0.03);
  guard.rotation.set(Math.PI, Math.PI / 2, 0);
  g.add(guard);
  const trigger = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.03, 0.008), steel());
  trigger.position.set(0, -0.04, 0.035);
  g.add(trigger);
  // muzzle
  const muzzle = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.05), black);
  muzzle.position.z = -L + 0.13;
  g.add(muzzle);
  // shaft on top of the barrel
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0035, 1.15, 8).rotateX(Math.PI / 2), steel());
  shaft.position.set(0, 0.031, -1.15 / 2 + 0.1);
  g.add(shaft);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.006, 0.04, 6).rotateX(-Math.PI / 2), steel());
  tip.position.set(0, 0, -1.15 / 2 - 0.02);
  shaft.add(tip);
  // two rubber bands from the muzzle back to the shaft notches
  const band = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.6 });
  for (const s of [-1, 1]) {
    const len = 0.55;
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, len, 8).rotateX(Math.PI / 2), band);
    b.position.set(s * 0.024, 0.02, -L + 0.13 + len / 2);
    b.rotation.y = s * 0.03;
    g.add(b);
  }
  // line reel under the barrel
  const reel = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.03, 16).rotateZ(Math.PI / 2), black);
  reel.position.set(0, -0.045, -0.12);
  g.add(reel);
  return { gun: g, shaft };
}

/** A short steel pry bar (バール) for prising urchins off the rock: flattened claw end, red grip. */
export function buildBar(): THREE.Group {
  const g = new THREE.Group();
  const st = new THREE.MeshStandardMaterial({ color: 0x5a6068, metalness: 0.85, roughness: 0.4 });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.42, 8).rotateX(Math.PI / 2), st);
  shaft.position.z = -0.18;
  g.add(shaft);
  const claw = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.006, 0.06), st);
  claw.position.set(0, -0.012, -0.41);
  claw.rotation.x = 0.5;
  g.add(claw);
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.12, 10).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xb02a20, roughness: 0.7 }));
  grip.position.z = 0.04;
  g.add(grip);
  return g;
}

/** A diver's knife (Phase 3: cutting the ghost net off a turtle): steel blade with a serrated back, black grip, guard. */
export function buildKnife(): THREE.Group {
  const g = new THREE.Group();
  const st = new THREE.MeshStandardMaterial({ color: 0xc8d0d8, metalness: 0.9, roughness: 0.25, emissive: 0x101418 });
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.026, 0.16), st);
  blade.position.z = -0.12;
  g.add(blade);
  const tip = new THREE.Mesh(new THREE.CylinderGeometry(0, 0.018, 0.04, 3).rotateX(-Math.PI / 2).scale(0.22, 1, 1), st);
  tip.position.set(0, -0.004, -0.218);
  g.add(tip);
  for (let i = 0; i < 6; i++) {
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.006, 0.006).rotateX(Math.PI / 4), st);
    t.position.set(0, 0.014, -0.07 - i * 0.016);
    g.add(t);
  }
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.05, 0.01), new THREE.MeshStandardMaterial({ color: 0x30343a, metalness: 0.6, roughness: 0.4 }));
  guard.position.z = -0.035;
  g.add(guard);
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.015, 0.1, 10).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.8 }));
  grip.position.z = 0.02;
  g.add(grip);
  return g;
}

/**
 * A treasure chest (dark wood, gold bands) as one mesh. The lid is a vertex range that setLid swings
 * about its hinge (rotation about x in radians: 0 closed, negative open).
 */
export function chestModel(): { mesh: THREE.Mesh; setLid: (angle: number) => void } {
  const wood = { color: 0x4a2e18, rough: 0.8, emissive: 0x120804 };
  const gold = { color: 0xe8b830, rough: 0.3, metal: 0.8, emissive: 0x3a2800 };
  const parts: PropPart[] = [{ geo: new THREE.BoxGeometry(0.7, 0.4, 0.45), ...wood }];
  for (const x of [-0.25, 0.25]) parts.push({ geo: new THREE.BoxGeometry(0.06, 0.66, 0.47).translate(x, 0.12, 0), ...gold });
  const lidStart = parts.reduce((n, p) => n + p.geo.attributes.position.count, 0);
  // the lid, in the hinge's frame
  const lid = new THREE.CylinderGeometry(0.225, 0.225, 0.7, 10, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).translate(0, 0, 0.225);
  const lidPos = Float32Array.from(lid.attributes.position.array);
  const lidNor = Float32Array.from(lid.attributes.normal.array);
  parts.push({ geo: lid, ...wood });
  const geo = mergeProp(parts);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const nor = geo.attributes.normal as THREE.BufferAttribute;
  const setLid = (angle: number) => {
    const c = Math.cos(angle), s = Math.sin(angle);
    for (let i = 0; i < lidPos.length / 3; i++) {
      const x = lidPos[i * 3], y = lidPos[i * 3 + 1], z = lidPos[i * 3 + 2];
      pos.setXYZ(lidStart + i, x, 0.2 + y * c - z * s, -0.225 + y * s + z * c);
      const nx = lidNor[i * 3], ny = lidNor[i * 3 + 1], nz = lidNor[i * 3 + 2];
      nor.setXYZ(lidStart + i, nx, ny * c - nz * s, ny * s + nz * c);
    }
    pos.needsUpdate = nor.needsUpdate = true;
  };
  setLid(0);
  // covers the lid at any angle
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.2, -0.1), 0.9);
  return { mesh: new THREE.Mesh(geo, propMaterial()), setLid };
}
