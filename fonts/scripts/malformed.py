"""Deterministic whole-corpus corruption checks; never classify a crash as a match."""
from __future__ import annotations

import argparse
from concurrent.futures import ProcessPoolExecutor, as_completed
import gzip
import hashlib
import json
from pathlib import Path
import random
import shutil
import subprocess
import tempfile

import harness

CAMPAIGN_VERSION = 1


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def freeze_binary(binary: Path, directory: Path) -> dict:
    """A concurrent build must not change the executable halfway through a run."""
    data = binary.read_bytes()
    digest = sha(data)
    snapshot = directory / digest / binary.name
    snapshot.parent.mkdir(parents=True, exist_ok=True)
    if not snapshot.exists() or sha(snapshot.read_bytes()) != digest:
        temporary = snapshot.with_suffix(".tmp")
        temporary.write_bytes(data)
        temporary.chmod(0o755)
        temporary.replace(snapshot)
    return {"path": str(binary), "sha256": digest, "run_path": str(snapshot.resolve())}


def mutations(data: bytes, seed: int):
    """Header edges, 1/16 length intervals, final byte, and eight seeded flips."""
    size = len(data)
    cuts = {0, 1, 2, 3, 4, 5, 6, 7, 8, 11, 12, 15, 16, 31, 32, 63, 64}
    cuts.update(size * n // 16 for n in range(1, 16))
    cuts.add(size - 1)
    for cut in sorted(cut for cut in cuts if 0 <= cut < size):
        yield {"kind": "truncate", "length": cut}, data[:cut]
    if not size:
        return
    rng = random.Random(f"read-fonts-malformed-v{CAMPAIGN_VERSION}:{seed}:{sha(data)}")
    # Even invalid/unsupported inputs are mutated. SFNT directory targeting is
    # only a mutation heuristic and does not decide whether a font is tested.
    directory_end = min(size, 12 + 16 * int.from_bytes(data[4:6], "big"))
    regions = [(0, min(size, 12)), (12, directory_end), (directory_end, size), (0, size)]
    for index in range(8):
        start, end = regions[index // 2]
        if start >= end:
            start, end = 0, size
        offsets = rng.sample(range(start, end), min(1 << (index % 4), end - start))
        changed = bytearray(data)
        flips = []
        for offset in offsets:
            mask = rng.randrange(1, 256)
            changed[offset] ^= mask
            flips.append([offset, mask])
        yield {"kind": "flip", "index": index, "xor": flips}, bytes(changed)


def check_case(data: bytes, recipe: dict, reference: Path, silk: Path,
               timeout: float, failure_directory: Path) -> dict:
    observation = {"mutation": recipe, "input_sha256": sha(data), "length": len(data)}
    with tempfile.TemporaryDirectory(prefix="read-fonts-corrupt-") as temporary:
        directory = Path(temporary)
        font = directory / "input.font"
        font.write_bytes(data)
        outputs = [directory / "rust.dump", directory / "silk.dump"]
        processes = []
        for binary, path in zip((reference, silk), outputs):
            with path.open("w+b") as output:
                try:
                    result = harness.run_dump_file(binary, font, timeout, output)
                    processes.append({"exit": result.returncode,
                                      "stderr": result.stderr.decode("utf-8", errors="backslashreplace")})
                except subprocess.TimeoutExpired:
                    processes.append({"timeout_seconds": timeout})
        observation["processes"] = dict(zip(("rust", "silk"), processes))
        if any(process.get("exit") != 0 for process in processes):
            observation["status"] = "failure"
        else:
            try:
                with outputs[0].open("rb") as left, outputs[1].open("rb") as right:
                    difference = harness.first_difference_files(left, right)
                    left_info = harness.inspect_dump_file(left)
                    # Identical bytes have identical structural validity. Avoid
                    # parsing a potentially very large matching dump twice.
                    right_info = harness.inspect_dump_file(right) if difference else left_info
                observation.update(
                    status="difference" if difference else "match",
                    rust_dump_sha256=left_info["dump_sha256"],
                    silk_dump_sha256=right_info["dump_sha256"],
                    lines=left_info["lines"],
                    parse_error_count=len(left_info["parse_errors"]),
                    parse_errors_sha256=sha("\n".join(left_info["parse_errors"]).encode()),
                )
                if difference:
                    number, left_line, right_line = difference
                    observation["first_difference"] = {
                        "line": number, "rust": harness.show_line(left_line),
                        "silk": harness.show_line(right_line)}
            except (ValueError, UnicodeError) as error:
                observation.update(status="failure", error=str(error))
        if observation["status"] != "match":
            destination = failure_directory / observation["input_sha256"]
            destination.mkdir(parents=True, exist_ok=True)
            for path in (font, *outputs):
                shutil.copyfile(path, destination / path.name)
            (destination / "observation.json").write_text(json.dumps(observation, indent=2) + "\n")
            observation["artifacts"] = harness.display(destination)
    return observation


def check_font(font: Path, configuration: dict, cache: Path, failures: Path) -> dict:
    data = font.read_bytes()
    source = {"font": harness.display(font), "input_sha256": sha(data)}
    receipt = cache / (sha(source["font"].encode()) + ".json")
    previous = {}
    if receipt.exists():
        saved = json.loads(receipt.read_text())
        if saved["configuration"] == configuration and saved["source"] == source:
            previous = {json.dumps(case["mutation"], sort_keys=True): case
                        for case in saved["results"] if case["status"] == "match"}
    record = {"configuration": configuration, "source": source, "results": []}
    for recipe, changed in mutations(data, configuration["seed"]):
        key = json.dumps(recipe, sort_keys=True)
        result = previous.get(key)
        if result is None or result["input_sha256"] != sha(changed):
            result = check_case(changed, recipe, Path(configuration["reference"]["run_path"]),
                                Path(configuration["silk"]["run_path"]), configuration["timeout"], failures)
        record["results"].append(result)
        temporary = receipt.with_suffix(".tmp")
        temporary.write_text(json.dumps(record) + "\n")
        temporary.replace(receipt)
        # Keep the first actionable failure per source, then test other fonts.
        # A later run reuses only verified matches and retries this mutation.
        if result["status"] != "match":
            break
    record["expected_cases"] = sum(1 for _ in mutations(data, configuration["seed"]))
    return record


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fonts", type=Path)
    parser.add_argument("--reference", type=Path, default=harness.REFERENCE)
    parser.add_argument("--silk-dumper", type=Path)
    parser.add_argument("--seed", type=int, default=20261026)
    parser.add_argument("--jobs", type=int, default=harness.JOBS)
    parser.add_argument("--timeout", type=float, default=600)
    parser.add_argument("--cache", type=Path, default=harness.ROOT / "build/malformed-cache")
    parser.add_argument("--failures", type=Path, default=harness.ROOT / "build/malformed-failures")
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    if args.jobs < 1 or args.timeout <= 0:
        parser.error("jobs and timeout must be positive")
    fonts, _ = harness.font_list(args.fonts)
    reference = args.reference.resolve()
    silk = (args.silk_dumper or harness.silk_binary()).resolve()
    configuration = {
        "campaign_version": CAMPAIGN_VERSION, "seed": args.seed, "timeout": args.timeout,
        "dump_header": harness.HEADER.decode(),
        "reference": freeze_binary(reference, args.cache / "binaries"),
        "silk": freeze_binary(silk, args.cache / "binaries"),
    }
    args.cache.mkdir(parents=True, exist_ok=True)
    records = []
    with ProcessPoolExecutor(max_workers=args.jobs) as pool:
        tasks = {pool.submit(check_font, font, configuration, args.cache, args.failures): font for font in fonts}
        for task in as_completed(tasks):
            record = task.result()
            records.append(record)
            bad = [case for case in record["results"] if case["status"] != "match"]
            if bad:
                print("FAIL", record["source"]["font"], json.dumps(bad[0]), flush=True)
            elif len(records) % 10 == 0 or len(records) == len(fonts):
                print(f"Checked {len(records)}/{len(fonts)} fonts", flush=True)
    records.sort(key=lambda record: record["source"]["font"])
    summary = {"fonts": len(fonts), "expected_cases": sum(r["expected_cases"] for r in records),
               "completed": sum(len(r["results"]) for r in records),
               "matched": sum(c["status"] == "match" for r in records for c in r["results"]),
               "differences": sum(c["status"] == "difference" for r in records for c in r["results"]),
               "process_or_harness_failures": sum(c["status"] == "failure" for r in records for c in r["results"])}
    for record in records:
        del record["configuration"]
    report = {"summary": summary, "configuration": configuration, "fonts": records}
    args.report.parent.mkdir(parents=True, exist_ok=True)
    opener = gzip.open if args.report.suffix == ".gz" else open
    with opener(args.report, "wt", encoding="utf-8") as output:
        json.dump(report, output, indent=2)
        output.write("\n")
    print(json.dumps(summary, sort_keys=True), flush=True)
    return int(summary["matched"] != summary["expected_cases"])


if __name__ == "__main__":
    raise SystemExit(main())
