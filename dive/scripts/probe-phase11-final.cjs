/**
 * Phase 11 (final pass) probe: the checklist items of 進行・ストーリー / 経済・装備・依頼 / 図鑑・UI・システム that no earlier probe
 * covers (Phases 1–3 had no probe of their own). Fresh profile -> prologue -> tutorial coach layout, tutorial 3 not instant,
 * order of the tutorial, the landlady's staged talk, night after surfacing / sleep / light button, chapter rewards and tips,
 * the notice board (cancel keeps the request, clear -> one more), shop gating by species count, bar-only air, signal float
 * gating, "unlock all" / "reset" buttons.
 * Usage: node scripts/probe-phase11-final.cjs [dist/artifact.html]   (PROBE_CHROME=<chromium binary>)
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
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => window.__THREE_GAME_TEST_HOOKS__, null, { timeout: 120000 });
  const ev = (fn, arg) => page.evaluate(fn, arg);

  // ---- 1. a brand-new game starts under water in the shallow lagoon, behind the opening story
  await page.waitForFunction(() => window.__THREE_GAME_TEST_HOOKS__.game.state === 'diving', null, { timeout: 240000, polling: 500 });
  const start = await ev(() => {
    const h = window.__THREE_GAME_TEST_HOOKS__; const g = h.game; const p = g.camera.position;
    return { state: g.state, zone: h.zoneAt(p.x, p.z), y: p.y, prologue: !document.getElementById('prologue').classList.contains('hidden'), prText: document.getElementById('pr-text').textContent.slice(0, 30), title: document.getElementById('title').classList.contains('hidden') };
  });
  check('start: a new game begins diving in the shallow lagoon (no boat screen first)', start.state === 'diving' && start.zone === 'lagoon' && start.y < 0 && start.title, JSON.stringify(start));
  check('start: the opening story (hobby diver scouted by the editor) sits over the first view', start.prologue && start.prText.includes('趣味'), start.prText);
  await ev(() => document.getElementById('pr-go')?.click());
  await page.waitForTimeout(500);
  await ev(() => { window.__THREE_GAME_TEST_HOOKS__.game.paused = true; });

  // ---- 2. tutorial coach: every step fits on screen, off the centre, in several viewports
  const sizes = [[390, 844], [360, 640], [412, 915], [844, 390], [1280, 720]];
  const bad = [];
  let nSteps = 0;
  for (const [w, hgt] of sizes) {
    await page.setViewportSize({ width: w, height: hgt });
    await page.waitForTimeout(150);
    const r = await ev(({ w, hgt }) => {
      const g = window.__THREE_GAME_TEST_HOOKS__.game;
      const out = { n: 0, bad: [] };
      const coach = document.getElementById('coach');
      const txt = document.getElementById('coach-text');
      for (let i = 0; i < 8; i++) {
        g.tut.step = i; g.tut.praise = 0;
        txt.textContent = '';
        g.showCoach();
        out.n++;
        const rc = coach.getBoundingClientRect();
        const inside = rc.left >= -0.5 && rc.right <= w + 0.5 && rc.top >= -0.5 && rc.bottom <= hgt + 0.5;
        const clipped = txt.scrollHeight > txt.clientHeight + 1 || coach.scrollHeight > coach.clientHeight + 1 || txt.scrollWidth > txt.clientWidth + 1;
        const covers = rc.left < w / 2 && rc.right > w / 2 && rc.top < hgt / 2 && rc.bottom > hgt / 2;
        if (!inside || clipped || covers) out.bad.push({ i, inside, clipped, covers, rect: [Math.round(rc.left), Math.round(rc.top), Math.round(rc.right), Math.round(rc.bottom)] });
      }
      return out;
    }, { w, hgt });
    nSteps += r.n;
    for (const b of r.bad) bad.push({ vp: `${w}x${hgt}`, ...b });
  }
  check('tutorial: all 8 steps in 5 viewports stay on screen, unclipped, and off the screen centre', bad.length === 0 && nSteps === 40, bad.length ? JSON.stringify(bad.slice(0, 4)) : `${nSteps} cases`);
  await page.setViewportSize({ width: 390, height: 844 });

  // ---- 3. tutorial order: photos are money (4, 5) before the air (6); step 3 cannot clear in an instant
  const order = await ev(() => {
    const g = window.__THREE_GAME_TEST_HOOKS__.game; const txt = document.getElementById('coach-text'); const t = [];
    for (let i = 0; i < 8; i++) { g.tut.step = i; g.tut.praise = 0; txt.textContent = ''; g.showCoach(); t.push(txt.textContent); }
    return t;
  });
  const iMoney = order.findIndex((t) => t.includes('買い取'));
  const iAir = order.findIndex((t) => t.includes('エア'));
  const iRepeat = order.findIndex((t) => t.includes('2枚目'));
  check('tutorial: "photos are bought" and the second-photo rule come before the air', iMoney >= 0 && iRepeat > iMoney && iAir > iRepeat, `money@${iMoney + 1} repeat@${iRepeat + 1} air@${iAir + 1}`);
  check('tutorial: the second-photo text is complete ("…潜り直す必要がある")', order[iRepeat].endsWith('潜り直す必要がある'), order[iRepeat].slice(-24));
  const t3 = await ev(() => {
    const h = window.__THREE_GAME_TEST_HOOKS__; const g = h.game; const T = g.tut;
    const p = g.camera.position; const out = {};
    // floor right under the diver (the case that used to clear instantly): alt < 1.2 with no ▼ held
    p.set(p.x, h.heightAt(p.x, p.z) + 0.5, p.z);
    g.tut.step = 2; T.praise = 0; T.t = 0; T.down = 0; T.depth0 = -p.y; g.paused = false;
    for (let k = 0; k < 30; k++) g.updateTutorial(0.1);
    out.noButton = T.step === 2 && T.praise <= 0;
    T.down = 0.7; g.updateTutorial(0.1);
    out.withButton = T.praise > 0;
    g.paused = true; T.praise = 0;
    return out;
  });
  check('tutorial 3: does not clear without pressing ▼ (even with the floor right below), clears after ▼ is held', t3.noButton && t3.withButton, JSON.stringify(t3));

  // ---- 4. after the tutorial: surfacing makes it night; the editor praises and gives a paid job; the landlady's talk
  const after = await ev(() => {
    const h = window.__THREE_GAME_TEST_HOOKS__; const g = h.game;
    g.tut.step = -1; g.save.tutorial = true;
    g.paused = false; g.endDive('surface'); g.paused = true;
    const clockAfter = g.save.clock;
    const resultShown = !document.getElementById('result').classList.contains('hidden');
    g.toTitle();
    return { clockAfter, resultShown, state: g.state };
  });
  check('surfacing forces night (clock jumps to dusk end)', after.clockAfter >= 1 && after.resultShown, JSON.stringify(after));
  const story = await ev(() => {
    const g = window.__THREE_GAME_TEST_HOOKS__.game;
    g.save.storyMain = 0; g.save.storyRead = 0; g.save.storyClaim = [];
    g.renderStory();
    const first = document.getElementById('story-card').textContent;
    // the first chapter's job is "dive once": it is done now
    g.save.dives = Math.max(g.save.dives, 1);
    g.checkStory?.();
    return { first, dives: g.save.dives, claim: g.save.storyClaim, main: g.save.storyMain };
  });
  check('story: chapter 1 is a paid job from the editor (the first card names a goal)', story.first.includes('目標') && story.first.includes('試し撮り'), story.first.slice(0, 80));
  const praise = await ev(() => {
    const g = window.__THREE_GAME_TEST_HOOKS__.game;
    g.save.storyMain = 0; g.save.storyRead = 0; g.save.storyClaim = []; g.save.dives = 1; g.save.money = 0;
    const fn = g.advanceStory ?? g.checkChapters ?? g.updateStory;
    return { has: typeof fn, keys: Object.getOwnPropertyNames(Object.getPrototypeOf(g)).filter((k) => /story|chapter|claim/i.test(k)) };
  });
  console.log('  (story methods)', JSON.stringify(praise));

  // ---- 5. the landlady tells the island's story a little at a time, board and hints included
  const lore = await ev(() => {
    const g = window.__THREE_GAME_TEST_HOOKS__.game; const k = g.kitchen;
    g.save.okami = { lore: 0 }; g.save.boardOn = false; g.save.day = 1; g.save.clock = 0;
    const said = [];
    const talk = (found, chapter, ev) => { g.kitchen.host.progress = () => ({ found, chapter, spear: false }); k.say(ev); said.push(k.line); };
    talk(0, 0, 'back');   // 1st visit: greeting + who she is
    talk(0, 0, 'back');   // 2nd: the island gathers the world's fish
    talk(0, 0, 'back');   // 3rd: nothing new is due yet
    talk(10, 0, 'back');  // cold sea
    talk(15, 0, 'back');  // gear hint (suit)
    talk(15, 3, 'back');  // sunken town
    const boardBefore = g.save.boardOn;
    k.say('morning');
    const boardAfter = g.save.boardOn;
    return { said, boardBefore, boardAfter, morning: k.line };
  });
  const s = lore.said;
  check('landlady: one piece per visit, in order (self-intro → island → cold sea → gear hint → sunken town), none all at once',
    s[0].includes('女将') && s[1].includes('世界中の魚') && !s[2].includes('寒い海') && s[3].includes('寒い海') && s[4].includes('気づかれにくい') && s[5].includes('昔の町'), s.map((t) => t.slice(0, 12)).join(' | '));
  check('landlady: the gear hint does not promise gear ("will be sold later" is never said)', !/売る|売って|入荷|あとで買え/.test(s[4]), s[4].slice(0, 60));
  check('landlady: the notice board is introduced on the first morning', !lore.boardBefore && lore.boardAfter && lore.morning.includes('掲示板'), lore.morning.slice(0, 80));

  // ---- 6. sleeping makes morning; the light unlocks the "go out at night" button, which swaps with the time
  const time = await ev(() => {
    const g = window.__THREE_GAME_TEST_HOOKS__.game; const k = g.kitchen; const btn = document.getElementById('k-sleep');
    const out = {};
    g.save.owned = (g.save.owned ?? []).filter((x) => x !== 'torch');
    g.save.clock = 1.2 * 1000; // night
    g.save.clock = 2000;
    out.nightIsNight = g.save.clock > 0;
    k.open(); out.nightBtn = btn.textContent; out.nightHidden = btn.classList.contains('hidden'); k.close();
    const day0 = g.save.day ?? 1;
    k.open(); k.sleep(); out.afterSleep = { day: g.save.day, was: day0, clock: g.save.clock }; k.close();
    // by day without a light the button is hidden; with a light it offers the night
    out.dayNoLightHidden = (() => { k.open(); const h = btn.classList.contains('hidden'); k.close(); return h; })();
    g.save.owned = [...(g.save.owned ?? []), 'torch'];
    k.open(); out.dayLightBtn = btn.textContent; out.dayLightHidden = btn.classList.contains('hidden');
    btn.click(); out.afterGoOut = g.save.clock; out.nightLabel = btn.textContent; k.close();
    return out;
  });
  check('time: at night the button says 朝にする; sleeping starts the next morning (day+1, clock 0)', time.nightBtn.includes('朝にする') && time.afterSleep.day === time.afterSleep.was + 1 && time.afterSleep.clock === 0, JSON.stringify(time.afterSleep));
  check('time: by day the button is hidden without a light and says 夜にする with one', time.dayNoLightHidden && time.dayLightBtn.includes('夜にする') && !time.dayLightHidden, time.dayLightBtn.slice(0, 20));
  check('time: pressing it by day makes night, and the same button then says 朝にする', time.afterGoOut > 0 && time.nightLabel.includes('朝にする'), `clock=${time.afterGoOut} label=${time.nightLabel.slice(0, 12)}`);

  // ---- 7. economy / gear
  const eco = await ev(() => {
    const h = window.__THREE_GAME_TEST_HOOKS__; const g = h.game; const out = {};
    // air: bar only (no time text anywhere in the air readout)
    const air = document.getElementById('air');
    out.airText = air.textContent.trim();
    out.airHasTime = /分|秒|min|sec/.test(air.textContent);
    out.airMax = g.airMax;
    // signal float gating: no surfacing from anywhere without it; the pause menu never offers it
    g.save.owned = (g.save.owned ?? []).filter((x) => x !== 'float');
    out.floatOff = g.surfaceAnywhere();
    g.save.owned = [...g.save.owned, 'float'];
    out.floatOn = g.surfaceAnywhere();
    g.save.owned = g.save.owned.filter((x) => x !== 'float');
    return out;
  });
  check('air: the readout is the ring and the bar number only (no remaining-time text)', !eco.airHasTime && /^\d+bar/.test(eco.airText.replace(/\s/g, '')), JSON.stringify({ t: eco.airText, max: eco.airMax }));
  check('surface anywhere: only after buying the signal float', eco.floatOff === false && eco.floatOn === true, JSON.stringify(eco));
  const shop = await ev(() => {
    const g = window.__THREE_GAME_TEST_HOOKS__.game; const out = {};
    g.save.stocked = []; g.save.owned = []; g.save.money = 999999;
    const mk = (n) => { for (const k of Object.keys(g.save.found)) delete g.save.found[k]; for (let i = 0; i < n; i++) g.save.found['probe_sp' + i] = { photo: '', depth: 0, t: 0 }; };
    const stockedAt = (id, n) => { mk(n); g.renderShop(); const el = document.querySelector(`[data-buy="${id}"]`); return !!el && !el.classList.contains('locked'); };
    out.torch44 = stockedAt('torch', 44); out.torch45 = stockedAt('torch', 45);
    out.spear59 = stockedAt('spear', 59); out.spear60 = stockedAt('spear', 60);
    out.float29 = stockedAt('float', 29); out.float30 = stockedAt('float', 30);
    // locked items do not name themselves
    mk(5); g.renderShop();
    const locked = [...document.querySelectorAll('#gear .gear-item.locked')];
    out.lockedN = locked.length;
    out.lockedNames = locked.filter((el) => /ライト|銛|スクーター|ソナー|魚群|ワイド|マクロ|リブリーザー|シールド|大気圧|海図/.test(el.textContent)).length;
    out.hasPctText = /%|％/.test(document.getElementById('gear').textContent);
    // buyable items are bright (class can), not blinking
    mk(45); g.save.money = 99999; g.renderShop();
    const can = document.querySelector('.gear-item.can');
    out.canAnim = can ? getComputedStyle(can).animationName : 'none-found';
    out.canFound = !!can;
    return out;
  });
  check('shop: unlock is by species count (torch 45, spear 60, float 30), not a share', !shop.torch44 && shop.torch45 && !shop.spear59 && shop.spear60 && !shop.float29 && shop.float30 && !shop.hasPctText, JSON.stringify(shop));
  check('shop: locked items are shown as ？？？ (no names)', shop.lockedN > 0 && shop.lockedNames === 0, `locked=${shop.lockedN} named=${shop.lockedNames}`);
  check('shop: buyable items are bright and do not blink (no animation)', shop.canFound && (shop.canAnim === 'none' || shop.canAnim === ''), shop.canAnim);

  // ---- 8. editor's chapters pay; S tips; the board: cancel keeps the request, clear -> one more
  const ed = await ev(() => {
    const g = window.__THREE_GAME_TEST_HOOKS__.game; const out = {};
    g.save.storyMain = 2; g.save.storyRead = 1; g.save.storyClaim = [];
    g.renderStory();
    out.ch3 = document.getElementById('story-card').textContent;
    out.ch3tips = document.getElementById('story-card').innerHTML.includes('コツ') || document.getElementById('story-card').textContent.includes('コツ');
    g.save.storyMain = 1; g.save.storyClaim = [1]; g.save.storyRead = 1; g.save.money = 0;
    g.renderStory();
    const claim = document.querySelector('[data-claim]');
    out.claimBtn = claim ? claim.textContent : null;
    if (claim) claim.click();
    out.moneyAfter = g.save.money;
    return out;
  });
  check('editor: a chapter\'s reward is paid by a claim button (money rises)', ed.claimBtn && ed.moneyAfter > 0, `${ed.claimBtn} → ¥${ed.moneyAfter}`);
  check('editor: the S-rank chapter card teaches how to get an S (コツ)', ed.ch3tips, '');

  const bd = await ev(() => {
    const g = window.__THREE_GAME_TEST_HOOKS__.game; const out = {};
    g.save.boardOn = true; g.save.boardIntro = true; g.save.board = []; g.save.quests = [];
    document.getElementById('quests').classList.remove('hidden');
    g.renderQuests();
    out.board0 = g.save.board.length; out.held0 = g.save.quests.length;
    document.querySelector('[data-take]')?.click();
    out.afterTake = { board: g.save.board.length, held: g.save.quests.length };
    const heldId = g.save.quests[0]?.id; const heldTitle = g.save.quests[0]?.title;
    document.querySelector('[data-drop]')?.click();
    out.afterDrop = { board: g.save.board.length, held: g.save.quests.length, backFirst: g.save.board[0]?.id === heldId, same: g.save.board[0]?.title === heldTitle };
    document.querySelector('[data-take]')?.click();
    const id = g.save.quests[0]?.id;
    g.completeQuest(id, 'probe');
    out.afterClear = { board: g.save.board.length, held: g.save.quests.length, fresh: g.save.board.some((q) => q.fresh) };
    return out;
  });
  check('board: 3 slots at the start (board+held)', bd.board0 + bd.held0 === 3 || bd.board0 >= 3, JSON.stringify({ b: bd.board0, h: bd.held0 }));
  check('board: dropping a taken request puts the same request back at the top (it never vanishes)', bd.afterDrop.board === bd.afterTake.board + 1 && bd.afterDrop.backFirst && bd.afterDrop.same, JSON.stringify(bd.afterDrop));
  check('board: clearing one request puts up exactly one new one (board+held stays full, marked NEW)', bd.afterClear.board + bd.afterClear.held === bd.board0 + bd.held0 && bd.afterClear.fresh, JSON.stringify(bd.afterClear));

  // ---- 9. debug buttons: two-tap unlock-all and reset both work
  const dbg = await ev(() => {
    const out = {};
    const tap = (id) => { const b = document.getElementById(id); b.click(); const armed = b.textContent; return armed; };
    out.unlockArmed = tap('unlock-all');
    return out;
  });
  check('debug: first tap on 全部解禁 arms the button (confirm text on the button itself)', dbg.unlockArmed.includes('本当に'), dbg.unlockArmed);
  await ev(() => { const g = window.__THREE_GAME_TEST_HOOKS__.game; g.save.owned = []; g.save.discovered = []; g.writeSave(); });
  await Promise.all([page.waitForNavigation({ timeout: 60000 }).catch(() => null), ev(() => document.getElementById('unlock-all').click())]);
  await page.waitForFunction(() => window.__THREE_GAME_TEST_HOOKS__, null, { timeout: 120000 });
  const unlocked = await ev(() => {
    const h = window.__THREE_GAME_TEST_HOOKS__; const g = h.game; const sv = JSON.parse(localStorage.getItem('blue-depths-save-v1') || '{}');
    return { owned: (sv.owned || []).length, hasAds: (sv.owned || []).includes('ads'), disc: (sv.discovered || []).length, hasRiver: (sv.discovered || []).includes('river'), hasEst: (sv.discovered || []).includes('estuary'), money: sv.money, story: sv.storyMain, state: g.state };
  });
  check('debug: 全部解禁 gives every gear item, every dive point (estuary and river too) and the whole story', unlocked.owned > 20 && unlocked.hasAds && unlocked.hasRiver && unlocked.hasEst && unlocked.money >= 999999 && unlocked.story >= 7, JSON.stringify(unlocked));
  await ev(() => document.getElementById('pr-go')?.click());
  await ev(() => { document.getElementById('reset-save').click(); });
  const armed = await ev(() => document.getElementById('reset-save').textContent);
  check('debug: first tap on リセット arms it (confirm text)', armed.includes('本当に'), armed);
  await Promise.all([page.waitForNavigation({ timeout: 60000 }).catch(() => null), ev(() => document.getElementById('reset-save').click())]);
  await page.waitForFunction(() => window.__THREE_GAME_TEST_HOOKS__, null, { timeout: 120000 });
  const reset = await ev(() => {
    const raw = localStorage.getItem('blue-depths-save-v1');
    const sv = raw ? JSON.parse(raw) : {};
    return { owned: (sv.owned || []).length, money: sv.money ?? 0, dives: sv.dives ?? 0, found: Object.keys(sv.found || {}).length };
  });
  check('debug: リセット returns to a fresh game (nothing owned, no money, no dives, no dex)', reset.owned === 0 && (reset.money ?? 0) <= 0 && reset.dives === 0 && reset.found === 0, JSON.stringify(reset));

  // ---- 10. map edges: held at every wall with a "cannot go further" toast (the cold warning is kept quiet so it cannot hide it); the album shows only discovered maps
  await ev(() => document.getElementById('pr-go')?.click());
  await page.waitForTimeout(600);
  const edges = await ev(() => {
    const h = window.__THREE_GAME_TEST_HOOKS__; const g = h.game; g.paused = false; const out = {};
    const run = (name, x, z, vx, vz) => {
      h.teleport(x, -5, z); g.vel.set(vx, 0, vz); g.lastEdgeWarn = -99; g.coldWarned = g.time + 1e6; document.getElementById('toast').textContent = '';
      for (let i = 0; i < 8; i++) g.updateDiver(0.05);
      out[name] = { x: +g.camera.position.x.toFixed(1), z: +g.camera.position.z.toFixed(1), toast: document.getElementById('toast').textContent };
    };
    run('west', -429.5, 300, -3, 0); run('east', 429.5, 300, 3, 0); run('north', 0, 1079, 0, 3);
    g.paused = true;
    return out;
  });
  check('edges: west / east / north walls hold the diver and say "これ以上は進めない"', edges.west.x >= -430 && edges.east.x <= 430 && edges.north.z <= 1080 && Object.values(edges).every((e) => /進めない/.test(e.toast)), JSON.stringify(edges));
  const album = await ev(() => {
    const g = window.__THREE_GAME_TEST_HOOKS__.game; g.renderAlbum();
    const body = document.getElementById('album-body');
    return { rows: body.querySelectorAll('.al-spot').length, hasQ: body.innerText.includes('/ ？'), leaks: body.innerText.includes('未発見のマップ') };
  });
  check('album (fresh game): only the discovered map has a row and the totals are hidden (/ ？)', album.rows === 1 && album.hasQ && !album.leaks, JSON.stringify(album));

  // ---- 11. repel rules fixed in the final pass: no repel while a territorial animal is still posturing; the window is the tool's repelReach
  const rp = await ev(() => {
    const g = window.__THREE_GAME_TEST_HOOKS__.game;
    const mk = (kind, mode, modeT, aggro = true) => ({ rt: { def: { aggro: { kind } } }, agent: { aggro, mode, modeT } });
    return { posturing: g.repelling(mk('territory', 2, 1.0)), charging: g.repelling(mk('territory', 2, 0)), shark: g.repelling(mk('shark', 2, 0)), circling: g.repelling(mk('shark', 1, 3)), calm: g.repelling(mk('shark', 2, 0, false)) };
  });
  check('repel: not while a territorial animal is still posturing; yes once charging (shark too); not when circling or calm', !rp.posturing && rp.charging && rp.shark && !rp.circling && !rp.calm, JSON.stringify(rp));

  // ---- 12. every map has at least 10 fish of its own (Phase 5 §6.1 counting: fish / ray / garden eel, >= 80% of the group homes inside the map's own zone; dropoff + offshore are one map)
  const uniq = await ev(() => {
    const h = window.__THREE_GAME_TEST_HOOKS__; const g = h.game;
    const FISH = new Set(['fish', 'ray', 'gardenEel']);
    const mapOf = (z) => (z === 'offshore' ? 'dropoff' : z);
    const per = {}; const dup = {};
    for (const rt of g.creatures.list) {
      const d = rt.def;
      (dup[d.name] ??= []).push(d.id);
      if (!FISH.has(d.kind) || !rt.groups.length) continue;
      const own = mapOf(d.zone);
      const inside = rt.groups.filter((gr) => mapOf(h.zoneAt(gr.home.x, gr.home.z)) === own).length / rt.groups.length;
      if (inside >= 0.8) per[own] = (per[own] ?? 0) + 1;
    }
    return { per, total: g.creatures.list.length };
  });
  const low = Object.entries(uniq.per).filter(([, n]) => n < 10);
  console.log('  (own fish per map)', JSON.stringify(uniq.per));
  check('every map that has species has >= 10 species-own fish (80% rule)', Object.keys(uniq.per).length >= 12 && low.length === 0, JSON.stringify(uniq.per));

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' / '));
  const pass = results.filter((r) => r.ok).length;
  console.log(`\n${pass}/${results.length} checks passed`);
  await browser.close();
  server.close();
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => { console.error('probe crashed', e); process.exit(2); });
