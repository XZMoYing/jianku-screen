use std::sync::Arc;

use crate::{
    RenderVideoConstants,
    composite_frame::{CompositeVideoFramePipeline, CompositeVideoFrameUniforms},
};

#[derive(Clone, Copy, Debug)]
pub struct InsetUniforms {
    pub composite: CompositeVideoFrameUniforms,
    pub color: [u8; 3],
}

pub struct InsetLayer {
    pipeline: Arc<CompositeVideoFramePipeline>,
    buffer: wgpu::Buffer,
    texture: wgpu::Texture,
    bind_group: wgpu::BindGroup,
    color: Option<[u8; 3]>,
    ready: bool,
}

impl InsetLayer {
    pub fn new(device: &wgpu::Device, pipeline: Arc<CompositeVideoFramePipeline>) -> Self {
        let buffer = CompositeVideoFrameUniforms::default().to_buffer(device);
        let texture = CompositeVideoFramePipeline::create_frame_texture(device, 1, 1);
        let view = texture.create_view(&Default::default());
        let bind_group = pipeline.bind_group(device, &buffer, &view);
        Self {
            pipeline,
            buffer,
            texture,
            bind_group,
            color: None,
            ready: false,
        }
    }

    pub fn prepare(&mut self, constants: &RenderVideoConstants, inset: Option<InsetUniforms>) {
        self.ready = false;
        let Some(inset) = inset else {
            return;
        };
        if self.color != Some(inset.color) {
            constants.queue.write_texture(
                wgpu::TexelCopyTextureInfo {
                    texture: &self.texture,
                    mip_level: 0,
                    origin: wgpu::Origin3d::ZERO,
                    aspect: wgpu::TextureAspect::All,
                },
                &[inset.color[0], inset.color[1], inset.color[2], 255],
                wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(4),
                    rows_per_image: Some(1),
                },
                wgpu::Extent3d {
                    width: 1,
                    height: 1,
                    depth_or_array_layers: 1,
                },
            );
            self.color = Some(inset.color);
        }
        inset
            .composite
            .write_to_buffer(&constants.queue, &self.buffer);
        self.ready = true;
    }

    pub fn render(&self, pass: &mut wgpu::RenderPass<'_>) {
        if !self.ready {
            return;
        }
        pass.set_pipeline(&self.pipeline.render_pipeline);
        pass.set_bind_group(0, &self.bind_group, &[]);
        pass.draw(0..3, 0..1);
    }
}
