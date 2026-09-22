from __future__ import annotations

import os
import re
import threading
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit, urlunsplit

from pydantic import BaseModel, Field, field_validator


StorageSource = Literal["proxmox", "pbs"]
STORAGE_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")


def _env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _clean_api_url(value: str) -> str:
    value = value.strip().rstrip("/")
    if not value:
        return ""
    parsed = urlsplit(value)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("Nur vollständige HTTP(S)-Adressen sind zulässig")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("Die API-Adresse darf keine Zugangsdaten, Abfrage oder Fragment enthalten")
    if parsed.path not in {"", "/"}:
        raise ValueError("Die API-Adresse darf keinen Pfad enthalten")
    return urlunsplit((parsed.scheme, parsed.netloc, "", "", ""))


class InfrastructureConfig(BaseModel):
    proxmox_host: str = Field(default="", max_length=300)
    proxmox_user: str = Field(default="", max_length=128)
    proxmox_token_name: str = Field(default="", max_length=128)
    proxmox_token_secret: str = Field(default="", max_length=512)
    proxmox_verify_ssl: bool = True
    storage_source: StorageSource = "proxmox"
    storage_ids: list[str] = Field(default_factory=list, max_length=32)
    pbs_host: str = Field(default="", max_length=300)
    pbs_user: str = Field(default="", max_length=128)
    pbs_token_name: str = Field(default="", max_length=128)
    pbs_token_secret: str = Field(default="", max_length=512)
    pbs_datastore: str = Field(default="", max_length=64)
    pbs_verify_ssl: bool = True

    @field_validator("proxmox_host", "pbs_host")
    @classmethod
    def clean_host(cls, value: str) -> str:
        return _clean_api_url(value)

    @field_validator(
        "proxmox_user", "proxmox_token_name", "pbs_user", "pbs_token_name", "pbs_datastore"
    )
    @classmethod
    def clean_identifier(cls, value: str) -> str:
        return value.strip()

    @field_validator("proxmox_token_secret", "pbs_token_secret")
    @classmethod
    def clean_secret(cls, value: str) -> str:
        return value.strip()

    @field_validator("storage_ids")
    @classmethod
    def clean_storage_ids(cls, values: list[str]) -> list[str]:
        cleaned: list[str] = []
        for value in values:
            value = value.strip()
            if not value:
                continue
            if not STORAGE_ID_PATTERN.fullmatch(value):
                raise ValueError(f"Ungültige Proxmox-Speicher-ID: {value}")
            if value not in cleaned:
                cleaned.append(value)
        return cleaned

    @property
    def proxmox_configured(self) -> bool:
        return all((self.proxmox_host, self.proxmox_user, self.proxmox_token_name, self.proxmox_token_secret))

    @property
    def pbs_configured(self) -> bool:
        return all((self.pbs_host, self.pbs_user, self.pbs_token_name, self.pbs_token_secret, self.pbs_datastore))


class InfrastructureUpdate(BaseModel):
    proxmox_host: str = Field(default="", max_length=300)
    proxmox_user: str = Field(default="", max_length=128)
    proxmox_token_name: str = Field(default="", max_length=128)
    proxmox_token_secret: str | None = Field(default=None, max_length=512)
    proxmox_verify_ssl: bool = True
    storage_source: StorageSource = "proxmox"
    storage_ids: list[str] = Field(default_factory=list, max_length=32)
    pbs_host: str = Field(default="", max_length=300)
    pbs_user: str = Field(default="", max_length=128)
    pbs_token_name: str = Field(default="", max_length=128)
    pbs_token_secret: str | None = Field(default=None, max_length=512)
    pbs_datastore: str = Field(default="", max_length=64)
    pbs_verify_ssl: bool = True

    @field_validator("proxmox_host", "pbs_host")
    @classmethod
    def clean_host(cls, value: str) -> str:
        return _clean_api_url(value)

    @field_validator(
        "proxmox_user", "proxmox_token_name", "pbs_user", "pbs_token_name", "pbs_datastore"
    )
    @classmethod
    def clean_identifier(cls, value: str) -> str:
        return value.strip()

    @field_validator("storage_ids")
    @classmethod
    def clean_storage_ids(cls, values: list[str]) -> list[str]:
        return InfrastructureConfig.clean_storage_ids(values)


class InfrastructurePublic(BaseModel):
    proxmox_host: str
    proxmox_user: str
    proxmox_token_name: str
    proxmox_token_configured: bool
    proxmox_verify_ssl: bool
    storage_source: StorageSource
    storage_ids: list[str]
    pbs_host: str
    pbs_user: str
    pbs_token_name: str
    pbs_token_configured: bool
    pbs_datastore: str
    pbs_verify_ssl: bool


class InfrastructureStore:
    def __init__(self, path: Path | None = None, defaults: InfrastructureConfig | None = None) -> None:
        default_path = Path(__file__).resolve().parents[3] / "data" / "infrastructure.json"
        self.path = (path or Path(os.getenv("DASHBOARD_INFRASTRUCTURE", str(default_path)))).resolve()
        self._lock = threading.RLock()
        self._data = defaults or InfrastructureConfig(
            proxmox_host=os.getenv("PROXMOX_HOST", ""),
            proxmox_user=os.getenv("PROXMOX_USER", ""),
            proxmox_token_name=os.getenv("PROXMOX_TOKEN_NAME", ""),
            proxmox_token_secret=os.getenv("PROXMOX_TOKEN_SECRET", ""),
            proxmox_verify_ssl=_env_bool("PROXMOX_VERIFY_SSL", True),
            storage_source=os.getenv("STORAGE_SOURCE", "proxmox"),
            storage_ids=[item for item in os.getenv("PROXMOX_STORAGE_IDS", "").split(",") if item.strip()],
            pbs_host=os.getenv("PBS_HOST", ""),
            pbs_user=os.getenv("PBS_USER", ""),
            pbs_token_name=os.getenv("PBS_TOKEN_NAME", ""),
            pbs_token_secret=os.getenv("PBS_TOKEN_SECRET", ""),
            pbs_datastore=os.getenv("PBS_DATASTORE", ""),
            pbs_verify_ssl=_env_bool("PBS_VERIFY_SSL", True),
        )
        if self.path.is_file():
            self._data = InfrastructureConfig.model_validate_json(self.path.read_text(encoding="utf-8"))

    def snapshot(self) -> InfrastructureConfig:
        with self._lock:
            return self._data.model_copy(deep=True)

    def public(self) -> InfrastructurePublic:
        current = self.snapshot()
        return InfrastructurePublic(
            proxmox_host=current.proxmox_host,
            proxmox_user=current.proxmox_user,
            proxmox_token_name=current.proxmox_token_name,
            proxmox_token_configured=bool(current.proxmox_token_secret),
            proxmox_verify_ssl=current.proxmox_verify_ssl,
            storage_source=current.storage_source,
            storage_ids=current.storage_ids,
            pbs_host=current.pbs_host,
            pbs_user=current.pbs_user,
            pbs_token_name=current.pbs_token_name,
            pbs_token_configured=bool(current.pbs_token_secret),
            pbs_datastore=current.pbs_datastore,
            pbs_verify_ssl=current.pbs_verify_ssl,
        )

    def update(self, payload: InfrastructureUpdate) -> InfrastructurePublic:
        with self._lock:
            current = self._data
            values = payload.model_dump()
            for field in ("proxmox_token_secret", "pbs_token_secret"):
                if not values[field]:
                    values[field] = getattr(current, field)
            updated = InfrastructureConfig.model_validate(values)
            self.path.parent.mkdir(parents=True, exist_ok=True)
            temporary = self.path.with_suffix(".tmp")
            temporary.write_text(updated.model_dump_json(indent=2) + "\n", encoding="utf-8")
            os.chmod(temporary, 0o600)
            os.replace(temporary, self.path)
            self._data = updated
            return self.public()


infrastructure = InfrastructureStore()
