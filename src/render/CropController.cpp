#include "CropController.h"

namespace Render {
CropController::CropController(SettingsStore *settings, QObject *parent) : QObject(parent), settings_(settings) {
    connect(settings_, &SettingsStore::currentChanged, this, [this] { if (active_) cancel(); });
}
void CropController::setSourceSize(const QSizeF &source) { cancel(); source_ = source; emit changed(); }
QVariantMap CropController::draftPixels() const {
    const auto pixels = draft_.pixels(source_);
    return {{"x", std::round(pixels.x())}, {"y", std::round(pixels.y())},
        {"width", std::round(pixels.width())}, {"height", std::round(pixels.height())}};
}
void CropController::begin() {
    if (active_ || source_.isEmpty()) return;
    draft_ = sourceCropFromSettings(settings_->current()); active_ = true; error_.clear(); emit changed();
}
void CropController::cancel() { if (!active_) return; active_ = false; error_.clear(); emit changed(); }
bool CropController::apply() {
    if (!active_) return false;
    emit committing();
    active_ = false; error_.clear();
    const bool ok = settings_->setCurrent("screenCrop", draft_.map());
    if (!ok) error_ = QStringLiteral("裁切参数未能写入，请检查工程目录");
    emit committed(); emit changed(); return ok;
}
void CropController::resetDraft() { if (active_) setDraft({}); }
void CropController::setDraft(const SourceCrop &value) {
    if (!active_ || source_.isEmpty()) return;
    const auto safe = value.clamped();
    // Sample on original pixel edges, independently of the preview resolution.
    const auto pixels = safe.pixels(source_);
    const double x = std::clamp(std::round(pixels.left()), 0.0, source_.width() - std::ceil(source_.width() * .02));
    const double y = std::clamp(std::round(pixels.top()), 0.0, source_.height() - std::ceil(source_.height() * .02));
    const double right = std::min(source_.width(), std::max(x + std::ceil(source_.width() * .02), std::round(pixels.right())));
    const double bottom = std::min(source_.height(), std::max(y + std::ceil(source_.height() * .02), std::round(pixels.bottom())));
    draft_ = SourceCrop{x / source_.width(), y / source_.height(), (right - x) / source_.width(), (bottom - y) / source_.height()}.clamped();
    error_.clear(); emit changed();
}
bool CropController::setDraftPixels(const QVariantMap &pixels) {
    if (!active_ || source_.isEmpty()) return false;
    if (pixels.keys() != QStringList({"height", "width", "x", "y"})) return false;
    for (const auto &v : pixels) { bool ok = false; const double n = v.toDouble(&ok); if (v.metaType().id() == QMetaType::Bool || v.metaType().id() == QMetaType::QString || !ok || !std::isfinite(n) || n != std::floor(n)) { error_ = QStringLiteral("请输入整数像素"); emit changed(); return false; } }
    SourceCrop value{pixels["x"].toDouble() / source_.width(), pixels["y"].toDouble() / source_.height(),
        pixels["width"].toDouble() / source_.width(), pixels["height"].toDouble() / source_.height()};
    SourceCrop validated;
    if (!readSourceCrop(value.map(), &validated)) { error_ = QStringLiteral("裁切不能超出原画面，宽高至少为原尺寸的 2%"); emit changed(); return false; }
    setDraft(validated); return true;
}
void CropController::dragDraft(const QVariantMap &map, int handle, double dx, double dy) {
    SourceCrop origin;
    if (!active_ || !std::isfinite(dx) || !std::isfinite(dy) || handle < -1 || handle > 7 || !readSourceCrop(map, &origin)) return;
    setDraft(handle == -1 ? moveSourceCrop(origin, dx, dy) : resizeSourceCrop(origin, handle, dx, dy, source_));
}
void CropController::setAspectRatio(double ratio) {
    if (!active_ || !std::isfinite(ratio) || ratio <= 0) return;
    const auto current = draft_.pixels(source_); const QPointF centre = current.center();
    double w = current.width(), h = w / ratio;
    if (h > source_.height()) { h = source_.height(); w = h * ratio; }
    if (w > source_.width()) { w = source_.width(); h = w / ratio; }
    const double x = std::clamp(centre.x() - w / 2, 0.0, source_.width() - w);
    const double y = std::clamp(centre.y() - h / 2, 0.0, source_.height() - h);
    setDraft({x / source_.width(), y / source_.height(), w / source_.width(), h / source_.height()});
}
} // namespace Render
