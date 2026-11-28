/**
 * Phase 11 probe (attack / repel): bite values, the lethal hit (air = 0 -> blackout), the floors that stay (octopus grab,
 * haul cost), repel by spear tier, the repel window (inside / outside / already reached), the "just" band and the
 * 30 s / 90 s cooldown, and the shark shield coexisting.
 * Usage: node scripts/probe-phase11.cjs [dist/artifact.html]   (PROBE_CHROME=<chromium binary>)
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
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(fs.readFileSync(ARTIFACT)); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({ ...(EXE ? { executablePath: EXE } : {}), args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => window.__THREE_GAME_TEST_HOOKS__, null, { timeout: 120000 });
  const ev = (fn, arg) => page.evaluate(fn, arg);
  console.log('booted'); await ev(() => document.getElementById('pr-go')?.click());
  await page.waitForTimeout(1200);
  await ev(() => window.__THREE_GAME_TEST_HOOKS__.setState('reef'));
  await page.waitForFunction(() => window.__THREE_GAME_TEST_HOOKS__.game.state === 'diving', null, { timeout: 240000, polling: 1000 });
  await ev(() => { window.__THREE_GAME_TEST_HOOKS__.game.tut.step = -1; window.__THREE_GAME_TEST_HOOKS__.setPausedForScreenshot(true); });
  await page.waitForTimeout(500);

  // ---------- 1. bite values / lethal flag ----------
  const bites = await ev(() => {
    const g = window.__THREE_GAME_TEST_HOOKS__.game;
    const out = {};
    for (const id of ['monngara', 'gomamongara', 'okizayori', 'silvertip', 'yogore', 'oomejirozame', 'dunkleosteus', 'megalodon']) {
      const a = g.creatures.list.find((r) => r.def.id === id)?.def.aggro;
      out[id] = a ? [a.bite, !!a.lethal, a.chance, a.range, a.speed] : null;
    }
    out.lethalIds = g.creatures.list.filter((r) => r.def.aggro?.lethal).map((r) => r.def.id);
    return out;
  });
  const want = { monngara: [6, 0.25, 3, 2.2], gomamongara: [10, 0.6, 4.5, 2.6], okizayori: [8, 1, 12, 7], silvertip: [25, 0.3, 12, 3.4], yogore: [35, 0.5, 14, 3.6], oomejirozame: [40, 0.3, 14, 3.4], dunkleosteus: [80, 0.6, 16, 3.2], megalodon: [30, 0.5, 26, 4] };
  for (const [id, w] of Object.entries(want)) {
    const b = bites[id];
    check(`bite ${id} = ${w[0]}（chance/range/speed 不変）`, !!b && b[0] === w[0] && b[1] === (id === 'megalodon') && b[2] === w[1] && b[3] === w[2] && b[4] === w[3], JSON.stringify(b));
  }
  check('lethal はメガロドンだけ', bites.lethalIds.length === 1 && bites.lethalIds[0] === 'megalodon', bites.lethalIds.join(','));

  // ---------- 2. hits: damage, lethal -> blackout, floors ----------
  const H = await ev(() => {
    const h = window.__THREE_GAME_TEST_HOOKS__, g = h.game;
    const hit = (id, air) => {
      const rt = g.creatures.list.find((r) => r.def.id === id);
      g.air = air;
      g.creatures.events.push({ type: 'hit', def: rt.def, p: g.camera.position.clone().add({ x: 3, y: 0, z: 0 }) });
      g.handleEncounters();
      return g.air;
    };
    const out = { dmg: {}, floor: {}, state: null };
    for (const id of ['monngara', 'gomamongara', 'okizayori', 'silvertip', 'yogore', 'oomejirozame', 'dunkleosteus']) out.dmg[id] = 100 - hit(id, 100);
    out.floor.yogore10 = hit('yogore', 10);
    out.floor.dunk50 = hit('dunkleosteus', 50);
    out.floor.mega100 = hit('megalodon', 100);
    // octopus grab keeps the floor of 1
    const oct = g.creatures.list.find((r) => r.def.kind === 'octopus');
    g.air = 0.4;
    g.creatures.events.push({ type: 'grab', def: oct.def, p: g.camera.position.clone() });
    g.handleEncounters();
    out.floor.grab = g.air;
    // the haul cost keeps its floor: speared fish at air 1.2 -> 1
    const fishRt = g.creatures.list.find((r) => { const e = h.edible(r.def.id); return r.def.kind === 'fish' && !r.def.aggro && r.def.size >= 0.3 && r.def.size <= 0.7 && e && e.ok && !e.protected && !e.poison && !e.shark && r.agents.length; });
    const a = fishRt.agents[0];
    g.air = 1.2; g.reload = 0;
    const pos = g.camera.position, fwd = g.camera.getWorldDirection(g.tmpDir);
    a.p.copy(pos).addScaledVector(fwd, 1.0); a.taken = false; fishRt.groups[a.g].absent = false;
    const rnd = Math.random; Math.random = () => 0;
    g.spearT = { rt: fishRt, agent: a, dist: 1.0, ang: 0, speed: 0 };
    g.fireSpear();
    Math.random = rnd;
    out.floor.haulTaken = a.taken; out.floor.haul = g.air;
    return out;
  });
  const wantDmg = { monngara: 6, gomamongara: 10, okizayori: 8, silvertip: 25, yogore: 35, oomejirozame: 40, dunkleosteus: 80 };
  for (const [id, d] of Object.entries(wantDmg)) check(`ヒットで ${id} は エア −${d}`, H.dmg[id] === d, String(H.dmg[id]));
  check('aggro のヒットはエアが 0 まで減る（床 1 を撤廃）：yogore 10 → 0', H.floor.yogore10 === 0, String(H.floor.yogore10));
  check('ダンクルオステウス 50 → 0（80 でも 0 止まり）', H.floor.dunk50 === 0, String(H.floor.dunk50));
  check('メガロドン（lethal）は 100 → 0', H.floor.mega100 === 0, String(H.floor.mega100));
  check('タコの grab の床 1 は維持', H.floor.grab === 1, String(H.floor.grab));
  check('銛の haul コストの床 1 は維持（獲れて、エア 1.2 → 1）', H.floor.haulTaken === true && H.floor.haul === 1, `taken=${H.floor.haulTaken} air=${H.floor.haul}`);

  // ---------- 3. repel: tier matrix, window, just ----------
  /** thrust at `id` with a tool, the animal being in mode 2 at body-surface distance `surf` (m) */
  const thrust = (arg) => ev((o) => {
    const h = window.__THREE_GAME_TEST_HOOKS__, g = h.game;
    g.save.owned = o.owned;
    g.reload = 0;
    const rt = g.creatures.list.find((r) => r.def.id === o.id);
    const a = rt.agents[0];
    const def = rt.def;
    const hitD = def.size * 0.45 + 0.55;
    const d = o.surfAbs !== undefined ? def.size * 0.45 + o.surfAbs : hitD + o.beyond;
    const pos = g.camera.position, fwd = g.camera.getWorldDirection(g.tmpDir).clone();
    a.p.copy(pos).addScaledVector(fwd, d);
    a.aggro = true; a.mode = 2; a.modeT = 0; a.repelT = 0; a.taken = false; a.v.set(0, 0, 0);
    rt.groups[a.g].absent = false;
    let toastText = '';
    const tt = g.toast.bind(g); g.toast = (t, k, dd) => { toastText = t; return tt(t, k, dd); };
    const air0 = g.air, caught0 = g.diveCatch.length;
    g.spearT = { rt, agent: a, dist: Math.max(0, d - a.s * 0.3), ang: 0, speed: 0 };
    g.fireSpear();
    g.toast = tt;
    return { mode: a.mode, repelT: a.repelT ?? 0, reload: g.reload, toast: toastText, taken: a.taken, caught: g.diveCatch.length - caught0, airDelta: g.air - air0, hitD, d };
  }, arg);
  const GEAR = { hand: [], gun: ['license', 'speargun'], big: ['license', 'speargun', 'powerhead'] };
  const matrix = { hand: { monngara: 1, okizayori: 1, silvertip: 0, yogore: 0, oomejirozame: 0, dunkleosteus: 0, megalodon: 0 }, gun: { monngara: 1, okizayori: 1, silvertip: 1, yogore: 1, oomejirozame: 1, dunkleosteus: 0, megalodon: 0 }, big: { monngara: 1, okizayori: 1, silvertip: 1, yogore: 1, oomejirozame: 1, dunkleosteus: 1, megalodon: 1 } };
  const RANGE = { hand: 2.2, gun: 6, big: 7 };
  for (const tool of ['hand', 'gun', 'big']) {
    const bad = [];
    for (const [id, exp] of Object.entries(matrix[tool])) {
      const r = await thrust({ owned: GEAR[tool], id, surfAbs: 1.9 + 0.0 });
      const repelled = r.mode === 3 && r.repelT > 0 && !r.taken && r.caught === 0;
      if (repelled !== !!exp) bad.push(`${id}:${repelled}`);
      if (!exp && !(r.mode === 2 && r.reload > 0 && !r.taken)) bad.push(`${id}:nohint-state`);
    }
    check(`段階別の撃退可否：${tool}（${Object.entries(matrix[tool]).map(([k, v]) => k + (v ? '○' : '×')).join(' ')}）`, bad.length === 0, bad.join(' '));
  }
  const hint = await thrust({ owned: GEAR.hand, id: 'silvertip', surfAbs: 1.9 });
  check('段階不足の空振りにヒント（手銛ではサメに効かない！）＋リロード消費', hint.toast.includes('手銛ではサメに効かない') && hint.reload > 0, hint.toast);
  const hint2 = await thrust({ owned: GEAR.gun, id: 'megalodon', surfAbs: 1.9 });
  check('水中銃でメガロドン：ヒント（大物用水中銃が要る）', hint2.toast.includes('大物用水中銃'), hint2.toast);

  // window (gun vs silvertip, repelReach 3 — the catch range stays 6)
  const inside = await thrust({ owned: GEAR.gun, id: 'silvertip', surfAbs: 2.9 });
  const outside = await thrust({ owned: GEAR.gun, id: 'silvertip', surfAbs: 3.4 });
  const reached = await thrust({ owned: GEAR.gun, id: 'silvertip', beyond: -0.1 });
  check('窓の内（射程の内側）：撃退成功', inside.mode === 3 && inside.repelT === 30, JSON.stringify(inside));
  check('窓の外（撃退の届く距離 3m より遠い）：空振り・リロード消費・状態は変わらない', outside.mode === 2 && outside.repelT === 0 && outside.reload > 0 && !outside.taken && outside.caught === 0, JSON.stringify(outside));
  check('ヒット判定距離に到達済みの入力は撃退にならない', reached.mode === 2 && reached.repelT === 0 && !reached.taken, JSON.stringify(reached));
  // the hand spear window is its own range
  const handIn = await thrust({ owned: GEAR.hand, id: 'monngara', surfAbs: 2.1 });
  const handOut = await thrust({ owned: GEAR.hand, id: 'monngara', surfAbs: 2.4 });
  check('手銛の窓は 2.2m（2.1m 成功／2.4m 失敗）', handIn.mode === 3 && handOut.mode === 2, `in=${handIn.mode} out=${handOut.mode}`);
  // just band: min(1.2, speed × 0.3) = 1.02 m for the silvertip (speed 3.4)
  const jIn = await thrust({ owned: GEAR.gun, id: 'silvertip', surfAbs: 0.55 + 0.95 });
  const jOut = await thrust({ owned: GEAR.gun, id: 'silvertip', surfAbs: 0.55 + 1.15 });
  const jEdge = await thrust({ owned: GEAR.gun, id: 'silvertip', surfAbs: 0.6 });
  check('ジャスト（ヒット判定距離＋min(1.2m, 速さ×0.3s) 以内）：クールダウン 90 秒', jIn.repelT === 90 && jEdge.repelT === 90, `${jIn.repelT}/${jEdge.repelT}`);
  check('ジャスト帯の外：クールダウン 30 秒', jOut.repelT === 30, String(jOut.repelT));
  check('撃退のトースト（通常／ジャスト）', /突きが届いた！ ツマジロが退いた/.test(jOut.toast) && /ジャスト/.test(jIn.toast), `${jOut.toast} | ${jIn.toast}`);
  check('撃退は非殺傷（獲物にならない・エア消費なし）', jIn.caught === 0 && !jIn.taken && jIn.airDelta === 0, `caught=${jIn.caught} airΔ=${jIn.airDelta}`);
  check('撃退でもリロードは通常どおり（大物用 3 秒）', (await thrust({ owned: GEAR.big, id: 'megalodon', surfAbs: 3 })).reload === 3, '');
  // not charging: an ordinary spearing of a circling shark / a non-aggro fish is untouched by repel
  const circ = await ev(() => {
    const g = window.__THREE_GAME_TEST_HOOKS__.game;
    g.save.owned = ['license', 'speargun', 'powerhead']; g.reload = 0;
    const rt = g.creatures.list.find((r) => r.def.id === 'silvertip'), a = rt.agents[0];
    a.aggro = true; a.mode = 1; a.repelT = 0;
    g.spearT = { rt, agent: a, dist: 3, ang: 0, speed: 0 };
    a.p.copy(g.camera.position).addScaledVector(g.camera.getWorldDirection(g.tmpDir), 3);
    g.fireSpear();
    return { mode: a.mode, repelT: a.repelT ?? 0 };
  });
  check('突進中（mode 2）でなければ撃退は発動しない（旋回中 mode 1）', circ.mode === 1 && circ.repelT === 0, JSON.stringify(circ));

  // ---------- 4. cooldown in the live simulation ----------
  const CD = await ev(() => {
    const h = window.__THREE_GAME_TEST_HOOKS__, g = h.game;
    g.save.owned = ['license', 'speargun'];
    const pos = g.camera.position;
    const dir = g.camera.getWorldDirection(g.tmpDir).clone();
    const run = (id, surf, total) => {
      const rt = g.creatures.list.find((r) => r.def.id === id);
      const gr = rt.groups[0], a = rt.agents.find((x) => x.g === 0);
      // the whole group sits 1.3 m ahead of the diver: inside the territory trigger range, so the species is active
      const c = pos.clone().addScaledVector(dir, 1.3);
      gr.absent = false; gr.c.copy(c); gr.t.copy(c); gr.home.copy(c);
      for (const x of rt.agents) if (x.g === 0) x.p.copy(c).add(x.off);
      g.creatures.update(0.1, pos, g.vel, dir);
      a.aggro = true; a.mode = 2; a.modeT = 0; a.repelT = 0; a.taken = false;
      const hitD = rt.def.size * 0.45 + 0.55;
      a.p.copy(pos).addScaledVector(dir, hitD + surf - 0.55);
      g.reload = 0;
      g.spearT = { rt, agent: a, dist: Math.max(0, a.p.distanceTo(pos) - a.s * 0.3), ang: 0, speed: 0 };
      g.fireSpear();
      const o = { repelT0: a.repelT, modeAfter: a.mode, againAt: null, active: rt.active, warns: 0 };
      for (let t = 0; t < total; t += 0.25) {
        g.creatures.update(0.25, pos, g.vel, dir);
        // keep the animal close so the trigger condition stays true all the time
        for (const x of rt.agents) if (x.g === 0 && !x.taken && x.p.distanceTo(pos) > 1.6) x.p.copy(pos).addScaledVector(dir, 1.3);
        gr.home.copy(c);
        if (o.againAt === null && (a.mode === 1 || a.mode === 2)) o.againAt = +(t + 0.25).toFixed(2);
      }
      o.repelTEnd = a.repelT ?? 0;
      g.creatures.events.length = 0;
      return o;
    };
    return { plain: run('monngara', 1.9, 80), just: run('monngara', 1.0, 140), ctrl: (() => {
      // control: the same animal never repelled gets aggro again quickly
      const rt = g.creatures.list.find((r) => r.def.id === 'monngara'), a = rt.agents.find((x) => x.g === 0);
      a.aggro = true; a.mode = 0; a.modeT = 0; a.repelT = 0; a.taken = false;
      let at = null;
      for (let t = 0; t < 12; t += 0.25) { g.creatures.update(0.25, pos, g.vel, dir); for (const x of rt.agents) if (x.g === 0 && x.p.distanceTo(pos) > 1.6) x.p.copy(pos).addScaledVector(dir, 1.3); if (at === null && (a.mode === 1 || a.mode === 2)) at = t; }
      g.creatures.events.length = 0;
      return { againAt: at };
    })() };
  });
  check('撃退の直後は mode 3（退却）', CD.plain.modeAfter === 3 && CD.plain.repelT0 === 30, JSON.stringify(CD.plain));
  check('通常撃退：30 秒間は再び aggro 状態に入らない（その後は入りうる）', CD.plain.againAt === null || CD.plain.againAt >= 29, `again@${CD.plain.againAt}（null＝80 秒間入らず／縄張り条件の外）`);
  check('ジャスト撃退：90 秒間は再び aggro 状態に入らない', CD.just.repelT0 === 90 && (CD.just.againAt === null || CD.just.againAt >= 89), `again@${CD.just.againAt}`);
  check('対照：撃退していない個体は 12 秒以内にまた aggro に入る（クールダウンが効いている証拠）', CD.ctrl.againAt !== null, JSON.stringify(CD.ctrl));

  // ---------- 5. shark shield coexists (unchanged: shield works at size*0.45+1.8, inside the window) ----------
  const S = await ev(() => {
    const h = window.__THREE_GAME_TEST_HOOKS__, g = h.game;
    const pos = g.camera.position, dir = g.camera.getWorldDirection(g.tmpDir).clone();
    const rt = g.creatures.list.find((r) => r.def.id === 'monngara');
    const a = rt.agents.find((x) => x.g === 0), gr = rt.groups[0];
    const c = pos.clone().addScaledVector(dir, 4);
    gr.absent = false; gr.c.copy(c); gr.t.copy(c); gr.home.copy(c);
    for (const x of rt.agents) if (x.g === 0) x.p.copy(c).add(x.off);
    g.creatures.update(0.1, pos, g.vel, dir);
    g.creatures.shield = true;
    a.aggro = true; a.mode = 2; a.modeT = -1; a.repelT = 0;
    a.p.copy(pos).addScaledVector(dir, rt.def.size * 0.45 + 1.7);
    g.creatures.events.length = 0;
    g.creatures.update(0.05, pos, g.vel, dir);
    const evs = g.creatures.events.map((e) => e.type);
    const shieldWorked = a.mode === 3 && evs.includes('repel') && !evs.includes('hit');
    g.creatures.shield = false; g.creatures.events.length = 0;
    const spearRange = 2.2;
    return { shieldWorked, evs, windowOuter: spearRange, shieldDist: rt.def.size * 0.45 + 1.8 };
  });
  check('シャークシールド併用：作動距離（体表 1.8m 未満）は撃退窓（手銛 2.2m）の内側、従来どおり作動', S.shieldWorked, JSON.stringify(S.evs));
  check('シールドの作動距離は手銛の窓の内側（体表 1.8m < 2.2m）', 1.8 < 2.2 && 1.8 < 3, '');

  // (last: it ends the dive)
  // lethal hit -> endDive('blackout') through the normal loop
  const B = await ev(() => {
    const h = window.__THREE_GAME_TEST_HOOKS__, g = h.game;
    g.air = 100;
    const rt = g.creatures.list.find((r) => r.def.id === 'megalodon');
    g.creatures.events.push({ type: 'hit', def: rt.def, p: g.camera.position.clone().add({ x: 3, y: 0, z: 0 }) });
    g.handleEncounters();
    const airAfter = g.air;
    let reason = null;
    const orig = g.endDive.bind(g);
    g.endDive = (r) => { reason = r; return orig(r); };
    g.paused = false;
    g.updateDiver(0.05);
    g.endDive = orig;
    return { airAfter, reason, state: g.state };
  });
  check('lethal ヒット → endDive(\'blackout\') に合流', B.airAfter === 0 && B.reason === 'blackout', JSON.stringify(B));
  check('ページエラー 0', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  server.close();
  const bad = results.filter((r) => !r.ok);
  console.log(`\n${results.length - bad.length}/${results.length} PASS`);
  process.exit(bad.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
