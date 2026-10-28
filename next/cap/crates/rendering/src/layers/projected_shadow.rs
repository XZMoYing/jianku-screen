use bytemuck::{Pod, Zeroable};
use wgpu::util::DeviceExt;

use crate::{ProjectUniforms, composite_frame::CompositeVideoFrameUniforms};

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ProjectedShadowSource {
    strength: f32,
    size: f32,
    opacity: f32,
    blur: f32,
    half_edge: f32,
}

impl ProjectedShadowSource {
    pub fn from_composite(uniforms: &CompositeVideoFrameUniforms) -> Self {
        Self {
            strength: uniforms.shadow,
            size: uniforms.shadow_size,
            opacity: uniforms.shadow_opacity,
            blur: uniforms.shadow_blur,
            half_edge: (uniforms.target_bounds[2] - uniforms.target_bounds[0])
                .min(uniforms.target_bounds[3] - uniforms.target_bounds[1])
                * 0.5,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct ShadowSettings {
    spread: f32,
    sigma: f32,
    opacity: f32,
}

impl ShadowSettings {
    fn blend(values: impl Iterator<Item = Self>) -> Option<Self> {
        let mut first = None;
        let mut count = 0;
        let mut weights = 0.0;
        let mut spread = 0.0;
        let mut sigma = 0.0;
        let mut remaining = 1.0;
        for settings in values {
            first.get_or_insert(settings);
            count += 1;
            weights += settings.opacity;
            spread += settings.spread * settings.opacity;
            sigma += settings.sigma * settings.opacity;
            remaining *= 1.0 - settings.opacity;
        }
        if count <= 1 {
            return first;
        }
        Some(Self {
            spread: spread / weights,
            sigma: sigma / weights,
            opacity: 1.0 - remaining,
        })
    }

    fn new(
        activity: f32,
        strength: f32,
        size: f32,
        opacity: f32,
        blur: f32,
        half_edge: f32,
    ) -> Option<Self> {
        if ![activity, strength, size, opacity, blur, half_edge]
            .iter()
            .all(|v| v.is_finite())
        {
            return None;
        }
        let strength = strength.clamp(0.0, 100.0) / 100.0;
        let remaining = 1.0 - activity.clamp(0.0, 1.0);
        // The existing flat pass fades both strength and opacity at the boundary.
        let weight = 1.0 - remaining * remaining;
        let opacity = strength * opacity.clamp(0.0, 100.0) / 100.0 * weight;
        if opacity <= 0.0 || half_edge <= 0.0 {
            return None;
        }
        let size = strength * size.clamp(0.0, 100.0) / 100.0 * half_edge;
        let blur = strength * blur.clamp(0.0, 100.0) / 100.0 * half_edge;
        let spread = size * 0.5;
        let sigma = (size + 2.0 * blur) * 0.25;
        if !spread.is_finite() || !sigma.is_finite() {
            return None;
        }
        Some(Self {
            spread,
            sigma,
            opacity,
        })
    }
}

#[repr(C)]
#[derive(Clone, Copy, PartialEq, Pod, Zeroable)]
struct ShadowUniforms {
    geometry: [f32; 4],
    opacity: [f32; 4],
}

struct ShadowTextures {
    mask: wgpu::Texture,
    mask_view: wgpu::TextureView,
    projection: wgpu::Texture,
    projection_view: wgpu::TextureView,
    mask_group: wgpu::BindGroup,
    projection_group: wgpu::BindGroup,
}

struct ShadowPipelines {
    layout: wgpu::BindGroupLayout,
    spread: wgpu::RenderPipeline,
    horizontal: wgpu::RenderPipeline,
    vertical: wgpu::RenderPipeline,
}

pub struct ProjectedShadowLayer {
    settings: Option<ShadowSettings>,
    textures: Option<ShadowTextures>,
    pipelines: Option<ShadowPipelines>,
    buffer: wgpu::Buffer,
    sampler: wgpu::Sampler,
    cached_uniforms: Option<ShadowUniforms>,
}

impl ProjectedShadowLayer {
    pub fn new(device: &wgpu::Device) -> Self {
        Self {
            settings: None,
            textures: None,
            pipelines: None,
            buffer: device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("Projected shadow uniforms"),
                contents: bytemuck::bytes_of(&ShadowUniforms::zeroed()),
                usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            }),
            sampler: device.create_sampler(&wgpu::SamplerDescriptor {
                label: Some("Projected shadow sampler"),
                mag_filter: wgpu::FilterMode::Linear,
                min_filter: wgpu::FilterMode::Linear,
                ..Default::default()
            }),
            cached_uniforms: None,
        }
    }

    pub fn prepare(
        &mut self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        uniforms: &ProjectUniforms,
        warp_active: bool,
    ) {
        self.settings = None;
        if !warp_active
            || !uniforms.scene.should_render_screen()
            || uniforms.display.opacity <= 0.001
        {
            return;
        }
        let activity = uniforms.camera3d.map_or(0.0, |frame| frame.activity as f32);
        let candidates = uniforms
            .screen_shadow_sources
            .iter()
            .flatten()
            .filter_map(|source| {
                ShadowSettings::new(
                    activity,
                    source.strength,
                    source.size,
                    source.opacity,
                    source.blur,
                    source.half_edge,
                )
            });
        let Some(settings) = ShadowSettings::blend(candidates) else {
            return;
        };
        if self.pipelines.is_none() {
            self.pipelines = Some(ShadowPipelines::new(device));
        }
        let (width, height) = (uniforms.output_size.0.max(1), uniforms.output_size.1.max(1));
        if !self.textures.as_ref().is_some_and(|textures| {
            textures.mask.width() == width
                && textures.mask.height() == height
                && textures.projection.width() == width
                && textures.projection.height() == height
        }) {
            let create = |label| {
                device.create_texture(&wgpu::TextureDescriptor {
                    label: Some(label),
                    size: wgpu::Extent3d {
                        width,
                        height,
                        depth_or_array_layers: 1,
                    },
                    mip_level_count: 1,
                    sample_count: 1,
                    dimension: wgpu::TextureDimension::D2,
                    format: wgpu::TextureFormat::Rgba8Unorm,
                    usage: wgpu::TextureUsages::RENDER_ATTACHMENT
                        | wgpu::TextureUsages::TEXTURE_BINDING,
                    view_formats: &[],
                })
            };
            let mask = create("Screen shadow mask");
            let projection = create("Projected screen shadow mask");
            let mask_view = mask.create_view(&Default::default());
            let projection_view = projection.create_view(&Default::default());
            let pipelines = self.pipelines.as_ref().expect("shadow pipelines prepared");
            let group = |source| {
                device.create_bind_group(&wgpu::BindGroupDescriptor {
                    label: Some("Projected shadow cached bind group"),
                    layout: &pipelines.layout,
                    entries: &[
                        wgpu::BindGroupEntry {
                            binding: 0,
                            resource: self.buffer.as_entire_binding(),
                        },
                        wgpu::BindGroupEntry {
                            binding: 1,
                            resource: wgpu::BindingResource::TextureView(source),
                        },
                        wgpu::BindGroupEntry {
                            binding: 2,
                            resource: wgpu::BindingResource::Sampler(&self.sampler),
                        },
                    ],
                })
            };
            self.textures = Some(ShadowTextures {
                mask_group: group(&mask_view),
                projection_group: group(&projection_view),
                mask,
                mask_view,
                projection,
                projection_view,
            });
        }
        let values = ShadowUniforms {
            geometry: [
                1.0 / width as f32,
                1.0 / height as f32,
                settings.spread,
                settings.sigma,
            ],
            opacity: [settings.opacity, 0.0, 0.0, 0.0],
        };
        if self.cached_uniforms != Some(values) {
            queue.write_buffer(&self.buffer, 0, bytemuck::bytes_of(&values));
            self.cached_uniforms = Some(values);
        }
        self.settings = Some(settings);
    }

    pub fn views(&self) -> Option<(&wgpu::TextureView, &wgpu::TextureView)> {
        self.settings?;
        self.textures
            .as_ref()
            .map(|textures| (&textures.mask_view, &textures.projection_view))
    }

    pub fn has_spread(&self) -> bool {
        self.settings.is_some_and(|settings| settings.spread > 0.01)
    }

    pub fn render_spread(&self, pass: &mut wgpu::RenderPass<'_>) {
        if let Some(pipelines) = &self.pipelines {
            self.render(pass, &pipelines.spread, false);
        }
    }

    pub fn render_horizontal(&self, pass: &mut wgpu::RenderPass<'_>, source_is_mask: bool) {
        if let Some(pipelines) = &self.pipelines {
            self.render(pass, &pipelines.horizontal, source_is_mask);
        }
    }

    pub fn render_vertical(&self, pass: &mut wgpu::RenderPass<'_>, source_is_mask: bool) {
        if let Some(pipelines) = &self.pipelines {
            self.render(pass, &pipelines.vertical, source_is_mask);
        }
    }

    fn render(
        &self,
        pass: &mut wgpu::RenderPass<'_>,
        pipeline: &wgpu::RenderPipeline,
        source_is_mask: bool,
    ) {
        let Some(textures) = &self.textures else {
            return;
        };
        let group = if source_is_mask {
            &textures.mask_group
        } else {
            &textures.projection_group
        };
        pass.set_pipeline(pipeline);
        pass.set_bind_group(0, group, &[]);
        pass.draw(0..3, 0..1);
    }
}

impl ShadowPipelines {
    fn new(device: &wgpu::Device) -> Self {
        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("Projected shadow layout"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: true },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 2,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                    count: None,
                },
            ],
        });
        let shader =
            device.create_shader_module(wgpu::include_wgsl!("../shaders/projected-shadow.wgsl"));
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("Projected shadow pipeline layout"),
            bind_group_layouts: &[&layout],
            push_constant_ranges: &[],
        });
        let create = |entry, blend| {
            device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some(entry),
                layout: Some(&pipeline_layout),
                vertex: wgpu::VertexState {
                    module: &shader,
                    entry_point: Some("vs_main"),
                    buffers: &[],
                    compilation_options: Default::default(),
                },
                fragment: Some(wgpu::FragmentState {
                    module: &shader,
                    entry_point: Some(entry),
                    targets: &[Some(wgpu::ColorTargetState {
                        format: wgpu::TextureFormat::Rgba8Unorm,
                        blend: Some(blend),
                        write_mask: wgpu::ColorWrites::ALL,
                    })],
                    compilation_options: Default::default(),
                }),
                primitive: Default::default(),
                depth_stencil: None,
                multisample: Default::default(),
                multiview: None,
                cache: None,
            })
        };
        Self {
            spread: create("fs_spread", wgpu::BlendState::REPLACE),
            horizontal: create("fs_horizontal", wgpu::BlendState::REPLACE),
            vertical: create(
                "fs_vertical",
                wgpu::BlendState::PREMULTIPLIED_ALPHA_BLENDING,
            ),
            layout,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blending_shadow_owners_does_not_jump_when_their_strengths_cross() {
        let at = |delta: f32| {
            ShadowSettings::blend(
                [
                    ShadowSettings {
                        spread: 4.0,
                        sigma: 2.0,
                        opacity: 0.5 + delta,
                    },
                    ShadowSettings {
                        spread: 20.0,
                        sigma: 10.0,
                        opacity: 0.5 - delta,
                    },
                ]
                .into_iter(),
            )
            .unwrap()
        };
        let left = at(-0.00001);
        let right = at(0.00001);
        assert!((left.spread - right.spread).abs() < 0.001);
        assert!((left.sigma - right.sigma).abs() < 0.001);
        assert!((at(0.0).opacity - 0.75).abs() < 1e-6);
        assert!(ShadowSettings::blend(std::iter::empty()).is_none());
        assert_eq!(ShadowSettings::blend(std::iter::once(left)), Some(left));
    }

    #[test]
    fn disabling_shadow_or_activity_never_adds_a_pass() {
        for (activity, strength, opacity) in [(0.0, 60.0, 30.0), (1.0, 0.0, 30.0), (1.0, 60.0, 0.0)]
        {
            assert!(ShadowSettings::new(activity, strength, 25.0, opacity, 30.0, 300.0).is_none());
        }
    }

    #[test]
    fn output_scale_changes_softness_and_spread_together() {
        let small = ShadowSettings::new(1.0, 60.0, 25.0, 30.0, 30.0, 300.0).unwrap();
        let large = ShadowSettings::new(1.0, 60.0, 25.0, 30.0, 30.0, 600.0).unwrap();
        assert_eq!(large.spread, small.spread * 2.0);
        assert_eq!(large.sigma, small.sigma * 2.0);
        assert_eq!(large.opacity, small.opacity);
    }

    #[test]
    fn projected_opacity_complements_the_existing_flat_shadow() {
        for activity in [0.1_f32, 0.25, 0.5, 0.75, 1.0] {
            let settings = ShadowSettings::new(activity, 100.0, 25.0, 100.0, 30.0, 300.0).unwrap();
            let flat = (1.0 - activity).powi(2);
            assert!((settings.opacity + flat - 1.0).abs() < 1e-6);
        }
    }

    #[test]
    fn invalid_or_empty_geometry_does_not_reach_the_gpu() {
        for invalid in [f32::NAN, f32::INFINITY, f32::NEG_INFINITY, 0.0, -1.0] {
            assert!(ShadowSettings::new(1.0, 60.0, 25.0, 30.0, 30.0, invalid).is_none());
        }
        assert!(ShadowSettings::new(f32::NAN, 60.0, 25.0, 30.0, 30.0, 300.0).is_none());
        assert!(ShadowSettings::new(1.0, 100.0, 100.0, 100.0, 100.0, f32::MAX).is_none());
    }
}
