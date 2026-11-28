/**
 * 修正バッチ2 F6：ゲート先の 1 ダイブあたりの出会い（120 秒、決まった周回コースを泳いで、20m 以内に入った種と個体の数）。
 * ブルーホールは全体 11 種と少ないので、流氷・水中洞窟と並べて測る。 Usage: node scripts/probe-fix2-f6-encounters.cjs [dist/artifact.html] [秒]
 */
const path = require('path');
const http = require('http');
const fs = require('fs');
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('playwright-core')); }
const ARTIFACT = process.argv[2] || path.join(__dirname, '..', 'dist', 'artifact.html');
const SECS = Number(process.argv[3] || 120);
(async () => {
  const html = fs.readFileSync(ARTIFACT);
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({ args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(600000);
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => window.__THREE_GAME_TEST_HOOKS__, null, { timeout: 120000 });
  await page.evaluate(() => document.getElementById('pr-go')?.click());
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.setState('offshore'));
  const sites = { bluehole: { id: 'bluehole', x: 300, z: 545, c: [300, 600], r: 50, y: -6, dive: true }, cold: { id: 'cold', x: -300, z: 130, c: [-300, 130], r: 50, y: -8 }, cave: { id: 'cave', x: -330, z: 850, c: [-330, 860], r: 30, y: -10 } };
  for (const key of (process.env.SITES || 'bluehole,cold,cave').split(',')) {
    const s = sites[key];
    const r = await page.evaluate(async ({ s, SECS }) => {
      const h = window.__THREE_GAME_TEST_HOOKS__, g = h.game;
      g.tut.step = -1;
      g.state = 'title';
      g.startDive({ id: s.id, name: s.id, sub: '', x: s.x, z: s.z });
      await new Promise((r) => setTimeout(r, 1500));
      g.tut.step = -1;
      const seen = new Map(); const perSample = [];
      const t0 = performance.now(); let k = 0;
      while ((performance.now() - t0) / 1000 < SECS) {
        const t = (performance.now() - t0) / 1000 / SECS; k++;
        let x, z, y = s.y;
        if (s.dive) {
          // ブルーホール：開始地点 → 穴の縁（0〜20%）→ 穴の中を螺旋で底（水深 48m）まで（20〜100%）。実際に潜る遊び方に近い
          if (t < 0.2) { const u = t / 0.2; x = s.x + (s.c[0] - s.x) * u; z = s.z + (s.c[1] - 22 - s.z) * u; y = -6; }
          else { const u = (t - 0.2) / 0.8, a = u * Math.PI * 2 * 3; x = s.c[0] + Math.sin(a) * 16; z = s.c[1] + Math.cos(a) * 16 - 6 * (1 - u); y = -6 - 42 * u; }
        } else { const a = (k * 0.5 / 20) * (Math.PI * 2) * 0.5; x = s.c[0] + Math.cos(a) * s.r; z = s.c[1] + Math.sin(a) * s.r; } // 周回：40 秒で一周
        g.camera.position.set(x, y, z); g.vel.set(0, 0, 0); g.air = 999;
        const p = g.camera.position; let n = 0;
        for (const rt of g.creatures.list) for (const ag of rt.agents) {
          if (Math.hypot(ag.p.x - p.x, ag.p.y - p.y, ag.p.z - p.z) < 20) { n++; seen.set(rt.def.id, (seen.get(rt.def.id) ?? 0) + 1); }
        }
        perSample.push(n);
        await new Promise((r) => setTimeout(r, 500));
      }
      const total = g.creatures.list.filter((rt) => rt.def.zone === s.id).length;
      return { species: seen.size, ids: [...seen.keys()], zoneSpecies: total, meanInView: +(perSample.reduce((a, b) => a + b, 0) / perSample.length).toFixed(1), samples: perSample.length };
    }, { s, SECS });
    console.log(key, JSON.stringify(r));
  }
  await browser.close(); server.close();
})();
