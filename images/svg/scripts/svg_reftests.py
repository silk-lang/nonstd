"""PNG and standalone SVG reftests. A caller supplies the real renderer; none is bundled."""
import argparse
from html.parser import HTMLParser
import json
from pathlib import Path
import subprocess
import tempfile
from urllib.parse import unquote, urlsplit
import warnings
import xml.etree.ElementTree as ET

from svg_suites import DEFAULT_CACHE, DEFAULT_LOCK, ROOT, contained, fetch_suite, load_lock

WPT_AREAS = ("svg", "css/filter-effects", "css/css-masking", "css/compositing", "css/css-transforms")
STATUSES = {"pass", "fail", "spec-difference", "skip"}
SVG_NAMESPACE = "http://www.w3.org/2000/svg"
OWN_FIXTURES = ROOT / "images/svg/tests/fixtures"


def validate_expectation(entry):
    if not isinstance(entry.get("id"), str) or not entry["id"]:
        raise ValueError("expectation requires a nonempty id")
    if entry.get("status") not in STATUSES:
        raise ValueError(f"{entry['id']}: unknown expectation status")
    for field in ("reason", "spec"):
        if not isinstance(entry.get(field), str) or not entry[field].strip():
            raise ValueError(f"{entry['id']}: missing {field}")
    if not entry["spec"].startswith("https://") or not urlsplit(entry["spec"]).fragment:
        raise ValueError(f"{entry['id']}: spec must be an HTTPS normative #anchor citation")
    if entry["status"] == "spec-difference":
        for field in ("spec_result", "reference_result"):
            if not isinstance(entry.get(field), str) or not entry[field].strip():
                raise ValueError(f"{entry['id']}: spec difference requires {field}")
    tolerance = entry.get("tolerance", {})
    if not isinstance(tolerance, dict) or set(tolerance) - {"channel", "pixels", "antialias_channel", "reason"}:
        raise ValueError(f"{entry['id']}: invalid tolerance")
    for field, maximum in (("channel", 255), ("antialias_channel", 255), ("pixels", 100000000)):
        value = tolerance.get(field, 0)
        if type(value) is not int or not 0 <= value <= maximum:
            raise ValueError(f"{entry['id']}: invalid {field} tolerance")
    if tolerance and not str(tolerance.get("reason", "")).strip():
        raise ValueError(f"{entry['id']}: tolerance needs a reason")


def load_expectations(path, suite):
    data = json.loads(path.read_text())
    if data.get("version") != 1 or data.get("suite") != suite:
        raise ValueError("expectation version/suite mismatch")
    result = {}
    for entry in data["cases"]:
        validate_expectation(entry)
        if entry["id"] in result:
            raise ValueError(f"duplicate expectation: {entry['id']}")
        result[entry["id"]] = entry
    return result


def load_own_manifest(path, malformed=False):
    """Validate tracked coverage without importing Pillow or invoking a renderer."""
    data = json.loads(path.read_text())
    mode = "malformed" if malformed else "reference"
    if not isinstance(data, dict) or data.get("version") != 1 or data.get("suite") != "own" or data.get("mode") != mode:
        raise ValueError("own manifest version/suite/mode mismatch")
    cases = data.get("cases")
    if not isinstance(cases, list) or not cases:
        raise ValueError("own manifest requires nonempty cases")
    root = path.parent.resolve()
    expectations = {}
    files = set()
    inputs = set()
    for entry in cases:
        if not isinstance(entry, dict):
            raise ValueError("own case must be an object")
        validate_expectation(entry)
        contained(root, entry["id"])
        if entry["status"] != "pass":
            raise ValueError(f"{entry['id']}: own cases must have status pass")
        if entry["id"] in expectations:
            raise ValueError(f"duplicate own case: {entry['id']}")
        expectations[entry["id"]] = entry
        source = entry.get("input")
        input_path = contained(root, source)
        if input_path.suffix != ".svg":
            raise ValueError(f"{entry['id']}: input must be SVG")
        if source in inputs:
            raise ValueError(f"duplicate own input: {source}")
        inputs.add(source)
        references = entry.get("references", [])
        if not isinstance(references, list):
            raise ValueError(f"{entry['id']}: references must be an array")
        if malformed:
            code = entry.get("exit_code")
            presence = entry.get("output_present")
            if type(code) is not int or code not in (0, 1) or type(presence) is not bool or presence != (code == 0):
                raise ValueError(f"{entry['id']}: malformed contract requires exit 1 without output or exit 0 with output")
            if code == 1 and references:
                raise ValueError(f"{entry['id']}: rejected input cannot have references")
            needs_reference = code == 0
        else:
            needs_reference = True
        if needs_reference and not references:
            raise ValueError(f"{entry['id']}: missing references")
        names = [source]
        for reference in references:
            if not isinstance(reference, dict) or reference.get("relation") not in ("==", "!="):
                raise ValueError(f"{entry['id']}: invalid reference")
            ref_path = contained(root, reference.get("path"))
            if ref_path.suffix not in (".svg", ".png"):
                raise ValueError(f"{entry['id']}: reference must be SVG or PNG")
            if ref_path.resolve() == input_path.resolve():
                raise ValueError(f"{entry['id']}: input cannot reference itself")
            names.append(reference["path"])
        for name in names:
            if not contained(root, name).is_file():
                raise ValueError(f"{entry['id']}: missing fixture {name}")
            files.add(name)
    discovered = {item.relative_to(root).as_posix() for item in root.rglob("*") if item.suffix in (".svg", ".png") and item.is_file()}
    unlisted = sorted(discovered - files)
    if unlisted:
        raise ValueError(f"unlisted own fixtures: {', '.join(unlisted[:10])}")
    return root, cases, expectations


def read_png(path):
    try:
        from PIL import Image
    except ImportError as error:
        raise ValueError("PNG comparison requires: python3 -m pip install -r images/svg/scripts/requirements.txt") from error
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(path) as image:
                if image.format != "PNG":
                    raise ValueError(f"renderer output is not PNG: {path}")
                if image.width * image.height > 16000000:
                    raise ValueError("PNG exceeds 16 million pixel comparison limit")
                image.seek(0)
                rgba = image.convert("RGBA")
                return rgba.width, rgba.height, rgba.tobytes()
    except (Image.DecompressionBombError, Image.DecompressionBombWarning) as error:
        raise ValueError("PNG exceeds safe decoder dimensions") from error


def compare_rgba(actual, reference, channel=0, pixels=0, antialias_channel=0):
    aw, ah, a = actual
    bw, bh, b = reference
    if len(a) != aw * ah * 4 or len(b) != bw * bh * 4:
        raise ValueError("invalid RGBA buffer length")
    if (aw, ah) != (bw, bh):
        return {"match": False, "reason": "image dimensions differ", "actual_size": [aw, ah], "reference_size": [bw, bh]}
    different = 0
    maximum = 0
    for offset in range(0, len(a), 4):
        delta = max(abs(a[offset + c] - b[offset + c]) for c in range(4))
        maximum = max(maximum, delta)
        # Opt-in only for known opaque geometry: both samples must be partially
        # covered. Exact opaque/transparent interiors keep the ordinary tolerance.
        partial = 0 < a[offset + 3] < 255 and 0 < b[offset + 3] < 255
        allowed = max(channel, antialias_channel) if partial else channel
        different += delta > allowed
    return {"match": different <= pixels, "different_pixels": different, "max_channel_difference": maximum,
            "channel_tolerance": channel, "antialias_channel_tolerance": antialias_channel, "pixel_tolerance": pixels}


def outcome(expected, matched):
    if expected == "pass":
        return "pass" if matched else "unexpected-fail"
    if expected in ("fail", "spec-difference"):
        return "unexpected-pass" if matched else expected
    raise ValueError("skip cases must not be compared")


def renderer_argv(command, input_path, output_path):
    if not isinstance(command, list) or not command or any(not isinstance(arg, str) for arg in command):
        raise ValueError("--renderer must be a JSON array of argv strings")
    if not any("{input}" in arg for arg in command) or not any("{output}" in arg for arg in command):
        raise ValueError("renderer argv requires {input} and {output} placeholders")
    return [arg.replace("{input}", str(input_path)).replace("{output}", str(output_path)) for arg in command]


class Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.references = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag.rsplit(":", 1)[-1] == "link" and attrs.get("rel") in ("match", "mismatch"):
            self.references.append((attrs.get("href", ""), attrs["rel"]))


def svg_document(path):
    data = path.read_bytes()
    if b"<!DOCTYPE" in data.upper() or b"<!ENTITY" in data.upper():
        raise ValueError("DTD/entity-dependent WPT needs manual adaptation")
    document = ET.fromstring(data)
    if document.tag != "{" + SVG_NAMESPACE + "}svg":
        raise ValueError("HTML layout or non-SVG document required")
    for element in document.iter():
        local = element.tag.rsplit("}", 1)[-1]
        if local == "script" or any(key.rsplit("}", 1)[-1].startswith("on") for key in element.attrib):
            raise ValueError("script or event handler required")
        if local == "foreignObject":
            raise ValueError("foreignObject HTML layout requires manual adaptation")
        if "reftest-wait" in element.get("class", "").split():
            raise ValueError("script-driven reftest-wait required")
    return document


def wpt_cases(root):
    cases = []
    for path in sorted(root.rglob("*")):
        if path.suffix not in (".svg", ".html", ".xhtml", ".htm") or not path.is_file():
            continue
        name = path.relative_to(root).as_posix()
        # When passed a full WPT tree, restrict tests, but leave resources accessible.
        if (root / "svg").exists() and not any(name.startswith(area + "/") for area in WPT_AREAS):
            continue
        links = Links()
        links.feed(path.read_text(errors="replace"))
        if not links.references:
            continue
        case = {"id": name, "input": name, "references": []}
        try:
            if path.suffix != ".svg":
                raise ValueError("HTML layout required; not a standalone SVG reftest")
            svg_document(path)
            for href, relation in links.references:
                url = urlsplit(href)
                if url.scheme or url.netloc or url.query or url.fragment:
                    raise ValueError("external/query/fragment reference needs manual adaptation")
                decoded = unquote(url.path)
                if "\\" in decoded or not decoded:
                    raise ValueError("invalid reference path")
                reference = (root / decoded.lstrip("/") if decoded.startswith("/") else path.parent / decoded).resolve()
                if not reference.is_relative_to(root.resolve()):
                    raise ValueError("reference outside suite root")
                if reference.suffix != ".svg":
                    raise ValueError("reference requires HTML layout rather than standalone SVG")
                if not reference.is_file():
                    raise ValueError("reference resource absent from fetched scope")
                svg_document(reference)
                case["references"].append({"path": reference.relative_to(root.resolve()).as_posix(), "relation": "==" if relation == "match" else "!="})
        except (ValueError, OSError, ET.ParseError) as error:
            case["skip_reason"] = str(error)
        cases.append(case)
    return cases


def discover_cases(root, suite, lock, full):
    if suite == "wpt":
        return wpt_cases(root)
    if suite == "resvg" and not full:
        return [{"id": case["id"], "input": case["files"][0]["path"], "references": [{"path": case["files"][1]["path"], "relation": "=="}]} for case in lock["suites"][suite]["curated"]]
    source = root / ("crates/resvg/tests/tests" if suite == "resvg" else "svg")
    cases = []
    for path in sorted(source.rglob("*.svg")):
        relative = path.relative_to(source)
        reference = path.with_suffix(".png") if suite == "resvg" else root / "png" / relative.with_suffix(".png")
        case = {"id": relative.with_suffix("").as_posix(), "input": path.relative_to(root).as_posix(), "references": [{"path": reference.relative_to(root).as_posix(), "relation": "=="}]}
        if not reference.is_file():
            case["skip_reason"] = "upstream provides no PNG reference; manual pass-criteria adaptation required"
        cases.append(case)
    return cases


def render(command, source, output, timeout):
    process = subprocess.run(renderer_argv(command, source.resolve(), output.resolve()), timeout=timeout, capture_output=True, text=True)
    if process.returncode:
        raise ValueError(f"renderer exited {process.returncode}: {process.stderr[-2000:]}")
    if not output.is_file():
        raise ValueError("renderer did not produce its requested PNG")
    return read_png(output)


def write_diff(actual, reference, path):
    from PIL import Image
    if actual[:2] != reference[:2]:
        return
    data = bytearray(len(actual[2]))
    for offset in range(0, len(data), 4):
        for c in range(3):
            data[offset + c] = abs(actual[2][offset + c] - reference[2][offset + c])
        data[offset + 3] = 255
        if actual[2][offset + 3] != reference[2][offset + 3]:
            data[offset:offset + 3] = bytes([255, 0, 255])
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.frombytes("RGBA", actual[:2], bytes(data)).save(path)


def run_case(case, expectation, root, command, timeout, diff_dir=None):
    result = {"id": case["id"], "expected": expectation["status"], "reason": expectation["reason"], "spec": expectation["spec"], "rendered": False}
    if expectation["status"] == "skip":
        return dict(result, outcome="skip")
    if case.get("skip_reason"):
        return dict(result, outcome="error", detail=case["skip_reason"])
    tolerance = expectation.get("tolerance", {})
    comparisons = []
    try:
        with tempfile.TemporaryDirectory(prefix="svg-reftest-") as temporary:
            tmp = Path(temporary)
            actual = render(command, contained(root, case["input"]), tmp / "actual.png", timeout)
            result["rendered"] = True
            pairs = []
            for index, ref in enumerate(case["references"]):
                path = contained(root, ref["path"])
                reference = read_png(path) if path.suffix == ".png" else render(command, path, tmp / f"reference-{index}.png", timeout)
                comparison = compare_rgba(actual, reference, tolerance.get("channel", 0),
                                          tolerance.get("pixels", 0), tolerance.get("antialias_channel", 0))
                comparison.update(reference=ref["path"], relation=ref["relation"])
                comparisons.append(comparison)
                pairs.append(reference)
            equal = [r["match"] for r in comparisons if r["relation"] == "=="]
            unequal = [not r["match"] for r in comparisons if r["relation"] == "!="]
            # WPT: one matching alternative is sufficient; every mismatch must differ.
            matched = (any(equal) if equal else True) and all(unequal)
            if not comparisons:
                raise ValueError("case has no references")
            result["outcome"] = outcome(expectation["status"], matched)
            result["comparisons"] = comparisons
            if diff_dir and result["outcome"] == "unexpected-fail":
                for index, reference in enumerate(pairs):
                    if not comparisons[index]["match"]:
                        target = contained(diff_dir, case["id"] + f"-{index}.png")
                        write_diff(actual, reference, target)
    except (OSError, ValueError, subprocess.TimeoutExpired) as error:
        result.update(outcome="error", detail=str(error))
    return result


def run_malformed_case(case, root, command, timeout, diff_dir=None):
    if case["exit_code"] == 0:
        # Successful prefix recovery must produce the specified pixels, not just a file.
        result = run_case(case, case, root, command, timeout, diff_dir)
        result.update(expected_exit_code=0, expected_output_present=True)
        return result
    result = {"id": case["id"], "expected": "pass", "reason": case["reason"], "spec": case["spec"], "rendered": False,
              "expected_exit_code": 1, "expected_output_present": False}
    try:
        with tempfile.TemporaryDirectory(prefix="svg-malformed-") as temporary:
            output = Path(temporary) / "actual.png"
            process = subprocess.run(renderer_argv(command, contained(root, case["input"]).resolve(), output.resolve()),
                                     timeout=timeout, capture_output=True, text=True)
            result.update(exit_code=process.returncode, output_present=output.exists(), stderr=process.stderr[-2000:])
            result["outcome"] = "pass" if process.returncode == 1 and not output.exists() else "error"
            if result["outcome"] == "error":
                result["detail"] = "expected CLI rejection (exit 1, no output); crashes and other exits are not rejection"
    except (OSError, ValueError, subprocess.TimeoutExpired) as error:
        result.update(outcome="error", detail=str(error))
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--suite", choices=("own", "resvg", "w3c-svg11", "wpt"), default="resvg")
    parser.add_argument("--lock", type=Path, default=DEFAULT_LOCK)
    parser.add_argument("--cache-dir", type=Path, default=DEFAULT_CACHE)
    parser.add_argument("--full", action="store_true")
    parser.add_argument("--expectations", type=Path)
    parser.add_argument("--manifest", type=Path, help="own-suite manifest; defaults to tracked fixtures")
    parser.add_argument("--malformed", action="store_true", help="own-suite CLI rejection and path-prefix recovery smoke cases")
    parser.add_argument("--validate", action="store_true", help="check cached integrity, coverage and expectation schema; render nothing")
    parser.add_argument("--renderer", help='JSON argv, e.g. ["renderer", "{input}", "-o", "{output}"]')
    parser.add_argument("--timeout", type=float, default=30)
    parser.add_argument("--report", type=Path, help="write machine-readable JSON report outside source control")
    parser.add_argument("--diff-dir", type=Path, help="opt-in local/scheduled unexpected-failure images")
    args = parser.parse_args(argv)
    try:
        if args.timeout <= 0:
            raise ValueError("timeout must be positive")
        if args.suite != "own" and (args.manifest or args.malformed):
            raise ValueError("--manifest and --malformed require --suite own")
        if args.suite == "own" and (args.expectations or args.full):
            raise ValueError("own suite uses its manifest, not --expectations or --full")
        command = json.loads(args.renderer) if args.renderer else None
        if not args.validate:
            renderer_argv(command, Path("input.svg"), Path("output.png"))
        if args.suite == "own":
            manifest = args.manifest or OWN_FIXTURES / ("malformed" if args.malformed else "own") / "manifest.json"
            root, cases, expectations = load_own_manifest(manifest, args.malformed)
        else:
            lock = load_lock(args.lock)
            # Runner never downloads implicitly. Fetching is a separate reviewed step.
            root = fetch_suite(lock, args.suite, args.cache_dir, args.full, offline=True)
            expectations = load_expectations(args.expectations or ROOT / "images/svg/tests/expectations" / (args.suite + ".txt"), args.suite)
            cases = discover_cases(root, args.suite, lock, args.full)
        if not cases:
            raise ValueError("no reftest cases discovered")
        ids = {case["id"] for case in cases}
        stale = sorted(set(expectations) - ids)
        if stale:
            raise ValueError(f"expectations name absent cases: {', '.join(stale[:10])}")
        results = []
        for case in cases:
            expectation = expectations.get(case["id"])
            if expectation is None:
                results.append({"id": case["id"], "outcome": "untriaged", "rendered": False, "reason": case.get("skip_reason", "no reviewed expectation; rendering/conformance not evaluated")})
                continue
            if args.validate:
                results.append({"id": case["id"], "outcome": "validated", "expected": expectation["status"], "rendered": False, "reason": expectation["reason"]})
            elif args.malformed:
                results.append(run_malformed_case(case, root, command, args.timeout, args.diff_dir))
            else:
                results.append(run_case(case, expectation, root, command, args.timeout, args.diff_dir))
        failures = ("unexpected-pass", "unexpected-fail", "error", "untriaged")
        report = {"suite": args.suite, "mode": "validate-only" if args.validate else ("malformed" if args.malformed else "render"),
                  "rendered_cases": sum(r["rendered"] for r in results),
                  "passed_cases": sum(r["outcome"] == "pass" for r in results),
                  "failed_cases": sum(r["outcome"] in ("fail", "unexpected-fail", "error") for r in results),
                  "gate_failures": sum(r["outcome"] in failures for r in results), "results": results}
        text = json.dumps(report, indent=2) + "\n"
        if args.report:
            args.report.parent.mkdir(parents=True, exist_ok=True)
            args.report.write_text(text)
        print(text, end="")
        return int(any(r["outcome"] in failures for r in results))
    except (OSError, ValueError, KeyError) as error:
        parser.exit(1, f"reftests: {error}\n")
