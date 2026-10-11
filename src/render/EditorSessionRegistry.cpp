#include "EditorSessionRegistry.h"

#include "../project/RecentProjects.h"

#include <QDir>
#include <QFileInfo>
#include <QGuiApplication>
#include <QQmlComponent>
#include <QQuickWindow>
#include <QScreen>
#include <algorithm>

namespace Render {
namespace {

// Where a torn-off window is placed. Clamped to a screen so a drag that ended past the
// edge of the desktop cannot create a window nobody can reach.
QPoint windowPosition(const QPoint &requested) {
    const QScreen *screen = QGuiApplication::screenAt(requested);
    if (!screen)
        screen = QGuiApplication::primaryScreen();
    if (!screen)
        return requested;
    const QRect available = screen->availableGeometry();
    return QPoint(std::clamp(requested.x(), available.left(), std::max(available.left(), available.right() - 320)),
        std::clamp(requested.y(), available.top(), std::max(available.top(), available.bottom() - 240)));
}

} // namespace

EditorSessionRegistry::EditorSessionRegistry(QQmlEngine *engine, QObject *parent)
    : QObject(parent), engine_(engine) {
    refreshRecentProjects();
}

EditorSessionRegistry::~EditorSessionRegistry() {
    // Destroy views while their session/context objects are still alive. The
    // windows created through QQmlComponent are not engine root objects.
    QList<QQuickWindow *> windows;
    for (const auto &state : windows_) if (state.window) windows.append(state.window);
    for (auto *window : windows) { disconnect(window, nullptr, this, nullptr); delete window; }
}

void EditorSessionRegistry::bump() {
    ++revision_;
    emit revisionChanged();
} 

QVariantList EditorSessionRegistry::tabs() const {
    QVariantList list;
    for (auto it = windows_.constBegin(); it != windows_.constEnd(); ++it) {
        for (const QString &project : it.value().projects) {
            list.append(QVariantMap{
                {QStringLiteral("windowId"), it.key()},
                {QStringLiteral("path"), project},
                {QStringLiteral("title"), RecentProjects::describe(project)},
                {QStringLiteral("current"), project == it.value().current},
                {QStringLiteral("dirty"), sessions_.value(project) && sessions_.value(project)->dirty()},
            });
        }
    }
    return list;
}

QVariantList EditorSessionRegistry::tabsForWindow(int windowId) const {
    QVariantList list;
    const auto it = windows_.constFind(windowId);
    if (it == windows_.constEnd())
        return list;
    for (const QString &project : it.value().projects) {
        EditorSession *session = sessions_.value(project);
        list.append(QVariantMap{
            {QStringLiteral("path"), project},
            {QStringLiteral("title"), RecentProjects::describe(project)},
            {QStringLiteral("current"), project == it.value().current},
            {QStringLiteral("dirty"), session && session->dirty()},
        });
    }
    return list;
}

QString EditorSessionRegistry::activeTitle() const {
    const EditorSession *session = activeSession();
    return session ? session->title() : QString();
}

bool EditorSessionRegistry::activeDirty() const {
    const EditorSession *session = activeSession();
    return session && session->dirty();
}

bool EditorSessionRegistry::activeCanUndo() const {
    const EditorSession *session = activeSession();
    return session && session->timeline()->canUndo();
}

bool EditorSessionRegistry::activeCanRedo() const {
    const EditorSession *session = activeSession();
    return session && session->timeline()->canRedo();
}

QVariantList EditorSessionRegistry::recentProjects() const {
    return recentProjects_;
}

void EditorSessionRegistry::setRecordingDirectory(const QString &directory) {
    const QString resolved = RecentProjects::recordingDirectory(directory);
    if (resolved == recordingDirectory_)
        return;
    recordingDirectory_ = resolved;
    refreshRecentProjects();
}

void EditorSessionRegistry::refreshRecentProjects() {
    QVariantList list;
    for (const QString &path : RecentProjects::list(recordingDirectory_)) {
        list.append(QVariantMap{{QStringLiteral("path"), path},
            {QStringLiteral("label"), RecentProjects::describe(path)}});
    }
    recentProjects_ = list;
    emit recentProjectsChanged();
}

EditorSession *EditorSessionRegistry::ensureSession(const QString &projectDirectory) {
    const QString canonical = QFileInfo(projectDirectory).absoluteFilePath();
    if (EditorSession *existing = sessions_.value(canonical))
        return existing;
    auto *session = new EditorSession(canonical, this);
    sessions_.insert(canonical, session);
    // A tab shows a dirty dot, and the registry-level properties follow the active
    // session, so both have to be re-announced when a session's state moves.
    connect(session, &EditorSession::dirtyChanged, this, [this] { emit tabsChanged(); });
    connect(session, &EditorSession::changed, this, [this, session] {
        if (session == activeSession())
            emit activeSessionChanged();
        emit tabsChanged();
    });
    connect(session->timeline(), &TimelineController::changed, this,
        [this] { emit activeSessionChanged(); });
    session->open();
    return session;
}

EditorSession *EditorSessionRegistry::openProject(const QString &projectDirectory, bool inNewWindow) {
    if (projectDirectory.isEmpty() || !QFileInfo::exists(projectDirectory + QStringLiteral("/project.json")))
        return nullptr;
    EditorSession *session = ensureSession(projectDirectory);
    const QString canonical = session->projectDirectory();

    // Already open somewhere: focus it instead of showing the same project twice. Two
    // views of one recording would be two undo stacks over one file, which is a way to
    // lose an edit with no warning at all.
    for (auto it = windows_.begin(); it != windows_.end(); ++it) {
        if (it.value().projects.contains(canonical)) {
            it.value().current = canonical;
            if (inNewWindow) {
                // Explicitly asked for a second window: move the tab rather than
                // duplicating the session.
                QQuickWindow *target = newWindow();
                if (target) {
                    moveTab(canonical, target->property("editorWindowId").toInt(), -1);
                    return session;
                }
            }
            activateWindow(it.key());
            emit tabsChanged();
            emit activeSessionChanged();
            return session;
        }
    }

    QQuickWindow *window = nullptr;
    if (inNewWindow || windows_.isEmpty())
        window = newWindow();
    else
        window = windowAt(activeWindowId_);
    if (!window)
        window = newWindow();
    if (!window)
        return session;

    const int windowId = window->property("editorWindowId").toInt();
    WindowState &state = windows_[windowId];
    state.projects.append(canonical);
    state.current = canonical;
    activeWindowId_ = windowId;
    window->show();
    window->raise();
    emit tabRequested(windowId, canonical);
    emit tabsChanged();
    emit activeSessionChanged();
    emit activeWindowChanged();
    bump();
    return session;
}

QQuickWindow *EditorSessionRegistry::newWindow() {
    if (!engine_)
        return nullptr;
    QQmlComponent component(engine_, QUrl(QStringLiteral("qrc:/qt/qml/Jianku/Screen/EditorWindow.qml")));
    if (component.isError()) {
        qWarning("编辑器窗口加载失败: %s", qPrintable(component.errorString()));
        return nullptr;
    }
    QObject *object = component.create();
    auto *window = qobject_cast<QQuickWindow *>(object);
    if (!window) {
        delete object;
        return nullptr;
    }
    const int id = nextWindowId_++;
    window->setProperty("editorWindowId", id);
    WindowState state;
    state.window = QPointer<QQuickWindow>(window);
    windows_.insert(id, state);
    attachWindow(window);
    activeWindowId_ = id;
    window->show();
    emit tabsChanged();
    emit activeWindowChanged();
    emit activeSessionChanged();
    bump();
    return window;
}

void EditorSessionRegistry::attachWindow(QQuickWindow *window) {
    // Closing a window must not destroy the sessions it showed: a session can be open
    // in another window, and its edit may be unsaved. Only the tab list is dropped.
    const int id = window->property("editorWindowId").toInt();
    connect(window, &QObject::destroyed, this, [this, id] {
        windows_.remove(id);
        if (activeWindowId_ == id) {
            // QHash has no "first key": any surviving window will do, because the next
            // focus change corrects it.
            activeWindowId_ = 0;
            for (auto it = windows_.constBegin(); it != windows_.constEnd(); ++it) {
                activeWindowId_ = it.key();
                break;
            }
        }
        emit tabsChanged();
        emit activeWindowChanged();
        emit activeSessionChanged();
        bump();
    });
    connect(window, &QWindow::visibleChanged, this, [this, window](bool visible) {
        if (visible)
            noteActiveWindow(window);
    });
}

void EditorSessionRegistry::noteActiveWindow(QQuickWindow *window) {
    if (!window)
        return;
    const int id = window->property("editorWindowId").toInt();
    if (id == 0 || !windows_.contains(id) || activeWindowId_ == id)
        return;
    activeWindowId_ = id;
    emit activeWindowChanged();
    emit activeSessionChanged();
    bump();
}

EditorSession *EditorSessionRegistry::activeSession() const {
    if (!windows_.contains(activeWindowId_))
        return nullptr;
    const QString project = windows_.value(activeWindowId_).current;
    return project.isEmpty() ? nullptr : sessions_.value(project);
}

EditorSession *EditorSessionRegistry::sessionAt(int windowId) const {
    if (!windows_.contains(windowId))
        return nullptr;
    return sessions_.value(windows_.value(windowId).current);
}

QQuickWindow *EditorSessionRegistry::windowAt(int windowId) const {
    const auto it = windows_.constFind(windowId);
    return it == windows_.constEnd() ? nullptr : it.value().window.data();
}

void EditorSessionRegistry::activateTab(int windowId, const QString &projectDirectory) {
    if (!windows_.contains(windowId))
        return;
    WindowState &state = windows_[windowId];
    const QString canonical = QFileInfo(projectDirectory).absoluteFilePath();
    if (!state.projects.contains(canonical))
        return;
    state.current = canonical;
    activeWindowId_ = windowId;
    if (QQuickWindow *window = state.window.data()) {
        window->show();
        window->raise();
        window->requestActivate();
    }
    emit tabsChanged();
    emit activeSessionChanged();
    emit activeWindowChanged();
    bump();
}

void EditorSessionRegistry::activateWindow(int windowId) {
    if (QQuickWindow *window = windowAt(windowId)) {
        window->show();
        window->raise();
        window->requestActivate();
        activeWindowId_ = windowId;
        emit activeWindowChanged();
        emit activeSessionChanged();
        bump();
    }
}

void EditorSessionRegistry::closeTab(int windowId, const QString &projectDirectory) {
    const auto it = windows_.find(windowId);
    if (it == windows_.end())
        return;
    const QString canonical = QFileInfo(projectDirectory).absoluteFilePath();
    WindowState &state = it.value();
    const int index = state.projects.indexOf(canonical);
    if (index < 0)
        return;
    state.projects.removeAt(index);
    recentlyClosed_.append(canonical);
    if (state.current == canonical)
        state.current = state.projects.isEmpty() ? QString()
            : state.projects.at(std::min(index, int(state.projects.size()) - 1));
    // The session itself is kept: reopening the project must come back with its undo
    // history and playhead, and a window that closes does not mean the user is done.
    if (state.current.isEmpty()) {
        if (QQuickWindow *window = state.window.data())
            window->close();
    }
    emit tabsChanged();
    emit activeSessionChanged();
    bump();
}

bool EditorSessionRegistry::moveTab(const QString &projectDirectory, int toWindowId, int toIndex) {
    const QString canonical = QFileInfo(projectDirectory).absoluteFilePath();
    int fromWindow = 0;
    int fromIndex = -1;
    for (auto it = windows_.constBegin(); it != windows_.constEnd(); ++it) {
        const int index = it.value().projects.indexOf(canonical);
        if (index >= 0) {
            fromWindow = it.key();
            fromIndex = index;
            break;
        }
    }
    if (fromIndex < 0)
        return false;
    if (fromWindow == toWindowId) {
        // Reorder within one window. Inserting at the old index is a no-op, and the
        // index shifts by one when the tab is removed from before the target.
        QStringList &list = windows_[fromWindow].projects;
        if (toIndex < 0 || toIndex >= list.size())
            toIndex = list.size() - 1;
        list.move(fromIndex, toIndex);
        emit tabsChanged();
        bump();
        return true;
    }
    if (!windows_.contains(toWindowId))
        return false;
    windows_[fromWindow].projects.removeAt(fromIndex);
    QStringList &target = windows_[toWindowId].projects;
    const int insertAt = (toIndex < 0 || toIndex > target.size()) ? target.size() : toIndex;
    target.insert(insertAt, canonical);
    windows_[toWindowId].current = canonical;
    activeWindowId_ = toWindowId;
    if (windows_[fromWindow].projects.isEmpty()) {
        if (QQuickWindow *window = windows_[fromWindow].window.data())
            window->close();
    }
    if (QQuickWindow *window = windowAt(toWindowId))
        window->show();
    emit tabRequested(toWindowId, canonical);
    emit tabsChanged();
    emit activeSessionChanged();
    bump();
    return true;
}

QQuickWindow *EditorSessionRegistry::tearOff(const QString &projectDirectory, double globalX, double globalY) {
    // Braces, not parentheses: `QPoint release(int(x), int(y))` parses as a function
    // declaration (the most vexing parse), which then reads as "no such function" three
    // lines later.
    const QPoint release{int(globalX), int(globalY)};
    // Qt reports "dropped outside the app" and "cancelled with Escape" identically, so
    // the only way to tell them apart is geometry: if the release point is still inside
    // an editor window, this was a cancel or a reorder, not a tear-off.
    for (auto it = windows_.constBegin(); it != windows_.constEnd(); ++it) {
        QQuickWindow *window = it.value().window.data();
        if (window && window->isVisible() && window->geometry().contains(release))
            return nullptr;
    }
    QQuickWindow *window = newWindow();
    if (!window)
        return nullptr;
    window->setPosition(windowPosition(release));
    moveTab(projectDirectory, window->property("editorWindowId").toInt(), -1);
    return window;
}

void EditorSessionRegistry::saveActive() {
    if (EditorSession *session = activeSession())
        session->save();
}

void EditorSessionRegistry::undoActive() {
    if (EditorSession *session = activeSession()) {
        session->timeline()->undo();
        emit activeSessionChanged();
    }
}

void EditorSessionRegistry::redoActive() {
    if (EditorSession *session = activeSession()) {
        session->timeline()->redo();
        emit activeSessionChanged();
    }
}

} // namespace Render
