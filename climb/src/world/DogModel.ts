import * as THREE from 'three';
import { sweep, strand, paint, furTexture, furBump, type Section } from './Sculpt';

/**
 * A Himalayan street dog, sculpted in code (not stacked primitives):
 * - torso → neck → head → muzzle is ONE continuous swept surface (deep chest, tucked waist,
 *   neck ruff, defined stop, tapering muzzle) so there are no seams between "parts";
 * - legs are two-segment swept limbs on pivots (shoulder/hip → elbow/hock) so the gait bends;
 * - ears are curved thin shells, the tail is a tapered strand curled over the back (spitz-type);
 * - coat colour is painted per vertex (tan coat, dark saddle, cream chest/belly/muzzle/socks)
 *   and the fur grain is an independent texture + bump so highlights break like a coat.
 * Faces +X. About 0.5 m at the shoulder.
 */
export interface DogRig {
  root: THREE.Group;      // place / rotate this
  body: THREE.Group;      // pitch this for sitting/lying
  head: THREE.Group;      // pivot at the top of the neck
  tail: THREE.Group;      // pivot at the tail root
  tongue: THREE.Mesh;
  legs: { hip: THREE.Group; knee: THREE.Group; front: boolean; side: number }[];
}

const TAN = new THREE.Color(0.55, 0.36, 0.2);
const SADDLE = new THREE.Color(0.25, 0.16, 0.09);
const CREAM = new THREE.Color(0.85, 0.77, 0.64);
const MASK = new THREE.Color(0.42, 0.29, 0.19);

function hash(x: number, y: number, z: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

function coatMaterial(): THREE.MeshStandardMaterial {
  const map = furTexture().clone();
  map.needsUpdate = true;
  map.repeat.set(12, 5);
  const bump = furBump().clone();
  bump.needsUpdate = true;
  bump.repeat.set(16, 7);
  return new THREE.MeshStandardMaterial({ vertexColors: true, map, bumpMap: bump, bumpScale: 0.9, roughness: 0.93, metalness: 0 });
}

export function buildDog(): DogRig {
  const coat = coatMaterial();
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  // ---------------------------------------------------------------- torso + neck + head
  const V = (x: number, y: number) => new THREE.Vector3(x, y, 0);
  const torsoKeys: Section[] = [
    { p: V(-0.37, 0.47), w: 0.01, up: 0.01, down: 0.01 },
    { p: V(-0.33, 0.475), w: 0.09, up: 0.08, down: 0.09 },
    { p: V(-0.25, 0.48), w: 0.125, up: 0.1, down: 0.125 },  // haunch
    { p: V(-0.08, 0.49), w: 0.11, up: 0.092, down: 0.085 },  // tucked waist
    { p: V(0.08, 0.495), w: 0.128, up: 0.1, down: 0.15 },    // ribcage
    { p: V(0.21, 0.505), w: 0.125, up: 0.11, down: 0.15 },   // deep chest / shoulders
    { p: V(0.3, 0.57), w: 0.1, up: 0.095, down: 0.115 },     // neck ruff
    { p: V(0.365, 0.665), w: 0.075, up: 0.07, down: 0.075 }, // neck
    { p: V(0.4, 0.705), w: 0.05, up: 0.05, down: 0.05 },     // tucks into the head
    { p: V(0.415, 0.72), w: 0.005, up: 0.005, down: 0.005 },
  ];
  // head: its own sweep on the head pivot, overlapping the neck so turning it shows no seam
  const headKeys: Section[] = [
    { p: V(0.365, 0.725), w: 0.008, up: 0.008, down: 0.008 },
    { p: V(0.385, 0.727), w: 0.066, up: 0.062, down: 0.058 },
    { p: V(0.425, 0.725), w: 0.082, up: 0.078, down: 0.068 },// skull
    { p: V(0.49, 0.72), w: 0.066, up: 0.05, down: 0.058 },   // stop / eyes
    { p: V(0.545, 0.7), w: 0.045, up: 0.038, down: 0.04 },   // muzzle (short and blunt, not a fox)
    { p: V(0.582, 0.693), w: 0.03, up: 0.026, down: 0.027 },
    { p: V(0.6, 0.69), w: 0.006, up: 0.006, down: 0.006 },
  ];
  const coatPaint = (p: THREE.Vector3, n: THREE.Vector3) => {
    const j = hash(p.x * 40, p.y * 40, p.z * 40) * 0.08 - 0.04;
    const c = TAN.clone();
    // dark saddle over the back and the top of the neck
    const saddle = THREE.MathUtils.smoothstep(n.y, 0.35, 0.8) * (1 - THREE.MathUtils.smoothstep(p.x, 0.32, 0.4));
    c.lerp(SADDLE, saddle * 0.85);
    // cream chest, throat and belly
    const under = THREE.MathUtils.smoothstep(-n.y, 0.15, 0.6);
    const chest = THREE.MathUtils.smoothstep(p.x, 0.12, 0.26) * THREE.MathUtils.smoothstep(n.x, 0.1, 0.6) * (1 - THREE.MathUtils.smoothstep(p.y, 0.6, 0.7));
    c.lerp(CREAM, Math.max(under * 0.9, chest));
    // muzzle cream, darker mask on top of the muzzle and around the eyes
    if (p.x > 0.47) {
      c.lerp(CREAM, THREE.MathUtils.smoothstep(p.x, 0.5, 0.56) * (1 - THREE.MathUtils.smoothstep(n.y, 0.1, 0.7) * 0.6));
      c.lerp(MASK, THREE.MathUtils.smoothstep(n.y, 0.4, 0.9) * 0.6);
    }
    return c.offsetHSL(0, 0, j);
  };
  // a stockier build: fuller body (the legs are shortened by lowering the whole body)
  for (const k of torsoKeys) { k.w *= 1.12; k.up *= 1.08; k.down *= 1.1; }
  const torso = paint(sweep(torsoKeys, 64, 22), coatPaint);
  body.add(new THREE.Mesh(torso, coat));
  const headGeo = paint(sweep(headKeys, 40, 22), coatPaint).translate(-0.37, -0.67, 0);

  // ---------------------------------------------------------------- head details
  const head = new THREE.Group();
  head.position.set(0.37, 0.67, 0);
  head.scale.setScalar(1.14);
  body.add(head);
  head.add(new THREE.Mesh(headGeo, coat));
  const eyeMat = new THREE.MeshPhysicalMaterial({ color: 0x1a120c, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.05 });
  const noseMat = new THREE.MeshStandardMaterial({ color: 0x15110f, roughness: 0.38 });
  for (const z of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.0135, 12, 10), eyeMat);
    eye.position.set(0.488 - 0.37, 0.737 - 0.67, z * 0.043);
    head.add(eye);
    // brow spot (a classic marking on these dogs)
    const brow = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), new THREE.MeshStandardMaterial({ color: 0xd8c3a2, roughness: 0.9 }));
    brow.scale.set(1, 0.6, 1);
    brow.position.set(0.476 - 0.37, 0.762 - 0.67, z * 0.037);
    head.add(brow);
    // ears: curved, cupped thin shells, upright and a little splayed
    const ear = buildEar();
    ear.position.set(0.415 - 0.37, 0.785 - 0.67, z * 0.047);
    ear.rotation.set(z * 0.35, z * -0.35, 0.12);
    ear.scale.set(1.35, 1.35, 1.35 * z);
    head.add(ear);
  }
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.024, 14, 10), noseMat);
  nose.scale.set(0.8, 0.72, 1);
  nose.position.set(0.594 - 0.37, 0.703 - 0.67, 0);
  head.add(nose);
  const tongue = new THREE.Mesh(
    sweep([
      { p: new THREE.Vector3(0, 0, 0), w: 0.018, up: 0.004, down: 0.004 },
      { p: new THREE.Vector3(0.01, -0.03, 0), w: 0.02, up: 0.004, down: 0.004 },
      { p: new THREE.Vector3(0.005, -0.055, 0), w: 0.016, up: 0.004, down: 0.004 },
      { p: new THREE.Vector3(0, -0.06, 0), w: 0.002, up: 0.002, down: 0.002 },
    ], 10, 10),
    new THREE.MeshStandardMaterial({ color: 0xd96b7a, roughness: 0.35 }),
  );
  tongue.position.set(0.55 - 0.37, 0.668 - 0.67, 0);
  tongue.visible = false;
  head.add(tongue);

  // ---------------------------------------------------------------- legs
  const legs: DogRig['legs'] = [];
  const limb = (pts: [number, number][], r0: number, r1: number, sock: boolean) =>
    paint(strand(pts.map(([x, y]) => new THREE.Vector3(x, y, 0)), (t) => THREE.MathUtils.lerp(r0, r1, t), 10, 12), (p, n) => {
      // socks: cream just above the paw on the lower leg; tan everywhere else
      const k = sock ? THREE.MathUtils.smoothstep(-p.y, 0.1, 0.16) : 0;
      return TAN.clone().lerp(CREAM, k * 0.85).offsetHSL(0, 0, hash(p.x * 50, p.y * 50, n.z) * 0.06 - 0.03);
    });
  const pawGeo = paint(sweep([
    { p: new THREE.Vector3(-0.025, 0.012, 0), w: 0.004, up: 0.004, down: 0.004 },
    { p: new THREE.Vector3(-0.015, 0.016, 0), w: 0.03, up: 0.018, down: 0.014 },
    { p: new THREE.Vector3(0.02, 0.014, 0), w: 0.032, up: 0.016, down: 0.013 },
    { p: new THREE.Vector3(0.042, 0.01, 0), w: 0.004, up: 0.004, down: 0.004 },
  ], 12, 12), () => CREAM.clone());
  const addLeg = (front: boolean, side: number) => {
    const hip = new THREE.Group();
    hip.position.set(front ? 0.21 : -0.25, front ? 0.44 : 0.46, side * (front ? 0.078 : 0.088));
    const upper = front
      ? limb([[0, 0.04], [0.012, -0.08], [0.005, -0.18]], 0.062, 0.04, false)
      : limb([[0.0, 0.09], [0.03, -0.03], [0.0, -0.11], [-0.02, -0.17]], 0.085, 0.042, false); // thigh, rooted inside the haunch
    hip.add(new THREE.Mesh(upper, coat));
    const knee = new THREE.Group();
    knee.position.set(front ? 0.005 : -0.02, front ? -0.18 : -0.17, 0);
    hip.add(knee);
    const lower = front
      ? limb([[0, 0.03], [0.004, -0.09], [0.01, -0.19]], 0.04, 0.03, true)
      : limb([[0, 0.03], [0.02, -0.1], [0.03, -0.215]], 0.042, 0.03, true);
    knee.add(new THREE.Mesh(lower, coat));
    // joint volumes so elbow/hock and shoulder/hip read as one continuous limb
    const joint = (r: number) => new THREE.Mesh(paint(new THREE.SphereGeometry(r, 14, 10), () => TAN.clone()), coat);
    knee.add(joint(front ? 0.041 : 0.044));
    const top = joint(front ? 0.058 : 0.072);
    top.scale.set(1.1, 1.2, 0.6);
    top.position.set(0, front ? 0.03 : 0.05, -side * 0.025);
    hip.add(top);
    const paw = new THREE.Mesh(pawGeo, coat);
    paw.scale.setScalar(1.15);
    paw.position.set(front ? 0.01 : 0.03, front ? -0.205 : -0.232, 0);
    knee.add(paw);
    body.add(hip);
    legs.push({ hip, knee, front, side });
  };
  addLeg(true, 1); addLeg(true, -1); addLeg(false, 1); addLeg(false, -1);

  // ---------------------------------------------------------------- tail
  const tail = new THREE.Group();
  tail.position.set(-0.335, 0.53, 0);
  const tailGeo = paint(strand([
    new THREE.Vector3(0, 0, 0), new THREE.Vector3(-0.07, 0.07, 0), new THREE.Vector3(-0.06, 0.18, 0),
    new THREE.Vector3(0.02, 0.24, 0.02), new THREE.Vector3(0.1, 0.2, 0.05), new THREE.Vector3(0.12, 0.13, 0.06),
  ], (t) => 0.028 + Math.sin(Math.PI * Math.min(1, t * 1.25)) * 0.034 - t * 0.012, 34, 14), (_p, n, uv) => {
    // plume: darker on top, cream tip and underside
    const c = TAN.clone().lerp(SADDLE, THREE.MathUtils.smoothstep(n.y, 0.2, 0.9) * 0.6);
    return c.lerp(CREAM, Math.max(THREE.MathUtils.smoothstep(uv.x, 0.82, 0.98), THREE.MathUtils.smoothstep(-n.y, 0.4, 0.9) * 0.6));
  });
  tail.add(new THREE.Mesh(tailGeo, coat));
  body.add(tail);

  root.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return { root, body, head, tail, tongue, legs };
}

function buildEar(): THREE.Group {
  const g = new THREE.Group();
  const shape = (w: number, h: number) => {
    const s = new THREE.Shape();
    s.moveTo(-w, 0);
    s.quadraticCurveTo(-w * 0.75, h * 0.6, 0, h);
    s.quadraticCurveTo(w * 0.75, h * 0.6, w, 0);
    s.quadraticCurveTo(0, -h * 0.08, -w, 0);
    return s;
  };
  const cup = (geo: THREE.BufferGeometry, depth: number) => {
    // cup the shell: bend it around its vertical axis (a thin shell conforming to a curve)
    const p = geo.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      p.setZ(i, depth * (1 - Math.pow(x / 0.04, 2)));
    }
    geo.computeVertexNormals();
    return geo;
  };
  const outer = new THREE.Mesh(cup(new THREE.ShapeGeometry(shape(0.04, 0.085), 8), 0.012),
    new THREE.MeshStandardMaterial({ color: 0x4a3221, roughness: 0.9, side: THREE.DoubleSide }));
  const inner = new THREE.Mesh(cup(new THREE.ShapeGeometry(shape(0.028, 0.065), 8), 0.009),
    new THREE.MeshStandardMaterial({ color: 0xc99a8e, roughness: 0.8, side: THREE.DoubleSide }));
  inner.position.set(0, 0.006, 0.004);
  // ears face forward (+X): the shapes are in the XY plane, turn them
  outer.rotation.y = -Math.PI / 2;
  inner.rotation.y = -Math.PI / 2;
  inner.position.x = 0.004;
  g.add(outer, inner);
  return g;
}

/**
 * Pose the rig. walk: 0..1 gait amount; phase: gait phase; sit/lie: 0..1 blends.
 */
export function poseDog(r: DogRig, phase: number, walk: number, sit: number, lie = 0): void {
  for (const l of r.legs) {
    const ph = phase + (l.front ? 0 : Math.PI) + (l.side > 0 ? 0 : Math.PI * 0.5);
    const s = Math.sin(ph) * walk;
    if (l.front) {
      l.hip.rotation.z = s * 0.45 - sit * 0.35 + lie * 1.05;
      l.knee.rotation.z = Math.max(0, -Math.cos(ph)) * walk * 0.7 + lie * 0.45;
    } else {
      l.hip.rotation.z = s * 0.5 + sit * 1.35 + lie * -1.1;
      l.knee.rotation.z = -Math.max(0, Math.cos(ph)) * walk * 0.55 - sit * 1.9 - lie * 0.4;
    }
  }
  // sitting: rear down, chest up; lying: whole body lowered, flat
  r.body.rotation.z = sit * 0.42;
  // the body sits 4 cm lower than it is modelled: shorter legs, a sturdier dog
  r.body.position.set(sit * -0.04, -0.04 - sit * 0.13 - lie * 0.29 + Math.abs(Math.sin(phase)) * 0.02 * walk, 0);
}
