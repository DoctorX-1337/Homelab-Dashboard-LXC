from app.services.icons import icon_for


def test_known_icons():
    assert icon_for("Jellyfin", "lxc") == "jellyfin"
    assert icon_for("immich", "lxc") == "immich"
    assert icon_for("HomeDC", "qemu") == "windows"
    assert icon_for("Nginx Proxyverwaltung", "lxc") == "nginx"
    assert icon_for("WireGuard", "lxc") == "wireguard"
    assert icon_for("NAS01", "lxc") == "qnap"


def test_type_fallback():
    assert icon_for("custom-app", "lxc") == "container"
