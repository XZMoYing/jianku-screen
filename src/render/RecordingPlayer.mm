#include "RecordingPlayer.h"
#include "../animation/AnimationSettings.h"
#import <AVFoundation/AVFoundation.h>
#include <QCoreApplication>
#include <QMetaObject>
#include <QPainter>
#include <QThreadPool>
#include <QUrl>
#include <algorithm>
#include <cmath>

namespace Render {
struct RecordingPlayer::Native {
    AVPlayer *player = nil;
    AVPlayer *microphone = nil;
    AVPlayerItemVideoOutput *output = nil;
};

RecordingPlayer::RecordingPlayer(QQuickItem *parent)
    : QQuickPaintedItem(parent), native_(std::make_unique<Native>()) {
    setAntialiasing(true);
    poll_.setInterval(33);
    connect(&poll_, &QTimer::timeout, this, &RecordingPlayer::tick);
    prepareTimer_.setInterval(120);
    prepareTimer_.setSingleShot(true);
    connect(&prepareTimer_, &QTimer::timeout, this, &RecordingPlayer::prepare);
    connect(this, &QQuickItem::visibleChanged, this, [this] { if (!isVisible()) pause(); });
}
RecordingPlayer::~RecordingPlayer() { [native_->player pause]; [native_->microphone pause]; }

void RecordingPlayer::setController(QObject *value) {
    auto *next = qobject_cast<TimelineController *>(value);
    if (next == controller_) return;
    pause();
    if (controller_) disconnect(controller_, nullptr, this, nullptr);
    ++generation_;
    frame_ = {}; sourceFrame_ = {}; frameTimeMs_ = -1;
    controller_ = next;
    if (next) {
        connect(next, &TimelineController::playheadChanged, this, [this] {
            if (!updatingPlayhead_) { pause(); seek(); }
        });
        connect(next, &TimelineController::timelineChanged, this, [this] { pause(); seek(); });
        connect(next, &TimelineController::focusChanged, this, [this] { if (!sourceFrame_.isNull()) compose(frameTimeMs_); prepareTimer_.start(); });
        connect(next, &TimelineController::selectionChanged, this, [this] { if (!sourceFrame_.isNull()) compose(frameTimeMs_); emit changed(); });
        prepareTimer_.start();
    }
    emit changed();
}
void RecordingPlayer::setOptions(const QVariantMap &options) {
    if (options_ == options) return;
    options_ = options;
    prepareTimer_.start();
}

void RecordingPlayer::prepare() {
    if (!controller_ || !controller_->loaded()) return;
    pause();
    const QString directory = controller_->projectDirectory();
    const QVariantMap options = options_;
    const auto focus = controller_->focusRanges();
    const int generation = ++generation_;
    loading_ = true; error_.clear(); emit changed();
    QPointer<RecordingPlayer> self(this);
    const QString background = bundledBackgroundRoot();
    QThreadPool::globalInstance()->start([self, directory, options, focus, generation, background] {
        auto ready = std::make_shared<Prepared>();
        auto project = loadProject(directory);
        if (project.valid) {
            if (!options.isEmpty()) project.settings = options;
            project.zoomRanges = focus;
            // Decode at preview size; use the shared compositor for appearance.
            ready->context = makeComposeContext(project, background, {}, 540);
            const auto settings = Animation::driverSettingsFromMap(project.settings);
            AnimationSequence sequence(ready->context.project, settings.screenSpring, settings.cursor);
            const int count = int(std::ceil(project.durationMs * 60 / 1000)) + 1;
            ready->poses.reserve(count);
            for (int i = 0; i < count; ++i) {
                const double time = i * 1000.0 / 60;
                ready->poses.push_back({sequence.cameraAt(time), sequence.cursorAt(time)});
            }
        } else ready->context.error = project.error;
        QMetaObject::invokeMethod(qApp, [self, ready, directory, generation] {
            if (!self || generation != self->generation_) return;
            self->loading_ = false;
            self->prepared_ = ready;
            if (!ready->context.valid) {
                self->error_ = ready->context.error;
                emit self->changed(); return;
            }
            if (self->directory_ != directory) {
                self->directory_ = directory;
                self->frame_ = {}; self->sourceFrame_ = {}; self->frameTimeMs_ = -1;
                [self->native_->microphone pause]; self->native_->microphone = nil;
                const auto &project = ready->context.project;
                NSURL *url = [NSURL fileURLWithPath:(directory + "/" + project.videoFile).toNSString()];
                AVPlayerItem *item = [AVPlayerItem playerItemWithURL:url];
                self->native_->output = [[AVPlayerItemVideoOutput alloc] initWithPixelBufferAttributes:
                    @{(NSString *)kCVPixelBufferPixelFormatTypeKey: @(kCVPixelFormatType_32BGRA)}];
                [item addOutput:self->native_->output];
                self->native_->player = [AVPlayer playerWithPlayerItem:item];
                self->native_->player.actionAtItemEnd = AVPlayerActionAtItemEndPause;
                if (project.microphone.present) self->native_->microphone = [AVPlayer playerWithURL:
                    [NSURL fileURLWithPath:(directory + "/" + project.microphone.file).toNSString()]];
            }
            self->native_->player.volume = self->options_.value("muteSystemAudio", false).toBool()
                ? 0 : float(self->options_.value("systemAudioVolume", 1).toDouble());
            self->native_->microphone.volume = self->options_.value("muteMicrophone", false).toBool()
                ? 0 : float(self->options_.value("audioVolume", 1).toDouble());
            // A paused AVPlayer does not promise a new pixel buffer when seeking
            // to the same instant. Recompose its cached source on a style edit.
            if (!self->sourceFrame_.isNull()) self->compose(self->frameTimeMs_);
            self->seek();
            self->poll_.start();
            emit self->changed();
        }, Qt::QueuedConnection);
    });
}

void RecordingPlayer::seek() {
    if (!controller_ || !prepared_ || !prepared_->context.valid) return;
    const double time = controller_->timeline().sourceTimeAt(controller_->playheadMs());
    const CMTime target = CMTimeMakeWithSeconds(time / 1000, 60000);
    seeking_ = true;
    const int revision = ++seekRevision_;
    QPointer<RecordingPlayer> self(this);
    [native_->player seekToTime:target toleranceBefore:kCMTimeZero toleranceAfter:kCMTimeZero
        completionHandler:^(BOOL) {
            QMetaObject::invokeMethod(qApp, [self, revision] {
                if (self && revision == self->seekRevision_) { self->seeking_ = false; self->tick(); }
            }, Qt::QueuedConnection);
        }];
    const double mic = std::max(0.0, time - prepared_->context.project.microphoneDelayMs());
    [native_->microphone seekToTime:CMTimeMakeWithSeconds(mic / 1000, 60000)];
}
void RecordingPlayer::play() {
    if (!controller_ || !hasFrame() || loading_) return;
    if (controller_->playheadMs() >= controller_->outputDurationMs() - 20) controller_->setPlayheadMs(0);
    playStartMs_ = controller_->playheadMs();
    playClock_.restart(); playing_ = true;
    native_->player.rate = float(controller_->timeline().rateAt(playStartMs_));
    native_->microphone.rate = native_->player.rate;
    emit changed();
}
void RecordingPlayer::pause() {
    [native_->player pause]; [native_->microphone pause];
    if (!playing_) return;
    playing_ = false; emit changed();
}
void RecordingPlayer::toggle() { if (playing_) pause(); else play(); }

void RecordingPlayer::tick() {
    if (!controller_ || !prepared_ || !prepared_->context.valid) return;
    if (native_->player.currentItem.status == AVPlayerItemStatusFailed) {
        error_ = QString::fromNSString(native_->player.currentItem.error.localizedDescription);
        pause(); poll_.stop(); emit changed(); return;
    }
    if (seeking_) return;
    if (playing_) {
        const double output = std::min(controller_->outputDurationMs(), playStartMs_ + playClock_.elapsed());
        updatingPlayhead_ = true; controller_->setPlayheadMs(output); updatingPlayhead_ = false;
        const double desired = controller_->timeline().sourceTimeAt(output);
        const double actual = CMTimeGetSeconds(native_->player.currentTime) * 1000;
        if (std::isfinite(actual) && std::abs(actual - desired) > 120) seek();
        native_->player.rate = float(controller_->timeline().rateAt(output));
        native_->microphone.rate = native_->player.rate;
        if (output >= controller_->outputDurationMs()) pause();
    }
    const CMTime time = native_->player.currentTime;
    if (![native_->output hasNewPixelBufferForItemTime:time]) return;
    CVPixelBufferRef buffer = [native_->output copyPixelBufferForItemTime:time itemTimeForDisplay:nil];
    if (!buffer) return;
    CVPixelBufferLockBaseAddress(buffer, kCVPixelBufferLock_ReadOnly);
    QImage view(static_cast<const uchar *>(CVPixelBufferGetBaseAddress(buffer)),
        int(CVPixelBufferGetWidth(buffer)), int(CVPixelBufferGetHeight(buffer)),
        int(CVPixelBufferGetBytesPerRow(buffer)), QImage::Format_ARGB32_Premultiplied);
    sourceFrame_ = view.scaled(960, 540, Qt::KeepAspectRatio, Qt::SmoothTransformation);
    CVPixelBufferUnlockBaseAddress(buffer, kCVPixelBufferLock_ReadOnly);
    CVPixelBufferRelease(buffer);
    const double sourceMs = CMTimeGetSeconds(time) * 1000;
    compose(std::isfinite(sourceMs) ? sourceMs : 0);
}
void RecordingPlayer::compose(double sourceMs) {
    if (sourceFrame_.isNull() || !prepared_ || prepared_->poses.empty()) return;
    const int index = std::clamp(int(std::round(sourceMs * 60 / 1000)), 0, int(prepared_->poses.size()) - 1);
    const auto &pose = prepared_->poses[index];
    const auto &previous = prepared_->poses[std::max(0, index - 1)];
    const BlurPlan blur = planBlur(prepared_->context, previous.camera, previous.cursor,
        pose.camera, pose.cursor, sourceMs, true);
    CameraPose camera = pose.camera;
    const auto selected = controller_ ? controller_->selectedFocus() : QVariantMap{};
    const bool targetPreview = focusPreview_ && !playing_ && !selected.isEmpty();
    if (targetPreview) {
        Project::FocusClip focus;
        focus.startMs = selected.value("startMs").toDouble(); focus.endMs = selected.value("endMs").toDouble();
        focus.zoom = selected.value("zoom").toDouble(); focus.fixedPosition = selected.value("fixedPosition").toBool();
        focus.focusX = selected.value("focusX").toDouble(); focus.focusY = selected.value("focusY").toDouble();
        focus.snapToEdgesRatio = selected.value("snapToEdgesRatio").toDouble();
        camera = AnimationSequence::cameraTargetFor(prepared_->context.project, focus, sourceMs);
    }
    displayedCamera_ = camera;
    frame_ = composeFrame(prepared_->context, sourceFrame_, camera, pose.cursor, sourceMs, true,
        targetPreview || blur.empty() ? nullptr : &blur);
    frameTimeMs_ = sourceMs;
    update(); emit changed();
}
void RecordingPlayer::setFocusPreview(bool enabled) {
    if (focusPreview_ == enabled) return;
    focusPreview_ = enabled; if (!sourceFrame_.isNull()) compose(frameTimeMs_); emit changed();
}
QVariantMap RecordingPlayer::sourcePointAt(double x, double y) const {
    if (!prepared_ || frame_.isNull() || width() <= 0 || height() <= 0) return {{"valid", false}};
    const QSizeF size = QSizeF(frame_.size()).scaled(boundingRect().size(), Qt::KeepAspectRatio);
    if (size.isEmpty()) return {{"valid", false}};
    const QPointF origin((width() - size.width()) / 2, (height() - size.height()) / 2);
    const QPointF canvas = (QPointF(x, y) - origin) * (frame_.width() / size.width());
    const auto &layout = prepared_->context.layout();
    const QPointF local = (canvas - layout.frameRect.topLeft()
        - QPointF(displayedCamera_.offsetX, displayedCamera_.offsetY) * layout.fitScale) / displayedCamera_.scale
        - (layout.contentRect.topLeft() - layout.frameRect.topLeft());
    const double nx = local.x() / layout.contentRect.width(), ny = local.y() / layout.contentRect.height();
    return {{"valid", nx >= 0 && nx <= 1 && ny >= 0 && ny <= 1}, {"x", nx}, {"y", ny}};
}
QPointF RecordingPlayer::focusMarker() const {
    const auto selected = controller_ ? controller_->selectedFocus() : QVariantMap{};
    if (!prepared_ || frame_.isNull() || selected.isEmpty() || !selected.value("fixedPosition").toBool()) return {-100, -100};
    const auto &layout = prepared_->context.layout();
    const auto focus = QPointF(selected.value("focusX").toDouble() * layout.contentRect.width(), selected.value("focusY").toDouble() * layout.contentRect.height());
    const auto canvas = layout.frameRect.topLeft() + QPointF(displayedCamera_.offsetX, displayedCamera_.offsetY) * layout.fitScale
        + displayedCamera_.scale * (layout.contentRect.topLeft() - layout.frameRect.topLeft() + focus);
    const QSizeF size = QSizeF(frame_.size()).scaled(boundingRect().size(), Qt::KeepAspectRatio);
    return QPointF((width() - size.width()) / 2, (height() - size.height()) / 2) + canvas * (size.width() / frame_.width());
}
void RecordingPlayer::paint(QPainter *painter) {
    if (frame_.isNull()) return;
    const QSizeF size = QSizeF(frame_.size()).scaled(boundingRect().size(), Qt::KeepAspectRatio);
    const QRectF rect((width() - size.width()) / 2, (height() - size.height()) / 2, size.width(), size.height());
    painter->setRenderHint(QPainter::SmoothPixmapTransform);
    painter->drawImage(rect, frame_);
}
} // namespace Render
