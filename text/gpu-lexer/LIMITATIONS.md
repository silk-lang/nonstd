# Silk limitations

## 1. No byte view of a `[u32]`
- Status: worked around, filed as silk-lang/silk#2655
- Found: 2026-10-30, Silk 0.1.0-dev.33+b6c479e631a5
- Cost: one `unsafe` helper; no copy.
- Workaround: `src/gpu_util.silk` `wordBytes` (LIMITATION-1) reinterprets the slice pointer to
  upload u32 tables with `Queue.writeBuffer`, which takes `&[u8]`.

## 2. Constant arrays cannot hold byte strings
- Status: worked around, not filed (constants are limited to scalars, `string`, arrays and
  structs of those by design)
- Cost: entry-point names come from a `match` (`tree.entryPoint`, `generated_models.liteStep`).
