from app.security import create_session, hash_pin, verify_pin, verify_session


def test_pin_hash_and_session_roundtrip(tmp_path):
    path = tmp_path / "dashboard.pin"
    path.write_text(hash_pin("1234", salt=b"0123456789abcdef"), encoding="utf-8")

    assert verify_pin("1234", path) is True
    assert verify_pin("9999", path) is False
    token, expires = create_session(path, now=1_000)
    assert expires == 2_800
    assert verify_session(token, path, now=1_001) is True
    assert verify_session(token, path, now=2_801) is False


def test_pin_must_have_four_digits():
    for invalid in ("123", "12345", "12a4"):
        try:
            hash_pin(invalid)
        except ValueError:
            pass
        else:
            raise AssertionError(f"invalid PIN accepted: {invalid}")
