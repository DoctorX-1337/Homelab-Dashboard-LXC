#!/usr/bin/env bash
set -Eeuo pipefail

[[ ${EUID} -eq 0 ]] || { echo "Das Dashboard-Update benötigt root-Rechte." >&2; exit 1; }

readonly APP_DIR=/opt/homelab-dashboard
readonly REQUEST_FILE=/run/homelab-dashboard/update-request
readonly STATE_FILE="$APP_DIR/data/update-state.json"
readonly TAGS_API_URL=https://api.github.com/repos/DoctorX-1337/Homelab-Dashboard-LXC/tags?per_page=100
readonly ARCHIVE_BASE_URL=https://github.com/DoctorX-1337/Homelab-Dashboard-LXC/archive/refs/tags

write_state() {
  local status=$1 message=$2 target=${3:-} progress=${4:-0}
  mkdir -p "$(dirname "$STATE_FILE")"
  python3 - "$STATE_FILE" "$status" "$message" "$target" "$progress" <<'PY'
import json
import os
import sys
from datetime import UTC, datetime

path, status, message, target, progress = sys.argv[1:]
temporary = f"{path}.tmp"
with open(temporary, "w", encoding="utf-8") as handle:
    json.dump(
        {"status": status, "message": message, "target_version": target or None,
         "progress": max(0, min(100, int(progress))),
         "updated_at": datetime.now(UTC).isoformat()},
        handle,
        ensure_ascii=False,
        indent=2,
    )
    handle.write("\n")
os.replace(temporary, path)
PY
  chown homelab-dashboard:homelab-dashboard "$STATE_FILE"
  chmod 0640 "$STATE_FILE"
}

exec 9>/run/lock/homelab-dashboard-update.lock
flock -n 9 || { echo "Eine Dashboard-Aktualisierung läuft bereits."; exit 0; }
rm -f -- "$REQUEST_FILE"

current_version=$(tr -d '[:space:]' < "$APP_DIR/VERSION")
[[ $current_version =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || {
  write_state failed "Ungültige lokal installierte Version" "" 100
  exit 1
}

write_state running "Veröffentlichte Version wird geprüft" "" 5

latest_tag=$(
  curl --fail --silent --show-error --location --connect-timeout 8 --max-time 30 \
    -H 'Accept: application/vnd.github+json' \
    -H 'User-Agent: Homelab-Dashboard-Manual-Update' \
    "$TAGS_API_URL" |
  python3 -c 'import json,re,sys; tags=[x["name"] for x in json.load(sys.stdin)]; valid=[(tuple(map(int,t.removeprefix("v").split("."))),t) for t in tags if re.fullmatch(r"v?\d+\.\d+\.\d+",t)]; print(max(valid)[1] if valid else "")'
)
latest_version=${latest_tag#v}
[[ $latest_version =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || {
  write_state failed "Keine gültige veröffentlichte Version gefunden" "" 100
  exit 1
}

if [[ $current_version == "$latest_version" ]] ||
   [[ $(printf '%s\n%s\n' "$current_version" "$latest_version" | sort -V | tail -n 1) != "$latest_version" ]]; then
  write_state idle "Dashboard ist aktuell" "$current_version" 100
  exit 0
fi

work_dir=$(mktemp -d /tmp/homelab-dashboard-update.XXXXXX)
trap 'rm -rf -- "$work_dir"' EXIT
mkdir -p "$work_dir/source" "$work_dir/backup"
chmod 0755 "$work_dir/source" "$work_dir/backup"
write_state running "Update wird heruntergeladen" "$latest_version" 15

curl --fail --silent --show-error --location \
  --proto '=https' --tlsv1.2 --connect-timeout 8 --max-time 120 \
  "$ARCHIVE_BASE_URL/$latest_tag.tar.gz" -o "$work_dir/release.tar.gz"
tar -xzf "$work_dir/release.tar.gz" --strip-components=1 -C "$work_dir/source"
write_state running "Download abgeschlossen, Archiv wird geprüft" "$latest_version" 28

archive_version=$(tr -d '[:space:]' < "$work_dir/source/VERSION")
[[ $archive_version == "$latest_version" ]] || {
  write_state failed "Versionsprüfung des Archivs fehlgeschlagen" "$latest_version" 100
  exit 1
}
write_state running "Archiv geprüft, vorhandener Stand wird gesichert" "$latest_version" 36

exclude_args=(
  --exclude '/data/'
  --exclude '/.venv/'
  --exclude '/backend/.env'
  --exclude '/frontend/node_modules/'
  --exclude '/frontend/dist/'
)
rsync -a --delete "${exclude_args[@]}" "$APP_DIR/" "$work_dir/backup/"
rsync -a --delete "${exclude_args[@]}" "$work_dir/source/" "$APP_DIR/"

write_state running "Neue Version wird installiert" "$latest_version" 46
export DASHBOARD_UPDATE_STATE_FILE="$STATE_FILE"
export DASHBOARD_UPDATE_TARGET_VERSION="$latest_version"
export DASHBOARD_UPDATE_STATUS=running
if bash "$APP_DIR/deploy/update.sh"; then
  write_state success "Update erfolgreich installiert" "$latest_version" 100
  exit 0
fi

write_state rollback "Build fehlgeschlagen, vorherige Version wird wiederhergestellt" "$current_version" 50
rsync -a --delete "${exclude_args[@]}" "$work_dir/backup/" "$APP_DIR/"
export DASHBOARD_UPDATE_TARGET_VERSION="$current_version"
export DASHBOARD_UPDATE_STATUS=rollback
if bash "$APP_DIR/deploy/update.sh"; then
  write_state failed "Update fehlgeschlagen; vorherige Version wiederhergestellt" "$current_version" 100
else
  write_state failed "Update und automatische Wiederherstellung fehlgeschlagen" "$current_version" 100
fi
exit 1
