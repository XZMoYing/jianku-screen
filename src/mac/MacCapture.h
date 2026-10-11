#pragma once

#include "../capture/CaptureSource.h"

#include <QObject>
#include <QStringList>
#include <QVariantList>
#include <QVariantMap>
#include <memory>
#include <optional>

class VideoFrameStore;

class MacCapture final : public QObject {
    Q_OBJECT
    Q_PROPERTY(QStringList displayNames READ displayNames NOTIFY displayNamesChanged)
    Q_PROPERTY(QVariantList displayIds READ displayIds NOTIFY displayNamesChanged)
    // Refresh rate of each display, in the same order as displayNames. 0 means the
    // system did not report one. Kept separate from the label because the export
    // settings need the number, not the text.
    Q_PROPERTY(QVariantList displayRefreshRates READ displayRefreshRates NOTIFY displayNamesChanged)
    // Window sources, as a QVariantList of {windowId, title, application, width,
    // height} so QML can offer a picker without knowing about ScreenCaptureKit.
    Q_PROPERTY(QVariantList windowSources READ windowSources NOTIFY windowSourcesChanged)
    Q_PROPERTY(QString status READ status NOTIFY statusChanged)
    Q_PROPERTY(bool running READ running NOTIFY runningChanged)
    Q_PROPERTY(bool busy READ busy NOTIFY busyChanged)
    Q_PROPERTY(bool recording READ recording NOTIFY recordingChanged)
    Q_PROPERTY(bool recordingPaused READ recordingPaused NOTIFY recordingPausedChanged)
    Q_PROPERTY(bool recordingFinalizing READ recordingFinalizing NOTIFY recordingFinalizingChanged)
    Q_PROPERTY(QString recordingProjectPath READ recordingProjectPath NOTIFY recordingStatusChanged)
    Q_PROPERTY(QString recordingStatus READ recordingStatus NOTIFY recordingStatusChanged)
    Q_PROPERTY(QString lastRecordingPath READ lastRecordingPath NOTIFY lastRecordingPathChanged)
    Q_PROPERTY(QString lastProjectPath READ lastProjectPath NOTIFY lastRecordingPathChanged)
    // Recordings found on disk, newest first, as {path, label}. Without this the app
    // only knows about the project it just recorded, so restarting it leaves the
    // export and the edit timeline disabled with no way to reach an older recording.
    Q_PROPERTY(QVariantList recentProjects READ recentProjects NOTIFY recentProjectsChanged)
    Q_PROPERTY(QObject *frameStore READ frameStore CONSTANT)
    // The rect being captured and the frame size it arrives at, once a source is
    // running: {x, y, widthPoints, heightPoints, widthPixels, heightPixels}. The
    // preview needs it to place the smooth pointer inside the frame — mapping the
    // pointer through the primary display instead puts it in the wrong place for a
    // window, a region, or a second screen. Empty until a source starts.
    Q_PROPERTY(QVariantMap sourceGeometry READ sourceGeometry NOTIFY sourceGeometryChanged)
    Q_PROPERTY(bool screenAuthorized READ screenAuthorized NOTIFY screenAuthorizedChanged)
    // The other two permissions, asked for rather than inferred from a failure.
    //
    // The guide used to describe three tabs without knowing which of them was actually
    // missing, so it could only say "if it still does not work, try…". Reading the state
    // up front lets it name the missing one and say what breaks without it.
    Q_PROPERTY(bool inputMonitoringAuthorized READ inputMonitoringAuthorized
        NOTIFY permissionStateChanged)
    Q_PROPERTY(bool microphoneAuthorized READ microphoneAuthorized NOTIFY permissionStateChanged)
    // True when the microphone is needed but not granted. A muted recording is a real
    // choice, so an unauthorised microphone is only a blocker when it would be used.
    Q_PROPERTY(bool microphoneBlocked READ microphoneBlocked NOTIFY permissionStateChanged)
    Q_PROPERTY(QString permissionIssue READ permissionIssue NOTIFY permissionIssueChanged)
    Q_PROPERTY(QString permissionIssueKind READ permissionIssueKind NOTIFY permissionIssueChanged)

public:
    explicit MacCapture(QObject *parent = nullptr);
    ~MacCapture() override;

    QStringList displayNames() const { return displayNames_; }
    QVariantList displayIds() const { return displayIds_; }
    void updateCaptureExclusions();
    QVariantList displayRefreshRates() const { return displayRefreshRates_; }
    QVariantList windowSources() const { return windowSources_; }
    QString status() const { return status_; }
    bool running() const { return running_; }
    bool busy() const { return busy_; }
    bool recording() const { return recording_; }
    bool recordingPaused() const { return recordingPaused_; }
    bool recordingFinalizing() const { return recordingFinalizing_; }
    QString recordingProjectPath() const { return recordingProjectPath_; }
    QString recordingStatus() const { return recordingStatus_; }
    QString lastRecordingPath() const { return lastRecordingPath_; }
    QString lastProjectPath() const { return lastProjectPath_; }
    QObject *frameStore() const;
    QVariantMap sourceGeometry() const { return sourceGeometry_; }
    QVariantList recentProjects() const { return recentProjects_; }

    Q_INVOKABLE void refreshDisplays();
    Q_INVOKABLE void startDisplay(int index);
    // Window source by SCWindow.windowID (0 = none).
    Q_INVOKABLE void startWindow(double windowId);
    // Region source in global points; the display is picked from the region's
    // centre so a drag across a monitor boundary still lands on a real display.
    Q_INVOKABLE void startRegion(double x, double y, double width, double height);
    Q_INVOKABLE void startRecordingDisplay(int index, const QVariantMap &settings);
    // Same, for the other two source kinds. They exist so the UI never has to
    // sequence "start the source, then remember to start recording" itself.
    Q_INVOKABLE void startRecordingWindow(double windowId, const QVariantMap &settings);
    Q_INVOKABLE void startRecordingRegion(double x, double y, double width, double height,
        const QVariantMap &settings);
    // Records the currently running source; the UI calls this after startSource.
    Q_INVOKABLE void startRecording();
    Q_INVOKABLE void pauseRecording();
    Q_INVOKABLE void resumeRecording();
    Q_INVOKABLE void stopRecording();
    Q_INVOKABLE void stop();
    Q_INVOKABLE void openLastProject();
    // Re-scans the recording directory. Called on launch and after a recording ends.
    Q_INVOKABLE void refreshRecentProjects();
    // The settings the scan needs (only the recording directory, currently). Kept
    // separate from the recording settings so the scan does not depend on a recording
    // having happened.
    Q_INVOKABLE void setRecordingSettings(const QVariantMap &settings) {
        recordingSettings_ = settings;
    }
    // Points the app at an existing recording: the exporter and the edit timeline
    // both follow `lastProjectPathChanged`.
    Q_INVOKABLE void openProject(const QString &directory);
    Q_INVOKABLE void openRecordingDirectory();

    bool screenAuthorized() const;
    // Human-readable reason the last capture/event start failed, plus a stable
    // kind ("screen" / "input" / "microphone") the guide uses to pick a tab.
    QString permissionIssue() const { return permissionIssue_; }
    QString permissionIssueKind() const { return permissionIssueKind_; }
    Q_INVOKABLE void refreshScreenAuthorization();
    // Re-reads all three, for the guide's "我已授权，重新检测" button.
    Q_INVOKABLE void refreshPermissionState();

    bool inputMonitoringAuthorized() const;
    bool microphoneAuthorized() const;
    bool microphoneBlocked() const;
    Q_INVOKABLE bool requestScreenAuthorization();
    Q_INVOKABLE void openScreenRecordingSettings();
    Q_INVOKABLE void openInputMonitoringSettings();
    Q_INVOKABLE void openMicrophoneSettings();
    Q_INVOKABLE void requestMicrophoneAccess();
    Q_INVOKABLE bool requestInputMonitoringAccess();
    Q_INVOKABLE void revealAppInFinder();
    Q_INVOKABLE QString appBundlePath() const;
    Q_INVOKABLE QString appFileUrl() const;
    Q_INVOKABLE void beginAppDrag();
    Q_INVOKABLE void relaunch();
    Q_INVOKABLE void resetScreenPermission();

signals:
    void displayNamesChanged();
    void windowSourcesChanged();
    void statusChanged();
    void runningChanged();
    void busyChanged();
    void recordingChanged();
    void recordingPausedChanged();
    void recordingFinalizingChanged();
    void recordingReady(const QString &directory);
    void recordingFailed(const QString &message);
    void recordingStatusChanged();
    void lastRecordingPathChanged();
    void screenAuthorizedChanged();
    void permissionStateChanged();
    void sourceGeometryChanged();
    void recentProjectsChanged();
    void permissionIssueChanged();
    void captureAccessDenied();

private:
    struct Impl;
    std::unique_ptr<Impl> impl_;
    std::shared_ptr<VideoFrameStore> frameStore_;

    // One code path for every source kind. startDisplay/startWindow/startRegion
    // only build a CaptureSource; everything below is source-agnostic.
    void startSource(const Capture::CaptureSource &source);
    void startRecordingSource(const Capture::CaptureSource &source, const QVariantMap &settings);

    QStringList displayNames_;
    QVariantList displayIds_;
    QVariantList displayRefreshRates_;
    QVariantList windowSources_;
    QString status_ = QStringLiteral("正在准备屏幕来源…");
    bool running_ = false;
    bool busy_ = false;
    bool stopRequested_ = false;
    bool recordWhenReady_ = false;
    bool captureProbeOk_ = false;
    bool recording_ = false;
    bool recordingPaused_ = false;
    bool recordingFinalizing_ = false;
    std::optional<Capture::CaptureSource> pendingRecordingSource_;
    QString recordingProjectPath_;
    int activeDisplayIndex_ = -1;
    // The source the running stream is capturing. Recorded verbatim in
    // project.json so a project always states what it was made from.
    Capture::CaptureSource activeSource_;
    QString recordingStatus_;
    QString lastRecordingPath_;
    QString lastProjectPath_;
    QVariantMap recordingSettings_;
    QVariantMap sourceGeometry_;
    QVariantList recentProjects_;
    QString permissionIssue_;
    QString permissionIssueKind_;

    void setStatus(const QString &value);
    void setPermissionIssue(const QString &kind, const QString &message);
    void setRunning(bool value);
    void setBusy(bool value);
    void setRecording(bool value);
    void setRecordingPaused(bool value);
    void setRecordingFinalizing(bool value);
    void setRecordingStatus(const QString &value);
    void setLastRecordingPath(const QString &value);
    void reportError(const QString &value);
};
