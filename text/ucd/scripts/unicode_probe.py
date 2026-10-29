"""Build library-internal diagnostics as isolated executable packages.

Silk intentionally makes no executable artifact for a library package, even
when its source override has main(). These build-only copies keep diagnostic
helpers out of ucd's public exports and do not generate another Unicode table.
"""
import os
from pathlib import Path
import shutil
import subprocess
import tomllib

ROOT = Path(__file__).resolve().parents[3]


def build_probe(name, silk=None):
    directory = ROOT / "build/unicode-probes" / name
    source = directory / "src"
    source.mkdir(parents=True, exist_ok=True)
    for path in (ROOT / "text/ucd/src").glob("*.silk"):
        shutil.copyfile(path, source / path.name)
    shutil.copyfile(ROOT / "text/ucd/src" / f"{name}.silk", source / "main.silk")
    pin = tomllib.loads((ROOT / "text/ucd/silk.toml").read_text())["package"]["silk-version"]
    (directory / "silk.toml").write_text(
        f'[package]\nname = "ucd_probe"\nversion = "0.1.0"\nsilk-version = "{pin}"\n'
    )
    # Dev.22 cache workaround; never reuse stale optimized bodies (#2468).
    for base in (ROOT, directory):
        for cache in ("build/llvm", "build/cache"):
            shutil.rmtree(base / cache, ignore_errors=True)
    executable = directory / "ucd_probe"
    subprocess.run([silk or os.environ.get("SILK", "silk"), "build", str(source / "main.silk"),
                    "-o", str(executable), "--optimization", "speed", "--debug", "false"],
                   cwd=directory, check=True)
    return executable
