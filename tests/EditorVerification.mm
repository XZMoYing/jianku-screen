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
    QString focusId;
    QImage beforeFraming;
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
            if (beforeFraming == player->renderedFrame()) { finish("framing target did not change composited pixels"); return; }
            result.insert("focusPositionPadAndPixels", true); next();
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
