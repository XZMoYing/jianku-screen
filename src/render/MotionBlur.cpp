#include "MotionBlur.h"
#include "ParallelRows.h"

#include <QtMath>
#include <algorithm>
#include <cmath>

#include <vector>

namespace Render::MotionBlur {
namespace {

// Deterministic hash of a pixel coordinate. The reference derives its zoom
// sample offset from a texture coordinate; the exact bit pattern is unknown, so
// this stands in for it. What matters for reproduction is that the offsets are
// stable for a given pixel and spread over [0,1), which keeps the sampling
// pattern from crawling between frames.
double hashNoise(int x, int y) {
    quint32 h = static_cast<quint32>(x) * 0x9E3779B1u ^ static_cast<quint32>(y) * 0x85EBCA77u;
    h ^= h >> 15;
    h *= 0x2545F491u;
    h ^= h >> 13;
    return (h & 0xFFFFFFu) / double(0x1000000);
}

using Detail::parallelRows;

} // namespace

Decision decide(const LayerMotion &motion, double amount, double moveAmount, double zoomAmount,
    double strengthFactor) {
    Decision decision;
    if (!(amount > 0.0) || !(strengthFactor > 0.0))
        return decision;

    // The two candidates are compared as lengths on the layer's boundary —
    // "how far did the centre travel" against "how much did the size change" —
    // not as a spring's raw velocity, so a fast pan and a fast zoom are told
    // apart by what a viewer would actually see moving.
    const double centreLength = std::hypot(motion.centreDelta.x(), motion.centreDelta.y());
    const double sizeChange = std::abs(motion.diagonal - motion.previousDiagonal);
    const bool zoomDominant = sizeChange > centreLength;

    if (zoomDominant) {
        // A zoom amount of 0 does not fall back to move: the reference leaves the
        // frame unfiltered rather than blurring along the wrong axis.
        if (zoomAmount <= 0.0 || sizeChange < kMinimumChange)
            return decision;
        // The strength itself is the relative size change, a ratio, even though
        // the dominance test above used an absolute length.
        const double relative = motion.previousDiagonal > 0.0
            ? std::abs(1.0 - motion.diagonal / motion.previousDiagonal) : 0.0;
        decision.channel = Channel::Zoom;
        decision.zoomStrength = relative * zoomAmount * amount * strengthFactor;
        return decision;
    }

    if (moveAmount <= 0.0 || centreLength < kMinimumChange)
        return decision;
    QPointF scaled = motion.centreDelta * (moveAmount * amount * strengthFactor);
    // Bound the smear. See kMaximumSmearRatio: an unbounded one-frame
    // displacement wipes most of the frame translucent during a fast camera
    // release, which is not the trailing the effect is meant to be.
    const double limit = kMaximumSmearRatio * std::max(motion.diagonal, motion.previousDiagonal);
    const double length = std::hypot(scaled.x(), scaled.y());
    if (limit > 0.0 && length > limit)
        scaled *= limit / length;
    decision.moveVector = scaled;
    decision.moveLength = std::hypot(scaled.x(), scaled.y());
    if (decision.moveLength < kMinimumMoveLength)
        return decision;
    decision.channel = Channel::Move;
    decision.zoomStrength = 0.0;
    return decision;
}

std::vector<QPointF> moveSampleOffsets(const QPointF &vector, int kernel) {
    std::vector<QPointF> offsets;
    if (kernel < 1)
        return offsets;
    // The reference requests offset = -length/2 and then walks
    //     bias vector * i/(kernel-1), i = 0..kernel-1
    // over that shifted range. The centre sample is taken first, then kernel-1
    // more, and the whole sum is divided by kernel — a one-sided distribution,
    // not a symmetric one. Reproduced literally so a slow move smears forward
    // the way the reference does instead of straddling the original position.
    offsets.reserve(kernel);
    const QPointF bias = vector / std::max(1, kernel - 1);
    for (int i = 0; i < kernel; ++i)
        offsets.push_back(bias * static_cast<double>(i));
    return offsets;
}

std::vector<Sample> mergeSamples(const std::vector<QPointF> &offsets) {
    std::vector<Sample> samples;
    if (offsets.empty())
        return samples;
    const double weight = 1.0 / static_cast<double>(offsets.size());
    for (const QPointF &offset : offsets) {
        const int dx = static_cast<int>(std::lround(offset.x()));
        const int dy = static_cast<int>(std::lround(offset.y()));
        auto found = std::find_if(samples.begin(), samples.end(),
            [dx, dy](const Sample &sample) { return sample.dx == dx && sample.dy == dy; });
        if (found != samples.end())
            found->weight += weight;
        else
            samples.push_back(Sample{dx, dy, weight});
    }
    return samples;
}

QPointF subtractParentMotion(const QPointF &child, const QPointF &parent) {
    QPointF result = child - parent;
    // An axis that ends up pointing the other way from the parent is cancelled.
    // Without this a cursor carried along by a panning camera would keep a
    // backwards smear of its own on top of the camera's.
    if (child.x() * parent.x() < 0.0)
        result.setX(0.0);
    if (child.y() * parent.y() < 0.0)
        result.setY(0.0);
    return result;
}

double pixelNoise(int x, int y) { return hashNoise(x, y); }

QImage accumulate(const QImage &layer, const std::vector<Sample> &samples) {
    if (layer.isNull() || samples.empty()) return layer;
    const QImage source = layer.format() == QImage::Format_ARGB32_Premultiplied
        ? layer : layer.convertToFormat(QImage::Format_ARGB32_Premultiplied);
    QImage result(source.size(), QImage::Format_ARGB32_Premultiplied);
    const int width = source.width(), height = source.height();
    const auto *input = source.constBits();
    auto *output = result.bits(); // Detach once, before any worker touches pixels.
    const auto inputStride = source.bytesPerLine(), outputStride = result.bytesPerLine();
    parallelRows(height, [&](int begin, int end) {
        for (int y = begin; y < end; ++y) {
            auto *row = reinterpret_cast<QRgb *>(output + y * outputStride);
            for (int x = 0; x < width; ++x) {
                double alpha = 0, red = 0, green = 0, blue = 0;
                // Preserve the former per-pixel accumulation order and doubles,
                // including transparent out-of-bounds samples and byte rounding.
                for (const auto &sample : samples) {
                    const int sx = x + sample.dx, sy = y + sample.dy;
                    if (sample.weight <= 0 || sx < 0 || sx >= width || sy < 0 || sy >= height) continue;
                    const auto pixel = reinterpret_cast<const QRgb *>(input + sy * inputStride)[sx];
                    alpha += qAlpha(pixel) * sample.weight; red += qRed(pixel) * sample.weight;
                    green += qGreen(pixel) * sample.weight; blue += qBlue(pixel) * sample.weight;
                }
                row[x] = qRgba(int(std::lround(red)), int(std::lround(green)),
                    int(std::lround(blue)), int(std::lround(alpha)));
            }
        }
    });
    return result;
}

QImage applyMove(const QImage &layer, const QPointF &vector) {
    const double length = std::hypot(vector.x(), vector.y());
    if (layer.isNull() || length < kMinimumMoveLength)
        return layer;
    return accumulate(layer, mergeSamples(moveSampleOffsets(vector)));
}

QImage applyZoom(const QImage &layer, const QPointF &centre, double strength, int maxKernel) {
    if (layer.isNull() || maxKernel < 1 || !(strength > 0.0))
        return layer;
    const QImage source = layer.format() == QImage::Format_ARGB32_Premultiplied
        ? layer : layer.convertToFormat(QImage::Format_ARGB32_Premultiplied);
    const int width = source.width(), height = source.height();
    QImage result(source.size(), QImage::Format_ARGB32_Premultiplied);
    const auto *input = source.constBits();
    auto *output = result.bits();
    const auto inputStride = source.bytesPerLine(), outputStride = result.bytesPerLine();
    const double radius = std::clamp(strength, 0.0, 1.0);
    parallelRows(height, [&](int begin, int end) {
        for (int y = begin; y < end; ++y) {
            auto *row = reinterpret_cast<QRgb *>(output + y * outputStride);
            for (int x = 0; x < width; ++x) {
                const double dx = centre.x() - x, dy = centre.y() - y;
                double alpha = 0, red = 0, green = 0, blue = 0, totalWeight = 0;
                if (std::hypot(dx, dy) >= 1e-6) {
                    const double offset = hashNoise(x, y);
                    for (int t = 0; t < maxKernel; ++t) {
                        const double percent = std::clamp((t + offset) / maxKernel, 0.0, 1.0) * radius;
                        const double weight = 4.0 * (percent - percent * percent);
                        if (weight <= 0) continue;
                        const int sx = int(std::lround(x + dx * percent));
                        const int sy = int(std::lround(y + dy * percent));
                        if (sx < 0 || sx >= width || sy < 0 || sy >= height) continue;
                        const auto pixel = reinterpret_cast<const QRgb *>(input + sy * inputStride)[sx];
                        alpha += qAlpha(pixel) * weight; red += qRed(pixel) * weight;
                        green += qGreen(pixel) * weight; blue += qBlue(pixel) * weight;
                        totalWeight += weight;
                    }
                }
                row[x] = totalWeight > 0
                    ? qRgba(int(std::lround(red / totalWeight)), int(std::lround(green / totalWeight)),
                        int(std::lround(blue / totalWeight)), int(std::lround(alpha / totalWeight)))
                    : reinterpret_cast<const QRgb *>(input + y * inputStride)[x];
            }
        }
    });
    return result;
}

} // namespace Render::MotionBlur
