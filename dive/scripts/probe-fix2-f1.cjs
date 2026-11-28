/**
 * 修正バッチ2 F1 probe: HUD size settings (--shutter-k / --ctl-k, save.ui kept across a progress reset), air number centred in the
 * ring (2 viewports), two air warnings only, narcosis blackout after 60 s, dex page closing (dexDirect), removed HUD rows / buttons /
 * glint, wording, board day, grades. Usage: node scripts/probe-fix2-f1.cjs [dist/artifact.html]  (PROBE_CHROME=<chromium binary>)
 */
const path = require('path');
const http = require('http');
const fs = require('fs');
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('playwright-core')); }
const ARTIFACT = process.argv[2] || path.join(__dirname, '..', 'dist', 'artifact.html');
const EXE = process.env.PROBE_CHROME;
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

(async () => {
  const html = fs.readFileSync(ARTIFACT);
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({ ...(EXE ? { executablePath: EXE } : {}), args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(() => {
    if (!localStorage.getItem('blue-depths-save-v1')) {
      localStorage.setItem('blue-depths-save-v1', JSON.stringify({ found: {}, dives: 1, maxDepth: 0, money: 0, owned: [], earned: 0, discovered: ['lagoon', 'reef'], visited: ['lagoon'], storyMain: 0, storyRead: -1, airLv: 0, p1: 1, p2: 1, tutorial: true, day: 1, clock: 0 }));
    }
  });
  const url = `http://127.0.0.1:${server.address().port}/`;
  await page.goto(url);
  await page.waitForFunction(() => window.__THREE_GAME_TEST_HOOKS__, null, { timeout: 120000 });
  const ev = (fn, arg) => page.evaluate(fn, arg);
  await page.waitForTimeout(1500);

  // ---- (1) settings screen
  const dom = await ev(() => ({
    heading: !!document.getElementById('heading'), maxDepth: !!document.getElementById('max-depth'), pauseDex: !!document.getElementById('pause-dex'),
    pauseSettings: !!document.getElementById('pause-settings'), openSettings: !!document.getElementById('open-settings'),
  }));
  check('(13)(27) heading / max-depth rows and the pause "図鑑を見る" are gone; settings buttons exist', !dom.heading && !dom.maxDepth && !dom.pauseDex && dom.pauseSettings && dom.openSettings, JSON.stringify(dom));
  await ev(() => document.getElementById('open-settings').click());
  const setV = (id, v) => ev(({ id, v }) => { const e = document.getElementById(id); e.value = String(v); e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }, { id, v });
  await setV('set-shutter', 130);
  await setV('set-ctl', 70);
  const k = await ev(() => ({ s: getComputedStyle(document.documentElement).getPropertyValue('--shutter-k').trim(), c: getComputedStyle(document.documentElement).getPropertyValue('--ctl-k').trim(), shown: !document.getElementById('settings').classList.contains('hidden'), saved: JSON.parse(localStorage.getItem('blue-depths-save-v1')).ui, pv: document.querySelector('.pv-shutter').getBoundingClientRect().width, pc: document.querySelector('.pv-ctl').getBoundingClientRect().width }));
  check('(1) sliders set --shutter-k / --ctl-k and the sample buttons follow; saved in save.ui', k.s === '1.3' && k.c === '0.7' && k.shown && k.saved && Math.abs(k.saved.shutter - 1.3) < 1e-6 && Math.abs(k.saved.ctl - 0.7) < 1e-6 && Math.abs(k.pv - 124.8) < 1 && k.pc >= 44, JSON.stringify(k));
  await ev(() => document.getElementById('set-close').click());
  await page.reload();
  await page.waitForFunction(() => window.__THREE_GAME_TEST_HOOKS__, null, { timeout: 120000 });
  await page.waitForTimeout(1500);
  const k2 = await ev(() => getComputedStyle(document.documentElement).getPropertyValue('--shutter-k').trim());
  check('(1) the size survives a reload', k2 === '1.3', k2);
  // progress reset keeps ui
  await ev(() => { const b = document.getElementById('reset-save'); b.click(); });
  await page.evaluate(() => document.getElementById('reset-save').click());
  await page.waitForTimeout(2500);
  await page.waitForFunction(() => window.__THREE_GAME_TEST_HOOKS__, null, { timeout: 120000 });
  const after = await ev(() => { const s = JSON.parse(localStorage.getItem('blue-depths-save-v1') || 'null'); return s && { ui: s.ui, dives: s.dives, found: Object.keys(s.found || {}).length }; });
  check('(1) debug "進行度0にする" resets progress but keeps save.ui', after && after.ui && Math.abs(after.ui.shutter - 1.3) < 1e-6 && after.dives === 0 && after.found === 0, JSON.stringify(after));

  // put the tutorial-done save back (progress reset above) and go diving
  await ev(() => { const s = JSON.parse(localStorage.getItem('blue-depths-save-v1')); s.dives = 1; s.tutorial = true; s.p1 = 1; s.p2 = 1; localStorage.setItem('blue-depths-save-v1', JSON.stringify(s)); });
  await page.reload();
  await page.waitForFunction(() => window.__THREE_GAME_TEST_HOOKS__, null, { timeout: 120000 });
  await page.waitForTimeout(1500);

  // ---- night wording (9) on the boat screen
  const night2 = await ev(() => {
    const g = window.__THREE_GAME_TEST_HOOKS__.game;
    g.save.clock = 800; g.save.owned = [];
    const btns = [...document.querySelectorAll('#points button')];
    if (btns.length) btns[0].click();
    return document.getElementById('toast').textContent;
  });
  check('(9) night without a light: no parenthesis in the message', /夜の海はライトがないと潜れない。しおさい亭で休んで朝を待とう$/.test(night2) && !night2.includes('（'), night2);
  await ev(() => { const g = window.__THREE_GAME_TEST_HOOKS__.game; g.save.clock = 0; });

  // ---- dive
  await ev(() => window.__THREE_GAME_TEST_HOOKS__.setState('reef'));
  await page.waitForTimeout(1500);
  const sizes = await ev(() => {
    const r = (id) => document.getElementById(id).getBoundingClientRect();
    return { sh: r('btn-shutter').width, up: r('btn-up').width, state: window.__THREE_GAME_TEST_HOOKS__.game.state };
  });
  check('(1) in the dive the shutter is 96 x 1.3 and the ▲▼ buttons stay >= 44 px at 70%', sizes.state === 'diving' && Math.abs(sizes.sh - 124.8) < 1 && sizes.up >= 44 && sizes.up <= 46, JSON.stringify(sizes));
  await ev(() => { const g = window.__THREE_GAME_TEST_HOOKS__.game; g.paused = true; g.save.ui = { shutter: 1, ctl: 1 }; });
  await ev(() => { document.documentElement.style.setProperty('--shutter-k', '1'); document.documentElement.style.setProperty('--ctl-k', '1'); });
  const dflt = await ev(() => { const r = (id) => document.getElementById(id).getBoundingClientRect(); return { sh: r('btn-shutter').width, up: r('btn-up').width, air: r('air').width, map: r('minimap-btn').width }; });
  check('(1) default sizes: shutter 96, ctl 58, air 100, minimap 100 (390 wide)', Math.abs(dflt.sh - 96) < 1 && Math.abs(dflt.up - 58) < 1 && Math.abs(dflt.air - 100) < 1 && Math.abs(dflt.map - 100) < 1, JSON.stringify(dflt));

  // ---- (6) air number centred, two viewports
  for (const [w, h] of [[390, 844], [844, 390]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(300);
    for (const v of ['200', '88', '7']) {
      await ev((v) => { document.getElementById('air-value').textContent = v; }, v);
      const d = await ev(() => {
        const a = document.getElementById('air').getBoundingClientRect(); const n = document.getElementById('air-value').getBoundingClientRect();
        return { dx: (n.left + n.width / 2) - (a.left + a.width / 2), dy: (n.top + n.height / 2) - (a.top + a.height / 2), w: a.width };
      });
      check(`(6) air number centre within 2px of the ring centre — ${w}x${h}, "${v}"`, Math.abs(d.dx) <= 2 && Math.abs(d.dy) <= 2, JSON.stringify(d));
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  await ev(() => { const g = window.__THREE_GAME_TEST_HOOKS__.game; g.air = g.airMax; });

  // ---- (8) two air warnings only
  await ev(() => {
    const g = window.__THREE_GAME_TEST_HOOKS__.game;
    window.__warn = { n: 0, toasts: [] };
    const w = g.audio.warn.bind(g.audio);
    g.audio.warn = (s) => { window.__warn.n++; w(s); };
    const t = g.toast.bind(g);
    g.toast = (x, k, d) => { window.__warn.toasts.push(x); t(x, k, d); };
    g.paused = false; g.air = g.airMax * 0.3; g.airWarned = 0; g.save.clock = 0; g.tut.step = -1;
  });
  await page.waitForTimeout(2500);
  const w1 = await ev(() => ({ n: window.__warn.n, air: document.getElementById('air').className, toasts: window.__warn.toasts.filter((t) => t.includes('エア')) }));
  await ev(() => { const g = window.__THREE_GAME_TEST_HOOKS__.game; g.air = 40; });
  await page.waitForTimeout(2500);
  const w2 = await ev(() => ({ n: window.__warn.n, toasts: window.__warn.toasts.filter((t) => t.includes('エア')) }));
  await ev(() => { const g = window.__THREE_GAME_TEST_HOOKS__.game; g.air = 12; });
  await page.waitForTimeout(2500);
  const w3 = await ev(() => ({ n: window.__warn.n, toasts: window.__warn.toasts.filter((t) => t.includes('エア')), cls: document.getElementById('air').className, anim: getComputedStyle(document.getElementById('air')).animationName }));
  await ev(() => { const g = window.__THREE_GAME_TEST_HOOKS__.game; g.air = 11; });
  await page.waitForTimeout(8000);
  const w4 = await ev(() => ({ n: window.__warn.n, toasts: window.__warn.toasts.filter((t) => t.includes('エア')).length }));
  check('(8) half-tank warning once (35 % cut): one sound, gauge amber, no blink', w1.n === 1 && w1.toasts.length === 1 && w1.air.includes('low') && !w1.air.includes('crit') && w1.toasts[0].includes('半分'), JSON.stringify(w1));
  check('(8) staying low (40 bar) shows nothing more', w2.n === 1 && w2.toasts.length === 1, JSON.stringify(w2));
  check('(8) the last stretch (12 bar) warns once more, gauge red, no animation', w3.n === 2 && w3.toasts.length === 2 && w3.cls.includes('crit') && w3.anim === 'none', JSON.stringify(w3));
  check('(8) after 8 more seconds still only two warnings', w4.n === 2 && w4.toasts === 2, JSON.stringify(w4));
  await ev(() => { const g = window.__THREE_GAME_TEST_HOOKS__.game; g.air = g.airMax; g.airWarned = 0; });

  // ---- (34) narcosis: 60 s
  const nv = await ev(() => { const g = window.__THREE_GAME_TEST_HOOKS__.game; g.camera.position.set(0, -58, 520); g.narcDeepT = 0; return null; });
  await page.waitForTimeout(4000);
  // (headless frames are slow, so jump the timer instead of waiting: 11 s was already fatal under the old 10 s limit)
  await ev(() => { const g = window.__THREE_GAME_TEST_HOOKS__.game; g.narcDeepT = 11; });
  await page.waitForTimeout(3000);
  const n1 = await ev(() => { const g = window.__THREE_GAME_TEST_HOOKS__.game; return { state: g.state, t: g.narcDeepT, y: g.camera.position.y, warn: document.getElementById('depth-warn').textContent }; });
  check('(34) 11 s below 55 m: still conscious (the old limit was 10 s)', n1.state === 'diving' && n1.t > 10 && n1.t < 20, JSON.stringify(n1));
  await ev(() => { const g = window.__THREE_GAME_TEST_HOOKS__.game; g.narcDeepT = 45; });
  await page.waitForTimeout(3000);
  const n1b = await ev(() => ({ state: window.__THREE_GAME_TEST_HOOKS__.game.state, warn: document.getElementById('depth-warn').textContent }));
  check('(34) with 15 s left the warning turns urgent', n1b.state === 'diving' && n1b.warn.includes('もうすぐ'), JSON.stringify(n1b));
  await ev(() => { const g = window.__THREE_GAME_TEST_HOOKS__.game; g.narcDeepT = 59.5; });
  await page.waitForFunction(() => window.__THREE_GAME_TEST_HOOKS__.game.state === 'result', null, { timeout: 60000 }).catch(() => {});
  const n2 = await ev(() => window.__THREE_GAME_TEST_HOOKS__.game.state);
  check('(34) after ~60 s total below 55 m the diver blacks out (narcosis result)', n2 === 'result', n2);
  await ev(() => document.getElementById('res-ok').click());
  await page.waitForTimeout(800);

  // ---- (12) dex closing (surfacing made it night: back to the morning so the dive can start)
  await ev(() => { const g = window.__THREE_GAME_TEST_HOOKS__.game; g.save.clock = 0; });
  await ev(() => window.__THREE_GAME_TEST_HOOKS__.setState('reef'));
  await page.waitForTimeout(1500);
  const d1 = await ev(() => {
    const g = window.__THREE_GAME_TEST_HOOKS__.game;
    const id = g.creatures.list[0].def.id;
    g.save.found[id] = { photo: '', depth: 3, t: 1, score: 50 };
    const dc = document.getElementById('discover'); dc.dataset.dex = id; dc.classList.remove('hidden'); dc.click();
    const open = { dex: !document.getElementById('dex').classList.contains('hidden'), detail: !document.getElementById('dex-detail').classList.contains('hidden'), state: g.state };
    document.getElementById('dd-close').click();
    return { id, open, after: { dex: !document.getElementById('dex').classList.contains('hidden'), state: g.state, paused: g.paused } };
  });
  check('(12) photo -> dex page -> close returns straight to the dive (not the list)', d1.open.dex && d1.open.detail && d1.open.state === 'dex' && !d1.after.dex && d1.after.state === 'diving' && !d1.after.paused, JSON.stringify(d1));
  const d2 = await ev(() => {
    const g = window.__THREE_GAME_TEST_HOOKS__.game;
    document.getElementById('dex-chip').click();
    document.querySelector('#dex-grid .dcard').click();
    const o = { detail: !document.getElementById('dex-detail').classList.contains('hidden'), state: g.state };
    document.getElementById('dd-close').click();
    const mid = { dex: !document.getElementById('dex').classList.contains('hidden'), detail: !document.getElementById('dex-detail').classList.contains('hidden'), state: g.state };
    document.getElementById('dex-close').click();
    return { o, mid, end: { state: g.state, paused: g.paused } };
  });
  check('(12) opened from the list: closing the page goes back to the list; the list closes to the dive', d2.o.detail && d2.mid.dex && !d2.mid.detail && d2.mid.state === 'dex' && d2.end.state === 'diving', JSON.stringify(d2));

  // ---- pause menu
  await ev(() => document.getElementById('btn-pause').click());
  const pm = await ev(() => { const hid = (id) => document.getElementById(id).classList.contains('hidden'); document.getElementById('pause-settings').click(); const a = { pause: hid('pause'), set: hid('settings') }; document.getElementById('set-close').click(); return { a, b: { pause: hid('pause'), set: hid('settings') } }; });
  check('(1) pause menu -> 設定 -> 閉じる returns to the pause menu', pm.a.pause && !pm.a.set && !pm.b.pause && pm.b.set, JSON.stringify(pm));
  await ev(() => document.getElementById('resume').click());

  // ---- (5) glint, (13) depth readout flicker, (19) grades, (33) board, (25) ending, (21)
  const misc = await ev(() => {
    const g = window.__THREE_GAME_TEST_HOOKS__.game;
    const out = {};
    out.glint = 'glint' in g.chests;
    // (33)
    const k = g.kitchen;
    g.save.boardOn = false; g.save.day = 4; k.say('morning'); out.d4 = !!g.save.boardOn;
    g.save.day = 5; k.say('morning'); out.d5 = !!g.save.boardOn;
    g.save.boardOn = true; g.save.day = 2; k.say('morning'); out.keep = !!g.save.boardOn;
    g.save.boardOn = false; g.save.day = 1;
    // (13)
    g.narcBlur = 0.4; const vals = new Set(); for (let i = 0; i < 6; i++) { g.time += 0.013; g.updateHud(0.016); vals.add(document.getElementById('depth-value').textContent); }
    out.flicker = vals.size; out.depth = g.bodyDepth().toFixed(1); g.narcBlur = 0;
    return out;
  });
  check('(5) the chest glint is gone', misc.glint === false, JSON.stringify(misc));
  check('(33) the board is introduced from day 5 (not 4); an existing boardOn stays', misc.d4 === false && misc.d5 === true && misc.keep === true, JSON.stringify(misc));
  check('(13) narcosis stage 2 flickers the depth readout', misc.flicker >= 2, JSON.stringify(misc));
  const src = html.toString();
  check('(25) ending ends at 「もう立派な海中写真家だ。」', !src.includes('図鑑の空欄、全部埋めてみせて') && src.includes('もう立派な海中写真家だ。」'));
  check('(21) stock notice has no description', !src.includes('が入荷した！（'));
  check('(19) grades S 70 / A 55 / B 40', /g:[`"']S[`"'],min:70,[^}]*\},\{g:[`"']A[`"'],min:55,[^}]*\},\{g:[`"']B[`"'],min:40,/.test(src), '');
  check('no page errors', errors.length === 0, errors.join(' | ').slice(0, 300));

  await browser.close();
  server.close();
  const bad = results.filter((r) => !r.ok);
  console.log(`\n${results.length - bad.length}/${results.length} passed`);
  process.exit(bad.length ? 1 : 0);
})().catch((e) => { console.log('PROBE CRASH', e); process.exit(2); });
