#pragma once
#include <QRectF>
#include <QSizeF>
#include <QVariantMap>
#include <algorithm>
#include <cmath>

namespace Render {
// Adapted from DogSC NormalizedCrop and EditorCanvasPreview's crop gestures
// (MIT, locked source/excerpts in third_party/dogsc). The recording remains in
// original pixels; only the sampling rectangle and composition coordinates move.
struct SourceCrop {
    double x = 0, y = 0, width = 1, height = 1;
    QVariantMap map() const { return {{"x", x}, {"y", y}, {"width", width}, {"height", height}}; }
    QRectF normalizedRect() const { return {x, y, width, height}; }
    QRectF pixels(const QSizeF &size) const { return {x * size.width(), y * size.height(), width * size.width(), height * size.height()}; }
    bool full() const { return std::abs(x) < 1e-9 && std::abs(y) < 1e-9 && std::abs(width - 1) < 1e-9 && std::abs(height - 1) < 1e-9; }
    SourceCrop clamped(double minimum = .02) const {
        minimum = std::clamp(minimum, .001, 1.0);
        const double a = std::clamp(std::isfinite(x) ? x : 0, 0.0, 1 - minimum);
        const double b = std::clamp(std::isfinite(y) ? y : 0, 0.0, 1 - minimum);
        return {a, b, std::clamp(std::isfinite(width) ? width : 1, minimum, 1 - a),
            std::clamp(std::isfinite(height) ? height : 1, minimum, 1 - b)};
    }
};
inline bool readSourceCrop(const QVariant &value, SourceCrop *out) {
    if (value.metaType().id() != QMetaType::QVariantMap) return false;
    const auto map = value.toMap();
    if (map.keys() != QStringList({"height", "width", "x", "y"})) return false;
    for (const auto &v : map) {
        if (v.metaType().id() == QMetaType::Bool || v.metaType().id() == QMetaType::QString) return false;
        bool ok = false; const double n = v.toDouble(&ok);
        if (!ok || !std::isfinite(n)) return false;
    }
    SourceCrop crop{map["x"].toDouble(), map["y"].toDouble(), map["width"].toDouble(), map["height"].toDouble()};
    if (crop.x < 0 || crop.y < 0 || crop.width < .02 - 1e-9 || crop.height < .02 - 1e-9
        || crop.x + crop.width > 1 + 1e-9 || crop.y + crop.height > 1 + 1e-9) return false;
    *out = crop.clamped(); return true;
}
inline SourceCrop sourceCropFromSettings(const QVariantMap &settings) {
    SourceCrop crop;
    if (settings.contains("screenCrop")) readSourceCrop(settings.value("screenCrop"), &crop);
    return crop;
}
inline SourceCrop moveSourceCrop(const SourceCrop &origin, double dx, double dy) {
    return {std::clamp(origin.x + dx, 0.0, 1 - origin.width), std::clamp(origin.y + dy, 0.0, 1 - origin.height), origin.width, origin.height};
}
// Clockwise handles: top-left, top, top-right, right, bottom-right, bottom,
// bottom-left, left. Opposite edges remain anchored to the gesture's origin.
inline SourceCrop resizeSourceCrop(const SourceCrop &origin, int handle, double dx, double dy, const QSizeF &source) {
    const double minW = std::min(1.0, std::max(.02, 24 / std::max(1.0, source.width())));
    const double minH = std::min(1.0, std::max(.02, 24 / std::max(1.0, source.height())));
    double l = origin.x, r = l + origin.width, t = origin.y, b = t + origin.height;
    if (handle == 0 || handle == 6 || handle == 7) l = std::clamp(l + dx, 0.0, std::max(0.0, r - minW));
    if (handle == 2 || handle == 3 || handle == 4) r = std::clamp(r + dx, std::min(1.0, l + minW), 1.0);
    if (handle == 0 || handle == 1 || handle == 2) t = std::clamp(t + dy, 0.0, std::max(0.0, b - minH));
    if (handle == 4 || handle == 5 || handle == 6) b = std::clamp(b + dy, std::min(1.0, t + minH), 1.0);
    return SourceCrop{l, t, r - l, b - t}.clamped();
}
} // namespace Render
