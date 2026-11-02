// Monochrome sprites: glyphs and icons, a coverage tile tinted with one color, with the
// DirectWrite contrast and gamma correction for text (from Windows Terminal's dwrite.hlsl, MIT,
// as GPUI uses it).
struct MonoSprite {
  bounds: vec4f,
  mask: vec4f,
  // straight alpha
  color: vec4f,
  tile: vec4f,
}
@group(0) @binding(1) var<storage, read> sprites: array<MonoSprite>;

@vertex fn vs(@builtin(vertex_index) v: u32, @builtin(instance_index) index: u32) -> Varying {
  let s = sprites[index];
  return Varying(corner(cover(s.bounds, s.mask), v), index);
}

fn brightness(color: vec3f) -> f32 {
  return dot(color, vec3f(0.30, 0.59, 0.11));
}

// The correction of glyph coverage `alpha` for text of `color`.
fn correctText(alpha: f32, color: vec3f) -> f32 {
  let b = brightness(color);
  let k = globals.contrast * clamp(4.0 * (0.75 - b), 0.0, 1.0);
  let a = alpha * (k + 1.0) / (alpha * k + 1.0);
  let g = globals.gamma;
  let correction = (g.x * b + g.y) * a + (g.z * b + g.w);
  return a + a * (1.0 - a) * correction;
}

@fragment fn fs(v: Varying) -> @location(0) vec4f {
  let s = sprites[v.index];
  let p = v.position.xy;
  let clipped = vec4f(max(s.mask.xy, s.bounds.xy), min(s.mask.zw, s.bounds.zw));
  let clip = areaIn(clipped, p);
  if clip <= 0.0 { discard; }
  let sample = sampleTile(s.tile, s.bounds, p).r;
  let alpha = clamp(correctText(sample, clamp(s.color.rgb, vec3f(0.0), vec3f(1.0))), 0.0, 1.0);
  return premultiply(s.color) * (alpha * clip);
}
