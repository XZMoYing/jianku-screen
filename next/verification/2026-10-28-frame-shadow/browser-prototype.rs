#[derive(Clone, Copy)]
enum FrameTheme {
    Light,
    Dark,
}
const CHROME_FONTS: &str = "Helvetica Neue, Helvetica, Segoe UI, Arial, sans-serif";
fn escape_xml(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('\"', "&quot;")
}
fn bar_fill_height(h: f64) -> f64 {
    h + (h * 0.04).max(1.5)
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

fn main() {
    for (name, theme, width, url) in [
        ("light", FrameTheme::Light, 1440.0, "jianku.local"),
        ("dark", FrameTheme::Dark, 1440.0, "jianku.local"),
        (
            "narrow",
            FrameTheme::Light,
            320.0,
            "example.com/a-long-page-with-extra-details",
        ),
        (
            "localized",
            FrameTheme::Light,
            1440.0,
            "简库镜传 · 项目演示",
        ),
    ] {
        std::fs::write(
            format!("/private/tmp/jianku-frame-3d/browser-{}.svg", name),
            browser_svg(width, 60.0, 60.0, theme, url),
        )
        .unwrap();
    }
}
