#!/usr/bin/env bash
set -Eeuo pipefail

[[ ${EUID} -eq 0 ]] || { echo "Dieses Skript benötigt root-Rechte." >&2; exit 1; }
readonly PIN_FILE=/opt/homelab-dashboard/data/settings-pin
hash_file=""

if [[ ${1:-} == --hash-file ]]; then
  hash_file=${2:-}
  [[ -f $hash_file ]] || { echo "PIN-Hashdatei fehlt." >&2; exit 1; }
  grep -Eq '^pbkdf2_sha256\$[0-9]+\$[A-Za-z0-9_=/+-]+\$[A-Za-z0-9_=/+-]+$' "$hash_file" || {
    echo "PIN-Hashdatei ist ungültig." >&2
    exit 1
  }
else
  [[ -t 0 ]] || { echo "Für die PIN-Eingabe ist ein interaktives Terminal erforderlich." >&2; exit 1; }
  while true; do
    read -r -s -p "Vierstelligen Einstellungen-PIN festlegen: " pin
    echo
    read -r -s -p "PIN wiederholen: " confirmation
    echo
    if [[ $pin =~ ^[0-9]{4}$ && $pin == "$confirmation" ]]; then
      break
    fi
    echo "Die PINs stimmen nicht überein oder enthalten nicht genau vier Ziffern." >&2
  done
  hash_file=$(mktemp /run/homelab-dashboard-pin.XXXXXX)
  chmod 0600 "$hash_file"
  printf '%s' "$pin" | python3 -c 'import base64,hashlib,secrets,sys; pin=sys.stdin.read(); salt=secrets.token_bytes(16); rounds=600000; digest=hashlib.pbkdf2_hmac("sha256",pin.encode(),salt,rounds); print(f"pbkdf2_sha256${rounds}${base64.urlsafe_b64encode(salt).decode()}${base64.urlsafe_b64encode(digest).decode()}")' >"$hash_file"
  unset pin confirmation
  trap 'rm -f -- "$hash_file"' EXIT
fi

getent group homelab-dashboard >/dev/null || { echo "Dashboard-Gruppe ist noch nicht vorhanden." >&2; exit 1; }
install -d -o homelab-dashboard -g homelab-dashboard -m 0750 "$(dirname "$PIN_FILE")"
install -o root -g homelab-dashboard -m 0640 "$hash_file" "$PIN_FILE"
if systemctl is-active --quiet homelab-dashboard; then
  systemctl restart homelab-dashboard
fi
echo "Einstellungen-PIN wurde sicher gespeichert."
