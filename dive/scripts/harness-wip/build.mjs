// 検証専用ビルド：リポジトリ内の three r170 と手元の esbuild を使う。公開物には使わない。
// usage: node build.mjs <diveDir> <out.html> [--viewport]
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
const require = createRequire('/opt/npm-tools/package.json');
const esbuild = require('esbuild');
const [dive, out, flag] = process.argv.slice(2);
const root = resolve(dive);
const plugin = { name: 'vite-shim', setup(b) {
  b.onResolve({ filter: /^three$/ }, () => ({ path: join(root, '../racing/vendor/three.module.min.js') }));
  b.onResolve({ filter: /BufferGeometryUtils\.js$/ }, () => ({ path: '/home/claude/harness/bgu.js' }));
  b.onResolve({ filter: /^three\/addons\// }, (a) => ({ errors: [{ text: 'この検証環境に無いアドオン: ' + a.path }] }));
  b.onLoad({ filter: /\.ts$/ }, (a) => {
    let s = readFileSync(a.path, 'utf8');
    s = s.replace(/import\.meta\.glob\('([^']+)\/\*\.(\w+)'[^)]*\)/g, (_, dir, ext) => {
      let files = []; try { files = readdirSync(join(dirname(a.path), dir)).filter((f) => f.endsWith('.' + ext)); } catch {}
      return '({' + files.map((f) => `'${dir}/${f}': 'data:image/${ext};base64,${readFileSync(join(dirname(a.path), dir, f)).toString('base64')}'`).join(',') + '})';
    });
    return { contents: s, loader: 'ts', resolveDir: dirname(a.path) };
  });
} };
const r = await esbuild.build({ entryPoints: [join(root, 'src/main.ts')], bundle: true, format: 'esm', minify: true, write: false, outdir: '/tmp/h', target: 'es2022', loader: { '.webp': 'dataurl', '.jpg': 'dataurl', '.png': 'dataurl' }, plugins: [plugin], logLevel: 'warning', nodePaths: [] });
const js = r.outputFiles.find((f) => f.path.endsWith('.js')).text.replace(/<\/script/gi, '<\\/script');
const css = r.outputFiles.find((f) => f.path.endsWith('.css'))?.text ?? '';
const html = readFileSync(join(root, 'index.html'), 'utf8');
const body = html.match(/<body>([\s\S]*?)<\/body>/)[1].replace(/<script type="module"[^>]*><\/script>/, '');
const meta = flag === '--viewport' ? '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n' : '';
writeFileSync(out, `<meta charset="utf-8">\n${meta}<style>${css}</style>\n${body}\n<script type="module">${js}</script>\n`);
console.log('wrote', out, (readFileSync(out).length / 1024).toFixed(0), 'KB');
