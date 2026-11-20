# Foxbloom Android TV App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the existing Foxbloom TV web app on Google TV / Android TV inside a small Android app that plays video with ExoPlayer, installed from the PC by FoxbloomTVSetup.exe.

**Architecture:** A Kotlin app (`android/`) shows the built `tv/dist` in a transparent WebView over a Media3 ExoPlayer surface and exposes a `FoxbloomAndroid` JavaScript bridge. The TV web app gets a third `TvPlayer` (`player/android.ts`) and small platform hooks that use the bridge when present. FoxbloomTVSetup.exe gains an adb-driven Android path (find, pair, install) next to the Samsung one, with the signed APK and Google's `adb.exe` embedded.

**Tech Stack:** Kotlin, Gradle (Android Gradle Plugin, current stable), AndroidX WebKit (`WebViewAssetLoader`), AndroidX Media3 (`media3-exoplayer`, `media3-exoplayer-hls`, `media3-ui`); Preact/TypeScript + Vitest (`tv/`); .NET Framework 4 C# with Windows' csc (`installer/tv`); Node (`scripts/`).

**Spec:** `docs/superpowers/specs/2026-11-20-android-tv-app-design.md`

## Global Constraints

- Package name `org.foxbloom.tv`, never changed. `minSdk 24`, `targetSdk`/`compileSdk 35` (SDK platform installed: `platforms;android-35`, build-tools `37.0.0`).
- Android SDK at `%LOCALAPPDATA%\Android\Sdk`; build with JDK 21 (`C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot`). Emulator AVD `foxbloom_tv` (Android TV 16, 1080p) exists.
- `versionName` = `tv/package.json` version; `versionCode` = major·10000 + minor·100 + patch (0.9.7 → 907).
- Signing key lives in `%APPDATA%\Foxbloom\android\` (`foxbloom-release.jks` + `key.properties`), never in git. A release without it stops with an error.
- The GitHub release still uploads only FoxbloomSetup.exe and FoxbloomTVSetup.exe; the APK is embedded in FoxbloomTVSetup.exe.
- No change in look or behaviour of the Samsung app; one `tv` bundle (ES5 + legacy polyfills) serves both TVs.
- No FFmpeg/NDK in the app. Caps report AC3/E-AC3/DTS only when the device decodes them or can pass them through.
- Installer supports Android 11+ (Wireless debugging, pairing code) and older TVs with network adb on port 5555; anything else gets the "can't be set up from the PC" page. No USB path.
- Installer stays .NET Framework 4 C#, no NuGet; it runs the embedded `adb.exe`.
- Work on branch `android-tv`; never commit `data/`, keys, or vendor binaries.

## Review Focus

1. **A TV that already has a Foxbloom signed with another key** (e.g. a debug build) → install fails with "remove the old Foxbloom from the TV first", not a raw adb error. Test in Task 6.
2. **A wrong or expired pairing code** → "That code didn't work. Codes change each time you open the pairing screen; open it again and type the new one." Test in Task 6.
3. **Back on the remote** → goes back one screen; at the first screen it closes the app; while playing it leaves the player like Samsung's Back. Checked on the emulator in Task 3.
4. **720p and 4K TVs** → the 1920-px layout fills the screen exactly, no clipping or scroll. Checked on the emulator at 1280×720 and 3840×2160 in Task 3.
5. **The stream fails mid-playback** (server offline, file gone) → the existing "The video stopped playing" screen with Try again, not a frozen picture. Test in Task 2.

---

### Task 1: Android platform hooks in the TV web app

**Files:**
- Create: `tv/src/platform.ts`, `tv/src/platform.test.ts`
- Modify: `tv/src/app.tsx:28` (exit), `tv/src/screens/AddPerson.tsx:17` (model), `tv/src/player/caps.ts` (`detectCaps`), `tv/src/player/caps.test.ts`

**Interfaces:**
- Produces:
  - `interface AndroidBridge { open(url: string, startMs: number): void; play(): void; pause(): void; seek(ms: number): void; time(): number; duration(): number; audioTracks(): string; setAudio(index: number): void; close(): void; caps(): string; model(): string; exit(): void; }` (all ms; `audioTracks`/`caps` return JSON text).
  - `androidBridge(win?: { FoxbloomAndroid?: AndroidBridge }): AndroidBridge | null` in `platform.ts`.
  - `detectCaps(env)` returns the bridge's caps (parsed, with `switchesAudio: true`, `forceConvert: false` forced) when `env.FoxbloomAndroid` exists; `CapsEnv` gains `FoxbloomAndroid?: AndroidBridge`.
- Remote keys need no change: the Android app sends Back and media keys as the Tizen key codes `remote.ts` already maps (10009, 415, 19, 10252, 417, 412).

- [ ] **Step 1: Write failing tests** — `platform.test.ts`: `androidBridge({})` is null; returns the object when `FoxbloomAndroid` is set. `caps.test.ts`: `detectCaps({ FoxbloomAndroid: fake })` where `fake.caps()` returns `'{"mp4":true,"mkv":true,"h264":true,"hevc":true,"av1":false,"vp9":true,"aac":true,"mp3":true,"opus":true,"flac":true,"ac3":false,"eac3":true,"dts":false,"webm":true}'` equals that object plus `switchesAudio: true, forceConvert: false`; a `caps()` that throws or returns bad JSON falls back to the existing non-Tizen result.
- [ ] **Step 2: Run** `npx vitest run src/platform.test.ts src/player/caps.test.ts` in `tv/` — expect FAIL.
- [ ] **Step 3: Implement** `platform.ts`; branch at the top of `detectCaps`; `app.tsx` exit calls `androidBridge()!.exit()` when present (before the Tizen check); `AddPerson.tsx` model uses `androidBridge().model()` when present.
- [ ] **Step 4: Run** `npm test -w tv` — all pass; `npm run build -w tv` — "JS ok for ES5".
- [ ] **Step 5: Commit** `git commit -m "TV app: Android bridge hooks for caps, exit and model name"`

### Task 2: `TvPlayer` on the Android bridge

**Files:**
- Create: `tv/src/player/android.ts`, `tv/src/player/android.test.ts`
- Modify: `tv/src/screens/Player.tsx:18` (`defaultPlayer`)

**Interfaces:**
- Consumes: `AndroidBridge`, `androidBridge()` (Task 1); `TvPlayer` (`tv/src/player/types.ts`).
- Produces:
  - `androidPlayer(bridge: AndroidBridge, win?: Window): TvPlayer` (`name`-less, same contract as `avPlayer`).
  - Native→page events: the app calls `window.__foxbloomPlayer(event: string, arg: string)`; events: `'ready'` (prepared and at the start point), `'buffering'` (`'1'`/`'0'`), `'ended'`, `'error'` (message), `'seeked'` (`'1'` landed / `'0'` failed). `androidPlayer` installs this global on creation and removes it on `close()`.
  - `defaultPlayer = () => androidBridge() ? androidPlayer(androidBridge()!) : hasAvPlay() ? avPlayer() : html5Player()`.

- [ ] **Step 1: Write failing tests** (fake bridge recording calls; tests fire events through `window.__foxbloomPlayer`):
  - `open('https://s/x?st=1', 12.5)` calls `bridge.open('https://s/x?st=1', 12500)` and resolves only after `'ready'`.
  - `open` rejects when `'error'` arrives before `'ready'`; an `'error'` after `'ready'` calls the `onError` callback with the message (Review Focus 5).
  - `seek(30)` calls `bridge.seek(30000)` and resolves `true` on `'seeked','1'`, `false` on `'seeked','0'`.
  - `time()`/`duration()` convert ms to seconds (`bridge.time()` 61500 → 61.5).
  - `audioTracks()` parses `'[{"index":1,"language":"jpn"}]'`; bad JSON → `[]`.
  - `'buffering','1'`/`'0'` → `onBuffering(true/false)`; `'ended'` → `onEnded`.
  - `close()` calls `bridge.close()` and deletes `window.__foxbloomPlayer`.
- [ ] **Step 2: Run** `npx vitest run src/player/android.test.ts` — FAIL.
- [ ] **Step 3: Implement** `android.ts` and the `defaultPlayer` change.
- [ ] **Step 4: Run** `npm test -w tv` and `npm run build -w tv` — pass.
- [ ] **Step 5: Commit** `git commit -m "TV app: ExoPlayer-backed TvPlayer for Android"`

### Task 3: Android app shell (WebView + assets + keys + scaling)

**Files:**
- Create: `android/settings.gradle.kts`, `android/build.gradle.kts`, `android/gradle.properties`, Gradle wrapper (`gradlew`, `gradlew.bat`, `gradle/wrapper/*`), `android/app/build.gradle.kts`, `android/app/src/main/AndroidManifest.xml`, `android/app/src/main/java/org/foxbloom/tv/MainActivity.kt`, `android/app/src/main/java/org/foxbloom/tv/Keys.kt`, `android/app/src/main/res/` (banner 320×180 and launcher icon from the Foxbloom logo, `values/strings.xml` app name "Foxbloom"), `android/app/src/test/java/org/foxbloom/tv/KeysTest.kt`, `android/local.properties` (git-ignored, `sdk.dir`), `android/README.md`
- Modify: `.gitignore` (`android/.gradle/`, `android/build/`, `android/app/build/`, `android/local.properties`, `android/app/src/main/assets/web/`)

**Interfaces:**
- Produces:
  - Gradle task `copyWeb` (runs before `preBuild`): copies `../tv/dist` into `app/src/main/assets/web/`; fails with "Build the TV app first: npm run build -w tv" if `tv/dist/index.html` is missing.
  - `versionName`/`versionCode` read from `../tv/package.json` (Global Constraints formula).
  - The page loads from `https://appassets.androidplatform.net/assets/web/index.html` through `WebViewAssetLoader`; navigation to any other origin is blocked in `shouldOverrideUrlLoading`.
  - `fun tizenKeyCode(androidKeyCode: Int): Int?` in `Keys.kt`: `KEYCODE_BACK`→10009, `KEYCODE_MEDIA_PLAY`→415, `KEYCODE_MEDIA_PAUSE`→19, `KEYCODE_MEDIA_PLAY_PAUSE`→10252, `KEYCODE_MEDIA_FAST_FORWARD`→417, `KEYCODE_MEDIA_REWIND`→412, others null. `MainActivity.dispatchKeyEvent` turns those into a page `keydown` (`dispatchEvent(new KeyboardEvent... keyCode)` via a tiny injected helper) and consumes them; D-pad, OK and digits go to the WebView as usual.
  - A bridge stub `FoxbloomAndroid` with `model()` (`Build.MANUFACTURER + " " + Build.MODEL`) and `exit()` (`finish()`); the player methods arrive in Task 4.
- WebView settings: JavaScript and DOM storage on, transparent background, `setInitialScale` so 1920 CSS px = screen width (`screenWidthPx * 100 / 1920`), media playback without user gesture.
- Manifest: `LEANBACK_LAUNCHER` + `LAUNCHER` intent filters, `android:banner`, `uses-feature android.software.leanback required=false`, `android.hardware.touchscreen required=false`, `INTERNET` permission, `usesCleartextTraffic=true` (home servers on http://192.168.x.x).

- [ ] **Step 1: Write failing test** `KeysTest`: each mapping above, and `KEYCODE_DPAD_UP` → null.
- [ ] **Step 2: Run** `android\gradlew.bat -p android testDebugUnitTest` — FAIL (no `tizenKeyCode`).
- [ ] **Step 3: Implement** the project, `Keys.kt`, `MainActivity.kt`, resources.
- [ ] **Step 4: Run** `npm run build -w tv` then `android\gradlew.bat -p android testDebugUnitTest assembleDebug` — tests pass, `android/app/build/outputs/apk/debug/app-debug.apk` exists.
- [ ] **Step 5: Emulator check** — start `foxbloom_tv`, `adb install -r` the debug APK, `adb shell am start -n org.foxbloom.tv/.MainActivity`, `adb exec-out screencap -p > shot.png`: the Connect screen fills the screen. Repeat with `adb shell wm size 1280x720` and `3840x2160` (then `wm size reset`) — no clipping or scrollbars (Review Focus 4). `adb shell input keyevent KEYCODE_BACK` on the first screen closes the app (Review Focus 3).
- [ ] **Step 6: Commit** `git commit -m "Android TV app shell: WebView with the TV app, remote keys, 1080p scaling"`

### Task 4: ExoPlayer and the player bridge

**Files:**
- Create: `android/app/src/main/java/org/foxbloom/tv/PlayerBridge.kt`, `android/app/src/main/java/org/foxbloom/tv/Caps.kt`, `android/app/src/test/java/org/foxbloom/tv/CapsTest.kt`
- Modify: `MainActivity.kt` (layout: `PlayerView` under the WebView; register the bridge), `android/app/build.gradle.kts` (Media3 dependencies)

**Interfaces:**
- Consumes: the bridge contract and event names from Tasks 1–2 (must match exactly).
- Produces:
  - `PlayerBridge` implements every `AndroidBridge` method as `@JavascriptInterface`, hopping to the main thread; numbers in ms; `audioTracks()` returns `[{"index":n,"language":"xx"}]` in file order; `setAudio(index)` selects that track via track-selection overrides.
  - Events via `webView.evaluateJavascript("window.__foxbloomPlayer&&window.__foxbloomPlayer('ready','')")` etc.: `'ready'` after `STATE_READY` the first time and the start-point seek is done; `'buffering'` on `STATE_BUFFERING`/`READY`; `'ended'` on `STATE_ENDED`; `'error'` with `PlaybackException.errorCodeName`; `'seeked'` `'1'` on `onPositionDiscontinuity(DISCONTINUITY_REASON_SEEK)` landing within 5 s of the target, else `'0'`.
  - `fun capsJson(decoders: Set<String>, passthrough: Set<String>): String` in `Caps.kt` (pure, testable). `decoders` = MIME types from `MediaCodecList(REGULAR_CODECS)` decoders; `passthrough` = encodings from `AudioCapabilities` (`"ac3"`, `"eac3"`, `"dts"`). Fields: `mp4`, `mkv`, `webm` true; `h264` ← `video/avc`; `hevc` ← `video/hevc`; `av1` ← `video/av01`; `vp9` ← `video/x-vnd.on2.vp9`; `aac`, `mp3`, `opus`, `flac` true (ExoPlayer software decoders); `ac3` ← `audio/ac3` decoder or passthrough `ac3`; `eac3` ← `audio/eac3` or passthrough `eac3`; `dts` ← `audio/vnd.dts` or passthrough `dts`.

- [ ] **Step 1: Write failing tests** `CapsTest`: decoders `{video/avc, video/hevc}`, passthrough `{}` → `hevc` true, `av1` false, `ac3`/`eac3`/`dts` false; passthrough `{"eac3"}` → `eac3` true, `ac3` false; decoders containing `audio/ac3` → `ac3` true.
- [ ] **Step 2: Run** `android\gradlew.bat -p android testDebugUnitTest` — FAIL.
- [ ] **Step 3: Implement** `Caps.kt`, `PlayerBridge.kt`, layout change.
- [ ] **Step 4: Run** unit tests — pass; `assembleDebug` — succeeds.
- [ ] **Step 5: Emulator check** against a local test server (never the owner's real instance): `npm start` with a test data dir on port 7990, sign in with a test account, play a test MKV: it plays, Right+wait jumps 10 s, a resume starts at the saved spot, the audio menu switches tracks, Back leaves the player (Review Focus 3).
- [ ] **Step 6: Commit** `git commit -m "Android TV app: ExoPlayer playback through the JavaScript bridge"`

### Task 5: Signing key, release APK build

**Files:**
- Create: `scripts/android-key.mjs`, `scripts/build-apk.mjs`, `scripts/android.test.mjs`
- Modify: `android/app/build.gradle.kts` (release `signingConfig`), `android/README.md`, `package.json` (scripts `android:key`, `android:apk`, test glob)

**Interfaces:**
- Produces:
  - `keyDir()` → `process.env.FOXBLOOM_ANDROID_KEY_DIR || %APPDATA%\Foxbloom\android`; `key.properties` keys: `storeFile`, `storePassword`, `keyAlias=foxbloom`, `keyPassword`.
  - `npm run android:key`: runs JDK `keytool -genkeypair -keyalg RSA -keysize 4096 -validity 36500 -alias foxbloom` with a random 32-byte password; refuses if the keystore already exists ("A Foxbloom signing key already exists… back it up; never replace it"); prints the back-up reminder.
  - `npm run android:apk`: builds `tv`, runs `gradlew assembleRelease` with `FOXBLOOM_ANDROID_KEY_DIR`, copies the result to `installer/tv/build/Foxbloom.apk`; exits 1 with "No Android signing key: run npm run android:key once (and back up %APPDATA%\Foxbloom\android)" when `key.properties` is missing.
  - `versionCodeOf(version: string): number` exported from `build-apk.mjs` (also used by Gradle's equivalent).
- [ ] **Step 1: Write failing tests** (`node --test scripts/android.test.mjs`): `versionCodeOf('0.9.7') === 907`, `versionCodeOf('1.2.30') === 10230`, `versionCodeOf('1.0') ` throws; `keyDir()` honours `FOXBLOOM_ANDROID_KEY_DIR`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** both scripts and the Gradle `signingConfig` (reads `key.properties` from `keyDir()`; release build fails when missing).
- [ ] **Step 4: Run** tests — pass. Run `npm run android:key` (creates the owner's key) then `npm run android:apk` — `installer/tv/build/Foxbloom.apk` exists; `apksigner verify --print-certs` shows the Foxbloom certificate. Add `installer/tv/build/` to `.gitignore`.
- [ ] **Step 5: Commit** `git commit -m "Android TV app: release signing and APK build scripts"`

### Task 6: `Adb` wrapper in the installer

**Files:**
- Create: `installer/tv/Adb.cs`, `installer/tv/tests/AdbTests.cs`
- Modify: `installer/tv/test.ps1` (add `Adb.cs` to `$sources`)

**Interfaces:**
- Consumes: `TvInstallException`, `SdbResult`, `ISdbRunner`, `SdbProcessRunner` patterns from `Sdb.cs` (reuse the runner types; `Adb` takes an `ISdbRunner`).
- Produces (`public sealed class Adb`):
  - `const string PackageName = "org.foxbloom.tv"`, `const string Activity = "org.foxbloom.tv/.MainActivity"`.
  - `static Adb Embedded()` — extracts `adb.exe`, `AdbWinApi.dll`, `AdbWinUsbApi.dll` resources into one temp folder (like `Sdb.Extract`).
  - `void Pair(string hostPort, string code)` — `adb pair <hostPort> <code>`; success on "Successfully paired".
  - `void Connect(string hostPort)` — `adb connect <hostPort>`; success on "connected to"/"already connected".
  - `AndroidTvInfo Describe(string hostPort)` — `adb -s <hostPort> shell getprop ro.product.manufacturer|ro.product.model|ro.build.version.sdk`.
  - `void Install(string hostPort, string apkPath)` — `adb -s <hostPort> install -r <apk>` (keeps data) then `adb -s <hostPort> shell am start -n org.foxbloom.tv/.MainActivity`.
  - `void Stop()` — `adb kill-server`.
  - `class AndroidTvInfo { string Target, Name, Model; int Sdk; }`.
  - Plain messages (thrown as `TvInstallException`):
    - pair failure (wrong/expired code): "That code didn't work. Codes change each time you open the pairing screen; open it again and type the new one." (Review Focus 2)
    - connect `refused`/`failed to connect`: "The TV didn't answer at <hostPort>. Check Wireless debugging (or Network debugging) is still on and the address matches the TV's screen."
    - `unauthorized`/`failed to authenticate`: "The TV hasn't allowed this PC yet. Choose Allow (tick Always allow) on the TV, then try again."
    - `INSTALL_FAILED_UPDATE_INCOMPATIBLE`: "This TV already has a Foxbloom signed by someone else (for example a test build). Remove Foxbloom from the TV (Settings > Apps), then try again." (Review Focus 1)
    - `INSTALL_FAILED_OLDER_SDK`: "This TV's Android is too old for Foxbloom (it needs Android 7 or newer)."
    - `INSTALL_FAILED_INSUFFICIENT_STORAGE`: "The TV is out of space. Remove an app you don't use, then try again."
- [ ] **Step 1: Write failing tests** in `AdbTests.cs` with a `FakeAdb : ISdbRunner`: exact command lines for pair/connect/describe/install (install line contains `install -r`); each failure output above maps to its message; `Describe` parses `"Google\r\n"`, `"Chromecast\r\n"`, `"34\r\n"` → Name "Google Chromecast", Sdk 34.
- [ ] **Step 2: Run** `powershell -ExecutionPolicy Bypass -File installer\tv\test.ps1` — FAIL (no `Adb`).
- [ ] **Step 3: Implement** `Adb.cs`.
- [ ] **Step 4: Run** test.ps1 — all pass.
- [ ] **Step 5: Commit** `git commit -m "TV setup: adb wrapper with plain-language failures"`

### Task 7: Finding Android TVs

**Files:**
- Create: `installer/tv/AndroidDiscovery.cs`, `installer/tv/tests/AndroidDiscoveryTests.cs`
- Modify: `installer/tv/test.ps1` (`$sources`)

**Interfaces:**
- Consumes: `Adb` (Task 6), `TvDiscovery.SelectSweepAdapters`, `TvDiscovery.LocalAdapters`, `TvDiscovery.ProbeOpen(hosts, port, budget)`.
- Produces (`public static class AndroidDiscovery`):
  - `class AndroidTarget { string Ip; int ConnectPort; int PairPort; bool Wireless; }` (`PairPort` 0 when unknown; `Wireless` false = classic port 5555).
  - `static List<AndroidTarget> ParseMdns(string adbMdnsServicesOutput)` — lines `<name>\t_adb-tls-connect._tcp\t<ip>:<port>` and `_adb-tls-pairing._tcp`, merged per IP.
  - `static List<AndroidTarget> Find(Adb adb, TimeSpan timeout)` — `adb mdns services` merged with hosts answering on port 5555 in the sweep (`Wireless=false, ConnectPort=5555`), de-duplicated by IP.
- [ ] **Step 1: Write failing tests** for `ParseMdns`: a sample with one TV advertising both services → one target with both ports; garbage lines ignored; empty output → empty list.
- [ ] **Step 2: Run** test.ps1 — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** test.ps1 — pass.
- [ ] **Step 5: Commit** `git commit -m "TV setup: find Android TVs (wireless debugging and port 5555)"`

### Task 8: Installer pages and packaging

**Files:**
- Modify: `installer/tv/FoxbloomTvSetup.cs` (scan, list, new Android pages), `installer/tv/build.ps1` (embed APK + adb vendor files), `installer/tv/vendor.sha256` (three new lines), `installer/tv/vendor/README.md`, `installer/tv/THIRD-PARTY.txt` (adb notice), `scripts/release.mjs`, `tv/README.md` (Android section)

**Interfaces:**
- Consumes: `Adb`, `AndroidDiscovery`, `AndroidTarget`, `AndroidTvInfo` (Tasks 6–7); `installer/tv/build/Foxbloom.apk` (Task 5).
- Produces:
  - Scan page title "Looking for TVs…"; the Samsung and Android scans run in parallel; list rows say "Samsung TV" or "Android TV".
  - Pages: **Android setup help** (Developer options: Settings > System > About > press Build 7 times; then Developer options > Wireless debugging > Pair device with pairing code; older TVs: Network debugging on), **Pair** (pairing code box, pairing address:port box prefilled from `PairPort`, connection address:port prefilled from `ConnectPort`), **Allow on the TV** (classic 5555 path: "Choose Allow on the TV"), **Installing**, **Done** ("You can turn Wireless debugging off again; you'll pair once more for the next update"), **Failed** (Adb message + Try again), **Unsupported** ("This TV can't be set up from the PC: it has neither Wireless debugging nor Network debugging").
  - "Enter an address" accepts `ip` (tries Samsung, then adb `ip:5555`) or `ip:port` (Android).
  - `build.ps1`: vendor list adds `adb.exe`, `AdbWinApi.dll`, `AdbWinUsbApi.dll` (from `%LOCALAPPDATA%\Android\Sdk\platform-tools`, platform-tools 37.0.3); embeds `installer/tv/build/Foxbloom.apk` as resource `Foxbloom.apk`; without it (and without `-NoVendor`) the build stops: "Build the Android app first: npm run android:apk".
  - `release.mjs`: before building the TV setup, check the key exists (same early stop as the vendor check) and run `npm run android:apk`; uploads stay `setup` + `tvSetup`.
- [ ] **Step 1: Build** `installer\tv\build.ps1` — FAIL until vendor/APK are wired (expected message names the missing files).
- [ ] **Step 2: Implement** pages, packaging, release changes; copy the three adb files into `installer/tv/vendor/` and record their SHA-256 in `vendor.sha256`.
- [ ] **Step 3: Run** `installer\tv\test.ps1` and `npm test` — all pass; `installer\tv\build.ps1` — builds `installer\dist\FoxbloomTVSetup.exe`.
- [ ] **Step 4: End-to-end on the emulator** — start `foxbloom_tv`; in FoxbloomTVSetup.exe use Enter an address `127.0.0.1:5555`: installs, the app opens on the emulator. Run it again: update keeps the app's sign-in (`install -r`). Install a debug-signed APK first, then run the setup: the "signed by someone else" page appears (Review Focus 1).
- [ ] **Step 5: Commit** `git commit -m "TV setup: install Foxbloom on Android TVs"`

---

## Self-review notes

- Spec coverage: app shell (T3), ExoPlayer + bridge + caps (T4, T2), TV-app hooks (T1, T2), installer find/pair/install/messages (T6–T8), signing + versionCode + release (T5, T8), two-file release (T8), no NDK (T4), Android 11+/5555/unsupported (T7, T8), testing on emulator (T3, T4, T8).
- The real Google TV test waits for the owner; the emulator covers the wireless-debugging-free 5555 path only, so the pairing-code path is covered by unit tests until then.
