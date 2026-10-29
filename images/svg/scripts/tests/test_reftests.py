"""Test the adapter, not an SVG renderer. Synthetic pixels are not rendered SVGs."""
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import svg_reftests as reftests

SVG = "https://www.w3.org/TR/2018/CR-SVG2-20181004/render.html#RenderingOrder"


class ReftestTests(unittest.TestCase):
    def test_tolerances_bound_channels_and_pixel_count(self):
        """https://www.w3.org/TR/png-3/#11IHDR (RGBA samples; tolerance is harness policy)."""
        a = bytes([10, 20, 30, 255, 10, 20, 30, 255])
        b = bytes([12, 20, 30, 255, 10, 24, 30, 255])
        result = reftests.compare_rgba((2, 1, a), (2, 1, b), 2, 0)
        self.assertFalse(result["match"])
        self.assertEqual(result["different_pixels"], 1)
        self.assertEqual(result["max_channel_difference"], 4)
        self.assertTrue(reftests.compare_rgba((2, 1, a), (2, 1, b), 2, 1)["match"])

    def test_dimensions_and_alpha_are_compared(self):
        """https://www.w3.org/TR/png-3/#11IHDR"""
        self.assertFalse(reftests.compare_rgba((1, 1, bytes(4)), (2, 1, bytes(8)), 0, 0)["match"])
        self.assertFalse(reftests.compare_rgba((1, 1, bytes(4)), (1, 1, bytes([0, 0, 0, 1])), 0, 0)["match"])

    def test_antialias_tolerance_preserves_opaque_and_transparent_samples(self):
        """https://www.w3.org/TR/2018/CR-SVG2-20181004/conform.html#ConformingSVGViewers"""
        def compared(a, b):
            return reftests.compare_rgba((1, 1, bytes(a)), (1, 1, bytes(b)),
                                        antialias_channel=80)["match"]
        self.assertTrue(compared([32, 64, 128, 100], [32, 64, 128, 180]))
        self.assertFalse(compared([32, 64, 128, 100], [32, 64, 128, 181]))
        self.assertFalse(compared([32, 64, 128, 255], [33, 64, 128, 255]))
        self.assertFalse(compared([32, 64, 128, 0], [32, 64, 128, 1]))
        self.assertFalse(compared([32, 64, 128, 254], [32, 64, 128, 255]))

    def test_unexpected_pass_and_failure_are_gate_failures(self):
        """https://www.w3.org/TR/2018/CR-SVG2-20181004/render.html#RenderingOrder"""
        self.assertEqual(reftests.outcome("fail", True), "unexpected-pass")
        self.assertEqual(reftests.outcome("pass", False), "unexpected-fail")
        self.assertEqual(reftests.outcome("spec-difference", True), "unexpected-pass")
        self.assertEqual(reftests.outcome("spec-difference", False), "spec-difference")

    def test_expectations_reject_missing_reasons_and_tolerance_reason(self):
        """https://www.w3.org/TR/2018/CR-SVG2-20181004/conform.html#ConformingSVGViewers"""
        entry = {"id": "a", "status": "fail", "spec": SVG}
        with self.assertRaisesRegex(ValueError, "reason"):
            reftests.validate_expectation(entry)
        entry.update(reason="Known shape discrepancy", status="pass", tolerance={"channel": 2, "pixels": 1})
        with self.assertRaisesRegex(ValueError, "reason"):
            reftests.validate_expectation(entry)

    def test_spec_difference_requires_both_observed_results(self):
        """https://www.w3.org/TR/2018/CR-SVG2-20181004/render.html#RenderingOrder"""
        entry = {"id": "a", "status": "spec-difference", "spec": SVG, "reason": "Normative result differs"}
        with self.assertRaisesRegex(ValueError, "spec_result"):
            reftests.validate_expectation(entry)
        entry.update(spec_result="red", reference_result="blue")
        reftests.validate_expectation(entry)

    def test_wpt_standalone_reference_and_script_boundary(self):
        """https://www.w3.org/TR/2018/CR-SVG2-20181004/conform.html#secure-static-mode"""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            test = root / "test.svg"
            reference = root / "ref.svg"
            reference.write_text('<svg xmlns="http://www.w3.org/2000/svg"/>')
            test.write_text('<svg xmlns="http://www.w3.org/2000/svg"><link xmlns="http://www.w3.org/1999/xhtml" rel="match" href="ref.svg"/></svg>')
            cases = reftests.wpt_cases(root)
            self.assertEqual(cases[0]["references"], [{"path": "ref.svg", "relation": "=="}])
            test.write_text('<svg xmlns="http://www.w3.org/2000/svg" onload="run()"><link rel="match" href="ref.svg"/></svg>')
            self.assertIn("script", reftests.wpt_cases(root)[0]["skip_reason"])

    def test_wpt_external_reference_is_not_fetched(self):
        """https://www.w3.org/TR/2018/CR-SVG2-20181004/conform.html#secure-static-mode"""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "test.svg").write_text('<svg xmlns="http://www.w3.org/2000/svg"><link rel="match" href="../escape.svg"/></svg>')
            self.assertIn("outside", reftests.wpt_cases(root)[0]["skip_reason"])

    def test_renderer_argv_requires_placeholders_without_shell(self):
        """https://www.w3.org/TR/2018/CR-SVG2-20181004/conform.html#secure-static-mode"""
        self.assertEqual(reftests.renderer_argv(['renderer', '{input}', '-o', '{output}'], Path('a b.svg'), Path('out.png')), ['renderer', 'a b.svg', '-o', 'out.png'])
        with self.assertRaises(ValueError):
            reftests.renderer_argv(['renderer'], Path('a.svg'), Path('out.png'))

    def test_renderer_errors_never_count_as_expected_pixel_failure(self):
        """https://www.w3.org/TR/2018/CR-SVG2-20181004/render.html#RenderingOrder"""
        case = {"id": "a", "input": "a.svg", "references": [{"path": "a.png", "relation": "=="}]}
        expectation = {"status": "fail", "reason": "Known pixel mismatch", "spec": SVG}
        with tempfile.TemporaryDirectory() as tmp, patch.object(reftests, "render", side_effect=ValueError("renderer exited 1")):
            result = reftests.run_case(case, expectation, Path(tmp), ["renderer", "{input}", "{output}"], 1)
        self.assertEqual(result["outcome"], "error")
        self.assertFalse(result["rendered"])

    def test_skip_does_not_invoke_renderer(self):
        """https://www.w3.org/TR/2018/CR-SVG2-20181004/conform.html#secure-static-mode"""
        with patch.object(reftests, "render") as render:
            result = reftests.run_case({"id": "a"}, {"status": "skip", "reason": "No renderer in phase 1", "spec": SVG}, Path("."), [], 1)
            render.assert_not_called()
        self.assertFalse(result["rendered"])
        self.assertEqual(result["outcome"], "skip")

    def test_oversized_png_is_a_controlled_harness_error(self):
        """https://www.w3.org/TR/png-3/#11IHDR (decoder allocation boundary)."""
        from PIL import Image
        with patch.object(Image, "open", side_effect=Image.DecompressionBombError("oversized")):
            with self.assertRaisesRegex(ValueError, "PNG exceeds"):
                reftests.read_png(Path("oversized.png"))

    def test_png_decode_compares_samples(self):
        """https://www.w3.org/TR/png-3/#11IHDR"""
        from PIL import Image
        with tempfile.TemporaryDirectory() as tmp:
            image = Path(tmp) / "sample.png"
            Image.new("RGBA", (1, 1), (3, 5, 7, 9)).save(image)
            self.assertEqual(reftests.read_png(image), (1, 1, bytes([3, 5, 7, 9])))


if __name__ == "__main__":
    unittest.main()
