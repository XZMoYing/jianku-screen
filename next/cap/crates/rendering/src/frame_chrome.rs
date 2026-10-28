//! Decorative frame ("chrome") rendering for the display layer.
//!
//! A frame wraps the screen recording in synthetic window chrome — a macOS
//! title bar, a browser toolbar or a MacBook body. The chrome is rasterized
//! on the CPU from a parameterized SVG (same technique as SVG cursors) into
//! an RGBA texture that the frame layer composites with the shared
//! composite-video-frame pipeline, so it inherits rounded corners, shadows,
//! borders and motion blur from the exact same shader as the video itself.
//!
//! Geometry model: the *outer card* (video + chrome) is what padding,
//! `display_position` and zoom apply to; the video sits inside it offset by
//! [`ChromeInsets`]. Insets are expressed as fractions of the video content
//! height so the chrome keeps its proportions at any recording size.

use crate::composite_frame::CompositeVideoFrameUniforms;
use cap_project::{FrameStyle, FrameTheme, XY};
use std::sync::{Arc, OnceLock};

/// Everything the frame layer needs to draw the chrome for one frame:
/// composite uniforms for the shared pipeline (bounds/rounding/shadow/motion
/// blur; `frame_size`/`crop_bounds` are filled in by the layer once the
/// texture size is known) plus the parameters that drive rasterization.
#[derive(Clone, Debug)]
pub struct FrameChromeUniforms {
    pub composite: CompositeVideoFrameUniforms,
    pub style: FrameStyle,
    pub theme: FrameTheme,
    pub url: String,
    pub title: String,
    /// Unzoomed outer card size in output px — the rasterization base size.
    pub raster_size: XY<f64>,
    /// Unzoomed video content height in output px (chrome proportions basis).
    pub content_height: f64,
}

/// Content insets of a frame style, as fractions of the video content height.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct ChromeInsets {
    pub top: f64,
    pub right: f64,
    pub bottom: f64,
    pub left: f64,
}

/// macOS window title bar height.
const MACOS_BAR_FRAC: f64 = 0.055;
/// Windows 11 window title bar height.
const WINDOWS_BAR_FRAC: f64 = 0.05;
/// Browser toolbar height.
const BROWSER_BAR_FRAC: f64 = 0.062;
/// MacBook screen bezel thickness (all four sides of the panel).
const MACBOOK_BEZEL_FRAC: f64 = 0.028;
/// MacBook deck (keyboard base) height below the panel.
const MACBOOK_DECK_FRAC: f64 = 0.045;
/// How far the deck overhangs the panel on each side.
const MACBOOK_OVERHANG_FRAC: f64 = 0.10;
/// Room reserved under the deck for its baked soft shadow.
const MACBOOK_SHADOW_ROOM_FRAC: f64 = 0.035;

/// Supersampling factor for the rasterized chrome texture, so it stays crisp
/// when zoom segments scale the card up.
const CHROME_SUPERSAMPLE: f64 = 2.0;
/// Hard cap on either texture dimension.
const CHROME_MAX_TEXTURE_DIM: f64 = 4096.0;

pub fn chrome_insets(style: FrameStyle) -> ChromeInsets {
    match style {
        FrameStyle::None => ChromeInsets::default(),
        FrameStyle::MacOS => ChromeInsets {
            top: MACOS_BAR_FRAC,
            ..Default::default()
        },
        FrameStyle::Windows => ChromeInsets {
            top: WINDOWS_BAR_FRAC,
            ..Default::default()
        },
        FrameStyle::Browser => ChromeInsets {
            top: BROWSER_BAR_FRAC,
            ..Default::default()
        },
        FrameStyle::Macbook => ChromeInsets {
            top: MACBOOK_BEZEL_FRAC,
            right: MACBOOK_BEZEL_FRAC + MACBOOK_OVERHANG_FRAC,
            bottom: MACBOOK_BEZEL_FRAC + MACBOOK_DECK_FRAC + MACBOOK_SHADOW_ROOM_FRAC,
            left: MACBOOK_BEZEL_FRAC + MACBOOK_OVERHANG_FRAC,
        },
        FrameStyle::Phone | FrameStyle::Tablet => {
            let bezel = mobile_bezel_fraction(style);
            ChromeInsets {
                top: bezel,
                right: bezel,
                bottom: bezel,
                left: bezel,
            }
        }
    }
}

fn mobile_bezel_fraction(style: FrameStyle) -> f64 {
    match style {
        FrameStyle::Phone => 0.024,
        FrameStyle::Tablet => 0.04,
        _ => 0.0,
    }
}

pub fn chrome_insets_for_aspect(style: FrameStyle, aspect: f64) -> ChromeInsets {
    let mut insets = chrome_insets(style);
    if mobile_bezel_fraction(style) > 0.0 {
        let scale = aspect.clamp(f64::EPSILON, 1.0);
        insets.top *= scale;
        insets.right *= scale;
        insets.bottom *= scale;
        insets.left *= scale;
    }
    insets
}

pub fn mobile_bezel_px(style: FrameStyle, width: f64, height: f64) -> f64 {
    let fraction = mobile_bezel_fraction(style);
    width.min(height) * fraction / (1.0 + 2.0 * fraction)
}

/// Whether the shader-side shadow/border decoration applies to this style.
/// The MacBook silhouette is not a rectangle, so it bakes its own shadow into
/// the SVG instead of using the rect-SDF shadow.
pub fn style_uses_card_decoration(style: FrameStyle) -> bool {
    matches!(
        style,
        FrameStyle::MacOS
            | FrameStyle::Windows
            | FrameStyle::Browser
            | FrameStyle::Phone
            | FrameStyle::Tablet
    )
}

/// Texture size for a chrome card whose unzoomed on-screen size is `w`×`h`
/// output pixels.
pub fn chrome_texture_size(w: f64, h: f64) -> (u32, u32) {
    let scale = (CHROME_MAX_TEXTURE_DIM / w.max(1.0))
        .min(CHROME_MAX_TEXTURE_DIM / h.max(1.0))
        .min(CHROME_SUPERSAMPLE);
    let tw = ((w * scale).round() as u32).clamp(16, CHROME_MAX_TEXTURE_DIM as u32);
    let th = ((h * scale).round() as u32).clamp(16, CHROME_MAX_TEXTURE_DIM as u32);
    (tw, th)
}

fn escape_xml(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

struct Palette {
    bar: &'static str,
    bar_top_highlight: &'static str,
    hairline: &'static str,
    title_text: &'static str,
    icon: &'static str,
}

fn palette(theme: FrameTheme) -> Palette {
    match theme {
        FrameTheme::Light => Palette {
            bar: "#ECEBEA",
            bar_top_highlight: "rgba(255,255,255,0.55)",
            hairline: "rgba(0,0,0,0.12)",
            title_text: "#4B4B4E",
            icon: "#87868B",
        },
        FrameTheme::Dark => Palette {
            bar: "#2E2E31",
            bar_top_highlight: "rgba(255,255,255,0.07)",
            hairline: "rgba(0,0,0,0.55)",
            title_text: "#C9C9CE",
            icon: "#9A9AA1",
        },
    }
}

/// The three traffic-light buttons, positioned in a bar of height `bar_h`
/// whose vertical center is `cy`.
fn traffic_lights(bar_h: f64, cy: f64) -> String {
    let r = bar_h * 0.135;
    let first_cx = bar_h * 0.45;
    let gap = r * 3.0;
    format!(
        concat!(
            r##"<circle cx="{x0}" cy="{cy}" r="{r}" fill="#FF5F57"/>"##,
            r##"<circle cx="{x1}" cy="{cy}" r="{r}" fill="#FEBC2E"/>"##,
            r##"<circle cx="{x2}" cy="{cy}" r="{r}" fill="#28C840"/>"##,
        ),
        x0 = first_cx,
        x1 = first_cx + gap,
        x2 = first_cx + gap * 2.0,
        cy = cy,
        r = r,
    )
}

/// Font stack used for chrome text. Resolved against the system font
/// database; if nothing matches, resvg simply skips the text node and the
/// chrome renders without labels.
const CHROME_FONTS: &str = "Helvetica Neue, Helvetica, Segoe UI, Arial, sans-serif";

/// The bar fill extends slightly below the bar so no background seam can show
/// between the chrome and the video's (square) top edge.
fn bar_fill_height(bar_h: f64) -> f64 {
    bar_h + (bar_h * 0.04).max(1.5)
}

fn macos_svg(w: f64, h: f64, bar_h: f64, theme: FrameTheme, title: &str) -> String {
    let p = palette(theme);
    let title_el = if title.trim().is_empty() {
        String::new()
    } else {
        format!(
            r##"<text x="{x}" y="{y}" font-family="{fonts}" font-size="{size}" font-weight="600" fill="{fill}" text-anchor="middle">{title}</text>"##,
            x = w * 0.5,
            y = bar_h * 0.5 + bar_h * 0.155,
            fonts = CHROME_FONTS,
            size = bar_h * 0.42,
            fill = p.title_text,
            title = escape_xml(title),
        )
    };

    format!(
        concat!(
            r##"<svg width="{w}" height="{h}" viewBox="0 0 {w} {h}" xmlns="http://www.w3.org/2000/svg">"##,
            r##"<rect width="{w}" height="{bar_fill}" fill="{bar}"/>"##,
            r##"<rect width="{w}" height="{hl_h}" fill="{highlight}"/>"##,
            r##"<rect y="{hair_y}" width="{w}" height="{hair_h}" fill="{hairline}"/>"##,
            "{lights}",
            "{title_el}",
            "</svg>"
        ),
        w = w,
        h = h,
        bar_fill = bar_fill_height(bar_h),
        bar = p.bar,
        hl_h = (bar_h * 0.045).max(1.0),
        highlight = p.bar_top_highlight,
        hair_y = bar_h - (bar_h * 0.03).max(1.0),
        hair_h = (bar_h * 0.03).max(1.0),
        hairline = p.hairline,
        lights = traffic_lights(bar_h, bar_h * 0.5),
        title_el = title_el,
    )
}

/// Windows 11 title bar: left-aligned title, right-aligned minimize /
/// maximize / close caption controls.
fn windows_svg(w: f64, h: f64, bar_h: f64, theme: FrameTheme, title: &str) -> String {
    let p = palette(theme);
    let cy = bar_h * 0.5;
    let g = bar_h * 0.145;
    let stroke = format!(
        r##"stroke="{icon}" stroke-width="{sw}" stroke-linecap="round" fill="none""##,
        icon = p.icon,
        sw = (bar_h * 0.038).max(1.2),
    );
    // Caption controls, right to left: close, maximize, minimize.
    let zone = bar_h * 1.30;
    let close_cx = w - zone * 0.5;
    let max_cx = w - zone * 1.5;
    let min_cx = w - zone * 2.5;
    let controls = format!(
        concat!(
            r##"<path d="M {min0} {cy} H {min1}" {stroke}/>"##,
            r##"<rect x="{mx}" y="{my}" width="{ms}" height="{ms}" rx="{mr}" {stroke}/>"##,
            r##"<path d="M {cx0} {cy0} L {cx1} {cy1} M {cx0} {cy1} L {cx1} {cy0}" {stroke}/>"##,
        ),
        min0 = min_cx - g,
        min1 = min_cx + g,
        cy = cy,
        mx = max_cx - g,
        my = cy - g,
        ms = g * 2.0,
        mr = g * 0.30,
        cx0 = close_cx - g,
        cx1 = close_cx + g,
        cy0 = cy - g,
        cy1 = cy + g,
        stroke = stroke,
    );

    let title_el = if title.trim().is_empty() {
        String::new()
    } else {
        format!(
            r##"<text x="{x}" y="{y}" font-family="{fonts}" font-size="{size}" fill="{fill}" text-anchor="start">{title}</text>"##,
            x = bar_h * 0.55,
            y = cy + bar_h * 0.14,
            fonts = CHROME_FONTS,
            size = bar_h * 0.38,
            fill = p.title_text,
            title = escape_xml(title),
        )
    };

    format!(
        concat!(
            r##"<svg width="{w}" height="{h}" viewBox="0 0 {w} {h}" xmlns="http://www.w3.org/2000/svg">"##,
            r##"<rect width="{w}" height="{bar_fill}" fill="{bar}"/>"##,
            r##"<rect y="{hair_y}" width="{w}" height="{hair_h}" fill="{hairline}"/>"##,
            "{title_el}",
            "{controls}",
            "</svg>"
        ),
        w = w,
        h = h,
        bar_fill = bar_fill_height(bar_h),
        bar = p.bar,
        hair_y = bar_h - (bar_h * 0.028).max(1.0),
        hair_h = (bar_h * 0.028).max(1.0),
        hairline = p.hairline,
        title_el = title_el,
        controls = controls,
    )
}

fn browser_svg(w: f64, h: f64, bar_h: f64, theme: FrameTheme, url: &str) -> String {
    let (bar, field, glyph, text_color, line) = match theme {
        FrameTheme::Light => ("#FAF9F6", "#ECEEE9", "#757C73", "#41483F", "#E1E4DD"),
        FrameTheme::Dark => ("#232720", "#343A30", "#AAB3A4", "#E0E7DB", "#3B4236"),
    };
    let cy = bar_h * 0.5;
    let lights = format!(
        concat!(
            r##"<circle cx="{x0}" cy="{cy}" r="{r}" fill="#F27870"/>"##,
            r##"<circle cx="{x1}" cy="{cy}" r="{r}" fill="#E6BC61"/>"##,
            r##"<circle cx="{x2}" cy="{cy}" r="{r}" fill="#78B782"/>"##,
        ),
        x0 = bar_h * 0.38,
        x1 = bar_h * 0.69,
        x2 = bar_h,
        r = bar_h * 0.09,
        cy = cy,
    );
    let show_navigation = w > bar_h * 10.0;
    let nav = if show_navigation {
        format!(
            concat!(
                r##"<g stroke="{glyph}" stroke-width="{stroke}" stroke-linecap="round" stroke-linejoin="round" fill="none" opacity="0.72">"##,
                r##"<path d="M {bx1} {top} L {bx0} {cy} L {bx1} {bottom}"/>"##,
                r##"<path d="M {fx0} {top} L {fx1} {cy} L {fx0} {bottom}" opacity="0.45"/>"##,
                r##"<path d="M {rx1} {ry} A {radius} {radius} 0 1 0 {rx2} {ry2} M {rx1} {ry0} V {ry} H {rx0}"/>"##,
                "</g>",
            ),
            glyph = glyph,
            stroke = (bar_h * 0.022).max(0.8),
            bx0 = bar_h * 1.67,
            bx1 = bar_h * 1.79,
            fx0 = bar_h * 2.25,
            fx1 = bar_h * 2.37,
            top = cy - bar_h * 0.12,
            bottom = cy + bar_h * 0.12,
            cy = cy,
            rx0 = bar_h * 2.94,
            rx1 = bar_h * 3.08,
            rx2 = bar_h * 3.06,
            ry0 = cy - bar_h * 0.23,
            ry = cy - bar_h * 0.075,
            ry2 = cy + bar_h * 0.13,
            radius = bar_h * 0.145,
        )
    } else {
        String::new()
    };
    let field_h = bar_h * 0.48;
    let font_size = bar_h * 0.245;
    let address = url.trim();
    let estimated_text_width = address
        .chars()
        .map(|c| if c.is_ascii() { 0.53 } else { 1.0 })
        .sum::<f64>()
        * font_size;
    let min_x = bar_h * if show_navigation { 3.7 } else { 1.45 };
    let max_x = (w - bar_h * 0.8).max(min_x);
    let field_w = (estimated_text_width + field_h * 1.85)
        .max(field_h * 3.2)
        .min(w * 0.52)
        .min((max_x - min_x).max(0.0));
    let center = (w * 0.5).clamp(min_x + field_w * 0.5, max_x - field_w * 0.5);
    let field_x = center - field_w * 0.5;
    let text_x = field_x + field_h * 1.1;
    let address_bar = if address.is_empty() || field_w < field_h * 1.8 {
        String::new()
    } else {
        format!(
            concat!(
                r##"<rect x="{x}" y="{y}" width="{width}" height="{height}" rx="{radius}" fill="{field}"/>"##,
                r##"<defs><clipPath id="address"><rect x="{text_x}" y="{y}" width="{text_width}" height="{height}"/></clipPath></defs>"##,
                r##"<g stroke="{glyph}" stroke-width="{stroke}" stroke-linecap="round" fill="none" opacity="0.7">"##,
                r##"<path d="M {gx0} {gy0} H {gx1} M {gx0} {gy1} H {gx1}"/>"##,
                r##"<circle cx="{gc0}" cy="{gy0}" r="{gr}" fill="{field}"/><circle cx="{gc1}" cy="{gy1}" r="{gr}" fill="{field}"/></g>"##,
                r##"<text x="{text_x}" y="{baseline}" font-family="{fonts}" font-size="{font_size}" fill="{text_color}" clip-path="url(#address)">{text}</text>"##,
            ),
            x = field_x,
            y = cy - field_h * 0.5,
            width = field_w,
            height = field_h,
            radius = field_h * 0.5,
            field = field,
            glyph = glyph,
            stroke = (bar_h * 0.017).max(0.65),
            gx0 = field_x + field_h * 0.34,
            gx1 = field_x + field_h * 0.77,
            gy0 = cy - field_h * 0.105,
            gy1 = cy + field_h * 0.105,
            gc0 = field_x + field_h * 0.49,
            gc1 = field_x + field_h * 0.65,
            gr = field_h * 0.055,
            text_x = text_x,
            text_width = (field_w - field_h * 1.4).max(0.0),
            baseline = cy + font_size * 0.35,
            fonts = CHROME_FONTS,
            font_size = font_size,
            text_color = text_color,
            text = escape_xml(address),
        )
    };
    format!(
        concat!(
            r##"<svg width="{w}" height="{h}" viewBox="0 0 {w} {h}" xmlns="http://www.w3.org/2000/svg">"##,
            r##"<rect width="{w}" height="{bar_fill}" fill="{bar}"/>"##,
            r##"<rect y="{line_y}" width="{w}" height="{line_h}" fill="{line}"/>"##,
            "{lights}{nav}{address_bar}",
            r##"<g fill="{glyph}" opacity="0.65"><circle cx="{menu_x}" cy="{menu_y0}" r="{menu_r}"/><circle cx="{menu_x}" cy="{cy}" r="{menu_r}"/><circle cx="{menu_x}" cy="{menu_y1}" r="{menu_r}"/></g>"##,
            "</svg>",
        ),
        w = w,
        h = h,
        bar_fill = bar_fill_height(bar_h),
        bar = bar,
        line_y = bar_h - (bar_h * 0.008).max(0.5),
        line_h = (bar_h * 0.008).max(0.5),
        line = line,
        lights = lights,
        nav = nav,
        address_bar = address_bar,
        glyph = glyph,
        menu_x = w - bar_h * 0.36,
        menu_y0 = cy - bar_h * 0.1,
        menu_y1 = cy + bar_h * 0.1,
        menu_r = bar_h * 0.023,
        cy = cy,
    )
}
fn macbook_svg(w: f64, h: f64, content_h: f64, theme: FrameTheme) -> String {
    let bezel = content_h * MACBOOK_BEZEL_FRAC;
    let deck_h = content_h * MACBOOK_DECK_FRAC;
    let overhang = content_h * MACBOOK_OVERHANG_FRAC;
    let shadow_room = content_h * MACBOOK_SHADOW_ROOM_FRAC;

    // Panel (screen + bezel) block.
    let panel_x = overhang;
    let panel_w = w - overhang * 2.0;
    let panel_h = h - deck_h - shadow_room;
    let panel_radius = bezel * 1.35;

    let deck_y = panel_h;
    let deck_radius = deck_h * 0.42;
    let scoop_w = w * 0.14;
    let scoop_h = deck_h * 0.52;

    let (alu_top, alu_bottom, alu_edge, panel_fill, scoop_top, scoop_bottom) = match theme {
        FrameTheme::Light => (
            "#E6E7E9", "#ADAFB4", "#8E9094", "#0E0E11", "#C4C6CA", "#9EA0A5",
        ),
        FrameTheme::Dark => (
            "#3E3F43", "#232427", "#151619", "#0E0E11", "#2A2B2F", "#1B1C1F",
        ),
    };

    format!(
        concat!(
            r##"<svg width="{w}" height="{h}" viewBox="0 0 {w} {h}" xmlns="http://www.w3.org/2000/svg">"##,
            "<defs>",
            r##"<linearGradient id="alu" x1="0" y1="0" x2="0" y2="1">"##,
            r##"<stop offset="0" stop-color="{alu_top}"/><stop offset="1" stop-color="{alu_bottom}"/>"##,
            "</linearGradient>",
            r##"<linearGradient id="scoop" x1="0" y1="0" x2="0" y2="1">"##,
            r##"<stop offset="0" stop-color="{scoop_top}"/><stop offset="1" stop-color="{scoop_bottom}"/>"##,
            "</linearGradient>",
            r##"<filter id="soft" x="-30%" y="-30%" width="160%" height="160%">"##,
            r##"<feGaussianBlur stdDeviation="{shadow_blur}"/>"##,
            "</filter>",
            "</defs>",
            // Baked ground shadow under the deck.
            r##"<ellipse cx="{sh_cx}" cy="{sh_cy}" rx="{sh_rx}" ry="{sh_ry}" fill="rgba(0,0,0,0.42)" filter="url(#soft)"/>"##,
            // Panel with bezel; the video sits inset by the bezel.
            r##"<rect x="{panel_x}" y="0" width="{panel_w}" height="{panel_h}" rx="{panel_radius}" fill="{panel_fill}"/>"##,
            // Camera dot centered in the top bezel.
            r##"<circle cx="{cam_cx}" cy="{cam_cy}" r="{cam_r}" fill="#17181C"/>"##,
            r##"<circle cx="{cam_cx}" cy="{cam_cy}" r="{cam_r_inner}" fill="#2A3138"/>"##,
            // Deck with rounded bottom corners and the thumb scoop.
            r##"<path d="M 0 {deck_y} H {w} V {deck_bot_edge} Q {w} {deck_bot} {deck_right_in} {deck_bot} H {deck_left_in} Q 0 {deck_bot} 0 {deck_bot_edge} Z" fill="url(#alu)"/>"##,
            r##"<rect x="0" y="{deck_y}" width="{w}" height="{edge_h}" fill="{alu_edge}" fill-opacity="0.35"/>"##,
            r##"<path d="M {scoop_left} {deck_y} h {scoop_w} v {scoop_body} a {scoop_r} {scoop_r} 0 0 1 -{scoop_r} {scoop_r} h -{scoop_flat} a {scoop_r} {scoop_r} 0 0 1 -{scoop_r} -{scoop_r} Z" fill="url(#scoop)"/>"##,
            // Bottom edge line of the deck for definition.
            r##"<rect x="{deck_left_in}" y="{deck_edge_y}" width="{deck_edge_w}" height="{deck_edge_h}" fill="{alu_edge}" fill-opacity="0.6"/>"##,
            "</svg>"
        ),
        w = w,
        h = h,
        alu_top = alu_top,
        alu_bottom = alu_bottom,
        scoop_top = scoop_top,
        scoop_bottom = scoop_bottom,
        shadow_blur = deck_h * 0.55,
        sh_cx = w * 0.5,
        sh_cy = deck_y + deck_h * 0.9,
        sh_rx = w * 0.46,
        sh_ry = deck_h * 0.55,
        panel_x = panel_x,
        panel_w = panel_w,
        panel_h = panel_h,
        panel_radius = panel_radius,
        panel_fill = panel_fill,
        cam_cx = w * 0.5,
        cam_cy = bezel * 0.5,
        cam_r = (bezel * 0.16).max(1.5),
        cam_r_inner = (bezel * 0.07).max(0.8),
        deck_y = deck_y,
        deck_bot = deck_y + deck_h,
        deck_bot_edge = deck_y + deck_h - deck_radius,
        deck_right_in = w - deck_radius,
        deck_left_in = deck_radius,
        edge_h = (deck_h * 0.06).max(1.0),
        scoop_left = (w - scoop_w) * 0.5,
        scoop_w = scoop_w,
        scoop_body = scoop_h - scoop_h * 0.5,
        scoop_r = scoop_h * 0.5,
        scoop_flat = scoop_w - scoop_h,
        deck_edge_y = deck_y + deck_h - (deck_h * 0.08).max(1.0),
        deck_edge_w = w - deck_radius * 2.0,
        deck_edge_h = (deck_h * 0.08).max(1.0),
        alu_edge = alu_edge,
    )
}

fn mobile_svg(style: FrameStyle, theme: FrameTheme, w: f64, h: f64) -> String {
    let bezel = mobile_bezel_px(style, w, h);
    let landscape_phone = style == FrameStyle::Phone && w > h;
    let (camera_x, camera_y) = if landscape_phone {
        (bezel * 0.5, h * 0.5)
    } else {
        (w * 0.5, bezel * 0.5)
    };
    let (top, bottom, edge) = match theme {
        FrameTheme::Dark => ("#343840", "#101319", "#626975"),
        FrameTheme::Light => ("#D8DCE4", "#9CA3AF", "#F4F5F8"),
    };
    format!(
        concat!(
            r##"<svg width="{w}" height="{h}" viewBox="0 0 {w} {h}" xmlns="http://www.w3.org/2000/svg">"##,
            r##"<defs><linearGradient id="body" x1="0" y1="0" x2="1" y2="1"><stop stop-color="{top}"/><stop offset="1" stop-color="{bottom}"/></linearGradient></defs>"##,
            r##"<rect width="{w}" height="{h}" fill="url(#body)"/>"##,
            r##"<rect x="0" y="0" width="{w}" height="{h}" fill="none" stroke="{edge}" stroke-width="{rim}" stroke-opacity="0.6"/>"##,
            r##"<circle cx="{camera_x}" cy="{camera_y}" r="{camera_r}" fill="#080B11" stroke="#6D778B" stroke-opacity="0.6" stroke-width="{lens_rim}"/>"##,
            r##"<circle cx="{camera_x}" cy="{camera_y}" r="{lens_r}" fill="#152438"/>"##,
            "</svg>"
        ),
        w = w,
        h = h,
        top = top,
        bottom = bottom,
        edge = edge,
        camera_x = camera_x,
        camera_y = camera_y,
        rim = (bezel * 0.06).max(0.6),
        camera_r = bezel * 0.16,
        lens_r = bezel * 0.07,
        lens_rim = (bezel * 0.025).max(0.35),
    )
}

/// Build the SVG for a chrome card of `w`×`h` texture pixels wrapping a video
/// content area of height `content_h` texture pixels.
pub fn chrome_svg(
    style: FrameStyle,
    theme: FrameTheme,
    url: &str,
    title: &str,
    w: f64,
    h: f64,
    content_h: f64,
) -> Option<String> {
    match style {
        FrameStyle::None => None,
        FrameStyle::MacOS => Some(macos_svg(w, h, content_h * MACOS_BAR_FRAC, theme, title)),
        FrameStyle::Windows => Some(windows_svg(
            w,
            h,
            content_h * WINDOWS_BAR_FRAC,
            theme,
            title,
        )),
        FrameStyle::Browser => Some(browser_svg(w, h, content_h * BROWSER_BAR_FRAC, theme, url)),
        FrameStyle::Macbook => Some(macbook_svg(w, h, content_h, theme)),
        FrameStyle::Phone | FrameStyle::Tablet => Some(mobile_svg(style, theme, w, h)),
    }
}

fn chrome_fontdb() -> Arc<resvg::usvg::fontdb::Database> {
    static FONTDB: OnceLock<Arc<resvg::usvg::fontdb::Database>> = OnceLock::new();
    FONTDB
        .get_or_init(|| {
            let mut db = resvg::usvg::fontdb::Database::new();
            db.load_system_fonts();
            Arc::new(db)
        })
        .clone()
}

/// Rasterize a chrome card to RGBA8 (non-premultiplied). Returns `None` for
/// [`FrameStyle::None`] or if rasterization fails (the frame layer then skips
/// drawing rather than erroring the whole frame).
pub fn rasterize_chrome(
    style: FrameStyle,
    theme: FrameTheme,
    url: &str,
    title: &str,
    tex_w: u32,
    tex_h: u32,
    content_h_px: f64,
) -> Option<Vec<u8>> {
    let svg = chrome_svg(
        style,
        theme,
        url,
        title,
        tex_w as f64,
        tex_h as f64,
        content_h_px,
    )?;

    let options = resvg::usvg::Options {
        fontdb: if matches!(style, FrameStyle::Phone | FrameStyle::Tablet) {
            Arc::new(resvg::usvg::fontdb::Database::new())
        } else {
            chrome_fontdb()
        },
        ..Default::default()
    };

    let tree = match resvg::usvg::Tree::from_str(&svg, &options) {
        Ok(tree) => tree,
        Err(error) => {
            tracing::warn!("Failed to parse frame chrome SVG: {error}");
            return None;
        }
    };

    let mut pixmap = tiny_skia::Pixmap::new(tex_w, tex_h)?;
    resvg::render(
        &tree,
        tiny_skia::Transform::identity(),
        &mut pixmap.as_mut(),
    );

    Some(
        pixmap
            .pixels()
            .iter()
            .flat_map(|p| {
                let c = p.demultiply();
                [c.red(), c.green(), c.blue(), c.alpha()]
            })
            .collect(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_frame_has_no_insets() {
        assert_eq!(chrome_insets(FrameStyle::None), ChromeInsets::default());
    }

    #[test]
    fn texture_size_respects_max_dim() {
        let (w, h) = chrome_texture_size(8000.0, 200.0);
        assert!(w <= 4096 && h <= 4096);
        let (w, h) = chrome_texture_size(1600.0, 1000.0);
        assert_eq!((w, h), (3200, 2000));
    }

    /// Visual iteration helper: dumps every style/theme chrome to PNGs.
    /// `CAP_CHROME_DUMP_DIR=/tmp/x cargo test -p cap-rendering dump_chrome -- --ignored`
    #[test]
    #[ignore]
    fn dump_chrome_pngs() {
        let Ok(dir) = std::env::var("CAP_CHROME_DUMP_DIR") else {
            return;
        };
        std::fs::create_dir_all(&dir).unwrap();
        for style in [
            FrameStyle::MacOS,
            FrameStyle::Windows,
            FrameStyle::Browser,
            FrameStyle::Macbook,
        ] {
            for theme in [FrameTheme::Light, FrameTheme::Dark] {
                let insets = chrome_insets(style);
                let content_h = 900.0_f64;
                let content_w = content_h * 16.0 / 10.0;
                let w = (content_w + (insets.left + insets.right) * content_h).round() as u32;
                let h = (content_h * (1.0 + insets.top + insets.bottom)).round() as u32;
                let rgba =
                    rasterize_chrome(style, theme, "cap.so", "Cap Recording", w, h, content_h)
                        .unwrap();
                image::RgbaImage::from_raw(w, h, rgba)
                    .unwrap()
                    .save(format!("{dir}/{style:?}-{theme:?}.png"))
                    .unwrap();
            }
        }
    }

    #[test]
    fn all_styles_rasterize() {
        for style in [
            FrameStyle::MacOS,
            FrameStyle::Windows,
            FrameStyle::Browser,
            FrameStyle::Macbook,
            FrameStyle::Phone,
            FrameStyle::Tablet,
        ] {
            for theme in [FrameTheme::Light, FrameTheme::Dark] {
                let rgba = rasterize_chrome(style, theme, "cap.so", "Recording", 640, 420, 360.0);
                let rgba = rgba.expect("chrome should rasterize");
                assert_eq!(rgba.len(), 640 * 420 * 4);
                // Something visible must have been drawn.
                assert!(rgba.chunks_exact(4).any(|px| px[3] > 0));
            }
        }
    }

    #[test]
    fn mobile_bezels_keep_the_same_thickness_when_rotated() {
        for style in [FrameStyle::Phone, FrameStyle::Tablet] {
            for (width, height) in [
                (360.0, 640.0),
                (640.0, 360.0),
                (768.0, 1024.0),
                (1024.0, 768.0),
            ] {
                let insets = chrome_insets_for_aspect(style, width / height);
                let bezel = insets.top * height;
                assert!((bezel - mobile_bezel_fraction(style) * width.min(height)).abs() < 1e-9);
                let outer_width = width + bezel * 2.0;
                let outer_height = height + bezel * 2.0;
                assert!((mobile_bezel_px(style, outer_width, outer_height) - bezel).abs() < 1e-9);
                let rgba = rasterize_chrome(
                    style,
                    FrameTheme::Dark,
                    "",
                    "",
                    outer_width.ceil() as u32,
                    outer_height.ceil() as u32,
                    height,
                )
                .unwrap();
                assert_eq!(
                    rgba.len(),
                    outer_width.ceil() as usize * outer_height.ceil() as usize * 4
                );
            }
        }
    }
}
