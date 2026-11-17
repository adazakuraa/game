import * as THREE from 'three';

/** Exhaled vapour escaping the oxygen mask, drifting with the wind. */
export class Breath {
  readonly group = new THREE.Group();
  private readonly sprites: { s: THREE.Sprite; life: number; vel: THREE.Vector3 }[] = [];
  private lastPhase = 0;

  constructor() {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
    grad.addColorStop(0, 'rgba(255,255,255,0.55)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0.18)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    for (let i = 0; i < 6; i++) {
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0 });
      const s = new THREE.Sprite(mat);
      s.visible = false;
      this.group.add(s);
      this.sprites.push({ s, life: 0, vel: new THREE.Vector3() });
    }
    this.group.name = 'breathVapour';
  }

  update(dt: number, breathPhase: number, camera: THREE.Camera, wind: THREE.Vector3, cold: number, light: number): void {
    if (this.lastPhase < 0.45 && breathPhase >= 0.45 && cold > 0) {
      const slot = this.sprites.find((p) => p.life <= 0);
      if (slot) {
        slot.life = 1.4;
        const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
        slot.s.position.copy(camera.position).addScaledVector(fwd, 0.32);
        slot.s.position.y -= 0.16;
        slot.vel.copy(fwd).multiplyScalar(0.35).add(wind.clone().multiplyScalar(0.08));
        slot.vel.y += 0.05;
        slot.s.visible = true;
      }
    }
    this.lastPhase = breathPhase;
    for (const p of this.sprites) {
      if (p.life <= 0) continue;
      p.life -= dt;
      p.s.position.addScaledVector(p.vel, dt);
      const age = 1.4 - p.life;
      p.s.scale.setScalar(0.12 + age * 0.35);
      (p.s.material as THREE.SpriteMaterial).opacity = Math.max(0, Math.min(1, age * 6) * (p.life / 1.4)) * 0.5 * cold;
      (p.s.material as THREE.SpriteMaterial).color.setScalar(0.4 + light * 0.6);
      if (p.life <= 0) p.s.visible = false;
    }
  }
}
