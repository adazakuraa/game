import * as THREE from 'three';

/** First-person arms: down-suit sleeves, mittens, ice axe and ascender (jumar). */
export class Viewmodel {
  readonly scene = new THREE.Scene();
  readonly rig = new THREE.Group();
  private readonly right = new THREE.Group();
  private readonly left = new THREE.Group();
  private readonly axe = new THREE.Group();
  private readonly jumar = new THREE.Group();
  private readonly ropeBit: THREE.Mesh;
  /** Locking carabiner on a sling clipped to the harness. */
  private readonly biner = new THREE.Group();
  private readonly gate: THREE.Mesh;
  private readonly sling: THREE.Mesh;
  private readonly tmpA = new THREE.Vector3();
  private readonly tmpB = new THREE.Vector3();
  readonly sun = new THREE.DirectionalLight(0xffffff, 2);
  readonly hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, 0.6);
  readonly lamp = new THREE.PointLight(0xfff2dd, 0, 3, 1.5);
  private t = 0;
  private reachK = 0;
  /** 0 = arm lowered out of view, 1 = raised into view */
  private rPres = 0;
  private lPres = 0;

  constructor() {
    this.scene.add(this.rig, this.sun, this.sun.target, this.hemi);
    this.rig.add(this.lamp);
    this.lamp.position.set(0, 0.25, 0.1);
    const suit = new THREE.MeshStandardMaterial({ color: 0xa3221b, roughness: 0.55, metalness: 0.0 });
    const suitDark = new THREE.MeshStandardMaterial({ color: 0x3a0c0a, roughness: 0.7 });
    const mitt = new THREE.MeshStandardMaterial({ color: 0x1d1f22, roughness: 0.8 });
    const cuff = new THREE.MeshStandardMaterial({ color: 0xe0761c, roughness: 0.6 });
    const metal = new THREE.MeshStandardMaterial({ color: 0x9aa3ab, roughness: 0.3, metalness: 0.95 });
    const shaftMat = new THREE.MeshStandardMaterial({ color: 0x2652a8, roughness: 0.35, metalness: 0.6 });
    const grip = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });

    const sleeve = (): THREE.Group => {
      const g = new THREE.Group();
      // Puffy baffled sleeve via lathe profile
      const pts: THREE.Vector2[] = [];
      for (let i = 0; i <= 40; i++) {
        const y = i / 40;
        const baffle = Math.pow(Math.abs(Math.sin(y * Math.PI * 6)), 0.6) * 0.012;
        pts.push(new THREE.Vector2(0.062 + y * 0.03 + baffle, y * 0.55));
      }
      const geo = new THREE.LatheGeometry(pts, 18);
      const m = new THREE.Mesh(geo, suit);
      m.rotation.x = Math.PI / 2;
      m.position.z = 0.05;
      g.add(m);
      const seam = new THREE.Mesh(new THREE.TorusGeometry(0.066, 0.008, 6, 18), suitDark);
      seam.position.z = 0.05;
      g.add(seam);
      return g;
    };
    const mitten = (mirror: number): THREE.Group => {
      const g = new THREE.Group();
      const palm = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.07, 6, 12), mitt);
      palm.scale.set(1.15, 1, 0.8);
      palm.rotation.x = Math.PI / 2;
      palm.position.z = -0.06;
      g.add(palm);
      const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.022, 0.04, 4, 8), mitt);
      thumb.position.set(0.05 * mirror, 0.02, -0.06);
      thumb.rotation.set(0.6, 0, -0.9 * mirror);
      g.add(thumb);
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.068, 0.072, 0.06, 16, 1, true), cuff);
      c.rotation.x = Math.PI / 2;
      c.position.z = 0.02;
      g.add(c);
      return g;
    };

    // Right arm + ice axe
    const rs = sleeve();
    this.right.add(rs);
    const rm = mitten(-1);
    this.right.add(rm);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.017, 0.62, 10), shaftMat);
    shaft.position.y = -0.12;
    this.axe.add(shaft);
    const gripM = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.019, 0.14, 10), grip);
    gripM.position.y = -0.36;
    this.axe.add(gripM);
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.014, 0.06, 8), metal);
    spike.rotation.x = Math.PI;
    spike.position.y = -0.46;
    this.axe.add(spike);
    // Head: curved pick + adze
    const pickShape = new THREE.Shape();
    pickShape.moveTo(0, 0.012);
    pickShape.quadraticCurveTo(0.12, 0.0, 0.2, -0.05);
    pickShape.lineTo(0.2, -0.06);
    pickShape.quadraticCurveTo(0.11, -0.02, 0, -0.012);
    pickShape.lineTo(0, 0.012);
    const pick = new THREE.Mesh(new THREE.ExtrudeGeometry(pickShape, { depth: 0.008, bevelEnabled: false }), metal);
    pick.position.set(0, 0.2, -0.004);
    this.axe.add(pick);
    const adze = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.012, 0.035), metal);
    adze.position.set(-0.05, 0.2, 0);
    adze.rotation.z = 0.15;
    this.axe.add(adze);
    const headBody = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.05, 0.022), metal);
    headBody.position.y = 0.19;
    this.axe.add(headBody);
    this.axe.position.set(0, 0, -0.07);
    this.axe.rotation.set(-0.15, Math.PI / 2, 0.2);
    this.right.add(this.axe);

    // Left arm + jumar
    const ls = sleeve();
    this.left.add(ls);
    this.left.add(mitten(1));
    const jBody = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.16, 0.05), new THREE.MeshStandardMaterial({ color: 0xe6c12a, roughness: 0.4, metalness: 0.5 }));
    jBody.position.set(0, 0.06, -0.08);
    this.jumar.add(jBody);
    const jCam = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.035, 10), metal);
    jCam.rotation.z = Math.PI / 2;
    jCam.position.set(0, 0.12, -0.1);
    this.jumar.add(jCam);
    this.ropeBit = new THREE.Mesh(
      new THREE.CylinderGeometry(0.009, 0.009, 3, 6),
      new THREE.MeshStandardMaterial({ color: 0xc8202a, roughness: 0.7 }),
    );
    this.ropeBit.rotation.x = Math.PI / 2 - 0.35;
    this.ropeBit.position.set(0, 0.12, -1.5);
    this.jumar.add(this.ropeBit);
    this.left.add(this.jumar);

    // Carabiner: D-shaped aluminium body with a spring gate, held in the left mitten.
    const alu = new THREE.MeshStandardMaterial({ color: 0xd8a02a, roughness: 0.35, metalness: 0.85 });
    // D path: straight spine on the left, big curve on the right; the gap on the right side is the gate.
    const dPts = [
      new THREE.Vector3(-0.022, -0.045, 0), new THREE.Vector3(-0.024, 0.0, 0), new THREE.Vector3(-0.022, 0.045, 0),
      new THREE.Vector3(-0.005, 0.062, 0), new THREE.Vector3(0.018, 0.058, 0), new THREE.Vector3(0.03, 0.035, 0),
      new THREE.Vector3(0.032, 0.022, 0),
    ];
    const dTail = [new THREE.Vector3(0.03, -0.03, 0), new THREE.Vector3(0.016, -0.055, 0), new THREE.Vector3(-0.004, -0.06, 0), new THREE.Vector3(-0.022, -0.045, 0)];
    const body = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(dPts), 24, 0.0058, 6, false), alu);
    const tail = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(dTail), 12, 0.0058, 6, false), alu);
    this.biner.add(body, tail);
    // Gate hinges at the bottom right and swings inward when opened.
    this.gate = new THREE.Mesh(new THREE.CylinderGeometry(0.0045, 0.0045, 0.052, 6).translate(0, 0.026, 0), new THREE.MeshStandardMaterial({ color: 0xc9d0d6, metalness: 0.95, roughness: 0.25 }));
    this.gate.position.set(0.03, -0.03, 0);
    this.biner.add(this.gate);
    // Held by the spine just beyond the mitten's fingertips, facing the eye.
    this.biner.position.set(0.02, 0.085, -0.2);
    this.biner.rotation.set(0.25, 0.0, -0.2);
    this.biner.scale.setScalar(1.25);
    this.left.add(this.biner);
    // Sling (cow's tail) from the harness up to the carabiner; oriented every frame.
    this.sling = new THREE.Mesh(new THREE.CylinderGeometry(0.0045, 0.0045, 1, 6).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: 0x2a5bd1, roughness: 0.8 }));
    this.rig.add(this.sling);

    this.rig.add(this.right, this.left);
    this.rig.traverse((o) => { o.frustumCulled = false; });
  }

  update(
    dt: number,
    camera: THREE.Camera,
    s: {
      stepPhase: number; speed: number; resting: boolean; clipped: boolean; mode: string; actionT: number;
      arresting: boolean; breath: number; shake: number; shiver: number; aspect: number; slope: number;
      actionKind: 'clip' | 'unclip' | 'transfer' | null; actionProgress: number; target: THREE.Vector3; anchor: THREE.Vector3;
      grip: THREE.Vector3 | null;
    },
  ): void {
    this.t += dt;
    this.rig.position.copy(camera.position);
    this.rig.quaternion.copy(camera.quaternion);
    this.rig.updateMatrixWorld(true);
    const walk = Math.min(1, s.speed / 0.8);
    const ph = s.stepPhase * Math.PI;
    const breathe = Math.sin(s.breath * Math.PI * 2) * 0.008;
    const shiver = s.shiver > 0 ? Math.sin(this.t * 60) * 0.003 * s.shiver : 0;

    // Arms stay down at the sides while walking on easy ground (as a real climber's would)
    // and only come into view when they are doing something.
    const caneNeeded = s.slope > 24 && !s.clipped;
    const rTarget = s.mode === 'slide' || s.resting || caneNeeded ? 1 : 0;
    // When clipped, the left hand rides the jumar on the real rope: it is only in view
    // while that spot on the rope is in front of us and within arm's reach.
    let gripLocal: THREE.Vector3 | null = null;
    if (s.clipped && s.grip && !s.actionKind) {
      const v = this.tmpA.copy(s.grip);
      this.rig.worldToLocal(v);
      const dist = v.length();
      const inFront = v.z < -0.25 && Math.abs(v.x) < -v.z * 1.1 && dist < 1.6;
      if (inFront) gripLocal = v.clone().normalize().multiplyScalar(Math.min(dist, 0.62));
    }
    const lTarget = gripLocal || s.mode === 'transfer' || s.mode === 'clipping' ? 1 : 0;
    this.rPres += (rTarget - this.rPres) * Math.min(1, dt * 3.5);
    this.lPres += (lTarget - this.lPres) * Math.min(1, dt * 3.5);

    // Right: ice axe used as a cane on steep snow — planted low ahead every other step.
    let rx = 0.3, ry = -0.44 + breathe, rz = -0.52;
    let rRotX = 0.55, rRotZ = 0;
    const plant = Math.max(0, Math.sin(ph * 0.5)) * walk;
    ry += -0.05 * plant + Math.sin(ph) * 0.015 * walk;
    rz += -0.08 * plant;
    rRotX += 0.35 * plant;
    if (s.resting) { ry = -0.47 + breathe; rRotX = 0.75; rz = -0.5; }
    ry -= (1 - this.rPres) * 0.5;
    rRotX += (1 - this.rPres) * 0.6;
    if (s.mode === 'slide') {
      rx = 0.12; ry = -0.25 + Math.sin(this.t * 20) * 0.02; rz = -0.42; rRotX = s.arresting ? 1.3 : -0.3; rRotZ = 0.6;
    }
    const ax = Math.min(1, Math.max(0.55, s.aspect / 1.4));
    this.right.position.set((rx + shiver) * ax, ry, rz);
    this.right.rotation.set(rRotX, -0.08, rRotZ);

    // Left: holds the ascender on the rope when clipped.
    let lx = -0.3, ly = -0.44 + breathe, lz = -0.52;
    let lRotX = 0.2;
    // Jumar: slid up the rope with each step.
    if (gripLocal) {
      // hand sits just behind/below the grip point so the jumar body is on the rope
      lx = gripLocal.x - 0.03; ly = gripLocal.y - 0.07 + Math.sin(ph) * 0.01 * walk; lz = gripLocal.z + 0.12;
      lRotX = 0.5;
    }
    // Rope work: reach the carabiner out to the rope, open the gate, snap it shut, bring the hand back.
    let gateOpen = 0;
    // while clipped the carabiner hangs on the rope (drawn in the world), not in the hand
    let binerInHand = false;
    if (s.actionKind) {
      const p = s.actionProgress;
      // target point in camera space, kept within arm's reach
      const local = (pt: THREE.Vector3) => {
        // Put the hand on the line of sight to the rope point, at arm's length, so on
        // screen it lands exactly on the rope.
        const v = this.tmpA.copy(pt);
        this.rig.worldToLocal(v);
        v.normalize().multiplyScalar(0.5);
        if (v.z > -0.3) v.z = -0.3;
        return v.clone();
      };
      const rest = new THREE.Vector3(lx, ly, lz);
      const ease = (t: number) => t * t * (3 - 2 * t);
      let reach = 0;
      let tgt = local(s.target);
      if (s.actionKind === 'transfer') {
        // 1) clip the safety carabiner past the anchor, 2) slide the hand back via the anchor to move the jumar
        if (p < 0.5) {
          reach = ease(Math.min(1, p / 0.25)) * (p < 0.4 ? 1 : 1 - (p - 0.4) / 0.1 * 0.3);
          gateOpen = p > 0.22 && p < 0.36 ? Math.sin(((p - 0.22) / 0.14) * Math.PI) : 0;
        } else {
          tgt = local(s.anchor);
          reach = Math.sin(((p - 0.5) / 0.5) * Math.PI) * 0.9;
        }
        binerInHand = true;
      } else {
        reach = p < 0.45 ? ease(p / 0.45) : p < 0.7 ? 1 : 1 - ease((p - 0.7) / 0.3);
        gateOpen = p > 0.42 && p < 0.66 ? Math.sin(((p - 0.42) / 0.24) * Math.PI) : 0;
        binerInHand = s.actionKind === 'clip' ? true : p < 0.7;
      }
      // offset so the carabiner's gate (not the mitten) meets the rope on screen
      const pos = rest.lerp(tgt.add(new THREE.Vector3(-0.07, -0.05, 0.17)), reach);
      lx = pos.x; ly = pos.y; lz = pos.z;
      lRotX = 0.4 + reach * 0.35;
      this.reachK = reach;
    }
    this.gate.rotation.z = -gateOpen * 0.9;
    this.biner.visible = binerInHand;
    this.lPres = s.actionKind ? 1 : this.lPres;
    if (s.resting) { ly -= 0.06; }
    ly -= (1 - this.lPres) * 0.5;
    this.left.visible = this.lPres > 0.02;
    this.right.visible = this.rPres > 0.02;
    this.left.position.set((lx - shiver) * ax, ly, lz);
    this.left.rotation.set(lRotX, 0.1, 0);
    if (s.actionKind || gripLocal) {
      if (!s.actionKind) this.reachK = 0.6;
      // Aim the forearm from the left shoulder to the hand so the arm enters from the lower left.
      this.left.updateMatrixWorld();
      const handW = this.left.getWorldPosition(this.tmpB.set(0, 0, 0));
      const back = this.tmpA.set(-0.42, -0.62, 0.25);
      this.rig.localToWorld(back);
      const dir = back.sub(handW).normalize();
      // +Z of the arm group points back toward the shoulder
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
      const rigQ = this.rig.getWorldQuaternion(new THREE.Quaternion());
      this.left.quaternion.copy(rigQ.invert().multiply(q));
      this.left.rotateZ(-0.5 * this.reachK);
    } else {
      this.reachK = 0;
    }
    this.jumar.visible = !!gripLocal;
    // The real fixed rope is drawn in the world; no camera-locked rope stub.
    this.ropeBit.visible = false;
    // Sling from the harness (below, slightly left of view) to the carabiner in hand.
    this.rig.updateMatrixWorld(true);
    this.sling.visible = this.biner.visible && this.left.visible;
    if (this.sling.visible) {
      const from = this.tmpA.set(-0.22, -0.85, 0.05);
      // attach to the bottom of the carabiner's D
      this.biner.localToWorld(this.tmpB.set(0.0, -0.055, 0));
      this.rig.worldToLocal(this.tmpB);
      const d = this.tmpB.clone().sub(from);
      const len = d.length();
      this.sling.position.copy(from);
      this.sling.scale.set(1, len, 1);
      this.sling.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.divideScalar(len || 1));
    }

    if (s.shake > 0) {
      this.rig.position.x += (Math.random() - 0.5) * 0.01 * s.shake;
      this.rig.position.y += (Math.random() - 0.5) * 0.01 * s.shake;
    }
    this.rig.updateMatrixWorld(true);
  }

  syncLights(sun: THREE.DirectionalLight, hemi: THREE.HemisphereLight, lampOn: number): void {
    this.sun.color.copy(sun.color);
    this.sun.intensity = sun.intensity;
    this.sun.position.copy(this.rig.position).add(new THREE.Vector3().subVectors(sun.position, sun.target.position).normalize());
    this.sun.target.position.copy(this.rig.position);
    this.sun.target.updateMatrixWorld();
    this.hemi.color.copy(hemi.color);
    this.hemi.groundColor.copy(hemi.groundColor);
    this.hemi.intensity = hemi.intensity;
    this.lamp.intensity = lampOn * 0.35;
  }
}
