#!/usr/bin/env bash
# Checks the tracked branch for new commits and, if there are any, pulls,
# reinstalls dependencies only if the lockfile changed, and restarts the
# service. Run as root (it shells out to `sudo -u quickdash` for the git/npm
# steps so files stay owned by the app user) via the quickdash-autoupdate
# systemd timer — see quickdash-autoupdate.timer.
set -euo pipefail

APP_DIR="/opt/quickdash"
APP_USER="quickdash"
cd "$APP_DIR"

sudo -u "$APP_USER" git fetch origin --quiet

LOCAL=$(sudo -u "$APP_USER" git rev-parse HEAD)
REMOTE=$(sudo -u "$APP_USER" git rev-parse '@{u}')

if [ "$LOCAL" = "$REMOTE" ]; then
  exit 0
fi

echo "$(date -Is) Updating QuickDash: $LOCAL -> $REMOTE"

if sudo -u "$APP_USER" git diff --quiet "$LOCAL" "$REMOTE" -- package-lock.json; then
  LOCKFILE_CHANGED=0
else
  LOCKFILE_CHANGED=1
fi

sudo -u "$APP_USER" git pull --ff-only

if [ "$LOCKFILE_CHANGED" -eq 1 ]; then
  echo "package-lock.json changed, reinstalling dependencies"
  sudo -u "$APP_USER" npm ci --omit=dev
fi

systemctl restart quickdash
echo "$(date -Is) QuickDash updated and restarted ($REMOTE)."
