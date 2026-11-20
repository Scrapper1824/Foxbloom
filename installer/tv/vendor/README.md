# vendor/

Files FoxbloomTVSetup.exe embeds but that are not kept in git (`vendor/*` is git-ignored except this file).
`installer\tv\build.ps1` stops with a message naming any that are missing.

| File | Where it comes from |
| --- | --- |
| `sdb.exe` | Samsung's Tizen SDK tools: `tools\sdb.exe` in a Tizen Studio install, or the Tizen Studio command-line tools download. Apache-2.0. |
| `vd_tizen_dev_author_ca.cer` | Samsung's Certificate Extension for Tizen Studio (its `ca` folder). A public certificate. |
| `vd_tizen_dev_public2.crt` | Same place. A public certificate. |
| `adb.exe` | Google's Android SDK Platform-Tools 37.0.3: `%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe` after installing Platform-Tools with Android Studio's SDK Manager. Apache-2.0. |
| `AdbWinApi.dll` | Same folder (adb.exe needs it beside it). |
| `AdbWinUsbApi.dll` | Same folder. |

The installer checks both certificates against pinned thumbprints (see `SamsungCert.cs`), so a wrong file is
refused at run time, not silently trusted.

Each file must also have its SHA-256 in `installer\tv\vendor.sha256` (committed; one `<sha256>  <file name>` line
per file). `build.ps1` refuses to build when a file has no line there or its hash differs, so record the hashes when
you first supply the files (the header of `vendor.sha256` shows how).

Nothing here is downloaded automatically. Put the files in this folder by hand, then build:

    powershell -ExecutionPolicy Bypass -File installer\tv\build.ps1

The Android TV app itself is not a vendor file: `npm run android:apk` builds it to `installer\tv\build\Foxbloom.apk`
(git-ignored), and `build.ps1` stops with "Build the Android app first: npm run android:apk" if it is missing.

For development without them, `build.ps1 -NoVendor` builds an exe that finds TVs and walks through the setup
screens but says it can't install (on Android: "This build can't install on Android TVs").
