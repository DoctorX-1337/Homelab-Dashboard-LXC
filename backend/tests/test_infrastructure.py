import json

import pytest
from pydantic import ValidationError

from app.services.infrastructure import InfrastructureConfig, InfrastructureStore, InfrastructureUpdate


def test_infrastructure_persists_secrets_but_never_returns_them(tmp_path):
    store = InfrastructureStore(
        path=tmp_path / "infrastructure.json",
        defaults=InfrastructureConfig(proxmox_token_secret="existing-secret"),
    )
    public = store.update(InfrastructureUpdate(
        proxmox_host="https://proxmox.example.test:8006/",
        proxmox_user="dashboard@pve",
        proxmox_token_name="homelab",
        storage_ids=["local-lvm", "local-lvm"],
    ))

    assert public.proxmox_host == "https://proxmox.example.test:8006"
    assert public.proxmox_token_configured is True
    assert public.storage_ids == ["local-lvm"]
    assert "secret" not in public.model_dump_json()
    stored = json.loads(store.path.read_text(encoding="utf-8"))
    assert stored["proxmox_token_secret"] == "existing-secret"
    assert store.path.stat().st_mode & 0o777 == 0o600


def test_infrastructure_rejects_unsafe_urls_and_storage_ids():
    with pytest.raises(ValidationError):
        InfrastructureUpdate(proxmox_host="https://user:secret@example.test")
    with pytest.raises(ValidationError):
        InfrastructureUpdate(pbs_host="file:///etc/passwd")
    with pytest.raises(ValidationError):
        InfrastructureUpdate(storage_ids=["../../etc"])
