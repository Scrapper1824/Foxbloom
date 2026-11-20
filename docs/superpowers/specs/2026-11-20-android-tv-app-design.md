# Foxbloom on Google TV / Android TV — design

Date: 2026-11-20. Status: draft for approval.

## Why

The owner has a Google TV and wants Foxbloom on it, and on any Android TV, the way it already runs on Samsung TVs:
the same TV app (profiles, PIN, sign-in with a code, rows, player, skip intro, trickplay, quality, auto-skip),
installed from the PC with **FoxbloomTVSetup.exe**. The Samsung work showed that the TV's video player is where
things break (seeking needed three releases), so video should go to a player known to handle MKV, seeking and
surround audio well.

## Goals

- An Android TV app (Google TV, Android TV boxes, TVs running Android TV) that runs the existing TV web app
  (`tv/`) unchanged in look and behaviour, with video played by Android's ExoPlayer (AndroidX Media3).
- FoxbloomTVSetup.exe finds Android TVs on the network, pairs with them, and installs or updates the app, alongside
  what it does for Samsung TVs today.
- Updates install over the old app without losing its sign-ins (same package name, same signing key).

## Non-goals

- Google Play Store, Amazon store, or any other store listing.
- An APK download for sideloading (Downloader app, a link on the server, a separate release asset). The owner chose:
  installs go **only through FoxbloomTVSetup.exe**.
- Phones and tablets. Fire TV (Fire OS is Android and will probably work, but it isn't a target or tested).
- A separate native Android UI.

## Anti-goals (would count as failure even if it works)

- Forking the TV app: a second copy of screens that must be kept in step. Android-only code lives in the Android
  shell and a small player/platform layer in `tv/src`, nothing else.
- Breaking or changing the Samsung app's behaviour.
- More files on the GitHub release: it stays FoxbloomSetup.exe + FoxbloomTVSetup.exe (the APK is inside the TV setup).
- An update that makes people uninstall (and lose sign-ins) because the signing key changed or was lost.

## Approaches considered

- **A. Android shell: a WebView running the TV web app + ExoPlayer for video (chosen).** Reuses every screen; video
  gets a player that plays MKV directly, seeks reliably and handles AC3/E-AC3/DTS. Costs a small Kotlin project and
  a JavaScript↔Android bridge for the player.
- **B. WebView only, the web page's own `<video>`.** Least work, but Android's web player supports fewer formats and
  seeking varies by device: more server conversions and likely a repeat of the Samsung seeking saga.
- **C. A fully native Android TV app.** A second UI to build and maintain forever. Rejected.

The owner picked A.

## Decided by the owner

- Approach A (WebView + ExoPlayer).
- Installation only through FoxbloomTVSetup.exe; no APK download anywhere.
- Must work on any Android TV, not only Google TV.

## Design

### 1. The Android app (`android/` in the repo, new)

- Kotlin, Gradle (Android Gradle Plugin), one Activity, package name `org.foxbloom.tv` (fixed forever: changing it
  makes a different app).
- `minSdk` 24 (Android 7; covers essentially every Android TV still in use), `targetSdk` current. Declared as a TV
  app: `android.software.leanback` required = false, touchscreen not required, `LEANBACK_LAUNCHER` intent, a TV
  banner (from the existing logo) and app icon.
- **Web content:** the built `tv/dist` files are packaged as app assets and served through AndroidX
  `WebViewAssetLoader` at `https://appassets.androidplatform.net/…`, so the page has a normal https origin
  (localStorage, fetch and CORS behave as in a browser). JavaScript and DOM storage on; the WebView background is
  transparent so video drawn underneath shows through, as with Samsung's AVPlay plane.
- **Video:** a Media3 ExoPlayer `PlayerView`/SurfaceView placed **under** the WebView, full screen, with
  `media3-exoplayer`, `-hls` and the default extractors (MKV, MP4, WebM, TS). Subtitles stay as today: the TV app
  draws SRT cues in HTML; image subtitles are burned in by the server.
- **Bridge:** `addJavascriptInterface` exposes `FoxbloomAndroid` to the page (only to the bundled origin):
  open(url, startMs), play, pause, seek(ms), getTime, getDuration, audio track list and select, close, and `caps()`.
  Android calls back into the page with `evaluateJavascript` for prepared/ready, buffering, ended, error and
  seek-done. All player calls run on the main thread.
- **Caps:** `caps()` reports what the device decodes, from `MediaCodecList` (H.264, HEVC, AV1, VP9; AAC, AC3, E-AC3,
  DTS, Opus, FLAC) and whether the TV can pass surround audio through (`AudioCapabilities`), plus MKV/MP4/WebM
  containers (ExoPlayer extractors). The server's existing decision logic uses these as for Samsung.
- **Remote:** D-pad and OK reach the WebView as normal key events (37–40, 13). The Activity forwards Back and the
  media keys (play/pause/play-pause/fast-forward/rewind, digits) into the page as key events the TV app's `remote.ts`
  understands; Back at the app's first screen exits the app, as on Samsung.
- **Exit and model name:** the bridge provides `exit()` and `model()` (Build.MODEL / manufacturer) for the two places
  the TV app calls Tizen for these today.
- Screen: the TV app is laid out for 1920×1080. The WebView is scaled so 1920 CSS px fill the screen width on 720p,
  1080p and 4K TVs.

### 2. The TV web app (`tv/src`)

- A third `TvPlayer`, `player/android.ts`, on the `FoxbloomAndroid` bridge, chosen when the bridge exists (Samsung
  keeps AVPlay, desktop keeps `<video>`). Same contract as `avplay.ts`, so `usePlayback` and the player screen are
  unchanged.
- `caps.ts` uses the bridge's caps on Android.
- `remote.ts` maps the key codes Android delivers for media keys (and Back) to the existing `Key` values;
  `registerTvKeys` stays a no-op off Tizen.
- `app.tsx` exit and `AddPerson.tsx` model name use the bridge when present.
- The build stays one bundle (ES5 + legacy polyfills) used by both TVs.

### 3. FoxbloomTVSetup.exe (`installer/tv`)

- Embeds `Foxbloom.apk` (built and signed during the release) and Google's `adb.exe` (+ its two DLLs) as vendor files,
  the same way it embeds `sdb.exe`: from `installer/tv/vendor/`, not in git, checked against `vendor.sha256`.
- **Finding Android TVs:** alongside the Samsung scan, it looks for Android devices advertising wireless debugging
  (mDNS `_adb-tls-pairing._tcp` / `_adb-tls-connect._tcp`) and for ones accepting classic network adb on port 5555.
  Entering an address by hand works too. The list says which TVs are Samsung and which are Android.
- **First-time setup, shown step by step in the window:** on the TV, turn on Developer options (Settings → System →
  About → press Build seven times), then Wireless debugging → "Pair device with pairing code"; type the six-digit code
  (and the address:port the TV shows, if it wasn't found) into the setup window. It runs `adb pair`, then
  `adb connect`. TVs without wireless debugging (older Android) use network debugging on port 5555 and an "Allow
  debugging?" prompt on the TV instead of a code.
- **Install:** `adb install -r Foxbloom.apk` (keeps the app's data on update), then starts the app. Same done and
  failure screens as Samsung, with plain-language messages (for example "the TV said no to debugging", "this TV
  already has a Foxbloom signed with a different key: remove it first").
- Afterwards it says wireless debugging can be turned off again; re-pairing is only needed for the next update.

### 4. Building and releasing

- `npm run release` additionally builds the APK (`gradlew assembleRelease`) after `tv` is built, copies `tv/dist` into
  the app's assets, signs it with the Foxbloom release key, and the TV setup build embeds it. The release still
  uploads only FoxbloomSetup.exe and FoxbloomTVSetup.exe.
- `versionName` = the TV package version; `versionCode` derived from it (major·10000 + minor·100 + patch), so every
  release is an upgrade.
- **Signing key:** one keystore made once, kept outside git (a path given by an environment variable or a git-ignored
  file), with a reminder to back it up: losing it means every Android TV has to uninstall (and sign in again) to update.
- Development builds can skip the APK (like `-NoVendor` today): the exe then says it can't install on Android TVs.

## Calls made by Claude (owner to check)

- **Surround audio:** no bundled FFmpeg decoder. `caps()` reports AC3/E-AC3/DTS only when the device really decodes
  them or can pass them through to the TV/receiver; otherwise the server converts just the audio (light work). Keeps
  the APK small and the build free of the Android NDK.
- **Signing key:** generated once on the release PC, kept outside the repo in `%APPDATA%\Foxbloom\android\`
  (keystore + a password file the release reads, so releases need no typing). A release with no keystore stops with
  an error, as it does today when `sdb.exe` is missing. The owner is told once to back that folder up.

- **Which Android TVs the setup tool handles:** Android 11 and newer (Wireless debugging with a pairing code), plus
  older TVs whose menus have a "Network debugging" switch (port 5555 and an "Allow debugging?" prompt). No USB path:
  a TV that offers neither gets a plain "this TV can't be set up from the PC" page.

## Constraints

- Building needs the Android SDK, Gradle and Google's platform-tools (`adb`) on the release PC. Java (JDK 17/21) is
  already installed. Downloading the SDK and accepting Google's Android SDK licence need the owner's explicit OK.
- `adb.exe` is Google's binary, redistributed like `sdb.exe`; its licence notice goes into THIRD-PARTY.txt.
- The installer is .NET Framework 4 C# compiled with Windows' own csc: no NuGet packages; it drives `adb.exe` rather
  than speaking adb's protocol itself.
- Until the owner has their Google TV back, testing is on the Android TV emulator only.

## Left to the builder

- Exact Gradle/AGP/Media3 versions (current stable), project layout inside `android/`, Kotlin style.
- How the bridge queues callbacks and guards against calls from other origins.
- The scaling method for 1920-px layout (WebView zoom vs. viewport meta), as long as it is pixel-correct on 720p,
  1080p and 4K.
- mDNS implementation in the installer (a small multicast DNS query in C# or `adb mdns services`).
- Wording and layout of the new installer pages, matching the existing Samsung pages.
- Tests: unit tests for `android.ts`, caps and key mapping in `tv`; installer tests in `installer/tv/tests` for the
  Android discovery/pairing flow against a fake adb; an instrumented smoke test on the emulator if practical.
