# Foxbloom for Samsung TV — design

Date: 2026-11-18. Status: reviewed, owner's answers added; waiting for approval.

## Why

The owner watches Foxbloom on a Samsung TV. The TV's web browser is slow and clunky, so they want a real app on
the TV that opens straight into Foxbloom, is driven with the remote, feels fast, and plays video smoothly.
It is for their own TV(s), installed with the TV's Developer Mode, not published on Samsung's app store.

## Goals

- Open the app → (signed in) → pick something → it plays. Few clicks with the remote.
- Fast menus: light code, no heavy web UI, posters load quickly, focus moves instantly with the arrow keys.
- Smooth playback using the TV's own video player (Samsung AVPlay), which decodes in hardware and can play many
  files as they are, so the server converts less.
- Same accounts, watch progress and Continue watching as the web app (start on the TV, continue on the phone).

## Non-goals (first version)

- Samsung app store publishing (needs Samsung review; not wanted).
- Admin and management screens: Requests, Downloads, Discover/adding titles, Statistics, Settings, Users.
  Those stay on the web app.
- Watch Together parties on the TV.
- Other TV brands (LG webOS, Android TV, Fire TV). The code should not make them impossible, but nothing is built
  for them now.

## Anti-goals (would make it a failure even if it "works")

- Feels like the website squeezed onto a TV: small text, mouse-style menus, focus you can't see.
- Stutters or buffers where the web app on a PC would not.
- Signing in means typing a long password letter by letter with the remote.

## Constraints

- **Platform:** Samsung Tizen TV web app (`.wgt`): HTML/CSS/JS plus Samsung's `webapis` (AVPlay, TV input/remote keys).
  The TV's model/year is unknown (the owner doesn't know it). So: target 2017 and newer (Tizen 3.0+, an old Chromium),
  build the code down to ES5 with the needed polyfills, and **detect what the TV can play when the app starts** instead
  of a fixed list (see Playback). *My call* on the 2017 cut-off; older TVs have weaker players and far fewer users.
- **Installing:** Developer Mode on the TV, Samsung's Tizen tools on the owner's PC, and a Samsung certificate made
  with their own Samsung account. Sideloaded apps must be signed with a certificate that names the TV, so a ready-made
  `.wgt` cannot be published on GitHub for everyone; it is built and signed on the owner's PC.
- **Server:** the existing Foxbloom server (Fastify, node:sqlite). Today sign-in is a `SameSite=Strict` HttpOnly
  cookie, and `crossSite()` rejects requests whose Origin isn't the server itself. A packaged TV app runs from its own
  origin, so it can't use that cookie; the server needs a sign-in the TV can use (below).
- **Speed:** the TV's processor is weak. Keep the app small; no big UI framework; no subtitle renderer running in
  JavaScript (the web player's JASSUB) on the TV.
- **Network:** the app must work both at home and away (owner's answer). The server caps "remote" viewers at the
  remote bitrate limit (8 Mbps today) using `isLocalAddress(req.ip)`, so at home it should talk to the server's local
  address for full quality, and away it uses the public HTTPS address (Cloudflare Tunnel).
- **Several people per TV** (owner's answer: "me and family"): more than one Foxbloom account signed in on one TV.
- **Sign-in lifetime: same as the website today** (owner's answer). TV sign-ins are ordinary sessions: they end after
  7 days unused or 30 days at most, and when the password or two-factor setting changes or an admin resets the account.
  So pairing must be quick, because people will re-pair from time to time.

## Approaches considered

1. **Wrap the existing website in a TV app.** Quickest, but it is the same heavy page the TV browser already struggles
   with, and the menus are made for a mouse. Fails "fast and smooth".
2. **A separate, light TV app built for the remote, using the TV's own player (AVPlay).** Most work, but the only one
   that gets both fast menus and hardware playback. **Chosen by the owner.**
3. **The same TV app with the web player (hls.js) instead of AVPlay.** Simpler player code, but playback runs on the
   TV's weak processor and can stutter, which is the problem being solved.

## The design

### Where it lives

A new `tv/` folder in the Foxbloom repo (its own small package, built with Vite + TypeScript to ES2015). *My call:*
Preact for the screens (about 4 KB, React-like, so it reads like the web app) and plain CSS. Shared types with the web
app are copied, not imported, to keep the TV bundle independent.

### Screens (all driven by arrows, OK, Back, and Play/Pause on the remote)

1. **First run — connect.** Enter the server's public address once (e.g. the HTTPS Cloudflare address; on-screen
   keyboard). *My call:* once someone has signed in, the app asks the server for its home-network address (a new
   field in `/api/auth/status`, e.g. `http://192.168.x.x:7979`) and remembers both. Each time it starts, and when a request
   fails, it tries the home address first with a short timeout (about 1.5 s) and falls back to the public one. A small
   "Home / Away" label in the corner shows which one it's using.
2. **Who's watching?** A row of profiles (each person's username and a coloured initial), plus "Add person".
   With one profile and no PIN, it goes straight in. A profile with a PIN shows a small lock and asks for it.
   **Optional PIN (owner's request):** after a person is added (step 3), the TV offers "Add a PIN to your profile?"
   with Skip as the default. *My calls:* 4 digits, typed with the remote's number keys or an on-screen number pad,
   entered twice to set it; stored on the TV only (hashed, per profile), not on the server; can be changed or removed
   later from that profile's options after entering it; after 5 wrong tries the profile waits 30 seconds; a forgotten
   PIN is handled by removing the profile and adding the person again (pairing proves who they are on their phone).
   The web accounts still decide what each person may see (e.g. adult content).
3. **Add person — pairing code.** *My call:* the TV shows a short code (e.g. `FXB-4K7Q`) and a QR code of the web
   page's address. On a phone or PC, signed in to Foxbloom as that person, they open a new **"Link a TV"** page and
   type the code (or scan the QR); the TV gets a sign-in for that person. A plain username + password form is there as
   a fallback. When a person's sign-in has ended (see lifetime above), choosing their profile shows the pairing code
   again with a "Sign in again" message; their profile stays on the TV.
4. **Home.** Rows like the web app's Home: Continue watching first, then the Home rows the server already returns
   (`/api/home`, `/api/continue`). A big hero at the top for the first Continue watching item.
5. **Library.** Movies / Shows / Anime tabs, poster grid (`/api/media`).
6. **Title page.** Backdrop, title, year, overview, Play/Resume button; for shows and anime, a season picker and episode
   list with watched marks and progress bars (`/api/media/:id`).
7. **Search.** *My call:* a simple search of the library with the on-screen keyboard (filters `/api/media`); nothing
   outside the library.
8. **Player.** Full screen AVPlay video with a controls bar that hides itself:
   - Play/Pause, seek with left/right (10 s steps, faster when held), progress bar with intro/credits marked
     (like the web player).
   - Resume where you left off; progress saved with `PUT /api/play/:kind/:id/progress` the same way the web player
     does it.
   - Audio and subtitle choice, Skip intro, Next episode button and countdown at the end (autoplay next).
   - Back leaves the player (saving progress).
9. **Switch person.** From Home's top bar, back to Who's watching; from there a profile can be removed (signs it out; no PIN needed, since removing only
   takes the person off this TV), or its PIN added, changed or removed (asks for the current PIN first).

### Look

The Foxbloom look from the web app (midnight-blue background, rose accent `#f2a7c3`, fox logo), sized for a TV:
designed at 1920×1080, big text (at least 24 px body), a clear rose focus ring and slight zoom on the focused item, and
nothing important within the outer 5% of the screen (TVs crop edges).

### Playback

- When the app starts it works out what this TV can play: the model year from `webapis.productinfo`, and each codec
  checked with the TV's media support checks (`MediaSource.isTypeSupported` / `webapis.avinfo` where present),
  falling back to a safe list per Tizen version (H.264 + AAC + MP4 always; HEVC, 10-bit HEVC, AC3, E-AC3, DTS and MKV only
  when detected or known for that year). It sends that as `caps` when asking the server to start playback, like the
  web player does (`POST /api/play/:kind/:id/start`).
- The server's playback decision (`decidePlayback`) gains MKV as a container a client may play directly, so most files
  play on the TV untouched (`/api/play/direct/...`, with range requests for seeking). When the TV can't play
  something (e.g. DTS audio, image-based subtitles burned in), the server converts to HLS as it does today and AVPlay
  plays the HLS stream.
- **Subtitles:** AVPlay can show text subtitles from a file. The server's subtitle endpoint gains a plain SRT output
  for the TV. Styled anime subtitles (ASS) will show as plain text on the TV, without their fonts, colours and
  placement. *My call*, because rendering them in JavaScript would make playback stutter. A "burn in styled subtitles"
  choice that makes the server convert with the subtitles drawn into the picture can be added later if plain text
  bothers anyone.

### Server changes

- **TV sign-in:** pairing. The TV asks the server for a code; a signed-in user confirms the code on the web app; the
  TV collects a session token for that user (named after the TV, e.g. "Samsung TV — Living room"), stored on the TV per
  profile. It is an ordinary row in the existing `sessions` table with the same lifetime and sign-out rules as the
  website (owner's answer). Sent as `Authorization: Bearer …`; all existing user checks apply (roles, adult setting,
  must-change password, rate limits); "sign out other devices" signs the TV out too.
- **Home-network address:** for a signed-in request only, `/api/auth/status` also returns the server's own local
  address(es) and port, so the TV can try them at home (not shown to strangers).
- **Cross-origin access for the TV app only:** requests carrying a valid device token are allowed from the TV app's
  origin (CORS headers for it); the existing cookie + `x-requested-with` protection for the website stays as it is.
- **Stream URLs:** AVPlay cannot add headers to video requests, so the direct-play and HLS URLs given to the TV carry a
  short-lived, single-title playback token in the query string, checked the same way as the session.
- MKV as a playable container for clients that say so; SRT subtitle output.
- **Audio track switching on the TV:** today `decidePlayback` converts whenever the chosen audio isn't the file's
  default track. AVPlay can switch audio tracks itself, so a client that says so in its `caps` (a new
  `switchesAudio` flag) gets the file untouched and switches the track on the TV. This matters most for anime
  (sub vs dub). *My call.*
- **Every Foxbloom install gets this, not just the owner's** (*my call*): the repo is public, and the TV sign-in is
  only reachable through pairing by an already signed-in user, so it adds no new way in. No admin switch; the README
  links to the TV guide.
- Tests for all of the above alongside the existing server tests.

### Installing and updating: FoxbloomTVSetup.exe (owner's choice)

A Windows installer, **FoxbloomTVSetup.exe**, published on each GitHub release next to FoxbloomSetup.exe. No Node,
Tizen Studio or command line needed on the PC. It carries the ready-built (unsigned) TV app and does the rest:

1. **Finds the TVs.** Scans the home network (SSDP, then a quick sweep of port 8001 on the PC's subnet if nothing
   answers) and asks each Samsung TV for its details (`http://<ip>:8001/api/v2/`: name, model, DUID, Developer Mode
   and the developer IP it trusts). Lists them, e.g. "Living Room — QN55Q80 · Developer Mode on", plus "Enter an
   address" for a TV it can't find. The owner picks one.
2. **Checks Developer Mode.** If it's off, or set to another PC's address, it shows the steps (Apps → 1 2 3 4 5 →
   Developer mode On → type this PC's IP, shown large → restart the TV) and a "Check again" button.
3. **Samsung certificate, made by the installer (owner's choice, option 1).** The first time, it opens Samsung's
   sign-in page in the browser; after sign-in it makes the certificate for that TV and keeps it (protected with
   Windows' per-user encryption) for next time. A new TV is added to the certificate automatically. This uses
   Samsung's sign-in and certificate service the way Samsung's own tools do; it's undocumented, so if Samsung changes
   it the installer needs a fix (known risk, accepted). Other community TV installers work the same way.
4. **Signs and installs.** Signs the TV app with that certificate and installs it on the chosen TV over Samsung's
   developer connection (sdb), then starts it. Reinstalling keeps everyone's sign-ins and profiles.

- *My call:* built like the existing server installer (C#, `installer/`), same look (midnight blue, rose, fox).
- *My call:* when the server is newer than the TV app, the TV shows "A TV app update is ready — run Foxbloom TV Setup
  on your PC".
- Samsung certificates from the free account expire after a while; when one does, the installer says so and makes a
  new one after a fresh sign-in. Developer Mode installs keep working until then.
- A short guide (`tv/README.md`, linked from the main README) covers the same steps with screenshots-in-words, for
  when something goes wrong.

## Left to the builder

- Exact screen layouts and row/grid sizes, within the look above.
- How the remote keys map in detail (which keys to register with `tizen.tvinputdevice`), long-press seek speed.
- The pairing code format, its lifetime (a few minutes) and how the web page for entering it looks (it follows the web
  app's existing style).
- How playback tokens are made and checked, as long as they are short-lived, limited to one title, and tied to the user.
- How the app is tested without the TV during development (the app should run in a desktop browser with a fake player
  and keyboard arrows standing in for the remote), plus a final check on the real TV with the owner.
