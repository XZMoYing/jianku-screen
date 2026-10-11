#pragma once
#include "EditTimeline.h"
#include <QJsonArray>
#include <QJsonObject>
#include <QSet>
#include <QString>
#include <algorithm>
#include <cmath>
#include <vector>

namespace Project {
// Effect timing is anchored to the original recording. Cuts/rates/order only
// change its presentation, never its association with the recorded operation.
struct FocusClip {
    double startMs = 0;
    double endMs = 0;
    double zoom = 2;
    double snapToEdgesRatio = .25;
    bool system = true;
    QString id;
    bool fixedPosition = false;
    double focusX = .5;
    double focusY = .5;
    bool enabled = true;
    bool customized = false;
};
inline QJsonObject focusJson(const FocusClip &f) {
    return {{"id", f.id}, {"startMs", f.startMs}, {"endMs", f.endMs}, {"zoom", f.zoom},
        {"snapToEdgesRatio", f.snapToEdgesRatio}, {"system", f.system},
        {"fixedPosition", f.fixedPosition}, {"focusX", f.focusX}, {"focusY", f.focusY},
        {"enabled", f.enabled}, {"customized", f.customized}};
}
inline QJsonObject focusTrackJson(const std::vector<FocusClip> &clips) {
    QJsonArray array;
    for (const auto &clip : clips) array.append(focusJson(clip));
    return {{"version", 1}, {"clips", array}};
}
inline bool readFocusTrack(const QJsonObject &json, double duration,
    std::vector<FocusClip> *out, QString *error = nullptr) {
    auto fail = [&] { if (error) *error = QStringLiteral("焦点轨道包含无效的区间或参数"); return false; };
    if (json.value("version").toInt() != 1 || !json.value("clips").isArray()) return fail();
    const auto array = json.value("clips").toArray();
    if (array.size() > 20000) return fail();
    std::vector<FocusClip> clips; QSet<QString> ids;
    for (const auto &value : array) {
        if (!value.isObject()) return fail();
        const auto o = value.toObject(); FocusClip f;
        f.id = o.value("id").toString();
        for (const auto &key : {"startMs", "endMs", "zoom", "snapToEdgesRatio", "focusX", "focusY"})
            if (!o.value(key).isDouble() || !std::isfinite(o.value(key).toDouble())) return fail();
        for (const auto &key : {"system", "fixedPosition", "enabled", "customized"})
            if (!o.value(key).isBool()) return fail();
        f.startMs = o.value("startMs").toDouble(); f.endMs = o.value("endMs").toDouble();
        f.zoom = o.value("zoom").toDouble(); f.snapToEdgesRatio = o.value("snapToEdgesRatio").toDouble();
        f.system = o.value("system").toBool(); f.fixedPosition = o.value("fixedPosition").toBool();
        f.focusX = o.value("focusX").toDouble(); f.focusY = o.value("focusY").toDouble();
        f.enabled = o.value("enabled").toBool(); f.customized = o.value("customized").toBool();
        if (f.id.isEmpty() || ids.contains(f.id) || f.startMs < 0 || f.endMs <= f.startMs
            || f.endMs > duration + 1e-5 || f.zoom < 1 || f.zoom > 6
            || f.snapToEdgesRatio < 0 || f.snapToEdgesRatio > 1 || f.focusX < 0 || f.focusX > 1
            || f.focusY < 0 || f.focusY > 1) return fail();
        ids.insert(f.id); clips.push_back(f);
    }
    *out = std::move(clips); return true;
}
struct FocusFragment {
    QString id;
    int clipIndex = -1;
    double startMs = 0, endMs = 0;
    double sourceStartMs = 0, sourceEndMs = 0;
};
// Source/output interval mapping uses DogSC TimelineMap's segment mapping
// (MIT, original in third_party/dogsc/TimelineMap.swift), with intersections
// retained separately so an effect does not bridge deleted or reordered media.
inline std::vector<FocusFragment> focusFragments(const FocusClip &focus, const EditTimeline &timeline) {
    std::vector<FocusFragment> fragments;
    double output = 0; int index = 0;
    for (const auto &segment : timeline.segments()) {
        const double from = std::max(focus.startMs, segment.sourceStartMs);
        const double to = std::min(focus.endMs, segment.sourceEndMs);
        if (to > from + 1e-6) fragments.push_back({focus.id, index,
            output + (from - segment.sourceStartMs) / segment.speed,
            output + (to - segment.sourceStartMs) / segment.speed, from, to});
        output += segment.outputLengthMs(); ++index;
    }
    return fragments;
}
} // namespace Project
