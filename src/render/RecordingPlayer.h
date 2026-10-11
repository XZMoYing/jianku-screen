#pragma once
#include "ProjectCompositor.h"
#include "TimelineController.h"
#include <QElapsedTimer>
#include <QPointer>
#include <QQuickPaintedItem>
#include <QTimer>
#include <memory>

namespace Render {
// Native playback is a macOS adapter; composition and the edit clock stay in
// the shared renderer. Every editor tab owns one view, never a live capture.
class RecordingPlayer : public QQuickPaintedItem {
    Q_OBJECT
    Q_PROPERTY(QObject *controller READ controller WRITE setController NOTIFY changed)
    Q_PROPERTY(QVariantMap options READ options WRITE setOptions NOTIFY changed)
    Q_PROPERTY(bool focusPreview READ focusPreview WRITE setFocusPreview NOTIFY changed)
    Q_PROPERTY(QPointF focusMarker READ focusMarker NOTIFY changed)
    Q_PROPERTY(bool playing READ playing NOTIFY changed)
    Q_PROPERTY(bool hasFrame READ hasFrame NOTIFY changed)
    Q_PROPERTY(bool loading READ loading NOTIFY changed)
    Q_PROPERTY(QString error READ error NOTIFY changed)
public:
    explicit RecordingPlayer(QQuickItem *parent = nullptr);
    ~RecordingPlayer() override;
    QObject *controller() const { return controller_; }
    void setController(QObject *value);
    QVariantMap options() const { return options_; }
    void setOptions(const QVariantMap &options);
    bool playing() const { return playing_; }
    bool hasFrame() const { return !frame_.isNull(); }
    bool loading() const { return loading_; }
    QString error() const { return error_; }
    QImage renderedFrame() const { return frame_; }
    QSize frameSize() const { return frame_.size(); }
    double frameTimeMs() const { return frameTimeMs_; }
    bool focusPreview() const { return focusPreview_; }
    void setFocusPreview(bool enabled);
    QPointF focusMarker() const;
    Q_INVOKABLE QVariantMap sourcePointAt(double x, double y) const;
    Q_INVOKABLE void play();
    Q_INVOKABLE void pause();
    Q_INVOKABLE void toggle();
    void paint(QPainter *painter) override;
signals:
    void changed();
private:
    struct Native;
    struct Prepared {
        ComposeContext context;
        std::vector<Snapshot> poses;
    };
    std::unique_ptr<Native> native_;
    std::shared_ptr<Prepared> prepared_;
    QPointer<TimelineController> controller_;
    QVariantMap options_;
    QImage frame_;
    QImage sourceFrame_;
    QTimer poll_;
    QTimer prepareTimer_;
    QElapsedTimer playClock_;
    double playStartMs_ = 0;
    double frameTimeMs_ = -1;
    CameraPose displayedCamera_;
    bool focusPreview_ = false;
    bool playing_ = false;
    bool loading_ = false;
    bool updatingPlayhead_ = false;
    bool seeking_ = false;
    int generation_ = 0;
    int seekRevision_ = 0;
    QString error_;
    QString directory_;
    void prepare();
    void seek();
    void tick();
    void compose(double sourceMs);
};
} // namespace Render
