from __future__ import annotations

import asyncio
import json
import os
import re
import time
from datetime import UTC, datetime
from pathlib import Path

import httpx


REPOSITORY_URL = "https://github.com/DoctorX-1337/Homelab-Dashboard-LXC"
TAGS_API_URL = "https://api.github.com/repos/DoctorX-1337/Homelab-Dashboard-LXC/tags?per_page=100"
VERSION_PATTERN = re.compile(r"^\d+\.\d+\.\d+$")
UPDATE_STATE_PATH = Path(__file__).resolve().parents[3] / "data" / "update-state.json"
UPDATE_STATUSES = {"idle", "queued", "running", "success", "failed", "rollback"}


def read_installation_state(path: Path = UPDATE_STATE_PATH) -> dict[str, object]:
    fallback: dict[str, object] = {
        "status": "idle",
        "message": "Bereit",
        "progress": 0,
        "target_version": None,
        "updated_at": None,
    }
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(payload, dict) or payload.get("status") not in UPDATE_STATUSES:
            return fallback
        progress = max(0, min(100, int(payload.get("progress", 0))))
        return {
            "status": payload["status"],
            "message": str(payload.get("message") or "Update wird verarbeitet"),
            "progress": progress,
            "target_version": payload.get("target_version"),
            "updated_at": payload.get("updated_at"),
        }
    except (OSError, ValueError, TypeError, json.JSONDecodeError):
        return fallback


def write_installation_state(
    status: str, message: str, progress: int, target_version: str | None,
    path: Path = UPDATE_STATE_PATH,
) -> None:
    if status not in UPDATE_STATUSES:
        raise ValueError("Ungültiger Update-Status")
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(f"{path.suffix}.{os.getpid()}.tmp")
    temporary.write_text(
        json.dumps(
            {
                "status": status,
                "message": message,
                "progress": max(0, min(100, progress)),
                "target_version": target_version,
                "updated_at": datetime.now(UTC).isoformat(),
            },
            ensure_ascii=False,
            indent=2,
        ) + "\n",
        encoding="utf-8",
    )
    os.chmod(temporary, 0o640)
    os.replace(temporary, path)


def parse_version(value: str) -> tuple[int, int, int]:
    normalized = value.strip()
    if not VERSION_PATTERN.fullmatch(normalized):
        raise ValueError("Ungültiges Versionsformat")
    major, minor, patch = normalized.split(".")
    return int(major), int(minor), int(patch)


def is_newer(current: str, latest: str) -> bool:
    return parse_version(latest) > parse_version(current)


def latest_version_from_tags(tags: list[str]) -> str:
    versions = [tag.removeprefix("v") for tag in tags]
    valid = [version for version in versions if VERSION_PATTERN.fullmatch(version)]
    if not valid:
        raise ValueError("Keine gültige Release-Version gefunden")
    return max(valid, key=parse_version)


class UpdateChecker:
    def __init__(self, cache_seconds: int = 900) -> None:
        self.cache_seconds = cache_seconds
        self.version_path = Path(__file__).resolve().parents[3] / "VERSION"
        self._lock = asyncio.Lock()
        self._cached: dict[str, object] | None = None
        self._cached_at = 0.0

    def current_version(self) -> str:
        return self.version_path.read_text(encoding="utf-8").strip()

    async def status(self, force: bool = False) -> dict[str, object]:
        now = time.monotonic()
        if not force and self._cached and now - self._cached_at < self.cache_seconds:
            return self._cached
        async with self._lock:
            now = time.monotonic()
            if not force and self._cached and now - self._cached_at < self.cache_seconds:
                return self._cached
            current = self.current_version()
            checked_at = datetime.now(UTC).isoformat()
            try:
                async with httpx.AsyncClient(timeout=5, follow_redirects=True) as client:
                    response = await client.get(
                        TAGS_API_URL,
                        headers={
                            "Accept": "application/vnd.github+json",
                            "User-Agent": "Homelab-Dashboard-Update-Check",
                        },
                    )
                    response.raise_for_status()
                payload = response.json()
                if not isinstance(payload, list):
                    raise ValueError("Ungültige Antwort der GitHub-API")
                tag_names = [
                    item["name"]
                    for item in payload
                    if isinstance(item, dict) and isinstance(item.get("name"), str)
                ]
                latest = latest_version_from_tags(tag_names)
                available = is_newer(current, latest)
                result: dict[str, object] = {
                    "current_version": current,
                    "latest_version": latest,
                    "update_available": available,
                    "repository_url": REPOSITORY_URL,
                    "checked_at": checked_at,
                    "error": None,
                }
            except (httpx.HTTPError, OSError, ValueError):
                result = {
                    "current_version": current,
                    "latest_version": None,
                    "update_available": False,
                    "repository_url": REPOSITORY_URL,
                    "checked_at": checked_at,
                    "error": "Versionsprüfung derzeit nicht verfügbar",
                }
            self._cached = result
            self._cached_at = now
            return result


update_checker = UpdateChecker()
