/* Phase 7 verification (UI・図鑑・メニュー・操作性): photo->dex links, menu spoiler,
   diner buff line, two-tap debug buttons, coach position, mission countdown gating,
   shop buyable style, font bumps. Run after `npm run artifact`. */
const http = require('http');
const fs = require('fs');
let chromium;
try { ({ chromium } = require('playwright-core')); } catch { ({ chromium } = require('/tmp/probe-env/node_modules/playwright-core')); }
const EXE = process.env.PROBE_CHROME || '/home/hatch/.cache/ms-playwright/chromium_headless_shell-1148/chrome-linux/headless_shell';
const html = fs.readFileSync(__dirname + '/../dist/artifact.html');
const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); });
const results = [];
const check = (name, ok, extra = '') => { results.push([name, ok]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`); };

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const browser = await chromium.launch({ executablePath: EXE, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => window.__THREE_GAME_TEST_HOOKS__, null, { timeout: 120000 });
  const ev = (fn) => page.evaluate(fn);
  // a fresh profile boots into the prologue, which keeps the game paused;
  // dismiss it so the main loop (and missions) actually run
  await ev(() => document.getElementById('pr-go')?.click());
  await page.waitForTimeout(800);

  await ev(() => {
    const h = window.__THREE_GAME_TEST_HOOKS__;
    const g = h.game;
    h.setState('title');
    // a mid-game save built by hand: 10 species found (fins stocked), little money
    const rec = { photo: 'data:image/png;base64,iVBORw0KGgo=', depth: 5, score: 80, grade: 'A', value: 900, isNew: false };
    for (const id of ['kumanomi', 'okizayori', 'gomamongara', 'monngara', 'moonjelly', 'kuronamako', 'aohitode', 'manjuhitode', 'onihitode', 'nudibranch']) g.save.found[id] = rec;
    g.save.money = 100;
    g.save.tutorial = true;
    g.save.buff = null;
    g.writeSave();
  });

  // ---- menu spoiler: with money short of the next goal, the name stays hidden
  const spoiler = await ev(() => {
    const g = window.__THREE_GAME_TEST_HOOKS__.game;
    const goal = g['nextGoal']();
    g.renderTitle();
    return { name: goal?.name ?? null, text: document.getElementById('t-goal').textContent };
  });
  check('menu: the next goal never names the product', spoiler.name === null || !spoiler.text.includes(spoiler.name), JSON.stringify(spoiler));

  // ---- diner: no makanae explanation without a buff, the status line with one
  const buff = await ev(() => {
    const g = window.__THREE_GAME_TEST_HOOKS__.game;
    g.kitchen.open();
    const empty = document.getElementById('k-buff').textContent.trim();
    g.save.buff = 'nabe';
    g.kitchen.render();
    const withBuff = document.getElementById('k-buff').textContent;
    g.kitchen.close();
    return { empty, withBuff };
  });
  check('diner: the makanae explanation is gone, the active-buff status stays', buff.empty === '' && /次のダイブ/.test(buff.withBuff), JSON.stringify(buff));

  // ---- shop: buyable items are lit, not animated; fonts bumped
  const shop = await ev(() => {
    const g = window.__THREE_GAME_TEST_HOOKS__.game;
    g.save.money = 5000; // enough for the fins, so a .can item exists
    g.writeSave();
    document.getElementById('open-shop').click();
    const can = document.querySelector('.gear-item.can');
    return {
      found: !!can,
      anim: can ? getComputedStyle(can).animationName : null,
      font: can ? getComputedStyle(document.querySelector('.gear-item')).fontSize : null,
      reqFont: can ? getComputedStyle(document.querySelector('.gear-item .req')).fontSize : null,
    };
  });
  check('shop: a buyable item exists and does not blink', shop.found && shop.anim === 'none', JSON.stringify(shop));
  check('shop: item text 12.5px, requirement text 12px', shop.font === '12.5px' && shop.reqFont === '12px', JSON.stringify(shop));
  await ev(() => document.getElementById('shop-close').click());

  // ---- discover card -> dex detail
  // the card lives in #hud, which is hidden on the title: dive first so hit-testing sees it
  await ev(() => window.__THREE_GAME_TEST_HOOKS__.setState('reef'));
  await page.waitForTimeout(600);
  const disc = await ev(() => {
    const g = window.__THREE_GAME_TEST_HOOKS__.game;
    g['showDiscover']('kumanomi', 'data:image/png;base64,iVBORw0KGgo=', false, undefined, 0, undefined, false);
    const el = document.getElementById('discover');
    const has = el.dataset.dex === 'kumanomi' && !el.classList.contains('hidden');
    // hit-test first: a real finger goes through elementFromPoint, not el.click()
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    const hitOk = !!hit && (hit === el || el.contains(hit));
    el.click();
    return { has, hitOk, dexOpen: !document.getElementById('dex').classList.contains('hidden'), detail: !document.getElementById('dex-detail').classList.contains('hidden'), name: document.querySelector('#dex-detail h3')?.textContent };
  });
  check('photo card: tapping the discover card opens that species page', disc.has && disc.hitOk && disc.dexOpen && disc.detail && /クマノミ/.test(disc.name), JSON.stringify(disc));
  await ev(() => window.__THREE_GAME_TEST_HOOKS__.game['closeDex']());

  // ---- result card -> dex detail
  await ev(() => window.__THREE_GAME_TEST_HOOKS__.setState('reef'));
  await page.waitForTimeout(1500);
  const res = await ev(() => {
    const g = window.__THREE_GAME_TEST_HOOKS__.game;
    g.pending.set('kumanomi', { photo: 'data:image/png;base64,iVBORw0KGgo=', depth: 5, score: 80, grade: 'A', value: 900, isNew: false });
    g.endDive('surface');
    const card = document.querySelector('.res-card');
    const has = !!card && card.dataset.dex === 'kumanomi';
    card?.click();
    return { has, detail: !document.getElementById('dex-detail').classList.contains('hidden'), name: document.querySelector('#dex-detail h3')?.textContent };
  });
  check('photo card: tapping a result card opens that species page', res.has && res.detail && /クマノミ/.test(res.name), JSON.stringify(res));
  await ev(() => { const g = window.__THREE_GAME_TEST_HOOKS__.game; g['closeDex'](); g.toTitle(); });

  // ---- coach sits right under the HUD row on a phone, not mid-screen
  await ev(() => window.__THREE_GAME_TEST_HOOKS__.setState('reef'));
  await page.waitForTimeout(600);
  const coach = await ev(() => {
    const g = window.__THREE_GAME_TEST_HOOKS__.game;
    g.tut.step = 0;
    g['showCoach']();
    const el = document.getElementById('coach');
    const r = el.getBoundingClientRect();
    return { top: Math.round(r.top), computed: getComputedStyle(el).top, hidden: el.classList.contains('hidden') };
  });
  check('tutorial: the coach hugs the top (118px), clear of the centre', !coach.hidden && coach.computed === '118px', JSON.stringify(coach));

  // ---- mission countdown only inside the circle
  const mission = await ev(() => {
    const h = window.__THREE_GAME_TEST_HOOKS__;
    const g = h.game;
    // missions.update only runs once the tutorial is over (tut.step < 0)
    g.tut.step = -1;
    h.startMission('urchin');
    // the headless main loop is frame-starved (SwiftShader on a throttled CPU),
    // so step the mission system directly instead of waiting for the game tick
    const step = () => g.missions.update(g['missionCtx']());
    for (let i = 0; i < 6 && !g.missions.active; i++) step();
    const a = g.missions.active;
    const area = a?.area;
    let outside = null, inside = null;
    if (area) {
      g.camera.position.set(area.x + area.r + 60, -3, area.z);
      step(); step();
      outside = document.getElementById('ms-prog').textContent;
      g.camera.position.set(area.x, -3, area.z);
      step(); step();
      inside = document.getElementById('ms-prog').textContent;
    }
    return { active: !!a, hasArea: !!area, kind: a?.kind, outside, inside };
  });
  check('mission: no countdown outside the circle, countdown inside', mission.active && mission.hasArea && mission.outside !== null && !/\u6b8b\u308a\d+\u79d2/.test(mission.outside) && /\u6b8b\u308a\d+\u79d2/.test(mission.inside ?? ''), JSON.stringify(mission));

  // ---- debug buttons: arm on first tap even where confirm() is unavailable
  const arm = await ev(() => {
    window.confirm = () => { throw new Error('blocked'); };
    const b = document.getElementById('reset-save');
    b.click();
    return { label: b.textContent, stillThere: !!localStorage.getItem('blue-depths-save-v1') };
  });
  check('debug: first tap arms the reset button (no confirm dialog)', /本当にリセットする/.test(arm.label) && arm.stillThere, JSON.stringify(arm));

  // ---- unlock-all: two taps apply everything (page reloads)
  await ev(() => { document.getElementById('unlock-all').click(); document.getElementById('unlock-all').click(); });
  await page.waitForFunction(() => window.__THREE_GAME_TEST_HOOKS__, null, { timeout: 120000 });
  await page.waitForTimeout(1500);
  const unlocked = await ev(() => {
    const sv = JSON.parse(localStorage.getItem('blue-depths-save-v1'));
    return { owned: sv.owned?.length ?? 0, money: sv.money, tutorial: sv.tutorial };
  });
  check('debug: two taps on unlock-all unlock everything', unlocked.owned >= 12 && unlocked.money >= 999999 && unlocked.tutorial === true, JSON.stringify(unlocked));

  check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  const failed = results.filter(([, ok]) => !ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  await browser.close();
  server.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('PROBE ERROR', e); process.exit(2); });
