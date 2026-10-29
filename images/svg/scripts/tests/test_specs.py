"""Spec baseline integrity, not renderer conformance.

Normative scope: https://www.w3.org/TR/2018/CR-SVG2-20181004/conform.html#conformance-overview
Pinning policy: images/svg/SPECIFICATIONS.md#baseline-integrity
"""
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


SCRIPT = Path(__file__).resolve().parents[1] / "fetch-specs.py"
SPEC = importlib.util.spec_from_file_location("svg_fetch_specs", SCRIPT)
fetch_specs = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(fetch_specs)


class SpecificationCacheTests(unittest.TestCase):
    """All cases enforce SPECIFICATIONS.md#baseline-integrity for the scope above."""

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.lock = self.root / "specs.lock.json"
        self.cache = self.root / "cache"
        self.url = "https://example.org/spec/"
        self.urls = {"spec": self.url}
        self.body = b"<html id='conformance'>Normative fixture</html>"
        self.record = {"url": self.url, "resolved": self.url + "index.html",
                       "sha256": hashlib.sha256(self.body).hexdigest()}

    def establish(self):
        with patch.object(fetch_specs, "download", return_value=(self.record["resolved"], self.body)):
            fetch_specs.synchronize(self.lock, self.cache, self.urls, update=True)

    def test_initial_baseline_requires_explicit_update(self):
        with self.assertRaisesRegex(fetch_specs.SpecError, "--update"):
            fetch_specs.synchronize(self.lock, self.cache, self.urls)
        self.assertFalse(self.lock.exists())

    def test_update_records_original_and_resolved_urls_and_real_digest(self):
        self.establish()
        baseline = json.loads(self.lock.read_text())
        self.assertEqual(baseline, {"format": 1, "specs": {"spec": self.record}})
        self.assertEqual(fetch_specs.cache_path(self.cache, self.record).read_bytes(), self.body)

    def test_offline_verifies_without_network_or_rewriting_lock(self):
        self.establish()
        before = self.lock.read_bytes()
        with patch.object(fetch_specs, "download", side_effect=AssertionError("network forbidden")):
            fetch_specs.synchronize(self.lock, self.cache, self.urls, offline=True)
        self.assertEqual(self.lock.read_bytes(), before)

    def test_missing_offline_document_fails_closed(self):
        self.establish()
        fetch_specs.cache_path(self.cache, self.record).unlink()
        with patch.object(fetch_specs, "download", side_effect=AssertionError("network forbidden")):
            with self.assertRaisesRegex(fetch_specs.SpecError, "missing.*offline"):
                fetch_specs.synchronize(self.lock, self.cache, self.urls, offline=True)

    def test_corrupt_cache_is_not_silently_replaced(self):
        self.establish()
        fetch_specs.cache_path(self.cache, self.record).write_bytes(b"corruption")
        with patch.object(fetch_specs, "download", side_effect=AssertionError("network forbidden")):
            with self.assertRaisesRegex(fetch_specs.SpecError, "SHA-256"):
                fetch_specs.synchronize(self.lock, self.cache, self.urls)

    def test_changed_upstream_cannot_change_lock_or_populate_cache(self):
        self.establish()
        before = self.lock.read_bytes()
        cached = fetch_specs.cache_path(self.cache, self.record)
        cached.unlink()
        with patch.object(fetch_specs, "download", return_value=(self.record["resolved"], b"new draft")):
            with self.assertRaisesRegex(fetch_specs.SpecError, "SHA-256"):
                fetch_specs.synchronize(self.lock, self.cache, self.urls)
        self.assertEqual(self.lock.read_bytes(), before)
        self.assertFalse(cached.exists())

    def test_missing_cache_fetches_pinned_bytes_without_changing_baseline(self):
        self.establish()
        before = self.lock.read_bytes()
        fetch_specs.cache_path(self.cache, self.record).unlink()
        with patch.object(fetch_specs, "download", return_value=(self.url + "new-location", self.body)):
            fetch_specs.synchronize(self.lock, self.cache, self.urls)
        self.assertEqual(self.lock.read_bytes(), before)
        self.assertEqual(fetch_specs.cache_path(self.cache, self.record).read_bytes(), self.body)

    def test_failed_update_preserves_previous_lock(self):
        self.establish()
        before = self.lock.read_bytes()
        with patch.object(fetch_specs, "download", side_effect=OSError("unreachable")):
            with self.assertRaisesRegex(fetch_specs.SpecError, "unreachable"):
                fetch_specs.synchronize(self.lock, self.cache, self.urls, update=True)
        self.assertEqual(self.lock.read_bytes(), before)

    def test_update_and_offline_are_mutually_exclusive(self):
        with self.assertRaisesRegex(fetch_specs.SpecError, "--update.*--offline"):
            fetch_specs.synchronize(self.lock, self.cache, self.urls, update=True, offline=True)

    def test_catalog_changes_require_explicit_update(self):
        self.establish()
        with self.assertRaisesRegex(fetch_specs.SpecError, "catalog.*--update"):
            fetch_specs.synchronize(self.lock, self.cache, {**self.urls, "another": self.url})

    def test_malformed_hash_is_rejected_before_cache_access(self):
        self.establish()
        baseline = json.loads(self.lock.read_text())
        baseline["specs"]["spec"]["sha256"] = "../escape"
        self.lock.write_text(json.dumps(baseline))
        with self.assertRaisesRegex(fetch_specs.SpecError, "invalid.*SHA-256"):
            fetch_specs.synchronize(self.lock, self.cache, self.urls)

    def test_only_verifies_selected_documents(self):
        self.establish()
        self.urls["uncached"] = "https://example.org/uncached/"
        baseline = json.loads(self.lock.read_text())
        baseline["specs"]["uncached"] = {
            "url": self.urls["uncached"], "resolved": self.urls["uncached"],
            "sha256": hashlib.sha256(b"uncached").hexdigest(),
        }
        self.lock.write_text(json.dumps(baseline))
        with patch.object(fetch_specs, "download", side_effect=AssertionError("network forbidden")):
            self.assertEqual(fetch_specs.synchronize(
                self.lock, self.cache, self.urls, offline=True, only=["spec"]), 1)

    def test_unknown_selection_is_an_error(self):
        with self.assertRaisesRegex(fetch_specs.SpecError, "unknown specification"):
            fetch_specs.synchronize(self.lock, self.cache, self.urls, only=["typo"])

    def test_update_requires_the_complete_catalog(self):
        with self.assertRaisesRegex(fetch_specs.SpecError, "--update.*--only"):
            fetch_specs.synchronize(self.lock, self.cache, self.urls, update=True, only=["spec"])


if __name__ == "__main__":
    unittest.main()
