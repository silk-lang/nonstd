#!/usr/bin/env python3
"""Fetch or verify the SVG normative baseline; only --update changes the lock."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
import urllib.request


ROOT = Path(__file__).resolve().parents[3]
LOCK = ROOT / "images/svg/specs.lock.json"
CACHE = ROOT / "images/svg/.cache/specs"
SVG11 = "https://www.w3.org/TR/2011/REC-SVG11-20110816/"
SVG2 = "https://www.w3.org/TR/2018/CR-SVG2-20181004/"
SVG2_ED = "https://svgwg.org/svg2-draft/"
CSS21 = "https://www.w3.org/TR/2011/REC-CSS2-20110607/"
SVG11_CHAPTERS = (
    "intro concepts render types struct styling coords paths shapes text painting "
    "color pservers masking filters interact linking script animate fonts metadata "
    "backward extend svgdom implnote conform access feature changes refs"
).split()
SVG2_CHAPTERS = (
    "intro conform render types struct styling geometry coords paths shapes text "
    "embedded painting pservers interact linking animate implnote access changes refs"
).split()
CSS21_CHAPTERS = (
    "intro conform syndata selector cascade media box visuren visudet visufx "
    "generate page colors fonts text tables ui grammar sample changes"
).split()
URLS = {
    "svg11": SVG11,
    "svg11-errata": "https://www.w3.org/2011/08/REC-SVG11-20110816-errata",
    "svg2": SVG2,
    "svg2-ed": SVG2_ED,
    "css21": CSS21,
    **{f"svg11-{name}": SVG11 + name + ".html" for name in SVG11_CHAPTERS},
    **{f"svg2-{name}": SVG2 + name + ".html" for name in SVG2_CHAPTERS},
    **{f"svg2-ed-{name}": SVG2_ED + name + ".html" for name in SVG2_CHAPTERS},
    **{f"css21-{name}": CSS21 + name + ".html" for name in CSS21_CHAPTERS},
    **{name: f"https://www.w3.org/TR/{name}/" for name in (
        "filter-effects-1 css-masking-1 compositing-1 css-transforms-1 "
        "css-syntax-3 css-cascade-4 selectors-4 css-namespaces-3 mediaqueries-4 mediaqueries-5 "
        "css-conditional-3 css-variables-1 css-values-3 css-values-4 css-color-4 "
        "css-images-3 css-fonts-4 css-text-3 css-text-4 cssom css-text-decor-3 css-writing-modes-3 "
        "css-inline-3 css-shapes-1 css-animations-1 svg-integration xml xml-names "
        "xmlbase xml-stylesheet xlink11 png-3"
    ).split()},
    "css-transforms-2": "https://drafts.csswg.org/css-transforms-2/",
    "css-shadow-1": "https://drafts.csswg.org/css-shadow-1/",
    "css-values-4-ed": "https://drafts.csswg.org/css-values-4/",
    "encoding": "https://encoding.spec.whatwg.org/",
    "unicode-uts46": "https://www.unicode.org/reports/tr46/",
    "css-conditional-3-2022": "https://www.w3.org/TR/2022/CR-css-conditional-3-20220113/",
    "smil-animation": "https://www.w3.org/TR/2001/REC-smil-animation-20010904/",
    "smil-content": "https://www.w3.org/TR/REC-smil/smil-content.html",
    "media-frags": "https://www.w3.org/TR/2012/REC-media-frags-20120925/",
    "svg-animations-2": "https://svgwg.org/specs/animations/",
    **{f"unicode-uax{number}": f"https://www.unicode.org/reports/tr{number}/"
       for number in (9, 14, 24, 29, 50)},
    **{f"rfc{number}": f"https://www.rfc-editor.org/rfc/rfc{number}.html"
       for number in (2397, 1950, 1951, 1952, 3492, 5892, 5893)},
    "url": "https://url.spec.whatwg.org/",
    "jpeg-t81": "https://www.w3.org/Graphics/JPEG/itu-t81.pdf",
    "jpeg-jfif": "https://www.w3.org/Graphics/JPEG/jfif3.pdf",
    "icc-embedding": "https://archive.color.org/files/technotes/ICC-Technote-ProfileEmbedding.pdf",
    "icc-v4": "https://www.color.org/specification/ICC.1-2022-05.pdf",
}


class SpecError(Exception):
    """The baseline cannot be established or verified safely."""


def digest(body):
    return hashlib.sha256(body).hexdigest()


def cache_path(cache, record):
    # Content addressing preserves the previous baseline through failed updates.
    return cache / record["sha256"]


def atomic_write(path, body):
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=".download-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as output:
            output.write(body)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def download(url):
    request = urllib.request.Request(url, headers={"User-Agent": "read-fonts-svg-specs/1.0"})
    with urllib.request.urlopen(request, timeout=90) as response:
        resolved, body = response.geturl(), response.read()
    if not resolved.startswith("https://"):
        raise SpecError(f"insecure redirect from {url} to {resolved}")
    if not body:
        raise SpecError(f"empty document: {url}")
    return resolved, body


def load_lock(path, urls):
    if not path.exists():
        raise SpecError("missing lock; use --update to establish the baseline")
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (ValueError, OSError) as error:
        raise SpecError(f"cannot read lock: {error}") from error
    if not isinstance(document, dict) or document.get("format") != 1:
        raise SpecError("unsupported specification lock format")
    records = document.get("specs")
    if not isinstance(records, dict) or set(records) != set(urls):
        raise SpecError("specification catalog differs from lock; review --update")
    for name, record in records.items():
        if not isinstance(record, dict):
            raise SpecError(f"{name}: invalid lock record")
        if not isinstance(record.get("sha256"), str) or not re.fullmatch(r"[0-9a-f]{64}", record["sha256"]):
            raise SpecError(f"{name}: invalid SHA-256 in lock")
        if record.get("url") != urls[name]:
            raise SpecError(f"{name}: catalog URL changed; review --update")
        if not isinstance(record.get("resolved"), str) or not record["resolved"].startswith("https://"):
            raise SpecError(f"{name}: invalid resolved URL in lock")
    return records


def synchronize(lock, cache, urls, *, update=False, offline=False, only=None):
    if update and offline:
        raise SpecError("--update cannot be combined with --offline")
    if update and only:
        raise SpecError("--update cannot be combined with --only; review the complete baseline")
    selected = set(urls) if only is None else set(only)
    unknown = selected - set(urls)
    if unknown:
        raise SpecError("unknown specification IDs: " + ", ".join(sorted(unknown)))
    records = {} if update else load_lock(lock, urls)

    def process(name):
        url = urls[name]
        if not update:
            record = records[name]
            cached = cache_path(cache, record)
            if cached.exists():
                if digest(cached.read_bytes()) != record["sha256"]:
                    raise SpecError(f"{name}: cached SHA-256 mismatch; remove corrupt cache explicitly")
                return name, record
            if offline:
                raise SpecError(f"{name}: missing cache in offline mode")
        resolved, body = download(url)
        actual = digest(body)
        if not update and actual != record["sha256"]:
            raise SpecError(f"{name}: upstream SHA-256 changed; inspect before --update")
        if update:
            record = {"url": url, "resolved": resolved, "sha256": actual}
        atomic_write(cache_path(cache, record), body)
        return name, record

    failures = []
    with ThreadPoolExecutor(max_workers=6) as pool:
        pending = [(name, pool.submit(process, name)) for name in sorted(selected)]
        for name, future in pending:
            try:
                key, record = future.result()
                records[key] = record
            except (OSError, ValueError, SpecError) as error:
                failures.append(f"{name}: {error}")
    if failures:
        raise SpecError("\n".join(failures))
    if update:
        body = json.dumps({"format": 1, "specs": dict(sorted(records.items()))}, indent=2) + "\n"
        atomic_write(lock, body.encode("utf-8"))
    return len(selected)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--update", action="store_true", help="explicitly fetch and replace the complete baseline")
    parser.add_argument("--offline", action="store_true", help="verify cached bytes without network access")
    parser.add_argument("--only", nargs="+", metavar="ID", help="verify only these locked specification IDs")
    parser.add_argument("--lock", type=Path, default=LOCK)
    parser.add_argument("--cache", type=Path, default=CACHE)
    args = parser.parse_args()
    try:
        count = synchronize(args.lock, args.cache, URLS, update=args.update, offline=args.offline, only=args.only)
    except (SpecError, OSError) as error:
        parser.exit(1, f"specifications: {error}\n")
    print(f"{'Pinned' if args.update else 'Verified'} {count} specifications in {args.cache}")


if __name__ == "__main__":
    main()
