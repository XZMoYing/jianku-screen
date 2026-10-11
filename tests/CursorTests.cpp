#include "../src/animation/CursorEngine.h"
#include "../src/animation/AnimationSettings.h"

#include <QCoreApplication>
#include <QVariantMap>
#include <cmath>
#include <iostream>
#include <stdexcept>

using namespace Animation;

namespace {
void require(bool condition, const char *message) {
    if (!condition)
        throw std::runtime_error(message);
}
bool close(double a, double b, double tolerance = 1e-9) {
    return std::abs(a - b) <= tolerance;
}
EventTrack sampleTrack() {
    EventTrack track;
    track.setEvents({
        {0.0, 0.0, 0.0, InputKind::Move},
        {400.0, 100.0, 0.0, InputKind::Move},
        {800.0, 100.0, 50.0, InputKind::Drag},
        {2000.0, 500.0, 300.0, InputKind::Down},
        {2100.0, 500.0, 300.0, InputKind::Up},
    });
    return track;
}
}

int main(int argc, char **argv) {
    QCoreApplication app(argc, argv);
    try {
        CursorEngine engine;
        engine.setTrack(sampleTrack());
        const CursorSettings settings;
        engine.setSettings(settings);

        // Position target: future click within 500 ms wins.
        require(close(engine.plannedTargetAt(1600.0).x, 500.0)
                && close(engine.plannedTargetAt(1600.0).y, 300.0), "click lookahead target");
        // Otherwise the previous event position.
        require(close(engine.plannedTargetAt(1000.0).x, 100.0)
                && close(engine.plannedTargetAt(1000.0).y, 50.0), "previous event target");
        // Before any event, fall back to the first event.
        require(close(engine.plannedTargetAt(-50.0).x, 0.0), "first event fallback");

        // Conditional spring: near click / drag / default.
        {
            const SpringConfig near = engine.springConfigAt(1900.0);
            require(close(near.stiffness, 530.0) && close(near.damping, 40.0) && close(near.mass, 1.0),
                "near-click spring");
        }
        {
            const SpringConfig dragging = engine.springConfigAt(1000.0);
            require(close(dragging.stiffness, 1000.0) && close(dragging.damping, 40.0), "drag spring");
        }
        {
            const SpringConfig plain = engine.springConfigAt(400.0);
            require(close(plain.stiffness, 470.0) && close(plain.damping, 70.0) && close(plain.mass, 3.0),
                "default movement spring");
        }
        {
            CursorSettings off = settings;
            off.disabled = true;
            CursorEngine disabled;
            disabled.setTrack(sampleTrack());
            disabled.setSettings(off);
            const SpringConfig c = disabled.springConfigAt(400.0);
            require(close(c.stiffness, 1.0) && close(c.mass, 0.0), "disabled spring");
            require(close(disabled.plannedTargetAt(400.0).x, 100.0), "disabled target is raw position");
        }

        // Rotation: planned horizontal difference over the window, scaled and clamped.
        {
            EventTrack moves;
            moves.setEvents({{0.0, 0.0, 0.0, InputKind::Move}, {400.0, 100.0, 0.0, InputKind::Move}});
            CursorEngine e;
            e.setTrack(moves);
            e.setSettings(settings);
            require(close(e.rotationAt(400.0), 1.5), "rotation factor");
        }
        {
            EventTrack moves;
            moves.setEvents({{0.0, 0.0, 0.0, InputKind::Move}, {400.0, 1000.0, 0.0, InputKind::Move}});
            CursorSettings s = settings;
            s.rotationRatio = 1.0;
            CursorEngine e;
            e.setTrack(moves);
            e.setSettings(s);
            require(close(e.rotationAt(400.0), 20.0), "rotation clamp");
        }

        // Fast movement and a 400 ms history-window rollover change the rotation
        // target abruptly, but the displayed rotateZ must keep its velocity.
        {
            EventTrack moves;
            moves.setEvents({{0, 0, 0, InputKind::Move}, {100, 2000, 0, InputKind::Move}});
            CursorEngine e;
            e.setTrack(moves);
            e.setSettings(settings);
            e.advanceTo(0);
            double previous = 0;
            double peak = 0;
            for (int t = 10; t <= 1600; t += 10) {
                const double angle = e.advanceTo(t).rotationDeg;
                require(std::abs(angle - previous) < 3, "displayed angle never snaps on target rollover");
                if (t == 500) require(angle > 10, "history-window rollover preserves displayed tilt");
                peak = std::max(peak, angle);
                previous = angle;
            }
            require(peak > 10 && std::abs(previous) < .05, "tilt rises and settles naturally");
        }

        // Click scale target: within 130 ms of a mouse-down, or before a mouse-up.
        require(close(engine.clickScaleTargetAt(1900.0), 0.8), "click scale lookahead");
        require(close(engine.clickScaleTargetAt(1800.0), 1.0), "click scale outside lookahead");
        require(close(engine.clickScaleTargetAt(2050.0), 0.8), "click scale before mouse-up");

        // "No click feedback" must actually suppress the fader, not just hide the
        // switch: the UI exposed clickEffect but nothing read it.
        {
            CursorSettings plain = settings;
            plain.clickScaleEnabled = false;
            CursorEngine e;
            e.setTrack(sampleTrack());
            e.setSettings(plain);
            require(close(e.clickScaleTargetAt(1900.0), 1.0),
                "disabled click effect keeps the fader at 1.0 during lookahead");
            require(close(e.clickScaleTargetAt(2050.0), 1.0),
                "disabled click effect keeps the fader at 1.0 before mouse-up");
        }

        // Idle hide with restore window.
        {
            EventTrack idle;
            idle.setEvents({{0.0, 0.0, 0.0, InputKind::Move}});
            CursorSettings s = settings;
            s.hideAfterMs = 500.0;
            CursorEngine e;
            e.setTrack(idle);
            e.setSettings(s);
            require(e.hiddenAt(600.0), "idle cursor hides");
            require(!e.hiddenAt(100.0), "idle cursor still visible");
        }
        {
            EventTrack busy;
            busy.setEvents({{0.0, 0.0, 0.0, InputKind::Move}, {700.0, 10.0, 0.0, InputKind::Move}});
            CursorSettings s = settings;
            s.hideAfterMs = 500.0;
            CursorEngine e;
            e.setTrack(busy);
            e.setSettings(s);
            require(!e.hiddenAt(600.0), "restore window keeps cursor visible");
        }
        {
            CursorSettings s = settings;
            s.hideAfterMs = 0.0;
            CursorEngine e;
            e.setTrack(EventTrack{});
            e.setSettings(s);
            require(!e.hiddenAt(10000.0), "hide disabled when threshold is zero");
        }

        // advanceTo moves the pose toward the target over time.
        {
            EventTrack track;
            track.setEvents({{0.0, 0.0, 0.0, InputKind::Move}, {1000.0, 100.0, 0.0, InputKind::Move}});
            CursorEngine e;
            e.setTrack(track);
            e.setSettings(settings);
            require(close(e.advanceTo(0.0).x, 0.0), "starts at initial position");
            require(close(e.advanceTo(1000.0).x, 0.0, 1e-6), "target applied after advancing");
            const CursorPose mid = e.advanceTo(1100.0);
            require(mid.x > 0.0 && mid.x < 100.0, "spring integrates toward target");
            for (int i = 0; i < 200; ++i)
                e.advanceTo(1100.0 + i * 1000.0 / 60.0);
            require(close(e.advanceTo(6000.0).x, 100.0, 1e-3), "spring converges to target");
        }

        // Settings-map mapping is shared with the offline compositor, so the two
        // readers cannot drift apart again.
        {
            const DriverSettings plain = driverSettingsFromMap({});
            require(plain.cursor.smoothingEnabled, "smoothing defaults on for an empty map");
            require(plain.cursor.clickScaleEnabled, "click feedback defaults on for an empty map");

            QVariantMap off;
            off.insert("cursorSmoothing", QStringLiteral("None"));
            require(!driverSettingsFromMap(off).cursor.smoothingEnabled,
                "the None preset disables smoothing");

            QVariantMap noClick;
            noClick.insert("clickEffect", QStringLiteral("none"));
            require(!driverSettingsFromMap(noClick).cursor.clickScaleEnabled,
                "clickEffect none disables the click feedback");

            QVariantMap spring;
            spring.insert("mouseMovementSpring",
                QVariantMap{{"stiffness", 999.0}, {"damping", 111.0}, {"mass", 2.0}});
            const DriverSettings tuned = driverSettingsFromMap(spring);
            require(close(tuned.cursor.movement.stiffness, 999.0)
                    && close(tuned.cursor.movement.damping, 111.0)
                    && close(tuned.cursor.movement.mass, 2.0), "movement spring is read");
            require(close(tuned.screenSpring.stiffness, 200.0),
                "a missing screen spring keeps the base value");

            QVariantMap screens;
            screens.insert("screenMovementSpring",
                QVariantMap{{"stiffness", 170.0}, {"damping", 50.0}, {"mass", 3.0}});
            screens.insert("defaultZoomLevel", 1.4);
            screens.insert("snapToEdgesRatio", 0.3);
            const DriverSettings resolved = driverSettingsFromMap(screens);
            require(close(resolved.screenSpring.stiffness, 170.0), "screen spring is read");
            require(close(resolved.zoomLevel, 1.4), "zoom level is read");
            require(close(resolved.snapToEdgesRatio, 0.3), "snap ratio is read");
            require(close(resolved.cursor.movement.stiffness, 470.0),
                "screen settings do not clobber the cursor spring");

            // The click feedback spring. `mouseClickSpring` (700/30/1) exists in the
            // settings and in every project, but the located reference chain says the
            // zoomer-and-fader call uses its *own* spring (300/30/0.3), which is what
            // the engine already runs. So this asserts the value is deliberately
            // ignored: wiring it up would look like fixing an unwired setting while
            // actually contradicting the evidence. The test is here so nobody
            // "fixes" it back without seeing that note.
            QVariantMap click;
            click.insert("mouseClickSpring",
                QVariantMap{{"stiffness", 700.0}, {"damping", 30.0}, {"mass", 1.0}});
            const DriverSettings clicked = driverSettingsFromMap(click);
            require(close(clicked.cursor.clickFader.stiffness, 300.0)
                    && close(clicked.cursor.clickFader.damping, 30.0)
                    && close(clicked.cursor.clickFader.mass, 0.3),
                "mouseClickSpring does not drive the click fader");
            require(close(clicked.cursor.movement.stiffness, 470.0),
                "and it does not clobber the movement spring either");
        }

        std::cout << "cursor engine checks passed\n";
        return 0;
    } catch (const std::exception &error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
