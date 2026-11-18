# Foxbloom for Samsung TV — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Samsung (Tizen) TV app for Foxbloom, driven by the remote, playing through the TV's own AVPlay player, with
family profiles signed in by pairing codes, plus the server and web changes it needs.

**Architecture:** Server gains bearer-token sessions (same `sessions` table and rules), pairing codes, short-lived
stream tokens for AVPlay URLs, MKV/DTS/audio-switch capabilities and SRT subtitles. The web app gains a "Link a TV"
page. A new `tv/` workspace is a small Preact app built to ES5 (Vite + legacy plugin), packaged as a `.wgt` and
installed from the owner's PC by FoxbloomTVSetup.exe, which finds the TV, makes the Samsung certificate, signs and installs.

**Tech Stack:** Server: Fastify, node:sqlite, vitest (existing). Web: React (existing). TV: Preact, TypeScript, Vite +
`@vitejs/plugin-legacy`, vitest + jsdom, Samsung `webapis` (AVPlay, productinfo) and `tizen.tvinputdevice`.
Installer: C# WinForms compiled with the .NET Framework `csc.exe` (like `installer/`), Samsung's `sdb.exe` bundled.

**Spec:** `docs/superpowers/specs/2026-11-18-samsung-tv-app-design.md`

## Global Constraints

- TV target: Samsung TVs 2017 and newer (Tizen 3.0+); TV code is built down to ES5 with polyfills.
- TV sign-ins are ordinary rows in the `sessions` table: 7 days unused (`IDLE_MS`) or 30 days at most
  (`ABSOLUTE_MS`), and removed by everything that removes website sessions today.
- Pairing code shown on TV, entered on a signed-in phone/PC; username + password form only as a fallback.
- Profile PIN: optional, offered after adding a person with Skip as default; 4 digits; entered twice to set;
  stored on the TV only, hashed per profile; 5 wrong tries → 30 s wait; removing a profile needs no PIN.
- Home address tried first with about a 1.5 s timeout, then the public address; a "Home / Away" label shows which.
- Look: midnight-blue background `#1d2440` family, rose accent `#f2a7c3`, fox logo, designed at 1920×1080, body text
  ≥ 24 px, visible rose focus ring, nothing important in the outer 5% of the screen.
- Styled (ASS) subtitles show as plain text on the TV; no JavaScript subtitle renderer on the TV.
- Out of scope on the TV: Requests, Downloads, Discover, Statistics, Settings, Users, Watch Together.
- Every Foxbloom install gets it; no admin switch. Never weaken the website's cookie + `x-requested-with` + same-site
  protection for cookie requests.
- Work on a `tv-app` branch; each task's commit goes there and only touches that task's files. Nothing is merged to
  `main` or released until the owner says so; do not run `npm run release`.

## Review Focus

1. **Home address unreachable** (TV away, or server's LAN IP changed): the app must fall back to the public address
   within ~1.5 s per attempt and keep working, never hang on a spinner. → test in Task 7.
2. **Sign-in ended mid-use** (any API call returns 401): that profile goes to "Sign in again" with a fresh pairing
   code; other profiles are untouched; no crash or blank screen. → test in Task 7.
3. **A file the TV claims to play but AVPlay fails on** (e.g. a codec mis-detected): the player retries once by asking
   the server to convert (start again with `caps.forceConvert = true`), instead of a black screen. → tests in Tasks 4
   and 10.
4. **Wrong or expired pairing code typed on the phone**: clear message on the web page; the TV makes a new code when
   its code expires, without the person doing anything. → tests in Tasks 2 and 8.
5. **The TV isn't found, or Developer Mode trusts another PC** (TV off, other network, guest Wi-Fi): the installer
   says so in plain words and offers "Enter an address" / "Check again", never an endless scan. → test in Task 11a.
6. **Back on the top screens** (Who's watching / Home): Back from Home goes to Who's watching only via the top-bar
   button; Back on Home or Who's watching asks "Exit Foxbloom?" and exits the app on OK, never navigates into a
   dead screen. → test in Task 6.

---

### Task 1: Bearer sessions and cross-origin access for the TV app

**Files:**
- Modify: `server/src/auth/security.ts` (onRequest hook, onSend hook)
- Test: `server/src/auth/bearer.test.ts`

**Interfaces:**
- Produces: `req.authVia: 'cookie' | 'bearer' | 'stream' | null` (new request decoration). `Authorization: Bearer
  <token>` resolves through `userForSession(token)` and sets `req.sessionToken = token`, so logout/logout-others work
  unchanged. Cookie wins when both are present.

- [ ] **Step 1: Write failing tests** in `bearer.test.ts` (same setup helpers as `auth.test.ts`; make a session token
  with `createSession(userId, '127.0.0.1', 'test')`):
  - `bearer token signs in`: `GET /api/auth/status` with `authorization: Bearer <t>` → `authenticated === true`.
  - `bearer POST from another origin is allowed`: `POST /api/auth/logout` with bearer, `x-requested-with: mediarr`,
    `origin: file://` → 200, and the session row is gone.
  - `cookie POST from another origin is still blocked`: same request with the cookie instead → 403
    `'Cross-site request blocked'`.
  - `preflight`: `OPTIONS /api/home` with `origin: file://`, `access-control-request-headers: authorization,
    content-type, x-requested-with` → 204 with `access-control-allow-origin: file://`,
    `access-control-allow-headers` containing `authorization`, and no `access-control-allow-credentials`.
  - `CORS headers only for bearer`: bearer `GET /api/home` from `origin: null` → `access-control-allow-origin: null`
    and `cross-origin-resource-policy: cross-origin`; cookie `GET /api/home` → no `access-control-allow-origin`,
    CORP stays `same-origin`.
  - `expired bearer`: a session whose `last_seen` is 8 days old → 401.
- [ ] **Step 2: Run** `npm test -w server -- bearer` → FAIL.
- [ ] **Step 3: Implement** in `security.ts`: read `authorization` (`/^Bearer ([\w-]{20,100})$/`) when no session
  cookie user; set `req.authVia`. Skip `crossSite()` for `authVia === 'bearer'` (bearer tokens are not sent
  automatically by browsers, so CSRF doesn't apply); keep requiring `x-requested-with`. Answer `OPTIONS` on `/api/*`
  that carries `access-control-request-method` with 204 + CORS headers before auth (methods `GET, POST, PUT, DELETE`,
  headers `authorization, content-type, x-requested-with`, max-age 600). In `onSend`, when `authVia` is `bearer` or
  `stream`, echo the request `origin` in `Access-Control-Allow-Origin` and set CORP `cross-origin`.
- [ ] **Step 4: Run** `npm test -w server` → all pass (including the existing "everything needs a login" tests).
- [ ] **Step 5: Commit** `git commit -m "Server: bearer sessions and CORS for the TV app"`

### Task 2: Pairing codes

**Files:**
- Create: `server/src/auth/pairing.ts`, `server/src/auth/pairing.test.ts`
- Modify: `server/src/auth/routes.ts` (register routes), `server/src/auth/security.ts` (`PUBLIC_API`,
  `USER_ALLOWED`), `server/src/auth/auth.test.ts` (its `PUBLIC` set)

**Interfaces:**
- Produces routes:
  - `POST /api/tv/pair` (public) body `{ deviceName: string, baseUrl: string }` →
    `{ code: string /* 'FXB-XXXX', alphabet without 0/O/1/I */, pairId: string /* 32 random bytes base64url */,
    expiresIn: 600, qr: string /* data:image/svg+xml URI of `${baseUrl}/link-tv?code=${code}` */ }`.
  - `POST /api/tv/pair/poll` (public) body `{ pairId }` → `{ status: 'waiting' }` | `{ status: 'expired' }` |
    `{ status: 'done', token: string, user: PublicUser }` (token handed out once; a second poll gets `expired`).
  - `POST /api/tv/link` (signed in, users and admins) body `{ code }` → `{ ok: true, deviceName }`; creates the
    session with `createSession(req.user.id, req.ip, 'Foxbloom TV — ' + deviceName)`.
- Pending codes live in memory (`Map`), 10-minute lifetime, at most 50 pending (oldest dropped).

- [ ] **Step 1: Write failing tests** in `pairing.test.ts`:
  - `pair → link → poll gives a working token`: the token from poll signs in via bearer as the linking user.
  - `poll before link` → `waiting`; `poll after hand-out` → `expired`.
  - `wrong code` → 404 `{ error: 'That code isn’t right or has expired. Check the code on the TV.' }`.
  - `expired code` (advance time with `vi.useFakeTimers` past 600 s) → same 404 message; poll → `expired`.
  - `code is case- and dash-insensitive`: linking `fxb4k7q`-style input for `FXB-4K7Q` works.
  - `link needs a signed-in user` → 401; `must_change_password` user → 403.
  - `link rate limit`: 10 wrong codes from one IP → 429 (use `lockedFor`/`recordFailure` with key `'__tvlink__'`).
  - `pair rate limit`: more than 20 `POST /api/tv/pair` per IP per 10 minutes → 429.
  - `qr` starts with `data:image/svg+xml` and the code appears in the encoded URL.
- [ ] **Step 2: Run** `npm test -w server -- pairing` → FAIL.
- [ ] **Step 3: Implement** `pairing.ts` (`startPairing`, `pollPairing`, `linkPairing`) and the routes (QR via the
  `qrcode` package already used by TOTP setup; validate `baseUrl` is `http(s)://` and ≤ 200 chars, `deviceName` ≤ 40
  chars). Add the two public routes to `PUBLIC_API` and the test's `PUBLIC`; add `POST /api/tv/link` to
  `USER_ALLOWED`.
- [ ] **Step 4: Run** `npm test -w server` → all pass.
- [ ] **Step 5: Commit** `git commit -m "Server: TV pairing codes"`

### Task 3: Stream tokens, home address and version for the TV

**Files:**
- Create: `server/src/auth/streamTokens.ts`, `server/src/auth/streamTokens.test.ts`
- Modify: `server/src/auth/security.ts`, `server/src/routes/play.ts` (`/start` response), `server/src/auth/routes.ts`
  (`/api/auth/status`)

**Interfaces:**
- Produces: `issueStreamToken(userId: number, title: string /* 'episode:12' */): string` (valid 6 h) and
  `streamTokenUser(token: string, title: string): number | null`.
- `POST /api/play/:kind/:id/start` adds `streamToken` to its response when `req.authVia === 'bearer'`; the TV appends
  `?st=<streamToken>` to the `url` it was given and to subtitle URLs.
- In `security.ts`, for exactly `GET /api/play/direct/:kind/:id`, `GET /api/play/hls/:session/:file` and
  `GET /api/play/:kind/:id/subtitle/:track`, a valid `st` query param sets `req.user` and `req.authVia = 'stream'`.
  The title is `${kind}:${id}` from the params, or the HLS session's `title` (`getSession(id)`).
- `/api/auth/status` adds, for signed-in requests only: `version` (root package version) and `localUrls: string[]`
  (`http://<private IPv4>:<PORT>` for each non-internal private interface from `os.networkInterfaces()`).

- [ ] **Step 1: Write failing tests**:
  - `stream token opens its own title's direct file` (with a fixture media file as in `play` tests) → 200/206.
  - `stream token for another title` → 401; `stream token on /api/home` → 401; `expired` (6 h + 1 s) → 401.
  - `start via bearer returns streamToken`; `start via cookie has no streamToken`.
  - `status`: signed out → no `localUrls`/`version` keys; signed in → `localUrls` is an array of `http://…:<port>`,
    `version` matches `package.json`.
- [ ] **Step 2: Run** `npm test -w server -- streamTokens` → FAIL.
- [ ] **Step 3: Implement** (tokens: 32 random bytes base64url, in-memory `Map` with expiry, pruned on issue).
- [ ] **Step 4: Run** `npm test -w server` → all pass.
- [ ] **Step 5: Commit** `git commit -m "Server: stream tokens and home address for the TV"`

### Task 4: TV playback capabilities and SRT subtitles

**Files:**
- Modify: `server/src/playback/decide.ts`, `server/src/routes/play.ts` (`CAP_KEYS`, subtitle route),
  `server/src/playback/probe.ts` (`extractSubtitle`)
- Test: `server/src/playback/decide.test.ts`, subtitle case in the existing extras/ffmpeg integration test file

**Interfaces:**
- `ClientCaps` gains `mkv: boolean`, `dts: boolean`, `switchesAudio: boolean`, `forceConvert: boolean`
  (all default false via `parseCaps`).
- `extractSubtitle(file, track, format: 'ass' | 'srt' = 'ass')`; cache name `${order}.${format}`.
- `GET /api/play/:kind/:id/subtitle/:track?format=srt` serves SRT.

- [ ] **Step 1: Write failing tests** in `decide.test.ts`:
  - `.mkv` HEVC + AAC with `{ mkv, hevc, aac }` → `mode: 'direct'`; same without `mkv` → transcode (copy rules
    unchanged).
  - DTS audio with `dts: true` → direct; without → convert with reason containing `DTS`.
  - Non-default audio choice with `switchesAudio: true` → direct (`audio` = the chosen order); without → existing
    `'Switching audio tracks needs a conversion'`.
  - `forceConvert: true` on a file that would play directly → `mode: 'transcode'`, reason
    `'The TV couldn’t play the original file'`.
  - Integration: `subtitle/0?format=srt` on the fixture with a text subtitle returns a body starting with `1\n` and
    containing `-->`.
- [ ] **Step 2: Run** `npm test -w server -- decide` → FAIL.
- [ ] **Step 3: Implement** (`AUDIO_OK.dts = 'dts'`; `containerOk` also true for `.mkv` with `caps.mkv`;
  `forceConvert` checked first after the no-video check).
- [ ] **Step 4: Run** `npm test -w server` → all pass.
- [ ] **Step 5: Commit** `git commit -m "Server: MKV, DTS, audio switching and SRT subtitles for the TV"`

### Task 5: "Link a TV" page on the web app

**Files:**
- Create: `web/src/pages/LinkTv.tsx`, `web/src/pages/LinkTv.test.tsx`
- Modify: `web/src/App.tsx` (route `/link-tv`, and a "Link a TV" entry under the account/Settings area that already
  holds sign-out), `web/src/styles.css` if needed

**Interfaces:**
- Consumes: `POST /api/tv/link` (Task 2). Reads `?code=` from the URL (QR) and prefills it.

- [ ] **Step 1: Write failing tests** (same testing setup the web package already uses): prefilled from `?code=`;
  submit calls `/api/tv/link` with the code; shows `'Your TV is signed in as <username>. You can put your phone
  down.'` on success; shows the server's error text on 404/429.
- [ ] **Step 2: Run** `npm test -w web -- LinkTv` → FAIL.
- [ ] **Step 3: Implement**: one large input (auto-uppercase, accepts with or without the dash), "Link TV" button,
  short help line "Open Foxbloom on your TV and choose Add person to see a code." Follows existing page styles.
- [ ] **Step 4: Run** `npm test -w web` → pass; `npm run build -w web` → succeeds.
- [ ] **Step 5: Commit** `git commit -m "Web: Link a TV page"`

### Task 6: TV app skeleton: build, packaging files, remote keys and focus

**Files:**
- Create: `tv/package.json` (name `foxbloom-tv`, same version as root), `tv/vite.config.ts`, `tv/tsconfig.json`,
  `tv/index.html`, `tv/config.xml`, `tv/public/icon.png` (fox logo 512×512, drawn from `web/src/components/Logo.tsx`
  shapes), `tv/src/main.tsx`, `tv/src/app.tsx` (screen router: a stack of screens with `push`/`pop`/`replace`),
  `tv/src/remote.ts`, `tv/src/focus.ts`, `tv/src/styles.css`, `tv/src/focus.test.ts`, `tv/src/app.test.tsx`
- Modify: root `package.json` (`workspaces` += `tv`; `test` also runs `npm test -w tv`), `scripts/release.mjs`
  (`git add` also `tv/package.json`)

**Interfaces:**
- `remote.ts`: `type Key = 'up'|'down'|'left'|'right'|'ok'|'back'|'play'|'pause'|'playpause'|'ff'|'rw'|'digit'`;
  `registerTvKeys(): void` (registers MediaPlay, MediaPause, MediaPlayPause, MediaFastForward, MediaRewind,
  0–9 with `tizen.tvinputdevice` when present); `keyFromEvent(e: KeyboardEvent): { key: Key; digit?: number } | null`
  (Tizen codes: 37–40 arrows, 13 OK, 10009 Back, 415 play, 19 pause, 10252 play/pause, 417 ff, 412 rw, 48–57 digits;
  on desktop Escape/Backspace = back).
- `focus.ts`: elements marked `data-focusable`; `moveFocus(dir: 'up'|'down'|'left'|'right', root: HTMLElement):
  HTMLElement | null` picks the nearest focusable whose rect lies in that direction (primary axis distance + 2×
  cross-axis offset), scrolls it into view, adds the `focused` class; `focusFirst(root)`.
- `config.xml`: Tizen app id `FoxbloomTV.foxbloom` (package `FoxbloomTV`), `required_version` 3.0,
  `<access origin="*" subdomains="true"/>`, privileges `http://tizen.org/privilege/tv.inputdevice`,
  `http://developer.samsung.com/privilege/avplay`, `http://developer.samsung.com/privilege/productinfo`,
  `http://tizen.org/privilege/internet`; screen size 1920×1080; `<tizen:setting screen-orientation="landscape"
  background-support="disable"/>`.
- Build: Vite with `@vitejs/plugin-legacy` `{ targets: ['chrome >= 47'], renderModernChunks: false }`,
  `base: './'`, output `tv/dist`.

- [ ] **Step 1: Write failing tests**: `focus.test.ts` with a jsdom grid of 3×3 boxes (mock
  `getBoundingClientRect`): right from (0,0) → (0,1); down from (0,1) → (1,1); right from the last column → null.
  `app.test.tsx`: Back on the root screen shows `'Exit Foxbloom?'`; OK on it calls
  `tizen.application.getCurrentApplication().exit` (mocked); Back on a pushed screen pops it.
- [ ] **Step 2: Run** `npm test -w tv` → FAIL.
- [ ] **Step 3: Implement** the files above. `styles.css` sets the TV look from Global Constraints (5% safe area as
  `padding: 54px 96px` on the screen root).
- [ ] **Step 4: Run** `npm test -w tv` → pass; `npm run build -w tv` → `tv/dist/index.html` exists and the bundle
  contains no `=>` at top level of the legacy chunk (quick check: `grep -c "=>" tv/dist/assets/index-legacy-*.js`
  is 0).
- [ ] **Step 5: Commit** `git commit -m "TV: app skeleton, remote keys and focus"`

### Task 7: TV core: server connection, API client, profiles and PIN

**Files:**
- Create: `tv/src/connection.ts`, `tv/src/api.ts`, `tv/src/profiles.ts`, `tv/src/pin.ts`, `tv/src/sha256.ts`
  (small pure-JS SHA-256; `crypto.subtle` is unreliable on `file://` on old Tizen), and tests
  `connection.test.ts`, `api.test.ts`, `profiles.test.ts`, `pin.test.ts`

**Interfaces:**
- `connection.ts`: `interface Servers { publicUrl: string; localUrls: string[] }`;
  `pickBase(s: Servers, fetchFn = fetch, timeoutMs = 1500): Promise<{ base: string; where: 'home' | 'away' }>`
  (tries each local URL's `/api/auth/status` with the timeout, first OK wins, else `publicUrl`/`'away'`).
- `api.ts`: `class Api { constructor(base: string, token: string | null); get<T>(path): Promise<T>; send<T>(method,
  path, body?): Promise<T>; streamUrl(url: string, streamToken: string): string }` — sends `Authorization: Bearer`,
  `x-requested-with: mediarr`; on 401 throws `SignedOutError`; on network failure throws `OfflineError` (the app then
  re-runs `pickBase` once and retries).
- `profiles.ts` (localStorage key `foxbloom.tv.v1`): `interface Profile { userId: number; username: string; token:
  string | null /* null = needs signing in again */; pin: { salt: string; hash: string } | null; failedPins: number;
  lockedUntil: number }`; `loadState(): { servers: Servers | null; profiles: Profile[] }`; `saveState(...)`;
  `upsertProfile`, `removeProfile(userId)`, `markSignedOut(userId)`.
- `pin.ts`: `setPin(p: Profile, pin: string): Profile` (4 digits only, else throws), `checkPin(p: Profile, pin: string,
  now = Date.now()): { ok: boolean; profile: Profile; waitSeconds: number }` (5th failure sets `lockedUntil = now +
  30_000`; success resets counters), `clearPin(p)`. Hash = SHA-256 of `salt + ':' + pin`, salt 16 random hex chars.

- [ ] **Step 1: Write failing tests**:
  - `pickBase`: local responds → `home`; local hangs (never-resolving fetch) → resolves `away` within 1.6 s (fake
    timers); no local URLs → `away`. (Review Focus 1)
  - `Api`: 401 → `SignedOutError`; caller marks that profile signed out and keeps the others (test on
    `markSignedOut` + `loadState`). (Review Focus 2)
  - `pin`: set + correct → ok; 5 wrong → `waitSeconds` 30 and a correct PIN is refused until 30 s pass; `'12a4'` and
    `'12345'` rejected by `setPin`; stored state contains no plain PIN.
  - `profiles`: corrupted localStorage JSON → empty state, no throw.
- [ ] **Step 2: Run** `npm test -w tv` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test -w tv` → pass.
- [ ] **Step 5: Commit** `git commit -m "TV: connection, API client, profiles and PIN"`

### Task 8: TV screens: connect, Who's watching, Add person, PIN, switch person

**Files:**
- Create: `tv/src/screens/Connect.tsx`, `Profiles.tsx`, `AddPerson.tsx`, `PinPad.tsx`, `tv/src/keyboard.tsx`
  (on-screen keyboard for the address and the fallback form), tests `AddPerson.test.tsx`, `Profiles.test.tsx`

**Interfaces:**
- Consumes: Tasks 2, 3, 6, 7. Device name sent when pairing: `'Samsung TV'` plus the model from
  `webapis.productinfo.getModel()` when available.
- Flow: no `servers` → Connect (checks `${url}/api/auth/status`, saves `publicUrl`); Profiles; Add person → pairing
  code + QR, polls `/api/tv/pair/poll` every 2 s, makes a new code automatically on `expired`; on `done` stores the
  profile, fetches `/api/auth/status` with the new token to save `localUrls`, then offers "Add a PIN to your
  profile?" (Skip focused by default) → PinPad twice → Home. "Sign in with password instead" opens the fallback form
  (username, password, and the code field when the server answers `totpRequired`; uses `POST /api/auth/login` —
  extend login in `server/src/auth/routes.ts` to also return `{ token }` in the body when the request has header
  `x-foxbloom-client: tv`, with a test, since the TV can't read the HttpOnly cookie).
- Profiles: one tile per profile (initial in a coloured circle, username, lock icon if PIN), "Add person"; a
  signed-out profile opens Add person with the heading `'Sign in again, <username>'`; options on a tile (long-press
  OK or the ⋯ button): Remove (no PIN), Add/Change/Remove PIN (asks current PIN first).

- [ ] **Step 1: Write failing tests**: AddPerson regenerates the code when poll returns `expired` (mock API)
  (Review Focus 4); after `done`, the PIN offer appears with Skip focused; Profiles shows a lock for a PIN profile;
  Remove works without asking for the PIN; signed-out profile shows `'Sign in again, …'`. Server: login with
  `x-foxbloom-client: tv` returns `token`, without the header it doesn't.
- [ ] **Step 2: Run** `npm test -w tv` and `npm test -w server -- auth` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** both test suites → pass.
- [ ] **Step 5: Commit** `git commit -m "TV: connect, profiles, pairing and PIN screens"`

### Task 9: TV screens: Home, Library, title page, search

**Files:**
- Create: `tv/src/screens/Home.tsx`, `Library.tsx`, `Title.tsx`, `Search.tsx`, `tv/src/components/PosterRow.tsx`,
  `tv/src/components/PosterGrid.tsx`, `tv/src/components/TopBar.tsx` (Home / Library / Search / switch person,
  Home-or-Away label, update notice), tests `Home.test.tsx`, `Title.test.tsx`

**Interfaces:**
- Consumes: `GET /api/home`, `GET /api/continue`, `GET /api/media` (+ its existing type filter used by the web
  Library), `GET /api/media/:id`. Read the web app's `Home.tsx`, `Library.tsx`, `Detail.tsx` and `libraryType.ts` for
  the response shapes and copy their TypeScript types into `tv/src/types.ts`.
- Update notice: when `status.version` is newer than the TV app's build version (`__APP_VERSION__` define from
  `tv/package.json`), TopBar shows `'A TV app update is ready — run Foxbloom TV Setup on your PC'`.
- Images: posters at the smallest TMDB size that fills the tile (`w342` for rows), `loading="lazy"`; rows render only
  the visible tiles plus 4 either side.

- [ ] **Step 1: Write failing tests**: Home renders Continue watching first and a hero for its first item; OK on a
  poster pushes Title; Title for a show lists seasons and marks watched episodes; the update notice shows only when
  the server version is newer.
- [ ] **Step 2: Run** `npm test -w tv` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test -w tv` → pass.
- [ ] **Step 5: Commit** `git commit -m "TV: home, library, title and search screens"`

### Task 10: TV player

**Files:**
- Create: `tv/src/player/types.ts`, `tv/src/player/avplay.ts`, `tv/src/player/html5.ts` (desktop stand-in),
  `tv/src/player/caps.ts`, `tv/src/player/srt.ts`, `tv/src/screens/Player.tsx`, tests `caps.test.ts`,
  `srt.test.ts`, `Player.test.tsx`

**Interfaces:**
- `types.ts`: `interface TvPlayer { open(url: string, startAt: number): Promise<void>; play(); pause(); seek(seconds:
  number): Promise<void>; time(): number; duration(): number; audioTracks(): { index: number; language: string }[];
  setAudio(index: number): void; onEnded(cb); onError(cb: (msg: string) => void); onBuffering(cb: (on: boolean) =>
  void); close(): void }`. `avplay.ts` implements it on `webapis.avplay` (`open`, `setDisplayRect(0,0,1920,1080)`,
  `prepareAsync`, `seekTo` in ms, `setSelectTrack('AUDIO', i)`, `setListener` for `onbufferingstart/complete`,
  `onstreamcompleted`, `onerror`); the page background behind the video must be transparent.
- `caps.ts`: `detectCaps(env = window): ClientCaps & { mkv; dts; switchesAudio: true }` — from
  `webapis.productinfo` model year and `MediaSource.isTypeSupported` checks, falling back to: always
  `mp4, h264, aac, mp3, mkv`; `hevc`, `ac3`, `eac3` for Tizen ≥ 3; `dts` only when detected.
- `srt.ts`: `parseSrt(text: string): { start: number; end: number; text: string }[]` (strips `{\…}` and `<…>` tags),
  `cueAt(cues, t): string` (binary search).
- Player screen: starts with `POST /api/play/:kind/:id/start` `{ audio, subtitle: null, caps, startAt }`; plays
  `api.streamUrl(url, streamToken)`; subtitles fetched from `subtitle/:track?format=srt&st=…` and drawn in a DOM
  overlay; saves progress with `PUT /api/play/:kind/:id/progress` every 10 s, on pause and on leaving; marks intro /
  credits on the bar from `info.segments`; Skip intro / Next episode buttons and a 10 s next-episode countdown like the
  web player; an Audio & subtitles menu (from `info.audio` / `info.subtitles`; audio switches with `setAudio` when
  playing the original file, otherwise restarts `/start` with the new `audio` at the current time; preselect like the
  web player's `pickAudio`, honouring `info.audioPreference`); left/right seek 10 s, held → 30 s steps; Play/Pause keys; Back saves and leaves; on HLS ends
  `DELETE /api/play/hls/:session`.
- On `onError` before playback has started: once, restart with `caps.forceConvert = true` (Review Focus 3); a second
  failure shows `'This video can’t play on this TV.'` with Back.

- [ ] **Step 1: Write failing tests**: `parseSrt` on a 3-cue sample (with `<i>` and `{\an8}` tags) and `cueAt`
  boundaries; `detectCaps` with a mocked productinfo for a 2017 and a 2022 model and no `webapis` (desktop);
  Player with a fake `TvPlayer`: error before start → second `/start` call has `forceConvert: true`; second error →
  the message; progress `PUT` sent on Back.
- [ ] **Step 2: Run** `npm test -w tv` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test -w tv` → pass.
- [ ] **Step 5: Commit** `git commit -m "TV: AVPlay player"`

### Task 11: FoxbloomTVSetup.exe — find the TV, make the certificate, sign and install

Split into three commits (11a–11c), each with its own tests, because a reviewer could accept one and reject another.

**Files:**
- Create: `installer/tv/FoxbloomTvSetup.cs` (WinForms UI, same look and `Logo` drawing as
  `installer/MediarrSetup.cs`), `installer/tv/TvDiscovery.cs`, `installer/tv/SamsungCert.cs`,
  `installer/tv/WgtSigner.cs`, `installer/tv/Sdb.cs`, `installer/tv/build.ps1` (compiles with the same .NET Framework
  `csc.exe` as `installer/build.ps1`; embeds `tv/dist` packed as an unsigned `Foxbloom.wgt` zip with `config.xml` +
  `icon.png`, and `sdb.exe`, as resources; outputs `installer/dist/FoxbloomTVSetup.exe`), `installer/tv/tests/*.cs`
  + `installer/tv/test.ps1` (a small console test runner compiled with csc; no NuGet), `tv/README.md`
  (troubleshooting guide), `installer/tv/THIRD-PARTY.txt` (sdb's licence notice).
- Modify: `scripts/release.mjs` (build `tv/dist`, run `installer/tv/build.ps1`, upload `FoxbloomTVSetup.exe` with the
  other installers), root `README.md` (one "Samsung TV" section).

**Interfaces:**
- `TvDiscovery.Find(TimeSpan timeout): List<TvInfo>`: SSDP M-SEARCH (`ST: urn:dial-multiscreen-org:service:dial:1`) on
  every IPv4 interface; if none answer within 3 s, a parallel sweep of port 8001 on the PC's /24 (300 ms per host).
  `TvDiscovery.Describe(string ip): TvInfo` from `GET http://ip:8001/api/v2/`.
  `class TvInfo { string Ip, Name, Model, Duid; bool DeveloperMode; string DeveloperIp; }` from `device.name`,
  `device.modelName`, `device.duid`, `device.developerMode == "1"`, `device.developerIP`.
- `SamsungCert.Ensure(IEnumerable<string> duids, Action<string> openBrowser): CertBundle`: loads the saved bundle from
  `%APPDATA%/Foxbloom/tv-cert/` (author and distributor .p12; passwords protected with `ProtectedData` CurrentUser);
  if missing, expired, or a DUID isn't in the distributor certificate, signs in through Samsung's account sign-in in
  the browser with a localhost callback and requests new author/distributor certificates (RSA 2048 key pairs, CSRs)
  for the DUIDs.
- `WgtSigner.Sign(byte[] unsignedWgt, CertBundle cert): byte[]`: Tizen widget signing, `author-signature.xml` and
  `signature1.xml` (W3C XML Digital Signatures for Widgets, RSA-SHA256, every file referenced with SHA-256, the
  distributor signature also covering `author-signature.xml`), using `System.Security.Cryptography.Xml.SignedXml`.
- `Sdb.Install(string ip, byte[] signedWgt, string appId = "FoxbloomTV.foxbloom"): void`: `sdb connect ip:26101`, push
  to `/home/owner/share/tmp/sdk_tools/Foxbloom.wgt`, `sdb shell 0 vd_appinstall <appId> <path>`, then
  `sdb shell 0 was_execute <appId>`; throws `TvInstallException` with a plain message on each failure.
- UI flow: Scanning → TV list (name, model, "Developer Mode on/off", "Enter an address") → if Developer Mode is off or
  `DeveloperIp` isn't this PC: steps + this PC's IP in large type + "Check again" → "Signing in to Samsung…" (first
  time) → "Installing on <name>…" → "Done — Foxbloom is on your TV" with "Install on another TV". Command line
  `FoxbloomTVSetup.exe --tv <ip>` skips the list (for development).

#### 11a: Find TVs
- [ ] **Step 1: Write failing tests**: parse a captured `/api/v2/` JSON sample into `TvInfo` (Developer Mode on, off,
  and a TV whose `developerIP` is another PC); parse an SSDP response's `LOCATION` host; a non-Samsung DIAL device (no
  `/api/v2/`) is left out.
- [ ] **Step 2: Run** `powershell -File installer/tv/test.ps1` → FAIL.
- [ ] **Step 3: Implement** `TvDiscovery` and the UI's list and Developer Mode screens.
- [ ] **Step 4: Run** tests → pass; `powershell -File installer/tv/build.ps1` → exe builds; run it on this PC: with no
  TV it shows "No TVs found" and "Enter an address", never an endless spinner (Review Focus 5).
- [ ] **Step 5: Commit** `git commit -m "TV installer: find Samsung TVs"`

#### 11b: Certificate and signing
- [ ] **Step 0: Research (no code).** Read how Samsung's Certificate Extension for Tizen Studio and the open-source
  Jellyfin2Samsung installer (github.com/Jellyfin2Samsung/Samsung-Jellyfin-Installer) sign in and request author /
  distributor certificates (endpoints, client id, callback, request fields, the Samsung CA chain to include). Write the
  findings at the top of `SamsungCert.cs` as a comment. Check its licence and do not copy its code; write our own.
- [ ] **Step 1: Write failing tests**: `WgtSigner` on a small test wgt with a self-made test certificate produces
  `author-signature.xml` and `signature1.xml` whose signatures verify with `SignedXml.CheckSignature` and whose
  references list every file with the right SHA-256; the saved bundle round-trips through `ProtectedData`; a bundle
  missing a DUID reports `NeedsNewDistributor`.
- [ ] **Step 2: Run** tests → FAIL.
- [ ] **Step 3: Implement** `WgtSigner` and `SamsungCert`.
- [ ] **Step 4: Run** tests → pass. (The real Samsung sign-in is checked with the owner in Task 12.)
- [ ] **Step 5: Commit** `git commit -m "TV installer: Samsung certificate and app signing"`

#### 11c: Install, release wiring, guide
- [ ] **Step 1: Write failing tests**: `Sdb` builds the exact command lines above (with a fake runner) and turns sdb's
  known failure outputs (can't connect, install failed with a code) into plain messages.
- [ ] **Step 2: Run** tests → FAIL.
- [ ] **Step 3: Implement** `Sdb`, the install screens, `installer/tv/build.ps1` resources, release wiring and
  `tv/README.md` (Developer Mode steps, what each installer message means, certificate renewal).
- [ ] **Step 4: Run** root `npm test` and `powershell -File installer/tv/test.ps1` → pass; build both installers.
- [ ] **Step 5: Commit** `git commit -m "TV installer: install over sdb, release and guide"`

### Task 12: Check on the real TV with the owner

- [ ] **Step 1:** The owner turns on Developer Mode on the TV (they do every TV-side step and the Samsung sign-in).
- [ ] **Step 2:** Run FoxbloomTVSetup.exe with the owner: the TV shows in the list, Samsung sign-in works, the app
  installs and opens.
- [ ] **Step 3:** With the owner: add two people by pairing (one with a PIN), play a movie and an anime episode
  (switch sub/dub, turn subtitles on), skip intro, let it roll to the next episode, Back out, check Continue watching
  on the phone; repeat one playback on mobile data / away to see "Away".
- [ ] **Step 4:** Note anything that failed and fix it in the owning task's files with a test.
