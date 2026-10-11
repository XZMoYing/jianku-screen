#import "VideoSurface.h"
#include "SourceCrop.h"
#import "../capture/VideoFrameStore.h"

#import <CoreVideo/CVMetalTextureCache.h>
#import <Metal/Metal.h>

#include <QQuickWindow>
#include <QSGRendererInterface>
#include <QSGSimpleTextureNode>
#include <QSGTexture>
#include <QtQuick/qsgtexture_platform.h>

#include <algorithm>

namespace {
class NativeFrameNode final : public QSGSimpleTextureNode {
public:
    ~NativeFrameNode() override {
        delete wrapper;
        if (metalFrame)
            CFRelease(metalFrame);
        if (cache)
            CFRelease(cache);
    }

    QSGTexture *wrapper = nullptr;
    CVMetalTextureRef metalFrame = nullptr;
    CVMetalTextureCacheRef cache = nullptr;
    id<MTLDevice> device = nil;
    std::uint64_t sequence = 0;
    QSize sourceSize;

    void replaceTexture(QSGTexture *nextWrapper, CVMetalTextureRef nextFrame) {
        QSGTexture *previousWrapper = wrapper;
        CVMetalTextureRef previousFrame = metalFrame;
        setTexture(nextWrapper);
        wrapper = nextWrapper;
        metalFrame = nextFrame;
        delete previousWrapper;
        if (previousFrame)
            CFRelease(previousFrame);
    }
};
} // namespace

VideoSurface::VideoSurface(QQuickItem *parent) : QQuickItem(parent) {
    setFlag(ItemHasContents, true);
}

QObject *VideoSurface::frameStore() const { return store_; }
void VideoSurface::setSourceCropRect(const QRectF &rect) {
    const auto safe = Render::SourceCrop{rect.x(), rect.y(), rect.width(), rect.height()}.clamped().normalizedRect();
    if (sourceCropRect_ == safe) return;
    sourceCropRect_ = safe; emit sourceCropRectChanged(); update();
}

void VideoSurface::setFrameStore(QObject *store) {
    auto *typed = qobject_cast<VideoFrameStore *>(store);
    if (store_ == typed)
        return;
    disconnect(frameConnection_);
    store_ = typed;
    if (store_)
        frameConnection_ = connect(store_, &VideoFrameStore::frameChanged,
                                   this, &VideoSurface::update);
    emit frameStoreChanged();
    update();
}

QSGNode *VideoSurface::updatePaintNode(QSGNode *oldNode, UpdatePaintNodeData *) {
    auto *node = static_cast<NativeFrameNode *>(oldNode);
    if (!store_ || !window()) {
        delete node;
        return nullptr;
    }
    auto frame = store_->snapshot();
    if (!frame.pixelBuffer) {
        delete node;
        return nullptr;
    }

    QSGRendererInterface *renderer = window()->rendererInterface();
    if (renderer->graphicsApi() != QSGRendererInterface::Metal) {
        CVPixelBufferRelease(frame.pixelBuffer);
        delete node;
        return nullptr;
    }
    id<MTLDevice> device = (__bridge id<MTLDevice>)renderer->getResource(
        window(), QSGRendererInterface::DeviceResource);
    if (!device) {
        CVPixelBufferRelease(frame.pixelBuffer);
        delete node;
        return nullptr;
    }
    if (!node)
        node = new NativeFrameNode;
    node->setOwnsTexture(false);

    if (node->device != device) {
        delete node;
        node = new NativeFrameNode;
        node->setOwnsTexture(false);
        node->device = device;
        CVMetalTextureCacheCreate(kCFAllocatorDefault, nullptr, device,
                                  nullptr, &node->cache);
        node->sequence = 0;
    }

    if (node->cache && frame.sequence != node->sequence) {
        const int pixelWidth = static_cast<int>(CVPixelBufferGetWidth(frame.pixelBuffer));
        const int pixelHeight = static_cast<int>(CVPixelBufferGetHeight(frame.pixelBuffer));
        CVMetalTextureRef native = nullptr;
        const CVReturn result = CVMetalTextureCacheCreateTextureFromImage(
            kCFAllocatorDefault, node->cache, frame.pixelBuffer, nullptr,
            MTLPixelFormatBGRA8Unorm, pixelWidth, pixelHeight, 0, &native);
        if (result == kCVReturnSuccess && native) {
            id<MTLTexture> metal = CVMetalTextureGetTexture(native);
            QSGTexture *wrapper = QNativeInterface::QSGMetalTexture::fromNative(
                metal, window(), QSize(pixelWidth, pixelHeight));
            if (wrapper) {
                node->replaceTexture(wrapper, native);
                node->sourceSize = QSize(pixelWidth, pixelHeight);
                node->sequence = frame.sequence;
            } else {
                CFRelease(native);
            }
        }
    }
    CVPixelBufferRelease(frame.pixelBuffer);

    if (!node->texture()) {
        delete node;
        return nullptr;
    }
    const qreal sw = node->sourceSize.width() * sourceCropRect_.width();
    const qreal sh = node->sourceSize.height() * sourceCropRect_.height();
    node->setSourceRect(sourceCropRect_.x() * node->sourceSize.width(), sourceCropRect_.y() * node->sourceSize.height(), sw, sh);
    const qreal factor = std::min(width() / sw, height() / sh);
    const qreal drawWidth = sw * factor;
    const qreal drawHeight = sh * factor;
    node->setRect((width() - drawWidth) / 2, (height() - drawHeight) / 2,
                  drawWidth, drawHeight);
    node->setFiltering(QSGTexture::Linear);
    return node;
}
