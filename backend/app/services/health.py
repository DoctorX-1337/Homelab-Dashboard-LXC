from __future__ import annotations

import asyncio
from dataclasses import dataclass
from urllib.parse import urlsplit

import httpx


@dataclass(slots=True)
class HealthResult:
    reachable: bool
    status_code: int | None = None


def validate_configured_url(url: str) -> str:
    parsed = urlsplit(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("Nur konfigurierte HTTP(S)-URLs sind zulässig")
    if parsed.username or parsed.password:
        raise ValueError("Zugangsdaten dürfen nicht Bestandteil einer URL sein")
    return url


async def check_url(client: httpx.AsyncClient, url: str) -> HealthResult:
    validate_configured_url(url)
    try:
        # A redirect already proves that the configured endpoint is reachable.
        # Not following it also avoids treating local appliances with a
        # self-signed HTTPS target as offline.
        response = await client.get(url, follow_redirects=False)
        return HealthResult(response.status_code < 500, response.status_code)
    except (httpx.HTTPError, asyncio.TimeoutError):
        return HealthResult(False, None)
