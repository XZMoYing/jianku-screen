#import "QuickScreenshot.h"
#include "CaptureSurfacePolicy.h"

#import <ScreenCaptureKit/ScreenCaptureKit.h>
#import <CoreGraphics/CoreGraphics.h>
#import <AppKit/AppKit.h>
#include "../capture/CaptureSource.h"

#include "../render/CanvasRenderer.h"

#include <QDateTime>
#include <QDir>
#include <QFileInfo>
#include <QGuiApplication>
#include <QClipboard>
#include <QImage>
#include <QMetaObject>
#include <QPainter>
#include <QPointer>
#include <QDebug>
#include <QStandardPaths>
#include <QTimer>
#include <algorithm>

namespace {
QImage imageFromCG(CGImageRef source) {
    if (!source) return {};
    const int width = static_cast<int>(CGImageGetWidth(source));
    const int height = static_cast<int>(CGImageGetHeight(source));
    QImage image(width, height, QImage::Format_ARGB32_Premultiplied);
    if (image.isNull()) return {};
    CGColorSpaceRef colorSpace = CGColorSpaceCreateDeviceRGB();
    CGContextRef context = CGBitmapContextCreate(image.bits(), width, height, 8,
        image.bytesPerLine(), colorSpace,
        kCGImageAlphaPremultipliedFirst | kCGBitmapByteOrder32Host);
    CGColorSpaceRelease(colorSpace);
    if (!context) return {};
    CGContextDrawImage(context, CGRectMake(0, 0, width, height), source);
    CGContextRelease(context);
    return image;
}

// Composes the screenshot through the same CanvasRenderer the preview and the
// offline compositor use. Before this it had its own copy of the padding maths and
// knew only about a flat colour, so choosing a gradient or a built-in background
// produced a screenshot that looked nothing like the preview.
QString saveComposed(const QImage &source, const QVariantMap &options, const QString &backgroundRoot) {
    if (source.isNull()) return QStringLiteral("截图为空");
    const Render::CanvasStyle style = Render::canvasStyleFromMap(options, backgroundRoot);
    // No canvas size: the image grows to make room for the padding, which is the
    // one place the layout rule is solved from the content instead of the canvas.
    const Render::CanvasPlan plan = Render::planCanvas(style,
        Render::canvasSizeForAspect(source.size(), options.value("outputAspectRatio", "auto").toString()),
        QSizeF(source.width(), source.height()));
    if (!plan.valid) return QStringLiteral("截图合成失败：") + plan.error;

    QImage result(plan.width(), plan.height(), QImage::Format_ARGB32_Premultiplied);
    result.fill(Qt::transparent);
    QPainter painter(&result);
    painter.setRenderHint(QPainter::Antialiasing);
    painter.setRenderHint(QPainter::SmoothPixmapTransform);
    Render::drawCanvasBackdrop(painter, plan);
    Render::beginFrame(painter, plan, QColor(QString::fromLatin1(Render::kFrameColor)));
    const QRectF content = plan.layout.contentRect.translated(-plan.layout.frameRect.topLeft());
    painter.drawImage(content, source);
    Render::drawInsetBorder(painter, plan);
    Render::endFrame(painter, plan);
    painter.end();

    QString directory = options.value("screenshotDirectory").toString();
    if (directory.isEmpty())
        directory = QStandardPaths::writableLocation(QStandardPaths::PicturesLocation)
                    + "/Jianku Screen";
    if (!QDir().mkpath(directory)) return QStringLiteral("无法创建截图目录：") + directory;
    const QString fileName = directory + "/Jianku Screen "
        + QDateTime::currentDateTime().toString("yyyy-MM-dd HH-mm-ss-zzz") + ".png";
    return result.save(fileName, "PNG") ? fileName : QStringLiteral("截图保存失败：") + fileName;
}
} // namespace

QuickScreenshot::QuickScreenshot(QObject *parent) : QObject(parent) {}

void QuickScreenshot::setStatus(const QString &status) {
    status_ = status;
    emit statusChanged();
}

void QuickScreenshot::capture(const QVariantMap &options) {
    if (busy_) return;
    busy_ = true;
    qInfo() << "Jianku screenshot requested";
    setStatus(QStringLiteral("正在截图…"));
    QPointer<QuickScreenshot> self(this);
    const quint64 request = ++requestId_;
    QTimer::singleShot(15000, this, [self, request] {
        if (!self || !self->busy_ || self->requestId_ != request) return;
        ++self->requestId_;
        self->busy_ = false;
        self->setStatus(QStringLiteral("截图等待系统响应超时，请检查屏幕录制权限后重试"));
        emit self->finished(false);
    });
    const QVariantMap frozenOptions = options;
    const QVariantMap chosenSource = source_;
    const QString backgroundRoot = Render::bundledBackgroundRoot();
    const QSet<quint32> editorIds = editorCaptureWindowIds();
    [SCShareableContent getShareableContentExcludingDesktopWindows:NO
        onScreenWindowsOnly:NO
        completionHandler:^(SCShareableContent *content, NSError *error) {
            qInfo() << "Jianku screenshot sources ready" << bool(content) << bool(error);
            if (error || content.displays.count == 0) {
                const QString message = error ? QString::fromNSString(error.localizedDescription)
                                              : QStringLiteral("没有可截图的显示器");
                QMetaObject::invokeMethod(qApp, [self, message, request] {
                    if (self && self->requestId_ == request) { self->busy_ = false; self->setStatus(QStringLiteral("截图失败：") + message); emit self->finished(false); }
                }, Qt::QueuedConnection);
                return;
            }
            SCDisplay *display = content.displays.firstObject;
            const int displayIndex = chosenSource.value("displayIndex", 0).toInt();
            if (displayIndex >= 0 && displayIndex < static_cast<int>(content.displays.count))
                display = content.displays[displayIndex];
            const auto displayId = chosenSource.value("displayId").toUInt();
            if (displayId) {
                display = nil;
                for (SCDisplay *candidate in content.displays)
                    if (candidate.displayID == displayId) { display = candidate; break; }
                if (!display) {
                    QMetaObject::invokeMethod(qApp, [self, request] {
                        if (self && self->requestId_ == request) { self->busy_ = false; self->setStatus(QStringLiteral("所选显示器已断开，请重新选择来源")); emit self->finished(false); }
                    }, Qt::QueuedConnection);
                    return;
                }
            }
            SCWindow *window = nil;
            const QString kind = chosenSource.value("kind", "display").toString();
            if (kind == "window") {
                const auto windowId = chosenSource.value("windowId").toUInt();
                for (SCWindow *candidate in content.windows) if (candidate.windowID == windowId) window = candidate;
                if (!window) {
                    QMetaObject::invokeMethod(qApp, [self, request] {
                        if (self && self->requestId_ == request) { self->busy_ = false; self->setStatus(QStringLiteral("截图失败：请重新选择窗口")); emit self->finished(false); }
                    }, Qt::QueuedConnection);
                    return;
                }
            }
            const QRectF region(chosenSource.value("x").toDouble(), chosenSource.value("y").toDouble(),
                chosenSource.value("width").toDouble(), chosenSource.value("height").toDouble());
            if (kind == "region") {
                for (SCDisplay *candidate in content.displays) {
                    const CGRect r = CGDisplayBounds(candidate.displayID);
                    if (CGRectContainsPoint(r, CGPointMake(region.center().x(), region.center().y()))) display = candidate;
                }
            }
            SCContentFilter *filter = window ? [[SCContentFilter alloc] initWithDesktopIndependentWindow:window]
                : displayCaptureFilter(display, content.applications, content.windows, editorIds);
            SCStreamConfiguration *config = [[SCStreamConfiguration alloc] init];
            CGDisplayModeRef mode = CGDisplayCopyDisplayMode(display.displayID);
            config.width = mode ? CGDisplayModeGetPixelWidth(mode) : display.width;
            config.height = mode ? CGDisplayModeGetPixelHeight(mode) : display.height;
            if (mode) CGDisplayModeRelease(mode);
            Capture::CaptureSource captureSource;
            captureSource.kind = window ? Capture::SourceKind::Window : kind == "region" ? Capture::SourceKind::Region : Capture::SourceKind::Display;
            captureSource.regionPoints = region;
            const CGRect b = CGDisplayBounds(display.displayID);
            const QRectF bounds(b.origin.x, b.origin.y, b.size.width, b.size.height);
            const CGRect w = window ? window.frame : CGRectZero;
            const auto geometry = Capture::resolveGeometry(captureSource, bounds, QSize(int(config.width), int(config.height)),
                QRectF(w.origin.x, w.origin.y, w.size.width, w.size.height));
            if (!geometry.valid) {
                const QString message = geometry.error;
                QMetaObject::invokeMethod(qApp, [self, message, request] {
                    if (self && self->requestId_ == request) { self->busy_ = false; self->setStatus(message); emit self->finished(false); }
                }, Qt::QueuedConnection);
                return;
            }
            config.width = geometry.pixelSize.width();
            config.height = geometry.pixelSize.height();
            if (window) config.ignoreShadowsSingleWindow = YES;
            if (kind == "region") {
                config.sourceRect = CGRectMake(geometry.boundsPoints.x() - bounds.x(), geometry.boundsPoints.y() - bounds.y(),
                    geometry.boundsPoints.width(), geometry.boundsPoints.height());
                config.scalesToFit = YES;
            }
            config.showsCursor = NO;
            config.pixelFormat = kCVPixelFormatType_32BGRA;
            qInfo() << "Jianku screenshot native capture" << kind << config.width << config.height;
            [SCScreenshotManager captureImageWithFilter:filter configuration:config
                completionHandler:^(CGImageRef image, NSError *captureError) {
                    qInfo() << "Jianku screenshot image ready" << bool(image) << bool(captureError);
                    const QString result = captureError
                        ? QStringLiteral("截图失败：") + QString::fromNSString(captureError.localizedDescription)
                        : saveComposed(imageFromCG(image), frozenOptions, backgroundRoot);
                    qInfo() << "Jianku screenshot result" << result;
                    QMetaObject::invokeMethod(qApp, [self, result, request] {
                        if (!self || self->requestId_ != request) return;
                        self->busy_ = false;
                        const bool ok = QFileInfo::exists(result);
                        if (ok) {
                            self->lastPath_ = result;
                            QGuiApplication::clipboard()->setImage(QImage(result));
                        }
                        self->setStatus(ok ? QStringLiteral("截图已保存并复制：") + result : result);
                        emit self->finished(ok);
                    }, Qt::QueuedConnection);
                }];
        }];
}

void QuickScreenshot::revealLast() {
    if (!lastPath_.isEmpty()) [[NSWorkspace sharedWorkspace] activateFileViewerSelectingURLs:
        @[[NSURL fileURLWithPath:lastPath_.toNSString()]]];
}
