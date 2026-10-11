#pragma once
#include <algorithm>
#include <cmath>
#include <limits>
#include <vector>

// Adapted from DogSC EditorTimelineMagneticSnap.swift (MIT, copyright 2026 神烦老狗).
// Original source and license: third_party/dogsc/. Times here are milliseconds.
namespace Render {
class TimelineMagnet {
public:
    void begin(std::vector<double> points, const std::vector<double> &initial = {}) {
        reset();
        for (double time : points) if (std::isfinite(time)) candidates_.push_back(time);
        std::sort(candidates_.begin(), candidates_.end());
        candidates_.erase(std::unique(candidates_.begin(), candidates_.end()), candidates_.end());
        for (double point : candidates_)
            if (std::any_of(initial.begin(), initial.end(), [point](double p) { return std::abs(p - point) < 0.01; })) suppressed_.push_back(point);
    }
    void reset() { candidates_.clear(); suppressed_.clear(); target_ = -1; heldOffset_ = 0; }
    double target() const { return target_; }
    double resolve(double proposed, double pixelsPerMs, bool bypass, const std::vector<double> &offsets = {0}) {
        if (!std::isfinite(proposed) || pixelsPerMs <= 0) return proposed;
        const double capture = 7 / pixelsPerMs, escape = 14 / pixelsPerMs;
        suppressed_.erase(std::remove_if(suppressed_.begin(), suppressed_.end(), [&](double point) {
            return std::none_of(offsets.begin(), offsets.end(), [&](double offset) { return std::abs(proposed + offset - point) <= escape; });
        }), suppressed_.end());
        if (bypass) { target_ = -1; return proposed; }
        if (target_ >= 0 && std::abs(proposed + heldOffset_ - target_) <= escape) return target_ - heldOffset_;
        target_ = -1;
        double best = std::numeric_limits<double>::infinity(), result = proposed;
        for (double offset : offsets) {
            const auto position = std::lower_bound(candidates_.begin(), candidates_.end(), proposed + offset);
            const int at = int(position - candidates_.begin());
            for (int index : {at - 1, at}) {
                if (index < 0 || index >= int(candidates_.size())) continue;
                const double point = candidates_[index], distance = std::abs(point - proposed - offset);
                if (std::find(suppressed_.begin(), suppressed_.end(), point) != suppressed_.end() || distance > capture || distance >= best) continue;
                best = distance; target_ = point; heldOffset_ = offset; result = point - offset;
            }
        }
        return result;
    }
private:
    std::vector<double> candidates_, suppressed_;
    double target_ = -1, heldOffset_ = 0;
};
} // namespace Render
