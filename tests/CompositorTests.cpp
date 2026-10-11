// Compositor checks.
//
// These build a small synthetic project on disk (the same file layout the
// recorder writes) and verify the parts that are easy to get subtly wrong: the
// media-time → source-frame mapping, cursor shape selection, camera framing and
// the composited image itself. A real 124 s recording is used as a smoke test
// when one is available, because synthetic data cannot catch "the pipeline runs
// but the output is black".
#include "../src/render/ProjectCompositor.h"
#include "../src/animation/AnimationSettings.h"
#include "../src/capture/CaptureSource.h"

#include <QCoreApplication>
#include <QDir>
#include <QFile>
#include <QImage>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QTemporaryDir>
#include <cmath>
#include <iostream>
#include <stdexcept>

using namespace Render;

namespace {
void require(bool condition, const char *message) {
    if (!condition) throw std::runtime_error(message);
}
bool close(double a, double b, double tolerance = 1e-6) {
    return std::abs(a - b) <= tolerance;
}
QByteArray line(const QJsonObject &object) {
    return QJsonDocument(object).toJson(QJsonDocument::Compact) + '\n';
}
void write(const QString &path, const QByteArray &data) {
    QDir().mkpath(QFileInfo(path).absolutePath());
    QFile file(path);
    require(file.open(QIODevice::WriteOnly), "fixture open");
    require(file.write(data) == data.size(), "fixture write");
    file.close();
}

// A 4×4 red PNG standing in for a recorded cursor shape.
QImage cursorImage() {
    QImage image(4, 4, QImage::Format_ARGB32_Premultiplied);
    image.fill(QColor(255, 0, 0, 255));
    return image;
}

struct Fixture {
    QTemporaryDir dir;
    QString root;
    QString cursorId = QStringLiteral("cursor-a");

    bool build() {
        if (!dir.isValid())
            return false;
        root = dir.path();
        require(cursorImage().save(root + "/cursor-a.png"), "cursor png");

        const QJsonObject manifest{
            {"schemaVersion", 1},
            {"application", "Jianku Screen"},
            {"source", QJsonObject{{"type", "display"}, {"displayId", 1},
                {"widthPx", 1000}, {"heightPx", 500},
                {"globalBoundsPoints", QJsonObject{{"x", 0}, {"y", 0},
                    {"width", 500}, {"height", 250}}}}},
            {"settings", QJsonObject{
                {"outputAspectRatio", "auto"},
                {"backgroundPaddingRatio", 10.0},
                {"windowBorderRadius", 12.0},
                {"insetSize", 0.0},
                {"shadowIntensity", 0.0},
                {"backgroundBlur", 0.0},
                {"backgroundType", "color"},
                {"backgroundColor", "#102030"},
                {"cursorSize", 2.0},
                {"defaultZoomLevel", 2.0},
                {"snapToEdgesRatio", 0.25},
                {"autoZoom", true},
                {"mouseMovementSpring", QJsonObject{{"stiffness", 470.0},
                    {"damping", 70.0}, {"mass", 3.0}}},
                {"screenMovementSpring", QJsonObject{{"stiffness", 200.0},
                    {"damping", 40.0}, {"mass", 2.25}}}}},
            {"video", QJsonObject{{"file", "raw.mp4"},
                {"durationNs", QString::number(2000LL * 1000000LL)},
                {"mediaZeroHostTimeNs", "1000"}, {"frameCount", 4}}},
        };
        write(root + "/project.json", QJsonDocument(manifest).toJson());

        // Four frames at 0/500/1000/1500 ms.
        QByteArray frames;
        for (int i = 0; i < 4; ++i) {
            frames += line(QJsonObject{{"mediaTimeNs", QString::number(qint64(i) * 500000000LL)},
                {"displayHostTimeNs", QString::number(1000 + qint64(i) * 500000000LL)},
                {"displayTimeAvailable", true}});
        }
        write(root + "/video-frames.jsonl", frames);

        // One click at 600 ms, plus a pre-roll event that must be ignored.
        QByteArray events;
        events += line(QJsonObject{{"type", "mouseMoved"}, {"mediaTimeNs", "-100000000"},
            {"withinVideo", false}, {"xPx", 1}, {"yPx", 1}});
        events += line(QJsonObject{{"type", "mouseMoved"}, {"mediaTimeNs", "400000000"},
            {"withinVideo", true}, {"xPx", 200}, {"yPx", 100}});
        events += line(QJsonObject{{"type", "mouseDown"}, {"mediaTimeNs", "600000000"},
            {"withinVideo", true}, {"xPx", 300}, {"yPx", 150}});
        events += line(QJsonObject{{"type", "mouseUp"}, {"mediaTimeNs", "700000000"},
            {"withinVideo", true}, {"xPx", 300}, {"yPx", 150}});
        write(root + "/pointer-timeline.jsonl", events);

        QByteArray observations;
        observations += line(QJsonObject{{"mediaTimeNs", "-50000000"}, {"withinVideo", false},
            {"available", true}, {"cursorId", cursorId}});
        observations += line(QJsonObject{{"mediaTimeNs", "0"}, {"withinVideo", true},
            {"available", true}, {"cursorId", cursorId}});
        write(root + "/cursor-timeline.jsonl", observations);

        write(root + "/cursors.json", QJsonDocument(QJsonObject{{cursorId, QJsonObject{
            {"image", "cursor-a.png"}, {"widthPx", 4}, {"heightPx", 4},
            {"hotSpotXPx", 0}, {"hotSpotYPx", 0}}}}).toJson());
        write(root + "/automatic-zooms.json", QJsonDocument(QJsonObject{
            {"ranges", QJsonArray{QJsonObject{
                {"startTimeMs", 500.0}, {"endTimeMs", 1500.0}, {"zoom", 2.0},
                {"snapToEdgesRatio", 0.25}, {"isDisabled", false}}}}}).toJson());

        // A tiny placeholder; the compositor only checks that it exists, the
        // smoke test below uses a real recording.
        write(root + "/raw.mp4", QByteArray("not a real video"));
        return true;
    }
};
} // namespace

int main(int argc, char **argv) {
    QCoreApplication app(argc, argv);
    try {
        Fixture fixture;
        require(fixture.build(), "fixture builds");

        // --- loading ------------------------------------------------------
        QString error;
        ProjectData project = loadProject(fixture.root, &error);
        require(project.valid, "project loads");
        require(close(project.durationMs, 2000.0), "duration read");
        require(project.frameMediaMs.size() == 4, "frame timeline read");
        require(project.events.size() == 3, "pre-roll events are excluded");
        require(project.cursorObservations.size() == 1, "in-video cursor observations kept");
        require(project.zoomRanges.size() == 1, "zoom range read");
        require(close(project.zoomRanges.front().zoom, 2.0), "zoom level read");

        // The compositor only needs the frame size; pointer events were already
        // mapped into frame pixels when they were recorded. A window or region
        // manifest therefore composites without knowing its source kind — but it
        // does carry extra fields, and those must not upset the loader.
        {
            QString manifest = QString::fromUtf8([&] {
                QFile file(fixture.root + "/project.json");
                if (!file.open(QIODevice::ReadOnly))
                    throw std::runtime_error("manifest open");
                return file.readAll();
            }());
            QJsonParseError parseError;
            const QJsonObject original = QJsonDocument::fromJson(manifest.toUtf8(),
                &parseError).object();
            const QJsonObject source = original.value(QStringLiteral("source")).toObject();

            // A region source as MacCapture now writes it: clipped rect, kind and
            // label included, and a size that is not the display's.
            QJsonObject regionSource = source;
            regionSource.insert(QStringLiteral("type"), QStringLiteral("region"));
            regionSource.insert(QStringLiteral("label"), QStringLiteral("区域"));
            regionSource.insert(QStringLiteral("regionPoints"), QJsonObject{
                {QStringLiteral("x"), 400.0}, {QStringLiteral("y"), 200.0},
                {QStringLiteral("width"), 500.0}, {QStringLiteral("height"), 250.0}});
            QJsonObject rebuilt = original;
            rebuilt.insert(QStringLiteral("source"), regionSource);
            write(fixture.root + "/project.json", QJsonDocument(rebuilt).toJson());

            const ProjectData regionProject = loadProject(fixture.root, &error);
            require(regionProject.valid, "a region-source manifest loads");
            require(close(regionProject.sourceSize.width(), 1000.0)
                    && close(regionProject.sourceSize.height(), 500.0),
                "the frame size comes from widthPx/heightPx, not the display");
            require(regionProject.events.size() == project.events.size(),
                "events are unaffected by the source kind");

            // The manifest itself still round-trips through the shared parser.
            bool kindOk = false;
            const Capture::CaptureSource parsed = Capture::CaptureSource::fromJson(regionSource, &kindOk);
            require(kindOk && parsed.kind == Capture::SourceKind::Region,
                "the recorded source block is a valid region description");
            require(parsed.regionPoints == QRectF(400.0, 200.0, 500.0, 250.0),
                "the recorded region rect matches the frame it was captured with");

            write(fixture.root + "/project.json", QJsonDocument(original).toJson());
            require(loadProject(fixture.root, &error).valid, "fixture restored");
        }

        // Legacy projects stored `"microphone": true` because an NSDictionary was
        // handed to QJsonObject::insert and silently became a bool. The loader has
        // to understand both shapes or those recordings look like they have no
        // microphone at all.
        {
            require(!project.microphone.present, "no microphone.m4a on disk means no track");
            require(close(project.microphoneDelayMs(), 0.0), "no offset without a microphone");

            write(fixture.root + "/microphone.m4a", QByteArray("placeholder"));
            // Rebuild the manifest in its legacy bool form.
            QString manifest = QString::fromUtf8([&] {
                QFile file(fixture.root + "/project.json");
                if (!file.open(QIODevice::ReadOnly))
                    throw std::runtime_error("manifest open");
                return file.readAll();
            }());
            const int marker = manifest.indexOf(QStringLiteral("\"video\""));
            require(marker > 0, "manifest has a video section");
            manifest.insert(marker, QStringLiteral("\"microphone\": true, "));
            write(fixture.root + "/project.json", manifest.toUtf8());
            const ProjectData legacyProject = loadProject(fixture.root, &error);
            require(legacyProject.valid, "legacy manifest still loads");
            require(legacyProject.microphone.present,
                "a bare `true` still finds microphone.m4a");
            require(!legacyProject.microphone.startKnown,
                "the legacy form has no start time to align with");
            require(close(legacyProject.microphoneDelayMs(), 0.0),
                "an unknown start time yields no offset");

            // New form: the recorder stamps the host clock.
            const QJsonObject modern{{"microphone", QJsonObject{
                {"file", "microphone.m4a"}, {"durationMs", 2000.0},
                {"startHostTimeNs", "1600000"}}}};
            QJsonParseError parseError;
            QJsonObject rebuilt = QJsonDocument::fromJson(
                QByteArray(manifest.toUtf8()), &parseError).object();
            rebuilt.insert(QStringLiteral("microphone"), modern.value(QStringLiteral("microphone")));
            write(fixture.root + "/project.json", QJsonDocument(rebuilt).toJson());
            const ProjectData modernProject = loadProject(fixture.root, &error);
            require(modernProject.valid
                    && modernProject.microphone.present
                    && modernProject.microphone.startKnown,
                "the modern manifest keeps the microphone track info");
            // mediaZeroHostTimeNs is 1000, microphone started at 1600000 ns.
            require(close(modernProject.microphoneDelayMs(), 1.599),
                "the offset is measured against the first video frame");
            require(fixture.build() && loadProject(fixture.root, &error).valid,
                "fixture restored");
            project = loadProject(fixture.root, &error);
        }

        {
            ProjectData missing = loadProject(fixture.root + "/nope");
            require(!missing.valid && !missing.error.isEmpty(), "missing project fails loudly");
        }
        {
            write(fixture.root + "/pointer-timeline.jsonl", "{broken}\n");
            ProjectData broken = loadProject(fixture.root, &error);
            require(!broken.valid, "a corrupt event line fails the load");
            require(fixture.build(), "fixture rebuilt");
            project = loadProject(fixture.root, &error);
            require(project.valid, "project loads again");
        }

        // --- context ------------------------------------------------------
        ComposeContext context = makeComposeContext(project,
            QStringLiteral(JIANKU_SOURCE_DIR "/assets/backgrounds"));
        require(context.valid, "context builds");
        require(context.width() == 1000 && context.height() == 500, "auto canvas keeps source size");
        require(close(context.layout().padding, 50.0), "padding is 10% of the canvas short side");
        // padded box = 900×400; a 2:1 source contained in it is height-limited.
        require(close(context.layout().contentRect.height(), 400.0), "content fills the padded height");
        require(close(context.layout().contentRect.width(), 800.0), "content keeps aspect ratio");
        require(close(context.layout().contentRect.center().x(), context.width() / 2.0),
            "content stays centred");
        const ComposeContext smaller = makeComposeContext(project, {}, {}, 250);
        require(smaller.valid && close(smaller.settings.canvas.radius, context.settings.canvas.radius / 2),
            "a smaller preview scales corner radius with the canvas");
        require(close(smaller.settings.canvas.shadowDistance, context.settings.canvas.shadowDistance / 2),
            "a smaller export keeps shadow proportions");

        // --- cursor shape selection ---------------------------------------
        {
            const CursorDefinition *first = cursorAt(project, 0.0);
            const CursorDefinition *later = cursorAt(project, 1900.0);
            require(first && later, "cursor resolves across the clip");
            require(first->id == fixture.cursorId, "cursor id matches");
            require(close(first->widthPx, 4.0), "cursor metrics read");
            require(cursorAt(project, -10000.0) == first,
                "before the first observation the first shape is used");
        }

        // --- camera framing -------------------------------------------------
        {
            const double snap = 0.25;
            const CameraPose idle = AnimationSequence::cameraTargetAt(project, 0.0, snap);
            require(close(idle.scale, 1.0) && close(idle.offsetX, 0.0) && close(idle.offsetY, 0.0),
                "outside a zoom range the camera is at rest");

            const CameraPose zoomed = AnimationSequence::cameraTargetAt(project, 1000.0, snap);
            require(close(zoomed.scale, 2.0), "inside the range the camera is at the range zoom");
            require(zoomed.offsetX <= 0.0 && zoomed.offsetY <= 0.0,
                "the camera never exposes space outside the source");
            require(zoomed.offsetX >= -1000.0 && zoomed.offsetY >= -500.0,
                "the camera stays inside the source");
        }

        // --- frame rendering ------------------------------------------------
        {
            QImage source(1000, 500, QImage::Format_ARGB32_Premultiplied);
            source.fill(QColor(0, 255, 0));

            const CursorPose cursor{200.0, 100.0, 1.0, 0.0, 1.0};
            const QImage canvas = composeFrame(context, source, CameraPose{1.0, 0.0, 0.0},
                cursor, 1000.0, true);
            require(!canvas.isNull(), "frame composes");
            require(canvas.width() == 1000 && canvas.height() == 500, "frame size matches the canvas");

            // Background shows at the canvas edge, content sits inside the padding.
            require(canvas.pixelColor(2, 250) != QColor(0, 255, 0), "background fills the padding");
            const QPoint inside = context.layout().contentRect.center().toPoint();
            require(canvas.pixelColor(inside) == QColor(0, 255, 0), "source is drawn in the frame");

            const QImage withoutCursor = composeFrame(context, source, CameraPose{1.0, 0.0, 0.0},
                cursor, 1000.0, false);
            require(withoutCursor != canvas, "the pointer changes the composed frame");
            require(std::abs(withoutCursor.pixelColor(inside).red() - 0)
                    <= std::abs(canvas.pixelColor(inside).red() - 0),
                "the pointer does not replace the source underneath it");

            // A camera zoom must actually change the pixels.
            const QImage zoomedFrame = composeFrame(context, source, CameraPose{2.0, -100.0, -50.0},
                cursor, 1000.0, true);
            require(zoomedFrame != canvas, "the camera transform changes the frame");
        }

        // --- animation sequence --------------------------------------------
        // Stepped at 60 fps like the real loop: the springs are causal, so
        // jumping straight to a later time would only show the old target.
        {
            Animation::DriverSettings driver;
            AnimationSequence sequence(project, driver.screenSpring, driver.cursor);
            const double step = 1000.0 / 60.0;
            double peak = 1.0;
            for (double t = 0.0; t <= 2000.0; t += step) {
                const CameraPose pose = sequence.cameraAt(t);
                require(pose.scale >= 1.0 - 1e-9, "the camera never zooms out past the full view");
                peak = std::max(peak, pose.scale);
            }
            require(peak > 1.5, "the camera actually zooms inside the range");
            // The reference screen spring is underdamped, so the camera does
            // overshoot its target slightly. Bound it rather than forbidding it:
            // a runaway overshoot means the integrator is wrong, a few tenths of
            // a percent is the spring being a spring.
            require(peak <= 2.0 * 1.02, "the camera overshoot stays within a few percent");

            // Let it settle, then confirm it returns to the full view.
            for (double t = 2000.0; t <= 6000.0; t += step)
                sequence.cameraAt(t);
            const CameraPose settled = sequence.cameraAt(6000.0);
            require(close(settled.scale, 1.0, 1e-3), "sequence returns to the full view");
            require(close(settled.offsetX, 0.0, 1e-3) && close(settled.offsetY, 0.0, 1e-3),
                "sequence recentres");
        }

        // --- mix levels come from the project --------------------------------
        // The two volume sliders existed in the settings page and in every project
        // manifest, and nothing read them: an export used 1.0 regardless, so moving
        // either slider changed nothing. This pins the mapping.
        {
            Fixture fixture;
            require(fixture.build(), "fixture");
            const QString path = fixture.root + "/project.json";
            QFile file(path);
            require(file.open(QIODevice::ReadOnly), "read manifest");
            QJsonObject manifest = QJsonDocument::fromJson(file.readAll()).object();
            file.close();
            QJsonObject settings = manifest.value(QStringLiteral("settings")).toObject();
            settings.insert(QStringLiteral("systemAudioVolume"), 0.4);
            settings.insert(QStringLiteral("audioVolume"), 0.25);
            manifest.insert(QStringLiteral("settings"), settings);
            write(path, QJsonDocument(manifest).toJson());

            QString loadError;
            const ProjectData loaded = loadProject(fixture.root, &loadError);
            require(loaded.valid, "the edited manifest still loads");
            const ComposeContext mixed = makeComposeContext(loaded,
                QStringLiteral(JIANKU_SOURCE_DIR "/assets/backgrounds"));
            require(mixed.valid, "context builds");
            require(close(mixed.settings.systemAudioVolume, 0.4), "the system level is read");
            require(close(mixed.settings.microphoneVolume, 0.25), "the microphone level is read");

            // Out-of-range values are clamped rather than passed to ffmpeg: a negative
            // volume would invert the waveform instead of silencing it.
            settings.insert(QStringLiteral("systemAudioVolume"), -3.0);
            settings.insert(QStringLiteral("audioVolume"), 99.0);
            manifest.insert(QStringLiteral("settings"), settings);
            write(path, QJsonDocument(manifest).toJson());
            const ComposeContext clamped = makeComposeContext(loadProject(fixture.root), {});
            require(clamped.valid, "context builds");
            require(close(clamped.settings.systemAudioVolume, 0.0), "a negative level clamps to 0");
            require(close(clamped.settings.microphoneVolume, 4.0), "an absurd level clamps to 4");
            write(path, QJsonDocument(manifest).toJson());
        }

        // --- real recording smoke test (only when one is present) ------------
#ifndef JIANKU_SMOKE_PROJECT
#define JIANKU_SMOKE_PROJECT ""
#endif
        {
            const QString smoke = QStringLiteral(JIANKU_SMOKE_PROJECT);
            if (!smoke.isEmpty() && QFileInfo::exists(smoke + "/project.json")) {
                ProjectData real = loadProject(smoke, &error);
                require(real.valid, "real recording loads");
                ComposeContext realContext = makeComposeContext(real,
                    QStringLiteral(JIANKU_SOURCE_DIR "/assets/backgrounds"));
                require(realContext.valid, "real recording context builds");
                require(realContext.width() > 0 && realContext.height() > 0, "real canvas size");
                std::cout << "real recording: " << realContext.width() << "x" << realContext.height()
                          << ", " << real.frameMediaMs.size() << " frames, "
                          << real.events.size() << " events, "
                          << real.cursors.size() << " cursor shapes, "
                          << real.zoomRanges.size() << " zoom ranges\n";
            } else {
                std::cout << "real recording smoke test skipped (no fixture at "
                          << JIANKU_SMOKE_PROJECT << ")\n";
            }
        }

        std::cout << "compositor checks passed\n";
        return 0;
    } catch (const std::exception &error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
