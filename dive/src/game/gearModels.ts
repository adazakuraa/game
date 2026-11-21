import * as THREE from 'three';

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
