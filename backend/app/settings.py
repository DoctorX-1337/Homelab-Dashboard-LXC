from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parents[2]
load_dotenv(BASE_DIR / "backend" / ".env")


def _bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _int(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except ValueError:
        return default
    return min(maximum, max(minimum, value))


@dataclass(frozen=True, slots=True)
class Settings:
    proxmox_host: str = os.getenv("PROXMOX_HOST", "").rstrip("/")
    proxmox_user: str = os.getenv("PROXMOX_USER", "")
    proxmox_token_name: str = os.getenv("PROXMOX_TOKEN_NAME", "")
    proxmox_token_secret: str = os.getenv("PROXMOX_TOKEN_SECRET", "")
    proxmox_verify_ssl: bool = _bool("PROXMOX_VERIFY_SSL", True)
    refresh_interval: int = _int("REFRESH_INTERVAL", 30, 10, 3600)
    health_timeout: int = _int("HEALTH_TIMEOUT", 5, 1, 15)
    app_host: str = os.getenv("APP_HOST", "127.0.0.1")
    app_port: int = _int("APP_PORT", 8000, 1, 65535)
    dashboard_name: str = os.getenv("DASHBOARD_NAME", "HomeLab")
    dashboard_subtitle: str = os.getenv(
        "DASHBOARD_SUBTITLE", "Meine Infrastruktur. Meine Freiheit."
    )
    allowed_hosts: tuple[str, ...] = tuple(
        item.strip()
        for item in os.getenv(
            "ALLOWED_HOSTS",
            "localhost,127.0.0.1",
        ).split(",")
        if item.strip()
    )

    @property
    def api_configured(self) -> bool:
        return all(
            (
                self.proxmox_host,
                self.proxmox_user,
                self.proxmox_token_name,
                self.proxmox_token_secret,
            )
        )


settings = Settings()
