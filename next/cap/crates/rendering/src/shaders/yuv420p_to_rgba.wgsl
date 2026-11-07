@group(0) @binding(0) var y_plane: texture_2d<f32>;
@group(0) @binding(1) var u_plane: texture_2d<f32>;
@group(0) @binding(2) var v_plane: texture_2d<f32>;
@group(0) @binding(3) var output: texture_storage_2d<rgba8unorm, write>;

// BT.709 limited-range decode, matching the BT709/MPEG stream tags written by
// the encoder and the coefficients used by the CPU conversion path.

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let coords = global_id.xy;
    let dims = textureDimensions(output);

    if (coords.x >= dims.x || coords.y >= dims.y) {
        return;
    }

    let y_raw = textureLoad(y_plane, coords, 0).r;

    let uv_coords = coords / 2;
    let u_dims = textureDimensions(u_plane);
    let v_dims = textureDimensions(v_plane);
    let u_clamped = min(uv_coords, u_dims - vec2<u32>(1, 1));
    let v_clamped = min(uv_coords, v_dims - vec2<u32>(1, 1));
    let u_raw = textureLoad(u_plane, u_clamped, 0).r;
    let v_raw = textureLoad(v_plane, v_clamped, 0).r;

    let y = (y_raw - 0.0625) * 1.164;
    let u = u_raw - 0.5;
    let v = v_raw - 0.5;

    let r = y + 1.7926 * v;
    let g = y - 0.2132 * u - 0.5328 * v;
    let b = y + 2.1124 * u;

    let color = vec4<f32>(
        clamp(r, 0.0, 1.0),
        clamp(g, 0.0, 1.0),
        clamp(b, 0.0, 1.0),
        1.0
    );

    textureStore(output, coords, color);
}