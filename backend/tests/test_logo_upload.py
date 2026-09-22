import base64
import io

from PIL import Image


def test_logo_fixture_is_a_small_valid_png():
    output = io.BytesIO()
    Image.new("RGBA", (64, 64), (40, 167, 69, 255)).save(output, format="PNG")
    encoded = base64.b64encode(output.getvalue()).decode()

    assert len(encoded) < 4_200_000
    with Image.open(io.BytesIO(base64.b64decode(encoded))) as uploaded:
        assert uploaded.format == "PNG"
        assert uploaded.size == (64, 64)
