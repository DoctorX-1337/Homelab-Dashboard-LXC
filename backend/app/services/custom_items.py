from __future__ import annotations

import json
import hashlib
import os
import re
import threading
import uuid
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, Field, field_validator


ThemeName = Literal[
    "multicolor", "blue", "green", "yellow", "red",
    "black", "purple", "cyan", "orange", "pink",
]


class ThemePreference(BaseModel):
    theme: ThemeName = "black"


def builtin_link_id(name: str, url: str) -> str:
    digest = hashlib.sha256(f"{name}\0{url}".encode()).hexdigest()[:16]
    return f"builtin-link-{digest}"


class EditableItem(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    description: str = Field(default="", max_length=180)
    icon: str = Field(default="server", min_length=1, max_length=40)
    url: str = Field(default="", max_length=500)
    favorite: bool = False

    @field_validator("name", "description")
    @classmethod
    def clean_text(cls, value: str) -> str:
        return " ".join(value.strip().split())

    @field_validator("icon")
    @classmethod
    def clean_icon(cls, value: str) -> str:
        value = value.strip().lower()
        if not re.fullmatch(r"(?:custom:)?[a-z0-9_-]+", value):
            raise ValueError("Das Icon muss ein Standardname oder custom:<name> sein")
        return value

    @field_validator("url")
    @classmethod
    def clean_url(cls, value: str) -> str:
        value = value.strip()
        if not value:
            return value
        parsed = urlsplit(value)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname:
            raise ValueError("Nur vollständige HTTP(S)-URLs sind zulässig")
        if parsed.username or parsed.password:
            raise ValueError("Zugangsdaten dürfen nicht in der URL stehen")
        return value


class StoredItem(EditableItem):
    id: str


class CustomItems(BaseModel):
    theme: ThemeName = "black"
    hosts: list[StoredItem] = Field(default_factory=list)
    links: list[StoredItem] = Field(default_factory=list)
    app_overrides: list[StoredItem] = Field(default_factory=list)
    link_overrides: list[StoredItem] = Field(default_factory=list)
    hidden_apps: list[str] = Field(default_factory=list)
    hidden_links: list[str] = Field(default_factory=list)


class CustomItemsStore:
    def __init__(self) -> None:
        default_path = Path(__file__).resolve().parents[3] / "data" / "custom-items.json"
        self.path = Path(os.getenv("DASHBOARD_CUSTOM_ITEMS", str(default_path))).resolve()
        self._lock = threading.RLock()

    def snapshot(self) -> CustomItems:
        with self._lock:
            if not self.path.exists():
                return CustomItems()
            raw = json.loads(self.path.read_text(encoding="utf-8"))
            return CustomItems.model_validate(raw)

    def save(
        self,
        kind: Literal["hosts", "links"],
        payload: EditableItem,
        item_id: str | None = None,
    ) -> StoredItem:
        with self._lock:
            data = self.snapshot()
            items = getattr(data, kind)
            if item_id:
                index = next((i for i, item in enumerate(items) if item.id == item_id), None)
                if index is None:
                    raise KeyError(item_id)
                stored = StoredItem(id=item_id, **payload.model_dump())
                items[index] = stored
            else:
                stored = StoredItem(id=uuid.uuid4().hex[:16], **payload.model_dump())
                items.append(stored)
            self._write(data)
            return stored

    def set_theme(self, theme: ThemeName) -> ThemePreference:
        with self._lock:
            data = self.snapshot()
            data.theme = theme
            self._write(data)
            return ThemePreference(theme=theme)

    def delete(self, kind: Literal["hosts", "links"], item_id: str) -> None:
        with self._lock:
            data = self.snapshot()
            items = getattr(data, kind)
            remaining = [item for item in items if item.id != item_id]
            if len(remaining) == len(items):
                raise KeyError(item_id)
            setattr(data, kind, remaining)
            self._write(data)

    def save_managed(
        self,
        kind: Literal["applications", "links"],
        item_id: str,
        payload: EditableItem,
    ) -> StoredItem:
        with self._lock:
            data = self.snapshot()
            custom_collection = data.hosts if kind == "applications" else data.links
            custom_prefix = "custom-host-" if kind == "applications" else "custom-link-"
            if item_id.startswith(custom_prefix):
                custom_id = item_id.removeprefix(custom_prefix)
                index = next((i for i, item in enumerate(custom_collection) if item.id == custom_id), None)
                if index is None:
                    raise KeyError(item_id)
                stored = StoredItem(id=custom_id, **payload.model_dump())
                custom_collection[index] = stored
            else:
                overrides = data.app_overrides if kind == "applications" else data.link_overrides
                index = next((i for i, item in enumerate(overrides) if item.id == item_id), None)
                stored = StoredItem(id=item_id, **payload.model_dump())
                if index is None:
                    overrides.append(stored)
                else:
                    overrides[index] = stored
                hidden = data.hidden_apps if kind == "applications" else data.hidden_links
                if item_id in hidden:
                    hidden.remove(item_id)
            self._write(data)
            return stored

    def delete_managed(self, kind: Literal["applications", "links"], item_id: str) -> None:
        with self._lock:
            data = self.snapshot()
            custom_collection = data.hosts if kind == "applications" else data.links
            custom_prefix = "custom-host-" if kind == "applications" else "custom-link-"
            if item_id.startswith(custom_prefix):
                custom_id = item_id.removeprefix(custom_prefix)
                remaining = [item for item in custom_collection if item.id != custom_id]
                if len(remaining) == len(custom_collection):
                    raise KeyError(item_id)
                if kind == "applications":
                    data.hosts = remaining
                else:
                    data.links = remaining
            else:
                overrides = data.app_overrides if kind == "applications" else data.link_overrides
                overrides[:] = [item for item in overrides if item.id != item_id]
                hidden = data.hidden_apps if kind == "applications" else data.hidden_links
                if item_id not in hidden:
                    hidden.append(item_id)
            self._write(data)

    def _write(self, data: CustomItems) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix(".tmp")
        temporary.write_text(
            json.dumps(data.model_dump(), ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        os.chmod(temporary, 0o640)
        os.replace(temporary, self.path)


custom_items = CustomItemsStore()
