// Quads: a rounded rectangle filled with a paint, and a solid or dashed border band over it.
struct Quad {
  bounds: vec4f,
  mask: vec4f,
  // top-left, top-right, bottom-right, bottom-left
  radii: vec4f,
  // top, right, bottom, left
  borders: vec4f,
  // straight alpha; `paint.kind.z` is 1 for a dashed border
  borderColor: vec4f,
  paint: Paint,
}
@group(0) @binding(1) var<storage, read> quads: array<Quad>;

struct Varying { @builtin(position) position: vec4f, @location(0) @interpolate(flat) index: u32 }

@vertex fn vs(@builtin(vertex_index) v: u32, @builtin(instance_index) index: u32) -> Varying {
  let q = quads[index];
  return Varying(corner(cover(q.bounds, q.mask), v), index);
}

const PI: f32 = 3.141592653589793;

fn clampedRadii(r: vec4f, radii: vec4f) -> vec4f {
  let limit = max(min(r.z - r.x, r.w - r.y) * 0.5, 0.0);
  return clamp(radii, vec4f(0.0), vec4f(limit));
}

// A quarter of an ellipse's perimeter (Ramanujan).
fn quarterArc(e: vec2f) -> f32 {
  if e.x <= 0.0 || e.y <= 0.0 { return 0.0; }
  return PI * 0.25 * (3.0 * (e.x + e.y) - sqrt((3.0 * e.x + e.y) * (e.x + 3.0 * e.y)));
}

// Where along the outline of `r` (corner radii `tl`, `tr`, `br`, `bl` as x, y pairs) the point
// nearest to `p` lies, measured from the bottom of the top-left corner, clockwise.
fn perimeterPosition(p: vec2f, r: vec4f, tl: vec2f, tr: vec2f, br: vec2f, bl: vec2f) -> f32 {
  let arcs = vec4f(quarterArc(tl), quarterArc(tr), quarterArc(br), quarterArc(bl));
  let top = max(r.z - tr.x - (r.x + tl.x), 0.0);
  let right = max(r.w - br.y - (r.y + tr.y), 0.0);
  let bottom = max(r.z - br.x - (r.x + bl.x), 0.0);
  let start1 = arcs.x;
  let start2 = start1 + top;
  let start3 = start2 + arcs.y;
  let start4 = start3 + right;
  let start5 = start4 + arcs.z;
  let start6 = start5 + bottom;
  let start7 = start6 + arcs.w;

  // Corner zones, by the arc's angle (y down: angles grow clockwise).
  if p.x < r.x + tl.x && p.y < r.y + tl.y && arcs.x > 0.0 {
    let d = (p - (r.xy + tl)) / tl;
    let a = atan2(d.y, d.x) + 2.0 * PI;
    return clamp((a - PI) / (0.5 * PI), 0.0, 1.0) * arcs.x;
  }
  if p.x > r.z - tr.x && p.y < r.y + tr.y && arcs.y > 0.0 {
    let d = (p - vec2f(r.z - tr.x, r.y + tr.y)) / tr;
    let a = atan2(d.y, d.x) + 2.0 * PI;
    return start2 + clamp((a - 1.5 * PI) / (0.5 * PI), 0.0, 1.0) * arcs.y;
  }
  if p.x > r.z - br.x && p.y > r.w - br.y && arcs.z > 0.0 {
    let d = (p - (r.zw - br)) / br;
    let a = atan2(d.y, d.x);
    return start4 + clamp(a / (0.5 * PI), 0.0, 1.0) * arcs.z;
  }
  if p.x < r.x + bl.x && p.y > r.w - bl.y && arcs.w > 0.0 {
    let d = (p - vec2f(r.x + bl.x, r.w - bl.y)) / bl;
    let a = atan2(d.y, d.x);
    return start6 + clamp((a - 0.5 * PI) / (0.5 * PI), 0.0, 1.0) * arcs.w;
  }

  // Otherwise the nearest straight side.
  let distances = vec4f(abs(p.y - r.y), abs(p.x - r.z), abs(p.y - r.w), abs(p.x - r.x));
  let nearest = min(min(distances.x, distances.y), min(distances.z, distances.w));
  if nearest == distances.x { return start1 + clamp(p.x - (r.x + tl.x), 0.0, top); }
  if nearest == distances.y { return start3 + clamp(p.y - (r.y + tr.y), 0.0, right); }
  if nearest == distances.z { return start5 + clamp(r.z - br.x - p.x, 0.0, bottom); }
  let left = max(r.w - bl.y - (r.y + tl.y), 0.0);
  return start7 + clamp(r.w - bl.y - p.y, 0.0, left);
}

// Coverage of dashes `2 w` long with gaps `w`, starting on at position 0.
fn dashCoverage(s: f32, w: f32) -> f32 {
  let period = 3.0 * w;
  let m = s - period * floor(s / period);
  if m < 2.0 * w {
    return clamp(0.5 + min(m, 2.0 * w - m), 0.0, 1.0);
  }
  return clamp(0.5 - min(m - 2.0 * w, period - m), 0.0, 1.0);
}

@fragment fn fs(v: Varying) -> @location(0) vec4f {
  let q = quads[v.index];
  let p = v.position.xy;
  let clip = areaIn(q.mask, p);
  if clip <= 0.0 { discard; }
  let radii = clampedRadii(q.bounds, q.radii);
  let outer = coverage(roundedRectSdf(p, q.bounds, radii));
  let background = shade(q.paint, p) * outer;

  var border = vec4f(0.0);
  let w = q.borders;
  if q.borderColor.a > 0.0 && max(max(w.x, w.y), max(w.z, w.w)) > 0.0 {
    // The band between the outline and the inner outline inset by the widths, whose corners are
    // elliptical with radii (r - left or right, r - top or bottom).
    let inner = vec4f(q.bounds.x + w.w, q.bounds.y + w.x, q.bounds.z - w.y, q.bounds.w - w.z);
    var inside = 0.0;
    if inner.x < inner.z && inner.y < inner.w {
      let c = p - (inner.xy + inner.zw) * 0.5;
      var e = vec2f(radii.x - w.w, radii.x - w.x);
      if c.x >= 0.0 && c.y < 0.0 { e = vec2f(radii.y - w.y, radii.y - w.x); }
      if c.x >= 0.0 && c.y >= 0.0 { e = vec2f(radii.z - w.y, radii.z - w.z); }
      if c.x < 0.0 && c.y >= 0.0 { e = vec2f(radii.w - w.w, radii.w - w.z); }
      inside = coverage(ellipticRectSdf(p, inner, max(e, vec2f(0.0))));
    }
    var band = max(outer - inside, 0.0);
    if q.paint.kind.z == 1u && band > 0.0 {
      // Dashes along the band's center line, as long as twice the widest edge.
      let widest = max(max(w.x, w.y), max(w.z, w.w));
      let mid = vec4f(q.bounds.x + w.w * 0.5, q.bounds.y + w.x * 0.5, q.bounds.z - w.y * 0.5, q.bounds.w - w.z * 0.5);
      let tl = max(vec2f(radii.x - w.w * 0.5, radii.x - w.x * 0.5), vec2f(0.0));
      let tr = max(vec2f(radii.y - w.y * 0.5, radii.y - w.x * 0.5), vec2f(0.0));
      let br = max(vec2f(radii.z - w.y * 0.5, radii.z - w.z * 0.5), vec2f(0.0));
      let bl = max(vec2f(radii.w - w.w * 0.5, radii.w - w.z * 0.5), vec2f(0.0));
      band = band * dashCoverage(perimeterPosition(p, mid, tl, tr, br, bl), widest);
    }
    border = premultiply(q.borderColor) * band;
  }
  let b = border * clip;
  let g = background * clip;
  return b + g * (1.0 - b.a);
}
