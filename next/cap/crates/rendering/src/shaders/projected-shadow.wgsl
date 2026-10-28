struct ShadowUniforms {
    geometry: vec4<f32>,
    opacity: vec4<f32>,
};

@group(0) @binding(0) var<uniform> u: ShadowUniforms;
@group(0) @binding(1) var source: texture_2d<f32>;
@group(0) @binding(2) var source_sampler: sampler;

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) index: u32) -> VertexOutput {
    let uv = vec2<f32>(f32((index << 1u) & 2u), f32(index & 2u));
    var result: VertexOutput;
    result.position = vec4<f32>(uv * 2.0 - 1.0, 0.0, 1.0);
    result.uv = vec2<f32>(uv.x, 1.0 - uv.y);
    return result;
}

fn alpha_at(uv: vec2<f32>) -> f32 {
    let alpha = textureSampleLevel(source, source_sampler, clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0)), 0.0).a;
    return select(0.0, alpha, all(uv >= vec2<f32>(0.0)) && all(uv <= vec2<f32>(1.0)));
}

@fragment
fn fs_spread(in: VertexOutput) -> @location(0) vec4<f32> {
    var alpha = alpha_at(in.uv);
    for (var index = 0u; index < 16u; index++) {
        let angle = f32(index) * 0.3926990817;
        let offset = vec2<f32>(cos(angle), sin(angle)) * u.geometry.z * u.geometry.xy;
        alpha = max(alpha, alpha_at(in.uv + offset));
    }
    return vec4<f32>(0.0, 0.0, 0.0, alpha);
}

fn blurred_alpha(uv: vec2<f32>, direction: vec2<f32>) -> f32 {
    let sigma = u.geometry.w;
    if sigma < 0.1 {
        return alpha_at(uv);
    }
    var alpha = 0.0;
    var total = 0.0;
    for (var index = -12; index <= 12; index++) {
        let distance = f32(index) * sigma * 0.25;
        let weight = exp(-0.5 * distance * distance / (sigma * sigma));
        alpha += alpha_at(uv + direction * distance * u.geometry.xy) * weight;
        total += weight;
    }
    return alpha / total;
}

@fragment
fn fs_horizontal(in: VertexOutput) -> @location(0) vec4<f32> {
    return vec4<f32>(0.0, 0.0, 0.0, blurred_alpha(in.uv, vec2<f32>(1.0, 0.0)));
}

@fragment
fn fs_vertical(in: VertexOutput) -> @location(0) vec4<f32> {
    return vec4<f32>(0.0, 0.0, 0.0, blurred_alpha(in.uv, vec2<f32>(0.0, 1.0)) * u.opacity.x);
}
