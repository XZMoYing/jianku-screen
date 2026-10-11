#include "EditorSession.h"

#include "../project/RecentProjects.h"
#include "../project/EditSidecar.h"
#include <QFileInfo>
#include <QDesktopServices>
#include <QUrl>

namespace Render {

EditorSession::EditorSession(const QString &projectDirectory, QObject *parent)
    : QObject(parent), projectDirectory_(projectDirectory), settings_(this, projectDirectory + "/appearance.json") {
    autosave_.setSingleShot(true); autosave_.setInterval(1000);
    connect(&autosave_, &QTimer::timeout, this, [this] { if (dirty()) save(); });
    connect(&timeline_, &TimelineController::dirtyChanged, this, [this] { if (!initializing_ && dirty()) autosave_.start(); });
    connect(&timeline_, &TimelineController::focusChanged, this, [this] { exporter_.setFocusRanges(timeline_.focusRanges()); });
    connect(&timeline_, &TimelineController::appearanceRestored, this, [this](const QVariantMap &map) {
        restoring_ = true; settings_.replaceCurrent(map); restoring_ = false;
    });
    title_ = RecentProjects::describe(projectDirectory_);

    // The wiring lives here rather than in main.cpp so it exists exactly once per
    // project instead of exactly once per process. `timelineChanged` is emitted for
    // every successful edit, so the exporter always holds the current timeline and an
    // export started from the UI cannot pick up a stale one.
    connect(&timeline_, &TimelineController::timelineChanged, &exporter_, [this] {
        exporter_.setTimeline(timeline_.timeline());
    });
    connect(&timeline_, &TimelineController::changed, this, [this] {
        emit changed();
        emit dirtyChanged();
    });
    connect(&timeline_, &TimelineController::dirtyChanged, this, &EditorSession::dirtyChanged);
    connect(&settings_, &SettingsStore::currentChanged, this, [this] {
        if (!initializing_ && !restoring_) timeline_.recordAppearance(settings_.current());
        exporter_.setEditingSettings(settings_.current());
        exporter_.refreshOutputSize();
        emit changed();
    });
    connect(&settings_, &SettingsStore::errorOccurred, this, [this](const QString &message) {
        error_ = message; emit errorChanged(); emit changed();
    });
    connect(&timeline_, &TimelineController::errorChanged, this, [this] {
        error_ = timeline_.error();
        emit errorChanged();
        emit changed();
    });
}

EditorSession::~EditorSession() { autosave_.stop(); if (dirty()) timeline_.save(); }

bool EditorSession::open() {
    initializing_ = true; autosave_.stop();
    const bool ok = timeline_.load(projectDirectory_);
    // The exporter follows the session, not "the last recording". Without this an
    // export started from a tab would write the other tab's project — the exact
    // failure that made a process-wide controller untenable.
    exporter_.setProjectDirectory(projectDirectory_);
    exporter_.setTimeline(timeline_.timeline());
    const auto project = loadProject(projectDirectory_);
    settings_.initializeProject(project.settings);
    const auto saved = Project::load(projectDirectory_, project.durationMs);
    if (saved.valid && !saved.appearance.isEmpty()
        && (saved.projectCreatedAt.isEmpty() || saved.projectCreatedAt == project.createdAt)
        && QFileInfo(Project::path(projectDirectory_)).lastModified() >= QFileInfo(projectDirectory_ + "/appearance.json").lastModified())
        settings_.replaceCurrent(saved.appearance);
    timeline_.initializeAppearance(settings_.current());
    exporter_.setFocusRanges(timeline_.focusRanges());
    exporter_.setEditingSettings(settings_.current());
    initializing_ = false;
    if (ok) media_.load(projectDirectory_);
    title_ = RecentProjects::describe(projectDirectory_);
    emit changed();
    return ok;
}

void EditorSession::revealProject() { QDesktopServices::openUrl(QUrl::fromLocalFile(projectDirectory_)); }

bool EditorSession::save() {
    autosave_.stop();
    const bool ok = timeline_.save();
    if (!ok)
        error_ = timeline_.error();
    emit changed();
    return ok;
}

} // namespace Render
