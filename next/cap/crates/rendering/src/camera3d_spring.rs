use std::sync::OnceLock;

use cap_project::{Camera3DMotionSpring, ScreenMovementSpring, XY};
use serde::Serialize;

use crate::spring_mass_damper::{SpringMassDamperSimulation, SpringMassDamperSimulationConfig};

const STEP_SECONDS: f64 = 0.008;
const MOVE_SECONDS: f64 = 4.0;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SpringResponse {
    step_seconds: f64,
    move_seconds: f64,
    stiffness: f32,
    damping: f32,
    mass: f32,
    samples: Vec<[f64; 2]>,
}

fn response() -> &'static SpringResponse {
    static RESPONSE: OnceLock<SpringResponse> = OnceLock::new();
    RESPONSE.get_or_init(|| {
        let spring = ScreenMovementSpring::default();
        let mut simulation = SpringMassDamperSimulation::new(SpringMassDamperSimulationConfig {
            tension: spring.stiffness,
            friction: spring.damping,
            mass: spring.mass,
        });
        simulation.set_position(XY::new(spring.damping / spring.stiffness, 0.0));
        simulation.set_velocity(XY::new(-1.0, 0.0));
        let mut samples = Vec::new();
        for _ in 0..2500 {
            samples.push([
                f64::from(simulation.position.x),
                f64::from(simulation.velocity.x),
            ]);
            if simulation.position.x == 0.0 && simulation.velocity.x == 0.0 {
                break;
            }
            simulation.run((STEP_SECONDS * 1000.0) as f32);
        }
        SpringResponse {
            step_seconds: STEP_SECONDS,
            move_seconds: MOVE_SECONDS,
            stiffness: spring.stiffness,
            damping: spring.damping,
            mass: spring.mass,
            samples,
        }
    })
}

fn residual(time: f64) -> f64 {
    let curve = response();
    let last = curve.samples.len() - 1;
    let at = (time / curve.step_seconds).clamp(0.0, last as f64);
    let index = (at.floor() as usize).min(last - 1);
    let t = at - index as f64;
    let [a, va] = curve.samples[index];
    let [b, vb] = curve.samples[index + 1];
    let t2 = t * t;
    let t3 = t2 * t;
    (2.0 * t3 - 3.0 * t2 + 1.0) * a
        + (t3 - 2.0 * t2 + t) * curve.step_seconds * va
        + (-2.0 * t3 + 3.0 * t2) * b
        + (t3 - t2) * curve.step_seconds * vb
}

fn ramp_position(progress: f64) -> f64 {
    if progress <= 0.0 {
        return 0.0;
    }
    if progress >= 1.0 {
        return 1.0;
    }
    let curve = response();
    let settle = (curve.samples.len() - 1) as f64 * curve.step_seconds;
    let duration = curve.move_seconds;
    let time = progress * (duration + settle);
    if time <= duration {
        (time - curve.samples[0][0] + residual(time)) / duration
    } else {
        1.0 + (residual(time) - residual(time - duration)) / duration
    }
}

pub fn progress(motion: &Camera3DMotionSpring, progress: f64) -> f64 {
    let [start, end] = motion.range;
    let range = end - start;
    if !start.is_finite()
        || !end.is_finite()
        || !(0.0..=1.0).contains(&start)
        || !(0.0..=1.0).contains(&end)
        || range.abs() < 1e-9
    {
        return progress;
    }
    let from = ramp_position(start);
    let to = ramp_position(end);
    if (to - from).abs() <= f64::EPSILON {
        return progress;
    }
    (ramp_position(start + range * progress) - from) / (to - from)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shared_reference_comes_from_the_existing_zoom_spring_solver() {
        let json = serde_json::to_string_pretty(response()).unwrap() + "\n";
        let mut checks = Vec::new();
        for span in [0.25, 1.0, 4.0, 7.0, 60.0, 3600.0] {
            for range in [[0.0, 1.0], [0.0, 0.37], [0.37, 1.0], [1.0, 0.0]] {
                for index in 0..=100 {
                    let t = index as f64 / 100.0;
                    checks.push([
                        span,
                        range[0],
                        range[1],
                        t,
                        crate::camera3d::sample_track(
                            0.0,
                            &[
                                cap_project::Camera3DKeyframe {
                                    time: 0.0,
                                    value: 0.0,
                                    out_easing: None,
                                    in_easing: None,
                                    out_spring: Some(Camera3DMotionSpring { range }),
                                },
                                cap_project::Camera3DKeyframe {
                                    time: span,
                                    value: 1.0,
                                    out_easing: None,
                                    in_easing: None,
                                    out_spring: None,
                                },
                            ],
                            t * span,
                        ),
                    ]);
                }
            }
        }
        let checks_json = serde_json::to_string_pretty(&checks).unwrap() + "\n";
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../apps/desktop/src/utils/camera3d-spring-reference.json");
        let checks_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("test-data/camera3d-spring-progress.json");
        if std::env::var_os("JIANKU_GENERATE_CAMERA3D_SPRING").is_some() {
            std::fs::write(&path, &json).unwrap();
            std::fs::write(&checks_path, &checks_json).unwrap();
        }
        let stored: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
        assert_eq!(
            stored,
            serde_json::from_str::<serde_json::Value>(&json).unwrap()
        );
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(
                &std::fs::read_to_string(checks_path).unwrap()
            )
            .unwrap(),
            serde_json::from_str::<serde_json::Value>(&checks_json).unwrap()
        );
        assert_eq!(response().samples.last().copied(), Some([0.0, 0.0]));
    }

    #[test]
    fn ramp_motion_has_resting_endpoints_and_keeps_the_middle_moving() {
        let motion = Camera3DMotionSpring::default();
        assert_eq!(progress(&motion, 0.0), 0.0);
        assert_eq!(progress(&motion, 1.0), 1.0);
        let epsilon = 1e-6;
        assert!(progress(&motion, epsilon).abs() / epsilon < 0.02);
        assert!((1.0 - progress(&motion, 1.0 - epsilon)).abs() / epsilon < 0.02);
        assert!(progress(&motion, 0.5) < 0.98);
        for index in 0..1000 {
            let p = progress(&motion, index as f64 / 1000.0);
            assert!(p.is_finite() && (-0.001..=1.001).contains(&p));
        }
    }

    #[test]
    fn split_and_reversed_ranges_preserve_the_original_trajectory() {
        let full = Camera3DMotionSpring::default();
        let cut = 0.37;
        let mid = progress(&full, cut);
        for index in 0..1001 {
            let t = index as f64 / 1000.0;
            let actual = if t <= cut {
                mid * progress(&Camera3DMotionSpring { range: [0.0, cut] }, t / cut)
            } else {
                mid + (1.0 - mid)
                    * progress(
                        &Camera3DMotionSpring { range: [cut, 1.0] },
                        (t - cut) / (1.0 - cut),
                    )
            };
            assert!((actual - progress(&full, t)).abs() < 1e-12);
            let reversed = progress(&Camera3DMotionSpring { range: [1.0, 0.0] }, t);
            assert!((reversed - (1.0 - progress(&full, 1.0 - t))).abs() < 1e-12);
        }
    }
}
