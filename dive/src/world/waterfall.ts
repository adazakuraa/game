import * as THREE from 'three';
import { makeBubble } from '../render/textures';
import { heightAt, WATERFALL } from './layout';
import { mulberry32 } from '../utils/noise';

/**
 * Phase 9 S2 (PHASE9-DESIGN §3.4): the river's waterfall. A 6 m wide, 6.5 m tall strip of falling water lying on the cliff ramp
 * (additive, a small noise shader, no texture), plus 300 foam bubbles that well up from the plunge pool's floor.
 * Everything sleeps (invisible, no updates) when the camera is more than FAR m away.
 */
export const FALL = { width: 6, far: 160, foam: 300, foamR: 5 };

export class Waterfall {
  readonly group = new THREE.Group();
  private mat: THREE.ShaderMaterial;
  private foam: THREE.Points;
  private pos: Float32Array;
  private size: Float32Array;
  private data: { x: number; y: number; z: number; vy: number; s: number }[] = [];
  private rnd = mulberry32(90125);
  private floorY = -6;

  constructor(pointScale: { value: number }) {
    const W = WATERFALL, hw = FALL.width / 2, top = W.h + 0.5;
    // the strip lies on the ramp: bottom at the foot (z = rampZ0), top at the ramp's end, 0.2 m in front of the rock
    const z0 = W.rampZ0 + 0.25, z1 = W.rampZ0 - W.rampLen + 0.2;
    const COLS = 4, ROWS = 4, pos: number[] = [], uv: number[] = [], idx: number[] = [];
    for (let j = 0; j <= ROWS; j++) for (let i = 0; i <= COLS; i++) {
      const u = i / COLS, v = j / ROWS;
      pos.push(W.x - hw + u * FALL.width, v * top, z0 + (z1 - z0) * v);
      uv.push(u, v);
    }
    for (let j = 0; j < ROWS; j++) for (let i = 0; i < COLS; i++) {
      const a = j * (COLS + 1) + i, b = a + 1, c = a + COLS + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
      uniforms: { uTime: { value: 0 } },
      vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: /* glsl */ `uniform float uTime; varying vec2 vUv;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
          return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
        void main(){
          float fall = uTime * 2.6;
          float s = n(vec2(vUv.x * 14.0, vUv.y * 3.0 + fall)) * 0.6 + n(vec2(vUv.x * 31.0 + 5.0, vUv.y * 7.0 + fall * 1.7)) * 0.4;
          float edge = smoothstep(0.0, 0.12, vUv.x) * smoothstep(1.0, 0.88, vUv.x);
          float a = (0.25 + 0.55 * s) * edge * (0.55 + 0.45 * smoothstep(1.0, 0.0, vUv.y * 0.5));
          gl_FragColor = vec4(vec3(0.7, 0.85, 0.9) * a, a);
        }`,
    });
    const strip = new THREE.Mesh(g, this.mat);
    strip.frustumCulled = false;
    this.group.add(strip);

    // foam bubbles from the pool floor (own Points, the same bubble texture and size scale as the diver's)
    this.pos = new Float32Array(FALL.foam * 3);
    this.size = new Float32Array(FALL.foam);
    for (let i = 0; i < FALL.foam; i++) {
      this.data.push({ x: 0, y: 0, z: 0, vy: 0, s: 0 });
      this.respawn(i, true);
    }
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    fg.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    this.foam = new THREE.Points(fg, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: false,
      uniforms: { uTex: { value: makeBubble() }, uScale: pointScale },
      vertexShader: /* glsl */ `attribute float aSize; uniform float uScale;
        void main(){ vec4 mv = viewMatrix*modelMatrix*vec4(position,1.0);
          gl_PointSize = aSize * uScale / max(-mv.z, 0.2); gl_Position = projectionMatrix*mv; }`,
      fragmentShader: /* glsl */ `uniform sampler2D uTex; void main(){ vec4 t = texture2D(uTex, gl_PointCoord); gl_FragColor = vec4(t.rgb * 0.9, t.a * 0.8); }`,
    }));
    this.foam.frustumCulled = false;
    this.group.add(this.foam);
    this.group.visible = false;
  }

  private respawn(i: number, scatter: boolean): void {
    const r = this.rnd, d = this.data[i], a = r() * Math.PI * 2, rr = FALL.foamR * Math.sqrt(r());
    d.x = WATERFALL.x + Math.cos(a) * rr;
    d.z = WATERFALL.z + 2.5 + Math.sin(a) * rr * 0.8;
    const floor = this.floorY;
    d.y = scatter ? floor + r() * -floor : floor + 0.3;
    d.vy = 0.5 + r() * 0.9;
    d.s = 0.02 + r() * r() * 0.06;
  }

  update(dt: number, cam: THREE.PerspectiveCamera, time: number): void {
    const near = Math.hypot(cam.position.x - WATERFALL.x, cam.position.z - WATERFALL.z) < FALL.far;
    this.group.visible = near;
    if (!near) return;
    this.mat.uniforms.uTime.value = time;
    this.floorY = Math.min(-1, heightAt(WATERFALL.x, WATERFALL.z + 3) + 0.3);
    for (let i = 0; i < FALL.foam; i++) {
      const d = this.data[i];
      d.y += d.vy * dt;
      d.x += Math.sin(time * 5 + i) * 0.006;
      if (d.y > -0.05) this.respawn(i, false);
      this.pos[i * 3] = d.x; this.pos[i * 3 + 1] = d.y; this.pos[i * 3 + 2] = d.z;
      this.size[i] = d.s;
    }
    this.foam.geometry.attributes.position.needsUpdate = true;
    this.foam.geometry.attributes.aSize.needsUpdate = true;
  }
}
