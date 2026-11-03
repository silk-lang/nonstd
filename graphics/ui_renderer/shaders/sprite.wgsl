// Sprite sampling shared by mono.wgsl and poly.wgsl: bilinear at pixel centers, clamped to the
// tile, read with textureLoad so no texel outside the tile is touched.
@group(0) @binding(2) var atlas: texture_2d<f32>;

// Tile `whole` (texel rectangle xMin, yMin, xMax, yMax, clipped to the texture) stretched over
// `bounds`, at pixel center `p`.
fn sampleTile(whole: vec4f, bounds: vec4f, p: vec2f) -> vec4f {
  let dims = vec2f(textureDimensions(atlas));
  let tile = vec4f(min(whole.xy, dims), min(whole.zw, dims));
  let size = tile.zw - tile.xy;
  let uv = (p - bounds.xy) * size / (bounds.zw - bounds.xy);
  let f = clamp(uv - 0.5, vec2f(0.0), size - 1.0);
  let i0 = floor(f);
  let w = f - i0;
  let i1 = min(i0 + 1.0, size - 1.0);
  let a = textureLoad(atlas, vec2u(tile.xy + i0), 0);
  let b = textureLoad(atlas, vec2u(tile.xy + vec2f(i1.x, i0.y)), 0);
  let c = textureLoad(atlas, vec2u(tile.xy + vec2f(i0.x, i1.y)), 0);
  let d = textureLoad(atlas, vec2u(tile.xy + i1), 0);
  return mix(mix(a, b, w.x), mix(c, d, w.x), w.y);
}

struct Varying { @builtin(position) position: vec4f, @location(0) @interpolate(flat) index: u32 }
