# Foxbloom on a Samsung TV (and Android TV)

Foxbloom has a TV app for Samsung TVs from 2017 on (Tizen 3.0 and newer), and for Android TVs and Google TVs
([below](#android-tv-and-google-tv)). You put it on your TV once with
**FoxbloomTVSetup.exe**, a Windows program from the [releases page](https://github.com/Scrapper1824/Foxbloom/releases/latest).
It is not in Samsung's app store, so the TV has to be in Developer Mode for the install.

## Installing

1. Put the TV and your PC on the same network (same Wi-Fi, or both on the router).
2. Run `FoxbloomTVSetup.exe`. It looks for Samsung TVs. If yours isn't listed, choose **Enter an address**
   and type the TV's IP address (TV: Settings > General > Network > Network Status > IP Settings).
3. If the setup says Developer Mode is off, follow its steps (below), then choose **Check again**.
4. Choose **Install**. The first time, your browser opens a Samsung sign-in. Sign in with any Samsung account
   (a free one is fine). Foxbloom Setup uses it to get a certificate that lets *your* TV trust the app.
5. Wait about a minute. When it says "Done", Foxbloom opens on the TV. After that it is in the TV's Apps list.
6. In the TV app, enter your Foxbloom address and sign in with the code it shows (enter that code on a Foxbloom
   page you're already signed in to, on your phone or PC).

## Turning on Developer Mode

1. On the TV, open **Apps**.
2. On the remote, press **1 2 3 4 5** one after the other. (On some remotes, open the number pad on screen first.)
3. Switch **Developer Mode** to **On**.
4. In **Host PC IP**, type the address the setup shows in large type. It is this PC's address on your network.
5. Press **OK**, then restart the TV: hold the power button until it switches off, then on again.
   Developer Mode does nothing until the TV has restarted.

## What the messages mean

| Message | What to do |
| --- | --- |
| No TVs found | The TV must be fully on (not in standby) and on the same network as the PC. Some routers keep Wi-Fi and wired devices apart ("client isolation"). Use **Enter an address** instead. |
| No Samsung TV answered at ... | The address is wrong, or the TV is off. Check it against the TV's Network Status screen. |
| Developer Mode is off / is set up for a different PC | Do the Developer Mode steps above, with the address shown on the setup screen, and restart the TV. |
| Couldn't connect to the TV | Same checklist: Developer Mode on, Host PC IP is this PC's address, TV restarted after changing it, same network. A VPN on the PC can also get in the way. Windows Firewall may ask whether to allow the setup program; allow it on private networks. |
| The TV wouldn't tell us its ID | The TV connected but didn't answer. Restart the TV and try again. |
| Signing in to Samsung... | Finish the sign-in in the browser window that opened. If no window opened, look for it behind other windows. The setup waits about five minutes. |
| Couldn't copy the app to the TV | Try again. If it keeps failing, restart the TV. |
| The TV didn't accept the app's certificate | The saved certificate is for a different TV or out of date. Run the setup again; if it persists, delete the folder `%APPDATA%\Foxbloom\tv-cert` (below) and run it once more. |
| The TV doesn't have enough free storage | Remove some apps from the TV and try again. |
| Foxbloom is installed on the TV, but it didn't start on its own | Nothing is wrong: open Foxbloom from the TV's Apps list. |

## Certificate renewal

Samsung's certificates for a home install last a limited time (a year or so). The setup keeps yours in
`%APPDATA%\Foxbloom\tv-cert` (the passwords are protected by your Windows account). When it expires, or when you
install on a TV it hasn't seen before, running `FoxbloomTVSetup.exe` signs in to Samsung again and makes a new one.

An app installed with an expired certificate keeps working until you restart the TV, and then may refuse to start.
If Foxbloom stops opening, run the setup again to install it fresh. To force a new certificate, close the setup,
delete `%APPDATA%\Foxbloom\tv-cert`, and run it again.

## Re-installing and updating

Run `FoxbloomTVSetup.exe` again and choose the same TV. It replaces the app, keeps nothing you need to back up
(your sign-in and profiles live on your Foxbloom server and in the TV app's own storage), and works for updates
too. Developer Mode must still be on, with this PC's address in Host PC IP. If your PC's address changed, update
it on the TV and restart the TV.

## Removing it

On the TV, open Apps, move to Foxbloom, press and hold OK (or the Tools button) and choose **Delete**. You can turn
Developer Mode off in the same Apps screen (press 1 2 3 4 5, switch it Off, restart).

## Android TV and Google TV

The same `FoxbloomTVSetup.exe` also installs Foxbloom on Android TVs and Google TVs (Android 7 and newer: Sony,
Philips, TCL, Hisense, Chromecast with Google TV, NVIDIA Shield and so on). It isn't in the Play Store, so the TV has
to let your PC install it, once:

1. On the TV, open **Settings > System > About** (on some TVs **Settings > Device Preferences > About**), select
   **Build** and press OK on it **7 times**, until the TV says you're a developer.
2. Go back to **Settings > System > Developer options** and turn on **Wireless debugging**.
3. Run `FoxbloomTVSetup.exe`. Your TV shows up as **Android TV**. Pick it.
4. On the TV, choose **Wireless debugging > Pair device with pairing code**. Type the code and the pairing address
   it shows into the setup, check the connection address (the **IP address & Port** on the Wireless debugging
   screen), and choose **Pair and install**.
5. When it says "Done", Foxbloom opens on the TV. After that it is in the TV's Apps list. Sign in as above.

**Older TVs (Android 10 and earlier)** have no Wireless debugging. Turn on **Network debugging** (sometimes called
ADB debugging) in Developer options instead. There is no code: when the setup connects, the TV asks whether to
allow this PC. Tick **Always allow from this computer** and choose **Allow**.

If the TV isn't listed, choose **Enter an address** and type the **IP address & Port** from the Wireless debugging
screen (like `192.168.1.50:37000`), or just the TV's address (like `192.168.1.50`) for Network debugging.

You can turn Wireless debugging off again afterwards; you'll pair once more for the next update. To update, run the
setup again: it replaces the app and keeps your sign-in.

| Message | What to do |
| --- | --- |
| That code didn't work | Codes change each time the pairing screen opens. Open it again and type the new code and address. |
| This PC isn't paired with the TV | Type the pairing code (leave it empty only if this PC is already listed under Paired devices). |
| The TV didn't answer at ... | Wireless debugging (or Network debugging) is off, or the address and port don't match the TV's screen. The port changes whenever Wireless debugging is switched on. |
| The TV hasn't allowed this PC yet | Network debugging: choose Allow on the TV (tick Always allow), then try again. |
| This TV already has a Foxbloom signed by someone else | A test build is installed. Remove Foxbloom from the TV (Settings > Apps > Foxbloom > Uninstall), then try again. |
| This TV's Android is too old for Foxbloom | Foxbloom needs Android 7 or newer. |
| This TV can't be set up from the PC: it has neither Wireless debugging nor Network debugging | Some TVs lock Developer options. Foxbloom can't be installed on them from a PC. |

To remove it: Settings > Apps > Foxbloom > Uninstall.

## For developers

`npm run build -w tv` builds the app into `tv/dist`. `installer\tv\build.ps1` packs it into the installer; it
needs `sdb.exe`, Samsung's CA certificates and adb (`adb.exe`, `AdbWinApi.dll`, `AdbWinUsbApi.dll`) in
`installer\tv\vendor\` (see the README there) and the Android app from `npm run android:apk`
(`installer\tv\build\Foxbloom.apk`), or `-NoVendor` for a build that can't install. Tests:
`powershell -File installer\tv\test.ps1`.
