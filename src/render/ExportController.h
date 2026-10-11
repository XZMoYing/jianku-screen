#pragma once

#include "ProjectCompositor.h"

#include "../project/EditTimeline.h"

#include <QObject>
#include <QString>
#include <QVariantMap>
#include <atomic>

class QThread;

namespace Render {

// Runs the offline compositor off the GUI thread and reports progress to QML.
//
// composeProject() is synchronous by design (it drives two ffmpeg processes with
// blocking reads), so it runs on a worker thread and every update comes back
// through queued signals. Blocking the GUI thread here would freeze the window
// for the entire export — minutes on a long recording.
class ExportController final : public QObject {
    Q_OBJECT
    Q_PROPERTY(bool busy READ busy NOTIFY busyChanged)
    Q_PROPERTY(double progress READ progress NOTIFY progressChanged)
    Q_PROPERTY(QString status READ status NOTIFY statusChanged)
    Q_PROPERTY(QString outputPath READ outputPath NOTIFY outputPathChanged)
    Q_PROPERTY(QString error READ error NOTIFY errorChanged)
    Q_PROPERTY(QString defaultOutputPath READ defaultOutputPath NOTIFY defaultOutputPathChanged)
    // Output frame rate. The UI reads it so the timeline's playhead snaps to the
    // same frames the export writes; keeping one source avoids the two disagreeing
    // about where a frame boundary is.
    Q_PROPERTY(int frameRate READ frameRate WRITE setFrameRate NOTIFY frameRateChanged)
    // Export height (0 = the recording's own resolution). The width follows the
    // canvas's aspect ratio; the two together are what "export settings" means.
    Q_PROPERTY(int exportHeight READ exportHeight WRITE setExportHeight NOTIFY exportHeightChanged)
    // The output size the settings will produce, for the UI to show before exporting.
    Q_PROPERTY(QString outputSizeLabel READ outputSizeLabel NOTIFY outputSizeLabelChanged)

public:
    void setFocusRanges(const std::vector<Project::FocusClip> &ranges) { focus_ = ranges; }
    void setEditingSettings(const QVariantMap &settings) { editingSettings_ = settings; }
    explicit ExportController(QObject *parent = nullptr);
    ~ExportController() override;

    bool busy() const { return busy_; }
    double progress() const { return progress_; }
    QString status() const { return status_; }
    QString outputPath() const { return outputPath_; }
    QString error() const { return error_; }
    // <project>/composed.mp4 for the most recent recording, so the UI can show
    // where the result will land before the user starts an export.
    QString defaultOutputPath() const { return defaultOutputPath_; }

    int frameRate() const { return frameRate_; }
    void setFrameRate(int fps);

    int exportHeight() const { return exportHeight_; }
    void setExportHeight(int height);
    // "<w> × <h>" for the chosen settings, or empty when there is no project yet.
    QString outputSizeLabel() const;
    void refreshOutputSize() { emit outputSizeLabelChanged(); }

    // Records the project the UI is looking at. Called whenever a recording
    // finishes; an empty path disables exporting.
    Q_INVOKABLE void setProjectDirectory(const QString &directory);

    // The edit timeline to export. The controller copies it at start() time, so an
    // edit made during an export cannot change what is being written.
    void setTimeline(const Project::EditTimeline &timeline) { timeline_ = timeline; }

    // Starts an export. `outputPath` may be empty to use the default.
    // `includeCursor` / `includeAutoZoom` / `includeAudio` map to the CLI flags;
    // `includeMicrophone` mixes in microphone.m4a when the project has one.
    Q_INVOKABLE bool start(const QString &outputPath = {}, bool includeCursor = true,
        bool includeAutoZoom = true, bool includeAudio = true, bool includeMicrophone = true);

    Q_INVOKABLE void cancel();
    Q_INVOKABLE void revealOutput() const;
    Q_INVOKABLE void reset();

signals:
    void busyChanged();
    void progressChanged();
    void statusChanged();
    void outputPathChanged();
    void errorChanged();
    void defaultOutputPathChanged();
    void frameRateChanged();
    void exportHeightChanged();
    void outputSizeLabelChanged();
    // Emitted once per finished export; `ok` mirrors the error being empty.
    void finished(bool ok);

private:
    void applyResult(const ComposeResult &result);

    QString projectDirectory_;
    Project::EditTimeline timeline_;
    std::optional<std::vector<Project::FocusClip>> focus_;
    QVariantMap editingSettings_;
    int frameRate_ = 60;
    int exportHeight_ = 0;
    QString defaultOutputPath_;
    QString outputPath_;
    QString status_;
    QString error_;
    double progress_ = 0.0;
    bool busy_ = false;
    QThread *thread_ = nullptr;
    std::atomic_bool cancelRequested_{false};
};

} // namespace Render
