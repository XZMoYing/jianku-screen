#include "CanvasRenderer.h"
#include <QGuiApplication>
#include <QDir>
#include <QElapsedTimer>
#include <QJsonDocument>
#include <QJsonObject>
#include <iostream>
int main(int argc, char **argv) {
    QGuiApplication app(argc, argv);
    const bool capture = app.arguments().contains("--capture");
    const QString root = app.arguments().last(); QDir().mkpath(root);
    const QSizeF sizes[]{{240,180}, {320.25,200.75}, {80.5,60.5}, {960,600}};
    const double blur[]{0,.7,4.8,20,55}, radius[]{0,12,48,120}, intensity[]{0,.25,.75,1};
    QElapsedTimer clock; clock.start(); int mismatch = 0;
    for (int i = 0; i < 32; ++i) {
        Render::CanvasStyle style; style.shadowBlur = blur[i % 5]; style.radius = radius[(i / 2) % 4];
        style.shadowIntensity = intensity[(i / 3) % 4]; style.shadowDistance = i % 3 == 0 ? 12.2 : 25;
        style.shadowQuality = i % 7 == 0 ? 3 : 0;
        const auto image = Render::buildShadowSprite(sizes[i % 4], style);
        const auto file = root + QString("/shadow-%1.png").arg(i, 2, 10, QChar('0'));
        if (capture) { if (!image.save(file)) ++mismatch; }
        else if (image.convertToFormat(QImage::Format_ARGB32) != QImage(file).convertToFormat(QImage::Format_ARGB32)) {
            std::cerr << "Pixel mismatch in case " << i << '\n'; ++mismatch;
        }
    }
    std::cout << QJsonDocument(QJsonObject{{"ok", mismatch == 0}, {"cases", 32}, {"mismatch", mismatch},
        {"elapsedMs", double(clock.elapsed())}, {"capture", capture}}).toJson().constData();
    return mismatch ? 2 : 0;
}
