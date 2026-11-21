use cap_project::ClipTransitionType;
use wgpu::util::DeviceExt;

#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
struct TransitionUniforms {
    progress: f32,
    kind: u32,
    opaque: u32,
    padding: u32,
    outgoing: [f32; 4],
    incoming: [f32; 4],
    wipe: [f32; 4],
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TransitionLayer {
    pub offset: [f32; 2],
    pub scale: f32,
    pub opacity: f32,
}

impl TransitionLayer {
    const IDENTITY: Self = Self {
        offset: [0.0, 0.0],
        scale: 1.0,
        opacity: 1.0,
    };

    fn packed(self) -> [f32; 4] {
        [self.offset[0], self.offset[1], self.scale, self.opacity]
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TransitionWipe {
    pub direction: [f32; 2],
    pub edge: f32,
    pub feather: f32,
}

impl TransitionWipe {
    pub fn coverage(self, uv: [f32; 2]) -> f32 {
        let along = |value: f32, direction: f32| {
            if direction < 0.0 {
                (1.0 - value) * -direction
            } else {
                value * direction
            }
        };
        let distance = along(uv[0], self.direction[0]) + along(uv[1], self.direction[1]);
        let t = ((self.edge - distance) / self.feather).clamp(0.0, 1.0);
        t * t * (3.0 - 2.0 * t)
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum TransitionComposite {
    Frames {
        outgoing_weight: f32,
        incoming_weight: f32,
        dip: Option<TransitionDip>,
    },
    Layers {
        outgoing: TransitionLayer,
        incoming: TransitionLayer,
        wipe: Option<TransitionWipe>,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TransitionDip {
    Black,
    White,
}

const WIPE_FEATHER: f32 = 0.015;
const ZOOM_PEAK_SCALE: f32 = 0.5;

pub fn ease_in_out_cubic(t: f32) -> f32 {
    let t = t.clamp(0.0, 1.0);
    if t < 0.5 {
        4.0 * t * t * t
    } else {
        1.0 - (-2.0 * t + 2.0).powi(3) / 2.0
    }
}

fn ease_in_cubic(t: f32) -> f32 {
    let t = t.clamp(0.0, 1.0);
    t * t * t
}

fn ease_out_cubic(t: f32) -> f32 {
    1.0 - ease_in_cubic(1.0 - t)
}

fn smoothstep(edge0: f32, edge1: f32, x: f32) -> f32 {
    let t = ((x - edge0) / (edge1 - edge0)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

impl TransitionComposite {
    pub fn at(kind: ClipTransitionType, progress: f32) -> Self {
        let p = if progress.is_finite() {
            progress.clamp(0.0, 1.0)
        } else {
            0.0
        };
        let dip = |dip| Self::Frames {
            outgoing_weight: (1.0 - p * 2.0).max(0.0),
            incoming_weight: (p * 2.0 - 1.0).max(0.0),
            dip: Some(dip),
        };
        let push = |direction: [f32; 2]| {
            let eased = ease_in_out_cubic(p);
            Self::Layers {
                outgoing: TransitionLayer {
                    offset: [direction[0] * eased, direction[1] * eased],
                    ..TransitionLayer::IDENTITY
                },
                incoming: TransitionLayer {
                    offset: [-direction[0] * (1.0 - eased), -direction[1] * (1.0 - eased)],
                    ..TransitionLayer::IDENTITY
                },
                wipe: None,
            }
        };
        let wipe = |direction: [f32; 2]| Self::Layers {
            outgoing: TransitionLayer::IDENTITY,
            incoming: TransitionLayer::IDENTITY,
            wipe: Some(TransitionWipe {
                direction,
                edge: ease_in_out_cubic(p) * (1.0 + WIPE_FEATHER),
                feather: WIPE_FEATHER,
            }),
        };
        match kind {
            ClipTransitionType::CrossFade => Self::Frames {
                outgoing_weight: 1.0 - p,
                incoming_weight: p,
                dip: None,
            },
            ClipTransitionType::FadeThroughBlack => dip(TransitionDip::Black),
            ClipTransitionType::FadeThroughWhite => dip(TransitionDip::White),
            ClipTransitionType::PushLeft => push([-1.0, 0.0]),
            ClipTransitionType::PushRight => push([1.0, 0.0]),
            ClipTransitionType::PushUp => push([0.0, -1.0]),
            ClipTransitionType::PushDown => push([0.0, 1.0]),
            ClipTransitionType::WipeLeft => wipe([-1.0, 0.0]),
            ClipTransitionType::WipeRight => wipe([1.0, 0.0]),
            ClipTransitionType::WipeUp => wipe([0.0, -1.0]),
            ClipTransitionType::WipeDown => wipe([0.0, 1.0]),
            ClipTransitionType::Zoom => {
                let incoming_opacity = smoothstep(0.3, 0.7, p);
                Self::Layers {
                    outgoing: TransitionLayer {
                        offset: [0.0, 0.0],
                        scale: 1.0 + ZOOM_PEAK_SCALE * ease_in_cubic(p),
                        opacity: 1.0 - incoming_opacity,
                    },
                    incoming: TransitionLayer {
                        offset: [0.0, 0.0],
                        scale: 1.0 + ZOOM_PEAK_SCALE * (1.0 - ease_out_cubic(p)),
                        opacity: incoming_opacity,
                    },
                    wipe: None,
                }
            }
        }
    }

    pub fn is_layered(&self) -> bool {
        matches!(self, Self::Layers { .. })
    }

    fn uniforms(&self, progress: f32, opaque: bool) -> TransitionUniforms {
        let base = TransitionUniforms {
            progress: progress.clamp(0.0, 1.0),
            kind: 0,
            opaque: u32::from(opaque),
            padding: 0,
            outgoing: TransitionLayer::IDENTITY.packed(),
            incoming: TransitionLayer::IDENTITY.packed(),
            wipe: [0.0; 4],
        };
        match *self {
            Self::Frames { dip, .. } => TransitionUniforms {
                kind: match dip {
                    None => 0,
                    Some(TransitionDip::Black) => 1,
                    Some(TransitionDip::White) => 2,
                },
                ..base
            },
            Self::Layers {
                outgoing,
                incoming,
                wipe,
            } => TransitionUniforms {
                kind: 3,
                outgoing: outgoing.packed(),
                incoming: incoming.packed(),
                wipe: wipe.map_or([0.0; 4], |wipe| {
                    [
                        wipe.direction[0],
                        wipe.direction[1],
                        wipe.edge,
                        wipe.feather,
                    ]
                }),
                ..base
            },
        }
    }
}

struct TransitionTextures {
    outgoing: wgpu::Texture,
    incoming: wgpu::Texture,
    bind_group: wgpu::BindGroup,
    width: u32,
    height: u32,
}

pub struct TransitionCompositor {
    bind_group_layout: wgpu::BindGroupLayout,
    frames_pipeline: wgpu::RenderPipeline,
    layers_pipeline: wgpu::RenderPipeline,
    sampler: wgpu::Sampler,
    uniforms_buffer: wgpu::Buffer,
    textures: Option<TransitionTextures>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum CompositePass {
    Frames,
    LayersOnClear,
}

pub struct TransitionParameters {
    pub kind: ClipTransitionType,
    pub progress: f32,
    pub opaque: bool,
}

impl TransitionParameters {
    pub fn composite(&self) -> TransitionComposite {
        TransitionComposite::at(self.kind, self.progress)
    }
}

impl TransitionCompositor {
    pub fn new(device: &wgpu::Device) -> Self {
        let bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("Transition Compositor Bind Group Layout"),
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
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: true },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 3,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                    count: None,
                },
            ],
        });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("Transition Compositor Pipeline Layout"),
            bind_group_layouts: &[&bind_group_layout],
            push_constant_ranges: &[],
        });
        let shader = device.create_shader_module(wgpu::include_wgsl!("shaders/transition.wgsl"));
        let make_pipeline = |label, entry_point, blend| {
            device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some(label),
                layout: Some(&pipeline_layout),
                vertex: wgpu::VertexState {
                    module: &shader,
                    entry_point: Some("vs_main"),
                    buffers: &[],
                    compilation_options: wgpu::PipelineCompilationOptions::default(),
                },
                fragment: Some(wgpu::FragmentState {
                    module: &shader,
                    entry_point: Some(entry_point),
                    targets: &[Some(wgpu::ColorTargetState {
                        format: wgpu::TextureFormat::Rgba8Unorm,
                        blend,
                        write_mask: wgpu::ColorWrites::ALL,
                    })],
                    compilation_options: wgpu::PipelineCompilationOptions::default(),
                }),
                primitive: wgpu::PrimitiveState::default(),
                depth_stencil: None,
                multisample: wgpu::MultisampleState::default(),
                multiview: None,
                cache: None,
            })
        };
        let frames_pipeline = make_pipeline("Transition Compositor Pipeline", "fs_main", None);
        let layers_pipeline = make_pipeline(
            "Transition Layers Pipeline",
            "fs_layers",
            Some(wgpu::BlendState::PREMULTIPLIED_ALPHA_BLENDING),
        );
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("Transition Compositor Sampler"),
            address_mode_u: wgpu::AddressMode::ClampToEdge,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            address_mode_w: wgpu::AddressMode::ClampToEdge,
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });
        let uniforms_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("Transition Compositor Uniforms"),
            contents: bytemuck::bytes_of(
                &TransitionComposite::at(ClipTransitionType::CrossFade, 0.0).uniforms(0.0, true),
            ),
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        });

        Self {
            bind_group_layout,
            frames_pipeline,
            layers_pipeline,
            sampler,
            uniforms_buffer,
            textures: None,
        }
    }

    pub fn ensure_size(&mut self, device: &wgpu::Device, width: u32, height: u32) {
        if self
            .textures
            .as_ref()
            .is_some_and(|textures| textures.width == width && textures.height == height)
        {
            return;
        }

        let create_texture = |label| {
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
                usage: wgpu::TextureUsages::COPY_DST | wgpu::TextureUsages::TEXTURE_BINDING,
                view_formats: &[],
            })
        };
        let outgoing = create_texture("Transition Outgoing Texture");
        let incoming = create_texture("Transition Incoming Texture");
        let outgoing_view = outgoing.create_view(&wgpu::TextureViewDescriptor::default());
        let incoming_view = incoming.create_view(&wgpu::TextureViewDescriptor::default());
        let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Transition Compositor Bind Group"),
            layout: &self.bind_group_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: self.uniforms_buffer.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::TextureView(&outgoing_view),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: wgpu::BindingResource::TextureView(&incoming_view),
                },
                wgpu::BindGroupEntry {
                    binding: 3,
                    resource: wgpu::BindingResource::Sampler(&self.sampler),
                },
            ],
        });

        self.textures = Some(TransitionTextures {
            outgoing,
            incoming,
            bind_group,
            width,
            height,
        });
    }

    pub fn capture_outgoing(&self, encoder: &mut wgpu::CommandEncoder, source: &wgpu::Texture) {
        if let Some(textures) = &self.textures {
            copy_texture(
                encoder,
                source,
                &textures.outgoing,
                textures.width,
                textures.height,
            );
        }
    }

    pub fn capture_incoming_and_render(
        &self,
        queue: &wgpu::Queue,
        encoder: &mut wgpu::CommandEncoder,
        source: &wgpu::Texture,
        target: &wgpu::TextureView,
        parameters: TransitionParameters,
    ) {
        let Some(textures) = &self.textures else {
            return;
        };
        copy_texture(
            encoder,
            source,
            &textures.incoming,
            textures.width,
            textures.height,
        );
        let composite = parameters.composite();
        let pass = if composite.is_layered() {
            CompositePass::LayersOnClear
        } else {
            CompositePass::Frames
        };
        self.draw(queue, encoder, target, &parameters, composite, pass);
    }

    fn draw(
        &self,
        queue: &wgpu::Queue,
        encoder: &mut wgpu::CommandEncoder,
        target: &wgpu::TextureView,
        parameters: &TransitionParameters,
        composite: TransitionComposite,
        pass: CompositePass,
    ) {
        let Some(textures) = &self.textures else {
            return;
        };
        let layered = pass != CompositePass::Frames;
        queue.write_buffer(
            &self.uniforms_buffer,
            0,
            bytemuck::bytes_of(&composite.uniforms(parameters.progress, parameters.opaque)),
        );

        let mut render_pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("Transition Compositor Pass"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: target,
                resolve_target: None,
                ops: wgpu::Operations {
                    load: match pass {
                        CompositePass::Frames => wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                        CompositePass::LayersOnClear => {
                            wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT)
                        }
                    },
                    store: wgpu::StoreOp::Store,
                },
            })],
            depth_stencil_attachment: None,
            timestamp_writes: None,
            occlusion_query_set: None,
        });
        render_pass.set_pipeline(if layered {
            &self.layers_pipeline
        } else {
            &self.frames_pipeline
        });
        render_pass.set_bind_group(0, &textures.bind_group, &[]);
        render_pass.draw(0..3, 0..1);
    }
}

fn copy_texture(
    encoder: &mut wgpu::CommandEncoder,
    source: &wgpu::Texture,
    destination: &wgpu::Texture,
    width: u32,
    height: u32,
) {
    encoder.copy_texture_to_texture(
        wgpu::TexelCopyTextureInfo {
            texture: source,
            mip_level: 0,
            origin: wgpu::Origin3d::ZERO,
            aspect: wgpu::TextureAspect::All,
        },
        wgpu::TexelCopyTextureInfo {
            texture: destination,
            mip_level: 0,
            origin: wgpu::Origin3d::ZERO,
            aspect: wgpu::TextureAspect::All,
        },
        wgpu::Extent3d {
            width,
            height,
            depth_or_array_layers: 1,
        },
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_twelve_transition_kinds_produce_valid_composites() {
        for kind in ClipTransitionType::ALL {
            let start = TransitionComposite::at(kind, 0.0);
            let mid = TransitionComposite::at(kind, 0.5);
            let end = TransitionComposite::at(kind, 1.0);
            assert_eq!(start.is_layered(), mid.is_layered());
            assert_eq!(mid.is_layered(), end.is_layered());
        }
        assert!(matches!(
            TransitionComposite::at(ClipTransitionType::FadeThroughWhite, 0.5),
            TransitionComposite::Frames {
                dip: Some(TransitionDip::White),
                ..
            }
        ));
        assert!(TransitionComposite::at(ClipTransitionType::PushLeft, 0.5).is_layered());
        assert!(TransitionComposite::at(ClipTransitionType::WipeRight, 0.5).is_layered());
        assert!(TransitionComposite::at(ClipTransitionType::Zoom, 0.5).is_layered());
    }
}
