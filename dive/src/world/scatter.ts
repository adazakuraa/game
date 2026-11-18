import * as THREE from 'three';

export type ScatterItem = { m: THREE.Matrix4; c?: THREE.Color };

/** Instanced set bucketed into spatial cells so off-screen cells can be skipped cheaply. */
export class ScatterSet {
  readonly group = new THREE.Group();
  private cells: { mesh: THREE.InstancedMesh; cx: number; cz: number }[] = [];

  constructor(
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    items: ScatterItem[],
    public viewDist = 85,
    cellSize = 70,
  ) {
    const buckets = new Map<string, ScatterItem[]>();
    const v = new THREE.Vector3();
    for (const it of items) {
      v.setFromMatrixPosition(it.m);
      const k = Math.floor(v.x / cellSize) + ',' + Math.floor(v.z / cellSize);
      let b = buckets.get(k);
      if (!b) buckets.set(k, (b = []));
      b.push(it);
    }
    for (const [k, list] of buckets) {
      const [ix, iz] = k.split(',').map(Number);
      const mesh = new THREE.InstancedMesh(geo, mat, list.length);
      const hasColor = list.some((i) => i.c);
      list.forEach((it, i) => {
        mesh.setMatrixAt(i, it.m);
        if (hasColor) mesh.setColorAt(i, it.c ?? new THREE.Color(1, 1, 1));
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.matrixAutoUpdate = false;
      this.cells.push({ mesh, cx: (ix + 0.5) * cellSize, cz: (iz + 0.5) * cellSize });
      this.group.add(mesh);
    }
  }

  update(x: number, y: number, z: number): void {
    for (const c of this.cells) {
      const s = c.mesh.boundingSphere!;
      const d = Math.hypot(s.center.x - x, s.center.y - y, s.center.z - z) - s.radius;
      c.mesh.visible = d < this.viewDist;
    }
  }

  get count(): number {
    return this.cells.reduce((a, c) => a + c.mesh.count, 0);
  }
}
