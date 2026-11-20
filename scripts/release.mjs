// Publishes a new Foxbloom release on GitHub, which every install then offers as "Update available".
//
//   npm run release -- patch      0.1.0 -> 0.1.1  (fixes)
//   npm run release -- minor      0.1.0 -> 0.2.0  (new features)
//   npm run release -- major      0.1.0 -> 1.0.0
//   npm run release -- patch --dry-run   shows what would happen
//
// It refuses to run with uncommitted changes or off main, builds and tests first, then bumps the
// version, commits, tags, pushes and creates the GitHub Release (notes = the commits since the last one).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { keyDir } from './android-key.mjs';

const root = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const kind = args.find((a) => !a.startsWith('--'));

/** The next version for a bump kind; throws on anything else. */
export function nextVersion(current, bump) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(current);
  if (!m) throw new Error(`Current version "${current}" isn't x.y.z`);
  const [maj, min, pat] = m.slice(1).map(Number);
  if (bump === 'major') return `${maj + 1}.0.0`;
  if (bump === 'minor') return `${maj}.${min + 1}.0`;
  if (bump === 'patch') return `${maj}.${min}.${pat + 1}`;
  throw new Error('Say which kind of release: patch, minor or major (e.g. "npm run release -- patch")');
}

const npmCli = process.env.npm_execpath;
function run(file, fileArgs, { capture = false, onFail } = {}) {
  const [cmd, cmdArgs] = file === 'npm' && npmCli ? [process.execPath, [npmCli, ...fileArgs]] : [file, fileArgs];
  if (!capture) console.log(`$ ${file} ${fileArgs.join(' ')}`);
  if (dryRun && !capture) return '';
  const r = spawnSync(cmd, cmdArgs, { cwd: root, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit' });
  if (r.status !== 0) {
    console.error(`\n"${file} ${fileArgs.join(' ')}" failed${r.stderr ? `: ${r.stderr.trim()}` : ''}`);
    if (onFail) onFail();
    process.exit(1);
  }
  return (r.stdout ?? '').trim();
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/').replace(/^\//, '')}`) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  let version;
  try {
    version = nextVersion(pkg.version, kind);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
  const tag = `v${version}`;
  if (run('git', ['status', '--porcelain'], { capture: true })) {
    console.error('There are uncommitted changes. Commit them first, so the release contains exactly what is on GitHub.');
    process.exit(1);
  }
  const branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { capture: true });
  if (branch !== 'main') {
    console.error(`Releases are made from main (you're on "${branch}").`);
    process.exit(1);
  }
  // FoxbloomTVSetup.exe goes on every release: stop now, before anything is published, if its vendor files or the
  // Android signing key (for the APK inside it) are missing.
  if (process.platform === 'win32') {
    const need = ['sdb.exe', 'vd_tizen_dev_author_ca.cer', 'vd_tizen_dev_public2.crt', 'adb.exe', 'AdbWinApi.dll', 'AdbWinUsbApi.dll'];
    const missing = need.filter((f) => !fs.existsSync(path.join(root, 'installer', 'tv', 'vendor', f)));
    if (missing.length) {
      console.error(`Cannot release: these files are missing from installer/tv/vendor/ (needed for FoxbloomTVSetup.exe): ${missing.join(', ')}.
See installer/tv/vendor/README.md for where each comes from.`);
      process.exit(1);
    }
    if (!fs.existsSync(path.join(keyDir(), 'key.properties'))) {
      console.error(`Cannot release: the Android signing key is missing from ${keyDir()} (needed to sign the Android TV app).
Restore it from your backup; only if there has never been one, run npm run android:key.`);
      process.exit(1);
    }
  }
  console.log(`Releasing Foxbloom ${tag} (was v${pkg.version})${dryRun ? ' — dry run, nothing will change' : ''}\n`);

  run('npm', ['run', 'build']);
  run('npm', ['test']);
  const versionFiles = ['package.json', 'package-lock.json', 'server/package.json', 'web/package.json', 'tv/package.json'];
  run('npm', ['version', version, '--no-git-tag-version', '--workspaces', '--include-workspace-root']);
  // FoxbloomTVSetup.exe is built now, before anything is committed or published, so a TV app (tsc, CSS/ES5 check) or
  // installer (csc, vendor hash) error stops the release here instead of after the push. It is built after the version
  // bump (so far only in the working tree) because the exe embeds tv/package.json's version; if the build fails, the
  // bump is undone and the tree is as it was.
  // The Android TV APK it embeds is built first, after the bump too, because its versionCode comes from tv/package.json.
  const tvSetup = path.join(root, 'installer', 'dist', 'FoxbloomTVSetup.exe');
  if (process.platform === 'win32') {
    const undoBump = () => {
      spawnSync('git', ['checkout', '--', ...versionFiles], { cwd: root, stdio: 'inherit' });
      console.error('Nothing was committed or published; the version bump was undone.');
    };
    run('npm', ['run', 'android:apk'], { onFail: undoBump });
    run('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'installer', 'tv', 'build.ps1')], {
      onFail: undoBump,
    });
  }
  run('git', ['add', ...versionFiles]);
  run('git', ['commit', '-m', `Release ${tag}`]);
  run('git', ['tag', '-a', tag, '-m', `Foxbloom ${tag}`]);
  run('git', ['push', 'origin', 'main', tag]);
  run('gh', ['release', 'create', tag, '--title', `Foxbloom ${tag}`, '--generate-notes', '--verify-tag']);
  // The Windows installer (FoxbloomSetup.exe) goes on every release, so "latest/download/FoxbloomSetup.exe" always works.
  if (process.platform === 'win32') {
    run('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'installer', 'build.ps1')]);
    const setup = path.join(root, 'installer', 'dist', 'FoxbloomSetup.exe');
    // Only the two installers go on a release. The TV installer (built above, before the push) carries sdb's
    // and adb's Apache-2.0 notices inside it (its "Licences" link), so no separate notice file is uploaded.
    run('gh', ['release', 'upload', tag, setup, tvSetup, '--clobber']);
  }
  console.log(`\nReleased ${tag}. Foxbloom installs will offer it as an update.`);
}
