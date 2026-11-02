"""Build a package with the pinned Silk compiler and return its executable.

Manifests declare everything a build needs: gpu/webgpu/sys pins Dawn and compiles the callback
shim, and the frameworks and libraries reach dependent executables on their own. This module only
locates the pinned tools and, on Windows, puts the DLLs a test program loads beside it.
"""
import hashlib
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

from _install import ROOT, REPO, CACHE


def command_path(script):
    # Silk and LLVM installers are shared at the repository root; Dawn's lives here.
    directory = REPO / "scripts" if script in ("install-silk", "install-llvm", "install-glfw", "install-dxc") else ROOT / "scripts"
    return Path(subprocess.check_output([sys.executable, str(directory / script)], text=True).strip())


def executable(name):
    return name + (".exe" if os.name == "nt" else "")


def windows_dawn(clang, dawn):
    """Put Dawn's C++ initialization behind the Windows DLL CRT entry point.

    Silk's native entry point deliberately does not initialize the C runtime.
    The pinned Dawn archive uses the dynamic MSVC CRT. Link it into a DLL with
    its public C exports; Silk links the resulting import library. Returns a
    directory shaped like the Dawn archive (include/, lib/nonstd_dawn.lib and the
    CRT import libraries, bin/nonstd_dawn.dll) that scripts/prepare-windows names as the override of
    gpu/webgpu/sys's `dawn` archive.
    Run from an x64 Visual Studio developer shell with the Windows SDK installed.
    """
    symbols = re.findall(r'extern "C" fn (wgpu\w+)\(', (ROOT / "sys/src/generated_webgpu.silk").read_text(encoding="utf-8"))
    definition = "EXPORTS\n" + "\n".join(sorted(set(symbols))) + "\n"
    identity = repr((str(clang), clang.stat().st_mtime_ns, str(dawn), os.environ.get("LIB")))
    key = hashlib.sha256((definition + identity).encode()).hexdigest()[:20]
    stage = CACHE / "native-dawn" / key
    library = stage / "lib" / "nonstd_dawn.lib"
    dll = stage / "bin" / "nonstd_dawn.dll"
    if not library.exists() or not dll.exists() or not (stage / "lib" / "vcruntime.lib").is_file():
        for directory in (stage / "lib", stage / "bin"):
            directory.mkdir(parents=True, exist_ok=True)
        exports = stage / "exports.def"
        exports.write_text(definition, encoding="utf-8")
        source = stage / "entry.c"
        source.write_text("/* DLL CRT startup owns Dawn's C++ static initialization. */\n", encoding="utf-8")
        subprocess.run([str(clang), "-shared", "-fuse-ld=lld", "-fms-runtime-lib=dll", str(source),
                        str(dawn / "lib/webgpu_dawn.lib"), "-o", str(dll),
                        f"-Wl,/def:{exports}", f"-Wl,/implib:{library}",
                        "-luser32", "-lonecore_apiset", "-ldxguid"], check=True)
        if not (stage / "include").is_dir():
            shutil.copytree(dawn / "include", stage / "include")
        for name in ("ucrt", "vcruntime"):
            shutil.copy2(windows_import_library(name), stage / "lib" / f"{name}.lib")
    windows_c_libraries(clang, stage)
    return stage


# The C sources that manifests compile on macOS and Linux. On Windows Silk passes include
# directories to Clang as \\?\ paths, where `#include <webgpu/webgpu.h>` is not found, so these are
# compiled here into the Dawn stage and the manifests link them from it.
WINDOWS_C_LIBRARIES = {
    "nonstd_callbacks": (ROOT / "sys/native/callbacks.c", ["-O2"], []),
    "nonstd_abi_layout": (ROOT / "sys/abi/generated_layout.c", ["-DSILK_GPU_ABI_LIBRARY"], ["include/dawn"]),
    "nonstd_bench_support": (ROOT / "bench/support.c", ["-O3", "-g", "-I", str(ROOT / "bench")], []),
}


def windows_c_libraries(clang, stage):
    for name, (source, flags, includes) in WINDOWS_C_LIBRARIES.items():
        library = stage / "lib" / f"{name}.lib"
        command = [str(clang), "-std=c11", "-fms-runtime-lib=dll", "-fms-omit-default-lib", *flags,
                   "-I", str(stage / "include"), *(arg for path in includes for arg in ("-I", str(stage / path)))]
        key = hashlib.sha256(source.read_bytes() + repr(command).encode()).hexdigest()
        stamp = library.with_suffix(".key")
        if library.is_file() and stamp.is_file() and stamp.read_text() == key:
            continue
        object_path = stage / f"{name}.o"
        subprocess.run([*command, "-c", str(source), "-o", str(object_path)], check=True)
        library.unlink(missing_ok=True)
        subprocess.run([str(clang.parent / executable("llvm-ar")), "rcs", str(library), str(object_path)], check=True)
        object_path.unlink()
        stamp.write_text(key)


def windows_import_library(name):
    for directory in os.environ.get("LIB", "").split(os.pathsep):
        if directory and (Path(directory) / f"{name}.lib").is_file():
            return Path(directory) / f"{name}.lib"
    raise RuntimeError(f"Cannot find {name}.lib; run from an x64 Visual Studio 2026 developer shell with the Windows SDK")


def silk_command(subcommand, manifest, release=False, target=None):
    """The pinned compiler's command line for `subcommand` on `manifest`, and its environment."""
    compiler_bin = command_path("install-silk")
    clang = command_path("install-llvm")
    command = [str(compiler_bin / executable("silkc")), subcommand, "--manifest-path", str(manifest),
               "--stdlib", str(compiler_bin.parent / "lib" / "silk" / "stdlib"), "--clang", str(clang)]
    if target:
        command += ["--target", target]
    if release:
        command.append("--release")
    return command, silk_environment(clang)


def silk_environment(clang):
    """The environment for silkc. The pinned Clang finds the macOS SDK, which Objective-C sources
    need for Foundation and AppKit, only through SDKROOT."""
    env = dict(os.environ, SILK_CLANG=str(clang))
    if sys.platform == "darwin" and not env.get("SDKROOT"):
        env["SDKROOT"] = subprocess.check_output(["xcrun", "--show-sdk-path"], text=True).strip()
    return env


def build(package_path, release=False, target=None):
    """Build the package at `package_path` and return its executable."""
    package_path = Path(package_path).resolve()
    if package_path.is_file():
        package_path = package_path.parent
    name = re.search(r'^name = "([^"]+)"', (package_path / "silk.toml").read_text(encoding="utf-8"), re.M).group(1)
    command, env = silk_command("build", package_path / "silk.toml", release, target)
    subprocess.run(command, cwd=REPO, env=env, check=True)
    wasm = target == "wasm32-unknown-unknown"
    profile = "release" if release else "debug"
    file = name if wasm else executable(name)
    # Workspace members build into the shared output directory; other packages into their own.
    candidates = [path for output in (REPO / "build", package_path / "build")
                  for path in (output / "llvm").glob(f"{target or '*'}/{profile}/{file}")]
    if len(candidates) != 1:
        raise RuntimeError(f"Expected one built executable named {file}, found {candidates}")
    program = candidates[0]
    if not wasm and sys.platform == "win32":
        # Windows finds DLLs beside the program. scripts/prepare-windows wrapped Dawn in one.
        dawn = windows_dawn(command_path("install-llvm"), command_path("install-webgpu"))
        shutil.copy2(dawn / "bin" / "nonstd_dawn.dll", program.parent / "nonstd_dawn.dll")
        dxc = command_path("install-dxc")
        for library in ("dxcompiler.dll", "dxil.dll"):
            shutil.copy2(dxc / library, program.parent / library)
    return program
