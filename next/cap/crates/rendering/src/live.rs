use std::collections::VecDeque;

use cap_project::{CursorConfiguration, ScreenMovementSpring, XY};
use serde::{Deserialize, Serialize};
use specta::Type;

use crate::{
    numeric_spring::NumericSpring,
    spring_mass_damper::SpringMassDamperSimulationConfig,
    zoom::{InterpolatedZoom, SegmentBounds},
};

#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum LiveFocusMode {
    Off,
    #[default]
    Automatic,
    Manual,
}

#[derive(Clone, Debug)]
pub struct LiveAnimationFrame {
    pub time_ms: f64,
    pub position: XY<f64>,
    pub velocity: XY<f32>,
    pub rotation_degrees: f64,
    pub click_scale: f64,
    pub zoom: InterpolatedZoom,
    pub visible: bool,
}

#[derive(Clone, Copy)]
pub struct LivePointerInput {
    pub position: XY<f64>,
    pub pressed: bool,
    pub keyboard_active: bool,
    pub visible: bool,
}

pub struct LiveMotion {
    screen: XY<u32>,
    x: NumericSpring,
    y: NumericSpring,
    rotation: NumericSpring,
    click: NumericSpring,
    amount: NumericSpring,
    center_x: NumericSpring,
    center_y: NumericSpring,
    history: VecDeque<(f64, f64)>,
    last_time: Option<f64>,
    last_input: Option<LivePointerInput>,
    last_valid_position: XY<f64>,
    last_activity: f64,
    last_click: f64,
    automatic_zoom: bool,
    manual_zoom: bool,
    mode: LiveFocusMode,
    frames: VecDeque<LiveAnimationFrame>,
}

impl LiveMotion {
    pub fn new(
        screen: XY<u32>,
        cursor: &CursorConfiguration,
        spring: ScreenMovementSpring,
    ) -> Self {
        let pointer = SpringMassDamperSimulationConfig {
            tension: cursor.tension,
            friction: cursor.friction,
            mass: cursor.mass,
        };
        let camera = SpringMassDamperSimulationConfig {
            tension: spring.stiffness as f32,
            friction: spring.damping as f32,
            mass: spring.mass as f32,
        };
        Self {
            screen,
            x: NumericSpring::new(f64::from(screen.x) / 2.0, pointer),
            y: NumericSpring::new(f64::from(screen.y) / 2.0, pointer),
            rotation: NumericSpring::new(0.0, pointer),
            click: NumericSpring::new(1.0, click_config(cursor)),
            amount: NumericSpring::new(1.0, camera),
            center_x: NumericSpring::new(500.0, camera),
            center_y: NumericSpring::new(500.0, camera),
            history: VecDeque::new(),
            last_time: None,
            last_input: None,
            last_valid_position: XY::new(0.5, 0.5),
            last_activity: 0.0,
            last_click: f64::NEG_INFINITY,
            automatic_zoom: false,
            manual_zoom: false,
            mode: LiveFocusMode::Automatic,
            frames: VecDeque::new(),
        }
    }

    pub fn toggle(&mut self) {
        self.manual_zoom = !self.manual_zoom;
    }

    pub fn latest(&self) -> Option<&LiveAnimationFrame> {
        self.frames.back()
    }

    pub fn sample(&self, time_ms: f64) -> Option<&LiveAnimationFrame> {
        self.frames
            .iter()
            .rev()
            .find(|frame| frame.time_ms <= time_ms + 0.01)
            .or_else(|| self.frames.front())
    }

    pub fn advance(
        &mut self,
        now_ms: f64,
        input: LivePointerInput,
        mode: LiveFocusMode,
        cursor: &CursorConfiguration,
        zoom_amount: f64,
        idle_secs: f64,
    ) -> LiveAnimationFrame {
        let dt = self
            .last_time
            .map_or(0.0, |last| (now_ms - last).clamp(0.0, 1000.0));
        for spring in [
            &mut self.x,
            &mut self.y,
            &mut self.rotation,
            &mut self.click,
            &mut self.amount,
            &mut self.center_x,
            &mut self.center_y,
        ] {
            spring.advance(dt);
        }
        self.last_time = Some(now_ms);
        if mode != self.mode {
            self.automatic_zoom = false;
            self.mode = mode;
        }
        let pressed_now = input.pressed && !self.last_input.is_some_and(|old| old.pressed);
        let moved = self.last_input.is_some_and(|old| {
            ((old.position.x - input.position.x) * f64::from(self.screen.x))
                .hypot((old.position.y - input.position.y) * f64::from(self.screen.y))
                >= 1.0
        });
        if input.visible && (moved || input.pressed || input.keyboard_active) {
            self.last_activity = now_ms;
        }
        if input.visible && (pressed_now || input.keyboard_active) {
            self.automatic_zoom = true;
            self.last_activity = now_ms;
        }
        if input.visible && pressed_now {
            self.last_click = now_ms;
        }
        if now_ms - self.last_activity >= idle_secs.clamp(1.0, 30.0) * 1000.0 {
            self.automatic_zoom = false;
        }
        let zoomed = match mode {
            LiveFocusMode::Off => false,
            LiveFocusMode::Automatic => self.automatic_zoom,
            LiveFocusMode::Manual => self.manual_zoom,
        };
        let pointer = if cursor.raw {
            SpringMassDamperSimulationConfig {
                tension: 1.0,
                friction: 1.0,
                mass: 0.0,
            }
        } else if input.pressed {
            SpringMassDamperSimulationConfig {
                tension: 1000.0,
                friction: 40.0,
                mass: 1.0,
            }
        } else if now_ms - self.last_click <= 175.0 {
            SpringMassDamperSimulationConfig {
                tension: 530.0,
                friction: 40.0,
                mass: 1.0,
            }
        } else {
            SpringMassDamperSimulationConfig {
                tension: cursor.tension,
                friction: cursor.friction,
                mass: cursor.mass,
            }
        };
        if input.visible {
            self.last_valid_position = XY::new(
                input.position.x.clamp(0.0, 1.0),
                input.position.y.clamp(0.0, 1.0),
            );
        }
        let position = self.last_valid_position;
        if self.last_input.is_none() || cursor.raw {
            self.x.value = position.x * f64::from(self.screen.x);
            self.y.value = position.y * f64::from(self.screen.y);
        }
        if cursor.raw {
            self.x.velocity = 0.0;
            self.y.velocity = 0.0;
            self.rotation.value = 0.0;
            self.rotation.velocity = 0.0;
        }
        self.x.set_config(pointer);
        self.y.set_config(pointer);
        self.rotation.set_config(pointer);
        self.x.set_target(position.x * f64::from(self.screen.x));
        self.y.set_target(position.y * f64::from(self.screen.y));
        self.history.push_back((now_ms, position.x));
        while self.history.len() > 2
            && self
                .history
                .get(1)
                .is_some_and(|entry| entry.0 <= now_ms - 400.0)
        {
            self.history.pop_front();
        }
        let old_x = self.history.front().map_or(position.x, |entry| entry.1);
        self.rotation.set_target(if cursor.raw {
            0.0
        } else {
            ((position.x - old_x)
                * f64::from(self.screen.x)
                * 0.03
                * f64::from(cursor.rotation_amount))
            .clamp(-20.0, 20.0)
        });
        self.click.set_config(click_config(cursor));
        self.click.set_target(if input.pressed { 0.8 } else { 1.0 });
        self.amount.set_target(if zoomed {
            zoom_amount.clamp(1.0, 4.0)
        } else {
            1.0
        });
        let center = XY::new(
            ((position.x - 0.25) / 0.5).clamp(0.0, 1.0),
            ((position.y - 0.25) / 0.5).clamp(0.0, 1.0),
        );
        if self.amount.value <= 1.0005 {
            self.center_x.value = center.x * 1000.0;
            self.center_y.value = center.y * 1000.0;
            self.center_x.velocity = 0.0;
            self.center_y.velocity = 0.0;
        }
        let amount = self.amount.value.max(1.0);
        let viewport = 1.0 / amount;
        let view_center = XY::new(
            (self.center_x.value / 1000.0) * (1.0 - viewport) + viewport / 2.0,
            (self.center_y.value / 1000.0) * (1.0 - viewport) + viewport / 2.0,
        );
        let outside_focus = (position.x - view_center.x).abs() > viewport * 0.25
            || (position.y - view_center.y).abs() > viewport * 0.35;
        if self.amount.value <= 1.0005 || (zoomed && outside_focus) {
            self.center_x.set_target(center.x * 1000.0);
            self.center_y.set_target(center.y * 1000.0);
        }
        let frame = LiveAnimationFrame {
            time_ms: now_ms,
            position: XY::new(
                self.x.value / f64::from(self.screen.x.max(1)),
                self.y.value / f64::from(self.screen.y.max(1)),
            ),
            velocity: XY::new(
                (self.x.velocity / f64::from(self.screen.x.max(1))) as f32,
                (self.y.velocity / f64::from(self.screen.y.max(1))) as f32,
            ),
            rotation_degrees: self.rotation.value,
            click_scale: self.click.value,
            visible: input.visible,
            zoom: InterpolatedZoom {
                t: ((self.amount.value - 1.0) / (zoom_amount.max(1.01) - 1.0)).clamp(0.0, 1.0),
                bounds: SegmentBounds::from_amount_center(
                    self.amount.value,
                    XY::new(self.center_x.value / 1000.0, self.center_y.value / 1000.0),
                ),
            },
        };
        self.last_input = Some(input);
        self.frames.push_back(frame.clone());
        while self.frames.len() > 240 {
            self.frames.pop_front();
        }
        frame
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn input(x: f64, pressed: bool) -> LivePointerInput {
        LivePointerInput {
            position: XY::new(x, 0.5),
            pressed,
            keyboard_active: false,
            visible: true,
        }
    }
    #[test]
    fn continuous_operations_keep_focus_until_actual_idle() {
        let config = CursorConfiguration::default();
        let mut motion = LiveMotion::new(
            XY::new(1920, 1080),
            &config,
            ScreenMovementSpring::default(),
        );
        for index in 0..900 {
            let frame = motion.advance(
                index as f64 * 1000.0 / 60.0,
                input(0.5 + (index as f64 * 0.02).sin() * 0.2, index == 0),
                LiveFocusMode::Automatic,
                &config,
                1.8,
                4.0,
            );
            if index > 180 {
                assert!(frame.zoom.display_amount() > 1.7);
            }
        }
        for index in 900..1400 {
            motion.advance(
                index as f64 * 1000.0 / 60.0,
                input(0.5, false),
                LiveFocusMode::Automatic,
                &config,
                1.8,
                4.0,
            );
        }
        assert!(motion.sample(24_000.0).unwrap().zoom.display_amount() < 1.001);
    }
    #[test]
    fn manual_toggle_and_off_are_independent_of_clicks() {
        let config = CursorConfiguration::default();
        let mut motion = LiveMotion::new(
            XY::new(1920, 1080),
            &config,
            ScreenMovementSpring::default(),
        );
        motion.toggle();
        for index in 0..180 {
            motion.advance(
                index as f64 * 16.67,
                input(0.8, false),
                LiveFocusMode::Manual,
                &config,
                1.8,
                1.0,
            );
        }
        assert!(motion.sample(3000.0).unwrap().zoom.display_amount() > 1.7);
        for index in 180..360 {
            motion.advance(
                index as f64 * 16.67,
                input(0.8, true),
                LiveFocusMode::Off,
                &config,
                1.8,
                1.0,
            );
        }
        assert!(motion.sample(6000.0).unwrap().zoom.display_amount() < 1.001);
    }
    #[test]
    fn reversal_preserves_pose_and_click_recovers_without_snapping() {
        let config = CursorConfiguration::default();
        let mut motion = LiveMotion::new(
            XY::new(1920, 1080),
            &config,
            ScreenMovementSpring::default(),
        );
        let mut previous = 0.0;
        for index in 0..300 {
            let frame = motion.advance(
                index as f64 * 16.67,
                input(
                    if index < 60 { index as f64 / 60.0 } else { 0.0 },
                    index == 60,
                ),
                LiveFocusMode::Off,
                &config,
                1.8,
                4.0,
            );
            assert!((frame.rotation_degrees - previous).abs() < 10.0);
            previous = frame.rotation_degrees;
        }
        assert!(previous.abs() < 0.01);
        assert!((motion.sample(6000.0).unwrap().click_scale - 1.0).abs() < 0.001);
    }
}

fn click_config(cursor: &CursorConfiguration) -> SpringMassDamperSimulationConfig {
    let config = cursor.click_spring_config();
    SpringMassDamperSimulationConfig {
        tension: config.tension,
        friction: config.friction,
        mass: config.mass,
    }
}
