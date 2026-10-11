#include "EditorVerification.h"
#include "../src/render/EditorSessionRegistry.h"
#include "../src/render/RecordingPlayer.h"
#include "../src/mac/MacCapture.h"
#include "../src/mac/QuickScreenshot.h"
#import <AppKit/AppKit.h>
#include <QApplication>
#include <QDir>
#include <QElapsedTimer>
#include <QFile>
#include <QJsonDocument>
#include <QJsonObject>
#include <QQuickWindow>
#include <QTimer>
#include <QClipboard>
#include <QMouseEvent>
#include <QWheelEvent>
#include <QKeyEvent>
#include <cmath>
#include "../src/render/VideoSurface.h"
#include "../src/capture/VideoFrameStore.h"
#include <QSGRendererInterface>
#include <memory>

namespace {
QQuickItem *findItem(QQuickItem *item, const QString &name) {
    if (item->objectName() == name) return item;
    for (auto *child : item->childItems()) if (auto *found = findItem(child, name)) return found;
    return nullptr;
}
int loadedThumbnails(QQuickItem *item) {
    int count = item->objectName() == "filmstripTile" && item->property("status").toInt() == 1 ? 1 : 0;
    for (auto *child : item->childItems()) count += loadedThumbnails(child);
    return count;
}
Render::RecordingPlayer *findPlayer(QQuickItem *item) {
    if (auto *player = qobject_cast<Render::RecordingPlayer *>(item)) return player;
    for (auto *child : item->childItems()) if (auto *player = findPlayer(child)) return player;
    return nullptr;
}
struct Check : QObject {
    QApplication *app;
    Render::EditorSessionRegistry *registry;
    MacCapture *capture;
    QuickScreenshot *screenshot;
    Render::EditorSession *session = nullptr;
    Render::RecordingPlayer *player = nullptr;
    QQuickWindow *window = nullptr;
    QTimer timer;
    QElapsedTimer clock;
    QString output;
    QJsonObject result;
    int stage = 0;
    qint64 stageStart = 0;
    bool recordingCheck = false;
    bool timelineCheck = false;
    bool focusCheck = false;
    bool cropCheck = false;
    bool performanceCheck = false;
    bool playbackCheck = false;
    bool requireSmoothPreview = false;
    bool appearanceCheck = false;
    QQuickItem *paddingSlider = nullptr;
    QPointF sliderPoint;
    QVariantMap originalAppearance, finalAppearance;
    QImage originalAppearanceFrame;
    int dragMoves = 0, dragFrames = 0;
    qint64 lastAppearanceEdit = 0;
    std::vector<double> appearanceLatency;
    int warmDeliveryCount = 0;
    double lastEditedPlayhead = 0;
    QTimer heartbeat;
    qint64 lastHeartbeat = 0;
    std::vector<double> heartbeatGaps, deliveryGaps, swapGaps;
    qint64 lastDelivery = 0, lastSwap = 0;
    double measuredSource = -1;
    static double percentile(std::vector<double> values, double ratio) {
        if (values.empty()) return 0;
        std::sort(values.begin(), values.end());
        return values[std::min(values.size() - 1, size_t(ratio * (values.size() - 1)))];
    }
    QString focusId;
    QImage beforeFraming;
    bool positionPadPending = false;
    VideoFrameStore gpuFrames;
    std::unique_ptr<QQuickWindow> gpuWindow;
    VideoSurface *gpuSurface = nullptr;
    bool recordingStarted = false;
    bool screenshotStarted = false;
    bool screenshotFinished = false;
    QString capturedProject;
    QVariantMap captureOptions;
    Check(QApplication *a, Render::EditorSessionRegistry *r, MacCapture *c, QuickScreenshot *s)
        : QObject(a), app(a), registry(r), capture(c), screenshot(s) {}
    void finish(const QString &error = {}) {
        timer.stop();
        capture->stop();
        result.insert("stage", stage);
        result.insert("playerFound", player != nullptr);
        if (player) {
            result.insert("loading", player->loading());
            result.insert("hasFrame", player->hasFrame());
            result.insert("playerError", player->error());
        }
        if (window) window->grabWindow().save(output + "/editor-final.png");
        result.insert("ok", error.isEmpty()); result.insert("error", error);
        QFile file(output + "/result.json");
        if (file.open(QIODevice::WriteOnly)) file.write(QJsonDocument(result).toJson());
        if (!error.isEmpty()) qCritical().noquote() << error;
        app->exit(error.isEmpty() ? 0 : 2);
    }
    void next() { ++stage; stageStart = clock.elapsed(); qInfo() << "Editor verification stage" << stage; }
    void mouse(QEvent::Type type, const QPointF &point, Qt::MouseButton button, Qt::MouseButtons buttons) {
        QMouseEvent event(type, point, QPointF(window->mapToGlobal(point.toPoint())), button, buttons, Qt::NoModifier);
        QCoreApplication::sendEvent(window, &event);
    }
    void key(int key, Qt::KeyboardModifiers modifiers) {
        QKeyEvent press(QEvent::KeyPress, key, modifiers); QCoreApplication::sendEvent(window, &press);
        QKeyEvent release(QEvent::KeyRelease, key, modifiers); QCoreApplication::sendEvent(window, &release);
    }
    bool click(const QString &name) {
        auto *item = findItem(window->contentItem(), name);
        if (!item || !item->isVisible() || !item->isEnabled()) return false;
        auto *scroll = findItem(window->contentItem(), "cropInspectorScroll");
        bool inScroll = false;
        for (auto *parent = item->parentItem(); parent; parent = parent->parentItem()) if (parent == scroll) inScroll = true;
        if (scroll && inScroll) {
            const double y = item->mapToItem(scroll, QPointF(0, item->height() / 2)).y();
            if (y < item->height() / 2 || y > scroll->height() - item->height() / 2) {
                const double target = scroll->property("contentY").toDouble() + y - scroll->height() / 2;
                scroll->setProperty("contentY", std::clamp(target, 0.0, std::max(0.0, scroll->property("contentHeight").toDouble() - scroll->height())));
            }
        }
        const auto point = item->mapToScene(QPointF(item->width() / 2, item->height() / 2));
        mouse(QEvent::MouseButtonPress, point, Qt::LeftButton, Qt::LeftButton);
        mouse(QEvent::MouseButtonRelease, point, Qt::LeftButton, Qt::NoButton); return true;
    }
    bool enterNumber(const QString &name, const QString &text) {
        if (!click(name)) return false;
        key(Qt::Key_A, Qt::ControlModifier);
        QKeyEvent event(QEvent::KeyPress, 0, Qt::NoModifier, text);
        QCoreApplication::sendEvent(window, &event); return true;
    }
    int manualCount() const {
        int count = 0; for (const auto &f : session->timeline()->focusRanges()) if (!f.system) ++count; return count;
    }
    void poll() {
        if (clock.elapsed() - stageStart > 45000) { finish(QStringLiteral("verification stage %1 timed out").arg(stage)); return; }
        if (stage == 0) {
            window = registry->windowAt(registry->activeWindowId());
            if (!window) return;
            player = findPlayer(window->contentItem());
            if (!player) return;
            if (!player->error().isEmpty()) { finish(player->error()); return; }
            if (!player->hasFrame() || player->loading()) return;
            if (appearanceCheck) {
                paddingSlider = findItem(window->contentItem(), "parameterControl_留白");
                if (!paddingSlider) { finish("padding slider not found"); return; }
                for (auto *parent = paddingSlider->parentItem(); parent; parent = parent->parentItem()) {
                    if (!parent->property("contentY").isValid() || !parent->property("contentHeight").isValid()) continue;
                    const double y = paddingSlider->mapToItem(parent, QPointF(0, paddingSlider->height() / 2)).y();
                    parent->setProperty("contentY", std::clamp(parent->property("contentY").toDouble() + y - parent->height() / 2,
                        0.0, std::max(0.0, parent->property("contentHeight").toDouble() - parent->height())));
                    break;
                }
                originalAppearance = session->settingsStore()->current(); originalAppearanceFrame = player->renderedFrame();
                result.insert("initialAspect", originalAppearance["outputAspectRatio"].toString());
                result.insert("initialPreviewWidth", player->frameSize().width());
                result.insert("initialPreviewHeight", player->frameSize().height());
                QObject::connect(session->settingsStore(), &SettingsStore::currentChanged, this, [this] { lastAppearanceEdit = clock.nsecsElapsed(); });
                QObject::connect(player, &Render::RecordingPlayer::frameChanged, this, [this] {
                    if (stage == 28) ++dragFrames;
                    if (lastAppearanceEdit && player->displayedOptions() == session->settingsStore()->current()) {
                        appearanceLatency.push_back((clock.nsecsElapsed() - lastAppearanceEdit) / 1e6); lastAppearanceEdit = 0;
                    }
                });
                heartbeat.setInterval(8); heartbeat.setTimerType(Qt::PreciseTimer);
                QObject::connect(&heartbeat, &QTimer::timeout, this, [this] {
                    const auto now = clock.nsecsElapsed();
                    if (lastHeartbeat) heartbeatGaps.push_back((now - lastHeartbeat) / 1e6); lastHeartbeat = now;
                });
                heartbeat.start(); player->resetPlaybackMetrics();
                const double position = paddingSlider->property("position").toDouble();
                sliderPoint = paddingSlider->mapToScene(QPointF(7 + position * (paddingSlider->width() - 14), paddingSlider->height() / 2));
                mouse(QEvent::MouseButtonPress, sliderPoint, Qt::LeftButton, Qt::LeftButton);
                stage = 28; stageStart = clock.elapsed(); timer.setInterval(32); return;
            }
            if (performanceCheck) {
                player->resetPlaybackMetrics();
                QObject::connect(player, &Render::RecordingPlayer::frameChanged, this, [this] {
                    if (player->frameTimeMs() == measuredSource) return;
                    measuredSource = player->frameTimeMs();
                    if (stage == 23 && clock.elapsed() - stageStart >= 1000) ++warmDeliveryCount;
                    const auto now = clock.nsecsElapsed();
                    if (lastDelivery) deliveryGaps.push_back((now - lastDelivery) / 1e6);
                    lastDelivery = now;
                });
                QObject::connect(window, &QQuickWindow::frameSwapped, this, [this] {
                    const auto now = clock.nsecsElapsed();
                    if (lastSwap) swapGaps.push_back((now - lastSwap) / 1e6);
                    lastSwap = now;
                });
                heartbeat.setInterval(8); heartbeat.setTimerType(Qt::PreciseTimer);
                QObject::connect(&heartbeat, &QTimer::timeout, this, [this] {
                    const auto now = clock.nsecsElapsed();
                    if (lastHeartbeat) heartbeatGaps.push_back((now - lastHeartbeat) / 1e6);
                    lastHeartbeat = now;
                });
                heartbeat.start(); player->play(); stage = 23; stageStart = clock.elapsed(); return;
            }
            window->grabWindow().save(output + "/editor-loaded.png");
            result.insert("firstFrame", true);
            player->play(); next();
        } else if (stage == 1) {
            if (session->timeline()->playheadMs() < 700) return;
            result.insert("playback", player->playing() && player->frameTimeMs() > 300);
            if (!result.value("playback").toBool()) { finish("video clock did not advance"); return; }
            player->pause();
            session->timeline()->setPlayheadMs(1200);
            session->timeline()->setPlayheadMs(2300);
            session->timeline()->setPlayheadMs(3200);
            next();
        } else if (stage == 2) {
            if (std::abs(player->frameTimeMs() - 3200) > 80) return;
            result.insert("rapidSeek", true);
            session->settingsStore()->setCurrent("outputAspectRatio", "1:1");
            session->settingsStore()->setCurrent("backgroundPaddingRatio", 15.0);
            next();
        } else if (stage == 3) {
            if (player->loading() || player->frameSize().width() != player->frameSize().height()) return;
            if (Render::loadProject(session->projectDirectory()).settings.value("outputAspectRatio") != "1:1") {
                finish("preview appearance did not persist for export"); return;
            }
            window->grabWindow().save(output + "/editor-appearance.png");
            result.insert("appearance", true);
            if (!session->timeline()->splitAt(2000) || !session->timeline()->setSpeed(0, 2000, 2) || !session->save()) {
                finish("edit/save failed"); return;
            }
            result.insert("editSave", true);
            if (cropCheck) {
                session->timeline()->reset(); session->timeline()->setPlayheadMs(800);
                session->settingsStore()->setCurrent("outputAspectRatio", "auto");
                session->settingsStore()->setCurrent("backgroundPaddingRatio", 8.0);
                stage = 14; stageStart = clock.elapsed(); return;
            }
            if (focusCheck) {
                session->timeline()->reset(); session->timeline()->setPlayheadMs(800);
                stage = 9; stageStart = clock.elapsed(); return;
            }
            if (timelineCheck) {
                session->timeline()->reset();
                session->timeline()->splitAt(1500); session->timeline()->splitAt(3500);
                stage = 7; stageStart = clock.elapsed(); return;
            }
            if (!recordingCheck) { finish(); return; }
            captureOptions = {{"recordingDirectory", output + "/recordings"},
                {"muteMicrophone", true}, {"muteSystemAudio", true},
                {"backgroundType", "color"}, {"backgroundColor", "#203040"}};
            capture->setRecordingSettings(captureOptions);
            capture->refreshDisplays(); next();
        } else if (stage == 4) {
            if (capture->busy()) return;
            if (capture->displayNames().isEmpty()) { finish("native capture permission or display unavailable: " + capture->status()); return; }
            NSView *view = (__bridge NSView *)reinterpret_cast<void *>(window->winId());
            if (!screenshotStarted) {
                screenshotStarted = true;
                result.insert("screenPreflight", bool(CGPreflightScreenCaptureAccess()));
                result.insert("screenAuthorized", capture->screenAuthorized());
                result.insert("inputAuthorized", capture->inputMonitoringAuthorized());
                result.insert("microphoneAuthorized", capture->microphoneAuthorized());
                if (!CGPreflightScreenCaptureAccess() || !capture->inputMonitoringAuthorized()) {
                    finish("native capture requires authorization for the new stable application signature"); return;
                }
                screenshot->setSource({{"kind", "window"}, {"windowId", quint32(view.window.windowNumber)}});
                screenshot->capture({{"screenshotDirectory", output + "/screenshots"}, {"outputAspectRatio", "16:9"},
                    {"backgroundType", "color"}, {"backgroundColor", "#203040"}});
                return;
            }
            if (!screenshotFinished) return;
            capture->startRecordingWindow(view.window.windowNumber, captureOptions);
            next();
        } else if (stage == 5) {
            if (!capture->recording()) {
                if (clock.elapsed() - stageStart > 5000 && !capture->busy()) finish("native recording failed to start: " + capture->recordingStatus());
                return;
            }
            if (!recordingStarted) { stageStart = clock.elapsed(); recordingStarted = true; }
            if (clock.elapsed() - stageStart < 1500) return;
            capture->stopRecording(); next();
        } else if (stage == 7) {
            if (session->media()->loading()) return;
            auto *strip = findItem(window->contentItem(), "editorTimeline");
            auto *viewport = findItem(window->contentItem(), "timelineViewport");
            auto *clip = findItem(window->contentItem(), "timelineClip-0");
            auto *tail = findItem(window->contentItem(), "clipTail-0");
            if (!strip || !viewport || !clip || !tail) { finish("timeline visual items unavailable"); return; }
            const auto peaks = session->media()->waveform(0, 0, 5000, 50);
            if (!session->media()->hasSystemAudio() || peaks.empty() || peaks.front().toDouble() <= 0) { finish("real waveform unavailable"); return; }
            result.insert("audioWaveform", true);
            QPointF point = clip->mapToScene(QPointF(clip->width() / 2, clip->height() / 2));
            mouse(QEvent::MouseButtonPress, point, Qt::LeftButton, Qt::LeftButton);
            mouse(QEvent::MouseButtonRelease, point, Qt::LeftButton, Qt::NoButton);
            if (session->timeline()->selectedCount() != 1) { finish("clip click did not select clip"); return; }
            result.insert("clipSelectionGesture", true);
            point = tail->mapToScene(QPointF(tail->width() / 2, tail->height() / 2));
            mouse(QEvent::MouseButtonPress, point, Qt::LeftButton, Qt::LeftButton);
            mouse(QEvent::MouseMove, point - QPointF(40, 0), Qt::NoButton, Qt::LeftButton);
            mouse(QEvent::MouseButtonRelease, point - QPointF(40, 0), Qt::LeftButton, Qt::NoButton);
            if (session->timeline()->outputDurationMs() >= 4980) { finish("clip edge drag did not trim source"); return; }
            result.insert("clipTrimGesture", true);
            session->timeline()->undo();
            clip = findItem(window->contentItem(), "timelineClip-0");
            if (!clip) { finish("clip not reconstructed after undo"); return; }
            point = clip->mapToScene(QPointF(clip->width() / 2, clip->height() / 2));
            const QPointF target = viewport->mapToScene(QPointF(viewport->width() - 2, 50));
            mouse(QEvent::MouseButtonPress, point, Qt::LeftButton, Qt::LeftButton);
            mouse(QEvent::MouseMove, target, Qt::NoButton, Qt::LeftButton);
            mouse(QEvent::MouseButtonRelease, target, Qt::LeftButton, Qt::NoButton);
            if (std::abs(session->timeline()->timeline().sourceTimeAt(0) - 1500) > 1) { finish("clip drag did not reorder authored source"); return; }
            result.insert("clipReorderGesture", true);
            session->timeline()->setPlayheadMs(0);
            next();
        } else if (stage == 8) {
            if (player->loading() || std::abs(player->frameTimeMs() - 1500) > 80) return;
            const int thumbnails = loadedThumbnails(window->contentItem());
            if (!thumbnails) return;
            result.insert("loadedThumbnails", thumbnails);
            result.insert("reorderedPreview", true);
            auto *strip = findItem(window->contentItem(), "editorTimeline");
            auto *viewport = findItem(window->contentItem(), "timelineViewport");
            const QPointF point = viewport->mapToScene(QPointF(viewport->width() / 2, 50));
            QWheelEvent zoom(point, QPointF(window->mapToGlobal(point.toPoint())), QPoint(0, 80), QPoint(), Qt::NoButton, Qt::NoModifier, Qt::ScrollUpdate, false);
            QCoreApplication::sendEvent(window, &zoom);
            if (strip->property("timelineZoom").toDouble() <= 1) { finish("timeline wheel did not zoom viewport"); return; }
            result.insert("timelineWheelZoom", true);
            if (!session->save()) { finish("reordered edit save failed"); return; }
            window->grabWindow().save(output + "/editor-timeline.png");
            finish(); return;
        } else if (stage == 9) {
            if (player->loading() || std::abs(player->frameTimeMs() - 800) > 80) return;
            auto *viewport = findItem(window->contentItem(), "timelineViewport");
            auto *strip = findItem(window->contentItem(), "editorTimeline");
            auto *background = findItem(window->contentItem(), "manualFocusBackground");
            if (!viewport || !strip || !background) { finish("focus lane unavailable"); return; }
            const double pixels = strip->property("pixelsPerMs").toDouble();
            const auto start = background->mapToScene(QPointF(12 + 500 * pixels, 19));
            const auto end = background->mapToScene(QPointF(12 + 1800 * pixels, 19));
            mouse(QEvent::MouseButtonPress, start, Qt::LeftButton, Qt::LeftButton);
            mouse(QEvent::MouseMove, end, Qt::NoButton, Qt::LeftButton);
            mouse(QEvent::MouseButtonRelease, end, Qt::LeftButton, Qt::NoButton);
            if (manualCount() != 1 || session->timeline()->selectedFocusId().isEmpty()) { finish("blank focus lane drag did not create a manual effect"); return; }
            focusId = session->timeline()->selectedFocusId(); result.insert("manualFocusCreateGesture", true); next();
        } else if (stage == 10) {
            if (player->loading()) return;
            const auto selected = session->timeline()->selectedFocus();
            auto *tail = findItem(window->contentItem(), "focusTail-" + selected.value("fragmentId").toString());
            auto *strip = findItem(window->contentItem(), "editorTimeline");
            if (!tail || !strip) return;
            const double pixels = strip->property("pixelsPerMs").toDouble();
            const auto point = tail->mapToScene(QPointF(tail->width() / 2, tail->height() / 2));
            mouse(QEvent::MouseButtonPress, point, Qt::LeftButton, Qt::LeftButton);
            mouse(QEvent::MouseMove, point - QPointF(300 * pixels, 0), Qt::NoButton, Qt::LeftButton);
            mouse(QEvent::MouseButtonRelease, point - QPointF(300 * pixels, 0), Qt::LeftButton, Qt::NoButton);
            if (session->timeline()->selectedFocus().value("outputEndMs").toDouble() >= 1750) { finish("focus edge drag did not resize range"); return; }
            result.insert("focusResizeGesture", true);
            key(Qt::Key_C, Qt::MetaModifier); session->timeline()->setPlayheadMs(3000); key(Qt::Key_V, Qt::MetaModifier);
            if (manualCount() != 2) { finish("focus keyboard copy/paste failed"); return; }
            result.insert("focusKeyboardCopyPaste", true); next();
        } else if (stage == 11) {
            if (player->loading()) return;
            const auto selected = session->timeline()->selectedFocus();
            auto *clip = findItem(window->contentItem(), "focusClip-" + selected.value("fragmentId").toString());
            auto *strip = findItem(window->contentItem(), "editorTimeline");
            if (!clip || !strip) return;
            const double pixels = strip->property("pixelsPerMs").toDouble();
            const auto point = clip->mapToScene(QPointF(clip->width() / 2, clip->height() / 2));
            mouse(QEvent::MouseButtonPress, point, Qt::LeftButton, Qt::LeftButton);
            mouse(QEvent::MouseMove, point + QPointF(400 * pixels, 0), Qt::NoButton, Qt::LeftButton);
            mouse(QEvent::MouseButtonRelease, point + QPointF(400 * pixels, 0), Qt::LeftButton, Qt::NoButton);
            if (session->timeline()->selectedFocus().value("outputStartMs").toDouble() < 3300) { finish("focus drag did not move range"); return; }
            result.insert("focusMoveGesture", true);
            auto *button = findItem(window->contentItem(), "focusPreviewButton");
            if (!button) { finish("framing preview control unavailable"); return; }
            const auto click = button->mapToScene(QPointF(button->width() / 2, button->height() / 2));
            mouse(QEvent::MouseButtonPress, click, Qt::LeftButton, Qt::LeftButton); mouse(QEvent::MouseButtonRelease, click, Qt::LeftButton, Qt::NoButton);
            if (!player->focusPreview()) { finish("framing target preview did not enable"); return; }
            next();
        } else if (stage == 12) {
            if (player->loading()) return;
            if (positionPadPending) {
                if (beforeFraming == player->renderedFrame()) return;
                result.insert("focusPositionPadAndPixels", true); next(); return;
            }
            auto *pad = findItem(window->contentItem(), "focusPositionPad");
            if (!pad || pad->height() <= 0) return;
            const auto point = pad->mapToScene(QPointF(pad->width() * .8, pad->height() * .3));
            auto *inspector = findItem(window->contentItem(), "focusInspector");
            if (!inspector) { finish("focus inspector unavailable"); return; }
            if (inspector->property("scrolling").toBool()) return;
            const auto bottom = inspector->mapToScene(QPointF(0, inspector->height())).y();
            if (point.y() > bottom - 10) {
                const auto centre = inspector->mapToScene(QPointF(inspector->width() / 2, inspector->height() / 2));
                QWheelEvent scroll(centre, QPointF(window->mapToGlobal(centre.toPoint())), QPoint(0, -100), QPoint(0, -120), Qt::NoButton, Qt::NoModifier, Qt::ScrollUpdate, false);
                QCoreApplication::sendEvent(window, &scroll);
                return;
            }
            beforeFraming = player->renderedFrame();
            mouse(QEvent::MouseButtonPress, point, Qt::LeftButton, Qt::LeftButton); mouse(QEvent::MouseButtonRelease, point, Qt::LeftButton, Qt::NoButton);
            const auto focus = session->timeline()->selectedFocus();
            if (std::abs(focus.value("focusX").toDouble() - .8) > .01 || std::abs(focus.value("focusY").toDouble() - .3) > .01) {
                qInfo() << "Position pad" << point << pad->size() << "focus" << focus.value("focusX") << focus.value("focusY");
                finish("position pad did not update framing coordinates"); return;
            }
            positionPadPending = true; // The shared compositor now finishes asynchronously.
        } else if (stage == 13) {
            if (player->loading()) return;
            auto *picker = findItem(window->contentItem(), "focusCanvasPicker");
            if (!picker || !picker->isEnabled()) { finish("canvas focus picker unavailable"); return; }
            const QPointF local(player->width() * .48, player->height() * .5);
            const auto source = player->sourcePointAt(local.x(), local.y());
            if (!source.value("valid").toBool()) { finish("canvas centre did not map to captured source"); return; }
            const auto click = picker->mapToScene(local);
            mouse(QEvent::MouseButtonPress, click, Qt::LeftButton, Qt::LeftButton); mouse(QEvent::MouseButtonRelease, click, Qt::LeftButton, Qt::NoButton);
            if (std::abs(session->timeline()->selectedFocus().value("focusX").toDouble() - source.value("x").toDouble()) > .01) { finish("canvas click did not set source focus"); return; }
            result.insert("focusCanvasPickGesture", true);
            if (!session->save()) { finish("focus project save failed"); return; }
            const auto saved = Render::loadProject(session->projectDirectory());
            if (saved.zoomRanges.size() != session->timeline()->focusRanges().size()) { finish("saved effects do not match rendering project"); return; }
            result.insert("focusSaveForExport", true); window->grabWindow().save(output + "/editor-focus.png"); finish(); return;
        } else if (stage == 14) {
            if (player->loading() || std::abs(player->frameTimeMs() - 800) > 80) return;
            if (!click("beginCropButton") || !session->cropController()->active()) { finish("crop button did not enter draft"); return; }
            next();
        } else if (stage == 15) {
            auto *crop = session->cropController();
            const auto raw = player->sourceDisplayRect();
            if (!player->cropEditing() || raw.isEmpty()) return;
            auto *handle = findItem(window->contentItem(), "cropHandle-0");
            if (!handle) { finish("crop handle unavailable"); return; }
            auto point = handle->mapToScene(QPointF(handle->width() / 2, handle->height() / 2));
            const auto delta = QPointF(raw.width() * .12, raw.height() * .15);
            mouse(QEvent::MouseButtonPress, point, Qt::LeftButton, Qt::LeftButton);
            mouse(QEvent::MouseMove, point + delta, Qt::NoButton, Qt::LeftButton);
            mouse(QEvent::MouseButtonRelease, point + delta, Qt::LeftButton, Qt::NoButton);
            if (crop->draft()["x"].toDouble() < .10 || crop->draft()["y"].toDouble() < .13) { finish("corner gesture did not crop original source"); return; }
            const double previous = crop->draft()["x"].toDouble();
            auto *move = findItem(window->contentItem(), "cropMoveArea");
            point = move->mapToScene(QPointF(move->width() / 2, move->height() / 2));
            const auto shift = QPointF(-raw.width() * .05, -raw.height() * .05);
            mouse(QEvent::MouseButtonPress, point, Qt::LeftButton, Qt::LeftButton);
            mouse(QEvent::MouseMove, point + shift, Qt::NoButton, Qt::LeftButton);
            mouse(QEvent::MouseButtonRelease, point + shift, Qt::LeftButton, Qt::NoButton);
            if (crop->draft()["x"].toDouble() >= previous - .04 || !Render::sourceCropFromSettings(session->settingsStore()->current()).full()) { finish("moving draft changed geometry incorrectly or committed prematurely"); return; }
            result.insert("cropCornerAndMoveGestures", true);
            window->setWidth(1100); window->setHeight(680); next();
        } else if (stage == 16) {
            if (!enterNumber("cropXField", "192") || !enterNumber("cropYField", "120") || !enterNumber("cropWidthField", "480") || !enterNumber("cropHeightField", "360") || !click("cropPixelsButton")) { finish("pixel crop controls unavailable"); return; }
            const auto pixels = session->cropController()->draftPixels();
            if (pixels["x"].toInt() != 192 || pixels["y"].toInt() != 120 || pixels["width"].toInt() != 480 || pixels["height"].toInt() != 360) { finish("pixel fields did not set exact source crop"); return; }
            result.insert("cropPixelInput", true);
            window->grabWindow().save(output + "/editor-crop-draft.png");
            auto *confirm = findItem(window->contentItem(), "applyCropButton");
            auto *strip = findItem(window->contentItem(), "editorTimeline");
            if (!confirm || !strip || confirm->mapToScene(QPointF(0, confirm->height())).y() > strip->mapToScene(QPointF()).y()) { finish("crop confirmation is obscured at minimum window size"); return; }
            result.insert("cropConfirmationAtMinimumWindow", true);
            if (!click("applyCropButton") || session->cropController()->active()) { finish("confirm crop failed"); return; }
            next();
        } else if (stage == 17) {
            if (player->loading()) return;
            if (std::abs(double(player->frameSize().width()) / player->frameSize().height() - 4.0 / 3) > .02) { finish("composed preview did not use cropped aspect"); return; }
            const auto point = player->sourcePointAt(player->width() / 2, player->height() / 2);
            if (!point["valid"].toBool() || std::abs(point["x"].toDouble() - .45) > .01 || std::abs(point["y"].toDouble() - .5) > .01) { finish("cropped canvas inverse does not recover original source centre"); return; }
            result.insert("croppedPreviewAndSourceInverse", true);
            if (!click("beginCropButton")) { finish("cannot reopen crop"); return; }
            next();
        } else if (stage == 18) {
            auto *crop = session->cropController();
            if (!click("resetCropButton")) { finish("crop reset unavailable"); return; }
            key(Qt::Key_Escape, Qt::NoModifier);
            const auto kept = Render::sourceCropFromSettings(session->settingsStore()->current());
            if (crop->active() || std::abs(kept.x - .2) > .001 || kept.width != .5) { qInfo() << "Crop after Escape" << crop->active() << kept.map() << "window active" << window->isActive() << "focus" << window->activeFocusItem(); finish("Escape did not discard reset draft"); return; }
            result.insert("cropCancelGesture", true);
            crop->begin(); crop->resetDraft(); crop->apply(); session->timeline()->undo();
            if (Render::sourceCropFromSettings(session->settingsStore()->current()).normalizedRect() != kept.normalizedRect()) { finish("undo did not restore confirmed crop"); return; }
            result.insert("cropUndo", true);
            session->timeline()->createFocus(500, 1500);
            session->timeline()->updateFocus(session->timeline()->selectedFocusId(), {{"fixedPosition", true}, {"focusX", .45}, {"focusY", .5}, {"zoom", 2.0}});
            player->setFocusPreview(true); next();
        } else if (stage == 19) {
            if (player->loading()) return;
            auto *picker = findItem(window->contentItem(), "focusCanvasPicker");
            if (!picker || !picker->isEnabled()) { finish("cropped focus picker unavailable"); return; }
            const auto local = QPointF(player->width() * .48, player->height() * .5);
            const auto original = player->sourcePointAt(local.x(), local.y());
            const auto point = picker->mapToScene(local);
            mouse(QEvent::MouseButtonPress, point, Qt::LeftButton, Qt::LeftButton); mouse(QEvent::MouseButtonRelease, point, Qt::LeftButton, Qt::NoButton);
            if (!original["valid"].toBool() || std::abs(session->timeline()->selectedFocus()["focusX"].toDouble() - original["x"].toDouble()) > .001) { finish("cropped zoomed canvas did not store original source focus"); return; }
            if (!session->save()) { finish("crop save failed"); return; }
            const auto saved = Render::loadProject(session->projectDirectory());
            if (!saved.valid || Render::sourceCropFromSettings(saved.settings).normalizedRect() != QRectF(.2, .2, .5, .6)) { finish("saved crop differs from editor"); return; }
            result.insert("croppedFocusCanvasPickAndSave", true);
            window->grabWindow().save(output + "/editor-cropped-focus.png"); next();
        } else if (stage == 20) {
            // Exercise the real presentation texture path with an IOSurface,
            // independently of screen capture permissions and recorded playback.
            CVPixelBufferRef buffer = nullptr;
            NSDictionary *attributes = @{(id)kCVPixelBufferIOSurfacePropertiesKey: @{}, (id)kCVPixelBufferMetalCompatibilityKey: @YES};
            if (CVPixelBufferCreate(kCFAllocatorDefault, 200, 100, kCVPixelFormatType_32BGRA, (__bridge CFDictionaryRef)attributes, &buffer) != kCVReturnSuccess) { finish("synthetic IOSurface unavailable"); return; }
            CVPixelBufferLockBaseAddress(buffer, 0);
            auto *bytes = static_cast<unsigned char *>(CVPixelBufferGetBaseAddress(buffer));
            const auto stride = CVPixelBufferGetBytesPerRow(buffer);
            for (int y = 0; y < 100; ++y) for (int x = 0; x < 200; ++x) {
                auto *pixel = bytes + y * stride + x * 4;
                pixel[0] = x >= 100 ? 255 : 0; pixel[1] = x < 100 ? 255 : 0; pixel[2] = 0; pixel[3] = 255;
            }
            CVPixelBufferUnlockBaseAddress(buffer, 0); gpuFrames.publish(buffer); CVPixelBufferRelease(buffer);
            gpuWindow = std::make_unique<QQuickWindow>(); gpuWindow->setGeometry(180, 180, 200, 200); gpuWindow->setColor(Qt::black);
            gpuSurface = new VideoSurface(gpuWindow->contentItem()); gpuSurface->setWidth(200); gpuSurface->setHeight(200);
            gpuSurface->setFrameStore(&gpuFrames); gpuSurface->setSourceCropRect({.5, 0, .5, 1}); gpuWindow->show(); next();
        } else if (stage == 21) {
            if (clock.elapsed() - stageStart < 400) return;
            const auto picture = gpuWindow->grabWindow();
            if (gpuWindow->rendererInterface()->graphicsApi() != QSGRendererInterface::Metal || picture.isNull() || picture.pixelColor(picture.width() / 2, picture.height() / 2).blue() < 240 || picture.pixelColor(4, 4).blue() < 240) { finish("Metal crop did not sample right blue half at cropped aspect"); return; }
            picture.save(output + "/metal-crop-blue.png"); gpuSurface->setSourceCropRect({0, 0, .5, 1}); next();
        } else if (stage == 22) {
            if (clock.elapsed() - stageStart < 400) return;
            const auto picture = gpuWindow->grabWindow();
            if (picture.isNull() || picture.pixelColor(picture.width() / 2, picture.height() / 2).green() < 240 || picture.pixelColor(4, 4).green() < 240) { finish("Metal crop change did not update existing texture coordinates"); return; }
            picture.save(output + "/metal-crop-green.png"); result.insert("metalCropAndSameFrameUpdate", true);
            gpuWindow->close(); finish(); return;
        } else if (stage == 23) {
            if (player->playing() && clock.elapsed() - stageStart < 8000) return;
            const double duration = clock.elapsed() - stageStart;
            player->pause(); heartbeat.stop();
            auto metrics = QJsonObject::fromVariantMap(player->playbackMetrics());
            metrics.insert("elapsedMs", duration);
            metrics.insert("deliveredFrames", int(deliveryGaps.size() + 1));
            metrics.insert("deliveredFps", (deliveryGaps.size() + 1) * 1000.0 / duration);
            metrics.insert("deliveryMedianMs", percentile(deliveryGaps, .5));
            metrics.insert("deliveryP95Ms", percentile(deliveryGaps, .95));
            metrics.insert("deliveryMaxMs", percentile(deliveryGaps, 1));
            metrics.insert("steadyDeliveredFps", warmDeliveryCount * 1000.0 / std::max(1.0, duration - 1000));
            metrics.insert("guiHeartbeatP95Ms", percentile(heartbeatGaps, .95));
            metrics.insert("guiHeartbeatMaxMs", percentile(heartbeatGaps, 1));
            metrics.insert("swapP95Ms", percentile(swapGaps, .95));
            metrics.insert("canvasWidth", player->frameSize().width());
            metrics.insert("canvasHeight", player->frameSize().height());
            metrics.insert("finalSourceMs", player->frameTimeMs());
            result.insert("performance", metrics);
            if (requireSmoothPreview && (metrics.value("deliveredFps").toDouble() < 50
                || metrics.value("deliveryP95Ms").toDouble() > 40
                || metrics.value("guiHeartbeatP95Ms").toDouble() > 24)) {
                finish("preview missed the explicit smooth-playback acceptance thresholds"); return;
            }
            if (!playbackCheck) { finish(); return; }
            session->timeline()->reset();
            if (!session->timeline()->splitAt(1000) || !session->timeline()->splitAt(3000)
                || !session->timeline()->setSpeed(0, 1000, 2)) { finish("playback test edits failed"); return; }
            session->timeline()->selectSegment(2);
            if (!session->timeline()->reorderSelection(0)) { finish("playback reorder failed"); return; }
            session->timeline()->clearSelection(); session->timeline()->setPlayheadMs(0);
            next();
        } else if (stage == 24) {
            if (player->loading() || std::abs(player->frameTimeMs() - 3000) > 50) return;
            player->resetPlaybackMetrics(); player->play(); next();
        } else if (stage == 25) {
            const double position = session->timeline()->playheadMs();
            if (position + 1 < lastEditedPlayhead) { finish("edited output clock moved backwards"); return; }
            lastEditedPlayhead = position;
            if (player->playing()) return;
            if (std::abs(position - session->timeline()->outputDurationMs()) > 1) { finish("edited playback stopped before end"); return; }
            if (std::abs(player->frameTimeMs() - 3000) > 80) return;
            const auto metrics = player->playbackMetrics();
            if (metrics.value("seeks").toInt() != 1) { finish("contiguous speed change caused extra seek or reordered cut missed seek"); return; }
            result.insert("reorderedAndSpeedPlayback", QJsonObject::fromVariantMap(metrics));
            result.insert("editedPlaybackReachedEnd", true);
            player->play(); next();
        } else if (stage == 26) {
            if (session->timeline()->playheadMs() < 250 || player->frameTimeMs() < 3200) return;
            result.insert("restartAfterEnd", player->playing()); player->pause();
            session->timeline()->setPlayheadMs(1200);
            session->timeline()->setPlayheadMs(200);
            session->timeline()->setPlayheadMs(900);
            next();
        } else if (stage == 27) {
            if (std::abs(player->frameTimeMs() - 3900) > 50) return;
            if (player->playing()) { finish("rapid seek did not pause playback"); return; }
            result.insert("asyncPlaybackRapidSeek", true); finish(); return;
        } else if (stage == 28) {
            const double elapsed = clock.elapsed() - stageStart;
            if (player->loading()) { finish("appearance drag entered animation loading"); return; }
            const double fraction = .5 + .3 * std::sin(elapsed * .002);
            sliderPoint = paddingSlider->mapToScene(QPointF(7 + fraction * (paddingSlider->width() - 14), paddingSlider->height() / 2));
            mouse(QEvent::MouseMove, sliderPoint, Qt::NoButton, Qt::LeftButton); ++dragMoves;
            if (elapsed < 3000) return;
            mouse(QEvent::MouseButtonRelease, sliderPoint, Qt::LeftButton, Qt::NoButton);
            finalAppearance = session->settingsStore()->current(); next();
        } else if (stage == 29) {
            if (player->displayedOptions() != finalAppearance) return;
            result.insert("dragMoves", dragMoves); result.insert("framesWhileDragging", dragFrames);
            result.insert("dragFps", dragFrames / 3.0);
            result.insert("releaseToFinalFrameMs", clock.elapsed() - stageStart);
            result.insert("dragMetrics", QJsonObject::fromVariantMap(player->playbackMetrics()));
            result.insert("appearanceLatencyP95Ms", percentile(appearanceLatency, .95));
            result.insert("guiHeartbeatP95Ms", percentile(heartbeatGaps, .95));
            if (dragFrames < 45 || player->playbackMetrics()["preparations"].toInt() != 0
                || player->playbackMetrics()["seeks"].toInt() != 0
                || player->renderedFrame() == originalAppearanceFrame
                || finalAppearance["backgroundPaddingRatio"] == originalAppearance["backgroundPaddingRatio"]
                || clock.elapsed() - stageStart > 200
                || percentile(heartbeatGaps, .95) > 24) { finish("continuous slider drag missed live-preview acceptance"); return; }
            session->settingsStore()->replaceCurrent(originalAppearance); next();
        } else if (stage == 30) {
            if (player->displayedOptions() != originalAppearance) return;
            if (player->renderedFrame() != originalAppearanceFrame) { finish("restoring appearance changed preview pixels"); return; }
            result.insert("restoredFramePixelIdentical", true);
            player->resetPlaybackMetrics(); player->play(); next();
        } else if (stage == 31) {
            if (!player->playing()) { finish("appearance edit paused playback"); return; }
            const double elapsed = clock.elapsed() - stageStart;
            const double phase = .5 + .5 * std::sin(elapsed * .003);
            session->settingsStore()->setInteractiveCurrent("insetSize", phase * 16);
            session->settingsStore()->setInteractiveCurrent("windowBorderRadius", phase * 48);
            session->settingsStore()->setInteractiveCurrent("shadowDistance", phase * 40);
            session->settingsStore()->setInteractiveCurrent("shadowIntensity", .25 + phase * .5);
            if (elapsed < 3000) return;
            result.insert("playbackDuringAppearance", QJsonObject::fromVariantMap(player->playbackMetrics()));
            if (player->playbackMetrics()["preparations"].toInt() != 0 || player->playbackMetrics()["seeks"].toInt() != 0
                || player->playbackMetrics()["frames"].toInt() < 60 || session->timeline()->playheadMs() < 2700) {
                finish("playing preview stalled or rebuilt its animation during appearance edits"); return;
            }
            player->pause(); finalAppearance = session->settingsStore()->current(); next();
        } else if (stage == 32) {
            if (player->displayedOptions() != finalAppearance) return;
            if (!session->save()) { finish("pending interactive settings were not saved"); return; }
            const auto reopened = Render::loadProject(session->projectDirectory());
            if (reopened.settings["insetSize"] != finalAppearance["insetSize"]) { finish("interactive settings did not persist"); return; }
            result.insert("interactiveSave", true); finish(); return;
        } else if (stage == 6) {
            if (capturedProject.isEmpty()) return;
            const auto project = Render::loadProject(capturedProject);
            if (!project.valid) { finish(project.error); return; }
            result.insert("recordingFinalized", true);
            result.insert("recordedProject", capturedProject);
            result.insert("recordedDurationMs", project.durationMs);
            const auto *active = registry->activeSession();
            if (!active || active->projectDirectory() != capturedProject) { finish("recording did not auto-open editor"); return; }
            window = registry->windowAt(registry->activeWindowId());
            auto *recordedPlayer = findPlayer(window->contentItem());
            if (!recordedPlayer || !recordedPlayer->hasFrame() || recordedPlayer->loading()) return;
            result.insert("recordingAutoOpened", true);
            window->grabWindow().save(output + "/recording-opened.png");
            finish();
        }
    }
};
}
void startEditorVerification(QApplication *app, Render::EditorSessionRegistry *registry, MacCapture *capture, QuickScreenshot *screenshot) {
    const QStringList args = app->arguments();
    auto *check = new Check(app, registry, capture, screenshot);
    const int index = args.indexOf("--verify-editor");
    const int out = args.indexOf("--verification-output");
    check->output = out >= 0 ? args.value(out + 1) : QString();
    if (index < 0 || args.value(index + 1).isEmpty() || check->output.isEmpty()) {
        check->finish("--verify-editor PROJECT --verification-output DIR are required"); return;
    }
    QDir().mkpath(check->output);
    check->recordingCheck = args.contains("--verify-recording");
    check->timelineCheck = args.contains("--verify-timeline");
    check->focusCheck = args.contains("--verify-focus");
    check->cropCheck = args.contains("--verify-crop");
    check->performanceCheck = args.contains("--verify-performance");
    check->playbackCheck = args.contains("--verify-playback");
    check->requireSmoothPreview = args.contains("--require-smooth-preview");
    check->appearanceCheck = args.contains("--verify-appearance");
    check->session = registry->openProject(args.value(index + 1), true);
    if (!check->session) { check->finish("synthetic project failed to open"); return; }
    QObject::connect(capture, &MacCapture::recordingReady, check, [check](const QString &project) { check->capturedProject = project; });
    QObject::connect(capture, &MacCapture::recordingFailed, check, [check](const QString &error) { check->finish(error); });
    QObject::connect(screenshot, &QuickScreenshot::finished, check, [check](bool ok) {
        const QImage image(check->screenshot->lastPath());
        if (!ok || image.isNull() || QApplication::clipboard()->image().isNull()) {
            check->finish("native screenshot or clipboard failed: " + check->screenshot->status()); return;
        }
        check->screenshotFinished = true;
        check->result.insert("screenshotSavedAndCopied", true);
        check->result.insert("screenshotPath", check->screenshot->lastPath());
    });
    check->timer.setInterval(100);
    QObject::connect(&check->timer, &QTimer::timeout, check, [check] { check->poll(); });
    check->clock.start(); check->timer.start();
}
