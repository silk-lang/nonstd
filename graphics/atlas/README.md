# graphics-atlas

A texture atlas allocator for the UI renderer: it packs glyphs, icons and images into a few large
textures and evicts what has not been drawn recently. It is bookkeeping only. It never holds pixels
and has no GPU dependency, so the same code serves native WebGPU, browser WebGPU (wasm32) and the
CPU reference renderer.

## Modules

- `shelf`: `ShelfAllocator` packs rectangles into one texture. The texture is cut into shelves
  whose heights are rounded up to buckets (steps of 2 px up to 16, then 4, 8, 16 and 32), so glyphs
  of one size share a shelf. Freed space merges with free neighbours, and empty shelves merge back
  together, so the space is reusable by items of any height. Handles carry a generation and go
  stale when freed.
- `atlas`: `Atlas` manages many textures, one `Kind` each (`Monochrome` for A8 coverage,
  `Subpixel` and `Polychrome` for RGBA8), and remembers the frame each tile was last used in.

## A frame

```silk
import atlas.atlas { Atlas, AtlasError, AtlasTile, Kind, TileId }
import silk.core.option { Option }
import silk.mem.allocator { Allocator, OutOfMemoryError }

/// Returns the tile for a glyph, reusing `cached` while it is live.
pub effect fn glyphTile(atlas: &mut Atlas, cached: TileId, width: u32, height: u32) -> AtlasTile
  ! AtlasError | OutOfMemoryError
  ? &mut Allocator {
  if atlas.touch(cached) {
    if let Option<AtlasTile>.Some { value } = atlas.get(cached) {
      return value
    }
  }
  // A miss: reserve space, then rasterize into tile.bounds of texture tile.texture.
  return run atlas.allocate(Kind.Monochrome, width, height)
}
```

Each frame:

1. `atlas.beginFrame()`.
2. For each glyph or icon drawn, `atlas.touch(id)`. It returns false when the tile was evicted;
   then `atlas.allocate(kind, width, height)` and draw its pixels again.
3. When `atlas.textureCount()` grew, create the new textures (`atlas.texture(i)` gives the kind and
   size). Write new tiles' pixels at `tile.bounds` (`queue.writeTexture` on WebGPU).
4. Read `atlas.evicted()` to drop cache keys that point at evicted tiles, then
   `atlas.clearEvicted()`.

`allocate` never evicts a tile used in the current frame, because the scene being built still
draws it. When a kind is out of room and already has `maxTextures` textures, it evicts the least
recently used tiles of that kind, oldest first, until the request fits; if it cannot, it fails
with `AtlasError.Full`. `evictUnusedSince(frame)` drops every tile not drawn since `frame`, for
example to free memory after a scene change.

## Options

| Field | Default | Meaning |
| --- | --- | --- |
| `textureSize` | 1024 | Side of a new square texture. A larger tile gets the next power of two |
| `maxTextureSize` | 8192 | Largest side created. 8192 is the `maxTextureDimension2D` every WebGPU adapter supports |
| `maxTextures` | 4 | Textures per kind before eviction starts |
| `padding` | 0 | Empty pixels around each tile, for tiles sampled with bilinear filtering |

Textures never change size after creation, because a WebGPU texture cannot grow in place.

## Tests

```sh
silk test --manifest-path graphics/atlas/silk.toml --root src/tests.silk
```

The tests check that tiles never overlap and stay inside their texture (random glyph sizes,
churn, a 60-frame cache simulation), the fill ratio (at least 85% of a 512 x 512 texture with
random glyph-sized tiles before the first refusal, 100% for uniform tiles), merging back to an
empty texture, stale ids, padding, texture growth, and eviction order.
