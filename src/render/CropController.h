#pragma once
#include "SourceCrop.h"
#include "../settings/SettingsStore.h"
#include <QObject>

namespace Render {
class CropController final : public QObject {
    Q_OBJECT
    Q_PROPERTY(bool active READ active NOTIFY changed)
    Q_PROPERTY(QVariantMap draft READ draft NOTIFY changed)
    Q_PROPERTY(QVariantMap draftPixels READ draftPixels NOTIFY changed)
    Q_PROPERTY(double sourceWidth READ sourceWidth NOTIFY changed)
    Q_PROPERTY(double sourceHeight READ sourceHeight NOTIFY changed)
    Q_PROPERTY(QString error READ error NOTIFY changed)
public:
    explicit CropController(SettingsStore *settings, QObject *parent = nullptr);
    void setSourceSize(const QSizeF &source);
    bool active() const { return active_; }
    QVariantMap draft() const { return draft_.map(); }
    QVariantMap draftPixels() const;
    double sourceWidth() const { return source_.width(); }
    double sourceHeight() const { return source_.height(); }
    QString error() const { return error_; }
    Q_INVOKABLE void begin();
    Q_INVOKABLE void cancel();
    Q_INVOKABLE bool apply();
    Q_INVOKABLE void resetDraft();
    Q_INVOKABLE bool setDraftPixels(const QVariantMap &pixels);
    Q_INVOKABLE void dragDraft(const QVariantMap &origin, int handle, double dx, double dy);
    Q_INVOKABLE void setAspectRatio(double ratio);
signals:
    void changed();
    void committing();
    void committed();
private:
    SettingsStore *settings_;
    QSizeF source_;
    SourceCrop draft_;
    bool active_ = false;
    QString error_;
    void setDraft(const SourceCrop &crop);
};
} // namespace Render
