use std::{cell::RefCell, collections::HashMap, time::Duration, time::Instant};

use objc2::{ClassType, msg_send, rc::Retained};
use objc2_app_kit::{NSCursor, NSImage};
use objc2_foundation::NSProcessInfo;
use sha2::{Digest, Sha256};

use crate::CursorShapeMacOS;

type CursorHash = [u8; 32];

#[derive(Default)]
struct SystemCursorCache {
    shapes: HashMap<CursorHash, CursorShapeMacOS>,
    refreshed_at: Option<Instant>,
}

impl SystemCursorCache {
    fn resolve(
        &mut self,
        hash: CursorHash,
        now: Instant,
        refresh: impl FnOnce() -> HashMap<CursorHash, CursorShapeMacOS>,
    ) -> Option<CursorShapeMacOS> {
        if let Some(shape) = self.shapes.get(&hash) {
            return Some(*shape);
        }
        if self
            .refreshed_at
            .is_none_or(|time| now.saturating_duration_since(time) >= Duration::from_secs(1))
        {
            self.shapes = refresh();
            self.refreshed_at = Some(now);
        }
        self.shapes.get(&hash).copied()
    }
}

thread_local! {
    static SYSTEM_CURSORS: RefCell<SystemCursorCache> = RefCell::default();
}

impl CursorShapeMacOS {
    pub fn from_system_image(image: &[u8]) -> Option<Self> {
        let hash = Sha256::digest(image);
        if let Some(shape) = Self::from_hash(&format!("{hash:x}")) {
            return Some(shape);
        }
        // Accessibility settings change system cursor TIFFs, so fixed hashes
        // cannot identify every standard shape. Refresh on misses to cover
        // settings changed during a recording without caching custom cursors.
        SYSTEM_CURSORS.with(|cache| {
            cache
                .borrow_mut()
                .resolve(hash.into(), Instant::now(), system_cursor_shapes)
        })
    }
}

fn system_cursor_shapes() -> HashMap<CursorHash, CursorShapeMacOS> {
    use CursorShapeMacOS::*;

    let tahoe = NSProcessInfo::processInfo()
        .operatingSystemVersion()
        .majorVersion
        >= 26;
    let class = NSCursor::class();
    let cursors: [(Option<Retained<NSCursor>>, CursorShapeMacOS); 18] = unsafe {
        [
            (msg_send![class, arrowCursor], Arrow),
            (msg_send![class, contextualMenuCursor], ContextualMenu),
            (msg_send![class, closedHandCursor], ClosedHand),
            (msg_send![class, crosshairCursor], Crosshair),
            (msg_send![class, disappearingItemCursor], DisappearingItem),
            (msg_send![class, dragCopyCursor], DragCopy),
            (msg_send![class, dragLinkCursor], DragLink),
            (msg_send![class, IBeamCursor], IBeam),
            (msg_send![class, openHandCursor], OpenHand),
            (
                msg_send![class, operationNotAllowedCursor],
                OperationNotAllowed,
            ),
            (msg_send![class, pointingHandCursor], PointingHand),
            (msg_send![class, resizeDownCursor], ResizeDown),
            (msg_send![class, resizeLeftCursor], ResizeLeft),
            (msg_send![class, resizeLeftRightCursor], ResizeLeftRight),
            (msg_send![class, resizeRightCursor], ResizeRight),
            (msg_send![class, resizeUpCursor], ResizeUp),
            (msg_send![class, resizeUpDownCursor], ResizeUpDown),
            (
                msg_send![class, IBeamCursorForVerticalLayout],
                IBeamVerticalForVerticalLayout,
            ),
        ]
    };
    cursors
        .into_iter()
        .filter_map(|(cursor, shape)| unsafe {
            let cursor = cursor?;
            let image: Option<Retained<NSImage>> = msg_send![&*cursor, image];
            let bytes = image?.TIFFRepresentation()?;
            let hash = Sha256::digest(bytes.as_bytes_unchecked()).into();
            Some((hash, if tahoe { shape.to_tahoe() } else { shape }))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn system_settings_changes_replace_the_snapshot() {
        let mut cache = SystemCursorCache::default();
        let now = Instant::now();
        let normal = [1; 32];
        let enlarged = [2; 32];
        let shape = CursorShapeMacOS::PointingHand;
        assert_eq!(
            cache.resolve(normal, now, || HashMap::from([(normal, shape)])),
            Some(shape)
        );
        assert_eq!(
            cache.resolve(normal, now, || panic!("known cursor must not rebuild")),
            Some(shape)
        );
        assert_eq!(
            cache.resolve(enlarged, now, || panic!("misses must be throttled")),
            None
        );
        assert_eq!(
            cache.resolve(enlarged, now + Duration::from_secs(1), || HashMap::from([
                (enlarged, shape)
            ])),
            Some(shape)
        );
        assert_eq!(cache.shapes.len(), 1);
        assert!(!cache.shapes.contains_key(&normal));
    }

    #[test]
    fn custom_cursors_are_not_classified_or_accumulated() {
        let mut cache = SystemCursorCache::default();
        let now = Instant::now();
        for index in 0..100 {
            assert_eq!(
                cache.resolve(
                    [index; 32],
                    now + Duration::from_secs(u64::from(index)),
                    HashMap::new
                ),
                None
            );
            assert!(cache.shapes.is_empty());
        }
    }

    #[test]
    fn unknown_images_remain_unclassified() {
        assert_eq!(CursorShapeMacOS::from_system_image(b"custom drawing"), None);
    }
}
