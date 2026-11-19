// Fails when the built CSS uses something Tizen 3's Chromium 47 cannot read.
import { readdirSync, readFileSync } from 'node:fs';

const dir = new URL('../dist/assets/', import.meta.url);
const banned = [
  ['var(', /var\(/],
  ['inset:', /(^|[^-\w])inset\s*:/],
  ['display:grid', /display\s*:\s*(inline-)?grid/],
  ['gap:', /(^|[^-\w])(row-|column-|grid-)?gap\s*:/],
];
let bad = 0;
// The legacy build injects the stylesheet from the script as a string (createElement("style") ... textContent="..."), so
// check those strings as well as any .css files.
const sheets = [];
for (const f of readdirSync(dir)) {
  const text = readFileSync(new URL(f, dir), 'utf8');
  if (f.endsWith('.css')) sheets.push([f, text]);
  else if (f.endsWith('.js')) {
    const re = /createElement\("style"\);\w+\.textContent=("(?:[^"\\]|\\.)*")/g;
    let m;
    while ((m = re.exec(text))) sheets.push([f, JSON.parse(m[1])]);
  }
}
if (!sheets.length) {
  console.error('no stylesheet found in dist/assets');
  process.exit(1);
}
for (const [f, css] of sheets) {
  for (const [name, re] of banned) {
    if (re.test(css)) {
      console.error('dist/assets/' + f + ' contains ' + name);
      bad++;
    }
  }
}
if (bad) process.exit(1);
console.log('CSS ok for Chromium 47');
