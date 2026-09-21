import pytest

from app.services.updates import (
    UpdateChecker,
    is_newer,
    latest_version_from_tags,
    parse_version,
    read_installation_state,
    write_installation_state,
)


def test_version_comparison():
    assert parse_version("1.2.3") == (1, 2, 3)
    assert is_newer("1.1.0", "1.2.0") is True
    assert is_newer("1.2.0", "1.2.0") is False
    assert is_newer("2.0.0", "1.9.9") is False


def test_invalid_version_is_rejected():
    with pytest.raises(ValueError):
        parse_version("main")


def test_latest_version_from_tags():
    assert latest_version_from_tags(["v1.2.0", "v2.0.0", "preview", "v1.10.0"]) == "2.0.0"
    with pytest.raises(ValueError):
        latest_version_from_tags(["main", "preview"])


def test_current_version_file(tmp_path):
    checker = UpdateChecker()
    checker.version_path = tmp_path / "VERSION"
    checker.version_path.write_text("3.4.5\n", encoding="utf-8")
    assert checker.current_version() == "3.4.5"


def test_installation_state_roundtrip_and_validation(tmp_path):
    path = tmp_path / "update-state.json"
    assert read_installation_state(path)["status"] == "idle"

    write_installation_state("running", "Frontend wird gebaut", 78, "2.0.0", path)
    state = read_installation_state(path)
    assert state["status"] == "running"
    assert state["progress"] == 78
    assert state["target_version"] == "2.0.0"

    path.write_text('{"status":"unknown","progress":500}', encoding="utf-8")
    assert read_installation_state(path)["status"] == "idle"
