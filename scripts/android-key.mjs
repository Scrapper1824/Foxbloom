// Creates the Android release signing key, once.  Run:  npm run android:key
//
// The key lives outside the repo, in %APPDATA%\Foxbloom\android (or FOXBLOOM_ANDROID_KEY_DIR).
// Every update of the Android TV app must be signed with the same key, so back that folder up and never replace it.
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** Where the keystore and key.properties live. */
export function keyDir() {
  return process.env.FOXBLOOM_ANDROID_KEY_DIR || path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Foxbloom', 'android');
}

function keytoolPath() {
  const exe = process.platform === 'win32' ? 'keytool.exe' : 'keytool';
  if (process.env.JAVA_HOME) {
    const p = path.join(process.env.JAVA_HOME, 'bin', exe);
    if (fs.existsSync(p)) return p;
  }
  return exe; // on PATH
}

function main() {
  const dir = keyDir();
  const storeFile = path.join(dir, 'foxbloom.jks');
  if (fs.existsSync(storeFile) || fs.existsSync(path.join(dir, 'key.properties'))) {
    console.error(`A Foxbloom signing key already exists in ${dir}. Back it up; never replace it (apps signed with a new key cannot update the old one).`);
    process.exit(1);
  }
  fs.mkdirSync(dir, { recursive: true });
  const password = crypto.randomBytes(32).toString('hex');
  const r = spawnSync(
    keytoolPath(),
    [
      '-genkeypair', '-keystore', storeFile, '-storetype', 'PKCS12',
      '-keyalg', 'RSA', '-keysize', '4096', '-validity', '36500', '-alias', 'foxbloom',
      '-dname', 'CN=Foxbloom TV, O=Foxbloom',
      '-storepass:env', 'FOXBLOOM_KEY_PW', '-keypass:env', 'FOXBLOOM_KEY_PW',
    ],
    { env: { ...process.env, FOXBLOOM_KEY_PW: password }, stdio: ['ignore', 'inherit', 'inherit'] },
  );
  if (r.status !== 0) {
    fs.rmSync(storeFile, { force: true });
    console.error('keytool failed (is a JDK installed? set JAVA_HOME).');
    process.exit(1);
  }
  const esc = (s) => s.replace(/\\/g, '\\\\');
  fs.writeFileSync(
    path.join(dir, 'key.properties'),
    `storeFile=${esc(storeFile)}\nstorePassword=${password}\nkeyAlias=foxbloom\nkeyPassword=${password}\n`,
  );
  console.log(`Created the Foxbloom Android signing key in ${dir}`);
  console.log('BACK UP THIS FOLDER NOW (foxbloom.jks and key.properties). If it is lost, installed TVs cannot be updated; never replace it.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
