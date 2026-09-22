from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from urllib.parse import quote

import httpx

from app.services.infrastructure import InfrastructureConfig


class PBSError(RuntimeError):
    pass


class PBSClient:
    def __init__(self, config: InfrastructureConfig) -> None:
        self.config = config

    @property
    def headers(self) -> dict[str, str]:
        token_id = f"{self.config.pbs_user}!{self.config.pbs_token_name}"
        return {
            "Authorization": f"PBSAPIToken={token_id}:{self.config.pbs_token_secret}",
            "Accept": "application/json",
        }

    async def _get(self, client: httpx.AsyncClient, path: str) -> Any:
        response = await client.get(f"{self.config.pbs_host}/api2/json{path}", headers=self.headers)
        response.raise_for_status()
        payload = response.json()
        return payload.get("data", payload)

    async def status(self) -> tuple[dict[str, Any] | None, dict[str, int]]:
        if not self.config.pbs_configured:
            raise PBSError("PBS-API ist noch nicht vollständig konfiguriert")
        datastore = quote(self.config.pbs_datastore, safe="")
        timeout = httpx.Timeout(8.0, connect=4.0)
        try:
            async with httpx.AsyncClient(verify=self.config.pbs_verify_ssl, timeout=timeout) as client:
                storage = await self._get(client, f"/admin/datastore/{datastore}/status")
                snapshots = await self._get(client, f"/admin/datastore/{datastore}/snapshots")
        except (httpx.HTTPError, ValueError) as exc:
            raise PBSError(f"PBS-API nicht erreichbar: {type(exc).__name__}") from exc

        latest = None
        candidates = [item for item in snapshots if item.get("backup-time")]
        if candidates:
            newest = max(candidates, key=lambda item: int(item.get("backup-time") or 0))
            latest = {
                "status": "OK",
                "timestamp": datetime.fromtimestamp(int(newest["backup-time"]), tz=timezone.utc),
                "node": self.config.pbs_datastore,
                "source": "pbs",
            }
        return latest, {
            "used": int(storage.get("used") or 0),
            "total": int(storage.get("total") or 0),
        }
