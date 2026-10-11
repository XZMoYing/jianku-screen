#pragma once

#include "CanvasLayout.h"

#include <QColor>
#include <QImage>
#include <QSizeF>
#include <QString>
#include <QVariantMap>

class QPainter;

namespace Render {

// The static half of the canvas: background, padding, rounded frame, inset and
// shadow, plus the settings → style mapping behind them.
//
// This used to exist three times over — the preview in QML, the quick screenshot
// in QPainter and the offline compositor in QPainter — and the three disagreed:
// the screenshot knew only about a flat colour, so a gradient or built-in
// background silently produced a screenshot that looked nothing like the preview,
// and the preview derived its padding from the canvas while the screenshot derived
// it from the source. Anything that draws a canvas goes through here now, so a
// settings change cannot land in one output and miss another.
//
// Nothing here knows about the pointer, the camera or the source image's contents:
// those are per-frame and belong to the caller.

// Style resolved from a project's or the app's settings map. Field names match the
// settings keys so the mapping stays a direct read.
struct CanvasStyle {
    QString backgroundType = QStringLiteral("gradient");
    QColor backgroundColor;
    QColor gradientStart;
    QColor gradientEnd;
    double gradientAngle = 135.0;
    QString backgroundImagePath;      // already resolved to a real file
    double backgroundBlur = 0.0;

    double paddingPercent = 0.0;
    double radius = 0.0;
    double insetSize = 0.0;
    QColor insetColor;
    double insetAlpha = 0.5;

    double shadowIntensity = 0.0;
    double shadowAngle = 90.0;
    double shadowDistance = 0.0;
    double shadowBlur = 0.0;
    int shadowQuality = 0; // 0 derives the pass count from the unscaled blur.
};

// Reads a settings map into a style. `backgroundRoot` is searched for a built-in
// background name; pass an empty string when the caller resolves the path itself.
CanvasStyle canvasStyleFromMap(const QVariantMap &settings, const QString &backgroundRoot = {});
QString bundledBackgroundRoot();

// Everything a canvas needs, computed once.
struct CanvasPlan {
    bool valid = false;
    QString error;
    QSizeF canvasSize;
    CanvasLayout layout;
    QImage background;     // canvas size, background already blurred
    QImage shadow;         // sprite; null when there is no shadow
    CanvasStyle style;

    int width() const { return static_cast<int>(canvasSize.width()); }
    int height() const { return static_cast<int>(canvasSize.height()); }
    // Double-precision ratio, deliberately not `width() / height()`: those return int,
    // and a 1680x944 canvas divided that way is 1, which is how the preview came to
    // draw itself as a square whatever aspect ratio was selected.
    double aspect() const {
        return canvasSize.height() > 0.0 ? canvasSize.width() / canvasSize.height() : 0.0;
    }
};

// `canvasSize` empty means "grow the canvas from the content" (quick screenshot);
// otherwise the canvas is fixed and the content is contained inside it (preview,
// export).
CanvasPlan planCanvas(const CanvasStyle &style, const QSizeF &canvasSize, const QSizeF &contentSize);

// Draws the background and the shadow into `painter`, in canvas coordinates. The
// caller draws the content and the per-frame layers on top.
void drawCanvasBackdrop(QPainter &painter, const CanvasPlan &plan);

// Draws the rounded frame fill and clips to it, leaving the painter positioned in
// frame-local coordinates so the caller can draw the source with `layout.contentRect`
// shifted by `-frameRect.topLeft()`.
void beginFrame(QPainter &painter, const CanvasPlan &plan, const QColor &frameColor);
void endFrame(QPainter &painter, const CanvasPlan &plan);

// The inset border, drawn on the frame edge inside the rounded corners.
void drawInsetBorder(QPainter &painter, const CanvasPlan &plan);

// The fill behind the source while it loads or where it does not cover the frame.
// The preview uses the same value so a transparent capture reads the same way.
inline constexpr const char *kFrameColor = "#101013";

QImage buildBackground(const CanvasStyle &style, const QSize &size);
QImage buildShadowSprite(const QSizeF &frameSize, const CanvasStyle &style);

// Separable box blur, repeated to approximate a Gaussian. Public because the
// compositor's background blur and shadow both need it and the screenshot path
// must produce the same result.
void boxBlur(QImage &image, int radius, int passes);

} // namespace Render
