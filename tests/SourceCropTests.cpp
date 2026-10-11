#include "../src/render/CropController.h"
#include <QCoreApplication>
#include <QTemporaryDir>
#include <limits>
#include <stdexcept>
#include <iostream>
using namespace Render;
void require(bool value, const char *message) { if (!value) throw std::runtime_error(message); }
bool close(double a, double b) { return std::abs(a - b) < 1e-8; }
int main(int argc, char **argv) {
    QCoreApplication app(argc, argv);
    try {
        SourceCrop crop;
        require(readSourceCrop(SourceCrop{.2, .1, .6, .7}.map(), &crop), "valid crop");
        for (const QVariant &value : {QVariant(true), QVariant("0.2"), QVariant(std::numeric_limits<double>::infinity()), QVariant(std::numeric_limits<double>::quiet_NaN())}) {
            auto map = crop.map(); map["x"] = value; SourceCrop result;
            require(!readSourceCrop(map, &result), "nonnumeric and nonfinite crop rejected");
        }
        auto map = crop.map(); map["extra"] = 1; require(!readSourceCrop(map, &crop), "unknown crop field rejected");
        require(!readSourceCrop(SourceCrop{.8, 0, .6, 1}.map(), &crop), "crop cannot leave source");
        require(!readSourceCrop(SourceCrop{0, 0, .01, 1}.map(), &crop), "tiny crop rejected");
        crop = {.2, .1, .6, .7};
        const auto moved = moveSourceCrop(crop, 2, -2);
        require(close(moved.x, .4) && moved.y == 0 && moved.width == crop.width && moved.height == crop.height, "moving clamps without shrinking");
        const auto resized = resizeSourceCrop(crop, 0, .9, .9, {1000, 500});
        require(close(resized.x + resized.width, .8) && close(resized.y + resized.height, .8), "opposite corner stays anchored");
        require(close(resized.width, .024) && close(resized.height, .048), "drag minimum is 24 source pixels");
        const auto side = resizeSourceCrop(crop, 3, -.1, .3, {1000, 500});
        require(close(side.width, .5) && side.x == crop.x && side.y == crop.y && side.height == crop.height, "horizontal handle changes only its edge");
        QTemporaryDir temp; require(temp.isValid(), "temporary directory");
        SettingsStore settings(nullptr, temp.path() + "/appearance.json");
        CropController controller(&settings); controller.setSourceSize({1000, 500});
        const auto initial = settings.current(); int changes = 0;
        QObject::connect(&settings, &SettingsStore::currentChanged, [&] { ++changes; });
        controller.begin(); controller.dragDraft(controller.draft(), 0, .1234, .2345);
        require(controller.draftPixels()["x"].toDouble() == 123 && controller.draftPixels()["y"].toDouble() == 117, "draft quantized on original pixel edges");
        require(changes == 0 && settings.current() == initial, "draft does not change saved appearance");
        controller.cancel(); require(!controller.active() && changes == 0, "cancel leaves committed crop intact");
        controller.begin();
        require(!controller.setDraftPixels({{"x", 900}, {"y", 0}, {"width", 500}, {"height", 500}}), "invalid pixel extent refused");
        require(!controller.setDraftPixels({{"x", true}, {"y", 0}, {"width", 500}, {"height", 500}}), "bool is not a pixel coordinate");
        require(controller.setDraftPixels({{"x", 200}, {"y", 100}, {"width", 600}, {"height", 300}}), "pixel crop accepted");
        controller.setAspectRatio(1);
        require(controller.draftPixels()["width"] == controller.draftPixels()["height"], "square preset fits source");
        require(controller.apply() && !controller.active() && changes == 1, "confirm changes appearance once");
        SettingsStore reopened(nullptr, temp.path() + "/appearance.json");
        require(reopened.current()["screenCrop"] == settings.current()["screenCrop"], "crop survives settings reload");
        controller.begin(); controller.resetDraft(); require(sourceCropFromSettings({{"screenCrop", controller.draft()}}).full(), "reset is a full-size draft");
        controller.cancel(); require(!sourceCropFromSettings(settings.current()).full(), "reset then cancel keeps committed crop");
        controller.begin(); settings.setCurrent("backgroundPaddingRatio", 12.0);
        require(!controller.active(), "external appearance changes cancel the stale draft");
        std::cout << "source crop checks passed\n"; return 0;
    } catch (const std::exception &error) { std::cerr << error.what() << '\n'; return 1; }
}
