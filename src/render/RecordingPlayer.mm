#include "RecordingPlayer.h"
#include "../animation/AnimationSettings.h"
#import <AVFoundation/AVFoundation.h>
#include <QCoreApplication>
#include <QMetaObject>
#include <QQuickWindow>
#include <QSGSimpleTextureNode>
#include <QSGTexture>
#include <QThreadPool>
#include <QUrl>
#include <algorithm>
#include <cmath>

namespace Render {
struct RecordingPlayer::DecodedSource {
    CVPixelBufferRef buffer = nullptr;
    QImage scaled; // Only the serial composition pool initializes this cache.
    std::uint64_t sequence = 0;
    double sourceMs = 0;
    ~DecodedSource() { if (buffer) CVPixelBufferRelease(buffer); }
};
struct RecordingPlayer::Native {
    AVPlayer *player = nil;
    AVPlayer *microphone = nil;
    AVPlayerItemVideoOutput *output = nil;
    std::shared_ptr<DecodedSource> source;
    std::uint64_t sequence = 0;
    int segment = -1;
};
struct RecordingPlayer::FrameRequest {
    std::shared_ptr<Prepared> prepared;
    std::shared_ptr<DecodedSource> source;
    CameraPose camera;
    CursorPose cursor;
    BlurPlan blur;
    bool applyBlur = true;
    QVariantMap options;
    double sourceMs = 0;
    int generation = 0, revision = 0;
};
namespace {
struct PreviewNode : QSGSimpleTextureNode { qint64 imageKey = 0; };
}

RecordingPlayer::RecordingPlayer(QQuickItem *parent)
    : QQuickItem(parent), native_(std::make_unique<Native>()) {
    setFlag(ItemHasContents, true);
    composePool_.setMaxThreadCount(1);
    poll_.setInterval(8); poll_.setTimerType(Qt::PreciseTimer);
    connect(&poll_, &QTimer::timeout, this, &RecordingPlayer::tick);
    prepareTimer_.setInterval(120); prepareTimer_.setSingleShot(true);
    connect(&prepareTimer_, &QTimer::timeout, this, &RecordingPlayer::prepare);
    connect(this, &QQuickItem::visibleChanged, this, [this] { if (!isVisible()) pause(); });
    connect(this, &QQuickItem::widthChanged, this, &RecordingPlayer::frameChanged);
    connect(this, &QQuickItem::heightChanged, this, &RecordingPlayer::frameChanged);
}
RecordingPlayer::~RecordingPlayer() {
    [native_->player pause]; [native_->microphone pause];
    pendingFrame_.reset(); composePool_.waitForDone();
}
void RecordingPlayer::invalidateFrames() {
    ++renderRevision_; pendingFrame_.reset(); lastRequestedPose_ = -1;
}
int RecordingPlayer::segmentAt(double outputMs) const {
    if (!controller_) return -1;
    double end = 0;
    const auto &segments = controller_->timeline().segments();
    for (int i = 0; i < int(segments.size()); ++i) {
        end += segments[i].outputLengthMs();
        if (outputMs < end || i + 1 == int(segments.size())) return i;
    }
    return -1;
}
void RecordingPlayer::startNativePlayback() {
    if (!playing_ || seeking_ || !controller_) return;
    // Local files need no network-style stall buffering. Start both native
    // clocks once, and let their media clock drive the edit clock.
    const float rate = float(controller_->timeline().rateAt(controller_->playheadMs()));
    [native_->player playImmediatelyAtRate:rate];
    [native_->microphone playImmediatelyAtRate:rate];
    playStartMs_ = controller_->playheadMs(); playClock_.restart();
    native_->segment = segmentAt(playStartMs_);
}

void RecordingPlayer::setController(QObject *value) {
    auto *next = qobject_cast<TimelineController *>(value);
    if (next == controller_) return;
    pause();
    if (controller_) disconnect(controller_, nullptr, this, nullptr);
    ++generation_; invalidateFrames(); prepared_.reset(); native_->source.reset();
    frame_ = {}; sourceFrame_ = {}; frameTimeMs_ = -1;
    controller_ = next;
    if (next) {
        connect(next, &TimelineController::playheadChanged, this, [this] {
            if (!updatingPlayhead_) { pause(); seek(); }
        });
        connect(next, &TimelineController::timelineChanged, this, [this] { pause(); seek(); });
        connect(next, &TimelineController::focusChanged, this, [this] {
            invalidateFrames();
            // Target framing can update from the selected clip immediately;
            // rebuilding the full animation sequence remains debounced.
            if (focusPreview_ && !playing_ && !loading_ && !sourceFrame_.isNull()) compose(frameTimeMs_);
            prepareTimer_.start();
        });
        connect(next, &TimelineController::selectionChanged, this, [this] { invalidateFrames(); if (!sourceFrame_.isNull()) compose(frameTimeMs_); emit changed(); });
        prepareTimer_.start();
    }
    emit changed();
}
void RecordingPlayer::setOptions(const QVariantMap &options) {
    if (options_ == options) return;
    static const QStringList appearanceKeys{
        "backgroundType", "backgroundSystemName", "backgroundImagePath", "backgroundColor",
        "gradientStartColor", "gradientEndColor", "gradientAngle", "backgroundBlur",
        "backgroundPaddingRatio", "windowBorderRadius", "cornerSmoothing", "insetSize", "insetColor", "insetAlpha",
        "shadowIntensity", "shadowAngle", "shadowDistance", "shadowBlur", "shadowIsDirectional",
        "outputAspectRatio", "cursorSize", "hideCursor", "motionBlurAmount", "motionBlurCursorAmount",
        "motionBlurScreenMoveAmount", "motionBlurScreenZoomAmount", "audioVolume", "systemAudioVolume",
        "muteMicrophone", "muteSystemAudio"};
    bool appearanceOnly = prepared_ && prepared_->context.valid && !loading_ && !prepareTimer_.isActive();
    for (auto it = options.constBegin(); appearanceOnly && it != options.constEnd(); ++it)
        if (options_.value(it.key()) != it.value() && !appearanceKeys.contains(it.key())) appearanceOnly = false;
    for (auto it = options_.constBegin(); appearanceOnly && it != options_.constEnd(); ++it)
        if (!options.contains(it.key()) && !appearanceKeys.contains(it.key())) appearanceOnly = false;
    options_ = options;
    if (appearanceOnly) {
        native_->player.volume = options.value("muteSystemAudio", false).toBool()
            ? 0 : float(options.value("systemAudioVolume", 1).toDouble());
        native_->microphone.volume = options.value("muteMicrophone", false).toBool()
            ? 0 : float(options.value("audioVolume", 1).toDouble());
        // Keep the media clock and poses. One in-flight frame may finish while
        // the latest pending settings replace earlier moves during a drag.
        compose(playing_ && controller_ ? controller_->timeline().sourceTimeAt(controller_->playheadMs()) : frameTimeMs_);
        emit changed(); return;
    }
    // Pending style work is already loading. Invalidate an older worker now,
    // before the debounce elapses, so it cannot install an obsolete crop.
    ++generation_; invalidateFrames(); pause(); loading_ = true; error_.clear();
    prepareTimer_.start();
    emit changed();
}

void RecordingPlayer::prepare() {
    if (!controller_ || !controller_->loaded()) return;
    ++measuredPreparations_;
    pause();
    const QString directory = controller_->projectDirectory();
    const QVariantMap options = options_;
    const auto focus = controller_->focusRanges();
    const int generation = ++generation_; invalidateFrames();
    loading_ = true; error_.clear(); emit changed();
    QPointer<RecordingPlayer> self(this);
    const QString background = bundledBackgroundRoot();
    QThreadPool::globalInstance()->start([self, directory, options, focus, generation, background] {
        @autoreleasepool {
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
            ready->poses->reserve(count);
            for (int i = 0; i < count; ++i) {
                const double time = i * 1000.0 / 60;
                ready->poses->push_back({sequence.cameraAt(time), sequence.cursorAt(time)});
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
                self->native_->player.automaticallyWaitsToMinimizeStalling = NO;
                self->native_->player.actionAtItemEnd = AVPlayerActionAtItemEndPause;
                if (project.microphone.present) self->native_->microphone = [AVPlayer playerWithURL:
                    [NSURL fileURLWithPath:(directory + "/" + project.microphone.file).toNSString()]];
            }
            self->native_->microphone.automaticallyWaitsToMinimizeStalling = NO;
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
        }
    });
}

void RecordingPlayer::seek() {
    if (!controller_ || !prepared_ || !prepared_->context.valid) return;
    invalidateFrames(); native_->source.reset();
    const double time = controller_->timeline().sourceTimeAt(controller_->playheadMs());
    if (!sourceFrame_.isNull() && std::abs(frameTimeMs_ - time) < 50) compose(time);
    const CMTime target = CMTimeMakeWithSeconds(time / 1000, 60000);
    seeking_ = true; ++measuredSeeks_;
    [native_->player pause]; [native_->microphone pause];
    const int revision = ++seekRevision_;
    QPointer<RecordingPlayer> self(this);
    [native_->player seekToTime:target toleranceBefore:kCMTimeZero toleranceAfter:kCMTimeZero
        completionHandler:^(BOOL finished) {
            QMetaObject::invokeMethod(qApp, [self, revision, finished] {
                if (!self || revision != self->seekRevision_) return;
                self->seeking_ = false;
                // Native completion establishes the new media clock before any
                // further output position or animation frame is requested.
                if (finished) { self->startNativePlayback(); self->tick(); }
            }, Qt::QueuedConnection);
        }];
    const double mic = std::max(0.0, time - prepared_->context.project.microphoneDelayMs());
    [native_->microphone seekToTime:CMTimeMakeWithSeconds(mic / 1000, 60000)];
}
void RecordingPlayer::play() {
    if (!controller_ || !hasFrame() || loading_ || cropEditing_ || playing_) return;
    if (controller_->playheadMs() >= controller_->outputDurationMs() - 20) controller_->setPlayheadMs(0);
    playing_ = true; startNativePlayback(); emit changed();
}

void RecordingPlayer::pause() {
    [native_->player pause]; [native_->microphone pause];
    if (!playing_) return;
    playing_ = false; emit changed();
}
void RecordingPlayer::toggle() { if (playing_) pause(); else play(); }

void RecordingPlayer::tick() {
    if (!controller_ || !prepared_ || !prepared_->context.valid || loading_) return;
    if (native_->player.currentItem.status == AVPlayerItemStatusFailed) {
        error_ = QString::fromNSString(native_->player.currentItem.error.localizedDescription);
        pause(); poll_.stop(); emit changed(); return;
    }
    if (seeking_) return;
    double sourceMs = controller_->timeline().sourceTimeAt(controller_->playheadMs());
    if (playing_) {
        // AVPlayer's media clock is the master for video, audio and animation.
        // A wall clock advances while native decoding/preroll is waiting and
        // repeatedly seeks into the future; restarting that loop never catches up.
        const auto &segments = controller_->timeline().segments();
        const int index = native_->segment;
        if (index < 0 || index >= int(segments.size())) { seek(); return; }
        const auto &segment = segments[index];
        const double actual = CMTimeGetSeconds(native_->player.currentTime) * 1000;
        if (!std::isfinite(actual)) return;
        const double output = controller_->timeline().outputStartAt(index)
            + std::clamp(actual - segment.sourceStartMs, 0.0, segment.sourceLengthMs()) / segment.speed;
        updatingPlayhead_ = true; controller_->setPlayheadMs(output); updatingPlayhead_ = false;
        sourceMs = controller_->timeline().sourceTimeAt(output);
        if (measuring_ && ++measuredTicks_ % 30 == 0 && clockSamples_.size() < 100) clockSamples_.append(QVariantMap{
            {"outputMs", output}, {"nativeMs", actual}, {"rate", native_->player.rate},
            {"timeControlStatus", int(native_->player.timeControlStatus)}});
        if (actual >= segment.sourceEndMs - .001) {
            if (index + 1 < int(segments.size())) {
                const auto &next = segments[index + 1];
                if (std::abs(next.sourceStartMs - segment.sourceEndMs) < .001) {
                    // A split, including a rate change, needs no decoder seek
                    // when the next source interval is contiguous.
                    native_->segment = index + 1;
                    if (next.speed != segment.speed) {
                        native_->player.rate = float(next.speed);
                        native_->microphone.rate = float(next.speed);
                    }
                } else { seek(); return; }
            } else pause();
        }
    }
    const CMTime time = native_->player.currentTime;
    bool decoded = false;
    if ([native_->output hasNewPixelBufferForItemTime:time]) {
        CMTime displayed = kCMTimeInvalid;
        CVPixelBufferRef buffer = [native_->output copyPixelBufferForItemTime:time itemTimeForDisplay:&displayed];
        if (buffer) {
            auto source = std::make_shared<DecodedSource>(); source->buffer = buffer;
            source->sequence = ++native_->sequence;
            source->sourceMs = CMTimeGetSeconds(CMTIME_IS_NUMERIC(displayed) ? displayed : time) * 1000;
            native_->source = std::move(source); decoded = true; ++decodedFrames_;
        }
    }
    // Camera/cursor poses advance at 60 Hz even on a 30 Hz source recording.
    // A source bitmap is scaled only once and can be reused between video frames.
    if (native_->source && (decoded || playing_)) {
        const double animationMs = playing_ ? sourceMs : native_->source->sourceMs;
        const int pose = playing_ ? int(playClock_.nsecsElapsed() * 60 / 1000000000) : -1;
        if (!playing_ || pose != lastRequestedPose_) {
            compose(animationMs); lastRequestedPose_ = pose;
        }
    }
}

void RecordingPlayer::compose(double sourceMs) {
    if ((!native_->source && sourceFrame_.isNull()) || !prepared_ || prepared_->poses->empty()) return;
    const int index = std::clamp(int(std::round(sourceMs * 60 / 1000)), 0, int(prepared_->poses->size()) - 1);
    const auto &pose = (*prepared_->poses)[index];
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
    auto request = std::make_shared<FrameRequest>();
    request->prepared = prepared_; request->source = native_->source;
    if (!request->source) {
        request->source = std::make_shared<DecodedSource>(); request->source->scaled = sourceFrame_;
    }
    request->camera = camera; request->cursor = pose.cursor; request->sourceMs = sourceMs;
    request->options = options_;
    // Blur depends on the current padding/layout, so calculate it after the
    // worker has installed this request's appearance context.
    request->applyBlur = !targetPreview;
    request->generation = generation_; request->revision = renderRevision_;
    if (pendingFrame_) ++coalescedFrames_;
    pendingFrame_ = std::move(request); startComposition();
}
void RecordingPlayer::startComposition() {
    if (composing_ || !pendingFrame_) return;
    composing_ = true;
    auto request = std::move(pendingFrame_);
    QPointer<RecordingPlayer> self(this);
    composePool_.start([self, request] {
        @autoreleasepool {
        if (request->prepared->context.project.settings != request->options) {
            auto ready = std::make_shared<Prepared>();
            auto project = request->prepared->context.project; project.settings = request->options;
            ready->context = makeComposeContext(std::move(project), bundledBackgroundRoot(), {}, 540,
                &request->prepared->context.canvasPlan);
            ready->poses = request->prepared->poses;
            request->prepared = std::move(ready);
        }
        if (request->applyBlur) {
            const auto &poses = *request->prepared->poses;
            const int index = std::clamp(int(std::round(request->sourceMs * 60 / 1000)), 0, int(poses.size()) - 1);
            const auto &previous = poses[std::max(0, index - 1)];
            request->blur = planBlur(request->prepared->context, previous.camera, previous.cursor,
                request->camera, request->cursor, request->sourceMs, true);
        }
        double scaleMs = 0;
        auto &source = *request->source;
        if (source.scaled.isNull() && source.buffer) {
            QElapsedTimer timer; timer.start();
            CVPixelBufferLockBaseAddress(source.buffer, kCVPixelBufferLock_ReadOnly);
            QImage view(static_cast<const uchar *>(CVPixelBufferGetBaseAddress(source.buffer)),
                int(CVPixelBufferGetWidth(source.buffer)), int(CVPixelBufferGetHeight(source.buffer)),
                int(CVPixelBufferGetBytesPerRow(source.buffer)), QImage::Format_ARGB32_Premultiplied);
            source.scaled = view.scaled(960, 540, Qt::KeepAspectRatio, Qt::SmoothTransformation);
            // QImage::scaled returns the same storage for an unchanged size.
            // The cached bitmap must outlive the decoder's reusable CV buffer.
            if (source.scaled.constBits() == view.constBits()) source.scaled = source.scaled.copy();
            CVPixelBufferUnlockBaseAddress(source.buffer, kCVPixelBufferLock_ReadOnly);
            scaleMs = timer.nsecsElapsed() / 1e6;
        }
        QElapsedTimer timer; timer.start();
        const QImage frame = composeFrame(request->prepared->context, source.scaled,
            request->camera, request->cursor, request->sourceMs, true,
            request->blur.empty() ? nullptr : &request->blur);
        const double composeMs = timer.nsecsElapsed() / 1e6;
        // Only the GUI callback dereferences the guarded item. Workers own their
        // buffers/context, never QML or the mutable session, including on close.
        QMetaObject::invokeMethod(qApp, [self, request, frame, scaleMs, composeMs] {
            if (!self) return;
            self->composing_ = false;
            self->scaleTotalMs_ += scaleMs; self->composeTotalMs_ += composeMs;
            self->composeMaxMs_ = std::max(self->composeMaxMs_, composeMs);
            if (request->generation == self->generation_ && request->revision == self->renderRevision_ && !frame.isNull()) {
                const bool first = !self->hasFrame();
                self->frame_ = frame; self->sourceFrame_ = request->source->scaled;
                self->displayedOptions_ = request->options;
                self->prepared_ = request->prepared;
                self->frameTimeMs_ = request->sourceMs; self->displayedCamera_ = request->camera;
                ++self->measuredFrames_; self->update(); emit self->frameChanged();
                if (first) emit self->changed();
            } else ++self->discardedFrames_;
            self->startComposition();
        }, Qt::QueuedConnection);
        }
    });
}
void RecordingPlayer::resetPlaybackMetrics() {
    measuredFrames_ = 0; scaleTotalMs_ = composeTotalMs_ = composeMaxMs_ = 0;
    measuredSeeks_ = measuredTicks_ = decodedFrames_ = coalescedFrames_ = discardedFrames_ = 0;
    measuredPreparations_ = 0;
    measuring_ = true; clockSamples_.clear();
}
QVariantMap RecordingPlayer::playbackMetrics() const {
    return {{"frames", measuredFrames_}, {"scaleTotalMs", scaleTotalMs_},
        {"composeTotalMs", composeTotalMs_}, {"composeMaxMs", composeMaxMs_},
        {"seeks", measuredSeeks_}, {"preparations", measuredPreparations_}, {"clockSamples", clockSamples_}, {"decodedFrames", decodedFrames_},
        {"coalescedFrames", coalescedFrames_}, {"discardedFrames", discardedFrames_}};
}
void RecordingPlayer::setFocusPreview(bool enabled) {
    if (focusPreview_ == enabled) return;
    focusPreview_ = enabled; invalidateFrames(); if (!sourceFrame_.isNull()) compose(frameTimeMs_); emit changed();
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
    const auto crop = sourceCropFromSettings(prepared_->context.project.settings);
    return {{"valid", nx >= 0 && nx <= 1 && ny >= 0 && ny <= 1}, {"x", crop.x + nx * crop.width}, {"y", crop.y + ny * crop.height}};
}
QPointF RecordingPlayer::focusMarker() const {
    const auto selected = controller_ ? controller_->selectedFocus() : QVariantMap{};
    if (!prepared_ || frame_.isNull() || selected.isEmpty() || !selected.value("fixedPosition").toBool()) return {-100, -100};
    const auto &layout = prepared_->context.layout();
    const auto crop = sourceCropFromSettings(prepared_->context.project.settings);
    const auto nx = (selected.value("focusX").toDouble() - crop.x) / crop.width;
    const auto ny = (selected.value("focusY").toDouble() - crop.y) / crop.height;
    if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return {-100, -100};
    const auto focus = QPointF(nx * layout.contentRect.width(), ny * layout.contentRect.height());
    const auto canvas = layout.frameRect.topLeft() + QPointF(displayedCamera_.offsetX, displayedCamera_.offsetY) * layout.fitScale
        + displayedCamera_.scale * (layout.contentRect.topLeft() - layout.frameRect.topLeft() + focus);
    const QSizeF size = QSizeF(frame_.size()).scaled(boundingRect().size(), Qt::KeepAspectRatio);
    return QPointF((width() - size.width()) / 2, (height() - size.height()) / 2) + canvas * (size.width() / frame_.width());
}
QSGNode *RecordingPlayer::updatePaintNode(QSGNode *oldNode, UpdatePaintNodeData *) {
    auto *node = static_cast<PreviewNode *>(oldNode);
    const auto &picture = cropEditing_ ? sourceFrame_ : frame_;
    if (picture.isNull() || !window()) { delete node; return nullptr; }
    if (!node) { node = new PreviewNode; node->setOwnsTexture(true); }
    if (node->imageKey != picture.cacheKey()) {
        auto *next = window()->createTextureFromImage(picture);
        if (!next) { delete node; return nullptr; }
        node->setTexture(next); // OwnsTexture releases the previous texture.
        node->imageKey = picture.cacheKey();
    }
    const auto size = QSizeF(picture.size()).scaled(boundingRect().size(), Qt::KeepAspectRatio);
    node->setRect((width() - size.width()) / 2, (height() - size.height()) / 2, size.width(), size.height());
    node->setFiltering(QSGTexture::Linear);
    return node;
}

void RecordingPlayer::setCropEditing(bool value) {
    if (cropEditing_ == value) return;
    cropEditing_ = value; pause(); update(); emit changed();
}
QRectF RecordingPlayer::sourceDisplayRect() const {
    if (sourceFrame_.isNull()) return {};
    const auto size = QSizeF(sourceFrame_.size()).scaled(boundingRect().size(), Qt::KeepAspectRatio);
    return {(width() - size.width()) / 2, (height() - size.height()) / 2, size.width(), size.height()};
}
} // namespace Render
