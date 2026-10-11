#include "CanvasRenderer.h"
#include "ParallelRows.h"
#include <QPainter>
#include <algorithm>
#include <cmath>
#include <vector>
namespace Render {
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
        for (int pass = 0; pass < quality; ++pass) {
            const double offset = style.shadowBlur * (1.0 - double(pass) / quality) + .5;
            const int whole = int(std::floor(offset));
            const float fraction = float(offset - whole);
            Detail::parallelRows(height, [&](int begin, int end) {
            for (int y = begin; y < end; ++y) {
                const float *row = alpha.data() + y * width;
                for (int x = 0; x < width; ++x) {
                    const float left = std::lerp(row[std::clamp(x - whole, 0, width - 1)],
                        row[std::clamp(x - whole - 1, 0, width - 1)], fraction);
                    const float right = std::lerp(row[std::clamp(x + whole, 0, width - 1)],
                        row[std::clamp(x + whole + 1, 0, width - 1)], fraction);
                    horizontal[y * width + x] = (left + right) * .5f;
                }
            }
            });
            Detail::parallelRows(height, [&](int begin, int end) {
            for (int y = begin; y < end; ++y) {
                const float *top = horizontal.data() + std::clamp(y - whole, 0, height - 1) * width;
                const float *topNext = horizontal.data() + std::clamp(y - whole - 1, 0, height - 1) * width;
                const float *bottom = horizontal.data() + std::clamp(y + whole, 0, height - 1) * width;
                const float *bottomNext = horizontal.data() + std::clamp(y + whole + 1, 0, height - 1) * width;
                for (int x = 0; x < width; ++x) next[y * width + x] = std::round(
                    (std::lerp(top[x], topNext[x], fraction) + std::lerp(bottom[x], bottomNext[x], fraction)) * .5f);
            }
            });
            alpha.swap(next);
        }
        for (int y = 0; y < height; ++y) {
            auto *row = reinterpret_cast<QRgb *>(image.scanLine(y));
            for (int x = 0; x < width; ++x) row[x] = qRgba(0, 0, 0, int(alpha[y * width + x]));
        }
    }
    // Opacity belongs to the cached sprite, after filtering, not to the mask.
    const double intensity = std::clamp(style.shadowIntensity, 0.0, 1.0);
    for (int y = 0; y < height; ++y) {
        auto *row = reinterpret_cast<QRgb *>(image.scanLine(y));
        for (int x = 0; x < width; ++x) row[x] = qRgba(0, 0, 0, int(std::round(qAlpha(row[x]) * intensity)));
    }
    return image;
}

}
