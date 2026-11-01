"""Build executable packages against pinned binaries without machine paths in manifests."""
import os
from pathlib import Path
import platform
import subprocess
import tomllib
import hashlib
import sys
import shutil
import re

from _install import ROOT, REPO, CACHE


def command_path(script):
    # Silk and LLVM installers are shared at the repository root; Dawn's lives here.
    directory = REPO / "scripts" if script in ("install-silk", "install-llvm", "install-glfw", "install-dxc") else ROOT / "scripts"
    return Path(subprocess.check_output([sys.executable, str(directory / script)], text=True).strip())


def executable(name):
    return name + (".exe" if os.name == "nt" else "")


def stage_path(source, destination):
    """Stage current inputs without requiring Windows symlink privileges."""
    if os.name == "nt":
        if source.is_dir():
            if destination.exists():
                resolved = destination.resolve()
                if destination.is_symlink() or not resolved.is_relative_to(REPO) or resolved == REPO:
                    raise RuntimeError(f"Unsafe staging directory: {destination}")
                shutil.rmtree(destination)
            shutil.copytree(source, destination)
        else:
            shutil.copy2(source, destination)
    else:
        if destination.is_symlink() and destination.resolve() != source.resolve():
            destination.unlink()
        if not destination.exists():
            destination.symlink_to(source, target_is_directory=source.is_dir())
        elif destination.resolve() != source.resolve():
            raise RuntimeError(f"Conflicting staged input: {destination}")


def quoted(value):
    import json
    return json.dumps(str(value))


def callback_archive(clang, dawn):
    source = ROOT / "native" / "callbacks.c"
    flags = ["-std=c11", "-O2", "-I", str(dawn / "include")]
    if platform.system() == "Darwin":
        sdk = subprocess.check_output(["xcrun", "--show-sdk-path"], text=True).strip()
        flags += ["-isysroot", sdk, "-mmacosx-version-min=26.0"]
    identity = repr((str(clang), clang.stat().st_mtime_ns, platform.machine(), flags))
    key = hashlib.sha256(source.read_bytes() + identity.encode()).hexdigest()[:20]
    stage = CACHE / "native-callbacks" / key
    archive = stage / "libsilk_webgpu_callbacks.a"
    if not archive.exists():
        stage.mkdir(parents=True, exist_ok=True)
        object_path = stage / f"callbacks-{os.getpid()}.o"
        subprocess.run([str(clang), *flags, "-c", str(source), "-o", str(object_path)], check=True)
        temporary = stage / f"callbacks-{os.getpid()}.a"
        subprocess.run([str(clang.parent / executable("llvm-ar")), "rcs", str(temporary), str(object_path)], check=True)
        temporary.replace(archive)
        object_path.unlink()
    return archive


def windows_dawn(clang, dawn):
    """Put Dawn's C++ initialization behind the Windows DLL CRT entry point.

    Silk's native entry point deliberately does not initialize the C runtime.
    The pinned Dawn archive uses the dynamic MSVC CRT. Link it into a DLL with
    its public C exports, then link Silk to the resulting import library.
    Run from an x64 Visual Studio developer shell with the Windows SDK installed.
    """
    symbols = re.findall(r'extern "C" fn (wgpu\w+)\(', (ROOT / "sys/src/generated_webgpu.silk").read_text(encoding="utf-8"))
    definition = "EXPORTS\n" + "\n".join(sorted(set(symbols))) + "\n"
    identity = repr((str(clang), clang.stat().st_mtime_ns, str(dawn), os.environ.get("LIB")))
    key = hashlib.sha256((definition + identity).encode()).hexdigest()[:20]
    stage = CACHE / "native-dawn" / key
    library = stage / "nonstd_dawn.lib"
    dll = stage / "nonstd_dawn.dll"
    if not library.exists() or not dll.exists():
        stage.mkdir(parents=True, exist_ok=True)
        exports = stage / "exports.def"
        exports.write_text(definition, encoding="utf-8")
        source = stage / "entry.c"
        source.write_text("/* DLL CRT startup owns Dawn's C++ static initialization. */\n", encoding="utf-8")
        subprocess.run([str(clang), "-shared", "-fuse-ld=lld", "-fms-runtime-lib=dll", str(source),
                        str(dawn / "lib/webgpu_dawn.lib"), "-o", str(dll),
                        f"-Wl,/def:{exports}", f"-Wl,/implib:{library}",
                        "-luser32", "-lonecore_apiset", "-ldxguid"], check=True)
    return library, dll


def windows_import_library(name):
    for directory in os.environ.get("LIB", "").split(os.pathsep):
        if directory and (Path(directory) / f"{name}.lib").is_file():
            return Path(directory) / f"{name}.lib"
    raise RuntimeError(f"Cannot find {name}.lib; run from an x64 Visual Studio 2026 developer shell with the Windows SDK")


def build(package_path, release=False, extra_links=(), target=None):
    package_path = Path(package_path).resolve()
    if package_path.is_file():
        package_path = package_path.parent
    manifest = tomllib.loads((package_path / "silk.toml").read_text())
    package = manifest["package"]
    compiler_bin = command_path("install-silk")
    clang = command_path("install-llvm")
    stdlib = compiler_bin.parent / "lib" / "silk" / "stdlib"
    wasm = target == "wasm32-unknown-unknown"
    stage = CACHE / "build" / (package["name"] + ("-wasm" if wasm else ""))
    stage.mkdir(parents=True, exist_ok=True)
    source = stage / "src"
    stage_path(package_path / "src", source)
    lines = ["[package]"]
    for key, value in package.items():
        if isinstance(value, list):
            lines.append(f"{key} = [" + ", ".join(quoted(v) for v in value) + "]")
        else:
            lines.append(f"{key} = {quoted(value)}")
    lines.extend(["", "[dependencies]"])
    for name, dependency in manifest.get("dependencies", {}).items():
        if "path" not in dependency or not set(dependency) <= {"path", "package"}:
            raise ValueError(f"Expected a local dependency: {name}")
        renamed = f", package = {quoted(dependency['package'])}" if "package" in dependency else ""
        lines.append(f"{name} = {{ path = {quoted((package_path / dependency['path']).resolve())}{renamed} }}")
    links = []
    if not wasm:
        dawn = command_path("install-webgpu")
        if platform.system() == "Darwin":
            links = [{"static-archive": dawn / "lib" / "libwebgpu_dawn.a"}, {"library": "c++", "mode": "dynamic"}]
            links += [{"framework": name} for name in ("CoreFoundation", "Foundation", "IOSurface", "QuartzCore", "Cocoa", "IOKit", "Metal")]
        elif platform.system() == "Linux":
            links = [{"static-archive": dawn / "lib64" / "libwebgpu_dawn.a"}]
            links += [{"library": name, "mode": "dynamic"} for name in ("stdc++", "m", "dl", "rt", "pthread")]
        elif platform.system() == "Windows":
            library, dawn_dll = windows_dawn(clang, dawn)
            links = [{"static-archive": library}]
            # Silk suppresses the CRT defaults. ABI probes and benchmark support
            # call C stdio explicitly, so name their DLL import libraries here.
            links += [{"static-archive": windows_import_library(name)} for name in ("ucrt", "vcruntime")]
        else:
            raise RuntimeError(f"Unsupported native WebGPU host: {platform.system()}")
        # Support archives precede Dawn so their WebGPU references resolve with traditional linkers.
        links = list(extra_links) + [{"static-archive": callback_archive(clang, dawn)}] + links
        staged_links = []
        for index, link in enumerate(links):
            link = dict(link)
            for key in ("static-archive", "object", "search-path"):
                if key in link:
                    path = Path(link[key]).resolve()
                    if not path.exists():
                        raise FileNotFoundError(path)
                    name = f"link-{index}" + (path.suffix if path.is_file() else "")
                    local = stage / name
                    stage_path(path, local)
                    link[key] = name
            staged_links.append("  { " + ", ".join(f"{key} = {quoted(value)}" for key, value in link.items()) + " }")
        lines.extend(["", "[native]", "link = [", ",\n".join(staged_links), "]"])
    staged_manifest = stage / "silk.toml"
    staged_manifest.write_text("\n".join(lines) + "\n")
    command = [str(compiler_bin / executable("silkc")), "build", "--manifest-path", str(staged_manifest), "--stdlib", str(stdlib), "--clang", str(clang)]
    if target:
        command += ["--target", target]
    if release:
        command.append("--release")
    completed = subprocess.run(command, cwd=ROOT, capture_output=True, text=True)
    print(completed.stdout, end="")
    print(completed.stderr, end="", file=__import__("sys").stderr)
    completed.check_returncode()
    profile = "release" if release else "debug"
    name = package['name'] if wasm else executable(package['name'])
    candidates = list((stage / "build" / "llvm").glob(f"*/{profile}/{name}"))
    if len(candidates) != 1:
        raise RuntimeError(f"Expected one built executable under {stage}, found {candidates}")
    if not wasm and platform.system() == "Windows":
        shutil.copy2(dawn_dll, candidates[0].parent / dawn_dll.name)
        dxc = command_path("install-dxc")
        for name in ("dxcompiler.dll", "dxil.dll"):
            shutil.copy2(dxc / name, candidates[0].parent / name)
    return candidates[0]
