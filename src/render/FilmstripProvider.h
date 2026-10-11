#pragma once
#include <QQuickImageProvider>
#include <QThreadPool>
#include <memory>

namespace Render {
class FilmstripProvider final : public QQuickAsyncImageProvider {
public:
    FilmstripProvider();
    ~FilmstripProvider() override;
    QQuickImageResponse *requestImageResponse(const QString &id, const QSize &size) override;
private:
    struct Cache;
    std::shared_ptr<Cache> cache_;
    QThreadPool pool_;
};
} // namespace Render
