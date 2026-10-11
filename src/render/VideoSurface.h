#pragma once

#include <QQuickItem>
#include <QRectF>

class VideoFrameStore;
class QSGNode;

class VideoSurface : public QQuickItem {
    Q_OBJECT
    Q_PROPERTY(QObject *frameStore READ frameStore WRITE setFrameStore NOTIFY frameStoreChanged)
    Q_PROPERTY(QRectF sourceCropRect READ sourceCropRect WRITE setSourceCropRect NOTIFY sourceCropRectChanged)

public:
    explicit VideoSurface(QQuickItem *parent = nullptr);
    QObject *frameStore() const;
    void setFrameStore(QObject *store);
    QRectF sourceCropRect() const { return sourceCropRect_; }
    void setSourceCropRect(const QRectF &rect);

signals:
    void frameStoreChanged();
    void sourceCropRectChanged();

protected:
    QSGNode *updatePaintNode(QSGNode *oldNode, UpdatePaintNodeData *) override;

private:
    VideoFrameStore *store_ = nullptr;
    QMetaObject::Connection frameConnection_;
    QRectF sourceCropRect_{0, 0, 1, 1};
};
