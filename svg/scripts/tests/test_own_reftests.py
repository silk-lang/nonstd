"""Own-fixture manifest boundaries; actual renderer acceptance is exercised by reftests."""
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import svg_reftests as reftests

SPEC = "https://www.w3.org/TR/2018/CR-SVG2-20181004/shapes.html#RectElement"


class OwnManifestTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name) / "fixtures"
        self.root.mkdir()
        self.manifest = self.root / "manifest.json"
        for name in ("input.svg", "reference.svg"):
            (self.root / name).write_text('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>')
        self.entry = {"id": "rectangle", "input": "input.svg", "references": [{"path": "reference.svg", "relation": "=="}], "status": "pass", "reason": "Equivalent geometry", "spec": SPEC, "tolerance": {}}

    def load(self, malformed=False):
        self.manifest.write_text(json.dumps({"version": 1, "suite": "own", "mode": "malformed" if malformed else "reference", "cases": [self.entry]}))
        return reftests.load_own_manifest(self.manifest, malformed)

    def test_rejects_traversal_absolute_and_symlink_paths(self):
        outside = self.root.parent / "outside.svg"
        outside.write_text("outside")
        (self.root / "escape.svg").symlink_to(outside)
        for path in ("../outside.svg", str(outside), "escape.svg", "a/../../outside.svg", "a\\outside.svg"):
            for field in ("input", "reference", "id"):
                with self.subTest(path=path, field=field):
                    original = json.loads(json.dumps(self.entry))
                    if field == "reference":
                        self.entry["references"][0]["path"] = path
                    else:
                        self.entry[field] = path
                    with self.assertRaises(ValueError):
                        self.load()
                    self.entry = original

    def test_missing_and_unlisted_files_fail(self):
        (self.root / "reference.svg").unlink()
        with self.assertRaisesRegex(ValueError, "missing"):
            self.load()
        (self.root / "reference.svg").write_text("<svg/>")
        (self.root / "unlisted.svg").write_text("<svg/>")
        with self.assertRaisesRegex(ValueError, "unlisted"):
            self.load()

    def test_svgz_inputs_preserve_complete_manifest_coverage(self):
        # SVG 1.1 G.7 #ConformingSVGViewers; manifest enumeration remains strict.
        (self.root / "input.svg").rename(self.root / "input.svgz")
        self.entry["input"] = "input.svgz"
        _, cases, _ = self.load()
        self.assertEqual(cases[0]["input"], "input.svgz")
        (self.root / "unlisted.svgz").write_bytes(b"gzip fixture")
        with self.assertRaisesRegex(ValueError, "unlisted"):
            self.load()

    def test_invalid_tolerances_fail_during_validation(self):
        for tolerance in ({"channel": -1}, {"channel": 256}, {"pixels": -1}, {"pixels": True}, {"pixels": 1.5}, {"channel": 1}, {"unknown": 0}, []):
            with self.subTest(tolerance=tolerance):
                self.entry["tolerance"] = tolerance
                with self.assertRaises(ValueError):
                    self.load()

    def test_arguments_must_be_option_strings(self):
        self.entry["arguments"] = ["--time", "1s"]
        _, cases, _ = self.load()
        self.assertEqual(cases[0]["arguments"], ["--time", "1s"])
        for arguments in ("--time 1s", [1], {"time": "1s"}):
            with self.subTest(arguments=arguments):
                self.entry["arguments"] = arguments
                with self.assertRaisesRegex(ValueError, "arguments"):
                    self.load()

    def test_ordinary_cases_cannot_hide_failures(self):
        for status in ("skip", "fail", "spec-difference"):
            self.entry["status"] = status
            with self.assertRaises(ValueError):
                self.load()

    def test_malformed_requires_exact_cli_rejection_contract(self):
        self.entry.pop("references")
        (self.root / "reference.svg").unlink()
        for code, presence in ((-11, False), (2, False), (1, True), (0, False), (True, False)):
            with self.subTest(code=code, presence=presence):
                self.entry.update(exit_code=code, output_present=presence)
                with self.assertRaises(ValueError):
                    self.load(malformed=True)
        self.entry.update(exit_code=1, output_present=False)
        _, cases, _ = self.load(malformed=True)
        self.assertEqual(cases[0]["exit_code"], 1)


if __name__ == "__main__":
    unittest.main()
