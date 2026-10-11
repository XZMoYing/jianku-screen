#pragma once

#include <QObject>
#include <QVariantMap>

class SettingsStore final : public QObject {
    Q_OBJECT
    Q_PROPERTY(QVariantMap current READ current NOTIFY currentChanged)
    Q_PROPERTY(QVariantMap defaults READ defaults NOTIFY defaultsChanged)
    Q_PROPERTY(QVariantMap factory READ factory CONSTANT)
    Q_PROPERTY(QString storagePath READ storagePath CONSTANT)

public:
    explicit SettingsStore(QObject *parent = nullptr, const QString &storagePath = {});
    bool replaceCurrent(const QVariantMap &map);
    void initializeProject(const QVariantMap &recordedSettings);

    QVariantMap current() const { return current_; }
    QVariantMap defaults() const { return defaults_; }
    QVariantMap factory() const { return factory_; }
    QString storagePath() const { return storagePath_; }

    Q_INVOKABLE bool setCurrent(const QString &key, const QVariant &value);
    Q_INVOKABLE bool setAsDefault(const QString &key);
    Q_INVOKABLE bool restoreFactory(const QString &key);
    Q_INVOKABLE void restoreAllFactory();
    Q_INVOKABLE void useDefaults();

signals:
    void currentChanged();
    void defaultsChanged();
    void errorOccurred(const QString &message);

private:
    QVariantMap factory_;
    QVariantMap defaults_;
    QVariantMap current_;
    QString storagePath_;

    bool save();
    void load();
    QVariant normalized(const QString &key, const QVariant &value) const;
};
