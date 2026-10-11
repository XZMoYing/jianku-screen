#pragma once
#include "../src/render/MotionBlur.h"
#include <algorithm>
#include <cmath>

// Scalar oracle preserves the former double scratch-buffer algorithm. Production
// code must match every byte, including alpha, rather than a visual tolerance.
namespace BlurReference {
inline QImage move(const QImage &layer, const QPointF &vector) {
    using namespace Render::MotionBlur;
    if (std::hypot(vector.x(), vector.y()) < kMinimumMoveLength) return layer;
    const auto source = layer.convertToFormat(QImage::Format_ARGB32_Premultiplied);
    const int w = source.width(), h = source.height();
    std::vector<double> sums(size_t(w) * h * 4, 0);
    for (const auto &sample : mergeSamples(moveSampleOffsets(vector))) {
        for (int y = 0; y < h; ++y) {
            const int sy = y + sample.dy;
            if (sy < 0 || sy >= h) continue;
            const auto *row = reinterpret_cast<const QRgb *>(source.constScanLine(sy));
            for (int x = 0; x < w; ++x) {
                const int sx = x + sample.dx;
                if (sx < 0 || sx >= w) continue;
                const auto p = row[sx]; auto *cell = sums.data() + (size_t(y) * w + x) * 4;
                cell[0] += qAlpha(p) * sample.weight; cell[1] += qRed(p) * sample.weight;
                cell[2] += qGreen(p) * sample.weight; cell[3] += qBlue(p) * sample.weight;
            }
        }
    }
    QImage result(w, h, QImage::Format_ARGB32_Premultiplied);
    for (int y = 0; y < h; ++y) {
        auto *row = reinterpret_cast<QRgb *>(result.scanLine(y));
        for (int x = 0; x < w; ++x) {
            const auto *cell = sums.data() + (size_t(y) * w + x) * 4;
            row[x] = qRgba(int(std::lround(cell[1])), int(std::lround(cell[2])),
                int(std::lround(cell[3])), int(std::lround(cell[0])));
        }
    }
    return result;
}
inline QImage zoom(const QImage &layer, const QPointF &centre, double strength, int kernel) {
    const auto source = layer.convertToFormat(QImage::Format_ARGB32_Premultiplied);
    const int w = source.width(), h = source.height();
    std::vector<double> sums(size_t(w) * h * 4, 0), weights(size_t(w) * h, 0);
    for (int y = 0; y < h; ++y) for (int x = 0; x < w; ++x) {
        const double dx = centre.x() - x, dy = centre.y() - y;
        if (std::hypot(dx, dy) < 1e-6) continue;
        const double offset = Render::MotionBlur::pixelNoise(x, y);
        double total = 0;
        for (int t = 0; t < kernel; ++t) {
            const double p = std::clamp((t + offset) / kernel, 0.0, 1.0) * std::clamp(strength, 0.0, 1.0);
            const double weight = 4.0 * (p - p * p);
            if (weight <= 0) continue;
            const int sx = int(std::lround(x + dx * p)), sy = int(std::lround(y + dy * p));
            if (sx < 0 || sx >= w || sy < 0 || sy >= h) continue;
            const auto pixel = reinterpret_cast<const QRgb *>(source.constScanLine(sy))[sx];
            auto *cell = sums.data() + (size_t(y) * w + x) * 4;
            cell[0] += qAlpha(pixel) * weight; cell[1] += qRed(pixel) * weight;
            cell[2] += qGreen(pixel) * weight; cell[3] += qBlue(pixel) * weight; total += weight;
        }
        weights[size_t(y) * w + x] = total;
    }
    QImage result(w, h, QImage::Format_ARGB32_Premultiplied);
    for (int y = 0; y < h; ++y) {
        auto *row = reinterpret_cast<QRgb *>(result.scanLine(y));
        for (int x = 0; x < w; ++x) {
            const auto i = size_t(y) * w + x; const auto *cell = sums.data() + i * 4;
            row[x] = weights[i] > 0
                ? qRgba(int(std::lround(cell[1] / weights[i])), int(std::lround(cell[2] / weights[i])),
                    int(std::lround(cell[3] / weights[i])), int(std::lround(cell[0] / weights[i])))
                : reinterpret_cast<const QRgb *>(source.constScanLine(y))[x];
        }
    }
    return result;
}
} // namespace BlurReference
