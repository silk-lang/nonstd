#!/usr/bin/env python3
"""Corpus discovery and process-level differential checks (Python 3.11+, stdlib only)."""
from __future__ import annotations

import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
import hashlib
import itertools
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
CORPUS_ROOTS = (
    "font/parse/upstream/font-test-data/test_data/ttf",
    "font/parse/upstream/font-test-data/test_data/ttc",
    "font/parse/upstream/font-test-data/test_data/extracted",
    "font/shape/test-data/harfrust/harfrust/tests/fonts",
)
# Unsupported containers are still oracle inputs: their upstream errors are observations.
FONT_SUFFIXES = {".ttf", ".otf", ".ttc", ".otc", ".dfont", ".woff", ".woff2"}
FONT_MAGIC = {b"\0\1\0\0", b"OTTO", b"true", b"ttcf"}
HEADER = b"font-dump.version=9\ndump.scope=all\n"
# READ_FONTS_PROFILE=release points every check at the release dumpers.
PROFILE = os.environ.get("READ_FONTS_PROFILE", "debug")
REFERENCE = ROOT / f"build/rust/{PROFILE}/rust-font-dump"
JOBS = int(os.environ.get("READ_FONTS_JOBS", os.cpu_count() or 1))


def display(path: Path) -> str:
    try:
        return path.relative_to(ROOT).as_posix()
    except ValueError:
        return str(path)


def discover() -> tuple[list[Path], list[dict]]:
    fonts = []
    inventory = []
    for name in CORPUS_ROOTS:
        directory = ROOT / name
        if not directory.is_dir():
            raise ValueError(f"missing corpus {name}; run git submodule update --init --recursive")
        found = []
        excluded = []
        for path in sorted(directory.rglob("*")):
            if not path.is_file():
                continue
            with path.open("rb") as source:
                magic = source.read(4)
            if path.suffix.lower() in FONT_SUFFIXES or magic in FONT_MAGIC:
                found.append(path)
            else:
                excluded.append(display(path))
        # extracted/ contains glyph expectation text at the pinned commit, not font containers.
        if not found and not name.endswith("/extracted"):
            raise ValueError(f"empty font corpus: {name}")
        fonts.extend(found)
        inventory.append({"root": name, "fonts": len(found), "excluded": excluded})
    return sorted(set(fonts)), inventory


def font_list(path: Path | None) -> tuple[list[Path], list[dict]]:
    if path is None:
        return discover()
    fonts = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line or line.startswith("#"):
            continue
        candidate = Path(line)
        if not candidate.is_absolute():
            candidate = ROOT / candidate
        candidate = candidate.resolve()
        if not candidate.is_file():
            raise ValueError(f"font list names a missing file: {line}")
        fonts.append(candidate)
    if not fonts:
        raise ValueError("font list is empty")
    if len(set(fonts)) != len(fonts):
        raise ValueError("font list contains duplicates")
    return fonts, []


def run_dumper(executable: Path, font: Path, timeout: float) -> subprocess.CompletedProcess:
    # Each path is one argv item; paths with whitespace or shell punctuation are safe.
    return subprocess.run([str(executable.resolve()), str(font)], capture_output=True, timeout=timeout)


def validate_dump(output: bytes) -> None:
    if not output.startswith(HEADER) or not output.endswith(b"\n"):
        raise ValueError("dumper did not emit a complete font dump")
    lines = output.splitlines()
    if len(lines) < 4 or not lines[2].startswith(b"file.length="):
        raise ValueError("dump has no file length (a skeleton is not a passing dump)")
    if not (lines[3].startswith(b"file.error=") or lines[3] in (b"file.kind=sfnt", b"file.kind=ttc")):
        raise ValueError("dump has neither a file kind nor an upstream parse error")


def run_dump_file(executable: Path, font: Path, timeout: float, output):
    return subprocess.run([str(executable.resolve()), str(font)], stdout=output,
                          stderr=subprocess.PIPE, timeout=timeout)


BLOCK = 1 << 24


def lines_containing(block: bytes, *needles: bytes) -> list[bytes]:
    """Lines of block containing any needle, in order; bytes.find beats a regex scan by ~10x."""
    starts = set()
    for needle in needles:
        position = block.find(needle)
        while position != -1:
            start = block.rfind(b"\n", 0, position) + 1
            starts.add(start)
            position = block.find(needle, block.find(b"\n", position))
    return [block[start:block.find(b"\n", start)] for start in sorted(starts)]


def line_blocks(output):
    """Yield blocks of whole lines; dumps reach gigabytes, so never go line by line."""
    output.seek(0)
    pending = b""
    while chunk := output.read(BLOCK):
        chunk = pending + chunk
        end = chunk.rfind(b"\n") + 1
        pending = chunk[end:]
        if end:
            yield chunk[:end]
    if pending:
        raise ValueError("dumper did not emit a complete font dump")


def inspect_dump_file(output) -> dict:
    output.seek(0)
    prefix = b"".join(output.readline() for _ in range(4))
    validate_dump(prefix)
    digest = hashlib.sha256()
    count = faces = missing = 0
    errors = []
    nodes = set()
    for block in line_blocks(output):
        if b"=traversal-limit\n" in block:
            raise ValueError("dump exceeded its traversal bound; not a complete field comparison")
        block.decode("utf-8")
        for line in lines_containing(block, b".node=", b".ref="):
            path, number = line.rsplit(b"=", 1)
            key = (path.split(b".", 1)[0], int(number))
            if path.endswith(b".ref") and key not in nodes:
                raise ValueError("dump reference has no preceding node")
            if path.endswith(b".node"):
                if key in nodes:
                    raise ValueError("dump reuses a node identifier")
                nodes.add(key)
        digest.update(block)
        count += block.count(b"\n")
        faces += sum(line.startswith(b"font[") for line in lines_containing(block, b".sfntVersion="))
        missing += block.count(b".lookup=missing\n")
        errors.extend(line.decode("utf-8") for line in lines_containing(block, b".error="))
    return {"dump_sha256": digest.hexdigest(), "lines": count, "faces_ok": faces,
            "missing_table_lookups": missing, "parse_errors": errors}


def first_difference_files(left, right):
    left.seek(0)
    right.seek(0)
    while True:
        a, b = left.read(BLOCK), right.read(BLOCK)
        if a != b:
            break
        if not a:
            return None
    left.seek(0)
    right.seek(0)
    for number, (a, b) in enumerate(itertools.zip_longest(left, right), 1):
        if a != b:
            return number, a, b
    return None


def first_difference(left: bytes, right: bytes) -> tuple[int, bytes | None, bytes | None] | None:
    # keepends detects a missing final newline; None distinguishes EOF from an empty line.
    for number, (a, b) in enumerate(itertools.zip_longest(
        left.splitlines(keepends=True), right.splitlines(keepends=True)
    ), 1):
        if a != b:
            return number, a, b
    return None


def show_line(line: bytes | None) -> str:
    return "<EOF>" if line is None else repr(line.decode("utf-8", errors="backslashreplace"))


def silk_binary() -> Path:
    candidates = sorted((ROOT / "build/llvm").glob(f"*/{PROFILE}/font_dump"))
    if len(candidates) != 1:
        raise ValueError("build font_dump first with font/scripts/build, or pass --silk-dumper PATH")
    return candidates[0]


def process_messages(name: str, result: subprocess.CompletedProcess) -> list[str]:
    messages = [f"{name}: exit {result.returncode}"]
    if result.stderr:
        messages.append(result.stderr.decode("utf-8", errors="backslashreplace").rstrip())
    return messages


def report_process(name: str, result: subprocess.CompletedProcess) -> None:
    print(f"{name}: exit {result.returncode}", file=sys.stderr)
    if result.stderr:
        print(result.stderr.decode("utf-8", errors="backslashreplace").rstrip(), file=sys.stderr)


def compare(fonts: list[Path], reference: Path, silk: Path, timeout: float,
            report: Path | None = None) -> int:
    observations = []

    def finish(status: int) -> int:
        if report is not None:
            report.parent.mkdir(parents=True, exist_ok=True)
            report.write_text(json.dumps({
                "summary": {
                    "format_version": 9, "scope": "all", "fonts_total": len(fonts),
                    "completed": sum(item["status"] in ("match", "difference") for item in observations),
                    "matched": sum(item["status"] == "match" for item in observations),
                    "differences": sum(item["status"] == "difference" for item in observations),
                    "process_failures": sum(item["status"] == "failure" for item in observations),
                    "exit_code": status,
                },
                "reference": {"path": display(reference), "sha256": hashlib.sha256(reference.read_bytes()).hexdigest()},
                "silk": {"path": display(silk), "sha256": hashlib.sha256(silk.read_bytes()).hexdigest()},
                "results": observations,
            }, indent=2) + "\n")
        return status

    def check(font: Path) -> tuple[dict, list[str], Exception | None]:
        # Runs on a worker thread: collect messages and print them in corpus order.
        messages = []
        observation = {"font": display(font), "input_sha256": hashlib.sha256(font.read_bytes()).hexdigest()}
        try:
            with tempfile.TemporaryFile() as rust_output, tempfile.TemporaryFile() as silk_output:
                rust = run_dump_file(reference, font, timeout, rust_output)
                port = run_dump_file(silk, font, timeout, silk_output)
                difference = first_difference_files(rust_output, silk_output)
                if difference is not None:
                    number, left, right = difference
                    messages.append(f"{display(font)}: first difference at line {number}\n"
                                    f"  Rust: {show_line(left)}\n  Silk: {show_line(right)}")
                    observation["first_difference"] = {"line": number, "rust": show_line(left), "silk": show_line(right)}
                if rust.returncode != 0 or port.returncode != 0:
                    messages.extend(process_messages("Rust", rust) + process_messages("Silk", port))
                    observation.update(status="failure", rust_exit=rust.returncode, silk_exit=port.returncode)
                    return observation, messages, None
                rust_info = inspect_dump_file(rust_output)
                port_info = rust_info if difference is None else inspect_dump_file(silk_output)
        except (OSError, subprocess.TimeoutExpired, ValueError) as error:
            observation.update(status="failure", error=str(error))
            return observation, messages, error
        observation.update(
            status="match" if difference is None else "difference",
            rust_dump_sha256=rust_info["dump_sha256"],
            silk_dump_sha256=port_info["dump_sha256"],
            lines=rust_info["lines"],
            parse_errors=rust_info["parse_errors"],
        )
        return observation, messages, None

    with ThreadPoolExecutor(max_workers=JOBS) as pool:
        results = list(pool.map(check, fonts))
    observations.extend(observation for observation, _, _ in results)
    status = 0
    for observation, messages, error in results:
        for message in messages:
            print(message)
        if error is not None:
            # An unusable dump or a timeout is a harness error, not a difference.
            finish(2)
            raise error
        if observation["status"] == "failure":
            print(f"{observation['font']}: {observation.get('error', 'dumper failed')}", file=sys.stderr)
            status = 2
        elif observation["status"] == "difference":
            status = max(status, 1)
    if status:
        failed = sum(item["status"] != "match" for item in observations)
        print(f"FAIL: {failed} of {len(fonts)} fonts differ or failed")
        return finish(status)
    print(f"MATCH: {len(fonts)} fonts; format 9")
    return finish(0)


def verify(fonts: list[Path], inventory: list[dict], reference: Path,
           timeout: float, report: Path | None) -> int:
    results = []
    failures = []
    totals = Counter()
    for font in fonts:
        name = display(font)
        try:
            with tempfile.TemporaryFile() as output:
                result = run_dump_file(reference, font, timeout, output)
                if result.returncode != 0:
                    report_process(name, result)
                    raise ValueError(f"exit {result.returncode}")
                info = inspect_dump_file(output)
            totals["faces_ok"] += info["faces_ok"]
            totals["parse_error_records"] += len(info["parse_errors"])
            totals["missing_table_lookups"] += info["missing_table_lookups"]
            results.append({"font": name, "input_sha256": hashlib.sha256(font.read_bytes()).hexdigest(), **info})
        except (OSError, subprocess.TimeoutExpired, ValueError) as error:
            failures.append({"font": name, "error": str(error)})
            print(f"FAIL: {name}: {error}", file=sys.stderr)
    summary = {
        "format_version": 9, "scope": "all", "fonts_total": len(fonts),
        "completed": len(results), "process_failures": len(failures),
        "faces_ok": totals["faces_ok"], "parse_error_records": totals["parse_error_records"],
        "missing_table_lookups": totals["missing_table_lookups"],
    }
    if report is not None:
        report.parent.mkdir(parents=True, exist_ok=True)
        report.write_text(json.dumps({"summary": summary, "inventory": inventory,
                                     "failures": failures, "results": results}, indent=2) + "\n")
    print(json.dumps(summary, sort_keys=True))
    # Parse errors are valid oracle observations, never hidden or counted as parsed faces.
    return int(bool(failures))


def main(mode: str | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    if mode is None:
        parser.add_argument("mode", choices=("font-list", "verify-reference", "compare"))
    parser.add_argument("--fonts", type=Path, help="UTF-8 font list; relative entries use the repo root")
    parser.add_argument("--reference", type=Path, default=REFERENCE)
    parser.add_argument("--silk-dumper", type=Path)
    parser.add_argument("--timeout", type=float, default=30, help="seconds per dumper per font")
    parser.add_argument("--report", type=Path, help="write comparison, reference results, or corpus inventory as JSON")
    parser.add_argument("--output", type=Path, help="write font list here instead of stdout")
    args = parser.parse_args()
    selected = mode or args.mode
    try:
        if args.timeout <= 0:
            raise ValueError("timeout must be positive")
        fonts, inventory = font_list(args.fonts)
        if selected == "font-list":
            output = "".join(display(font) + "\n" for font in fonts)
            if args.output is not None:
                args.output.parent.mkdir(parents=True, exist_ok=True)
                args.output.write_text(output, encoding="utf-8")
            else:
                print(output, end="")
            if args.report is not None:
                args.report.parent.mkdir(parents=True, exist_ok=True)
                args.report.write_text(json.dumps(inventory, indent=2) + "\n")
            print(f"{len(fonts)} fonts; {sum(len(item['excluded']) for item in inventory)} non-font files excluded",
                  file=sys.stderr)
            return 0
        if selected == "compare":
            return compare(fonts, args.reference, args.silk_dumper or silk_binary(), args.timeout, args.report)
        return verify(fonts, inventory, args.reference, args.timeout, args.report)
    except (OSError, ValueError, subprocess.TimeoutExpired) as error:
        print(f"{selected}: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
