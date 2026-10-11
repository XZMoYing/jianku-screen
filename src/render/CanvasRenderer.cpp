#include "CanvasRenderer.h"
#include "ParallelRows.h"
#include <QDateTime>

#include <QDir>
#include <QCoreApplication>
#include <QFileInfo>
#include <QLinearGradient>
#include <QPainter>
#include <QPainterPath>
#include <algorithm>
#include <cmath>
#include <vector>

namespace Render {
QString bundledBackgroundRoot() {
    const QString bundled = QDir(QCoreApplication::applicationDirPath()).filePath("../Resources/backgrounds");
    if (QDir(bundled).exists()) return QDir(bundled).absolutePath();
#ifdef JIANKU_SOURCE_DIR
    return QStringLiteral(JIANKU_SOURCE_DIR "/assets/backgrounds");
#else
    return {};
#endif
}
namespace {

QColor colorFrom(const QVariantMap &settings, const char *key, const QColor &fallback) {
    const QString value = settings.value(QString::fromLatin1(key)).toString().trimmed();
    if (value.isEmpty())
        return fallback;
    const QColor color(value);
    return color.isValid() ? color : fallback;
}

// Built-in backgrounds ship with the app; the caller may also point at a file.
QString findBackground(const QString &root, const QString &name) {
    if (name.isEmpty() || root.isEmpty())
        return {};
    const QStringList candidates{
        root + QLatin1Char('/') + name,
        root + QStringLiteral("/backgrounds/") + name};
    for (const QString &candidate : candidates) {
        if (QFileInfo::exists(candidate))
            return candidate;
    }
    return {};
}

} // namespace

void boxBlur(QImage &image, int radius, int passes) {
    if (radius <= 0 || image.isNull() || passes <= 0)
        return;
    const int width = image.width();
    const int height = image.height();
    QImage scratch(image.size(), QImage::Format_ARGB32_Premultiplied);
    std::vector<int> channel(std::max(width, height));

    for (int pass = 0; pass < passes; ++pass) {
        for (int y = 0; y < height; ++y) {
            const QRgb *src = reinterpret_cast<const QRgb *>(image.constScanLine(y));
            QRgb *dst = reinterpret_cast<QRgb *>(scratch.scanLine(y));
            for (int component = 0; component < 4; ++component) {
                int sum = 0;
                const int shift = component * 8;
                for (int x = -radius; x <= radius; ++x)
                    sum += (src[std::clamp(x, 0, width - 1)] >> shift) & 0xff;
                const int count = 2 * radius + 1;
                for (int x = 0; x < width; ++x) {
                    channel[x] = sum / count;
                    const int outgoing = std::clamp(x - radius, 0, width - 1);
                    const int incoming = std::clamp(x + radius + 1, 0, width - 1);
                    sum += ((src[incoming] >> shift) & 0xff) - ((src[outgoing] >> shift) & 0xff);
                }
                for (int x = 0; x < width; ++x)
                    dst[x] = (dst[x] & ~(0xff << shift)) | (channel[x] << shift);
            }
        }
        for (int x = 0; x < width; ++x) {
            for (int component = 0; component < 4; ++component) {
                const int shift = component * 8;
                int sum = 0;
                for (int y = -radius; y <= radius; ++y)
                    sum += (reinterpret_cast<const QRgb *>(scratch.constScanLine(
                                std::clamp(y, 0, height - 1)))[x] >> shift) & 0xff;
                const int count = 2 * radius + 1;
                for (int y = 0; y < height; ++y) {
                    channel[y] = sum / count;
                    const int outgoing = std::clamp(y - radius, 0, height - 1);
                    const int incoming = std::clamp(y + radius + 1, 0, height - 1);
                    sum += ((reinterpret_cast<const QRgb *>(scratch.constScanLine(incoming))[x] >> shift) & 0xff)
                        - ((reinterpret_cast<const QRgb *>(scratch.constScanLine(outgoing))[x] >> shift) & 0xff);
                }
                for (int y = 0; y < height; ++y) {
                    QRgb *dst = reinterpret_cast<QRgb *>(image.scanLine(y));
                    dst[x] = (dst[x] & ~(0xff << shift)) | (channel[y] << shift);
                }
            }
        }
    }
}

CanvasStyle canvasStyleFromMap(const QVariantMap &settings, const QString &backgroundRoot) {
    CanvasStyle style;
    style.backgroundType = settings.value(QStringLiteral("backgroundType"),
        QStringLiteral("gradient")).toString();
    style.backgroundColor = colorFrom(settings, "backgroundColor", QColor(QStringLiteral("#1b2230")));
    style.gradientStart = colorFrom(settings, "gradientStartColor", QColor(QStringLiteral("#3F37C9")));
    style.gradientEnd = colorFrom(settings, "gradientEndColor", QColor(QStringLiteral("#8C87DF")));
    style.gradientAngle = settings.value(QStringLiteral("gradientAngle"), 135.0).toDouble();
    style.backgroundBlur = settings.value(QStringLiteral("backgroundBlur"), 0.0).toDouble();

    style.paddingPercent = settings.value(QStringLiteral("backgroundPaddingRatio"), 0.0).toDouble();
    style.radius = settings.value(QStringLiteral("windowBorderRadius"), 0.0).toDouble();
    style.insetSize = settings.value(QStringLiteral("insetSize"), 0.0).toDouble();
    style.insetColor = colorFrom(settings, "insetColor", QColor(QStringLiteral("#000000")));
    style.insetAlpha = settings.value(QStringLiteral("insetAlpha"), 0.5).toDouble();

    style.shadowIntensity = settings.value(QStringLiteral("shadowIntensity"), 0.0).toDouble();
    style.shadowAngle = settings.value(QStringLiteral("shadowAngle"), 90.0).toDouble();
    style.shadowDistance = settings.value(QStringLiteral("shadowDistance"), 0.0).toDouble();
    style.shadowBlur = settings.value(QStringLiteral("shadowBlur"), 0.0).toDouble();

    if (style.backgroundType == QStringLiteral("image")) {
        const QString path = settings.value(QStringLiteral("backgroundImagePath")).toString();
        if (!path.isEmpty() && QFileInfo::exists(path))
            style.backgroundImagePath = path;
    } else if (style.backgroundType == QStringLiteral("system")) {
        style.backgroundImagePath = findBackground(backgroundRoot,
            settings.value(QStringLiteral("backgroundSystemName")).toString());
    }
    if (!style.backgroundImagePath.isEmpty()) {
        const QFileInfo image(style.backgroundImagePath);
        style.backgroundImageModifiedMs = image.lastModified().toMSecsSinceEpoch();
        style.backgroundImageBytes = image.size();
    }
    return style;
}

QImage buildBackground(const CanvasStyle &style, const QSize &size) {
    QImage image(size, QImage::Format_ARGB32_Premultiplied);
    image.fill(style.backgroundColor);
    QPainter painter(&image);
    painter.setRenderHint(QPainter::SmoothPixmapTransform);

    if ((style.backgroundType == QStringLiteral("image")
            || style.backgroundType == QStringLiteral("system"))
        && !style.backgroundImagePath.isEmpty()) {
        QImage source(style.backgroundImagePath);
        if (!source.isNull()) {
            const QSize scaled = source.size().scaled(size, Qt::KeepAspectRatioByExpanding);
            const QRect target((size.width() - scaled.width()) / 2,
                (size.height() - scaled.height()) / 2, scaled.width(), scaled.height());
            painter.drawImage(target, source);
        }
    } else if (style.backgroundType == QStringLiteral("gradient")) {
        // The preview rotates a square gradient by gradientAngle; reproducing it
        // as a linear gradient along that angle keeps both ends visible.
        const QPointF centre(size.width() / 2.0, size.height() / 2.0);
        const double radians = style.gradientAngle * M_PI / 180.0;
        const double half = std::hypot(double(size.width()), double(size.height())) / 2.0;
        QLinearGradient gradient(
            QPointF(centre.x() - std::cos(radians) * half, centre.y() - std::sin(radians) * half),
            QPointF(centre.x() + std::cos(radians) * half, centre.y() + std::sin(radians) * half));
        gradient.setColorAt(0.0, style.gradientStart);
        gradient.setColorAt(1.0, style.gradientEnd);
        painter.fillRect(QRect(QPoint(0, 0), size), gradient);
    }
    painter.end();

    if (style.backgroundBlur > 0.001) {
        // The reference maps its 0..40 slider onto a blur radius; the exact curve
        // is not verified, so keep it proportional and leave the UI honest.
        const int radius = static_cast<int>(std::round(style.backgroundBlur * 0.25));
        boxBlur(image, std::max(1, radius), 2);
    }
    return image;
}

QImage buildShadowSprite(const QSizeF &frameSize, const CanvasStyle &style) {
    // The reference caches a padded shadow texture. Its Kawase filter samples
    // much farther than a Gaussian of blur/2; the old 28 px padding clipped the
    // default halo and made it appear harsh. mp = distance + blur * 5.
    const int pad = static_cast<int>(std::ceil(style.shadowDistance + style.shadowBlur * 5)) + 8;
    const int width = static_cast<int>(std::ceil(frameSize.width())) + pad * 2;
    const int height = static_cast<int>(std::ceil(frameSize.height())) + pad * 2;
    if (width <= 0 || height <= 0)
        return {};
    QImage image(width, height, QImage::Format_ARGB32_Premultiplied);
    image.fill(Qt::transparent);
    QPainter painter(&image);
    painter.setRenderHint(QPainter::Antialiasing);
    painter.setPen(Qt::NoPen);
    painter.setBrush(Qt::black);
    painter.drawRoundedRect(QRectF(pad, pad, frameSize.width(), frameSize.height()),
        style.radius, style.radius);
    painter.end();
    if (style.shadowBlur > 0.0) {
        // Independently implement the verified four-diagonal-sample Kawase path.
        // Equal x/y offsets make each pass separable. Retain float intermediates
        // within a pass, then quantise the same way as an RGBA8 render texture.
        const int quality = style.shadowQuality > 0 ? style.shadowQuality
            : std::max(1, int(std::round(style.shadowBlur * .625)));
        std::vector<float> alpha(width * height), horizontal(width * height), next(width * height);
        for (int y = 0; y < height; ++y) {
            const auto *row = reinterpret_cast<const QRgb *>(image.constScanLine(y));
            for (int x = 0; x < width; ++x) alpha[y * width + x] = qAlpha(row[x]);
        }
        // This inner rectangle is fully opaque even with fractional frame sizes
        // and antialiased corners. Shrink it by each filter's support. Sampling
        // 255 throughout still yields exactly 255, so fill it instead of doing
        // identical taps across millions of interior pixels on a large display.
        int solidLeft = std::clamp(int(std::ceil(pad + std::max(0.0, style.radius))) + 1, 0, width);
        int solidRight = std::clamp(int(std::floor(pad + frameSize.width() - std::max(0.0, style.radius))) - 1, 0, width);
        int solidTop = std::clamp(int(std::ceil(pad + std::max(0.0, style.radius))) + 1, 0, height);
        int solidBottom = std::clamp(int(std::floor(pad + frameSize.height() - std::max(0.0, style.radius))) - 1, 0, height);
        for (int pass = 0; pass < quality; ++pass) {
            const double offset = style.shadowBlur * (1.0 - double(pass) / quality) + .5;
            const int whole = int(std::floor(offset));
            const float fraction = float(offset - whole);
            const int left = std::min(width, solidLeft + whole + 1), right = std::max(0, solidRight - whole - 1);
            const int topRow = std::min(height, solidTop + whole + 1), bottomRow = std::max(0, solidBottom - whole - 1);
            Detail::parallelRows(height, [&](int begin, int end) {
                for (int y = begin; y < end; ++y) {
                    const float *row = alpha.data() + y * width;
                    float *dst = horizontal.data() + y * width;
                    const bool solid = y >= solidTop && y < solidBottom && left < right;
                    const int a = solid ? left : 0, b = solid ? right : 0;
                    auto sample = [&](int x) {
                        const float lo = std::lerp(row[std::clamp(x - whole, 0, width - 1)],
                            row[std::clamp(x - whole - 1, 0, width - 1)], fraction);
                        const float hi = std::lerp(row[std::clamp(x + whole, 0, width - 1)],
                            row[std::clamp(x + whole + 1, 0, width - 1)], fraction);
                        dst[x] = (lo + hi) * .5f;
                    };
                    for (int x = 0; x < a; ++x) sample(x);
                    std::fill(dst + a, dst + b, 255.0f);
                    for (int x = b; x < width; ++x) sample(x);
                }
            }, 4);
            Detail::parallelRows(height, [&](int begin, int end) {
                for (int y = begin; y < end; ++y) {
                    const float *top = horizontal.data() + std::clamp(y - whole, 0, height - 1) * width;
                    const float *topNext = horizontal.data() + std::clamp(y - whole - 1, 0, height - 1) * width;
                    const float *bottom = horizontal.data() + std::clamp(y + whole, 0, height - 1) * width;
                    const float *bottomNext = horizontal.data() + std::clamp(y + whole + 1, 0, height - 1) * width;
                    float *dst = next.data() + y * width;
                    const bool solid = y >= topRow && y < bottomRow && left < right;
                    const int a = solid ? left : 0, b = solid ? right : 0;
                    auto sample = [&](int x) { dst[x] = std::round(
                        (std::lerp(top[x], topNext[x], fraction) + std::lerp(bottom[x], bottomNext[x], fraction)) * .5f); };
                    for (int x = 0; x < a; ++x) sample(x);
                    std::fill(dst + a, dst + b, 255.0f);
                    for (int x = b; x < width; ++x) sample(x);
                }
            }, 4);
            alpha.swap(next);
            solidLeft = left; solidRight = right; solidTop = topRow; solidBottom = bottomRow;
        }
        // Apply the same post-filter opacity while writing the final image;
        // avoid writing/reading that full image once more just for opacity.
        const double intensity = std::clamp(style.shadowIntensity, 0.0, 1.0);
        auto *pixels = reinterpret_cast<QRgb *>(image.bits()); const int stride = image.bytesPerLine() / sizeof(QRgb);
        Detail::parallelRows(height, [&](int begin, int end) {
            for (int y = begin; y < end; ++y) {
                auto *row = pixels + y * stride;
                for (int x = 0; x < width; ++x) row[x] = qRgba(0, 0, 0, int(std::round(int(alpha[y * width + x]) * intensity)));
            }
        }, 4);
        return image;
    }
    // Opacity belongs to the cached sprite, after filtering, not to the mask.
    const double intensity = std::clamp(style.shadowIntensity, 0.0, 1.0);
    for (int y = 0; y < height; ++y) {
        auto *row = reinterpret_cast<QRgb *>(image.scanLine(y));
        for (int x = 0; x < width; ++x) row[x] = qRgba(0, 0, 0, int(std::round(qAlpha(row[x]) * intensity)));
    }
    return image;
}

CanvasPlan planCanvas(const CanvasStyle &style, const QSizeF &canvasSize, const QSizeF &contentSize,
    const CanvasPlan *previous) {
    CanvasPlan plan;
    plan.style = style;
    if (contentSize.width() <= 0.0 || contentSize.height() <= 0.0) {
        plan.error = QStringLiteral("画面内容尺寸无效");
        return plan;
    }

    CanvasLayoutInput input;
    input.content = contentSize;
    input.paddingPercent = style.paddingPercent;
    input.radius = style.radius;
    input.inset = style.insetSize;
    if (canvasSize.width() > 0.0 && canvasSize.height() > 0.0) {
        input.canvas = canvasSize;
    } else {
        // Grow the canvas from the content: the screenshot path. Solving the same
        // padding rule the other way round keeps the two identical, which is what
        // failed before — the screenshot took a percentage of the source while the
        // preview took one of the canvas, so the same setting gave two paddings.
        const double padding = paddingForContent(contentSize, style.paddingPercent);
        input.canvas = QSizeF(contentSize.width() + 2 * padding, contentSize.height() + 2 * padding);
    }
    plan.canvasSize = input.canvas;
    plan.layout = computeCanvasLayout(input);
    if (!plan.layout.valid) {
        plan.error = QStringLiteral("画布布局计算失败：来源或画布尺寸无效");
        return plan;
    }
    const QSize size(plan.width(), plan.height());
    if (size.width() < 2 || size.height() < 2) {
        plan.error = QStringLiteral("画布尺寸过小");
        return plan;
    }
    const CanvasStyle old = previous ? previous->style : CanvasStyle{};
    const bool sameBackground = previous && previous->valid && previous->background.size() == size
        && old.backgroundType == style.backgroundType && old.backgroundImagePath == style.backgroundImagePath
        && old.backgroundImageModifiedMs == style.backgroundImageModifiedMs && old.backgroundImageBytes == style.backgroundImageBytes
        && old.backgroundColor == style.backgroundColor && old.gradientStart == style.gradientStart
        && old.gradientEnd == style.gradientEnd && old.gradientAngle == style.gradientAngle
        && old.backgroundBlur == style.backgroundBlur;
    plan.background = sameBackground ? previous->background : buildBackground(style, size);
    if (style.shadowIntensity > 0.001) {
        const bool sameShadow = previous && previous->valid && !previous->shadow.isNull()
            && previous->layout.frameRect.size() == plan.layout.frameRect.size()
            && old.radius == style.radius && old.shadowIntensity == style.shadowIntensity
            && old.shadowDistance == style.shadowDistance && old.shadowBlur == style.shadowBlur
            && old.shadowQuality == style.shadowQuality;
        plan.shadow = sameShadow ? previous->shadow : buildShadowSprite(plan.layout.frameRect.size(), style);
    }
    plan.valid = true;
    return plan;
}

void drawCanvasBackdrop(QPainter &painter, const CanvasPlan &plan) {
    if (!plan.valid)
        return;
    painter.drawImage(0, 0, plan.background);
    if (plan.style.shadowIntensity > 0.001 && !plan.shadow.isNull()) {
        const QImage &shadow = plan.shadow;
        const double radians = plan.style.shadowAngle * M_PI / 180.0;
        const QPointF offset(std::cos(radians) * plan.style.shadowDistance,
            std::sin(radians) * plan.style.shadowDistance);
        painter.save();
        painter.translate(plan.layout.frameRect.topLeft() + offset);
        painter.translate(-(shadow.width() - plan.layout.frameRect.width()) / 2.0,
            -(shadow.height() - plan.layout.frameRect.height()) / 2.0);
        painter.drawImage(0, 0, shadow);
        painter.restore();
    }
}

void beginFrame(QPainter &painter, const CanvasPlan &plan, const QColor &frameColor) {
    if (!plan.valid)
        return;
    const QRectF frameRect = plan.layout.frameRect;
    painter.save();
    painter.setClipRect(QRectF(QPointF(0, 0), plan.canvasSize));
    painter.translate(frameRect.topLeft());

    QPainterPath framePath;
    framePath.addRoundedRect(QRectF(0.0, 0.0, frameRect.width(), frameRect.height()),
        plan.style.radius, plan.style.radius);
    painter.setClipPath(framePath, Qt::IntersectClip);
    painter.fillPath(framePath, frameColor);
}

void drawInsetBorder(QPainter &painter, const CanvasPlan &plan) {
    if (!plan.valid || plan.style.insetSize <= 0.01)
        return;
    QColor color = plan.style.insetColor;
    color.setAlphaF(static_cast<float>(std::clamp(plan.style.insetAlpha, 0.0, 1.0)));
    QPen pen(color);
    pen.setWidthF(plan.style.insetSize);
    painter.setPen(pen);
    painter.setBrush(Qt::NoBrush);
    const QRectF frameRect = plan.layout.frameRect;
    const double half = plan.style.insetSize / 2.0;
    const double radius = std::max(0.0, plan.style.radius - half);
    painter.drawRoundedRect(QRectF(half, half, frameRect.width() - plan.style.insetSize,
        frameRect.height() - plan.style.insetSize), radius, radius);
}

void endFrame(QPainter &painter, const CanvasPlan &plan) {
    if (!plan.valid)
        return;
    painter.restore();
}

} // namespace Render
