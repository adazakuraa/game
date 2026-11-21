import * as THREE from 'three';
import { heightAt } from './layout';

/**
 * True "what is under me" height: terrain plus the actual triangles of solid scatter (rocks, coral heads,
 * bommies), found by a downward ray against the placed geometry. Used to set benthic animals onto rocks/coral
 * instead of floating at an estimated height.
 */
type Item = { geo: THREE.BufferGeometry; m: THREE.Matrix4; x: number; z: number; r: number; top: number };
const CELL = 6;
const grid = new Map<string, Item[]>();
const key = (ix: number, iz: number) => ix + ',' + iz;

export function addSurfaceItem(geo: THREE.BufferGeometry, m: THREE.Matrix4, x: number, z: number, r: number, top: number): void {
  const it: Item = { geo, m, x, z, r, top };
  for (let ix = Math.floor((x - r) / CELL); ix <= Math.floor((x + r) / CELL); ix++)
    for (let iz = Math.floor((z - r) / CELL); iz <= Math.floor((z + r) / CELL); iz++) {
      const k = key(ix, iz);
      let l = grid.get(k);
      if (!l) grid.set(k, (l = []));
      l.push(it);
    }
}

const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
const probe = new THREE.Mesh(new THREE.BufferGeometry(), mat);
const ray = new THREE.Raycaster();
const down = new THREE.Vector3(0, -1, 0);
const origin = new THREE.Vector3();
const hits: THREE.Intersection[] = [];

/** Highest surface at (x, z): terrain or the top of any rock / coral head there. */
export function surfaceAt(x: number, z: number): number {
  let y = heightAt(x, z);
  const list = grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
  if (!list) return y;
  for (const it of list) {
    if (it.top <= y || Math.hypot(x - it.x, z - it.z) > it.r) continue;
    probe.geometry = it.geo;
    probe.matrixWorld.copy(it.m);
    origin.set(x, it.top + 0.5, z);
    ray.set(origin, down);
    ray.far = it.top + 0.5 - y;
    hits.length = 0;
    probe.raycast(ray, hits);
    for (const h of hits) if (h.point.y > y) y = h.point.y;
  }
  return y;
}
