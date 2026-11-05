# graphics-gpu-scene

Draws [graphics-vector](../vector) scenes on the GPU through [gpu-webgpu](../../native/gpu/webgpu),
producing the same bytes as the CPU renderer. Geometry and coverage are still computed on the
CPU. The GPU packs strips, alphas and paints into storage buffers and paints and composites them
in instanced render passes, as in [vello_hybrid](https://github.com/linebender/vello/tree/main/sparse_strips).

It covers what `vector` paints: solid, gradient and image paints, layers with masks, clips,
opacity and blend modes, and all of the filter primitives. The renderer pools its textures,
buffers and uniforms across frames.

[docs/scene-renderer.md](core/docs/scene-renderer.md) explains the pipeline, the buffer layouts and how
exactness is kept between CPU and GPU.

## Packages

| Path | Package | What it is |
| --- | --- | --- |
| `graphics/gpu_scene` | `graphics-gpu-scene` | The renderer |
| `graphics/gpu_scene/tests` | `graphics-gpu-scene-tests` | Renders each scene on the CPU and the GPU and compares bytes |

The WGSL shaders live in `shaders/`, and `native/gpu/webgpu/core/scripts/embed-shaders` embeds them in
`src/generated_shaders.silk`. Edit the `.wgsl` files, never the generated module.

## Tests

From the repository root, with a Vulkan, Metal or D3D driver available (CI uses lavapipe):

```sh
svg/core/scripts/check-vector
```

Every scene comparison requires identical bytes. The one exception is a single specular lighting
case, which allows a channel delta of 1. The check runs in the `graphics-vector` CI workflow.

Dependents import the package as `gpu_scene`.
