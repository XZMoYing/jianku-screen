// Export path checks.
//
// Covers the layer the UI actually talks to: ExportController must run the
// compositor off the GUI thread, report progress, and never claim success for an
// output that is missing or short. The fixture is a real (tiny) MP4 produced by
// ffmpeg, so the decode → compose → encode → verify chain runs end to end.
#include "../src/render/ExportController.h"

#include <QCoreApplication>
#include <QBuffer>
#include <QDir>
#include <QEventLoop>
#include <QFile>
#include <QFileInfo>
#include <QImage>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QProcess>
#include <QTemporaryDir>
#include <QTimer>
#include <iostream>
#include <stdexcept>
#include <cmath>
#include <cstring>

using namespace Render;

namespace {
void require(bool condition, const char *message) {
    if (!condition) throw std::runtime_error(message);
}
QByteArray line(const QJsonObject &object) {
    return QJsonDocument(object).toJson(QJsonDocument::Compact) + '\n';
}
void write(const QString &path, const QByteArray &data) {
    QDir().mkpath(QFileInfo(path).absolutePath());
    QFile file(path);
    require(file.open(QIODevice::WriteOnly), "fixture open");
    require(file.write(data) == data.size(), "fixture write");
}

QString ffmpegPath() {
    return findFfmpeg();
}

// 30 frames of 320x180 green, standing in for a recording.
bool makeSourceVideo(const QString &path) {
    QProcess ffmpeg;
    ffmpeg.start(ffmpegPath(), {QStringLiteral("-v"), QStringLiteral("error"),
        QStringLiteral("-f"), QStringLiteral("lavfi"),
        QStringLiteral("-i"), QStringLiteral("color=c=green:s=320x180:r=30:d=1"),
        QStringLiteral("-c:v"), QStringLiteral("libx264"),
        QStringLiteral("-pix_fmt"), QStringLiteral("yuv420p"),
        QStringLiteral("-y"), path});
    return ffmpeg.waitForFinished(60000) && ffmpeg.exitCode() == 0 && QFileInfo::exists(path);
}
} // namespace

int main(int argc, char **argv) {
    QCoreApplication app(argc, argv);
    try {
        QTemporaryDir directory;
        require(directory.isValid(), "temporary project");
        const QString root = directory.path();
        require(makeSourceVideo(root + "/raw.mp4"), "source video is produced by ffmpeg");
        write(root + "/cursor-a.png", [] {
            QImage image(4, 4, QImage::Format_ARGB32_Premultiplied);
            image.fill(QColor(255, 0, 0));
            QByteArray bytes;
            QBuffer buffer(&bytes);
            buffer.open(QIODevice::WriteOnly);
            image.save(&buffer, "PNG");
            return bytes;
        }());

        // The source is 30 frames over 1000 ms but the export runs at 60 fps, so
        // the compositor must hold each source frame for two output frames. That
        // is the point of this check: the file has to contain the full output
        // timeline, not the source frame count.
        constexpr qint64 kSourceFrames = 30;
        constexpr qint64 kOutputFrames = 60;
        QByteArray frames;
        for (int i = 0; i < kSourceFrames; ++i)
            frames += line(QJsonObject{{"mediaTimeNs", QString::number(qint64(i) * 33333333LL)},
                {"displayHostTimeNs", QString::number(1000 + qint64(i) * 33333333LL)},
                {"displayTimeAvailable", true}});
        write(root + "/video-frames.jsonl", frames);

        write(root + "/pointer-timeline.jsonl",
            line(QJsonObject{{"type", "mouseMoved"}, {"mediaTimeNs", "0"},
                {"withinVideo", true}, {"xPx", 100}, {"yPx", 50}})
            + line(QJsonObject{{"type", "mouseDown"}, {"mediaTimeNs", "500000000"},
                {"withinVideo", true}, {"xPx", 100}, {"yPx", 50}}));
        write(root + "/cursor-timeline.jsonl",
            line(QJsonObject{{"mediaTimeNs", "0"}, {"withinVideo", true},
                {"available", true}, {"cursorId", "cursor-a"}}));
        {
            // Keyed by cursor id, so it cannot be a braced pair list.
            QJsonObject definitions;
            definitions.insert(QStringLiteral("cursor-a"), QJsonObject{
                {"image", "cursor-a.png"}, {"widthPx", 4}, {"heightPx", 4},
                {"hotSpotXPx", 0}, {"hotSpotYPx", 0}});
            write(root + "/cursors.json", QJsonDocument(definitions).toJson());
        }
        write(root + "/automatic-zooms.json", QJsonDocument(QJsonObject{
            {"ranges", QJsonArray{QJsonObject{{"startTimeMs", 200.0}, {"endTimeMs", 800.0},
                {"zoom", 2.0}, {"snapToEdgesRatio", 0.25}, {"isDisabled", false}}}}}).toJson());
        write(root + "/project.json", QJsonDocument(QJsonObject{
            {"schemaVersion", 1},
            {"source", QJsonObject{{"type", "display"}, {"widthPx", 320}, {"heightPx", 180},
                {"globalBoundsPoints", QJsonObject{{"width", 320}, {"height", 180}}}}},
            {"settings", QJsonObject{{"outputAspectRatio", "auto"},
                {"backgroundPaddingRatio", 8.0}, {"windowBorderRadius", 8.0},
                {"shadowIntensity", 0.0}, {"backgroundType", "color"},
                {"backgroundColor", "#101820"}, {"cursorSize", 2.0}}},
            {"video", QJsonObject{{"file", "raw.mp4"},
                {"durationNs", QString::number(1000LL * 1000000LL)},
                {"mediaZeroHostTimeNs", "1000"}, {"frameCount", 30}}}}).toJson());

        // --- refuses to run without a project -----------------------------
        {
            ExportController controller;
            require(!controller.busy(), "idle at construction");
            require(controller.defaultOutputPath().isEmpty(), "no default output before a recording");
            require(!controller.start(QString(), true, true, true, true),
                "starting without a project fails instead of pretending to export");
            require(!controller.error().isEmpty(), "the refusal explains itself");
        }

        // --- a real export through the controller --------------------------
        {
            ExportController controller;
            QObject::connect(&controller, &ExportController::finished,
                &app, [&](bool) { app.quit(); });

            controller.setProjectDirectory(root);
            require(controller.defaultOutputPath() == root + "/composed.mp4",
                "default output is composed.mp4 next to the project");
            require(controller.start(QString(), true, true, false, false), "export starts");
            require(controller.busy(), "busy while exporting");

            double seenProgress = 0.0;
            QObject::connect(&controller, &ExportController::progressChanged,
                &app, [&] { seenProgress = std::max(seenProgress, controller.progress()); });

            QTimer::singleShot(120000, &app, [] {
                throw std::runtime_error("export did not finish within 120 s");
            });
            app.exec();

            require(!controller.busy(), "not busy after finishing");
            require(controller.error().isEmpty(),
                "export reports no error (see status for detail)");
            require(QFileInfo::exists(root + "/composed.mp4"), "output file exists");
            require(QFileInfo(root + "/composed.mp4").size() > 0, "output file is not empty");
            require(seenProgress > 0.0, "progress was reported");
            require(controller.progress() == 1.0, "progress ends at 1.0");
            require(controller.status().contains(QStringLiteral("导出完成")),
                "status line names the finished export");

            // The written frame count must match what the file actually holds.
            QProcess probe;
            probe.start(findFfprobe(), {QStringLiteral("-v"), QStringLiteral("error"),
                QStringLiteral("-select_streams"), QStringLiteral("v:0"),
                QStringLiteral("-count_packets"),
                QStringLiteral("-show_entries"), QStringLiteral("stream=nb_read_packets"),
                QStringLiteral("-of"), QStringLiteral("csv=p=0"), root + "/composed.mp4"});
            require(probe.waitForFinished(60000) && probe.exitCode() == 0, "ffprobe runs");
            bool ok = false;
            const qint64 packets = QString::fromUtf8(probe.readAllStandardOutput())
                .trimmed().toLongLong(&ok);
            require(ok && packets == kOutputFrames,
                "the file holds every composited output frame (60 at 60 fps)");
        }

        // --- a missing project is still refused ----------------------------
        {
            ExportController controller;
            controller.setProjectDirectory(root + "/does-not-exist");
            require(!controller.start(QString(), true, true, false, false),
                "a project directory without project.json is refused");
        }

        // Audio must follow the same source spans and speeds as the video. A
        // two-tone track exposes a wrong cut even when the output length is right.
        {
            QProcess source;
            source.start(ffmpegPath(), {"-v", "error", "-i", root + "/raw.mp4", "-f", "lavfi", "-i",
                "aevalsrc=0.1*sin(2*PI*if(lt(t\\,0.5)\\,440\\,880)*t):s=48000:d=1",
                "-c:v", "copy", "-c:a", "aac", "-y", root + "/with-audio.mp4"});
            require(source.waitForFinished(30000) && source.exitCode() == 0, "two-tone audio fixture");
            require(QFile::rename(root + "/raw.mp4", root + "/silent.mp4"), "retain silent source");
            require(QFile::rename(root + "/with-audio.mp4", root + "/raw.mp4"), "use system audio source");
            ComposeOptions options;
            options.ffmpegPath = ffmpegPath(); options.projectDirectory = root;
            options.outputPath = root + "/audio-edit.mp4";
            options.timeline = Project::EditTimeline::whole(1000);
            require(options.timeline.trimStart(500), "cut first tone");
            require(options.timeline.setSpeed(0, 500, 2), "retime remaining audio");
            const auto exported = composeProject(options);
            if (!exported.ok) std::cerr << exported.error.toStdString() << '\n' << exported.encoderLog.toStdString() << '\n';
            require(exported.ok && exported.audioMuxed, "edited system audio exports");
            QProcess decode;
            decode.start(ffmpegPath(), {"-v", "error", "-i", options.outputPath,
                "-map", "0:a:0", "-ac", "1", "-ar", "48000", "-f", "f32le", "-"});
            require(decode.waitForFinished(30000) && decode.exitCode() == 0, "decode edited audio");
            const QByteArray pcm = decode.readAllStandardOutput();
            const int samples = pcm.size() / 4;
            require(samples > 10000 && samples < 14000, "audio duration follows 250 ms edit, not original one second");
            float previous = 0; int crossings = 0;
            for (int i = 0; i < samples; ++i) {
                float value; std::memcpy(&value, pcm.constData() + i * 4, 4);
                if (previous <= 0 && value > 0) ++crossings;
                previous = value;
            }
            const double frequency = crossings * 48000.0 / samples;
            require(frequency > 700 && frequency < 1000, "cut keeps second tone and speed preserves pitch");

            // A muted system recording can still have a microphone track. Its
            // export must not reference a nonexistent [1:a] input.
            require(QFile::remove(root + "/raw.mp4") && QFile::rename(root + "/silent.mp4", root + "/raw.mp4"), "restore silent source");
            QProcess microphone;
            microphone.start(ffmpegPath(), {"-v", "error", "-f", "lavfi", "-i",
                "sine=frequency=660:duration=1", "-c:a", "aac", "-y", root + "/microphone.m4a"});
            require(microphone.waitForFinished(30000) && microphone.exitCode() == 0, "microphone fixture");
            QFile manifestFile(root + "/project.json");
            require(manifestFile.open(QIODevice::ReadOnly), "open microphone manifest");
            auto manifest = QJsonDocument::fromJson(manifestFile.readAll()).object(); manifestFile.close();
            manifest.insert("microphone", QJsonObject{{"file", "microphone.m4a"}, {"durationMs", 1000}});
            write(root + "/project.json", QJsonDocument(manifest).toJson());
            options.outputPath = root + "/microphone-only.mp4";
            options.includeMicrophone = true;
            const auto mic = composeProject(options);
            if (!mic.ok) std::cerr << mic.error.toStdString() << '\n' << mic.encoderLog.toStdString() << '\n';
            require(mic.ok && mic.microphoneMuxed && mic.audioMuxed, "microphone-only recording exports without a system track");
        }

        {
            QProcess source;
            source.start(ffmpegPath(), {"-v", "error", "-f", "lavfi", "-i", "color=c=red:s=320x180:r=30:d=0.5",
                "-f", "lavfi", "-i", "color=c=blue:s=320x180:r=30:d=0.5",
                "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0[v]", "-map", "[v]",
                "-c:v", "libx264", "-pix_fmt", "yuv420p", "-y", root + "/reorder-source.mp4"});
            require(source.waitForFinished(30000) && source.exitCode() == 0, "two-color ordered fixture");
            require(QFile::remove(root + "/raw.mp4") && QFile::rename(root + "/reorder-source.mp4", root + "/raw.mp4"), "use changing source frames");
            QFile manifestFile(root + "/project.json"); require(manifestFile.open(QIODevice::ReadOnly), "read reorder manifest");
            auto manifest = QJsonDocument::fromJson(manifestFile.readAll()).object(); manifestFile.close();
            manifest["settings"] = QJsonObject{{"outputAspectRatio", "16:9"}, {"backgroundPaddingRatio", 0},
                {"windowBorderRadius", 0}, {"windowInset", 0}, {"shadowIntensity", 0}, {"autoZoom", false}};
            write(root + "/project.json", QJsonDocument(manifest).toJson());
            ComposeOptions options;
            options.ffmpegPath = ffmpegPath(); options.projectDirectory = root; options.outputPath = root + "/reordered.mp4";
            options.exportHeight = 90; options.includeAudio = false; options.includeCursor = false; options.includeAutoZoom = false;
            options.motionBlur.amount = 0;
            options.timeline = Project::EditTimeline::whole(1000);
            require(options.timeline.split(500) && options.timeline.moveSegment(1, 0), "reverse color clips");
            const auto exported = composeProject(options);
            if (!exported.ok) std::cerr << exported.error.toStdString() << '\n';
            if (exported.height != 90 || exported.width != 160 || exported.encodedFrames != 60)
                std::cerr << "reorder metrics " << exported.width << "x" << exported.height << " frames " << exported.encodedFrames << " duration " << exported.durationMs << '\n';
            require(exported.ok && exported.height == 90 && exported.width == 160 && exported.encodedFrames == 60,
                "source decode geometry stays independent of smaller output canvas");
            QProcess decode;
            decode.start(ffmpegPath(), {"-v", "error", "-i", options.outputPath, "-vf", "scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"});
            require(decode.waitForFinished(30000) && decode.exitCode() == 0, "decode reordered color frames");
            const auto pixels = decode.readAllStandardOutput();
            require(pixels.size() == 60 * 3, "all output color frames present");
            require(uchar(pixels[2]) > uchar(pixels[0]) + 100, "output begins with second blue source clip");
            require(uchar(pixels[45 * 3]) > uchar(pixels[45 * 3 + 2]) + 100, "backward cut decodes original red source clip");
        }

        // A manual focus survives disabling auto zoom and changes real encoded
        // pixels. Sample an off-centre source point before/after the spring settles.
        {
            QProcess source;
            source.start(ffmpegPath(), {"-v", "error", "-f", "lavfi", "-i",
                "color=c=red:s=320x180:r=30:d=2,drawbox=x=160:y=0:w=160:h=180:color=blue:t=fill",
                "-c:v", "libx264", "-pix_fmt", "yuv420p", "-y", root + "/focus-source.mp4"});
            require(source.waitForFinished(30000) && source.exitCode() == 0, "manual framing fixture");
            require(QFile::remove(root + "/raw.mp4") && QFile::rename(root + "/focus-source.mp4", root + "/raw.mp4"), "replace framing source");
            QFile mf(root + "/project.json"); require(mf.open(QIODevice::ReadOnly), "framing manifest");
            auto manifest = QJsonDocument::fromJson(mf.readAll()).object(); mf.close();
            auto video = manifest["video"].toObject(); video["durationNs"] = "2000000000"; video["frameCount"] = 60; manifest["video"] = video;
            write(root + "/project.json", QJsonDocument(manifest).toJson());
            QByteArray frameRows;
            for (int i = 0; i < 60; ++i) frameRows += QJsonDocument(QJsonObject{{"mediaTimeNs", QString::number(qint64(i) * 1000000000 / 30)}}).toJson(QJsonDocument::Compact) + '\n';
            write(root + "/video-frames.jsonl", frameRows);
            Project::FocusClip manual{500, 1500, 2, 0, false};
            manual.id = "manual-test"; manual.fixedPosition = true; manual.focusX = .8; manual.focusY = .5; manual.customized = true;
            ComposeOptions options;
            options.ffmpegPath = ffmpegPath(); options.projectDirectory = root; options.outputPath = root + "/manual-focus.mp4";
            options.focusOverride = std::vector<Project::FocusClip>{manual};
            options.exportHeight = 90; options.includeCursor = false; options.includeAudio = false; options.includeAutoZoom = false; options.motionBlur.amount = 0;
            const auto composed = composeProject(options);
            if (!composed.ok) std::cerr << composed.error.toStdString() << '\n';
            require(composed.ok && composed.encodedFrames == 120, "manual focus exports while automatic zoom is disabled");
            QProcess decode;
            decode.start(ffmpegPath(), {"-v", "error", "-i", options.outputPath, "-vf", "crop=2:2:50:44,scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"});
            require(decode.waitForFinished(30000) && decode.exitCode() == 0, "decode manual framing pixels");
            const auto pixels = decode.readAllStandardOutput(); require(pixels.size() == 120 * 3, "all framing pixels decoded");
            require(uchar(pixels[0]) > uchar(pixels[2]) + 100, "unzoomed sample starts on red source half");
            require(uchar(pixels[72 * 3 + 2]) > uchar(pixels[72 * 3]) + 100, "settled manual camera focuses blue source half");
        }

        std::cout << "export controller checks passed\n";
        return 0;
    } catch (const std::exception &error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
