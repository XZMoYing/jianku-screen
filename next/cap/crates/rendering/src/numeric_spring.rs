use crate::spring_mass_damper::SpringMassDamperSimulationConfig;

pub(super) struct NumericSpring {
    config: SpringMassDamperSimulationConfig,
    pub value: f64,
    pub velocity: f64,
    target: f64,
    precision: f64,
}

impl NumericSpring {
    pub fn new(value: f64, config: SpringMassDamperSimulationConfig) -> Self {
        Self {
            config,
            value,
            velocity: 0.0,
            target: value,
            precision: 1.0,
        }
    }

    pub fn set_config(&mut self, config: SpringMassDamperSimulationConfig) {
        self.config = config;
    }

    pub fn set_target(&mut self, target: f64) {
        if self.target != target {
            self.precision = (self.value - target).abs().max(1.0) * 0.002;
            self.target = target;
        }
    }

    pub fn advance(&mut self, dt_ms: f64) {
        if dt_ms <= 0.0 {
            return;
        }
        if self.config.mass <= 0.0 {
            self.value = self.target;
            self.velocity = 0.0;
            return;
        }
        // Keep the legacy millisecond integrator's fractional-step convention.
        // The target is updated after advancing, never before this interval.
        let steps = dt_ms.ceil() as usize;
        for step in 1..=steps {
            let step_ms = if step as f64 > dt_ms {
                step as f64 - dt_ms
            } else {
                1.0
            };
            let dt = step_ms / 1000.0;
            let acceleration = (-(self.value - self.target) * f64::from(self.config.tension)
                - self.velocity * f64::from(self.config.friction))
                / f64::from(self.config.mass);
            let velocity = self.velocity + acceleration * dt;
            let value = self.value + velocity * dt;
            if velocity.abs() < self.precision && (value - self.target).abs() < self.precision {
                self.value = self.target;
                self.velocity = 0.0;
            } else {
                self.value = value;
                self.velocity = velocity;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_legacy_solver_through_reversals_and_profile_changes() {
        let mut tilt = NumericSpring::new(
            0.0,
            SpringMassDamperSimulationConfig {
                tension: 470.0,
                friction: 70.0,
                mass: 3.0,
            },
        );
        let mut scale = NumericSpring::new(
            1.0,
            SpringMassDamperSimulationConfig {
                tension: 300.0,
                friction: 30.0,
                mass: 0.3,
            },
        );
        tilt.set_target(20.0);
        scale.set_target(0.8);
        for line in include_str!("../test-data/numeric-spring.csv")
            .lines()
            .skip(1)
        {
            let expected: Vec<f64> = line
                .split(',')
                .map(|field| field.parse().unwrap())
                .collect();
            let frame = expected[0] as usize;
            tilt.advance(1000.0 / 60.0);
            scale.advance(1000.0 / 60.0);
            if frame == 8 {
                tilt.set_config(SpringMassDamperSimulationConfig {
                    tension: 1000.0,
                    friction: 40.0,
                    mass: 1.0,
                });
                tilt.set_target(-20.0);
                scale.set_target(1.0);
            }
            if frame == 20 {
                tilt.set_config(SpringMassDamperSimulationConfig {
                    tension: 530.0,
                    friction: 40.0,
                    mass: 1.0,
                });
                tilt.set_target(0.0);
                scale.set_target(0.8);
            }
            if frame == 30 {
                scale.set_target(1.0);
            }
            for (actual, expected) in [tilt.value, tilt.velocity, scale.value, scale.velocity]
                .into_iter()
                .zip(&expected[1..])
            {
                assert!(
                    (actual - expected).abs() < 1e-6,
                    "frame={frame}, actual={actual}, expected={expected}"
                );
            }
        }
    }
}
