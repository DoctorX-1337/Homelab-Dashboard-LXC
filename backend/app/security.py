from __future__ import annotations

import base64
import hashlib
import hmac
import os
import re
import secrets
import time
from pathlib import Path


PIN_FILE = Path(os.getenv("DASHBOARD_PIN_FILE", "/etc/homelab-dashboard.pin"))
PIN_PATTERN = re.compile(r"^\d{4}$")
SESSION_TTL_SECONDS = 30 * 60
PBKDF2_ALGORITHM = "sha256"


def hash_pin(pin: str, *, iterations: int = 600_000, salt: bytes | None = None) -> str:
    if not PIN_PATTERN.fullmatch(pin):
        raise ValueError("Der PIN muss genau vier Ziffern enthalten")
    actual_salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac(PBKDF2_ALGORITHM, pin.encode(), actual_salt, iterations)
    encoded_salt = base64.urlsafe_b64encode(actual_salt).decode()
    encoded_digest = base64.urlsafe_b64encode(digest).decode()
    return f"pbkdf2_sha256${iterations}${encoded_salt}${encoded_digest}"


def _read_record(path: Path = PIN_FILE) -> str | None:
    try:
        record = path.read_text(encoding="utf-8").strip()
    except OSError:
        return None
    return record if record.startswith("pbkdf2_sha256$") else None


def pin_is_configured(path: Path = PIN_FILE) -> bool:
    return _read_record(path) is not None


def verify_pin(pin: str, path: Path = PIN_FILE) -> bool:
    record = _read_record(path)
    if record is None or not PIN_PATTERN.fullmatch(pin):
        return False
    try:
        _, iterations, encoded_salt, encoded_digest = record.split("$", 3)
        expected = base64.urlsafe_b64decode(encoded_digest)
        actual = hashlib.pbkdf2_hmac(
            PBKDF2_ALGORITHM,
            pin.encode(),
            base64.urlsafe_b64decode(encoded_salt),
            int(iterations),
        )
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(actual, expected)


def create_session(path: Path = PIN_FILE, now: int | None = None) -> tuple[str, int]:
    record = _read_record(path)
    if record is None:
        raise RuntimeError("Kein Dashboard-PIN konfiguriert")
    expires = (now or int(time.time())) + SESSION_TTL_SECONDS
    payload = f"{expires}.{secrets.token_urlsafe(18)}"
    signature = hmac.new(record.encode(), payload.encode(), hashlib.sha256).hexdigest()
    return f"{payload}.{signature}", expires


def verify_session(token: str | None, path: Path = PIN_FILE, now: int | None = None) -> bool:
    record = _read_record(path)
    if record is None or not token:
        return False
    try:
        expires, nonce, signature = token.split(".", 2)
        if int(expires) < (now or int(time.time())) or not nonce:
            return False
    except (ValueError, TypeError):
        return False
    payload = f"{expires}.{nonce}"
    expected = hmac.new(record.encode(), payload.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(signature, expected)
