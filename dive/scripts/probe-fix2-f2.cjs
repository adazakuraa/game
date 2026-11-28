/**
 * 修正バッチ2 F2 probe: (31) スティック前進で沈まない（pitch −0.35 で 10 秒 → 水深変化 0.1m 以内、真下 70° なら降りる）、
 * (14) ボートの錨（綱の上端が船首に付き揺れに合わせて動く、錨は海底、描画 +2 呼び出し・1k 三角形以下）。
 * (11) の浮き計測は scripts/probe-float.cjs。 Usage: node scripts/probe-fix2-f2.cjs [dist/artifact.html]
 */
const path = require('path');
const http = require('http');
const fs = require('fs');
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('playwright-core')); }
const ARTIFACT = process.argv[2] || path.join(__dirname, '..', 'dist', 'artifact.html');
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

(async () => {
  const html = fs.readFileSync(ARTIFACT);
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({ ...(process.env.PROBE_CHROME ? { executablePath: process.env.PROBE_CHROME } : {}), args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => window.__THREE_GAME_TEST_HOOKS__, null, { timeout: 120000 });
  await page.waitForTimeout(1500);
  await page.evaluate(() => document.getElementById('pr-go')?.click());
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.setState('offshore'));

  // ---- (31)
  const stick = await page.evaluate(() => {
    const h = window.__THREE_GAME_TEST_HOOKS__, g = h.game;
    g.tut.step = -1;
    const run = (pitch, secs = 10) => {
      h.teleport(0, -20, 520); g.vel.set(0, 0, 0); g.input.keys.delete('KeyW'); g.updateDiver(0.1);
      h.teleport(0, -20, 520); g.vel.set(0, 0, 0);
      h.look(Math.PI, pitch);
      const y0 = g.camera.position.y, z0 = g.camera.position.z;
      g.input.keys.add('KeyW');
      for (let i = 0; i < secs * 10; i++) { h.look(Math.PI, pitch); g.updateDiver(0.1); g.air = 999; }
      g.input.keys.delete('KeyW');
      return { dy: +(g.camera.position.y - y0).toFixed(3), dz: +(g.camera.position.z - z0).toFixed(2) };
    };
    return { p35: run(-0.35), p0: run(0), up35: run(0.35), p60: run(-60 * Math.PI / 180), p80: run(-80 * Math.PI / 180), p50: run(-50 * Math.PI / 180) };
  });
  console.log(JSON.stringify(stick));
  check('(31) pitch −0.35、スティック前 10 秒 → 水深の変化 0.1m 以内、前へは進む', Math.abs(stick.p35.dy) <= 0.1 && Math.abs(stick.p35.dz) > 10, JSON.stringify(stick.p35));
  check('(31) pitch +0.35（上向き）でも浮き上がらない', Math.abs(stick.up35.dy) <= 0.1, JSON.stringify(stick.up35));
  check('(31) |pitch| = 50° までは縦に進まない', Math.abs(stick.p50.dy) <= 0.15, JSON.stringify(stick.p50));
  check('(31) 60° は途中まで、80° は見ている方向へ縦にも降りる（段階的）', stick.p60.dy < -1 && stick.p80.dy < stick.p60.dy - 1, `60°=${stick.p60.dy} 80°=${stick.p80.dy}`);

  // ---- (14)
  const an = await page.evaluate(() => {
    const h = window.__THREE_GAME_TEST_HOOKS__, g = h.game, f = g.flora;
    const out = {};
    for (const [x, z, yaw] of [[22, 52, undefined], [-30, 218, undefined], [100, 220, 0.15]]) {
      f.placeBoat(x, z, yaw);
      f.boat.visible = true;
      f.update(g.camera.position, 1.0);
      const a = f.anchor, m = a.model, rp = a.rope;
      const mp = m.position;
      const bow = f.boat.localToWorld(new f.boat.position.constructor(0, 0.1, 7.4));
      const pos = rp.geometry.attributes.position;
      const topRing = [0, 1, 2, 3, 4].reduce((s, k) => s.add(new f.boat.position.constructor(pos.getX(k), pos.getY(k), pos.getZ(k))), new f.boat.position.constructor()).multiplyScalar(0.2);
      const endRing = [15, 16, 17, 18, 19].reduce((s, k) => s.add(new f.boat.position.constructor(pos.getX(k), pos.getY(k), pos.getZ(k))), new f.boat.position.constructor()).multiplyScalar(0.2);
      const ground = h.heightAt(mp.x, mp.z);
      f.update(g.camera.position, 3.0);
      const bow2 = f.boat.localToWorld(new f.boat.position.constructor(0, 0.1, 7.4));
      const top2 = new f.boat.position.constructor(pos.getX(0), pos.getY(0), pos.getZ(0));
      const tris = [m, rp].reduce((s, o) => s + (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3, 0);
      out[x + ',' + z] = { visible: a.group.visible, topErr: +topRing.distanceTo(bow).toFixed(3), endErr: +endRing.distanceTo(new f.boat.position.constructor(mp.x, mp.y + 0.5, mp.z)).toFixed(3), anchorAboveGround: +(mp.y - ground).toFixed(2), depth: +(-h.heightAt(bow.x, bow.z)).toFixed(1), swayMove: +bow.distanceTo(bow2).toFixed(3), topFollows: +top2.distanceTo(bow2).toFixed(2), anchorStill: mp.y === m.position.y, tris, meshes: a.group.children.length };
    }
    // hidden boat (ADS) hides the anchor
    g.flora.boat.visible = false; g.flora.update(g.camera.position, 4);
    out.hidden = !g.flora.anchor.group.visible;
    return out;
  });
  console.log(JSON.stringify(an));
  for (const k of Object.keys(an)) {
    if (k === 'hidden') continue;
    const o = an[k];
    check(`(14) ${k}: 錨が置かれ綱の上端は船首に付く（誤差 0.1m 以内）、揺れに合わせて動く`, o.visible && o.topErr < 0.1 && o.swayMove > 0.005, JSON.stringify(o));
    check(`(14) ${k}: 錨は海底（±0.5m）、綱の下端は錨に付く、三角形 1k 以下・メッシュ 2 つ`, Math.abs(o.anchorAboveGround) < 0.5 && o.endErr < 0.1 && o.tris <= 1000 && o.meshes === 2, JSON.stringify(o));
  }
  check('(14) ボートを隠す（ADS）と錨も消える', an.hidden);
  check('ページエラーなし', errors.length === 0, errors.join(' | '));
  await browser.close();
  server.close();
  const bad = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - bad}/${results.length} passed`);
  process.exit(bad ? 1 : 0);
})();
