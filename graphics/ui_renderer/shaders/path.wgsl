// Paths: `vector` coverage strips (4-row bands with one coverage byte per row, packed into a
// word per column) and fully covered runs, placed at the path's integer origin. The band layout
// is gpu_scene's, except that bands start at the sprite's own y and every run has a paint record.
struct Run {
  x: i32,
  y: i32,
  width: u32,
  // Word index of the first column in `alphas`, or SOLID for a fully covered run.
  alpha: u32,
  path: u32,
  // The last row + 1 the path covers.
  bottom: i32,
  unused0: u32,
  unused1: u32,
}
struct PathRecord {
  mask: vec4f,
  paint: Paint,
}
@group(0) @binding(1) var<storage, read> runs: array<Run>;
@group(0) @binding(2) var<storage, read> paths: array<PathRecord>;
@group(0) @binding(3) var<storage, read> alphas: array<u32>;

const SOLID: u32 = 0xffffffffu;

struct Varying { @builtin(position) position: vec4f, @location(0) @interpolate(flat) index: u32 }

@vertex fn vs(@builtin(vertex_index) v: u32, @builtin(instance_index) index: u32) -> Varying {
  let r = runs[index];
  let top = f32(r.y);
  let x = f32(r.x);
  let bounds = vec4f(x, top, x + f32(r.width), f32(min(r.y + 4, r.bottom)));
  return Varying(corner(cover(bounds, paths[r.path].mask), v), index);
}

@fragment fn fs(v: Varying) -> @location(0) vec4f {
  let r = runs[v.index];
  let path = paths[r.path];
  let p = v.position.xy;
  let clip = areaIn(path.mask, p);
  if clip <= 0.0 { discard; }
  var alpha = 1.0;
  if r.alpha != SOLID {
    let column = u32(i32(floor(p.x)) - r.x);
    let row = u32(i32(floor(p.y)) - r.y);
    alpha = f32((alphas[r.alpha + column] >> (8u * row)) & 255u) / 255.0;
  }
  return shade(path.paint, p) * (alpha * clip);
}
