#!/usr/bin/env bash
set -Eeuo pipefail

[[ ${EUID} -eq 0 ]] || { echo "Dieses Skript muss auf einem Proxmox-Host als root laufen." >&2; exit 1; }
for required_command in pct pveam pvesh pvesm curl python3; do
  command -v "$required_command" >/dev/null || { echo "$required_command wurde nicht gefunden. Bitte direkt auf einem Proxmox-VE-Host ausführen." >&2; exit 1; }
done

if [[ -t 1 ]]; then
  readonly RESET=$'\033[0m' BOLD=$'\033[1m' DIM=$'\033[2m'
  readonly BLUE=$'\033[38;5;39m' GREEN=$'\033[38;5;40m' YELLOW=$'\033[38;5;220m'
  readonly PURPLE=$'\033[38;5;135m' CYAN=$'\033[38;5;44m' PINK=$'\033[38;5;205m' RED=$'\033[38;5;196m'
else
  readonly RESET='' BOLD='' DIM='' BLUE='' GREEN='' YELLOW='' PURPLE='' CYAN='' PINK='' RED=''
fi

banner() {
  clear 2>/dev/null || true
  printf '%s\n' "${BLUE}${BOLD} _   _                      _          _${RESET}"
  printf '%s\n' "${CYAN}${BOLD}| | | | ___  _ __ ___   ___| |    __ _| |__${RESET}"
  printf '%s\n' "${GREEN}${BOLD}| |_| |/ _ \\| '_ \` _ \\ / _ \\ |   / _\` | '_ \\${RESET}"
  printf '%s\n' "${YELLOW}${BOLD}|  _  | (_) | | | | | |  __/ |__| (_| | |_) |${RESET}"
  printf '%s\n' "${PINK}${BOLD}|_| |_|\\___/|_| |_| |_|\\___|_____\\__,_|_.__/${RESET}"
  printf '\n%s\n' "${PURPLE}${BOLD}        HomeLab Dashboard · Proxmox LXC Installer${RESET}"
  printf '%s\n\n' "${DIM}        Sicher · reproduzierbar · updatefähig${RESET}"
}

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
LOG_FILE="/var/log/homelab-dashboard-installer-${CTID}.log"
CURRENT_TASK="Initialisierung"

fail() { printf '\n%s✗ %s%s\n' "$RED$BOLD" "$1" "$RESET" >&2; exit 1; }
success() { printf '%s✓%s %s\n' "$GREEN$BOLD" "$RESET" "$1"; }

progress() {
  local current=$1 total=$2 label=$3 width=28 filled empty
  filled=$((current * width / total)); empty=$((width - filled))
  printf '\n%s[%d/%d]%s %s\n' "$BOLD" "$current" "$total" "$RESET" "$label"
  printf '%s  [' "$DIM"
  printf '%*s' "$filled" '' | tr ' ' '█'
  printf '%*s' "$empty" '' | tr ' ' '·'
  printf '] %3d%%%s\n' "$((current * 100 / total))" "$RESET"
}

run_task() {
  local label=$1
  shift
  CURRENT_TASK=$label
  printf '  %s⟳%s %s … ' "$YELLOW" "$RESET" "$label"
  if "$@" >>"$LOG_FILE" 2>&1; then
    printf '%sOK%s\n' "$GREEN$BOLD" "$RESET"
  else
    printf '%sFEHLER%s\n' "$RED$BOLD" "$RESET"
    return 1
  fi
}

on_error() {
  local exit_code=$?
  trap - ERR
  printf '\n%s%sInstallation in Phase „%s“ fehlgeschlagen.%s\n' "$RED" "$BOLD" "$CURRENT_TASK" "$RESET" >&2
  printf '%sLetzte Logzeilen:%s\n' "$DIM" "$RESET" >&2
  tail -n 24 "$LOG_FILE" >&2 2>/dev/null || true
  printf '\nLogdatei: %s\n' "$LOG_FILE" >&2
  printf 'CT %s bleibt zur sicheren Diagnose unverändert erhalten.\n' "$CTID" >&2
  exit "$exit_code"
}

banner

[[ $CTID =~ ^[0-9]+$ ]] || fail "CTID muss numerisch sein."
[[ $CORES =~ ^[0-9]+$ && $MEMORY =~ ^[0-9]+$ && $SWAP =~ ^[0-9]+$ && $DISK_SIZE =~ ^[0-9]+$ ]] || fail "CORES, MEMORY, SWAP und DISK_SIZE müssen numerisch sein."
[[ -n $STORAGE && -n $TEMPLATE_STORAGE ]] || fail "Kein geeigneter Container- oder Template-Speicher gefunden."
pct status "$CTID" >/dev/null 2>&1 && fail "CT $CTID existiert bereits; es wurden keine Änderungen vorgenommen."
install -m 0600 /dev/null "$LOG_FILE"
trap on_error ERR

printf '%sInstallationsplan%s\n' "$BOLD" "$RESET"
printf '  %-18s %s\n' 'Container' "CT $CTID · $CT_HOSTNAME"
printf '  %-18s %s\n' 'Ressourcen' "$CORES CPU · ${MEMORY} MB RAM · ${DISK_SIZE} GB Disk"
printf '  %-18s %s\n' 'Speicher' "$STORAGE (Template: $TEMPLATE_STORAGE)"
printf '  %-18s %s\n' 'Netzwerk' "$BRIDGE · $IP_CONFIG"
printf '  %-18s %s\n' 'Release' "$DASHBOARD_VERSION"

progress 1 7 "Debian-Template vorbereiten"
run_task "Proxmox-Templatekatalog aktualisieren" pveam update
template=$(pveam available --section system | awk '$2 ~ /^debian-13-standard_/ {print $2; exit}')
if [[ -z $template ]]; then
  template=$(pveam available --section system | awk '$2 ~ /^debian-12-standard_/ {print $2; exit}')
fi
[[ -n $template ]] || fail "Kein unterstütztes Debian-LXC-Template gefunden."
if ! pveam list "$TEMPLATE_STORAGE" | awk '{print $1}' | grep -Fqx "$TEMPLATE_STORAGE:vztmpl/$template"; then
  run_task "Template $template herunterladen" pveam download "$TEMPLATE_STORAGE" "$template"
else
  success "Template $template ist bereits vorhanden"
fi
template_path=$(pvesm path "$TEMPLATE_STORAGE:vztmpl/$template")

progress 2 7 "Unprivilegierten LXC erstellen"
run_task "CT $CTID auf $STORAGE anlegen" pct create "$CTID" "$template_path" \
  --hostname "$CT_HOSTNAME" \
  --cores "$CORES" \
  --memory "$MEMORY" \
  --swap "$SWAP" \
  --rootfs "$STORAGE:$DISK_SIZE" \
  --net0 "name=eth0,bridge=$BRIDGE,ip=$IP_CONFIG" \
  --unprivileged 1 \
  --onboot 1
run_task "CT $CTID starten" pct start "$CTID"

progress 3 7 "Netzwerk und DNS prüfen"
CURRENT_TASK="Netzwerkverbindung abwarten"
printf '  %s⟳%s Warte auf Namensauflösung' "$YELLOW" "$RESET"
network_ready=false
for attempt in $(seq 1 60); do
  if pct exec "$CTID" -- getent hosts github.com >>"$LOG_FILE" 2>&1; then
    network_ready=true
    break
  fi
  (( attempt % 5 == 0 )) && printf '.'
  sleep 2
done
[[ $network_ready == true ]] || fail "Der Container hat nach 120 Sekunden keine funktionierende Namensauflösung."
printf ' %sOK%s\n' "$GREEN$BOLD" "$RESET"

progress 4 7 "Dashboard-Release ermitteln"
if [[ $DASHBOARD_VERSION == latest ]]; then
  CURRENT_TASK="Veröffentlichte Version ermitteln"
  DASHBOARD_VERSION=$(
    curl --fail --silent --show-error --location --connect-timeout 8 --max-time 45 \
      --retry 4 --retry-delay 3 --retry-all-errors \
      -H 'Accept: application/vnd.github+json' \
      -H 'User-Agent: Homelab-Dashboard-PVE-Installer' \
      "https://api.github.com/repos/$REPOSITORY/tags?per_page=100" |
    python3 -c 'import json,re,sys; tags=[x.get("name","") for x in json.load(sys.stdin)]; valid=[(tuple(map(int,t.removeprefix("v").split("."))),t) for t in tags if re.fullmatch(r"v?\d+\.\d+\.\d+",t)]; print(max(valid)[1] if valid else "")'
  )
fi
[[ $DASHBOARD_VERSION =~ ^v?[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "Keine gültige Release-Version gefunden."
release_tag=${DASHBOARD_VERSION#v}
success "Version v$release_tag ausgewählt"

progress 5 7 "Systemvoraussetzungen installieren"
run_task "Paketlisten und Downloadwerkzeuge einrichten" pct exec "$CTID" -- bash -lc 'apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ca-certificates curl tar'

progress 6 7 "HomeLab Dashboard installieren"
CURRENT_TASK="Dashboard v$release_tag herunterladen, bauen und starten"
printf '  %s⟳%s Dashboard v%s wird eingerichtet … ' "$YELLOW" "$RESET" "$release_tag"
if pct exec "$CTID" -- bash -s -- "$REPOSITORY" "$release_tag" >>"$LOG_FILE" 2>&1 <<'CONTAINER_INSTALL'
set -Eeuo pipefail
repository=$1
version=$2
install -d -m 0755 /opt/homelab-dashboard
curl --fail --silent --show-error --location \
  --proto '=https' --tlsv1.2 --connect-timeout 8 --max-time 180 \
  --retry 4 --retry-delay 3 --retry-all-errors \
  "https://github.com/$repository/archive/refs/tags/v$version.tar.gz" |
  tar -xz --strip-components=1 -C /opt/homelab-dashboard
bash /opt/homelab-dashboard/deploy/install.sh
CONTAINER_INSTALL
then
  printf '%sOK%s\n' "$GREEN$BOLD" "$RESET"
else
  false
fi

progress 7 7 "Installation und Erreichbarkeit prüfen"
run_task "Lokale Dashboard-API testen" pct exec "$CTID" -- curl --fail --silent --show-error http://127.0.0.1/api/status
container_ip=$(pct exec "$CTID" -- hostname -I | awk '{print $1}')
[[ -n $container_ip ]] || fail "Die Container-IP konnte nicht ermittelt werden."

trap - ERR
printf '\n%s%s╭──────────────────────────────────────────────────────────╮%s\n' "$GREEN" "$BOLD" "$RESET"
printf '%s%s│  ✓ HomeLab Dashboard v%-10s ist einsatzbereit       │%s\n' "$GREEN" "$BOLD" "$release_tag" "$RESET"
printf '%s%s╰──────────────────────────────────────────────────────────╯%s\n\n' "$GREEN" "$BOLD" "$RESET"
printf '  %-16s %s\n' 'Container:' "CT $CTID ($CT_HOSTNAME)"
printf '  %-16s %s%shttp://%s/%s\n' 'Dashboard:' "$BOLD" "$CYAN" "$container_ip" "$RESET"
printf '  %-16s %s\n' 'Installationslog:' "$LOG_FILE"
printf '\n%sNächster Schritt:%s Optional den Proxmox-API-Token in CT %s unter\n' "$BOLD" "$RESET" "$CTID"
printf '  /etc/homelab-dashboard.env\neintragen und anschließend ausführen:\n'
printf '  pct exec %s -- systemctl restart homelab-dashboard\n\n' "$CTID"
