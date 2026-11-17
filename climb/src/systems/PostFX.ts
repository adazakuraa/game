import * as THREE from 'three';

const VERT = `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D tScene;
uniform vec2 uRes;
uniform float uExposure;
uniform float uHypoxia;   // 0..1 tunnel vision, desaturation, blur
uniform float uCold;      // 0..1 frost on goggles
uniform float uFatigue;   // 0..1 pulsing darkening
uniform float uPulse;     // heartbeat phase 0..1
uniform float uFlash;     // impact flash
uniform float uWhiteout;  // storm whiteout
uniform float uTime;
uniform float uFade;      // 0..1 fade to black
uniform float uDrift;     // HACE hallucination warp

float hash(vec2 p){ p = fract(p*vec2(234.34,435.345)); p += dot(p, p+34.23); return fract(p.x*p.y); }
float vn(vec2 p){ vec2 i=floor(p); vec2 f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y); }

vec3 aces(vec3 x){
  // Narkowicz ACES fit
  x *= 0.6;
  return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14), 0.0, 1.0);
}
vec3 toSRGB(vec3 c){ return mix(c*12.92, 1.055*pow(c, vec3(1.0/2.4))-0.055, step(0.0031308, c)); }

void main(){
  vec2 uv = vUv;
  vec2 c = uv - 0.5;
  c.x *= uRes.x / uRes.y;
  float r = length(c);
  if (uDrift > 0.0) {
    uv += vec2(sin(uv.y*9.0 + uTime*1.3), cos(uv.x*7.0 + uTime*1.1)) * 0.006 * uDrift;
  }
  vec3 col = texture2D(tScene, uv).rgb;
  // Peripheral blur from hypoxia (cheap radial taps).
  float blurAmt = smoothstep(0.25, 0.85, r) * uHypoxia * 0.018 + uDrift*0.004;
  if (blurAmt > 0.0005) {
    vec2 dir = normalize(uv - 0.5 + 1e-5) * blurAmt;
    col = (col + texture2D(tScene, uv - dir).rgb + texture2D(tScene, uv + dir).rgb + texture2D(tScene, uv - dir*2.0).rgb) * 0.25;
  }
  col *= uExposure;
  vec3 mapped = aces(col);
  // Desaturate as SpO2 drops.
  float l = dot(mapped, vec3(0.2126, 0.7152, 0.0722));
  mapped = mix(mapped, vec3(l), uHypoxia * 0.55);
  // Tunnel vision + heartbeat pulse.
  float tunnel = smoothstep(0.95 - uHypoxia*0.55 - uFatigue*0.15, 0.25 - uHypoxia*0.05, r);
  float pulse = (1.0 - smoothstep(0.0, 0.25, uPulse)) * (uFatigue*0.25 + uHypoxia*0.25);
  mapped *= mix(1.0, tunnel, 0.35 + uHypoxia*0.55) * (1.0 - pulse * smoothstep(0.2, 0.9, r));
  // Goggle vignette (always a little).
  mapped *= 1.0 - smoothstep(0.55, 1.05, r) * 0.35;
  // Frost creeping in from the goggle rim.
  if (uCold > 0.01) {
    vec2 fuv = vec2(uv.x * uRes.x / uRes.y, uv.y);
    vec2 warp = vec2(vn(fuv*6.0), vn(fuv*6.0+3.7)) - 0.5;
    float fn = vn(fuv*14.0 + warp*3.0) * 0.5 + vn(fuv*41.0 + warp*5.0) * 0.3 + vn(fuv*130.0) * 0.2;
    // feathery crystal streaks pointing inward
    float ang = atan(c.y, c.x);
    fn += (vn(vec2(ang*18.0, r*6.0)) - 0.5) * 0.35;
    float edge = smoothstep(0.35, 0.95, r + fn*0.25);
    float frost = smoothstep(1.0 - uCold, 1.0 - uCold + 0.25, edge);
    vec3 fcol = vec3(0.82, 0.9, 0.97) * (0.75 + 0.25*fn);
    mapped = mix(mapped, fcol, frost * 0.7);
  }
  // Whiteout in storms.
  mapped = mix(mapped, vec3(dot(mapped, vec3(0.33)) * 0.5 + 0.45), uWhiteout * 0.35);
  // Impact flash
  mapped = mix(mapped, vec3(0.6, 0.05, 0.03), uFlash * 0.45);
  vec3 outc = toSRGB(clamp(mapped, 0.0, 1.0));
  // Film grain
  outc += (hash(uv*uRes + fract(uTime)*91.0) - 0.5) * 0.025;
  outc *= 1.0 - uFade;
  gl_FragColor = vec4(outc, 1.0);
}`;

export interface PostParams {
  exposure: number;
  hypoxia: number;
  cold: number;
  fatigue: number;
  pulse: number;
  flash: number;
  whiteout: number;
  fade: number;
  drift: number;
}

export class PostFX {
  private target: THREE.WebGLRenderTarget;
  private readonly material: THREE.ShaderMaterial;
  private readonly quadScene = new THREE.Scene();
  private readonly quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  readonly params: PostParams = {
    exposure: 1, hypoxia: 0, cold: 0, fatigue: 0, pulse: 0, flash: 0, whiteout: 0, fade: 0, drift: 0,
  };

  constructor(private readonly renderer: THREE.WebGLRenderer, mobile: boolean) {
    this.target = new THREE.WebGLRenderTarget(2, 2, {
      type: THREE.HalfFloatType,
      samples: mobile ? 2 : 4,
      depthBuffer: true,
    });
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tScene: { value: this.target.texture },
        uRes: { value: new THREE.Vector2(2, 2) },
        uExposure: { value: 1 },
        uHypoxia: { value: 0 },
        uCold: { value: 0 },
        uFatigue: { value: 0 },
        uPulse: { value: 0 },
        uFlash: { value: 0 },
        uWhiteout: { value: 0 },
        uTime: { value: 0 },
        uFade: { value: 0 },
        uDrift: { value: 0 },
      },
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    quad.frustumCulled = false;
    this.quadScene.add(quad);
  }

  resize(width: number, height: number): void {
    this.target.setSize(width, height);
    this.material.uniforms.uRes.value.set(width, height);
  }

  render(scene: THREE.Scene, overlay: THREE.Scene | null, camera: THREE.Camera, time: number): void {
    const r = this.renderer;
    r.setRenderTarget(this.target);
    r.autoClear = true;
    r.render(scene, camera);
    if (overlay) {
      r.autoClear = false;
      r.clearDepth();
      r.render(overlay, camera);
      r.autoClear = true;
    }
    r.setRenderTarget(null);
    const u = this.material.uniforms;
    const p = this.params;
    u.uExposure.value = p.exposure;
    u.uHypoxia.value = p.hypoxia;
    u.uCold.value = p.cold;
    u.uFatigue.value = p.fatigue;
    u.uPulse.value = p.pulse;
    u.uFlash.value = p.flash;
    u.uWhiteout.value = p.whiteout;
    u.uTime.value = time;
    u.uFade.value = p.fade;
    u.uDrift.value = p.drift;
    r.render(this.quadScene, this.quadCam);
  }

  dispose(): void {
    this.target.dispose();
    this.material.dispose();
  }
}
