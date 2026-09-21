#!/usr/bin/env bash
set -Eeuo pipefail

[[ ${EUID} -eq 0 ]] || { echo "Dieses Skript muss auf einem Proxmox-Host als root laufen." >&2; exit 1; }
command -v pct >/dev/null || { echo "pct wurde nicht gefunden. Bitte direkt auf einem Proxmox-VE-Host ausführen." >&2; exit 1; }
command -v pveam >/dev/null || { echo "pveam wurde nicht gefunden." >&2; exit 1; }
command -v pvesh >/dev/null || { echo "pvesh wurde nicht gefunden." >&2; exit 1; }
command -v pvesm >/dev/null || { echo "pvesm wurde nicht gefunden." >&2; exit 1; }
command -v curl >/dev/null || { echo "curl wurde nicht gefunden." >&2; exit 1; }
command -v python3 >/dev/null || { echo "python3 wurde nicht gefunden." >&2; exit 1; }

readonly REPOSITORY="DoctorX-1337/Homelab-Dashboard-LXC"
CTID=${CTID:-$(pvesh get /cluster/nextid)}
CT_HOSTNAME=${CT_HOSTNAME:-homelab-dashboard}
CORES=${CORES:-2}
MEMORY=${MEMORY:-2048}
SWAP=${SWAP:-512}
DISK_SIZE=${DISK_SIZE:-8}
BRIDGE=${BRIDGE:-vmbr0}
IP_CONFIG=${IP_CONFIG:-dhcp}
STORAGE=${STORAGE:-$(pvesm status --content rootdir | awk 'NR > 1 && $3 == "active" {print $1; exit}')}
TEMPLATE_STORAGE=${TEMPLATE_STORAGE:-$(pvesm status --content vztmpl | awk 'NR > 1 && $3 == "active" {print $1; exit}')}
DASHBOARD_VERSION=${DASHBOARD_VERSION:-latest}

[[ $CTID =~ ^[0-9]+$ ]] || { echo "CTID muss numerisch sein." >&2; exit 1; }
[[ $CORES =~ ^[0-9]+$ && $MEMORY =~ ^[0-9]+$ && $DISK_SIZE =~ ^[0-9]+$ ]] || {
  echo "CORES, MEMORY und DISK_SIZE müssen numerisch sein." >&2
  exit 1
}
[[ -n $STORAGE && -n $TEMPLATE_STORAGE ]] || {
  echo "Kein geeigneter Container- oder Template-Speicher gefunden." >&2
  exit 1
}
if pct status "$CTID" >/dev/null 2>&1; then
  echo "CT $CTID existiert bereits; es wurden keine Änderungen vorgenommen." >&2
  exit 1
fi

echo "[1/6] Debian-Template wird ermittelt …"
pveam update >/dev/null
template=$(pveam available --section system | awk '$2 ~ /^debian-13-standard_/ {print $2; exit}')
if [[ -z $template ]]; then
  template=$(pveam available --section system | awk '$2 ~ /^debian-12-standard_/ {print $2; exit}')
fi
[[ -n $template ]] || { echo "Kein unterstütztes Debian-LXC-Template gefunden." >&2; exit 1; }
if ! pveam list "$TEMPLATE_STORAGE" | awk '{print $1}' | grep -Fqx "$TEMPLATE_STORAGE:vztmpl/$template"; then
  pveam download "$TEMPLATE_STORAGE" "$template"
fi
template_path=$(pvesm path "$TEMPLATE_STORAGE:vztmpl/$template")

echo "[2/6] Unprivilegierter LXC $CTID wird erstellt …"
pct create "$CTID" "$template_path" \
  --hostname "$CT_HOSTNAME" \
  --cores "$CORES" \
  --memory "$MEMORY" \
  --swap "$SWAP" \
  --rootfs "$STORAGE:$DISK_SIZE" \
  --net0 "name=eth0,bridge=$BRIDGE,ip=$IP_CONFIG" \
  --unprivileged 1 \
  --onboot 1
pct start "$CTID"

echo "[3/6] Netzwerk wird abgewartet …"
for _ in $(seq 1 60); do
  if pct exec "$CTID" -- getent hosts github.com >/dev/null 2>&1; then
    break
  fi
  sleep 2
done
pct exec "$CTID" -- getent hosts github.com >/dev/null 2>&1 || {
  echo "Der Container hat nach 120 Sekunden keine funktionierende Namensauflösung." >&2
  exit 1
}

echo "[4/6] Release wird ermittelt …"
if [[ $DASHBOARD_VERSION == latest ]]; then
  DASHBOARD_VERSION=$(
    curl --fail --silent --show-error --location \
      -H 'Accept: application/vnd.github+json' \
      -H 'User-Agent: Homelab-Dashboard-PVE-Installer' \
      "https://api.github.com/repos/$REPOSITORY/tags?per_page=100" |
    python3 -c 'import json,re,sys; tags=[x.get("name","") for x in json.load(sys.stdin)]; valid=[(tuple(map(int,t.removeprefix("v").split("."))),t) for t in tags if re.fullmatch(r"v?\d+\.\d+\.\d+",t)]; print(max(valid)[1] if valid else "")'
  )
fi
[[ $DASHBOARD_VERSION =~ ^v?[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "Keine gültige Release-Version gefunden." >&2; exit 1; }
release_tag=${DASHBOARD_VERSION#v}

echo "[5/6] Dashboard v$release_tag wird installiert …"
pct exec "$CTID" -- bash -lc 'apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ca-certificates curl tar'
pct exec "$CTID" -- bash -s -- "$REPOSITORY" "$release_tag" <<'CONTAINER_INSTALL'
set -Eeuo pipefail
repository=$1
version=$2
install -d -m 0755 /opt/homelab-dashboard
curl --fail --silent --show-error --location \
  --proto '=https' --tlsv1.2 \
  "https://github.com/$repository/archive/refs/tags/v$version.tar.gz" |
  tar -xz --strip-components=1 -C /opt/homelab-dashboard
bash /opt/homelab-dashboard/deploy/install.sh
CONTAINER_INSTALL

echo "[6/6] Installation wird geprüft …"
pct exec "$CTID" -- curl --fail --silent http://127.0.0.1/api/status >/dev/null
container_ip=$(pct exec "$CTID" -- hostname -I | awk '{print $1}')
cat <<EOF

HomeLab Dashboard v$release_tag wurde erfolgreich installiert.
Container: CT $CTID ($CT_HOSTNAME)
Adresse:   http://$container_ip/

Optional: Proxmox-API-Token in CT $CTID unter
  /etc/homelab-dashboard.env
eintragen und danach ausführen:
  pct exec $CTID -- systemctl restart homelab-dashboard
EOF
