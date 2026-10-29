"""Pinned upstream test data. Downloading never means rendering or passing a test."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import shutil
import tarfile
import tempfile
import urllib.request

ROOT = Path(__file__).resolve().parents[3]
DEFAULT_LOCK = ROOT / "images/svg/tests/suites.lock.json"
DEFAULT_CACHE = ROOT / "images/svg/tests/.cache/suites"
MAX_DOWNLOAD = 512 * 1024 * 1024
MAX_MEMBER = 128 * 1024 * 1024
MAX_EXTRACTED = 2 * 1024 * 1024 * 1024


def relative_path(value):
    if not isinstance(value, str) or not value or "\\" in value or "\x00" in value:
        raise ValueError(f"unsafe relative path: {value!r}")
    path = PurePosixPath(value)
    if path.is_absolute() or any(p in ("", ".", "..") for p in value.split("/")):
        raise ValueError(f"unsafe relative path: {value!r}")
    return path


def contained(root, name):
    path = root.joinpath(*relative_path(name).parts)
    if not path.resolve().is_relative_to(root.resolve()):
        raise ValueError(f"path outside suite: {name}")
    return path


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def file_hash(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def fetch_bytes(url):
    if not isinstance(url, str) or not url.startswith("https://"):
        raise ValueError("suite URLs must use HTTPS")
    request = urllib.request.Request(url, headers={"User-Agent": "read-fonts-svg-suites/1"})
    with urllib.request.urlopen(request, timeout=120) as response:
        if not response.url.startswith("https://"):
            raise ValueError("suite redirect downgraded HTTPS")
        data = response.read(MAX_DOWNLOAD + 1)
    if len(data) > MAX_DOWNLOAD:
        raise ValueError("suite download exceeds size limit")
    return data


def download(record, cache, offline=False):
    digest = record["sha256"]
    if not re.fullmatch(r"[a-f0-9]{64}", digest):
        raise ValueError("invalid SHA-256 pin")
    cache.mkdir(parents=True, exist_ok=True)
    target = contained(cache, digest)
    if target.exists():
        if file_hash(target) != digest:
            raise ValueError(f"hash mismatch in cached download {target}; remove corrupted cache explicitly")
        return target
    if offline:
        raise ValueError(f"offline cache miss: {record['url']}")
    data = fetch_bytes(record["url"])
    if sha256(data) != digest:
        raise ValueError(f"hash mismatch for {record['url']}; use --update only after reviewing upstream")
    with tempfile.NamedTemporaryFile(dir=cache, delete=False) as stream:
        temporary = Path(stream.name)
        stream.write(data)
    temporary.replace(target)
    return target


def extract_archive(archive, destination, strip_prefix, include):
    if destination is not None:
        destination.mkdir(parents=True, exist_ok=True)
    hashes = {}
    total = 0
    with tarfile.open(archive, "r:*") as tar:
        for member in tar:
            name = member.name.rstrip("/")
            relative_path(name)
            if strip_prefix:
                if name == strip_prefix.rstrip("/"):
                    continue
                if not name.startswith(strip_prefix):
                    raise ValueError(f"archive member outside pinned prefix: {name}")
                name = name[len(strip_prefix):]
            if not any(not prefix or name == prefix.rstrip("/") or name.startswith(prefix.rstrip("/") + "/") for prefix in include):
                continue
            if member.isdir():
                continue
            if not member.isfile():
                raise ValueError(f"archive links/special files are forbidden: {name}")
            if name in hashes:
                raise ValueError(f"duplicate archive member: {name}")
            total += member.size
            if member.size > MAX_MEMBER or total > MAX_EXTRACTED:
                raise ValueError("archive exceeds extraction size limit")
            digest = hashlib.sha256()
            with tar.extractfile(member) as source:
                if destination is None:
                    for chunk in iter(lambda: source.read(1024 * 1024), b""):
                        digest.update(chunk)
                else:
                    target = contained(destination, name)
                    target.parent.mkdir(parents=True, exist_ok=True)
                    with target.open("wb") as output:
                        for chunk in iter(lambda: source.read(1024 * 1024), b""):
                            digest.update(chunk)
                            output.write(chunk)
            hashes[name] = digest.hexdigest()
    return hashes


def load_lock(path):
    lock = json.loads(path.read_text())
    if lock.get("version") != 1 or set(lock.get("suites", {})) != {"resvg", "w3c-svg11", "wpt"}:
        raise ValueError("unsupported or incomplete suite lock")
    for name, suite in lock["suites"].items():
        if name != "w3c-svg11" and not re.fullmatch(r"[0-9a-f]{40}", suite["revision"]):
            raise ValueError(f"{name}: revision must be a full commit SHA")
        for record in [suite["archive"]] + [f for case in suite.get("curated", []) for f in case["files"]]:
            if not re.fullmatch(r"[0-9a-f]{64}", record["sha256"]) or not record["url"].startswith("https://"):
                raise ValueError(f"{name}: invalid download pin")
            if "path" in record:
                relative_path(record["path"])
        if name == "resvg" and not 0 < len(suite["curated"]) <= 200:
            raise ValueError("resvg curated subset must contain 1–200 cases")
    return lock


def suite_directory(cache, suite, full):
    return cache / suite["archive"]["sha256"] / ("full" if full else "curated")


def verify_receipt(root, receipt):
    for name, digest in receipt["files"].items():
        path = contained(root, name)
        if not path.is_file() or file_hash(path) != digest:
            raise ValueError(f"hash mismatch for extracted resource {name}")


def fetch_suite(lock, name, cache, full=False, offline=False):
    suite = lock["suites"][name]
    if name != "resvg" and not full:
        raise ValueError(f"{name} has no curated subset; use --full explicitly")
    target = suite_directory(cache, suite, full)
    receipt_path = target / ".receipt.json"
    pin = sha256(json.dumps(suite, sort_keys=True).encode())
    if receipt_path.exists():
        receipt = json.loads(receipt_path.read_text())
        if receipt.get("pin") != pin:
            raise ValueError("suite receipt does not match lock; remove stale extracted cache explicitly")
        # Rehash the source cache as well as every extracted input/reference/resource.
        records = [suite["archive"]] if full else [f for c in suite["curated"] for f in c["files"]]
        for record in records:
            download(record, cache / "downloads", offline)
        if full:
            archive = cache / "downloads" / suite["archive"]["sha256"]
            expected = extract_archive(archive, None, suite["strip_prefix"], suite["include"])
        else:
            expected = {record["path"]: record["sha256"] for record in records}
        if receipt.get("files") != expected:
            raise ValueError("suite receipt inventory differs from pinned source inventory")
        verify_receipt(target, receipt)
        return target
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=target.parent) as tmp:
        staging = Path(tmp) / "suite"
        staging.mkdir()
        if full:
            archive = download(suite["archive"], cache / "downloads", offline)
            hashes = extract_archive(archive, staging, suite["strip_prefix"], suite["include"])
        else:
            hashes = {}
            for case in suite["curated"]:
                for record in case["files"]:
                    source = download(record, cache / "downloads", offline)
                    destination = contained(staging, record["path"])
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copyfile(source, destination)
                    hashes[record["path"]] = record["sha256"]
        (staging / ".receipt.json").write_text(json.dumps({"pin": pin, "suite": name, "files": hashes}, indent=2) + "\n")
        if target.exists():
            raise ValueError(f"incomplete cache exists at {target}; remove it explicitly")
        staging.replace(target)
    return target


def update_suite(lock, name, revision):
    suite = lock["suites"][name]
    if name != "w3c-svg11":
        if not revision or not re.fullmatch(r"[a-f0-9]{40}", revision):
            raise ValueError("--update requires --revision with a reviewed full commit SHA")
        old = suite["revision"]
        suite["revision"] = revision
        suite["strip_prefix"] = suite["strip_prefix"].replace(old, revision)
        for record in [suite["archive"]] + [f for c in suite.get("curated", []) for f in c["files"]]:
            record["url"] = record["url"].replace(old, revision)
    elif revision:
        raise ValueError("W3C suite is the dated 20110816 release, not a git revision")
    for record in [suite["archive"]] + [f for c in suite.get("curated", []) for f in c["files"]]:
        data = fetch_bytes(record["url"])
        record["sha256"] = sha256(data)
        record["bytes"] = len(data)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--lock", type=Path, default=DEFAULT_LOCK)
    parser.add_argument("--cache-dir", type=Path, default=DEFAULT_CACHE)
    parser.add_argument("--suite", choices=("resvg", "w3c-svg11", "wpt"), default="resvg")
    parser.add_argument("--full", action="store_true", help="explicitly download the full pinned archive")
    parser.add_argument("--offline", action="store_true", help="use verified cached bytes only")
    parser.add_argument("--update", action="store_true", help="explicitly replace reviewed pins in the lock; does not render")
    parser.add_argument("--revision", help="full reviewed git SHA, only with --update")
    args = parser.parse_args(argv)
    try:
        lock = load_lock(args.lock)
        if args.revision and not args.update:
            raise ValueError("--revision requires --update")
        if args.update and args.offline:
            raise ValueError("--update cannot be used offline")
        if args.update:
            update_suite(lock, args.suite, args.revision)
            args.lock.write_text(json.dumps(lock, indent=2) + "\n")
            print(f"Updated {args.suite} pins; review lock and expectations before committing.")
        else:
            print(fetch_suite(lock, args.suite, args.cache_dir, args.full, args.offline))
        return 0
    except (ValueError, OSError, KeyError, tarfile.TarError) as error:
        parser.exit(1, f"fetch-suites: {error}\n")
