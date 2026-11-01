import importlib.util
import os
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

    @unittest.skipUnless(os.name == "nt", "Windows copies sources without symlink privileges")
    def test_staging_refresh_removes_deleted_modules(self):
        with tempfile.TemporaryDirectory(dir=ROOT / ".cache") as directory:
            root = Path(directory)
            source, destination = root / "input", root / "src"
            source.mkdir()
            (source / "old.silk").write_text("old")
            _build.stage_path(source, destination)
            (source / "old.silk").unlink()
            (source / "new.silk").write_text("new")
            _build.stage_path(source, destination)
            self.assertFalse((destination / "old.silk").exists())
            self.assertEqual((destination / "new.silk").read_text(), "new")


if __name__ == "__main__":
    unittest.main()
