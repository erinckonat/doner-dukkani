// Turns the Vite build into one self-contained page for publishing as a claude.ai artifact:
// JS and CSS are inlined (the artifact CSP only admits scripts from a few CDNs), the
// document wrapper tags are dropped (the publisher adds its own skeleton), and the title
// moves to the top. The crowd recording ships alongside as sfx/restaurant.mp4.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const dist = 'dist';
let html = readFileSync(`${dist}/index.html`, 'utf8');

html = html.replace(/<script type="module" crossorigin src="\.\/(assets\/[^"]+\.js)"><\/script>/, (_, f) =>
  `<script type="module">${readFileSync(`${dist}/${f}`, 'utf8').replace(/<\/script/gi, '<\\/script')}</script>`);
html = html.replace(/<link rel="stylesheet" crossorigin href="\.\/(assets\/[^"]+\.css)">/, (_, f) =>
  `<style>${readFileSync(`${dist}/${f}`, 'utf8')}</style>`);

const title = html.match(/<title>.*?<\/title>/)[0];
html = html
  .replace(/<!doctype html>/i, '')
  .replace(/<\/?html[^>]*>/gi, '')
  .replace(/<\/?head>/gi, '')
  .replace(/<\/?body>/gi, '')
  .replace(/<meta charset="utf-8" \/>/i, '')
  .replace(/<meta name="viewport"[^>]*>/i, '')
  .replace(title, '');
html = `${title}\n${html.trim()}\n`;

if (/src="\.\/assets|href="\.\/assets/.test(html)) throw new Error('an asset was not inlined');
mkdirSync('artifact/sfx', { recursive: true });
writeFileSync('artifact/doner-dukkani.html', html);
writeFileSync('artifact/sfx/restaurant.mp4', readFileSync(`${dist}/sfx/restaurant.mp4`));
console.log(`artifact/doner-dukkani.html ${(html.length / 1024).toFixed(0)} KB`);
