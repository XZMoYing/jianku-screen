#include "TimelineMedia.h"
#include "ProjectCompositor.h"
#include <QCoreApplication>
#include <QCryptographicHash>
#include <QDataStream>
#include <QDateTime>
#include <QDir>
#include <QFileInfo>
#include <QPointer>
#include <QProcess>
#include <QSaveFile>
#include <QStandardPaths>
#include <QThreadPool>
#include <algorithm>
#include <cmath>
#include <cstring>

namespace Render {
TimelineMedia::TimelineMedia(QObject *parent) : QObject(parent) {}
TimelineMedia::~TimelineMedia() { if (cancelled_) *cancelled_ = true; }

TimelineMedia::Wave TimelineMedia::analyze(const QString &file, double duration, double offset,
    const QString &cacheRoot, const std::shared_ptr<std::atomic<bool>> &cancel, QString *error) {
    Wave wave; wave.offsetMs = offset;
    if (*cancel || !QFileInfo::exists(file)) return wave;
    QProcess probe;
    probe.start(findFfprobe(), {"-v", "error", "-select_streams", "a:0", "-show_entries", "stream=index", "-of", "csv=p=0", file});
    if (!probe.waitForFinished(10000) || probe.exitCode() != 0) { *error = QStringLiteral("音轨检查失败"); return wave; }
    if (probe.readAllStandardOutput().trimmed().isEmpty()) return wave;
    wave.present = true;
    const int count = std::clamp(int(std::ceil(std::max(duration - offset, 1.0) / 80)), 60, 6000);
    const int samplesPerBin = std::max(1, int(std::ceil(std::max(duration - offset, 1.0) * 8 / count)));
    wave.binMs = samplesPerBin / 8.0;
    const QFileInfo info(file);
    const QByteArray key = QCryptographicHash::hash((info.absoluteFilePath() + QString::number(info.size())
        + info.lastModified().toString(Qt::ISODateWithMs) + QString::number(samplesPerBin)).toUtf8(), QCryptographicHash::Sha256).toHex();
    const QString cacheFile = cacheRoot + "/" + QString::fromLatin1(key) + ".peaks";
    QFile cached(cacheFile);
    if (cached.open(QIODevice::ReadOnly)) {
        QDataStream data(&cached); quint32 version, size; data >> version >> size;
        if (version == 1 && size == quint32(count)) {
            wave.peaks.resize(count);
            for (auto &peak : wave.peaks) data >> peak;
            if (data.status() == QDataStream::Ok && std::all_of(wave.peaks.begin(), wave.peaks.end(), [](float p) { return std::isfinite(p) && p >= 0 && p <= 1; })) return wave;
        }
    }
    wave.peaks.assign(count, 0);
    QProcess decoder;
    decoder.start(findFfmpeg(), {"-v", "error", "-i", file, "-vn", "-ac", "1", "-ar", "8000", "-f", "f32le", "-"});
    if (!decoder.waitForStarted(10000)) { *error = QStringLiteral("无法生成音频波形"); return wave; }
    QByteArray pending; qint64 sample = 0;
    while (decoder.state() != QProcess::NotRunning || decoder.bytesAvailable() > 0) {
        if (*cancel) { decoder.kill(); decoder.waitForFinished(3000); return {}; }
        decoder.waitForReadyRead(1000);
        decoder.readAllStandardError();
        pending += decoder.readAllStandardOutput();
        const int available = pending.size() / int(sizeof(float));
        for (int i = 0; i < available; ++i, ++sample) {
            float value; std::memcpy(&value, pending.constData() + i * sizeof(float), sizeof(float));
            const qint64 bin = sample / samplesPerBin;
            if (bin < count && std::isfinite(value)) wave.peaks[bin] = std::max(wave.peaks[bin], std::min(1.0f, std::abs(value)));
        }
        pending.remove(0, available * int(sizeof(float)));
    }
    decoder.waitForFinished(3000);
    if (decoder.exitCode() != 0) { *error = QStringLiteral("波形解码失败"); return wave; }
    if (!*cancel && QDir().mkpath(cacheRoot)) {
        QSaveFile out(cacheFile);
        if (out.open(QIODevice::WriteOnly)) {
            QDataStream data(&out); data << quint32(1) << quint32(count);
            for (float value : wave.peaks) data << value;
            out.commit();
        }
        const auto caches = QDir(cacheRoot).entryInfoList({"*.peaks"}, QDir::Files, QDir::Time);
        for (int i = 48; i < caches.size(); ++i) QFile::remove(caches[i].absoluteFilePath());
    }
    return wave;
}

void TimelineMedia::load(const QString &directory) {
    if (cancelled_) *cancelled_ = true;
    cancelled_ = std::make_shared<std::atomic<bool>>(false);
    const auto cancel = cancelled_;
    loading_ = true; system_ = {}; microphone_ = {}; error_.clear(); emit changed();
    const QString cache = QStandardPaths::writableLocation(QStandardPaths::CacheLocation) + "/waveforms";
    QPointer<TimelineMedia> self(this);
    QThreadPool::globalInstance()->start([self, directory, cache, cancel] {
        const auto project = loadProject(directory);
        QString error;
        Wave system, microphone;
        if (project.valid) {
            system = analyze(directory + "/" + project.videoFile, project.durationMs, 0, cache, cancel, &error);
            if (project.microphone.present) microphone = analyze(directory + "/" + project.microphone.file,
                project.durationMs, project.microphoneDelayMs(), cache, cancel, &error);
        } else error = project.error;
        if (*cancel) return;
        QMetaObject::invokeMethod(qApp, [self, cancel, system = std::move(system), microphone = std::move(microphone), error] {
            if (!self || *cancel) return;
            self->system_ = system; self->microphone_ = microphone; self->loading_ = false; self->error_ = error; emit self->changed();
        }, Qt::QueuedConnection);
    });
}

QVariantList TimelineMedia::waveform(int track, double start, double end, int bars) const {
    QVariantList result;
    const auto &wave = track == 0 ? system_ : microphone_;
    if (!wave.present || wave.peaks.empty() || !std::isfinite(start) || !std::isfinite(end) || end <= start) return result;
    bars = std::clamp(bars, 1, 1200); result.reserve(bars);
    for (int i = 0; i < bars; ++i) {
        const double from = start + (end - start) * i / bars - wave.offsetMs;
        const double to = start + (end - start) * (i + 1) / bars - wave.offsetMs;
        float peak = 0;
        const int lower = std::max(0, int(std::floor(from / wave.binMs))), upper = std::min(int(wave.peaks.size()), int(std::ceil(to / wave.binMs)));
        for (int bin = lower; bin < upper; ++bin) peak = std::max(peak, wave.peaks[bin]);
        result.append(std::pow(peak, 0.65));
    }
    return result;
}
} // namespace Render
