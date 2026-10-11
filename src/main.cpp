#include "animation/AnimationDriver.h"
#include "mac/MacCapture.h"
#include "mac/QuickScreenshot.h"
#include "mac/GlobalHotkey.h"
#include "mac/AppMenu.h"
#include "mac/MacWindowStyle.h"
#include "project/RecentProjects.h"
#include "render/CanvasPreview.h"
#include "render/EditorSessionRegistry.h"
#include "render/ExportController.h"
#include "render/TimelineController.h"
#include "render/VideoSurface.h"
#include "render/RecordingPlayer.h"
#include "render/FilmstripProvider.h"
#include "settings/BackgroundLibrary.h"
#include "settings/BrandAssets.h"
#include "settings/ScreenList.h"
#include "settings/SettingsStore.h"

#include <QApplication>
#include <QAction>
#include <QMenu>
#include <QIcon>
#include <QPainter>
#include <QPixmap>
#include <QQmlApplicationEngine>
#include <QQmlContext>
#include <QQuickWindow>
#include <QQuickStyle>
#include <QSGRendererInterface>
#include <QTimer>
#include <QSystemTrayIcon>
#ifdef JIANKU_UI_VERIFICATION
#include "../tests/EditorVerification.h"
#endif

int main(int argc, char *argv[]) {
    QQuickWindow::setGraphicsApi(QSGRendererInterface::Metal);
    QQuickStyle::setStyle(QStringLiteral("Basic"));
    QApplication app(argc, argv);
    app.setApplicationName(QStringLiteral("Jianku Screen"));
    // The window icon: on macOS this is what the About panel and any window list
    // show, and it falls back to the same source as the tray icon.
    app.setWindowIcon(Branding::mark());
    app.setOrganizationName(QStringLiteral("Jianku"));
    app.setQuitOnLastWindowClosed(false);

    qmlRegisterType<VideoSurface>("Jianku.Screen", 1, 0, "VideoSurface");
    qmlRegisterType<Render::RecordingPlayer>("Jianku.Screen", 1, 0, "RecordingPlayer");
    MacCapture capture;
    SettingsStore settings;
    BackgroundLibrary backgrounds;
    ScreenList screens;
    AnimationDriver anim;
    QuickScreenshot screenshot;
    GlobalHotkey hotkey;
    GlobalHotkey focusHotkey;
    Render::ExportController exporter;
    Render::CanvasPreview canvasPreview;
    Render::CanvasPreview audienceCanvasPreview(nullptr, "audienceCanvas");
    BrandAssets brand;
    Render::TimelineController timeline;
    QQmlApplicationEngine engine;
    engine.addImageProvider(QStringLiteral("filmstrip"), new Render::FilmstripProvider);
    engine.rootContext()->setContextProperty(QStringLiteral("capture"), &capture);
    engine.rootContext()->setContextProperty(QStringLiteral("settings"), &settings);
    engine.rootContext()->setContextProperty(QStringLiteral("backgrounds"), &backgrounds);
    engine.rootContext()->setContextProperty(QStringLiteral("screens"), &screens);
    engine.rootContext()->setContextProperty(QStringLiteral("anim"), &anim);
    // addImageProvider takes ownership; allocate on the heap.
    engine.addImageProvider(QStringLiteral("cursor"), new CursorImageProvider(&anim));
    engine.addImageProvider(QStringLiteral("canvas"), new Render::CanvasImageProvider(&canvasPreview));
    engine.addImageProvider(QStringLiteral("audienceCanvas"), new Render::CanvasImageProvider(&audienceCanvasPreview));
    engine.rootContext()->setContextProperty(QStringLiteral("screenshot"), &screenshot);
    engine.rootContext()->setContextProperty(QStringLiteral("hotkey"), &hotkey);
    engine.rootContext()->setContextProperty(QStringLiteral("exporter"), &exporter);
    engine.rootContext()->setContextProperty(QStringLiteral("canvasPreview"), &canvasPreview);
    engine.rootContext()->setContextProperty(QStringLiteral("audienceCanvasPreview"), &audienceCanvasPreview);
    engine.rootContext()->setContextProperty(QStringLiteral("timeline"), &timeline);
    engine.rootContext()->setContextProperty(QStringLiteral("brand"), &brand);
    // The editor's session registry is the one new root-context object: it is shared by
    // every editor window, and a per-window instance would mean two windows could not
    // see each other's tabs. Everything project-specific is reached through a session,
    // not through the root context, so no per-window state leaks into the engine.
    Render::EditorSessionRegistry registry(&engine);
    engine.rootContext()->setContextProperty(QStringLiteral("registry"), &registry);
    auto updateCaptureSurfaces = [&] {
        QTimer::singleShot(200, &capture, &MacCapture::updateCaptureExclusions);
    };
    QObject::connect(&registry, &Render::EditorSessionRegistry::tabsChanged, &capture, updateCaptureSurfaces);
    QObject::connect(&capture, &MacCapture::runningChanged, &capture, updateCaptureSurfaces);
    // The exporter always targets the project the user just recorded, and exports
    // the edit timeline as it stands. The two are wired together here so an export
    // started from the UI can never use a stale timeline: the controller pushes
    // every change into the exporter.
    QObject::connect(&capture, &MacCapture::lastRecordingPathChanged, &exporter, [&] {
        exporter.setProjectDirectory(capture.lastProjectPath());
    });
    QObject::connect(&capture, &MacCapture::lastRecordingPathChanged, &timeline, [&] {
        timeline.load(capture.lastProjectPath());
    });
    QObject::connect(&timeline, &Render::TimelineController::timelineChanged, &exporter, [&] {
        exporter.setTimeline(timeline.timeline());
    });
    // The scan needs the recording directory, which lives in the settings — the
    // recorder's own copy of them is only filled in when a recording starts, so a
    // fresh launch would otherwise search the default directory even after the user
    // changed it.
    auto refreshRecent = [&] {
        capture.setRecordingSettings(settings.current());
        capture.refreshRecentProjects();
        registry.setRecordingDirectory(settings.current().value("recordingDirectory").toString());
    };
    QObject::connect(&settings, &SettingsStore::currentChanged, &capture, refreshRecent);
    QObject::connect(&app, &QGuiApplication::applicationStateChanged, &capture,
        [&](Qt::ApplicationState state) { if (state == Qt::ApplicationActive) capture.refreshPermissionState(); });
    refreshRecent();
    if (capture.lastProjectPath().isEmpty())
        capture.openProject(RecentProjects::mostRecent(RecentProjects::recordingDirectory(
            settings.current().value("recordingDirectory").toString())));
    // Installed before the first window so the menu bar is there from the start: a menu
    // that appears only after a window opens reads as a glitch.
    installApplicationMenu(&registry);
    engine.loadFromModule("Jianku.Screen", "Main");
    if (engine.rootObjects().isEmpty())
        return 1;
    auto *mainWindow = qobject_cast<QQuickWindow *>(engine.rootObjects().first());
    if (!mainWindow) return 1;
    applyDarkWindowStyle(mainWindow);
    if (auto *audienceWindow = mainWindow->findChild<QQuickWindow *>(QStringLiteral("audienceWindow"))) {
        QObject::connect(audienceWindow, &QWindow::visibleChanged, audienceWindow,
                         [audienceWindow](bool visible) {
                             if (visible) applyDarkWindowStyle(audienceWindow);
                         });
    }

    QObject::connect(&settings, &SettingsStore::currentChanged, &hotkey, [&] {
        hotkey.setShortcut(settings.current().value("screenshotHotkey").toString());
    });
    hotkey.setShortcut(settings.current().value("screenshotHotkey").toString());
    auto registerFocusHotkey = [&] {
        focusHotkey.setShortcut(settings.current().value("presentationFocusHotkey").toString());
    };
    registerFocusHotkey();
    QObject::connect(&settings, &SettingsStore::currentChanged, &focusHotkey, registerFocusHotkey);
    QObject::connect(&focusHotkey, &GlobalHotkey::activated, &anim, [&] {
        if (capture.running() && !capture.recording()) anim.toggleManualZoom();
    });
    QObject::connect(&hotkey, &GlobalHotkey::activated, &screenshot, [&] {
        screenshot.capture(settings.current());
    });
    QObject::connect(&app, &QGuiApplication::lastWindowClosed,
                     &capture, &MacCapture::stop);

    // The menu bar mark is a template image, like every other macOS status item: a
    // single-colour glyph that the system paints black or white to match the menu bar.
    // The coloured app icon was tried here first and is wrong for the spot — it is a
    // small picture among monochrome symbols, and on a dark menu bar its dark tile
    // nearly disappears against the bar.
    const QIcon trayIcon = Branding::menuBarIcon();
    QSystemTrayIcon tray{trayIcon};
    QMenu trayMenu;
    QAction *openAction = trayMenu.addAction(QStringLiteral("打开简库镜传"));
    QAction *screenshotAction = trayMenu.addAction(QStringLiteral("立即截图"));
    trayMenu.addSeparator();
    // The About panel is where macOS shows the application icon at its largest, and
    // it is the one place a user looks to check which build they are running.
    QAction *aboutAction = trayMenu.addAction(QStringLiteral("关于简库镜传"));
    trayMenu.addSeparator();
    QAction *quitAction = trayMenu.addAction(QStringLiteral("退出"));
    QObject::connect(openAction, &QAction::triggered, mainWindow, [mainWindow] {
        mainWindow->show();
        mainWindow->raise();
        mainWindow->requestActivate();
    });
    QObject::connect(screenshotAction, &QAction::triggered, &screenshot, [&] {
        screenshot.capture(settings.current());
    });
    QObject::connect(aboutAction, &QAction::triggered, &app, [] { showAboutPanel(); });
    QObject::connect(quitAction, &QAction::triggered, &app, &QApplication::quit);
    QObject::connect(&tray, &QSystemTrayIcon::activated, mainWindow,
        [mainWindow](QSystemTrayIcon::ActivationReason reason) {
            if (reason == QSystemTrayIcon::DoubleClick) {
                mainWindow->show();
                mainWindow->raise();
                mainWindow->requestActivate();
            }
        });
    tray.setContextMenu(&trayMenu);
    tray.setIcon(trayIcon);
    tray.setToolTip(QStringLiteral("简库镜传 · 常驻截图"));
    tray.show();
    const int openIndex = app.arguments().indexOf(QStringLiteral("--open-project"));
    if (openIndex >= 0 && openIndex + 1 < app.arguments().size()) {
        const QString project = app.arguments().at(openIndex + 1);
        QTimer::singleShot(0, &registry, [&registry, project] { registry.openProject(project, false); });
    } else if (app.arguments().contains(QStringLiteral("--open-editor"))) {
        const QString project = capture.lastProjectPath();
        if (!project.isEmpty()) QTimer::singleShot(0, &registry, [&registry, project] { registry.openProject(project, false); });
    }
    QObject::connect(&screenshot, &QuickScreenshot::statusChanged, &tray, [&] {
        if (!screenshot.status().isEmpty() && screenshot.status() != QStringLiteral("正在截图…"))
            tray.showMessage(QStringLiteral("简库镜传截图"), screenshot.status());
    });
    // Probe capture access unconditionally; success is treated as authorised.
#ifdef JIANKU_UI_VERIFICATION
    if (app.arguments().contains("--verify-editor")) {
        QTimer::singleShot(0, &app, [&] { startEditorVerification(&app, &registry, &capture, &screenshot); });
    } else
#endif
        QTimer::singleShot(0, &capture, &MacCapture::refreshDisplays);
    return app.exec();
}
