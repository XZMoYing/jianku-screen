#pragma once

#include "../project/RecentProjects.h"
#include "ExportController.h"
#include "TimelineController.h"
#include "TimelineMedia.h"
#include "../settings/SettingsStore.h"

#include <QObject>
#include <QString>
#include <QTimer>

namespace Render {

// One recording, open for editing: the top-level object a tab is a view of.
//
// Why this type has to exist: `TimelineController` and `ExportController` used to be
// process-wide singletons in `main.cpp`, wired to "the recording that finished last".
// That is fine for one editor and impossible for two. Two tabs sharing one controller
// means undo in one tab changes the other, and — worse — `TimelineController::load()`
// resets the timeline, so merely switching tabs would discard the edit you were not
// looking at. Two tabs sharing one exporter means the export targets whichever project
// was opened most recently, which is not necessarily the one on screen.
//
// So the state moves here, one instance per project, and the window layer just decides
// which session is visible. The session deliberately does *not* know about windows: a
// tab that is dragged into a new window keeps the same session, and a window that
// closes while its session is still open elsewhere must not take the session with it.
class EditorSession final : public QObject {
    Q_OBJECT
    Q_PROPERTY(QString projectDirectory READ projectDirectory NOTIFY changed)
    // What to show in a tab: "10-04 07:30 · 2:05". Reused from the recent-projects
    // search so a tab and the open dialog label the same recording the same way.
    Q_PROPERTY(QString title READ title NOTIFY changed)
    Q_PROPERTY(bool loaded READ loaded NOTIFY changed)
    Q_PROPERTY(QString error READ error NOTIFY changed)
    // Forwarded from the timeline so a tab can show a dirty dot without reaching
    // through two objects.
    Q_PROPERTY(bool dirty READ dirty NOTIFY dirtyChanged)
    // The two controllers, as QObject so QML can reach them without the types having
    // to be registered as creatable: the session is the only thing that constructs
    // them, and QML only ever reads properties and calls Q_INVOKABLE methods.
    //
    // They must be Q_PROPERTYs, not plain accessors. A plain method is invisible to the
    // engine, so `session.timeline` evaluated to `undefined` and every binding through
    // it failed with "Cannot read property of undefined" — a wall of errors that named
    // the strip rather than the missing property.
    Q_PROPERTY(QObject *timeline READ timelineObject CONSTANT)
    Q_PROPERTY(QObject *exporter READ exporterObject CONSTANT)
    Q_PROPERTY(QObject *settings READ settingsObject CONSTANT)
    Q_PROPERTY(QObject *media READ mediaObject CONSTANT)

public:
    ~EditorSession() override;
    explicit EditorSession(const QString &projectDirectory, QObject *parent = nullptr);

    QString projectDirectory() const { return projectDirectory_; }
    QString title() const { return title_; }
    bool loaded() const { return timeline_.loaded(); }
    QString error() const { return error_; }
    bool dirty() const { return timeline_.dirty(); }

    TimelineController *timeline() { return &timeline_; }
    const TimelineController *timeline() const { return &timeline_; }
    ExportController *exporter() { return &exporter_; }
    QObject *timelineObject() { return &timeline_; }
    QObject *exporterObject() { return &exporter_; }
    QObject *settingsObject() { return &settings_; }
    SettingsStore *settingsStore() { return &settings_; }
    QObject *mediaObject() { return &media_; }
    TimelineMedia *media() { return &media_; }
    Q_INVOKABLE void revealProject();

    // Loads the recording and any saved edit. Returns false when the project cannot be
    // opened at all (no manifest, no readable timeline); a sidecar that failed to load
    // still returns true, with `error` explaining what was ignored.
    bool open();
    // Writes the edit sidecar. Returns false when there is nothing to save to.
    Q_INVOKABLE bool save();

    // Where this project's export lands by default.
    QString defaultExportPath() const { return exporter_.defaultOutputPath(); }

signals:
    void changed();
    void errorChanged();
    void dirtyChanged();

private:
    QString projectDirectory_;
    QString title_;
    QString error_;
    bool initializing_ = false;
    bool restoring_ = false;
    QTimer autosave_;
    TimelineController timeline_;
    ExportController exporter_;
    SettingsStore settings_;
    TimelineMedia media_;
};

} // namespace Render
