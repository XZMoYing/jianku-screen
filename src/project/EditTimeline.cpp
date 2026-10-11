#include "EditTimeline.h"

#include <QJsonArray>
#include <QSet>
#include <QUuid>
#include <algorithm>
#include <cmath>

namespace Project {
namespace {

// Output times that land exactly on a boundary are common (a frame clock and a
// segment edge coincide), and floating point makes "exactly" unreliable. This is
// the tolerance used for every boundary comparison in this file.
constexpr double kEpsilon = 1e-6;

} // namespace

EditTimeline EditTimeline::whole(double durationMs) {
    EditTimeline timeline;
    timeline.sourceDurationMs_ = std::max(0.0, durationMs);
    if (timeline.sourceDurationMs_ > 0.0)
        timeline.segments_.push_back(Segment{0.0, timeline.sourceDurationMs_, 1.0, QStringLiteral("full-recording")});
    timeline.revalidate();
    return timeline;
}

void EditTimeline::revalidate() {
    valid_ = false;
    error_.clear();
    if (segments_.empty()) {
        error_ = QStringLiteral("时间线为空");
        return;
    }
    if (!std::isfinite(sourceDurationMs_) || !(sourceDurationMs_ > 0.0)) {
        error_ = QStringLiteral("录制时长无效");
        return;
    }
    QSet<QString> ids;
    for (const Segment &segment : segments_) {
        if (!std::isfinite(segment.speed) || !(segment.speed > 0.0)) {
            error_ = QStringLiteral("播放速度必须大于 0");
            return;
        }
        if (!std::isfinite(segment.sourceStartMs) || !std::isfinite(segment.sourceEndMs)
            || !(segment.sourceEndMs > segment.sourceStartMs)) {
            error_ = QStringLiteral("片段长度必须大于 0");
            return;
        }
        if (segment.sourceStartMs < -kEpsilon || segment.sourceEndMs > sourceDurationMs_ + kEpsilon) {
            error_ = QStringLiteral("片段超出录制范围");
            return;
        }
        if (segment.id.isEmpty() || ids.contains(segment.id)) {
            error_ = QStringLiteral("片段标识为空或重复");
            return;
        }
        ids.insert(segment.id);
    }
    auto ordered = segments_;
    std::sort(ordered.begin(), ordered.end(), [](const auto &a, const auto &b) { return a.sourceStartMs < b.sourceStartMs; });
    for (size_t i = 1; i < ordered.size(); ++i) {
        if (ordered[i].sourceStartMs < ordered[i - 1].sourceEndMs - kEpsilon) {
            error_ = QStringLiteral("片段不能重复使用同一段源素材");
            return;
        }
    }
    valid_ = true;
}

bool EditTimeline::isIdentity() const {
    return valid_ && segments_.size() == 1
        && std::abs(segments_.front().sourceStartMs) <= kEpsilon
        && std::abs(segments_.front().sourceEndMs - sourceDurationMs_) <= kEpsilon
        && std::abs(segments_.front().speed - 1.0) <= kEpsilon;
}

bool EditTimeline::playsWholeRecording() const {
    if (!valid_)
        return false;
    if (std::abs(segments_.front().sourceStartMs) > kEpsilon)
        return false;
    if (std::abs(segments_.back().sourceEndMs - sourceDurationMs_) > kEpsilon)
        return false;
    double expected = 0.0;
    for (const Segment &segment : segments_) {
        if (std::abs(segment.speed - 1.0) > kEpsilon)
            return false;
        // A gap means material was cut out, which is a change the viewer sees.
        if (std::abs(segment.sourceStartMs - expected) > 1e-3)
            return false;
        expected = segment.sourceEndMs;
    }
    return true;
}

double EditTimeline::outputDurationMs() const {
    double total = 0.0;
    for (const Segment &segment : segments_)
        total += segment.outputLengthMs();
    return total;
}

int EditTimeline::segmentIndexAtOutput(double outputMs) const {
    if (segments_.empty())
        return -1;
    if (outputMs <= 0.0)
        return 0;
    double elapsed = 0.0;
    for (size_t index = 0; index < segments_.size(); ++index) {
        const double length = segments_[index].outputLengthMs();
        if (outputMs < elapsed + length - kEpsilon)
            return static_cast<int>(index);
        // The very end belongs to the last segment, not to "nothing".
        if (index + 1 == segments_.size())
            return static_cast<int>(index);
        elapsed += length;
    }
    return static_cast<int>(segments_.size()) - 1;
}

int EditTimeline::segmentIndexAtSource(double sourceMs) const {
    if (segments_.empty())
        return -1;
    int next = -1;
    double nearestStart = INFINITY;
    for (size_t index = 0; index < segments_.size(); ++index) {
        const Segment &segment = segments_[index];
        if (sourceMs >= segment.sourceStartMs - kEpsilon && sourceMs < segment.sourceEndMs - kEpsilon)
            return static_cast<int>(index);
        if (segment.sourceStartMs >= sourceMs && segment.sourceStartMs < nearestStart) {
            next = int(index); nearestStart = segment.sourceStartMs;
        }
    }
    if (next >= 0) return next;
    return int(std::max_element(segments_.begin(), segments_.end(), [](const auto &a, const auto &b) {
        return a.sourceEndMs < b.sourceEndMs;
    }) - segments_.begin());
}

double EditTimeline::sourceTimeAt(double outputMs) const {
    if (!valid_)
        return 0.0;
    const int index = segmentIndexAtOutput(outputMs);
    if (index < 0)
        return 0.0;
    double elapsed = 0.0;
    for (int i = 0; i < index; ++i)
        elapsed += segments_[i].outputLengthMs();
    const Segment &segment = segments_[index];
    const double into = std::clamp(outputMs - elapsed, 0.0, segment.outputLengthMs());
    return std::clamp(segment.sourceStartMs + into * segment.speed,
        segment.sourceStartMs, segment.sourceEndMs);
}

double EditTimeline::outputTimeAt(double sourceMs) const {
    if (!valid_)
        return 0.0;
    const int index = segmentIndexAtSource(sourceMs);
    if (index < 0)
        return 0.0;
    double elapsed = 0.0;
    for (int i = 0; i < index; ++i)
        elapsed += segments_[i].outputLengthMs();
    const Segment &segment = segments_[index];
    const double source = std::clamp(sourceMs, segment.sourceStartMs, segment.sourceEndMs);
    return elapsed + (source - segment.sourceStartMs) / segment.speed;
}

double EditTimeline::rateAt(double outputMs) const {
    if (!valid_)
        return 1.0;
    const int index = segmentIndexAtOutput(outputMs);
    return index < 0 ? 1.0 : segments_[index].speed;
}

double EditTimeline::rateAtSource(double sourceMs) const {
    if (!valid_)
        return 1.0;
    const int index = segmentIndexAtSource(sourceMs);
    return index < 0 ? 1.0 : segments_[index].speed;
}

bool EditTimeline::splitInternal(double outputMs) {
    const int index = segmentIndexAtOutput(outputMs);
    if (index < 0)
        return false;
    const Segment &segment = segments_[index];
    double elapsed = 0.0;
    for (int i = 0; i < index; ++i)
        elapsed += segments_[i].outputLengthMs();
    const double into = outputMs - elapsed;
    // Nothing to split at either end: the time is already a boundary.
    if (into <= kEpsilon || into >= segment.outputLengthMs() - kEpsilon)
        return false;
    const double sourceSplit = segment.sourceStartMs + into * segment.speed;
    Segment left{segment.sourceStartMs, sourceSplit, segment.speed, segment.id};
    Segment right{sourceSplit, segment.sourceEndMs, segment.speed, QUuid::createUuid().toString(QUuid::WithoutBraces)};
    segments_[index] = left;
    segments_.insert(segments_.begin() + index + 1, right);
    return true;
}

bool EditTimeline::split(double outputMs) {
    if (!valid_)
        return false;
    // A split has to leave a usable piece on both sides; splitting exactly on an
    // existing boundary is a no-op, not an error, so it reports success.
    const int index = segmentIndexAtOutput(outputMs);
    if (index < 0)
        return false;
    splitInternal(outputMs);
    return true;
}

// Drops every segment whose output span lies entirely inside [from, to] and keeps
// the rest. `from` and `to` are expected to be boundaries already (the callers
// split first), so this never has to slice a segment in half.
bool EditTimeline::dropRange(double from, double to) {
    std::vector<Segment> kept;
    double consumed = 0.0;
    for (const Segment &segment : segments_) {
        const double start = consumed;
        const double end = consumed + segment.outputLengthMs();
        consumed = end;
        if (start >= from - kEpsilon && end <= to + kEpsilon)
            continue;
        kept.push_back(segment);
    }
    if (kept.empty())
        return false;
    segments_ = std::move(kept);
    return true;
}

bool EditTimeline::trimStart(double outputMs, double minimumMs) {
    if (!valid_)
        return false;
    const double total = outputDurationMs();
    if (outputMs <= kEpsilon)
        return true;
    // Never leave less than a usable amount of timeline: a zero-length timeline
    // has no meaningful frame count and would divide by zero downstream.
    if (outputMs > total - minimumMs)
        return false;
    splitInternal(outputMs);
    if (!dropRange(0.0, outputMs))
        return false;
    revalidate();
    return valid_;
}

bool EditTimeline::trimEnd(double outputMs, double minimumMs) {
    if (!valid_)
        return false;
    const double total = outputDurationMs();
    if (outputMs >= total - kEpsilon)
        return true;
    if (outputMs < minimumMs)
        return false;
    splitInternal(outputMs);
    if (!dropRange(outputMs, total))
        return false;
    revalidate();
    return valid_;
}

bool EditTimeline::remove(double fromMs, double toMs, double minimumMs) {
    if (!valid_)
        return false;
    const double total = outputDurationMs();
    const double from = std::clamp(std::min(fromMs, toMs), 0.0, total);
    const double to = std::clamp(std::max(fromMs, toMs), 0.0, total);
    if (to - from <= kEpsilon)
        return false;
    if (total - (to - from) < minimumMs)
        return false;
    if (from <= kEpsilon) {
        // Removing from the head is a trim; keeping this in one place avoids two
        // subtly different implementations of the same operation.
        return trimStart(to, minimumMs);
    }
    if (to >= total - kEpsilon)
        return trimEnd(from, minimumMs);
    // Splitting does not move the output clock, so both boundaries can be cut
    // before anything is removed.
    splitInternal(from);
    splitInternal(to);
    if (!dropRange(from, to))
        return false;
    revalidate();
    return valid_;
}

bool EditTimeline::setSpeed(double fromMs, double toMs, double speed) {
    if (!valid_ || !std::isfinite(speed) || !(speed > 0.0))
        return false;
    const double total = outputDurationMs();
    const double from = std::clamp(std::min(fromMs, toMs), 0.0, total);
    const double to = std::clamp(std::max(fromMs, toMs), 0.0, total);
    if (to - from <= kEpsilon)
        return false;
    splitInternal(from);
    splitInternal(to);

    bool changed = false;
    double consumed = 0.0;
    for (Segment &segment : segments_) {
        const double start = consumed;
        const double end = consumed + segment.outputLengthMs();
        consumed = end;
        // Only a segment fully inside the range is retimed: one that merely
        // touches the boundary belongs to the surrounding real-time material.
        if (start >= from - kEpsilon && end <= to + kEpsilon) {
            segment.speed = speed;
            changed = true;
        }
    }
    if (!changed)
        return false;
    revalidate();
    return valid_;
}

double EditTimeline::outputStartAt(int index) const {
    double start = 0;
    for (int i = 0; i < index && i < int(segments_.size()); ++i) start += segments_[i].outputLengthMs();
    return start;
}

bool EditTimeline::isSourceOrdered() const {
    for (size_t i = 1; i < segments_.size(); ++i)
        if (segments_[i].sourceStartMs < segments_[i - 1].sourceEndMs - kEpsilon) return false;
    return true;
}

bool EditTimeline::moveSegment(int fromIndex, int toIndex) {
    if (!valid_ || fromIndex < 0 || toIndex < 0 || fromIndex >= int(segments_.size()) || toIndex >= int(segments_.size())) return false;
    const auto moved = segments_[fromIndex];
    segments_.erase(segments_.begin() + fromIndex);
    segments_.insert(segments_.begin() + toIndex, moved);
    revalidate();
    return valid_;
}

bool EditTimeline::trimSegment(int index, double start, double end, double minimumMs) {
    if (!valid_ || index < 0 || index >= int(segments_.size()) || !std::isfinite(start) || !std::isfinite(end)) return false;
    EditTimeline next = *this;
    auto &segment = next.segments_[index];
    if ((end - start) / segment.speed < minimumMs - kEpsilon) return false;
    segment.sourceStartMs = start; segment.sourceEndMs = end;
    next.revalidate();
    if (!next.valid()) return false;
    *this = next;
    return true;
}

bool EditTimeline::removeSegments(const std::vector<int> &indices, double minimumMs) {
    if (!valid_ || indices.empty()) return false;
    auto next = *this;
    std::vector<Segment> kept;
    for (int i = 0; i < int(segments_.size()); ++i)
        if (std::find(indices.begin(), indices.end(), i) == indices.end()) kept.push_back(segments_[i]);
    next.segments_ = std::move(kept); next.revalidate();
    if (!next.valid() || next.outputDurationMs() < minimumMs) return false;
    *this = next; return true;
}

bool EditTimeline::mergeNext(int index, bool restoreGap) {
    if (!valid_ || index < 0 || index + 1 >= int(segments_.size())) return false;
    const auto &left = segments_[index]; const auto &right = segments_[index + 1];
    if (std::abs(left.speed - right.speed) > kEpsilon || right.sourceStartMs < left.sourceEndMs - kEpsilon
        || (!restoreGap && std::abs(left.sourceEndMs - right.sourceStartMs) > kEpsilon)) return false;
    auto next = *this;
    next.segments_[index].sourceEndMs = right.sourceEndMs;
    next.segments_.erase(next.segments_.begin() + index + 1); next.revalidate();
    if (!next.valid()) return false;
    *this = next; return true;
}

QJsonObject EditTimeline::toJson() const {
    QJsonArray array;
    for (const Segment &segment : segments_) {
        array.append(QJsonObject{{QStringLiteral("sourceStartMs"), segment.sourceStartMs},
            {QStringLiteral("sourceEndMs"), segment.sourceEndMs},
            {QStringLiteral("speed"), segment.speed}, {QStringLiteral("id"), segment.id}});
    }
    return QJsonObject{{QStringLiteral("schemaVersion"), 2},
        {QStringLiteral("sourceDurationMs"), sourceDurationMs_},
        {QStringLiteral("segments"), array}};
}

EditTimeline EditTimeline::fromJson(const QJsonObject &object, double durationMs, QString *error) {
    EditTimeline timeline;
    const int version = object.value(QStringLiteral("schemaVersion")).toInt(1);
    if (version < 1 || version > 2) { if (error) *error = QStringLiteral("时间线版本不支持"); return timeline; }
    timeline.sourceDurationMs_ = durationMs > 0.0
        ? durationMs : object.value(QStringLiteral("sourceDurationMs")).toDouble();
    const QJsonArray array = object.value(QStringLiteral("segments")).toArray();
    for (const QJsonValue &value : array) {
        const QJsonObject entry = value.toObject();
        Segment segment;
        segment.sourceStartMs = entry.value(QStringLiteral("sourceStartMs")).toDouble();
        segment.sourceEndMs = entry.value(QStringLiteral("sourceEndMs")).toDouble();
        segment.speed = entry.value(QStringLiteral("speed")).toDouble(1.0);
        segment.id = entry.value(QStringLiteral("id")).toString();
        if (segment.id.isEmpty()) segment.id = QStringLiteral("legacy-%1").arg(timeline.segments_.size());
        timeline.segments_.push_back(segment);
    }
    timeline.revalidate();
    if (version == 1 && !timeline.isSourceOrdered()) {
        timeline.valid_ = false; timeline.error_ = QStringLiteral("旧版片段顺序与录制顺序不一致");
    }
    if (!timeline.valid_ && error)
        *error = timeline.error_;
    return timeline;
}

} // namespace Project
