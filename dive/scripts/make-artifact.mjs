// Inline the Vite build into one HTML body fragment for single-file hosting (claude.ai Artifact).
// Usage: node scripts/make-artifact.mjs dist out.html
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [dist = 'dist', out = 'dist/artifact.html'] = process.argv.slice(2);
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
writeFileSync(out, `${head.trim()}\n${body.trim()}\n<script type="module">${js}</script>\n`);
console.log('wrote', out, (readFileSync(out).length / 1024).toFixed(0) + ' KB');
