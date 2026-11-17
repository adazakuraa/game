// ボートレース（競艇）の水面・ブイ・スタンド・大時計
import * as THREE from 'three';
import { World } from './world.js';
import * as T from './textures.js';
import { mergeGeos } from './carmodel.js';

function hash(n) { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }

export class WaterWorld extends World {
  get lastIndex() { return this.track.N; }

  // ---------- 水面 ----------
  buildRoad() {
    const w = this.def.water || {};
    const nt = T.waterNormalTexture();
    nt.repeat.set(1800, 1800);
    this.waterN = nt;
    const mat = new THREE.MeshStandardMaterial({
      color: w.color ?? 0x0a2a3c,
      roughness: 0.16,
      metalness: 0.05,
      normalMap: nt,
      normalScale: new THREE.Vector2(0.4 * (w.wave ?? 0.5), 0.4 * (w.wave ?? 0.5)),
      envMapIntensity: this.night ? 0.7 : 1.3,
    });
    const geo = new THREE.PlaneGeometry(7000, 7000).rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(this.track.x[0], 0, this.track.z[0]);
    m.receiveShadow = true;
    this.scene.add(m);
    this.water = m;
    this.road = m;
    this.roadGeo = geo;
  }

  // 毎フレーム: 水面のゆらぎ
  tick(dt) {
    this.waterN.offset.x += dt * 0.0006;
    this.waterN.offset.y += dt * 0.0004;
    if (this.clockHand) {
      // 大時計の針: 0 秒が真上。残り時間に応じて動く
      this.clockHand.rotation.z = -(Math.max(0, this.clockRemain ?? 11) / 11) * Math.PI * 2;
    }
  }

  setClock(remain) { this.clockRemain = remain; }

  // ---------- 内側と外側のブイ・ロープ ----------
  buildWalls() {
    const tr = this.track;
    const N = tr.N;
    const buoyGeo = new THREE.SphereGeometry(0.32, 10, 8);
    buoyGeo.translate(0, 0.05, 0);
    const per = 6;
    const cnt = Math.ceil((N * tr.ds * 2) / per) + 4;
    const buoys = new THREE.InstancedMesh(buoyGeo, new THREE.MeshStandardMaterial({ roughness: 0.4 }), cnt);
    const m4 = new THREE.Matrix4(), col = new THREE.Color();
    let n = 0;
    const ropeC = { 1: [], '-1': [] };
    for (const side of [1, -1]) {
      for (let i = 0; i < N; i += Math.max(1, Math.round(per / tr.ds))) {
        const w = side > 0 ? tr.wallL[i] : tr.wallR[i];
        const x = tr.x[i] + tr.tz[i] * w * side, z = tr.z[i] - tr.tx[i] * w * side;
        m4.makeTranslation(x, 0, z);
        buoys.setMatrixAt(n, m4);
        col.setHex(((i / Math.max(1, Math.round(per / tr.ds))) | 0) % 2 ? 0xff7a1a : 0xf4f4f4);
        buoys.setColorAt(n, col);
        n++;
      }
      for (let i = 0; i <= N; i += 2) {
        const j = i % N;
        const w = side > 0 ? tr.wallL[j] : tr.wallR[j];
        ropeC[side].push(new THREE.Vector3(tr.x[j] + tr.tz[j] * w * side, 0.16, tr.z[j] - tr.tx[j] * w * side));
      }
    }
    buoys.count = n;
    if (buoys.instanceColor) buoys.instanceColor.needsUpdate = true;
    buoys.castShadow = true;
    this.scene.add(buoys);
    const ropeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 });
    for (const side of [1, -1]) {
      const curve = new THREE.CatmullRomCurve3(ropeC[side], true);
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.floor(N / 2), 0.04, 4, true), ropeMat);
      this.scene.add(tube);
    }
    this.buildMarks();
  }

  // ターンマーク: 折り返す 2 つの大きな円筒ブイ（コース内側）
  buildMarks() {
    const tr = this.track;
    const centers = { pos: [0, 0, 0], neg: [0, 0, 0] };
    for (let i = 0; i < tr.N; i++) {
      if (tr.kappa[i] < 1 / 120) continue;
      const R = 1 / tr.kappa[i];
      const cx = tr.x[i] + tr.tz[i] * R, cz = tr.z[i] - tr.tx[i] * R;
      const key = tr.x[i] > this.track.x[0] ? 'pos' : 'neg';
      centers[key][0] += cx; centers[key][1] += cz; centers[key][2]++;
    }
    const stripe = T.bannerTextureText('', '#ff7a1a', '#ffffff');
    this.marks = [];
    for (const [k, c] of Object.entries(centers)) {
      if (!c[2]) continue;
      const g = new THREE.Group();
      const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.62, 2.2, 16), new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.5, emissive: this.night ? 0x331100 : 0x000000 }));
      cyl.position.y = 1.1;
      cyl.castShadow = true;
      g.add(cyl);
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.505, 0.55, 0.35, 16), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 }));
      band.position.y = 1.0;
      g.add(band);
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.6, 6), new THREE.MeshStandardMaterial({ color: 0x333333 }));
      mast.position.y = 3.0;
      g.add(mast);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.45), new THREE.MeshStandardMaterial({ color: 0xffd000, side: THREE.DoubleSide }));
      flag.position.set(0.38, 3.5, 0);
      g.add(flag);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffaa33, emissiveIntensity: this.night ? 4 : 0.6 }));
      lamp.position.y = 2.35;
      g.add(lamp);
      g.position.set(c[0] / c[2], 0, c[1] / c[2]);
      this.scene.add(g);
      this.marks.push({ x: g.position.x, z: g.position.z, key: k });
    }
    void stripe;
  }

  // ---------- 岸・背景 ----------
  buildTerrain() {
    const tr = this.track;
    const N = tr.N;
    // 平均位置と大きさ
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    for (let i = 0; i < N; i++) {
      minX = Math.min(minX, tr.x[i]); maxX = Math.max(maxX, tr.x[i]);
      minZ = Math.min(minZ, tr.z[i]); maxZ = Math.max(maxZ, tr.z[i]);
    }
    this.center = new THREE.Vector3((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
    this.radius = Math.max(maxX - minX, maxZ - minZ) / 2 + 200;
    this.heightAt = () => 0.6;
    // 外側の護岸（コンクリート）と陸地
    const sc = this.def.scenery;
    const quay = T.concreteTexture(false);
    const landKind = { bay: 'city', river: 'grass', tide: 'mountain' }[sc] || 'grass';
    const gt = T.groundTextures(landKind);
    const rows = [
      [22, -0.4, 'q'], [23, 0.9, 'q'], [30, 1.0, 'q'], [32, 0.7, 'g'], [60, 0.8, 'g'], [260, 1.6, 'g'], [900, 4, 'g'],
    ];
    const buildStrip = (a, b, mat, uvScale) => {
      const pos = [], uv = [], idx = [];
      for (let i = 0; i <= N; i++) {
        const j = i % N;
        const w = tr.wallR[j];
        for (let r = a; r <= b; r++) {
          const [d, y] = rows[r];
          const x = tr.x[j] - tr.tz[j] * (w + d), z = tr.z[j] + tr.tx[j] * (w + d);
          pos.push(x, y, z);
          uv.push(x / uvScale, z / uvScale);
        }
      }
      const R = b - a + 1;
      for (let i = 0; i < N; i++) for (let r = 0; r < R - 1; r++) {
        const p = i * R + r, q = p + 1, s = p + R, t = s + 1;
        idx.push(p, s, q, q, s, t);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, mat);
      m.receiveShadow = true;
      this.scene.add(m);
    };
    buildStrip(0, 3, new THREE.MeshStandardMaterial({ map: quay, color: 0xc8c8c8, roughness: 0.85 }), 6);
    buildStrip(3, 6, new THREE.MeshStandardMaterial({ map: gt.map, normalMap: gt.normal, roughness: 0.95, color: landKind === 'city' ? 0x55595f : 0xffffff }), 9);
    // 遠景
    if (sc === 'tide') {
      const ring = new THREE.CylinderGeometry(1, 1, 1, 120, 4, true);
      const rp = ring.attributes.position;
      const R = this.radius + 1100;
      for (let k = 0; k < rp.count; k++) {
        const a = Math.atan2(rp.getZ(k), rp.getX(k));
        const tt = rp.getY(k) + 0.5;
        const hh = 80 + hash(Math.floor(a * 9)) * 220 + Math.sin(a * 3) * 60;
        rp.setXYZ(k, Math.cos(a) * R, -10 + tt * hh, Math.sin(a) * R);
      }
      ring.computeVertexNormals();
      const mtn = new THREE.Mesh(ring, new THREE.MeshStandardMaterial({ color: 0x3a3a44, roughness: 1, side: THREE.BackSide }));
      mtn.position.set(this.center.x, 0, this.center.z);
      this.scene.add(mtn);
    }
  }

  // ---------- スタンド・スタートライン・大時計 ----------
  buildStartArea() {
    const tr = this.track;
    this.pitSide = -1;
    if (this.night) {
      // ナイターの照明: 水面全体を照らす
      this.scene.add(new THREE.HemisphereLight(0x9aaacc, 0x1a2430, 1.3));
      const flood = new THREE.DirectionalLight(0xfff0d8, 1.6);
      flood.position.set(this.center.x - 200, 160, this.center.z + 300);
      flood.target.position.copy(this.center);
      this.scene.add(flood, flood.target);
    }
    // スタートライン（水面の白い帯）と両端のポール
    const p0 = tr.pointAt(0, 0, {});
    const line = new THREE.Mesh(new THREE.PlaneGeometry(1.0, tr.wallL[0] + tr.wallR[0]).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75, polygonOffset: true, polygonOffsetFactor: -2 }));
    const g0 = new THREE.Group();
    line.position.set(0, 0.03, (tr.wallL[0] - tr.wallR[0]) / 2);
    line.rotation.y = Math.PI / 2;
    g0.add(line);
    g0.position.set(p0.x, 0, p0.z);
    g0.rotation.y = p0.hd;
    // 平面の向き: 帯の長辺がコースの横幅方向になるように
    line.rotation.y = 0;
    line.geometry = new THREE.PlaneGeometry(tr.wallL[0] + tr.wallR[0], 1.0).rotateX(-Math.PI / 2);
    line.rotation.y = Math.PI / 2;
    this.scene.add(g0);
    for (const side of [1, -1]) {
      const w = side > 0 ? tr.wallL[0] : tr.wallR[0];
      const q = tr.pointAt(0, side * w, {});
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 5, 8), new THREE.MeshStandardMaterial({ color: 0xdddddd }));
      pole.position.set(q.x, 2.5, q.z);
      this.scene.add(pole);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.9), new THREE.MeshStandardMaterial({ map: T.checkerTexture(), side: THREE.DoubleSide }));
      flag.position.set(q.x, 4.4, q.z);
      flag.rotation.y = p0.hd + Math.PI / 2;
      this.scene.add(flag);
    }
    // スタンド: ホームストレッチの外側（スタートライン付近）
    const wt = T.windowTexture(this.night);
    const pitMat = new THREE.MeshStandardMaterial({ color: 0xdedede, roughness: 0.7 });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x223040, metalness: 0.3, roughness: 0.1, emissive: this.night ? 0xffe0b0 : 0x000000, emissiveIntensity: this.night ? 0.5 : 0 });
    const metal = new THREE.MeshStandardMaterial({ color: 0x30343a, metalness: 0.7, roughness: 0.4 });
    for (let k = -7; k <= 7; k++) {
      const s = k * 17;
      const p = tr.pointAt(s, 0, {});
      const off = tr.wallR[p.i] + 38;
      const q = tr.pointAt(s, -off, {});
      const blk = new THREE.Group();
      const base = new THREE.Mesh(new THREE.BoxGeometry(17, 7, 16), pitMat);
      base.position.y = 3.5 + 0.9;
      base.castShadow = true; base.receiveShadow = true;
      blk.add(base);
      const gl = new THREE.Mesh(new THREE.BoxGeometry(15.5, 1.8, 0.08), glassMat);
      gl.position.set(0, 5.4, 8.03);
      blk.add(gl);
      const seats = new THREE.Mesh(new THREE.PlaneGeometry(17, 9.5), new THREE.MeshStandardMaterial({ map: T.crowdTexture(), roughness: 0.9 }));
      seats.rotation.x = -0.62;
      seats.position.set(0, 11.2, -1.2);
      blk.add(seats);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(17.4, 0.3, 13), new THREE.MeshStandardMaterial({ color: 0xf2f2f2, metalness: 0.4, roughness: 0.5 }));
      roof.position.set(0, 17.2, -0.5);
      roof.rotation.x = 0.08;
      roof.castShadow = true;
      blk.add(roof);
      for (const sx of [-8, 8]) {
        const col = new THREE.Mesh(new THREE.BoxGeometry(0.3, 10, 0.3), metal);
        col.position.set(sx, 12.5, -6);
        blk.add(col);
      }
      blk.position.set(q.x, 0.9, q.z);
      blk.rotation.y = p.hd + Math.PI / 2; // 正面（+z）がコースを向く
      this.scene.add(blk);
    }
    void wt;
    // 大時計（スタンドの前に立つ塔）
    const cp = tr.pointAt(0, -(tr.wallR[0] + 26), {});
    const tower = new THREE.Group();
    const mast = new THREE.Mesh(new THREE.BoxGeometry(1.2, 14, 1.2), metal);
    mast.position.y = 7;
    tower.add(mast);
    const face = new THREE.Mesh(new THREE.CircleGeometry(3.4, 40), new THREE.MeshStandardMaterial({ map: T.clockFaceTexture(), roughness: 0.4, emissive: 0xffffff, emissiveMap: T.clockFaceTexture(), emissiveIntensity: this.night ? 0.6 : 0.15 }));
    face.position.set(0, 16.4, 0.65);
    tower.add(face);
    const back = new THREE.Mesh(new THREE.CylinderGeometry(3.55, 3.55, 0.5, 40), metal);
    back.rotation.x = Math.PI / 2;
    back.position.set(0, 16.4, 0.35);
    tower.add(back);
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.22, 2.9, 0.08), new THREE.MeshStandardMaterial({ color: 0xd01818, emissive: 0x400000 }));
    hand.geometry.translate(0, 1.2, 0);
    const pivot = new THREE.Group();
    pivot.position.set(0, 16.4, 0.72);
    pivot.add(hand);
    tower.add(pivot);
    this.clockHand = pivot;
    tower.position.set(cp.x, 0, cp.z);
    // 文字盤がコース側を向くように（+z が内側）
    tower.rotation.y = cp.hd + Math.PI / 2;
    this.scene.add(tower);
  }

  buildBoards() {}
  buildBillboards() {}

  // ---------- 背景 ----------
  buildScenery() {
    const sc = this.def.scenery;
    const tr = this.track;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), v = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
    // 外側かどうか（コースの右側 = 外側 に陸地がある）
    const outside = (x, z) => {
      const nr = tr.nearest(x, z, 600);
      if (!nr) return null;
      const i = nr.i;
      const d = (x - tr.x[i]) * tr.tz[i] + (z - tr.z[i]) * -tr.tx[i];
      return d < 0 && nr.dist > tr.wallR[i] + 46 ? nr.dist : null;
    };
    const place = (count, fn) => {
      let n = 0, tries = 0;
      const R = this.radius + 500;
      while (n < count && tries < count * 40) {
        tries++;
        const x = this.center.x + (hash(tries * 3) - 0.5) * 2 * R, z = this.center.z + (hash(tries * 3 + 1) - 0.5) * 2 * R;
        if (outside(x, z) == null) continue;
        fn(x, z, n);
        n++;
      }
    };
    if (sc === 'bay') {
      // 高層ビル群（夜景）
      const wt = T.windowTexture(this.night);
      const geo = new THREE.BoxGeometry(1, 1, 1);
      geo.translate(0, 0.5, 0);
      const mat = new THREE.MeshStandardMaterial({ map: wt.map, emissiveMap: wt.emissive, emissive: this.night ? 0xffffff : 0, emissiveIntensity: this.night ? 1.2 : 0, roughness: 0.55, metalness: 0.3 });
      mat.map.repeat.set(2, 3);
      wt.emissive.repeat.set(2, 3);
      const cnt = this.quality >= 2 ? 360 : 200;
      const inst = new THREE.InstancedMesh(geo, mat, cnt);
      let k = 0;
      place(cnt, (x, z, n) => {
        const nr = tr.nearest(x, z, 600);
        const near = nr && nr.dist < 160;
        const h = near ? 14 + hash(n) * 28 : 30 + hash(n + 7) * 120;
        q.setFromAxisAngle(up, hash(n + 3) * 6);
        m4.compose(v.set(x, 0, z), q, s.set(14 + hash(n + 1) * 20, h, 14 + hash(n + 2) * 20));
        inst.setMatrixAt(k, m4);
        const t = 0.55 + hash(n + 5) * 0.5;
        col.setRGB(t, t * 0.97, t * 1.02);
        inst.setColorAt(k, col);
        k++;
      });
      inst.count = k;
      inst.castShadow = true;
      this.scene.add(inst);
    } else if (sc === 'river') {
      const trunk = new THREE.CylinderGeometry(0.2, 0.3, 4, 6);
      trunk.translate(0, 2, 0);
      const parts = [];
      for (let kk = 0; kk < 4; kk++) {
        const c = new THREE.IcosahedronGeometry(1.9 - kk * 0.2, 1);
        c.translate(Math.cos(kk * 2.1), 5 + kk * 0.7, Math.sin(kk * 2.1));
        parts.push(c);
      }
      const leaves = mergeGeos(parts);
      const cnt = this.quality >= 2 ? 900 : 500;
      const tI = new THREE.InstancedMesh(trunk, new THREE.MeshStandardMaterial({ color: 0x4a3626 }), cnt);
      const lI = new THREE.InstancedMesh(leaves, new THREE.MeshStandardMaterial({ map: T.foliageTexture('leaf'), roughness: 0.9 }), cnt);
      let k = 0;
      place(cnt, (x, z, n) => {
        const sc2 = 0.9 + hash(n) * 1.3;
        q.setFromAxisAngle(up, hash(n + 2) * 6);
        m4.compose(v.set(x, 0.6, z), q, s.set(sc2, sc2 * (0.9 + hash(n + 1) * 0.4), sc2));
        tI.setMatrixAt(k, m4); lI.setMatrixAt(k, m4);
        col.setRGB(0.8 + hash(n + 4) * 0.4, 0.9 + hash(n + 5) * 0.2, 0.8 + hash(n + 6) * 0.3);
        lI.setColorAt(k, col);
        k++;
      });
      tI.count = lI.count = k;
      lI.castShadow = true;
      this.scene.add(tI, lI);
    } else {
      // 潮: 岩礁
      const rt = T.rockTexture();
      const geo = new THREE.IcosahedronGeometry(1, 2);
      const mat = new THREE.MeshStandardMaterial({ color: 0x777782, map: rt.map, normalMap: rt.normal, roughness: 0.95 });
      const cnt = 260;
      const inst = new THREE.InstancedMesh(geo, mat, cnt);
      let k = 0;
      place(cnt, (x, z, n) => {
        const sz = 1.5 + hash(n) * 6;
        q.setFromAxisAngle(up, hash(n + 1) * 6);
        m4.compose(v.set(x, 0.4, z), q, s.set(sz, sz * 0.7, sz));
        inst.setMatrixAt(k++, m4);
      });
      inst.count = k;
      inst.castShadow = true;
      this.scene.add(inst);
    }
  }

  // 夜: 岸の街灯
  buildStreetLights() {
    const tr = this.track;
    const poleGeo = new THREE.CylinderGeometry(0.1, 0.15, 9, 8);
    poleGeo.translate(0, 5, 0);
    const spacing = 40;
    const n = Math.floor(tr.length / spacing);
    const poles = new THREE.InstancedMesh(poleGeo, new THREE.MeshStandardMaterial({ color: 0x3a3e44, metalness: 0.7, roughness: 0.4 }), n);
    const glowMat = new THREE.SpriteMaterial({ map: T.radialTexture('rgba(255,220,160,0.9)', 'rgba(255,200,120,0)'), blending: THREE.AdditiveBlending, depthWrite: false });
    const m4 = new THREE.Matrix4();
    for (let k = 0; k < n; k++) {
      const p = tr.pointAt(k * spacing + 12, 0, {});
      const q = tr.pointAt(k * spacing + 12, -(tr.wallR[p.i] + 25), {});
      m4.makeTranslation(q.x, 1.0, q.z);
      poles.setMatrixAt(k, m4);
      const spr = new THREE.Sprite(glowMat);
      spr.position.set(q.x, 10.2, q.z);
      spr.scale.set(7, 7, 7);
      this.scene.add(spr);
    }
    this.scene.add(poles);
  }
}
