// Inline the Vite build into one HTML body fragment for single-file hosting (claude.ai Artifact).
// Usage: node scripts/make-artifact.mjs dist out.html [--page]
// --page: output for a stand-alone page (dive/play.html on GitHub Pages). It adds the charset and viewport meta
// tags; without them a phone lays the page out 980 px wide. The Artifact output (no flag) leaves both to its frame.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const page = args.includes('--page');
const [dist = 'dist', out = page ? 'dist/play.html' : 'dist/artifact.html'] = args.filter((a) => a !== '--page');
let html = readFileSync(join(dist, 'index.html'), 'utf8');
html = html.replace(/<link rel="stylesheet"[^>]*href="\.\/(assets\/[^"]+\.css)"[^>]*>/g, (_, p) =>
  `<style>${readFileSync(join(dist, p), 'utf8')}</style>`);
html = html.replace(/<script type="module"[^>]*src="\.\/(assets\/[^"]+\.js)"[^>]*><\/script>/g, (_, p) => '__SCRIPT__' + p);
const scriptPath = (html.match(/__SCRIPT__(\S+?\.js)/) || [])[1];
html = html.replace(/__SCRIPT__\S+?\.js/, '');
const js = readFileSync(join(dist, scriptPath), 'utf8').replace(/<\/script/gi, '<\\/script');
const head = html.match(/<head>([\s\S]*?)<\/head>/)[1]
  .replace(/<meta charset[^>]*>/, '')
  .replace(/<meta name="viewport"[^>]*>/, '');
const body = html.match(/<body>([\s\S]*?)<\/body>/)[1];
const meta = page
  ? '<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
  : '';
writeFileSync(out, `${meta}${head.trim()}\n${body.trim()}\n<script type="module">${js}</script>\n`);
console.log('wrote', out, (readFileSync(out).length / 1024).toFixed(0) + ' KB');
