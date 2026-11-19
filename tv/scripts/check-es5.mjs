// Fails when a built script is not plain ES5 (Tizen 3's Chromium 47 is the floor; the legacy build should lower
// everything). Parses each dist/assets/*.js with acorn at ecmaVersion 5. Optional argument: another folder to check.
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'acorn';

const dir = process.argv[2] ? resolve(process.argv[2]) : fileURLToPath(new URL('../dist/assets/', import.meta.url));
const files = readdirSync(dir).filter((f) => f.endsWith('.js'));
if (!files.length) {
  console.error('no scripts found in ' + dir);
  process.exit(1);
}
let bad = 0;
for (const f of files) {
  try {
    parse(readFileSync(join(dir, f), 'utf8'), { ecmaVersion: 5, sourceType: 'script' });
  } catch (e) {
    console.error(f + ' is not ES5: ' + e.message);
    bad++;
  }
}
if (bad) process.exit(1);
console.log('JS ok for ES5 (' + files.length + ' file' + (files.length === 1 ? '' : 's') + ')');
