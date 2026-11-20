import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
import { versionCodeOf } from './build-apk.mjs';
import { keyDir } from './android-key.mjs';

test('versionCodeOf = major*10000 + minor*100 + patch', () => {
  assert.equal(versionCodeOf('0.9.7'), 907);
  assert.equal(versionCodeOf('1.2.30'), 10230);
});

test('versionCodeOf rejects anything that is not x.y.z', () => {
  assert.throws(() => versionCodeOf('1.0'));
  assert.throws(() => versionCodeOf('a.b.c'));
});

test('keyDir honours FOXBLOOM_ANDROID_KEY_DIR', () => {
  const old = process.env.FOXBLOOM_ANDROID_KEY_DIR;
  process.env.FOXBLOOM_ANDROID_KEY_DIR = path.join(os.tmpdir(), 'fb-test-keys');
  try {
    assert.equal(keyDir(), path.join(os.tmpdir(), 'fb-test-keys'));
  } finally {
    if (old === undefined) delete process.env.FOXBLOOM_ANDROID_KEY_DIR;
    else process.env.FOXBLOOM_ANDROID_KEY_DIR = old;
  }
});

test('keyDir defaults to Foxbloom/android under APPDATA', () => {
  const old = process.env.FOXBLOOM_ANDROID_KEY_DIR;
  delete process.env.FOXBLOOM_ANDROID_KEY_DIR;
  try {
    assert.equal(keyDir(), path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "Foxbloom", "android"));
  } finally {
    if (old !== undefined) process.env.FOXBLOOM_ANDROID_KEY_DIR = old;
  }
});
