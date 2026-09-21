from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import httpx

from app.models import Memory, Resource
from app.services.icons import icon_for
from app.settings import Settings


class ProxmoxError(RuntimeError):
    pass


class ProxmoxClient:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    @property
    def headers(self) -> dict[str, str]:
        token_id = f"{self.settings.proxmox_user}!{self.settings.proxmox_token_name}"
        return {
            "Authorization": f"PVEAPIToken={token_id}={self.settings.proxmox_token_secret}",
            "Accept": "application/json",
        }
    async def _get(self, client: httpx.AsyncClient, path: str) -> Any:
        response = await client.get(
            f"{self.settings.proxmox_host}/api2/json{path}", headers=self.headers
        )
        response.raise_for_status()
        payload = response.json()
        return payload.get("data", payload)

    async def resources(self) -> list[Resource]:
        if not self.settings.api_configured:
            raise ProxmoxError("Proxmox-API ist noch nicht konfiguriert")
        timeout = httpx.Timeout(8.0, connect=4.0)
        try:
            async with httpx.AsyncClient(
                verify=self.settings.proxmox_verify_ssl, timeout=timeout
            ) as client:
                raw = await self._get(client, "/cluster/resources")
        except (httpx.HTTPError, ValueError) as exc:
            raise ProxmoxError(f"Proxmox-API nicht erreichbar: {type(exc).__name__}") from exc

        result: list[Resource] = []
        for item in raw:
            kind = item.get("type", "unknown")
            if kind not in {"node", "lxc", "qemu", "storage"}:
                continue
            name = item.get("name") or item.get("node") or item.get("storage") or "Unbekannt"
            result.append(
                Resource(
                    vmid=item.get("vmid"),
                    name=str(name),
                    type=kind,
                    node=str(item.get("node", "")),
                    status=str(item.get("status", "unknown")),
                    cpu=float(item.get("cpu") or 0),
                    memory=Memory(used=int(item.get("mem") or 0), total=int(item.get("maxmem") or 0)),
                    disk=Memory(used=int(item.get("disk") or 0), total=int(item.get("maxdisk") or 0)),
                    uptime=int(item.get("uptime") or 0),
                    icon=icon_for(str(name), kind),
                )
            )
        return result

    async def latest_backup(self) -> dict[str, Any] | None:
        timeout = httpx.Timeout(8.0, connect=4.0)
        try:
            async with httpx.AsyncClient(
                verify=self.settings.proxmox_verify_ssl, timeout=timeout
            ) as client:
                nodes = await self._get(client, "/nodes")
                tasks: list[dict[str, Any]] = []
                for node in nodes:
                    node_name = node.get("node")
                    if not node_name:
                        continue
                    node_tasks = await self._get(
                        client, f"/nodes/{node_name}/tasks?typefilter=vzdump&limit=20"
                    )
                    tasks.extend(node_tasks)
        except (httpx.HTTPError, ValueError):
            return None
        completed = [task for task in tasks if task.get("endtime")]
        if not completed:
            return None
        task = max(completed, key=lambda entry: int(entry.get("endtime") or 0))
        return {
            "status": task.get("status") or task.get("exitstatus") or "unknown",
            "timestamp": datetime.fromtimestamp(int(task["endtime"]), tz=timezone.utc),
            "node": task.get("node", ""),
        }
