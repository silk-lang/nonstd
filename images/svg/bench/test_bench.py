"""Behavior tests; run explicitly with python -m unittest discover -s svg_bench."""
import importlib.util
import tempfile
from pathlib import Path
import unittest

HERE = Path(__file__).resolve().parent


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


workloads = load("svg_workloads", HERE / "workloads.py")
harness = load("svg_benchmark", HERE / "harness.py")


class WorkloadsTest(unittest.TestCase):
    def test_generated_icons_are_deterministic_and_distinct(self):
        config = {"count": 8, "size": 32, "seed": 7}
        first = workloads.generate_icons(config)
        self.assertEqual(first, workloads.generate_icons(config))
        self.assertEqual(len(first), 8)
        self.assertEqual(len(set(first.values())), 8)

    def test_content_hash_ignores_cache_location_but_not_input(self):
        with tempfile.TemporaryDirectory() as directory:
            left, right = Path(directory) / "left", Path(directory) / "right"
            left.mkdir()
            right.mkdir()
            (left / "a.svg").write_bytes(b"<svg/>")
            (right / "a.svg").write_bytes(b"<svg/>")
            self.assertEqual(harness.workload_hash([left / "a.svg"]), harness.workload_hash([right / "a.svg"]))
            (right / "a.svg").write_bytes(b"<svg ><path/></svg>")
            self.assertNotEqual(harness.workload_hash([left / "a.svg"]), harness.workload_hash([right / "a.svg"]))

    def test_tiger_rejects_modified_download(self):
        with self.assertRaisesRegex(ValueError, "SHA-256"):
            workloads.verify_asset(b"not the tiger", {"sha256": "0" * 64, "bytes": 13})

    def test_tiger_viewport_normalization_preserves_geometry_and_paint(self):
        import xml.etree.ElementTree as ET
        source = b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 900" id="root"><g transform="matrix(2,0,0,2,3,4)" fill="#ffc" stroke="#000"><path id="shape" d="M1 2C3 4 5 6 7 8Z" stroke-width="0.17200001"/></g></svg>'
        config = {"viewBox": "0 0 900 900", "width": 900, "height": 900}
        original = ET.fromstring(source)
        sized = ET.fromstring(workloads.normalize_tiger(source, config))
        self.assertEqual(sized.tag, original.tag)
        self.assertEqual(sized.attrib, {**original.attrib, "width": "900", "height": "900"})
        before = [(node.tag, node.attrib, node.text, node.tail) for node in list(original.iter())[1:]]
        after = [(node.tag, node.attrib, node.text, node.tail) for node in list(sized.iter())[1:]]
        self.assertEqual(after, before)


class MeasurementTest(unittest.TestCase):
    def test_callgrind_uses_named_event_column(self):
        self.assertEqual(harness.callgrind_ir("events: Dr Ir Dw\nsummary: 9 123456 8\n"), 123456)
        with self.assertRaisesRegex(ValueError, "Ir"):
            harness.callgrind_ir("events: Dr Dw\nsummary: 9 8\n")

    def test_baseline_rejects_different_measured_work(self):
        current = {"protocol": 1, "config": {"iterations": 3}, "workloads": {"map": {"sha256": "a"}}, "results": {}}
        baseline = {**current, "workloads": {"map": {"sha256": "b"}}}
        with self.assertRaisesRegex(ValueError, "workloads"):
            harness.baseline_ratios(current, baseline)

    def test_baseline_ratio_is_current_over_previous(self):
        common = {"protocol": 1, "config": {"iterations": 3}, "workloads": {"map": {"sha256": "a"}}}
        current = {**common, "results": {"silk": {"map/render": {"median_ns": 150}}}}
        baseline = {**common, "results": {"silk": {"map/render": {"median_ns": 100}}}}
        self.assertEqual(harness.baseline_ratios(current, baseline), {"silk": {"map/render": 1.5}})


if __name__ == "__main__":
    unittest.main()
