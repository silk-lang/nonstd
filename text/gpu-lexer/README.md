# text-gpu-lexer

A Silk port of [gpu-lexer](https://github.com/vercel-labs/gpu-lexer): a language-agnostic
syntax lexer that runs a small learned model on WebGPU. It takes source text with no language
argument and no grammar, and returns display spans in nine classes: `plain`, `comment`,
`string`, `number`, `keyword`, `type`, `function`, `constant` and `operator`.

It runs natively through Dawn (Vulkan, Metal) and in the browser through `navigator.gpu`, using
[`gpu/webgpu`](../../gpu/webgpu).

## Example

```silk
import gpu_lexer.lexer { Lexer, Options }
import gpu_lexer.spans { Span, SyntaxClass }
import webgpu.runtime { GpuError }
import silk.collections.list { List }
import silk.mem.allocator { Allocator, OutOfMemoryError }

/// Counts the keyword spans in `source`.
pub effect fn keywords(source: &[u8]) -> usize ! GpuError | OutOfMemoryError ? &mut Allocator {
  let mut lexer = run Lexer.open(Options.default())
  let spans = run lexer.parse(source)
  let mut count: usize = 0
  let mut index: usize = 0
  while index < spans.length() {
    if spans.get(index).kind == SyntaxClass.Keyword { count = count + 1 }
    index = index + 1
  }
  return count
}
```

- `Lexer` runs the default tree model and `LiteLexer` the lite model, like the original's
  `gpu-lexer` and `gpu-lexer/lite` entries. Each keeps its device, pipelines, weights and
  grow-only buffers between calls.
- `parse(source)` returns non-overlapping spans that cover the source in order.
  `parseMany(sources, output)` lexes a batch in one GPU submission.
- `Lexer.open` and `LiteLexer.open` create a native device; `make(device, ...)` uses one you
  already have.
- `parse` and `parseMany` wait for the GPU. In a browser, call `submit`, `poll` the request from
  the event loop, then `finish`.

## How it works

The CPU makes one pass over the source, splitting it into word runs, horizontal-space runs,
newlines and single symbols, and packs each part's features into two words: kind, length
bucket, first and last character, word hashes, line-start and shape flags, and neighboring-pair
codes (`src/tree_parts.silk`, `src/lite_parts.silk`). The GPU embeds those features and runs the
model; the CPU merges equal neighboring labels into spans.

- **Tree model** (`src/tree.silk`): 32 hidden channels, a five-part local window,
  bidirectional affine scans over 32-part blocks with exact block prefixes, and a binary tree
  that merges blocks bottom-up and sends whole-source context back down. 41,321 int6 weights,
  expanded to f32 once at startup. Seven compute passes in one command buffer.
- **Lite model** (`src/lite.silk`): a convolution and scan network with bit-packed weights,
  18 passes, up to 64 sources per dispatch.

Both models are gpu-lexer's own promoted checkpoints (`model/`). `generator/generate.mjs` turns
them into `src/generated_models.silk` and `src/generated_shaders.silk`, using gpu-lexer's own
shader generator (`generator/`, unchanged, MIT) so that a newly trained checkpoint gets the
shader its training expects.

## Parity with the original

`tests/` compares this port with gpu-lexer at commit `4f36e39` on 18 fixtures (17 languages plus
Unicode, CRLF and tabs). `tests/expected` was produced by the original: CPU features in Node,
spans in Chromium's WebGPU (`scripts/expected.mjs`).

- Both CPU passes match word for word.
- On SwiftShader, the Vulkan device Chromium used, both models' spans match exactly.
- On lavapipe (CI), the lite model matches exactly and the tree model differs on 30 of 7,963
  bytes: lavapipe rounds `tanh` and `exp` differently, which flips a few near-ties. The gate
  allows 1% on devices other than SwiftShader.

To run against SwiftShader locally, point Vulkan at Chromium's copy:
`VK_ICD_FILENAMES=<chromium>/vk_swiftshader_icd.json python3 text/gpu-lexer/scripts/check`.

### Known differences

- Offsets are UTF-8 byte offsets, not UTF-16 code units. The models still see UTF-16: a
  non-ASCII scalar counts as one or two word units in lengths and hashes, exactly as in
  JavaScript. Invalid UTF-8 counts as one U+FFFD per byte.
- Batching is explicit (`parseMany`) instead of coalescing calls made in one microtask.
- Sources must be shorter than 4 GiB.

## Tests

From the repository root:

```sh
python3 text/gpu-lexer/scripts/check               # everything, on the native device
python3 text/gpu-lexer/scripts/check --skip-native # generated modules, packages, unit tests
```

The native part needs Dawn and a Vulkan driver (lavapipe in CI); see `gpu/webgpu`.
`node text/gpu-lexer/scripts/expected.mjs <gpu-lexer checkout>` regenerates `tests/expected`
from the original (Node, plus Playwright's Chromium for the spans).

## License

MIT. gpu-lexer is MIT © Shu Ding; its models, shader generator and lite shader are used here
under that license (`generator/LICENSE`).
