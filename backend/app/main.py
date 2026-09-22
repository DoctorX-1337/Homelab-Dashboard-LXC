from __future__ import annotations

import os
import re
import time
import base64
import binascii
import io
import unicodedata
from contextlib import asynccontextmanager
from pathlib import Path

from typing import Literal
from urllib.parse import urlsplit

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from PIL import Image, UnidentifiedImageError

from app.security import create_session, hash_pin, pin_is_configured, verify_pin, verify_session
from app.services.dashboard import state
from app.services.custom_items import BrandingPreference, EditableItem, ThemePreference, custom_items
from app.services.infrastructure import InfrastructureUpdate, infrastructure
from app.services.updates import read_installation_state, update_checker, write_installation_state
from app.settings import settings


CUSTOM_LOGO_DIRECTORY = Path(__file__).resolve().parents[2] / "data" / "logos"
CUSTOM_LOGO_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,79}\.(?:png|webp|jpe?g)$")
SESSION_COOKIE = "homelab_dashboard_session"
FAILED_PIN_ATTEMPTS: dict[str, list[float]] = {}


class PinLogin(BaseModel):
    pin: str


class PinChange(BaseModel):
    current_pin: str
    new_pin: str


class LogoUpload(BaseModel):
    name: str
    content_base64: str


@asynccontextmanager
async def lifespan(_: FastAPI):
    await state.refresh()
    state.start()
    yield
    await state.stop()


app = FastAPI(
    title="HomeLab Dashboard API",
    version="1.0.0",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
    lifespan=lifespan,
)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=list(settings.allowed_hosts))


@app.get("/api/status")
async def api_status():
    infra = infrastructure.snapshot()
    branding = custom_items.snapshot().branding
    return {
        "ok": state.last_error is None,
        "api_configured": settings.api_configured,
        "last_refresh": state.last_refresh,
        "last_success": state.last_success,
        "error": state.last_error,
        "refresh_interval": settings.refresh_interval,
        "dashboard_name": branding.dashboard_title,
        "dashboard_subtitle": branding.dashboard_subtitle,
        "footer_title": branding.footer_title,
        "footer_text": branding.footer_text,
        "browser_title": branding.browser_title,
        "verify_ssl": settings.proxmox_verify_ssl,
        "backup_configured": infra.pbs_configured or infra.proxmox_configured,
        "pbs_configured": infra.pbs_configured,
        "pbs_error": state.pbs_error,
        "storage_source": infra.storage_source,
        "latest_backup": state.latest_backup,
    }


@app.get("/api/custom-logos/{logo_name}", response_class=FileResponse)
async def api_custom_logo(logo_name: str):
    if not CUSTOM_LOGO_PATTERN.fullmatch(logo_name):
        raise HTTPException(status_code=404, detail="Logo nicht gefunden")
    logo_path = CUSTOM_LOGO_DIRECTORY / logo_name
    if not logo_path.is_file():
        raise HTTPException(status_code=404, detail="Logo nicht gefunden")
    return FileResponse(logo_path)


@app.post("/api/settings/logos")
async def api_settings_logo_upload(payload: LogoUpload, request: Request):
    require_settings_request(request)
    if len(payload.content_base64) > 4_200_000:
        raise HTTPException(status_code=413, detail="Das Logo darf höchstens 3 MB groß sein")
    try:
        raw = base64.b64decode(payload.content_base64, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(status_code=422, detail="Ungültige Bilddaten") from exc
    if not raw or len(raw) > 3_000_000:
        raise HTTPException(status_code=413, detail="Das Logo darf höchstens 3 MB groß sein")
    try:
        with Image.open(io.BytesIO(raw)) as uploaded:
            if uploaded.format not in {"PNG", "WEBP", "JPEG"}:
                raise HTTPException(status_code=422, detail="Nur PNG, WebP und JPEG sind zulässig")
            if uploaded.width > 4096 or uploaded.height > 4096 or uploaded.width * uploaded.height > 16_000_000:
                raise HTTPException(status_code=422, detail="Das Logo darf maximal 4096 × 4096 Pixel groß sein")
            uploaded.seek(0)
            image = uploaded.convert("RGBA")
            image.thumbnail((512, 512), Image.Resampling.LANCZOS)
            output = io.BytesIO()
            image.save(output, format="PNG", optimize=True)
    except (UnidentifiedImageError, OSError) as exc:
        raise HTTPException(status_code=422, detail="Die Datei ist kein gültiges Bild") from exc

    normalized = unicodedata.normalize("NFKD", payload.name).encode("ascii", "ignore").decode().lower()
    slug = re.sub(r"[^a-z0-9]+", "-", normalized).strip("-")[:64] or "logo"
    CUSTOM_LOGO_DIRECTORY.mkdir(parents=True, exist_ok=True)
    destination = CUSTOM_LOGO_DIRECTORY / f"{slug}.png"
    temporary = destination.with_suffix(".tmp")
    try:
        temporary.write_bytes(output.getvalue())
        os.chmod(temporary, 0o640)
        os.replace(temporary, destination)
    except OSError as exc:
        temporary.unlink(missing_ok=True)
        raise HTTPException(status_code=503, detail="Das Logo konnte nicht gespeichert werden") from exc
    return {"icon": f"custom:{slug}", "filename": destination.name}


@app.get("/api/cluster")
async def api_cluster():
    infra = infrastructure.snapshot()
    resources = state.resources
    nodes = [item for item in resources if item.type == "node"]
    guests = [item for item in resources if item.type in {"lxc", "qemu"}]
    storages = [
        item for item in resources
        if item.type == "storage" and (not infra.storage_ids or item.name in infra.storage_ids)
    ]
    if infra.storage_source == "pbs":
        storage_used = state.pbs_storage["used"] if state.pbs_storage else 0
        storage_total = state.pbs_storage["total"] if state.pbs_storage else 0
    else:
        storage_used = sum(item.disk.used for item in storages if item.status == "available")
        storage_total = sum(item.disk.total for item in storages if item.status == "available")
    return {
        "nodes": len(nodes),
        "containers": sum(item.type == "lxc" for item in guests),
        "vms": sum(item.type == "qemu" for item in guests),
        "running": sum(item.status in {"running", "online"} for item in guests),
        "stopped": sum(item.status in {"stopped", "offline"} for item in guests),
        "healthy": bool(nodes) and all(item.status == "online" for item in nodes),
        "cpu": sum(item.cpu for item in nodes) / max(len(nodes), 1),
        "memory_used": sum(item.memory.used for item in nodes),
        "memory_total": sum(item.memory.total for item in nodes),
        "storage_used": storage_used,
        "storage_total": storage_total,
    }


@app.get("/api/resources")
async def api_resources():
    return [
        item for item in state.resources
        if item.vmid is None or f"resource-{item.vmid}" not in state.hidden_app_ids
    ]


@app.get("/api/nodes")
async def api_nodes():
    return [item for item in state.resources if item.type == "node"]


@app.get("/api/vms")
async def api_vms():
    return [item for item in state.resources if item.type == "qemu"]


@app.get("/api/containers")
async def api_containers():
    return [item for item in state.resources if item.type == "lxc"]


@app.get("/api/services")
async def api_services():
    return state.manual_services


@app.get("/api/links")
async def api_links():
    return state.links


@app.get("/api/events")
async def api_events():
    return list(state.events)


@app.get("/api/update-status")
async def api_update_status():
    return {**await update_checker.status(), "installation": read_installation_state()}


def require_settings_request(request: Request) -> None:
    require_same_origin(request)
    if not verify_session(request.cookies.get(SESSION_COOKIE)):
        raise HTTPException(status_code=401, detail="Einstellungen sind gesperrt")


def require_settings_session(request: Request) -> None:
    if not verify_session(request.cookies.get(SESSION_COOKIE)):
        raise HTTPException(status_code=401, detail="Einstellungen sind gesperrt")


def require_same_origin(request: Request) -> None:
    if request.headers.get("x-dashboard-settings") != "1":
        raise HTTPException(status_code=403, detail="Einstellungsanfrage nicht bestätigt")
    origin = request.headers.get("origin")
    origin_host = urlsplit(origin).hostname if origin else None
    request_host = request.url.hostname
    if not origin_host or origin_host != request_host:
        raise HTTPException(status_code=403, detail="Ungültiger Anfrageursprung")


@app.get("/api/auth/status")
async def api_auth_status(request: Request):
    configured = pin_is_configured()
    return {
        "configured": configured,
        "authenticated": configured and verify_session(request.cookies.get(SESSION_COOKIE)),
    }


@app.post("/api/auth/pin")
async def api_auth_pin(payload: PinLogin, request: Request, response: Response):
    require_same_origin(request)
    if not pin_is_configured():
        raise HTTPException(status_code=503, detail="Dashboard-PIN ist noch nicht eingerichtet")
    client = request.client.host if request.client else "unknown"
    now = time.monotonic()
    attempts = [value for value in FAILED_PIN_ATTEMPTS.get(client, []) if now - value < 300]
    if len(attempts) >= 10:
        raise HTTPException(status_code=429, detail="Zu viele Fehlversuche; bitte fünf Minuten warten")
    if not verify_pin(payload.pin):
        attempts.append(now)
        FAILED_PIN_ATTEMPTS[client] = attempts
        raise HTTPException(status_code=401, detail="PIN ist nicht korrekt")
    FAILED_PIN_ATTEMPTS.pop(client, None)
    token, _ = create_session()
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=30 * 60,
        httponly=True,
        samesite="strict",
        secure=request.url.scheme == "https",
        path="/",
    )
    return {"authenticated": True}


@app.put("/api/settings/pin", status_code=202)
async def api_settings_pin_update(payload: PinChange, request: Request):
    require_settings_request(request)
    if not verify_pin(payload.current_pin):
        raise HTTPException(status_code=401, detail="Der aktuelle PIN ist nicht korrekt")
    try:
        encoded_pin = hash_pin(payload.new_pin)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    request_path = Path("/run/homelab-dashboard/pin-change-request")
    try:
        descriptor = os.open(request_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o640)
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            handle.write(encoded_pin)
            handle.write("\n")
    except FileExistsError as exc:
        raise HTTPException(status_code=409, detail="Eine PIN-Änderung wird bereits verarbeitet") from exc
    except OSError as exc:
        raise HTTPException(status_code=503, detail="PIN-Änderung konnte nicht gestartet werden") from exc
    return {"accepted": True}


@app.post("/api/update", status_code=202)
async def api_update(request: Request):
    require_settings_request(request)
    status = await update_checker.status(force=True)
    if status["error"]:
        raise HTTPException(status_code=503, detail="Versionsprüfung derzeit nicht verfügbar")
    if not status["update_available"] or not status["latest_version"]:
        raise HTTPException(status_code=409, detail="Kein Update verfügbar")

    request_path = Path("/run/homelab-dashboard/update-request")
    try:
        descriptor = os.open(request_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o640)
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            handle.write(str(status["latest_version"]))
            handle.write("\n")
    except FileExistsError as exc:
        raise HTTPException(status_code=409, detail="Ein Update läuft bereits") from exc
    except OSError as exc:
        raise HTTPException(status_code=503, detail="Update konnte nicht gestartet werden") from exc
    write_installation_state(
        "queued", "Update-Dienst wird gestartet", 2, str(status["latest_version"])
    )
    return {"started": True, "target_version": status["latest_version"]}


@app.get("/api/settings/items")
async def api_settings_items():
    return {"applications": state.managed_apps, "links": state.managed_links}


@app.get("/api/settings/infrastructure")
async def api_settings_infrastructure(request: Request):
    require_settings_session(request)
    return {
        "config": infrastructure.public(),
        "proxmox_error": state.last_error,
        "pbs_error": state.pbs_error,
    }


@app.put("/api/settings/infrastructure")
async def api_settings_infrastructure_update(payload: InfrastructureUpdate, request: Request):
    require_settings_request(request)
    try:
        configured = infrastructure.update(payload)
    except OSError as exc:
        raise HTTPException(status_code=503, detail="Infrastruktur-Konfiguration konnte nicht gespeichert werden") from exc
    await state.refresh()
    return {
        "config": configured,
        "proxmox_error": state.last_error,
        "pbs_error": state.pbs_error,
    }


@app.get("/api/settings/theme")
async def api_settings_theme():
    return ThemePreference(theme=custom_items.snapshot().theme)


@app.put("/api/settings/theme")
async def api_settings_theme_update(payload: ThemePreference, request: Request):
    require_settings_request(request)
    return custom_items.set_theme(payload.theme)


@app.get("/api/settings/branding")
async def api_settings_branding(request: Request):
    require_settings_session(request)
    return custom_items.snapshot().branding


@app.put("/api/settings/branding")
async def api_settings_branding_update(payload: BrandingPreference, request: Request):
    require_settings_request(request)
    return custom_items.set_branding(payload)


@app.post("/api/settings/{kind}")
async def api_settings_create(
    kind: Literal["hosts", "links"], payload: EditableItem, request: Request
):
    require_settings_request(request)
    if not payload.url:
        raise HTTPException(status_code=422, detail="Eine URL ist erforderlich")
    item = custom_items.save(kind, payload)
    await state.refresh()
    return item


@app.put("/api/settings/{kind}/{item_id}")
async def api_settings_update(
    kind: Literal["applications", "links"], item_id: str, payload: EditableItem, request: Request
):
    require_settings_request(request)
    try:
        item = custom_items.save_managed(kind, item_id, payload)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Eintrag nicht gefunden") from exc
    await state.refresh()
    return item


@app.delete("/api/settings/{kind}/{item_id}", status_code=204)
async def api_settings_delete(
    kind: Literal["applications", "links"], item_id: str, request: Request
):
    require_settings_request(request)
    try:
        custom_items.delete_managed(kind, item_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Eintrag nicht gefunden") from exc
    await state.refresh()


@app.post("/api/refresh", include_in_schema=False)
async def api_refresh():
    await state.refresh()
    return {"ok": state.last_error is None, "last_refresh": state.last_refresh}
