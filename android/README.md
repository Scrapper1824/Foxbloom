# Foxbloom for Android TV

A full-screen WebView that shows the TV web app (`tv/`) — the same bundle the Samsung app uses — on Android TV and
Google TV. Back and the media keys on the remote are passed to the page as the Samsung key codes it already handles.

## Build

Needs the Android SDK (`platforms;android-35`, `build-tools;37.0.0`) and JDK 21.

1. `android/local.properties` (not in git) points at the SDK:
   `sdk.dir=C\:\Users\<you>\AppData\Local\Android\Sdk`
2. Build the TV web app: `npm run build -w tv` (the Android build copies `tv/dist` into the APK and stops with
   "Build the TV app first" if it is missing).
3. With `JAVA_HOME` set to the JDK: `android\gradlew.bat -p android testDebugUnitTest assembleDebug`
   → `android/app/build/outputs/apk/debug/app-debug.apk`.

The version comes from `tv/package.json`: `versionName` is its version, `versionCode` = major·10000 + minor·100 + patch
(0.9.7 → 907).

## Try it on the emulator

```
emulator -avd foxbloom_tv
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n org.foxbloom.tv/.MainActivity
```

Debug builds allow `chrome://inspect` on the page.
