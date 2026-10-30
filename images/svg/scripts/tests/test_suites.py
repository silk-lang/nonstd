"""Suite provenance/security gates; no renderer is invoked by these tests."""
import hashlib
import json
from pathlib import Path
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import svg_suites as suites

class SuiteTests(unittest.TestCase):
    def test_cached_bytes_are_rehashed_not_trusted(self):
        """https://www.w3.org/TR/2018/CR-SVG2-20181004/conform.html#secure-static-mode (lock is harness policy)."""
        with tempfile.TemporaryDirectory() as tmp:
            cache = Path(tmp)
            digest = hashlib.sha256(b"original").hexdigest()
            (cache / digest).write_bytes(b"tampered")
            with self.assertRaisesRegex(ValueError, "hash mismatch"):
                suites.download({"url": "https://example.org/file", "sha256": digest}, cache)

    def test_paths_cannot_escape_cache(self):
        """https://www.w3.org/TR/2018/CR-SVG2-20181004/conform.html#secure-static-mode"""
        for path in ("../escape", "/absolute", "a/../../escape", "a\\escape", "a/./b", ""):
            with self.subTest(path=path), self.assertRaises(ValueError):
                suites.relative_path(path)

    def test_archive_rejects_links_and_traversal(self):
        """https://www.w3.org/TR/2018/CR-SVG2-20181004/conform.html#secure-static-mode"""
        for name, link in (("../outside", False), ("safe/link", True)):
            with self.subTest(name=name), tempfile.TemporaryDirectory() as tmp:
                archive = Path(tmp) / "suite.tar"
                with tarfile.open(archive, "w") as tar:
                    entry = tarfile.TarInfo(name)
                    if link:
                        entry.type = tarfile.SYMTYPE
                        entry.linkname = "/tmp/escape"
                    tar.addfile(entry)
                with self.assertRaises(ValueError):
                    suites.extract_archive(archive, Path(tmp) / "out", "", [""])

    def test_hash_change_never_updates_implicitly(self):
        """https://www.w3.org/TR/2011/REC-SVG11-20110816/conform.html#ConformingSVGViewers"""
        with tempfile.TemporaryDirectory() as tmp, patch.object(suites, "fetch_bytes", return_value=b"changed"):
            record = {"url": "https://example.org/a", "sha256": "0" * 64}
            with self.assertRaisesRegex(ValueError, "hash mismatch"):
                suites.download(record, Path(tmp))
            self.assertEqual(record["sha256"], "0" * 64)

    def test_receipt_detects_modified_extracted_resource(self):
        """https://www.w3.org/TR/2018/CR-SVG2-20181004/conform.html#secure-static-mode"""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "a.svg").write_bytes(b"modified")
            receipt = {"files": {"a.svg": hashlib.sha256(b"original").hexdigest()}}
            with self.assertRaisesRegex(ValueError, "hash mismatch"):
                suites.verify_receipt(root, receipt)

    def test_receipt_cannot_omit_locked_files(self):
        """https://www.w3.org/TR/2018/CR-SVG2-20181004/conform.html#secure-static-mode"""
        lock = suites.load_lock(suites.DEFAULT_LOCK)
        suite = lock["suites"]["resvg"]
        with tempfile.TemporaryDirectory() as tmp:
            cache = Path(tmp)
            target = suites.suite_directory(cache, suite, False)
            target.mkdir(parents=True)
            pin = suites.sha256(json.dumps(suite, sort_keys=True).encode())
            (target / ".receipt.json").write_text(json.dumps({"pin": pin, "files": {}}))
            with patch.object(suites, "download"), self.assertRaisesRegex(ValueError, "inventory"):
                suites.fetch_suite(lock, "resvg", cache, offline=True)

    def test_offline_cache_miss_never_uses_network(self):
        """https://www.w3.org/TR/2018/CR-SVG2-20181004/conform.html#secure-static-mode"""
        with tempfile.TemporaryDirectory() as tmp, patch.object(suites, "fetch_bytes") as fetch:
            with self.assertRaisesRegex(ValueError, "offline cache miss"):
                suites.download({"url": "https://example.org/a", "sha256": "0" * 64}, Path(tmp), offline=True)
            fetch.assert_not_called()

    def test_curated_lock_is_bounded_and_pinned(self):
        """https://www.w3.org/TR/2011/REC-SVG11-20110816/conform.html#ConformingSVGViewers"""
        lock = suites.load_lock(suites.DEFAULT_LOCK)
        subset = lock["suites"]["resvg"]["curated"]
        self.assertGreater(len(subset), 0)
        self.assertLessEqual(len(subset), 200)
        for case in subset:
            self.assertTrue(case["id"].startswith(("shapes/", "painting/mix-blend-mode/", "masking/clipPath/", "masking/mask/", "structure/image/")))
            expected = {f'crates/resvg/tests/tests/{case["id"]}.{extension}' for extension in ("svg", "png")}
            if case["id"] in ("structure/image/no-width-and-height", "structure/image/width-and-height-set-to-auto"):
                expected.add("crates/resvg/tests/resources/image.jpg")
            self.assertEqual(len(case["files"]), len(expected))
            self.assertEqual({entry["path"] for entry in case["files"]}, expected)
        for suite in lock["suites"].values():
            self.assertRegex(suite["archive"]["sha256"], r"^[0-9a-f]{64}$")


if __name__ == "__main__":
    unittest.main()
