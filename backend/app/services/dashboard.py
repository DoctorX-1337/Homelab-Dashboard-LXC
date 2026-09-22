from __future__ import annotations

import asyncio
import hashlib
from collections import deque
from datetime import datetime, timezone

import httpx

from app.config import load_dashboard_config
from app.models import DashboardEvent, Link, Resource, Service
from app.services.custom_items import builtin_link_id, custom_items
from app.services.health import check_url
from app.services.icons import icon_for
from app.services.infrastructure import infrastructure
from app.services.pbs import PBSClient, PBSError
from app.services.proxmox import ProxmoxClient
from app.settings import settings


class DashboardState:
    def __init__(self) -> None:
        self.proxmox = ProxmoxClient(settings)
        self.resources: list[Resource] = []
        self.manual_services: list[Service] = []
        self.all_manual_services: list[Service] = []
        self.links: list[Link] = []
        self.managed_apps: list[dict] = []
        self.managed_links: list[dict] = []
        self.hidden_app_ids: set[str] = set()
        self.events: deque[DashboardEvent] = deque(maxlen=60)
        self.last_refresh: datetime | None = None
        self.last_success: datetime | None = None
        self.last_error: str | None = None
        self.latest_backup: dict | None = None
        self.pbs_storage: dict[str, int] | None = None
        self.pbs_error: str | None = None
        self._previous: dict[str, str] = {}
        self._task: asyncio.Task | None = None
        self._lock = asyncio.Lock()

    def _event(self, level: str, title: str, detail: str) -> None:
        stamp = datetime.now(timezone.utc)
        raw = f"{stamp.isoformat()}:{title}:{detail}".encode()
        self.events.appendleft(
            DashboardEvent(
                id=hashlib.sha256(raw).hexdigest()[:16],
                timestamp=stamp,
                level=level,
                title=title,
                detail=detail,
            )
        )

    def _detect_events(self, resources: list[Resource]) -> None:
        current = {
            f"{item.type}:{item.node}:{item.vmid or item.name}": item.status
            for item in resources
            if item.type in {"node", "lxc", "qemu"}
        }
        if self._previous:
            for key, status in current.items():
                if key not in self._previous:
                    self._event("info", "Neues System erkannt", key)
                elif self._previous[key] != status:
                    level = "success" if status in {"running", "online"} else "warning"
                    self._event(level, "Status geändert", f"{key}: {self._previous[key]} → {status}")
            for key in self._previous.keys() - current.keys():
                self._event("warning", "System nicht mehr erkannt", key)
        self._previous = current

    async def refresh(self) -> None:
        async with self._lock:
            infra = infrastructure.snapshot()
            config = load_dashboard_config()
            custom = custom_items.snapshot()
            app_overrides = {item.id: item for item in custom.app_overrides}
            link_overrides = {item.id: item for item in custom.link_overrides}
            self.hidden_app_ids = set(custom.hidden_apps)
            visible_links: list[Link] = []
            managed_links: list[dict] = []
            for link in config.links:
                item_id = builtin_link_id(link.name, link.url)
                override = link_overrides.get(item_id)
                current = Link.model_validate(override.model_dump(exclude={"id", "favorite"}) if override else link.model_dump())
                hidden = item_id in custom.hidden_links
                managed_links.append({"id": item_id, "source": "builtin", "hidden": hidden, **current.model_dump()})
                if not hidden:
                    visible_links.append(current)
            for item in custom.links:
                current = Link.model_validate(item.model_dump(exclude={"id", "favorite"}))
                managed_links.append({"id": f"custom-link-{item.id}", "source": "custom", "hidden": False, **current.model_dump()})
                visible_links.append(current)
            self.links = visible_links
            self.managed_links = managed_links
            try:
                resources = await self.proxmox.resources() if infra.proxmox_configured else []
                for resource in resources:
                    if resource.vmid is None:
                        continue
                    override = config.resource_overrides.get(resource.vmid, {})
                    resource.url = override.get("url")
                    resource.description = override.get("description", "")
                    resource.favorite = bool(override.get("favorite", False))
                    resource.icon = override.get("icon") or icon_for(resource.name, resource.type)
                    runtime = app_overrides.get(f"resource-{resource.vmid}")
                    if runtime:
                        resource.name = runtime.name
                        resource.url = runtime.url
                        resource.description = runtime.description
                        resource.favorite = runtime.favorite
                        resource.icon = runtime.icon

                urls = [item.url for item in resources if item.url]
                manual = [service.model_copy(deep=True) for service in config.manual_services]
                for service in manual:
                    runtime = app_overrides.get(f"manual-{service.id}")
                    if runtime:
                        service.name = runtime.name
                        service.url = runtime.url
                        service.description = runtime.description
                        service.favorite = runtime.favorite
                        service.icon = runtime.icon
                manual.extend(
                    Service(
                        id=f"custom-host-{item.id}",
                        name=item.name,
                        description=item.description,
                        icon=item.icon,
                        url=item.url,
                        favorite=item.favorite,
                    )
                    for item in custom.hosts
                )
                visible_manual = [
                    service for service in manual
                    if (service.id if service.id.startswith("custom-host-") else f"manual-{service.id}") not in self.hidden_app_ids
                ]
                urls.extend(service.url for service in visible_manual)
                timeout = httpx.Timeout(settings.health_timeout)
                async with httpx.AsyncClient(timeout=timeout, verify=True) as client:
                    checks = []
                    # The local DNS/proxy path becomes unreliable when every
                    # appliance is resolved at once. Small batches retain
                    # concurrency without producing false offline results.
                    for start in range(0, len(urls), 5):
                        checks.extend(
                            await asyncio.gather(
                                *(check_url(client, url) for url in urls[start : start + 5]),
                                return_exceptions=True,
                            )
                        )
                checked = iter(checks)
                for resource in resources:
                    if resource.url:
                        result = next(checked)
                        resource.reachable = False if isinstance(result, Exception) else result.reachable
                for service in visible_manual:
                    result = next(checked)
                    if isinstance(result, Exception):
                        service.reachable = False
                    else:
                        service.reachable = result.reachable
                        service.status_code = result.status_code

                self._detect_events(resources)
                self.resources = resources
                self.all_manual_services = manual
                self.manual_services = visible_manual
                managed_apps = []
                for resource in resources:
                    if resource.type not in {"lxc", "qemu"} or resource.vmid is None:
                        continue
                    item_id = f"resource-{resource.vmid}"
                    managed_apps.append({
                        "id": item_id, "source": "builtin", "hidden": item_id in self.hidden_app_ids,
                        "name": resource.name, "description": resource.description, "icon": resource.icon,
                        "url": resource.url or "", "favorite": resource.favorite,
                    })
                for service in manual:
                    item_id = service.id if service.id.startswith("custom-host-") else f"manual-{service.id}"
                    managed_apps.append({
                        "id": item_id, "source": "custom" if item_id.startswith("custom-host-") else "builtin",
                        "hidden": item_id in self.hidden_app_ids, "name": service.name,
                        "description": service.description, "icon": service.icon, "url": service.url,
                        "favorite": service.favorite,
                    })
                self.managed_apps = managed_apps
                self.latest_backup = None
                self.pbs_storage = None
                previous_pbs_error = self.pbs_error
                self.pbs_error = None
                if infra.pbs_configured:
                    try:
                        self.latest_backup, self.pbs_storage = await PBSClient(infra).status()
                    except PBSError as exc:
                        self.pbs_error = str(exc)[:240]
                        if self.pbs_error != previous_pbs_error:
                            self._event("warning", "PBS-API nicht erreichbar", self.pbs_error)
                if self.latest_backup is None and infra.proxmox_configured:
                    self.latest_backup = await self.proxmox.latest_backup()
                self.last_success = datetime.now(timezone.utc)
                self.last_error = None
            except Exception as exc:  # keep the last good cache available
                message = str(exc)[:240]
                if message != self.last_error:
                    self._event("error", "Proxmox API nicht erreichbar", message)
                self.last_error = message
            finally:
                self.last_refresh = datetime.now(timezone.utc)

    async def run(self) -> None:
        while True:
            await self.refresh()
            await asyncio.sleep(settings.refresh_interval)

    def start(self) -> None:
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self.run())

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass


state = DashboardState()
