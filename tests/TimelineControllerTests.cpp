// Timeline controller checks.
//
// The controller is the only thing the UI talks to for editing, and it owns two
// behaviours the model does not: an edit that fails must leave the timeline
// untouched, and every successful edit must be undoable. Both are easy to get
// subtly wrong (pushing an undo step for a rejected edit, or reporting success
// while the timeline is unchanged) and neither shows up until a user loses work.
#include "../src/render/TimelineController.h"

#include <QCoreApplication>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QJsonDocument>
#include <QJsonObject>
#include <QTemporaryDir>
#include <cmath>
#include <iostream>
#include <stdexcept>

using namespace Render;

namespace {
void require(bool condition, const char *message) {
    if (!condition) throw std::runtime_error(message);
}
bool close(double a, double b, double epsilon = 1e-6) {
    return std::abs(a - b) <= epsilon;
}

// A minimal project. The controller reads the recording's length through the same
// loader the exporter uses, so the fixture has to satisfy that loader: a manifest
// plus the video it names. The video is a placeholder — the loader checks that the
// file exists, not that it decodes, and nothing here decodes it.
bool writeProject(const QString &directory, double durationMs) {
    if (!QDir().mkpath(directory))
        return false;
    QFile video(directory + "/raw.mp4");
    if (!video.open(QIODevice::WriteOnly))
        return false;
    video.write("placeholder");
    video.close();
    // The frame timeline is what drives the picture, so the loader refuses a
    // project without one. A handful of frames spread over the recording is
    // enough: nothing here renders.
    QFile frames(directory + "/video-frames.jsonl");
    if (!frames.open(QIODevice::WriteOnly))
        return false;
    const int frameCount = 10;
    for (int i = 0; i < frameCount; ++i) {
        const qint64 mediaNs = qint64(durationMs * 1e6) * i / frameCount;
        const QJsonObject row{{"mediaTimeNs", QString::number(mediaNs)},
            {"displayHostTimeNs", QString::number(1000 + mediaNs)},
            {"displayTimeAvailable", true}};
        const QByteArray line = QJsonDocument(row).toJson(QJsonDocument::Compact) + '\n';
        if (frames.write(line) != line.size())
            return false;
    }
    frames.close();
    // The event and cursor timelines must exist even when empty: the loader treats
    // an unreadable file as a damaged project rather than as "no events", because a
    // lost timeline is how a recording ends up with no pointer at all.
    for (const char *name : {"/pointer-timeline.jsonl", "/cursor-timeline.jsonl"}) {
        QFile empty(directory + QString::fromLatin1(name));
        if (!empty.open(QIODevice::WriteOnly))
            return false;
    }
    QFile file(directory + "/project.json");
    if (!file.open(QIODevice::WriteOnly))
        return false;
    const QJsonObject manifest{
        {"schemaVersion", 1},
        {"createdAt", "2026-10-04T07:30:12.345"},
        {"source", QJsonObject{{"type", "display"}, {"widthPx", 1000}, {"heightPx", 500}}},
        {"settings", QJsonObject{{"outputAspectRatio", "auto"}}},
        {"video", QJsonObject{{"file", "raw.mp4"},
            {"durationNs", QString::number(qint64(durationMs * 1e6))},
            {"mediaZeroHostTimeNs", "1000"}, {"frameCount", 10}}}};
    const QByteArray bytes = QJsonDocument(manifest).toJson();
    return file.write(bytes) == bytes.size();
}
} // namespace

int main(int argc, char **argv) {
    QCoreApplication app(argc, argv);
    try {
        QTemporaryDir temp;
        require(temp.isValid(), "temporary directory");
        const QString project = temp.path() + "/test.jianku";
        require(writeProject(project, 10000.0), "fixture project");

        // --- loading ---------------------------------------------------------
        {
            TimelineController controller;
            require(!controller.loaded(), "nothing is loaded at construction");
            require(!controller.load(QString()), "an empty path is refused");
            require(!controller.loaded(), "and leaves nothing loaded");
            require(!controller.load(temp.path() + "/missing.jianku"),
                "a directory without project.json is refused");
            require(!controller.error().isEmpty(), "and says why");

            require(controller.load(project), "a real project loads");
            require(controller.loaded(), "and is marked loaded");
            require(close(controller.sourceDurationMs(), 10000.0), "the source length is read");
            require(close(controller.outputDurationMs(), 10000.0), "output starts as the whole recording");
            require(!controller.edited(), "a fresh load is not edited");
            require(!controller.canUndo() && !controller.canRedo(), "with no history");
            require(close(controller.outputRatio(), 1.0), "and a ratio of 1");
            require(controller.segments().size() == 1, "one segment");
            const QVariantMap segment = controller.segments().front().toMap();
            require(close(segment.value(QStringLiteral("startRatio")).toDouble(), 0.0),
                "the single segment starts at the beginning of the strip");
            require(close(segment.value(QStringLiteral("lengthRatio")).toDouble(), 1.0),
                "and covers the whole strip");
            require(!segment.value(QStringLiteral("retimed")).toBool(), "and is not retimed");
        }

        // --- operations and history ------------------------------------------
        {
            TimelineController controller;
            int changes = 0;
            QObject::connect(&controller, &TimelineController::timelineChanged,
                [&changes] { ++changes; });
            require(controller.load(project), "loaded");

            require(changes == 1, "loading announced the initial timeline");
            require(controller.splitAt(4000.0), "split succeeds");
            require(controller.segments().size() == 2, "into two segments");
            require(controller.canUndo(), "a successful edit is undoable");
            require(!controller.edited(), "but splitting alone does not change the output");
            require(changes == 2, "and the split announced the new timeline");

            require(controller.removeRange(1000.0, 3000.0), "a range can be removed");
            require(close(controller.outputDurationMs(), 8000.0), "output shrinks");
            require(controller.edited(), "and the timeline counts as edited");
            require(close(controller.outputRatio(), 0.8), "the ratio reflects it");
            const QVariantList segments = controller.segments();
            require(segments.size() == 3, "three segments after the cut");
            double ratioSum = 0.0;
            for (const QVariant &value : segments)
                ratioSum += value.toMap().value(QStringLiteral("lengthRatio")).toDouble();
            require(close(ratioSum, 1.0, 1e-9), "the strip fractions add up to the whole");

            // --- undo / redo -------------------------------------------------
            controller.undo();
            require(close(controller.outputDurationMs(), 10000.0), "undo restores the length");
            require(controller.canRedo(), "and offers a redo");
            controller.redo();
            require(close(controller.outputDurationMs(), 8000.0), "redo reapplies the cut");
            require(!controller.canRedo(), "after which there is nothing to redo");

            // A new edit after an undo drops the redo branch: the alternative would
            // be a history tree, which is not what an editor's undo means.
            controller.undo();
            require(controller.canRedo(), "undo leaves a redo available");
            require(controller.setSpeed(0.0, 2000.0, 2.0), "a new edit succeeds");
            require(!controller.canRedo(), "and clears the redo branch");
            require(close(controller.outputDurationMs(), 9000.0), "the new edit took effect");

            controller.reset();
            require(controller.edited() == false, "reset returns to the whole recording");
            require(close(controller.outputDurationMs(), 10000.0), "with its full length");
            require(controller.canUndo(), "and is itself undoable");
        }

        // --- a rejected edit changes nothing ---------------------------------
        // This is the property that protects the user's work: a refused operation
        // must not move the timeline and must not become an undo step.
        {
            TimelineController controller;
            require(controller.load(project), "loaded");
            require(controller.removeRange(0.0, 2000.0), "a first edit succeeds");
            const double before = controller.outputDurationMs();
            const int segmentsBefore = controller.segments().size();
            controller.undo();
            controller.redo();
            const bool undoBefore = controller.canUndo();
            require(undoBefore, "history is non-empty before the rejected edit");

            const int changesBefore = 0;
            Q_UNUSED(changesBefore);
            require(!controller.setSpeed(0.0, 1000.0, 0.0), "a zero speed is refused");
            require(!controller.error().isEmpty(), "and reports a reason");
            require(close(controller.outputDurationMs(), before), "the length is unchanged");
            require(controller.segments().size() == segmentsBefore, "the segments are unchanged");
            require(controller.canUndo() == undoBefore, "no undo step was pushed");

            require(!controller.removeRange(500.0, 500.0), "an empty range is refused");
            require(!controller.removeRange(0.0, 100000.0),
                "removing the whole timeline is refused");
            require(!controller.trimEnd(10.0), "a trim leaving under the minimum is refused");
            require(close(controller.outputDurationMs(), before),
                "and none of them moved the timeline");

            // A later valid edit still reports the error state clearly.
            require(controller.setSpeed(0.0, 1000.0, 1.5), "a valid edit is accepted");
            require(controller.error().isEmpty(), "and clears the error");
        }

        // --- edits are expressed in output time ------------------------------
        // After a cut everything downstream shifts earlier, which is what a timeline
        // strip shows. A controller that used source time here would cut the wrong
        // part of the recording.
        {
            TimelineController controller;
            require(controller.load(project), "loaded");
            require(controller.removeRange(1000.0, 6000.0), "cut out the middle");
            require(close(controller.outputDurationMs(), 5000.0), "leaving five seconds");
            // A cut leaves two segments (0..1000 and 6000..10000 of media). Splitting
            // at output 1 s lands exactly on that boundary, so no third segment is
            // created — and, crucially, the boundary is at media 6000, not media
            // 1000: the controller works in output time.
            require(controller.splitAt(1000.0), "split at the cut point");
            const QVariantList segments = controller.segments();
            require(segments.size() == 2, "splitting on an existing boundary adds nothing");
            require(close(segments[1].toMap().value(QStringLiteral("sourceStartMs")).toDouble(), 6000.0),
                "output 1 s is where media 6 s now lives");

            // Splitting inside a segment does create a boundary, and the boundary is
            // in media time: output 500 ms is media 500 ms.
            require(controller.splitAt(500.0), "split inside the first segment");
            const QVariantList split = controller.segments();
            require(split.size() == 3, "three segments now");
            require(close(split[1].toMap().value(QStringLiteral("sourceStartMs")).toDouble(), 500.0),
                "the new boundary is at media 500 ms");
            require(close(split[1].toMap().value(QStringLiteral("sourceEndMs")).toDouble(), 1000.0),
                "and the first segment still ends where the cut begins");
        }

        // --- playhead and ruler ----------------------------------------------
        {
            TimelineController controller;
            require(controller.load(project), "loaded");
            require(close(controller.playheadMs(), 0.0), "the playhead starts at the beginning");
            require(close(controller.playheadRatio(), 0.0), "at ratio 0");

            require(controller.rulerTicks().size() >= 2, "the ruler has ticks");
            const QVariantMap first = controller.rulerTicks().front().toMap();
            const QVariantMap last = controller.rulerTicks().back().toMap();
            require(close(first.value(QStringLiteral("ratio")).toDouble(), 0.0),
                "the first tick is at the start");
            require(close(last.value(QStringLiteral("ratio")).toDouble(), 1.0),
                "the last tick is at the end");
            require(!first.value(QStringLiteral("label")).toString().isEmpty(),
                "ticks carry labels");

            // --- moving the playhead -----------------------------------------
            controller.setPlayheadRatio(0.25);
            require(close(controller.playheadMs(), 2500.0), "a quarter of ten seconds");
            controller.setPlayheadMs(999999.0);
            require(close(controller.playheadMs(), 10000.0),
                "a time past the end clamps to the end");
            controller.setPlayheadMs(-500.0);
            require(close(controller.playheadMs(), 0.0), "and one before the start clamps to 0");
            controller.setPlayheadRatio(2.0);
            require(close(controller.playheadMs(), 10000.0), "a ratio above 1 clamps too");

            // --- frame snapping ----------------------------------------------
            // Without a frame rate there is nothing to snap to, and guessing one
            // would silently move the user's playhead.
            controller.setPlayheadMs(1234.0);
            require(close(controller.snappedPlayheadMs(), 1234.0),
                "with no frame rate the playhead is used as it stands");
            controller.setFrameRate(60.0);
            require(close(controller.snappedPlayheadMs(), 1233.3333333333, 1e-6),
                "at 60 fps it snaps to the nearest frame");
            // Snapping at the very end must not push past the last frame, where a
            // split would be refused for no visible reason.
            controller.setPlayheadMs(10000.0);
            require(controller.snappedPlayheadMs() <= 10000.0 + 1e-9,
                "snapping at the end stays inside the timeline");
            controller.setFrameRate(0.0);
            require(close(controller.snappedPlayheadMs(), 10000.0), "an unknown rate disables snapping");

            // --- the playhead survives an edit --------------------------------
            controller.setPlayheadMs(8000.0);
            require(controller.removeRange(1000.0, 4000.0), "cut three seconds out");
            require(close(controller.outputDurationMs(), 7000.0), "leaving seven seconds");
            require(controller.playheadMs() <= 7000.0 + 1e-9,
                "the playhead is pulled back inside the shorter timeline");
            require(controller.rulerTicks().size() >= 2, "the ruler still has ticks");
            require(close(controller.rulerTicks().back().toMap()
                    .value(QStringLiteral("ratio")).toDouble(), 1.0),
                "and still ends at the end");

            // Undo restores the length; the playhead stays where it was clamped,
            // which is the least surprising thing for a single-step undo.
            controller.undo();
            require(close(controller.outputDurationMs(), 10000.0), "undo restores the length");
            require(controller.playheadMs() <= 10000.0 + 1e-9, "and the playhead is still valid");
        }

        // --- operations at the playhead ---------------------------------------
        {
            TimelineController controller;
            require(controller.load(project), "loaded");
            // Splitting exactly at the start would make an empty segment, so it is
            // refused with a message that says what to do instead.
            require(!controller.splitAtPlayhead(), "splitting at the very start is refused");
            require(!controller.error().isEmpty(), "and says why");
            require(!controller.canUndo(), "without recording a history step");

            controller.setPlayheadRatio(0.5);
            require(controller.splitAtPlayhead(), "splitting in the middle works");
            require(controller.segments().size() == 2, "into two segments");

            // A join of the two operations a UI actually offers: put the playhead
            // somewhere, cut a span around it. The span is centred on the playhead.
            TimelineController second;
            require(second.load(project), "loaded");
            second.setPlayheadRatio(0.5);
            require(second.removeAroundPlayhead(2000.0), "removing a span around the playhead");
            require(close(second.outputDurationMs(), 8000.0), "removed exactly the span");
            // The two segments meet at output 4 s, and there the media jumps from
            // 4 s to 6 s — the cut is centred on the playhead, so it removed one
            // second before it and one after.
            const QVariantList segments = second.segments();
            require(segments.size() == 2, "two segments after one cut");
            require(close(segments[0].toMap().value(QStringLiteral("sourceEndMs")).toDouble(), 4000.0),
                "the first segment ends where the cut begins");
            require(close(segments[1].toMap().value(QStringLiteral("sourceStartMs")).toDouble(), 6000.0),
                "and the second resumes two seconds later");

            require(!second.removeAroundPlayhead(0.0), "a zero-length removal is refused");
            require(!second.removeAroundPlayhead(-500.0), "and so is a negative one");
            require(!second.error().isEmpty(), "both report a reason");
        }

        // --- trimming by dragging a handle ------------------------------------
        {
            TimelineController controller;
            require(controller.load(project), "loaded");
            controller.setFrameRate(60.0);

            require(controller.trimStartTo(2000.0), "the head can be trimmed to a time");
            require(close(controller.outputDurationMs(), 8000.0), "leaving eight seconds");
            // Output 0 now shows media 2 s: the trimmed material is skipped, not
            // rescaled. Compared with a tolerance because the requested time was
            // snapped to a 60 fps frame first, and 120 frames is 2000.0000000000002 ms
            // in binary floating point.
            require(close(controller.segments().front().toMap()
                    .value(QStringLiteral("sourceStartMs")).toDouble(), 2000.0, 1e-6),
                "output zero points at the new media start");

            // After the head trim the output is 8 s long, so trimming "to 7 s" means
            // 7 s of *output* time, i.e. media 9 s — the two clocks are different and
            // every operation here is expressed in output time.
            require(controller.trimEndTo(7000.0), "the tail can be trimmed too");
            require(close(controller.outputDurationMs(), 7000.0), "leaving seven seconds");
            require(close(controller.segments().back().toMap()
                    .value(QStringLiteral("sourceEndMs")).toDouble(), 9000.0, 1e-6),
                "which is media 9 s, because the first two seconds were already cut");

            // A dragged handle lands on a frame, so a trim requested mid-frame is
            // snapped rather than producing a cut no frame corresponds to.
            TimelineController snapped;
            require(snapped.load(project), "loaded");
            snapped.setFrameRate(60.0);
            require(snapped.trimStartTo(1005.0), "a mid-frame trim is accepted");
            const double start = snapped.segments().front().toMap()
                .value(QStringLiteral("sourceStartMs")).toDouble();
            require(std::abs(start - 1000.0) < 1e-6 || std::abs(start - 1016.6666667) < 1e-3,
                "and lands on a frame boundary");

            // Refused trims must say why: a handle that silently does nothing reads
            // as broken.
            TimelineController guard;
            require(guard.load(project), "loaded");
            require(!guard.trimEndTo(50.0), "a trim that would leave under the minimum is refused");
            require(!guard.error().isEmpty(), "with a reason");
            require(close(guard.outputDurationMs(), 10000.0), "and the timeline is untouched");
            // Trimming to where it already is succeeds and changes nothing.
            require(guard.trimStartTo(0.0), "trimming to the start is a no-op that succeeds");
            require(close(guard.outputDurationMs(), 10000.0), "with the length intact");
        }

        // --- retiming the segment under the playhead --------------------------
        {
            TimelineController controller;
            require(controller.load(project), "loaded");
            controller.setFrameRate(60.0);
            controller.setPlayheadRatio(0.5);
            require(controller.setSpeedAtPlayhead(2.0), "the segment at the playhead can be sped up");
            // The whole ten seconds was one segment, so all of it is retimed and the
            // output is halved.
            require(close(controller.outputDurationMs(), 5000.0), "the output halves");
            require(close(controller.outputRatio(), 0.5), "and the ratio reflects it");
            require(controller.segments().front().toMap()
                    .value(QStringLiteral("retimed")).toBool(), "the segment is marked as retimed");

            // After a cut there are two segments, and only the one the playhead is
            // inside is retimed — the other must stay at real time, or a speed change
            // would silently affect material the user did not point at.
            TimelineController partial;
            require(partial.load(project), "loaded");
            require(partial.removeRange(5000.0, 6000.0), "cut out a second");
            partial.setPlayheadRatio(0.1);
            require(partial.setSpeedAtPlayhead(2.0), "retime the first segment");
            const QVariantList after = partial.segments();
            require(after.size() == 2, "still two segments");
            require(close(after[0].toMap().value(QStringLiteral("speed")).toDouble(), 2.0),
                "the segment under the playhead is retimed");
            require(close(after[1].toMap().value(QStringLiteral("speed")).toDouble(), 1.0),
                "and the other one is left at real time");

            // At the very end the playhead still retimes the last segment.
            TimelineController tail;
            require(tail.load(project), "loaded");
            require(tail.removeRange(0.0, 5000.0), "trim the head so there are two segments");
            tail.setPlayheadMs(tail.outputDurationMs());
            require(tail.setSpeedAtPlayhead(1.5), "the last segment can be retimed from the end");

            require(!controller.setSpeedAtPlayhead(0.0), "a zero rate is refused");
            require(!controller.setSpeedAtPlayhead(-1.0), "and a negative one");
            require(!controller.error().isEmpty(), "both report a reason");
        }

        // --- no project -------------------------------------------------------
        {
            TimelineController controller;
            controller.clear();
            require(!controller.loaded(), "cleared");
            require(!controller.splitAt(1000.0), "operations on an empty controller fail");
            require(!controller.canUndo(), "and do not create history");
            controller.undo();
            controller.redo();
            require(!controller.loaded(), "undo/redo on an empty history is harmless");
        }

        // --- the edit survives a reload --------------------------------------
        // Until the sidecar existed, `load()` reset the timeline to the whole
        // recording every time, so every split and speed change was thrown away when
        // the app closed — and `EditTimeline::toJson()`/`fromJson()` had no callers.
        {
            TimelineController controller;
            require(controller.load(project), "first load");
            require(!controller.dirty(), "a freshly opened project is clean");
            require(controller.splitAt(4000.0), "split");
            require(controller.setSpeed(0.0, 4000.0, 2.0), "speed up the first half");
            const double outputDuration = controller.outputDurationMs();
            require(controller.dirty(), "an edit marks the project dirty");
            require(controller.save(), "save writes the sidecar");
            require(!controller.dirty(), "and saving clears the dirty flag");
            require(QFileInfo::exists(project + "/edit.json"), "the sidecar is in the project");

            // A second controller reading the same directory — i.e. the app restarted.
            TimelineController reopened;
            require(reopened.load(project), "reload");
            require(reopened.segments().size() == controller.segments().size(),
                "the segment count survives a reload");
            require(std::abs(reopened.outputDurationMs() - outputDuration) < 0.5,
                "and so does the edited duration");
            require(!reopened.dirty(), "a reloaded project is clean, not dirty on open");

            // Undoing back to the saved state has to read as clean again. This is why
            // the flag is a comparison against a snapshot rather than a boolean.
            require(reopened.setSpeed(0.0, 2000.0, 0.5), "another edit");
            require(reopened.dirty(), "which is dirty");
            reopened.undo();
            require(!reopened.dirty(), "undo back to the saved snapshot is clean again");
        }

        // A sidecar that cannot be parsed must not make the recording unopenable: the
        // project opens with the edit ignored and the reason reported.
        {
            QFile broken(project + "/edit.json");
            require(broken.open(QIODevice::WriteOnly), "write a broken sidecar");
            broken.write("{ this is not json");
            broken.close();

            TimelineController controller;
            require(controller.load(project), "a broken sidecar still opens the project");
            require(controller.segments().size() == 1, "with the whole recording as the timeline");
            require(!controller.error().isEmpty(), "and the reason is reported");
            require(!controller.dirty(), "a project that failed to load an edit is not dirty");
        }

        // A sidecar whose schema is from the future is refused rather than guessed at.
        {
            QFile sidecar(project + "/edit.json");
            require(sidecar.open(QIODevice::WriteOnly), "write a future schema");
            sidecar.write(R"({"schema":"jianku-edit/99","playheadMs":1000})");
            sidecar.close();

            TimelineController controller;
            require(controller.load(project), "a future schema still opens the project");
            require(controller.segments().size() == 1, "and is ignored");
            require(controller.error().contains(QStringLiteral("版本")), "the reason names the schema");
        }

        {
            QFile::remove(project + "/edit.json");
            TimelineController controller;
            require(controller.load(project), "load fresh selection fixture");
            require(controller.splitAt(3000) && controller.splitAt(7000), "three selectable clips");
            controller.selectSegment(0); controller.selectSegment(2, true);
            require(controller.selectedCount() == 2, "command selection toggles distinct clips");
            const auto selectedIds = controller.selectedIds();
            require(controller.setSelectedSpeed(2), "retime both selected clips together");
            require(close(controller.outputDurationMs(), 7000), "unselected middle clip keeps speed");
            require(controller.selectedIds() == selectedIds, "selection survives retime");
            require(controller.reorderSelection(3), "move selected block to timeline tail");
            require(close(controller.timeline().sourceTimeAt(0), 3000), "reorder changes output source mapping");
            require(close(controller.timeline().sourceTimeAt(4500), 1000), "reorder supports backward source jump");
            require(controller.save(), "save authored clip order");
            TimelineController reopened;
            require(reopened.load(project) && close(reopened.timeline().sourceTimeAt(0), 3000), "sidecar reopens reordered timeline");
            require(controller.deleteSelection(), "delete exactly selected clips");
            require(close(controller.outputDurationMs(), 4000), "middle clip remains, not fixed two seconds");
            controller.undo();
            require(controller.segments().size() == 3, "one undo restores multi-delete");
            require(controller.trimClip(0, 500, 3500), "trim one clip in output clock");
            require(close(controller.segments()[0].toMap().value("sourceStartMs").toDouble(), 3500), "trim maps to source clock");
            const double duration = controller.outputDurationMs();
            require(!controller.trimClip(0, -2000, 9000), "invalid overlap trim is refused");
            require(close(controller.outputDurationMs(), duration), "rejected gesture leaves committed timeline intact");
            require(controller.visibleTicks(1000, 2000, 800).size() > 1, "zoomed ruler covers visible range");
            controller.clearSelection(); controller.selectSegment(0); controller.selectSegment(2, false, true);
            require(controller.selectedCount() == 3, "Shift selects intervening clips");
            require(!controller.deleteSelection(), "whole timeline deletion is refused");
            controller.reset();
            require(controller.removeRange(3000, 5000) && controller.mergeClip(0, true), "restore retained source gap");
            require(controller.timeline().isIdentity(), "restoring gap returns original recording");
            QFile::remove(project + "/edit.json");
        }

        // Focus effects follow retained source material through cuts, rates and order.
        {
            const QString root = temp.path() + "/focus.jianku";
            require(writeProject(root, 10000), "focus fixture");
            TimelineController c; require(c.load(root), "focus load");
            require(c.createFocus(2000, 8000), "manual range");
            const QString id = c.selectedFocusId();
            require(c.updateFocus(id, {{"zoom", 3.0}, {"focusX", .25}, {"focusY", .7}}), "manual framing");
            require(c.removeRange(4000, 6000), "cut across focus");
            require(c.focusSegments().size() == 2, "effect retains two separate fragments");
            require(c.setSpeed(0, 4000, 2), "retime first retained clip");
            auto ranges = c.focusSegments();
            require(close(ranges[0].toMap()["outputStartMs"].toDouble(), 1000), "first fragment retimed");
            require(close(ranges[1].toMap()["outputStartMs"].toDouble(), 2000), "second fragment ripple maps");
            c.selectSegment(1); require(c.reorderSelection(0), "reorder with focus");
            ranges = c.focusSegments();
            require(close(ranges[0].toMap()["outputStartMs"].toDouble(), 0), "source 6s focus follows first clip");
            require(close(ranges[1].toMap()["outputStartMs"].toDouble(), 5000), "source 2s focus follows later retimed clip");
            c.selectFocus(id, 0);
            require(c.setFocusTiming(id, 0, 0, 1500), "trim displayed fragment");
            require(c.focusRanges().size() == 2, "editing fragment isolates retained sibling");
            require(close(c.focusSegments()[1].toMap()["outputEndMs"].toDouble(), 1500), "edited fragment timing");
            c.undo(); require(c.focusRanges().size() == 1, "undo reconstructs source anchored focus");
            c.redo(); require(c.focusRanges().size() == 2, "redo isolates it again");
            require(!c.setFocusTiming(id, 0, -100, 1500), "cross cut timing is refused");
            require(!c.updateFocus(id, {{"zoom", 99.0}}), "invalid magnification is refused");
            require(c.save(), "save effects"); require(c.save(), "backup save");
            require(QFileInfo::exists(root + "/edit.previous.json"), "previous complete edit retained");
            TimelineController reopened; require(reopened.load(root), "focus reopen");
            require(reopened.focusRanges().size() == 2 && !reopened.dirty(), "focus round trip and clean baseline");
            require(close(reopened.focusRanges()[0].focusX, .25), "manual position persists");
        }
        {
            const QString root = temp.path() + "/clipboard.jianku";
            require(writeProject(root, 10000), "clipboard fixture");
            TimelineController c; require(c.load(root), "clipboard load");
            require(c.createFocus(1000, 3000), "clipboard source range");
            const auto id = c.selectedFocusId();
            require(c.updateFocus(id, {{"zoom", 4.0}, {"focusX", .3}}) && c.copyFocus(), "copy focus properties and length");
            require(c.pasteFocus(5000), "paste into empty source interval");
            require(c.focusRanges().size() == 2 && close(c.selectedFocus()["zoom"].toDouble(), 4), "paste retains framing");
            c.undo(); require(c.focusRanges().size() == 1, "paste is one undo step"); c.redo();
            const auto pastedId = c.selectedFocusId();
            c.selectFocus(pastedId); require(c.updateFocus(pastedId, {{"zoom", 2.0}}), "destination property edit");
            require(c.pasteFocus(-1, true), "paste attributes only");
            require(close(c.selectedFocus()["zoom"].toDouble(), 4) && close(c.selectedFocus()["outputStartMs"].toDouble(), 5000), "attribute paste preserves timing");
            c.setPlayheadMs(6000); require(c.splitFocus(), "split selected focus");
            require(c.focusRanges().size() == 3, "focus split creates new identifier");
            require(c.regenerateFocus(), "regenerate empty click track");
            require(c.focusRanges().size() == 3, "regeneration preserves manual effects");
            c.selectFocus(id); require(c.deleteFocus(), "delete effect"); c.undo();
            require(c.focusRanges().size() == 3, "effect deletion is undoable");
        }

        {
            const QString root = temp.path() + "/automatic-focus.jianku";
            require(writeProject(root, 10000), "automatic focus fixture");
            QFile events(root + "/pointer-timeline.jsonl");
            require(events.open(QIODevice::WriteOnly), "recorded click track");
            for (const auto time : {2000, 4000, 9500}) {
                events.write(QJsonDocument(QJsonObject{{"type", "mouseDown"}, {"withinVideo", true},
                    {"mediaTimeNs", QString::number(qint64(time) * 1000000)}, {"xPx", 400}, {"yPx", 200}}).toJson(QJsonDocument::Compact) + '\n');
            }
            events.close();
            TimelineController c; require(c.load(root), "automatic focus load");
            require(c.createFocus(7500, 8500), "manual effect before regeneration");
            const auto manualId = c.selectedFocusId();
            require(c.regenerateFocus() && c.focusRanges().size() == 2, "nearby recorded clicks merge, final click excluded, manual retained");
            const auto automatic = c.focusRanges().back();
            require(automatic.system && close(automatic.startMs, 1700) && close(automatic.endMs, 6500), "regeneration uses existing verified click windows");
            c.selectFocus(automatic.id, 0);
            require(c.setFocusTiming(automatic.id, 0, 1800, 6000), "automatic lane timing is editable");
            require(c.updateFocus(automatic.id, {{"zoom", 3.0}, {"enabled", false}}), "automatic lane properties are editable");
            require(c.copyFocus() && c.pasteFocus(100), "automatic properties can create manual copy");
            require(!c.selectedFocus()["system"].toBool() && !c.selectedFocus()["enabled"].toBool(), "copy converts lane origin and retains disabled state");
            require(c.regenerateFocus(), "regenerate replaces customized automatic ranges");
            int manualCount = 0, automaticCount = 0;
            for (const auto &f : c.focusRanges()) { if (f.system) { ++automaticCount; require(f.enabled && !f.customized, "automatic defaults restored"); } else ++manualCount; }
            require(manualCount == 2 && automaticCount == 1, "regenerate preserves both manual effects");
            c.selectFocus(manualId); require(!c.createFocus(7600, 8000), "same-lane collision refuses partial creation");
            require(c.focusRanges().size() == 3, "rejected overlapping creation changes nothing");
        }

        {
            const QString root = temp.path() + "/focus-schema.jianku";
            require(writeProject(root, 10000), "schema fixture");
            TimelineController c; require(c.load(root) && c.splitAt(4000) && c.save(), "base edit schema");
            QFile file(root + "/edit.json"); require(file.open(QIODevice::ReadOnly), "read saved schema");
            const auto saved = QJsonDocument::fromJson(file.readAll()).object(); file.close();
            for (const int version : {1, 2, 3}) {
                auto legacy = saved; legacy["schema"] = QString("jianku-edit/%1").arg(version); legacy["schemaVersion"] = version;
                legacy.remove("focusTrack"); legacy.remove("appearance");
                if (version == 1) {
                    auto timeline = legacy["timeline"].toObject(); timeline["schemaVersion"] = 1;
                    auto segments = timeline["segments"].toArray();
                    for (int i = 0; i < segments.size(); ++i) { auto segment = segments[i].toObject(); segment.remove("id"); segments[i] = segment; }
                    timeline["segments"] = segments; legacy["timeline"] = timeline;
                }
                require(file.open(QIODevice::WriteOnly), "write legacy edit"); file.write(QJsonDocument(legacy).toJson()); file.close();
                TimelineController reopened;
                require(reopened.load(root) && reopened.segments().size() == 2 && !reopened.dirty(), "legacy schema retains cuts and clean baseline");
                require(reopened.createFocus(1000, 2000) && reopened.save(), "legacy edit upgrades with manual focus");
            }
            require(file.open(QIODevice::ReadOnly), "read upgraded focus edit");
            auto malformed = QJsonDocument::fromJson(file.readAll()).object(); file.close();
            auto track = malformed["focusTrack"].toObject(); auto clips = track["clips"].toArray();
            auto clip = clips[0].toObject(); clip["zoom"] = 0; clips[0] = clip; track["clips"] = clips; malformed["focusTrack"] = track;
            require(file.open(QIODevice::WriteOnly), "write malformed focus"); file.write(QJsonDocument(malformed).toJson()); file.close();
            TimelineController reopened;
            require(reopened.load(root) && reopened.error().contains(QStringLiteral("焦点")), "damaged focus edit reports error while opening original recording");
            require(!reopened.dirty() && reopened.focusRanges().empty(), "damaged edit is not silently autosaved or rendered");
        }

        std::cout << "timeline controller checks passed\n";
        return 0;
    } catch (const std::exception &error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
