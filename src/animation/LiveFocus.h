#pragma once

#include "AutoFocusEngine.h"
#include <algorithm>
#include <cmath>

namespace Animation {

// Causal presentation policy. Clicks enter a zoom; subsequent interaction keeps
// the same envelope alive. The camera springs are owned by the driver and never
// reset when activity or the focus group changes.
class LiveFocus {
public:
    void reset() { *this = LiveFocus{}; }
    void setIdleMs(double value) { idleMs_ = std::clamp(value, 1000.0, 10000.0); }
    void setManual(bool value) { manual_ = value; automatic_ = false; }
    bool manual() const { return manual_; }
    void update(double timeMs, FocusPoint pointer, double widthPoints, double heightPoints,
        bool pressed, bool extraActivity, bool inside, bool automaticEnabled, double zoom) {
        const bool click = pressed && !pressed_;
        const double dx = (pointer.x - activityAnchor_.x) * widthPoints;
        const double dy = (pointer.y - activityAnchor_.y) * heightPoints;
        const bool moved = initialized_ && std::hypot(dx, dy) >= 2.0;
        if (!initialized_ || moved) activityAnchor_ = pointer;
        initialized_ = true;
        pressed_ = pressed;
        if (!automaticEnabled) automatic_ = false;
        if (inside && automaticEnabled && click && !manual_) {
            if (!automatic_) { focus_ = pointer; enteredMs_ = timeMs; }
            automatic_ = true;
            lastActivityMs_ = timeMs;
        }
        if (automatic_ && inside && (moved || pressed || extraActivity))
            lastActivityMs_ = timeMs;
        if (automatic_ && timeMs - enteredMs_ >= 1000.0 && timeMs - lastActivityMs_ >= idleMs_)
            automatic_ = false;
        if ((manual_ || automatic_) && inside && (moved || click)) {
            // Keep the focus steady in a small safe region. Once it is exceeded,
            // shift just enough to keep the pointer visible, rather than centring
            // the camera on every sample (which magnifies hand jitter).
            const double halfX = 0.25 / std::max(1.0, zoom);
            const double halfY = 0.35 / std::max(1.0, zoom);
            focus_.x = std::clamp(focus_.x, pointer.x - halfX, pointer.x + halfX);
            focus_.y = std::clamp(focus_.y, pointer.y - halfY, pointer.y + halfY);
        }
    }
    void setFocus(FocusPoint value) { focus_ = value; }
    bool zoomed() const { return manual_ || automatic_; }
    FocusPoint focus() const { return zoomed() ? focus_ : FocusPoint{0.5, 0.5}; }

private:
    bool initialized_ = false;
    bool pressed_ = false;
    bool automatic_ = false;
    bool manual_ = false;
    double enteredMs_ = 0.0;
    double lastActivityMs_ = 0.0;
    double idleMs_ = 3000.0;
    FocusPoint activityAnchor_{0.5, 0.5};
    FocusPoint focus_{0.5, 0.5};
};
} // namespace Animation
