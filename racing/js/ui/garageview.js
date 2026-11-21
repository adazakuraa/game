// ガレージ画面: スタジオ風の 3D プレビューとパーツ選択 UI
import * as THREE from 'three';
import { buildCar } from '../render/carmodel.js';
import { radialTexture } from '../render/textures.js';
import { SLOTS, ITEMS, PART_SLOTS, PARTS, STATS, STAT_MAX, garage, resolveLook } from '../garage.js';

const $ = (s) => document.querySelector(s);

// カテゴリごとのカメラ位置。need: その構図で画面内に収めたい横幅(m)
const VIEWS = {
  front: { yaw: 0.72, pitch: 0.2, dist: 8.2, target: [0, 0.65, 0], need: 6.8 },
  top: { yaw: 0.5, pitch: 0.78, dist: 8.5, target: [0, 0.8, 0], need: 6.4 },
  wheel: { yaw: 1.3, pitch: 0.08, dist: 4.4, target: [0.5, 0.42, 1.0], need: 2.6 },
  rear: { yaw: 2.7, pitch: 0.2, dist: 6.4, target: [0, 0.85, -1.2], need: 3.4 },
  glow: { yaw: 0.95, pitch: 0.12, dist: 9, target: [0, 0.4, 0], need: 7.6 },
  smoke: { yaw: 2.8, pitch: 0.08, dist: 6, target: [0, 0.4, -1.4], need: 3.2 },
  side: { yaw: 1.5708, pitch: 0.06, dist: 7.4, target: [0, 0.6, 0], need: 7.0 },
  nose: { yaw: 0.45, pitch: 0.12, dist: 5.2, target: [0, 0.5, 1.5], need: 3.6 },
  rearLow: { yaw: 2.85, pitch: 0.05, dist: 4.6, target: [0, 0.4, -1.9], need: 3.0 },
};

const SWATCH_SLOTS = ['paint', 'stripeColor', 'wheelColor', 'caliper', 'glow', 'smoke', 'window', 'light'];
const wrap = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
const hexCss = (n) => '#' + n.toString(16).padStart(6, '0');
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

export class GarageView {
  constructor(renderer, { onBack, quality }) {
    this.renderer = renderer;
    this.onBack = onBack;
    this.quality = quality;
    this.open_ = false;
    this.mode = 'look'; // 'look' 見た目 / 'perf' 性能
    this.slot = 'paint';
    this.sel = null; // 性能タブで選んでいるパーツ id
    this.pending = null; // 購入前に試している { slot, id }
    this.zoom = 1;
    this.lastInput = 0;
    this.pointers = new Map();
    this.buildScene();
    this.buildUI();
  }

  // ---------- 3D ----------
  buildScene() {
    const r = this.renderer;
    const scene = (this.scene = new THREE.Scene());
    const bg = new THREE.Color(0x0b0d11);
    scene.background = bg;
    scene.fog = new THREE.Fog(bg, 20, 46);
    // 反射用のスタジオ環境（ソフトボックス）
    const pm = new THREE.PMREMGenerator(r);
    const env = new THREE.Scene();
    env.add(new THREE.Mesh(new THREE.SphereGeometry(40, 24, 16), new THREE.MeshBasicMaterial({ color: 0x07090c, side: THREE.BackSide })));
    const panel = (w, h, pos, k, color = 0xffffff) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), side: THREE.DoubleSide }));
      m.position.set(...pos);
      m.lookAt(0, 0, 0);
      env.add(m);
    };
    panel(20, 8, [0, 14, 0], 6);
    panel(5, 12, [-14, 5, 4], 4, 0xffe6cc);
    panel(5, 12, [14, 5, -2], 4, 0xcfe0ff);
    panel(14, 4, [0, 4, -16], 3);
    panel(10, 3, [0, 3, 16], 2);
    scene.environment = pm.fromScene(env, 0.03, 0.1, 100).texture;
    scene.environmentIntensity = 1;
    pm.dispose();
    // 床
    const floor = new THREE.Mesh(new THREE.CircleGeometry(40, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x14171c, roughness: 0.45, metalness: 0.2 }));
    floor.position.y = -0.002;
    floor.receiveShadow = true;
    scene.add(floor);
    const spot = new THREE.Mesh(new THREE.PlaneGeometry(26, 26).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: radialTexture('rgba(255,255,255,0.16)', 'rgba(255,255,255,0)', 256), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    spot.position.y = 0.002;
    scene.add(spot);
    for (const [a, b, o] of [[4.9, 4.96, 0.9], [7.2, 7.23, 0.25]]) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(a, b, 96).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xff3b2f, transparent: true, opacity: o, depthWrite: false }));
      ring.position.y = 0.004;
      scene.add(ring);
    }
    // 光
    const key = (this.key = new THREE.DirectionalLight(0xffffff, 2.4));
    key.position.set(6, 10, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(this.quality >= 2 ? 2048 : 1024, this.quality >= 2 ? 2048 : 1024);
    const sc = key.shadow.camera;
    sc.left = -5; sc.right = 5; sc.top = 5; sc.bottom = -5; sc.near = 1; sc.far = 30;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.03;
    scene.add(key, new THREE.HemisphereLight(0x8899bb, 0x111111, 0.35));
    // カメラ
    this.cam = new THREE.PerspectiveCamera(32, 1, 0.1, 120);
    const v = VIEWS.front;
    this.cur = { yaw: v.yaw, pitch: v.pitch, dist: 10, tx: 0, ty: 0.65, tz: 0 };
    this.tgt = { ...this.cur };
  }

  setCarLook(look) {
    const sig = JSON.stringify(look);
    if (sig === this.lookSig) return;
    this.lookSig = sig;
    if (this.model) {
      this.scene.remove(this.model.root);
      this.model.dispose();
    }
    this.model = buildCar({ quality: this.quality, look });
    this.model.setShadows(this.quality >= 1);
    this.model.shadow.visible = false; // スタジオでは実影を使う
    this.model.update({ x: 0, y: 0, z: 0, psi: 0, wheelRot: 0 }, 0);
    this.scene.add(this.model.root);
  }

  previewEq() {
    const eq = garage.equipped;
    if (this.pending) eq[this.pending.slot] = this.pending.id;
    // ストライプ色を選んでいる間は、ストライプなしでも色が見えるよう仮のストライプで見せる
    if (this.slot === 'stripeColor' && eq.stripe === 'none') eq.stripe = 'center2';
    return eq;
  }

  applyView() {
    const slot = this.mode === 'perf' ? null : SLOTS.find((s) => s.id === this.slot);
    this.view = (slot && VIEWS[slot.view]) || VIEWS.front;
    this.zoom = 1;
    this.layout();
  }

  // プレビュー領域の中心に車が来るよう視点をずらし、領域に収まる距離を決める
  layout() {
    const W = innerWidth, H = innerHeight;
    const rect = $('#garagePreview').getBoundingClientRect();
    const portrait = H > W;
    this.cam.fov = portrait ? 52 : 32;
    this.cam.aspect = W / H;
    const dx = rect.left + rect.width / 2 - W / 2, dy = rect.top + rect.height / 2 - H / 2;
    this.cam.setViewOffset(W, H, -dx, -dy, W, H);
    this.cam.updateProjectionMatrix();
    const t = Math.tan((this.cam.fov * Math.PI) / 360);
    const v = this.view || VIEWS.front;
    const visPerDist = 2 * t * (Math.max(rect.width, 50) / H);
    const dist = Math.max(v.dist, v.need / visPerDist);
    const visV = 2 * t * (Math.max(rect.height, 50) / H);
    const distV = 3.2 / visV;
    this.tgt.dist = Math.max(dist, distV) * this.zoom;
    this.tgt.yaw = v.yaw;
    this.tgt.pitch = v.pitch;
    [this.tgt.tx, this.tgt.ty, this.tgt.tz] = v.target;
  }

  // ---------- UI ----------
  buildUI() {
    $('#garageBack').onclick = () => this.onBack();
    this.buildTabs();
    for (const b of document.querySelectorAll('.g-mode')) b.onclick = () => this.setMode(b.dataset.mode);
    $('#gAction').onclick = () => this.onAction();
    // ドラッグで回転、ホイール・ピンチでズーム
    const area = $('#garagePreview');
    area.addEventListener('pointerdown', (e) => {
      area.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.lastInput = performance.now();
    });
    area.addEventListener('pointermove', (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      if (this.pointers.size === 1) {
        this.tgt.yaw -= dx * 0.008;
        this.tgt.pitch = Math.max(0.03, Math.min(1.25, this.tgt.pitch + dy * 0.004));
      } else if (this.pointers.size === 2) {
        const o = [...this.pointers.entries()].find(([id]) => id !== e.pointerId)[1];
        const before = Math.hypot(p.x - o.x, p.y - o.y), after = Math.hypot(e.clientX - o.x, e.clientY - o.y);
        if (before > 10) this.zoomBy(before / after);
      }
      p.x = e.clientX; p.y = e.clientY;
      this.lastInput = performance.now();
    });
    const up = (e) => this.pointers.delete(e.pointerId);
    area.addEventListener('pointerup', up);
    area.addEventListener('pointercancel', up);
    area.addEventListener('wheel', (e) => { e.preventDefault(); this.zoomBy(Math.exp(e.deltaY * 0.001)); this.lastInput = performance.now(); }, { passive: false });
  }

  zoomBy(f) {
    const nz = Math.max(0.55, Math.min(1.6, this.zoom * f));
    this.tgt.dist *= nz / this.zoom;
    this.zoom = nz;
  }

  buildTabs() {
    const tabs = $('#gTabs');
    tabs.textContent = '';
    for (const s of this.mode === 'perf' ? PART_SLOTS : SLOTS) {
      const b = el('button', 'g-tab', s.name);
      b.dataset.slot = s.id;
      b.onclick = () => this.selectSlot(s.id);
      tabs.appendChild(b);
    }
  }

  setMode(m) {
    if (m === this.mode) return;
    this.mode = m;
    this.slot = m === 'perf' ? PART_SLOTS[0].id : 'paint';
    this.pending = null;
    this.sel = null;
    this.buildTabs();
    this.syncMode();
    this.renderTabs();
    this.renderItems();
    this.applyView();
    this.refresh();
  }

  syncMode() {
    const perf = this.mode === 'perf';
    document.querySelectorAll('.g-mode').forEach((b) => b.classList.toggle('on', b.dataset.mode === this.mode));
    $('#gStats').classList.toggle('hidden', !perf);
    $('#garage').classList.toggle('perf', perf);
  }

  // 性能タブ: 選んでいるパーツに替えたときのステータス
  previewParts() {
    const p = garage.parts;
    if (this.sel) p[this.slot] = this.sel;
    return p;
  }

  renderStats() {
    const box = $('#gStats');
    const cur = garage.stats();
    const nxt = garage.stats(this.previewParts());
    if (!box.children.length) {
      for (const st of STATS) {
        const row = el('div', 'st-row');
        row.dataset.stat = st.id;
        row.append(el('span', 'st-name', st.name));
        const bar = el('span', 'st-bar');
        for (const c of ['base', 'gain', 'loss']) bar.appendChild(el('i', 'st-' + c));
        for (let i = 1; i < STAT_MAX * 2; i++) { const t = el('u', 'st-tick'); t.style.left = (i / (STAT_MAX * 2)) * 100 + '%'; bar.appendChild(t); }
        row.append(bar, el('span', 'st-val'));
        box.appendChild(row);
      }
    }
    for (const st of STATS) {
      const row = box.querySelector(`[data-stat="${st.id}"]`);
      const a = cur[st.id], b = nxt[st.id];
      const pc = (v) => (v / STAT_MAX) * 100 + '%';
      row.querySelector('.st-base').style.width = pc(Math.min(a, b));
      const gain = row.querySelector('.st-gain'), loss = row.querySelector('.st-loss');
      gain.style.left = pc(a); gain.style.width = pc(Math.max(0, b - a));
      loss.style.left = pc(b); loss.style.width = pc(Math.max(0, a - b));
      const d = b - a;
      const val = row.querySelector('.st-val');
      val.textContent = d ? `${b} (${d > 0 ? '+' : '−'}${Math.abs(d)})` : String(a);
      val.className = 'st-val' + (d > 0 ? ' up' : d < 0 ? ' down' : '');
    }
  }

  deltaChips(v) {
    const box = el('span', 'g-deltas');
    let n = 0;
    for (const st of STATS) {
      const d = v[st.id];
      if (!d) continue;
      n++;
      box.appendChild(el('span', 'g-delta ' + (d > 0 ? 'up' : 'down'), `${st.name}${d > 0 ? '+' : '−'}${Math.abs(d)}`));
    }
    if (!n) box.appendChild(el('span', 'g-delta', '変化なし'));
    return box;
  }

  renderParts() {
    const box = $('#gItems');
    box.classList.add('list', 'parts');
    const eqId = garage.parts[this.slot];
    for (const p of PARTS[this.slot]) {
      const owned = garage.partOwned(this.slot, p.id);
      const equipped = eqId === p.id;
      const b = el('button', 'g-item txt' + (this.sel === p.id || (!this.sel && equipped) ? ' sel' : ''));
      b.dataset.id = p.id;
      b.appendChild(el('span', 'g-name', p.name));
      b.appendChild(el('span', 'g-desc', p.desc));
      b.appendChild(this.deltaChips(p.v));
      const tag = el('span', 'g-tag');
      if (equipped) { tag.textContent = '装備中'; tag.classList.add('eq'); }
      else if (owned) tag.textContent = '所持';
      else {
        tag.classList.add('price');
        tag.appendChild(el('i', 'coin'));
        tag.appendChild(document.createTextNode(String(p.price)));
        if (p.price > garage.coins) tag.classList.add('short');
      }
      b.appendChild(tag);
      b.onclick = () => { this.sel = p.id === eqId ? null : p.id; this.renderItems(); this.refresh(); };
      box.appendChild(b);
    }
  }

  selectSlot(id) {
    this.slot = id;
    this.sel = null;
    this.pending = null;
    this.renderTabs();
    this.renderItems();
    this.applyView();
    this.refresh();
  }

  renderTabs() {
    this.syncMode();
    document.querySelectorAll('.g-tab').forEach((b) => b.classList.toggle('on', b.dataset.slot === this.slot));
    const on = document.querySelector('.g-tab.on');
    if (on && on.scrollIntoView) on.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }

  swatchStyle(slot, it) {
    if (!SWATCH_SLOTS.includes(slot)) return null;
    if (it.color === 'rainbow') return 'conic-gradient(#ff3b30,#ffcc00,#34c759,#00c7ff,#af52de,#ff3b30)';
    if (it.color != null) return hexCss(it.color);
    if (slot === 'smoke') return '#f2f2f2';
    return 'none'; // 「なし」: 斜線の丸
  }

  renderItems() {
    const box = $('#gItems');
    box.textContent = '';
    const perf = this.mode === 'perf';
    box.classList.toggle('parts', perf);
    box.classList.toggle('numbers', !perf && this.slot === 'number');
    box.classList.toggle('list', perf || (!SWATCH_SLOTS.includes(this.slot) && this.slot !== 'number'));
    if (perf) return this.renderParts();
    if (this.slot === 'number') return this.renderNumber(box);
    const eq = garage.equipped;
    for (const it of ITEMS[this.slot]) {
      const owned = garage.isOwned(this.slot, it.id);
      const equipped = eq[this.slot] === it.id;
      const selected = this.pending ? this.pending.id === it.id : equipped;
      const sw = this.swatchStyle(this.slot, it);
      const b = el('button', 'g-item' + (sw ? ' sw' : ' txt') + (selected ? ' sel' : ''));
      b.dataset.id = it.id;
      if (sw) {
        const c = el('span', 'g-sw');
        if (sw === 'none') c.classList.add('none'); else c.style.background = sw;
        if (this.slot === 'wheelColor' || this.slot === 'caliper') c.classList.add('ring');
        b.appendChild(c);
      }
      b.appendChild(el('span', 'g-name', it.name));
      if (!sw && it.desc) b.appendChild(el('span', 'g-desc', it.desc));
      const tag = el('span', 'g-tag');
      if (equipped) { tag.textContent = '装備中'; tag.classList.add('eq'); }
      else if (owned) tag.textContent = '所持';
      else {
        tag.classList.add('price');
        tag.appendChild(el('i', 'coin'));
        tag.appendChild(document.createTextNode(String(it.price)));
        if (it.price > garage.coins) tag.classList.add('short');
      }
      b.appendChild(tag);
      b.onclick = () => this.onPick(it.id);
      box.appendChild(b);
    }
  }

  renderNumber(box) {
    const n = garage.equipped.number;
    const disp = el('div', 'num-disp', String(n));
    const row = el('div', 'num-row');
    for (const [label, d] of [['−10', -10], ['−1', -1], ['+1', 1], ['+10', 10]]) {
      const b = el('button', 'num-btn', label);
      b.onclick = () => {
        garage.setNumber(((garage.equipped.number + d) % 100 + 100) % 100);
        this.renderItems();
        this.refresh();
      };
      row.appendChild(b);
    }
    box.append(disp, row, el('div', 'g-note', '0〜99。ボディ両側とボンネットに表示されます。'));
  }

  onPick(id) {
    const owned = garage.isOwned(this.slot, id);
    if (owned) {
      garage.equip(this.slot, id);
      this.pending = null;
    } else {
      this.pending = { slot: this.slot, id };
    }
    this.renderItems();
    this.refresh();
  }

  onPartAction() {
    const id = this.sel;
    if (!id) return;
    const slot = this.slot;
    let msg = '装備しました';
    if (!garage.partOwned(slot, id)) {
      if (!garage.buyPart(slot, id)) return;
      msg = '購入して装備しました';
      const c = $('#garageCoins');
      c.classList.remove('pop'); void c.offsetWidth; c.classList.add('pop');
    }
    garage.equipPart(slot, id);
    this.sel = null;
    this.toast(msg);
    this.renderItems();
    this.refresh();
  }

  onAction() {
    if (this.mode === 'perf') return this.onPartAction();
    if (!this.pending) return;
    const { slot, id } = this.pending;
    if (garage.buy(slot, id)) {
      garage.equip(slot, id);
      this.pending = null;
      const c = $('#garageCoins');
      c.classList.remove('pop'); void c.offsetWidth; c.classList.add('pop');
      this.toast('購入して装備しました');
      this.renderItems();
      this.refresh();
    }
  }

  toast(msg) {
    const t = $('#gToast');
    t.textContent = msg;
    t.classList.remove('show'); void t.offsetWidth; t.classList.add('show');
  }

  // コイン・下部の購入バー・プレビューの車を更新
  refresh() {
    $('#garageCoins').textContent = String(garage.coins);
    const pr = garage.progress();
    $('#garageProg').textContent = `パーツ ${pr.have}/${pr.all}`;
    this.setCarLook(resolveLook(this.mode === 'perf' ? garage.equipped : this.previewEq()));
    const bar = $('.g-buy');
    if (this.mode === 'perf') return this.refreshPerf(bar);
    const name = $('#gSelName'), sub = $('#gSelSub'), btn = $('#gAction');
    if (this.slot === 'number') {
      bar.classList.add('hidden');
      return;
    }
    bar.classList.remove('hidden');
    const id = this.pending ? this.pending.id : garage.equipped[this.slot];
    const it = garage.item(this.slot, id);
    name.textContent = it.name;
    if (this.pending) {
      const short = it.price - garage.coins;
      sub.textContent = short > 0 ? `あと ${short} コイン必要です` : this.slot === 'stripeColor' && garage.equipped.stripe === 'none' ? '試着中（ストライプなしのため見本のストライプで表示）' : '試着中。購入すると装備されます';
      btn.textContent = '';
      btn.appendChild(document.createTextNode('購入 '));
      btn.appendChild(el('i', 'coin'));
      btn.appendChild(document.createTextNode(String(it.price)));
      btn.disabled = short > 0;
    } else {
      sub.textContent = this.slot === 'stripeColor' && garage.equipped.stripe === 'none'
        ? '装備中（ストライプを付けると反映されます。今は見本のストライプで表示）'
        : it.desc || '装備中';
      btn.textContent = '装備中';
      btn.disabled = true;
    }
  }

  refreshPerf(bar) {
    this.renderStats();
    bar.classList.remove('hidden');
    const name = $('#gSelName'), sub = $('#gSelSub'), btn = $('#gAction');
    const id = this.sel || garage.parts[this.slot];
    const p = garage.part(this.slot, id);
    name.textContent = p.name;
    if (!this.sel) { sub.textContent = p.desc; btn.textContent = '装備中'; btn.disabled = true; return; }
    if (garage.partOwned(this.slot, id)) {
      sub.textContent = 'ステータスの変化を確認して装備できます';
      btn.textContent = '装備する'; btn.disabled = false;
      return;
    }
    const short = p.price - garage.coins;
    sub.textContent = short > 0 ? `あと ${short} コイン必要です` : '購入すると装備されます';
    btn.textContent = '';
    btn.appendChild(document.createTextNode('購入 '));
    btn.appendChild(el('i', 'coin'));
    btn.appendChild(document.createTextNode(String(p.price)));
    btn.disabled = short > 0;
  }

  // ---------- 表示 ----------
  open() {
    this.open_ = true;
    $('#garage').classList.add('show');
    const r = this.renderer;
    r.toneMappingExposure = 1;
    r.shadowMap.enabled = this.quality >= 1;
    this.mode = 'look';
    this.slot = 'paint';
    this.pending = null;
    this.sel = null;
    this.lookSig = null;
    this.buildTabs();
    this.renderTabs();
    this.renderItems();
    this.view = VIEWS.front;
    this.layout();
    Object.assign(this.cur, { yaw: this.tgt.yaw - 0.9, pitch: 0.3, dist: this.tgt.dist * 1.25, tx: this.tgt.tx, ty: this.tgt.ty, tz: this.tgt.tz });
    this.refresh();
    this.lastInput = performance.now();
    this.onResize = () => this.layout();
    addEventListener('resize', this.onResize);
    this.last = performance.now();
    const loop = (t) => {
      if (!this.open_) return;
      requestAnimationFrame(loop);
      this.frame(Math.min(0.1, (t - this.last) / 1000), t);
      this.last = t;
    };
    requestAnimationFrame(loop);
  }

  close() {
    this.open_ = false;
    $('#garage').classList.remove('show');
    removeEventListener('resize', this.onResize);
    if (this.model) {
      this.scene.remove(this.model.root);
      this.model.dispose();
      this.model = null;
      this.lookSig = null;
    }
  }

  frame(dt, t) {
    const c = this.cur, g = this.tgt;
    // しばらく触らなければゆっくり回す
    if (t - this.lastInput > 5000 && this.pointers.size === 0) g.yaw += 0.16 * dt;
    const k = 1 - Math.exp(-5 * dt);
    c.yaw += wrap(g.yaw - c.yaw) * k;
    c.pitch += (g.pitch - c.pitch) * k;
    c.dist += (g.dist - c.dist) * k;
    c.tx += (g.tx - c.tx) * k;
    c.ty += (g.ty - c.ty) * k;
    c.tz += (g.tz - c.tz) * k;
    const cp = Math.cos(c.pitch);
    this.cam.position.set(c.tx + Math.sin(c.yaw) * cp * c.dist, c.ty + Math.sin(c.pitch) * c.dist, c.tz + Math.cos(c.yaw) * cp * c.dist);
    this.cam.lookAt(c.tx, c.ty, c.tz);
    if (this.model) this.model.update({ x: 0, y: 0, z: 0, psi: 0, wheelRot: 0 }, 0);
    this.renderer.render(this.scene, this.cam);
  }
}
