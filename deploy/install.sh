#!/usr/bin/env bash
set -Eeuo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "Dieses Skript muss als root ausgeführt werden." >&2
  exit 1
fi

APP_DIR=/opt/homelab-dashboard
ENV_FILE=/etc/homelab-dashboard.env

apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ca-certificates curl nginx python3 python3-venv python3-pip rsync
if ! command -v node >/dev/null 2>&1 || [[ "$(node -p 'Number(process.versions.node.split(`.`)[0])')" -lt 20 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs
fi

getent group homelab-dashboard >/dev/null || groupadd --system homelab-dashboard
id homelab-dashboard >/dev/null 2>&1 || useradd --system --gid homelab-dashboard --home-dir "$APP_DIR" --shell /usr/sbin/nologin homelab-dashboard
install -d -o homelab-dashboard -g homelab-dashboard -m 0750 "$APP_DIR/data" "$APP_DIR/data/config"
for config_file in services.yaml links.yaml; do
  if [[ ! -f "$APP_DIR/data/config/$config_file" ]]; then
    install -o homelab-dashboard -g homelab-dashboard -m 0640 "$APP_DIR/config/$config_file" "$APP_DIR/data/config/$config_file"
  fi
done

python3 -m venv "$APP_DIR/.venv"
"$APP_DIR/.venv/bin/pip" install --disable-pip-version-check --no-cache-dir --upgrade pip
"$APP_DIR/.venv/bin/pip" install --disable-pip-version-check --no-cache-dir -r "$APP_DIR/backend/requirements.txt"

pushd "$APP_DIR/frontend" >/dev/null
npm install --ignore-scripts --no-audit --no-fund
npm run build
popd >/dev/null

if [[ ! -f "$ENV_FILE" ]]; then
  install -o root -g homelab-dashboard -m 0640 "$APP_DIR/backend/.env.example" "$ENV_FILE"
  allowed_hosts=$(hostname -I 2>/dev/null | tr ' ' '\n'; hostname -s; hostname -f 2>/dev/null || true)
  allowed_hosts=$(printf '%s\nlocalhost\n127.0.0.1\n' "$allowed_hosts" | sed '/^$/d' | sort -u | paste -sd, -)
  sed -i "s/^ALLOWED_HOSTS=.*/ALLOWED_HOSTS=$allowed_hosts/" "$ENV_FILE"
  echo "Hinweis: Proxmox-API-Zugang in $ENV_FILE ergänzen." >&2
fi

install -o root -g root -m 0644 "$APP_DIR/deploy/homelab-dashboard.service" /etc/systemd/system/homelab-dashboard.service
install -o root -g root -m 0755 "$APP_DIR/deploy/manual-update.sh" /usr/local/sbin/homelab-dashboard-manual-update
install -o root -g root -m 0644 "$APP_DIR/deploy/homelab-dashboard-update.service" /etc/systemd/system/homelab-dashboard-update.service
install -o root -g root -m 0644 "$APP_DIR/deploy/homelab-dashboard-update.path" /etc/systemd/system/homelab-dashboard-update.path
install -o root -g root -m 0644 "$APP_DIR/deploy/nginx.conf" /etc/nginx/sites-available/homelab-dashboard
ln -sfn /etc/nginx/sites-available/homelab-dashboard /etc/nginx/sites-enabled/homelab-dashboard
rm -f /etc/nginx/sites-enabled/default
chown -R homelab-dashboard:homelab-dashboard "$APP_DIR"
chmod 0755 "$APP_DIR" "$APP_DIR/frontend" "$APP_DIR/frontend/dist"
nginx -t
systemctl daemon-reload
systemctl enable --now homelab-dashboard nginx homelab-dashboard-update.path
systemctl restart homelab-dashboard nginx

curl --fail --silent --show-error http://127.0.0.1/api/status >/dev/null
echo "HomeLab Dashboard ist lokal erreichbar."
