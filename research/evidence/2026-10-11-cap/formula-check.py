"""Isolated mathematical examples; these are not measurements of app output."""

import json
import math
from pathlib import Path


def response(time_ms, stiffness, damping, mass):
    omega = math.sqrt(stiffness / mass)
    zeta = damping / (2 * math.sqrt(stiffness * mass))
    time = time_ms / 1000
    if zeta < 0.99:
        damped = omega * math.sqrt(1 - zeta * zeta)
        return 1 - math.exp(-zeta * omega * time) * (
            math.cos(damped * time)
            + zeta * omega / damped * math.sin(damped * time)
        )
    if zeta > 1.01:
        root = math.sqrt(zeta * zeta - 1)
        first = -omega * (zeta - root)
        second = -omega * (zeta + root)
        return 1 + (
            second * math.exp(first * time)
            - first * math.exp(second * time)
        ) / (first - second)
    return 1 - math.exp(-omega * time) * (1 + omega * time)


def euler_samples(stiffness, damping, mass):
    value = 0.0
    velocity = 0.0
    frame_ms = 1000 / 60
    result = []
    for frame in range(1, 61):
        for index in range(1, math.ceil(frame_ms) + 1):
            dt_ms = index - frame_ms if index > frame_ms else 1.0
            dt = dt_ms / 1000
            velocity += (stiffness * (1 - value) - damping * velocity) / mass * dt
            value += velocity * dt
        result.append((frame * frame_ms, value))
    return result


def main():
    solver_examples = {}
    for name, config in {
        "cursor": (470, 70, 3),
        "screen": (200, 40, 2.25),
    }.items():
        samples = euler_samples(*config)
        errors = [abs(value - response(t, *config)) for t, value in samples]
        solver_examples[name] = {
            "max_normalized_position_error_0_to_1000ms": max(errors),
            "scope": "constant unit step, zero initial velocity, 60Hz; no rest snap, target planning, frame update order or float32 rounding",
        }

    previous_left = -0.8
    previous_right = 1.2
    current_left = -0.72
    current_right = 1.18
    previous_center = (previous_left + previous_right) / 2
    cap_center = (previous_center - current_left) / (current_right - current_left)
    result = {
        "status": "double_precision_formula_examples_not_app_measurements",
        "ordinary_cursor_target_lead_ms": 70 / 470 * 1000,
        "isolated_solver_examples": solver_examples,
        "click_release_at_130ms": {
            "cap_fixed_smoothstep_scale": 1.0,
            "reference_300_30_0_3_isolated_continuous_spring_scale": 0.8 + 0.2 * response(130, 300, 30, 0.3),
            "scope": "release from fully held 0.8, zero velocity; not the reference frame timeline or measured export",
        },
        "zoom_out_center_example": {
            "previous_rect_x": [previous_left, previous_right],
            "current_rect_x": [current_left, current_right],
            "previous_contains_current": True,
            "cap_center_in_current_card_uv": cap_center,
            "corner_line_intersection_center_in_current_card_uv": 0.8,
            "scope": "fixed focus x=0.8, scale2 to1.9; y can be centered so size delta is dominant",
        },
        "directional_kernel_centroid_in_velocity_units": {
            "cap": sum(index / 20 for index in range(21)) / 21,
            "reference": sum(index / 20 for index in range(20)) / 21,
        },
        "cap_default_shadow": {
            "opacity_multiplier": 0.736 * 0.681,
            "size_fraction_of_card_short_side": 0.736 * 0.144,
            "blur_fraction_of_card_short_side": 0.736 * 0.038,
        },
    }
    path = Path(__file__).with_name("formula-result.json")
    path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
