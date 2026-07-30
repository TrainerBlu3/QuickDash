#!/usr/bin/env bash
# Bootstraps a fresh Ubuntu VM to run QuickDash: installs Node.js and Caddy,
# pulls the app under a dedicated system user, and installs (but does not
# start) the systemd service. Run as root: sudo bash setup.sh
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/TrainerBlu3/QuickDash.git}"
APP_DIR="/opt/quickdash"
APP_USER="quickdash"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root: sudo bash setup.sh" >&2
  exit 1
fi

apt-get update

# Minimal Ubuntu images omit these; everything below assumes they're present.
apt-get install -y curl gnupg git ca-certificates apt-transport-https debian-keyring debian-archive-keyring

# --- Node.js LTS ---
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

# --- Caddy (reverse proxy + automatic HTTPS) ---
if ! command -v caddy >/dev/null 2>&1; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    | tee /etc/apt/sources.list.d/caddy-stable.list
  apt-get update
  apt-get install -y caddy
fi

# --- dedicated, unprivileged app user ---
id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin "$APP_USER"

# --- app code ---
if [ -d "$APP_DIR/.git" ]; then
  sudo -u "$APP_USER" git -C "$APP_DIR" pull
else
  git clone "$REPO_URL" "$APP_DIR"
  chown -R "$APP_USER:$APP_USER" "$APP_DIR"
fi

cd "$APP_DIR"
sudo -u "$APP_USER" npm ci --omit=dev

mkdir -p "$APP_DIR/data"
chown -R "$APP_USER:$APP_USER" "$APP_DIR/data"

# --- .env with a generated session secret ---
if [ ! -f "$APP_DIR/.env" ]; then
  cp "$APP_DIR/.env.example" "$APP_DIR/.env"
  SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  sed -i "s/^SESSION_SECRET=.*/SESSION_SECRET=$SECRET/" "$APP_DIR/.env"
  chown "$APP_USER:$APP_USER" "$APP_DIR/.env"
  chmod 600 "$APP_DIR/.env"
fi

# --- systemd unit (installed, not started yet) ---
cp "$APP_DIR/deploy/quickdash.service" /etc/systemd/system/quickdash.service
systemctl daemon-reload

cat <<EOF

Setup done. Before starting the service:

1. (optional) Set a known admin password instead of a random one:
     sudo nano $APP_DIR/.env        # uncomment/set ADMIN_PASSWORD=...

2. Start QuickDash:
     sudo systemctl enable --now quickdash
     sudo systemctl status quickdash

3. Point Caddy at it — edit /etc/caddy/Caddyfile using $APP_DIR/deploy/Caddyfile
   as a template (fill in your VM's static external IP), then:
     sudo cp $APP_DIR/deploy/Caddyfile /etc/caddy/Caddyfile
     sudo systemctl reload caddy

4. If you didn't set ADMIN_PASSWORD, grab the generated one from the log:
     sudo journalctl -u quickdash -n 50 --no-pager | grep -A2 password
EOF
