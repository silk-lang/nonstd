"""Native builds for the vector and gpu_scene tools reuse gpu/webgpu's pinned Dawn build helper."""
from pathlib import Path
import sys

SVG = Path(__file__).resolve().parents[1]
REPO = SVG.parents[1]
sys.path.insert(0, str(REPO / "gpu" / "webgpu" / "scripts"))
from _build import build, command_path  # noqa: E402
