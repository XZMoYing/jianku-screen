use bytemuck::{Pod, Zeroable};
use cap_project::{AnimatedGradientConfig, BackgroundSource};
use image::GenericImageView;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{Mutex, RwLock};
use wgpu::{include_wgsl, util::DeviceExt};

use crate::{ProjectUniforms, RenderVideoConstants, RenderingError, create_shader_render_pipeline};

use super::{
    AnimatedGradientLayer,
    video_background::{VideoBackground, VideoFrame, is_video},
};

const MAX_BACKGROUND_DIMENSION: u32 = 2560;

const DEFAULT_BACKGROUND_CACHE_CAPACITY: usize = 8;

pub fn clean_background_path(path: &str) -> Option<String> {
    if path.is_empty() {
        return None;
    }

    let clean_path = path
        .replace("asset://localhost/", "/")
        .replace("asset://", "")
        .replace("localhost//", "/");

    std::path::Path::new(&clean_path)
        .exists()
        .then_some(clean_path)
}

fn decode_background_rgba(
    path: &str,
    max_dimension: u32,
) -> Result<(Vec<u8>, u32, u32), image::ImageError> {
    let img = image::open(path)?;
    let (source_width, source_height) = img.dimensions();

    let img = if source_width > max_dimension || source_height > max_dimension {
        tracing::info!(
            "Downscaling background image '{}' from {}x{} to fit within {}px",
            path,
            source_width,
            source_height,
            max_dimension
        );
        img.resize(
            max_dimension,
            max_dimension,
            image::imageops::FilterType::Triangle,
        )
    } else {
        img
    };

    let (width, height) = img.dimensions();
    Ok((img.to_rgba8().into_raw(), width, height))
}

struct CachedBackgroundTexture {
    texture: wgpu::Texture,
    last_used: u64,
}

/// Process-wide cache of decoded background image textures keyed by resolved path.
///
/// Decoding and downscaling large wallpapers is CPU-heavy (tens of milliseconds),
/// so this cache lets the screenshot editor reuse textures across re-selections,
/// re-opens, export and ahead-of-time prewarming instead of paying the cost on
/// every render. Eviction is least-recently-used; an entry that is still bound by
/// a live render stays valid because wgpu keeps the underlying texture alive
/// through the bind group that references it.
pub struct BackgroundTextureCache {
    inner: RwLock<BackgroundTextureCacheInner>,
    in_flight: Mutex<HashMap<String, Arc<Mutex<()>>>>,
    capacity: usize,
}

struct BackgroundTextureCacheInner {
    entries: HashMap<String, CachedBackgroundTexture>,
    counter: u64,
}

impl Default for BackgroundTextureCache {
    fn default() -> Self {
        Self::new(DEFAULT_BACKGROUND_CACHE_CAPACITY)
    }
}

impl BackgroundTextureCache {
    pub fn new(capacity: usize) -> Self {
        Self {
            inner: RwLock::new(BackgroundTextureCacheInner {
                entries: HashMap::new(),
                counter: 0,
            }),
            in_flight: Mutex::new(HashMap::new()),
            capacity: capacity.max(1),
        }
    }

    async fn get(&self, path: &str) -> Option<wgpu::Texture> {
        let mut inner = self.inner.write().await;
        inner.counter += 1;
        let counter = inner.counter;
        let entry = inner.entries.get_mut(path)?;
        entry.last_used = counter;
        Some(entry.texture.clone())
    }

    async fn insert(&self, path: String, texture: wgpu::Texture) {
        let mut inner = self.inner.write().await;
        inner.counter += 1;
        let counter = inner.counter;
        inner.entries.insert(
            path,
            CachedBackgroundTexture {
                texture,
                last_used: counter,
            },
        );

        while inner.entries.len() > self.capacity {
            let Some(evict_key) = inner
                .entries
                .iter()
                .min_by_key(|(_, entry)| entry.last_used)
                .map(|(key, _)| key.clone())
            else {
                break;
            };
            inner.entries.remove(&evict_key);
        }
    }

    /// Returns the cached texture for `path`, decoding and uploading it on a
    /// blocking thread first if it is not already cached. Returns `None` when the
    /// image cannot be loaded so callers can fall back gracefully.
    ///
    /// Concurrent calls for the same path (for example an ahead-of-time prewarm
    /// racing the render that follows a click) are de-duplicated so the image is
    /// decoded only once.
    pub async fn ensure(
        &self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        path: &str,
    ) -> Option<wgpu::Texture> {
        if let Some(texture) = self.get(path).await {
            return Some(texture);
        }

        let path_lock = {
            let mut in_flight = self.in_flight.lock().await;
            in_flight
                .entry(path.to_string())
                .or_insert_with(|| Arc::new(Mutex::new(())))
                .clone()
        };
        let _guard = path_lock.lock().await;

        if let Some(texture) = self.get(path).await {
            self.clear_in_flight(path).await;
            return Some(texture);
        }

        let texture = self.decode_and_upload(device, queue, path).await;
        self.clear_in_flight(path).await;
        texture
    }

    async fn clear_in_flight(&self, path: &str) {
        self.in_flight.lock().await.remove(path);
    }

    async fn decode_and_upload(
        &self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        path: &str,
    ) -> Option<wgpu::Texture> {
        let max_dimension = MAX_BACKGROUND_DIMENSION.min(device.limits().max_texture_dimension_2d);
        let path_owned = path.to_string();

        let decoded =
            tokio::task::spawn_blocking(move || decode_background_rgba(&path_owned, max_dimension))
                .await;

        let (rgba, width, height) = match decoded {
            Ok(Ok(decoded)) => decoded,
            Ok(Err(e)) => {
                tracing::warn!(
                    "Failed to load background image '{}': {}. Falling back to solid color.",
                    path,
                    e
                );
                return None;
            }
            Err(e) => {
                tracing::warn!("Background image decode task failed for '{}': {}", path, e);
                return None;
            }
        };

        let texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("Background Image Texture"),
            size: wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });

        queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            &rgba,
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(4 * width),
                rows_per_image: Some(height),
            },
            wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
        );

        self.insert(path.to_string(), texture.clone()).await;

        Some(texture)
    }
}

#[derive(PartialEq, Debug, Clone, Copy, Serialize, Deserialize, Type)]
pub struct Gradient {
    start: [f32; 4],
    end: [f32; 4],
    angle: f32,
    noise_intensity: f32,
    noise_scale: f32,
}

#[derive(PartialEq)]
pub enum ColorOrGradient {
    Color([f32; 4]),
    Gradient(Gradient),
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub enum Background {
    Color([f32; 4]),
    Gradient(Gradient),
    AnimatedGradient(AnimatedGradientConfig),
    Image { path: String },
}

impl From<BackgroundSource> for Background {
    fn from(value: BackgroundSource) -> Self {
        match value {
            BackgroundSource::AnimatedGradient { config } => Background::AnimatedGradient(config),
            BackgroundSource::Color { value, alpha } => Background::Color([
                value[0] as f32 / 255.0,
                value[1] as f32 / 255.0,
                value[2] as f32 / 255.0,
                alpha as f32 / 255.0,
            ]),
            BackgroundSource::Gradient {
                from,
                to,
                angle,
                noise_intensity,
                noise_scale,
                ..
            } => Background::Gradient(Gradient {
                start: [
                    from[0] as f32 / 255.0,
                    from[1] as f32 / 255.0,
                    from[2] as f32 / 255.0,
                    1.0,
                ],
                end: [
                    to[0] as f32 / 255.0,
                    to[1] as f32 / 255.0,
                    to[2] as f32 / 255.0,
                    1.0,
                ],
                angle: angle as f32,
                noise_intensity: noise_intensity.unwrap_or(0.0),
                noise_scale: noise_scale.unwrap_or(3.0),
            }),
            BackgroundSource::Image { path } | BackgroundSource::Wallpaper { path } => {
                if let Some(clean_path) = path.as_deref().and_then(clean_background_path) {
                    Background::Image { path: clean_path }
                } else {
                    Background::Color([1.0, 1.0, 1.0, 1.0])
                }
            }
        }
    }
}

fn background_source_is_empty(source: &BackgroundSource) -> bool {
    match source {
        BackgroundSource::Color { alpha, .. } => *alpha == 0,
        BackgroundSource::Image { path } | BackgroundSource::Wallpaper { path } => {
            path.as_deref().map(str::is_empty).unwrap_or(true)
        }
        BackgroundSource::Gradient { .. } | BackgroundSource::AnimatedGradient { .. } => false,
    }
}

impl Background {
    pub fn from_source(
        mut source: BackgroundSource,
        transparent_when_empty: bool,
        project_path: &std::path::Path,
    ) -> Self {
        if let BackgroundSource::Image { path } | BackgroundSource::Wallpaper { path } = &mut source
            && let Some(stored) = path.as_ref().filter(|stored| !stored.is_empty())
        {
            *path = Some(
                cap_project::resolve_project_asset_path(project_path, stored)
                    .to_string_lossy()
                    .into_owned(),
            );
        }
        if transparent_when_empty && background_source_is_empty(&source) {
            Background::Color([0.0, 0.0, 0.0, 0.0])
        } else {
            Background::from(source)
        }
    }
}

pub enum Inner {
    AnimatedGradient(Box<AnimatedGradientLayer>),
    Image {
        path: String,
        bind_group: wgpu::BindGroup,
        output_size: (u32, u32),
    },
    ColorOrGradient {
        value: ColorOrGradient,
        #[allow(unused)]
        buffer: wgpu::Buffer,
        bind_group: wgpu::BindGroup,
    },
}

fn create_video_texture(device: &wgpu::Device, width: u32, height: u32) -> wgpu::Texture {
    device.create_texture(&wgpu::TextureDescriptor {
        label: Some("Wallpaper Video Frame"),
        size: wgpu::Extent3d {
            width,
            height,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8Unorm,
        usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
        view_formats: &[],
    })
}

pub struct BackgroundLayer {
    pub(crate) realtime: Option<bool>,
    inner: Option<Inner>,
    image_pipeline: ImageBackgroundPipeline,
    video: Option<VideoBackground>,
    video_texture: Option<wgpu::Texture>,
    #[cfg(target_os = "macos")]
    video_converter: Option<crate::yuv_converter::YuvToRgbaConverter>,
    #[cfg(target_os = "macos")]
    video_pipelines: Arc<crate::yuv_converter::YuvConverterPipelines>,
    #[cfg(target_os = "macos")]
    native_identity: Option<crate::decoder::DecodedFrameStorageIdentity>,
    #[cfg(target_os = "macos")]
    native_gpu_failed: bool,
    color_pipeline: GradientOrColorPipeline,
}

impl BackgroundLayer {
    pub(crate) fn set_realtime(&mut self, state: Option<bool>) {
        if self.realtime.is_some() != state.is_some() {
            self.video = None;
            self.video_texture = None;
            self.inner = None;
            #[cfg(target_os = "macos")]
            {
                self.native_identity = None;
            }
        }
        self.realtime = state;
    }

    #[cfg(test)]
    pub fn new(device: &wgpu::Device) -> Self {
        Self::new_with_shared_pipelines(
            device,
            Arc::new(crate::yuv_converter::YuvConverterPipelines::new(device)),
        )
    }

    pub(crate) fn new_with_shared_pipelines(
        device: &wgpu::Device,
        video_pipelines: Arc<crate::yuv_converter::YuvConverterPipelines>,
    ) -> Self {
        #[cfg(not(target_os = "macos"))]
        let _ = video_pipelines;
        Self {
            #[cfg(target_os = "macos")]
            video_pipelines,
            #[cfg(target_os = "macos")]
            video_converter: None,
            #[cfg(target_os = "macos")]
            native_identity: None,
            #[cfg(target_os = "macos")]
            native_gpu_failed: false,
            realtime: None,
            inner: None,
            video: None,
            video_texture: None,
            image_pipeline: ImageBackgroundPipeline::new(device),
            color_pipeline: GradientOrColorPipeline::new(device),
        }
    }

    #[cfg(target_os = "macos")]
    fn prepare_native_texture(
        &mut self,
        constants: &RenderVideoConstants,
        frame: &crate::DecodedFrame,
    ) -> Result<(), String> {
        let identity = frame.storage_identity();
        if self
            .native_identity
            .as_ref()
            .is_some_and(|previous| previous.matches(&identity))
        {
            return Ok(());
        }
        let converter = self.video_converter.get_or_insert_with(|| {
            crate::yuv_converter::YuvToRgbaConverter::new_with_shared_pipelines(
                &constants.device,
                self.video_pipelines.clone(),
            )
        });
        frame
            .with_image_buf(|image| {
                converter
                    .convert_nv12_from_iosurface(&constants.device, &constants.queue, image)
                    .map(|_| ())
            })
            .ok_or("壁纸 IOSurface 未就绪")?
            .map_err(|error| error.to_string())?;
        let converted = converter.output_texture().ok_or("壁纸转换纹理未就绪")?;
        let (width, height) = (frame.width(), frame.height());
        if converted.width() < width || converted.height() < height {
            return Err("壁纸超过 GPU 转换尺寸上限".into());
        }
        if self
            .video_texture
            .as_ref()
            .is_none_or(|texture| texture.width() != width || texture.height() != height)
        {
            self.video_texture = Some(create_video_texture(&constants.device, width, height));
            self.inner = None;
        }
        let texture = self.video_texture.as_ref().ok_or("壁纸纹理未就绪")?;
        let mut encoder =
            constants
                .device
                .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                    label: Some("Wallpaper GPU Copy"),
                });
        encoder.copy_texture_to_texture(
            converted.as_image_copy(),
            texture.as_image_copy(),
            wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
        );
        constants.queue.submit(Some(encoder.finish()));
        let retained_frame = frame.clone();
        constants
            .queue
            .on_submitted_work_done(move || drop(retained_frame));
        self.native_identity = Some(identity);
        Ok(())
    }

    pub async fn prepare(
        &mut self,
        constants: &RenderVideoConstants,
        uniforms: &ProjectUniforms,
        background: Background,
    ) -> Result<(), RenderingError> {
        let device = &constants.device;
        let queue = &constants.queue;

        if let Background::Image { path } = &background
            && is_video(path)
        {
            if self.video.as_ref().is_none_or(|video| video.path != *path) {
                self.video_texture = None;
                #[cfg(target_os = "macos")]
                {
                    self.native_identity = None;
                    self.native_gpu_failed = false;
                }
                self.video = Some(
                    VideoBackground::new(path.clone(), self.realtime.is_some())
                        .map_err(RenderingError::ImageLoadError)?,
                );
            }
            let mut frame = self
                .video
                .as_mut()
                .ok_or_else(|| RenderingError::ImageLoadError("壁纸视频未就绪".into()))?
                .source(
                    f64::from(uniforms.frame_number) / f64::from(uniforms.frame_rate.max(1)),
                    self.realtime.unwrap_or(false),
                )
                .await
                .map_err(RenderingError::ImageLoadError)?;
            #[cfg(target_os = "macos")]
            if let VideoFrame::Native(native) = &frame {
                let result = if self.native_gpu_failed {
                    Err("壁纸 GPU 通道不可用".to_string())
                } else {
                    self.prepare_native_texture(constants, native)
                };
                if let Err(error) = result {
                    if !self.native_gpu_failed {
                        tracing::warn!(%error, "Using CPU wallpaper conversion fallback");
                        self.native_gpu_failed = true;
                    }
                    frame = VideoFrame::Rgba(
                        self.video
                            .as_ref()
                            .ok_or("壁纸未就绪")
                            .map_err(|e| RenderingError::ImageLoadError(e.into()))?
                            .materialize(frame)
                            .await
                            .map_err(RenderingError::ImageLoadError)?,
                    );
                }
            }
            let (width, height) = frame.size();
            let new_texture = self
                .video_texture
                .as_ref()
                .is_none_or(|texture| texture.width() != width || texture.height() != height);
            if new_texture {
                self.video_texture = Some(create_video_texture(device, width, height));
            }
            let texture = self
                .video_texture
                .as_ref()
                .ok_or_else(|| RenderingError::ImageLoadError("无法创建壁纸纹理".into()))?;
            if let VideoFrame::Rgba(frame) = &frame {
                queue.write_texture(
                    wgpu::TexelCopyTextureInfo {
                        texture,
                        mip_level: 0,
                        origin: wgpu::Origin3d::ZERO,
                        aspect: wgpu::TextureAspect::All,
                    },
                    &frame.data,
                    wgpu::TexelCopyBufferLayout {
                        offset: 0,
                        bytes_per_row: Some(width * 4),
                        rows_per_image: Some(height),
                    },
                    texture.size(),
                );
            }
            if !new_texture
                && matches!(&self.inner,Some(Inner::Image { path: current, output_size, .. }) if current == path && *output_size == uniforms.output_size)
            {
                return Ok(());
            }
            let output_ar = uniforms.output_size.0 as f32 / uniforms.output_size.1 as f32;
            let image_ar = width as f32 / height as f32;
            let image_uniforms = ImageBackgroundUniforms {
                output_size: [uniforms.output_size.0 as f32, uniforms.output_size.1 as f32],
                padding: 0.0,
                x_width: if output_ar < image_ar {
                    (1.0 - output_ar / image_ar) * 0.5
                } else {
                    0.0
                },
                y_height: if output_ar > image_ar {
                    (1.0 - image_ar / output_ar) * 0.5
                } else {
                    0.0
                },
                _padding: 0.0,
            };
            let buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("Wallpaper Video Layout"),
                contents: bytemuck::bytes_of(&image_uniforms),
                usage: wgpu::BufferUsages::UNIFORM,
            });
            self.inner = Some(Inner::Image {
                path: path.clone(),
                output_size: uniforms.output_size,
                bind_group: self.image_pipeline.bind_group(
                    device,
                    &buffer,
                    &texture.create_view(&wgpu::TextureViewDescriptor::default()),
                ),
            });
            return Ok(());
        }
        self.video = None;
        self.video_texture = None;
        #[cfg(target_os = "macos")]
        {
            self.video_converter = None;
            self.native_identity = None;
        }
        match background {
            Background::AnimatedGradient(config) => match &mut self.inner {
                Some(Inner::AnimatedGradient(layer)) => {
                    layer.prepare(device, queue, config, uniforms);
                }
                _ => {
                    self.inner = Some(Inner::AnimatedGradient(Box::new(
                        AnimatedGradientLayer::new(device, config, uniforms),
                    )));
                }
            },
            Background::Image { path } => {
                match &self.inner {
                    Some(Inner::Image {
                        path: current_path,
                        output_size,
                        ..
                    }) if current_path == &path && *output_size == uniforms.output_size => {}
                    _ => {
                        let texture = match constants
                            .background_textures
                            .ensure(device, queue, &path)
                            .await
                        {
                            Some(texture) => texture,
                            None => {
                                let fallback_background = Background::Color([1.0, 1.0, 1.0, 1.0]);
                                let buffer = GradientOrColorUniforms::from(fallback_background)
                                    .to_buffer(device);
                                self.inner = Some(Inner::ColorOrGradient {
                                    value: ColorOrGradient::Color([1.0, 1.0, 1.0, 1.0]),
                                    bind_group: self.color_pipeline.bind_group(device, &buffer),
                                    buffer,
                                });
                                return Ok(());
                            }
                        };

                        let output_ar =
                            uniforms.output_size.1 as f32 / uniforms.output_size.0 as f32;
                        let image_ar = texture.height() as f32 / texture.width() as f32;

                        let y_height = if output_ar < image_ar {
                            ((image_ar - output_ar) / 2.0) / image_ar
                        } else {
                            0.0
                        };

                        let x_width = if output_ar > image_ar {
                            let output_ar = 1.0 / output_ar;
                            let image_ar = 1.0 / image_ar;

                            ((image_ar - output_ar) / 2.0) / image_ar
                        } else {
                            0.0
                        };

                        let image_uniforms = ImageBackgroundUniforms {
                            output_size: [
                                uniforms.output_size.0 as f32,
                                uniforms.output_size.1 as f32,
                            ],
                            padding: 0.0,
                            x_width,
                            y_height,
                            _padding: 0.0,
                        };

                        let uniform_buffer =
                            device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                                label: Some("Image Background Uniforms"),
                                contents: bytemuck::cast_slice(&[image_uniforms]),
                                usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
                            });

                        let texture_view =
                            texture.create_view(&wgpu::TextureViewDescriptor::default());

                        self.inner = Some(Inner::Image {
                            path,
                            output_size: uniforms.output_size,
                            bind_group: self.image_pipeline.bind_group(
                                device,
                                &uniform_buffer,
                                &texture_view,
                            ),
                        });
                    }
                };
            }
            Background::Color(color) => match &self.inner {
                Some(Inner::ColorOrGradient {
                    value: ColorOrGradient::Color(current_color),
                    ..
                }) if &color == current_color => {}
                _ => {
                    let buffer = GradientOrColorUniforms::from(background).to_buffer(device);
                    self.inner = Some(Inner::ColorOrGradient {
                        value: ColorOrGradient::Color(color),
                        bind_group: self.color_pipeline.bind_group(device, &buffer),
                        buffer,
                    });
                }
            },
            Background::Gradient(gradient) => match &self.inner {
                Some(Inner::ColorOrGradient {
                    value: ColorOrGradient::Gradient(current_gradient),
                    ..
                }) if &gradient == current_gradient => {}
                _ => {
                    let buffer = GradientOrColorUniforms::from(background).to_buffer(device);
                    self.inner = Some(Inner::ColorOrGradient {
                        value: ColorOrGradient::Gradient(gradient),
                        bind_group: self.color_pipeline.bind_group(device, &buffer),
                        buffer,
                    });
                }
            },
        }

        Ok(())
    }

    pub fn render_surface(&mut self, encoder: &mut wgpu::CommandEncoder) {
        if let Some(Inner::AnimatedGradient(layer)) = &mut self.inner {
            layer.render_surface(encoder);
        }
    }

    pub fn render(&self, pass: &mut wgpu::RenderPass<'_>) {
        if let Some(Inner::AnimatedGradient(layer)) = &self.inner {
            layer.render(pass);
            return;
        }
        if let Some(Inner::Image { bind_group, .. }) = &self.inner {
            pass.set_pipeline(&self.image_pipeline.render_pipeline);
            pass.set_bind_group(0, bind_group, &[]);
        } else if let Some(Inner::ColorOrGradient { bind_group, .. }) = &self.inner {
            pass.set_pipeline(&self.color_pipeline.render_pipeline);
            pass.set_bind_group(0, bind_group, &[]);
        } else {
            return;
        }

        pass.draw(0..4, 0..1);
    }
}

pub struct ImageBackgroundPipeline {
    pub bind_group_layout: wgpu::BindGroupLayout,
    pub render_pipeline: wgpu::RenderPipeline,
}

#[repr(C)]
#[derive(Copy, Clone, Pod, Zeroable)]
pub struct ImageBackgroundUniforms {
    output_size: [f32; 2],
    padding: f32,
    x_width: f32,
    y_height: f32,
    _padding: f32, // For alignment
}

impl ImageBackgroundPipeline {
    pub fn new(device: &wgpu::Device) -> Self {
        let bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("ImageBackgroundBindGroupLayout"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::VERTEX_FRAGMENT,
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
        let shader = device.create_shader_module(include_wgsl!("../shaders/image-background.wgsl"));

        let render_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("ImageBackgroundPipeline"),
            layout: Some(
                &device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                    label: Some("ImageBackgroundPipelineLayout"),
                    bind_group_layouts: &[&bind_group_layout],
                    push_constant_ranges: &[],
                }),
            ),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vs_main"),
                buffers: &[],
                compilation_options: wgpu::PipelineCompilationOptions {
                    constants: &[],
                    zero_initialize_workgroup_memory: false,
                },
            },
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some("fs_main"),
                targets: &[Some(wgpu::ColorTargetState {
                    format: wgpu::TextureFormat::Rgba8Unorm,
                    blend: Some(wgpu::BlendState::REPLACE),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
                compilation_options: wgpu::PipelineCompilationOptions {
                    constants: &[],
                    zero_initialize_workgroup_memory: false,
                },
            }),
            primitive: wgpu::PrimitiveState {
                topology: wgpu::PrimitiveTopology::TriangleList,
                strip_index_format: None,
                front_face: wgpu::FrontFace::Ccw,
                cull_mode: Some(wgpu::Face::Back),
                unclipped_depth: false,
                polygon_mode: wgpu::PolygonMode::Fill,
                conservative: false,
            },
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            multiview: None,
            cache: None,
        });

        Self {
            bind_group_layout,
            render_pipeline,
        }
    }

    pub fn bind_group(
        &self,
        device: &wgpu::Device,
        uniforms: &wgpu::Buffer,
        texture: &wgpu::TextureView,
    ) -> wgpu::BindGroup {
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            address_mode_u: wgpu::AddressMode::ClampToEdge,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            address_mode_w: wgpu::AddressMode::ClampToEdge,
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            mipmap_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });

        device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("ImageBackgroundBindGroup"),
            layout: &self.bind_group_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: uniforms.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::TextureView(texture),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: wgpu::BindingResource::Sampler(&sampler),
                },
            ],
        })
    }
}

pub struct GradientOrColorPipeline {
    pub bind_group_layout: wgpu::BindGroupLayout,
    pub render_pipeline: wgpu::RenderPipeline,
}

#[derive(Debug, Clone, Copy, Pod, Zeroable, Default)]
#[repr(C)]
pub struct GradientOrColorUniforms {
    pub start: [f32; 4],
    pub end: [f32; 4],
    pub angle: f32,
    pub noise_intensity: f32,
    pub noise_scale: f32,
    _padding: f32,
}

impl GradientOrColorUniforms {
    fn to_buffer(self, device: &wgpu::Device) -> wgpu::Buffer {
        device.create_buffer_init(
            &(wgpu::util::BufferInitDescriptor {
                label: Some("GradientOrColorUniforms Buffer"),
                contents: bytemuck::cast_slice(&[self]),
                usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            }),
        )
    }
}

impl From<Background> for GradientOrColorUniforms {
    fn from(value: Background) -> Self {
        match value {
            Background::Color(color) => Self {
                start: [
                    color[0] * color[3],
                    color[1] * color[3],
                    color[2] * color[3],
                    color[3],
                ],
                end: [
                    color[0] * color[3],
                    color[1] * color[3],
                    color[2] * color[3],
                    color[3],
                ],
                angle: 0.0,
                noise_intensity: 0.0,
                noise_scale: 0.0,
                _padding: 0.0,
            },
            Background::Gradient(Gradient {
                start,
                end,
                angle,
                noise_intensity,
                noise_scale,
            }) => Self {
                start: [
                    start[0] * start[3],
                    start[1] * start[3],
                    start[2] * start[3],
                    start[3],
                ],
                end: [end[0] * end[3], end[1] * end[3], end[2] * end[3], end[3]],
                angle,
                noise_intensity,
                noise_scale,
                _padding: 0.0,
            },
            Background::Image { .. } | Background::AnimatedGradient(_) => {
                unreachable!("Textured backgrounds should be handled separately")
            }
        }
    }
}

impl GradientOrColorPipeline {
    pub fn new(device: &wgpu::Device) -> Self {
        let bind_group_layout = Self::bind_group_layout(device);
        let render_pipeline = create_shader_render_pipeline(
            device,
            &bind_group_layout,
            include_wgsl!("../shaders/gradient-or-color.wgsl"),
        );

        Self {
            bind_group_layout,
            render_pipeline,
        }
    }

    fn bind_group_layout(device: &wgpu::Device) -> wgpu::BindGroupLayout {
        device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("gradient-or-color.wgsl Bind Group Layout"),
            entries: &[wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::VERTEX_FRAGMENT,
                ty: wgpu::BindingType::Buffer {
                    ty: wgpu::BufferBindingType::Uniform,
                    has_dynamic_offset: false,
                    min_binding_size: None,
                },
                count: None,
            }],
        })
    }

    pub fn bind_group(&self, device: &wgpu::Device, uniforms: &wgpu::Buffer) -> wgpu::BindGroup {
        device.create_bind_group(&wgpu::BindGroupDescriptor {
            layout: &self.bind_group_layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: uniforms.as_entire_binding(),
            }],
            label: Some("bind_group"),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use cap_project::BackgroundSource;

    #[test]
    fn portable_background_resolves_against_moved_project_without_changing_empty_backgrounds() {
        let root = tempfile::tempdir().unwrap();
        let project = root.path().join("moved.cap");
        let asset = project.join("assets/background.png");
        std::fs::create_dir_all(asset.parent().unwrap()).unwrap();
        std::fs::write(&asset, b"synthetic background").unwrap();
        for source in [
            BackgroundSource::Image {
                path: Some("assets/background.png".into()),
            },
            BackgroundSource::Wallpaper {
                path: Some(asset.to_string_lossy().into_owned()),
            },
        ] {
            match Background::from_source(source, false, &project) {
                Background::Image { path } => assert_eq!(std::path::Path::new(&path), asset),
                _ => panic!("Expected an image background"),
            }
        }
        match Background::from_source(
            BackgroundSource::Image {
                path: Some(String::new()),
            },
            true,
            &project,
        ) {
            Background::Color(color) => assert_eq!(color, [0.0; 4]),
            _ => panic!("Expected a transparent background"),
        }
    }

    #[test]
    fn test_transparent_color_conversion() {
        let source = BackgroundSource::Color {
            value: [255, 0, 0],
            alpha: 128,
        };
        let background = Background::from(source);
        match background {
            Background::Color(color) => {
                assert!((color[0] - 1.0).abs() < 1e-6);
                assert_eq!(color[1], 0.0);
                assert_eq!(color[2], 0.0);
                assert!((color[3] - 0.5).abs() < 0.01);
            }
            _ => panic!("Expected Color variant"),
        }
    }

    #[test]
    fn test_color_conversion_uses_normalized_byte_values() {
        let source = BackgroundSource::Color {
            value: [128, 64, 32],
            alpha: 200,
        };
        let background = Background::from(source);
        match background {
            Background::Color(color) => {
                assert!((color[0] - (128.0 / 255.0)).abs() < 1e-6);
                assert!((color[1] - (64.0 / 255.0)).abs() < 1e-6);
                assert!((color[2] - (32.0 / 255.0)).abs() < 1e-6);
                assert!((color[3] - (200.0 / 255.0)).abs() < 1e-6);
            }
            _ => panic!("Expected Color variant"),
        }
    }

    #[test]
    fn test_gradient_conversion() {
        let source = BackgroundSource::Gradient {
            from: [0, 255, 0],
            to: [0, 0, 255],
            angle: 90,
            noise_intensity: Some(50.0),
            noise_scale: Some(30.0),
            animated: None,
            animation_speed: None,
        };
        let background = Background::from(source);
        match background {
            Background::Gradient(gradient) => {
                assert_eq!(gradient.start[0], 0.0);
                assert_eq!(gradient.start[1], 1.0);
                assert_eq!(gradient.start[2], 0.0);
                assert_eq!(gradient.start[3], 1.0);
                assert_eq!(gradient.end[0], 0.0);
                assert_eq!(gradient.end[1], 0.0);
                assert_eq!(gradient.end[2], 1.0);
                assert_eq!(gradient.end[3], 1.0);
                assert_eq!(gradient.angle, 90.0);
                assert_eq!(gradient.noise_intensity, 50.0);
                assert_eq!(gradient.noise_scale, 30.0);
            }
            _ => panic!("Expected Gradient variant"),
        }
    }
}
