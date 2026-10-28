fn main() {
    let args: Vec<_> = std::env::args().collect();
    let mut options = resvg::usvg::Options::default();
    let mut fonts = resvg::usvg::fontdb::Database::new();
    fonts.load_system_fonts();
    options.fontdb = std::sync::Arc::new(fonts);
    let data = std::fs::read(&args[1]).unwrap();
    let tree = resvg::usvg::Tree::from_data(&data, &options).unwrap();
    let size = tree.size().to_int_size();
    let mut pixels = resvg::tiny_skia::Pixmap::new(size.width(), size.height()).unwrap();
    resvg::render(
        &tree,
        resvg::tiny_skia::Transform::identity(),
        &mut pixels.as_mut(),
    );
    pixels.save_png(&args[2]).unwrap();
}
