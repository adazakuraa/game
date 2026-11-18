import * as THREE from 'three';
import { SPECIES, type SpeciesDef } from './species';
import { buildCrustacean, buildFish, buildJelly, buildNudibranch, buildOctopus, buildRay, buildSquid, buildTurtle, setAttr } from './models';
import { Paint } from './paint';
import { underwaterMaterial } from '../render/underwater';
import { makeSoftDot } from '../render/textures';
import { heightAt, VENT } from '../world/layout';
import { GARDEN_EEL_PATCH, type Homes } from '../world/flora';
import { clamp, mulberry32 } from '../utils/noise';

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
};

const UPRIGHT = new Set(['jelly', 'octopus', 'dumbo', 'nudi', 'isopod', 'lobster', 'gardenEel']);
const _m = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _qt = new THREE.Quaternion();
const _sc = new THREE.Vector3();

function buildGeometry(def: SpeciesDef): { geo: THREE.BufferGeometry; paint: Paint } {
  const [tw, th] = def.tex ?? [256, 128];
  switch (def.kind) {
    case 'fish': {
      const { geo, layout } = buildFish(def.fish!);
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
    default:
      throw new Error('no geometry for ' + def.kind);
  }
}

function makeMaterial(def: SpeciesDef, map: THREE.Texture): THREE.MeshStandardMaterial {
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
  return underwaterMaterial(mat, {
    key: 'cr-' + def.id,
    caustic: 0.9,
    uniforms: {
      uSwim: { value: new THREE.Vector3(...swim) },
      uFlap: { value: new THREE.Vector3(...flap) },
      uPulse: { value: new THREE.Vector2(...pulse) },
      uGlowCol: { value: glow },
      uGlowAmt: { value: 1 },
    },
    vertexHead: `attribute float aBend; attribute float aFlap; attribute float aPulse; attribute float aGlow;
      uniform vec3 uSwim; uniform vec3 uFlap; uniform vec2 uPulse; varying float vGlow;`,
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
      #ifdef GLOW_SPIN
        vGlow *= 0.15 + pow( 0.5 + 0.5 * sin( atan( position.z, position.x ) * 2.0 - uTime * 4.0 ), 3.0 ) * 1.6;
      #endif`,
    fragHead: 'uniform vec3 uGlowCol; uniform float uGlowAmt; varying float vGlow;',
    fragEmissive: `totalEmissiveRadiance += uGlowCol * vGlow * uGlowAmt * ( 2.2 + 0.6 * sin( uTime * 2.7 ) );`,
  });
}

export type PhotoTarget = { rt: SpeciesRuntime; agent: Agent; dist: number; angle: number; inRange: boolean };

export class Creatures {
  readonly group = new THREE.Group();
  readonly list: SpeciesRuntime[] = [];
  private rnd = mulberry32(77);
  private haloTex = makeSoftDot('rgba(255,255,255,1)', 'rgba(255,255,255,0.25)');
  time = 0;

  constructor(homes: Homes) {
    for (const def of SPECIES) this.list.push(this.spawn(def, homes));
  }

  private pickHome(def: SpeciesDef, homes: Homes, i: number): THREE.Vector3 {
    const r = this.rnd;
    const reg = def.region;
    const fromList = (arr: THREE.Vector3[]) => arr[Math.floor(r() * arr.length) % Math.max(1, arr.length)].clone();
    let p: THREE.Vector3;
    if (reg === 'anemones') p = homes.anemones[i % homes.anemones.length].clone();
    else if (reg === 'crevices') p = homes.crevices[(i * 7) % homes.crevices.length].clone();
    else if (reg === 'reefSpots') p = fromList(homes.reefSpots);
    else if (reg === 'rockSpots') p = fromList(homes.rockSpots);
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
        x = reg[0] + r() * (reg[1] - reg[0]);
        z = reg[2] + r() * (reg[3] - reg[2]);
        ground = heightAt(x, z);
        y = -(def.depth[0] + r() * (def.depth[1] - def.depth[0]));
        if (y > ground + 1) break;
      }
      p = new THREE.Vector3(x, Math.max(y, ground + 0.8), z);
    }
    return p;
  }

  private altitude(def: SpeciesDef): number {
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
    const rt: SpeciesRuntime = { def, agents: [], groups: [], active: false, bounds: new THREE.Box3() };
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
        const a2 = r() * Math.PI * 2, d = Math.sqrt(r()) * GARDEN_EEL_PATCH.r;
        a.p.set(GARDEN_EEL_PATCH.x + Math.cos(a2) * d, 0, GARDEN_EEL_PATCH.z + Math.sin(a2) * d);
        a.p.y = heightAt(a.p.x, a.p.z) - 0.12 * a.s;
        a.fixed = true;
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
        if (def.region === 'rockSpots') a.p.copy(g.home);
        else a.p.y = heightAt(a.p.x, a.p.z) + this.altitude(def);
        if (def.kind === 'none') a.p.set(VENT.x, heightAt(VENT.x, VENT.z) + 1.5, VENT.z);
      }
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
      const mat = makeMaterial(def, tex);
      const mesh = new THREE.InstancedMesh(geo, mat, def.count);
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.name = def.id;
      rt.mesh = mesh;
      this.group.add(mesh);
      if (def.mat?.glow) {
        rt.haloPos = new Float32Array(def.count * 3);
        const hg = new THREE.BufferGeometry();
        hg.setAttribute('position', new THREE.BufferAttribute(rt.haloPos, 3));
        const hm = new THREE.PointsMaterial({
          map: this.haloTex,
          color: def.mat.glow,
          size: def.id === 'atolla' ? def.size * 3.2 : 0.6,
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
    rt.agents.forEach((a, i) => {
      this.orient(rt, a, 1);
      this.writeInstance(rt, a, i);
    });
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

  private writeInstance(rt: SpeciesRuntime, a: Agent, i: number) {
    let s = a.s;
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

  update(dt: number, player: THREE.Vector3, playerVel: THREE.Vector3): void {
    this.time += dt;
    const r = this.rnd;
    for (const rt of this.list) {
      const near = rt.bounds.distanceToPoint(player) < 130;
      rt.active = near;
      if (rt.mesh) rt.mesh.visible = near;
      if (rt.halo) rt.halo.visible = near;
      if (!near || !rt.mesh) continue;
      const def = rt.def;

      // ---- group centers
      for (const g of rt.groups) {
        g.timer -= dt;
        const toT = _v.copy(g.t).sub(g.c);
        const dist = toT.length();
        const curiousNear = def.curious && player.distanceTo(g.c) < 32 && player.distanceTo(g.c) > def.size * 1.5 + 3;
        if (curiousNear) {
          g.t.copy(player).add(_v2.set(Math.sin(this.time * 0.2 + g.home.x) * (def.size + 5), -1 + Math.sin(this.time * 0.3) * 2, Math.cos(this.time * 0.2 + g.home.x) * (def.size + 5)));
        } else if (dist < 1.5 || g.timer <= 0) {
          g.timer = 8 + r() * 14;
          const rr = g.roam;
          g.t.set(g.home.x + (r() - 0.5) * 2 * rr, g.home.y + (r() - 0.5) * Math.min(rr * 0.4, 6), g.home.z + (r() - 0.5) * 2 * rr);
        }
        const ground = heightAt(g.t.x, g.t.z);
        g.t.y = clamp(g.t.y, Math.max(ground + this.altitude(def), -def.depth[1]), Math.min(-def.depth[0], -0.6));
        if (def.behavior === 'anemone' || def.region === 'reefSpots' && def.behavior !== 'school') g.t.copy(g.home);
        if (def.region === 'reefSpots' && def.behavior === 'school') g.t.y = Math.max(g.t.y, g.home.y + 1.0);
        const spd = def.speed * (def.behavior === 'pelagic' ? 1 : 0.6);
        _v.copy(g.t).sub(g.c);
        const L = _v.length();
        if (L > 0.01) g.v.lerp(_v.multiplyScalar(Math.min(spd, L) / L), 1 - Math.exp(-dt * 0.8));
        // flee as a group (schools scatter around player)
        const pd = _v2.copy(g.c).sub(player);
        const pl = pd.length();
        if (def.flee > 0 && pl < def.flee * 2.5 && def.behavior !== 'anemone') g.v.addScaledVector(pd.normalize(), dt * def.speed * 2);
        g.c.addScaledVector(g.v, dt);
        const gg = heightAt(g.c.x, g.c.z);
        g.c.y = clamp(g.c.y, gg + this.altitude(def) * 0.8, -0.5);
      }

      // ---- agents
      for (let i = 0; i < rt.agents.length; i++) {
        const a = rt.agents[i];
        const g = rt.groups[a.g];
        const dPlayer = a.p.distanceTo(player);
        if (def.behavior === 'buried') {
          const want = dPlayer < def.flee + playerVel.length() * 1.5 ? 1 : 0;
          a.retract += (want - a.retract) * Math.min(1, dt * (want ? 6 : 0.35));
          // face roughly toward the current
          a.yaw = 0.6 + Math.sin(a.ph) * 0.4;
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
          const t = this.time * 0.9 + a.ph;
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
        _v.set(tx - a.p.x, ty - a.p.y, tz - a.p.z);
        const k = def.behavior === 'anemone' ? 3 : 0.9;
        const acc = _v.multiplyScalar(k);
        if (def.flee > 0 && dPlayer < def.flee) {
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
        const minY = gy + Math.max(0.1, def.behavior === 'bottom' ? this.altitude(def) : a.s * 0.3);
        if (a.p.y < minY) { a.p.y = minY; a.v.y = Math.max(a.v.y, 0); }
        if (a.p.y > -0.4) { a.p.y = -0.4; a.v.y = Math.min(a.v.y, 0); }
        this.orient(rt, a, 1 - Math.exp(-dt * (def.size > 3 ? 1.2 : 5)));
        this.writeInstance(rt, a, i);
      }
      rt.mesh.instanceMatrix.needsUpdate = true;
      if (rt.halo) rt.halo.geometry.attributes.position.needsUpdate = true;
    }
  }

  /** Best photographable creature under the reticle. */
  findTarget(cam: THREE.Camera, visibility: number): PhotoTarget | null {
    const fwd = _v.set(0, 0, -1).applyQuaternion(cam.quaternion);
    const cp = cam.position;
    let best: PhotoTarget | null = null;
    let bestScore = -Infinity;
    for (const rt of this.list) {
      if (!rt.active) continue;
      const def = rt.def;
      const range = Math.min(def.photoRange ?? Math.max(4, def.size * 8 + 4), visibility);
      for (const a of rt.agents) {
        if (def.behavior === 'buried' && a.retract > 0.6) continue;
        _v2.copy(a.p).sub(cp);
        const dist = _v2.length();
        if (dist > range * 1.6) continue;
        const ang = _v2.angleTo(fwd);
        const lim = 0.2 + Math.atan((def.size * 0.6) / Math.max(dist, 0.1));
        if (ang > lim) continue;
        const inRange = dist <= range;
        const score = (inRange ? 2 : 0) - ang / lim - dist / range * 0.5 + (def.rarity - 1) * 0.15;
        if (score > bestScore) {
          bestScore = score;
          best = { rt, agent: a, dist, angle: ang, inRange };
        }
      }
    }
    return best;
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
