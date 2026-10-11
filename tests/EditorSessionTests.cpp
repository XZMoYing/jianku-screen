// Two recordings open at once must not share anything.
//
// This is the invariant that forced `EditorSession` into existence. The controllers used
// to be process-wide singletons, so `load()` on one project reset the other's timeline —
// meaning that with a second tab open, merely switching tabs would discard the edit you
// were not looking at. That failure is silent, which is why it is pinned here rather than
// left to the UI to demonstrate.
#include "../src/render/EditorSession.h"
#include "../src/project/EditSidecar.h"

#include <QCoreApplication>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QEventLoop>
#include <QTimer>
#include <QJsonDocument>
#include <QJsonObject>
#include <QTemporaryDir>
#include <cmath>
#include <iostream>
#include <stdexcept>

using namespace Render;

namespace {

void require(bool condition, const char *message) {
    if (!condition)
        throw std::runtime_error(message);
}

bool writeProject(const QString &directory, double durationMs, const QString &createdAt) {
    if (!QDir().mkpath(directory))
        return false;
    // The loader requires the video file and both timelines to exist: an unreadable
    // timeline is treated as a damaged project rather than as "no events", because a
    // lost timeline is how a recording ends up with no pointer at all.
    for (const char *name : {"/raw.mp4", "/pointer-timeline.jsonl", "/cursor-timeline.jsonl",
             "/pointer-events.jsonl", "/cursor-observations.jsonl"}) {
        QFile file(directory + QString::fromLatin1(name));
        if (!file.open(QIODevice::WriteOnly))
            return false;
    }
    QFile frames(directory + "/video-frames.jsonl");
    if (!frames.open(QIODevice::WriteOnly))
        return false;
    for (int i = 0; i < 30; ++i) {
        const QJsonObject frame{{"mediaTimeNs", QString::number(qint64(i) * 33333333)}};
        const QByteArray line = QJsonDocument(frame).toJson(QJsonDocument::Compact) + '\n';
        if (frames.write(line) != line.size())
            return false;
    }
    frames.close();

    QFile manifest(directory + "/project.json");
    if (!manifest.open(QIODevice::WriteOnly))
        return false;
    const QJsonObject root{
        {"schemaVersion", 1},
        {"createdAt", createdAt},
        {"source", QJsonObject{{"type", "display"}, {"widthPx", 1000}, {"heightPx", 500}}},
        {"settings", QJsonObject{{"outputAspectRatio", "auto"}}},
        {"video", QJsonObject{{"file", "raw.mp4"},
            {"durationNs", QString::number(qint64(durationMs * 1e6))},
            {"mediaZeroHostTimeNs", "1000"}, {"frameCount", 30}}}};
    const QByteArray bytes = QJsonDocument(root).toJson();
    return manifest.write(bytes) == bytes.size();
}

} // namespace

int main(int argc, char **argv) {
    QCoreApplication app(argc, argv);
    try {
        QTemporaryDir temp;
        require(temp.isValid(), "temporary directory");
        const QString first = temp.path() + "/first.jianku";
        const QString second = temp.path() + "/second.jianku";
        require(writeProject(first, 10000.0, "2026-10-04T07:00:00.000"), "first fixture");
        require(writeProject(second, 20000.0, "2026-10-04T08:00:00.000"), "second fixture");

        EditorSession a(first);
        EditorSession b(second);
        require(a.open(), "the first session opens");
        require(b.open(), "the second session opens");
        require(std::abs(a.timeline()->sourceDurationMs() - 10000.0) < 0.5,
            "the first session sees its own duration");
        require(std::abs(b.timeline()->sourceDurationMs() - 20000.0) < 0.5,
            "and the second session sees a different one, not the first's");

        // --- the two do not share an exporter target ------------------------------
        // With one process-wide controller, an export started from a tab could write the
        // other tab's project. Each session has to point at its own directory.
        require(a.defaultExportPath().contains(first), "a's export lands in a's project");
        require(b.defaultExportPath().contains(second), "b's export lands in b's project");
        require(a.defaultExportPath() != b.defaultExportPath(),
            "the two sessions do not export to the same file");

        require(a.settingsStore()->setCurrent("outputAspectRatio", "1:1"), "a saves its own appearance");
        require(a.settingsStore()->setCurrent("backgroundPaddingRatio", 15.0), "a changes padding");
        require(b.settingsStore()->current().value("outputAspectRatio") == "auto",
            "a's appearance leaves the other tab unchanged");
        require(loadProject(first).settings.value("outputAspectRatio") == "1:1",
            "the exporter reads the saved per-project appearance");
        require(a.exporter()->outputSizeLabel() == "500 × 500",
            "the output size refresh sees the newly saved settings");
        require(!QFileInfo::exists(second + "/appearance.json"), "opening a tab does not write appearance");

        // --- editing one leaves the other alone -----------------------------------
        require(a.timeline()->splitAt(4000.0), "split in a");
        require(a.timeline()->setSpeed(0.0, 4000.0, 2.0), "speed change in a");
        const double aDuration = a.timeline()->outputDurationMs();
        require(aDuration < 10000.0, "which shortens a's output");
        require(a.timeline()->canUndo(), "and a has an undo step");
        require(!b.timeline()->canUndo(), "while b has none — the undo stacks are separate");
        require(std::abs(b.timeline()->outputDurationMs() - 20000.0) < 0.5,
            "b's timeline is untouched");
        require(b.timeline()->segments().size() == 1, "b still has a single segment");

        // --- reloading one does not disturb the other -----------------------------
        // This is the case that used to lose data: `load()` resets the timeline, and with
        // a shared controller that meant opening b threw away a's edit.
        require(b.open(), "reopen b");
        require(a.timeline()->canUndo(), "a's undo history survives b being opened");
        require(std::abs(a.timeline()->outputDurationMs() - aDuration) < 0.5,
            "and a's edit is still applied");

        // --- each session saves only its own edit ---------------------------------
        require(a.save(), "a saves");
        require(QFileInfo::exists(first + "/edit.json"), "a wrote its sidecar");
        require(!QFileInfo::exists(second + "/edit.json"), "and b's project has none");

        EditorSession reopened(first);
        require(reopened.open(), "reopen a");
        require(reopened.settingsStore()->current().value("backgroundPaddingRatio").toDouble() == 15.0,
            "appearance survives reopening the project");
        require(std::abs(reopened.timeline()->outputDurationMs() - aDuration) < 0.5,
            "a's saved edit comes back");
        require(!reopened.dirty(), "and a freshly opened session is clean");
        require(reopened.title().contains(QStringLiteral(":")),
            "the tab title carries the recording's time and length");

        // One history orders appearance, effect edits, and primary cuts.
        {
            EditorSession history(second); require(history.open(), "history session");
            const auto original = history.settingsStore()->current();
            require(history.settingsStore()->setCurrent("backgroundPaddingRatio", 18.0), "appearance history first");
            require(history.timeline()->createFocus(1000, 3000), "effect history second");
            require(history.timeline()->splitAt(4000), "primary history third");
            history.timeline()->undo(); require(history.timeline()->segments().size() == 1, "undo primary edit first");
            history.timeline()->undo(); require(history.timeline()->focusRanges().empty(), "then undo effect");
            history.timeline()->undo(); require(history.settingsStore()->current() == original, "then restore appearance and disk settings");
            history.timeline()->redo(); history.timeline()->redo();
            require(history.timeline()->focusRanges().size() == 1, "redo crosses edit types");
            require(history.save(), "save unified edits");
            EditorSession copy(second); require(copy.open(), "unified edit reopen");
            require(copy.timeline()->focusRanges().size() == 1 && copy.settingsStore()->current()["backgroundPaddingRatio"].toDouble() == 18, "effects and appearance reopen together");
        }

        // A continuous drag updates the session before any file write, and an
        // immediate save/close must still retain its final value and undo step.
        {
            const QString interactive = temp.path() + "/interactive.jianku";
            require(writeProject(interactive, 10000, "2026-10-11T14:00:00"), "interactive fixture");
            {
                EditorSession session(interactive); require(session.open(), "interactive session");
                for (int i = 0; i < 60; ++i)
                    require(session.settingsStore()->setInteractiveCurrent("backgroundPaddingRatio", 12.0 + i * .1), "interactive change");
                require(!QFileInfo::exists(interactive + "/appearance.json"), "drag does not synchronously write each move");
                require(session.settingsStore()->current()["backgroundPaddingRatio"].toDouble() == 17.9 && session.dirty(), "drag updates live state and history immediately");
                require(session.save() && QFileInfo::exists(interactive + "/appearance.json"), "explicit save flushes pending appearance");
                session.timeline()->undo();
                require(session.settingsStore()->current()["backgroundPaddingRatio"].toDouble() == 10, "continuous drag is one undo step");
                session.timeline()->redo();
                session.settingsStore()->setInteractiveCurrent("insetSize", 8.0);
            }
            EditorSession reopened(interactive); require(reopened.open(), "reopen interactive session");
            require(reopened.settingsStore()->current()["backgroundPaddingRatio"].toDouble() == 17.9
                && reopened.settingsStore()->current()["insetSize"].toDouble() == 8, "immediate close flushes final interactive edit");
        }

        // Idle autosave and immediate close must both retain complete effects.
        const QString autosaveProject = temp.path() + "/autosave.jianku";
        require(writeProject(autosaveProject, 10000, "2026-10-11T10:00:00.000"), "autosave fixture");
        {
            EditorSession session(autosaveProject); require(session.open(), "autosave session");
            require(session.timeline()->createFocus(1000, 3000), "dirty effect before idle");
            QEventLoop loop; QTimer::singleShot(1600, &loop, &QEventLoop::quit); loop.exec();
            require(!session.dirty() && loadProject(autosaveProject).zoomRanges.size() == 1, "idle timer saves complete effects and clears dirty state");
            require(session.timeline()->updateFocus(session.timeline()->selectedFocusId(), {{"zoom", 4.0}}), "dirty effect before immediate close");
        }
        const auto closed = loadProject(autosaveProject);
        require(closed.zoomRanges.size() == 1 && closed.zoomRanges[0].zoom == 4, "immediate session destruction flushes pending edit");
        const auto backup = Project::load(autosaveProject, 10000);
        require(backup.valid && QFileInfo::exists(autosaveProject + "/edit.previous.json"), "close retains backup and valid edit schema");

        const QString cropProject = temp.path() + "/crop.jianku";
        require(writeProject(cropProject, 10000, "2026-10-11T11:00:00.000"), "crop fixture");
        {
            EditorSession session(cropProject); require(session.open(), "crop session");
            auto *crop = session.cropController();
            crop->begin(); crop->dragDraft(crop->draft(), 0, .2, .2); crop->cancel();
            require(!session.dirty() && !session.timeline()->canUndo(), "cancelled draft creates no dirty state or history");
            crop->begin(); const auto origin = crop->draft();
            for (int i = 1; i <= 20; ++i) crop->dragDraft(origin, 0, i * .01, i * .01);
            require(crop->apply() && session.dirty(), "first confirmed crop");
            const auto firstCrop = session.settingsStore()->current()["screenCrop"];
            crop->begin(); require(crop->setDraftPixels({{"x", 100}, {"y", 50}, {"width", 500}, {"height", 300}}) && crop->apply(), "second crop confirmed immediately");
            const auto secondCrop = session.settingsStore()->current()["screenCrop"];
            session.timeline()->undo(); require(session.settingsStore()->current()["screenCrop"] == firstCrop, "separate confirmations stay separate undo steps");
            session.timeline()->undo(); require(sourceCropFromSettings(session.settingsStore()->current()).full() && !session.timeline()->canUndo(), "many gesture updates commit one undo entry");
            session.timeline()->redo(); session.timeline()->redo();
            require(session.settingsStore()->current()["screenCrop"] == secondCrop && session.save(), "redo and save crop");
            EditorSession reopened(cropProject); require(reopened.open(), "crop reopens");
            require(reopened.settingsStore()->current()["screenCrop"] == secondCrop && !reopened.dirty(), "saved crop restored in clean session");
            require(sourceCropFromSettings(b.settingsStore()->current()).full(), "other project retains its own crop");
            QFile sidecar(cropProject + "/edit.json"); require(sidecar.open(QIODevice::ReadOnly), "read crop schema");
            require(QJsonDocument::fromJson(sidecar.readAll()).object()["schema"].toString() == "jianku-edit/4", "crop edit uses schema four");
        }
        std::cout << "editor session checks passed\n";
        return 0;
    } catch (const std::exception &error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
