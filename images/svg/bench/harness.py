"""Native stage-wall-time benchmark orchestration (Python standard library only).

Each native invocation loads one SVG before timing. A workload sample sums its
per-document stage times and divides by iterations: iconset means one complete
pass over all icons, not an average icon. Samples use fresh processes and alternate
engine order. Checksums consume every output outside the timed stage. Equality
across renderers is reported, never required and never a pixel-conformance claim.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import statistics
import subprocess
import sys
import tempfile
import time

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
# Also permits loading this module directly from unittest's file-based loader.
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))
import workloads

MODES = ("parse", "render", "end-to-end")
STAGES = {
    "parse": "XML + computed style + geometry resolve + Silk record / usvg render-ready retained tree; not raw resolve. Retained result rasterized and consumed outside timing.",
    "render": "Reuse retained display list/tree; allocate and zero a fresh destination inside every timed render; checksum and destination destruction outside timing.",
    "end-to-end": "Parse + record (Silk) / usvg retained tree + allocate/zero + render + intermediate-tree destruction. File I/O, PNG encoding, checksum and destination destruction excluded.",
}


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def workload_hash(paths):
    digest = hashlib.sha256()
    for path in sorted(paths, key=lambda item: item.name):
        name, data = path.name.encode(), path.read_bytes()
        digest.update(len(name).to_bytes(8, "big"))
        digest.update(name)
        digest.update(len(data).to_bytes(8, "big"))
        digest.update(data)
    return digest.hexdigest()


def callgrind_ir(text):
    events = None
    summary = None
    for line in text.splitlines():
        if line.startswith("events:"):
            events = line.split()[1:]
        elif line.startswith("summary:"):
            summary = line.split()[1:]
    if not events or "Ir" not in events or summary is None or len(events) != len(summary):
        raise ValueError("Callgrind output has no complete Ir summary")
    return int(summary[events.index("Ir")])


def baseline_ratios(current, baseline):
    for field in ("protocol", "config", "workloads"):
        if current[field] != baseline[field]:
            raise ValueError(f"baseline {field} differs; compare the same configuration and workload hashes or explicitly record a new baseline")
    for field in ("workload_manifest_sha256", "reference_pin"):
        if current.get(field) != baseline.get(field):
            raise ValueError(f"baseline {field} differs")
    ratios = {}
    for engine, values in current["results"].items():
        if engine not in baseline["results"] or set(values) != set(baseline["results"][engine]):
            raise ValueError(f"baseline stages differ for {engine}")
        ratios[engine] = {}
        for key, value in values.items():
            previous = baseline["results"][engine][key]["median_ns"]
            if previous <= 0:
                raise ValueError(f"baseline has nonpositive measured time for {engine}/{key}")
            ratios[engine][key] = value["median_ns"] / previous
    return ratios


def tool_version(command):
    try:
        completed = subprocess.run(command, capture_output=True, text=True, check=True, timeout=20)
        return (completed.stdout or completed.stderr).strip()
    except (OSError, subprocess.SubprocessError) as error:
        return f"unavailable: {error}"


def environment(binaries):
    versions = {
        "python": sys.version,
        "silk": tool_version([os.environ.get("SILK", "silk"), "--version"]),
        "rustc": tool_version([os.environ.get("RUSTC", "rustc"), "--version", "--verbose"]),
        "cargo": tool_version([os.environ.get("CARGO", "cargo"), "--version"]),
        "clang": tool_version([os.environ.get("SILK_CLANG", "clang"), "--version"]),
    }
    cpu = platform.processor()
    if sys.platform == "darwin":
        cpu = tool_version(["sysctl", "-n", "machdep.cpu.brand_string"])
    elif sys.platform.startswith("linux"):
        try:
            for line in Path("/proc/cpuinfo").read_text().splitlines():
                if line.startswith("model name"):
                    cpu = line.partition(":")[2].strip()
                    break
        except OSError:
            pass
    return {
        "platform": platform.platform(), "machine": platform.machine(), "cpu": cpu,
        "logical_cpus": os.cpu_count(), "tool_versions": versions,
        "build_environment": {key: os.environ[key] for key in ("SILK_CLANG", "RUSTFLAGS", "CARGO_ENCODED_RUSTFLAGS", "CARGO_TARGET_DIR") if key in os.environ},
        "binaries": {label: {"path": str(path), "sha256": sha256(path), "version": tool_version([str(path), "--version"])} for label, path in binaries.items()},
    }


def invoke(binary, mode, path, args, prefix=()):
    command = [*prefix, str(binary), mode, str(path), str(args.iterations), str(args.warmup)]
    start = time.perf_counter_ns()
    completed = subprocess.run(command, capture_output=True, text=True, timeout=args.timeout, check=True)
    wall = time.perf_counter_ns() - start
    result = json.loads(completed.stdout)
    for field, expected in (("protocol", 1), ("iterations", args.iterations), ("warmup", args.warmup)):
        if result.get(field) != expected:
            raise ValueError(f"{binary}: unexpected {field} in benchmark output")
    if not isinstance(result.get("elapsed_ns"), int) or result["elapsed_ns"] <= 0:
        raise ValueError(f"{binary}: no positive native stage measurement")
    if result.get("width", 0) <= 0 or result.get("height", 0) <= 0:
        raise ValueError(f"{binary}: no rendered image dimensions")
    checksum, consumed = int(result["checksum"]), int(result["consumed"])
    if not 0 <= checksum < 2**64 or consumed != (checksum * (args.iterations + args.warmup)) % 2**64:
        raise ValueError(f"{binary}: outputs changed within an invocation")
    return result, wall


def measure(args, binaries):
    manifest_path = HERE / "workloads.json"
    manifest = json.loads(manifest_path.read_text())
    if sha256(HERE / manifest["generator"]) != manifest["generator_sha256"]:
        raise ValueError("workload generator differs from its tracked manifest hash")
    paths = workloads.prepare(manifest, HERE / ".cache/workloads", args.fetch_workloads, args.workload)
    report = {
        "protocol": 1, "measured_at_utc": datetime.now(timezone.utc).isoformat(),
        "environment": environment(binaries),
        "config": {"iterations": args.iterations, "warmup": args.warmup, "samples": args.samples,
                   "modes": args.mode or list(MODES), "callgrind": args.callgrind,
                   "pixmap_policy": "fresh zeroed allocation per render, included in stage time",
                   "sample_unit": "one complete workload pass; sum per-file native times / iterations",
                   "timer": "native monotonic wall clock; Python perf_counter_ns separately records process wall time"},
        "stages": STAGES,
        "workload_manifest_sha256": sha256(manifest_path),
        "reference_pin": json.loads((ROOT / "images/svg/tests/suites.lock.json").read_text())["suites"]["resvg"]["revision"],
        "workloads": {name: {"sha256": workload_hash(files), "documents": len(files),
                              "bytes": sum(path.stat().st_size for path in files), "spec": manifest["workloads"][name]} for name, files in paths.items()},
        "results": {label: {} for label in binaries},
    }
    if "rust" in binaries and report["reference_pin"] not in report["environment"]["binaries"]["rust"]["version"]:
        raise ValueError("Rust benchmark --version does not identify the exact suites.lock.json resvg pin")
    if args.callgrind:
        if not sys.platform.startswith("linux") or not shutil.which("valgrind"):
            raise ValueError("--callgrind requires Linux and a working Valgrind/Callgrind installation for this architecture")
        report["environment"]["tool_versions"]["valgrind"] = tool_version(["valgrind", "--version"])
        report["callgrind_scope"] = "Full separate process invocation, including startup, file I/O, setup, warmup, checksum and untimed parse-result rasterization; Ir is NOT a stage-only counter. Wall-time samples above run without Valgrind."
    labels = list(binaries)
    for name, files in paths.items():
        for mode in report["config"]["modes"]:
            key = f"{name}/{mode}"
            measurements = {label: {"samples_ns": [], "process_wall_samples_ns": [], "outputs": {}} for label in labels}
            for sample in range(args.samples):
                for label in labels if sample % 2 == 0 else labels[::-1]:
                    elapsed = wall = 0
                    outputs = {}
                    for path in files:
                        result, process_wall = invoke(binaries[label], mode, path, args)
                        elapsed += result["elapsed_ns"]
                        wall += process_wall
                        outputs[path.name] = {field: result[field] for field in ("checksum", "width", "height")}
                    measured = measurements[label]
                    if sample and measured["outputs"] != outputs:
                        raise ValueError(f"{label} {key}: output checksum or dimensions changed between samples")
                    measured["outputs"] = outputs
                    measured["samples_ns"].append(elapsed / args.iterations)
                    measured["process_wall_samples_ns"].append(wall)
            for label, measured in measurements.items():
                measured["median_ns"] = statistics.median(measured["samples_ns"])
                measured["process_wall_median_ns"] = statistics.median(measured["process_wall_samples_ns"])
                if args.callgrind:
                    counts = []
                    for path in files:
                        with tempfile.TemporaryDirectory(prefix="svg-callgrind-") as directory:
                            output = Path(directory) / "callgrind.out"
                            invoke(binaries[label], mode, path, args, ["valgrind", "--tool=callgrind", "--error-exitcode=99", f"--callgrind-out-file={output}"])
                            counts.append(callgrind_ir(output.read_text()))
                    measured["callgrind_process_Ir"] = sum(counts)
                report["results"][label][key] = measured
                print(f"{label:>5} {key:<26} {measured['median_ns'] / 1e6:12.4f} ms/workload (median of {args.samples}, {args.iterations} iterations, {args.warmup} warmup)", file=sys.stderr)
    left, right = labels
    for key, value in report["results"][left].items():
        for filename, output in value["outputs"].items():
            other = report["results"][right][key]["outputs"][filename]
            if (output["width"], output["height"]) != (other["width"], other["height"]):
                raise ValueError(f"{key}/{filename}: output dimensions differ; refusing a ratio for unequal raster workloads")
    report["comparison"] = {
        "ratio_definition": f"{left}/{right} native median stage time; >1 means {left} slower",
        "ratios": {key: value["median_ns"] / report["results"][right][key]["median_ns"] for key, value in report["results"][left].items()},
        "checksum_equal": {key: value["outputs"] == report["results"][right][key]["outputs"] for key, value in report["results"][left].items()},
        "checksum_note": "FNV-1a over every premultiplied RGBA byte. Numerical rasterization differences are allowed; equality is not a pixel-conformance verdict.",
    }
    for key, ratio in report["comparison"]["ratios"].items():
        equal = report["comparison"]["checksum_equal"][key]
        print(f"{key:<26} {left}/{right}={ratio:.4f} checksum_equal={str(equal).lower()}", file=sys.stderr)
    return report


def options(parser):
    parser.add_argument("--iterations", type=int, default=3)
    parser.add_argument("--warmup", type=int, default=1)
    parser.add_argument("--samples", type=int, default=5)
    parser.add_argument("--mode", action="append", choices=MODES)
    parser.add_argument("--workload", action="append", choices=("iconset", "tiger", "largemap", "mixedcurves", "stylesheets", "instances", "paintservers", "compositing"))
    parser.add_argument("--fetch-workloads", action="store_true", help="explicitly fetch missing content-pinned, licensed Tiger")
    parser.add_argument("--callgrind", action="store_true", help="Linux only: separately collect full-process Ir, not stage-only instructions")
    parser.add_argument("--timeout", type=float, default=300, help="maximum seconds per native invocation")
    parser.add_argument("--output", type=Path, help="write measured report JSON (otherwise stdout)")


def validate(args, binaries):
    if not 1 <= args.iterations <= 100000 or not 0 <= args.warmup <= 10000 or not 1 <= args.samples <= 100:
        raise ValueError("iterations must be 1..100000, warmup 0..10000, samples 1..100")
    if not 0 < args.timeout <= 3600:
        raise ValueError("timeout must be >0 and <=3600 seconds")
    for label, binary in binaries.items():
        if not binary.is_file() or not os.access(binary, os.X_OK):
            raise ValueError(f"{label} executable missing or not executable: {binary}; build it explicitly first")


def emit(report, output):
    text = json.dumps(report, indent=2, sort_keys=True) + "\n"
    if output:
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(text)
    else:
        sys.stdout.write(text)


def bench_main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--silk", type=Path, required=True, help="release native images-svg-bench executable")
    parser.add_argument("--rust", type=Path, default=ROOT / "images/svg/scripts/rust-bench/target/release/svg-reference-bench")
    parser.add_argument("--baseline", type=Path, default=HERE / "baseline.json")
    parser.add_argument("--record-baseline", action="store_true", help="explicitly write actual measurements; default only compares")
    options(parser)
    args = parser.parse_args()
    try:
        if args.output and args.output.resolve() == args.baseline.resolve():
            raise ValueError("--output cannot overwrite the baseline; use --record-baseline")
        if not args.record_baseline and not args.baseline.is_file():
            raise ValueError("baseline missing; first run with --record-baseline to record real measurements")
        baseline = None if args.record_baseline else json.loads(args.baseline.read_text())
        binaries = {"silk": args.silk.resolve(), "rust": args.rust.resolve()}
        validate(args, binaries)
        report = measure(args, binaries)
        if baseline is not None:
            report["baseline_comparison"] = {"ratio_definition": "current/baseline; >1 is slower", "ratios": baseline_ratios(report, baseline),
                                               "environment_changed": report["environment"] != baseline["environment"]}
            for engine, values in report["baseline_comparison"]["ratios"].items():
                for key, ratio in values.items():
                    print(f"baseline {engine} {key}: current/previous={ratio:.4f}", file=sys.stderr)
        else:
            args.baseline.parent.mkdir(parents=True, exist_ok=True)
            args.baseline.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
            print(f"Recorded measured baseline: {args.baseline}", file=sys.stderr)
        emit(report, args.output)
    except (OSError, ValueError, KeyError, subprocess.SubprocessError) as error:
        parser.exit(1, f"bench: {error}\n")


def ab_main():
    parser = argparse.ArgumentParser(description="Compare two native SVG benchmark executables on identical generated/pinned workloads. Ratios are new/old; <1 is faster.")
    parser.add_argument("oldbinary", type=Path)
    parser.add_argument("newbinary", type=Path)
    options(parser)
    args = parser.parse_args()
    try:
        if args.output and args.output.resolve() == (HERE / "baseline.json").resolve():
            raise ValueError("ab cannot overwrite baseline.json; use bench --record-baseline")
        binaries = {"new": args.newbinary.resolve(), "old": args.oldbinary.resolve()}
        validate(args, binaries)
        emit(measure(args, binaries), args.output)
    except (OSError, ValueError, KeyError, subprocess.SubprocessError) as error:
        parser.exit(1, f"ab: {error}\n")
