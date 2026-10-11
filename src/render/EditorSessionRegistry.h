#pragma once

#include "EditorSession.h"

#include <QHash>
#include <QObject>
#include <QPointer>
#include <QQmlEngine>
#include <QStringList>
#include <QVariantList>

class QQuickWindow;

namespace Render {

// Owns every open editor session and every editor window, and decides which tab is in
// which window.
//
// The window layer is deliberately thin and lives here rather than in QML: the one
// operation that cannot be expressed in QML is moving a *live* item between windows,
// because QML has no `setParentItem` and a `Window` declared inside another `Window`
// becomes its transient child. Both were measured (see
// docs/编辑器窗口架构简报.md, appendix A) rather than assumed.
//
// One engine, many windows: a second `QQmlEngine` would not see the `cursor://` image
// provider, the registered `VideoSurface` type, or any of the context properties, and
// `QQmlApplicationEngine` destroys everything it loaded when it is destroyed.
class EditorSessionRegistry final : public QObject {
    Q_OBJECT
    // Every open session, in tab order within each window. Exposed as a flat list plus
    // a window id so the QML tab bar can be a plain Repeater.
    Q_PROPERTY(QVariantList tabs READ tabs NOTIFY tabsChanged)
    Q_PROPERTY(int activeWindowId READ activeWindowId NOTIFY activeWindowChanged)
    Q_PROPERTY(QString activeTitle READ activeTitle NOTIFY activeSessionChanged)
    Q_PROPERTY(bool activeDirty READ activeDirty NOTIFY activeSessionChanged)
    Q_PROPERTY(bool activeCanUndo READ activeCanUndo NOTIFY activeSessionChanged)
    Q_PROPERTY(bool activeCanRedo READ activeCanRedo NOTIFY activeSessionChanged)
    Q_PROPERTY(bool hasActive READ hasActive NOTIFY activeSessionChanged)
    // Recent recordings, for the editor's empty state and its File menu.
    Q_PROPERTY(QVariantList recentProjects READ recentProjects NOTIFY recentProjectsChanged)
    // Bumped on every change that could alter which session a window is showing.
    //
    // `sessionAt(windowId)` is a function call, and a QML binding onto a function call
    // has no property to depend on: it evaluates once and then never again. The window
    // therefore reads this counter as well, which is what makes the binding re-run.
    // (This was the bug that opened the editor on its empty state while the tab bar
    // already listed the project.)
    Q_PROPERTY(int revision READ revision NOTIFY revisionChanged)
    // Where recordings are looked for. Set from the settings by main.cpp rather than
    // read here, so the search uses the same value the recorder wrote to.
    Q_PROPERTY(QString recordingDirectory READ recordingDirectory WRITE setRecordingDirectory
        NOTIFY recentProjectsChanged)

public:
    explicit EditorSessionRegistry(QQmlEngine *engine, QObject *parent = nullptr);
    ~EditorSessionRegistry() override;

    QVariantList tabs() const;
    int activeWindowId() const { return activeWindowId_; }
    QString activeTitle() const;
    bool activeDirty() const;
    bool activeCanUndo() const;
    bool activeCanRedo() const;
    bool hasActive() const { return activeSession() != nullptr; }
    QVariantList recentProjects() const;
    int revision() const { return revision_; }
    QString recordingDirectory() const { return recordingDirectory_; }
    void setRecordingDirectory(const QString &directory);

    // Opens a project, or focuses the tab that already has it. `inNewWindow` forces a
    // new window; by default it goes to the active window, and to a new window when
    // there is none — which is what "默认开到新标签页，没有标签页就开到新窗口" means.
    Q_INVOKABLE EditorSession *openProject(const QString &projectDirectory, bool inNewWindow = false);
    // Opens an empty editor window (⌘N).
    Q_INVOKABLE QQuickWindow *newWindow();
    Q_INVOKABLE void closeTab(int windowId, const QString &projectDirectory);
    Q_INVOKABLE void activateTab(int windowId, const QString &projectDirectory);
    Q_INVOKABLE void activateWindow(int windowId);
    // Moves a tab within a window, or to another window's end. `toIndex` of -1 appends.
    Q_INVOKABLE bool moveTab(const QString &projectDirectory, int toWindowId, int toIndex);
    // Drag-out. Qt cannot distinguish "dropped outside the app" from "pressed Escape"
    // (both arrive as IgnoreAction with a null target), so the caller reports where the
    // drag ended and this decides whether that was outside every editor window.
    Q_INVOKABLE QQuickWindow *tearOff(const QString &projectDirectory, double globalX, double globalY);
    Q_INVOKABLE void saveActive();
    Q_INVOKABLE void undoActive();
    Q_INVOKABLE void redoActive();
    Q_INVOKABLE void refreshRecentProjects();

    // The session a window is showing, or null for an empty window.
    Q_INVOKABLE EditorSession *sessionAt(int windowId) const;
    // The tabs of one window, in order. A flat `tabs` list would make the tab bar
    // filter by window in QML, which is where an off-by-one between two windows lives.
    Q_INVOKABLE QVariantList tabsForWindow(int windowId) const;
    Q_INVOKABLE QQuickWindow *windowAt(int windowId) const;

    EditorSession *activeSession() const;
    // Called by each editor window as it gains focus, so the menu bar and the
    // shortcuts act on what the user is looking at. Q_INVOKABLE because QML calls it:
    // a plain method on a context property is invisible to the engine.
    Q_INVOKABLE void noteActiveWindow(QQuickWindow *window);

signals:
    void tabsChanged();
    void activeWindowChanged();
    void activeSessionChanged();
    void recentProjectsChanged();
    void revisionChanged();
    // A window should show `projectDirectory` in `windowId`. Emitted instead of the
    // registry touching QML directly, so a window that is still being constructed can
    // pick it up when it is ready.
    void tabRequested(int windowId, const QString &projectDirectory);

private:
    struct WindowState {
        QPointer<QQuickWindow> window;
        QStringList projects;   // tab order
        QString current;
    };

    EditorSession *ensureSession(const QString &projectDirectory);
    void attachWindow(QQuickWindow *window);
    void pruneWindows();
    QStringList allProjectDirectories() const;

    QQmlEngine *engine_ = nullptr;
    QHash<int, WindowState> windows_;
    QHash<QString, EditorSession *> sessions_;
    // Closed tabs, newest last, for ⌘⇧T.
    QStringList recentlyClosed_;
    QVariantList recentProjects_;
    QString recordingDirectory_;
    void bump();
    int activeWindowId_ = 0;
    int nextWindowId_ = 1;
    int revision_ = 0;
};

} // namespace Render
