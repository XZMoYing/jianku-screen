#include "../src/animation/LiveFocus.h"
#include <iostream>
#include <stdexcept>
using namespace Animation;
void require(bool ok, const char *message) { if (!ok) throw std::runtime_error(message); }
int main() {
    try {
        LiveFocus focus;
        auto step = [&](double t, double x, bool down = false, bool other = false, bool inside = true, bool automatic = true) {
            focus.update(t, {x, 0.5}, 1000, 600, down, other, inside, automatic, 2);
        };
        step(0, .5); step(100, .5, true); step(120, .5);
        require(focus.zoomed(), "click enters focus");
        for (int t = 200; t <= 8000; t += 100) step(t, .5 + t / 40000.0);
        require(focus.zoomed(), "continuous movement survives old fixed timeout");
        const double anchor = focus.focus().x;
        step(8100, .7); step(8200, .7001);
        require(focus.focus().x == anchor, "tiny motion does not move camera");
        step(10500, .7, false, true);
        step(13000, .7);
        require(focus.zoomed(), "scroll or typing extends active envelope");
        step(13600, .7);
        require(!focus.zoomed(), "idle interaction returns to full view");
        step(14000, .7, true); step(14020, .7);
        for (int t = 14100; t <= 18000; t += 100) step(t, .7001);
        require(!focus.zoomed(), "subpixel jitter cannot hold zoom indefinitely");
        step(19000, .8, true, false, false);
        require(!focus.zoomed(), "click outside capture cannot enter zoom");
        focus.setManual(true); step(20000, .8, false, false, true, false);
        require(focus.zoomed(), "manual focus works with automatic disabled");
        step(60000, .8, false, false, true, false);
        require(focus.zoomed(), "manual focus has no timeout");
        focus.setManual(false); step(60010, .8, false, false, true, false);
        require(!focus.zoomed(), "manual toggle returns to full view");
        step(61000, .8, true); step(70000, .8, true);
        require(focus.zoomed(), "long stationary press never ends drag");
        std::cout << "live focus checks passed\n";
    } catch (const std::exception &e) { std::cerr << e.what() << '\n'; return 1; }
}
