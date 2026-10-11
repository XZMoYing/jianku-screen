#include "TimelineController.h"

#include "../project/EditSidecar.h"
#include "ProjectCompositor.h"

#include <QDir>
#include <QFileInfo>
#include <QDateTime>
#include <QGuiApplication>
#include <QClipboard>
#include <QMimeData>
#include <QUuid>
#include "../animation/AutomaticZoom.h"
#include <cmath>
#include <QUrl>
#include <QUrlQuery>
#include <QJsonArray>
#include <algorithm>

namespace Render {
namespace {

// Bounded so a long editing session cannot grow memory without limit. Deep enough
// that no realistic run of edits hits it.
constexpr size_t kMaxHistory = 100;

} // namespace

TimelineController::TimelineController(QObject *parent) : QObject(parent) {}

QVariantList TimelineController::segments() const {
    QVariantList list;
    if (!timeline_.valid())
        return list;
    double outputStart = 0.0;
    int index = 0;
    for (const Project::Segment &segment : timeline_.segments()) {
        const double outputLength = segment.outputLengthMs();
        list.append(QVariantMap{
            {QStringLiteral("id"), segment.id}, {QStringLiteral("index"), index++},
            {QStringLiteral("outputStartMs"), outputStart},
            {QStringLiteral("outputEndMs"), outputStart + outputLength},
            {QStringLiteral("sourceStartMs"), segment.sourceStartMs},
            {QStringLiteral("sourceEndMs"), segment.sourceEndMs},
            {QStringLiteral("speed"), segment.speed},
            // Fractions of the total output, so the strip can be laid out without
            // knowing the pixel width.
            {QStringLiteral("startRatio"), outputStart / std::max(1.0, outputDurationMs())},
            {QStringLiteral("lengthRatio"), outputLength / std::max(1.0, outputDurationMs())},
            {QStringLiteral("retimed"), std::abs(segment.speed - 1.0) > 1e-6}});
        outputStart += outputLength;
    }
    return list;
}

std::vector<int> TimelineController::selectedIndices() const {
    std::vector<int> indices;
    for (int i = 0; i < int(timeline_.segments().size()); ++i)
        if (selectedIds_.contains(timeline_.segments()[i].id)) indices.push_back(i);
    return indices;
}
void TimelineController::pruneSelection() {
    QStringList ids;
    for (const auto &segment : timeline_.segments()) if (selectedIds_.contains(segment.id)) ids.append(segment.id);
    selectedIds_ = ids;
    if (!selectedFocusId_.isEmpty()) {
        const auto fragments = focusSegments(); bool found = false;
        for (const auto &v : fragments) if (v.toMap().value("id").toString() == selectedFocusId_) {
            found = true; break;
        }
        if (!found) { selectedFocusId_.clear(); selectedFocusClip_ = -1; }
    }
    emit selectionChanged();
}
void TimelineController::clearSelection() {
    selectedIds_.clear(); selectionAnchor_.clear(); selectedFocusId_.clear(); selectedFocusClip_ = -1; emit selectionChanged();
}
void TimelineController::selectSegment(int index, bool toggle, bool range) {
    if (index < 0 || index >= int(timeline_.segments().size())) return;
    selectedFocusId_.clear(); selectedFocusClip_ = -1;
    const QString id = timeline_.segments()[index].id;
    if (range && !selectionAnchor_.isEmpty()) {
        int anchor = index;
        for (int i = 0; i < int(timeline_.segments().size()); ++i) if (timeline_.segments()[i].id == selectionAnchor_) anchor = i;
        selectedIds_.clear();
        for (int i = std::min(anchor, index); i <= std::max(anchor, index); ++i) selectedIds_.append(timeline_.segments()[i].id);
    } else if (toggle) {
        if (selectedIds_.contains(id)) selectedIds_.removeAll(id); else selectedIds_.append(id);
        selectionAnchor_ = id;
    } else { selectedIds_ = QStringList{id}; selectionAnchor_ = id; }
    emit selectionChanged();
}

QVariantList TimelineController::visibleTicks(double start, double end, double pixels) const {
    QVariantList result;
    if (!loaded_ || end <= start || pixels <= 0) return result;
    const double step = TimelineGeometry::niceTickStepMs(end - start, pixels, 80);
    if (step <= 0) return result;
    for (double time = std::ceil(start / step) * step; time <= end + 1e-6 && result.size() < 200; time += step)
        result.append(QVariantMap{{"timeMs", time}, {"label", TimelineGeometry::tickLabel(time, step)}});
    return result;
}
QString TimelineController::thumbnailUrl(double sourceMs) const {
    QUrl url(QStringLiteral("image://filmstrip/frame"));
    QUrlQuery query;
    query.addQueryItem(QStringLiteral("file"), sourceVideoPath_);
    query.addQueryItem(QStringLiteral("time"), QString::number(std::max(0.0, std::round(sourceMs / 100) * 100)));
    url.setQuery(query); return url.toString(QUrl::FullyEncoded);
}

void TimelineController::beginSnap(int excludeIndex, bool scrub) {
    std::vector<double> targets{0, outputDurationMs()}, initial;
    for (int i = 0; i < int(timeline_.segments().size()); ++i) {
        const double start = timeline_.outputStartAt(i), end = start + timeline_.segments()[i].outputLengthMs();
        if (i == excludeIndex) { initial = {start, end}; continue; }
        targets.push_back(start); targets.push_back(end);
    }
    for (const auto &v : focusSegments()) {
        const auto f = v.toMap(); targets.push_back(f.value("outputStartMs").toDouble()); targets.push_back(f.value("outputEndMs").toDouble());
    }
    if (!scrub) targets.push_back(playheadMs_);
    magnet_.begin(targets, initial); emit snapChanged();
}
double TimelineController::snapTime(double time, double pixelsPerMs, bool bypass) {
    const double framed = std::isfinite(time) ? TimelineGeometry::snapToFrame(time, frameDurationMs_) : 0;
    const double result = magnet_.resolve(framed, pixelsPerMs, bypass);
    emit snapChanged(); return result;
}
void TimelineController::endSnap() { magnet_.reset(); emit snapChanged(); }

QVariantMap TimelineController::clipSourceBounds(int index) const {
    if (index < 0 || index >= int(timeline_.segments().size())) return {};
    const auto &clip = timeline_.segments()[index];
    double lower = 0, upper = sourceDurationMs();
    for (int i = 0; i < int(timeline_.segments().size()); ++i) if (i != index) {
        const auto &other = timeline_.segments()[i];
        if (other.sourceEndMs <= clip.sourceStartMs + 1e-6) lower = std::max(lower, other.sourceEndMs);
        if (other.sourceStartMs >= clip.sourceEndMs - 1e-6) upper = std::min(upper, other.sourceStartMs);
    }
    return {{"lower", lower}, {"upper", upper}};
}

double TimelineController::outputRatio() const {
    const double source = timeline_.sourceDurationMs();
    return source > 0.0 ? timeline_.outputDurationMs() / source : 1.0;
}

double TimelineController::playheadRatio() const {
    return TimelineGeometry::ratioForTime(playheadMs_, timeline_.outputDurationMs());
}

QString TimelineController::playheadLabel() const {
    return TimelineGeometry::tickLabel(playheadMs_, 10.0);
}

QVariantList TimelineController::rulerTicks() const {
    QVariantList ticks;
    const double duration = timeline_.outputDurationMs();
    if (!loaded_ || duration <= 0.0)
        return ticks;
    // The strip is a fixed-width widget, so a nominal width is used for the spacing
    // rule; the QML side lays the ticks out by ratio, so the exact width only
    // affects how many there are.
    const double step = TimelineGeometry::niceTickStepMs(duration, 900.0, 70.0);
    for (const double time : TimelineGeometry::tickTimes(duration, step)) {
        ticks.append(QVariantMap{
            {QStringLiteral("timeMs"), time},
            {QStringLiteral("ratio"), TimelineGeometry::ratioForTime(time, duration)},
            {QStringLiteral("label"), TimelineGeometry::tickLabel(time, step)}});
    }
    return ticks;
}

void TimelineController::setFrameRate(double fps) {
    const double next = fps > 0.0 ? 1000.0 / fps : 0.0;
    if (std::abs(next - frameDurationMs_) <= 1e-9)
        return;
    frameDurationMs_ = next;
    emit playheadChanged();
}

void TimelineController::setPlayheadMs(double ms) {
    if (!std::isfinite(ms)) return;
    const double clamped = std::clamp(ms, 0.0, std::max(0.0, timeline_.outputDurationMs()));
    if (std::abs(clamped - playheadMs_) <= 1e-9)
        return;
    playheadMs_ = clamped;
    emit playheadChanged();
}

void TimelineController::setPlayheadRatio(double ratio) {
    setPlayheadMs(TimelineGeometry::timeAtRatio(ratio, timeline_.outputDurationMs()));
}

double TimelineController::snappedPlayheadMs() const {
    if (!timeline_.valid())
        return 0.0;
    // Clamped after snapping too: rounding up at the very end would put the
    // playhead one frame past the last frame, where an operation is refused.
    const double snapped = TimelineGeometry::snapToFrame(playheadMs_, frameDurationMs_);
    return std::clamp(snapped, 0.0, timeline_.outputDurationMs());
}

bool TimelineController::splitAtPlayhead() {
    if (!selectedFocusId_.isEmpty()) return splitFocus();
    if (!timeline_.valid())
        return false;
    const double at = snappedPlayheadMs();
    // A split exactly at either end would create an empty segment, which the model
    // refuses; saying so here is friendlier than a generic failure.
    if (at <= 0.0 || at >= timeline_.outputDurationMs()) {
        setError(QStringLiteral("请把播放头移到片段中间再切分"));
        return false;
    }
    return splitAt(at);
}

bool TimelineController::removeAroundPlayhead(double spanMs) {
    if (!timeline_.valid())
        return false;
    if (!(spanMs > 0.0)) {
        setError(QStringLiteral("删除长度必须大于 0"));
        return false;
    }
    const double centre = snappedPlayheadMs();
    const double from = std::max(0.0, centre - spanMs / 2.0);
    const double to = std::min(timeline_.outputDurationMs(), centre + spanMs / 2.0);
    if (to - from <= 1e-6) {
        setError(QStringLiteral("请把播放头移到要删除的位置"));
        return false;
    }
    return removeRange(from, to);
}

bool TimelineController::trimStartTo(double outputMs) {
    if (!timeline_.valid())
        return false;
    const double snapped = TimelineGeometry::snapToFrame(
        std::max(0.0, std::min(outputMs, timeline_.outputDurationMs())), frameDurationMs_);
    if (trimStart(snapped))
        return true;
    // A refused trim is usually the minimum-length rule, which is worth saying
    // plainly: "nothing happened" with no reason reads as a broken handle.
    setError(QStringLiteral("裁剪后至少要保留 %1 毫秒").arg(100));
    return false;
}

bool TimelineController::trimEndTo(double outputMs) {
    if (!timeline_.valid())
        return false;
    const double snapped = TimelineGeometry::snapToFrame(
        std::max(0.0, std::min(outputMs, timeline_.outputDurationMs())), frameDurationMs_);
    if (trimEnd(snapped))
        return true;
    setError(QStringLiteral("裁剪后至少要保留 %1 毫秒").arg(100));
    return false;
}

bool TimelineController::setSpeedAtPlayhead(double rate) {
    if (!timeline_.valid())
        return false;
    if (!(rate > 0.0)) {
        setError(QStringLiteral("播放速度必须大于 0"));
        return false;
    }
    const double at = snappedPlayheadMs();
    const double duration = timeline_.outputDurationMs();
    // The whole segment the playhead is inside, found from the segment list so the
    // range matches exactly what the strip draws. Using a nominal span instead would
    // leave a sliver at real time next to the retimed part.
    double start = 0.0;
    double end = duration;
    for (const QVariant &value : segments()) {
        const QVariantMap segment = value.toMap();
        const double segmentStart = segment.value(QStringLiteral("outputStartMs")).toDouble();
        const double segmentEnd = segment.value(QStringLiteral("outputEndMs")).toDouble();
        // Half-open, with the very end belonging to the last segment: at the end of
        // the timeline the playhead must still retime something.
        if (at >= segmentStart - 1e-6 && (at < segmentEnd - 1e-6 || segmentEnd >= duration - 1e-6)) {
            start = segmentStart;
            end = segmentEnd;
            break;
        }
    }
    if (end - start <= 1e-6) {
        setError(QStringLiteral("播放头所在的片段长度为零，无法变速"));
        return false;
    }
    return setSpeed(start, end, rate);
}

void TimelineController::clampPlayhead() {
    const double limit = std::max(0.0, timeline_.outputDurationMs());
    const double clamped = std::clamp(playheadMs_, 0.0, limit);
    if (std::abs(clamped - playheadMs_) <= 1e-9)
        return;
    playheadMs_ = clamped;
    emit playheadChanged();
}

void TimelineController::setError(const QString &message) {
    if (error_ == message)
        return;
    error_ = message;
    emit errorChanged();
}

bool TimelineController::load(const QString &projectDirectory) {
    if (projectDirectory.isEmpty()) {
        clear();
        return false;
    }
    if (!QFileInfo::exists(projectDirectory + QStringLiteral("/project.json"))) {
        clear();
        // An empty path is "nothing to edit"; a path that looks like a project but
        // has no manifest is a problem worth reporting.
        setError(QStringLiteral("找不到录制工程清单：") + projectDirectory);
        return false;
    }
    QString loadError;
    const ProjectData project = loadProject(projectDirectory, &loadError);
    if (!project.valid) {
        clear();
        setError(QStringLiteral("无法读取录制工程：") + loadError);
        return false;
    }
    projectDirectory_ = projectDirectory;
    projectCreatedAt_ = project.createdAt;
    sourceVideoPath_ = QDir(projectDirectory).filePath(project.videoFile);
    focus_ = project.zoomRanges;
    recordedEvents_ = project.events;
    appearance_ = project.settings;
    historyKey_.clear();
    clearSelection();
    timeline_ = Project::EditTimeline::whole(project.durationMs);
    undo_.clear();
    redo_.clear();
    loaded_ = timeline_.valid();
    setError(loaded_ ? QString() : timeline_.error());
    playheadMs_ = 0.0;

    // A saved edit is applied on top of the whole-recording timeline. Until this
    // existed, `load()` reset every split, trim and speed change, so closing the app
    // silently threw the edit away — and `EditTimeline::toJson()`/`fromJson()` had no
    // callers at all.
    const Project::EditSidecar sidecar = Project::load(projectDirectory, project.durationMs);
    if (sidecar.valid && sidecar.timeline.valid()) {
        // A sidecar from a different recording that happens to reuse the directory
        // name is refused rather than applied to the wrong film.
        const bool sameProject = sidecar.projectCreatedAt.isEmpty()
            || projectCreatedAt_.isEmpty()
            || sidecar.projectCreatedAt == projectCreatedAt_;
        if (sameProject) {
            timeline_ = sidecar.timeline;
            playheadMs_ = std::clamp(sidecar.playheadMs, 0.0, timeline_.outputDurationMs());
        } else {
            setError(QStringLiteral("编辑记录属于另一个工程，已忽略"));
        }
    } else if (!sidecar.error.isEmpty()) {
        // Reported, not fatal: the recording still opens, with the edit ignored.
        setError(sidecar.error);
    }
    // The baseline is what is on disk now, so a freshly opened project is clean even
    // though its timeline is no longer the identity.
    savedSnapshot_ = snapshot();
    emit changed();
    emit rulerChanged();
    emit playheadChanged();
    emit timelineChanged();
    emit dirtyChanged();
    return loaded_;
}

void TimelineController::clear() {
    timeline_ = Project::EditTimeline();
    focus_.clear(); recordedEvents_.clear(); appearance_.clear(); historyKey_.clear();
    undo_.clear();
    redo_.clear();
    projectDirectory_.clear();
    projectCreatedAt_.clear();
    sourceVideoPath_.clear(); clearSelection();
    savedSnapshot_.clear();
    loaded_ = false;
    playheadMs_ = 0.0;
    setError(QString());
    emit changed();
    emit rulerChanged();
    emit playheadChanged();
    emit timelineChanged();
}

QByteArray TimelineController::snapshot() const {
    if (!timeline_.valid())
        return {};
    // Compact, and only the timeline: the playhead is deliberately excluded. Moving
    // the playhead is not an edit, and folding it in would make every scrub mark the
    // project dirty.
    return QJsonDocument(QJsonObject{{"timeline", timeline_.toJson()}, {"focus", Project::focusTrackJson(focus_)},
        {"appearance", QJsonObject::fromVariantMap(appearance_)}}).toJson(QJsonDocument::Compact);
}

bool TimelineController::dirty() const {
    if (!loaded_)
        return false;
    return snapshot() != savedSnapshot_;
}

bool TimelineController::save() {
    if (!loaded_ || projectDirectory_.isEmpty()) {
        setError(QStringLiteral("没有可保存的工程"));
        return false;
    }
    QString failure;
    if (!Project::save(projectDirectory_, timeline_, playheadMs_, projectCreatedAt_, &failure, &focus_, &appearance_)) {
        setError(failure);
        return false;
    }
    savedSnapshot_ = snapshot();
    setError(QString());
    emit dirtyChanged();
    return true;
}

template <typename Change>
bool TimelineController::apply(const QString &failureMessage, Change &&change) {
    if (!timeline_.valid())
        return false;
    // The edit is applied to a copy first: a rejected edit must leave the timeline
    // exactly as it was, and must not become an undo step.
    Project::EditTimeline next = timeline_;
    if (!change(next) || !next.valid()) {
        setError(failureMessage + (next.error().isEmpty() ? QString() : QStringLiteral("：") + next.error()));
        return false;
    }
    if (QJsonDocument(next.toJson()).toJson(QJsonDocument::Compact) == QJsonDocument(timeline_.toJson()).toJson(QJsonDocument::Compact)) {
        setError({}); return true;
    }
    pushHistory();
    timeline_ = next;
    pruneSelection();
    setError(QString());
    // The output length may have changed, so the playhead can now be past the end
    // and the ruler's ticks are stale.
    clampPlayhead();
    emit changed();
    emit rulerChanged();
    emit timelineChanged();
    emit dirtyChanged();
    return true;
}

bool TimelineController::deleteSelection() {
    if (!selectedFocusId_.isEmpty()) return deleteFocus();
    const auto indices = selectedIndices();
    if (indices.empty()) { setError(QStringLiteral("请先选中要删除的片段")); return false; }
    return apply(QStringLiteral("至少保留一个片段"), [indices](auto &timeline) { return timeline.removeSegments(indices); });
}
bool TimelineController::setSelectedSpeed(double rate) {
    const auto indices = selectedIndices();
    if (indices.empty()) return setSpeedAtPlayhead(rate);
    return apply(QStringLiteral("片段变速失败"), [indices, rate](auto &timeline) {
        for (auto it = indices.rbegin(); it != indices.rend(); ++it) {
            const double start = timeline.outputStartAt(*it);
            const double end = start + timeline.segments()[*it].outputLengthMs();
            if (!timeline.setSpeed(start, end, rate)) return false;
        }
        return true;
    });
}
bool TimelineController::reorderSelection(int insertionIndex) {
    const auto indices = selectedIndices();
    if (indices.empty() || insertionIndex < 0 || insertionIndex > int(timeline_.segments().size())) return false;
    const double source = timeline_.sourceTimeAt(playheadMs_);
    const bool ok = apply(QStringLiteral("移动片段失败"), [indices, insertionIndex](auto &timeline) {
        const QJsonObject original = timeline.toJson();
        QJsonArray kept, moved;
        const QJsonArray items = original.value("segments").toArray();
        int before = 0;
        for (int i = 0; i < items.size(); ++i) {
            if (std::find(indices.begin(), indices.end(), i) != indices.end()) { moved.append(items[i]); if (i < insertionIndex) ++before; }
            else kept.append(items[i]);
        }
        const int position = std::clamp(insertionIndex - before, 0, int(kept.size()));
        QJsonArray ordered;
        for (int i = 0; i <= kept.size(); ++i) {
            if (i == position) for (const auto &value : moved) ordered.append(value);
            if (i < kept.size()) ordered.append(kept[i]);
        }
        QJsonObject next = original; next["segments"] = ordered;
        timeline = Project::EditTimeline::fromJson(next, timeline.sourceDurationMs(), nullptr);
        return timeline.valid();
    });
    if (ok) setPlayheadMs(timeline_.outputTimeAt(source));
    return ok;
}
bool TimelineController::trimClip(int index, double start, double end) {
    if (index < 0 || index >= int(timeline_.segments().size())) return false;
    const auto clip = timeline_.segments()[index];
    const double origin = timeline_.outputStartAt(index);
    const double sourceStart = clip.sourceStartMs + (start - origin) * clip.speed;
    const double sourceEnd = clip.sourceStartMs + (end - origin) * clip.speed;
    return apply(QStringLiteral("片段边界不能越过其他片段，且至少保留 100 毫秒"), [=](auto &timeline) {
        return timeline.trimSegment(index, sourceStart, sourceEnd);
    });
}
bool TimelineController::retimeClip(int index, double duration) {
    if (index < 0 || index >= int(timeline_.segments().size()) || !std::isfinite(duration) || duration < 100) return false;
    const auto &clip = timeline_.segments()[index];
    const double rate = std::clamp(clip.sourceLengthMs() / duration, 0.1, 100.0);
    const double start = timeline_.outputStartAt(index), end = start + clip.outputLengthMs();
    return setSpeed(start, end, rate);
}
bool TimelineController::mergeClip(int index, bool restoreGap) {
    return apply(QStringLiteral("仅能合并同速、源素材连续的相邻片段"), [=](auto &timeline) { return timeline.mergeNext(index, restoreGap); });
}
bool TimelineController::rippleAtPlayhead(bool before) {
    int index = -1;
    const double time = snappedPlayheadMs();
    for (int i = 0; i < int(timeline_.segments().size()); ++i) {
        const double start = timeline_.outputStartAt(i), end = start + timeline_.segments()[i].outputLengthMs();
        if (time >= start && time < end) { index = i; break; }
    }
    if (index < 0) return false;
    const double start = timeline_.outputStartAt(index), end = start + timeline_.segments()[index].outputLengthMs();
    return trimClip(index, before ? time : start, before ? end : time);
}

bool TimelineController::splitAt(double outputMs) {
    return apply(QStringLiteral("切分失败"), [outputMs](Project::EditTimeline &timeline) {
        return timeline.split(outputMs);
    });
}

bool TimelineController::removeRange(double fromMs, double toMs) {
    return apply(QStringLiteral("删除区间失败"), [fromMs, toMs](Project::EditTimeline &timeline) {
        return timeline.remove(fromMs, toMs);
    });
}

bool TimelineController::setSpeed(double fromMs, double toMs, double rate) {
    return apply(QStringLiteral("变速失败"), [fromMs, toMs, rate](Project::EditTimeline &timeline) {
        return timeline.setSpeed(fromMs, toMs, rate);
    });
}

bool TimelineController::trimStart(double outputMs) {
    return apply(QStringLiteral("裁掉开头失败"), [outputMs](Project::EditTimeline &timeline) {
        return timeline.trimStart(outputMs);
    });
}

bool TimelineController::trimEnd(double outputMs) {
    return apply(QStringLiteral("裁掉结尾失败"), [outputMs](Project::EditTimeline &timeline) {
        return timeline.trimEnd(outputMs);
    });
}

void TimelineController::reset() {
    if (!loaded_ || timeline_.isIdentity())
        return;
    // Reset collapses the splits too, which is what "复原" means to a user: back to
    // the recording as it was captured.
    pushHistory();
    timeline_ = Project::EditTimeline::whole(timeline_.sourceDurationMs());
    clearSelection();
    setError(QString());
    clampPlayhead();
    emit dirtyChanged();
    emit changed();
    emit rulerChanged();
    emit timelineChanged();
}

void TimelineController::undo() {
    if (undo_.empty()) return;
    redo_.push_back(state()); const auto previous = undo_.back(); undo_.pop_back();
    restoreState(previous);
}
void TimelineController::redo() {
    if (redo_.empty()) return;
    undo_.push_back(state()); const auto next = redo_.back(); redo_.pop_back();
    restoreState(next);
}
void TimelineController::pushHistory(const QString &key) {
    const qint64 now = QDateTime::currentMSecsSinceEpoch();
    if (key.isEmpty() || key != historyKey_ || now - historyTime_ > 500 || !redo_.empty() || undo_.empty()) {
        undo_.push_back(state());
        if (undo_.size() > kMaxHistory) undo_.erase(undo_.begin());
    }
    historyKey_ = key; historyTime_ = now; redo_.clear();
}
void TimelineController::notifyEdit(bool changedFocus) {
    pruneSelection(); setError({}); clampPlayhead();
    emit changed(); emit rulerChanged(); emit timelineChanged(); emit dirtyChanged();
    if (changedFocus) emit focusChanged();
}
void TimelineController::restoreState(const State &s) {
    const bool changedFocus = Project::focusTrackJson(focus_) != Project::focusTrackJson(s.focus);
    const bool changedAppearance = appearance_ != s.appearance;
    timeline_ = s.timeline; focus_ = s.focus; appearance_ = s.appearance; historyKey_.clear();
    selectedIds_ = s.primarySelection; selectedFocusId_ = s.focusSelection; selectedFocusClip_ = s.focusClip; selectionAnchor_ = s.anchor;
    if (changedAppearance) emit appearanceRestored(appearance_);
    notifyEdit(changedFocus);
}
void TimelineController::initializeAppearance(const QVariantMap &map) {
    appearance_ = map; savedSnapshot_ = snapshot();
}
void TimelineController::recordAppearance(const QVariantMap &map) {
    if (!loaded_ || appearance_ == map) return;
    QStringList changedKeys;
    for (auto i = map.constBegin(); i != map.constEnd(); ++i) if (appearance_.value(i.key()) != i.value()) changedKeys.append(i.key());
    pushHistory("appearance:" + changedKeys.join(',')); appearance_ = map;
    emit changed(); emit selectionChanged(); emit dirtyChanged();
}

} // namespace Render
