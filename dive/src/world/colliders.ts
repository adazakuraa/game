import type * as THREE from 'three';

/** Vertical-cylinder colliders for corals and rocks, bucketed in a coarse grid. */
export type Collider = { x: number; z: number; r: number; y0: number; y1: number; sphere?: boolean; y?: number };

const CELL = 6;
const grid = new Map<string, Collider[]>();
const key = (ix: number, iz: number) => ix + ',' + iz;

export function addCollider(c: Collider): void {
  const x0 = Math.floor((c.x - c.r) / CELL), x1 = Math.floor((c.x + c.r) / CELL);
  const z0 = Math.floor((c.z - c.r) / CELL), z1 = Math.floor((c.z + c.r) / CELL);
  for (let ix = x0; ix <= x1; ix++)
    for (let iz = z0; iz <= z1; iz++) {
      const k = key(ix, iz);
      let list = grid.get(k);
      if (!list) grid.set(k, (list = []));
      list.push(c);
    }
}

/**
 * Push a sphere (radius rad) out of any collider it overlaps. Chooses the cheaper exit:
 * up over the top or sideways out of the cylinder. Returns true if it moved; `vel` loses
 * the component pointing into the obstacle.
 */
export function resolveSphere(p: THREE.Vector3, rad: number, vel?: THREE.Vector3): boolean {
  const list = grid.get(key(Math.floor(p.x / CELL), Math.floor(p.z / CELL)));
  if (!list) return false;
  let moved = false;
  for (const c of list) {
    if (c.sphere) {
      const dx = p.x - c.x, dy = p.y - c.y!, dz = p.z - c.z;
      const d = Math.hypot(dx, dy, dz);
      const R = c.r + rad;
      if (d >= R || d < 1e-5) continue;
      const k = (R - d) / d;
      p.x += dx * k; p.y += dy * k; p.z += dz * k;
      if (vel) {
        const vn = (vel.x * dx + vel.y * dy + vel.z * dz) / d;
        if (vn < 0) { vel.x -= (vn * dx) / d; vel.y -= (vn * dy) / d; vel.z -= (vn * dz) / d; }
      }
      moved = true;
      continue;
    }
    if (p.y < c.y0 - rad || p.y > c.y1 + rad) continue;
    const dx = p.x - c.x, dz = p.z - c.z;
    const d = Math.hypot(dx, dz);
    const R = c.r + rad;
    if (d >= R) continue;
    const side = R - d;
    const up = c.y1 + rad - p.y;
    if (up < side) {
      p.y += up;
      if (vel && vel.y < 0) vel.y = 0;
    } else {
      const nx = d > 1e-4 ? dx / d : 1, nz = d > 1e-4 ? dz / d : 0;
      p.x += nx * side;
      p.z += nz * side;
      if (vel) {
        const vn = vel.x * nx + vel.z * nz;
        if (vn < 0) { vel.x -= vn * nx; vel.z -= vn * nz; }
      }
    }
    moved = true;
  }
  return moved;
}

export function colliderCount(): number {
  let n = 0;
  for (const l of grid.values()) n += l.length;
  return n;
}

/** Test helper: is the point inside any collider (with margin)? */
export function insideAny(p: THREE.Vector3, rad: number): boolean {
  const list = grid.get(key(Math.floor(p.x / CELL), Math.floor(p.z / CELL)));
  if (!list) return false;
  return list.some((c) => p.y >= c.y0 - rad * 0.5 && p.y <= c.y1 + rad * 0.5 && Math.hypot(p.x - c.x, p.z - c.z) < c.r + rad * 0.5);
}

export function addSphere(x: number, y: number, z: number, r: number): void {
  addCollider({ x, z, r, y0: y - r, y1: y + r, sphere: true, y });
}

/** Push a sphere out of a capsule (segment a-b, radius cr). */
export function resolveCapsule(p: THREE.Vector3, rad: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number, cr: number, vel?: THREE.Vector3): boolean {
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const l2 = abx * abx + aby * aby + abz * abz;
  let t = l2 > 0 ? ((p.x - ax) * abx + (p.y - ay) * aby + (p.z - az) * abz) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const qx = ax + abx * t, qy = ay + aby * t, qz = az + abz * t;
  const dx = p.x - qx, dy = p.y - qy, dz = p.z - qz;
  const d = Math.hypot(dx, dy, dz);
  const R = cr + rad;
  if (d >= R || d < 1e-5) return false;
  const k = (R - d) / d;
  p.x += dx * k; p.y += dy * k; p.z += dz * k;
  if (vel) {
    const vn = (vel.x * dx + vel.y * dy + vel.z * dz) / d;
    if (vn < 0) { vel.x -= (vn * dx) / d; vel.y -= (vn * dy) / d; vel.z -= (vn * dz) / d; }
  }
  return true;
}
