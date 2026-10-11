#include "FilmstripProvider.h"
#import <AVFoundation/AVFoundation.h>
#include <QCache>
#include <QDateTime>
#include <QCoreApplication>
#include <QFileInfo>
#include <QMutex>
#include <QMutexLocker>
#include <QPointer>
#include <QUrlQuery>
#include <atomic>
#include <algorithm>

namespace Render {
struct FilmstripProvider::Cache {
    QMutex mutex;
    QCache<QString, QImage> images{32 * 1024 * 1024};
};
class Response final : public QQuickImageResponse {
public:
    QImage frame;
    QString failure;
    std::shared_ptr<std::atomic<bool>> cancelled = std::make_shared<std::atomic<bool>>(false);
    ~Response() override { *cancelled = true; }
    void cancel() override { *cancelled = true; }
    QQuickTextureFactory *textureFactory() const override { return QQuickTextureFactory::textureFactoryForImage(frame); }
    QString errorString() const override { return failure; }
    void deliver(QImage image, QString error) { frame = std::move(image); failure = error; emit finished(); }
};
FilmstripProvider::FilmstripProvider() : cache_(std::make_shared<Cache>()) { pool_.setMaxThreadCount(2); }
FilmstripProvider::~FilmstripProvider() { pool_.waitForDone(); }
QQuickImageResponse *FilmstripProvider::requestImageResponse(const QString &id, const QSize &) {
    const QUrlQuery query(QUrl(QStringLiteral("image://filmstrip/") + id));
    const QString file = query.queryItemValue("file", QUrl::FullyDecoded);
    const double time = query.queryItemValue("time").toDouble();
    auto *response = new Response;
    QPointer<Response> self(response);
    const auto cancel = response->cancelled;
    const auto cache = cache_;
    pool_.start([self, cancel, cache, file, time] {
        QImage image; QString error;
        @autoreleasepool {
            const QFileInfo info(file);
            const QString key = file + QString::number(info.size()) + info.lastModified().toString(Qt::ISODateWithMs) + QString::number(time);
            { QMutexLocker lock(&cache->mutex); if (auto *cached = cache->images.object(key)) image = *cached; }
            if (image.isNull() && !*cancel) {
                AVURLAsset *asset = [AVURLAsset URLAssetWithURL:[NSURL fileURLWithPath:file.toNSString()] options:nil];
                AVAssetImageGenerator *generator = [[AVAssetImageGenerator alloc] initWithAsset:asset];
                generator.appliesPreferredTrackTransform = YES;
                generator.maximumSize = CGSizeMake(320, 200);
                generator.requestedTimeToleranceBefore = CMTimeMakeWithSeconds(0.06, 600);
                generator.requestedTimeToleranceAfter = CMTimeMakeWithSeconds(0.06, 600);
                NSError *nativeError = nil;
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
                CGImageRef frame = [generator copyCGImageAtTime:CMTimeMakeWithSeconds(std::max(0.0, time) / 1000, 60000) actualTime:nil error:&nativeError];
#pragma clang diagnostic pop
                if (frame) {
                    image = QImage(int(CGImageGetWidth(frame)), int(CGImageGetHeight(frame)), QImage::Format_ARGB32_Premultiplied);
                    image.fill(Qt::transparent);
                    CGColorSpaceRef color = CGColorSpaceCreateDeviceRGB();
                    CGContextRef bitmap = CGBitmapContextCreate(image.bits(), image.width(), image.height(), 8, image.bytesPerLine(), color,
                        CGBitmapInfo(kCGImageAlphaPremultipliedFirst) | CGBitmapInfo(kCGBitmapByteOrder32Little));
                    if (bitmap) { CGContextDrawImage(bitmap, CGRectMake(0, 0, image.width(), image.height()), frame); CGContextRelease(bitmap); }
                    else { image = {}; error = QStringLiteral("缩略图绘制失败"); }
                    CGColorSpaceRelease(color); CGImageRelease(frame);
                    if (!image.isNull()) { QMutexLocker lock(&cache->mutex); cache->images.insert(key, new QImage(image), int(image.sizeInBytes())); }
                } else error = nativeError ? QString::fromNSString(nativeError.localizedDescription) : QStringLiteral("缩略图不可用");
            }
        }
        QMetaObject::invokeMethod(qApp, [self, image = std::move(image), error] { if (self) self->deliver(image, error); }, Qt::QueuedConnection);
    });
    return response;
}
} // namespace Render
