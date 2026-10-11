#pragma once

#include "AutoFocusEngine.h"
#include "CursorEngine.h"
#include "LiveFocus.h"
#include "SpringSolver.h"
#include "../render/SourceCrop.h"

#include <QElapsedTimer>
#include <QImage>
#include <QObject>
#include <QQuickImageProvider>
#include <QVariantMap>
#include <QVector>

class QTimer;

// Live pointer driver for the demo/real-time output. Samples the OS pointer
// causally, runs the cursor engine, and drives a causal zoom on click.
class AnimationDriver : public QObject {
    Q_OBJECT
    Q_PROPERTY(bool active READ active NOTIFY activeChanged)
    Q_PROPERTY(double contentWidth READ contentWidth NOTIFY contentSizeChanged)
    Q_PROPERTY(double contentHeight READ contentHeight NOTIFY contentSizeChanged)
    // The same frame in pixels. Needed because the appearance settings are authored in
    // output pixels while the pointer works in points: on a Retina display the two
    // differ by the backing scale factor, and using points for the layout drew every
    // absolute value at twice its exported size.
    Q_PROPERTY(double sourcePixelWidth READ sourcePixelWidth NOTIFY contentSizeChanged)
    Q_PROPERTY(double sourcePixelHeight READ sourcePixelHeight NOTIFY contentSizeChanged)
    // sourcePixels / sourcePoints — the display's backing scale factor, usually 2.
    //
    // This exists because `cursorX`/`cursorY` are in source *pixels* while the camera
    // (`camOffsetX`, `zoomFocus`) is in source *points*, and the preview draws in
    // points. Both spaces are deliberate: the pointer is in pixels because that is
    // what the recorded events and the compositor use, and the camera is in points
    // because the zoom is expressed as a fraction of the frame. Mixing them without
    // this factor put the preview's cursor at twice its distance from the top-left
    // corner, which is exactly the drift that was reported.
    Q_PROPERTY(double sourcePixelScale READ sourcePixelScale NOTIFY contentSizeChanged)
    // Pointer position in source *pixels*. This is the space the recorded pointer
    // events and the compositor use, so it is what the C++ side wants.
    Q_PROPERTY(double cursorX READ cursorX NOTIFY poseChanged)
    Q_PROPERTY(double cursorY READ cursorY NOTIFY poseChanged)
    // The same position in source *points*, for the live preview, which draws in
    // points. Two properties rather than one so QML never has to remember which space
    // it is holding: reading `cursorX` where points are needed is the mistake that put
    // the pointer at twice its distance from the corner on a Retina display.
    Q_PROPERTY(double cursorXPoints READ cursorXPoints NOTIFY poseChanged)
    Q_PROPERTY(double cursorYPoints READ cursorYPoints NOTIFY poseChanged)
    Q_PROPERTY(double cursorRotation READ cursorRotation NOTIFY poseChanged)
    Q_PROPERTY(double cursorScale READ cursorScale NOTIFY poseChanged)
    Q_PROPERTY(double cursorAlpha READ cursorAlpha NOTIFY poseChanged)
    Q_PROPERTY(double camScale READ camScale NOTIFY poseChanged)
    Q_PROPERTY(double camOffsetX READ camOffsetX NOTIFY poseChanged)
    Q_PROPERTY(double camOffsetY READ camOffsetY NOTIFY poseChanged)
    Q_PROPERTY(bool zoomed READ zoomed NOTIFY poseChanged)
    Q_PROPERTY(bool cursorAvailable READ cursorAvailable NOTIFY cursorImageChanged)
    Q_PROPERTY(int cursorImageRevision READ cursorImageRevision NOTIFY cursorImageChanged)
    Q_PROPERTY(double cursorPointWidth READ cursorPointWidth NOTIFY cursorImageChanged)
    Q_PROPERTY(double cursorPointHeight READ cursorPointHeight NOTIFY cursorImageChanged)
    Q_PROPERTY(double cursorHotspotX READ cursorHotspotX NOTIFY cursorImageChanged)
    Q_PROPERTY(double cursorHotspotY READ cursorHotspotY NOTIFY cursorImageChanged)

public:
    explicit AnimationDriver(QObject *parent = nullptr);

    bool active() const { return active_; }
    double contentWidth() const { return contentWidth_; }
    double contentHeight() const { return contentHeight_; }
    // Falls back to the point size: before a capture starts there is no pixel size, and
    // a 1x fallback is the honest guess rather than an arbitrary scale factor.
    double sourcePixelWidth() const {
        return sourcePixelWidth_ > 0.0 ? sourcePixelWidth_ : contentWidth_;
    }
    double sourcePixelHeight() const {
        return sourcePixelHeight_ > 0.0 ? sourcePixelHeight_ : contentHeight_;
    }
    // Never zero: the preview divides by it.
    double sourcePixelScale() const {
        const double scale = contentWidth_ > 0.0 ? sourcePixelWidth() / contentWidth_ : 1.0;
        return scale > 0.01 ? scale : 1.0;
    }
    double cursorX() const { return cursorX_; }
    double cursorY() const { return cursorY_; }
    double cursorXPoints() const;
    double cursorYPoints() const;
    double cursorRotation() const { return cursorRotation_; }
    double cursorScale() const { return cursorScale_; }
    double cursorAlpha() const { return cursorAlpha_; }
    double camScale() const { return camScale_; }
    double camOffsetX() const { return camOffsetX_; }
    double camOffsetY() const { return camOffsetY_; }
    bool zoomed() const { return zoomTarget_ > 1.0; }
    bool cursorAvailable() const { return cursorAvailable_; }
    int cursorImageRevision() const { return cursorImageRevision_; }
    double cursorPointWidth() const { return cursorPointWidth_; }
    double cursorPointHeight() const { return cursorPointHeight_; }
    double cursorHotspotX() const { return cursorHotspotX_; }
    double cursorHotspotY() const { return cursorHotspotY_; }
    QImage cursorImage() const { return cursorImage_; }

    Q_INVOKABLE void start();
    Q_INVOKABLE void stop();
    Q_INVOKABLE void setSettings(const QVariantMap &settings);
    Q_INVOKABLE void setManualZoom(bool zoomed);
    Q_INVOKABLE void toggleManualZoom();
    // Tells the driver what is actually being captured. Without this the pointer is
    // mapped through the primary display's size whatever the source is, so a window
    // or region capture — or a second display — puts the smooth pointer in the wrong
    // place. `boundsPoints` is the recorded rect in global points and `pixelSize`
    // the frame size, i.e. exactly the pair the pointer recorder uses.
    Q_INVOKABLE void setSourceGeometry(double x, double y, double widthPoints,
        double heightPoints, double widthPixels, double heightPixels);

signals:
    void activeChanged();
    void contentSizeChanged();
    void poseChanged();
    void cursorImageChanged();

private:
    void tick();
    void applySettings();

    bool active_ = false;
    QTimer *timer_ = nullptr;
    QElapsedTimer clock_;
    double nowMs_ = 0.0;
    double lastTickMs_ = 0.0;

    double contentWidth_ = 1920.0;
    double contentHeight_ = 1080.0;
    // The captured rect in global points and the frame size in pixels: the same pair
    // the pointer recorder uses, so the two cannot disagree about where the pointer
    // is inside the frame.
    double sourceBoundsX_ = 0.0;
    double sourceBoundsY_ = 0.0;
    double sourceBoundsWidth_ = 0.0;
    double sourceBoundsHeight_ = 0.0;
    double sourcePixelWidth_ = 0.0;
    double sourcePixelHeight_ = 0.0;
    // Height of the primary display in points. The pointer arrives in AppKit
    // coordinates (origin bottom-left, y up) while a source rect is expressed in
    // Quartz coordinates (origin top-left of the primary display, y down), so the
    // flip needs this one number — and it must be the *primary* display's height
    // even when the source is on a second screen, because that is where AppKit
    // anchors its origin.
    double primaryHeightPoints_ = 0.0;

    Animation::EventTrack track_;
    Animation::CursorEngine cursor_;
    Animation::CursorSettings cursorSettings_;
    Animation::SpringConfig screenSpring_{200.0, 40.0, 2.25, false, 0.002};
    Animation::Spring camScaleSpring_{Animation::SpringConfig{200.0, 40.0, 2.25, false, 0.002}};
    Animation::Spring camXSpring_{Animation::SpringConfig{200.0, 40.0, 2.25, false, 0.002}};
    Animation::Spring camYSpring_{Animation::SpringConfig{200.0, 40.0, 2.25, false, 0.002}};
    Animation::Spring pressSpring_{Animation::SpringConfig{300.0, 30.0, 0.3, false, 0.002}};

    bool smoothingEnabled_ = true;
    bool autoZoomEnabled_ = true;
    double zoomLevel_ = 2.0;
    QString focusMode_ = QStringLiteral("auto");
    bool keepZoomed_ = false;
    double idleMs_ = 3000.0;
    Animation::LiveFocus liveFocus_;
    Render::SourceCrop crop_;
    double snapToEdgesRatio_ = 0.25;

    bool pressed_ = false;
    double lastX_ = -1.0;
    double lastY_ = -1.0;
    double zoomTarget_ = 1.0;
    Animation::FocusPoint zoomFocus_{0.5, 0.5};

    double cursorX_ = 0.0;
    double cursorY_ = 0.0;
    double cursorRotation_ = 0.0;
    double cursorScale_ = 1.0;
    double cursorAlpha_ = 1.0;
    double camScale_ = 1.0;
    double camOffsetX_ = 0.0;
    double camOffsetY_ = 0.0;

    QImage cursorImage_;
    bool cursorAvailable_ = false;
    int cursorImageRevision_ = 0;
    unsigned long long cursorIdentity_ = 0;
    double cursorPointWidth_ = 0.0;
    double cursorPointHeight_ = 0.0;
    double cursorHotspotX_ = 0.0;
    double cursorHotspotY_ = 0.0;
};

// Serves the current system cursor image to QML as image://cursor/current.
class CursorImageProvider final : public QQuickImageProvider {
public:
    explicit CursorImageProvider(AnimationDriver *driver);
    QImage requestImage(const QString &id, QSize *size, const QSize &requestedSize) override;

private:
    AnimationDriver *driver_;
};
