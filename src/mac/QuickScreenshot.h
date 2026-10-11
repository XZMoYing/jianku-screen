#pragma once

#include <QObject>
#include <QVariantMap>

class QuickScreenshot final : public QObject {
    Q_OBJECT
    Q_PROPERTY(QString status READ status NOTIFY statusChanged)
    Q_PROPERTY(bool busy READ busy NOTIFY statusChanged)
    Q_PROPERTY(QString lastPath READ lastPath NOTIFY statusChanged)
public:
    explicit QuickScreenshot(QObject *parent = nullptr);
    QString status() const { return status_; }
    bool busy() const { return busy_; }
    QString lastPath() const { return lastPath_; }
    Q_INVOKABLE void setSource(const QVariantMap &source) { source_ = source; }
    Q_INVOKABLE void revealLast();
    Q_INVOKABLE void capture(const QVariantMap &options);
signals:
    void statusChanged();
    void finished(bool ok);
private:
    QString status_;
    bool busy_ = false;
    QString lastPath_;
    QVariantMap source_;
    quint64 requestId_ = 0;
    void setStatus(const QString &status);
};
