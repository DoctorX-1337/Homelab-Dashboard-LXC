#!/usr/bin/env bash
set -Eeuo pipefail
[[ ${EUID} -eq 0 ]] || { echo "Bitte als root ausführen." >&2; exit 1; }
APP_DIR=/opt/homelab-dashboard
install -d -o homelab-dashboard -g homelab-dashboard -m 0750 "$APP_DIR/data" "$APP_DIR/data/config"
for config_file in services.yaml links.yaml; do
  if [[ ! -f "$APP_DIR/data/config/$config_file" ]]; then
    install -o homelab-dashboard -g homelab-dashboard -m 0640 "$APP_DIR/config/$config_file" "$APP_DIR/data/config/$config_file"
  fi
done

report_progress() {
  local progress=$1 message=$2
  [[ -n ${DASHBOARD_UPDATE_STATE_FILE:-} ]] || return 0
  python3 - "$DASHBOARD_UPDATE_STATE_FILE" "$progress" "$message" "${DASHBOARD_UPDATE_TARGET_VERSION:-}" "${DASHBOARD_UPDATE_STATUS:-running}" <<'PY'
import json
import os
import sys
from datetime import UTC, datetime

path, progress, message, target, status = sys.argv[1:]
temporary = f"{path}.step.tmp"
with open(temporary, "w", encoding="utf-8") as handle:
    json.dump(
        {"status": status, "message": message, "progress": int(progress),
         "target_version": target or None, "updated_at": datetime.now(UTC).isoformat()},
        handle,
        ensure_ascii=False,
        indent=2,
    )
    handle.write("\n")
os.replace(temporary, path)
PY
  chown homelab-dashboard:homelab-dashboard "$DASHBOARD_UPDATE_STATE_FILE"
  chmod 0640 "$DASHBOARD_UPDATE_STATE_FILE"
}

report_progress 52 "Backend-Abhängigkeiten werden geprüft"
if ! command -v rsync >/dev/null 2>&1; then
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends rsync
fi
"$APP_DIR/.venv/bin/pip" install --disable-pip-version-check --no-cache-dir -r "$APP_DIR/backend/requirements.txt"
report_progress 64 "Frontend-Abhängigkeiten werden installiert"
pushd "$APP_DIR/frontend" >/dev/null
npm install --ignore-scripts --no-audit --no-fund
report_progress 76 "Frontend wird gebaut"
npm run build
popd >/dev/null
report_progress 88 "Systemdienste werden aktualisiert"
install -o root -g root -m 0644 "$APP_DIR/deploy/homelab-dashboard.service" /etc/systemd/system/homelab-dashboard.service
install -o root -g root -m 0755 "$APP_DIR/deploy/manual-update.sh" /usr/local/sbin/homelab-dashboard-manual-update
install -o root -g root -m 0644 "$APP_DIR/deploy/homelab-dashboard-update.service" /etc/systemd/system/homelab-dashboard-update.service
install -o root -g root -m 0644 "$APP_DIR/deploy/homelab-dashboard-update.path" /etc/systemd/system/homelab-dashboard-update.path
install -o root -g root -m 0644 "$APP_DIR/deploy/nginx.conf" /etc/nginx/sites-available/homelab-dashboard
chown -R homelab-dashboard:homelab-dashboard "$APP_DIR"
chmod 0755 "$APP_DIR" "$APP_DIR/frontend" "$APP_DIR/frontend/dist"
systemctl daemon-reload
systemctl enable --now homelab-dashboard-update.path
report_progress 94 "Dashboard-Dienste werden neu gestartet"
systemctl restart homelab-dashboard nginx
for attempt in $(seq 1 30); do
  if curl --fail --silent http://127.0.0.1/api/status >/dev/null; then
    report_progress 98 "Neustart erfolgreich, Abschlussprüfung läuft"
    echo "Update erfolgreich."
    exit 0
  fi
  sleep 1
done
journalctl -u homelab-dashboard --no-pager -n 40 >&2
echo "Dashboard-API wurde nach dem Neustart nicht rechtzeitig bereit." >&2
exit 1
