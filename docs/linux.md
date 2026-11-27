# Foxbloom on Ubuntu Server

The Linux counterpart of `FoxbloomSetup.exe`: one command installs Foxbloom as a system service on a headless
Ubuntu Server (made for **24.04 LTS**, also works on 22.04; x64 or ARM64).

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/Scrapper1824/Foxbloom/main/installer/linux/install.sh | sudo bash
```

To use another port than 7979, add `-s -- --port 8080` after `bash`.

The script:

1. installs **Node.js 22** (from NodeSource), **Git** and **FFmpeg** if they're missing or too old
2. creates a system user **`foxbloom`** (no login, no password). It also joins `video`/`render` so FFmpeg can use the GPU
3. downloads the latest release into **`/opt/foxbloom`**, installs its packages and builds it
4. keeps your settings, users and library database in **`/var/lib/foxbloom`**
5. installs and starts the systemd service **`foxbloom`**, which starts on boot and restarts if it stops
6. opens the port in `ufw` if that firewall is on, then prints the address and your first-run **setup code**

Running it again on an installed server reinstalls the packages and rebuilds without touching your data.
For a newer version, use the in-app update (below).

## Every day

| What | Command |
| --- | --- |
| Is it running? | `systemctl status foxbloom` |
| Live log | `journalctl -u foxbloom -f` |
| Restart / stop / start | `sudo systemctl restart foxbloom` (or `stop`, `start`) |
| Don't start on boot | `sudo systemctl disable foxbloom` |
| Forgotten admin password | `sudo -u foxbloom MEDIARR_DATA=/var/lib/foxbloom node /opt/foxbloom/server/dist/resetPassword.js <username>` |
| First-run setup code again | `sudo cat /var/lib/foxbloom/setup-code.txt` |

Settings that live outside the app (port, listen address, reverse proxy) are in **`/etc/foxbloom.env`**.
After changing one, run `sudo systemctl restart foxbloom`.

## Media folders and qBittorrent

Foxbloom runs as the `foxbloom` user. That user needs to **read** your library folders, and to **write** to
the folders where finished downloads are moved. For example, if your media is in `/srv/media`:

```bash
sudo setfacl -R -m u:foxbloom:rwX -m d:u:foxbloom:rwX /srv/media    # needs: sudo apt install acl
```

You can also add `foxbloom` to a group that already owns the files (`sudo usermod -aG mediagroup foxbloom`,
then `sudo systemctl restart foxbloom`).

qBittorrent and Prowlarr can run anywhere. Put their addresses in **Settings → Downloads / Indexers** as on
Windows. If qBittorrent runs on this server as another user, both users need access to the download folder.

## Updates

As on Windows: admins see **Update available**. Clicking **Update & restart** fetches the release, reinstalls
packages, rebuilds, then exits. systemd starts the new version a few seconds later. If anything fails, the
previous version is put back. The update log is `/var/lib/foxbloom/update.log`.

## Reverse proxy / HTTPS (optional)

Foxbloom listens on port 7979 on every interface. To put it behind nginx, Caddy or similar on the **same**
server, nothing else is needed. For a proxy on another machine, set `TRUST_PROXY=<its IP>` in
`/etc/foxbloom.env`. When it serves HTTPS, also set `COOKIE_SECURE=true`. Video streaming needs long
timeouts and no response buffering at the proxy.

## Uninstall

```bash
curl -fsSL https://raw.githubusercontent.com/Scrapper1824/Foxbloom/main/installer/linux/install.sh | sudo bash -s -- --uninstall
```

This stops and removes the service and deletes `/opt/foxbloom`. It **keeps** `/var/lib/foxbloom` and
`/etc/foxbloom.env`, so installing again picks up where you left off. To delete those and the `foxbloom` user
as well, add `--purge` (it asks first; add `--yes` to skip the question). Node.js, Git and FFmpeg stay
installed, and your media files are never touched.

## Files

| Path | What |
| --- | --- |
| `/opt/foxbloom` | the app (a Git copy of this repository at a release tag) |
| `/var/lib/foxbloom` | data: `mediarr.db`, setup code, update log, previews |
| `/var/cache/foxbloom` | npm's download cache |
| `/etc/foxbloom.env` | port and proxy settings |
| `/etc/systemd/system/foxbloom.service` | the service (rewritten on reinstall) |
