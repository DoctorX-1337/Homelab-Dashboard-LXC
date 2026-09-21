import pytest

from app.services.health import validate_configured_url


def test_accepts_http_and_https():
    assert validate_configured_url("https://example.test/path") == "https://example.test/path"


@pytest.mark.parametrize("url", ["file:///etc/passwd", "ftp://example.test", "https://user:pw@example.test"])
def test_rejects_unsafe_urls(url):
    with pytest.raises(ValueError):
        validate_configured_url(url)
