// ロードバイクのステージ: ゴールアーチ、残り 1km の赤い三角旗（フラム・ルージュ）、沿道の観客
import * as THREE from 'three';
import { World } from './world.js';
import { RallyWorld } from './rallyworld.js';
import * as T from './textures.js';
import { SURFACE_KINDS } from '../sim/track.js';

function hash(n) { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }

export class BikeWorld extends World {
  // 石畳区間があるコースは路面ごとにテクスチャを分ける
  buildRoad() {
    const tr = this.track;
    if (!this.def.surfaces) return super.buildRoad();
    const N = tr.N;
    let a = 0;
    for (let i = 1; i <= N; i++) {
      if (i === N || tr.surfArr[i % N] !== tr.surfArr[a]) {
        this.roadRun(a, i, SURFACE_KINDS[tr.surfArr[a]]);
        a = i;
      }
    }
  }

  roadRun(a, b, kind) {
    const tr = this.track;
    const N = tr.N;
    const across = 6;
    const pos = [], uv = [], idx = [];
    for (let ii = a; ii <= b; ii++) {
      const i = ii % N;
      const lx = tr.tz[i], lz = -tr.tx[i];
      for (let k = 0; k <= across; k++) {
        const u = k / across;
        const d = tr.halfW * (1 - 2 * u);
        const crown = (1 - Math.abs(1 - 2 * u)) * 0.05;
        pos.push(tr.x[i] + lx * d, tr.y[i] + 0.02 + crown, tr.z[i] + lz * d);
        uv.push(u, (ii * tr.ds) / (kind === 'cobble' ? 8 : 30));
      }
    }
    for (let i = 0; i < b - a; i++) {
      for (let k = 0; k < across; k++) {
        const p = i * (across + 1) + k, q = p + 1, r = p + across + 1, s = r + 1;
        idx.push(p, q, r, q, s, r);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const tx = kind === 'cobble' ? T.surfaceTextures('cobble') : T.roadTextures(this.rain, this.def.scenery);
    const mat = new THREE.MeshStandardMaterial({
      map: tx.map, normalMap: tx.normal, roughnessMap: tx.rough, roughness: 1, metalness: 0,
      normalScale: new THREE.Vector2(kind === 'cobble' ? 1.2 : 0.5, kind === 'cobble' ? 1.2 : 0.5),
      envMapIntensity: this.rain ? 1.3 : 0.6,
    });
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true;
    this.scene.add(m);
    if (!this.roadGeo) { this.roadGeo = g; this.road = m; }
  }

  buildTireWalls() {}
  buildBoards() {}

  buildStartArea() {
    this.pitSide = 0;
    const tr = this.track;
    RallyWorld.prototype.arch.call(this, 0, 'FINISH', '#f5c400');
    if (tr.length > 1300) RallyWorld.prototype.arch.call(this, tr.length - 1000, '1 KM', '#d01818');
    this.buildCrowd();
  }

  // 沿道の観客: ゴール前は鈴なり、登りでは道の両側にびっしり
  buildCrowd() {
    const tr = this.track;
    const geo = RallyWorld.prototype.mergeSimple([
      new THREE.CapsuleGeometry(0.2, 0.7, 4, 8).translate(0, 0.75, 0),
      new THREE.SphereGeometry(0.14, 8, 6).translate(0, 1.5, 0),
    ]);
    const max = this.quality >= 2 ? 1400 : 800;
    const inst = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.9 }), max);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), v = new THREE.Vector3(), col = new THREE.Color();
    const palette = [0xffd000, 0xe53935, 0x1e88e5, 0xf5f5f5, 0x43a047, 0xff7043, 0x8e24aa, 0x212121, 0xffd000];
    let n = 0;
    const put = (i, side, k) => {
      if (n >= max) return;
      const w = (side > 0 ? tr.wallL[i] : tr.wallR[i]) + 0.7 + hash(k) * 2.4;
      const x = tr.x[i] + tr.tz[i] * w * side + (hash(k + 1) - 0.5) * 0.8;
      const z = tr.z[i] - tr.tx[i] * w * side + (hash(k + 2) - 0.5) * 0.8;
      const y = Math.max(tr.y[i], this.heightAt(x, z));
      const sc = 0.85 + hash(k + 3) * 0.3;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), tr.hd[i] + (side > 0 ? -1 : 1) * Math.PI / 2 + (hash(k + 4) - 0.5) * 0.8);
      m4.compose(v.set(x, y, z), q, s.set(sc, sc, sc));
      inst.setMatrixAt(n, m4);
      col.setHex(palette[Math.floor(hash(k + 5) * palette.length)]);
      inst.setColorAt(n, col);
      n++;
    };
    let k = 0;
    const step = Math.max(1, Math.round(1.6 / tr.ds));
    for (let i = 0; i < tr.N; i += step) {
      const sDist = i * tr.ds;
      const nearFinish = sDist > tr.length - 260 || sDist < 30;
      const climb = tr.slope[i] > 0.035;
      const dens = nearFinish ? 1 : climb ? 0.75 : 0.12;
      for (const side of [1, -1]) {
        if (hash(k * 7 + side) < dens) put(i, side, k * 13 + (side > 0 ? 0 : 5));
        if (nearFinish && hash(k * 3 + side) < 0.7) put(i, side, k * 17 + 999);
        k++;
      }
    }
    inst.count = n;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    inst.castShadow = true;
    this.scene.add(inst);
  }
}
