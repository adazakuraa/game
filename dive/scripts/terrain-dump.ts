import { heightAt, surfaceTopAt, chartHeightAt } from '../src/world/layout';
import * as fs from 'node:fs';
let s = 123456789;
const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
const pts: number[][] = [];
for (let i = 0; i < 100000; i++) {
  let x = -430 + rnd() * 860, z = -60 + rnd() * 1140;
  if (i < 2000) z = -60 + rnd() * 30;      // dense near the new boundary
  pts.push([x, z]);
}
pts.push([0, -60], [100, -60], [-300, -60]);
const out = pts.map(([x, z]) => [x, z, heightAt(x, z), surfaceTopAt(x, z), chartHeightAt(x, z)]);
fs.writeFileSync(process.argv[2], JSON.stringify(out));
console.log('points', out.length);
