"""Parsing helpers for pinned Harfrust shaping data and migration comparisons only."""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "font/shape/test-data/harfrust/harfrust/src"


def array(source, name):
    match = re.search(rf"(?:static|const) {name}:.*?=\s*&?\[(.*?)\];", source, re.S)
    if not match:
        raise ValueError(f"missing upstream array {name}")
    return re.sub(r"//[^\n]*|/\*.*?\*/", "", match[1], flags=re.S)


def numbers(text):
    return [int(v.strip(), 0) for v in text.split(",") if v.strip()]


def byte_function(name, data):
    literal = "".join(f"\\x{byte:02x}" for byte in data)
    return f'pub fn {name}() -> &\'static [u8] {{ return b"{literal}" }}\n'


def script_tags():
    return dict(re.findall(r'pub const (\w+): Self = Self::from_bytes\(b"(....)"\);', (SOURCE / "script.rs").read_text()))
