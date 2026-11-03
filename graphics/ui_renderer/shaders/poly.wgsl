// Polychrome sprites: images, color glyphs and color icons from premultiplied RGBA tiles, with
// opacity, corner radii and grayscale.
struct PolySprite {
  bounds: vec4f,
  mask: vec4f,
  tile: vec4f,
  radii: vec4f,
  // opacity, grayscale (1 or 0)
  params: vec4f,
}
@group(0) @binding(1) var<storage, read> sprites: array<PolySprite>;

fn cameraSprite(source: PolySprite) -> PolySprite {
  var s = source;
  let camera = globals.imageCamera;
  let translation = vec4f(camera.zw, camera.zw);
  s.bounds = source.bounds * camera.x + translation;
  s.mask = source.mask * camera.x + translation;
  s.radii = source.radii * camera.x;
  return s;
}

@vertex fn vs(@builtin(vertex_index) v: u32, @builtin(instance_index) index: u32) -> Varying {
  let s = cameraSprite(sprites[index]);
  return Varying(corner(cover(s.bounds, s.mask), v), index);
}

@fragment fn fs(v: Varying) -> @location(0) vec4f {
  let s = cameraSprite(sprites[v.index]);
  let p = v.position.xy;
  let radii = clamp(s.radii, vec4f(0.0), vec4f(max(min(s.bounds.z - s.bounds.x, s.bounds.w - s.bounds.y) * 0.5, 0.0)));
  let weight = coverage(roundedRectSdf(p, s.bounds, radii)) * clamp(s.params.x, 0.0, 1.0) * areaIn(s.mask, p);
  if weight <= 0.0 { discard; }
  var c = sampleTile(s.tile, s.bounds, p);
  if s.params.y != 0.0 {
    let l = dot(c.rgb, vec3f(0.2126, 0.7152, 0.0722));
    c = vec4f(l, l, l, c.a);
  }
  return c * weight;
}
