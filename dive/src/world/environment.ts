import * as THREE from 'three';
import { UW } from '../render/underwater';
import { makeBubble } from '../render/textures';
import { heightAt, zoneAt, type ZoneId } from './layout';
import { clamp, lerp, mulberry32 } from '../utils/noise';

const ZONE_WATER: Record<ZoneId, [number, number, number, number]> = {
  // horizontal water color at ~5 m (linear RGB) and visibility in meters
  lagoon: [0.035, 0.27, 0.36, 38],
  reef: [0.02, 0.19, 0.34, 46],
  rocky: [0.02, 0.17, 0.28, 40],
  dropoff: [0.01, 0.12, 0.32, 56],
  offshore: [0.006, 0.09, 0.3, 64],
  deep: [0.004, 0.06, 0.2, 60],
  cold: [0.02, 0.15, 0.17, 26],
  ruins: [0.012, 0.15, 0.36, 52],
  bluehole: [0.006, 0.1, 0.38, 60],
  cave: [0.01, 0.16, 0.2, 34],
};

/** Water volume visuals: fog, lighting by depth, surface with Snell's window, god rays, marine snow, bubbles. */
export class Environment {
  readonly group = new THREE.Group();
  readonly fog = new THREE.FogExp2(0x1d6a8f, 0.03);
  readonly sun = new THREE.DirectionalLight(0xffffff, 2.5);
  readonly hemi = new THREE.HemisphereLight(0x8fd4ee, 0x2a2a22, 0.9);
  readonly diverLight = new THREE.SpotLight(0xfff1dd, 0, 38, 0.5, 0.6, 1.5);
  private surface: THREE.Mesh;
  private rays: THREE.Mesh[] = [];
  private rayMat: THREE.ShaderMaterial;
  private snow: THREE.Points;
  private snowMat: THREE.ShaderMaterial;
  private bubbles: THREE.Points;
  private bubbleData: { x: number; y: number; z: number; vy: number; life: number; s: number }[] = [];
  private bubblePos: Float32Array;
  private bubbleSize: Float32Array;
  private waterCol = new THREE.Color();
  private tmpCol = new THREE.Color();
  private smoothedZone = new THREE.Vector4(0.04, 0.27, 0.4, 46);
  lightOn = false;
  lightPower = 1;
  /** night dive (0/1) and cave-roof shade target (0/1); both darken sun, sky fill and water */
  night = 0;
  shade = 0;
  /** bioluminescent plankton sparkle (0..1), driven by how fast the diver moves at night */
  plankton = 0;
  private shadeS = 0;
  /** combined night / cave darkness 0..1 (read by the game for image-based light) */
  darkness = 0;
  narcosis = 0;
  exposure = 1;

  private shadowTick = 0;
  constructor(private scene: THREE.Scene, camera: THREE.PerspectiveCamera, private mobile = false) {
    scene.fog = this.fog;
    this.sun.position.copy(UW.uSunDir.value).multiplyScalar(100);
    this.sun.castShadow = true;
    const S = this.sun.shadow;
    S.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048);
    const half = mobile ? 20 : 26;
    Object.assign(S.camera, { left: -half, right: half, top: half, bottom: -half, near: 1, far: 140 });
    S.camera.updateProjectionMatrix();
    S.bias = -0.0006;
    S.normalBias = 0.04;
    S.radius = 2.5;
    this.group.add(this.sun, this.sun.target, this.hemi);
    camera.add(this.diverLight);
    camera.add(this.diverLight.target);
    this.diverLight.position.set(0.25, -0.2, 0);
    this.diverLight.target.position.set(0, -0.6, -10);

    // background sphere: fully fogged, so it shows the direction-aware water color
    const bg = new THREE.Mesh(
      new THREE.SphereGeometry(900, 24, 12),
      new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide, fog: true, depthWrite: false }),
    );
    bg.renderOrder = -10;
    bg.frustumCulled = false;
    bg.name = 'bg';
    this.group.add(bg);
    bg.onBeforeRender = (_r, _s, cam) => bg.position.copy(cam.position);

    // --- surface seen from below
    const sMat = new THREE.ShaderMaterial({
      fog: true,
      side: THREE.DoubleSide,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        { uTime: { value: 0 }, uSunDir: { value: UW.uSunDir.value }, uBright: { value: 1 } },
      ]),
      vertexShader: /* glsl */ `
        #include <fog_pars_vertex>
        varying vec3 vW;
        void main(){
          vec4 w = modelMatrix * vec4(position,1.0);
          vW = w.xyz;
          vec4 mvPosition = viewMatrix * w;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform vec3 uSunDir; uniform float uBright;
        varying vec3 vW;
        #include <fog_pars_fragment>
        vec2 wav(vec2 p, float t){
          vec2 g = vec2(0.0);
          g += vec2(cos(p.x*0.9 + t*1.3), 0.0)*0.5;
          g += vec2(0.0, cos(p.y*1.1 - t*1.1))*0.45;
          g += vec2(cos((p.x+p.y)*1.7 + t*1.9))*0.25;
          g += vec2(cos((p.x*2.9 - p.y*2.1) - t*2.3), sin(p.x*2.3 + p.y*3.1 + t*2.0))*0.15;
          return g;
        }
        void main(){
          vec3 V = normalize(vW - cameraPosition);
          vec2 g = wav(vW.xz*0.6, uTime);
          vec3 N = normalize(vec3(-g.x*0.16, -1.0, -g.y*0.16)); // pointing down into the water
          float cosI = dot(-V, N);
          float sinI = sqrt(max(0.0, 1.0 - cosI*cosI));
          // Snell's window: beyond ~48.6 deg total internal reflection
          float win = smoothstep(0.80, 0.70, sinI);
          vec3 refr = refract(V, -N, 1.333);
          vec3 sky = mix(vec3(0.35,0.62,0.82), vec3(0.75,0.9,0.98), pow(max(refr.y,0.0), 3.0)) * (0.75 + 0.25 * g.x);
          float sun = pow(max(dot(normalize(refr), uSunDir), 0.0), 220.0) * 6.0 + pow(max(dot(normalize(refr), uSunDir),0.0), 12.0)*0.6;
          vec3 inside = (sky + sun) * uBright;
          vec3 tir = fogColor * (0.7 + 0.3*g.x);
          float ring = smoothstep(0.66, 0.76, sinI) * smoothstep(0.84, 0.76, sinI);
          vec3 col = mix(tir, inside, win) + ring * 0.35 * uBright;
          gl_FragColor = vec4(col, 1.0);
          #include <fog_fragment>
        }`,
    });
    this.surface = new THREE.Mesh(new THREE.PlaneGeometry(700, 700, 1, 1), sMat);
    this.surface.rotation.x = -Math.PI / 2;
    this.surface.frustumCulled = false;
    this.group.add(this.surface);

    // --- god rays
    this.rayMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { uTime: UW.uTime, uStrength: { value: 1 }, uCamPos: { value: new THREE.Vector3() }, uColor: { value: new THREE.Color(0.6, 0.85, 0.95) } },
      vertexShader: /* glsl */ `
        varying vec2 vUv; varying vec3 vW; attribute float aSeed; varying float vSeed;
        void main(){ vUv = uv; vSeed = aSeed; vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform float uStrength; uniform vec3 uCamPos; uniform vec3 uColor;
        varying vec2 vUv; varying vec3 vW; varying float vSeed;
        void main(){
          float edge = smoothstep(0.0, 0.45, vUv.x) * smoothstep(1.0, 0.55, vUv.x);
          float stripes = 0.55 + 0.45*sin(vUv.x*18.0 + sin(uTime*0.4 + vSeed*7.0)*3.0);
          float flick = 0.6 + 0.4*sin(uTime*0.9 + vSeed*13.0) * sin(uTime*0.37 + vSeed*3.0);
          float vert = pow(vUv.y, 1.6); // top bright
          float d = length(vW - uCamPos);
          float nearFade = smoothstep(2.0, 9.0, d);
          float farFade = 1.0 - smoothstep(25.0, 60.0, d);
          float a = edge * stripes * flick * vert * nearFade * farFade * uStrength * 0.085;
          gl_FragColor = vec4(uColor * a, 1.0);
        }`,
    });
    const r = mulberry32(5);
    for (let i = 0; i < 18; i++) {
      const w = 2 + r() * 6;
      const geo = new THREE.PlaneGeometry(w, 46, 1, 1);
      geo.translate(0, -23, 0);
      // lean with the refracted sun
      const p = geo.attributes.position as THREE.BufferAttribute;
      for (let k = 0; k < p.count; k++) {
        const y = p.getY(k);
        p.setX(k, p.getX(k) - y * 0.18);
      }
      geo.setAttribute('aSeed', new THREE.BufferAttribute(new Float32Array(p.count).fill(r()), 1));
      const m = new THREE.Mesh(geo, this.rayMat);
      m.frustumCulled = false;
      m.userData.ox = (r() - 0.5) * 70;
      m.userData.oz = (r() - 0.5) * 70;
      this.rays.push(m);
      this.group.add(m);
    }

    // --- marine snow (wraps around camera in shader)
    const N = 2200;
    const sp = new Float32Array(N * 3);
    const ss = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      sp[i * 3] = r() * 40;
      sp[i * 3 + 1] = r() * 40;
      sp[i * 3 + 2] = r() * 40;
      ss[i] = 0.4 + r() * r() * 1.8;
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    sg.setAttribute('aSize', new THREE.BufferAttribute(ss, 1));
    this.snowMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: UW.uTime,
        uCam: { value: new THREE.Vector3() },
        uCamDir: { value: new THREE.Vector3(0, 0, -1) },
        uAmb: { value: 0.3 },
        uLight: { value: 0 },
        uScale: { value: 500 },
        uGlow: { value: 0 },
      },
      vertexShader: /* glsl */ `
        uniform float uTime; uniform vec3 uCam; uniform vec3 uCamDir; uniform float uAmb; uniform float uLight; uniform float uScale; uniform float uGlow;
        attribute float aSize; varying float vA; varying float vG;
        void main(){
          vec3 p = position + vec3(sin(uTime*0.1+position.y)*0.6, -uTime*0.05, cos(uTime*0.13+position.x)*0.6);
          p = mod(p - uCam + 20.0, 40.0) - 20.0 + uCam;
          vec4 mv = viewMatrix * vec4(p,1.0);
          float d = -mv.z;
          vec3 toP = normalize(p - uCam);
          float cone = smoothstep(0.82, 0.97, dot(toP, uCamDir)) * (1.0 - smoothstep(4.0, 16.0, d));
          vA = (uAmb * (1.0 - smoothstep(8.0, 20.0, d)) + cone * uLight) * smoothstep(0.3, 1.2, d);
          // night plankton: a third of the motes flash blue-green near the moving diver
          vG = uGlow * step(0.66, fract(aSize * 13.7 + floor(uTime * 1.3 + aSize * 7.0) * 0.37)) * (1.0 - smoothstep(1.0, 6.0, d));
          gl_PointSize = aSize * uScale / max(d, 0.5) * 0.06;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying float vA; varying float vG;
        void main(){ vec2 c = gl_PointCoord - 0.5; float a = smoothstep(0.5, 0.0, length(c)); gl_FragColor = vec4((vec3(0.9,0.95,1.0)*vA + vec3(0.25,0.95,1.0)*vG*2.5)*a, 1.0); }`,
    });
    this.snow = new THREE.Points(sg, this.snowMat);
    this.snow.frustumCulled = false;
    this.group.add(this.snow);

    // --- exhale bubbles
    const B = 90;
    this.bubblePos = new Float32Array(B * 3);
    this.bubbleSize = new Float32Array(B);
    for (let i = 0; i < B; i++) this.bubbleData.push({ x: 0, y: 999, z: 0, vy: 0, life: 0, s: 0 });
    const bg2 = new THREE.BufferGeometry();
    bg2.setAttribute('position', new THREE.BufferAttribute(this.bubblePos, 3));
    bg2.setAttribute('aSize', new THREE.BufferAttribute(this.bubbleSize, 1));
    const bubbleTex = makeBubble();
    const bMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uTex: { value: bubbleTex }, uScale: this.snowMat.uniforms.uScale, uBright: { value: 1 } },
      vertexShader: /* glsl */ `attribute float aSize; uniform float uScale; varying float vA;
        void main(){ vec4 mv = viewMatrix*modelMatrix*vec4(position,1.0); vA = aSize > 0.0 ? 1.0 : 0.0;
          gl_PointSize = aSize * uScale / max(-mv.z, 0.2); gl_Position = projectionMatrix*mv; }`,
      fragmentShader: /* glsl */ `uniform sampler2D uTex; uniform float uBright; varying float vA;
        void main(){ vec4 t = texture2D(uTex, gl_PointCoord); gl_FragColor = vec4(t.rgb*uBright, t.a*vA); }`,
    });
    this.bubbles = new THREE.Points(bg2, bMat);
    this.bubbles.frustumCulled = false;
    this.group.add(this.bubbles);

    scene.add(this.group);
  }

  exhale(cam: THREE.PerspectiveCamera, strength = 1): void {
    const r = Math.random;
    let spawned = 0;
    const want = Math.floor(14 * strength + r() * 8);
    for (const b of this.bubbleData) {
      if (b.life > 0) continue;
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
      const side = r() < 0.5 ? -1 : 1;
      b.x = cam.position.x + right.x * side * (0.35 + r() * 0.2) + fwd.x * 0.15 + (r() - 0.5) * 0.1;
      b.z = cam.position.z + right.z * side * (0.35 + r() * 0.2) + fwd.z * 0.15 + (r() - 0.5) * 0.1;
      b.y = cam.position.y - 0.25 - r() * 0.15;
      b.vy = 0.5 + r() * 0.9;
      b.s = 0.012 + r() * r() * 0.05;
      b.life = 6;
      if (++spawned >= want) break;
    }
  }

  update(dt: number, cam: THREE.PerspectiveCamera, renderer: THREE.WebGLRenderer, time: number): void {
    const cp = cam.position;
    const depth = Math.max(0, -cp.y);
    UW.uTime.value = time;
    UW.uCamY.value = cp.y;

    const zone = zoneAt(cp.x, cp.z);
    const zw = ZONE_WATER[zone];
    const k = 1 - Math.exp(-dt * 0.6);
    this.smoothedZone.x = lerp(this.smoothedZone.x, zw[0], k);
    this.smoothedZone.y = lerp(this.smoothedZone.y, zw[1], k);
    this.smoothedZone.z = lerp(this.smoothedZone.z, zw[2], k);
    this.smoothedZone.w = lerp(this.smoothedZone.w, zw[3], k);

    // water color darkens with depth, red and green absorbed first
    const att = Math.exp(-Math.max(0, depth - 4) / 38);
    const attR = Math.exp(-depth / 9);
    const attG = Math.exp(-Math.max(0, depth - 3) / 46);
    this.waterCol.setRGB(
      this.smoothedZone.x * (0.4 + 0.6 * attR) * att,
      this.smoothedZone.y * attG * att,
      this.smoothedZone.z * att * (0.35 + 0.65 * Math.exp(-depth / 160)),
    );
    this.shadeS = lerp(this.shadeS, this.shade, 1 - Math.exp(-dt * 2.5));
    const D = Math.max(this.night * 0.97, this.shadeS * 0.95);
    this.darkness = D;
    this.waterCol.multiplyScalar(1 - D * 0.88);
    // keep a faint floor so the deep is not pure black
    this.waterCol.r = Math.max(this.waterCol.r, 0.0006);
    this.waterCol.g = Math.max(this.waterCol.g, 0.0025);
    this.waterCol.b = Math.max(this.waterCol.b, 0.006);
    this.fog.color.copy(this.waterCol);
    let vis = this.smoothedZone.w;
    if (depth > 120) vis = lerp(vis, 40, clamp((depth - 120) / 150, 0, 1));
    vis *= 1 - this.narcosis * 0.3;
    this.fog.density = 1.75 / vis;

    // daylight
    const day = Math.exp(-depth / 24);
    this.sun.intensity = 3.0 * day * (1 - D);
    // sun shadows: crisp in the shallows, softer and weaker with depth, off in the deep
    const sh = this.sun.shadow;
    sh.intensity = clamp(Math.exp(-depth / 22) * 1.05, 0, 0.92) * (1 - D);
    sh.radius = 2 + depth * 0.25;
    const camS = sh.camera as THREE.OrthographicCamera;
    const texel = (camS.right - camS.left) / sh.mapSize.x;
    const sd = UW.uSunDir.value;
    // snap the light's focus to shadow texels (in light space) to avoid shimmering
    const fx = Math.round(cp.x / texel) * texel, fz = Math.round(cp.z / texel) * texel;
    const fy = Math.round(cp.y / texel) * texel;
    this.sun.target.position.set(fx, fy - 4, fz);
    this.sun.position.set(fx + sd.x * 70, fy - 4 + sd.y * 70, fz + sd.z * 70);
    this.sun.target.updateMatrixWorld();
    this.sun.updateMatrixWorld();
    this.shadowTick++;
    renderer.shadowMap.needsUpdate = depth < 45 && (!this.mobile || this.shadowTick % 2 === 0);
    this.tmpCol.setRGB(0.45 + 0.55 * Math.exp(-depth / 6), 0.82 + 0.18 * Math.exp(-depth / 25), 1);
    this.sun.color.copy(this.tmpCol);
    UW.uSunCol.value.copy(this.tmpCol);
    // ambient fill is low in the shallows so sunlit vs. shaded reads clearly; it takes over with depth
    this.hemi.intensity = ((0.38 + 0.25 * clamp(depth / 25, 0, 1)) * Math.exp(-depth / 40)) * (1 - D * 0.96) + 0.015 * (1 - D * 0.6);
    this.hemi.color.setRGB(0.42 + 0.3 * attR, 0.78, 0.95);
    this.hemi.groundColor.setRGB(0.16 * attR + 0.03, 0.14 * att + 0.03, 0.1 * att + 0.04);
    UW.uCaustic.value = clamp(Math.exp(-depth / 18) * 1.1, 0, 1.0) * (1 - D);

    // diver light
    const target = this.lightOn ? (depth > 120 ? 1.0 : 0.75) * this.lightPower : 0;
    this.diverLight.intensity = lerp(this.diverLight.intensity, target * 30, 1 - Math.exp(-dt * 10));
    this.diverLight.distance = 30 + 14 * this.lightPower;

    // exposure: eyes adapt somewhat to darkness
    this.exposure = lerp(this.exposure, 0.92 + clamp(depth / 60, 0, 1) * 0.6, 1 - Math.exp(-dt * 0.5));
    renderer.toneMappingExposure = this.exposure;

    // surface follows camera
    this.surface.position.set(cp.x, 0, cp.z);
    const sm = this.surface.material as THREE.ShaderMaterial;
    sm.uniforms.uTime.value = time;
    sm.uniforms.uBright.value = (0.75 + 0.25 * Math.exp(-depth / 10)) * (1 - this.night * 0.82);
    this.surface.visible = depth < 70;

    // rays follow camera on a wrapping grid
    const rayStrength = clamp(Math.exp(-depth / 20) * 1.2, 0, 1) * (1 - this.night);
    this.rayMat.uniforms.uStrength.value = rayStrength;
    this.rayMat.uniforms.uCamPos.value.copy(cp);
    this.rayMat.uniforms.uColor.value.setRGB(0.45 + 0.4 * attR, 0.85, 0.95);
    for (const m of this.rays) {
      m.visible = rayStrength > 0.03;
      if (!m.visible) continue;
      const wx = Math.round((cp.x - m.userData.ox) / 70) * 70 + m.userData.ox;
      const wz = Math.round((cp.z - m.userData.oz) / 70) * 70 + m.userData.oz;
      m.position.set(wx, 0, wz);
      m.rotation.y = Math.atan2(cp.x - wx, cp.z - wz);
    }

    // marine snow
    const su = this.snowMat.uniforms;
    su.uCam.value.copy(cp);
    cam.getWorldDirection(su.uCamDir.value);
    su.uAmb.value = (0.1 + 0.32 * Math.exp(-depth / 30) + (depth > 150 ? 0.05 : 0)) * (1 - D * 0.85);
    su.uGlow.value = lerp(su.uGlow.value, this.night * this.plankton, 1 - Math.exp(-dt * 4));
    su.uLight.value = (this.diverLight.intensity / 30) * 0.9;
    su.uScale.value = renderer.domElement.height / 2;

    // bubbles
    let i = 0;
    for (const b of this.bubbleData) {
      if (b.life > 0) {
        b.life -= dt;
        b.vy = Math.min(b.vy + dt * 0.8, 1.8);
        b.y += b.vy * dt;
        b.x += Math.sin(time * 9 + i) * 0.004;
        b.z += Math.cos(time * 7 + i * 1.3) * 0.004;
        if (b.y > -0.05) b.life = 0;
      }
      this.bubblePos[i * 3] = b.x;
      this.bubblePos[i * 3 + 1] = b.life > 0 ? b.y : 9999;
      this.bubblePos[i * 3 + 2] = b.z;
      this.bubbleSize[i] = b.life > 0 ? b.s : 0;
      i++;
    }
    this.bubbles.geometry.attributes.position.needsUpdate = true;
    this.bubbles.geometry.attributes.aSize.needsUpdate = true;
    (this.bubbles.material as THREE.ShaderMaterial).uniforms.uBright.value = 0.25 + 0.75 * Math.exp(-depth / 30) + su.uLight.value * 0.5;
  }

  bottomAt(x: number, z: number): number {
    return heightAt(x, z);
  }
}
