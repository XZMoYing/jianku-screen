#pragma once

#include "InputEvent.h"
#include "SpringSolver.h"

namespace Animation {

struct Vec2 {
    double x = 0.0;
    double y = 0.0;
};

// Cursor pose settings. Defaults follow the verified reference values
// (cursor Smooth 470/70/3, near-click 530/40/1, drag 1000/40/1, disabled 1/1/0,
// fader 300/30/0.3). Semantics: research/指针链路-核对.md.
struct CursorSettings {
    bool smoothingEnabled = true;
    bool disabled = false;

    SpringConfig movement{470.0, 70.0, 3.0, false, 0.002};
    SpringConfig nearClick{530.0, 40.0, 1.0, false, 0.002};
    SpringConfig drag{1000.0, 40.0, 1.0, false, 0.002};
    SpringConfig disabledSpring{1.0, 1.0, 0.0, false, 0.002};
    SpringConfig clickFader{300.0, 30.0, 0.3, false, 0.002};

    double clickLookaheadMs = 500.0;
    double nearClickLookaheadMs = 175.0;
    double clickScaleLookaheadMs = 130.0;
    double rotationWindowMs = 400.0;
    double rotationFactor = 0.03;
    double rotationRatio = 0.5;
    double rotationClampDeg = 20.0;
    double baseRotationDeg = 0.0;
    double clickScale = 0.8;
    // The reference exposes "no click feedback" as a separate switch; when it is
    // off the fader must stay at 1.0 instead of still pulsing on every press.
    bool clickScaleEnabled = true;
    double hiddenScale = 0.8;
    double hideAfterMs = 0.0;
    double hideRestoreMs = 250.0;
};

struct CursorPose {
    double x = 0.0;
    double y = 0.0;
    double rotationDeg = 0.0;
    double clickScale = 1.0;
    double alpha = 1.0;
};

class CursorEngine {
public:
    void setTrack(EventTrack track) { track_ = std::move(track); }
    void setSettings(const CursorSettings &settings) { settings_ = settings; }
    const EventTrack &track() const { return track_; }

    // Advances internal springs to media time t and returns the pose.
    CursorPose advanceTo(double t);
    void resetAt(double t);

    Vec2 plannedTargetAt(double t) const;
    SpringConfig springConfigAt(double t) const;
    double rotationAt(double t) const;
    double clickScaleTargetAt(double t) const;
    bool hiddenAt(double t) const;

private:
    CursorPose poseNow(double t) const;

    EventTrack track_;
    CursorSettings settings_;
    Spring x_;
    Spring y_;
    Spring rotation_;
    Spring clickFader_;
    SpringConfig activeConfig_;
    bool hasConfig_ = false;
    double time_ = -1.0;
};

} // namespace Animation
