# HomeLab Dashboard

Ein frei konfigurierbares Dashboard für Proxmox-Homelabs. Die React-Oberfläche zeigt Clusterzustand, Auslastung, Dienste und Schnelllinks; FastAPI liest Proxmox ausschließlich über einen eingeschränkten API-Token. Neue Installationen enthalten bewusst keine Hosts, URLs oder persönlichen Links.

## Schnellinstallation auf Proxmox VE

Der folgende Befehl wird als `root` direkt auf einem Proxmox-VE-Host ausgeführt. Der farbige Installer fragt verpflichtend einen vierstelligen Einstellungen-PIN mit Bestätigung ab, zeigt Konfiguration, sieben Installationsphasen und den aktuellen Prozess an, erstellt einen unprivilegierten Debian-LXC und installiert das jeweils neueste veröffentlichte Dashboard-Release:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/DoctorX-1337/Homelab-Dashboard-LXC/main/deploy/pve-install.sh)"
```

Voreinstellungen: nächste freie CT-ID, 2 CPU-Kerne, 2 GB RAM, 8 GB Festplatte, DHCP und `vmbr0`. Geeignete Container- und Template-Speicher werden automatisch erkannt. Werte können vor dem Aufruf überschrieben werden:

```bash
CTID=250 MEMORY=4096 STORAGE=local-zfs BRIDGE=vmbr1 \
  bash -c "$(curl -fsSL https://raw.githubusercontent.com/DoctorX-1337/Homelab-Dashboard-LXC/main/deploy/pve-install.sh)"
```

Weitere Variablen: `CT_HOSTNAME`, `CORES`, `SWAP`, `DISK_SIZE`, `IP_CONFIG`, `TEMPLATE_STORAGE` und `DASHBOARD_VERSION`.

Für eine bewusst nicht interaktive Bereitstellung kann zusätzlich `DASHBOARD_PIN=1234` gesetzt werden. Der Klartext-PIN wird weder protokolliert noch gespeichert; im privaten Datenbereich liegt nur ein mit PBKDF2-SHA256 gesalzener Hash. Nach zehn Fehlversuchen wird die PIN-Eingabe für fünf Minuten gebremst, eine erfolgreiche Sitzung läuft nach 30 Minuten ab. Der PIN kann später unter **Einstellungen → Einstellungen-PIN** geändert werden; danach ist eine neue Anmeldung erforderlich.

Nach der Installation gibt das Skript die lokale IP-Adresse aus. Anwendungen, Hosts und Links werden unter **Einstellungen** hinzugefügt. Unter **Einstellungen → Infrastruktur** lassen sich Proxmox-Cluster, anzuzeigende Proxmox-Speicher, Speicherquelle und Proxmox Backup Server ohne Konsolenzugriff konfigurieren und direkt prüfen. Verwende für Proxmox einen dedizierten Nur-Lese-Token (beispielsweise `PVEAuditor`) und für PBS einen auf den benötigten Datastore begrenzten `DatastoreAudit`-Token.

Unter **Einstellungen → Texte & Branding** können Dashboard-Titel, Beschreibung, Footer-Titel, Footer-Text und Browser-Tab-Titel unabhängig voneinander angepasst werden. Die Werte liegen gemeinsam mit den übrigen persönlichen Dashboard-Einstellungen updatefest unter `/opt/homelab-dashboard/data/`.

Das vollständige Installationsprotokoll liegt auf dem Proxmox-Host unter `/var/log/homelab-dashboard-installer-<CTID>.log`. Bei einem Fehler zeigt der Installer automatisch die letzten relevanten Logzeilen an und lässt den Container für eine sichere Diagnose unverändert bestehen.

Eigene, nicht öffentliche Logos können beim Bearbeiten oder Anlegen eines Dienstes bzw. Links direkt hochgeladen werden. PNG, WebP und JPEG bis 3 MB werden geprüft, auf höchstens 512 × 512 Pixel verkleinert und updatefest als PNG unter `/opt/homelab-dashboard/data/logos/` abgelegt. Persönliche Bilddateien und Namen müssen dadurch nicht ins öffentliche Repository aufgenommen werden.

## Datenschutz und öffentliche Standardkonfiguration

- `config/services.yaml` und `config/links.yaml` sind absichtlich leer.
- Persönliche Anpassungen liegen ausschließlich in `/opt/homelab-dashboard/data/` und werden bei Updates nicht überschrieben.
- Infrastruktur-Zugangsdaten liegen mit Dateimodus `0600` unter `/opt/homelab-dashboard/data/infrastructure.json`; bestehende Werte aus `/etc/homelab-dashboard.env` werden als sichere Startwerte unterstützt. Geheimnisse werden nie an den Browser zurückgegeben.
- Produktivadressen, private DNS-Namen, RFC1918-Adressen, Freigabepfade und persönliche Links gehören niemals in das öffentliche Repository.
- Die CI-Prüfung `scripts/check-public-content.py` blockiert typische private Netzwerkangaben.

Vor einem Fork oder öffentlichen Push sollte zusätzlich geprüft werden:

```bash
python3 scripts/check-public-content.py
git grep -nEi 'token|secret|password|private[_-]?key'
```

## Updates

Das Dashboard prüft veröffentlichte Tags im Format `vMAJOR.MINOR.PATCH`. Eine Installation startet nur nach Klick auf **Einstellungen → Dashboard-Update → Jetzt aktualisieren**. Ein dynamischer Balken bleibt bis zum Abschluss sichtbar; währenddessen sind Dashboard und übrige Einstellungen gesperrt und weichgezeichnet. Lokale Daten und die Systemkonfiguration bleiben erhalten; bei einem fehlgeschlagenen Build wird der vorherige Quellstand wiederhergestellt.

```bash
systemctl status homelab-dashboard-update.path
journalctl -u homelab-dashboard-update.service
```

## Farbschemata

Zehn gespeicherte Designs stehen zur Verfügung: Bunt, Blau (`#007BFF`), Grün (`#28A745`), Gelb (`#F4C001`), Rot (`#DC3545`), Schwarz (`#000000`), Violett (`#7B2CBF`), Cyan (`#00B8D4`), Orange (`#FF8C00`) und Pink (`#E83E8C`). Schwarz ist bei Neuinstallationen vorausgewählt; bestehende Installationen behalten ihre Auswahl. Logo und Favicons behalten immer ihre Originalfarben.

## Manuelle Installation in einem vorhandenen Debian-LXC

Das getaggte Release nach `/opt/homelab-dashboard` entpacken und ausführen:

```bash
cd /opt/homelab-dashboard
sudo bash deploy/install.sh
```

Die Runtime-Konfiguration wird unter `data/config/` erzeugt. Alternativ kann `DASHBOARD_CONFIG_DIR` in `/etc/homelab-dashboard.env` auf ein anderes privates Verzeichnis zeigen.

Bei einer manuellen Installation wird der PIN anschließend interaktiv gesetzt:

```bash
sudo bash deploy/set-pin.sh
```

## Entwicklung und Prüfung

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt -r requirements-dev.txt
PYTHONPATH=. .venv/bin/pytest

cd ../frontend
npm ci
npm run lint
npm run build
```

## Sicherheitsmodell

- Proxmox-Zugriff mit einem dedizierten Nur-Lese-Token
- Backend nur auf `127.0.0.1:8000`
- Host-Allowlist, URL-Validierung und Same-Origin-Schutz für Änderungen
- gehärtete systemd-Dienste, Security-Header und Content Security Policy
- keine API-Secrets im Frontend oder Repository
- geprüfte, größenbegrenzte Logo-Konvertierung; private Logos verbleiben im persistenten Datenverzeichnis
- Tests, Ruff, Bandit, `pip-audit`, npm-Audit und öffentlicher Inhaltscheck in CI
