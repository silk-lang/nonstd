// Isolated layers: composite a layer onto a copy of what is under it with a vector.layer blend
// mode and a group opacity (prepended with gpu_scene's blend.wgsl), and copy a finished frame out
// to a target of any format.
struct Params { op: u32, mode: u32, opacity: u32, backdropEnabled: u32, clip: vec4f, radius: f32, shape: u32, unused: vec2u }
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var backdrop: texture_2d<f32>;
@group(0) @binding(2) var layer: texture_2d<f32>;
@group(0) @binding(3) var filteredBackdrop: texture_2d<f32>;

const OP_COMPOSITE: u32 = 0u;
const OP_COPY: u32 = 1u;

@vertex fn vs(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((index << 1u) & 2u), f32(index & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}

@fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let pixel = vec2u(position.xy);
  let content = bytes(layer, pixel);
  if params.op == OP_COPY { return vec4f(content) / 255.0; }
  var b = bytes(backdrop, pixel);
  if params.backdropEnabled != 0u {
    let halfSize = (params.clip.zw - params.clip.xy) * 0.5;
    let p = position.xy - (params.clip.xy + halfSize);
    let radius = min(params.radius, min(halfSize.x, halfSize.y));
    let q = abs(p) - halfSize + radius;
    var distance = length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0) - radius;
    if params.shape == 1u {
      let normalized = p / max(halfSize, vec2f(0.001));
      distance = (length(normalized) - 1.0) * min(halfSize.x, halfSize.y);
    }
    let coverage = clamp(0.5 - distance, 0.0, 1.0) * f32(params.opacity) / 255.0;
    b = vec4u(round(mix(vec4f(b), vec4f(bytes(filteredBackdrop, pixel)), coverage)));
  }
  if params.opacity == 0u || content.w == 0u { return vec4f(b) / 255.0; }
  var s = content;
  if params.opacity != 255u {
    s = vec4u(div255(s.x * params.opacity), div255(s.y * params.opacity), div255(s.z * params.opacity), div255(s.w * params.opacity));
  }
  return vec4f(blend(b, s, params.mode)) / 255.0;
}
