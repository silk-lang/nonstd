"""Native builds for gpu-lexer reuse gpu/webgpu's pinned Dawn build helper."""
from pathlib import Path
import sys

LEXER = Path(__file__).resolve().parents[1]
REPO = LEXER.parents[1]
sys.path.insert(0, str(REPO / "gpu" / "webgpu" / "scripts"))
from _build import build, command_path  # noqa: E402,F401
