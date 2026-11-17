import * as THREE from 'three';
import { Noise2D, clamp, smoothstep } from '../utils/noise';

const SKY_VERT = `
varying vec3 vDir;
void main() {
  vDir = normalize((modelMatrix * vec4(position, 0.0)).xyz);
  vec4 p = projectionMatrix * viewMatrix * vec4((modelMatrix * vec4(position,1.0)).xyz, 1.0);
  gl_Position = p.xyww;
}`;

const SKY_FRAG = `
precision highp float;
varying vec3 vDir;
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform float uTime;
uniform float uStorm;
float h31(vec3 p){ p = fract(p*vec3(443.897,441.423,437.195)); p += dot(p, p.yzx+19.19); return fract((p.x+p.y)*p.z); }
float vnoise(vec3 p){ vec3 i=floor(p); vec3 f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(h31(i),h31(i+vec3(1,0,0)),f.x),mix(h31(i+vec3(0,1,0)),h31(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(h31(i+vec3(0,0,1)),h31(i+vec3(1,0,1)),f.x),mix(h31(i+vec3(0,1,1)),h31(i+vec3(1,1,1)),f.x),f.y),f.z); }
void main() {
  vec3 d = normalize(vDir);
  float sy = uSunDir.y;
  float day = smoothstep(-0.12, 0.25, sy);
  float up = max(d.y, 0.0);
  float hz = pow(1.0 - up, 5.0);
  // Thin, dark high-altitude sky.
  vec3 zenithDay = vec3(0.035, 0.11, 0.34);
  vec3 horizonDay = vec3(0.42, 0.56, 0.74);
  vec3 zenithNight = vec3(0.0025, 0.004, 0.012);
  vec3 horizonNight = vec3(0.012, 0.018, 0.035);
  vec3 col = mix(mix(zenithNight, zenithDay, day), mix(horizonNight, horizonDay, day), hz);
  float cs = dot(d, uSunDir);
  float sunward = pow(max(cs, 0.0), 4.0);
  float tw = exp(-abs(sy + 0.03) * 9.0);
  // Twilight: orange band near the sun, pink belt of Venus opposite.
  col += tw * hz * (0.25 + 1.6 * sunward) * vec3(1.0, 0.42, 0.14) * 1.6;
  col += tw * hz * pow(max(-cs, 0.0), 2.0) * vec3(0.35, 0.18, 0.28) * 0.6;
  col += tw * (1.0 - hz) * vec3(0.08, 0.06, 0.12) * 0.5;
  // Sun disc and Mie halo.
  float sunVis = smoothstep(-0.03, 0.01, sy);
  col += vec3(1.0, 0.9, 0.75) * smoothstep(0.99965, 0.99985, cs) * 60.0 * sunVis;
  col += vec3(1.0, 0.8, 0.6) * (pow(max(cs,0.0), 600.0) * 4.0 + pow(max(cs,0.0), 24.0) * 0.35) * sunVis;
  // Stars and Milky Way at night.
  float night = 1.0 - smoothstep(-0.18, 0.02, sy);
  if (night > 0.001 && d.y > -0.05) {
    vec3 sp = d * 260.0;
    vec3 cell = floor(sp);
    float h = h31(cell);
    vec3 fp = fract(sp) - 0.5;
    float star = smoothstep(0.08, 0.0, length(fp)) * step(0.985, h) * (h - 0.985) * 70.0;
    float tw2 = 0.6 + 0.4 * sin(uTime * 3.0 + h * 400.0);
    vec3 mwAxis = normalize(vec3(0.4, 0.3, 0.86));
    float band = exp(-pow(dot(d, mwAxis) * 3.2, 2.0));
    float mw = band * (0.5 * vnoise(d * 9.0) + 0.3 * vnoise(d * 23.0) + 0.2);
    col += night * (vec3(0.85, 0.9, 1.0) * star * tw2 * smoothstep(-0.05, 0.15, d.y) + vec3(0.03, 0.035, 0.05) * mw);
    // Moon
    float cm = dot(d, uMoonDir);
    col += night * vec3(0.9, 0.92, 1.0) * (smoothstep(0.99975, 0.9999, cm) * 6.0 + pow(max(cm,0.0), 80.0) * 0.08);
  }
  // Storm: flat grey overcast.
  vec3 stormCol = mix(vec3(0.02,0.025,0.03), vec3(0.42,0.45,0.5), day);
  col = mix(col, stormCol * (0.8 + 0.2 * hz), uStorm);
  // Below horizon: haze.
  col = mix(col, mix(horizonNight, horizonDay * 0.9, day), smoothstep(0.0, -0.08, d.y));
  gl_FragColor = vec4(col, 1.0);
}`;

const CLOUD_VERT = `
varying vec3 vW;
#include <common>
#include <logdepthbuf_pars_vertex>
void main(){
  vec4 w = modelMatrix * vec4(position,1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
  #include <logdepthbuf_vertex>
}`;

const CLOUD_FRAG = `
precision highp float;
varying vec3 vW;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform vec3 uSkyCol;
uniform vec3 uHaze;
uniform float uTime;
uniform float uStorm;
uniform vec3 uCam;
float h21(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float n2(vec2 p){ vec2 i=floor(p); vec2 f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(h21(i),h21(i+vec2(1,0)),f.x),mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x),f.y); }
float fbm(vec2 p){ float a=0.5; float s=0.0; for(int i=0;i<5;i++){ s+=a*n2(p); p=p*2.03+vec2(1.7,9.2); a*=0.5;} return s; }
void main(){
  vec2 p = vW.xz * 0.0016 + vec2(uTime*0.004, uTime*0.0015);
  float c = fbm(p);
  float c2 = fbm(p*3.1 + 4.0);
  float e = 0.018;
  float cx = fbm(p + vec2(e,0.0)) - c;
  float cz = fbm(p + vec2(0.0,e)) - c;
  vec3 n = normalize(vec3(-cx*24.0, 1.0, -cz*24.0));
  float lit = clamp(dot(n, normalize(uSunDir + vec3(0.0,0.15,0.0))), 0.0, 1.0);
  float dayK = smoothstep(-0.15, 0.2, uSunDir.y);
  vec3 base = mix(vec3(0.02,0.026,0.045), vec3(0.86,0.88,0.92), dayK);
  float puff = smoothstep(0.25, 0.75, c);
  vec3 col = base * (0.45 + 0.55*c2) * (0.6 + 0.5*puff) + uSunCol * lit * 0.75 * (0.5+0.8*puff) + uSkyCol * 0.3;
  col *= mix(1.0, 0.55, uStorm);
  float dist = length(vW.xz - uCam.xz);
  float haze = 1.0 - exp(-dist * 0.00013);
  col = mix(col, uHaze, clamp(haze, 0.0, 0.92));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export interface EnvState {
  sunDir: THREE.Vector3;
  sunColor: THREE.Color;
  sunIntensity: number;
  dayFactor: number;
  horizon: THREE.Color;
  exposure: number;
}

export class Environment {
  readonly group = new THREE.Group();
  readonly sun = new THREE.DirectionalLight(0xffffff, 3);
  readonly hemi = new THREE.HemisphereLight(0x8899bb, 0xd8e0ea, 0.6);
  readonly state: EnvState = {
    sunDir: new THREE.Vector3(),
    sunColor: new THREE.Color(),
    sunIntensity: 0,
    dayFactor: 0,
    horizon: new THREE.Color(),
    exposure: 1,
  };
  private readonly skyMat: THREE.ShaderMaterial;
  private readonly cloudMat: THREE.ShaderMaterial;
  private readonly moonDir = new THREE.Vector3(-0.55, 0.45, 0.35).normalize();
  private readonly lightDir = new THREE.Vector3();
  readonly cloudY: number;

  constructor(cloudY: number, seed: number, mobile: boolean) {
    this.cloudY = cloudY;
    this.group.name = 'environment';
    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      uniforms: {
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uMoonDir: { value: this.moonDir },
        uTime: { value: 0 },
        uStorm: { value: 0 },
      },
      side: THREE.BackSide,
      depthWrite: false,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), this.skyMat);
    sky.name = 'skyDome';
    sky.scale.setScalar(20000);
    sky.frustumCulled = false;
    sky.renderOrder = -10;
    this.group.add(sky);

    this.cloudMat = new THREE.ShaderMaterial({
      vertexShader: CLOUD_VERT,
      fragmentShader: CLOUD_FRAG,
      uniforms: {
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunCol: { value: new THREE.Color() },
        uSkyCol: { value: new THREE.Color() },
        uHaze: { value: new THREE.Color() },
        uTime: { value: 0 },
        uStorm: { value: 0 },
        uCam: { value: new THREE.Vector3() },
      },
      fog: false,
    });
    const clouds = new THREE.Mesh(new THREE.CircleGeometry(16000, 64).rotateX(-Math.PI / 2), this.cloudMat);
    clouds.name = 'cloudSea';
    clouds.position.y = cloudY;
    this.group.add(clouds);

    this.group.add(this.buildDistantRange(seed, mobile));

    this.sun.castShadow = true;
    const sm = mobile ? 1024 : 2048;
    this.sun.shadow.mapSize.set(sm, sm);
    const c = this.sun.shadow.camera;
    c.left = -55; c.right = 55; c.top = 55; c.bottom = -55; c.near = 1; c.far = 600;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.6;
    this.group.add(this.sun, this.sun.target, this.hemi);
  }

  /** Distant Himalayan/Karakoram skyline rising out of the cloud sea. */
  private buildDistantRange(seed: number, mobile: boolean): THREE.Mesh {
    const noise = new Noise2D(seed + 99);
    const segA = mobile ? 160 : 240;
    const segR = 40;
    const r0 = 2900;
    const r1 = 15000;
    const positions: number[] = [];
    const colors: number[] = [];
    const idx: number[] = [];
    // Named-peak style massifs: azimuth, radius, height above cloud sea, width.
    const peaks = [
      { az: 0.35, r: 6200, h: 520, w: 0.07 }, { az: 1.1, r: 9000, h: 380, w: 0.05 },
      { az: 2.0, r: 5200, h: 300, w: 0.06 }, { az: 2.9, r: 11000, h: 560, w: 0.05 },
      { az: 3.7, r: 7400, h: 420, w: 0.06 }, { az: 4.5, r: 5600, h: 260, w: 0.05 },
      { az: 5.2, r: 8800, h: 470, w: 0.05 }, { az: 5.85, r: 4600, h: 200, w: 0.06 },
    ];
    for (let j = 0; j <= segR; j++) {
      const tr = j / segR;
      const r = r0 + (r1 - r0) * Math.pow(tr, 1.6);
      for (let i = 0; i <= segA; i++) {
        const a = (i / segA) * Math.PI * 2;
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        let h = this.cloudY - 260 + noise.ridged(x * 0.0006, z * 0.0006, 5) * 420;
        for (const p of peaks) {
          let da = Math.abs(a - p.az);
          da = Math.min(da, Math.PI * 2 - da);
          const lat = da * r;
          const dr = r - p.r;
          const dist = Math.hypot(lat, dr * 1.15);
          const width = p.w * p.r;
          const k = Math.max(0, 1 - dist / width);
          h += Math.pow(k, 1.35) * (p.h + 300) * (0.85 + 0.15 * noise.ridged(x * 0.003, z * 0.003, 3));
        }
        h += noise.fbm(x * 0.002, z * 0.002, 3) * 60;
        positions.push(x, h, z);
        colors.push(1, 1, 1);
      }
    }
    for (let j = 0; j < segR; j++) {
      for (let i = 0; i < segA; i++) {
        const a = j * (segA + 1) + i;
        const b = a + 1;
        const c = a + segA + 1;
        const d = c + 1;
        idx.push(a, b, c, b, d, c);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const nrm = geo.getAttribute('normal');
    const col = new Float32Array(colors.length);
    for (let k = 0; k < nrm.count; k++) {
      const ny = nrm.getY(k);
      const y = positions[k * 3 + 1];
      const snow = smoothstep(0.55, 0.75, ny + (y - this.cloudY) * 0.0004);
      const rock = 0.22 + (noise.noise(k * 0.37, 0.5) * 0.5 + 0.5) * 0.08;
      col[k * 3] = rock + (0.9 - rock) * snow;
      col[k * 3 + 1] = rock + (0.92 - rock) * snow;
      col[k * 3 + 2] = rock * 1.05 + (0.96 - rock * 1.05) * snow;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'distantRange';
    return mesh;
  }

  /** hours: 0-24 local time. storm 0-1. */
  update(hours: number, storm: number, elapsed: number, camera: THREE.Camera, focus: THREE.Vector3): void {
    const dayFrac = (hours - 5.5) / 13;
    const el = Math.sin(dayFrac * Math.PI) * THREE.MathUtils.degToRad(68);
    const az = Math.PI / 2 + dayFrac * Math.PI;
    const s = this.state.sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
    const sy = s.y;
    const day = smoothstep(-0.1, 0.22, sy);
    this.state.dayFactor = day;

    const warm = smoothstep(-0.02, 0.35, sy);
    this.state.sunColor.setRGB(1.0, 0.42 + 0.55 * warm, 0.2 + 0.72 * warm);
    const sunUp = smoothstep(-0.03, 0.06, sy);
    this.state.sunIntensity = sunUp * (1.4 + 2.6 * warm) * (1 - storm * 0.8);

    // Moonlight carries the night so the snow stays readable.
    const night = 1 - smoothstep(-0.08, 0.05, sy);
    if (sunUp > 0.02) {
      this.lightDir.copy(s);
      this.sun.color.copy(this.state.sunColor);
      this.sun.intensity = this.state.sunIntensity;
    } else {
      this.lightDir.copy(this.moonDir);
      this.sun.color.setRGB(0.55, 0.65, 0.95);
      this.sun.intensity = 0.55 * night * (1 - storm * 0.7);
    }
    this.sun.position.copy(focus).addScaledVector(this.lightDir, 300);
    this.sun.target.position.copy(focus);
    this.sun.target.updateMatrixWorld();

    const sky = new THREE.Color().setRGB(0.05 + 0.25 * day, 0.08 + 0.35 * day, 0.18 + 0.55 * day);
    const twilight = Math.exp(-Math.abs(sy + 0.02) * 8) * (1 - storm);
    this.hemi.color.copy(sky).lerp(new THREE.Color(0.9, 0.55, 0.45), twilight * 0.35);
    this.hemi.groundColor.setRGB(0.3 + 0.55 * day, 0.32 + 0.56 * day, 0.38 + 0.56 * day);
    this.hemi.intensity = 0.35 + 0.75 * day + storm * 0.5 * day;

    this.state.horizon.setRGB(
      clamp(0.012 + 0.4 * day + twilight * 0.25, 0, 1),
      clamp(0.018 + 0.53 * day + twilight * 0.12, 0, 1),
      clamp(0.035 + 0.7 * day + twilight * 0.05, 0, 1),
    );
    if (storm > 0) this.state.horizon.lerp(new THREE.Color(0.35 * day + 0.02, 0.38 * day + 0.025, 0.42 * day + 0.03), storm);
    // Eyes adapt: brighter exposure at night so moonlit snow stays visible.
    this.state.exposure = 0.82 + 1.6 * (1 - day);

    const su = this.skyMat.uniforms;
    su.uSunDir.value.copy(s);
    su.uTime.value = elapsed;
    su.uStorm.value = storm;
    const cu = this.cloudMat.uniforms;
    cu.uSunDir.value.copy(s);
    (cu.uSunCol.value as THREE.Color).copy(this.state.sunColor).multiplyScalar(sunUp * (1 - storm * 0.7));
    (cu.uSkyCol.value as THREE.Color).copy(sky);
    (cu.uHaze.value as THREE.Color).copy(this.state.horizon);
    cu.uTime.value = elapsed;
    cu.uStorm.value = storm;
    cu.uCam.value.copy(camera.position);
  }
}
