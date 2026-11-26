// 検証専用の代用品（three/addons/utils/BufferGeometryUtils.js が無い環境向け）
import { BufferGeometry, BufferAttribute } from 'three';
export function mergeGeometries(list) {
  const first = list[0]; const indexed = !!first.index; const names = Object.keys(first.attributes);
  const out = new BufferGeometry();
  for (const g of list) { if (!!g.index !== indexed) return null; const n = Object.keys(g.attributes); if (n.length !== names.length || !n.every((k) => names.includes(k))) return null; }
  for (const k of names) {
    const a0 = first.attributes[k]; let len = 0; for (const g of list) len += g.attributes[k].count * a0.itemSize;
    const arr = new a0.array.constructor(len); let o = 0;
    for (const g of list) { const a = g.attributes[k]; if (a.itemSize !== a0.itemSize || a.array.constructor !== a0.array.constructor) return null; arr.set(a.array.subarray(0, a.count * a.itemSize), o); o += a.count * a.itemSize; }
    out.setAttribute(k, new BufferAttribute(arr, a0.itemSize, a0.normalized));
  }
  if (indexed) { const idx = []; let base = 0; for (const g of list) { for (let i = 0; i < g.index.count; i++) idx.push(g.index.getX(i) + base); base += g.attributes.position.count; } out.setIndex(idx); }
  return out;
}
export function mergeVertices(g, tol = 1e-4) {
  const names = Object.keys(g.attributes); const n = g.index ? g.index.count : g.attributes.position.count;
  const map = new Map(); const idx = []; const keep = []; const s = 1 / tol;
  for (let i = 0; i < n; i++) { const v = g.index ? g.index.getX(i) : i; let key = '';
    for (const k of names) { const a = g.attributes[k]; for (let c = 0; c < a.itemSize; c++) key += Math.round(a.array[v * a.itemSize + c] * s) + ','; }
    let j = map.get(key); if (j === undefined) { j = keep.length; keep.push(v); map.set(key, j); } idx.push(j); }
  const out = new BufferGeometry();
  for (const k of names) { const a = g.attributes[k]; const arr = new a.array.constructor(keep.length * a.itemSize); keep.forEach((v, j) => arr.set(a.array.subarray(v * a.itemSize, (v + 1) * a.itemSize), j * a.itemSize)); out.setAttribute(k, new BufferAttribute(arr, a.itemSize, a.normalized)); }
  out.setIndex(idx); return out;
}
