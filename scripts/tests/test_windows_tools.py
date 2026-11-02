import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "gpu/webgpu/scripts"))
import _build

spec = importlib.util.spec_from_file_location("shared_install", ROOT / "scripts/_install.py")
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class ReleaseTests(unittest.TestCase):
    def test_zip_release_and_flat_shader_distribution(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for strip_root in (True, False):
                archive = root / "release.zip"
                member = "release/bin/tool.exe" if strip_root else "bin/tool.exe"
                with zipfile.ZipFile(archive, "w") as source:
                    source.writestr(member, b"verified release")
                destination = root / str(strip_root)
                with patch.object(installer, "download", return_value=archive):
                    installer.extract({"strip_root": strip_root}, destination)
                self.assertEqual((destination / "bin/tool.exe").read_bytes(), b"verified release")

    def test_zip_traversal_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive = root / "release.zip"
            with zipfile.ZipFile(archive, "w") as source:
                source.writestr("../escape", b"bad")
            with patch.object(installer, "download", return_value=archive):
                with self.assertRaises(SystemExit):
                    installer.extract({}, root / "installed")
            self.assertFalse((root / "escape").exists())

    def test_installers_are_launched_with_python(self):
        with patch.object(_build.subprocess, "check_output", return_value=str(ROOT)) as run:
            self.assertEqual(_build.command_path("install-silk"), ROOT)
        self.assertEqual(run.call_args.args[0], [sys.executable, str(ROOT / "scripts/install-silk")])



class NativePinTests(unittest.TestCase):
    def test_manifest_dawn_archives_match_the_lock(self):
        """Every manifest that pins Dawn pins the release toolchains.lock.json installs."""
        import json
        import tomllib
        lock = json.loads((ROOT / "toolchains.lock.json").read_text())["webgpu"]["platforms"]
        manifests = {"gpu/webgpu/sys/silk.toml": "dawn", "gpu/webgpu/sys/abi/silk.toml": "dawn-headers",
                     "gpu/webgpu/bench/silk.toml": "dawn-headers"}
        for path, name in manifests.items():
            targets = tomllib.loads((ROOT / path).read_text())["native"]["archive"][name]["targets"]
            self.assertEqual(set(targets), set(lock), path)
            for target, pin in targets.items():
                self.assertEqual((pin["url"], pin["sha256"]), (lock[target]["url"], lock[target]["sha256"]), f"{path} {target}")


if __name__ == "__main__":
    unittest.main()
