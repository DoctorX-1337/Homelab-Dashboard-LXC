import pytest
from pydantic import ValidationError

from app.services.custom_items import BrandingPreference, CustomItemsStore, EditableItem, ThemePreference


def test_custom_items_roundtrip(tmp_path):
    store = CustomItemsStore()
    store.path = tmp_path / "custom-items.json"
    created = store.save(
        "links",
        EditableItem(name="Test", description="Link", icon="link", url="https://example.com"),
    )
    assert store.snapshot().links[0].id == created.id

    updated = store.save(
        "links",
        EditableItem(name="Neu", description="Link", icon="cloud", url="https://example.org"),
        created.id,
    )
    assert updated.name == "Neu"
    assert store.snapshot().links[0].url == "https://example.org"

    store.delete("links", created.id)
    assert store.snapshot().links == []


def test_custom_item_rejects_credentials_and_non_http_urls():
    with pytest.raises(ValidationError):
        EditableItem(name="Unsicher", icon="link", url="https://user:secret@example.com")
    with pytest.raises(ValidationError):
        EditableItem(name="Datei", icon="link", url="file:///etc/passwd")


def test_custom_logo_namespace_is_restricted():
    assert EditableItem(name="Privat", icon="custom:mein-logo").icon == "custom:mein-logo"
    with pytest.raises(ValidationError):
        EditableItem(name="Pfad", icon="custom:../secret")


def test_builtin_override_can_be_hidden_and_restored(tmp_path):
    store = CustomItemsStore()
    store.path = tmp_path / "custom-items.json"
    item = EditableItem(name="Jellyfin Neu", description="Medien", icon="jellyfin", url="https://example.com")

    store.save_managed("applications", "resource-101", item)
    assert store.snapshot().app_overrides[0].name == "Jellyfin Neu"

    store.delete_managed("applications", "resource-101")
    hidden = store.snapshot()
    assert "resource-101" in hidden.hidden_apps
    assert hidden.app_overrides == []

    store.save_managed("applications", "resource-101", item)
    restored = store.snapshot()
    assert "resource-101" not in restored.hidden_apps
    assert restored.app_overrides[0].name == "Jellyfin Neu"


def test_theme_defaults_to_black_and_persists(tmp_path):
    store = CustomItemsStore()
    store.path = tmp_path / "custom-items.json"

    assert store.snapshot().theme == "black"
    assert store.set_theme("purple").theme == "purple"
    assert store.snapshot().theme == "purple"
    assert store.set_theme("multicolor").theme == "multicolor"
    assert store.set_theme("yellow").theme == "yellow"

    with pytest.raises(ValidationError):
        ThemePreference(theme="invalid")


def test_branding_defaults_can_be_changed_and_are_cleaned(tmp_path):
    store = CustomItemsStore()
    store.path = tmp_path / "custom-items.json"

    assert store.snapshot().branding.footer_text == "Dein Dashboard. Deine Konfiguration."
    changed = store.set_branding(BrandingPreference(
        dashboard_title="  Mein   HomeLab  ",
        dashboard_subtitle="Alles auf einen Blick",
        footer_title="Startseite",
        footer_text="Mein Netzwerk",
        browser_title="HomeLab Startseite",
    ))
    assert changed.dashboard_title == "Mein HomeLab"
    assert store.snapshot().branding.browser_title == "HomeLab Startseite"
    with pytest.raises(ValidationError):
        BrandingPreference(dashboard_title="   ")
