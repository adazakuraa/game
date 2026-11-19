import * as THREE from 'three';
import { SPECIES, type SpeciesDef } from './species';
import { buildCrustacean, buildFish, buildJelly, buildNudibranch, buildOctopus, buildRay, buildSquid, buildTurtle, setAttr } from './models';
import { Paint } from './paint';
import { underwaterMaterial } from '../render/underwater';
import { makeSoftDot } from '../render/textures';
import { heightAt, VENT } from '../world/layout';
import { GARDEN_EEL_PATCH, type Homes } from '../world/flora';
import { clamp, mulberry32 } from '../utils/noise';
import { resolveSphere } from '../world/colliders';

type Group = { c: THREE.Vector3; t: THREE.Vector3; home: THREE.Vector3; v: THREE.Vector3; roam: number; timer: number };
type Agent = {
  p: THREE.Vector3;
  v: THREE.Vector3;
  q: THREE.Quaternion;
  s: number;
  g: number;
  off: THREE.Vector3;
  ph: number;
  retract: number;
  alarm: number;
  yaw: number;
  fixed?: boolean;
  col?: THREE.Color;
};

export type SpeciesRuntime = {
  def: SpeciesDef;
  mesh?: THREE.InstancedMesh;
  agents: Agent[];
  groups: Group[];
  active: boolean;
  bounds: THREE.Box3;
  halo?: THREE.Points;
  haloPos?: Float32Array;
  lureOffset?: THREE.Vector3;
  slot: number;
};

const UPRIGHT = new Set(['jelly', 'octopus', 'dumbo', 'nudi', 'isopod', 'lobster', 'gardenEel', 'inv']);
const _m = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _qt = new THREE.Quaternion();
const _sc = new THREE.Vector3();

function buildGeometry(def: SpeciesDef): { geo: THREE.BufferGeometry; paint: Paint } {
  const [tw, th] = def.tex ?? (def.kind === 'fish' && def.size >= 0.4 ? [512, 256] : [256, 128]);
  switch (def.kind) {
    case 'fish': {
      const small = def.size < 0.3;
      const { geo, layout } = buildFish({ ...def.fish!, rings: def.fish!.rings ?? (small ? 8 : 12), segs: def.fish!.segs ?? (small ? 12 : 18) });
      return { geo, paint: new Paint(tw, th, layout) };
    }
    case 'gardenEel': {
      const { geo, layout } = buildFish(def.fish!);
      geo.rotateX(-Math.PI / 2);
      geo.translate(0, 0.5, 0);
      setAttr(geo, 'aBend', (_x, y) => Math.pow(clamp(y, 0, 1), 1.5));
      return { geo, paint: new Paint(tw, th, layout) };
    }
    case 'ray':
      return { geo: buildRay(def.ray!).geo, paint: new Paint(tw, th) };
    case 'jelly':
      return { geo: buildJelly(def.jelly!), paint: new Paint(tw, th) };
    case 'squid':
      return { geo: buildSquid(def.squid!), paint: new Paint(tw, th) };
    case 'octopus':
      return { geo: buildOctopus({}), paint: new Paint(tw, th) };
    case 'dumbo':
      return { geo: buildOctopus({ dumbo: true }), paint: new Paint(tw, th) };
    case 'turtle':
      return { geo: buildTurtle(), paint: new Paint(tw, th) };
    case 'lobster':
      return { geo: buildCrustacean({ lobster: true }), paint: new Paint(tw, th) };
    case 'isopod':
      return { geo: buildCrustacean({}), paint: new Paint(tw, th) };
    case 'nudi':
      return { geo: buildNudibranch(), paint: new Paint(tw, th) };
    case 'inv':
      return { geo: def.build!(), paint: new Paint(tw, th) };
    default:
      throw new Error('no geometry for ' + def.kind);
  }
}

function makeMaterial(def: SpeciesDef, map: THREE.Texture, uvAspect = 0.3): THREE.MeshStandardMaterial {
  const m = def.mat ?? {};
  const translucent = m.translucent !== undefined;
  const mat = new THREE.MeshStandardMaterial({
    map,
    roughness: m.rough ?? 0.55,
    metalness: m.metal ?? 0.05,
    side: THREE.DoubleSide,
    transparent: translucent,
    opacity: translucent ? m.translucent : 1,
    depthWrite: !translucent,
    envMapIntensity: 0.9,
  });
  const swim = def.swim ?? [0, 0, 0];
  const flap = def.flap ?? [0, 0, 0];
  const pulse = def.pulse ?? [0, 0];
  const glow = new THREE.Color(m.glow ?? 0x000000);
  if (def.fish?.bendY) mat.defines = { BEND_Y: '' };
  if (def.id === 'atolla') mat.defines = { ...(mat.defines ?? {}), GLOW_SPIN: '' };
  if (def.rainbow) mat.defines = { ...(mat.defines ?? {}), RAINBOW: '' };
  const scaly = def.kind === 'fish' || def.kind === 'gardenEel';
  if (scaly) {
    mat.defines = { ...(mat.defines ?? {}), FISH_SCALES: '' };
    // wet, glossy skin; silver species keep their metal value
    mat.roughness = Math.min(mat.roughness, (m.metal ?? 0) > 0.3 ? 0.28 : 0.38);
  }
  return underwaterMaterial(mat, {
    key: 'cr-' + def.kind + (translucent ? '-t' : ''),
    caustic: 0.9,
    uniforms: {
      uSwim: { value: new THREE.Vector3(...swim) },
      uFlap: { value: new THREE.Vector3(...flap) },
      uPulse: { value: new THREE.Vector2(...pulse) },
      uGlowCol: { value: glow },
      uGlowAmt: { value: 1 },
      uUvAspect: { value: uvAspect },
      uFishSize: { value: def.size },
    },
    vertexHead: `attribute float aBend; attribute float aFlap; attribute float aPulse; attribute float aGlow; attribute float aFin;
      uniform vec3 uSwim; uniform vec3 uFlap; uniform vec2 uPulse; varying float vGlow; varying float vFin;`,
    vertexBody: `
      float ph = 0.0;
      #ifdef USE_INSTANCING
        ph = instanceMatrix[3].x * 0.71 + instanceMatrix[3].z * 0.53 + instanceMatrix[3].y * 0.37;
      #endif
      float wave = sin( uTime * uSwim.x + ph - position.z * uSwim.z );
      #ifdef BEND_Y
        transformed.y += wave * uSwim.y * aBend;
      #else
        transformed.x += wave * uSwim.y * aBend;
      #endif
      float fl = sin( uTime * uFlap.x + ph * 1.3 - position.z * uFlap.z );
      transformed.y += fl * uFlap.y * aFlap;
      float pu = sin( uTime * uPulse.x + ph );
      transformed.xz *= 1.0 - pu * uPulse.y * aPulse;
      transformed.y += max( pu, 0.0 ) * uPulse.y * aPulse * 0.25;
      vGlow = aGlow;
      vFin = aFin;
      #ifdef GLOW_SPIN
        vGlow *= 0.15 + pow( 0.5 + 0.5 * sin( atan( position.z, position.x ) * 2.0 - uTime * 4.0 ), 3.0 ) * 1.6;
      #endif`,
    fragHead: 'uniform vec3 uGlowCol; uniform float uGlowAmt; varying float vGlow; varying float vFin; uniform float uUvAspect; uniform float uFishSize;',
    fragFuncs: `
      #if defined( FISH_SCALES ) && defined( USE_MAP )
      float fishScale( vec2 uv ) {
        vec2 q = uv * vec2( 58.0, 58.0 * uUvAspect );
        float row = floor( q.y );
        q.x += mod( row, 2.0 ) * 0.5;
        vec2 f = fract( q ) - vec2( 0.62, 0.5 );
        return smoothstep( 0.66, 0.15, length( f * vec2( 0.85, 1.0 ) ) );
      }
      #endif`,
    fragDiffuse: `
      #ifdef FISH_SCALES
        // fins are thin membranes: lighter and a little desaturated where light passes through
        if ( vFin > 0.5 && vFin < 1.5 ) diffuseColor.rgb = mix( diffuseColor.rgb, vec3( dot( diffuseColor.rgb, vec3( 0.33 ) ) ), 0.15 ) * 1.12;
      #endif
      #if defined( FISH_SCALES ) && defined( USE_MAP )
      if ( vFin < 0.5 ) diffuseColor.rgb *= 0.985 + 0.02 * fishScale( vMapUv );
      else if ( vFin < 1.5 ) diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * ( 0.88 + 0.18 * abs( sin( vMapUv.y * 150.0 ) ) ), 0.7 );
      #endif`,
    fragBeforeLights: `
      #if defined( FISH_SCALES ) && defined( USE_MAP )
      {
        float hb = vFin < 0.5 ? fishScale( vMapUv ) * uFishSize * 0.0006 : vFin < 1.5 ? abs( sin( vMapUv.y * 150.0 ) ) * uFishSize * 0.0012 : 0.0;
        normal = uwBump( normal, hb );
      }
      #endif`,
    fragRough: `
      #ifdef FISH_SCALES
        roughnessFactor = vFin > 1.5 ? 0.06 : vFin > 0.5 ? 0.55 : roughnessFactor;
      #endif`,
    fragEmissive: `
      {
        // water back-scatter rim: silhouettes glow faintly against the blue, like in real underwater photos
        float rim = pow( 1.0 - clamp( dot( normalize( normal ), normalize( vViewPosition ) ), 0.0, 1.0 ), 3.0 );
        totalEmissiveRadiance += uSunCol * rim * 0.22 * exp( min( vUwPos.y, 0.0 ) / 30.0 ) * ( 1.0 - step( 1.5, vFin ) );
      }
      #ifdef RAINBOW
        vec3 hue = 0.5 + 0.5 * cos( 6.2831 * ( vUwPos.y * 4.0 - uTime * 0.9 + vec3( 0.0, 0.33, 0.67 ) ) );
        totalEmissiveRadiance += hue * vGlow * 1.4;
      #else
        totalEmissiveRadiance += uGlowCol * vGlow * uGlowAmt * ( 2.2 + 0.6 * sin( uTime * 2.7 ) );
      #endif`,
  });
}

export type PhotoTarget = { rt: SpeciesRuntime; agent: Agent; dist: number; angle: number; inRange: boolean; reason: 'ok' | 'small' | 'murky' | 'dark' | 'hidden'; frac: number };

export class Creatures {
  readonly group = new THREE.Group();
  readonly list: SpeciesRuntime[] = [];
  private rnd = mulberry32(77);
  private haloTex = makeSoftDot('rgba(255,255,255,1)', 'rgba(255,255,255,0.25)');
  time = 0;

  private homes!: Homes;
  constructor(homes: Homes) {
    this.homes = homes;
    for (const def of SPECIES) this.list.push(this.spawn(def, homes));
  }

  private pickHome(def: SpeciesDef, homes: Homes, i: number): THREE.Vector3 {
    const r = this.rnd;
    const reg = def.region;
    const fromList = (arr: THREE.Vector3[]) => arr[Math.floor(r() * arr.length) % Math.max(1, arr.length)].clone();
    let p: THREE.Vector3;
    if (reg === 'anemones') {
      // each anemonefish species keeps its own host anemones
      const off: Record<string, number> = { clownfish: 0, hamakumanomi: 9, kumanomi: 14, hanabirakuma: 19 };
      p = homes.anemones[((off[def.id] ?? 0) + i) % homes.anemones.length].clone();
    }
    else if (reg === 'crevices') p = homes.crevices[(i * 7) % homes.crevices.length].clone();
    else if (reg === 'reefSpots') p = fromList(homes.reefSpots);
    else if (reg === 'rockSpots') p = fromList(homes.rockSpots);
    else if (reg === 'coralTops') p = fromList(homes.coralTops);
    else if (reg === 'underTables') p = fromList(homes.underTables);
    else if (reg === 'wallSpots') p = fromList(homes.wallSpots);
    else if (reg === 'sandSpots') p = fromList(homes.sandSpots);
    else if (reg === 'grassSpots') p = fromList(homes.grassSpots);
    else if (reg === 'bommieSpots') p = fromList(homes.bommieSpots);
    else if (reg === 'vent') {
      const a = r() * Math.PI * 2, d = 5 + r() * 18;
      const x = VENT.x + Math.cos(a) * d, z = VENT.z + Math.sin(a) * d;
      p = new THREE.Vector3(x, heightAt(x, z), z);
    } else if (reg === 'eelPatch') {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * GARDEN_EEL_PATCH.r;
      const x = GARDEN_EEL_PATCH.x + Math.cos(a) * d, z = GARDEN_EEL_PATCH.z + Math.sin(a) * d;
      p = new THREE.Vector3(x, heightAt(x, z), z);
    } else {
      let x = 0, z = 0, ground = 0, y = 0;
      for (let k = 0; k < 40; k++) {
        const rg = reg as [number, number, number, number];
        x = rg[0] + r() * (rg[1] - rg[0]);
        z = rg[2] + r() * (rg[3] - rg[2]);
        ground = heightAt(x, z);
        y = -(def.depth[0] + r() * (def.depth[1] - def.depth[0]));
        if (y > ground + 1) break;
      }
      p = new THREE.Vector3(x, Math.max(y, ground + 0.8), z);
    }
    return p;
  }

  /** Altitude band [min,max] and its anchor for a habitat. 'home' = relative to the habitat point (coral top etc.). */
  private band(def: SpeciesDef): { lo: number; hi: number; anchor: 'home' | 'ground' | 'abs' } | null {
    switch (def.hab) {
      case 'coralHover': return { lo: 0.25, hi: 1.0, anchor: 'home' };
      case 'coralPick': return { lo: 0.05, hi: 0.6, anchor: 'home' };
      case 'cleaner': return { lo: 0.25, hi: 0.6, anchor: 'home' };
      case 'under': return { lo: -0.25, hi: 0.05, anchor: 'home' };
      case 'wall': return { lo: -1.5, hi: 3, anchor: 'home' };
      case 'reefRoam': case 'rockyRoam': return { lo: 0.6 + def.size, hi: 2.5 + def.size, anchor: 'ground' };
      case 'midwater': return { lo: 3 + def.size, hi: 10 + def.size * 2, anchor: 'ground' };
      case 'sandForage': return { lo: 0.12 + def.size * 0.15, hi: 0.4 + def.size * 0.3, anchor: 'ground' };
      case 'seagrass': return { lo: 0.3, hi: 1.1, anchor: 'ground' };
      case 'surface': return { lo: -1.8, hi: -0.35, anchor: 'abs' };
      default: return null;
    }
  }

  private nearFrom(list: THREE.Vector3[], c: THREE.Vector3, rad: number): THREE.Vector3 | null {
    const r = this.rnd;
    for (let k = 0; k < 24; k++) {
      const q = list[Math.floor(r() * list.length)];
      if (q && Math.abs(q.x - c.x) < rad && Math.abs(q.z - c.z) < rad) return q;
    }
    return null;
  }

  private habTarget(def: SpeciesDef, g: Group, out: THREE.Vector3): boolean {
    const b = this.band(def);
    if (!b) return false;
    const r = this.rnd;
    const H = this.homes;
    const rnd = (a: number, c: number) => a + r() * (c - a);
    switch (def.hab) {
      case 'coralHover': case 'cleaner': out.set(g.home.x + rnd(-0.4, 0.4), 0, g.home.z + rnd(-0.4, 0.4)); break;
      case 'under': out.set(g.home.x + rnd(-0.3, 0.3), 0, g.home.z + rnd(-0.3, 0.3)); break;
      case 'wall': out.set(g.home.x + rnd(-2, 2), 0, g.home.z + rnd(-1, 1)); break;
      case 'coralPick': {
        const q = this.nearFrom(H.coralTops, g.home, 9) ?? g.home;
        out.set(q.x + rnd(-0.3, 0.3), 0, q.z + rnd(-0.3, 0.3));
        out.y = q.y + rnd(b.lo, b.hi);
        return true;
      }
      case 'sandForage': {
        const q = this.nearFrom(H.sandSpots, g.home, 16);
        if (q) out.set(q.x + rnd(-2, 2), 0, q.z + rnd(-2, 2));
        else out.set(g.home.x + rnd(-8, 8), 0, g.home.z + rnd(-8, 8));
        break;
      }
      case 'seagrass': {
        const q = this.nearFrom(H.grassSpots, g.home, 18) ?? g.home;
        out.set(q.x + rnd(-2, 2), 0, q.z + rnd(-2, 2));
        break;
      }
      default: out.set(g.home.x + rnd(-1, 1) * g.roam, 0, g.home.z + rnd(-1, 1) * g.roam);
    }
    if (b.anchor === 'home') out.y = g.home.y + rnd(b.lo, b.hi);
    else if (b.anchor === 'abs') out.y = rnd(b.lo, b.hi);
    else out.y = Math.min(heightAt(out.x, out.z) + rnd(b.lo, b.hi), -0.8);
    return true;
  }

  private altitude(def: SpeciesDef): number {
    if (def.kind === 'inv' && (def.behavior === 'bottom' || def.behavior === 'static')) return 0.0;
    switch (def.behavior) {
      case 'bottom': return def.kind === 'isopod' ? 0.02 : def.kind === 'dumbo' ? 0.6 : 0.35;
      case 'static': return def.kind === 'ray' ? 0.02 : 0;
      case 'buried': return 0;
      case 'anemone': return 0.35;
      case 'crevice': return 0;
      case 'school': case 'solo': return def.region === 'reefSpots' ? 1.2 + def.size * 2 : 0.8 + def.size;
      default: return 1.5 + def.size * 0.5;
    }
  }

  private spawn(def: SpeciesDef, homes: Homes): SpeciesRuntime {
    const r = this.rnd;
    const rt: SpeciesRuntime = { def, agents: [], groups: [], active: false, bounds: new THREE.Box3(), slot: 0 };
    for (let gi = 0; gi < def.groups; gi++) {
      const home = this.pickHome(def, homes, gi);
      if (def.behavior !== 'static' && def.behavior !== 'buried' && def.behavior !== 'crevice' && def.behavior !== 'anemone') {
        const g0 = heightAt(home.x, home.z);
        home.y = Math.max(home.y, g0 + this.altitude(def));
      }
      const roam = def.behavior === 'pelagic' ? 60 : def.behavior === 'drift' ? 14 : def.region === 'reefSpots' ? 5 : 20;
      rt.groups.push({ c: home.clone(), t: home.clone(), home, v: new THREE.Vector3(), roam, timer: 0 });
    }
    for (let i = 0; i < def.count; i++) {
      const gi = i % def.groups;
      const g = rt.groups[gi];
      const spread = def.spread ?? (def.behavior === 'anemone' ? 0.45 : 0.6);
      const off = new THREE.Vector3((r() - 0.5) * 2, (r() - 0.5) * 2 * 0.5, (r() - 0.5) * 2).multiplyScalar(spread);
      if (def.id === 'sardine') off.setFromSphericalCoords(spread * (0.35 + 0.65 * Math.cbrt(r())), Math.acos(2 * r() - 1), r() * Math.PI * 2);
      const a: Agent = {
        p: g.c.clone().add(off),
        v: new THREE.Vector3(r() - 0.5, 0, r() - 0.5).multiplyScalar(def.speed),
        q: new THREE.Quaternion(),
        s: def.size * (0.85 + r() * 0.3),
        g: gi,
        off,
        ph: r() * 100,
        retract: 0,
        alarm: 0,
        yaw: r() * Math.PI * 2,
      };
      // fixed placements
      if (def.behavior === 'buried') {
        if (def.region === 'eelPatch') {
          const a2 = r() * Math.PI * 2, d = Math.sqrt(r()) * GARDEN_EEL_PATCH.r;
          a.p.set(GARDEN_EEL_PATCH.x + Math.cos(a2) * d, 0, GARDEN_EEL_PATCH.z + Math.sin(a2) * d);
          a.p.y = heightAt(a.p.x, a.p.z) - 0.12 * a.s;
          a.fixed = true;
        } else {
          // goby hovering over its burrow (or a tube worm fixed on coral)
          a.p.set(g.home.x + (r() - 0.5) * 1.2, 0, g.home.z + (r() - 0.5) * 1.2);
          a.p.y = def.anchorHome ? g.home.y + (r() - 0.5) * 0.2 : heightAt(a.p.x, a.p.z) + 0.12 + a.s * 0.3;
          if (def.anchorHome) a.fixed = true;
        }
      } else if (def.behavior === 'crevice') {
        const idx = (i * 7 + 3) % homes.crevices.length;
        const c = homes.crevices[idx];
        const rad = homes.creviceR[idx] ?? 3;
        a.yaw = r() * Math.PI * 2;
        const dir = new THREE.Vector3(Math.sin(a.yaw), 0, Math.cos(a.yaw));
        const d = rad * (def.kind === 'lobster' ? 1.05 : 0.95) + (def.kind === 'lobster' ? 0 : def.size * 0.25);
        a.p.set(c.x + dir.x * d, 0, c.z + dir.z * d);
        a.p.y = heightAt(a.p.x, a.p.z) + (def.kind === 'lobster' ? 0.05 : 0.35 + r() * 0.4);
        a.fixed = true;
      } else if (def.behavior === 'static') {
        a.p.copy(g.home).add(new THREE.Vector3((r() - 0.5) * 3, 0, (r() - 0.5) * 3));
        if (def.region === 'rockSpots' || def.region === 'coralTops' || def.region === 'bommieSpots') a.p.copy(g.home);
        else a.p.y = heightAt(a.p.x, a.p.z) + this.altitude(def);
        if (def.kind === 'none') a.p.set(VENT.x, heightAt(VENT.x, VENT.z) + 1.5, VENT.z);
      }
      if (def.instColors) a.col = new THREE.Color(def.instColors[Math.floor(r() * def.instColors.length)]);
      rt.agents.push(a);
    }
    for (const g of rt.groups) rt.bounds.expandByPoint(g.home);
    rt.bounds.expandByScalar(Math.max(...rt.groups.map((g) => g.roam)) + def.size * 2 + 10);

    if (def.kind !== 'none') {
      const { geo, paint } = buildGeometry(def);
      def.paint?.(paint);
      const tex = new THREE.CanvasTexture(paint.c);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      const lay = paint.fish;
      const mat = makeMaterial(def, tex, lay ? (2 * lay.yMax) / (lay.zMax - lay.zMin) : 0.3);
      const mesh = new THREE.InstancedMesh(geo, mat, def.count);
      mesh.frustumCulled = false;
      mesh.castShadow = def.kind !== 'jelly' && def.size >= 0.2;
      mesh.receiveShadow = true;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.name = def.id;
      if (def.instColors) { mesh.setColorAt(0, new THREE.Color(1, 1, 1)); }
      rt.mesh = mesh;
      this.group.add(mesh);
      if (def.mat?.glow) {
        rt.haloPos = new Float32Array(def.count * 3);
        const hg = new THREE.BufferGeometry();
        hg.setAttribute('position', new THREE.BufferAttribute(rt.haloPos, 3));
        const hm = new THREE.PointsMaterial({
          map: this.haloTex,
          color: def.mat.glow,
          size: def.id === 'atolla' ? def.size * 3.2 : Math.max(0.2, Math.min(0.7, def.size * 2)),
          sizeAttenuation: true,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          fog: false,
          opacity: 0.85,
        });
        rt.halo = new THREE.Points(hg, hm);
        rt.halo.frustumCulled = false;
        this.group.add(rt.halo);
        if (def.id === 'angler') rt.lureOffset = new THREE.Vector3(0, def.fish!.H / 2 + 0.22, 0.54);
      }
      this.writeAll(rt);
    }
    return rt;
  }

  private writeAll(rt: SpeciesRuntime) {
    rt.slot = 0;
    rt.agents.forEach((a, i) => {
      this.orient(rt, a, 1);
      this.writeInstance(rt, a, i);
    });
    rt.mesh!.count = rt.slot;
    rt.mesh!.instanceMatrix.needsUpdate = true;
  }

  private orient(rt: SpeciesRuntime, a: Agent, k: number) {
    const def = rt.def;
    const sp = a.v.length();
    if (sp > 0.02 && !a.fixed) {
      const yaw = Math.atan2(a.v.x, a.v.z);
      let dy = yaw - a.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      a.yaw += dy * k;
    }
    let pitch = 0;
    let roll = 0;
    if (!UPRIGHT.has(def.kind) && sp > 0.02) {
      pitch = -Math.asin(clamp(a.v.y / sp, -0.8, 0.8)) * 0.8;
    }
    if (def.id === 'oarfish') pitch = -1.25;
    if (def.kind === 'ray' && def.ray?.flounder) pitch = 0;
    _e.set(pitch, a.yaw, roll);
    a.q.setFromEuler(_e);
  }

  private viewPos = new THREE.Vector3(0, -1e5, 0);
  private viewDir = new THREE.Vector3(0, 0, -1);

  /** Pack only on-screen, nearby agents into the instance buffer (mesh.count trims the draw). */
  private writeInstance(rt: SpeciesRuntime, a: Agent, _i: number) {
    let s = a.s;
    const dx = a.p.x - this.viewPos.x, dy = a.p.y - this.viewPos.y, dz = a.p.z - this.viewPos.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const reach = s * 1.5 + 2;
    if (d > (s < 0.12 ? 20 : s < 0.35 ? 34 : s < 1 ? 46 : 52 + s * 3)) return;
    if (d > reach && (dx * this.viewDir.x + dy * this.viewDir.y + dz * this.viewDir.z) < -reach) return;
    const i = rt.slot++;
    if (a.col) rt.mesh!.setColorAt(i, a.col);
    if (rt.def.behavior === 'buried') {
      _v.copy(a.p);
      _v.y -= a.retract * s * 1.05;
      _m.compose(_v, a.q, _sc.setScalar(s));
    } else {
      _m.compose(a.p, a.q, _sc.setScalar(s));
    }
    rt.mesh!.setMatrixAt(i, _m);
    if (rt.haloPos) {
      _v.set(0, 0, 0);
      if (rt.lureOffset) _v.copy(rt.lureOffset).multiplyScalar(s).applyQuaternion(a.q);
      _v.add(a.p);
      rt.haloPos[i * 3] = _v.x;
      rt.haloPos[i * 3 + 1] = _v.y;
      rt.haloPos[i * 3 + 2] = _v.z;
    }
  }

  private relocT = 0;
  private relocIdx = 0;

  private canRelocate(def: SpeciesDef): boolean {
    if (def.kind === 'none' || def.behavior === 'anemone' || def.behavior === 'crevice') return false;
    if (def.region === 'eelPatch' || def.region === 'vent' || def.region === 'anemones' || def.region === 'crevices' || def.region === 'reefSpots') return false;
    return true;
  }

  /** Move a far-away group into matching habitat 30-75 m from the diver (outside the visible range). */
  private relocate(rt: SpeciesRuntime, gi: number, player: THREE.Vector3, minD = 32): boolean {
    const def = rt.def;
    const r = this.rnd;
    const reg = def.region;
    let p: THREE.Vector3 | null = null;
    const ok = (x: number, z: number) => {
      const d = Math.hypot(x - player.x, z - player.z);
      return d > minD && d < 75;
    };
    if (typeof reg === 'string') {
      const list = (this.homes as unknown as Record<string, THREE.Vector3[]>)[reg];
      if (!list?.length) return false;
      for (let k = 0; k < 40 && !p; k++) {
        const q = list[Math.floor(r() * list.length)];
        if (ok(q.x, q.z)) p = q.clone();
      }
    } else {
      const x0 = Math.max(reg[0], player.x - 75), x1 = Math.min(reg[1], player.x + 75);
      const z0 = Math.max(reg[2], player.z - 75), z1 = Math.min(reg[3], player.z + 75);
      if (x0 >= x1 || z0 >= z1) return false;
      for (let k = 0; k < 30 && !p; k++) {
        const x = x0 + r() * (x1 - x0), z = z0 + r() * (z1 - z0);
        if (!ok(x, z)) continue;
        const ground = heightAt(x, z);
        const y = -(def.depth[0] + r() * (def.depth[1] - def.depth[0]));
        if (y < ground + 0.5 && def.behavior !== 'bottom' && def.behavior !== 'static') continue;
        p = new THREE.Vector3(x, Math.max(y, ground + this.altitude(def)), z);
      }
    }
    if (!p) return false;
    const g = rt.groups[gi];
    g.home.copy(p);
    if (def.hab && def.behavior !== 'static' && def.behavior !== 'buried') this.habTarget(def, g, g.t);
    else g.t.copy(p);
    g.c.copy(def.hab ? g.t : p);
    g.v.set(0, 0, 0);
    for (const a of rt.agents) {
      if (a.g !== gi) continue;
      if (def.behavior === 'static') {
        a.p.copy(p);
        if (def.region !== 'rockSpots' && def.region !== 'coralTops' && def.region !== 'bommieSpots') { a.p.x += (r() - 0.5) * 3; a.p.z += (r() - 0.5) * 3; a.p.y = heightAt(a.p.x, a.p.z) + this.altitude(def); }
        a.alarm = 0;
      } else if (def.behavior === 'buried') {
        a.p.set(p.x + (r() - 0.5) * 1.2, 0, p.z + (r() - 0.5) * 1.2);
        a.p.y = def.anchorHome ? p.y + (r() - 0.5) * 0.2 : heightAt(a.p.x, a.p.z) + 0.12 + a.s * 0.3;
        a.retract = 0;
      } else {
        a.p.copy(g.c).add(a.off);
        const gy = heightAt(a.p.x, a.p.z) + 0.1;
        if (a.p.y < gy) a.p.y = gy;
      }
    }
    return true;
  }

  /** After a teleport (dive start): populate the surroundings immediately. */
  primeAround(player: THREE.Vector3): void {
    for (const rt of this.list) {
      if (!this.canRelocate(rt.def)) continue;
      if (rt.def.rarity >= 3 && this.rnd() > 0.3) continue;
      rt.groups.forEach((g, gi) => {
        if (Math.hypot(g.c.x - player.x, g.c.z - player.z) > 100) this.relocate(rt, gi, player, 6);
      });
    }
  }

  update(dt: number, player: THREE.Vector3, playerVel: THREE.Vector3, viewDir?: THREE.Vector3): void {
    // re-home far groups (a few species per frame)
    this.relocT += dt;
    if (this.relocT > 0.05) {
      this.relocT = 0;
      for (let n = 0; n < 4; n++) {
        const rt = this.list[this.relocIdx++ % this.list.length];
        if (!this.canRelocate(rt.def)) continue;
        if (rt.def.rarity >= 3 && this.rnd() > 0.15) continue;
        rt.groups.forEach((g, gi) => {
          if (Math.hypot(g.c.x - player.x, g.c.z - player.z) > 100) this.relocate(rt, gi, player);
        });
      }
    }
    this.viewPos.copy(player);
    if (viewDir) this.viewDir.copy(viewDir);
    this.time += dt;
    const r = this.rnd;
    for (const rt of this.list) {
      let near = false;
      for (const g of rt.groups) if (Math.abs(g.c.x - player.x) < 68 && Math.abs(g.c.z - player.z) < 68) { near = true; break; }
      rt.active = near;
      if (rt.mesh) rt.mesh.visible = near;
      if (rt.halo) rt.halo.visible = near;
      if (!near || !rt.mesh) continue;
      rt.slot = 0;
      const def = rt.def;

      // ---- group centers
      for (const g of rt.groups) {
        g.timer -= dt;
        const toT = _v.copy(g.t).sub(g.c);
        const dist = toT.length();
        const curiousNear = def.curious && player.distanceTo(g.c) < 32 && player.distanceTo(g.c) > def.size * 1.5 + 3;
        if (curiousNear) {
          g.t.copy(player).add(_v2.set(Math.sin(this.time * 0.2 + g.home.x) * (def.size + 5), -1 + Math.sin(this.time * 0.3) * 2, Math.cos(this.time * 0.2 + g.home.x) * (def.size + 5)));
        } else if (dist < 1.0 || g.timer <= 0) {
          g.timer = (def.hab === 'coralHover' || def.hab === 'under' ? 3 : 8) + r() * 12;
          if (!this.habTarget(def, g, g.t)) {
            const rr = g.roam;
            g.t.set(g.home.x + (r() - 0.5) * 2 * rr, g.home.y + (r() - 0.5) * Math.min(rr * 0.4, 6), g.home.z + (r() - 0.5) * 2 * rr);
          }
        }
        if (!def.hab) {
          const ground = heightAt(g.t.x, g.t.z);
          g.t.y = clamp(g.t.y, Math.max(ground + this.altitude(def), -def.depth[1]), Math.min(-def.depth[0], -0.6));
        } else g.t.y = Math.min(g.t.y, -0.3);
        if (def.behavior === 'anemone') g.t.copy(g.home);
        const spd = def.speed * (def.behavior === 'pelagic' ? 1 : 0.6);
        _v.copy(g.t).sub(g.c);
        const L = _v.length();
        if (L > 0.01) g.v.lerp(_v.multiplyScalar(Math.min(spd, L) / L), 1 - Math.exp(-dt * 0.8));
        // flee as a group (schools scatter around player)
        const pd = _v2.copy(g.c).sub(player);
        const pl = pd.length();
        if (def.flee > 0 && pl < def.flee * 2.5 && def.behavior !== 'anemone' && def.hab !== 'coralHover' && def.hab !== 'under' && def.hab !== 'cleaner') g.v.addScaledVector(pd.normalize(), dt * def.speed * 2);
        g.c.addScaledVector(g.v, dt);
        const gg = heightAt(g.c.x, g.c.z);
        const minAlt = def.hab ? (def.hab === 'sandForage' || def.hab === 'under' ? 0.1 : 0.2) : this.altitude(def) * 0.8;
        g.c.y = clamp(g.c.y, gg + minAlt, -0.3);
      }

      // ---- agents
      for (let i = 0; i < rt.agents.length; i++) {
        const a = rt.agents[i];
        const g = rt.groups[a.g];
        if (Math.abs(g.c.x - player.x) > 100 || Math.abs(g.c.z - player.z) > 100) continue;
        const dPlayer = a.p.distanceTo(player);
        if (def.behavior === 'buried') {
          const want = dPlayer < def.flee + playerVel.length() * 1.5 ? 1 : 0;
          a.retract += (want - a.retract) * Math.min(1, dt * (want ? 6 : 0.35));
          // face roughly toward the current (gobies hover and slowly turn)
          a.yaw = def.region === 'eelPatch' ? 0.6 + Math.sin(a.ph) * 0.4 : a.ph + Math.sin(this.time * 0.3 + a.ph) * 0.6;
          if (def.region !== 'eelPatch' && !def.anchorHome) a.p.y = heightAt(a.p.x, a.p.z) + 0.1 + a.s * 0.3 + Math.sin(this.time * 1.3 + a.ph) * 0.02;
          this.orient(rt, a, 1);
          this.writeInstance(rt, a, i);
          continue;
        }
        if (def.behavior === 'crevice') {
          a.q.setFromEuler(_e.set(-0.25 + Math.sin(this.time * 0.5 + a.ph) * 0.05, a.yaw + Math.sin(this.time * 0.3 + a.ph) * 0.12, 0));
          this.writeInstance(rt, a, i);
          continue;
        }
        if (def.behavior === 'static') {
          if (def.flee > 0 && dPlayer < def.flee && a.alarm <= 0) {
            a.alarm = 3.5;
            const away = _v.copy(a.p).sub(player).setY(0).normalize();
            a.v.copy(away).multiplyScalar(1.6);
          }
          if (a.alarm > 0) {
            a.alarm -= dt;
            a.p.addScaledVector(a.v, dt);
            a.v.multiplyScalar(1 - dt * 0.6);
            const gy = heightAt(a.p.x, a.p.z) + this.altitude(def);
            a.p.y += (gy + (a.alarm > 0.5 ? 0.4 : 0) - a.p.y) * Math.min(1, dt * 3);
            this.orient(rt, a, 1 - Math.exp(-dt * 4));
          } else if (!a.fixed) {
            a.q.setFromEuler(_e.set(0, a.yaw, 0));
          }
          this.writeInstance(rt, a, i);
          continue;
        }
        // swimmers
        let tx: number, ty: number, tz: number;
        if (def.behavior === 'anemone') {
          const t = this.time * (def.hab === 'cleaner' ? 1.6 : 0.9) + a.ph;
          tx = g.home.x + Math.sin(t) * 0.35 + a.off.x * 0.3;
          ty = g.home.y + 0.12 + Math.sin(t * 1.7) * 0.1;
          tz = g.home.z + Math.cos(t * 0.8) * 0.35 + a.off.z * 0.3;
        } else {
          const spin = this.time * (def.id === 'sardine' ? 0.35 : 0.08) + a.ph;
          const ox = a.off.x * Math.cos(spin) - a.off.z * Math.sin(spin);
          const oz = a.off.x * Math.sin(spin) + a.off.z * Math.cos(spin);
          tx = g.c.x + ox;
          ty = g.c.y + a.off.y + Math.sin(this.time * 0.5 + a.ph) * 0.2;
          tz = g.c.z + oz;
        }
        const hiding = (def.hab === 'coralHover' || def.hab === 'under') && dPlayer < def.flee * 1.6;
        if (hiding) {
          tx = g.home.x + a.off.x * 0.15;
          // nestle just above the coral surface (still visible) instead of disappearing inside it
          ty = g.home.y + (def.hab === 'coralHover' ? 0.08 : -0.05);
          tz = g.home.z + a.off.z * 0.15;
        }
        _v.set(tx - a.p.x, ty - a.p.y, tz - a.p.z);
        const k = def.behavior === 'anemone' || hiding ? 3 : def.hab === 'coralHover' || def.hab === 'under' || def.hab === 'cleaner' ? 1.6 : 0.9;
        const acc = _v.multiplyScalar(k);
        if (def.flee > 0 && dPlayer < def.flee && !hiding) {
          _v2.copy(a.p).sub(player).normalize().multiplyScalar((def.flee - dPlayer) * 4);
          acc.add(_v2);
        }
        a.v.addScaledVector(acc, dt);
        a.v.multiplyScalar(1 - Math.min(0.9, dt * 1.2));
        const maxV = def.speed * (dPlayer < def.flee ? 2.8 : 1.6) + 0.15;
        const vl = a.v.length();
        if (vl > maxV) a.v.multiplyScalar(maxV / vl);
        // keep a minimum cruising speed for pelagics so they never hover
        if (def.behavior === 'pelagic' && vl < def.speed * 0.4) a.v.add(_v2.set(Math.sin(a.yaw), 0, Math.cos(a.yaw)).multiplyScalar(def.speed * 0.4 * dt * 3));
        a.p.addScaledVector(a.v, dt);
        const gy = heightAt(a.p.x, a.p.z);
        const minY = gy + Math.max(0.06, def.behavior === 'bottom' ? this.altitude(def) : def.hab === 'sandForage' ? a.s * 0.15 : a.s * 0.3);
        if (a.p.y < minY) { a.p.y = minY; a.v.y = Math.max(a.v.y, 0); }
        if (a.p.y > -0.4) { a.p.y = -0.4; a.v.y = Math.min(a.v.y, 0); }
        // near the diver, keep swimmers outside coral heads and rocks
        if (dPlayer < 25 && def.hab !== 'under') resolveSphere(a.p, a.s * 0.25, a.v);
        this.orient(rt, a, 1 - Math.exp(-dt * (def.size > 3 ? 1.2 : 5)));
        this.writeInstance(rt, a, i);
      }
      rt.mesh.count = rt.slot;
      rt.mesh.visible = rt.slot > 0;
      if (rt.halo) { rt.halo.visible = rt.slot > 0; rt.halo.geometry.setDrawRange(0, rt.slot); }
      rt.mesh.instanceMatrix.needsUpdate = true;
      if (rt.mesh.instanceColor) rt.mesh.instanceColor.needsUpdate = true;
      if (rt.halo) rt.halo.geometry.attributes.position.needsUpdate = true;
    }
  }

  /**
   * Best photographable creature. A shot counts only if the animal is inside the photo crop,
   * large enough in frame, close enough to be sharp through the water, not hidden by terrain,
   * and lit (in the dark deep: inside the dive light's beam or bioluminescent).
   */
  findTarget(cam: THREE.PerspectiveCamera, o: { clear: number; dark: boolean; lightOn: boolean; cropX: number; cropY: number }): PhotoTarget | null {
    const fwd = _v.set(0, 0, -1).applyQuaternion(cam.quaternion);
    const cp = cam.position;
    const fovV = (cam.fov * Math.PI) / 180;
    let best: PhotoTarget | null = null;
    let bestScore = -Infinity;
    const ndc = new THREE.Vector3();
    for (const rt of this.list) {
      if (!rt.active) continue;
      const def = rt.def;
      for (const a of rt.agents) {
        if (def.behavior === 'buried' && a.retract > 0.5) continue;
        _v2.copy(a.p).sub(cp);
        const dist = _v2.length();
        if (dist > 60 || _v2.dot(fwd) <= 0) continue;
        // inside the photo crop?
        ndc.copy(a.p).project(cam);
        if (Math.abs(ndc.x) > o.cropX || Math.abs(ndc.y) > o.cropY) continue;
        // how big is it in the frame?
        const span = a.s * (def.kind === 'jelly' || def.kind === 'inv' ? 1.0 : 0.8);
        const frac = (2 * Math.atan(span / 2 / Math.max(dist, 0.05))) / fovV;
        if (frac < 0.025) continue;
        let reason: PhotoTarget['reason'] = 'ok';
        if (frac < 0.06) reason = 'small';
        if (dist > o.clear) reason = 'murky';
        if (o.dark) {
          const glows = !!def.mat?.glow;
          const inBeam = o.lightOn && _v2.angleTo(fwd) < 0.5 && dist < 14;
          if (!inBeam && !(glows && dist < 9)) reason = 'dark';
        }
        if (reason === 'ok' && this.occluded(cp, a.p)) reason = 'hidden';
        const centred = 1 - Math.min(1, Math.hypot(ndc.x / o.cropX, ndc.y / o.cropY));
        const score = (reason === 'ok' ? 3 : 0) + Math.min(frac, 0.5) * 4 + centred + (def.rarity - 1) * 0.1;
        if (score > bestScore) {
          bestScore = score;
          best = { rt, agent: a, dist, angle: _v2.angleTo(fwd), inRange: reason === 'ok', reason, frac };
        }
      }
    }
    return best;
  }

  /** Terrain between camera and subject? (coarse ray march against the height field) */
  private occluded(from: THREE.Vector3, to: THREE.Vector3): boolean {
    const n = 10;
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const x = from.x + (to.x - from.x) * t, y = from.y + (to.y - from.y) * t, z = from.z + (to.z - from.z) * t;
      if (heightAt(x, z) > y + 0.15) return true;
    }
    return false;
  }

  nearestOf(id: string, from: THREE.Vector3): number {
    const rt = this.list.find((r) => r.def.id === id);
    if (!rt) return Infinity;
    let d = Infinity;
    for (const a of rt.agents) d = Math.min(d, a.p.distanceTo(from));
    return d;
  }

  stats() {
    let instances = 0;
    let active = 0;
    for (const rt of this.list) {
      instances += rt.agents.length;
      if (rt.active) active++;
    }
    return { species: this.list.length, instances, active };
  }
}
