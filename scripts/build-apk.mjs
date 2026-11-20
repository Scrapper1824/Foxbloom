// Builds the signed Android TV release APK:  npm run android:apk
// Result: installer/tv/build/Foxbloom.apk (embedded by the TV installer).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { keyDir } from './android-key.mjs';

const root = path.resolve(import.meta.dirname, '..');

/** Same formula as android/app/build.gradle.kts: 0.9.7 -> 907. */
export function versionCodeOf(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!m) throw new Error(`Version "${version}" isn't x.y.z`);
  const [maj, min, pat] = m.slice(1).map(Number);
  return maj * 10000 + min * 100 + pat;
}

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function run(cmd, args, env = process.env) {
  console.log(`$ ${path.basename(cmd)} ${args.join(' ')}`);
  const bat = /\.(bat|cmd)$/i.test(cmd);
  const r = bat ? spawnSync(`"${cmd}" ${args.join(' ')}`, { cwd: root, env, stdio: 'inherit', shell: true }) : spawnSync(cmd, args, { cwd: root, env, stdio: 'inherit' });
  if (r.status !== 0) fail(`"${path.basename(cmd)} ${args.join(' ')}" failed`);
}

function sdkDir() {
  if (process.env.ANDROID_HOME) return process.env.ANDROID_HOME;
  const props = path.join(root, 'android', 'local.properties');
  if (fs.existsSync(props)) {
    const m = /^sdk\.dir=(.*)$/m.exec(fs.readFileSync(props, 'utf8'));
    if (m) return m[1].trim().replace(/\\(.)/g, '$1');
  }
  return null;
}

function apkanalyzer() {
  const sdk = sdkDir();
  const bat = sdk && path.join(sdk, 'cmdline-tools', 'latest', 'bin', 'apkanalyzer.bat');
  return bat && fs.existsSync(bat) ? bat : null;
}

function main() {
  const dir = keyDir();
  if (!fs.existsSync(path.join(dir, 'key.properties'))) {
    fail('No Android signing key: run npm run android:key once (and back up %APPDATA%\\Foxbloom\\android)');
  }
  const npm = process.env.npm_execpath ? [process.execPath, [process.env.npm_execpath]] : ['npm', []];
  run(npm[0], [...npm[1], 'run', 'build', '-w', 'tv']);

  const env = { ...process.env, FOXBLOOM_ANDROID_KEY_DIR: dir };
  const gradlew = path.join(root, 'android', process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
  run(gradlew, ['-p', 'android', 'assembleRelease'], env);

  const built = path.join(root, 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
  if (!fs.existsSync(built)) fail(`Gradle finished but ${built} is missing (is the release build unsigned?)`);

  const version = JSON.parse(fs.readFileSync(path.join(root, 'tv', 'package.json'), 'utf8')).version;
  const expected = versionCodeOf(version);
  const analyzer = apkanalyzer();
  if (!analyzer) fail('apkanalyzer not found (install the Android SDK cmdline-tools) - cannot verify the APK versionCode');
  const r = spawnSync(`"${analyzer}" manifest version-code "${built}"`, { encoding: 'utf8', shell: true });
  const actual = Number((r.stdout || '').trim());
  if (r.status !== 0 || actual !== expected) fail(`APK versionCode is ${r.stdout?.trim() || '?'} but tv/package.json ${version} needs ${expected}`);

  const out = path.join(root, 'installer', 'tv', 'build', 'Foxbloom.apk');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.copyFileSync(built, out);
  console.log(`\nBuilt ${out} (version ${version}, versionCode ${actual})`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
