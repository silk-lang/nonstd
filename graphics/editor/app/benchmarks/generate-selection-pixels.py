"""Regenerate the demo's grayscale samples from the user-supplied reference image.

Requires ImageMagick. Run from any directory; output is deterministic.
"""
import base64
import json
import subprocess
from pathlib import Path

app = Path(__file__).resolve().parent.parent
source = app / "benchmarks/fixtures/selection-source.png"
width, height = map(int, subprocess.check_output(
    ["magick", "identify", "-format", "%w %h", str(source)], text=True,
).split())
pixels = subprocess.check_output([
    "magick", str(source), "-colorspace", "Gray", "-filter", "Triangle",
    "-resize", "400x250!", "-depth", "8", "gray:-",
])
assert len(pixels) == 100_000
(app / "src/assets/selection-pixels.json").write_text(json.dumps({
    "columns": 400, "rows": 250, "sourceWidth": width, "sourceHeight": height,
    "grayscale": base64.b64encode(pixels).decode(),
}, indent=2) + "\n")
