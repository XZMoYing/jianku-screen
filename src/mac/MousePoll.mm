#include "MousePoll.h"

#import <AppKit/AppKit.h>

MouseSample pollMouse() {
    const NSPoint location = [NSEvent mouseLocation];
    const NSUInteger buttons = [NSEvent pressedMouseButtons];
    MouseSample sample;
    sample.x = location.x;
    sample.y = location.y;
    sample.pressed = buttons != 0; // any mouse button
    // Public event counters detect activity without retaining typed text.
    const uint32_t scroll = CGEventSourceCounterForEventType(kCGEventSourceStateCombinedSessionState, kCGEventScrollWheel);
    const uint32_t keys = CGEventSourceCounterForEventType(kCGEventSourceStateCombinedSessionState, kCGEventKeyDown);
    static uint32_t previousScroll = scroll, previousKeys = keys;
    sample.interactionActivity = scroll != previousScroll || keys != previousKeys;
    previousScroll = scroll;
    previousKeys = keys;
    sample.cursorIdentity =
        reinterpret_cast<unsigned long long>((__bridge void *)[NSCursor currentSystemCursor]);
    return sample;
}

CursorSample currentCursor() {
    CursorSample sample;
    NSCursor *cursor = [NSCursor currentSystemCursor];
    if (!cursor)
        return sample;
    NSImage *image = cursor.image;
    if (!image)
        return sample;
    const NSSize pointSize = image.size;
    if (pointSize.width <= 0.0 || pointSize.height <= 0.0)
        return sample;

    NSRect rect = NSMakeRect(0, 0, pointSize.width, pointSize.height);
    CGImageRef cgImage = [image CGImageForProposedRect:&rect context:nil hints:nil];
    if (!cgImage)
        return sample;
    const size_t width = CGImageGetWidth(cgImage);
    const size_t height = CGImageGetHeight(cgImage);
    if (width == 0 || height == 0)
        return sample;

    QImage result(int(width), int(height), QImage::Format_ARGB32_Premultiplied);
    result.fill(Qt::transparent);
    CGColorSpaceRef space = CGColorSpaceCreateDeviceRGB();
    CGContextRef context = CGBitmapContextCreate(result.bits(), width, height, 8,
        result.bytesPerLine(), space,
        kCGImageAlphaPremultipliedFirst | kCGBitmapByteOrder32Little);
    CGColorSpaceRelease(space);
    if (!context)
        return sample;
    // A CGBitmapContext stores rows top-first while drawing with a bottom-left
    // origin, so drawing directly yields a correctly oriented (non-flipped) image.
    CGContextDrawImage(context, CGRectMake(0, 0, CGFloat(width), CGFloat(height)), cgImage);
    CGContextRelease(context);

    sample.image = result;
    sample.pointWidth = pointSize.width;
    sample.pointHeight = pointSize.height;
    const NSPoint hotspot = cursor.hotSpot;
    sample.hotspotX = hotspot.x / pointSize.width;
    sample.hotspotY = hotspot.y / pointSize.height;
    sample.valid = true;
    return sample;
}

QSizeF primaryScreenPoints() {
    NSScreen *screen = [NSScreen mainScreen];
    if (!screen)
        return QSizeF(1920.0, 1080.0);
    const NSRect frame = screen.frame;
    return QSizeF(frame.size.width, frame.size.height);
}
