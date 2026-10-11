#include "SpringSolver.h"
#include <iomanip>
#include <iostream>

int main() {
    Animation::Spring tilt({470.0, 70.0, 3.0, false, 0.002});
    Animation::Spring scale({300.0, 30.0, 0.3, false, 0.002});
    tilt.reset(0.0);
    scale.reset(1.0);
    tilt.setTargetValue(20.0);
    scale.setTargetValue(0.8);
    std::cout << "frame,tilt,tiltVelocity,scale,scaleVelocity\n" << std::setprecision(17);
    for (int frame = 1; frame <= 60; ++frame) {
        tilt.advanceBy(1000.0 / 60.0);
        scale.advanceBy(1000.0 / 60.0);
        if (frame == 8) {
            tilt.setConfig({1000.0, 40.0, 1.0, false, 0.002});
            tilt.setTargetValue(-20.0);
            scale.setTargetValue(1.0);
        }
        if (frame == 20) {
            tilt.setConfig({530.0, 40.0, 1.0, false, 0.002});
            tilt.setTargetValue(0.0);
            scale.setTargetValue(0.8);
        }
        if (frame == 30) scale.setTargetValue(1.0);
        std::cout << frame << ',' << tilt.value() << ',' << tilt.velocity() << ','
                  << scale.value() << ',' << scale.velocity() << '\n';
    }
}
