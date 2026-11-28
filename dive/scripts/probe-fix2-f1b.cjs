/** 修正バッチ2 F1b probe: (41) 基準改定とセーブ移行（二重移行しない）、(42) 一時停止ボタン＝移動ボタン、(43) 枠の idle、(44) 左上の順序。
 * Usage: node scripts/probe-fix2-f1b.cjs [dist/artifact.html]  (PROBE_CHROME=<chromium>) */
const path = require('path'), http = require('http'), fs = require('fs');
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('playwright-core')); }
const ARTIFACT = process.argv[2] || path.join(__dirname, '..', 'dist', 'artifact.html');
const EXE = process.env.PROBE_CHROME;
const results = [];
const check = (n, ok, d = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };
(async () => {
  const html = fs.readFileSync(ARTIFACT);
  const server = http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); r.end(html); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({ ...(EXE ? { executablePath: EXE } : {}), args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'] });
  const page = await browser.newPage({ viewport: { width: 844, height: 1000 } });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('seeded')) {
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem('blue-depths-save-v1', JSON.stringify({ found: {}, dives: 1, maxDepth: 0, money: 0, owned: [], earned: 0, discovered: ['lagoon', 'reef'], visited: ['lagoon'], storyMain: 0, storyRead: -1, airLv: 0, p1: 1, p2: 1, tutorial: true, day: 1, clock: 0, ui: { shutter: 0.8, ctl: 0.75 } }));
    }
  });
  const url = `http://127.0.0.1:${server.address().port}/`;
  const boot = async () => { await page.waitForFunction(() => window.__THREE_GAME_TEST_HOOKS__, null, { timeout: 120000 }); await page.waitForTimeout(1200); };
  const kk = () => page.evaluate(() => ({ s: getComputedStyle(document.documentElement).getPropertyValue('--shutter-k').trim(), c: getComputedStyle(document.documentElement).getPropertyValue('--ctl-k').trim(), ui: JSON.parse(localStorage.getItem('blue-depths-save-v1')).ui }));
  await page.goto(url); await boot();
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.game.writeSave());
  let k = await kk();
  check('(41) 旧セーブ shutter 0.8 / ctl 0.75 → 新倍率 1 / 1、ui.base = 2', k.s === '1' && k.c === '1' && k.ui.base === 2 && k.ui.shutter === 1 && k.ui.ctl === 1, JSON.stringify(k));
  await page.reload(); await boot(); k = await kk();
  check('(41) 再読み込みしても二重に移行しない', k.s === '1' && k.c === '1' && k.ui.base === 2, JSON.stringify(k));
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.setState('reef')); await page.waitForTimeout(1500);
  const z = await page.evaluate(() => { const r = (s) => document.querySelector(s).getBoundingClientRect(); const d = document.getElementById('hud-depth').children; return { sh: r('#btn-shutter').width, up: r('#btn-up').width, pause: r('#btn-pause').width, first: d[0].id || d[0].className, ret: document.getElementById('reticle').className, o: getComputedStyle(document.querySelector('#reticle .c')).opacity, zy: r('#zone-name').top, dy: r('#depth-value').top }; });
  check('(41) 既定 100% はシャッター 76.8px・移動ボタン 43.5px', Math.abs(z.sh - 76.8) < 1 && Math.abs(z.up - 43.5) < 1, JSON.stringify(z));
  check('(42) 一時停止ボタン = 移動ボタンの大きさ', Math.abs(z.pause - z.up) < 0.6, JSON.stringify(z));
  check('(44) エリア名が水深の上', z.zy < z.dy, JSON.stringify(z));
  check('(43) 枠は idle のとき薄く（0.22）、魚がいれば通常（1）', (z.ret.includes('idle') ? Math.abs(Number(z.o) - 0.22) < 0.05 : Number(z.o) === 1), JSON.stringify(z));
  const lock = await page.evaluate(() => { const e = document.getElementById('reticle').cloneNode(true); e.id = 'ret2'; e.className = 'lock'; document.body.appendChild(e); return getComputedStyle(e.querySelector('.c')).opacity; });
  check('(43) idle でなければ通常の濃さ（不透明度 1）', Number(lock) === 1, lock);
  check('no page errors', errors.length === 0, errors.join('|').slice(0, 300));
  await browser.close(); server.close();
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`); process.exit(results.every(Boolean) ? 0 : 1);
})().catch((e) => { console.log('CRASH', e); process.exit(2); });
