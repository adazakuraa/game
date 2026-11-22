import * as THREE from 'three';
import { lathe, strand, woodTexture, makeTexture } from './Sculpt';

/**
 * Camp food, sculpted in code. Vessels are lathed (revolved profiles with real wall thickness
 * and rolled rims), noodles are dozens of thin curly strands, toppings are small irregular
 * pieces, liquids are glossy surfaces whose level can drop as you eat.
 * Units: metres. Each model sits on y = 0, centred on the origin.
 */

export interface FoodModel {
  group: THREE.Group;
  /** 0 = untouched, 3 = finished (three bites/sips) */
  setBites(n: number): void;
  /** where the steam rises from (local), or null for no steam */
  steam: THREE.Vector3 | null;
  /** animated utensil, if any (chopsticks) */
  update?(t: number, lift: number): void;
}

function rnd(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

// ---------------------------------------------------------------- cup ramen
function cupPrint(): THREE.Texture {
  // u runs around the cup, v from bottom (0) to top (1). Generic design, no real brand.
  const t = makeTexture('cupPrint', 1024, (g, s) => {
    g.fillStyle = '#f7f4ee';
    g.fillRect(0, 0, s, s);
    // fine paper fibre
    const r = rnd(5);
    for (let i = 0; i < 4000; i++) { g.fillStyle = `rgba(0,0,0,${r() * 0.025})`; g.fillRect(r() * s, r() * s, 2, 2); }
    const y = (v: number) => s * (1 - v); // canvas y from texture v
    // red band with a subtle gradient
    const grd = g.createLinearGradient(0, y(0.66), 0, y(0.38));
    grd.addColorStop(0, '#e0402e'); grd.addColorStop(1, '#b62a1f');
    g.fillStyle = grd;
    g.fillRect(0, y(0.66), s, y(0.38) - y(0.66));
    g.fillStyle = '#f2c14a';
    g.fillRect(0, y(0.385), s, 6);
    g.fillRect(0, y(0.665), s, 6);
    // lettering, twice around the cup
    g.fillStyle = '#ffffff';
    g.font = `900 ${Math.round(s * 0.11)}px "Noto Sans JP", "Hiragino Sans", sans-serif`;
    g.textBaseline = 'middle';
    for (const x of [0.06, 0.56]) g.fillText('ラーメン', s * x, y(0.52));
    g.font = `700 ${Math.round(s * 0.035)}px sans-serif`;
    g.fillStyle = '#7a1d14';
    for (const x of [0.07, 0.57]) g.fillText('SHOYU  NOODLE  SOUP', s * x, y(0.3));
    // little illustrated bowl motif
    for (const x of [0.4, 0.9]) {
      g.fillStyle = '#3a2a1e';
      g.beginPath(); g.ellipse(s * x, y(0.8), s * 0.05, s * 0.03, 0, 0, Math.PI); g.fill();
      g.strokeStyle = '#e8b54a'; g.lineWidth = 4;
      for (let k = 0; k < 4; k++) { g.beginPath(); g.moveTo(s * (x - 0.03 + k * 0.02), y(0.8)); g.quadraticCurveTo(s * (x - 0.02 + k * 0.02), y(0.86), s * (x - 0.01 + k * 0.02), y(0.8)); g.stroke(); }
    }
    g.fillStyle = '#9a9a9a';
    g.font = `500 ${Math.round(s * 0.022)}px sans-serif`;
    g.fillText('お湯を注いで3分', s * 0.3, y(0.12));
  });
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

export function cupRamen(): FoodModel {
  const group = new THREE.Group();
  const H = 0.1;
  const rIn = (h: number) => 0.0405 + (0.0545 - 0.0405) * (h / H);
  // outer wall with the print, rolled rim, inner wall, bottom
  const outer = new THREE.Mesh(lathe([[0.042, 0.002], [0.044, 0.006], [0.0565, H - 0.002]], 64),
    new THREE.MeshStandardMaterial({ map: cupPrint(), roughness: 0.55 }));
  const inner = new THREE.Mesh(lathe([[0.0545, H], [0.0405, 0.008]], 64),
    new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.7, side: THREE.BackSide }));
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.0568, 0.0032, 10, 64), new THREE.MeshStandardMaterial({ color: 0xf7f4ee, roughness: 0.5 }));
  rim.rotation.x = Math.PI / 2;
  rim.position.y = H;
  const bottom = new THREE.Mesh(new THREE.CircleGeometry(0.042, 40), new THREE.MeshStandardMaterial({ color: 0xe9e5dc, roughness: 0.8 }));
  bottom.rotation.x = Math.PI / 2;
  bottom.position.y = 0.002;
  group.add(outer, inner, rim, bottom);

  // peeled-back lid: a thin disc hinged at the back, curling up
  const lidGeo = new THREE.CircleGeometry(0.06, 48);
  const lp = lidGeo.getAttribute('position');
  for (let i = 0; i < lp.count; i++) {
    const x = lp.getX(i), y = lp.getY(i);
    // behind the hinge the lid rolls back on itself like peeled paper
    const back = Math.max(0, -y - 0.012);
    const a = back / 0.03; // curl angle
    lp.setXYZ(i, x, back > 0 ? -0.012 - Math.sin(a) * 0.03 : y, back > 0 ? (1 - Math.cos(a)) * 0.03 : 0);
  }
  lidGeo.computeVertexNormals();
  const lidTop = new THREE.Mesh(lidGeo, new THREE.MeshStandardMaterial({ map: makeTexture('lidTop', 256, (g, s) => {
    g.fillStyle = '#f3efe6'; g.fillRect(0, 0, s, s);
    g.fillStyle = '#c8321f'; g.beginPath(); g.arc(s / 2, s / 2, s * 0.32, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff'; g.font = `900 ${s * 0.12}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('3 MIN', s / 2, s / 2);
  }), roughness: 0.45, side: THREE.FrontSide }));
  const lidUnder = new THREE.Mesh(lidGeo, new THREE.MeshStandardMaterial({ color: 0xd9dde2, metalness: 1, roughness: 0.32, side: THREE.BackSide }));
  for (const m of [lidTop, lidUnder]) { m.rotation.x = -Math.PI / 2; m.position.set(0, H + 0.003, -0.044); }
  group.add(lidTop, lidUnder);

  // broth surface (glossy, slightly oily)
  const broth = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshPhysicalMaterial({
    color: 0xb9792f, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.08, metalness: 0,
  }));
  broth.rotation.x = -Math.PI / 2;
  group.add(broth);
  // floating fat droplets
  const drop = new THREE.InstancedMesh(new THREE.CircleGeometry(1, 12), new THREE.MeshStandardMaterial({ color: 0xe6b25d, roughness: 0.05, transparent: true, opacity: 0.7 }), 22);
  const r = rnd(9);
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < 22; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 0.034, sc = 0.0015 + r() * 0.004;
    m4.compose(new THREE.Vector3(Math.cos(a) * d, Math.sin(a) * d, 0.0004), new THREE.Quaternion(), new THREE.Vector3(sc, sc, 1));
    drop.setMatrixAt(i, m4);
  }
  broth.add(drop);

  // noodles: curly strands lying in the broth
  const noodleMat = new THREE.MeshPhysicalMaterial({ color: 0xedd38a, roughness: 0.38, clearcoat: 0.6, clearcoatRoughness: 0.3 });
  const noodles = new THREE.Group();
  for (let i = 0; i < 26; i++) {
    const pts: THREE.Vector3[] = [];
    let a = r() * Math.PI * 2, d = r() * 0.03;
    for (let k = 0; k < 9; k++) {
      a += (r() - 0.3) * 0.9;
      d = Math.min(0.04, Math.max(0.004, d + (r() - 0.5) * 0.012));
      pts.push(new THREE.Vector3(Math.cos(a) * d, (r() - 0.5) * 0.004 + Math.sin(k * 1.7) * 0.0015, Math.sin(a) * d));
    }
    noodles.add(new THREE.Mesh(strand(pts, () => 0.0021, 40, 6), noodleMat));
  }
  group.add(noodles);

  // toppings: green onion rings, egg flakes, little shrimp, meat dice
  const tops = new THREE.Group();
  const onion = new THREE.MeshStandardMaterial({ color: 0x5ea341, roughness: 0.5 });
  const egg = new THREE.MeshStandardMaterial({ color: 0xf2d04a, roughness: 0.7 });
  const shrimpM = new THREE.MeshStandardMaterial({ color: 0xf08a5d, roughness: 0.5 });
  const meat = new THREE.MeshStandardMaterial({ color: 0x8a5a33, roughness: 0.85 });
  for (let i = 0; i < 14; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 0.036;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    const kind = i % 4;
    let o: THREE.Mesh;
    if (kind === 0) { o = new THREE.Mesh(new THREE.TorusGeometry(0.0035, 0.0012, 6, 12), onion); o.rotation.x = Math.PI / 2 + (r() - 0.5); }
    else if (kind === 1) { o = new THREE.Mesh(new THREE.IcosahedronGeometry(0.004, 1), egg); o.scale.set(1.3, 0.5, 1); }
    else if (kind === 2) {
      const sp = [0, 1, 2, 3].map((k) => new THREE.Vector3(Math.cos(k * 0.9) * 0.005, 0, Math.sin(k * 0.9) * 0.005));
      o = new THREE.Mesh(strand(sp, (t) => 0.0022 * (1 - t * 0.6), 12, 6), shrimpM);
    } else { o = new THREE.Mesh(new THREE.IcosahedronGeometry(0.0035, 0), meat); o.scale.set(1, 0.7, 1.1); }
    o.position.set(x, 0.003, z);
    o.rotation.y = r() * 6;
    tops.add(o);
  }
  group.add(tops);

  // chopsticks + the lifted bundle of noodles
  const stickMat = new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.6 });
  const sticks = new THREE.Group();
  for (const k of [0, 1]) {
    const s = new THREE.Mesh(strand([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0.21, 0)], (t) => 0.0024 + t * 0.0022, 8, 8), stickMat);
    s.position.set(k * 0.008, 0, k * 0.004);
    s.rotation.z = (k - 0.5) * 0.05;
    sticks.add(s);
  }
  const bundle = new THREE.Group();
  for (let i = 0; i < 7; i++) {
    const dx = (r() - 0.5) * 0.012, dz = (r() - 0.5) * 0.012;
    const pts = [0, 1, 2, 3, 4, 5].map((k) => new THREE.Vector3(dx * (1 + k * 0.3) + Math.sin(k * 1.3 + i) * 0.003, -k * 0.016, dz + Math.cos(k * 1.1 + i) * 0.003));
    bundle.add(new THREE.Mesh(strand(pts, () => 0.0021, 24, 6), noodleMat));
  }
  bundle.position.set(0.004, 0.006, 0.002);
  sticks.add(bundle);
  // held at an angle over the cup
  sticks.rotation.set(0.15, 0.4, 0.62);
  group.add(sticks);

  let bites = 0;
  const setBites = (n: number) => {
    bites = n;
    const h = 0.072 - n * 0.016;
    const rr = rIn(h);
    broth.position.y = h;
    broth.scale.setScalar(rr);
    noodles.position.y = h + 0.002;
    noodles.scale.setScalar(Math.max(0.25, 1 - n * 0.22));
    noodles.children.forEach((c, i) => { c.visible = i < 26 - n * 7; });
    tops.position.y = h + 0.0015;
    tops.children.forEach((c, i) => { c.visible = i < 14 - n * 4; });
  };
  setBites(0);
  return {
    group,
    setBites,
    steam: new THREE.Vector3(0, H, 0),
    update: (_t, lift) => {
      // chopsticks dip into the bowl and come up with a hanging bundle
      const base = 0.072 - bites * 0.016;
      // at rest: laid across the rim; while eating: dipped in, then raised with noodles hanging
      const rest = 1 - Math.min(1, lift * 3);
      sticks.rotation.set(THREE.MathUtils.lerp(0.15, 0.05, rest), THREE.MathUtils.lerp(0.4, 0.9, rest), THREE.MathUtils.lerp(0.62, Math.PI / 2 - 0.08, rest));
      sticks.position.set(THREE.MathUtils.lerp(-0.03 + lift * 0.02, 0.085, rest), THREE.MathUtils.lerp(base - 0.01 + lift * 0.11, H + 0.006, rest), THREE.MathUtils.lerp(lift * 0.03, -0.01, rest));
      bundle.visible = lift > 0.15;
      bundle.scale.y = 0.4 + lift * 0.9;
    },
  };
}

// ---------------------------------------------------------------- dal bhat
export function dalBhat(): FoodModel {
  const group = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0xd4d8dc, metalness: 1, roughness: 0.26 });
  // thali: wide plate with a raised rim
  group.add(new THREE.Mesh(lathe([[0, 0.002], [0.11, 0.002], [0.122, 0.012], [0.126, 0.018], [0.123, 0.019], [0.112, 0.008], [0.0, 0.007]], 64), steel));
  const r = rnd(31);
  // rice: a soft mound with grains
  const riceGeo = new THREE.SphereGeometry(0.05, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2);
  const rp = riceGeo.getAttribute('position');
  for (let i = 0; i < rp.count; i++) {
    const x = rp.getX(i), y = rp.getY(i), z = rp.getZ(i);
    const n = 1 + (Math.sin(x * 300) * Math.sin(z * 320) * Math.sin(y * 280)) * 0.03 + (r() - 0.5) * 0.04;
    rp.setXYZ(i, x * n, y * 0.62 * n, z * n);
  }
  riceGeo.computeVertexNormals();
  const riceTex = makeTexture('rice', 256, (g, s) => {
    g.fillStyle = '#f4f1e8'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 900; i++) {
      g.save(); g.translate(r() * s, r() * s); g.rotate(r() * 6);
      g.fillStyle = `rgba(${200 + r() * 40},${195 + r() * 40},${180 + r() * 40},0.8)`;
      g.beginPath(); g.ellipse(0, 0, 4, 1.6, 0, 0, Math.PI * 2); g.fill(); g.restore();
    }
  }, true, true);
  riceTex.repeat.set(3, 2);
  const rice = new THREE.Mesh(riceGeo, new THREE.MeshStandardMaterial({ map: riceTex, bumpMap: riceTex, bumpScale: 0.8, roughness: 0.62 }));
  rice.position.set(-0.035, 0.007, 0.02);
  group.add(rice);
  // katori bowls: dal (yellow lentil soup) and a vegetable curry
  const bowl = (x: number, z: number, soup: number, chunky: boolean) => {
    const b = new THREE.Group();
    b.add(new THREE.Mesh(lathe([[0, 0], [0.026, 0], [0.031, 0.008], [0.034, 0.026], [0.032, 0.027], [0.029, 0.009], [0.024, 0.003], [0, 0.003]], 40), steel));
    const s = new THREE.Mesh(new THREE.CircleGeometry(0.03, 32), new THREE.MeshPhysicalMaterial({ color: soup, roughness: 0.2, clearcoat: 0.8 }));
    s.rotation.x = -Math.PI / 2;
    s.position.y = 0.02;
    b.add(s);
    if (chunky) for (let i = 0; i < 6; i++) {
      const c = new THREE.Mesh(new THREE.IcosahedronGeometry(0.006, 1), new THREE.MeshStandardMaterial({ color: i % 2 ? 0xe6b86a : 0x5f8f3e, roughness: 0.6 }));
      c.position.set((r() - 0.5) * 0.03, 0.021, (r() - 0.5) * 0.03);
      b.add(c);
    }
    b.position.set(x, 0.007, z);
    group.add(b);
    return s;
  };
  const dal = bowl(0.055, -0.03, 0xd9a22a, false);
  bowl(0.05, 0.05, 0xb3592a, true);
  // saag (greens) and achar (pickle)
  const saag = new THREE.Mesh(new THREE.IcosahedronGeometry(0.022, 2), new THREE.MeshStandardMaterial({ color: 0x2f5a23, roughness: 0.8 }));
  saag.scale.set(1.2, 0.4, 1);
  saag.position.set(-0.04, 0.01, -0.065);
  const achar = new THREE.Mesh(new THREE.IcosahedronGeometry(0.012, 1), new THREE.MeshStandardMaterial({ color: 0xc23a1c, roughness: 0.4 }));
  achar.scale.set(1.2, 0.5, 1);
  achar.position.set(-0.085, 0.009, 0.035);
  group.add(saag, achar);
  return {
    group,
    steam: new THREE.Vector3(-0.03, 0.04, 0.02),
    setBites: (n) => {
      rice.scale.set(1 - n * 0.22, 1 - n * 0.25, 1 - n * 0.22);
      dal.position.y = 0.02 - n * 0.005;
      saag.visible = n < 3;
    },
  };
}

// ---------------------------------------------------------------- chocolate bar
export function chocoBar(): FoodModel {
  const group = new THREE.Group();
  const choc = new THREE.MeshPhysicalMaterial({ color: 0x4a2a17, roughness: 0.32, clearcoat: 0.4, clearcoatRoughness: 0.35 });
  // six beveled blocks (extruded rounded squares) on a thin base slab
  const blockShape = new THREE.Shape();
  const w = 0.017, rr = 0.003;
  blockShape.moveTo(-w + rr, -w); blockShape.lineTo(w - rr, -w); blockShape.quadraticCurveTo(w, -w, w, -w + rr);
  blockShape.lineTo(w, w - rr); blockShape.quadraticCurveTo(w, w, w - rr, w); blockShape.lineTo(-w + rr, w);
  blockShape.quadraticCurveTo(-w, w, -w, w - rr); blockShape.lineTo(-w, -w + rr); blockShape.quadraticCurveTo(-w, -w, -w + rr, -w);
  const blockGeo = new THREE.ExtrudeGeometry(blockShape, { depth: 0.006, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.0028, bevelSegments: 3, curveSegments: 6 });
  blockGeo.rotateX(-Math.PI / 2);
  const blocks: THREE.Mesh[] = [];
  for (let i = 0; i < 6; i++) {
    const b = new THREE.Mesh(blockGeo, choc);
    b.position.set(-0.05 + (i % 3) * 0.038, 0.006, i < 3 ? -0.019 : 0.019);
    group.add(b);
    blocks.push(b);
  }
  const slab = new THREE.Mesh(new THREE.BoxGeometry(0.116, 0.006, 0.078), choc);
  slab.position.set(-0.012, 0.003, 0);
  group.add(slab);
  // half-peeled wrapper: crinkled foil under a red paper sleeve
  const wrapGeo = new THREE.BoxGeometry(0.06, 0.03, 0.086, 18, 4, 18);
  const wp = wrapGeo.getAttribute('position');
  const r = rnd(41);
  for (let i = 0; i < wp.count; i++) wp.setXYZ(i, wp.getX(i) + (r() - 0.5) * 0.0015, wp.getY(i) + (r() - 0.5) * 0.0015, wp.getZ(i) + (r() - 0.5) * 0.0015);
  wrapGeo.computeVertexNormals();
  const sleeve = new THREE.Mesh(wrapGeo, new THREE.MeshStandardMaterial({ map: makeTexture('chocoWrap', 256, (g, s) => {
    g.fillStyle = '#b8312d'; g.fillRect(0, 0, s, s);
    g.fillStyle = '#f2c14a'; g.fillRect(0, s * 0.42, s, s * 0.16);
    g.fillStyle = '#fff'; g.font = `900 ${s * 0.13}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('ENERGY', s / 2, s * 0.25);
  }), roughness: 0.5 }));
  sleeve.position.set(0.042, 0.012, 0);
  group.add(sleeve);
  const foil = new THREE.Mesh(wrapGeo, new THREE.MeshStandardMaterial({ color: 0xcfd3d8, metalness: 1, roughness: 0.3 }));
  foil.scale.set(0.35, 0.95, 1.02);
  foil.position.set(0.005, 0.012, 0);
  group.add(foil);
  return {
    group,
    steam: null,
    setBites: (n) => {
      // bitten from the free end, two blocks at a time
      blocks.forEach((b, i) => { b.visible = (i % 3) >= n; });
      slab.scale.x = Math.max(0.05, 1 - n * 0.33);
      slab.position.x = -0.012 + n * 0.019;
    },
  };
}

// ---------------------------------------------------------------- enamel mug of milk tea
export function teaMug(): FoodModel {
  const group = new THREE.Group();
  const enamel = new THREE.MeshPhysicalMaterial({ color: 0xf3f1ec, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.08, map: makeTexture('enamel', 256, (g, s) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, s, s);
    // chips in the enamel near the rim, a blue rim band
    g.fillStyle = '#2c5aa8'; g.fillRect(0, 0, s, s * 0.05);
    const r = rnd(13);
    for (let i = 0; i < 9; i++) { g.fillStyle = '#2b2b30'; g.beginPath(); g.arc(r() * s, s * (0.05 + r() * 0.12), 2 + r() * 4, 0, Math.PI * 2); g.fill(); }
  }) });
  enamel.map!.wrapS = THREE.RepeatWrapping;
  // outer wall (uv v=1 at the rim → the blue band), inner wall, rolled rim, base
  const outer = new THREE.Mesh(lathe([[0.04, 0.0], [0.041, 0.004], [0.041, 0.085]], 48), enamel);
  const innerM = new THREE.MeshStandardMaterial({ color: 0xeeece6, roughness: 0.25, side: THREE.BackSide });
  const inner = new THREE.Mesh(lathe([[0.0385, 0.085], [0.0385, 0.006]], 48), innerM);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.0398, 0.0024, 8, 48), new THREE.MeshStandardMaterial({ color: 0x2c5aa8, roughness: 0.25 }));
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.085;
  const handle = new THREE.Mesh(strand([
    new THREE.Vector3(0.039, 0.07, 0), new THREE.Vector3(0.062, 0.068, 0), new THREE.Vector3(0.068, 0.045, 0),
    new THREE.Vector3(0.062, 0.022, 0), new THREE.Vector3(0.039, 0.02, 0),
  ], () => 0.0045, 24, 10), enamel);
  group.add(outer, inner, rim, handle);
  const tea = new THREE.Mesh(new THREE.CircleGeometry(0.0385, 40), new THREE.MeshPhysicalMaterial({ color: 0xc69568, roughness: 0.1, clearcoat: 1 }));
  tea.rotation.x = -Math.PI / 2;
  group.add(tea);
  // a skin of milk foam at the edge
  const foam = new THREE.Mesh(new THREE.RingGeometry(0.032, 0.0385, 40), new THREE.MeshStandardMaterial({ color: 0xe2c9a6, roughness: 0.6 }));
  foam.rotation.x = -Math.PI / 2;
  tea.add(foam);
  foam.rotation.x = 0;
  foam.position.z = 0.0003;
  const setBites = (n: number) => { tea.position.y = 0.074 - n * 0.02; tea.visible = n < 3; };
  setBites(0);
  return { group, setBites, steam: new THREE.Vector3(0, 0.085, 0) };
}
