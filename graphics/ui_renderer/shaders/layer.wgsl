// Isolated layers: composite a layer onto a copy of what is under it with a vector.layer blend
// mode and a group opacity (prepended with gpu_scene's blend.wgsl), and copy a finished frame out
// to a target of any format.
struct Params { op: u32, mode: u32, opacity: u32, unused: u32 }
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var backdrop: texture_2d<f32>;
@group(0) @binding(2) var layer: texture_2d<f32>;

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
  let b = bytes(backdrop, pixel);
  if params.opacity == 0u || content.w == 0u { return vec4f(b) / 255.0; }
  var s = content;
  if params.opacity != 255u {
    s = vec4u(div255(s.x * params.opacity), div255(s.y * params.opacity), div255(s.z * params.opacity), div255(s.w * params.opacity));
  }
  return vec4f(blend(b, s, params.mode)) / 255.0;
}
