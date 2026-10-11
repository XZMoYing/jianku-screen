#pragma once
#include "ProjectCompositor.h"
#include "TimelineController.h"
#include <QElapsedTimer>
#include <QPointer>
#include <QQuickItem>
#include <QThreadPool>
#include <QTimer>
#include <memory>

namespace Render {
// Native playback is a macOS adapter; composition and the edit clock stay in
// the shared renderer. Every editor tab owns one view, never a live capture.
class RecordingPlayer : public QQuickItem {
    Q_OBJECT
    Q_PROPERTY(QObject *controller READ controller WRITE setController NOTIFY changed)
    Q_PROPERTY(QVariantMap options READ options WRITE setOptions NOTIFY changed)
    Q_PROPERTY(bool focusPreview READ focusPreview WRITE setFocusPreview NOTIFY changed)
    Q_PROPERTY(QPointF focusMarker READ focusMarker NOTIFY frameChanged)
    Q_PROPERTY(bool cropEditing READ cropEditing WRITE setCropEditing NOTIFY changed)
    Q_PROPERTY(QRectF sourceDisplayRect READ sourceDisplayRect NOTIFY frameChanged)
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
    QVariantMap displayedOptions() const { return displayedOptions_; }
    QSize frameSize() const { return frame_.size(); }
    double frameTimeMs() const { return frameTimeMs_; }
    // Developer measurements do not alter preview resolution or filter settings.
    QVariantMap playbackMetrics() const;
    void resetPlaybackMetrics();
    bool focusPreview() const { return focusPreview_; }
    void setFocusPreview(bool enabled);
    QPointF focusMarker() const;
    bool cropEditing() const { return cropEditing_; }
    void setCropEditing(bool value);
    QRectF sourceDisplayRect() const;
    Q_INVOKABLE QVariantMap sourcePointAt(double x, double y) const;
    Q_INVOKABLE void play();
    Q_INVOKABLE void pause();
    Q_INVOKABLE void toggle();
signals:
    void changed();
    void frameChanged();
protected:
    QSGNode *updatePaintNode(QSGNode *oldNode, UpdatePaintNodeData *) override;
private:
    struct Native;
    struct DecodedSource;
    struct FrameRequest;
    struct Prepared {
        ComposeContext context;
        std::shared_ptr<std::vector<Snapshot>> poses = std::make_shared<std::vector<Snapshot>>();
    };
    std::unique_ptr<Native> native_;
    std::shared_ptr<Prepared> prepared_;
    QPointer<TimelineController> controller_;
    QVariantMap options_;
    QVariantMap displayedOptions_;
    QImage frame_;
    QImage sourceFrame_;
    QTimer poll_;
    QTimer prepareTimer_;
    QThreadPool composePool_;
    std::shared_ptr<FrameRequest> pendingFrame_;
    bool composing_ = false;
    int renderRevision_ = 0;
    int lastRequestedPose_ = -1;
    QElapsedTimer playClock_;
    double playStartMs_ = 0;
    double frameTimeMs_ = -1;
    CameraPose displayedCamera_;
    bool focusPreview_ = false;
    bool cropEditing_ = false;
    bool playing_ = false;
    bool loading_ = false;
    bool updatingPlayhead_ = false;
    bool seeking_ = false;
    int generation_ = 0;
    int seekRevision_ = 0;
    QString error_;
    QString directory_;
    int measuredFrames_ = 0;
    double scaleTotalMs_ = 0, composeTotalMs_ = 0, composeMaxMs_ = 0;
    int measuredSeeks_ = 0, measuredTicks_ = 0;
    int measuredPreparations_ = 0;
    QVariantList clockSamples_;
    int decodedFrames_ = 0, coalescedFrames_ = 0, discardedFrames_ = 0;
    bool measuring_ = false;
    void prepare();
    void seek();
    void tick();
    void compose(double sourceMs);
    void startComposition();
    void invalidateFrames();
    void startNativePlayback();
    int segmentAt(double outputMs) const;
};
} // namespace Render
