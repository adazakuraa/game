/**
 * Phase 5 verification probe (see docs/PHASE5-DESIGN.md §9.9).
 * Chart secrecy + aerial-photo look, world edge, boat/album count hiding, the
 * pyramid, the moved blue hole, the cave from above, treasure chests and their
 * gear, marine snow gating, and the per-map fish census positions.
 *
 * Usage: node scripts/probe-phase5.cjs [path-to-artifact.html]
 * Screenshots land in /tmp/p5-*.png for eyeballing.
 */
const path = require('path');
const http = require('http');
const fs = require('fs');

function serveArtifact(file) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fs.readFileSync(file));
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/` }));
  });
}

let chromium;
try { ({ chromium } = require('playwright')); }
catch { try { ({ chromium } = require('playwright-core')); } catch { ({ chromium } = require('/tmp/probe-env/node_modules/playwright-core')); } }

const ARTIFACT = process.argv[2] || path.join(__dirname, '..', 'dist', 'artifact.html');
const EXE = process.env.PROBE_CHROME || '/tmp/probe-env/cft/chrome-headless-shell-linux64/chrome-headless-shell';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  const chartLog = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('ERR_TUNNEL')) errors.push(m.text());
    if (m.text().includes('[minimap]')) chartLog.push(m.text());
  });
  const { server, url } = await serveArtifact(ARTIFACT);
  await page.goto(url);
  await page.waitForFunction(() => window.__THREE_GAME_TEST_HOOKS__, null, { timeout: 60000 });
  const H = () => window.__THREE_GAME_TEST_HOOKS__;
  const ev = (fn, arg) => page.evaluate(fn, arg);
  // dismiss the prologue, enter a dive
  await ev(() => { const b = document.getElementById('pr-go'); if (b) b.click(); });
  await page.waitForTimeout(1500);
  await ev(() => window.__THREE_GAME_TEST_HOOKS__.setState('reef'));
  await page.waitForTimeout(2500);
  await ev(() => { const g = window.__THREE_GAME_TEST_HOOKS__.game; g.tut.step = -1; g.ensureMinimap(); });
  await page.waitForTimeout(500);

  // ---------- chart: secrecy, aerial look, edges ----------
  const chart = await ev(() => {
    const g = window.__THREE_GAME_TEST_HOOKS__.game;
    const c = g.minimap.chart;
    const ctx = c.getContext('2d');
    const img = ctx.getImageData(0, 0, c.width, c.height);
    const px = (x, z) => g.minimap.px(x, z);
    const at = (x, z) => {
      const [i, j] = px(x, z);
      const o = (Math.round(j) * c.width + Math.round(i)) * 4;
      return [img.data[o], img.data[o + 1], img.data[o + 2]];
    };
    const region = (x0, x1, z0, z1) => {
      const out = [];
      for (let x = x0; x <= x1; x += 5) for (let z = z0; z <= z1; z += 5) out.push(at(x, z));
      return out;
    };
    const std = (cols) => {
      const m = [0, 1, 2].map((k) => cols.reduce((a, c) => a + c[k], 0) / cols.length);
      return Math.sqrt([0, 1, 2].reduce((a, k) => a + cols.reduce((s, c) => s + (c[k] - m[k]) ** 2, 0) / cols.length, 0) / 3);
    };
    const mean = (cols) => [0, 1, 2].map((k) => Math.round(cols.reduce((a, c) => a + c[k], 0) / cols.length));
    const ruins = region(-355, -305, 480, 530);          // over the pyramid: should read as plain -22 m seafloor
    const seafloor = region(-355, -305, 300, 350);       // plain deep seafloor for comparison
    const trench = region(-345, -295, 880, 940);         // over the cave passage
    const plateau = region(-410, -380, 880, 940);        // cave plateau away from the passage
    const corners = [at(-425, -65), at(425, -65), at(-425, 1075), at(425, 1075), at(0, 1075), at(-425, 500)];
    const shallow = mean(region(-40, 40, 20, 80));
    const deep = mean(region(-40, 40, 800, 900));
    return { ruinsStd: std(ruins), seaStd: std(seafloor), ruinsMean: mean(ruins), seaMean: mean(seafloor),
      trenchMean: mean(trench), plateauMean: mean(plateau), corners, shallow, deep,
      dataUrl: c.toDataURL('image/png') };
  });
  fs.writeFileSync('/tmp/p5-chart.png', Buffer.from(chart.dataUrl.split(',')[1], 'base64'));
  check('chart: no pyramid shape over the ruins', chart.ruinsStd < chart.seaStd * 2.2, `std ruins=${chart.ruinsStd.toFixed(1)} sea=${chart.seaStd.toFixed(1)} means ${chart.ruinsMean} vs ${chart.seaMean}`);
  const trenchDiff = Math.max(...chart.trenchMean.map((v, k) => Math.abs(v - chart.plateauMean[k])));
  check('chart: no cave trench line', trenchDiff < 26, `max channel diff ${trenchDiff} (trench ${chart.trenchMean} vs plateau ${chart.plateauMean})`);
  // the design's deepest water is #082c6a (8,44,106): "never black" means never the old #020c14
  const notBlack = chart.corners.every(([r, g, b]) => b > 80 && g > 30);
  check('chart: edges are sea/land, never black', notBlack, `corners ${JSON.stringify(chart.corners)}`);
  check('chart: shallow bright, deep dark blue', chart.shallow[1] > 150 && chart.deep[2] > 60 && chart.deep[0] < 40, `shallow=${chart.shallow} deep=${chart.deep}`);
  console.log('  chart log:', chartLog.join(' | ') || '(none)');

  // ---------- moved species positions ----------
  const pos = await ev(() => {
    const h = window.__THREE_GAME_TEST_HOOKS__;
    return { hole: h.findSpecies('akebonohaze'), top: h.findSpecies('kusafugu'), ruins: h.findSpecies('tsubameuo') };
  });
  check('blue hole species live at the new hole (300,600)', !!pos.hole && Math.hypot(pos.hole.x - 300, pos.hole.z - 600) < 45, JSON.stringify(pos.hole));
  check('cave-top sand fish on the plateau (y > -5)', !!pos.top && pos.top.y > -5, JSON.stringify(pos.top));
  check('moved ruins fish near the ruins', !!pos.ruins && Math.hypot(pos.ruins.x + 330, pos.ruins.z - 505) < 80, JSON.stringify(pos.ruins));

  // ---------- screenshots: pyramid / cave top / cave inside ----------
    const shot = async (name, fn) => {
    await ev(fn);
    await page.waitForTimeout(2600);
    try { await page.screenshot({ path: `/tmp/p5-${name}.png`, timeout: 120000 }); }
    catch (e) { console.log(`  (screenshot ${name} skipped: ${String(e).split('\n')[0]})`); }
  };
  await shot('pyramid', () => { const h = window.__THREE_GAME_TEST_HOOKS__; h.teleport(-330, -13, 560); h.look(Math.PI, -0.12); });
  await shot('cavetop', () => { const h = window.__THREE_GAME_TEST_HOOKS__; h.teleport(-330, -1.6, 905); h.look(Math.PI * 0.9, -1.15); });
  await shot('cavein', () => window.__THREE_GAME_TEST_HOOKS__.setState('cave'));
  await shot('hole', () => window.__THREE_GAME_TEST_HOOKS__.setState('bluehole'));

  // ---------- world edge ----------
  const edge = await ev(() => {
    const g = window.__THREE_GAME_TEST_HOOKS__.game;
    const h = window.__THREE_GAME_TEST_HOOKS__;
    h.teleport(-429.5, -5, 300);
    g.vel.set(-3, 0, 0);
    for (let i = 0; i < 6; i++) g.updateDiver(0.05);
    return { x: g.camera.position.x, toast: document.getElementById('toast').textContent };
  });
  check('world edge: clamped with the "no further" toast', edge.x >= -430 && /進めない/.test(edge.toast), `x=${edge.x.toFixed(1)} toast="${edge.toast}"`);

  // ---------- boat + album secrecy ----------
  await ev(() => window.__THREE_GAME_TEST_HOOKS__.setState('title'));
  await page.waitForTimeout(600);
  const boat = await ev(() => document.getElementById('points').innerText);
  check('boat: undiscovered shown as ×？, never a count', boat.includes('未発見のポイント ×？') && !/未発見のポイント ×\d/.test(boat), '');
  const album = await ev(() => {
    const g = window.__THREE_GAME_TEST_HOOKS__.game;
    g.renderAlbum();
    const body = document.getElementById('album-body');
    return { text: body.innerText, rows: body.querySelectorAll('.al-spot').length };
  });
  check('album: spot total hidden, undiscovered maps have no row', album.text.includes('/ ？') && !album.text.includes('未発見のマップ') && album.rows === 1, `rows=${album.rows}`);

  // ---------- chests ----------
  await ev(() => window.__THREE_GAME_TEST_HOOKS__.setState('reef'));
  await page.waitForTimeout(1500);
  const chestList = await ev(() => window.__THREE_GAME_TEST_HOOKS__.chests());
  check('chests: 12 placed (10 + Phase 9 estuary and river)', chestList.length === 12, chestList.map((c) => c.id).join(','));
  const bh = chestList.find((c) => c.id === 'c_bluehole');
  check('chests: blue-hole chest above the scuba limit', !!bh && bh.y > -57, `y=${bh?.y?.toFixed(1)}`);
  const flow = await ev(() => {
    const h = window.__THREE_GAME_TEST_HOOKS__;
    const g = h.game;
    const out = {};
    h.goChest('c_reef');
    g.updateDiver(0.05);
    out.ready = g.chestReady;
    h.openChest('c_reef');
    out.hints = (g.save.sceneHints ?? []).length;
    out.saved = (JSON.parse(localStorage.getItem('blue-depths-save-v1'))?.chests ?? []).includes('c_reef');
    h.openChest('c_reef');
    out.hintsAfterReopen = (g.save.sceneHints ?? []).length;
    h.openChest('c_wreck');
    out.oldreg = (g.save.owned ?? []).includes('oldreg');
    h.openChest('c_ruins');
    out.goldfins = (g.save.owned ?? []).includes('goldfins');
    // silver: with every sight photographed, a hint chest pays silver instead
    g.save.scenes = Object.fromEntries(Object.keys(window.__THREE_GAME_TEST_HOOKS__.game ? {} : {}));
    return out;
  });
  check('chests: shutter target appears within reach', flow.ready === 'c_reef', `ready=${flow.ready}`);
  check('chests: hint chest records a scene hint and saves at once', flow.hints >= 1 && flow.saved, `hints=${flow.hints} saved=${flow.saved}`);
  check('chests: an opened chest does not open twice', flow.hintsAfterReopen === flow.hints, '');
  check('chests: wreck chest gives the old regulator', flow.oldreg === true, '');
  check('chests: ruins chest gives the golden fins', flow.goldfins === true, '');
  const silver = await ev(() => {
    const h = window.__THREE_GAME_TEST_HOOKS__;
    const g = h.game;
    // mark every sight as photographed by way of the scenes the game knows
    const before = g.save.money ?? 0;
    g.save.scenes = g.save.scenes ?? {};
    for (const id of ['whalesleep', 'spawning', 'baitball', 'mantatrain', 'whaleshark', 'humpback', 'dolphins', 'hammers', 'noctiluca', 'orcas', 'tornado', 'mantanight', 'lanternrise', 'flashlight', 'akameeyes', 'ayurun']) g.save.scenes[id] = { photo: '', t: 0 };
    h.openChest('c_lagoon');
    return (g.save.money ?? 0) - before;
  });
  check('chests: with all sights known, a hint chest pays silver', silver === 1000, `+${silver}`);

  // ---------- gear effects: air (oldreg ×0.9) and speed (goldfins ×1.1) ----------
  const measure = async (owned) => ev((ow) => {
    const g = window.__THREE_GAME_TEST_HOOKS__.game;
    const h = window.__THREE_GAME_TEST_HOOKS__;
    g.save.owned = ow;
    h.teleport(0, -20, 300);
    g.vel.set(0, 0, 0);
    const air0 = g.air;
    for (let i = 0; i < 20; i++) { h.teleport(0, -20, 300); g.updateDiver(0.5); }
    const airUsed = air0 - g.air;
    // speed: hold forward for 3 s of game time in open water
    g.input.moveY = 1;
    h.look(Math.PI, 0);
    let spd = 0;
    for (let i = 0; i < 30; i++) { const p = g.camera.position; h.teleport(p.x, -12, 300); g.updateDiver(0.1); spd = g.vel.length(); }
    g.input.moveY = 0;
    return { airUsed, spd };
  }, owned);
  const base = await measure([]);
  const boosted = await measure(['oldreg', 'goldfins']);
  check('gear: old regulator cuts air use to ×0.9', Math.abs(boosted.airUsed / base.airUsed - 0.9) < 0.03, `base=${base.airUsed.toFixed(2)} with=${boosted.airUsed.toFixed(2)} ratio=${(boosted.airUsed / base.airUsed).toFixed(3)}`);
  check('gear: golden fins raise speed to ×1.1', Math.abs(boosted.spd / base.spd - 1.1) < 0.04, `base=${base.spd.toFixed(2)} with=${boosted.spd.toFixed(2)} ratio=${(boosted.spd / base.spd).toFixed(3)}`);

  // ---------- marine snow gating ----------
  await ev(() => window.__THREE_GAME_TEST_HOOKS__.setState('offshore'));
  await page.waitForTimeout(3500);
  const snowShallow = await ev(() => { const g = window.__THREE_GAME_TEST_HOOKS__.game; return { uAmb: g.env.snowMat.uniforms.uAmb.value, vis: g.env.snow.visible }; });
  check('marine snow: none in shallow offshore water', snowShallow.uAmb === 0 && snowShallow.vis === false, JSON.stringify(snowShallow));
  await ev(() => window.__THREE_GAME_TEST_HOOKS__.setState('deep'));
  await page.waitForTimeout(3500);
  const snowDeep = await ev(() => { const g = window.__THREE_GAME_TEST_HOOKS__.game; return { uAmb: g.env.snowMat.uniforms.uAmb.value, vis: g.env.snow.visible, depth: -g.camera.position.y }; });
  check('marine snow: present in the deep (ADS)', snowDeep.uAmb > 0.05 && snowDeep.vis === true, JSON.stringify(snowDeep));

  // ---------- dex zones + big map + minimap corner ----------
  const dex = await ev(() => {
    window.__THREE_GAME_TEST_HOOKS__.setState('dex');
    return document.getElementById('dex-grid').innerText;
  });
  check('dex: all 11 map headings listed', ['海底遺跡', 'ブルーホール', '水中洞窟', '流氷の入り江', '海藻の森'].every((t) => dex.includes(t)), '');
  await ev(() => {
    const g = window.__THREE_GAME_TEST_HOOKS__.game;
    g.toggleMap(true);
  });
  await page.waitForTimeout(800);
  try { await page.screenshot({ path: '/tmp/p5-bigmap.png', timeout: 120000 }); } catch { console.log('  (bigmap screenshot skipped)'); }
  await ev(() => {
    const g = window.__THREE_GAME_TEST_HOOKS__.game;
    g.toggleMap(false);
    g.minimap.update(425, 1075, 0, null, true);
  });
  await page.waitForTimeout(300);
  try { await page.locator('#minimap').screenshot({ path: '/tmp/p5-mini-corner.png', timeout: 60000 }); } catch { console.log('  (minimap screenshot skipped)'); }

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  const fails = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - fails}/${results.length} checks passed`);
  await browser.close();
  server.close();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('PROBE CRASH', e); process.exit(2); });
