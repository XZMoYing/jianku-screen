// Standalone full-resolution preview stress check; compile instructions in README.md.
#include "CanvasPreview.h"
#include <QGuiApplication>
#include <QElapsedTimer>
#include <QJsonDocument>
#include <QJsonObject>
#include <QTimer>
#include <algorithm>
#include <cmath>
#include <iostream>
#include <vector>

int main(int argc, char **argv) {
    QGuiApplication app(argc, argv);
    Render::CanvasPreview preview;
    QVariantMap options{{"backgroundType", "gradient"}, {"gradientStartColor", "#29344f"},
        {"gradientEndColor", "#819cb8"}, {"outputAspectRatio", "auto"},
        {"backgroundPaddingRatio", 10.0}, {"windowBorderRadius", 12.0},
        {"shadowIntensity", .75}, {"shadowAngle", 90.0}, {"shadowDistance", 25.0}, {"shadowBlur", 20.0}};
    QElapsedTimer clock; clock.start();
    QTimer edits, heartbeat, timeout;
    int updates = 0, delivered = 0;
    bool ended = false, finished = false;
    qint64 lastBeat = 0, stoppedAt = 0;
    std::vector<double> gaps;
    auto finish = [&](bool ok, double settleMs, bool pixels) {
        if (finished) return; finished = true;
        edits.stop(); heartbeat.stop(); timeout.stop();
        std::sort(gaps.begin(), gaps.end());
        const double p95 = gaps.empty() ? 0 : gaps[size_t((gaps.size() - 1) * .95)];
        const QJsonObject result{{"ok", ok}, {"requests", updates}, {"deliveredDuringDrag", delivered},
            {"canvasWidth", preview.planWidth()}, {"canvasHeight", preview.planHeight()},
            {"guiHeartbeatP95Ms", p95}, {"releaseToFinalMs", settleMs}, {"finalPixelsIdentical", pixels}};
        std::cout << QJsonDocument(result).toJson().constData(); app.exit(ok ? 0 : 2);
    };
    heartbeat.setInterval(8); heartbeat.setTimerType(Qt::PreciseTimer);
    QObject::connect(&heartbeat, &QTimer::timeout, &app, [&] {
        const auto now = clock.nsecsElapsed(); if (lastBeat) gaps.push_back((now - lastBeat) / 1e6); lastBeat = now;
    });
    QObject::connect(&preview, &Render::CanvasPreview::changed, &app, [&] {
        if (!ended) { ++delivered; return; }
        if (std::abs(preview.radiusRatio() - options["windowBorderRadius"].toDouble() / 2100) > 1e-9
            || std::abs(preview.insetRatio() - options["insetSize"].toDouble() / 2100) > 1e-9) return;
        const double latency = clock.elapsed() - stoppedAt;
        const auto plan = Render::planCanvas(Render::canvasStyleFromMap(options), QSizeF(3360, 2100), QSizeF(3360, 2100));
        const bool pixels = preview.image("background") == plan.background && preview.image("shadow") == plan.shadow;
        auto sorted = gaps; std::sort(sorted.begin(), sorted.end());
        const double p95 = sorted.empty() ? 0 : sorted[size_t((sorted.size() - 1) * .95)];
        finish(pixels && delivered >= 30 && p95 <= 24 && latency <= 500, latency, pixels);
    });
    edits.setInterval(32); edits.setTimerType(Qt::PreciseTimer);
    QObject::connect(&edits, &QTimer::timeout, &app, [&] {
        const auto elapsed = clock.elapsed();
        const double phase = .5 + .5 * std::sin(elapsed * .003);
        options["backgroundPaddingRatio"] = 5 + phase * 20;
        options["windowBorderRadius"] = phase * 48;
        options["insetSize"] = phase * 12;
        preview.update(options, 1680, 1050, 3360, 2100); ++updates;
        if (elapsed >= 3000) { ended = true; stoppedAt = elapsed; edits.stop(); }
    });
    timeout.setSingleShot(true); timeout.setInterval(10000);
    QObject::connect(&timeout, &QTimer::timeout, &app, [&] { finish(false, clock.elapsed() - stoppedAt, false); });
    edits.start(); heartbeat.start(); timeout.start(); return app.exec();
}
