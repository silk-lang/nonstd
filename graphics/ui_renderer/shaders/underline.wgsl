// Underlines: the top `thickness` rows of the bounds, or a sine wave of that stroke width with
// wavelength 8 * thickness, centered in the bounds.
struct Underline {
  bounds: vec4f,
  mask: vec4f,
  // straight alpha
  color: vec4f,
  // thickness, wavy (1 or 0)
  params: vec4f,
}
@group(0) @binding(1) var<storage, read> underlines: array<Underline>;

struct Varying { @builtin(position) position: vec4f, @location(0) @interpolate(flat) index: u32 }

@vertex fn vs(@builtin(vertex_index) v: u32, @builtin(instance_index) index: u32) -> Varying {
  let u = underlines[index];
  return Varying(corner(cover(u.bounds, u.mask), v), index);
}

const TAU: f32 = 6.283185307179586;

@fragment fn fs(v: Varying) -> @location(0) vec4f {
  let u = underlines[v.index];
  let p = v.position.xy;
  let b = u.bounds;
  let thickness = u.params.x;
  var alpha = 0.0;
  if u.params.y == 0.0 {
    alpha = areaIn(vec4f(b.x, b.y, b.z, min(b.y + thickness, b.w)), p) * areaIn(u.mask, p);
  } else {
    // Distance to the wave, to first order: the vertical gap over the slope's length.
    let amplitude = max((b.w - b.y - thickness) * 0.5, 0.0);
    let k = TAU / (8.0 * thickness);
    let x = p.x - b.x;
    let gap = p.y - (b.y + b.w) * 0.5 - amplitude * sin(k * x);
    let slope = amplitude * k * cos(k * x);
    let distance = abs(gap) / sqrt(1.0 + slope * slope);
    let clipped = vec4f(max(u.mask.xy, b.xy), min(u.mask.zw, b.zw));
    alpha = clamp(thickness * 0.5 - distance + 0.5, 0.0, 1.0) * areaIn(clipped, p);
  }
  if alpha <= 0.0 { discard; }
  return premultiply(u.color) * alpha;
}
