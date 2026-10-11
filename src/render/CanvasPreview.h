#pragma once

#include "CanvasRenderer.h"

#include <QObject>
#include <QRectF>
#include <QVariantMap>
#include <QQuickImageProvider>

namespace Render {

// Exposes the shared canvas layout to QML.
//
// The preview used to compute its own padding in QML, from a different rule than
// the screenshot and the compositor used, so the same setting produced three
// different pictures. QML cannot call into the C++ layout directly — the values are
// needed as bindable properties — so this holds the computed plan and re-derives it
// when the settings change.
//
// It reports rectangle *fractions* of the stage, not pixels: the preview draws at
// whatever size the window happens to be, while the layout is defined in output
// pixels. Keeping the ratio is exactly what makes the preview show the same
// composition as the export.
class CanvasPreview final : public QObject {
    Q_OBJECT
    Q_PROPERTY(bool valid READ valid NOTIFY changed)
    // Stage fractions, all relative to the canvas (the output frame), 0..1.
    Q_PROPERTY(QRectF frameRect READ frameRect NOTIFY changed)
    Q_PROPERTY(QRectF contentRect READ contentRect NOTIFY changed)
    Q_PROPERTY(double radiusRatio READ radiusRatio NOTIFY changed)
    Q_PROPERTY(double insetRatio READ insetRatio NOTIFY changed)
    // Canvas aspect ratio (width / height) for the requested output ratio. This is the
    // property the preview sizes its stage with, so it has to be right even before a
    // capture source exists: it falls back to the source's own ratio and only then to
    // 16:9. A stub returning 1.0 drew the preview as a square and made every aspect
    // ratio setting look broken.
    Q_PROPERTY(double planAspect READ planAspect NOTIFY changed)
    // The canvas the layout was computed in. Exposed for tests and for the preview to
    // reason about absolute sizes (radius, inset) that do not scale with the stage.
    Q_PROPERTY(double planWidth READ planWidth NOTIFY changed)
    Q_PROPERTY(double planHeight READ planHeight NOTIFY changed)
    // Style, passed through for the QML that draws the background itself.
    Q_PROPERTY(QString backgroundType READ backgroundType NOTIFY changed)
    Q_PROPERTY(QColor backgroundColor READ backgroundColor NOTIFY changed)
    Q_PROPERTY(QColor gradientStart READ gradientStart NOTIFY changed)
    Q_PROPERTY(QColor gradientEnd READ gradientEnd NOTIFY changed)
    Q_PROPERTY(double gradientAngle READ gradientAngle NOTIFY changed)
    Q_PROPERTY(QColor insetColor READ insetColor NOTIFY changed)
    Q_PROPERTY(double insetAlpha READ insetAlpha NOTIFY changed)
    Q_PROPERTY(bool hasShadow READ hasShadow NOTIFY changed)
    Q_PROPERTY(QString backgroundSource READ backgroundSource NOTIFY changed)
    Q_PROPERTY(QString shadowSource READ shadowSource NOTIFY changed)
    Q_PROPERTY(QRectF shadowRect READ shadowRect NOTIFY changed)
    // Background blur as MultiEffect's 0..1 expects it. The reference's 0..40
    // slider maps onto a radius; the exact curve is not verified, so the same
    // proportional mapping the compositor uses is applied here, which at least
    // keeps preview and export equal.
    Q_PROPERTY(double backgroundBlur READ backgroundBlur NOTIFY changed)

public:
    explicit CanvasPreview(QObject *parent = nullptr, const QString &imageProvider = "canvas");

    bool valid() const { return plan_.valid; }
    QRectF frameRect() const { return fraction(plan_.layout.frameRect); }
    QRectF contentRect() const { return fraction(plan_.layout.contentRect); }
    double radiusRatio() const;
    double insetRatio() const;
    double planAspect() const;
    double planWidth() const { return plan_.valid ? plan_.width() : 0.0; }
    double planHeight() const { return plan_.valid ? plan_.height() : 0.0; }
    QString backgroundType() const { return style_.backgroundType; }
    QColor backgroundColor() const { return style_.backgroundColor; }
    QColor gradientStart() const { return style_.gradientStart; }
    QColor gradientEnd() const { return style_.gradientEnd; }
    double gradientAngle() const { return style_.gradientAngle; }
    QColor insetColor() const { return style_.insetColor; }
    double insetAlpha() const { return style_.insetAlpha; }
    bool hasShadow() const { return style_.shadowIntensity > 0.001; }
    QString backgroundSource() const { return "image://" + imageProvider_ + "/background?" + QString::number(revision_); }
    QString shadowSource() const { return plan_.shadow.isNull() ? QString()
        : "image://" + imageProvider_ + "/shadow?" + QString::number(revision_); }
    QRectF shadowRect() const;
    QImage image(const QString &id) const { return id.startsWith("shadow") ? plan_.shadow : plan_.background; }
    double backgroundBlur() const;

    // Settings map plus the captured source size. Both come from QML: the settings
    // are the live current values, the source size from the driver (or the chosen
    // display before capture starts).
    // `sourceWidth`/`sourceHeight` are the captured rect in *points*; `pixelWidth`/
    // `pixelHeight` are the same frame in pixels. Both are needed and they are not
    // interchangeable: the layout is computed in pixels because the appearance
    // settings are authored in output pixels (an 8 px corner radius is 8 px of the
    // exported file), while the pointer overlay is positioned in points. Planning the
    // preview from points made every absolute value twice its real size on a Retina
    // display — the corner radius in the preview was exactly 2x the exported one.
    Q_INVOKABLE void update(const QVariantMap &settings, double sourceWidth, double sourceHeight,
        double pixelWidth = 0.0, double pixelHeight = 0.0);
    Q_INVOKABLE void updateForOutput(const QVariantMap &settings, double sourceWidth, double sourceHeight,
        double pixelWidth, double pixelHeight, double outputWidth, double outputHeight);
    Q_INVOKABLE QString backgroundUrl(const QString &name) const;

signals:
    void changed();

private:
    QRectF fraction(const QRectF &rect) const;
    // Keeps the last source size so a settings-only update can re-plan. The plan is
    // always built from the pixel size; the point size is the fallback for callers
    // that only know one of the two.
    double sourceWidth_ = 1920.0;
    double sourceHeight_ = 1080.0;
    double pixelWidth_ = 1920.0;
    double pixelHeight_ = 1080.0;
    QString backgroundRoot_;
    CanvasStyle style_;
    CanvasPlan plan_;
    int revision_ = 0;
    QString imageProvider_;
    QSizeF outputSize_;
};

class CanvasImageProvider final : public QQuickImageProvider {
public:
    explicit CanvasImageProvider(CanvasPreview *preview) : QQuickImageProvider(QQuickImageProvider::Image), preview_(preview) {}
    QImage requestImage(const QString &id, QSize *size, const QSize &) override {
        const QImage image = preview_->image(id);
        if (size) *size = image.size();
        return image;
    }
private:
    CanvasPreview *preview_;
};

} // namespace Render
