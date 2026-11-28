/**
 * 修正バッチ2 F3 probe: ボート画面（ホーム画面の型）・ドック・エリアのカードと生き物の影・しおさい亭のタブ・ショップの影。
 * 390×844 で ①スクロールなしに 状態の帯・今やること・潜る場所 4 か所以上・ドック ②ドックが動かない ③今やることが最大 ④ボタン 44px・コントラスト 4.5
 * スクリーンショット：SHOT_DIR（既定 /tmp）に f3-one-area.png / f3-all-areas.png ほか
 * Usage: node scripts/probe-fix2-f3.cjs [dist/artifact.html]   (PROBE_CHROME=<chromium binary>)
 */
const path = require('path');
const http = require('http');
const fs = require('fs');
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('playwright-core')); }
const ARTIFACT = process.argv[2] || path.join(__dirname, '..', 'dist', 'artifact.html');
const EXE = process.env.PROBE_CHROME;
const SHOT = process.env.SHOT_DIR || '/tmp';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

// 画面内の「文字のある要素」のコントラスト比を測る（背景は祖先の重ね合わせ。グラデーションは一番明るい色で最悪側）
const MEASURE = (rootSel) => {
  const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const over = (top, bot) => ({ r: top.r * top.a + bot.r * (1 - top.a), g: top.g * top.a + bot.g * (1 - top.a), b: top.b * top.a + bot.b * (1 - top.a), a: 1 });
  const bgOf = (el) => {
    const stack = [];
    for (let e = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      let c = parse(cs.backgroundColor);
      const gi = cs.backgroundImage;
      if (gi && gi.includes('gradient')) {
        const cols = (gi.match(/rgba?\([^)]+\)/g) || []).map(parse).filter(Boolean);
        if (cols.length) c = cols.reduce((a, b) => (lum(over(b, { r: 3, g: 21, b: 33, a: 1 })) > lum(over(a, { r: 3, g: 21, b: 33, a: 1 })) ? b : a));
      }
      if (c && c.a > 0) stack.push(c);
      if (c && c.a >= 0.999) break;
    }
    let base = { r: 3, g: 21, b: 33, a: 1 };
    for (let i = stack.length - 1; i >= 0; i--) base = over(stack[i], base);
    return base;
  };
  const out = [];
  const root = document.querySelector(rootSel);
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  for (let n; (n = w.nextNode()); ) {
    if (!n.textContent.trim()) continue;
    const el = n.parentElement;
    if (seen.has(el)) continue;
    seen.add(el);
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (!r.width || !r.height || cs.visibility === 'hidden' || cs.display === 'none') continue;
    if (el.closest('.hidden') || el.closest('[hidden]') || el.closest('.dbg-fold')) continue;
    let op = 1;
    for (let e = el; e && e !== root.parentElement; e = e.parentElement) op *= parseFloat(getComputedStyle(e).opacity);
    let fg = parse(cs.color);
    const bg = bgOf(el);
    fg = over({ ...fg, a: fg.a * op }, op < 1 ? over({ ...bg, a: 1 }, { r: 3, g: 21, b: 33, a: 1 }) : bg);
    const L1 = lum(fg), L2 = lum(bg);
    const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    out.push({ t: n.textContent.trim().slice(0, 14), ratio: +ratio.toFixed(2), size: cs.fontSize });
  }
  return out;
};

(async () => {
  const html = fs.readFileSync(ARTIFACT);
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({ ...(EXE ? { executablePath: EXE } : {}), args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'] });
  const errors = [];
  const url = `http://127.0.0.1:${server.address().port}/`;
  async function boot(seed, vp = { width: 390, height: 844 }) {
    const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: +(process.env.F3_DSF || 1) });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    const page = await ctx.newPage();
    page.setDefaultTimeout(60000);
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.addInitScript((sv) => { if (!localStorage.getItem('blue-depths-save-v1')) localStorage.setItem('blue-depths-save-v1', JSON.stringify(sv)); }, seed);
    await page.goto(url);
    await page.waitForFunction(() => window.__THREE_GAME_TEST_HOOKS__, null, { timeout: 120000 });
    await page.waitForTimeout(1500);
    return page;
  }
  const base = { found: {}, dives: 2, maxDepth: 10, money: 12300, owned: [], earned: 0, discovered: ['lagoon'], visited: ['lagoon'], storyMain: 1, storyRead: 1, storyClaim: [], day: 1, clock: 0, tutorial: true };
  const rect = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, b: r.bottom }; }, sel);

  // ====================== 状態 A：エリアが 1 つ
  let page = await boot(base);
  await page.evaluate(() => { const g = window.__THREE_GAME_TEST_HOOKS__.game; g.toTitle(); });
  await page.waitForTimeout(500);
  await page.screenshot({ animations: 'disabled', path: path.join(SHOT, 'f3-one-area.png') });
  const A = await page.evaluate(() => ({
    pts: [...document.querySelectorAll('#points .pt')].map((e) => e.querySelector('.nm').textContent),
    sb: [...document.querySelectorAll('#points .pt .sb')].map((e) => e.textContent),
    icoSvg: document.querySelectorAll('#points .pt .ico svg').length,
    depthText: /\d+\s*m|水深/.test(document.getElementById('points').textContent),
    brand: !document.getElementById('home-brand').classList.contains('hidden'),
  }));
  check('(38) エリア一覧に水深の表示がない・アイコンは SVG の影', !A.depthText && A.icoSvg === 1, JSON.stringify(A));
  check('(23)(39) 順序：状態の帯 → 今やること → 潜る場所 → ドック', await page.evaluate(() => { const y = (s) => document.querySelector(s).getBoundingClientRect().top; return y('#home-bar') < y('#story-card') && y('#story-card') < y('#points') && y('#points') < y('#dock'); }));

  // ====================== 状態 B：全部見つかった
  await page.evaluate(() => {
    const g = window.__THREE_GAME_TEST_HOOKS__.game; const sv = g.save;
    sv.discovered = ['lagoon', 'reef', 'rocky', 'dropoff', 'cold', 'ruins', 'bluehole', 'cave', 'kelp', 'estuary', 'river', 'deep'];
    sv.owned = ['torch', 'spear', 'drysuit', 'macro', 'wide']; sv.money = 123456; sv.storyMain = 3; sv.storyRead = 3; sv.day = 6; sv.boardOn = true; sv.rep = 40; sv.story = 3;
    g.renderTitle();
  });
  await page.waitForTimeout(400);
  await page.screenshot({ animations: 'disabled', path: path.join(SHOT, 'f3-all-areas.png') });
  const B = await page.evaluate(() => {
    const vh = innerHeight;
    const r = (s) => { const e = document.querySelector(s).getBoundingClientRect(); return { top: e.top, bottom: e.bottom, h: e.height, w: e.width }; };
    const cards = [...document.querySelectorAll('#points .pt:not(.unknown)')].map((e) => { const q = e.getBoundingClientRect(); return { top: q.top, bottom: q.bottom, name: e.querySelector('.nm').textContent }; });
    return { vh, bar: r('#home-bar'), todo: r('#story-card'), dock: r('#dock'), main: r('#home-main'), cards, n: cards.length, title: r('#title') };
  });
  const dockTop = B.dock.top;
  const visibleCards = B.cards.filter((c) => c.top >= B.main.top - 1 && c.bottom <= dockTop + 1).length;
  check('① 390×844：状態の帯・今やること・ドックが画面内', B.bar.top >= 0 && B.todo.bottom <= dockTop && B.dock.bottom <= B.vh + 1, JSON.stringify({ bar: B.bar.top, todo: B.todo.bottom, dock: [B.dock.top, B.dock.bottom], vh: B.vh }));
  check('① 潜る場所が 4 か所以上、スクロールなしで見える', visibleCards >= 4, `見える ${visibleCards} / ${B.n} か所`);
  check('(38) 12 エリアすべてにカード（影のアイコン付き）', B.n === 12 && await page.evaluate(() => document.querySelectorAll('#points .pt:not(.unknown) .ico svg path').length >= 12 * 2));
  // ② ドックは動かない
  const d0 = await rect(page, '#dock');
  await page.evaluate(() => { const m = document.getElementById('home-main'); m.scrollTop = 99999; });
  await page.waitForTimeout(200);
  const d1 = await rect(page, '#dock');
  const sc = await page.evaluate(() => document.getElementById('home-main').scrollTop);
  check('② ドックは潜る場所をスクロールしても動かない', d0.y === d1.y && d0.h === d1.h && sc > 0, `scrollTop ${sc}, dock y ${d0.y}→${d1.y}`);
  await page.evaluate(() => { document.getElementById('home-main').scrollTop = 0; });
  // ③ 今やることが最大・最も目立つ
  const P = await page.evaluate(() => {
    const todo = document.getElementById('story-card'); const cs = getComputedStyle(todo);
    const pt = document.querySelector('#points .pt:not(.unknown)'); const pcs = getComputedStyle(pt);
    const tr = todo.getBoundingClientRect(), pr = pt.getBoundingClientRect();
    return { todoBorder: cs.borderTopWidth + ' ' + cs.borderTopColor, ptBorder: pcs.borderTopWidth + ' ' + pcs.borderTopColor, todoArea: tr.width * tr.height, ptArea: pr.width * pr.height, todoW: tr.width, ptW: pr.width };
  });
  check('③ 今やることは金の太い縁・幅が全幅・潜る場所のカードより大きい', P.todoBorder.startsWith('2px') && P.todoArea > P.ptArea * 1.5 && P.todoW > P.ptW * 1.8, JSON.stringify(P));
  // ④ ボタンの最小サイズとコントラスト
  const small = await page.evaluate(() => [...document.querySelectorAll('#title button, #title .pt:not(.unknown)')].filter((e) => !e.closest('.dbg-fold')).filter((e) => { const r = e.getBoundingClientRect(); return r.width && r.height && (r.width < 44 || r.height < 44); }).map((e) => (e.id || e.className) + ':' + Math.round(e.getBoundingClientRect().width) + 'x' + Math.round(e.getBoundingClientRect().height)));
  check('④ ホーム画面のボタンはすべて 44×44px 以上', small.length === 0, small.join(', '));
  let con = await page.evaluate(MEASURE, '#title');
  let bad = con.filter((c) => c.ratio < 4.5);
  check('④ 文字のコントラスト比 4.5 以上（状態 B）', bad.length === 0, bad.map((c) => `${c.t}=${c.ratio}`).join(' ') || `最小 ${Math.min(...con.map((c) => c.ratio))}`);
  // バッジ・ロックの確認
  const dockState = await page.evaluate(() => [...document.querySelectorAll('.dock-btn')].map((b) => ({ id: b.id, locked: b.classList.contains('locked'), bdg: b.querySelector('.bdg')?.textContent || '' })));
  check('ドックの 5 施設が固定の並び（ショップ・掲示板・しおさい亭・実績・図鑑）', JSON.stringify(dockState.map((d) => d.id)) === JSON.stringify(['open-shop', 'open-quests', 'open-kitchen', 'open-album', 'open-dex']), JSON.stringify(dockState));
  await page.close();

  // 鍵つきドック：しおさい亭・掲示板は未解放だと鍵つきで同じ位置に置く
  page = await boot({ ...base, tutorial: false, dives: 1 });
  await page.evaluate(() => { const g = window.__THREE_GAME_TEST_HOOKS__.game; g.save.tutorial = false; g.save.boardOn = false; g.toTitle(); });
  await page.waitForTimeout(400);
  const L = await page.evaluate(() => ({ k: document.getElementById('open-kitchen').classList.contains('locked'), q: document.getElementById('open-quests').classList.contains('locked'), kHidden: document.getElementById('open-kitchen').classList.contains('hidden'), r: ['open-shop', 'open-quests', 'open-kitchen', 'open-album', 'open-dex'].map((i) => Math.round(document.getElementById(i).getBoundingClientRect().x)) }));
  check('(39) 未解放の施設は鍵つきで置かれ（hidden にしない）、位置が変わらない', L.k && L.q && !L.kHidden && L.r.every((x, i, a) => i === 0 || x > a[i - 1]), JSON.stringify(L));
  await page.evaluate(() => document.getElementById('open-kitchen').click());
  const kopen = await page.evaluate(() => !document.getElementById('kitchen').classList.contains('hidden'));
  check('鍵つきのしおさい亭を押しても開かない（案内の吹き出し）', !kopen);
  await page.screenshot({ animations: 'disabled', path: path.join(SHOT, 'f3-locked-dock.png') });
  await page.close();

  // ====================== 夜でライトがない
  page = await boot({ ...base, clock: 1200 });
  const N = await page.evaluate(() => { const g = window.__THREE_GAME_TEST_HOOKS__.game; g.save.clock = 20 * 60; g.save.owned = []; g.toTitle(); return { night: g.save.clock }; });
  await page.waitForTimeout(400);
  const dk = await page.evaluate(() => ({ alert: document.querySelector('#story-card .td-alert')?.textContent || '', dim: document.querySelectorAll('#points .pt.dim').length, inn: !!document.querySelector('#daytime [data-inn]') }));
  check('(39) 夜でライトがない：今やることが「しおさい亭で休む」になり、潜る場所は暗くなる', /ライトがないと潜れない/.test(dk.alert) && dk.dim >= 1 && dk.inn, JSON.stringify(dk));
  await page.screenshot({ animations: 'disabled', path: path.join(SHOT, 'f3-night-dark.png') });
  await page.close();

  // ====================== ショップの影 (15)
  page = await boot({ ...base });
  await page.evaluate(() => { const g = window.__THREE_GAME_TEST_HOOKS__.game; g.toTitle(); document.getElementById('open-shop').click(); });
  await page.waitForTimeout(400);
  const S = await page.evaluate(() => {
    const items = [...document.querySelectorAll('#gear .gear-item.locked')];
    const it = items[0];
    return { n: items.length, svg: items.filter((i) => i.querySelector('.gi svg')).length, name: it?.childNodes[1]?.textContent, q: items.filter((i) => i.querySelector('.gq')).length, opacity: it && getComputedStyle(it.querySelector('.gi svg')).opacity, desc: it?.querySelector('.gdesc')?.textContent, req: it?.querySelector('.req')?.textContent.replace(/\s+/g, ' ') };
  });
  check('(15) 未入荷の商品は形だけの影（SVG・不透明度 0.35）で、名前は「？？？」・説明文は出さない', S.n > 0 && S.svg === S.n && S.q === 0 && /？？？/.test(S.name || '') && S.opacity === '0.35' && !S.desc && /図鑑\d+種で入荷/.test(S.req || ''), JSON.stringify(S));
  await page.screenshot({ animations: 'disabled', path: path.join(SHOT, 'f3-shop-silhouettes.png') });
  await page.close();

  // ====================== しおさい亭 (28)
  page = await boot({ ...base });
  await page.evaluate(() => { const g = window.__THREE_GAME_TEST_HOOKS__.game; g.save.owned = ['torch', 'spear']; g.save.rep = 30; g.save.story = 9; g.toTitle(); document.getElementById('open-kitchen').click(); });
  await page.waitForTimeout(500);
  const K = await page.evaluate(() => {
    const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const tabs = [...document.querySelectorAll('.k-tab')].map((t) => ({ t: t.firstChild.textContent, on: t.classList.contains('on'), h: Math.round(t.getBoundingClientRect().height) }));
    const panes = [...document.querySelectorAll('[data-kpane]')].map((p) => ({ k: p.dataset.kpane, vis: vis(p) }));
    return { tabs, panes, okami: vis(document.getElementById('k-okami')), time: vis(document.getElementById('k-sleep')), norenH: Math.round(document.querySelector('#kitchen .noren').getBoundingClientRect().height), norenBottom: document.querySelector('#kitchen .noren').getBoundingClientRect().bottom, headTop: document.querySelector('#kitchen .k-head').getBoundingClientRect().top };
  });
  check('(28) 上部は吹き出し＋時間ボタン、下はタブ 3 つ（注文・店の仕事・買い物）', K.okami && K.time && K.tabs.map((t) => t.t).join() === '注文,店の仕事,買い物' && K.tabs[0].on && K.panes.find((p) => p.k === 'orders').vis && !K.panes.find((p) => p.k === 'work').vis && !K.panes.find((p) => p.k === 'shop').vis, JSON.stringify(K));
  check('(28) のれんは細い帯に収まり、見出しと重ならない', K.norenH <= 40 && K.norenBottom <= K.headTop + 1, JSON.stringify({ h: K.norenH, b: K.norenBottom, headTop: K.headTop }));
  await page.screenshot({ animations: 'disabled', path: path.join(SHOT, 'f3-kitchen-orders.png') });
  con = await page.evaluate(MEASURE, '#kitchen');
  bad = con.filter((c) => c.ratio < 4.5);
  check('(28) しおさい亭（注文タブ）の文字のコントラスト比 4.5 以上', bad.length === 0, bad.map((c) => `${c.t}=${c.ratio}`).join(' '));
  await page.evaluate(() => document.querySelector('[data-ktab="work"]').click());
  await page.waitForTimeout(200);
  await page.screenshot({ animations: 'disabled', path: path.join(SHOT, 'f3-kitchen-work.png') });
  con = await page.evaluate(MEASURE, '#kitchen');
  bad = con.filter((c) => c.ratio < 4.5);
  check('(28) 同（店の仕事タブ）', bad.length === 0, bad.map((c) => `${c.t}=${c.ratio}`).join(' '));
  await page.evaluate(() => document.querySelector('[data-ktab="shop"]').click());
  await page.waitForTimeout(200);
  const baitBtn = await page.evaluate(() => !!document.querySelector('#k-bait [data-bait]') && document.querySelector('[data-kpane="shop"]').getBoundingClientRect().height > 0);
  check('(28) 買い物タブに餌の棚', baitBtn);
  await page.screenshot({ animations: 'disabled', path: path.join(SHOT, 'f3-kitchen-shop.png') });
  const kb = await page.evaluate(() => [...document.querySelectorAll('#kitchen button')].filter((e) => { const r = e.getBoundingClientRect(); return r.width && r.height && (r.height < 44 || r.width < 44); }).filter((e) => !e.closest('#mg')).map((e) => (e.id || e.className) + ':' + Math.round(e.getBoundingClientRect().width) + 'x' + Math.round(e.getBoundingClientRect().height)));
  check('（参考）しおさい亭の 44px 未満のボタン（従来のまま）', true, kb.join(', ') || 'なし');
  await page.close();

  // 横長
  page = await boot({ ...base }, { width: 844, height: 390 });
  await page.evaluate(() => { const g = window.__THREE_GAME_TEST_HOOKS__.game; g.save.discovered = ['lagoon', 'reef', 'rocky', 'dropoff', 'cold', 'ruins']; g.toTitle(); });
  await page.waitForTimeout(400);
  const LS = await page.evaluate(() => { const r = (s) => document.querySelector(s).getBoundingClientRect(); const d = r('#dock'), m = r('#home-main'); return { dockLeft: d.left, mainRight: m.right, dockBottom: d.bottom, vh: innerHeight, bar: r('#home-bar').height }; });
  check('(39) 横長：右にドックを縦に並べ、画面内に収まる', LS.dockLeft >= LS.mainRight && LS.dockBottom <= LS.vh + 1, JSON.stringify(LS));
  await page.screenshot({ animations: 'disabled', path: path.join(SHOT, 'f3-landscape.png') });
  await page.close();

  check('ページエラー 0 件', errors.length === 0, errors.join(' | '));
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  await browser.close(); server.close();
  process.exit(failed.length ? 1 : 0);
})();
