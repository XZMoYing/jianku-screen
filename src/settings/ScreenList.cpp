#include "ScreenList.h"

#include <QGuiApplication>
#include <QQuickWindow>
#include <QScreen>

ScreenList::ScreenList(QObject *parent) : QObject(parent) {
    connect(qApp, &QGuiApplication::screenAdded, this, &ScreenList::displaysChanged);
    connect(qApp, &QGuiApplication::screenRemoved, this, &ScreenList::displaysChanged);
}

QVariantList ScreenList::displays() const {
    QVariantList list;
    int index = 0;
    for (QScreen *screen : QGuiApplication::screens()) {
        const QRect geometry = screen->geometry();
        list.append(QVariantMap{
            {"index", index++},
            {"name", screen->name()},
            {"width", geometry.width()},
            {"height", geometry.height()},
            {"x", geometry.x()},
            {"y", geometry.y()},
            {"primary", screen == QGuiApplication::primaryScreen()}});
    }
    return list;
}

QRectF ScreenList::unionGeometry() const {
    QRect united;
    for (QScreen *screen : QGuiApplication::screens())
        united = united.united(screen->geometry());
    return QRectF(united);
}

void ScreenList::placeWindowOnDisplay(QObject *window, int index, bool fillScreen) {
    auto *quickWindow = qobject_cast<QQuickWindow *>(window);
    if (!quickWindow) {
        if (window)
            qWarning("placeWindowOnDisplay: not a window");
        return;
    }
    const QList<QScreen *> screens = QGuiApplication::screens();
    if (index >= 0 && index < screens.size())
        quickWindow->setScreen(screens[index]);
    if (!fillScreen) {
        quickWindow->showNormal();
        quickWindow->show();
        quickWindow->raise();
        return;
    }

    QScreen *target = quickWindow->screen();
    if (!target)
        target = QGuiApplication::primaryScreen();
    if (!target) {
        quickWindow->show();
        return;
    }
    // Frameless + the screen's own geometry, rather than showFullScreen(). See the header
    // for why: a macOS full-screen window lives in its own Space, and the Space outlived
    // the presentation — the second display stayed black after stopping.
    quickWindow->setFlags(quickWindow->flags() | Qt::FramelessWindowHint);
    quickWindow->setGeometry(target->geometry());
    quickWindow->show();
    quickWindow->raise();
}

void ScreenList::releaseWindow(QObject *window) {
    auto *quickWindow = qobject_cast<QQuickWindow *>(window);
    if (!quickWindow)
        return;
    // Order matters: hide first so the flag change is not animated on screen, then drop
    // the frameless hint so the next show() is an ordinary window again.
    quickWindow->hide();
    quickWindow->setFlags(quickWindow->flags() & ~Qt::FramelessWindowHint);
}
