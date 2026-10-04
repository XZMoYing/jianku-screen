#include "ProjectCompositor.h"

#include "../animation/AnimationSettings.h"
#include "../animation/AutoFocusEngine.h"

#include <QCoreApplication>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QLinearGradient>
#include <QPainter>
#include <QPainterPath>
#include <QProcess>
#include <QStandardPaths>
#include <algorithm>
#include <cmath>

namespace Render {
namespace {

QString readTextFile(const QString &path, QString *error) {
    QFile file(path);
    if (!file.open(QIODevice::ReadOnly)) {
        if (error)
            *error = QStringLiteral("无法读取 %1：%2").arg(path, file.errorString());
        return {};
    }
    return QString::fromUtf8(file.readAll());
}

bool parseJson(const QString &text, QJsonDocument *document, const QString &path, QString *error) {
    QJsonParseError parseError;
    *document = QJsonDocument::fromJson(text.toUtf8(), &parseError);
    if (parseError.error != QJsonParseError::NoError) {
        if (error)
            *error = QStringLiteral("%1 不是合法 JSON：%2").arg(path, parseError.errorString());
        return false;
    }
    return true;
}

// Every JSONL file in a project is a flat list of objects; one broken line makes
// the recording untrustworthy, so the whole load fails instead of silently
// dropping events (which would desynchronise the pointer).
bool readJsonLines(const QString &path, std::vector<QJsonObject> *rows, QString *error) {
    QFile file(path);
    if (!file.open(QIODevice::ReadOnly)) {
        if (error)
            *error = QStringLiteral("无法读取 %1：%2").arg(path, file.errorString());
        return false;
    }
    qint64 lineNumber = 0;
    while (!file.atEnd()) {
        const QByteArray line = file.readLine().trimmed();
        ++lineNumber;
        if (line.isEmpty())
            continue;
        QJsonParseError parseError;
        const QJsonDocument document = QJsonDocument::fromJson(line, &parseError);
        if (parseError.error != QJsonParseError::NoError || !document.isObject()) {
            if (error)
                *error = QStringLiteral("%1 第 %2 行损坏").arg(path).arg(lineNumber);
            return false;
        }
        rows->push_back(document.object());
    }
    if (file.error() != QFileDevice::NoError) {
        if (error)
            *error = QStringLiteral("读取 %1 失败：%2").arg(path, file.errorString());
        return false;
    }
    return true;
}

double number(const QJsonObject &object, const char *key, double fallback = 0.0) {
    const QJsonValue value = object.value(QLatin1String(key));
    if (value.isDouble())
        return value.toDouble();
    if (value.isString()) {
        bool ok = false;
        const double parsed = value.toString().toDouble(&ok);
        if (ok)
            return parsed;
    }
    return fallback;
}

Animation::InputKind kindFor(const QString &type) {
    if (type == QStringLiteral("mouseDown"))
        return Animation::InputKind::Down;
    if (type == QStringLiteral("mouseUp"))
        return Animation::InputKind::Up;
    if (type == QStringLiteral("mouseDragged"))
        return Animation::InputKind::Drag;
    return Animation::InputKind::Move;
}

} // namespace

ProjectData loadProject(const QString &directory, QString *errorOut) {
    ProjectData data;
    data.directory = directory;
    auto fail = [&](const QString &message) {
        data.valid = false;
        data.error = message;
        if (errorOut)
            *errorOut = message;
        return data;
    };

    QString error;
    const QString manifestText = readTextFile(directory + QStringLiteral("/project.json"), &error);
    if (manifestText.isEmpty())
        return fail(error);
    QJsonDocument manifestDocument;
    if (!parseJson(manifestText, &manifestDocument, QStringLiteral("project.json"), &error))
        return fail(error);
    const QJsonObject manifest = manifestDocument.object();
    data.settings = manifest.value(QStringLiteral("settings")).toObject().toVariantMap();
    data.createdAt = manifest.value(QStringLiteral("createdAt")).toString();

    const QJsonObject source = manifest.value(QStringLiteral("source")).toObject();
    data.sourceSize = QSizeF(source.value(QStringLiteral("widthPx")).toDouble(),
        source.value(QStringLiteral("heightPx")).toDouble());
    if (data.sourceSize.width() <= 0.0 || data.sourceSize.height() <= 0.0)
        return fail(QStringLiteral("project.json 缺少有效的来源尺寸"));

    const QJsonObject video = manifest.value(QStringLiteral("video")).toObject();
    data.videoFile = video.value(QStringLiteral("file")).toString();
    if (data.videoFile.isEmpty())
        return fail(QStringLiteral("project.json 缺少视频文件名"));
    if (!QFileInfo::exists(directory + QLatin1Char('/') + data.videoFile))
        return fail(QStringLiteral("找不到原始视频：") + data.videoFile);
    data.durationMs = number(video, "durationNs") / 1e6;
    if (!(data.durationMs > 0.0))
        return fail(QStringLiteral("project.json 的时长无效"));
    data.mediaZeroHostNs = static_cast<qint64>(number(video, "mediaZeroHostTimeNs"));

    // The microphone is a separate track. Older recordings stored a bare `true`
    // here (an NSDictionary was handed to QJsonObject::insert and silently became
    // a bool), so both shapes are accepted and the file is found on disk.
    const QJsonValue microphoneValue = manifest.value(QStringLiteral("microphone"));
    if (microphoneValue.isObject()) {
        const QJsonObject microphone = microphoneValue.toObject();
        data.microphone.file = microphone.value(QStringLiteral("file")).toString();
        data.microphone.durationMs = number(microphone, "durationMs");
        const qint64 start = static_cast<qint64>(number(microphone, "startHostTimeNs"));
        data.microphone.startKnown = start > 0;
        data.microphone.startHostTimeNs = start;
    } else if (microphoneValue.isBool() && microphoneValue.toBool()) {
        data.microphone.file = QStringLiteral("microphone.m4a");
    }
    if (!data.microphone.file.isEmpty()) {
        const QString microphonePath = directory + QLatin1Char('/') + data.microphone.file;
        if (QFileInfo::exists(microphonePath)) {
            data.microphone.present = true;
        } else {
            // Declared but missing: keep it non-fatal, the video is still usable.
            data.microphone.file.clear();
        }
    }

    // Frames: the recorded media times are the reference for the timeline.
    std::vector<QJsonObject> frames;
    if (!readJsonLines(directory + QStringLiteral("/video-frames.jsonl"), &frames, &error))
        return fail(error);
    if (frames.empty())
        return fail(QStringLiteral("video-frames.jsonl 为空"));
    data.frameMediaMs.reserve(frames.size());
    for (const QJsonObject &frame : frames)
        data.frameMediaMs.push_back(number(frame, "mediaTimeNs") / 1e6);
    if (!std::is_sorted(data.frameMediaMs.begin(), data.frameMediaMs.end()))
        return fail(QStringLiteral("video-frames.jsonl 的时间戳没有递增"));

    // Events. `withinVideo` already excludes pre-roll and in-pause clicks.
    std::vector<QJsonObject> events;
    if (!readJsonLines(directory + QStringLiteral("/pointer-timeline.jsonl"), &events, &error))
        return fail(error);
    for (const QJsonObject &event : events) {
        const QString type = event.value(QStringLiteral("type")).toString();
        if (type != QStringLiteral("mouseMoved") && type != QStringLiteral("mouseDragged")
            && type != QStringLiteral("mouseDown") && type != QStringLiteral("mouseUp"))
            continue;
        if (!event.value(QStringLiteral("withinVideo")).toBool())
            continue;
        Animation::InputEvent input;
        input.timeMs = number(event, "mediaTimeNs") / 1e6;
        input.x = number(event, "xPx");
        input.y = number(event, "yPx");
        input.kind = kindFor(type);
        data.events.push_back(input);
    }

    std::vector<QJsonObject> observations;
    if (!readJsonLines(directory + QStringLiteral("/cursor-timeline.jsonl"), &observations, &error))
        return fail(error);
    for (const QJsonObject &observation : observations) {
        if (!observation.value(QStringLiteral("withinVideo")).toBool()
            || !observation.value(QStringLiteral("available")).toBool())
            continue;
        const QString id = observation.value(QStringLiteral("cursorId")).toString();
        if (id.isEmpty())
            continue;
        CursorObservation entry;
        entry.mediaTimeMs = number(observation, "mediaTimeNs") / 1e6;
        entry.cursorId = id;
        data.cursorObservations.push_back(entry);
    }

    const QString cursorsText = readTextFile(directory + QStringLiteral("/cursors.json"), &error);
    if (!cursorsText.isEmpty()) {
        QJsonDocument cursorsDocument;
        if (!parseJson(cursorsText, &cursorsDocument, QStringLiteral("cursors.json"), &error))
            return fail(error);
        const QJsonObject root = cursorsDocument.object();
        for (auto it = root.begin(); it != root.end(); ++it) {
            const QJsonObject entry = it.value().toObject();
            CursorDefinition definition;
            definition.id = it.key();
            definition.imagePath = directory + QLatin1Char('/')
                + entry.value(QStringLiteral("image")).toString();
            definition.widthPx = number(entry, "widthPx");
            definition.heightPx = number(entry, "heightPx");
            definition.hotspotXPx = number(entry, "hotSpotXPx");
            definition.hotspotYPx = number(entry, "hotSpotYPx");
            QImage image(definition.imagePath);
            if (image.isNull())
                continue;   // a shape we cannot draw is skipped, its events fall back
            definition.image = image.convertToFormat(QImage::Format_ARGB32_Premultiplied);
            if (definition.widthPx <= 0.0)
                definition.widthPx = definition.image.width();
            if (definition.heightPx <= 0.0)
                definition.heightPx = definition.image.height();
            data.cursors.insert(definition.id, definition);
        }
    }

    const QString zoomsText = readTextFile(directory + QStringLiteral("/automatic-zooms.json"), &error);
    if (!zoomsText.isEmpty()) {
        QJsonDocument zoomsDocument;
        if (!parseJson(zoomsText, &zoomsDocument, QStringLiteral("automatic-zooms.json"), &error))
            return fail(error);
        const QJsonArray ranges = zoomsDocument.object().value(QStringLiteral("ranges")).toArray();
        for (const QJsonValue &value : ranges) {
            const QJsonObject range = value.toObject();
            if (range.value(QStringLiteral("isDisabled")).toBool())
                continue;
            ZoomRangeEntry entry;
            entry.startMs = number(range, "startTimeMs");
            entry.endMs = number(range, "endTimeMs");
            entry.zoom = number(range, "zoom", 2.0);
            entry.snapToEdgesRatio = number(range, "snapToEdgesRatio", 0.25);
            if (entry.endMs > entry.startMs)
                data.zoomRanges.push_back(entry);
        }
        std::sort(data.zoomRanges.begin(), data.zoomRanges.end(),
            [](const ZoomRangeEntry &a, const ZoomRangeEntry &b) { return a.startMs < b.startMs; });
    }

    data.valid = true;
    if (errorOut)
        errorOut->clear();
    return data;
}

double ProjectData::microphoneDelayMs() const {
    if (!microphone.present || !microphone.startKnown || mediaZeroHostNs <= 0)
        return 0.0;
    // Both clocks fold out the same pauses, so the offset is constant. A negative
    // result (microphone started after the first frame) is kept as-is: it means
    // the track has to be advanced instead.
    return (microphone.startHostTimeNs - mediaZeroHostNs) / 1e6;
}

const CursorDefinition *cursorAt(const ProjectData &project, double mediaTimeMs) {    if (project.cursors.isEmpty())
        return nullptr;
    const CursorObservation *chosen = nullptr;
    for (const CursorObservation &observation : project.cursorObservations) {
        if (observation.mediaTimeMs <= mediaTimeMs)
            chosen = &observation;
        else
            break;
    }
    // Before the first observation the recording started with some shape; using
    // the first one avoids a cursor-less opening.
    if (!chosen && !project.cursorObservations.empty())
        chosen = &project.cursorObservations.front();
    if (!chosen)
        return nullptr;
    const auto it = project.cursors.constFind(chosen->cursorId);
    return it == project.cursors.constEnd() ? nullptr : &it.value();
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

void applyMotionBlurOverrides(MotionBlurSettings &settings, const MotionBlurSettings &overrides) {
    if (overrides.amount >= 0.0)
        settings.amount = overrides.amount;
    if (overrides.cursorAmount >= 0.0)
        settings.cursorAmount = overrides.cursorAmount;
    if (overrides.screenMoveAmount >= 0.0)
        settings.screenMoveAmount = overrides.screenMoveAmount;
    if (overrides.screenZoomAmount >= 0.0)
        settings.screenZoomAmount = overrides.screenZoomAmount;
    if (overrides.fps > 0.0)
        settings.fps = overrides.fps;
}

ComposeContext makeComposeContext(ProjectData project, const QString &backgroundRoot,
    const MotionBlurSettings &blurOverride, int resolutionOverride) {
    ComposeContext context;
    context.project = std::move(project);
    if (!context.project.valid) {
        context.error = context.project.error;
        return context;
    }

    const QVariantMap &map = context.project.settings;
    ComposerSettings &settings = context.settings;
    // One settings→style mapping, shared with the preview and the screenshot.
    settings.canvas = canvasStyleFromMap(map, backgroundRoot);
    settings.cursorSizeFactor = map.value(QStringLiteral("cursorSize"), 1.5).toDouble();
    settings.hideCursor = map.value(QStringLiteral("hideCursor")).toBool();

    // Motion blur: one global amount times a per-channel one, as the reference
    // stores them. Motion blur is off unless a project asks for it, so existing
    // recordings export exactly as before.
    // Mix levels, straight from the project. The compositor has always accepted them
    // on ComposeOptions, but nothing filled them in, so the disk settings page's two
    // volume sliders had no effect on any export.
    settings.systemAudioVolume = std::clamp(
        map.value(QStringLiteral("systemAudioVolume"), 1.0).toDouble(), 0.0, 4.0);
    settings.microphoneVolume = std::clamp(
        map.value(QStringLiteral("audioVolume"), 1.0).toDouble(), 0.0, 4.0);

    MotionBlurSettings &blur = settings.motionBlur;
    blur.amount = map.value(QStringLiteral("motionBlurAmount"), 0.0).toDouble();
    blur.cursorAmount = map.value(QStringLiteral("motionBlurCursorAmount"), 0.0).toDouble();
    blur.screenMoveAmount = map.value(QStringLiteral("motionBlurScreenMoveAmount"), 0.0).toDouble();
    blur.screenZoomAmount = map.value(QStringLiteral("motionBlurScreenZoomAmount"), 0.0).toDouble();
    blur.fps = map.value(QStringLiteral("motionBlurFps"), 60.0).toDouble();
    // The project's own settings are the base; the caller can override any of
    // them without having to restate the rest.
    MotionBlurSettings merged;
    merged.amount = blur.amount;
    merged.cursorAmount = blur.cursorAmount;
    merged.screenMoveAmount = blur.screenMoveAmount;
    merged.screenZoomAmount = blur.screenZoomAmount;
    merged.fps = blur.fps;
    applyMotionBlurOverrides(merged, blurOverride);
    blur = merged;

    // The canvas is fixed for an export (the output size), so the content is
    // contained inside it; the aspect ratio setting decides that size.
    context.canvasPlan = planCanvas(settings.canvas,
        canvasSizeForResolution(canvasSizeForAspect(context.project.sourceSize,
                map.value(QStringLiteral("outputAspectRatio")).toString()),
            resolutionOverride),
        context.project.sourceSize);
    if (!context.canvasPlan.valid) {
        context.error = context.canvasPlan.error;
        return context;
    }
    context.valid = true;
    return context;
}

// ---------------------------------------------------------------------------
// Animation
// ---------------------------------------------------------------------------

AnimationSequence::AnimationSequence(const ProjectData &project,
    const Animation::SpringConfig &screenSpring, const Animation::CursorSettings &cursorSettings)
    : project_(project), cursorSettings_(cursorSettings) {
    scale_.setConfig(screenSpring);
    offsetX_.setConfig(screenSpring);
    offsetY_.setConfig(screenSpring);
    cursor_.setSettings(cursorSettings_);
    Animation::EventTrack track;
    track.setEvents(project.events);
    cursor_.setTrack(std::move(track));
}

CameraPose AnimationSequence::cameraTargetAt(const ProjectData &project, double mediaTimeMs,
    double snapFallback) {
    const ZoomRangeEntry *active = nullptr;
    for (const ZoomRangeEntry &range : project.zoomRanges) {
        if (mediaTimeMs >= range.startMs && mediaTimeMs <= range.endMs) {
            active = &range;
            break;
        }
    }
    if (!active || active->zoom <= 1.0)
        return CameraPose{1.0, 0.0, 0.0};

    // Grouping and framing come from the shared auto-focus engine, so the offline
    // camera lands exactly where the analysis said it would.
    Animation::ZoomRange range;
    range.startMs = active->startMs;
    range.endMs = active->endMs;
    range.zoom = active->zoom;
    const double snap = active->snapToEdgesRatio > 0.0 ? active->snapToEdgesRatio : snapFallback;
    const Animation::FocusPoint focus = Animation::AutoFocusEngine::focusAt(range,
        project.events, project.sourceSize.width(), project.sourceSize.height(), mediaTimeMs, snap);
    const Animation::ScreenTransform transform = Animation::AutoFocusEngine::transformFor(focus,
        active->zoom, project.sourceSize.width(), project.sourceSize.height(),
        project.sourceSize.width(), project.sourceSize.height(), snap);
    return CameraPose{transform.scale, transform.offsetX, transform.offsetY};
}

CameraPose AnimationSequence::cameraAt(double mediaTimeMs) {
    const double snap = project_.settings.value(QStringLiteral("snapToEdgesRatio"), 0.25).toDouble();
    const CameraPose target = cameraTargetAt(project_, mediaTimeMs, snap);

    if (!started_) {
        scale_.reset(target.scale);
        offsetX_.reset(target.offsetX);
        offsetY_.reset(target.offsetY);
        timeMs_ = mediaTimeMs;
        started_ = true;
        cursor_.resetAt(mediaTimeMs);
        return target;
    }
    const double delta = mediaTimeMs - timeMs_;
    if (delta > 0.0) {
        scale_.advanceBy(delta);
        offsetX_.advanceBy(delta);
        offsetY_.advanceBy(delta);
    }
    timeMs_ = mediaTimeMs;
    scale_.setTargetValue(target.scale);
    offsetX_.setTargetValue(target.offsetX);
    offsetY_.setTargetValue(target.offsetY);
    return CameraPose{scale_.value(), offsetX_.value(), offsetY_.value()};
}

CursorPose AnimationSequence::cursorAt(double mediaTimeMs) {
    const Animation::CursorPose pose = cursor_.advanceTo(mediaTimeMs);
    return CursorPose{pose.x, pose.y, pose.clickScale, pose.rotationDeg, pose.alpha};
}

// ---------------------------------------------------------------------------
// Motion blur
// ---------------------------------------------------------------------------

namespace {

// The boundary of the camera layer on the canvas: the frame rectangle scaled and
// translated by the camera. Its centre displacement and diagonal are what the
// reference compares to decide move vs zoom — measured on what the viewer sees,
// not on the spring's raw velocity.
MotionBlur::LayerMotion screenMotion(const ComposeContext &context, const CameraPose &previous,
    const CameraPose &current) {
    const QRectF frame = context.layout().frameRect;
    const double fit = context.layout().fitScale;
    auto centreAt = [&](const CameraPose &camera) {
        return frame.center() + QPointF(camera.offsetX * fit, camera.offsetY * fit);
    };
    MotionBlur::LayerMotion motion;
    motion.centre = centreAt(current);
    motion.centreDelta = centreAt(current) - centreAt(previous);
    motion.diagonal = std::hypot(frame.width(), frame.height()) * current.scale;
    motion.previousDiagonal = std::hypot(frame.width(), frame.height()) * previous.scale;
    return motion;
}

// The pointer's own boundary, in canvas pixels. Its size follows the camera (the
// pointer lives inside the zoomed layer), so a pure camera move changes its centre
// by exactly the camera's own displacement — which is what subtractParentMotion
// then removes.
MotionBlur::LayerMotion cursorMotion(const ComposeContext &context, const CursorDefinition &shape,
    const CameraPose &previousCamera, const CursorPose &previousCursor, const CameraPose &camera,
    const CursorPose &cursor) {
    const CanvasLayout &layout = context.layout();
    const QRectF frame = layout.frameRect;
    const double fit = layout.fitScale;
    const double size = std::max(2.0, shape.widthPx * fit * context.settings.cursorSizeFactor);
    auto centreAt = [&](const CameraPose &cam, const CursorPose &pose) {
        // Matches how composeFrame places the pointer: inside the frame, then
        // carried by the camera transform.
        const QPointF inFrame(layout.contentRect.x() - frame.x() + pose.x * fit,
            layout.contentRect.y() - frame.y() + pose.y * fit);
        return frame.topLeft() + QPointF(cam.offsetX * fit, cam.offsetY * fit)
            + (inFrame + QPointF(size / 2.0, size / 2.0)) * cam.scale;
    };
    MotionBlur::LayerMotion motion;
    motion.centre = centreAt(camera, cursor);
    motion.centreDelta = centreAt(camera, cursor) - centreAt(previousCamera, previousCursor);
    const double diagonal = size * std::hypot(1.0, 1.0);
    motion.diagonal = diagonal * camera.scale;
    motion.previousDiagonal = diagonal * previousCamera.scale;
    return motion;
}

} // namespace

BlurPlan planBlur(const ComposeContext &context, const CameraPose &previousCamera,
    const CursorPose &previousCursor, const CameraPose &camera, const CursorPose &cursor,
    double mediaTimeMs, bool includeCursor) {
    BlurPlan plan;
    const ComposerSettings &settings = context.settings;
    const MotionBlurSettings &blur = settings.motionBlur;
    if (!(blur.amount > 0.0))
        return plan;
    const double fpsFactor = blur.fps / 60.0;

    const MotionBlur::LayerMotion screen = screenMotion(context, previousCamera, camera);
    const MotionBlur::Decision screenDecision = MotionBlur::decide(screen,
        blur.amount, blur.screenMoveAmount, blur.screenZoomAmount, fpsFactor);
    plan.screen.channel = screenDecision.channel;
    plan.screen.moveVector = screenDecision.moveVector;
    plan.screen.zoomStrength = screenDecision.zoomStrength;
    // The blur centre for a zoom is the frame centre as drawn, so the smear runs
    // radially out of (or into) what the viewer is looking at.
    plan.screen.zoomCentre = screen.centre;

    // The pointer only blurs when it is actually drawn: a hidden or fading
    // pointer leaving a smear would be visible motion for something invisible.
    const bool cursorVisible = includeCursor && !settings.hideCursor && cursor.alpha > 0.01;
    const CursorDefinition *shape = cursorAt(context.project, mediaTimeMs);
    if (!cursorVisible || !shape)
        return plan;
    MotionBlur::LayerMotion child = cursorMotion(context, *shape, previousCamera, previousCursor,
        camera, cursor);
    // The reference subtracts the parent's motion from the child's and cancels any
    // axis that then opposes the parent. Without it a pointer being carried by a
    // panning camera would smear twice.
    const MotionBlur::LayerMotion parent = screenMotion(context, previousCamera, camera);
    child.centreDelta = MotionBlur::subtractParentMotion(child.centreDelta, parent.centreDelta);
    const MotionBlur::Decision cursorDecision = MotionBlur::decide(child,
        blur.amount, blur.cursorAmount, 0.0, fpsFactor);
    plan.cursor.channel = cursorDecision.channel;
    plan.cursor.moveVector = cursorDecision.moveVector;
    plan.cursor.zoomStrength = cursorDecision.zoomStrength;
    plan.cursor.zoomCentre = child.centre;
    return plan;
}

// ---------------------------------------------------------------------------
// Frame rendering
// ---------------------------------------------------------------------------

QImage composeFrame(const ComposeContext &context, const QImage &source,
    const CameraPose &camera, const CursorPose &cursor, double mediaTimeMs, bool includeCursor,
    const BlurPlan *blur) {
    if (!context.valid || source.isNull())
        return {};

    const ComposerSettings &settings = context.settings;
    const CanvasLayout &layout = context.layout();
    const QSize canvasSize(context.width(), context.height());
    const QRectF frameRect = layout.frameRect;
    const double fitScale = layout.fitScale;

    QImage canvas(canvasSize, QImage::Format_ARGB32_Premultiplied);
    canvas.fill(Qt::transparent);

    QPainter painter(&canvas);
    painter.setRenderHint(QPainter::Antialiasing);
    painter.setRenderHint(QPainter::SmoothPixmapTransform);
    // Background is static: it never moves with the camera, so it is drawn once
    // and is deliberately not part of any blur.
    painter.drawImage(0, 0, context.canvasPlan.background);

    // With the camera at rest the whole composition sits exactly on the layout
    // the preview and the screenshot use; the transform only ever moves it.
    const double cameraX = camera.offsetX * fitScale;
    const double cameraY = camera.offsetY * fitScale;

    // Shadow first: offset along the configured angle, behind the frame. Unlike the
    // preview it follows the camera, because here the frame really does move.
    if (settings.canvas.shadowIntensity > 0.001 && !context.canvasPlan.shadow.isNull()) {
        const QImage &shadow = context.canvasPlan.shadow;
        const double radians = settings.canvas.shadowAngle * M_PI / 180.0;
        const QPointF offset(std::cos(radians) * settings.canvas.shadowDistance,
            std::sin(radians) * settings.canvas.shadowDistance);
        painter.save();
        painter.translate(frameRect.topLeft() + QPointF(cameraX, cameraY));
        painter.scale(camera.scale, camera.scale);
        painter.translate(offset);
        painter.translate(-(shadow.width() - frameRect.width()) / 2.0,
            -(shadow.height() - frameRect.height()) / 2.0);
        painter.drawImage(0, 0, shadow);
        painter.restore();
    }

    // The screen layer and the pointer are rendered separately because each is
    // blurred on its own: the reference gives the pointer its own strength, and
    // subtracting the parent's motion only makes sense if the two are distinct
    // layers. Both are drawn in canvas coordinates so a blur vector in canvas
    // pixels means what it says.
    QImage screenLayer(canvasSize, QImage::Format_ARGB32_Premultiplied);
    screenLayer.fill(Qt::transparent);
    QPainter screenPainter(&screenLayer);
    screenPainter.setRenderHint(QPainter::Antialiasing);
    screenPainter.setRenderHint(QPainter::SmoothPixmapTransform);
    screenPainter.translate(frameRect.topLeft() + QPointF(cameraX, cameraY));
    screenPainter.scale(camera.scale, camera.scale);

    QPainterPath framePath;
    framePath.addRoundedRect(QRectF(0.0, 0.0, frameRect.width(), frameRect.height()),
        settings.canvas.radius, settings.canvas.radius);
    screenPainter.setClipPath(framePath);
    screenPainter.fillPath(framePath, QColor(QString::fromLatin1(kFrameColor)));

    // layout.contentRect is in canvas coordinates; shift it into frame-local.
    const QRectF contentRect(layout.contentRect.x() - frameRect.x(),
        layout.contentRect.y() - frameRect.y(),
        layout.contentRect.width(), layout.contentRect.height());
    screenPainter.drawImage(contentRect, source);

    // Inset border: drawn on the frame edge, inside the rounded corners. Same
    // helper the screenshot path uses, so the two cannot drift.
    drawInsetBorder(screenPainter, context.canvasPlan);
    screenPainter.end();

    if (blur && blur->screen.channel == MotionBlur::Channel::Move)
        screenLayer = MotionBlur::applyMove(screenLayer, blur->screen.moveVector);
    else if (blur && blur->screen.channel == MotionBlur::Channel::Zoom)
        screenLayer = MotionBlur::applyZoom(screenLayer, blur->screen.zoomCentre,
            blur->screen.zoomStrength);
    painter.drawImage(0, 0, screenLayer);

    // Pointer overlay. It lives inside the camera-scaled frame, exactly like the
    // preview, so the pointer grows with the zoom instead of staying a fixed size.
    const CursorDefinition *definition = cursorAt(context.project, mediaTimeMs);
    if (includeCursor && !settings.hideCursor && definition && !definition->image.isNull()
        && cursor.alpha > 0.001) {
        // The preview sizes the pointer in screen points and stretches the image
        // to that box; here everything is in source pixels, so use the pixel
        // metrics and let the canvas scale handle the rest.
        const double baseWidth = std::max(2.0, definition->widthPx * fitScale * settings.cursorSizeFactor);
        const double baseHeight = std::max(2.0, definition->heightPx * fitScale * settings.cursorSizeFactor);
        const double hotspotX = definition->hotspotXPx / std::max(1.0, definition->widthPx);
        const double hotspotY = definition->hotspotYPx / std::max(1.0, definition->heightPx);

        // The pointer is drawn into its own layer so the blur only touches the
        // pointer, never the screen underneath it.
        QImage cursorLayer(canvasSize, QImage::Format_ARGB32_Premultiplied);
        cursorLayer.fill(Qt::transparent);
        QPainter cursorPainter(&cursorLayer);
        cursorPainter.setRenderHint(QPainter::Antialiasing);
        cursorPainter.setRenderHint(QPainter::SmoothPixmapTransform);
        cursorPainter.translate(frameRect.topLeft() + QPointF(cameraX, cameraY));
        cursorPainter.scale(camera.scale, camera.scale);
        cursorPainter.translate(contentRect.x() + cursor.x * fitScale,
            contentRect.y() + cursor.y * fitScale);
        // Rotation and the click feedback both pivot on the hotspot.
        cursorPainter.translate(-hotspotX * baseWidth, -hotspotY * baseHeight);
        if (std::abs(cursor.rotationDeg) > 0.001)
            cursorPainter.rotate(cursor.rotationDeg);
        if (std::abs(cursor.scale - 1.0) > 0.001) {
            cursorPainter.translate(hotspotX * baseWidth, hotspotY * baseHeight);
            cursorPainter.scale(cursor.scale, cursor.scale);
            cursorPainter.translate(-hotspotX * baseWidth, -hotspotY * baseHeight);
        }
        cursorPainter.setOpacity(std::clamp(cursor.alpha, 0.0, 1.0));
        cursorPainter.drawImage(QRectF(0.0, 0.0, baseWidth, baseHeight), definition->image);
        cursorPainter.end();

        if (blur && blur->cursor.channel == MotionBlur::Channel::Move)
            cursorLayer = MotionBlur::applyMove(cursorLayer, blur->cursor.moveVector);
        else if (blur && blur->cursor.channel == MotionBlur::Channel::Zoom)
            cursorLayer = MotionBlur::applyZoom(cursorLayer, blur->cursor.zoomCentre,
                blur->cursor.zoomStrength);
        painter.drawImage(0, 0, cursorLayer);
    }

    painter.end();
    return canvas;
}

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

QString findFfmpeg() {
    // The bundle first, so a packaged build works on a machine that has never installed
    // Homebrew: `scripts/package-dmg.sh` copies ffmpeg and its whole dylib closure into
    // Resources/bin and rewrites the install names to @executable_path. Preferring it also
    // means a shipped build uses the ffmpeg it was tested against rather than whatever the
    // user happens to have on PATH.
    const QString bundled = QDir(QCoreApplication::applicationDirPath())
        .filePath(QStringLiteral("../Resources/bin/ffmpeg"));
    if (QFileInfo(bundled).isExecutable())
        return QDir::cleanPath(bundled);

    QStringList candidates{
        QStringLiteral("/opt/homebrew/bin/ffmpeg"),
        QStringLiteral("/usr/local/bin/ffmpeg"),
        QStringLiteral("/usr/bin/ffmpeg")};
    const QByteArray home = qgetenv("HOME");
    if (!home.isEmpty())
        candidates.prepend(QString::fromLocal8Bit(home) + QStringLiteral("/homebrew/bin/ffmpeg"));
    for (const QString &candidate : candidates) {
        if (QFileInfo(candidate).isExecutable())
            return candidate;
    }
    const QString found = QStandardPaths::findExecutable(QStringLiteral("ffmpeg"));
    return found.isEmpty() ? QStringLiteral("ffmpeg") : found;
}

QString findFfprobe(const QString &ffmpeg) {
    if (!ffmpeg.isEmpty()) {
        const QFileInfo info(ffmpeg);
        if (info.isFile()) {
            const QString sibling = info.absolutePath() + QStringLiteral("/ffprobe");
            if (QFileInfo(sibling).isExecutable())
                return sibling;
        }
    }
    const QString found = QStandardPaths::findExecutable(QStringLiteral("ffprobe"));
    return found.isEmpty() ? QStringLiteral("ffprobe") : found;
}

namespace {

QString videoPath(const ProjectData &project) {
    return project.directory + QLatin1Char('/') + project.videoFile;
}

// Index of the source frame that should be on screen at `mediaTimeMs`: the last
// frame whose recorded media time is at or before it.
qint64 frameIndexAt(const std::vector<double> &frameMediaMs, double mediaTimeMs) {
    if (frameMediaMs.empty())
        return -1;
    const auto it = std::upper_bound(frameMediaMs.begin(), frameMediaMs.end(), mediaTimeMs);
    if (it == frameMediaMs.begin())
        return 0;
    return std::distance(frameMediaMs.begin(), it) - 1;
}

} // namespace

ComposeResult composeProject(const ComposeOptions &options, const ComposeProgress &progress) {
    ComposeResult result;
    result.outputPath = options.outputPath;

    QString error;
    ProjectData project = loadProject(options.projectDirectory, &error);
    if (!project.valid) {
        result.error = error;
        return result;
    }

    ComposeContext context = makeComposeContext(project, options.backgroundRoot,
        options.motionBlur, options.exportHeight);
    if (!context.valid) {
        result.error = context.error;
        return result;
    }
    if (!options.includeAutoZoom)
        context.project.zoomRanges.clear();

    // The edit timeline defines the output clock. Without one the output is the
    // whole recording in real time, which is the same thing expressed as a single
    // segment — so there is only one code path here, not two.
    Project::EditTimeline timeline = options.timeline;
    if (!timeline.valid()) {
        timeline = Project::EditTimeline::whole(context.project.durationMs);
        // A fixed order, so the meaning of the operations does not depend on how
        // they were typed: retime first (it only changes playback rate), then cut,
        // then trim. Cuts and trims are expressed on the clock as it stands at that
        // point in the sequence.
        for (const EditOperation &edit : options.edits) {
            switch (edit.kind) {
            case EditKind::Speed:
                if (!timeline.setSpeed(edit.fromMs, edit.toMs, edit.value)) {
                    result.error = QStringLiteral("变速失败（%1..%2 ms，%3×）：%4")
                        .arg(edit.fromMs).arg(edit.toMs).arg(edit.value).arg(timeline.error());
                    return result;
                }
                break;
            case EditKind::Cut:
                if (!timeline.remove(edit.fromMs, edit.toMs)) {
                    result.error = QStringLiteral("删除区间失败（%1..%2 ms）：%3")
                        .arg(edit.fromMs).arg(edit.toMs).arg(timeline.error());
                    return result;
                }
                break;
            case EditKind::TrimStart:
                if (!timeline.trimStart(edit.fromMs)) {
                    result.error = QStringLiteral("裁掉开头失败（%1 ms）：%2")
                        .arg(edit.fromMs).arg(timeline.error());
                    return result;
                }
                break;
            case EditKind::TrimEnd:
                if (!timeline.trimEnd(edit.toMs)) {
                    result.error = QStringLiteral("裁掉结尾失败（%1 ms）：%2")
                        .arg(edit.toMs).arg(timeline.error());
                    return result;
                }
                break;
            }
        }
    }
    if (!timeline.valid()) {
        result.error = timeline.error();
        return result;
    }
    context.timeline = timeline;

    const double outputDuration = timeline.outputDurationMs();
    // `startMs` is an output-time offset: it exists so a smoke test can render a
    // few seconds out of the middle without decoding from the beginning.
    const double startMs = std::clamp(options.startMs, 0.0, std::max(0.0, outputDuration - 1.0));
    const int fps = std::clamp(options.fps, 1, 240);
    qint64 totalFrames = static_cast<qint64>(std::llround((outputDuration - startMs) * fps / 1000.0));
    if (options.maxOutputFrames > 0)
        totalFrames = std::min<qint64>(totalFrames, options.maxOutputFrames);
    if (totalFrames <= 0) {
        result.error = QStringLiteral("输出帧数为零");
        return result;
    }

    result.width = context.width();
    result.height = context.height();
    result.durationMs = outputDuration - startMs;
    result.sourceFrames = static_cast<qint64>(context.project.frameMediaMs.size());
    result.timelineSegments = static_cast<qint64>(timeline.segments().size());
    result.timelineIdentity = timeline.isIdentity();

    if (result.outputPath.isEmpty())
        result.outputPath = context.project.directory + QStringLiteral("/composed.mp4");
    const QString temporaryPath = result.outputPath + QStringLiteral(".part.mp4");

    const Animation::DriverSettings driver =
        Animation::driverSettingsFromMap(context.project.settings);
    AnimationSequence sequence(context.project, driver.screenSpring, driver.cursor);

    // --- decoder -----------------------------------------------------------
    QProcess decoder;
    decoder.setProcessChannelMode(QProcess::SeparateChannels);
    QStringList decoderArgs{
        QStringLiteral("-v"), QStringLiteral("error"),
        QStringLiteral("-i"), videoPath(context.project),
        QStringLiteral("-fps_mode"), QStringLiteral("passthrough"),
        QStringLiteral("-f"), QStringLiteral("rawvideo"),
        QStringLiteral("-pix_fmt"), QStringLiteral("bgra"),
        QStringLiteral("-")
    };
    decoder.start(options.ffmpegPath, decoderArgs);
    if (!decoder.waitForStarted(10000)) {
        result.error = QStringLiteral("无法启动 ffmpeg 解码：") + decoder.errorString();
        return result;
    }

    // --- encoder -----------------------------------------------------------
    // Input 0 is the composited video arriving on stdin. The recorded tracks are
    // additional inputs: 1 is the system audio inside raw.mp4, 2 (when present)
    // is microphone.m4a.
    //
    // With only the system track the audio can be stream-copied. Mixing in the
    // microphone needs a real filter graph, so that path re-encodes the audio
    // once — there is no way to combine two AAC streams without decoding them.
    const bool useMicrophone = options.includeAudio && options.includeMicrophone
        && context.project.microphone.present;
    const double microphoneDelayMs = context.project.microphoneDelayMs();
    result.microphoneMuxed = useMicrophone;
    result.microphoneDelayMs = useMicrophone ? microphoneDelayMs : 0.0;

    QProcess encoder;
    QStringList encoderArgs{
        QStringLiteral("-v"), QStringLiteral("error"),
        QStringLiteral("-f"), QStringLiteral("rawvideo"),
        QStringLiteral("-pix_fmt"), QStringLiteral("bgra"),
        QStringLiteral("-s"), QStringLiteral("%1x%2").arg(result.width).arg(result.height),
        QStringLiteral("-r"), QString::number(fps),
        QStringLiteral("-i"), QStringLiteral("-")
    };
    if (options.includeAudio)
        encoderArgs << QStringLiteral("-i") << videoPath(context.project);
    if (useMicrophone) {
        // A microphone that started after the first frame is trimmed instead of
        // delayed: adelay cannot pull a track earlier.
        if (microphoneDelayMs < -1.0)
            encoderArgs << QStringLiteral("-ss")
                        << QString::number(-microphoneDelayMs / 1000.0, 'f', 6);
        encoderArgs << QStringLiteral("-i")
                    << context.project.directory + QLatin1Char('/') + context.project.microphone.file;
    }
    encoderArgs << QStringLiteral("-map") << QStringLiteral("0:v:0");
    // The caller may override the levels (the CLI does); otherwise the project's own
    // values are used. The project's are clamped when the context is built.
    const double systemVolume = options.systemAudioVolume >= 0.0
        ? options.systemAudioVolume : context.settings.systemAudioVolume;
    const double microphoneVolume = options.microphoneVolume >= 0.0
        ? options.microphoneVolume : context.settings.microphoneVolume;
    if (options.includeAudio && !useMicrophone)
        encoderArgs << QStringLiteral("-map") << QStringLiteral("1:a:0?");
    if (useMicrophone) {
        // Hold the microphone back by the measured offset so it lands on the same
        // clock as the video, then mix. normalize=0 keeps the levels as recorded
        // instead of halving both tracks the way amix does by default.
        const qint64 holdMs = microphoneDelayMs > 0.0 ? qint64(std::llround(microphoneDelayMs)) : 0;
        const QString graph = QStringLiteral(
            "[1:a]volume=%1[sys];"
            "[2:a]adelay=%2:all=1,volume=%3[mic];"
            "[sys][mic]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0[aout]")
            .arg(systemVolume, 0, 'f', 3)
            .arg(holdMs)
            .arg(microphoneVolume, 0, 'f', 3);
        encoderArgs << QStringLiteral("-filter_complex") << graph
                    << QStringLiteral("-map") << QStringLiteral("[aout]");
    }
    encoderArgs << QStringLiteral("-c:v") << QStringLiteral("libx264")
                << QStringLiteral("-preset") << QStringLiteral("veryfast")
                << QStringLiteral("-crf") << QStringLiteral("18")
                << QStringLiteral("-pix_fmt") << QStringLiteral("yuv420p")
                << QStringLiteral("-movflags") << QStringLiteral("+faststart");
    if (options.includeAudio) {
        if (useMicrophone) {
            encoderArgs << QStringLiteral("-c:a") << QStringLiteral("aac")
                        << QStringLiteral("-b:a") << QStringLiteral("192k");
        } else {
            // Do NOT add -shortest: the source audio is a little shorter than the
            // video timeline (audio buffers stop when the last frame is written),
            // and -shortest would trim the video down to the audio length,
            // silently dropping the last frames.
            encoderArgs << QStringLiteral("-c:a") << QStringLiteral("copy");
        }
    }
    encoderArgs << QStringLiteral("-y") << temporaryPath;

    encoder.start(options.ffmpegPath, encoderArgs);
    if (!encoder.waitForStarted(10000)) {
        decoder.kill();
        decoder.waitForFinished(5000);
        result.error = QStringLiteral("无法启动 ffmpeg 编码：") + encoder.errorString();
        return result;
    }

    // --- compose loop ------------------------------------------------------
    const qint64 bytesPerFrame = qint64(result.width) * result.height * 4;
    QByteArray buffer;
    buffer.resize(static_cast<int>(bytesPerFrame));
    QImage sourceFrame;
    qint64 sourceIndex = -1;
    QString failure;
    QByteArray encoderStderr;
    QByteArray decoderStderr;
    // The blur of frame N is derived from the difference between frame N-1's pose
    // and frame N's, so the previous pose has to survive the loop iteration.
    CameraPose previousCamera;
    CursorPose previousCursor;
    bool havePreviousPose = false;

    // ffmpeg's stderr must be drained continuously. It is a pipe like any other:
    // letting it fill up blocks ffmpeg, and never reading it means the failure
    // message is missing exactly when it is needed.
    auto drainStderr = [&] {
        encoderStderr.append(encoder.readAllStandardError());
        decoderStderr.append(decoder.readAllStandardError());
    };

    // Qt buffers everything handed to write() in the parent process, and
    // waitForBytesWritten() only waits for that buffer to be flushed to the pipe
    // *once* — it returns instantly afterwards. Without an explicit ceiling the
    // buffer grows as fast as we can composite, which at 26.9 MB per 3360x2100
    // BGRA frame reached 82 GB and got the process OOM-killed by the kernel.
    auto waitForEncoderDrain = [&]() -> bool {
        const qint64 ceiling = bytesPerFrame * 2;
        while (encoder.bytesToWrite() > ceiling) {
            if (!encoder.waitForBytesWritten(30000)) {
                drainStderr();
                failure = QStringLiteral("编码器写入停滞（仍有 %1 字节未写出）")
                    .arg(encoder.bytesToWrite());
                return false;
            }
            drainStderr();
        }
        return true;
    };

    auto pullSourceFrame = [&]() -> bool {
        qint64 read = 0;
        while (read < bytesPerFrame) {
            drainStderr();
            if (!failure.isEmpty())
                return false;
            if (!decoder.waitForReadyRead(30000) && decoder.bytesAvailable() == 0) {
                failure = QStringLiteral("解码原始视频时中断（已读 %1/%2 字节）")
                    .arg(read).arg(bytesPerFrame);
                return false;
            }
            const qint64 got = decoder.read(buffer.data() + read, bytesPerFrame - read);
            if (got <= 0) {
                failure = QStringLiteral("原始视频帧数少于时间轴记录（第 %1 帧）").arg(sourceIndex + 2);
                return false;
            }
            read += got;
        }
        sourceFrame = QImage(reinterpret_cast<const uchar *>(buffer.constData()),
            result.width, result.height, result.width * 4, QImage::Format_ARGB32_Premultiplied).copy();
        ++sourceIndex;
        return true;
    };

    for (qint64 frame = 0; frame < totalFrames; ++frame) {
        if (options.shouldCancel && options.shouldCancel()) {
            result.error = QStringLiteral("导出已取消");
            result.cancelled = true;
            break;
        }
        // Output clock → media clock. The source time is non-decreasing across the
        // whole output timeline (segments stay in recording order), so the decoder
        // only ever has to move forward and never seeks.
        const double outputMs = startMs + frame * 1000.0 / fps;
        const double mediaTimeMs = timeline.sourceTimeAt(outputMs);
        const qint64 wantedSource = frameIndexAt(context.project.frameMediaMs, mediaTimeMs);
        // A cut can skip source frames ahead; a slow-down repeats the same one. Only
        // moving backwards is impossible, because segments stay in recording order —
        // so the decoder never has to seek.
        while (sourceIndex < wantedSource) {
            if (!pullSourceFrame()) {
                result.error = failure;
                break;
            }
        }
        if (!result.error.isEmpty())
            break;

        const CameraPose camera = sequence.cameraAt(mediaTimeMs);
        const CursorPose cursor = sequence.cursorAt(mediaTimeMs);
        // Blur comes from the difference between the two poses on either side of
        // this frame, so it is planned before the frame is drawn and persists
        // across the loop rather than being recomputed from scratch each time.
        const BlurPlan blur = havePreviousPose
            ? planBlur(context, previousCamera, previousCursor, camera, cursor, mediaTimeMs,
                  options.includeCursor)
            : BlurPlan{};
        previousCamera = camera;
        previousCursor = cursor;
        havePreviousPose = true;
        const QImage canvas = composeFrame(context, sourceFrame, camera, cursor, mediaTimeMs,
            options.includeCursor, blur.empty() ? nullptr : &blur);
        if (canvas.isNull()) {
            result.error = QStringLiteral("第 %1 帧合成失败").arg(frame);
            break;
        }

        if (!waitForEncoderDrain()) {
            result.error = failure;
            break;
        }
        const qint64 written = encoder.write(
            reinterpret_cast<const char *>(canvas.constBits()), bytesPerFrame);
        if (written != bytesPerFrame) {
            result.error = QStringLiteral("写入编码器失败（第 %1 帧）").arg(frame);
            break;
        }
        ++result.writtenFrames;
        if (progress && (frame % 60 == 0 || frame == totalFrames - 1))
            progress(result.writtenFrames, totalFrames);
    }
    drainStderr();

    // --- teardown ----------------------------------------------------------
    if (result.error.isEmpty()) {
        encoder.closeWriteChannel();
        if (!encoder.waitForFinished(-1)) {
            drainStderr();
            result.error = QStringLiteral("编码器未正常结束：") + encoder.errorString();
        } else {
            drainStderr();
            if (encoder.exitStatus() != QProcess::NormalExit || encoder.exitCode() != 0) {
                result.error = QStringLiteral("ffmpeg 编码失败：")
                    + QString::fromUtf8(encoderStderr).trimmed();
            }
        }
    } else {
        encoder.kill();
        encoder.waitForFinished(5000);
        drainStderr();
    }
    result.encoderLog = QString::fromUtf8(encoderStderr).trimmed();

    decoder.closeReadChannel(QProcess::StandardOutput);
    if (decoder.state() != QProcess::NotRunning) {
        decoder.closeWriteChannel();
        if (!decoder.waitForFinished(5000)) {
            decoder.kill();
            decoder.waitForFinished(5000);
        }
    }
    drainStderr();
    result.decoderLog = QString::fromUtf8(decoderStderr).trimmed();

    if (result.error.isEmpty()) {
        if (!QFileInfo::exists(temporaryPath) || QFileInfo(temporaryPath).size() == 0) {
            result.error = QStringLiteral("编码输出为空");
        } else if (!QFile::remove(result.outputPath) && QFileInfo::exists(result.outputPath)) {
            result.error = QStringLiteral("无法覆盖已有输出：") + result.outputPath;
        } else if (!QFile::rename(temporaryPath, result.outputPath)) {
            result.error = QStringLiteral("无法写入输出：") + result.outputPath;
        } else {
            result.audioMuxed = options.includeAudio;
            result.ok = true;
        }
    }
    if (!result.ok)
        QFile::remove(temporaryPath);
    if (result.cancelled)
        return result;

    // The video track is the authority: count the packets that actually landed in
    // the file so a trimmed or truncated export cannot pass as success. This is
    // what caught `-shortest` silently dropping the last frames.
    if (result.ok) {
        QProcess probe;
        probe.start(findFfprobe(options.ffmpegPath), {QStringLiteral("-v"), QStringLiteral("error"),
            QStringLiteral("-select_streams"), QStringLiteral("v:0"),
            QStringLiteral("-count_packets"),
            QStringLiteral("-show_entries"), QStringLiteral("stream=nb_read_packets"),
            QStringLiteral("-of"), QStringLiteral("csv=p=0"), result.outputPath});
        if (probe.waitForFinished(60000) && probe.exitCode() == 0) {
            bool ok = false;
            const qint64 counted = QString::fromUtf8(probe.readAllStandardOutput())
                .trimmed().toLongLong(&ok);
            if (ok && counted > 0)
                result.encodedFrames = counted;
        }
        if (result.encodedFrames > 0 && result.encodedFrames != result.writtenFrames) {
            result.error = QStringLiteral("输出帧数与合成帧数不一致（合成 %1，成片 %2）")
                .arg(result.writtenFrames).arg(result.encodedFrames);
            result.ok = false;
        }
    }
    return result;
}

} // namespace Render
