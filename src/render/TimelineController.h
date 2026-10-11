#pragma once

#include "../project/EditTimeline.h"
#include "../project/FocusTrack.h"
#include "../animation/InputEvent.h"
#include <QSizeF>

#include "TimelineGeometry.h"
#include "TimelineMagnet.h"

#include <QByteArray>
#include <QObject>
#include <QVariantList>
#include <QString>
#include <QStringList>
#include <vector>

namespace Render {

// The edit timeline as the UI sees it: a list of segments, the operations that
// change them, and undo/redo.
//
// All the arithmetic lives in Project::EditTimeline, which is a pure model with its
// own tests. This class only adds what a UI needs — a list QML can render, error
// reporting, and a history — so there is still exactly one implementation of what a
// cut means. The distinction matters: if the UI did its own time arithmetic, the
// preview and the export would eventually disagree about where a cut is.
//
// Times are in *output* milliseconds, i.e. the clock of the finished film. After a
// cut, everything after it shifts earlier, which is what a timeline strip shows.
class TimelineController final : public QObject {
    Q_OBJECT
    Q_PROPERTY(bool loaded READ loaded NOTIFY changed)
    Q_PROPERTY(bool edited READ edited NOTIFY changed)
    Q_PROPERTY(bool canUndo READ canUndo NOTIFY changed)
    Q_PROPERTY(bool canRedo READ canRedo NOTIFY changed)
    // Whether the timeline differs from what is stored on disk. Separate from
    // `edited`, which means "the export would differ from the recording": a split
    // changes nothing about the film but is still an edit that should be saved, and
    // undoing back to the saved state has to read as clean again.
    Q_PROPERTY(bool dirty READ dirty NOTIFY dirtyChanged)
    Q_PROPERTY(QString projectDirectory READ projectDirectory NOTIFY changed)
    Q_PROPERTY(double sourceDurationMs READ sourceDurationMs NOTIFY changed)
    Q_PROPERTY(double outputDurationMs READ outputDurationMs NOTIFY changed)
    Q_PROPERTY(QVariantList segments READ segments NOTIFY changed)
    Q_PROPERTY(QString error READ error NOTIFY errorChanged)
    // The exported length as a proportion of the recording, for a one-glance label.
    Q_PROPERTY(double outputRatio READ outputRatio NOTIFY changed)
    // Output time the playhead sits at. Clamped to the timeline, and moved by the
    // operations so a cut does not leave the playhead past the end.
    Q_PROPERTY(double playheadMs READ playheadMs NOTIFY playheadChanged)
    Q_PROPERTY(double playheadRatio READ playheadRatio NOTIFY playheadChanged)
    // Tick times and their labels for the strip's ruler, recomputed when the output
    // length changes. Done here rather than in QML so the same arithmetic is tested.
    Q_PROPERTY(QVariantList rulerTicks READ rulerTicks NOTIFY rulerChanged)
    Q_PROPERTY(QString playheadLabel READ playheadLabel NOTIFY playheadChanged)
    Q_PROPERTY(QStringList selectedIds READ selectedIds NOTIFY selectionChanged)
    Q_PROPERTY(int selectedCount READ selectedCount NOTIFY selectionChanged)
    Q_PROPERTY(QString sourceVideoPath READ sourceVideoPath NOTIFY changed)
    Q_PROPERTY(QVariantList focusSegments READ focusSegments NOTIFY changed)
    Q_PROPERTY(QString selectedFocusId READ selectedFocusId NOTIFY selectionChanged)
    Q_PROPERTY(QVariantMap selectedFocus READ selectedFocus NOTIFY selectionChanged)
    Q_PROPERTY(double snapTargetMs READ snapTargetMs NOTIFY snapChanged)

public:
    void historyBoundary() { historyKey_.clear(); }
    explicit TimelineController(QObject *parent = nullptr);

    bool loaded() const { return loaded_; }
    // Whether the export would differ from the recording. A split alone does not
    // qualify: it is an undoable step, not a change to the film.
    bool edited() const { return !timeline_.playsWholeRecording(); }
    bool canUndo() const { return !undo_.empty(); }
    bool canRedo() const { return !redo_.empty(); }
    bool dirty() const;
    QString projectDirectory() const { return projectDirectory_; }
    QString projectCreatedAt() const { return projectCreatedAt_; }
    double sourceDurationMs() const { return timeline_.sourceDurationMs(); }
    double outputDurationMs() const { return timeline_.outputDurationMs(); }
    QVariantList segments() const;
    QString error() const { return error_; }
    double outputRatio() const;
    double playheadMs() const { return playheadMs_; }
    double playheadRatio() const;
    QString playheadLabel() const;
    QVariantList rulerTicks() const;
    QStringList selectedIds() const { return selectedIds_; }
    int selectedCount() const { return selectedIds_.size(); }
    QString sourceVideoPath() const { return sourceVideoPath_; }
    QVariantList focusSegments() const;
    QVariantMap selectedFocus() const;
    QString selectedFocusId() const { return selectedFocusId_; }
    const std::vector<Project::FocusClip> &focusRanges() const { return focus_; }
    const QVariantMap &appearance() const { return appearance_; }
    Q_INVOKABLE void selectFocus(const QString &id, int clipIndex = -1);
    Q_INVOKABLE bool createFocus(double startMs, double endMs);
    Q_INVOKABLE bool addFocusAtPlayhead();
    Q_INVOKABLE bool updateFocus(const QString &id, const QVariantMap &properties);
    Q_INVOKABLE bool setFocusTiming(const QString &id, int clipIndex, double startMs, double endMs);
    Q_INVOKABLE QVariantMap focusBounds(const QString &id, int clipIndex) const;
    Q_INVOKABLE bool deleteFocus();
    Q_INVOKABLE bool splitFocus();
    Q_INVOKABLE bool regenerateFocus();
    Q_INVOKABLE bool copyFocus();
    Q_INVOKABLE bool pasteFocus(double outputMs = -1, bool attributesOnly = false);
    Q_INVOKABLE void beginFocusSnap(const QString &id = {}, int clipIndex = -1);
    Q_INVOKABLE double snapFocusTime(double startMs, double pixelsPerMs, double durationMs, bool bypass = false);
    void initializeAppearance(const QVariantMap &map);
    void recordAppearance(const QVariantMap &map);
    Q_INVOKABLE void selectSegment(int index, bool toggle = false, bool range = false);
    Q_INVOKABLE void clearSelection();
    Q_INVOKABLE bool deleteSelection();
    Q_INVOKABLE bool setSelectedSpeed(double rate);
    Q_INVOKABLE bool reorderSelection(int insertionIndex);
    Q_INVOKABLE bool trimClip(int index, double outputStartMs, double outputEndMs);
    Q_INVOKABLE bool retimeClip(int index, double outputDurationMs);
    Q_INVOKABLE bool mergeClip(int index, bool restoreGap = false);
    Q_INVOKABLE bool rippleAtPlayhead(bool before);
    Q_INVOKABLE QVariantMap clipSourceBounds(int index) const;
    Q_INVOKABLE QVariantList visibleTicks(double startMs, double endMs, double widthPixels) const;
    Q_INVOKABLE QString thumbnailUrl(double sourceMs) const;
    double snapTargetMs() const { return magnet_.target(); }
    Q_INVOKABLE void beginSnap(int excludeIndex = -1, bool scrub = false);
    Q_INVOKABLE double snapTime(double timeMs, double pixelsPerMs, bool bypass = false);
    Q_INVOKABLE void endSnap();

    // Frame duration used for snapping, from the export frame rate. 0 disables
    // snapping, which is what an unknown rate should do.
    Q_INVOKABLE void setFrameRate(double fps);
    Q_INVOKABLE void setPlayheadRatio(double ratio);
    Q_INVOKABLE void setPlayheadMs(double ms);
    // Where the next operation will apply, snapped to a frame. Exposed so the UI
    // and a test agree on what "here" means.
    Q_INVOKABLE double snappedPlayheadMs() const;
    // Splits / cuts at the playhead. Thin wrappers so the UI cannot apply a
    // different time than the one it is showing.
    Q_INVOKABLE bool splitAtPlayhead();
    Q_INVOKABLE bool removeAroundPlayhead(double spanMs);
    // Trims the head/tail to the given output time, snapping to a frame first so a
    // dragged handle lands on a frame boundary rather than between two.
    Q_INVOKABLE bool trimStartTo(double outputMs);
    Q_INVOKABLE bool trimEndTo(double outputMs);
    // Retimes the segment under the playhead. A whole-timeline speed change is the
    // common case, so an unset range means "the segment at the playhead".
    Q_INVOKABLE bool setSpeedAtPlayhead(double rate);

    const Project::EditTimeline &timeline() const { return timeline_; }

    // Reads the recording's length from the project, then applies any saved edit
    // (`edit.json`). Called when a recording finishes; an empty or unreadable
    // directory clears the timeline.
    Q_INVOKABLE bool load(const QString &projectDirectory);
    Q_INVOKABLE void clear();
    // Writes the edit sidecar. Returns false and reports through `error` on failure.
    Q_INVOKABLE bool save();
    // The recording's `createdAt`, kept so the sidecar can refuse to attach to a
    // different project that happens to share the directory name.
    Q_PROPERTY(QString projectCreatedAt READ projectCreatedAt NOTIFY changed)

    // --- operations, all in output time -----------------------------------
    Q_INVOKABLE bool splitAt(double outputMs);
    Q_INVOKABLE bool removeRange(double fromMs, double toMs);
    Q_INVOKABLE bool setSpeed(double fromMs, double toMs, double rate);
    Q_INVOKABLE bool trimStart(double outputMs);
    Q_INVOKABLE bool trimEnd(double outputMs);
    Q_INVOKABLE void reset();

    Q_INVOKABLE void undo();
    Q_INVOKABLE void redo();

signals:
    void changed();
    void errorChanged();
    void dirtyChanged();
    void playheadChanged();
    void rulerChanged();
    void selectionChanged();
    void snapChanged();
    // Emitted for every successful change, so the exporter can pick the timeline up.
    void timelineChanged();
    void focusChanged();
    void appearanceRestored(const QVariantMap &appearance);

private:
    // Applies `change` and records a history entry only when it succeeds and
    // actually changed something. A failed edit must not push an undo step.
    template <typename Change>
    bool apply(const QString &failureMessage, Change &&change);

    void setError(const QString &message);
    // The timeline serialised for the dirty comparison. Kept in memory so "undo back
    // to the saved state" reads as clean, which a boolean "was saved" cannot express.
    QByteArray snapshot() const;
    // Clamps the playhead to the timeline and announces it only when it moved.
    void clampPlayhead();
    std::vector<int> selectedIndices() const;
    void pruneSelection();

    Project::EditTimeline timeline_;
    struct State { Project::EditTimeline timeline; std::vector<Project::FocusClip> focus; QVariantMap appearance; QStringList primarySelection; QString focusSelection; int focusClip = -1; QString anchor; };
    State state() const { return {timeline_, focus_, appearance_, selectedIds_, selectedFocusId_, selectedFocusClip_, selectionAnchor_}; }
    void restoreState(const State &state);
    void pushHistory(const QString &coalesceKey = {});
    bool applyFocus(std::vector<Project::FocusClip> next, const QString &coalesceKey = {});
    void notifyEdit(bool focusChanged = false);
    std::vector<State> undo_, redo_;
    std::vector<Project::FocusClip> focus_;
    std::vector<Animation::InputEvent> recordedEvents_;
    QVariantMap appearance_;
    QString selectedFocusId_;
    int selectedFocusClip_ = -1;
    QString historyKey_;
    qint64 historyTime_ = 0;
    QString projectDirectory_;
    QString projectCreatedAt_;
    QString sourceVideoPath_;
    QStringList selectedIds_;
    QString selectionAnchor_;
    TimelineMagnet magnet_;
    // The timeline as last loaded or saved, serialised. Comparing against this is what
    // makes "undo back to where I started" clean again, which a boolean flag cannot do.
    QByteArray savedSnapshot_;
    QString error_;
    double playheadMs_ = 0.0;
    double frameDurationMs_ = 0.0;
    bool loaded_ = false;
};

} // namespace Render
