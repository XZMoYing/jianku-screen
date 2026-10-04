#pragma once

#include <QObject>
#include <QRectF>
#include <QVariantList>

// Enumerates screens and lets QML place the audience window on a chosen display.
class ScreenList final : public QObject {
    Q_OBJECT
    Q_PROPERTY(QVariantList displays READ displays NOTIFY displaysChanged)
    // Bounding rect of every screen in the same logical coordinates the screens
    // report, so the region selector can cover a multi-monitor desktop instead of
    // being trapped on one display.
    Q_PROPERTY(QRectF unionGeometry READ unionGeometry NOTIFY displaysChanged)

public:
    explicit ScreenList(QObject *parent = nullptr);

    QVariantList displays() const;
    QRectF unionGeometry() const;

    // Places the window on a display, or leaves it where it is when `index` < 0.
    //
    // `fillScreen` covers that display edge to edge. It is deliberately *not*
    // `showFullScreen()`: on macOS that puts the window in its own Space, and leaving it
    // leaves the Space behind — the display stayed black after the演示 was stopped. A
    // frameless window whose geometry is the screen covers the same pixels, is not a
    // Space, and is released by hiding it. It is also the behaviour a user wants from an
    // output window: it must not animate, take over Mission Control, or hide the menu bar
    // of the display the operator is working on.
    Q_INVOKABLE void placeWindowOnDisplay(QObject *window, int index, bool fillScreen);

    // Undoes placeWindowOnDisplay: drops the frameless flag and hides. Returns the window
    // to an ordinary window first so a later show() does not reappear full-bleed.
    Q_INVOKABLE void releaseWindow(QObject *window);

signals:
    void displaysChanged();
};
