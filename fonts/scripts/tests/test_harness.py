"""Regression tests for coverage and false-positive prevention in the oracle harness."""
import contextlib
import io
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import harness

VALID = harness.HEADER + b"file.length=0\nfile.error=OutOfBounds\n"


class HarnessTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="font harness ")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.font = self.root / "font with spaces;$(not-a-command).ttf"
        self.font.write_bytes(b"")

    def dumper(self, name, output=VALID, code=0):
        path = self.root / name
        path.write_text(f"#!{sys.executable}\nimport sys\n"
                        f"sys.stdout.buffer.write({output!r})\nsys.exit({code})\n")
        path.chmod(0o755)
        return path

    def compare(self, left, right):
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            return harness.compare([self.font], left, right, 2)

    def test_first_difference_reports_one_based_line(self):
        self.assertEqual(harness.first_difference(b"same\nleft\n", b"same\nright\n"),
                         (2, b"left\n", b"right\n"))

    def test_missing_newline_and_eof_are_differences(self):
        self.assertEqual(harness.first_difference(b"x\n", b"x"), (1, b"x\n", b"x"))
        self.assertEqual(harness.first_difference(b"x\n\n", b"x\n"), (2, b"\n", None))

    def test_identical_valid_dumps_pass_with_unusual_font_path(self):
        self.assertEqual(self.compare(self.dumper("left"), self.dumper("right")), 0)

    def test_first_changed_field_fails(self):
        self.assertEqual(self.compare(self.dumper("left"), self.dumper("right", VALID.replace(b"=0", b"=1"))), 1)

    def test_identical_output_from_failed_processes_is_not_a_match(self):
        self.assertEqual(self.compare(self.dumper("left", code=1), self.dumper("right", code=1)), 2)

    def test_empty_or_skeleton_output_is_not_a_match(self):
        for output in (b"", harness.HEADER + b"dump.status=unimplemented\n"):
            with self.assertRaises(ValueError):
                self.compare(self.dumper("left", output), self.dumper("right", output))

    def test_compare_report_distinguishes_matches_differences_and_process_failures(self):
        import json
        for output, code, status, matched, differences, failures in (
            (VALID, 0, 0, 1, 0, 0),
            (VALID.replace(b"=0", b"=1"), 0, 1, 0, 1, 0),
            (VALID, 1, 2, 0, 0, 1),
        ):
            report = self.root / "comparison.json"
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                actual = harness.compare([self.font], self.dumper("left"),
                                         self.dumper("right", output, code), 2, report)
            data = json.loads(report.read_text())
            self.assertEqual(actual, status)
            self.assertEqual(data["summary"]["matched"], matched)
            self.assertEqual(data["summary"]["differences"], differences)
            self.assertEqual(data["summary"]["process_failures"], failures)
            if matched:
                self.assertEqual(data["results"][0]["rust_dump_sha256"],
                                 data["results"][0]["silk_dump_sha256"])

    def test_traversal_limit_is_not_a_passing_field_comparison(self):
        output = VALID + b"font[0].GSUB=traversal-limit\n"
        with self.assertRaisesRegex(ValueError, "traversal bound"):
            self.compare(self.dumper("left", output), self.dumper("right", output))

    def test_streaming_comparison_preserves_late_difference_and_final_newline(self):
        left = VALID + b"font[0].value=1\n" * 5000
        right = left[:-2] + b"2\n"
        self.assertEqual(self.compare(self.dumper("left", left), self.dumper("right", right)), 1)
        with self.assertRaisesRegex(ValueError, "complete font dump"):
            self.compare(self.dumper("left", left), self.dumper("right", left[:-1]))

    def test_graph_references_require_a_preceding_unique_node(self):
        for suffix in (b"font[0].GSUB.ref=1\n", b"font[0].GSUB.node=1\nfont[0].GPOS.node=1\n"):
            with self.assertRaises(ValueError):
                self.compare(self.dumper("left", VALID + suffix), self.dumper("right", VALID + suffix))
        output = VALID + b"font[0].GSUB.node=1\nfont[0].GSUB.child.ref=1\n"
        self.assertEqual(self.compare(self.dumper("left", output), self.dumper("right", output)), 0)

    def test_subprocess_timeout_is_failure(self):
        path = self.root / "slow"
        path.write_text(f"#!{sys.executable}\nimport time\ntime.sleep(5)\n")
        path.chmod(0o755)
        with self.assertRaises(subprocess.TimeoutExpired):
            harness.run_dumper(path, self.font, 0.02)

    def test_font_list_is_root_relative_and_rejects_empty_or_duplicate_lists(self):
        listing = self.root / "fonts.txt"
        with patch.object(harness, "ROOT", self.root):
            listing.write_text(self.font.name + "\n")
            self.assertEqual(harness.font_list(listing)[0], [self.font])
            listing.write_text("# no fonts\n")
            with self.assertRaisesRegex(ValueError, "empty"):
                harness.font_list(listing)
            listing.write_text((self.font.name + "\n") * 2)
            with self.assertRaisesRegex(ValueError, "duplicates"):
                harness.font_list(listing)

    def test_discovery_includes_bad_fonts_and_extensionless_sfnt_but_excludes_text(self):
        for name in harness.CORPUS_ROOTS:
            directory = self.root / name
            directory.mkdir(parents=True)
            (directory / "README.md").write_text("fixture documentation")
            if not name.endswith("/extracted"):
                (directory / "bad.TTF").write_bytes(b"broken")
                (directory / "legacy.dfont").write_bytes(b"resource fork")
                (directory / "no-extension").write_bytes(b"OTTO")
        with patch.object(harness, "ROOT", self.root):
            fonts, inventory = harness.discover()
            self.assertEqual(len(fonts), 9)
            self.assertEqual(sum(len(i["excluded"]) for i in inventory), 4)

    def test_missing_corpus_fails_instead_of_shrinking_coverage(self):
        with patch.object(harness, "ROOT", self.root):
            with self.assertRaisesRegex(ValueError, "missing corpus"):
                harness.discover()

    def test_reference_verification_records_parse_errors_separately(self):
        report = self.root / "report.json"
        with contextlib.redirect_stdout(io.StringIO()):
            status = harness.verify([self.font], [], self.dumper("oracle"), 2, report)
        import json
        summary = json.loads(report.read_text())["summary"]
        self.assertEqual(status, 0)
        self.assertEqual(summary["completed"], 1)
        self.assertEqual(summary["faces_ok"], 0)
        self.assertEqual(summary["parse_error_records"], 1)


if __name__ == "__main__":
    unittest.main()
