import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Small props built from a few parts (chests, finds on the sea floor) merged into one mesh, one draw call
 * each (PHASE8-DESIGN §6.3-④). The look of each part's own MeshStandardMaterial is kept by baking its
 * colour, roughness, metalness and emissive into vertex attributes of one shared material.
 */
export type PropPart = {
  geo: THREE.BufferGeometry;
  color: number;
  rough: number;
  metal?: number;
  emissive?: number;
};

let shared: THREE.MeshStandardMaterial | null = null;

export function propMaterial(): THREE.MeshStandardMaterial {
  if (shared) return shared;
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 1 });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = `attribute vec2 aRM; attribute vec3 aEmis; varying vec2 vRM; varying vec3 vEmis;\n${shader.vertexShader}`
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vRM = aRM; vEmis = aEmis;');
    shader.fragmentShader = `varying vec2 vRM; varying vec3 vEmis;\n${shader.fragmentShader}`
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor *= vRM.x;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n  metalnessFactor *= vRM.y;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += vEmis;');
  };
  mat.customProgramCacheKey = () => 'prop';
  shared = mat;
  return mat;
}

/**
 * Merge parts (geometries already placed in the prop's own frame; they are consumed) into one geometry.
 * Vertices keep the order of the parts, so a part can still be moved afterwards by its vertex range.
 */
export function mergeProp(parts: PropPart[]): THREE.BufferGeometry {
  const c = new THREE.Color(), e = new THREE.Color();
  const geos = parts.map((p) => {
    const g = p.geo;
    g.deleteAttribute('uv');
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3), rm = new Float32Array(n * 2), em = new Float32Array(n * 3);
    c.set(p.color);
    e.set(p.emissive ?? 0x000000);
    for (let i = 0; i < n; i++) {
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      rm[i * 2] = p.rough; rm[i * 2 + 1] = p.metal ?? 0;
      em[i * 3] = e.r; em[i * 3 + 1] = e.g; em[i * 3 + 2] = e.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aRM', new THREE.BufferAttribute(rm, 2));
    g.setAttribute('aEmis', new THREE.BufferAttribute(em, 3));
    return g;
  });
  const merged = mergeGeometries(geos)!;
  for (const g of geos) g.dispose();
  return merged;
}
