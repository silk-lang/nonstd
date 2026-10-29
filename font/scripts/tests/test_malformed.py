"""The corruption gate must exercise every source and reject process failures."""
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import harness
import malformed


class MalformedTests(unittest.TestCase):
    def test_mutations_cover_edges_interior_and_reproducible_nonzero_flips(self):
        data = bytes(range(256)) * 4
        variants = list(malformed.mutations(data, 123))
        self.assertEqual(variants, list(malformed.mutations(data, 123)))
        cuts = [recipe["length"] for recipe, _ in variants if recipe["kind"] == "truncate"]
        self.assertGreaterEqual(len(cuts), 30)
        self.assertIn(0, cuts)
        self.assertIn(len(data) - 1, cuts)
        self.assertIn(len(data) // 2, cuts)
        flips = [(recipe, value) for recipe, value in variants if recipe["kind"] == "flip"]
        self.assertEqual(len(flips), 8)
        for recipe, value in flips:
            self.assertEqual(len(value), len(data))
            self.assertNotEqual(value, data)
            recovered = bytearray(value)
            for offset, mask in recipe["xor"]:
                recovered[offset] ^= mask
            self.assertEqual(recovered, data)
        self.assertNotEqual(flips, list(malformed.mutations(data, 124))[-8:])

    def test_tiny_inputs_and_identical_crashes(self):
        self.assertEqual(list(malformed.mutations(b"", 1)), [])
        self.assertEqual(len(list(malformed.mutations(b"x", 1))), 9)
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            dumper = root / "dumper"
            output = harness.HEADER + b"file.length=0\nfile.error=OutOfBounds\n"
            dumper.write_text(f"#!{sys.executable}\nimport sys\n"
                              f"sys.stdout.buffer.write({output!r})\n"
                              "sys.exit(1)\n")
            dumper.chmod(0o755)
            result = malformed.check_case(b"x", {"kind": "test"}, dumper, dumper, 2, root / "failures")
            self.assertEqual(result["status"], "failure")
            artifact = root / "failures" / result["input_sha256"]
            self.assertEqual((artifact / "input.font").read_bytes(), b"x")
            self.assertEqual(json.loads((artifact / "observation.json").read_text())["status"], "failure")

    def test_resume_retries_failure_and_invalidates_changed_binaries(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            font = root / "font.ttf"
            font.write_bytes(b"a")
            configuration = {"seed": 1, "reference": {"run_path": "rust", "sha256": "old"},
                             "silk": {"run_path": "silk", "sha256": "old"}, "timeout": 1}
            calls = []

            def check(data, recipe, *args):
                calls.append(recipe)
                return {"mutation": recipe, "input_sha256": malformed.sha(data),
                        "status": "failure" if len(calls) == 2 else "match"}

            with patch.object(malformed, "check_case", side_effect=check):
                first = malformed.check_font(font, configuration, root, root)
                self.assertEqual(len(first["results"]), 2)
                self.assertEqual(first["results"][-1]["status"], "failure")
                resumed = malformed.check_font(font, configuration, root, root)
                self.assertEqual(len(resumed["results"]), 9)
                self.assertEqual(len(calls), 10)  # One reused match; failed case retried.
                malformed.check_font(font, configuration, root, root)
                self.assertEqual(len(calls), 10)
                configuration["silk"]["sha256"] = "new"
                malformed.check_font(font, configuration, root, root)
                self.assertEqual(len(calls), 19)

    def test_timeout_is_failure_even_when_both_processes_time_out(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            dumper = root / "slow"
            dumper.write_text(f"#!{sys.executable}\nimport time\ntime.sleep(5)\n")
            dumper.chmod(0o755)
            result = malformed.check_case(b"x", {"kind": "test"}, dumper, dumper, .05, root)
            self.assertEqual(result["status"], "failure")
            self.assertEqual(result["processes"]["rust"], {"timeout_seconds": .05})
            self.assertEqual(result["processes"]["silk"], {"timeout_seconds": .05})

    def test_binary_snapshot_survives_concurrent_rebuild(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            binary = root / "dumper"
            binary.write_bytes(b"first binary")
            snapshot = malformed.freeze_binary(binary, root / "snapshots")
            binary.write_bytes(b"rebuilt binary")
            self.assertEqual(Path(snapshot["run_path"]).read_bytes(), b"first binary")
            self.assertEqual(snapshot["sha256"], malformed.sha(b"first binary"))
            rebuilt = malformed.freeze_binary(binary, root / "snapshots")
            self.assertNotEqual(snapshot["run_path"], rebuilt["run_path"])


if __name__ == "__main__":
    unittest.main()
