import * as THREE from 'three';
import type { MountainDef, Vec3Tuple } from '../game/Mountains';
import { altitudeToWorldY } from '../game/Mountains';
import { Noise2D, smoothstep } from '../utils/noise';
import { createTerrainTextures } from './TerrainTextures';

interface Segment {
  ax: number; az: number; ah: number;
  dx: number; dz: number; dh: number;
  len2: number;
}

function buildSegments(poly: Vec3Tuple[]): Segment[] {
  const segs: Segment[] = [];
  for (let i = 0; i < poly.length - 1; i++) {
    const [ax, az, ah] = poly[i];
    const [bx, bz, bh] = poly[i + 1];
    const dx = bx - ax;
    const dz = bz - az;
    segs.push({ ax, az, ah, dx, dz, dh: bh - ah, len2: dx * dx + dz * dz || 1 });
  }
  return segs;
}

export interface Crack {
  cx: number; cz: number;
  nx: number; nz: number;
  vx: number; vz: number;
  routeX: number; routeZ: number;
  half: number; halfLen: number; depth: number;
}

function smax(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.max(a, b) + h * h * k * 0.25;
}

/** Analytic mountain height field built from ridge polylines plus fractal noise. */
export class MountainField {
  private readonly ridges: Segment[][];
  private readonly noise: Noise2D;
  private readonly noise2: Noise2D;
  lastRouteDistance = 0;
  readonly cracks: Crack[] = [];
  private readonly flat: Set<number>;

  constructor(readonly def: MountainDef) {
    this.ridges = def.ridges.map(buildSegments);
    this.noise = new Noise2D(def.seed);
    this.noise2 = new Noise2D(def.seed * 7 + 3);
    this.flat = new Set(def.flatRidges ?? []);
    for (const c of def.crevasses ?? []) {
      const i = Math.min(Math.floor(c.at), def.route.length - 2);
      const f = c.at - i;
      const a = def.route[i];
      const b = def.route[i + 1];
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const l = Math.hypot(dx, dz) || 1;
      const ang = c.angle ?? 0;
      // n: crack normal (≈ route direction), v: along the crack
      const ux = dx / l, uz = dz / l;
      const nx = ux * Math.cos(ang) - uz * Math.sin(ang);
      const nz = ux * Math.sin(ang) + uz * Math.cos(ang);
      this.cracks.push({
        cx: a[0] + dx * f, cz: a[1] + dz * f,
        nx, nz, vx: -nz, vz: nx,
        routeX: ux, routeZ: uz,
        half: c.width / 2, halfLen: c.length / 2, depth: 24,
      });
    }
  }

  /** Depth of crevasse cut at a point (0 outside cracks). */
  crevasseDepth(x: number, z: number): number {
    let depth = 0;
    for (const c of this.cracks) {
      const px = x - c.cx;
      const pz = z - c.cz;
      const t = Math.abs(px * c.vx + pz * c.vz);
      if (t > c.halfLen) continue;
      const across = Math.abs(px * c.nx + pz * c.nz);
      if (across > c.half) continue;
      const edge = smoothstep(c.half, c.half - 0.7, across);
      const ends = 1 - smoothstep(c.halfLen - 8, c.halfLen, t);
      depth = Math.max(depth, c.depth * edge * ends);
    }
    return depth;
  }

  height(x: number, z: number): number {
    const h = this.surfaceHeight(x, z);
    return this.cracks.length ? h - this.crevasseDepth(x, z) : h;
  }

  /** Snow surface ignoring crevasses (used for ropes, ladders, trail). */
  surfaceHeight(x: number, z: number): number {
    const def = this.def;
    const s = def.faceSlope;
    const w = def.crestWidth;
    let h = def.floor + this.noise.fbm(x * 0.0012, z * 0.0012, 4) * 90;
    let routeD = 1e9;
    for (let r = 0; r < this.ridges.length; r++) {
      const segs = this.ridges[r];
      let best = 1e12;
      let crest = 0;
      for (let i = 0; i < segs.length; i++) {
        const sg = segs[i];
        let t = ((x - sg.ax) * sg.dx + (z - sg.az) * sg.dz) / sg.len2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const px = sg.ax + sg.dx * t - x;
        const pz = sg.az + sg.dz * t - z;
        const d2 = px * px + pz * pz;
        if (d2 < best) {
          best = d2;
          crest = sg.ah + sg.dh * t;
        }
      }
      const d = Math.sqrt(best);
      if (r === 0) routeD = d;
      let rh: number;
      if (r === 0 && def.valley) {
        // Glacier: U-shaped valley floor rising gently away from the route line.
        const dc = Math.min(d, 220);
        rh = crest + 0.0009 * dc * dc;
      } else if (this.flat.has(r)) {
        const ww = 140;
        rh = crest - 0.22 * (Math.sqrt(d * d + ww * ww) - ww);
      } else {
        // Faces get a little steeper higher up, flatter towards the glacier.
        const slope = s * (r === 0 ? 1 : 1.08);
        rh = crest - slope * (Math.sqrt(d * d + w * w) - w) + 0.00022 * d * d;
      }
      h = smax(h, rh, 28);
    }
    this.lastRouteDistance = routeD;

    // Detail: keep the route crest walkable, rugged faces away from it.
    const away = smoothstep(4, 45, routeD);
    const rugged = this.noise.ridged(x * 0.012, z * 0.012, 5);
    const big = this.noise2.fbm(x * 0.004, z * 0.004, 3);
    h += (rugged - 0.45) * (1.2 + away * 13) + big * away * 22;
    // Fall-line ribs and couloirs: noise stretched radially from the summit.
    const ang = Math.atan2(z, x);
    const rad = Math.hypot(x, z);
    const rib = this.noise2.ridged(Math.cos(ang) * 4.2, Math.sin(ang) * 4.2 + rad * 0.006, 4);
    h += (rib - 0.5) * away * (def.valley ? 10 : 26) * smoothstep(60, 260, rad);
    // Cliff bands: soft terracing on the faces away from the route gives layered
    // rock steps with snow ledges, as on real Himalayan walls.
    if (away > 0.05 && !def.valley || (def.valley && routeD > 120)) {
      const T = 7.5;
      const q = h / T;
      const fl = Math.floor(q);
      const fr = q - fl;
      const stepped = (fl + smoothstep(0.25, 0.75, fr)) * T;
      const k = away * 0.55 * smoothstep(0.3, 0.7, this.noise2.noise(x * 0.006 + 3, z * 0.006));
      h += (stepped - h) * k;
    }
    // Icefall: tumbled glacier surface with ice blocks.
    if (def.seracField) {
      // Tumbled glacier: flat-topped slabs with steep broken edges, not spikes.
      const b1 = this.noise.noise(x * 0.035, z * 0.035);
      const b2 = this.noise2.noise(x * 0.07 + 11, z * 0.07);
      const slab = smoothstep(0.05, 0.18, b1) * 2.6 + smoothstep(0.2, 0.32, b2) * 1.4;
      h += slab * smoothstep(5, 14, routeD);
    }
    // Gentle boot-scale undulation on the crest itself.
    h += this.noise2.noise(x * 0.09, z * 0.09) * 0.35;
    return h;
  }

  /** Surface normal from central differences. */
  normal(x: number, z: number, out = new THREE.Vector3(), e = 0.6): THREE.Vector3 {
    const hx = this.height(x + e, z) - this.height(x - e, z);
    const hz = this.height(x, z + e) - this.height(x, z - e);
    return out.set(-hx, 2 * e, -hz).normalize();
  }
}

export interface PatchFrame {
  ox: number; oz: number; // centre
  ux: number; uz: number; // along axis
  vx: number; vz: number; // across axis
  halfL: number; halfW: number;
}

export function computePatchFrame(def: MountainDef): PatchFrame {
  const camp = def.route[0];
  const ux0 = 0 - camp[0];
  const uz0 = 0 - camp[1];
  const len = Math.hypot(ux0, uz0);
  const ux = ux0 / len;
  const uz = uz0 / len;
  const vx = -uz;
  const vz = ux;
  let maxLat = 0;
  for (const p of def.route) {
    const lat = Math.abs((p[0] - camp[0]) * vx + (p[1] - camp[1]) * vz);
    maxLat = Math.max(maxLat, lat);
  }
  return {
    ox: camp[0] + ux * len * 0.5,
    oz: camp[1] + uz * len * 0.5,
    ux, uz, vx, vz,
    halfL: len * 0.5 + 95,
    halfW: maxLat + (def.valley ? 170 : 105),
  };
}

function patchInsideFactor(f: PatchFrame, x: number, z: number): number {
  const dx = x - f.ox;
  const dz = z - f.oz;
  const a = Math.abs(dx * f.ux + dz * f.uz);
  const b = Math.abs(dx * f.vx + dz * f.vz);
  const ea = f.halfL - a;
  const eb = f.halfW - b;
  const e = Math.min(ea, eb);
  return smoothstep(0, 5, e);
}

export interface TerrainUniforms {
  uSunDir: { value: THREE.Vector3 };
  uSunCol: { value: THREE.Color };
  uTime: { value: number };
  uCloudShadow: { value: number };
  uHazeBase: { value: number };
  uNear: { value: THREE.Vector3 };
  uSparkle: { value: number };
  uBandLow: { value: number };
  uBandHigh: { value: number };
  uSnowCover: { value: number };
  uBandCol: { value: THREE.Vector3 };
}

export function createTerrainMaterial(def: MountainDef, maxAniso: number): {
  material: THREE.MeshStandardMaterial;
  uniforms: TerrainUniforms;
} {
  const tex = createTerrainTextures(def.seed);
  for (const t of [tex.snowNormal, tex.rockNormal, tex.rockAlbedo]) {
    t.anisotropy = Math.min(8, maxAniso);
  }
  const uniforms: TerrainUniforms = {
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunCol: { value: new THREE.Color(1, 1, 1) },
    uTime: { value: 0 },
    uCloudShadow: { value: 0 },
    uHazeBase: { value: -300 },
    uNear: { value: new THREE.Vector3(0, 0, -1) },
    uSparkle: { value: 1 },
    uBandLow: { value: altitudeToWorldY(def, def.rockBand[0]) },
    uBandHigh: { value: altitudeToWorldY(def, def.rockBand[1]) },
    uSnowCover: { value: 1 },
    uBandCol: { value: new THREE.Vector3(...(def.bandColor ?? [0.5, 0.41, 0.27])) },
  };
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.85,
    metalness: 0,
  });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms, {
      tSnowN: { value: tex.snowNormal },
      tRockN: { value: tex.rockNormal },
      tRockA: { value: tex.rockAlbedo },
    });
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         varying vec3 vWPos;
         varying vec3 vWNrm;
         attribute float aCrev;
         varying float vCrev;
         attribute float aAO;
         varying float vAO;
         attribute float aNear;
         varying float vNear;`,
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
         vCrev = aCrev;
         vAO = aAO;
         vNear = aNear;
         vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
         vWNrm = normalize(mat3(modelMatrix) * objectNormal);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         varying vec3 vWPos;
         varying vec3 vWNrm;
         uniform sampler2D tSnowN;
         uniform sampler2D tRockN;
         uniform sampler2D tRockA;
         uniform float uSparkle;
         uniform float uBandLow;
         uniform float uBandHigh;
         uniform float uSnowCover;
         uniform vec3 uBandCol;
         uniform vec3 uSunDir;
         uniform vec3 uSunCol;
         uniform float uTime;
         uniform float uCloudShadow;
         uniform float uHazeBase;
         uniform vec3 uNear;
         varying float vNear;
         varying float vCrev;
         varying float vAO;
         float tHash(vec3 p){ p = fract(p*0.3183099+0.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
         float tNoise(vec2 p){ vec2 i=floor(p); vec2 f=fract(p); f=f*f*(3.0-2.0*f);
           float a=tHash(vec3(i,1.0)); float b=tHash(vec3(i+vec2(1,0),1.0));
           float c=tHash(vec3(i+vec2(0,1),1.0)); float d=tHash(vec3(i+vec2(1,1),1.0));
           return mix(mix(a,b,f.x),mix(c,d,f.x),f.y); }
         vec3 triW(vec3 n){ vec3 w = pow(abs(n), vec3(4.0)); return w/(w.x+w.y+w.z); }
         float gRock; float gIce; float gSnow;`,
      )
      .replace(
        '#include <map_fragment>',
        `
        // The high-res ground patch replaces the coarse terrain around the player.
        if (vNear < 0.5 && uNear.z > 0.0 && abs(vWPos.x - uNear.x) < uNear.z && abs(vWPos.z - uNear.y) < uNear.z) discard;
        vec3 wn = normalize(vWNrm);
        float slopeY = wn.y;
        float camDist = length(vWPos - cameraPosition);
        float n1 = tNoise(vWPos.xz*0.045);
        float n2 = tNoise(vWPos.xz*0.31 + 7.0);
        float n3 = tNoise(vWPos.xz*0.009 + 3.1);
        vec3 tw = triW(wn);
        // Rock micro-relief decides where snow can sit on ledges.
        // Coarse sample far away, fine sample close up, so ledge snow never turns into speckle.
        float ledgeFine = 1.0 - smoothstep(20.0, 70.0, camDist);
        vec3 rNyF = texture2D(tRockN, vWPos.xz*0.08).xyz*2.0-1.0;
        vec3 rNxF = texture2D(tRockN, vWPos.zy*0.08).xyz*2.0-1.0;
        vec3 rNyC = texture2D(tRockN, vWPos.xz*0.018+0.2).xyz*2.0-1.0;
        vec3 rNxC = texture2D(tRockN, vWPos.zy*0.018+0.2).xyz*2.0-1.0;
        float ledge = mix(rNyC.y*tw.y + rNxC.y*tw.x, rNyF.y*tw.y + rNxF.y*tw.x, ledgeFine);
        // Snow holds below ~50 degrees, with noisy edges, plus patches caught on ledges.
        float snowLine = 0.60 + (n1-0.5)*0.22 + (n2-0.5)*0.06 - (uSnowCover-1.0)*0.2;
        gSnow = smoothstep(snowLine-0.05, snowLine+0.06, slopeY);
        float ledgeSnow = smoothstep(0.35, 0.6, ledge + slopeY*0.6 + (mix(n1, n2, ledgeFine)-0.5)*0.3) * (1.0 - gSnow) * smoothstep(0.15, 0.4, slopeY);
        gSnow = max(gSnow, ledgeSnow * 0.9);
        gIce = (1.0 - smoothstep(0.72, 0.86, slopeY)) * gSnow * smoothstep(0.35,0.7,n1);
        gRock = 1.0 - gSnow;
        vec3 rA = texture2D(tRockA, vWPos.zy*0.06).rgb*tw.x + texture2D(tRockA, vWPos.xz*0.06).rgb*tw.y + texture2D(tRockA, vWPos.xy*0.06).rgb*tw.z;
        vec3 rB = texture2D(tRockA, vWPos.zy*0.0137+0.3).rgb*tw.x + texture2D(tRockA, vWPos.xz*0.0137+0.3).rgb*tw.y + texture2D(tRockA, vWPos.xy*0.0137+0.3).rgb*tw.z;
        rA = rA * (0.55 + rB * 0.9);
        // Layered gneiss/schist: thin and thick strata, slightly warped.
        float warp = n1*5.0 + tNoise(vWPos.xz*0.02)*8.0;
        // Fine strata fade out with distance so they never alias into scan lines.
        float fineK = 1.0 - smoothstep(25.0, 90.0, camDist);
        float strata = mix(sin(vWPos.y*0.75 + warp)*0.5+0.5, sin(vWPos.y*1.9 + warp)*0.5+0.5, fineK);
        float strata2 = smoothstep(0.55, 0.9, sin(vWPos.y*0.37 + warp*0.3)*0.5+0.5);
        vec3 rockCol = mix(vec3(0.17,0.16,0.155), vec3(0.34,0.31,0.28), strata*0.55);
        rockCol = mix(rockCol, vec3(0.42,0.38,0.33), strata2*0.45);
        // Dark vertical water/varnish streaks down rock walls.
        float streak = tNoise(vec2(dot(vWPos.xz, vec2(0.7,0.7))*0.45, vWPos.y*0.025));
        rockCol *= 1.0 - smoothstep(0.55, 0.85, streak)*0.35;
        rockCol *= (0.55 + rA*0.9);
        float band = smoothstep(uBandLow-6.0, uBandLow+4.0, vWPos.y) * (1.0 - smoothstep(uBandHigh-4.0, uBandHigh+6.0, vWPos.y));
        rockCol = mix(rockCol, uBandCol*(0.6+rA*0.7)*(0.85+strata*0.3), band*0.85);
        // Snow: wind crust vs powder patches, grey dusting near rock, blue in cavities.
        vec3 snowCol = mix(vec3(0.94,0.955,0.98), vec3(0.84,0.88,0.93), n2*0.5 + n3*0.35);
        // Wind-sculpted sastrugi: shade the ripple flanks a little so texture reads even under flat light.
        vec2 rip = texture2D(tSnowN, vWPos.xz*0.023+0.37).xy*2.0-1.0;
        vec2 rip2 = texture2D(tSnowN, vWPos.xz*0.11).xy*2.0-1.0;
        snowCol *= 0.93 + 0.07*clamp(0.5 + (rip.x + rip.y)*0.9 + (rip2.x - rip2.y)*0.4, 0.0, 1.0);
        float dirty = (1.0 - smoothstep(0.0, 0.5, gSnow - ledgeSnow)) * gSnow;
        snowCol = mix(snowCol, vec3(0.62,0.6,0.58), dirty*0.35);
        vec3 iceCol = vec3(0.70,0.81,0.90);
        vec3 surf = mix(snowCol, iceCol, gIce*0.7);
        diffuseColor.rgb = mix(rockCol, surf, gSnow);
        float cav = clamp(vAO, 0.45, 1.12);
        diffuseColor.rgb *= mix(vec3(1.0), vec3(0.78,0.86,1.0), (1.0-min(cav,1.0))*gSnow*1.2);
        diffuseColor.rgb *= mix(1.0, cav, 0.85);
        // Crevasse walls: blue ice darkening with depth.
        // even the shallow lip of a crack is glacier ice, never rock
        float crev = smoothstep(0.002, 0.05, vCrev);
        // Bright blue ice at the lip, darkening only deep inside the crack.
        diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(0.62,0.82,0.93), vec3(0.02,0.08,0.18), smoothstep(0.3, 1.0, vCrev)), crev);
        gSnow = mix(gSnow, 1.0, crev); gIce = mix(gIce, 1.0, crev);
        `,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `float roughnessFactor = roughness;
         roughnessFactor = mix(0.92, mix(0.72 + n2*0.14, 0.3, gIce), gSnow);`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        {
          // Detail normals: wind ripples on snow (planar), triplanar cracks on rock.
          vec3 sN = texture2D(tSnowN, vWPos.xz*0.11).xyz*2.0-1.0;
          vec3 sN2 = texture2D(tSnowN, vWPos.xz*0.023+0.37).xyz*2.0-1.0;
          vec3 rNx = texture2D(tRockN, vWPos.zy*0.08).xyz*2.0-1.0;
          vec3 rNy = texture2D(tRockN, vWPos.xz*0.08).xyz*2.0-1.0;
          vec3 rNz = texture2D(tRockN, vWPos.xy*0.08).xyz*2.0-1.0;
          vec3 tw2 = triW(wn);
          vec3 wPert = vec3(0.0);
          vec3 sN3 = texture2D(tSnowN, vWPos.xz*0.45+0.71).xyz*2.0-1.0;
          vec3 snowP = vec3(sN.x*0.6 + sN2.x*0.9 + sN3.x*0.25, 0.0, sN.y*0.6 + sN2.y*0.9 + sN3.y*0.25);
          vec3 rockP = vec3(0.0, rNx.y, rNx.x)*tw2.x + vec3(rNy.x, 0.0, rNy.y)*tw2.y + vec3(rNz.x, rNz.y, 0.0)*tw2.z;
          float dFade = 1.0 - smoothstep(60.0, 260.0, length(vWPos - cameraPosition));
          wPert = mix(rockP*1.5, snowP*0.95, gSnow) * (0.35 + 0.65*dFade);
          vec3 wN = normalize(wn + wPert);
          normal = normalize((viewMatrix * vec4(wN, 0.0)).xyz);
        }`,
      )
      .replace(
        '#include <lights_fragment_end>',
        `{
          // Cloud shadows drifting across the slopes (direct sun only).
          vec2 cp = vWPos.xz*0.0022 + uTime*vec2(0.006, 0.0025);
          float cl = tNoise(cp)*0.6 + tNoise(cp*2.3 + 5.0)*0.4;
          float cs = 1.0 - smoothstep(0.5, 0.72, cl) * uCloudShadow;
          reflectedLight.directDiffuse *= cs;
          reflectedLight.directSpecular *= cs;
        }
        #include <lights_fragment_end>`,
      )
      .replace(
        '#include <fog_fragment>',
        `#ifdef USE_FOG
        {
          // Aerial perspective: blue light scatters more, haze thickens toward the
          // valleys and glows toward the sun.
          vec3 vd = vWPos - cameraPosition;
          float dist = length(vd);
          vec3 vdir = vd / max(dist, 0.001);
          float lowest = min(vWPos.y, cameraPosition.y);
          float hf = exp(-max(0.0, lowest - uHazeBase) * 0.004);
          float dens = fogDensity * (0.55 + 1.6 * hf);
          vec3 ext = exp(-dist * dens * vec3(0.72, 0.9, 1.18));
          float sunAmt = pow(max(dot(vdir, uSunDir), 0.0), 6.0);
          vec3 inscatter = mix(fogColor, fogColor * 0.5 + uSunCol * 0.9, sunAmt * 0.7);
          gl_FragColor.rgb = gl_FragColor.rgb * ext + inscatter * (1.0 - ext);
        }
        #endif`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          vec3 cell = floor(vWPos*90.0);
          float g = tHash(cell + floor(cameraPosition*4.0));
          float camD = length(vWPos - cameraPosition);
          float spark = step(0.9985, g) * gSnow * (1.0-gIce*0.5) * smoothstep(1.5, 4.0, camD) * (1.0 - smoothstep(18.0, 40.0, camD));
          totalEmissiveRadiance += vec3(1.0,0.98,0.95) * spark * uSparkle * 1.6;
        }`,
      );
  };
  material.customProgramCacheKey = () => 'terrain-v7';
  return { material, uniforms };
}

function gridGeometry(
  cols: number,
  rows: number,
  place: (i: number, j: number, out: number[]) => void,
): THREE.BufferGeometry {
  const positions = new Float32Array((cols + 1) * (rows + 1) * 3);
  const tmp = [0, 0, 0];
  let p = 0;
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= cols; i++) {
      place(i, j, tmp);
      positions[p++] = tmp[0];
      positions[p++] = tmp[1];
      positions[p++] = tmp[2];
    }
  }
  const indexCount = cols * rows * 6;
  const index = (cols + 1) * (rows + 1) > 65535 ? new Uint32Array(indexCount) : new Uint16Array(indexCount);
  let k = 0;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = j * (cols + 1) + i;
      const b = a + 1;
      const c = a + cols + 1;
      const d = c + 1;
      index[k++] = a; index[k++] = c; index[k++] = b;
      index[k++] = b; index[k++] = c; index[k++] = d;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  return geo;
}

export function buildTerrainMeshes(
  field: MountainField,
  material: THREE.Material,
  mobile: boolean,
): { group: THREE.Group; frame: PatchFrame; triangles: number } {
  const def = field.def;
  const frame = computePatchFrame(def);
  const group = new THREE.Group();
  group.name = 'terrain';

  // Detail patch along the route.
  const step = mobile ? 2.4 : 1.9;
  const cols = Math.ceil((frame.halfL * 2) / step);
  const rows = Math.ceil((frame.halfW * 2) / step);
  const patch = gridGeometry(cols, rows, (i, j, out) => {
    const a = -frame.halfL + (i / cols) * frame.halfL * 2;
    const b = -frame.halfW + (j / rows) * frame.halfW * 2;
    const x = frame.ox + frame.ux * a + frame.vx * b;
    const z = frame.oz + frame.uz * a + frame.vz * b;
    out[0] = x;
    out[1] = field.height(x, z);
    out[2] = z;
  });
  const patchMesh = new THREE.Mesh(patch, material);
  patchMesh.name = 'terrainDetailPatch';
  patchMesh.receiveShadow = true;
  patchMesh.castShadow = false; // props/rocks cast; terrain self-shadow costs a full extra pass
  group.add(patchMesh);

  // Coarse surround, warped so resolution concentrates near the mountain.
  const half = 2600;
  const n = mobile ? 180 : 230;
  const cx = def.route[0][0] * 0.45;
  const cz = def.route[0][1] * 0.45;
  const warp = (u: number) => Math.sign(u) * Math.pow(Math.abs(u), 1.65);
  const base = gridGeometry(n, n, (i, j, out) => {
    const x = cx + warp(i / n * 2 - 1) * half;
    const z = cz + warp(j / n * 2 - 1) * half;
    const inside = patchInsideFactor(frame, x, z);
    out[0] = x;
    out[1] = field.height(x, z) - inside * 9;
    out[2] = z;
  });
  const baseMesh = new THREE.Mesh(base, material);
  baseMesh.name = 'terrainSurround';
  baseMesh.receiveShadow = true;
  group.add(baseMesh);

  for (const g of [patch, base]) {
    const pos = g.getAttribute('position');
    // Cavity term: concave spots (gullies, the foot of walls) get darker, convex crests brighter.
    const ao = new Float32Array(pos.count);
    const r = g === patch ? 5 : 18;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const h = field.surfaceHeight(x, z);
      const avg = (field.surfaceHeight(x + r, z) + field.surfaceHeight(x - r, z) + field.surfaceHeight(x, z + r) + field.surfaceHeight(x, z - r)) * 0.25;
      const c = (avg - h) / r;
      ao[i] = Math.min(1.12, Math.max(0.45, 1 - c * 1.6));
    }
    g.setAttribute('aAO', new THREE.BufferAttribute(ao, 1));
    const crev = new Float32Array(pos.count);
    if (field.cracks.length) {
      for (let i = 0; i < pos.count; i++) crev[i] = field.crevasseDepth(pos.getX(i), pos.getZ(i)) / 24;
    }
    g.setAttribute('aCrev', new THREE.BufferAttribute(crev, 1));
  }
  const triangles = (patch.index!.count + base.index!.count) / 3;
  return { group, frame, triangles };
}
