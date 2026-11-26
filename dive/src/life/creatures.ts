import * as THREE from 'three';
import { SPECIES, type SpeciesDef } from './species';
import { loadPhotoTex, photoFor } from './photoFish';
import { surfaceAt } from '../world/surface';
import { buildCrustacean, buildFish, buildPhotoFish, buildJelly, buildNudibranch, buildOctopus, buildRay, buildSquid, buildTurtle, setAttr } from './models';
import { Paint } from './paint';
import { underwaterMaterial } from '../render/underwater';
import { makeSoftDot } from '../render/textures';
import { caveRoofAt, caveTopAt, heightFast, VENT } from '../world/layout';
import { GARDEN_EEL_PATCH, type Homes } from '../world/flora';
import { clamp, mulberry32 } from '../utils/noise';
import { KEEP, SHADOW, THIN } from '../game/render';
import { resolveCapsule, resolveSphere, segmentBlocked } from '../world/colliders';

type Group = { c: THREE.Vector3; t: THREE.Vector3; home: THREE.Vector3; v: THREE.Vector3; roam: number; timer: number; absent?: boolean;
  /** 5 m cell key this group is registered under in the crowding map (Phase 4) */
  cell?: string;
  /** curious-follow state: 0 idle, 1 following the diver, 2 leaving (Phase 4) */
  cur?: number; curT?: number; curSide?: number };
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
  /** 0..1: wary of a slow diver nearby -> turns broadside to keep an eye on it */
  watch?: number;
  /** aggressive individual (see SpeciesDef.aggro): 0 idle, 1 circling, 2 charging, 3 retreating */
  aggro?: boolean; mode?: number; modeT?: number;
  /** speared by the diver: gone for the rest of this dive */
  taken?: boolean;
  /** time not yet simulated while this far individual was being skipped (PHASE8-DESIGN §6.3-⑦) */
  pend?: number;
  /** drawn to the scattered bait right now (Phase 4) */
  lured?: boolean;
  /** octopus: seconds spent inside grab reach / grab cooldown / the arm warning was shown (Phase 4) */
  octT?: number; octCd?: number; octWarned?: boolean;
  /** cached surface under a crawler: x, z, y */
  gx?: number; gz?: number; gy?: number;
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
  minD?: number;
  /** creature time when an individual was last within drawing range (PHASE8-DESIGN §6.3-⑥) */
  lastNear?: number;
};

const UPRIGHT = new Set(['jelly', 'octopus', 'dumbo', 'nudi', 'isopod', 'lobster', 'gardenEel', 'inv']);
const _m = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _eStage = new THREE.Euler();
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

/** Distance beyond which an individual of body length `s` is not drawn (lost in the haze). */
function drawCut(s: number): number {
  return s < 0.12 ? 20 : s < 0.35 ? 34 : s < 1 ? 46 : 52 + s * 3;
}

function makeMaterial(def: SpeciesDef, map: THREE.Texture, uvAspect = 0.3, photo = false): THREE.MeshStandardMaterial {
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
  // flashlight fish blink their light organ on and off, each on its own phase (see GLOW_BLINK below)
  const blink = def.id === 'hikarikinme' || def.id === 'hikarikinme2';
  if (blink) mat.defines = { ...(mat.defines ?? {}), GLOW_BLINK: '' };
  if (def.rainbow) mat.defines = { ...(mat.defines ?? {}), RAINBOW: '' };
  const scaly = !photo && (def.kind === 'fish' || def.kind === 'gardenEel');
  if (photo) {
    // photographed skin already carries scales / pattern; the outline comes from alpha
    mat.alphaTest = 0.5;
    mat.defines = { ...(mat.defines ?? {}), PHOTO_FISH: '' };
    mat.roughness = Math.min(mat.roughness, (m.metal ?? 0) > 0.3 ? 0.3 : 0.42);
  }
  if (scaly) {
    mat.defines = { ...(mat.defines ?? {}), FISH_SCALES: '' };
    // wet, glossy skin; silver species keep their metal value
    mat.roughness = Math.min(mat.roughness, (m.metal ?? 0) > 0.3 ? 0.28 : 0.38);
  }
  return underwaterMaterial(mat, {
    key: 'cr-' + def.kind + (translucent ? '-t' : '') + (photo ? '-p' : '') + (blink ? '-blink' : ''),
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
      uniform vec3 uSwim; uniform vec3 uFlap; uniform vec2 uPulse; varying float vGlow; varying float vFin; varying float vPh;`,
    vertexBody: `
      float ph = 0.0;
      #ifdef USE_INSTANCING
        ph = instanceMatrix[3].x * 0.71 + instanceMatrix[3].z * 0.53 + instanceMatrix[3].y * 0.37;
      #endif
      vPh = ph;
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
    fragHead: 'uniform vec3 uGlowCol; uniform float uGlowAmt; varying float vGlow; varying float vFin; varying float vPh; uniform float uUvAspect; uniform float uFishSize;',
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
        if ( vFin > 0.5 && vFin < 1.5 ) {
          float fe = clamp( ( vFin - 1.0 ) / 0.49, 0.0, 1.0 );
          diffuseColor.rgb = mix( diffuseColor.rgb, vec3( dot( diffuseColor.rgb, vec3( 0.33 ) ) ), 0.15 ) * 1.12;
          // thin margins: paler, light passes through
          diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * 1.3 + 0.035, fe * 0.55 );
        }
      #endif
      #if defined( FISH_SCALES ) && defined( USE_MAP )
      if ( vFin < 0.5 ) diffuseColor.rgb *= 0.985 + 0.02 * fishScale( vMapUv );
      else if ( vFin < 1.5 ) diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * ( 0.9 + 0.14 * abs( sin( vMapUv.y * 150.0 ) ) ), 0.7 * ( 1.0 - smoothstep( 0.8, 2.5, uFishSize ) ) );
      #endif`,
    fragBeforeLights: `
      #if defined( PHOTO_FISH ) && defined( USE_MAP )
        // photographed relief: luminance detail as a faint bump so scales and gill plates catch the light
        normal = uwBump( normal, dot( texture2D( map, vMapUv ).rgb, vec3( 0.3, 0.59, 0.11 ) ) * uFishSize * 0.004 );
      #endif
      #if defined( FISH_SCALES ) && defined( USE_MAP )
      {
        // relief fades with size: on big animals a texture-space pattern turns into coarse banding
        float big = 1.0 - smoothstep( 0.6, 2.0, uFishSize );
        float hb = vFin < 0.5 ? fishScale( vMapUv ) * uFishSize * 0.0006 * ( 0.3 + 0.7 * big ) : vFin < 1.5 ? abs( sin( vMapUv.y * 150.0 ) ) * uFishSize * 0.00035 * big : 0.0;
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
        // fin translucency: sunlight scattering through the membrane, strongest at the thin margin
        if ( vFin > 0.5 && vFin < 1.5 ) totalEmissiveRadiance += diffuseColor.rgb * uSunCol * clamp( ( vFin - 1.0 ) / 0.49, 0.0, 1.0 ) * 0.3 * exp( min( vUwPos.y, 0.0 ) / 30.0 );
      }
      #ifdef RAINBOW
        vec3 hue = 0.5 + 0.5 * cos( 6.2831 * ( vUwPos.y * 4.0 - uTime * 0.9 + vec3( 0.0, 0.33, 0.67 ) ) );
        totalEmissiveRadiance += hue * vGlow * 1.4;
      #elif defined( GLOW_BLINK )
        // per-instance blink: phase from the instance position, so the school winks on and off
        // one fish at a time and each light drops to fully dark for part of the cycle
        float blk = smoothstep( -0.3, 0.4, sin( uTime * 1.9 + vPh * 6.2831 ) );
        totalEmissiveRadiance += uGlowCol * vGlow * uGlowAmt * blk * 2.6;
      #else
        totalEmissiveRadiance += uGlowCol * vGlow * uGlowAmt * ( 2.2 + 0.6 * sin( uTime * 2.7 ) );
      #endif`,
  });
}

export type PhotoTarget = {
  rt: SpeciesRuntime; agent: Agent; dist: number; angle: number; inRange: boolean; reason: 'ok' | 'small' | 'murky' | 'dark' | 'hidden'; frac: number;
  /** 0..1: how close to the middle of the frame */
  centred: number;
  /** share of the body (head to tail, top to bottom) that lies inside the photo crop, 0..1 */
  fit: number;
  /** how much of the crop the subject's outline spans (0..1+, by its larger side): above ~0.9 it crowds the edges */
  fill: number;
  /** 0..1: 1 = perfect side view (fish), always 1 for animals without a "side" */
  side: number;
  /** the individual is circling / charging the diver right now */
  danger: boolean;
  /** sharp-photo distance used for this subject (lens dependent) */
  clear: number;
};

/**
 * Escape direction from away-vector `away` (player -> fish): a mix of a horizontal tangent (on the side the fish
 * is already moving) and the radial direction weighted by `radialW`. Writes a unit vector into `out`.
 */
function fleeDir(away: THREE.Vector3, vel: THREE.Vector3, radialW: number, out: THREE.Vector3, side = 0): THREE.Vector3 {
  const L = away.length() || 1;
  const rx = away.x / L, ry = away.y / L, rz = away.z / L;
  const h = Math.hypot(rx, rz) || 1;
  let tx = -rz / h, tz = rx / h;
  // Phase 4: with a fixed per-individual `side`, half the school veers left and half right,
  // so a fleeing school no longer piles onto one point beside the diver
  if (side !== 0) { if (side < 0) { tx = -tx; tz = -tz; } }
  else if (tx * vel.x + tz * vel.z < 0) { tx = -tx; tz = -tz; }
  out.set(tx + rx * radialW * 1.4, ry * radialW, tz + rz * radialW * 1.4);
  return out.normalize();
}

export type CreatureEvent = { type: 'warn' | 'charge' | 'hit' | 'repel' | 'octoWarn' | 'grab'; def: SpeciesDef; p: THREE.Vector3; agent?: Agent };

/** Night dive risk: daytime fish sleep (fewer groups show), and needlefish rush at the diver's light. */
export const NIGHT = {
  /** chance multiplier for a daytime species' group to be out at night (rarity-1 species keep one group) */
  dayPresence: 0.4,
  /** 'light' aggro only reacts to a diver shallower than this (m) */
  lightDepth: 8,
  /** seconds a needlefish hangs in the beam before it charges */
  lightWind: 0.8,
};
/** A rescued animal swimming with the diver. */
const COMPANION = { ahead: 2.2, side: 1.6, minSpeed: 1.2, warp: 25, warpBack: 4 };

/** Phase 4: how schools spread over habitat points and how residents react to the diver. */
export const SPREAD = { cell: 5, maxSpecies: 3, hideSpread: 0.7, linger: 0.15, residentFlee: 0.75, leash: 4, leashSize: 3 };
/** Phase 4: curious species (dolphins, turtles, seals...) follow the diver for a while, then leave. */
export const CURIOUS = { startR: 25, follow: 30, leaveR: 45, cooldown: 120, side: 5, away: 60 };
/** Phase 4: octopus grab (air loss, shake free with shutter taps). */
export const OCTO = { minSize: 0.3, grabR: 0.5, grabRSize: 0.8, dwell: 1.0, fleeSpeed: 0.9, first: 3, perSec: 1.5, big: 1.5, taps: 6, tapsBig: 9, maxHold: 6, cooldown: 20 };
/** Phase 4: photo targeting only counts animals the diver can actually see in the frame. */
export const PHOTO_VIS = { fogCut: 1.3, darkSeen: 4, minFit: 0.4, occTests: 8 };
/** Phase 4: bait lure limits (never too many fish, never more than 2-3 species at once). */
export const LURE = { radius: 15, maxFish: 10, maxSpecies: 3, refill: 2, fear: 0.3 };

export class Creatures {
  /** encounters for the game layer (warnings, charges, bites); drained every frame */
  events: CreatureEvent[] = [];
  /** time budget per frame for lazily building species meshes (raised while a loading screen is up) */
  buildBudgetMs = 6;
  /** gear effects set by the game: rebreather (no bubbles) shrinks flight distance; shark shield turns charges away */
  stealth = 1;
  shield = false;
  /** night dive: nocturnal species come out */
  night = false;
  /** staged individuals for a special sight: species id -> fixed poses (head-up sleeping whales, ...) */
  stage = new Map<string, { p: THREE.Vector3; yaw: number; pitch: number; s?: number; still?: boolean }[]>();
  /** test-only: pin agent 0 of a species */
  pin: { id: string; p: THREE.Vector3; yaw: number } | null = null;
  /** a rescued animal that swims beside the diver for the rest of the dive (agent 0 of that species) */
  companion: { id: string; p: THREE.Vector3; v: THREE.Vector3; yaw: number } | null = null;
  /** the diver's light is on (set by the game each frame); 'light' aggro species react to it at night */
  lightOn = false;
  /** the diver is in the ADS (deep dive): curious followers turn back (set by the game, Phase 4) */
  ads = false;
  readonly group = new THREE.Group();
  readonly list: SpeciesRuntime[] = [];
  private rnd = mulberry32(77);
  private haloTex = makeSoftDot('rgba(255,255,255,1)', 'rgba(255,255,255,0.25)');
  time = 0;
  /** the individual in the viewfinder (set by the game): always simulated every frame */
  focus: Agent | null = null;

  private homes!: Homes;
  constructor(homes: Homes) {
    this.homes = homes;
    for (const def of SPECIES) this.list.push(this.spawn(def, homes));
  }

  /** how many groups were sent to each habitat point this dive (spreads species out instead of stacking them) */
  private homeUse = new Map<THREE.Vector3, number>();

  /** Phase 4: presence multiplier from the day's weather, set by the game at dive start (1 = no effect). */
  weatherMult: (def: SpeciesDef) => number = () => 1;
  /** Phase 4: the bait cloud in the water right now, if any. */
  bait: { p: THREE.Vector3; t: number; kind: string; eats: (def: SpeciesDef) => boolean; fish: Set<Agent>; species: Set<string>; refill: number; life: number } | null = null;
  /** Phase 4: the octopus holding the diver right now, if any (the game drains the air and counts taps). */
  grab: { rt: SpeciesRuntime; a: Agent; t: number; taps: number; need: number } | null = null;

  /** Phase 4 crowding map: 5 m cell -> species id -> number of groups living there (swimming kinds only). */
  private spotMix = new Map<string, Map<string, number>>();
  private coralAllCache: THREE.Vector3[] | null = null;

  private cellKey(x: number, z: number): string {
    return Math.floor(x / SPREAD.cell) + ',' + Math.floor(z / SPREAD.cell);
  }

  /** Would one more group of `id` overcrowd this cell (already SPREAD.maxSpecies other swimming species)? */
  private mixFull(id: string, x: number, z: number): boolean {
    const m = this.spotMix.get(this.cellKey(x, z));
    if (!m) return false;
    let n = 0;
    for (const k of m.keys()) if (k !== id) n++;
    return n >= SPREAD.maxSpecies;
  }

  /** Register a group's home cell (and unregister the old one). Only swimming kinds count toward crowding. */
  private mixSet(def: SpeciesDef, g: Group, p: THREE.Vector3): void {
    if (g.cell) {
      const m = this.spotMix.get(g.cell);
      if (m) {
        const n = (m.get(def.id) ?? 1) - 1;
        if (n <= 0) m.delete(def.id); else m.set(def.id, n);
        if (!m.size) this.spotMix.delete(g.cell);
      }
      g.cell = undefined;
    }
    if (!(def.kind === 'fish' || def.kind === 'ray' || def.kind === 'squid' || def.kind === 'turtle')) return;
    const k = this.cellKey(p.x, p.z);
    let m = this.spotMix.get(k);
    if (!m) this.spotMix.set(k, (m = new Map()));
    m.set(def.id, (m.get(def.id) ?? 0) + 1);
    g.cell = k;
  }

  /** Habitat list for a region name; 'coralTops' also draws on every coral colony top (Phase 4). */
  private homeList(reg: string): THREE.Vector3[] {
    if (reg === 'coralTops') {
      if (!this.coralAllCache) this.coralAllCache = [...this.homes.coralTops, ...this.homes.coralAll];
      return this.coralAllCache;
    }
    return (this.homes as unknown as Record<string, THREE.Vector3[]>)[reg];
  }

  /** Of a few random candidates, take the least crowded habitat point. */
  private pickSpread(arr: THREE.Vector3[], ok: (q: THREE.Vector3) => boolean = () => true, tries = 8, id?: string): THREE.Vector3 | null {
    if (id) tries *= 2; // Phase 4: with a species id, sample more so the crowding check can bite
    let best: THREE.Vector3 | null = null, bestUse = Infinity;
    for (let k = 0, found = 0; k < tries * 5 && found < tries; k++) {
      const q = arr[Math.floor(this.rnd() * arr.length)];
      if (!q || !ok(q)) continue;
      found++;
      let u = (this.homeUse.get(q) ?? 0) + this.rnd() * 0.5;
      if (id && this.mixFull(id, q.x, q.z)) u += 50; // crowded cell: last resort only
      if (u < bestUse) { bestUse = u; best = q; }
    }
    if (best) this.homeUse.set(best, (this.homeUse.get(best) ?? 0) + 1);
    return best;
  }

  private pickHome(def: SpeciesDef, homes: Homes, i: number): THREE.Vector3 {
    const r = this.rnd;
    const reg = def.region;
    const fromList = (arr: THREE.Vector3[]) => (this.pickSpread(arr, () => true, 8, def.id) ?? arr[Math.floor(r() * arr.length) % Math.max(1, arr.length)]).clone();
    let p: THREE.Vector3;
    if (reg === 'anemones') {
      // each anemonefish species keeps its own host anemones
      const off: Record<string, number> = { clownfish: 0, hamakumanomi: 9, kumanomi: 14, hanabirakuma: 19 };
      p = homes.anemones[((off[def.id] ?? 0) + i) % homes.anemones.length].clone();
    }
    else if (reg === 'crevices') p = homes.crevices[(i * 7) % homes.crevices.length].clone();
    else if (reg === 'reefSpots') p = fromList(homes.reefSpots);
    else if (reg === 'rockSpots') p = fromList(homes.rockSpots);
    else if (reg === 'coralTops') p = fromList(this.homeList('coralTops'));
    else if (reg === 'underTables') p = fromList(homes.underTables);
    else if (reg === 'wallSpots') p = fromList(homes.wallSpots);
    else if (reg === 'sandSpots') p = fromList(homes.sandSpots);
    else if (reg === 'grassSpots') p = fromList(homes.grassSpots);
    else if (reg === 'bommieSpots') p = fromList(homes.bommieSpots);
    else if (reg === 'coldSpots') p = fromList(homes.coldSpots);
    else if (reg === 'caveSpots') p = fromList(homes.caveSpots);
    else if (reg === 'caveTopSpots') p = fromList(homes.caveTopSpots);
    else if (reg === 'kelpSpots') p = fromList(homes.kelpSpots);
    else if (reg === 'vent') {
      const a = r() * Math.PI * 2, d = 5 + r() * 18;
      const x = VENT.x + Math.cos(a) * d, z = VENT.z + Math.sin(a) * d;
      p = new THREE.Vector3(x, heightFast(x, z), z);
    } else if (reg === 'eelPatch') {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * GARDEN_EEL_PATCH.r;
      const x = GARDEN_EEL_PATCH.x + Math.cos(a) * d, z = GARDEN_EEL_PATCH.z + Math.sin(a) * d;
      p = new THREE.Vector3(x, heightFast(x, z), z);
    } else {
      let x = 0, z = 0, ground = 0, y = 0;
      for (let k = 0; k < 40; k++) {
        const rg = reg as [number, number, number, number];
        x = rg[0] + r() * (rg[1] - rg[0]);
        z = rg[2] + r() * (rg[3] - rg[2]);
        ground = heightFast(x, z);
        y = -(def.depth[0] + r() * (def.depth[1] - def.depth[0]));
        if (k <= 30 && this.mixFull(def.id, x, z)) continue; // Phase 4: don't stack into a crowded cell
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
    else out.y = Math.min(this.groundY(def, out.x, out.z) + rnd(b.lo, b.hi), -0.8);
    return true;
  }

  /** Ground under an animal: cave-top sand species stand on the plateau, not in the trench below. */
  private groundY(def: SpeciesDef, x: number, z: number): number {
    return def.region === 'caveTopSpots' ? (caveTopAt(x, z) ?? heightFast(x, z)) : heightFast(x, z);
  }

  /** Animals that live on the bottom and must sit on it (sand, rock or coral), never hover. */
  private benthic(def: SpeciesDef): boolean {
    if (def.kind === 'none') return false;
    return def.behavior === 'static' || (def.behavior === 'bottom' && def.kind !== 'ray' && def.kind !== 'dumbo');
  }

  /** Height at which a benthic animal rests on the real surface (terrain or rock / coral top). */
  private restY(def: SpeciesDef, x: number, z: number, s: number): number {
    const base = def.region === 'caveTopSpots' ? (caveTopAt(x, z) ?? surfaceAt(x, z)) : surfaceAt(x, z);
    return base + (def.kind === 'fish' ? s * 0.1 : def.kind === 'octopus' ? s * 0.08 : 0.005);
  }

  /** Same, cached per agent while it crawls (re-sampled every 20 cm). */
  private crawlY(def: SpeciesDef, a: Agent): number {
    if (a.gx === undefined || Math.abs(a.p.x - a.gx) + Math.abs(a.p.z - a.gz!) > 0.2) {
      a.gx = a.p.x; a.gz = a.p.z; a.gy = this.restY(def, a.p.x, a.p.z, a.s);
    }
    return a.gy!;
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
        const g0 = heightFast(home.x, home.z);
        home.y = Math.max(home.y, g0 + this.altitude(def));
      }
      const roam = def.behavior === 'pelagic' ? 60 : def.behavior === 'drift' ? 14 : def.region === 'reefSpots' ? 5 : 20;
      const gNew = { c: home.clone(), t: home.clone(), home, v: new THREE.Vector3(), roam, timer: 0 };
      rt.groups.push(gNew);
      this.mixSet(def, gNew, home);
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
          a.p.y = heightFast(a.p.x, a.p.z) - 0.12 * a.s;
          a.fixed = true;
        } else {
          // goby hovering over its burrow (or a tube worm fixed on coral)
          a.p.set(g.home.x + (r() - 0.5) * 1.2, 0, g.home.z + (r() - 0.5) * 1.2);
          a.p.y = def.anchorHome ? g.home.y + (r() - 0.5) * 0.2 : this.groundY(def, a.p.x, a.p.z) + 0.12 + a.s * 0.3;
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
        a.p.y = heightFast(a.p.x, a.p.z) + (def.kind === 'lobster' ? 0.05 : 0.35 + r() * 0.4);
        a.fixed = true;
      } else if (def.behavior === 'static') {
        const onTop = def.region === 'rockSpots' || def.region === 'coralTops' || def.region === 'bommieSpots' || def.region === 'coldSpots';
        const spread = onTop ? 1.2 : 3;
        a.p.copy(g.home).add(new THREE.Vector3((r() - 0.5) * spread, 0, (r() - 0.5) * spread));
        a.p.y = this.restY(def, a.p.x, a.p.z, a.s);
        if (def.kind === 'none') a.p.set(VENT.x, heightFast(VENT.x, VENT.z) + 1.5, VENT.z);
      }
      if (def.instColors) a.col = new THREE.Color(def.instColors[Math.floor(r() * def.instColors.length)]);
      rt.agents.push(a);
    }
    for (const g of rt.groups) rt.bounds.expandByPoint(g.home);
    rt.bounds.expandByScalar(Math.max(...rt.groups.map((g) => g.roam)) + def.size * 2 + 10);

    return rt;
  }

  /**
   * Mesh, painted texture and material for a species, built on first need (when it comes near the diver)
   * instead of for all ~375 species at start-up.
   */
  private buildMesh(rt: SpeciesRuntime): void {
    const def = rt.def;
      const photo = def.kind === 'fish' ? photoFor(def.id) : null;
      let geo: THREE.BufferGeometry;
      let mat: THREE.MeshStandardMaterial;
      if (photo) {
        geo = buildPhotoFish(photo.prof, photo.aspect, def.photoWidth ?? (def.fish ? Math.min(0.7, def.fish.W / def.fish.H) : 0.42));
        mat = makeMaterial(def, loadPhotoTex(photo.url), 1 / photo.aspect, true);
      } else {
        const b = buildGeometry(def);
        geo = b.geo;
        def.paint?.(b.paint);
        const tex = new THREE.CanvasTexture(b.paint.c);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 4;
        const lay = b.paint.fish;
        mat = makeMaterial(def, tex, lay ? (2 * lay.yMax) / (lay.zMax - lay.zMin) : 0.3);
      }
      const mesh = new THREE.InstancedMesh(geo, mat, def.count);
      mesh.frustumCulled = false;
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
        const hm = this.haloMaterial(def.mat.glow, def.id === 'atolla' ? def.size * 3.2 : Math.max(0.2, Math.min(0.7, def.size * 2)));
        rt.halo = new THREE.Points(hg, hm);
        rt.halo.frustumCulled = false;
        this.group.add(rt.halo);
        if (def.id === 'angler') rt.lureOffset = new THREE.Vector3(0, def.fish!.H / 2 + 0.22, 0.54);
      }
      rt.lastNear = this.time;
      this.held.add(rt);
      this.writeAll(rt);
      }

  /** Species whose mesh, texture and material exist right now. */
  private held = new Set<SpeciesRuntime>();

  /** Free everything buildMesh made; the species is built again when it comes near. */
  private disposeMesh(rt: SpeciesRuntime): void {
    const mesh = rt.mesh;
    if (!mesh) return;
    this.group.remove(mesh);
    const mat = mesh.material as THREE.MeshStandardMaterial;
    mat.map?.dispose(); // painted or photo texture, one per species
    mat.dispose();
    mesh.geometry.dispose();
    mesh.dispose(); // instance matrices and colours
    if (rt.halo) {
      this.group.remove(rt.halo);
      rt.halo.geometry.dispose();
      (rt.halo.material as THREE.Material).dispose(); // its texture (haloTex) is shared: kept
    }
    rt.mesh = undefined;
    rt.halo = undefined;
    rt.haloPos = undefined;
    rt.lureOffset = undefined;
    this.held.delete(rt);
  }

  /** Keep at most KEEP.species built: drop those that have been away the longest, if away long enough. */
  private evict(): void {
    if (this.held.size <= KEEP.species) return;
    const away: SpeciesRuntime[] = [];
    for (const rt of this.held) {
      const id = rt.def.id;
      if (this.stage.has(id) || this.pin?.id === id || this.companion?.id === id) continue;
      if (this.time - (rt.lastNear ?? 0) >= KEEP.idleSec) away.push(rt);
    }
    away.sort((a, b) => (a.lastNear ?? 0) - (b.lastNear ?? 0));
    for (const rt of away) {
      if (this.held.size <= KEEP.species) break;
      this.disposeMesh(rt);
    }
  }

  /**
   * Is any individual of an unbuilt species within drawing range? 2: and not behind the camera (it would be
   * drawn this frame), 1: only behind, 0: none.
   */
  private drawable(rt: SpeciesRuntime): 0 | 1 | 2 {
    let found: 0 | 1 = 0;
    for (const a of rt.agents) {
      if (rt.groups[a.g].absent || a.taken) continue;
      const dx = a.p.x - this.viewPos.x, dy = a.p.y - this.viewPos.y, dz = a.p.z - this.viewPos.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > drawCut(a.s) * 1.1) continue;
      const reach = a.s * 1.5 + 2;
      if (d <= reach || dx * this.viewDir.x + dy * this.viewDir.y + dz * this.viewDir.z >= -reach) return 2;
      found = 1;
    }
    return found;
  }

  /**
   * One tiny instanced mesh per distinct kind of creature shader, so that all of them can be compiled
   * before a dive (PHASE8-DESIGN §6.3-⑧). The caller keeps these objects: while their materials live,
   * the compiled programs are not released when species meshes are disposed.
   */
  warmupObjects(): THREE.Object3D[] {
    const map = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    map.colorSpace = THREE.SRGBColorSpace;
    map.needsUpdate = true;
    const geo = new THREE.BufferGeometry();
    for (const [name, size] of [['position', 3], ['normal', 3], ['uv', 2], ['aBend', 1], ['aFlap', 1], ['aPulse', 1], ['aGlow', 1], ['aFin', 1]] as const) {
      geo.setAttribute(name, new THREE.BufferAttribute(new Float32Array(3 * size), size));
    }
    const seen = new Set<string>();
    const out: THREE.Object3D[] = [];
    let halo = false;
    for (const def of SPECIES) {
      if (def.kind === 'none') continue;
      const photo = def.kind === 'fish' && !!photoFor(def.id);
      const sig = [def.kind, def.mat?.translucent !== undefined, photo, def.id.startsWith('hikarikinme'), def.id === 'atolla', !!def.rainbow, !!def.fish?.bendY, !!def.instColors].join('|');
      if (!seen.has(sig)) {
        seen.add(sig);
        const mesh = new THREE.InstancedMesh(geo, makeMaterial(def, map, 0.3, photo), 1);
        if (def.instColors) mesh.setColorAt(0, new THREE.Color(1, 1, 1));
        mesh.castShadow = def.kind !== 'jelly';
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;
        out.push(mesh);
      }
      if (def.mat?.glow && !halo) {
        halo = true;
        const pts = new THREE.Points(geo, this.haloMaterial(def.mat.glow, 0.2));
        pts.frustumCulled = false;
        out.push(pts);
      }
    }
    return out;
  }

  private haloMaterial(color: number, size: number): THREE.PointsMaterial {
    return new THREE.PointsMaterial({
      map: this.haloTex,
      color,
      size,
      sizeAttenuation: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      opacity: 0.85,
    });
  }

  private writeAll(rt: SpeciesRuntime) {
    rt.slot = 0;
    rt.minD = 1e9;
    rt.agents.forEach((a, i) => {
      this.orient(rt, a, 1);
      this.writeInstance(rt, a, i);
    });
    rt.mesh!.count = rt.slot;
    rt.mesh!.instanceMatrix.needsUpdate = true;
    this.shadowFor(rt);
  }

  /** Only large animals close to the diver cast a sun shadow (PHASE8-DESIGN §6.3-①). */
  private shadowFor(rt: SpeciesRuntime): void {
    rt.mesh!.castShadow = rt.def.kind !== 'jelly' && rt.def.size >= SHADOW.creatureSize && (rt.minD ?? 1e9) < SHADOW.creatureDist;
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
    if (a.watch && a.watch > 0) {
      // broadside to the diver: steer toward the nearer of the two tangent headings
      const ty = Math.atan2(-(a.p.z - this.viewPos.z), a.p.x - this.viewPos.x);
      let best = ty - a.yaw;
      while (best > Math.PI) best -= Math.PI * 2;
      while (best < -Math.PI) best += Math.PI * 2;
      if (best > Math.PI / 2) best -= Math.PI;
      else if (best < -Math.PI / 2) best += Math.PI;
      a.yaw += best * k * a.watch * 0.7;
    }
    let pitch = 0;
    let roll = 0;
    if (!UPRIGHT.has(def.kind) && sp > 0.02) {
      pitch = -Math.asin(clamp(a.v.y / sp, -0.8, 0.8)) * 0.8;
    }
    if (def.id === 'oarfish') pitch = -1.25;
    if (def.pitch !== undefined) pitch = def.pitch;
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
    if (d > drawCut(s)) return;
    rt.lastNear = this.time;
    if (!rt.mesh) return; // not built yet (nothing of it has been in sight)
    if (d > reach && (dx * this.viewDir.x + dy * this.viewDir.y + dz * this.viewDir.z) < -reach) return;
    const i = rt.slot++;
    if (d < (rt.minD ?? 1e9)) rt.minD = d;
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
      const list = this.homeList(reg);
      if (!list?.length) return false;
      const q = this.pickSpread(list, (h) => ok(h.x, h.z), 8, def.id);
      if (q) p = q.clone();
    } else {
      const x0 = Math.max(reg[0], player.x - 75), x1 = Math.min(reg[1], player.x + 75);
      const z0 = Math.max(reg[2], player.z - 75), z1 = Math.min(reg[3], player.z + 75);
      if (x0 >= x1 || z0 >= z1) return false;
      for (let k = 0; k < 30 && !p; k++) {
        const x = x0 + r() * (x1 - x0), z = z0 + r() * (z1 - z0);
        if (!ok(x, z)) continue;
        if (k < 24 && this.mixFull(def.id, x, z)) continue; // Phase 4: keep cells at 2-3 species
        const ground = heightFast(x, z);
        const y = -(def.depth[0] + r() * (def.depth[1] - def.depth[0]));
        if (y < ground + 0.5 && def.behavior !== 'bottom' && def.behavior !== 'static') continue;
        p = new THREE.Vector3(x, Math.max(y, ground + this.altitude(def)), z);
      }
    }
    if (!p) return false;
    const g = rt.groups[gi];
    this.mixSet(def, g, p);
    g.cur = 0; g.curT = 0;
    g.home.copy(p);
    if (def.hab && def.behavior !== 'static' && def.behavior !== 'buried') this.habTarget(def, g, g.t);
    else g.t.copy(p);
    g.c.copy(def.hab ? g.t : p);
    g.v.set(0, 0, 0);
    for (const a of rt.agents) {
      if (a.g !== gi) continue;
      if (def.behavior === 'static') {
        a.p.copy(p);
        // benthic animals scatter over several metres rather than piling up on one rock
        const spread = def.region === 'rockSpots' || def.region === 'coralTops' || def.region === 'bommieSpots' || def.region === 'coldSpots' ? 3.5 : 6;
        a.p.x += (r() - 0.5) * spread; a.p.z += (r() - 0.5) * spread;
        a.p.y = this.restY(def, a.p.x, a.p.z, a.s);
        a.gx = undefined;
        a.alarm = 0;
      } else if (def.behavior === 'buried') {
        a.p.set(p.x + (r() - 0.5) * 1.2, 0, p.z + (r() - 0.5) * 1.2);
        a.p.y = def.anchorHome ? p.y + (r() - 0.5) * 0.2 : heightFast(a.p.x, a.p.z) + 0.12 + a.s * 0.3;
        a.retract = 0;
      } else {
        a.p.copy(g.c).add(a.off);
        const gy = heightFast(a.p.x, a.p.z) + 0.1;
        if (a.p.y < gy) a.p.y = gy;
      }
    }
    return true;
  }

  /**
   * Phase 4 curious-follow state machine (per group): idle -> following the diver's side for
   * CURIOUS.follow seconds -> leaving to a point 60 m away, with a long cooldown. No more
   * endless circling around the diver.
   */
  private curiousStep(def: SpeciesDef, g: Group, player: THREE.Vector3, playerVel: THREE.Vector3, dt: number): void {
    const dist = player.distanceTo(g.c);
    g.curT = (g.curT ?? 0) - dt;
    if (!g.cur) {
      if (!g.absent && g.curT <= 0 && dist < CURIOUS.startR && dist > def.size * 1.5 + 2) {
        g.cur = 1; g.curT = CURIOUS.follow; g.curSide = this.rnd() < 0.5 ? -1 : 1;
      }
      return;
    }
    if (g.cur === 1) {
      if (g.curT <= 0 || dist > CURIOUS.leaveR || this.ads) {
        g.cur = 2; g.curT = CURIOUS.cooldown; g.timer = CURIOUS.cooldown;
        _v.copy(g.c).sub(player); _v.y = 0;
        if (_v.lengthSq() < 0.01) _v.set(1, 0, 0);
        _v.normalize();
        g.t.copy(g.c).addScaledVector(_v, CURIOUS.away);
        return;
      }
      // follow at the diver's side: heading from the swim direction, or the view when barely moving
      let fx = playerVel.x, fz = playerVel.z;
      if (Math.hypot(fx, fz) < 0.3) { fx = this.viewDir.x; fz = this.viewDir.z; }
      const fl = Math.hypot(fx, fz) || 1; fx /= fl; fz /= fl;
      const side = (CURIOUS.side + def.size) * (g.curSide ?? 1);
      const ahead = 1.5 + Math.sin(this.time * 0.25 + g.home.x) * 2;
      g.t.set(
        player.x + fz * side + fx * ahead,
        player.y - 1 + Math.sin(this.time * 0.3 + g.home.z) * 0.8,
        player.z - fx * side + fz * ahead,
      );
      g.timer = Math.max(g.timer, 1);
    } else if (g.curT <= 0) {
      g.cur = 0; g.curT = 0; g.timer = 0;
    }
  }

  /** Phase 4: octopus big enough to grab the diver (the tiny blue-ringed and the dumbo are exempt). */
  private grabber(def: SpeciesDef): boolean {
    return def.kind === 'octopus' && def.size >= OCTO.minSize;
  }

  /**
   * Phase 4 octopus grab: a slow approach does not scare it off; stay inside grab reach for
   * OCTO.dwell seconds and it wraps its arms around the diver (the game drains air and counts
   * shutter taps; releaseGrab lets it go). Returns true when this agent is fully handled here.
   */
  private octoStep(rt: SpeciesRuntime, a: Agent, player: THREE.Vector3, playerVel: THREE.Vector3, dt: number): boolean {
    const def = rt.def;
    if (!this.grabber(def)) return false;
    a.octCd = Math.max(0, (a.octCd ?? 0) - dt);
    if (this.grab && this.grab.a === a) {
      // held against the diver's front, arms waving
      let fx = this.viewDir.x, fz = this.viewDir.z;
      const fl = Math.hypot(fx, fz) || 1; fx /= fl; fz /= fl;
      _v.set(player.x + fx * 0.55, player.y - 0.45, player.z + fz * 0.55);
      a.p.lerp(_v, Math.min(1, dt * 6));
      a.q.setFromEuler(_e.set(0.4 + Math.sin(this.time * 7) * 0.12, Math.atan2(fx, fz), Math.sin(this.time * 6) * 0.15));
      return true;
    }
    if (a.alarm > 0 || (a.octCd ?? 0) > 0 || this.grab) { a.octT = 0; return false; }
    const reach = OCTO.grabR + def.size * OCTO.grabRSize;
    const d = a.p.distanceTo(player);
    if (d > reach * 3) a.octWarned = false;
    if (d < reach * 2 && !a.octWarned) {
      a.octWarned = true;
      this.events.push({ type: 'octoWarn', def, p: a.p.clone(), agent: a });
    }
    if (d < reach && playerVel.length() <= OCTO.fleeSpeed) {
      a.octT = (a.octT ?? 0) + dt;
      if (a.octT >= OCTO.dwell) {
        a.octT = 0;
        this.grab = { rt, a, t: 0, taps: 0, need: def.size >= 1 ? OCTO.tapsBig : OCTO.taps };
        this.events.push({ type: 'grab', def, p: a.p.clone(), agent: a });
        return true;
      }
    } else a.octT = 0;
    return false;
  }

  /** The diver shakes free (or the octopus lets go): it inks off a few metres and keeps away for a while. */
  releaseGrab(from: THREE.Vector3): void {
    const g = this.grab;
    if (!g) return;
    this.grab = null;
    const a = g.a;
    a.octCd = OCTO.cooldown;
    a.alarm = 3.5;
    _v.copy(a.p).sub(from); _v.y = 0;
    if (_v.lengthSq() < 0.01) _v.set(1, 0, 0);
    a.v.copy(_v.normalize().multiplyScalar(2.2));
    a.gx = undefined;
  }

  /** Scatter bait at a point: any old cloud is cleared first (only one cloud at a time). */
  dropBait(p: THREE.Vector3, kind: string, eats: (def: SpeciesDef) => boolean, life: number): void {
    this.clearBait();
    this.bait = { p: p.clone(), t: 0, kind, eats, fish: new Set(), species: new Set(), refill: 0, life };
  }

  clearBait(): void {
    if (!this.bait) return;
    for (const a of this.bait.fish) a.lured = false;
    this.bait = null;
  }

  /** Which species may be drawn to bait at all (no sharks, no fixed/nest/legendary/curious animals). */
  private lurable(def: SpeciesDef): boolean {
    return def.kind === 'fish' && def.rarity < 4 && !def.aggro && !def.curious
      && (def.behavior === 'school' || def.behavior === 'solo' || def.behavior === 'bottom')
      && !this.benthic(def);
  }

  private baitStep(dt: number): void {
    const b = this.bait;
    if (!b) return;
    b.t += dt;
    if (b.t >= b.life) { this.clearBait(); return; }
    for (const a of [...b.fish]) if (a.taken) { a.lured = false; b.fish.delete(a); }
    // the full scan runs once per LURE.refill seconds, not every frame; only fish that are active (drawn) count (Fix batch 1, P4-4)
    b.refill -= dt;
    if (b.refill > 0) return;
    b.refill = LURE.refill;
    b.species.clear();
    for (const rt of this.list) {
      for (const a of rt.agents) {
        if (!b.fish.has(a)) continue;
        if (!rt.active) { a.lured = false; b.fish.delete(a); } else b.species.add(rt.def.id);
      }
    }
    if (b.fish.size >= LURE.maxFish) return;
    const cands: { a: Agent; def: SpeciesDef; d: number }[] = [];
    for (const rt of this.list) {
      const def = rt.def;
      if (!rt.active || !this.lurable(def) || !b.eats(def)) continue;
      for (const a of rt.agents) {
        if (a.lured || a.taken || a.aggro || rt.groups[a.g].absent) continue;
        const d = a.p.distanceTo(b.p);
        if (d < LURE.radius) cands.push({ a, def, d });
      }
    }
    cands.sort((x, y) => x.d - y.d);
    for (const c of cands) {
      if (b.fish.size >= LURE.maxFish) break;
      if (!b.species.has(c.def.id) && b.species.size >= LURE.maxSpecies) continue;
      c.a.lured = true;
      b.fish.add(c.a);
      b.species.add(c.def.id);
    }
  }

  /** Bait cloud state for the HUD and tests. */
  baitInfo(): { kind: string; t: number; fish: number; species: string[]; near: number } | null {
    const b = this.bait;
    if (!b) return null;
    let near = 0;
    for (const a of b.fish) if (a.p.distanceTo(b.p) < 2.5) near++;
    return { kind: b.kind, t: b.t, fish: b.fish.size, species: [...b.species], near };
  }

  /** Night dives: daytime species are asleep (hidden in the reef), so fewer of them show up. */
  private nightGate(def: SpeciesDef): number {
    return this.night && def.when !== 'night' ? (def.aggro?.kind === 'light' ? 1 : NIGHT.dayPresence) : 1;
  }

  /** Rescued animal: swims at the diver's right front, easing toward a point ahead of the camera. */
  private stepCompanion(rt: SpeciesRuntime, a: Agent, i: number, player: THREE.Vector3, playerVel: THREE.Vector3, viewDir: THREE.Vector3 | undefined, dt: number): void {
    const c = this.companion!;
    rt.groups[a.g].absent = false;
    a.taken = false;
    let fx = viewDir ? viewDir.x : 0, fz = viewDir ? viewDir.z : 1;
    const fl = Math.hypot(fx, fz);
    if (fl < 0.05) { fx = Math.sin(c.yaw); fz = Math.cos(c.yaw); } else { fx /= fl; fz /= fl; }
    if (a.p.distanceTo(player) > COMPANION.warp) {
      a.p.set(player.x - fx * COMPANION.warpBack, player.y, player.z - fz * COMPANION.warpBack);
      a.v.set(0, 0, 0);
    }
    const tx = player.x + fx * COMPANION.ahead + fz * COMPANION.side + Math.sin(this.time * 0.7) * 0.4;
    const tz = player.z + fz * COMPANION.ahead - fx * COMPANION.side + Math.cos(this.time * 0.6) * 0.4;
    const gy = heightFast(tx, tz);
    const ty = clamp(player.y - 0.3 + Math.sin(this.time * 0.9) * 0.25, gy + 0.6, -0.8);
    _v2.set(tx - a.p.x, ty - a.p.y, tz - a.p.z);
    a.v.addScaledVector(_v2, dt * 2.2);
    a.v.multiplyScalar(1 - Math.min(0.9, dt * 1.6));
    const maxV = Math.max(COMPANION.minSpeed, playerVel.length() + 0.6);
    const vl = a.v.length();
    if (vl > maxV) a.v.multiplyScalar(maxV / vl);
    a.p.addScaledVector(a.v, dt);
    const want = vl > 0.15 ? Math.atan2(a.v.x, a.v.z) : Math.atan2(fx, fz);
    let dy = want - c.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    c.yaw += dy * Math.min(1, dt * 2.5);
    a.yaw = c.yaw;
    a.q.setFromEuler(_e.set(clamp(-a.v.y * 0.15, -0.3, 0.3), c.yaw, 0));
    this.writeInstance(rt, a, i);
  }

  /** Chance that a group shows up on a given dive, by rarity — mildly shifted by the day's weather (Phase 4). */
  private presence(def: SpeciesDef): number {
    const base = def.rarity >= 4 ? 0.07 : def.rarity === 3 ? 0.3 : def.rarity === 2 ? 0.6 : 0.9;
    return Math.min(0.95, base * this.weatherMult(def));
  }

  /**
   * Phase 4: a species with a fixed home (a coral head, a rock, a patch of sand) must not be
   * chased tens of metres away from it. Roamers (pelagic / drift / curious visitors) are exempt.
   */
  private resident(def: SpeciesDef): boolean {
    if (def.behavior === 'pelagic' || def.behavior === 'drift' || def.curious) return false;
    if (def.hab) return !(def.hab === 'midwater' || def.hab === 'surface' || def.hab === 'perch' || def.hab === 'burrow');
    return typeof def.region === 'string';
  }

  /**
   * New dive: reseed, roll which groups are present (by rarity) and scatter every movable
   * group to fresh habitat around the diver, so no dive looks the same.
   */
  reshuffle(player: THREE.Vector3, seed = (Date.now() ^ (Math.random() * 1e9)) >>> 0): void {
    this.rnd = mulberry32(seed);
    this.homeUse.clear();
    for (const rt of this.list) {
      const p = rt.def.when === 'night' && !this.night ? 0 : rt.def.aggro?.kind === 'light' && this.night ? 1 : this.presence(rt.def) * this.nightGate(rt.def);
      const movable = this.canRelocate(rt.def);
      rt.groups.forEach((g, gi) => {
        g.absent = this.rnd() > p;
        g.cur = 0; g.curT = 0; // curiosity state does not carry across dives (P4-7)
        if (!g.absent && movable) this.relocate(rt, gi, player, 4);
      });
      const ag = rt.def.aggro;
      for (const a of rt.agents) { a.aggro = !!ag && this.rnd() < ag.chance; a.mode = 0; a.modeT = 0; a.taken = false; }
      // always keep at least one group of common species
      if (rt.def.rarity === 1 && rt.groups.every((g) => g.absent)) rt.groups[0].absent = false;
    }
  }

  /** A random species with an individual within `radius` (for photo requests). */
  randomNear(p: THREE.Vector3, radius: number, minSize = 0.06): SpeciesDef | null {
    const cands: SpeciesDef[] = [];
    for (const rt of this.list) {
      const d = rt.def;
      if (!rt.active || d.kind === 'none' || d.size < minSize || d.behavior === 'buried' || this.stage.has(d.id)) continue;
      if (rt.agents.some((a) => !rt.groups[a.g].absent && a.p.distanceTo(p) < radius)) cands.push(d);
    }
    return cands.length ? cands[Math.floor(Math.random() * cands.length)] : null;
  }

  /** Fish finder: nearest individual of each not-yet-photographed species within `radius`. */
  sonar(p: THREE.Vector3, radius: number, known: (id: string) => boolean): { x: number; z: number; rare: boolean }[] {
    const out: { x: number; z: number; rare: boolean }[] = [];
    for (const rt of this.list) {
      if (!rt.active || known(rt.def.id) || rt.def.kind === 'none') continue;
      let best: Agent | null = null, bd = radius;
      for (const a of rt.agents) {
        if (rt.groups[a.g].absent || a.taken) continue;
        const d = a.p.distanceTo(p);
        if (d < bd) { bd = d; best = a; }
      }
      if (best) out.push({ x: best.p.x, z: best.p.z, rare: rt.def.rarity >= 2 });
    }
    return out;
  }

  /** Put one group of a species at a spot (first-dive showpiece). */
  placeNear(id: string, p: THREE.Vector3): void {
    const rt = this.list.find((r) => r.def.id === id);
    if (!rt) return;
    const g = rt.groups[0];
    g.absent = false;
    g.home.copy(p); g.c.copy(p); g.t.copy(p); g.v.set(0, 0, 0);
    for (const a of rt.agents) if (a.g === 0) { a.p.copy(p).add(a.off); a.v.set(0, 0, 0); }
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

  private frameNo = 0;

  update(dt0: number, player: THREE.Vector3, playerVel: THREE.Vector3, viewDir?: THREE.Vector3): void {
    const dt = dt0;
    this.frameNo++;
    // re-home far groups (a few species per frame)
    this.relocT += dt;
    if (this.relocT > 0.05) {
      this.relocT = 0;
      for (let n = 0; n < 4; n++) {
        const rt = this.list[this.relocIdx++ % this.list.length];
        if (!this.canRelocate(rt.def)) continue;
        if (rt.def.rarity >= 3 && this.rnd() > 0.15) continue;
        rt.groups.forEach((g, gi) => {
          if (Math.hypot(g.c.x - player.x, g.c.z - player.z) > 100) {
            g.absent = this.rnd() > this.presence(rt.def) * this.nightGate(rt.def);
            if (!g.absent) this.relocate(rt, gi, player);
          }
        });
      }
    }
    this.viewPos.copy(player);
    if (viewDir) this.viewDir.copy(viewDir);
    this.time += dt;
    this.baitStep(dt);
    const r = this.rnd;
    const pFast = Math.min(1, playerVel.length() / 1.4);
    let buildMs = 0, built = 0; // 0 = drifting / slow, 1 = finning hard
    /** species in range only behind the camera: built after the others, when there is time and room */
    const later: SpeciesRuntime[] = [];
    for (const rt of this.list) {
      let near = false;
      for (const g of rt.groups) if (Math.abs(g.c.x - player.x) < 68 && Math.abs(g.c.z - player.z) < 68) { near = true; break; }
      const forced = this.pin?.id === rt.def.id || this.companion?.id === rt.def.id || this.stage.has(rt.def.id);
      if (forced) near = true;
      if (near && !rt.mesh && rt.def.kind !== 'none') {
        // lazy build, a few species per frame so a dive never stalls on texture painting
        // (the budget counts build time only, and at least one species is built every frame).
        // A species is built once it could be drawn, not merely because it lives within 68 m (§6.3-⑥).
        const want = forced ? 2 : this.drawable(rt);
        if (want) rt.lastNear = this.time;
        if (want === 1) later.push(rt);
        else if (want === 2 && (forced || built === 0 || buildMs <= this.buildBudgetMs)) {
          const t0 = performance.now();
          this.buildMesh(rt);
          buildMs += performance.now() - t0;
          built++;
        }
      }
      rt.active = near;
      if (rt.mesh) rt.mesh.visible = near;
      if (rt.halo) rt.halo.visible = near;
      // an unbuilt species is still simulated (sonar, requests and bait see it); it just draws nothing
      if (!near) continue;
      rt.slot = 0;
      rt.minD = 1e9;
      const def = rt.def;
      // Flight distance shrinks for a slow diver (fish tolerate a gentle approach), and a slow diver
      // mostly makes them swim across the view (side-on) instead of turning tail.
      const fleeR = def.flee * (0.4 + 0.6 * pFast) * this.stealth;
      const radialW = 0.25 + 0.75 * pFast;

      // ---- group centers
      for (const g of rt.groups) {
        g.timer -= dt;
        const toT = _v.copy(g.t).sub(g.c);
        const dist = toT.length();
        if (def.curious) this.curiousStep(def, g, player, playerVel, dt);
        if (!(def.curious && g.cur) && (dist < 1.0 || g.timer <= 0)) {
          g.timer = (def.hab === 'coralHover' || def.hab === 'under' ? 3 : 8) + r() * 12;
          if (!this.habTarget(def, g, g.t)) {
            const rr = g.roam;
            g.t.set(g.home.x + (r() - 0.5) * 2 * rr, g.home.y + (r() - 0.5) * Math.min(rr * 0.4, 6), g.home.z + (r() - 0.5) * 2 * rr);
          }
        }
        if (def.behavior === 'bottom') {
          // bottom dwellers follow the seafloor wherever it is, regardless of their listed depth range
          g.t.y = heightFast(g.t.x, g.t.z) + this.altitude(def);
        } else if (!def.hab) {
          const ground = heightFast(g.t.x, g.t.z);
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
        const res = this.resident(def);
        const gFlee = res ? fleeR * SPREAD.residentFlee : fleeR;
        // leash (P4-3): beyond it the flee force is dropped and only the pull home applies
        const outside = res && Math.hypot(g.c.x - g.home.x, g.c.z - g.home.z) > SPREAD.leash + def.size * SPREAD.leashSize;
        if (!outside && def.flee > 0 && pl < gFlee * 2.5 && def.behavior !== 'anemone' && def.hab !== 'coralHover' && def.hab !== 'under' && def.hab !== 'cleaner') {
          // schools veer off sideways (keeping their distance) rather than bolting straight away
          fleeDir(pd, g.v, radialW, _v);
          g.v.addScaledVector(_v, dt * def.speed * 2);
        }
        if (outside) {
          // a resident group dragged too far from home swims back instead of fleeing on
          _v.set(g.home.x - g.c.x, 0, g.home.z - g.c.z).normalize();
          g.v.addScaledVector(_v, dt * def.speed * 2.5);
        }
        g.c.addScaledVector(g.v, dt);
        const gg = heightFast(g.c.x, g.c.z);
        const minAlt = def.hab ? (def.hab === 'sandForage' || def.hab === 'under' ? 0.1 : 0.2) : this.altitude(def) * 0.8;
        g.c.y = clamp(g.c.y, gg + minAlt, -0.3);
      }

      // ---- agents
      for (let i = 0; i < rt.agents.length; i++) {
        const a = rt.agents[i];
        const g = rt.groups[a.g];
        const staged = this.stage.get(def.id);
        if (staged && i < staged.length) {
          const st = staged[i];
          g.absent = false;
          a.taken = false;
          if (st.still) a.p.set(st.p.x, st.p.y + Math.sin(this.time * 0.25 + i * 2) * 0.12, st.p.z);
          else a.p.copy(st.p);
          if (st.s) a.s = st.s;
          a.v.set(0, 0.01, 0);
          a.yaw = st.yaw;
          a.q.setFromEuler(_eStage.set(st.pitch, st.yaw + Math.sin(this.time * 0.05 + i) * 0.05, 0, 'YXZ'));
          this.writeInstance(rt, a, i);
          continue;
        }
        if (this.companion && this.companion.id === def.id && i === 0) {
          this.stepCompanion(rt, a, i, player, playerVel, viewDir, dt0);
          continue;
        }
        if (this.pin && this.pin.id === def.id && i === 0) {
          // test showcase: hold one individual side-on in front of the camera
          g.absent = false;
          a.p.copy(this.pin.p);
          a.v.set(Math.sin(this.pin.yaw), 0, Math.cos(this.pin.yaw)).multiplyScalar(0.25);
          a.yaw = this.pin.yaw;
          a.q.setFromEuler(_e.set(0, a.yaw, 0));
          this.writeInstance(rt, a, i);
          continue;
        }
        if (g.absent || a.taken) continue;
        if (Math.abs(g.c.x - player.x) > 100 || Math.abs(g.c.z - player.z) > 100) continue;
        // far individuals are simulated every 2nd or 4th frame, with the skipped time added up (§6.3-⑦);
        // anything the diver is interacting with is simulated every frame
        const dPlayer = a.p.distanceTo(player);
        const busy = a.aggro || a.alarm > 0 || a.lured || (a.watch ?? 0) > 0 || !!g.cur || a === this.focus || this.grab?.a === a
          || (def.flee > 0 && dPlayer < Math.max(fleeR * 2.6, 2.6));
        const every = busy ? 1 : dPlayer > THIN.far ? 4 : dPlayer > THIN.mid ? 2 : 1;
        a.pend = Math.min(THIN.maxDt, (a.pend ?? 0) + dt0);
        if (every > 1 && (this.frameNo + i) % every !== 0) { this.writeInstance(rt, a, i); continue; }
        const dt = a.pend;
        a.pend = 0;
        if (def.behavior === 'buried') {
          const want = dPlayer < def.flee + playerVel.length() * 1.5 ? 1 : 0;
          a.retract += (want - a.retract) * Math.min(1, dt * (want ? 6 : 0.35));
          // face roughly toward the current (gobies hover and slowly turn)
          a.yaw = def.region === 'eelPatch' ? 0.6 + Math.sin(a.ph) * 0.4 : a.ph + Math.sin(this.time * 0.3 + a.ph) * 0.6;
          if (def.region !== 'eelPatch' && !def.anchorHome) a.p.y = heightFast(a.p.x, a.p.z) + 0.1 + a.s * 0.3 + Math.sin(this.time * 1.3 + a.ph) * 0.02;
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
          if (this.octoStep(rt, a, player, playerVel, dt)) { this.writeInstance(rt, a, i); continue; }
          if (def.flee > 0 && dPlayer < def.flee && a.alarm <= 0 && (!this.grabber(def) || playerVel.length() > OCTO.fleeSpeed)) {
            a.alarm = 3.5;
            const away = _v.copy(a.p).sub(player).setY(0).normalize();
            a.v.copy(away).multiplyScalar(1.6);
          }
          if (a.alarm > 0) {
            a.alarm -= dt;
            a.p.addScaledVector(a.v, dt);
            a.v.multiplyScalar(1 - dt * 0.6);
            const gy = this.crawlY(def, a);
            a.p.y += (gy + (a.alarm > 0.5 && def.kind === 'fish' ? 0.4 : 0) - a.p.y) * Math.min(1, dt * 3);
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
        // Individual wander: reef residents keep finning around their home in slow loops instead of hanging
        // motionless at one point (the group target itself only moves a few decimetres).
        if (def.kind === 'fish' && def.behavior !== 'anemone' && (def.behavior === 'solo' || def.hab === 'coralHover' || def.hab === 'under' || def.hab === 'cleaner' || def.hab === 'coralPick')) {
          const hover = def.hab === 'coralHover' || def.hab === 'cleaner';
          const A = hover ? 0.3 + def.size * 2 : def.hab === 'under' ? 0.35 + def.size * 1.6 : 0.5 + def.size * 3;
          const w = 0.26 / (0.5 + def.size);
          tx += Math.sin(this.time * w + a.ph * 3.1) * A;
          tz += Math.cos(this.time * w * 0.83 + a.ph * 1.7) * A;
          ty += Math.sin(this.time * w * 0.6 + a.ph) * A * (hover ? 0.25 : 0.12);
        }
        if (a.lured && this.bait) {
          // Phase 4: lured fish circle the bait cloud, too busy feeding to mind the diver
          const bt = this.time * (0.7 + (a.ph % 1) * 0.6) + a.ph * 5;
          const rr = 0.4 + (a.ph % 0.8);
          tx = this.bait.p.x + Math.cos(bt) * rr;
          ty = this.bait.p.y + Math.sin(bt * 1.3) * 0.3;
          tz = this.bait.p.z + Math.sin(bt) * rr;
        }
        let charging = false;
        if (a.aggro && def.aggro) {
          const ag = def.aggro;
          a.modeT = (a.modeT ?? 0) - dt;
          const mode = a.mode ?? 0;
          const homeD = Math.hypot(player.x - g.home.x, player.z - g.home.z);
          if (mode === 0) {
            const rng = ag.range * (ag.kind === 'territory' ? this.stealth * 0.4 + 0.6 : 1);
            const trig = ag.kind === 'territory' ? dPlayer < rng && homeD < rng * 1.8
              : ag.kind === 'light' ? this.night && this.lightOn && player.y > -NIGHT.lightDepth && dPlayer < rng
              : dPlayer < rng;
            if (trig && a.modeT <= 0) {
              a.mode = ag.kind === 'territory' ? 2 : 1;
              a.modeT = ag.kind === 'territory' ? 1.2 : ag.kind === 'light' ? NIGHT.lightWind : 5 + r() * 6;
              this.events.push({ type: 'warn', def, p: a.p.clone() });
            }
          } else if (mode === 1) {
            // shark: tightening circles around the diver, then a bumping pass
            if (ag.kind === 'light') {
              // needlefish: hang in the beam for a moment, then dash straight at the light
              tx = a.p.x; ty = a.p.y; tz = a.p.z;
              if (!this.lightOn) { a.mode = 0; a.modeT = 4; }
              else if (a.modeT <= 0) { a.mode = 2; a.modeT = 0; this.events.push({ type: 'charge', def, p: a.p.clone() }); }
            } else {
              const ang = this.time * (0.9 / (1 + def.size * 0.3)) + a.ph * 6;
              const R = 3 + def.size * 1.2 + Math.max(0, a.modeT) * 0.25;
              tx = player.x + Math.cos(ang) * R; tz = player.z + Math.sin(ang) * R; ty = player.y - 0.6;
              if (dPlayer > ag.range * 1.8) { a.mode = 0; a.modeT = 10; }
              else if (a.modeT <= 0) { a.mode = 2; a.modeT = 0; this.events.push({ type: 'charge', def, p: a.p.clone() }); }
            }
          } else if (mode === 2) {
            if (ag.kind === 'light' && !this.lightOn) { a.mode = 3; a.modeT = 5; } // light out: it loses the target
            if (ag.kind === 'territory' && a.modeT > 0) {
              // threat display: turn to face the intruder, fins raised
              tx = a.p.x + (player.x - a.p.x) * 0.05; ty = a.p.y; tz = a.p.z + (player.z - a.p.z) * 0.05;
              if (a.modeT - dt <= 0) this.events.push({ type: 'charge', def, p: a.p.clone() });
            } else {
              tx = player.x; ty = player.y - 0.1; tz = player.z; charging = true;
              if (this.shield && dPlayer < def.size * 0.45 + 1.8) {
                // electric shark shield: the charge veers off just short of the diver
                this.events.push({ type: 'repel', def, p: a.p.clone() });
                a.mode = 3; a.modeT = ag.kind === 'territory' ? 3 : 6;
              } else if (dPlayer < def.size * 0.45 + 0.55) {
                this.events.push({ type: 'hit', def, p: a.p.clone() });
                a.mode = 3; a.modeT = ag.kind === 'territory' ? 3 : 6;
              } else if (a.modeT < -3.5 || (ag.kind === 'territory' && homeD > ag.range * 2.4)) { a.mode = 3; a.modeT = 3; }
            }
          } else {
            if (ag.kind === 'territory') { tx = g.home.x; ty = g.home.y; tz = g.home.z; }
            else { _v2.copy(a.p).sub(player).setY(0).normalize(); tx = a.p.x + _v2.x * 6; ty = a.p.y; tz = a.p.z + _v2.z * 6; }
            if (a.modeT <= 0) { a.mode = 0; a.modeT = ag.kind === 'territory' ? 5 : 14; }
          }
        }
        // Phase 4: this individual's flight distance — residents flee less far, lured fish barely flee at all
        const fr = a.lured ? fleeR * LURE.fear : this.resident(def) ? fleeR * SPREAD.residentFlee : fleeR;
        const hiding = !a.aggro && !a.lured && (def.hab === 'coralHover' || def.hab === 'under') && dPlayer < fr * 1.6;
        if (hiding) {
          // keep each fish's own offset (scaled, not collapsed) so the school hugs the coral surface spread out
          tx = g.home.x + a.off.x * SPREAD.hideSpread;
          // nestle just above the coral surface (still visible) instead of disappearing inside it
          ty = g.home.y + (def.hab === 'coralHover' ? 0.08 : -0.05);
          tz = g.home.z + a.off.z * SPREAD.hideSpread;
        }
        _v.set(tx - a.p.x, ty - a.p.y, tz - a.p.z);
        const k = charging ? 4 : a.lured ? 1.8 : def.behavior === 'anemone' || hiding ? 3 : def.hab === 'coralHover' || def.hab === 'under' || def.hab === 'cleaner' ? 1.6 : 0.9;
        const acc = _v.multiplyScalar(k);
        const watchR = Math.max(fr * 2.6, a.lured ? 1.2 : 2.6);
        a.watch = !a.aggro && def.flee > 0 && !hiding && dPlayer < watchR && dPlayer > def.size * 0.6 && pFast < 0.6 ? (1 - pFast / 0.6) * Math.min(1, (watchR - dPlayer) / (watchR * 0.4)) : 0;
        if (def.flee > 0 && dPlayer < watchR && !hiding && !(a.aggro && a.mode)) {
          // Phase 4: each fish veers to its own fixed side, so the school splits instead of bunching
          const side = (a.ph % 2) < 1 ? 1 : -1;
          if (dPlayer < fr) {
            fleeDir(_v2.copy(a.p).sub(player), a.v, radialW, _v2, side);
            acc.addScaledVector(_v2, (fr - dPlayer) * 4);
          } else if (pFast < 0.6) {
            // wary but not frightened: drift sideways round the diver, keeping one eye on it (broadside view)
            fleeDir(_v2.copy(a.p).sub(player), a.v, 0, _v2, side);
            acc.addScaledVector(_v2, (watchR - dPlayer) * 1.2 * (1 - pFast));
            acc.addScaledVector(_v, -SPREAD.linger * (1 - pFast)); // linger rather than rejoin the school's heading
          }
        }
        a.v.addScaledVector(acc, dt);
        a.v.multiplyScalar(1 - Math.min(0.9, dt * 1.2));
        const maxV = charging ? def.aggro!.speed : a.aggro && a.mode === 1 ? Math.max(def.speed * 1.6, 1.6) : def.speed * (dPlayer < fr ? 1.6 + 1.2 * radialW : 1.6) + 0.15 + (a.lured ? 0.4 : 0);
        const vl = a.v.length();
        if (vl > maxV) a.v.multiplyScalar(maxV / vl);
        // keep a minimum cruising speed for pelagics so they never hover
        if (def.behavior === 'pelagic' && vl < def.speed * 0.4) a.v.add(_v2.set(Math.sin(a.yaw), 0, Math.cos(a.yaw)).multiplyScalar(def.speed * 0.4 * dt * 3));
        a.p.addScaledVector(a.v, dt);
        const gy = this.groundY(def, a.p.x, a.p.z);
        const minY = gy + Math.max(0.06, def.behavior === 'bottom' ? this.altitude(def) : def.hab === 'sandForage' ? a.s * 0.15 : a.s * 0.3);
        if (a.p.y < minY) { a.p.y = minY; a.v.y = Math.max(a.v.y, 0); }
        if (a.p.y > -0.4) { a.p.y = -0.4; a.v.y = Math.min(a.v.y, 0); }
        if (a.p.x < -240 && a.p.z > 820 && def.region !== 'caveTopSpots') {
          const rf = caveRoofAt(a.p.x, a.p.z);
          if (rf !== null && a.p.y > rf - 0.3 && a.p.y < -2) { a.p.y = rf - 0.3; a.v.y = Math.min(a.v.y, 0); }
        }
        if (def.behavior === 'bottom') {
          if (this.benthic(def)) {
            // crawlers stay on the surface they are crossing (sand, rock or coral)
            a.p.y = this.crawlY(def, a);
            a.v.y = 0;
          } else {
            // rays and dumbo octopus glide just above the floor
            const cap = gy + this.altitude(def) + 0.45;
            if (a.p.y > cap) { a.p.y = cap; a.v.y = Math.min(a.v.y, 0); }
          }
        }
        // near the diver, keep swimmers outside coral heads and rocks
        if (dPlayer < 25 && def.hab !== 'under') resolveSphere(a.p, a.s * 0.25, a.v);
        this.orient(rt, a, 1 - Math.exp(-dt * (def.size > 3 ? 1.2 : 5)));
        this.writeInstance(rt, a, i);
      }
      if (!rt.mesh) continue;
      rt.mesh.count = rt.slot;
      rt.mesh.visible = rt.slot > 0;
      if (rt.halo) { rt.halo.visible = rt.slot > 0; rt.halo.geometry.setDrawRange(0, rt.slot); }
      rt.mesh.instanceMatrix.needsUpdate = true;
      if (rt.mesh.instanceColor) rt.mesh.instanceColor.needsUpdate = true;
      if (rt.halo) rt.halo.geometry.attributes.position.needsUpdate = true;
      this.shadowFor(rt);
    }
    for (const rt of later) {
      if (this.held.size >= KEEP.species || (built > 0 && buildMs > this.buildBudgetMs)) break;
      const t0 = performance.now();
      this.buildMesh(rt);
      buildMs += performance.now() - t0;
      built++;
      rt.mesh!.visible = false; // behind the camera: shown by the next frame that packs it
    }
    this.evict();
    // draw budget: only the nearest species meshes are drawn (far small schools are lost in the haze anyway)
    const drawn = this.list.filter((rt) => rt.mesh?.visible);
    if (drawn.length > this.maxDrawn) {
      drawn.sort((a, b) => (a.minD ?? 1e9) - (b.minD ?? 1e9));
      for (let i = this.maxDrawn; i < drawn.length; i++) {
        drawn[i].mesh!.visible = false;
        if (drawn[i].halo) drawn[i].halo!.visible = false;
      }
    }
  }
  maxDrawn = 70;

  /**
   * Best photographable creature. A shot counts only if the animal is inside the photo crop,
   * large enough in frame, close enough to be sharp through the water, not hidden by terrain,
   * and lit (in the dark deep: inside the dive light's beam or bioluminescent).
   */
  findTarget(cam: THREE.PerspectiveCamera, o: { clear: number; dark: boolean; lightOn: boolean; cropX: number; cropY: number; beam?: number; macro?: boolean; wide?: boolean }): PhotoTarget | null {
    const fwd = _v.set(0, 0, -1).applyQuaternion(cam.quaternion);
    const cp = cam.position;
    const fovV = (cam.fov * Math.PI) / 180;
    const ndc = new THREE.Vector3();
    // Phase 4, stage 1: cheap conditions only. Animals the diver cannot actually see —
    // lost in the haze, in darkness beyond arm's reach, or with almost none of the body in
    // the frame — never become candidates at all (no label, no "???").
    type Cand = { rt: SpeciesRuntime; a: Agent; dist: number; angle: number; reason: PhotoTarget['reason']; frac: number; centred: number; side: number; clear: number; score: number };
    const cands: Cand[] = [];
    for (const rt of this.list) {
      if (!rt.active || (!rt.mesh && rt.def.kind !== 'none')) continue;
      const def = rt.def;
      for (const a of rt.agents) {
        if (rt.groups[a.g].absent || a.taken) continue;
        if (def.behavior === 'buried' && a.retract > 0.5) continue;
        _v2.copy(a.p).sub(cp);
        const dist = _v2.length();
        if (dist > 60 || _v2.dot(fwd) <= 0) continue;
        // inside the photo crop?
        ndc.copy(a.p).project(cam);
        if (Math.abs(ndc.x) > o.cropX || Math.abs(ndc.y) > o.cropY) continue;
        // how big is it in the frame?
        const span = a.s * (def.kind === 'jelly' || def.kind === 'inv' ? 1.0 : 0.8);
        // macro lens magnifies small subjects; wide lens fits big animals from farther away
        const frac = ((2 * Math.atan(span / 2 / Math.max(dist, 0.05))) / fovV) * (o.macro && def.size < 0.2 ? 1.7 : 1);
        if (frac < 0.025) continue;
        const clear = o.clear * (o.wide && def.size >= 1 ? 1.35 : 1);
        if (dist > clear * PHOTO_VIS.fogCut) continue; // haze has eaten it: not a candidate
        let reason: PhotoTarget['reason'] = 'ok';
        if (frac < 0.06) reason = 'small';
        if (dist > clear) reason = 'murky';
        if (o.dark) {
          const glows = !!def.mat?.glow;
          const inBeam = o.lightOn && _v2.angleTo(fwd) < 0.5 * (o.beam ?? 1) && dist < 14 * (o.beam ?? 1);
          if (!inBeam && !(glows && dist < 9)) {
            if (dist > PHOTO_VIS.darkSeen) continue; // too dark to see at all
            reason = 'dark'; // close enough that its shadow shows: "too dark, use the light"
          }
        }
        const centred = 1 - Math.min(1, Math.hypot(ndc.x / o.cropX, ndc.y / o.cropY));
        let side = 1;
        if (def.kind === 'fish' || def.kind === 'turtle') {
          const f = _v3.set(0, 0, 1).applyQuaternion(a.q);
          const c = Math.abs(f.dot(_v2) / Math.max(dist, 1e-3));
          side = Math.sqrt(Math.max(0, 1 - c * c));
        }
        const score = (reason === 'ok' ? 3 : 0) + Math.min(frac, 0.5) * 4 + centred + (def.rarity - 1) * 0.1;
        cands.push({ rt, a, dist, angle: _v2.angleTo(fwd), reason, frac, centred: Math.max(0, centred), side, clear, score });
      }
    }
    if (!cands.length) return null;
    // Stage 2: the expensive checks (body-in-frame share, occlusion by terrain and solids)
    // run on the best few candidates only.
    cands.sort((x, y) => y.score - x.score);
    let fallback: PhotoTarget | null = null;
    for (const c of cands.slice(0, PHOTO_VIS.occTests)) {
      const { rt, a } = c;
      const def = rt.def;
      // framing: sample the body outline and count how much of it is inside the crop
      const ax = _v3.set(0, 0, 1).applyQuaternion(a.q);
      const half = a.s * 0.5;
      const up = def.kind === 'fish' ? a.s * 0.18 : a.s * 0.3;
      let inside = 0, total = 0, x0 = 9, x1 = -9, y0 = 9, y1 = -9;
      for (let k = -2; k <= 2; k++) {
        for (const h of k === 0 ? [-1, 0, 1] : [0]) {
          ndc.copy(a.p).addScaledVector(ax, (half * k) / 2);
          ndc.y += up * h;
          ndc.project(cam);
          total++;
          x0 = Math.min(x0, ndc.x); x1 = Math.max(x1, ndc.x); y0 = Math.min(y0, ndc.y); y1 = Math.max(y1, ndc.y);
          if (Math.abs(ndc.x) <= o.cropX && Math.abs(ndc.y) <= o.cropY && ndc.z < 1) inside++;
        }
      }
      const fit = inside / total;
      if (fit < PHOTO_VIS.minFit) continue; // the body is barely in the frame: not a candidate
      // occlusion at head / middle / tail: fully covered means unseen; partly means "hidden"
      let blocked = 0;
      for (const s of [-0.4, 0, 0.4]) {
        _v2.copy(a.p).addScaledVector(ax, a.s * s);
        if (this.occluded(cp, _v2, a.s * 0.3 + 0.25)) blocked++;
      }
      if (blocked === 3) continue;
      let reason = c.reason;
      if (blocked > 0 && reason === 'ok') reason = 'hidden';
      const t: PhotoTarget = { rt, agent: a, dist: c.dist, angle: c.angle, inRange: reason === 'ok', reason, frac: c.frac, centred: c.centred, fit, fill: Math.max((x1 - x0) / (2 * o.cropX), (y1 - y0) / (2 * o.cropY)), side: c.side, danger: !!a.aggro && (a.mode === 1 || a.mode === 2), clear: c.clear };
      if (t.inRange) return t;
      fallback ??= t;
    }
    return fallback;
  }

  /** Spearfishing: the creature nearest the aim line within reach (any kind; the caller decides what may be taken). */
  findSpearTarget(cam: THREE.PerspectiveCamera, reach: number, maxAng = 0.3): { rt: SpeciesRuntime; agent: Agent; dist: number; ang: number; speed: number } | null {
    const fwd = _v.set(0, 0, -1).applyQuaternion(cam.quaternion);
    const cp = cam.position;
    let best: { rt: SpeciesRuntime; agent: Agent; dist: number; ang: number; speed: number } | null = null;
    let bestScore = Infinity;
    for (const rt of this.list) {
      if (!rt.active || !rt.mesh) continue;
      const def = rt.def;
      if (def.kind !== 'fish' && def.kind !== 'squid' && def.kind !== 'octopus' && def.kind !== 'turtle' && !(def.kind === 'ray' && def.ray?.flounder)) continue;
      if (this.stage.has(def.id)) continue;
      for (const a of rt.agents) {
        if (rt.groups[a.g].absent || a.taken) continue;
        _v2.copy(a.p).sub(cp);
        const dist = Math.max(0, _v2.length() - a.s * 0.3);
        if (dist > reach * 2) continue;
        const ang = _v2.angleTo(fwd);
        if (ang > maxAng + Math.atan2(a.s * 0.4, Math.max(dist, 0.2))) continue;
        const score = ang * 4 + dist / reach;
        if (score < bestScore && !this.occluded(cp, a.p)) {
          bestScore = score;
          best = { rt, agent: a, dist, ang: Math.max(0, ang - Math.atan2(a.s * 0.3, Math.max(dist, 0.2))), speed: a.v.length() / (def.speed * 1.6 + 0.3) };
        }
      }
    }
    return best;
  }

  /** The speared individual leaves the scene; its school bolts. */
  take(rt: SpeciesRuntime, a: Agent, from: THREE.Vector3): void {
    a.taken = true;
    for (const b of rt.agents) {
      if (b === a || b.taken || b.p.distanceTo(a.p) > 12) continue;
      _v.copy(b.p).sub(from).setY(0).normalize().multiplyScalar(3);
      b.v.add(_v);
      b.alarm = 3;
    }
  }

  /** A missed thrust: the fish darts away. */
  startle(a: Agent, from: THREE.Vector3): void {
    _v.copy(a.p).sub(from).normalize().multiplyScalar(4);
    a.v.add(_v);
    a.alarm = 3;
  }

  /** Blood in the water: some roaming sharks nearby come to circle the diver. Returns how many. */
  bloodIn(p: THREE.Vector3, range: number, chance: number): number {
    let n = 0;
    for (const rt of this.list) {
      const ag = rt.def.aggro;
      if (!rt.active || !ag || ag.kind !== 'shark') continue;
      for (const a of rt.agents) {
        if (rt.groups[a.g].absent || a.taken || a.p.distanceTo(p) > range || Math.random() > chance) continue;
        a.aggro = true;
        if (!a.mode) { a.mode = 1; a.modeT = 6 + Math.random() * 5; n++; this.events.push({ type: 'warn', def: rt.def, p: a.p.clone() }); }
      }
    }
    return n;
  }

  /** Dusk turned to night during a dive: nocturnal species come out around the diver. */
  nightFall(player: THREE.Vector3): void {
    this.night = true;
    for (const rt of this.list) {
      if (rt.def.when !== 'night') {
        // daytime species go to sleep: some groups vanish (keep one of the common ones)
        const gate = this.nightGate(rt.def);
        if (gate < 1) {
          for (const g of rt.groups) if (!g.absent && Math.random() > gate) g.absent = true;
          if (rt.def.rarity === 1 && rt.groups.every((g) => g.absent)) rt.groups[0].absent = false;
        } else if (rt.def.aggro?.kind === 'light') {
          const mv = this.canRelocate(rt.def);
          rt.groups.forEach((g, gi) => { if (g.absent) { g.absent = false; if (mv) this.relocate(rt, gi, player, 4); } });
        }
        continue;
      }
      const movable = this.canRelocate(rt.def);
      rt.groups.forEach((g, gi) => {
        g.absent = Math.random() > this.presence(rt.def);
        if (!g.absent && movable) this.relocate(rt, gi, player, 4);
      });
    }
  }

  /** The diver bumps into large animals instead of swimming through them (capsule along the body). */
  collideBig(p: THREE.Vector3, rad: number, vel?: THREE.Vector3): void {
    const fwd = new THREE.Vector3();
    for (const rt of this.list) {
      const def = rt.def;
      if (!rt.active || def.size < 0.9 || def.kind === 'jelly' || def.kind === 'none') continue;
      for (let ai = 0; ai < rt.agents.length; ai++) {
        const a = rt.agents[ai];
        if (rt.groups[a.g].absent || a.taken) continue;
        if (ai === 0 && this.companion?.id === def.id) continue; // the rescued animal does not shove the diver
        const reach = a.s * 0.7 + rad + 1;
        if (Math.abs(a.p.x - p.x) > reach || Math.abs(a.p.z - p.z) > reach || Math.abs(a.p.y - p.y) > reach) continue;
        fwd.set(0, 0, 1).applyQuaternion(a.q);
        let half = a.s * 0.38, cr = a.s * 0.1;
        if (def.kind === 'fish' && def.fish) cr = Math.max(0.08, (a.s * def.fish.H) / 2);
        if (def.kind === 'ray') { half = a.s * 0.2; cr = a.s * (def.ray?.manta ? 0.35 : 0.3); }
        if (def.kind === 'turtle') { half = a.s * 0.2; cr = a.s * 0.3; }
        if (def.kind === 'squid') { half = a.s * 0.25; cr = a.s * 0.1; }
        resolveCapsule(p, rad, a.p.x - fwd.x * half, a.p.y - fwd.y * half, a.p.z - fwd.z * half, a.p.x + fwd.x * half, a.p.y + fwd.y * half, a.p.z + fwd.z * half, cr, vel);
      }
    }
  }

  /** Terrain or a solid (rock, coral head, wreck) between camera and subject? */
  private occluded(from: THREE.Vector3, to: THREE.Vector3, skip = 0.3): boolean {
    // Inside the cave the heightfield is the seabed above the roof, so it must not
    // count as an obstacle between two points that are both under the roof —
    // otherwise nothing in the cave can ever be targeted (pre-Phase-4, occlusion
    // only softened the reason to "hidden"; Phase 4 made it an exclusion).
    const roof = caveRoofAt((from.x + to.x) / 2, (from.z + to.z) / 2);
    const inCave = roof !== null && from.y < roof && to.y < roof;
    if (!inCave) {
      const n = 10;
      for (let i = 1; i < n; i++) {
        const t = i / n;
        const x = from.x + (to.x - from.x) * t, y = from.y + (to.y - from.y) * t, z = from.z + (to.z - from.z) * t;
        if (heightFast(x, z) > y + 0.15) return true;
      }
    }
    return segmentBlocked(from, to, skip);
  }

  nearestOf(id: string, from: THREE.Vector3): number {
    const rt = this.list.find((r) => r.def.id === id);
    if (!rt) return Infinity;
    let d = Infinity;
    for (const a of rt.agents) d = Math.min(d, a.p.distanceTo(from));
    return d;
  }

  /**
   * Individuals drawn per level of detail, for the diagnostics readout. There is only the full model
   * until the LODs of PHASE8-DESIGN §1 exist, so everything counts as L0.
   */
  lodCounts(): { l0: number; l1: number; l2: number } {
    let l0 = 0;
    for (const rt of this.list) if (rt.mesh?.visible) l0 += rt.mesh.count;
    return { l0, l1: 0, l2: 0 };
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
