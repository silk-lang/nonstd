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
(`native/callbacks.c`); `scripts/_build.py` shows the exact link line for macOS and Linux.
Dependents import the packages as `webgpu` and `webgpu_sys`.

## Packages

| Path | Package | What it is |
| --- | --- | --- |
| `gpu/webgpu` | `gpu-webgpu` | The safe API |
| `gpu/webgpu/sys` | `gpu-webgpu-sys` | The generated raw bindings and ABI probes |
| `gpu/webgpu/examples` | `gpu-webgpu-examples` | Six headless samples (clear, triangle, textured quad, instanced rectangles, compute, MSAA), native and wasm |
| `gpu/webgpu/examples-window` | `gpu-webgpu-examples-window` | A GLFW window sample with a real surface and resizing |
| `gpu/webgpu/tests/native` | `gpu-webgpu-tests-native` | Native lifetime, readback and validation scenarios |
| `gpu/webgpu/bench` | `gpu-webgpu-bench` | The same CPU-side workloads in Silk, C on Dawn, and Rust on wgpu |

`browser/` holds the JavaScript host for the wasm build, and `tests/pixels/` holds the samples'
expected images.

## Platforms

Dawn's pinned release (`v20261027.184652`) runs natively on macOS arm64 and Linux x86_64 and is
tested on both: Metal on macOS, and Mesa lavapipe in Linux CI. Browsers are tested with
Chromium's WebGPU. Windows is blocked until Silk has a native Windows target
([silk-lang/silk#2542](https://github.com/silk-lang/silk/issues/2542)).

## Tests

From the repository root:

```sh
python3 gpu/webgpu/scripts/check              # everything native
python3 gpu/webgpu/scripts/check --skip-native  # freshness and package checks only
python3 gpu/webgpu/scripts/check --browser      # also runs the wasm samples in Chromium
```

The gate checks that the generated bindings, browser glue and embedded shaders are fresh. It
compares the compiled ABI against Dawn's headers, runs the native scenarios, and renders all six
samples, comparing them pixel by pixel. The `gpu-webgpu` CI workflow runs it on every pull
request. Weekly, it also runs the GLFW window on X11, the macOS Metal gate, the browser tests and
the instruction-count benchmarks.

## Performance

On the CPU-side workloads (encoding and submitting 10,000 draws, buffer writes or bind-group
switches, or one instanced draw of 10k–100k rectangles), Silk on Dawn runs between 11% faster and
5% slower than the same program in C on the same Dawn binary (median wall time, macOS arm64). [The reference](docs/reference.md#cpu-side-benchmarks)
has the tables, the instruction-count method and the Rust/wgpu comparison.

## More

- [Reference](docs/reference.md): implementation selection, header compatibility, toolchain
  prerequisites, CI, callback ownership, surfaces, samples, the browser ABI and benchmarks.
- [LIMITATIONS.md](LIMITATIONS.md): workarounds for compiler and standard-library gaps.
- [GPU scene renderer](../../images/svg/gpu_scene): 2D vector drawing on top of this package.
