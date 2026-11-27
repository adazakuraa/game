/** Phase 9 S7: start-up time and chart build time. node scripts/probe-s7-boot.cjs <artifact> [runs] */
const http = require('http'), fs = require('fs');
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('playwright-core')); }
const F = process.argv[2], N = +(process.argv[3] || 3);
(async () => {
  const server = http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); r.end(fs.readFileSync(F)); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({ executablePath: process.env.PROBE_CHROME || undefined, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'] });
  const res = [];
  for (let i = 0; i < N; i++) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    const logs = []; page.on('console', (m) => logs.push(m.text()));
    const t0 = Date.now();
    await page.goto(`http://127.0.0.1:${server.address().port}/a`);
    await page.waitForFunction(() => window.__THREE_GAME_TEST_HOOKS__, null, { timeout: 120000 });
    const boot = Date.now() - t0;
    await page.waitForTimeout(3000);
    const chart = logs.filter((l) => /chart built/.test(l));
    res.push({ boot, chart });
    await ctx.close();
  }
  console.log(JSON.stringify(res));
  await browser.close(); server.close();
})();
