#!/usr/bin/env bash
# Foxbloom setup for Ubuntu Server (the Linux counterpart of FoxbloomSetup.exe).
#
#   Install (or reinstall):
#     curl -fsSL https://raw.githubusercontent.com/Scrapper1824/Foxbloom/main/installer/linux/install.sh | sudo bash
#   Uninstall (keeps your library, users and settings in /var/lib/foxbloom):
#     curl -fsSL https://raw.githubusercontent.com/Scrapper1824/Foxbloom/main/installer/linux/install.sh | sudo bash -s -- --uninstall
#   Uninstall and delete everything, data included:
#     ... | sudo bash -s -- --uninstall --purge
#
# Options: --port N (default 7979), --uninstall, --purge, --yes (don't ask), --help.
# What it does: installs Node.js 22, Git and FFmpeg if they're missing, creates a "foxbloom" system user,
# downloads the latest release into /opt/foxbloom, builds it, keeps data in /var/lib/foxbloom, and runs it as
# the systemd service "foxbloom" (starts on boot, restarts if it crashes). Updates install from inside Foxbloom
# (Settings → System → Updates). See docs/linux.md.
#
# Everything runs inside main(), called on the last line, so a half-downloaded script never runs.
set -euo pipefail

REPO="Scrapper1824/Foxbloom"
REPO_URL="https://github.com/${REPO}.git"
APP_DIR="/opt/foxbloom"
DATA_DIR="/var/lib/foxbloom"
CACHE_DIR="/var/cache/foxbloom"
ENV_FILE="/etc/foxbloom.env"
UNIT_FILE="/etc/systemd/system/foxbloom.service"
SERVICE_USER="foxbloom"
NODE_MAJOR=22
NODE_MIN="22.13.0"

# For testing a branch or a local copy: FOXBLOOM_REPO_URL=/path/to/clone FOXBLOOM_REF=main
SOURCE_URL="${FOXBLOOM_REPO_URL:-$REPO_URL}"
SOURCE_REF="${FOXBLOOM_REF:-}"

PORT=7979
PORT_GIVEN=0
ACTION=install
PURGE=0
YES=0

say() { printf '\033[1;35m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!!\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31mError:\033[0m %s\n' "$*" >&2; exit 1; }

usage() {
  sed -n '2,16p' "$0" 2>/dev/null | sed 's/^# \{0,1\}//' || true
  echo "Options: --port N, --uninstall, --purge, --yes, --help"
}

# Asks yes/no on the terminal (works under curl | bash too). No terminal and no --yes: the answer is no.
confirm() {
  [ "$YES" = 1 ] && return 0
  local answer=""
  if [ -r /dev/tty ]; then
    printf '%s [y/N] ' "$1" >/dev/tty
    read -r answer </dev/tty || true
  fi
  [[ "$answer" =~ ^[Yy] ]]
}

as_app() { runuser -u "$SERVICE_USER" -- env HOME="$DATA_DIR" npm_config_cache="$CACHE_DIR/npm" GIT_TERMINAL_PROMPT=0 "$@"; }

# "a.b.c" >= "x.y.z"
version_ge() { [ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -n1)" = "$2" ]; }

parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --uninstall) ACTION=uninstall ;;
      --purge) PURGE=1 ;;
      --yes|-y) YES=1 ;;
      --port) [ $# -ge 2 ] || die "--port needs a number"; PORT="$2"; PORT_GIVEN=1; shift ;;
      --port=*) PORT="${1#--port=}"; PORT_GIVEN=1 ;;
      --help|-h) usage; exit 0 ;;
      *) die "Unknown option: $1 (try --help)" ;;
    esac
    shift
  done
  [[ "$PORT" =~ ^[0-9]+$ ]] && [ "$PORT" -ge 1 ] && [ "$PORT" -le 65535 ] || die "--port must be a number from 1 to 65535"
  if [ "$PURGE" = 1 ] && [ "$ACTION" != uninstall ]; then die "--purge only goes with --uninstall"; fi
}

preflight() {
  [ "$(id -u)" = 0 ] || die "Run this with sudo (it installs packages and a system service)."
  command -v systemctl >/dev/null && [ -d /run/systemd/system ] || die "This setup needs systemd, which isn't running here."
  if [ -r /etc/os-release ]; then
    # shellcheck disable=SC1091
    . /etc/os-release
    case "${ID:-}:${ID_LIKE:-}" in
      ubuntu:*|debian:*|*:*debian*|*:*ubuntu*) ;;
      *) warn "This setup is made for Ubuntu Server; ${PRETTY_NAME:-this system} may not work." ;;
    esac
  fi
  command -v apt-get >/dev/null || die "apt-get wasn't found. This setup is for Ubuntu (or Debian)."
}

# ---------- Dependencies ----------

APT_UPDATED=0
apt_install() {
  if [ "$APT_UPDATED" = 0 ]; then
    say "Updating the package list…"
    apt-get update -qq
    APT_UPDATED=1
  fi
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends "$@" >/dev/null
}

ensure_node() {
  local have=""
  if command -v node >/dev/null; then have="$(node -p 'process.versions.node' 2>/dev/null || true)"; fi
  if [ -n "$have" ] && version_ge "$have" "$NODE_MIN" && command -v npm >/dev/null; then
    say "Node.js $have — $(command -v node)"
    return
  fi
  if [ -n "$have" ]; then say "Node.js $have is too old (Foxbloom needs $NODE_MIN or newer); installing Node.js $NODE_MAJOR…"
  else say "Installing Node.js $NODE_MAJOR (from NodeSource)…"; fi
  apt_install ca-certificates curl gnupg
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
  chmod 0644 /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" >/etc/apt/sources.list.d/nodesource.list
  APT_UPDATED=0
  apt_install nodejs
  hash -r
  have="$(node -p 'process.versions.node' 2>/dev/null || true)"
  if [ -z "$have" ] || ! version_ge "$have" "$NODE_MIN"; then die "Node.js $NODE_MIN or newer still isn't available (found: ${have:-none})."; fi
  say "Node.js $have — $(command -v node)"
}

ensure_tools() {
  local missing=()
  command -v git >/dev/null || missing+=(git)
  command -v curl >/dev/null || missing+=(curl)
  command -v ffmpeg >/dev/null && command -v ffprobe >/dev/null || missing+=(ffmpeg)
  if [ ${#missing[@]} -gt 0 ]; then
    say "Installing ${missing[*]}…"
    apt_install ca-certificates "${missing[@]}"
  fi
  say "Git $(git --version | awk '{print $3}'), FFmpeg $(ffmpeg -version 2>/dev/null | awk 'NR==1{print $3}')"
}

# ---------- Install ----------

ensure_user() {
  if ! id "$SERVICE_USER" >/dev/null 2>&1; then
    say "Creating the system user \"$SERVICE_USER\"…"
    useradd --system --user-group --home-dir "$DATA_DIR" --no-create-home --shell /usr/sbin/nologin \
      --comment "Foxbloom media server" "$SERVICE_USER"
  fi
  # The GPU, for hardware video conversion (VAAPI / Quick Sync), when the server has one.
  for g in video render; do
    if getent group "$g" >/dev/null; then usermod -aG "$g" "$SERVICE_USER"; fi
  done
  install -d -m 0755 -o "$SERVICE_USER" -g "$SERVICE_USER" "$APP_DIR"
  install -d -m 0750 -o "$SERVICE_USER" -g "$SERVICE_USER" "$DATA_DIR"
  install -d -m 0750 -o "$SERVICE_USER" -g "$SERVICE_USER" "$CACHE_DIR"
}

latest_tag() {
  local tag=""
  tag="$(curl -fsSL --max-time 20 -H 'Accept: application/vnd.github+json' "https://api.github.com/repos/${REPO}/releases/latest" 2>/dev/null |
    sed -n 's/.*"tag_name": *"\(v[0-9]*\.[0-9]*\.[0-9]*\)".*/\1/p' | head -n1 || true)"
  if [ -z "$tag" ]; then
    # GitHub's API limits how often one network can ask; the tags themselves don't.
    tag="$(git ls-remote --tags --refs "$REPO_URL" 'v*' 2>/dev/null | sed -n 's#.*refs/tags/\(v[0-9]*\.[0-9]*\.[0-9]*\)$#\1#p' | sort -V | tail -n1 || true)"
  fi
  printf '%s' "$tag"
}

fetch_code() {
  if [ -d "$APP_DIR/.git" ]; then
    say "Foxbloom is already installed in $APP_DIR: reinstalling its packages and rebuilding (your data stays as it is)."
    say "For a newer version, use Settings → System → Updates in Foxbloom."
    return
  fi
  if [ -n "$(ls -A "$APP_DIR" 2>/dev/null)" ]; then die "$APP_DIR already has other files in it. Move them away, then run this again."; fi
  local ref="$SOURCE_REF"
  if [ -z "$ref" ]; then
    say "Finding the latest release…"
    ref="$(latest_tag)"
  fi
  say "Downloading Foxbloom${ref:+ $ref} from ${SOURCE_URL}…"
  as_app git clone --quiet "$SOURCE_URL" "$APP_DIR"
  # In-app updates fetch from GitHub; keep origin pointing there even when testing from a local copy.
  as_app git -C "$APP_DIR" remote set-url origin "$REPO_URL"
  # Stay on main (so in-app updates can fast-forward it) at the released version.
  if [ -n "$ref" ]; then as_app git -C "$APP_DIR" reset --quiet --hard "$ref"; fi
}

build_app() {
  say "Installing packages (this takes a minute or two)…"
  (cd "$APP_DIR" && as_app npm ci --no-audit --no-fund --loglevel=error)
  say "Building Foxbloom…"
  (cd "$APP_DIR" && as_app npm run build --silent >/dev/null)
  [ -f "$APP_DIR/server/dist/index.js" ] || die "The build didn't produce server/dist/index.js."
}

write_env() {
  # Settings you may change by hand (sudo nano /etc/foxbloom.env, then sudo systemctl restart foxbloom).
  if [ -f "$ENV_FILE" ]; then
    if [ "$PORT_GIVEN" = 1 ]; then
      if grep -q '^PORT=' "$ENV_FILE"; then sed -i "s/^PORT=.*/PORT=$PORT/" "$ENV_FILE"; else echo "PORT=$PORT" >>"$ENV_FILE"; fi
    else
      PORT="$(sed -n 's/^PORT=\([0-9]*\).*/\1/p' "$ENV_FILE" | tail -n1)"
      PORT="${PORT:-7979}"
    fi
    return
  fi
  cat >"$ENV_FILE" <<EOF
# Foxbloom settings. After changing one: sudo systemctl restart foxbloom
PORT=$PORT
# Listen address (0.0.0.0 = every network interface).
HOST=0.0.0.0
# Behind a reverse proxy on another machine, set its IP (or a range like 172.16.0.0/12).
#TRUST_PROXY=
# Served over HTTPS (through a proxy): mark sign-in cookies secure.
#COOKIE_SECURE=true
EOF
  chmod 0644 "$ENV_FILE"
}

write_unit() {
  local node
  node="$(command -v node)"
  cat >"$UNIT_FILE" <<EOF
# Installed by Foxbloom setup (installer/linux/install.sh). Reinstalling rewrites this file;
# put your own settings in $ENV_FILE instead.
[Unit]
Description=Foxbloom media server
Documentation=https://github.com/${REPO}/blob/main/docs/linux.md
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
Group=$SERVICE_USER
WorkingDirectory=$APP_DIR
Environment=HOME=$DATA_DIR
Environment=MEDIARR_DATA=$DATA_DIR
Environment=MEDIARR_SERVICE=systemd
Environment=npm_config_cache=$CACHE_DIR/npm
Environment=GIT_TERMINAL_PROMPT=0
EnvironmentFile=-$ENV_FILE
ExecStart=$node $APP_DIR/server/dist/index.js
# Restarts after a crash, and after an in-app update (which exits so the new version starts).
Restart=always
RestartSec=3
# Stop Foxbloom and anything it started (FFmpeg) together.
KillMode=control-group
TimeoutStopSec=20
UMask=0027
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full

[Install]
WantedBy=multi-user.target
EOF
  chmod 0644 "$UNIT_FILE"
}

port_answers() { curl -fs -o /dev/null --max-time 2 "http://127.0.0.1:$PORT/" 2>/dev/null; }

start_service() {
  systemctl daemon-reload
  systemctl enable --quiet foxbloom
  if systemctl is-active --quiet foxbloom; then
    say "Restarting Foxbloom…"
    systemctl restart foxbloom
  else
    if ss -ltnH "sport = :$PORT" 2>/dev/null | grep -q .; then
      warn "Something else is already listening on port $PORT, so Foxbloom can't start there."
      warn "Stop it, or run this again with --port <another port>."
      return 1
    fi
    say "Starting Foxbloom…"
    systemctl start foxbloom
  fi
  local _
  for _ in $(seq 1 60); do
    if port_answers; then return 0; fi
    if [ "$(systemctl is-active foxbloom 2>/dev/null || true)" = failed ]; then break; fi
    sleep 1
  done
  return 1
}

open_firewall() {
  if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q '^Status: active'; then
    say "Allowing port $PORT/tcp through the firewall (ufw)…"
    ufw allow "$PORT/tcp" comment 'Foxbloom' >/dev/null
  fi
}

do_install() {
  ensure_tools
  ensure_node
  ensure_user
  fetch_code
  build_app
  write_env
  write_unit
  open_firewall
  local ip url
  ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  url="http://${ip:-localhost}:$PORT"
  if start_service; then
    echo
    say "Foxbloom is installed and running: $url"
    local code_file="$DATA_DIR/setup-code.txt"
    if [ -s "$code_file" ]; then
      echo
      echo "  To create your admin account, open $url and use this setup code:"
      echo
      echo "      $(tr -d '[:space:]' <"$code_file")"
      echo
      echo "  (It's also in $code_file.)"
    fi
  else
    echo
    warn "Foxbloom was installed but didn't answer on port $PORT yet. See what it says with:"
    warn "  sudo journalctl -u foxbloom -n 50 --no-pager"
  fi
  cat <<EOF

  It starts by itself when the server boots and restarts if it stops.
    Status / logs:  systemctl status foxbloom   ·   journalctl -u foxbloom -f
    Restart:        sudo systemctl restart foxbloom
    Settings:       $ENV_FILE  (port, proxy)   ·   data: $DATA_DIR
    Updates:        inside Foxbloom, Settings → System → Updates
    Media folders:  the "$SERVICE_USER" user needs read access to them (write access for downloads);
                    see https://github.com/${REPO}/blob/main/docs/linux.md
    Uninstall:      curl -fsSL https://raw.githubusercontent.com/${REPO}/main/installer/linux/install.sh | sudo bash -s -- --uninstall
EOF
}

# ---------- Uninstall ----------

do_uninstall() {
  if [ "$PURGE" = 1 ]; then
    confirm "Delete Foxbloom AND its data in $DATA_DIR (users, library, settings, watch history)? This can't be undone." ||
      die "Nothing was removed. (Run with --yes to skip this question.)"
  fi
  say "Stopping and removing the foxbloom service…"
  if [ -f "$UNIT_FILE" ]; then
    systemctl disable --now --quiet foxbloom 2>/dev/null || true
    rm -f "$UNIT_FILE"
    systemctl daemon-reload
    systemctl reset-failed foxbloom 2>/dev/null || true
  fi
  if [ -f "$ENV_FILE" ] && command -v ufw >/dev/null; then
    local p
    p="$(sed -n 's/^PORT=\([0-9]*\).*/\1/p' "$ENV_FILE" | tail -n1)"
    if [ -n "$p" ] && ufw status 2>/dev/null | grep -q "^$p/tcp .*Foxbloom"; then ufw delete allow "$p/tcp" >/dev/null || true; fi
  fi
  say "Removing $APP_DIR and $CACHE_DIR…"
  rm -rf "$APP_DIR" "$CACHE_DIR"
  if [ "$PURGE" = 1 ]; then
    say "Deleting $DATA_DIR, $ENV_FILE and the \"$SERVICE_USER\" user…"
    rm -rf "$DATA_DIR" "$ENV_FILE"
    if id "$SERVICE_USER" >/dev/null 2>&1; then userdel "$SERVICE_USER" 2>/dev/null || true; fi
    getent group "$SERVICE_USER" >/dev/null && groupdel "$SERVICE_USER" 2>/dev/null || true
    say "Foxbloom and all its data are gone."
  else
    say "Foxbloom is removed. Your data is still in $DATA_DIR (and settings in $ENV_FILE):"
    say "installing again picks it up. To delete it too, run the uninstall with --purge."
  fi
  echo "  Node.js, Git and FFmpeg were left installed (other programs may use them)."
}

main() {
  parse_args "$@"
  preflight
  if [ "$ACTION" = uninstall ]; then do_uninstall; else do_install; fi
}

main "$@"
