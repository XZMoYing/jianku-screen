#[cfg(target_os = "macos")]
fn main() {
    use objc2::MainThreadMarker;
    use objc2_app_kit::NSApplication;

    let marker = MainThreadMarker::new().expect("native cursor probe runs on the main thread");
    let _app = NSApplication::sharedApplication(marker);
    check_system_cursors("main");
    std::thread::spawn(|| check_system_cursors("recording-thread"))
        .join()
        .expect("standard cursor recognition on the recording worker");
}

#[cfg(target_os = "macos")]
fn check_system_cursors(context: &str) {
    use cap_cursor_info::CursorShapeMacOS;
    use objc2::{msg_send, rc::Retained};
    use objc2_app_kit::{NSCursor, NSImage};
    use sha2::{Digest, Sha256};

    let cursors = [
        ("arrow", NSCursor::arrowCursor(), CursorShapeMacOS::Arrow),
        ("ibeam", NSCursor::IBeamCursor(), CursorShapeMacOS::IBeam),
        (
            "pointingHand",
            NSCursor::pointingHandCursor(),
            CursorShapeMacOS::PointingHand,
        ),
        (
            "crosshair",
            NSCursor::crosshairCursor(),
            CursorShapeMacOS::Crosshair,
        ),
        (
            "openHand",
            NSCursor::openHandCursor(),
            CursorShapeMacOS::OpenHand,
        ),
        (
            "closedHand",
            NSCursor::closedHandCursor(),
            CursorShapeMacOS::ClosedHand,
        ),
    ];
    for (name, cursor, expected) in cursors {
        unsafe {
            let image: Option<Retained<NSImage>> = msg_send![&*cursor, image];
            let image = image.expect("standard cursor image");
            let bytes = image.TIFFRepresentation().expect("standard cursor TIFF");
            let bytes = bytes.as_bytes_unchecked();
            let hash = Sha256::digest(bytes);
            let fixed = CursorShapeMacOS::from_hash(&format!("{hash:x}"));
            let actual = CursorShapeMacOS::from_system_image(bytes);
            assert_eq!(
                actual.map(|shape| cap_cursor_info::CursorShape::MacOS(shape)
                    .in_family(cap_cursor_info::CursorFamily::MacOS)),
                Some(cap_cursor_info::CursorShape::MacOS(expected))
            );
            println!(
                "{context}/{name}: fixed={fixed:?} runtime={actual:?} size={:?} hotspot={:?}",
                image.size(),
                cursor.hotSpot()
            );
        }
    }
}

#[cfg(not(target_os = "macos"))]
fn main() {
    println!("This probe requires macOS AppKit");
}
