#include "ExportController.h"

#include <QCoreApplication>
#include <algorithm>
#include <QDir>
#include <QFileInfo>
#include <QMetaObject>
#include <QProcess>
#include <QStandardPaths>
#include <QThread>
#include <QUrl>
#include <atomic>

namespace Render {
namespace {

// Where the built-in background library lives: the app bundle when running from
// one, otherwise the source tree. Same two candidates the rest of the app uses.
QString resolveBackgroundRoot() {
    const QString bundled = QDir(QCoreApplication::applicationDirPath())
        .filePath(QStringLiteral("../Resources/backgrounds"));
    if (QDir(bundled).exists())
        return QDir(bundled).absolutePath();
    const QString source = QStringLiteral(JIANKU_SOURCE_DIR "/assets/backgrounds");
    return QDir(source).exists() ? QDir(source).absolutePath() : QString();
}

} // namespace

ExportController::ExportController(QObject *parent) : QObject(parent) {}

ExportController::~ExportController() {
    cancelRequested_.store(true);
    if (thread_) {
        thread_->quit();
        thread_->wait(30000);
    }
}

void ExportController::setProjectDirectory(const QString &directory) {
    if (projectDirectory_ == directory)
        return;
    if (!busy_) reset();
    projectDirectory_ = directory;
    const auto project = loadProject(directory);
    sourceSize_ = project.valid ? project.sourceSize : QSizeF{};
    recordedSettings_ = project.settings;
    const QString next = directory.isEmpty() ? QString()
        : QDir(directory).filePath(QStringLiteral("composed.mp4"));
    if (defaultOutputPath_ != next) {
        defaultOutputPath_ = next;
        emit defaultOutputPathChanged();
    }
    // The label depends on the project's source size, so a new project changes it
    // even when the chosen resolution did not.
    emit outputSizeLabelChanged();
}

bool ExportController::start(const QString &outputPath, bool includeCursor,
    bool includeAutoZoom, bool includeAudio, bool includeMicrophone) {
    if (busy_) {
        error_ = QStringLiteral("已有导出在进行中");
        emit errorChanged();
        return false;
    }
    if (projectDirectory_.isEmpty()
        || !QFileInfo::exists(projectDirectory_ + QStringLiteral("/project.json"))) {
        error_ = QStringLiteral("没有可导出的录制工程");
        emit errorChanged();
        return false;
    }

    error_.clear();
    emit errorChanged();
    progress_ = 0.0;
    emit progressChanged();
    busy_ = true;
    emit busyChanged();
    cancelRequested_.store(false);

    ComposeOptions options;
    options.projectDirectory = projectDirectory_;
    options.outputPath = outputPath.isEmpty() ? defaultOutputPath_ : outputPath;
    options.backgroundRoot = resolveBackgroundRoot();
    options.ffmpegPath = findFfmpeg();
    options.includeCursor = includeCursor;
    options.includeAutoZoom = includeAutoZoom;
    options.includeAudio = includeAudio;
    options.includeMicrophone = includeMicrophone;
    options.fps = frameRate_;
    options.exportHeight = exportHeight_;
    // The strength factor is fps / 60 relative to the reference's 60 fps, so it
    // follows the export frame rate. Everything else stays as the project saved it.
    options.motionBlur.fps = options.fps;
    // The edit timeline, when the UI has one. Without it the export is the whole
    // recording in real time, which is exactly an identity timeline.
    options.timeline = timeline_;
    options.focusOverride = focus_; options.settingsOverride = editingSettings_;
    options.shouldCancel = [this] { return cancelRequested_.load(); };

    const QString target = options.outputPath;
    if (outputPath_ != target) {
        outputPath_ = target;
        emit outputPathChanged();
    }

    status_ = QStringLiteral("正在准备导出…");
    emit statusChanged();

    // Each export gets its own thread; a finished QThread deletes itself.
    auto *thread = QThread::create([this, options] {
        const ComposeResult result = composeProject(options, [this](qint64 done, qint64 total) {
            const double next = total > 0 ? double(done) / double(total) : 0.0;
            QMetaObject::invokeMethod(this, [this, next, done, total] {
                progress_ = next;
                status_ = QStringLiteral("正在导出 %1/%2 帧").arg(done).arg(total);
                emit progressChanged();
                emit statusChanged();
            }, Qt::QueuedConnection);
        });
        QMetaObject::invokeMethod(this, [this, result] { applyResult(result); },
            Qt::QueuedConnection);
    });
    thread_ = thread;
    thread->start();
    return true;
}

void ExportController::applyResult(const ComposeResult &result) {
    if (thread_) {
        thread_->quit();
        thread_->wait(5000);
        thread_ = nullptr;
    }
    busy_ = false;
    emit busyChanged();

    if (result.cancelled) {
        status_ = QStringLiteral("导出已取消");
        emit statusChanged();
        emit finished(false);
        return;
    }
    if (!result.ok) {
        error_ = result.error;
        status_ = QStringLiteral("导出失败");
        emit errorChanged();
        emit statusChanged();
        emit finished(false);
        return;
    }

    progress_ = 1.0;
    emit progressChanged();
    status_ = QStringLiteral("导出完成：%1 帧 · %2×%3 · %4 秒")
        .arg(result.encodedFrames > 0 ? result.encodedFrames : result.writtenFrames)
        .arg(result.width)
        .arg(result.height)
        .arg(QString::number(result.durationMs / 1000.0, 'f', 1));
    emit statusChanged();
    emit finished(true);
}

void ExportController::cancel() {
    if (!busy_)
        return;
    cancelRequested_.store(true);
    status_ = QStringLiteral("正在取消导出…");
    emit statusChanged();
}

void ExportController::revealOutput() const {
    if (outputPath_.isEmpty())
        return;
    QProcess::startDetached(QStringLiteral("/usr/bin/open"),
        {QStringLiteral("-R"), outputPath_});
}

void ExportController::setExportHeight(int height) {
    // 0 is "keep the source", which is a real choice and not a missing value, so it is
    // passed through; anything above 4K is refused rather than silently clamped,
    // because the user asked for a size the encoder will not produce.
    const int clamped = height <= 0 ? 0 : std::clamp(height, 120, 4320);
    if (clamped == exportHeight_)
        return;
    exportHeight_ = clamped;
    emit exportHeightChanged();
    emit outputSizeLabelChanged();
}

QString ExportController::outputSizeLabel() const {
    if (projectDirectory_.isEmpty() || !sourceSize_.isValid())
        return {};
    // The same two steps the export takes, so the label cannot disagree with the file:
    // the shape comes from the project's aspect ratio, the pixel count from here.
    const auto &settings = editingSettings_.isEmpty() ? recordedSettings_ : editingSettings_;
    const QSizeF canvas = canvasSizeForResolution(
        canvasSizeForAspect(sourceCropFromSettings(settings).pixels(sourceSize_).size(),
            settings.value(QStringLiteral("outputAspectRatio")).toString()),
        exportHeight_);
    return QStringLiteral("%1 × %2").arg(int(canvas.width())).arg(int(canvas.height()));
}

void ExportController::setFrameRate(int fps) {
    // Clamped to what the compositor accepts, so a bad value from a settings file
    // cannot reach the encoder.
    const int clamped = std::clamp(fps, 1, 240);
    if (clamped == frameRate_)
        return;
    frameRate_ = clamped;
    emit frameRateChanged();
}

void ExportController::reset() {
    if (busy_)
        return;
    status_.clear();
    error_.clear();
    progress_ = 0.0;
    emit statusChanged();
    emit errorChanged();
    emit progressChanged();
}

} // namespace Render
