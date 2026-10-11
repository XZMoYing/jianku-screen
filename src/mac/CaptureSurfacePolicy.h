#pragma once
#import <AppKit/AppKit.h>
#import <ScreenCaptureKit/ScreenCaptureKit.h>
#include <QGuiApplication>
#include <QWindow>
#include <QSet>

// Helper surfaces (recorder controls / audience output / permission guide) are
// excluded for this process only. Editors are normal source windows. Capture
// the IDs on the GUI thread before passing them into a native async callback.
inline QSet<quint32> editorCaptureWindowIds() {
    QSet<quint32> result;
    for (QWindow *window : QGuiApplication::allWindows()) {
        if (!window->property("editorWindowId").isValid()) continue;
        NSView *view = (__bridge NSView *)reinterpret_cast<void *>(window->winId());
        if (view.window) result.insert(quint32(view.window.windowNumber));
    }
    return result;
}
inline SCContentFilter *displayCaptureFilter(SCDisplay *display,
    NSArray<SCRunningApplication *> *applications, NSArray<SCWindow *> *windows,
    const QSet<quint32> &editorIds) {
    NSMutableArray<SCRunningApplication *> *excluded = [NSMutableArray array];
    NSMutableArray<SCWindow *> *exceptions = [NSMutableArray array];
    const pid_t ownPid = NSProcessInfo.processInfo.processIdentifier;
    for (SCRunningApplication *app in applications) if (app.processID == ownPid) [excluded addObject:app];
    for (SCWindow *window in windows)
        if (window.owningApplication.processID == ownPid && editorIds.contains(window.windowID)) [exceptions addObject:window];
    return [[SCContentFilter alloc] initWithDisplay:display excludingApplications:excluded exceptingWindows:exceptions];
}
