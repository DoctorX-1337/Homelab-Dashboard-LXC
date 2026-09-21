from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path
from typing import Any

import yaml

from app.models import Link, Service

BASE_DIR = Path(__file__).resolve().parents[3]
CONFIG_DIR = Path(os.getenv("DASHBOARD_CONFIG_DIR", BASE_DIR / "data" / "config")).resolve()


@dataclass(slots=True)
class DashboardConfig:
    resource_overrides: dict[int, dict[str, Any]]
    manual_services: list[Service]
    links: list[Link]


def _read_yaml(filename: str) -> dict[str, Any]:
    path = (CONFIG_DIR / filename).resolve()
    if path.parent != CONFIG_DIR.resolve():
        raise ValueError("Ungültiger Konfigurationspfad")
    if not path.exists():
        return {}
    with path.open("r", encoding="utf-8") as handle:
        data = yaml.safe_load(handle) or {}
    if not isinstance(data, dict):
        raise ValueError(f"{filename} muss ein YAML-Objekt enthalten")
    return data


def load_dashboard_config() -> DashboardConfig:
    services_data = _read_yaml("services.yaml")
    links_data = _read_yaml("links.yaml")

    overrides: dict[int, dict[str, Any]] = {}
    for key, value in (services_data.get("services") or {}).items():
        if isinstance(value, dict):
            overrides[int(key)] = value

    manual = [Service.model_validate(item) for item in services_data.get("manual_services", [])]
    links = [Link.model_validate(item) for item in links_data.get("links", [])]
    return DashboardConfig(overrides, manual, links)
