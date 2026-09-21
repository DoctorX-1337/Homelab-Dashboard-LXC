#!/usr/bin/env bash
set -Eeuo pipefail

readonly REQUEST_FILE=/run/homelab-dashboard/pin-change-request
readonly PIN_FILE=/opt/homelab-dashboard/data/settings-pin

[[ -f $REQUEST_FILE ]] || exit 0
grep -Eq '^pbkdf2_sha256\$[0-9]+\$[A-Za-z0-9_=/+-]+\$[A-Za-z0-9_=/+-]+$' "$REQUEST_FILE" || {
  rm -f -- "$REQUEST_FILE"
  echo "Ungültige PIN-Änderungsanforderung." >&2
  exit 1
}
install -o root -g homelab-dashboard -m 0640 "$REQUEST_FILE" "$PIN_FILE"
rm -f -- "$REQUEST_FILE"
sleep 1
systemctl restart homelab-dashboard
