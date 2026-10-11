#include "SettingsStore.h"
#include "../render/SourceCrop.h"

#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QJsonDocument>
#include <QJsonObject>
#include <QSaveFile>
#include <QStandardPaths>
#include <cmath>

namespace {
QVariantMap referenceFactory() {
    // Values are the reference software's verified base object where known
    // (research/parameters/桌面参数-官方3.7.5静态.json). Remaining editor fields use the
    // effective values observed in a real reference project. Not yet a measured
    // fresh-project preset; keep every uncertain value labelled in the UI.
    return {
        {"backgroundType", "gradient"},
        {"backgroundSystemName", "macOS/tahoe-light.jpg"},
        {"backgroundImagePath", ""},
        {"backgroundColor", "#1b2230"},
        {"gradientStartColor", "#3F37C9"},
        {"gradientEndColor", "#8C87DF"},
        {"gradientAngle", 135.0},
        {"backgroundBlur", 0.0},
        {"backgroundPaddingRatio", 10.0},
        {"windowBorderRadius", 12.0},
        {"cornerSmoothing", 0.0},
        {"insetSize", 0.0},
        {"insetColor", "#000000"},
        {"insetAlpha", 0.5},
        {"shadowIntensity", 0.75},
        {"shadowAngle", 90.0},
        {"shadowDistance", 25.0},
        {"shadowBlur", 20.0},
        {"shadowIsDirectional", false},
        {"outputAspectRatio", "auto"},
        {"screenCrop", Render::SourceCrop{}.map()},
        {"cursorSize", 1.5},
        {"cursorSmoothing", "Smooth"},
        {"cursorRotateOnXMovementRatio", 0.5},
        {"cursorBaseRotation", 0.0},
        {"hideCursor", false},
        {"hideNotMovingCursorAfterMs", 0.0},
        {"removeCurshorShakeTreshold", 500.0},
        {"clickEffect", "none"},
        {"alwaysUseDefaultCursor", false},
        {"disableMouseMovementSpring", false},
        {"mouseMovementSpring", QVariantMap{{"stiffness", 470.0}, {"damping", 70.0}, {"mass", 3.0}}},
        {"screenMovementSpring", QVariantMap{{"stiffness", 200.0}, {"damping", 40.0}, {"mass", 2.25}}},
        {"mouseClickSpring", QVariantMap{{"stiffness", 700.0}, {"damping", 30.0}, {"mass", 1.0}}},
        {"autoZoom", true},
        {"presentationFocusMode", "auto"},
        {"presentationIdleSeconds", 3.0},
        {"presentationFocusHotkey", "Meta+Shift+8"},
        {"defaultZoomLevel", 2.0},
        {"alwaysKeepZoomedIn", false},
        {"snapToEdgesRatio", 0.25},
        {"glideSpeed", 0.5},
        // Motion blur: the reference's base configuration is 1 for the global
        // amount and for each of the three channels. The appearance has not been
        // compared against reference output frames yet, so the UI labels it as
        // pending verification rather than settled.
        {"motionBlurAmount", 1.0},
        {"motionBlurCursorAmount", 1.0},
        {"motionBlurScreenMoveAmount", 1.0},
        {"motionBlurScreenZoomAmount", 1.0},
        {"hideCamera", true},
        {"cameraSize", 0.35},
        {"cameraRoundness", 0.25},
        {"cameraScaleDuringZoom", 0.7},
        {"mirrorCamera", false},
        {"cameraAspectRatio", "original"},
        {"audioVolume", 1.0},
        {"systemAudioVolume", 1.0},
        {"muteMicrophone", false},
        {"muteSystemAudio", false},
        {"muteExternalDeviceAudio", false},
        {"backgroundAudioVolume", 0.05},
        {"muteBackgroundAudio", false},
        {"clickSoundEffectVolume", 0.25},
        {"improveMicrophoneAudio", false},
        {"showTranscript", false},
        {"transcriptSizeRatio", 1.0},
        {"showShortcuts", false},
        {"shortcutsSizeRatio", 1.0},
        {"showShortcutsWithSingleLetters", false},
        {"playbackSpeed", 1.0},
        {"recordingDirectory", QStandardPaths::writableLocation(QStandardPaths::MoviesLocation)
                                  + "/Jianku Screen"},
        {"screenshotHotkey", "Meta+Shift+7"},
        {"screenshotDirectory", QStandardPaths::writableLocation(QStandardPaths::PicturesLocation)
                                + "/Jianku Screen"}
    };
}
} // namespace

SettingsStore::SettingsStore(QObject *parent, const QString &storagePath) : QObject(parent), factory_(referenceFactory()) {
    saveTimer_.setSingleShot(true); saveTimer_.setInterval(200);
    connect(&saveTimer_, &QTimer::timeout, this, [this] { save(); });
    storagePath_ = storagePath.isEmpty() ? QStandardPaths::writableLocation(QStandardPaths::AppConfigLocation)
        + "/settings.json" : storagePath;
    defaults_ = factory_;
    current_ = defaults_;
    load();
}

SettingsStore::~SettingsStore() { flush(); }

bool SettingsStore::flush() { return !saveTimer_.isActive() || save(); }

bool SettingsStore::setInteractiveCurrent(const QString &key, const QVariant &value) {
    const QVariant cleaned = normalized(key, value);
    if (!cleaned.isValid()) {
        emit errorOccurred(QStringLiteral("设置值无效：") + key); return false;
    }
    if (current_.value(key) == cleaned) return true;
    current_.insert(key, cleaned);
    saveTimer_.start();
    emit currentChanged();
    return true;
}

void SettingsStore::initializeProject(const QVariantMap &recordedSettings) {
    flush();
    current_ = factory_;
    for (auto it = recordedSettings.constBegin(); it != recordedSettings.constEnd(); ++it) {
        const QVariant value = normalized(it.key(), it.value());
        if (value.isValid()) current_[it.key()] = value;
    }
    defaults_ = current_;
    load(); // Project-specific overrides only; never read or change app defaults.
    emit currentChanged();
}

QVariant SettingsStore::normalized(const QString &key, const QVariant &value) const {
    if (!factory_.contains(key))
        return {};
    const QVariant exemplar = factory_.value(key);
    if (exemplar.metaType().id() == QMetaType::Double) {
        bool ok = false;
        const double number = value.toDouble(&ok);
        return ok && std::isfinite(number) && number >= 0.0 && number <= 10000.0
            ? QVariant(number) : QVariant();
    }
    if (exemplar.metaType().id() == QMetaType::Bool) {
        if (value.metaType().id() == QMetaType::Bool)
            return value;
        return {};
    }
    if (exemplar.metaType().id() == QMetaType::QString)
        return value.toString();
    if (exemplar.metaType().id() == QMetaType::QVariantMap) {
        if (key == "screenCrop") {
            Render::SourceCrop crop;
            return Render::readSourceCrop(value, &crop) ? QVariant(crop.map()) : QVariant();
        }
        const QVariantMap parts = value.toMap();
        if (parts.keys() != QStringList({"damping", "mass", "stiffness"}))
            return {};
        QVariantMap cleaned;
        for (const auto &part : parts.keys()) {
            bool ok = false;
            const double number = parts.value(part).toDouble(&ok);
            if (!ok || !std::isfinite(number) || number < 0.0 || number > 10000.0)
                return {};
            cleaned.insert(part, number);
        }
        return cleaned;
    }
    return {};
}

bool SettingsStore::replaceCurrent(const QVariantMap &map) {
    QVariantMap clean = factory_;
    for (auto i = map.constBegin(); i != map.constEnd(); ++i) {
        const auto value = normalized(i.key(), i.value());
        if (!value.isValid()) return false;
        clean[i.key()] = value;
    }
    if (clean == current_) return true;
    current_ = clean; const bool written = save();
    emit currentChanged(); return written;
}

bool SettingsStore::setCurrent(const QString &key, const QVariant &value) {
    if (!factory_.contains(key) && key.contains('.')) {
        const QString group = key.section('.', 0, 0);
        const QString component = key.section('.', 1, 1);
        QVariantMap spring = current_.value(group).toMap();
        if (!factory_.value(group).toMap().contains(component)) return false;
        spring[component] = value;
        return setCurrent(group, spring);
    }
    const QVariant cleaned = normalized(key, value);
    if (!cleaned.isValid()) {
        emit errorOccurred(QStringLiteral("设置值无效：") + key);
        return false;
    }
    if (current_.value(key) == cleaned)
        return true;
    current_.insert(key, cleaned);
    const bool saved = save();
    emit currentChanged();
    return saved;
}

bool SettingsStore::setAsDefault(const QString &key) {
    if (!factory_.contains(key) && key.contains('.')) {
        const QString group = key.section('.', 0, 0);
        const QString component = key.section('.', 1, 1);
        if (!factory_.value(group).toMap().contains(component)) return false;
        QVariantMap spring = defaults_.value(group).toMap();
        spring[component] = current_.value(group).toMap().value(component);
        defaults_[group] = spring;
        emit defaultsChanged();
        return save();
    }
    if (!factory_.contains(key))
        return false;
    defaults_.insert(key, current_.value(key));
    emit defaultsChanged();
    return save();
}

bool SettingsStore::restoreFactory(const QString &key) {
    if (!factory_.contains(key) && key.contains('.')) {
        const QString group = key.section('.', 0, 0);
        const QString component = key.section('.', 1, 1);
        if (!factory_.value(group).toMap().contains(component)) return false;
        QVariantMap currentSpring = current_.value(group).toMap();
        QVariantMap defaultSpring = defaults_.value(group).toMap();
        currentSpring[component] = factory_.value(group).toMap().value(component);
        defaultSpring[component] = currentSpring.value(component);
        current_[group] = currentSpring;
        defaults_[group] = defaultSpring;
        const bool saved = save();
        emit currentChanged();
        emit defaultsChanged();
        return saved;
    }
    if (!factory_.contains(key))
        return false;
    current_.insert(key, factory_.value(key));
    defaults_.insert(key, factory_.value(key));
    const bool saved = save();
    emit currentChanged();
    emit defaultsChanged();
    return saved;
}

void SettingsStore::restoreAllFactory() {
    current_ = factory_;
    defaults_ = factory_;
    save();
    emit currentChanged();
    emit defaultsChanged();
}

void SettingsStore::useDefaults() {
    current_ = defaults_;
    save();
    emit currentChanged();
}

void SettingsStore::load() {
    QFile file(storagePath_);
    if (!file.open(QIODevice::ReadOnly))
        return;
    QJsonParseError parseError;
    const QJsonDocument document = QJsonDocument::fromJson(file.readAll(), &parseError);
    if (parseError.error != QJsonParseError::NoError || !document.isObject()) {
        emit errorOccurred(QStringLiteral("无法读取已保存的设置。"));
        return;
    }
    const QJsonObject root = document.object();
    if (root.value("schemaVersion").toInt() != 1)
        return;
    const QVariantMap storedDefaults = root.value("defaults").toObject().toVariantMap();
    const QVariantMap storedCurrent = root.value("current").toObject().toVariantMap();
    for (const auto &key : factory_.keys()) {
        if (storedDefaults.contains(key)) {
            if (const QVariant value = normalized(key, storedDefaults.value(key)); value.isValid())
                defaults_[key] = value;
        }
        if (storedCurrent.contains(key)) {
            if (const QVariant value = normalized(key, storedCurrent.value(key)); value.isValid())
                current_[key] = value;
        }
    }
}

bool SettingsStore::save() {
    saveTimer_.stop();
    QDir().mkpath(QFileInfo(storagePath_).absolutePath());
    QSaveFile file(storagePath_);
    if (!file.open(QIODevice::WriteOnly)) {
        emit errorOccurred(QStringLiteral("无法写入设置文件：") + storagePath_);
        return false;
    }
    const QJsonObject root{{"schemaVersion", 1},
                           {"defaults", QJsonObject::fromVariantMap(defaults_)},
                           {"current", QJsonObject::fromVariantMap(current_)}};
    if (file.write(QJsonDocument(root).toJson(QJsonDocument::Indented)) < 0 || !file.commit()) {
        emit errorOccurred(QStringLiteral("保存设置失败：") + storagePath_);
        return false;
    }
    return true;
}
