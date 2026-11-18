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
  readonly sun = new THREE.DirectionalLight(0xffffff, 2);
  readonly hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, 0.6);
  readonly lamp = new THREE.PointLight(0xfff2dd, 0, 3, 1.5);
  private t = 0;
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

    this.rig.add(this.right, this.left);
    this.rig.traverse((o) => { o.frustumCulled = false; });
  }

  update(
    dt: number,
    camera: THREE.Camera,
    s: {
      stepPhase: number; speed: number; resting: boolean; clipped: boolean; mode: string; actionT: number;
      arresting: boolean; breath: number; shake: number; shiver: number; aspect: number; slope: number;
    },
  ): void {
    this.t += dt;
    this.rig.position.copy(camera.position);
    this.rig.quaternion.copy(camera.quaternion);
    const walk = Math.min(1, s.speed / 1.2);
    const ph = s.stepPhase * Math.PI;
    const breathe = Math.sin(s.breath * Math.PI * 2) * 0.008;
    const shiver = s.shiver > 0 ? Math.sin(this.t * 60) * 0.003 * s.shiver : 0;

    // Arms stay down at the sides while walking on easy ground (as a real climber's would)
    // and only come into view when they are doing something.
    const caneNeeded = s.slope > 24 && !s.clipped;
    const rTarget = s.mode === 'slide' || s.resting || caneNeeded ? 1 : 0;
    const lTarget = s.clipped || s.mode === 'transfer' || s.mode === 'clipping' ? 1 : 0;
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
    if (s.clipped) { lx = -0.2; ly = -0.36 + Math.sin(ph) * 0.03 * walk; lz = -0.58 - Math.max(0, Math.sin(ph)) * 0.05 * walk; lRotX = 0.5; }
    if (s.mode === 'transfer' || s.mode === 'clipping') {
      const k = Math.sin(Math.min(1, s.actionT / 1.5) * Math.PI);
      lx = -0.12; ly = -0.24 + k * 0.05; lz = -0.62 - k * 0.08; lRotX = 0.9;
    }
    if (s.resting) { ly -= 0.06; }
    ly -= (1 - this.lPres) * 0.5;
    this.left.visible = this.lPres > 0.02;
    this.right.visible = this.rPres > 0.02;
    this.left.position.set((lx - shiver) * ax, ly, lz);
    this.left.rotation.set(lRotX, 0.1, 0);
    this.jumar.visible = s.clipped || s.mode === 'transfer';
    this.ropeBit.visible = s.clipped;

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
