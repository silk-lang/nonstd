# gpu-webgpu

WebGPU for Silk, natively through [Dawn](https://dawn.googlesource.com/dawn) and in the browser
through `navigator.gpu`, with one API for both. The bindings follow the stable
[`webgpu.h`](https://github.com/webgpu-native/webgpu-headers) schema, so the same code runs on
Vulkan, Metal and D3D and as WebAssembly in a page.

There are two layers:

- `gpu-webgpu-sys` is the raw C layer, generated from the pinned header schema. All 92 records
  are checked against Dawn's own layouts, and all 202 functions are linked.
- `gpu-webgpu` is the safe layer built on it:
  - owned handles that release on drop;
  - descriptors that borrow instead of allocating;
  - typed `GpuError` failures with error scopes;
  - asynchronous requests that can be polled or awaited;
  - mapped buffers with checked copies;
  - capability snapshots;
  - host-owned surfaces.

## Example

```silk
import webgpu.runtime { GpuError, Instance, RequestAdapterOptions }
import webgpu.descriptors { DeviceDescriptor }
import webgpu.capabilities { adapterInfo }
import webgpu_sys.generated_webgpu as sys
import silk.mem.allocator { OutOfMemoryError }

/// Opens the default adapter and a device on it, and reports whether the adapter is a CPU
/// (software) implementation.
pub effect fn openDevice() -> bool ! GpuError | OutOfMemoryError {
  let instance = run Instance.create()
  let adapter = run instance.requestAdapter(&RequestAdapterOptions.default())
  let info = run adapterInfo(&adapter)
  let software = info.adapterType() == sys.WGPUAdapterType_CPU
  let device = run adapter.requestDevice(&DeviceDescriptor.default())
  run device.checkErrors()
  return software
}
```

The blocking `requestAdapter` and `requestDevice` are native conveniences. Each has a
`…Start` form that returns a request to `poll()` and `finish()`, which is what browser code must
use. `examples/src/session.silk` drives a whole sample that way, on both targets.

Native programs link Dawn's static library and a small callback helper
(`sys/native/callbacks.c`); `sys/silk.toml` pins Dawn and declares the native link
configuration, which reaches every program that depends on the packages.
Dependents import the packages as `webgpu` and `webgpu_sys`.

## Packages

| Path | Package | What it is |
| --- | --- | --- |
| `native/gpu/webgpu` | `gpu-webgpu` | The safe API |
| `native/gpu/webgpu/sys` | `gpu-webgpu-sys` | The generated raw bindings and ABI probes |
| `native/gpu/webgpu/examples` | `gpu-webgpu-examples` | Six headless samples (clear, triangle, textured quad, instanced rectangles, compute, MSAA), native and wasm |
| `native/gpu/webgpu/examples-window` | `gpu-webgpu-examples-window` | A GLFW window sample with a real surface and resizing |
| `native/gpu/webgpu/tests/native` | `gpu-webgpu-tests-native` | Native lifetime, readback and validation scenarios |
| `native/gpu/webgpu/bench` | `gpu-webgpu-bench` | The same CPU-side workloads in Silk, C on Dawn, and Rust on wgpu |

`browser/` holds the JavaScript host for the wasm build, and `tests/pixels/` holds the samples'
expected images.

## Platforms

Dawn's pinned release (`v20261027.184652`) runs natively on macOS arm64, Linux x86_64
and Windows x86_64. Tests use Metal on macOS, Mesa lavapipe on Linux, and D3D12 on
Windows. Browsers use Chromium's WebGPU.

Windows builds require LLVM 22 and an x64 Visual Studio 2026 developer shell with
the Windows SDK and current Visual C++ Redistributable. Invoke helpers as
`python native/gpu/webgpu/core/scripts/check`. The build wraps Dawn's pinned static archive
in `nonstd_dawn.dll` so Windows initializes its C++ runtime, then copies the DLL
and checksum-pinned DXC shader compiler beside each executable. The window helper
also installs pinned GLFW unless `GLFW_PREFIX` supplies its DLL and import library.
Keep those DLLs beside executables when moving them.

## Tests

From the repository root:

```sh
python3 native/gpu/webgpu/core/scripts/check              # everything native
python3 native/gpu/webgpu/core/scripts/check --skip-native  # freshness and package checks only
python3 native/gpu/webgpu/core/scripts/check --browser      # also runs the wasm samples in Chromium
```

The gate checks that the generated bindings, browser glue and embedded shaders are fresh. It
compares the compiled ABI against Dawn's headers, runs the native scenarios, and renders all six
samples, comparing them pixel by pixel. The `gpu-webgpu` CI workflow runs it on every pull
request. Weekly, it also runs the GLFW window on X11, the macOS Metal gate, the browser tests and
the instruction-count benchmarks.

## Performance

On the CPU-side workloads (encoding and submitting 10,000 draws, buffer writes or bind-group
switches, or one instanced draw of 10k–100k rectangles), Silk on Dawn runs between 11% faster and
5% slower than the same program in C on the same Dawn binary (median wall time, macOS arm64). [The reference](core/docs/reference.md#cpu-side-benchmarks)
has the tables, the instruction-count method and the Rust/wgpu comparison.

## More

- [Reference](core/docs/reference.md): implementation selection, header compatibility, toolchain
  prerequisites, CI, callback ownership, surfaces, samples, the browser ABI and benchmarks.
- [LIMITATIONS.md](core/LIMITATIONS.md): workarounds for compiler and standard-library gaps.
- [GPU scene renderer](../../../graphics/gpu_scene): 2D vector drawing on top of this package.
