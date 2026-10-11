#pragma once
#include <QObject>
#include <QVariantList>
#include <atomic>
#include <memory>
#include <vector>

namespace Render {
class TimelineMedia final : public QObject {
    Q_OBJECT
    Q_PROPERTY(bool loading READ loading NOTIFY changed)
    Q_PROPERTY(bool hasSystemAudio READ hasSystemAudio NOTIFY changed)
    Q_PROPERTY(bool hasMicrophone READ hasMicrophone NOTIFY changed)
    Q_PROPERTY(QString error READ error NOTIFY changed)
public:
    explicit TimelineMedia(QObject *parent = nullptr);
    ~TimelineMedia() override;
    void load(const QString &directory);
    bool loading() const { return loading_; }
    bool hasSystemAudio() const { return system_.present; }
    bool hasMicrophone() const { return microphone_.present; }
    QString error() const { return error_; }
    Q_INVOKABLE QVariantList waveform(int track, double sourceStartMs, double sourceEndMs, int bars) const;
signals:
    void changed();
private:
    struct Wave { std::vector<float> peaks; double binMs = 1; double offsetMs = 0; bool present = false; };
    static Wave analyze(const QString &file, double durationMs, double offsetMs,
        const QString &cacheRoot, const std::shared_ptr<std::atomic<bool>> &cancelled, QString *error);
    Wave system_, microphone_;
    bool loading_ = false;
    QString error_;
    std::shared_ptr<std::atomic<bool>> cancelled_;
};
} // namespace Render
