#include "TimelineController.h"
#include <QClipboard>
#include <QCoreApplication>
#include <QGuiApplication>
#include <QJsonDocument>
#include <QMimeData>
#include <QUuid>
#include "../animation/AutomaticZoom.h"

namespace Render {
namespace {
QString newId() { return QUuid::createUuid().toString(QUuid::WithoutBraces); }
int focusIndex(const std::vector<Project::FocusClip> &clips, const QString &id) {
    for (int i = 0; i < int(clips.size()); ++i) if (clips[i].id == id) return i;
    return -1;
}
QByteArray clipboardFallback;
constexpr auto mimeType = "application/x-jianku-focus";
bool overlaps(const std::vector<Project::FocusClip> &clips, const Project::FocusClip &candidate) {
    for (const auto &f : clips) if (f.id != candidate.id && f.system == candidate.system
        && f.startMs < candidate.endMs - 1e-5 && f.endMs > candidate.startMs + 1e-5) return true;
    return false;
}
}
QVariantList TimelineController::focusSegments() const {
    QVariantList result;
    for (const auto &focus : focus_) {
        auto properties = Project::focusJson(focus).toVariantMap();
        if (focus.system && !focus.customized) {
            properties["zoom"] = appearance_.value("defaultZoomLevel", focus.zoom);
            properties["snapToEdgesRatio"] = appearance_.value("snapToEdgesRatio", focus.snapToEdgesRatio);
        }
        for (const auto &fragment : Project::focusFragments(focus, timeline_)) {
            auto row = properties;
            row["clipIndex"] = fragment.clipIndex;
            row["fragmentId"] = focus.id + ':' + timeline_.segments()[fragment.clipIndex].id;
            row["outputStartMs"] = fragment.startMs; row["outputEndMs"] = fragment.endMs;
            row["visibleSourceStartMs"] = fragment.sourceStartMs; row["visibleSourceEndMs"] = fragment.sourceEndMs;
            result.append(row);
        }
    }
    return result;
}
QVariantMap TimelineController::selectedFocus() const {
    QVariantMap fallback;
    for (const auto &v : focusSegments()) {
        const auto row = v.toMap();
        if (row.value("id").toString() != selectedFocusId_) continue;
        if (row.value("clipIndex").toInt() == selectedFocusClip_) return row;
        if (fallback.isEmpty()) fallback = row;
    }
    return fallback;
}
void TimelineController::selectFocus(const QString &id, int clipIndex) {
    if (focusIndex(focus_, id) < 0) return;
    selectedIds_.clear(); selectionAnchor_.clear(); selectedFocusId_ = id; selectedFocusClip_ = clipIndex;
    emit selectionChanged();
}
bool TimelineController::applyFocus(std::vector<Project::FocusClip> next, const QString &key) {
    if (!loaded_) return false;
    std::vector<Project::FocusClip> validated;
    QString error;
    if (!Project::readFocusTrack(Project::focusTrackJson(next), sourceDurationMs(), &validated, &error)) {
        setError(error); return false;
    }
    if (Project::focusTrackJson(focus_) == Project::focusTrackJson(next)) { setError({}); return true; }
    pushHistory(key); focus_ = std::move(next); notifyEdit(true); return true;
}
bool TimelineController::createFocus(double from, double to) {
    if (!loaded_ || !std::isfinite(from) || !std::isfinite(to)) return false;
    if (from > to) std::swap(from, to);
    from = std::max(0.0, from); to = std::min(outputDurationMs(), to);
    if (to - from < 100) { setError(QStringLiteral("焦点区间至少保留 100 毫秒")); return false; }
    auto next = focus_; QString selected; int selectedIndex = -1;
    for (int i = 0; i < int(timeline_.segments().size()); ++i) {
        const auto &segment = timeline_.segments()[i]; const double start = timeline_.outputStartAt(i);
        const double a = std::max(from, start), b = std::min(to, start + segment.outputLengthMs());
        if (b <= a + 1e-6) continue;
        Project::FocusClip f;
        f.id = newId(); f.system = false; f.fixedPosition = true; f.customized = true; f.snapToEdgesRatio = 0;
        f.zoom = std::clamp(appearance_.value("defaultZoomLevel", 2).toDouble(), 1.0, 6.0);
        f.startMs = segment.sourceStartMs + (a - start) * segment.speed;
        f.endMs = segment.sourceStartMs + (b - start) * segment.speed;
        if (overlaps(next, f)) { setError(QStringLiteral("这个区间已有手动焦点，请移动或裁剪现有区间")); return false; }
        next.push_back(f);
        if (selected.isEmpty()) { selected = f.id; selectedIndex = i; }
    }
    if (selected.isEmpty() || !applyFocus(next)) return false;
    selectFocus(selected, selectedIndex); return true;
}
bool TimelineController::addFocusAtPlayhead() {
    if (!loaded_) return false;
    for (int i = 0; i < int(timeline_.segments().size()); ++i) {
        const double a = timeline_.outputStartAt(i), b = a + timeline_.segments()[i].outputLengthMs();
        if (playheadMs_ >= a && (playheadMs_ < b || i == int(timeline_.segments().size()) - 1)) {
            const double start = std::max(a, std::min(playheadMs_, b - 100));
            return createFocus(start, std::min(b, start + 2000));
        }
    }
    return false;
}
bool TimelineController::updateFocus(const QString &id, const QVariantMap &properties) {
    const int index = focusIndex(focus_, id); if (index < 0 || properties.isEmpty()) return false;
    auto next = focus_; auto json = Project::focusJson(next[index]);
    const QStringList allowed{"zoom", "snapToEdgesRatio", "fixedPosition", "focusX", "focusY", "enabled"};
    for (auto i = properties.constBegin(); i != properties.constEnd(); ++i) {
        if (!allowed.contains(i.key())) { setError(QStringLiteral("不支持的焦点属性")); return false; }
        json[i.key()] = QJsonValue::fromVariant(i.value());
    }
    json["customized"] = true;
    auto array = Project::focusTrackJson(next).value("clips").toArray(); array[index] = json;
    QString error;
    if (!Project::readFocusTrack({{"version", 1}, {"clips", array}}, sourceDurationMs(), &next, &error)) { setError(error); return false; }
    return applyFocus(next, "focus:" + id + ':' + properties.keys().join(','));
}
QVariantMap TimelineController::focusBounds(const QString &id, int clipIndex) const {
    const int index = focusIndex(focus_, id);
    if (index < 0 || clipIndex < 0 || clipIndex >= int(timeline_.segments().size())) return {};
    const auto &f = focus_[index]; const auto &clip = timeline_.segments()[clipIndex];
    double a = timeline_.outputStartAt(clipIndex), b = a + clip.outputLengthMs();
    const double start = std::max(f.startMs, clip.sourceStartMs), end = std::min(f.endMs, clip.sourceEndMs);
    for (const auto &other : focus_) if (other.id != id && other.system == f.system) {
        if (other.endMs <= start + 1e-5 && other.endMs > clip.sourceStartMs)
            a = std::max(a, timeline_.outputStartAt(clipIndex) + (other.endMs - clip.sourceStartMs) / clip.speed);
        if (other.startMs >= end - 1e-5 && other.startMs < clip.sourceEndMs)
            b = std::min(b, timeline_.outputStartAt(clipIndex) + (other.startMs - clip.sourceStartMs) / clip.speed);
    }
    return {{"lower", a}, {"upper", b}};
}
bool TimelineController::setFocusTiming(const QString &id, int clipIndex, double from, double to) {
    const int index = focusIndex(focus_, id);
    if (index < 0 || clipIndex < 0 || clipIndex >= int(timeline_.segments().size()) || !std::isfinite(from) || !std::isfinite(to)) return false;
    const auto bounds = focusBounds(id, clipIndex);
    if (to - from < 100 - 1e-5 || from < bounds.value("lower").toDouble() - 1e-5 || to > bounds.value("upper").toDouble() + 1e-5) {
        setError(QStringLiteral("焦点不能越过相邻区间或剪辑切点，且至少保留 100 毫秒")); return false;
    }
    const auto &segment = timeline_.segments()[clipIndex]; const double origin = timeline_.outputStartAt(clipIndex);
    const auto original = focus_[index]; auto next = focus_;
    // Editing one displayed fragment materializes its siblings. This keeps other
    // retained source intervals unchanged instead of silently dropping them.
    const auto fragments = Project::focusFragments(original, timeline_);
    next.erase(next.begin() + index);
    for (const auto &fragment : fragments) if (fragment.clipIndex != clipIndex) {
        auto sibling = original; sibling.id = newId(); sibling.startMs = fragment.sourceStartMs; sibling.endMs = fragment.sourceEndMs;
        next.push_back(sibling);
    }
    auto edited = original; edited.startMs = segment.sourceStartMs + (from - origin) * segment.speed;
    edited.endMs = segment.sourceStartMs + (to - origin) * segment.speed;
    if (overlaps(next, edited)) { setError(QStringLiteral("焦点区间不能重叠")); return false; }
    next.push_back(edited); return applyFocus(next);
}
bool TimelineController::deleteFocus() {
    const int index = focusIndex(focus_, selectedFocusId_); if (index < 0) return false;
    auto next = focus_; next.erase(next.begin() + index); return applyFocus(next);
}
bool TimelineController::splitFocus() {
    const int index = focusIndex(focus_, selectedFocusId_); if (index < 0) return false;
    const auto selected = selectedFocus(); const double at = snappedPlayheadMs();
    if (at <= selected.value("outputStartMs").toDouble() + 1e-5 || at >= selected.value("outputEndMs").toDouble() - 1e-5) {
        setError(QStringLiteral("请把播放头移到选中焦点的中间")); return false;
    }
    const double source = timeline_.sourceTimeAt(at);
    auto next = focus_; auto right = next[index]; right.startMs = source; right.id = newId(); next[index].endMs = source; next.push_back(right);
    return applyFocus(next);
}
bool TimelineController::regenerateFocus() {
    if (!loaded_) return false;
    std::vector<double> clicks;
    for (const auto &e : recordedEvents_) if (e.kind == Animation::InputKind::Down) clicks.push_back(e.timeMs);
    const auto generated = Animation::automaticZooms(clicks, sourceDurationMs(), false,
        std::clamp(appearance_.value("defaultZoomLevel", 2).toDouble(), 1.0, 6.0));
    std::vector<Project::FocusClip> next;
    for (const auto &f : focus_) if (!f.system) next.push_back(f);
    for (const auto &range : generated) {
        Project::FocusClip f{range.startMs, range.endMs, range.zoom}; f.id = newId();
        f.snapToEdgesRatio = std::clamp(appearance_.value("snapToEdgesRatio", .25).toDouble(), 0.0, 1.0);
        next.push_back(f);
    }
    return applyFocus(next);
}
bool TimelineController::copyFocus() {
    const auto selected = selectedFocus(); if (selected.isEmpty()) return false;
    const double length = selected.value("outputEndMs").toDouble() - selected.value("outputStartMs").toDouble();
    const auto bytes = QJsonDocument(QJsonObject{{"schema", "jianku-focus/1"}, {"durationMs", length}, {"properties", QJsonObject::fromVariantMap(selected)}}).toJson();
    clipboardFallback = bytes;
    if (qobject_cast<QGuiApplication *>(QCoreApplication::instance())) {
        auto *mime = new QMimeData; mime->setData(mimeType, bytes); mime->setText(QString::fromUtf8(bytes));
        QGuiApplication::clipboard()->setMimeData(mime);
    }
    setError({}); return true;
}
bool TimelineController::pasteFocus(double output, bool attributesOnly) {
    QByteArray bytes = clipboardFallback;
    if (qobject_cast<QGuiApplication *>(QCoreApplication::instance())) bytes = QGuiApplication::clipboard()->mimeData()->data(mimeType);
    const auto data = QJsonDocument::fromJson(bytes).object();
    if (data.value("schema").toString() != "jianku-focus/1") { setError(QStringLiteral("请先复制一个焦点区间")); return false; }
    const auto source = data.value("properties").toObject();
    QVariantMap properties;
    for (const auto &key : {"zoom", "snapToEdgesRatio", "fixedPosition", "focusX", "focusY", "enabled"}) properties[key] = source.value(key).toVariant();
    if (attributesOnly) return updateFocus(selectedFocusId_, properties);
    if (output < 0) output = playheadMs_;
    const double length = data.value("durationMs").toDouble();
    if (!std::isfinite(length) || length < 100 || !std::isfinite(output) || output < 0 || output >= outputDurationMs()) return false;
    for (int i = 0; i < int(timeline_.segments().size()); ++i) {
        const auto &clip = timeline_.segments()[i]; const double start = timeline_.outputStartAt(i), end = start + clip.outputLengthMs();
        if (output < start || output >= end) continue;
        const double to = std::min(output + length, end);
        if (to - output < 100) { setError(QStringLiteral("播放头后可用区间不足 100 毫秒")); return false; }
        Project::FocusClip f;
        f.id = newId(); f.system = false; f.customized = true;
        auto json = Project::focusJson(f);
        for (auto p = properties.constBegin(); p != properties.constEnd(); ++p) json[p.key()] = QJsonValue::fromVariant(p.value());
        json["startMs"] = clip.sourceStartMs + (output - start) * clip.speed; json["endMs"] = clip.sourceStartMs + (to - start) * clip.speed;
        std::vector<Project::FocusClip> decoded;
        if (!Project::readFocusTrack({{"version", 1}, {"clips", QJsonArray{json}}}, sourceDurationMs(), &decoded)) return false;
        f = decoded.front();
        if (overlaps(focus_, f)) { setError(QStringLiteral("粘贴区间已有手动焦点，请选择空白位置")); return false; }
        auto next = focus_; next.push_back(f);
        if (!applyFocus(next)) return false;
        selectFocus(f.id, i); return true;
    }
    return false;
}
void TimelineController::beginFocusSnap(const QString &id, int clipIndex) {
    std::vector<double> targets{0, outputDurationMs(), playheadMs_}, initial;
    for (const auto &v : segments()) { const auto m = v.toMap(); targets.push_back(m.value("outputStartMs").toDouble()); targets.push_back(m.value("outputEndMs").toDouble()); }
    for (const auto &v : focusSegments()) {
        const auto f = v.toMap(); const double start = f.value("outputStartMs").toDouble(), end = f.value("outputEndMs").toDouble();
        if (f.value("id").toString() == id && (clipIndex < 0 || f.value("clipIndex").toInt() == clipIndex)) { initial = {start, end}; continue; }
        targets.push_back(start); targets.push_back(end);
    }
    magnet_.begin(targets, initial); emit snapChanged();
}
double TimelineController::snapFocusTime(double time, double pixels, double duration, bool bypass) {
    const double framed = TimelineGeometry::snapToFrame(time, frameDurationMs_);
    const double result = magnet_.resolve(framed, pixels, bypass, duration > 0 ? std::vector<double>{0, duration} : std::vector<double>{0});
    emit snapChanged(); return result;
}
} // namespace Render
