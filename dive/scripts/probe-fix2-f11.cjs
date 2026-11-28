/**
 * 修正バッチ2 F11 probe: 天気限定の生き物（出現・依頼から除外・★2 以下・7 日以内に必ず来る天気・図鑑のヒント・朝のひとこと）と
 * 天気別の視程（晴れ＝曇り＞雨＞荒天）。
 * Usage: node scripts/probe-fix2-f11.cjs [dist/artifact.html]
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
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.setState('reef'));
  await page.waitForTimeout(1500);

  // ---- (1) 定義：8 種・★2 以下・ヒント
  const defs = await page.evaluate(() => {
    const g = window.__THREE_GAME_TEST_HOOKS__.game;
    const list = g.creatures.list.map((r) => r.def).filter((d) => d.weather);
    return list.map((d) => ({ id: d.id, name: d.name, rarity: d.rarity, weather: d.weather, hint: d.hint, zone: d.zone }));
  });
  check('天気限定の種が 6〜8 種', defs.length >= 6 && defs.length <= 8, `${defs.length} 種`);
  check('すべて ★2 以下', defs.every((d) => d.rarity <= 2), defs.map((d) => d.name + d.rarity).join(','));
  check('図鑑のヒントに「◯の日だけ現れる」', defs.every((d) => /(雨|荒天|曇り)の日だけ現れる/.test(d.hint)), defs[0]?.hint);
  const kinds = new Set(defs.flatMap((d) => d.weather));
  check('雨・荒天・曇りの 3 種類の天気にまたがる', kinds.has('rain') && kinds.has('storm') && kinds.has('cloudy'), [...kinds].join(','));

  // ---- (2) 出現：対象外の天気では 0、対象の天気では出る
  const pres = await page.evaluate(() => {
    const h = window.__THREE_GAME_TEST_HOOKS__, g = h.game;
    const THREE_V = g.camera.position.clone();
    const out = {};
    for (const w of ['sunny', 'cloudy', 'rain', 'storm']) {
      h.setWeather(w);
      let present = 0, wrong = 0, trials = 0;
      for (let k = 0; k < 20; k++) {
        g.creatures.reshuffle(THREE_V, 1000 + k);
        for (const rt of g.creatures.list) {
          if (!rt.def.weather) continue;
          const here = rt.groups.some((gr) => !gr.absent);
          if (rt.def.weather.includes(w)) { trials++; if (here) present++; } else if (here) wrong++;
        }
      }
      out[w] = { present, trials, wrong };
    }
    return out;
  });
  console.log(JSON.stringify(pres));
  check('対象外の天気では 1 回も出ない', Object.values(pres).every((v) => v.wrong === 0));
  check('対象の天気ではたいてい出る（70% 以上）', ['cloudy', 'rain', 'storm'].every((w) => pres[w].trials > 0 && pres[w].present / pres[w].trials >= 0.7), JSON.stringify(pres));
  check('晴れの日は天気限定の種が試行 0', pres.sunny.trials === 0);

  // ---- (3) 依頼の対象にならない
  const q = await page.evaluate(() => {
    const h = window.__THREE_GAME_TEST_HOOKS__, g = h.game;
    const names = g.creatures.list.filter((r) => r.def.weather).map((r) => r.def.name);
    const known = ['lagoon', 'reef', 'estuary', 'river', 'dropoff', 'rocky', 'kelp', 'cold', 'ruins'];
    let hits = 0, withSp = 0;
    for (let i = 0; i < 3000; i++) { const x = h.makeQuest(known, i + 1); if (x && /(の写真|の標識読み取り)$/.test(x.title)) { withSp++; if (names.some((n) => x.title.startsWith(n))) hits++; } }
    const pool = h.orderPool().map((d) => d.name);
    return { hits, withSp, inPool: names.filter((n) => pool.includes(n)).length };
  });
  check('撮影・標識の依頼・食堂の注文に天気限定の種が出ない', q.withSp > 100 && q.hits === 0 && q.inPool === 0, JSON.stringify(q));

  // ---- (4) 天気の決め方：雨・荒天はどの連続 7 日にも 1 回、荒天は連続しない
  const wd = await page.evaluate(() => {
    const h = window.__THREE_GAME_TEST_HOOKS__;
    const w = (d) => h.weatherOfDay(d);
    let miss = 0, stormStorm = 0; const cnt = {};
    for (let d = 1; d <= 3000; d++) {
      cnt[w(d)] = (cnt[w(d)] || 0) + 1;
      if (w(d) === 'storm' && w(d + 1) === 'storm') stormStorm++;
      for (const k of ['rain', 'storm']) { let ok = false; for (let j = 0; j < 7; j++) if (w(d + j) === k) ok = true; if (!ok) miss++; }
    }
    return { miss, stormStorm, day1: w(1), cnt };
  });
  console.log(JSON.stringify(wd));
  check('どの連続 7 日にも 雨と荒天が 1 回以上', wd.miss === 0, `miss=${wd.miss}`);
  check('荒天は連続しない・1 日目は晴れ', wd.stormStorm === 0 && wd.day1 === 'sunny');

  // ---- (5) 朝のひとこと
  const line = await page.evaluate(() => {
    const h = window.__THREE_GAME_TEST_HOOKS__;
    let d = 2; while (h.weatherOfDay(d) !== 'rain') d++;
    return { d, text: h.weatherMorning(d) };
  });
  check('雨の朝：「◯◯が出るかもね」', /(ヒメツバメウオ|ノコギリガザミ|ナマズ|ウナギ).*が出るかもね/.test(line.text), line.text);

  // ---- (6) 視程：晴れ＝曇り＞雨＞荒天
  const fog = {};
  for (const w of ['sunny', 'cloudy', 'rain', 'storm']) {
    await page.evaluate((w) => { const h = window.__THREE_GAME_TEST_HOOKS__; h.setWeather(w); }, w);
    await page.waitForTimeout(700);
    fog[w] = await page.evaluate(() => { const g = window.__THREE_GAME_TEST_HOOKS__.game; return g.env.fog.density; });
  }
  console.log(JSON.stringify(fog));
  check('視程：晴れ＝曇り', Math.abs(fog.sunny - fog.cloudy) / fog.sunny < 0.02, `${fog.sunny} / ${fog.cloudy}`);
  check('視程：曇り＞雨＞荒天（霧の濃さの逆）', fog.cloudy < fog.rain && fog.rain < fog.storm, JSON.stringify(fog));
  check('雨は晴れより 15% 以上、荒天は 30% 以上濃い', fog.rain / fog.sunny >= 1.15 && fog.storm / fog.sunny >= 1.3, `${(fog.rain / fog.sunny).toFixed(2)} / ${(fog.storm / fog.sunny).toFixed(2)}`);

  check('ページエラーなし', errors.length === 0, errors.slice(0, 3).join(' | '));
  const bad = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - bad}/${results.length} passed`);
  await browser.close(); server.close();
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
