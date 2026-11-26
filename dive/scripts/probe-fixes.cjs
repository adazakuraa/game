/* Fix batch 1 verification (dive/docs/FIX-BATCH-1.md). Run after `npm run artifact`:
     node scripts/probe-fixes.cjs
   Headless notes (RESUME.md, Phase 7): the main loop barely advances, so functions are stepped directly;
   setState only starts a dive from 'title'; a fresh profile boots into the prologue (dismiss it first). */
const http = require('http');
const fs = require('fs');
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node-tools/node_modules/playwright')); }
const html = fs.readFileSync(__dirname + '/../dist/artifact.html');
const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); });
const results = [];
const check = (name, ok, extra = '') => { results.push([name, ok]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`); };

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio', '--no-sandbox'] });
  const errors = [];
  async function boot() {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(url);
    await page.waitForFunction(() => window.__THREE_GAME_TEST_HOOKS__, null, { timeout: 120000 });
    return page;
  }
  async function reload(page) {
    await page.reload();
    await page.waitForFunction(() => window.__THREE_GAME_TEST_HOOKS__, null, { timeout: 120000 });
  }
  const dismiss = async (page) => { await page.evaluate(() => document.getElementById('pr-go')?.click()); await page.waitForTimeout(800); };

  // ================= P1-1: surfacing during the tutorial dive leaves a way into the diner at night
  {
    const page = await boot();
    await dismiss(page);
    const r = await page.evaluate(() => {
      const g = window.__THREE_GAME_TEST_HOOKS__.game;
      const tutBefore = g.save.tutorial;
      const stepBefore = g.tut.step;
      g.endDive('surface');
      g.toTitle();
      const inn = document.querySelector('#daytime [data-inn]');
      const kBtn = document.getElementById('open-kitchen');
      inn?.click();
      const kitchenOpen = !document.getElementById('kitchen').classList.contains('hidden');
      return { tutBefore: !!tutBefore, stepBefore, tutAfter: !!g.save.tutorial, clock: g.save.clock, night: document.getElementById('daytime').textContent.includes('夜'), hasInn: !!inn, kitchenBtnHidden: kBtn.classList.contains('hidden'), kitchenOpen };
    });
    check('P1-1: tutorial dive -> surface -> night boat screen has a way into the diner, and the diner opens', r.hasInn && r.kitchenOpen && !r.kitchenBtnHidden, JSON.stringify(r));
    // the blackout path goes through the same endDive(); verify on a fresh profile too
    const page2 = await boot();
    await dismiss(page2);
    const r2 = await page2.evaluate(() => {
      const g = window.__THREE_GAME_TEST_HOOKS__.game;
      g.air = 0;
      g.endDive('blackout');
      g.toTitle();
      return { hasInn: !!document.querySelector('#daytime [data-inn]'), tut: !!g.save.tutorial };
    });
    check('P1-1: blackout path (same endDive) also leaves the route', r2.hasInn && r2.tut, JSON.stringify(r2));
    await page.context().close(); await page2.context().close();
  }

  // ================= P1-2: boardOn migration only for saves without the p1 mark
  {
    const page = await boot();
    await dismiss(page);
    await page.evaluate(() => { // an old save: dives > 0, no p1, boardOn never set
      const g = window.__THREE_GAME_TEST_HOOKS__.game;
      g.save.dives = 1; delete g.save.p1; delete g.save.boardOn; delete g.save.okami;
      g.writeSave();
    });
    await reload(page);
    const old = await page.evaluate(() => { const s = window.__THREE_GAME_TEST_HOOKS__.game.save; return { boardOn: s.boardOn, p1: s.p1 }; });
    check('P1-2: old save (no p1, dives>0, boardOn unset) -> boardOn is set on load', old.boardOn === true && old.p1 === 1, JSON.stringify(old));
    await page.context().close();

    const p2 = await boot();
    await dismiss(p2);
    const marked = await p2.evaluate(() => { // a new profile: one dive, then written
      const g = window.__THREE_GAME_TEST_HOOKS__.game;
      const p1 = g.save.p1;
      g.endDive('surface'); g.toTitle();
      return { p1, dives: g.save.dives, boardOn: g.save.boardOn };
    });
    await reload(p2);
    const fresh = await p2.evaluate(() => { const s = window.__THREE_GAME_TEST_HOOKS__.game.save; return { boardOn: s.boardOn, p1: s.p1, dives: s.dives }; });
    check('P1-2: new profile (p1 mark) -> 1 dive + reload does NOT set boardOn', !fresh.boardOn && fresh.p1 === 1 && fresh.dives >= 1, JSON.stringify({ marked, fresh }));
    await p2.context().close();
  }

  // ================= P2-1: chapter 4 light wording follows the stock state
  {
    const page = await boot();
    await dismiss(page);
    const r = await page.evaluate(() => {
      const g = window.__THREE_GAME_TEST_HOOKS__.game;
      const ids = g.creatures.list.map((rt) => rt.def.id);
      const mk = (n) => { const f = {}; ids.slice(0, n).forEach((id) => { f[id] = { photo: '', depth: 3, score: 50, t: 0 }; }); return f; };
      const read = () => { g.save.storyMain = 3; g.renderStory(); const c = document.querySelector('#story-card .sc-wait'); return c ? c.textContent : ''; };
      g.save.owned = [];
      g.save.found = mk(10); const notStocked = read();
      g.save.found = mk(60); const stockedNotOwned = read();
      g.save.owned = ['torch']; const owned = read();
      return { notStocked, stockedNotOwned, owned };
    });
    check('P2-1: not stocked -> "図鑑を増やすと入荷する"', /入荷する/.test(r.notStocked), r.notStocked);
    check('P2-1: stocked but not owned -> no "入荷する"; says it can be bought', r.stockedNotOwned !== '' && !/入荷する/.test(r.stockedNotOwned) && /買える/.test(r.stockedNotOwned), r.stockedNotOwned);
    check('P2-1: owned -> no waiting note', r.owned === '', r.owned);
    await page.context().close();
  }

  // ================= P2-3: stock notice is "announced"-based (existing players with 30+ species), once
  {
    const page = await boot();
    await dismiss(page);
    await page.evaluate(() => {
      const g = window.__THREE_GAME_TEST_HOOKS__.game;
      const ids = g.creatures.list.map((rt) => rt.def.id);
      const f = {}; ids.slice(0, 35).forEach((id) => { f[id] = { photo: '', depth: 3, score: 50, t: 0 }; });
      g.save.found = f; g.save.dives = 3; g.save.tutorial = true; g.save.owned = []; g.save.boardOn = true; g.save.okami = { lore: 1 };
      delete g.save.announced; g.writeSave();
    });
    await reload(page);
    const first = await page.evaluate(() => {
      const g = window.__THREE_GAME_TEST_HOOKS__.game;
      const out = { state: g.state, announcedAtBoot: [...(g.save.announced ?? [])] };
      document.getElementById('toast').className = ''; document.getElementById('toast').textContent = '';
      g.save.announced = []; // forget the boot notice to observe the toast itself
      g.toTitle();
      out.toast = document.getElementById('toast').textContent;
      out.announced = [...g.save.announced];
      document.getElementById('toast').className = ''; document.getElementById('toast').textContent = '';
      g.renderTitle();
      out.again = document.getElementById('toast').textContent;
      return out;
    });
    check('P2-3: a 35-species player is told the float is in stock (once)', /入荷/.test(first.toast) && first.announced.includes('float') && !/入荷/.test(first.again), JSON.stringify(first));
    await reload(page);
    const second = await page.evaluate(() => { const g = window.__THREE_GAME_TEST_HOOKS__.game; return { announced: g.save.announced, toast: document.getElementById('toast').textContent }; });
    check('P2-3: reload does not announce again (announced persisted)', second.announced?.includes('float') && !/入荷/.test(second.toast), JSON.stringify(second));
    await page.context().close();
  }

  // ================= P3-1: new-map banner is cleared on endDive and on startDive
  {
    const page = await boot();
    await dismiss(page);
    const a = await page.evaluate(() => {
      const g = window.__THREE_GAME_TEST_HOOKS__.game;
      g.mapFoundQ.push({ name: 'テスト', sub: 'a' }, { name: 'キュー', sub: 'b' });
      g.updateMapFound(0.1);
      const shown = !document.getElementById('map-found').classList.contains('hidden');
      const q = g.mapFoundQ.length;
      g.endDive('surface');
      return { shown, qBefore: q, hiddenAfter: document.getElementById('map-found').classList.contains('hidden'), qAfter: g.mapFoundQ.length, t: g.mapFoundT };
    });
    check('P3-1: banner shown, then endDive hides it and empties the queue', a.shown && a.qBefore === 1 && a.hiddenAfter && a.qAfter === 0 && a.t === 0, JSON.stringify(a));
    await page.evaluate(() => {
      const g = window.__THREE_GAME_TEST_HOOKS__.game;
      g.toTitle();
      g.save.clock = 480; // morning: endDive left it night, and a night dive without a light is refused
      g.mapFoundQ.push({ name: 'テスト2', sub: 'a' }, { name: 'キュー2', sub: 'b' });
      g.updateMapFound(0.1);
    });
    await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.setState('reef'));
    await page.waitForTimeout(500);
    const b = await page.evaluate(() => { const g = window.__THREE_GAME_TEST_HOOKS__.game; return { state: g.state, hidden: document.getElementById('map-found').classList.contains('hidden'), q: g.mapFoundQ.length }; });
    check('P3-1: startDive also hides the banner and empties the queue', b.state === 'diving' && b.hidden && b.q === 0, JSON.stringify(b));

    // ---- P1-4 (same page: a dive is running): coach vs toast on a 390px-wide screen
    const measure = async (override) => page.evaluate((override) => {
      const g = window.__THREE_GAME_TEST_HOOKS__.game;
      let st = document.getElementById('__ovr');
      if (!st) { st = document.createElement('style'); st.id = '__ovr'; document.head.appendChild(st); }
      st.textContent = override ? '#app:has(#coach:not(.hidden)) #toast{top:calc(122px + var(--safe-t)) !important}' : '';
      let worst = null;
      for (let step = 0; step < 6; step++) {
        g.tut.step = step; g.tut.praise = 0;
        g.showCoach();
        g.toast('あと少し！ もっと近づいて大きく写そう（長めの警告文でも二行になる）', 'warn', 9);
        const c = document.getElementById('coach').getBoundingClientRect();
        const t = document.getElementById('toast').getBoundingClientRect();
        const hidden = document.getElementById('coach').classList.contains('hidden');
        if (hidden) continue;
        const overlap = Math.min(c.bottom, t.bottom) - Math.max(c.top, t.top);
        const hOver = Math.min(c.right, t.right) - Math.max(c.left, t.left);
        const o = overlap > 0 && hOver > 0 ? overlap : 0;
        if (!worst || o > worst.o) worst = { step, o: Math.round(o), coachBottom: Math.round(c.bottom), toastTop: Math.round(t.top) };
      }
      g.tut.step = -1; document.getElementById('coach').classList.add('hidden');
      return worst;
    }, override);
    const before = await measure(true);
    const after = await measure(false);
    console.log('INFO  P1-4 old toast position (rule disabled):', JSON.stringify(before), ' current:', JSON.stringify(after));
    check('P1-4: coach and toast rectangles do not overlap (390px)', after && after.o === 0, `old-position overlap=${before?.o}px (reproduced: ${before && before.o > 0}), now=${after?.o}px`);
    await page.context().close();
  }

  // ================= P3-4: result screen announces every chapter cleared on the dive
  {
    const page = await boot();
    await dismiss(page);
    const r = await page.evaluate(() => {
      const g = window.__THREE_GAME_TEST_HOOKS__.game;
      const ids = g.creatures.list.map((rt) => rt.def.id);
      const f = {}; ids.slice(0, 20).forEach((id) => { f[id] = { photo: '', depth: 3, score: 100, grade: 'S', t: 0 }; });
      g.save.found = f; g.save.dives = 1; g.save.storyMain = 1; g.save.storyClaim = [];
      g.endDive('surface');
      const t = [...document.querySelectorAll('#res-list .res-find .open')].map((e) => e.textContent).join('|');
      return t;
    });
    check('P3-4: two chapters cleared on one dive -> both are named on the result screen', (r.match(/「/g) || []).length >= 2, r);
    await page.context().close();
  }

  // ================= P4-1 / P4-2: bait diet words
  {
    const page = await boot();
    const d = await page.evaluate(() => {
      const h = window.__THREE_GAME_TEST_HOOKS__;
      const ids = ['kawahagi', 'tengukawahagi', 'monngara', 'asiakoshoudai', 'kasumiaji', 'giganmeaji', 'hatatatehaze', 'maaji', 'budai', 'aigo', 'hanagoi'];
      const o = {}; for (const id of ids) o[id] = h.dietOf(id); return o;
    });
    const want = { kawahagi: 'meat', tengukawahagi: 'meat', monngara: 'meat', asiakoshoudai: 'meat', kasumiaji: 'meat', giganmeaji: 'meat', maaji: 'plankton', budai: 'weed', aigo: 'weed', hanagoi: 'plankton' };
    const bad = Object.entries(want).filter(([k, v]) => d[k] !== v).map(([k, v]) => `${k}:${d[k]}!=${v}`);
    check('P4-1: kawahagi family / アジアコショウダイ / カスミアジ / ギンガメアジ -> meat; small アジ -> plankton; weed eaters stay weed', bad.length === 0, bad.join(',') || JSON.stringify(d));
    check('P4-1: ハタタテハゼ is not meat (size/behaviour fallback)', d.hatatatehaze !== 'meat', String(d.hatatatehaze));
    const s = await page.evaluate(() => { // P4-2: a schooling fish of 15cm+ is no longer a predator by size alone
      const h = window.__THREE_GAME_TEST_HOOKS__; const l = h.game.creatures.list;
      const sch = l.filter((rt) => rt.def.behavior === 'school' && rt.def.size >= 0.15 && !/ハギ|アジ|ダイ|ハタ|ベラ|フグ|カサゴ|ソイ|メバル|イサキ|カマス|モンガラ|フエダイ/.test(rt.def.name));
      const bad = sch.filter((rt) => h.dietOf(rt.def.id) === 'meat').map((rt) => rt.def.name);
      return { n: sch.length, bad: bad.slice(0, 5) };
    });
    check('P4-2: schooling fish (no meat word in the name) are not meat via the size fallback', s.n > 0 && s.bad.length === 0, JSON.stringify(s));
    await page.context().close();
  }

  // ================= P4-3 / P4-4 / P4-6 / P4-7 (behaviour changes): bait + curiosity state
  {
    const page = await boot();
    await dismiss(page);
    const r = await page.evaluate(() => {
      const h = window.__THREE_GAME_TEST_HOOKS__; const g = h.game;
      h.giveBait(3);
      g.save.tutorial = true;
      const info = h.dropBait('krill');
      const hasCloud = !!g.baitPts;
      g.endDive('surface');
      return { dropped: !!info, hasCloud, after: !!g.baitPts, bait: g.creatures.bait };
    });
    check('P4-6: after endDive the bait cloud and bait state are gone', r.hasCloud && !r.after && r.bait == null, JSON.stringify(r));
    const c = await page.evaluate(() => {
      const g = window.__THREE_GAME_TEST_HOOKS__.game; const l = g.creatures.list;
      let n = 0; for (const rt of l) for (const gr of rt.groups) { gr.cur = 2; gr.curT = 50; n++; }
      g.creatures.reshuffle(g.camera.position);
      let bad = 0; for (const rt of l) for (const gr of rt.groups) if (gr.cur !== 0 || gr.curT !== 0) bad++;
      return { n, bad };
    });
    check('P4-7: reshuffle resets curiosity state (cur/curT)', c.n > 0 && c.bad === 0, JSON.stringify(c));
    await page.context().close();
  }

  const failed = results.filter((x) => !x[1]);
  console.log(`\n${results.length - failed.length}/${results.length} passed; page errors: ${errors.length}${errors.length ? '\n' + errors.slice(0, 3).join('\n') : ''}`);
  await browser.close();
  server.close();
  process.exit(failed.length || errors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
