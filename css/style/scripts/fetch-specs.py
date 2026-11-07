#!/usr/bin/env python3
"""Download and verify CSSOM, its companion drafts, and their normative references."""
import argparse
from html.parser import HTMLParser
from pathlib import Path
import runpy
from urllib.parse import urljoin, urldefrag

ROOT = Path(__file__).resolve().parents[3]
# Share the repository's content-addressed download/lock policy with SVG.
FETCH = runpy.run_path(str(ROOT / "svg/scripts/fetch-specs.py"))
LOCK = ROOT / "css/style/specs.lock.json"
CACHE = ROOT / "css/style/.cache/specs"
ROOTS = {
    "cssom": "https://drafts.csswg.org/cssom/",
    "cssom-view": "https://drafts.csswg.org/cssom-view/",
    "css-typed-om-1": "https://drafts.css-houdini.org/css-typed-om-1/",
}


class References(HTMLParser):
    """Read the normative bibliography, not every incidental link in a draft."""
    def __init__(self, base):
        super().__init__()
        self.base = base
        self.active = False
        self.name = None
        self.urls = {}

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        identifier = attrs.get("id", "")
        if identifier == "normative":
            self.active = True
        elif identifier in ("informative", "index", "idl-index"):
            self.active = False
        if not self.active:
            return
        if tag == "dt" and identifier.startswith("biblio-"):
            self.name = identifier[7:].lower()
        if tag == "a" and self.name and "href" in attrs:
            url = urldefrag(urljoin(self.base, attrs["href"]))[0]
            if url.startswith("https://") and self.name not in self.urls:
                self.urls[self.name] = url


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--update", action="store_true", help="review and pin a new complete baseline")
    parser.add_argument("--offline", action="store_true", help="verify every cached document without network access")
    args = parser.parse_args()
    if args.update and args.offline:
        parser.error("--update cannot be combined with --offline")
    try:
        if args.update:
            urls = dict(ROOTS)
            for name, url in ROOTS.items():
                resolved, body = FETCH["download"](url)
                references = References(resolved)
                references.feed(body.decode("utf-8"))
                if not references.urls:
                    raise FETCH["SpecError"](f"{name}: normative bibliography not found")
                for key, reference in references.urls.items():
                    # Each root keeps its bibliography identity; editions can differ.
                    urls[f"{name}--{key}"] = reference
        else:
            import json
            document = json.loads(LOCK.read_text(encoding="utf-8"))
            urls = {name: record["url"] for name, record in document["specs"].items()}
            if any(urls.get(name) != url for name, url in ROOTS.items()):
                raise FETCH["SpecError"]("CSSOM roots differ from lock; review --update")
        count = FETCH["synchronize"](LOCK, CACHE, urls, update=args.update, offline=args.offline)
    except (OSError, ValueError, KeyError, FETCH["SpecError"]) as error:
        parser.exit(1, f"specifications: {error}\n")
    print(f"{'Pinned' if args.update else 'Verified'} {count} specification records in {CACHE}")


if __name__ == "__main__":
    main()
