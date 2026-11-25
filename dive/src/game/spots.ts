import * as THREE from 'three';
import { ARCH, BLUEHOLE, CENOTE, heightAt, KELP, RUINS, VENT, WRECK } from '../world/layout';

/**
 * Photo spots (Phase 3): famous views of the island. Shooting one from inside its circle, with the
 * viewfinder on its focus, pays once (the first time only) when the diver surfaces, like a creature photo.
 * Places, sizes and pay are tuning values (PHASE3-DESIGN §5.2).
 */
export const SPOT = {
  /** 【スポットの円】radius (m) drawn on the map; the shot must be taken inside it */
  r: 20,
  /** 【向き】max angle (deg) between the view and the focus */
  cone: 30,
  /** 【距離】max distance (m) from the camera to the focus */
  maxDist: 35,
};

export type SpotDef = {
  id: string;
  name: string;
  /** dive point (map) it belongs to: shown on the map only once that point is known */
  point: string;
  x: number;
  z: number;
  /** focus height: metres above the floor, or an absolute y when `y` is set */
  h?: number;
  y?: number;
  r?: number;
  pay: number;
  desc: string;
};

export const SPOTS: SpotDef[] = [
  { id: 'lagoon', name: 'ラグーンの白い砂紋', point: 'lagoon', x: -14, z: 52, h: 0.3, pay: 300, desc: '波がつくった砂の模様が、光の網目と重なる' },
  { id: 'reef', name: 'サンゴの根', point: 'reef', x: -30, z: 215, h: 1.5, pay: 400, desc: '色とりどりのサンゴが積み重なった大きな根' },
  { id: 'arch', name: '岩のアーチ', point: 'rocky', x: ARCH.x, z: ARCH.z, h: 3, pay: 500, desc: '岩礁にぽっかり開いた天然のアーチ' },
  { id: 'wreck', name: '沈没船', point: 'dropoff', x: WRECK.x, z: WRECK.z, h: 2, pay: 600, desc: '傾いたまま眠る古い船。魚たちの住みかになっている' },
  { id: 'kelp', name: 'ケルプの森の光', point: 'kelp', x: KELP.x, z: KELP.z, h: 6, pay: 800, desc: '水面まで伸びる海藻のすき間から、光が差しこむ' },
  { id: 'ruins', name: '海底遺跡の石段', point: 'ruins', x: RUINS.x, z: RUINS.z, h: 2, pay: 800, desc: '沈んだ町の、苔むした石の階段' },
  { id: 'bluehole', name: 'ブルーホールの縁', point: 'bluehole', x: BLUEHOLE.x, z: BLUEHOLE.z, y: -24, r: 40, pay: 900, desc: '浅瀬に開いた底なしの青い穴を、縁からのぞきこむ' },
  { id: 'cenote', name: 'セノーテの光のカーテン', point: 'cave', x: CENOTE.x, z: CENOTE.z, y: -12, pay: 1000, desc: '天井の穴から、光がカーテンのように降りてくる' },
  { id: 'vent', name: '熱水噴出孔', point: 'deep', x: VENT.x, z: VENT.z, h: 4, pay: 2000, desc: '深海の煙突から、黒い熱水が噴き上がる' },
];

const _v = new THREE.Vector3();
const _f = new THREE.Vector3();

export function spotFocus(s: SpotDef, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(s.x, s.y ?? heightAt(s.x, s.z) + (s.h ?? 1), s.z);
}

/** The spot this camera is framing right now (inside its circle, looking at its focus), if any. */
export function spotInView(cam: THREE.Camera): SpotDef | null {
  const p = cam.position;
  cam.getWorldDirection(_f);
  const cos = Math.cos((SPOT.cone * Math.PI) / 180);
  for (const s of SPOTS) {
    if (Math.hypot(p.x - s.x, p.z - s.z) > (s.r ?? SPOT.r)) continue;
    spotFocus(s, _v).sub(p);
    const d = _v.length();
    if (d > SPOT.maxDist) continue;
    // standing right on top of the focus counts as framing it
    if (d < 3 || _v.normalize().dot(_f) >= cos) return s;
  }
  return null;
}
