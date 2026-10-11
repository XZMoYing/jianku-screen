#pragma once
#include <QSemaphore>
#include <QThread>
#include <QThreadPool>
#include <algorithm>
#include <functional>

namespace Render::Detail {
// Separate from composition/IO pools: a caller waiting for these rows cannot
// occupy a worker it waits for. Each row retains the scalar operation order.
inline void parallelRows(int height, const std::function<void(int, int)> &body, int tasksPerWorker = 1) {
    static QThreadPool pool;
    const int workers = std::min(std::max(1, QThread::idealThreadCount()), std::max(1, height / 64));
    if (workers == 1) { body(0, height); return; }
    const int tasks = std::min(workers * tasksPerWorker, std::max(workers, height / 64));
    QSemaphore finished;
    for (int i = 0; i < tasks; ++i) {
        const int begin = height * i / tasks, end = height * (i + 1) / tasks;
        pool.start([&body, &finished, begin, end] { body(begin, end); finished.release(); });
    }
    finished.acquire(tasks);
}
}
