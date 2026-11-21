// ラリーステージの描画。ゴールまでの一本道だけを作り、路面ごとにテクスチャを切り替える
import * as THREE from 'three';
import { World } from './world.js';
import * as T from './textures.js';
import { SURFACE_KINDS } from '../sim/track.js';
import { paceNotes } from '../sim/rally.js';

function hash(n) { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }

export class RallyWorld extends World {
  // ゴールの先に 150m だけ道を作る（止まるための余白）
  get lastIndex() {
    const tr = this.track;
    return Math.min(tr.N, tr.stageN + Math.ceil(150 / tr.ds));
  }

  // ---------- 路面 ----------
  buildRoad() {
    const tr = this.track;
    const last = this.lastIndex;
    let a = 0;
    for (let i = 1; i <= last; i++) {
      if (i === last || tr.surfArr[i] !== tr.surfArr[a]) {
        this.roadRun(a, Math.min(i, last - 1), SURFACE_KINDS[tr.surfArr[a]]);
        a = i;
      }
    }
  }

  roadRun(a, b, kind) {
    const tr = this.track;
    const across = 6;
    const pos = [], uv = [], idx = [];
    for (let i = a; i <= b; i++) {
      const lx = tr.tz[i], lz = -tr.tx[i];
      for (let k = 0; k <= across; k++) {
        const u = k / across;
        const d = tr.halfW * (1 - 2 * u);
        const crown = (1 - Math.abs(1 - 2 * u)) * 0.04;
        pos.push(tr.x[i] + lx * d, tr.y[i] + 0.02 + crown, tr.z[i] + lz * d);
        uv.push(u, (i * tr.ds) / 30);
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
    const tx = kind === 'tarmac' ? T.roadTextures(false, 'country') : T.surfaceTextures(kind);
    const shiny = kind === 'ice';
    const mat = new THREE.MeshStandardMaterial({
      map: tx.map,
      normalMap: tx.normal,
      normalScale: new THREE.Vector2(kind === 'tarmac' ? 0.6 : 1, kind === 'tarmac' ? 0.6 : 1),
      roughnessMap: tx.rough,
      roughness: 1,
      metalness: 0,
      envMapIntensity: shiny ? 1.8 : 0.5,
    });
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true;
    this.scene.add(m);
    if (!this.road) { this.road = m; this.roadGeo = g; }
  }

  // ---------- 土手・わら束・観客 ----------
  buildWalls() {
    this.buildBanks();
    this.buildHay();
  }

  buildBanks() {
    const tr = this.track;
    const last = this.lastIndex;
    const kind = { alpine: 'snow', forest: 'forest', desert: 'sand' }[this.def.scenery] || 'grass';
    const gt = T.groundTextures(kind);
    const mat = new THREE.MeshStandardMaterial({ map: gt.map, normalMap: gt.normal, color: kind === 'snow' ? 0xf4f6fa : 0xcfc2a8, roughness: 0.95, envMapIntensity: 0.5 });
    const rows = [
      (w, hw) => [hw + 0.12, 0.03],
      (w, hw) => [hw + (w - hw) * 0.55, 0.16],
      (w) => [w, 0.75],
      (w) => [w + 1.5, 1.1],
      (w) => [w + 3.2, 0.45],
      (w) => [w + 5.5, -0.03],
    ];
    const R = rows.length;
    const pos = [], uv = [], idx = [];
    for (const side of [1, -1]) {
      const base = pos.length / 3;
      for (let i = 0; i < last; i++) {
        const lx = tr.tz[i], lz = -tr.tx[i];
        const w = side > 0 ? tr.wallL[i] : tr.wallR[i];
        for (let r = 0; r < R; r++) {
          const [d, dy] = rows[r](w, tr.halfW);
          const x = tr.x[i] + lx * d * side, z = tr.z[i] + lz * d * side;
          pos.push(x, tr.y[i] + dy, z);
          uv.push(x / 8, z / 8);
        }
      }
      for (let i = 0; i < last - 1; i++) {
        for (let r = 0; r < R - 1; r++) {
          const a = base + i * R + r, b = a + 1, c = a + R, d = c + 1;
          if (side > 0) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true;
    this.scene.add(m);
  }

  // きついコーナーの外側にわら束
  buildHay() {
    const tr = this.track;
    const geo = new THREE.BoxGeometry(1.5, 0.75, 0.8);
    geo.translate(0, 0.38, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0xd9b45a, roughness: 0.95 });
    const max = 360;
    const inst = new THREE.InstancedMesh(geo, mat, max);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3();
    const col = new THREE.Color();
    let n = 0;
    for (const nt of paceNotes(tr)) {
      if (nt.sev > 3 || n > max - 14) continue;
      const side = nt.dir === 'L' ? -1 : 1; // 外側
      const i0 = Math.floor(nt.s / tr.ds), i1 = Math.floor((nt.s + nt.len) / tr.ds);
      for (let i = i0; i <= i1 && n < max - 1; i += Math.max(1, Math.round(1.7 / tr.ds))) {
        const w = (side > 0 ? tr.wallL[i] : tr.wallR[i]) - 0.55;
        v.set(tr.x[i] + tr.tz[i] * w * side, tr.y[i] + 0.02, tr.z[i] - tr.tx[i] * w * side);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), tr.hd[i] + side * 0.0 + Math.PI / 2 * 0);
        m4.compose(v, q, s);
        inst.setMatrixAt(n, m4);
        col.setRGB(0.85 + hash(n) * 0.2, 0.7 + hash(n + 9) * 0.15, 0.33 + hash(n + 3) * 0.1);
        inst.setColorAt(n, col);
        n++;
      }
    }
    inst.count = n;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    inst.castShadow = true;
    this.scene.add(inst);
  }

  // 観客（スタート・ゴール付近と、コーナーの外側）
  buildSpectators() {
    const tr = this.track;
    const body = new THREE.CapsuleGeometry(0.2, 0.7, 4, 8);
    body.translate(0, 0.75, 0);
    const head = new THREE.SphereGeometry(0.14, 8, 6);
    head.translate(0, 1.5, 0);
    const geo = this.mergeSimple([body, head]);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.9 });
    const max = 520;
    const inst = new THREE.InstancedMesh(geo, mat, max);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), v = new THREE.Vector3(), col = new THREE.Color();
    const palette = [0xe53935, 0xffc107, 0x1e88e5, 0xff7043, 0xf5f5f5, 0x43a047, 0x8e24aa, 0x212121];
    let n = 0;
    const put = (i, side, off, k) => {
      if (n >= max) return;
      const w = (side > 0 ? tr.wallL[i] : tr.wallR[i]) + off;
      const x = tr.x[i] + tr.tz[i] * w * side + (hash(k) - 0.5) * 1.6;
      const z = tr.z[i] - tr.tx[i] * w * side + (hash(k + 5) - 0.5) * 1.6;
      const y = this.heightAt(x, z) + (off < 3.5 ? 0.9 : 0.35);
      const sc = 0.85 + hash(k + 11) * 0.3;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), tr.hd[i] + (side > 0 ? -1 : 1) * Math.PI / 2 + (hash(k + 2) - 0.5) * 0.6);
      m4.compose(v.set(x, y, z), q, s.set(sc, sc, sc));
      inst.setMatrixAt(n, m4);
      col.setHex(palette[Math.floor(hash(k + 17) * palette.length)]);
      inst.setColorAt(n, col);
      n++;
    };
    // スタートとゴール
    const iS = Math.round(14 / tr.ds), iF = tr.stageN;
    for (let j = 0; j < 46; j++) {
      put(iS + Math.floor(j / 2) * 2 - 12, j % 2 ? 1 : -1, 2.6 + hash(j) * 3, 100 + j);
      put(iF + Math.floor(j / 2) * 2 - 18, j % 2 ? 1 : -1, 2.6 + hash(j + 3) * 3, 200 + j);
    }
    // コーナー
    let kk = 300;
    for (const nt of paceNotes(tr)) {
      if (nt.sev > 4 || nt.s < 60 || n > max - 14) continue;
      const side = nt.dir === 'L' ? -1 : 1;
      const i = Math.floor((nt.s + nt.len * 0.5) / tr.ds);
      for (let j = 0; j < 9; j++) put(i + j - 4, side, 2.8 + hash(kk) * 2.6, kk++);
    }
    inst.count = n;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    inst.castShadow = true;
    this.scene.add(inst);
  }

  mergeSimple(geos) {
    const pos = [], nor = [], idx = [];
    let off = 0;
    for (const g of geos) {
      const p = g.attributes.position, n = g.attributes.normal;
      for (let i = 0; i < p.count; i++) { pos.push(p.getX(i), p.getY(i), p.getZ(i)); nor.push(n.getX(i), n.getY(i), n.getZ(i)); }
      if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(g.index.getX(i) + off);
      off += p.count;
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    out.setIndex(idx);
    return out;
  }

  // ---------- スタート・ゴールのゲート ----------
  buildStartArea() {
    this.pitSide = 0;
    const tr = this.track;
    this.buildSpectators(); // 地形ができた後でないと高さが分からない
    this.arch(14, 'START', '#1b6bd1');
    this.arch(tr.stageEnd, 'FINISH', '#d01818');
    // 道の終わりを示す赤白のポール（ゴール後の停止エリア）
    const metal = new THREE.MeshStandardMaterial({ color: 0xd22, roughness: 0.6 });
    const white = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.6 });
    for (let s = tr.stageEnd + 10; s < tr.stageEnd + 140; s += 14) {
      for (const side of [1, -1]) {
        const p = tr.pointAt(s, 0, {});
        const w = (side > 0 ? tr.wallL[p.i] : tr.wallR[p.i]) - 0.6;
        const q = tr.pointAt(s, side * w, {});
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.1, 0.1), Math.floor(s / 14) % 2 ? metal : white);
        post.position.set(q.x, q.y + 0.55, q.z);
        this.scene.add(post);
      }
    }
  }

  arch(s, text, color) {
    const tr = this.track;
    const p = tr.pointAt(s, 0, {});
    const span = Math.min(tr.wallL[p.i], tr.wallR[p.i]) + 0.3;
    const g = new THREE.Group();
    const metal = new THREE.MeshStandardMaterial({ color: 0x30343a, metalness: 0.7, roughness: 0.4 });
    for (const sx of [span, -span]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 7.2, 0.5), metal);
      post.position.set(sx, 3.6, 0);
      post.castShadow = true;
      g.add(post);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(span * 2 + 0.5, 1.8, 0.6), metal);
    beam.position.y = 6.6;
    beam.castShadow = true;
    g.add(beam);
    const ban = new THREE.Mesh(new THREE.PlaneGeometry(span * 2 - 0.4, 1.6), new THREE.MeshStandardMaterial({ map: T.bannerTextureText(text, color), roughness: 0.5 }));
    ban.position.set(0, 6.6, -0.32);
    ban.rotation.y = Math.PI;
    g.add(ban);
    const ban2 = ban.clone();
    ban2.position.z = 0.32;
    ban2.rotation.y = 0;
    g.add(ban2);
    g.position.set(p.x, p.y, p.z);
    g.rotation.y = p.hd;
    this.scene.add(g);
  }

  buildBoards() {}
  buildBillboards() {}

  // 道のすぐ外から急に地形が立ち上がる（深い森・山の中の道）
  terrainHeight(x, z, avgY, amp, i, dist) {
    const tr = this.track;
    const base = super.terrainHeight(x, z, avgY, amp, -1, 0);
    if (i < 0) return base;
    const lx = tr.tz[i], lz = -tr.tx[i];
    const d = (x - tr.x[i]) * lx + (z - tr.z[i]) * lz;
    const wall = d > 0 ? tr.wallL[i] : tr.wallR[i];
    const flat = tr.y[i] - 0.04;
    const t = Math.min(1, Math.max(0, (dist - wall - 2.5) / 55));
    const sm = t * t * (3 - 2 * t);
    return flat + (base - flat) * sm;
  }
}
