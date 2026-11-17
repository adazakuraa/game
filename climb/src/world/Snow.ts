import * as THREE from 'three';

const VERT = `
uniform float uTime;
uniform vec3 uCam;
uniform vec3 uWind;
uniform float uSize;
uniform float uBox;
attribute float aSeed;
varying float vAlpha;
void main(){
  vec3 p = position;
  // drift with wind, wrap inside a box that follows the camera
  p += uWind * uTime * (0.7 + aSeed*0.6);
  p.y -= uTime * (0.6 + aSeed*0.8);
  p.x += sin(uTime*1.7 + aSeed*30.0) * 0.4;
  p.z += cos(uTime*1.3 + aSeed*20.0) * 0.4;
  vec3 rel = mod(p - uCam + uBox*0.5, uBox) - uBox*0.5;
  vec4 mv = viewMatrix * vec4(uCam + rel, 1.0);
  gl_Position = projectionMatrix * mv;
  float d = -mv.z;
  gl_PointSize = uSize * (0.6 + aSeed) * 60.0 / max(d, 0.5);
  vAlpha = smoothstep(uBox*0.5, uBox*0.2, length(rel)) * smoothstep(0.2, 1.2, d);
}`;

const FRAG = `
uniform vec3 uColor;
uniform float uOpacity;
varying float vAlpha;
void main(){
  vec2 c = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.1, length(c));
  gl_FragColor = vec4(uColor, a * vAlpha * uOpacity);
}`;

/** Wind-driven spindrift and snowfall around the camera. */
export class Snow {
  readonly points: THREE.Points;
  private readonly mat: THREE.ShaderMaterial;

  constructor(count: number) {
    const box = 34;
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * box;
      pos[i * 3 + 1] = (Math.random() - 0.5) * box;
      pos[i * 3 + 2] = (Math.random() - 0.5) * box;
      seed[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uCam: { value: new THREE.Vector3() },
        uWind: { value: new THREE.Vector3(4, 0, 0) },
        uSize: { value: 0.12 },
        uBox: { value: box },
        uColor: { value: new THREE.Color(1, 1, 1) },
        uOpacity: { value: 0.8 },
      },
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.name = 'spindrift';
  }

  update(time: number, cam: THREE.Vector3, windVec: THREE.Vector3, intensity: number, light: number): void {
    const u = this.mat.uniforms;
    u.uTime.value = time;
    u.uCam.value.copy(cam);
    u.uWind.value.copy(windVec);
    u.uOpacity.value = Math.min(1, 0.12 + intensity * 0.9);
    u.uSize.value = 0.08 + intensity * 0.08;
    (u.uColor.value as THREE.Color).setScalar(0.35 + light * 0.9);
    this.points.geometry.setDrawRange(0, Math.floor(this.points.geometry.getAttribute('position').count * (0.25 + 0.75 * Math.min(1, intensity))));
  }
}
