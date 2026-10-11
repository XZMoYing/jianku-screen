// Fixed poses and identical source pixels isolate renderer cost from AVPlayer
// scheduling. --capture/--compare also compare complete frames byte for byte.
#include "../src/render/ProjectCompositor.h"
#include <QCoreApplication>
#include <QDir>
#include <QElapsedTimer>
#include <QJsonDocument>
#include <QJsonObject>
#include <QPainter>
#include <iostream>
#include <stdexcept>

int main(int argc, char **argv) {
    QCoreApplication app(argc, argv);
    try {
        QImage source(960, 600, QImage::Format_ARGB32_Premultiplied);
        for (int y = 0; y < source.height(); ++y) {
            auto *row = reinterpret_cast<QRgb *>(source.scanLine(y));
            for (int x = 0; x < source.width(); ++x)
                row[x] = qRgb((x * 17 + y) % 256, (y * 7 + x / 5) % 256, (x + y * 3) % 256);
        }
        Render::ProjectData project;
        project.valid = true; project.durationMs = 10000; project.sourceSize = source.size();
        project.settings = {{"backgroundType", "gradient"}, {"gradientStartColor", "#334455"},
            {"gradientEndColor", "#997733"}, {"backgroundPaddingRatio", 9.0},
            {"shadowIntensity", .75}, {"shadowBlur", 20}, {"shadowDistance", 25},
            {"windowBorderRadius", 12}, {"windowInset", 2}, {"cursorSize", 1.5}};
        Render::CursorDefinition definition;
        definition.id = "arrow"; definition.widthPx = 24; definition.heightPx = 32;
        definition.hotspotXPx = 2; definition.hotspotYPx = 3;
        definition.image = QImage(24, 32, QImage::Format_ARGB32_Premultiplied);
        definition.image.fill(Qt::transparent);
        QPainter shape(&definition.image); shape.setRenderHint(QPainter::Antialiasing);
        shape.setBrush(Qt::white); shape.setPen(QPen(Qt::black, 2));
        shape.drawPolygon(QPolygonF{{2, 3}, {21, 20}, {12, 20}, {10, 30}, {6, 20}, {2, 25}}); shape.end();
        project.cursors.insert("arrow", definition); project.cursorObservations.push_back({0, "arrow"});
        const auto args = app.arguments();
        const bool capture = args.contains("--capture"), compare = !capture;
        const QString directory = capture || args.contains("--compare")
            ? args.value(args.indexOf(capture ? "--capture" : "--compare") + 1)
            : QStringLiteral(JIANKU_SOURCE_DIR "/research/evidence/2026-10-11-preview/render-baseline");
        if (capture) QDir().mkpath(directory);
        QJsonObject metrics;
        int frames = 0;
        for (int variant = 0; variant < 3; ++variant) {
            project.settings["outputAspectRatio"] = variant == 1 ? "1:1" : "16:9";
            if (variant == 2) project.settings["screenCrop"] = Render::SourceCrop{.15, .2, .7, .6}.map();
            auto context = Render::makeComposeContext(project, {}, {}, 540);
            if (!context.valid) throw std::runtime_error("context invalid");
            for (int mode = 0; mode < 3; ++mode) {
                Render::CameraPose camera{1.3, -80, -45};
                Render::CursorPose cursor;
                cursor.x = mode == 2 ? 900 : 480; cursor.y = mode == 1 ? 100 : 320;
                cursor.scale = .84; cursor.alpha = .73; cursor.rotationDeg = -17;
                Render::BlurPlan blur;
                if (mode == 1) {
                    blur.screen.channel = blur.cursor.channel = Render::MotionBlur::Channel::Move;
                    blur.screen.moveVector = {4.3, -2.7}; blur.cursor.moveVector = {-8.1, 3.4};
                } else if (mode == 2) {
                    blur.screen.channel = blur.cursor.channel = Render::MotionBlur::Channel::Zoom;
                    blur.screen.zoomCentre = {430.5, 230.2}; blur.screen.zoomStrength = .031;
                    blur.cursor.zoomCentre = {700.2, 250.7}; blur.cursor.zoomStrength = .085;
                }
                QElapsedTimer timer; timer.start();
                QImage frame;
                for (int repeat = 0; repeat < 5; ++repeat)
                    frame = Render::composeFrame(context, source, camera, cursor, 0, true, &blur);
                metrics.insert(QString("variant%1-mode%2-ms").arg(variant).arg(mode), timer.nsecsElapsed() / 5e6);
                const auto path = directory + QString("/frame-%1-%2.png").arg(variant).arg(mode);
                if (capture && !frame.save(path)) throw std::runtime_error("capture failed");
                if (compare && frame != QImage(path).convertToFormat(QImage::Format_ARGB32_Premultiplied))
                    throw std::runtime_error(("render changed: " + path).toStdString());
                ++frames;
            }
        }
        metrics.insert("frames", frames); metrics.insert("pixelEquality", compare);
        std::cout << QJsonDocument(metrics).toJson().constData();
        return 0;
    } catch (const std::exception &error) { std::cerr << error.what() << '\n'; return 1; }
}
