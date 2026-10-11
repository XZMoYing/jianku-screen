#include "CanvasPreview.h"

#include <QCoreApplication>
#include <QDir>
#include <QFileInfo>
#include <algorithm>
#include <cmath>

namespace Render {

CanvasPreview::CanvasPreview(QObject *parent, const QString &imageProvider) : QObject(parent), imageProvider_(imageProvider) {
    // Built-in backgrounds: the bundle when running from one, else the source tree.
    const QString bundled = QDir(QCoreApplication::applicationDirPath())
        .filePath(QStringLiteral("../Resources/backgrounds"));
    if (QDir(bundled).exists())
        backgroundRoot_ = QDir(bundled).absolutePath();
    else
        backgroundRoot_ = QStringLiteral(JIANKU_SOURCE_DIR "/assets/backgrounds");
    update({}, sourceWidth_, sourceHeight_);
}

QRectF CanvasPreview::fraction(const QRectF &rect) const {
    if (!plan_.valid || plan_.width() <= 0 || plan_.height() <= 0)
        return {};
    // Fractions of the canvas, which the preview maps onto its own stage rect.
    return QRectF(rect.x() / plan_.width(), rect.y() / plan_.height(),
        rect.width() / plan_.width(), rect.height() / plan_.height());
}

double CanvasPreview::radiusRatio() const {
    if (!plan_.valid || plan_.height() <= 0)
        return 0.0;
    // Fraction of the canvas height, so the preview's stage shows the same corner
    // curvature as the exported file. The plan is in pixels and the stage is in
    // points, and the ratio is what bridges them.
    return style_.radius / plan_.height();
}

double CanvasPreview::insetRatio() const {
    if (!plan_.valid || plan_.height() <= 0)
        return 0.0;
    return style_.insetSize / plan_.height();
}

QRectF CanvasPreview::shadowRect() const {
    if (!plan_.valid || plan_.shadow.isNull()) return {};
    const double angle = style_.shadowAngle * M_PI / 180;
    const QRectF frame = plan_.layout.frameRect;
    const double x = std::cos(angle) * style_.shadowDistance - (plan_.shadow.width() - frame.width()) / 2;
    const double y = std::sin(angle) * style_.shadowDistance - (plan_.shadow.height() - frame.height()) / 2;
    return fraction(QRectF(x, y, plan_.shadow.width(), plan_.shadow.height()));
}

double CanvasPreview::planAspect() const {
    // Read from the plan, not from `valid`: an invalid plan still has a size, and the
    // preview must keep drawing at the right shape while it waits for a source.
    if (plan_.aspect() > 0.0)
        return plan_.aspect();
    return pixelHeight_ > 0.0 ? pixelWidth_ / pixelHeight_ : 16.0 / 9.0;
}

double CanvasPreview::backgroundBlur() const {
    return std::clamp(style_.backgroundBlur / 40.0, 0.0, 1.0);
}

QString CanvasPreview::backgroundUrl(const QString &name) const {
    if (name.isEmpty())
        return {};
    const QStringList candidates{backgroundRoot_ + QLatin1Char('/') + name,
        backgroundRoot_ + QStringLiteral("/backgrounds/") + name};
    for (const QString &candidate : candidates) {
        if (QFileInfo::exists(candidate))
            return QStringLiteral("file://") + candidate;
    }
    return {};
}

void CanvasPreview::update(const QVariantMap &settings, double sourceWidth, double sourceHeight,
    double pixelWidth, double pixelHeight) {
    if (sourceWidth > 0.0)
        sourceWidth_ = sourceWidth;
    if (sourceHeight > 0.0)
        sourceHeight_ = sourceHeight;
    // Until a pixel size is known, assume the points are the pixels. That is right for
    // a 1x display and is only a fallback: every real capture path passes both.
    pixelWidth_ = pixelWidth > 0.0 ? pixelWidth : sourceWidth_;
    pixelHeight_ = pixelHeight > 0.0 ? pixelHeight : sourceHeight_;
    style_ = canvasStyleFromMap(settings, backgroundRoot_);

    // Aspect ratio: the export picks its canvas from the source and the requested
    // ratio, and the preview has to show that same canvas. Built in *pixels* so the
    // absolute values in the style (radius, inset, shadow distance) mean the same
    // thing here as in the exported file; the preview scales the resulting fractions
    // down onto its own stage.
    const QSizeF canvas = outputSize_.isValid() ? outputSize_ : canvasSizeForAspect(QSizeF(pixelWidth_, pixelHeight_),
        settings.value(QStringLiteral("outputAspectRatio"),
            QStringLiteral("auto")).toString());
    plan_ = planCanvas(style_, canvas, QSizeF(pixelWidth_, pixelHeight_));
    ++revision_;
    emit changed();
}

void CanvasPreview::updateForOutput(const QVariantMap &settings, double sourceWidth, double sourceHeight,
    double pixelWidth, double pixelHeight, double outputWidth, double outputHeight) {
    outputSize_ = QSizeF(std::max(2.0, outputWidth), std::max(2.0, outputHeight));
    update(settings, sourceWidth, sourceHeight, pixelWidth, pixelHeight);
}

} // namespace Render
