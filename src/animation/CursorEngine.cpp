#include "CursorEngine.h"

#include <algorithm>
#include <cmath>

namespace Animation {
namespace {
double clampd(double value, double low, double high) {
    return std::max(low, std::min(high, value));
}
}

Vec2 CursorEngine::plannedTargetAt(double t) const {
    if (track_.empty())
        return {0.0, 0.0};

    if (settings_.disabled || !settings_.smoothingEnabled) {
        if (const InputEvent *previous = track_.lastAtOrBefore(t))
            return {previous->x, previous->y};
        const InputEvent &first = track_.events().front();
        return {first.x, first.y};
    }

    // A future/current click within the lookahead becomes the position target.
    if (const InputEvent *click = track_.firstClickWithin(t, settings_.clickLookaheadMs))
        return {click->x, click->y};

    if (const InputEvent *previous = track_.lastAtOrBefore(t))
        return {previous->x, previous->y};

    const InputEvent &first = track_.events().front();
    return {first.x, first.y};
}

SpringConfig CursorEngine::springConfigAt(double t) const {
    if (settings_.disabled || !settings_.smoothingEnabled)
        return settings_.disabledSpring;
    if (track_.firstClickWithin(t, settings_.nearClickLookaheadMs))
        return settings_.nearClick;
    if (const InputEvent *previous = track_.lastAtOrBefore(t)) {
        if (previous->kind == InputKind::Drag)
            return settings_.drag;
    }
    return settings_.movement;
}

double CursorEngine::rotationAt(double t) const {
    const double deltaX = plannedTargetAt(t).x - plannedTargetAt(t - settings_.rotationWindowMs).x;
    const double angle = deltaX * settings_.rotationFactor * settings_.rotationRatio;
    return clampd(angle, -settings_.rotationClampDeg, settings_.rotationClampDeg)
        + settings_.baseRotationDeg;
}

double CursorEngine::clickScaleTargetAt(double t) const {
    if (!settings_.clickScaleEnabled)
        return 1.0;
    const InputEvent *next = track_.firstAtOrAfter(t);
    if (!next)
        return 1.0;
    if (next->kind == InputKind::Down && next->timeMs - t <= settings_.clickScaleLookaheadMs)
        return settings_.clickScale;
    if (next->kind == InputKind::Up)
        return settings_.clickScale;
    return 1.0;
}

bool CursorEngine::hiddenAt(double t) const {
    if (settings_.hideAfterMs <= 0.0)
        return false;
    if (track_.firstMoveWithin(t, settings_.hideRestoreMs))
        return false;
    const InputEvent *previous = track_.lastAtOrBefore(t);
    if (!previous)
        return false;
    return (t - previous->timeMs) > settings_.hideAfterMs;
}

void CursorEngine::resetAt(double t) {
    const Vec2 target = plannedTargetAt(t);
    const SpringConfig config = springConfigAt(t);
    x_.reset(target.x);
    y_.reset(target.y);
    rotation_.reset(settings_.disabled || !settings_.smoothingEnabled ? settings_.baseRotationDeg : rotationAt(t));
    x_.setConfig(config);
    y_.setConfig(config);
    rotation_.setConfig(config);
    activeConfig_ = config;
    hasConfig_ = true;
    clickFader_.reset(1.0);
    clickFader_.setConfig(settings_.clickFader);
    time_ = t;
}

CursorPose CursorEngine::poseNow(double t) const {
    CursorPose pose;
    pose.x = x_.value();
    pose.y = y_.value();
    pose.rotationDeg = rotation_.value();
    pose.clickScale = clickFader_.value();
    pose.alpha = hiddenAt(t) ? 0.0 : 1.0;
    return pose;
}

CursorPose CursorEngine::advanceTo(double t) {
    if (time_ < 0.0)
        resetAt(t);

    const double delta = t - time_;
    if (delta > 0.0) {
        // Advance with the target/config that were active during the interval,
        // then update target and config for the new time (reference frame order).
        x_.advanceBy(delta);
        y_.advanceBy(delta);
        rotation_.advanceBy(delta);
        clickFader_.advanceBy(delta);
    }
    time_ = t;

    const Vec2 target = plannedTargetAt(t);
    x_.setTargetValue(target.x);
    y_.setTargetValue(target.y);
    // rotateZ belongs to cursor-mover's numeric style, so it uses the same
    // conditional spring as position (official 3.7.5: ok -> Nt -> C2/Cfe).
    // The 400 ms expression is a target, not a directly displayed angle.
    rotation_.setTargetValue(settings_.disabled || !settings_.smoothingEnabled
        ? settings_.baseRotationDeg : rotationAt(t));

    const SpringConfig config = springConfigAt(t);
    if (!hasConfig_ || config != activeConfig_) {
        x_.setConfig(config);
        y_.setConfig(config);
        rotation_.setConfig(config);
        activeConfig_ = config;
        hasConfig_ = true;
    }

    clickFader_.setTargetValue(clickScaleTargetAt(t));
    return poseNow(t);
}

} // namespace Animation
