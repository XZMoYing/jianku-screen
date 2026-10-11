#pragma once

#include <QImage>
#include <QSizeF>

struct MouseSample {
    double x = 0.0; // global points, origin bottom-left (AppKit)
    double y = 0.0;
    bool pressed = false;
    bool interactionActivity = false; // scroll / key-down counter changed; no key contents
    unsigned long long cursorIdentity = 0; // cheap change token for the current cursor
};

struct CursorSample {
    QImage image;
    double pointWidth = 0.0;
    double pointHeight = 0.0;
    double hotspotX = 0.0; // normalised 0..1 within the cursor image
    double hotspotY = 0.0;
    bool valid = false;
};

// Reads the live pointer without requiring capture permission.
MouseSample pollMouse();
// Reads the current system cursor image + hotspot (more expensive; call on change).
CursorSample currentCursor();
QSizeF primaryScreenPoints();
