// Timeline strip geometry checks.
//
// This arithmetic decides where a dragged playhead lands and how a ruler is
// labelled. Both fail in ways that look like "the app is slightly broken" rather
// than like a bug — a playhead that cannot quite reach the end, a cut that lands
// between frames, a ruler that switches to unreadable labels — so the properties
// are pinned here instead of being eyeballed in the UI.
#include "../src/render/TimelineGeometry.h"
#include "../src/render/TimelineMagnet.h"

#include <cmath>
#include <iostream>
#include <stdexcept>

using namespace Render;

namespace {
void require(bool condition, const char *message) {
    if (!condition) throw std::runtime_error(message);
}
bool close(double a, double b, double epsilon = 1e-9) {
    return std::abs(a - b) <= epsilon;
}
} // namespace

int main() {
    try {
        // --- position <-> time -----------------------------------------------
        {
            require(close(TimelineGeometry::ratioForTime(5000.0, 10000.0), 0.5), "half way");
            require(close(TimelineGeometry::ratioForTime(0.0, 10000.0), 0.0), "the start is 0");
            require(close(TimelineGeometry::ratioForTime(10000.0, 10000.0), 1.0), "the end is 1");
            // A drag that leaves the strip must clamp, not extrapolate: otherwise a
            // playhead dragged past the end reports a time that does not exist.
            require(close(TimelineGeometry::ratioForTime(-4000.0, 10000.0), 0.0),
                "before the start clamps");
            require(close(TimelineGeometry::ratioForTime(99000.0, 10000.0), 1.0),
                "past the end clamps");
            // A zero-length timeline must not divide by zero.
            require(close(TimelineGeometry::ratioForTime(500.0, 0.0), 0.0), "no length, no ratio");

            require(close(TimelineGeometry::timeAtRatio(0.25, 8000.0), 2000.0), "quarter way");
            require(close(TimelineGeometry::timeAtRatio(1.5, 8000.0), 8000.0), "clamped above");
            require(close(TimelineGeometry::timeAtRatio(-0.5, 8000.0), 0.0), "clamped below");
            require(close(TimelineGeometry::timeAtRatio(0.5, 0.0), 0.0), "no length, no time");

            // Round trip across the whole strip.
            for (int step = 0; step <= 100; ++step) {
                const double ratio = step / 100.0;
                const double time = TimelineGeometry::timeAtRatio(ratio, 124660.0);
                require(close(TimelineGeometry::ratioForTime(time, 124660.0), ratio, 1e-9),
                    "ratio -> time -> ratio is stable");
            }
        }

        // --- frame snapping ---------------------------------------------------
        {
            const double frame = 1000.0 / 60.0;
            require(close(TimelineGeometry::snapToFrame(2000.0, frame), 2000.0, 1e-9),
                "a time already on a frame does not move");
            // 2005 ms sits between frames 120 (2000.00) and 121 (2016.67), closer to
            // the previous one; 2012 ms is closer to the next.
            require(close(TimelineGeometry::snapToFrame(2005.0, frame), 2000.0, 1e-9),
                "rounds down when closer to the previous frame");
            require(close(TimelineGeometry::snapToFrame(2012.0, frame), 121 * frame, 1e-9),
                "and up when closer to the next one");
            require(close(TimelineGeometry::snapToFrame(1234.5, 0.0), 1234.5),
                "an unknown frame rate leaves the time alone");
            // Snapping must never produce a negative time.
            require(TimelineGeometry::snapToFrame(1.0, frame) >= 0.0, "no negative snap");
        }

        // --- snapping to existing cuts ---------------------------------------
        {
            const std::vector<double> cuts{2000.0, 5000.0, 9000.0};
            // Inside the tolerance: snaps exactly onto the cut, so a handle dragged
            // near an existing boundary lands on it rather than one frame away.
            require(close(TimelineGeometry::snapToNearest(2040.0, cuts, 100.0), 2000.0),
                "snaps to a nearby cut");
            require(close(TimelineGeometry::snapToNearest(8960.0, cuts, 100.0), 9000.0),
                "from either side");
            // Outside it: unchanged. Otherwise dragging anywhere would teleport.
            require(close(TimelineGeometry::snapToNearest(3000.0, cuts, 100.0), 3000.0),
                "leaves a time that is far from every cut");
            require(close(TimelineGeometry::snapToNearest(2000.0, cuts, 0.0), 2000.0),
                "a zero tolerance never snaps");
            require(close(TimelineGeometry::snapToNearest(3000.0, {}, 100.0), 3000.0),
                "no candidates, no snap");
            // The tolerance is inclusive: exactly at the limit still snaps.
            require(close(TimelineGeometry::snapToNearest(2100.0, cuts, 100.0), 2000.0),
                "exactly at the tolerance still snaps");
            require(close(TimelineGeometry::snapToNearest(2101.0, cuts, 100.0), 2101.0),
                "just outside it does not");
            // Two equidistant cuts: the result must not depend on which came first
            // in the list, or the same drag would land differently per project.
            const std::vector<double> tied{4000.0, 3000.0};
            require(close(TimelineGeometry::snapToNearest(3500.0, tied, 1000.0), 3000.0),
                "an exact tie resolves to the earlier cut");
            const std::vector<double> reversed{3000.0, 4000.0};
            require(close(TimelineGeometry::snapToNearest(3500.0, reversed, 1000.0), 3000.0),
                "the same answer whichever order they arrive in");
        }

        // --- ruler step -------------------------------------------------------
        {
            // 124.66 s across 900 px, ticks at least every 80 px: the step must be
            // at least 11.08 s, and the smallest nice step above that is 20 s.
            const double step = TimelineGeometry::niceTickStepMs(124660.0, 900.0, 80.0);
            require(close(step, 20000.0), "picks 20 s for a two-minute timeline");
            // The chosen step must actually satisfy the constraint, whatever it is.
            for (const double duration : {1000.0, 10000.0, 124660.0, 1588625.0}) {
                for (const double width : {120.0, 400.0, 1600.0}) {
                    const double chosen = TimelineGeometry::niceTickStepMs(duration, width, 60.0);
                    require(chosen > 0.0, "a step is always found");
                    const double pixels = chosen / (duration / width);
                    require(pixels >= 60.0 - 1e-6,
                        "the chosen step keeps ticks at least the minimum apart");
                }
            }
            // A very long recording still gets a usable step rather than none.
            require(TimelineGeometry::niceTickStepMs(3600000.0, 800.0, 60.0) > 0.0,
                "an hour-long recording still gets a step");
            // Degenerate inputs must not produce a division by zero downstream.
            require(close(TimelineGeometry::niceTickStepMs(0.0, 800.0, 60.0), 0.0), "no duration");
            require(close(TimelineGeometry::niceTickStepMs(1000.0, 0.0, 60.0), 0.0), "no width");
            require(close(TimelineGeometry::niceTickStepMs(1000.0, 800.0, 0.0), 0.0),
                "no minimum spacing");
        }

        // --- ticks and labels --------------------------------------------------
        {
            const std::vector<double> ticks = TimelineGeometry::tickTimes(10000.0, 2500.0);
            require(ticks.size() == 5, "0/2.5/5/7.5/10 s");
            require(close(ticks.front(), 0.0) && close(ticks.back(), 10000.0),
                "the ticks span the whole timeline");

            // An odd length still gets its final tick, otherwise the last label is
            // missing and the ruler looks truncated.
            const std::vector<double> odd = TimelineGeometry::tickTimes(9500.0, 2500.0);
            require(close(odd.back(), 9500.0), "the end is always a tick");
            require(odd.size() == 5, "0/2.5/5/7.5 plus the end");

            require(TimelineGeometry::tickTimes(10000.0, 0.0).empty(), "a zero step has no ticks");
            require(TimelineGeometry::tickTimes(0.0, 1000.0).empty(), "no duration, no ticks");
            // A step far smaller than the timeline must not build a huge vector on
            // the UI thread.
            require(TimelineGeometry::tickTimes(3600000.0, 0.001).empty(),
                "an absurdly small step is refused rather than allocating forever");

            require(TimelineGeometry::tickLabel(0.0, 10000.0) == QStringLiteral("0s"),
                "zero seconds");
            require(TimelineGeometry::tickLabel(30000.0, 10000.0) == QStringLiteral("30s"),
                "whole seconds with a whole-second step");
            require(TimelineGeometry::tickLabel(500.0, 500.0) == QStringLiteral("0.5s"),
                "a decimal when the step needs one");
            require(TimelineGeometry::tickLabel(65000.0, 10000.0) == QStringLiteral("1:05"),
                "minutes past a minute, with the seconds padded");
            require(TimelineGeometry::tickLabel(600000.0, 30000.0) == QStringLiteral("10:00"),
                "ten minutes");
        }

        {
            Render::TimelineMagnet magnet;
            magnet.begin({0, 1000, 2000}, {0});
            require(close(magnet.resolve(955, .1, false), 1000), "magnet captures within seven pixels");
            require(close(magnet.resolve(1100, .1, false), 1000), "magnet holds within fourteen pixels");
            require(close(magnet.resolve(1150, .1, false), 1150), "magnet releases beyond escape threshold");
            require(close(magnet.resolve(990, .1, true), 990) && magnet.target() < 0, "Shift bypass releases guide");
            magnet.begin({0, 1000}, {0});
            require(close(magnet.resolve(20, .1, false), 20), "original edge cannot trap new drag");
            magnet.resolve(200, .1, false);
            require(close(magnet.resolve(30, .1, false), 0), "edge may recapture after leaving suppression range");
            magnet.begin({1000});
            require(close(magnet.resolve(480, .1, false, {0, 500}), 500), "moving range can align trailing edge");
        }

        std::cout << "timeline geometry checks passed\n";
        return 0;
    } catch (const std::exception &error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
