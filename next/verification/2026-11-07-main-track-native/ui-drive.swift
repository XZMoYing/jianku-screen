import AppKit
import ApplicationServices
import Foundation

let appPath = "/Applications/Jianku Screen Next.app"
guard let app = NSRunningApplication.runningApplications(withBundleIdentifier: "com.jianku.screen.next")
    .first(where: { $0.bundleURL?.path == appPath }) else {
    print("{\"running\":false}")
    exit(2)
}
let args = Array(CommandLine.arguments.dropFirst())
func emit(_ value: [String: Any]) {
    print(String(data: try! JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]), encoding: .utf8)!)
}
let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
let owned = windows.filter { ($0[kCGWindowOwnerPID as String] as? Int) == Int(app.processIdentifier) }
let editors = owned.filter { (($0[kCGWindowName as String] as? String) ?? "").contains("视频编辑") }

guard args.count >= 1 else { exit(2) }
switch args[0] {
case "windows":
    var list: [[String: Any]] = []
    for window in owned {
        guard let number = window[kCGWindowNumber as String] as? Int, let bounds = window[kCGWindowBounds as String] as? [String: Double] else { continue }
        list.append(["id": number, "title": window[kCGWindowName as String] as? String ?? "", "bounds": bounds])
    }
    emit(["pid": Int(app.processIdentifier), "windows": list])
case "drag":
    guard args.count >= 7, editors.count == 1, let windowID = Int(args[1]),
          let rect = editors[0][kCGWindowBounds as String] as? [String: Double],
          let ox = rect["X"], let oy = rect["Y"], let width = rect["Width"], let height = rect["Height"],
          let x0 = Double(args[2]), let y0 = Double(args[3]), let x1 = Double(args[4]), let y1 = Double(args[5]),
          let steps = Int(args[6]), steps >= 2, steps <= 60,
          [x0, x1].allSatisfy({ $0 >= 0 && $0 < width }), [y0, y1].allSatisfy({ $0 >= 0 && $0 < height })
    else { exit(2) }
    guard windowID == editors[0][kCGWindowNumber as String] as? Int else { exit(2) }
    app.activate(options: [])
    RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.3))
    guard NSWorkspace.shared.frontmostApplication?.processIdentifier == app.processIdentifier else { exit(2) }
    func send(_ kind: CGEventType, _ x: Double, _ y: Double) {
        if let event = CGEvent(mouseEventSource: nil, mouseType: kind, mouseCursorPosition: CGPoint(x: ox + x, y: oy + y), mouseButton: .left) {
            event.post(tap: .cghidEventTap)
        }
        Thread.sleep(forTimeInterval: 0.05)
    }
    send(.mouseMoved, x0, y0)
    send(.leftMouseDown, x0, y0)
    send(.leftMouseDragged, x0 + (x1 - x0) * 0.02, y0 + (y1 - y0) * 0.02)
    for step in 1...steps {
        let t = Double(step) / Double(steps)
        send(.leftMouseDragged, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)
    }
    send(.leftMouseUp, x1, y1)
    emit(["draggedWindow": windowID, "from": [x0, y0], "to": [x1, y1], "steps": steps])
case "drag-cancel":
    guard args.count >= 6, editors.count == 1, let windowID = Int(args[1]),
          let rect = editors[0][kCGWindowBounds as String] as? [String: Double],
          let ox = rect["X"], let oy = rect["Y"],
          let x0 = Double(args[2]), let y0 = Double(args[3]), let x1 = Double(args[4]), let y1 = Double(args[5])
    else { exit(2) }
    guard windowID == editors[0][kCGWindowNumber as String] as? Int else { exit(2) }
    app.activate(options: [])
    RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.3))
    guard NSWorkspace.shared.frontmostApplication?.processIdentifier == app.processIdentifier else { exit(2) }
    func sendCancel(_ kind: CGEventType, _ x: Double, _ y: Double) {
        if let event = CGEvent(mouseEventSource: nil, mouseType: kind, mouseCursorPosition: CGPoint(x: ox + x, y: oy + y), mouseButton: .left) {
            event.post(tap: .cghidEventTap)
        }
        Thread.sleep(forTimeInterval: 0.06)
    }
    sendCancel(.mouseMoved, x0, y0)
    sendCancel(.leftMouseDown, x0, y0)
    for step in 1...8 {
        let t = Double(step) / 8
        sendCancel(.leftMouseDragged, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)
    }
    if let escape = CGEvent(keyboardEventSource: nil, virtualKey: 53, keyDown: true) {
        escape.postToPid(app.processIdentifier)
    }
    Thread.sleep(forTimeInterval: 0.15)
    sendCancel(.leftMouseUp, x1, y1)
    emit(["cancelledDragWindow": windowID, "from": [x0, y0], "to": [x1, y1]])
case "right-click":
    guard args.count >= 4, editors.count == 1, let windowID = Int(args[1]),
          let rect = editors[0][kCGWindowBounds as String] as? [String: Double],
          let ox = rect["X"], let oy = rect["Y"],
          let x = Double(args[2]), let y = Double(args[3]) else { exit(2) }
    guard windowID == editors[0][kCGWindowNumber as String] as? Int else { exit(2) }
    app.activate(options: [])
    RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.3))
    guard NSWorkspace.shared.frontmostApplication?.processIdentifier == app.processIdentifier else { exit(2) }
    let point = CGPoint(x: ox + x, y: oy + y)
    for kind in [CGEventType.rightMouseDown, .rightMouseUp] {
        if let event = CGEvent(mouseEventSource: nil, mouseType: kind, mouseCursorPosition: point, mouseButton: .right) {
            event.setIntegerValueField(.mouseEventClickState, value: 1)
            event.post(tap: .cghidEventTap)
        }
        Thread.sleep(forTimeInterval: 0.08)
    }
    emit(["rightClickedWindow": windowID, "at": [x, y]])
case "key":
    guard args.count >= 2 else { exit(2) }
    let keys: [String: (CGKeyCode, CGEventFlags)] = [
        "save": (1, [.maskCommand]),
        "undo": (6, [.maskCommand]),
        "redo": (6, [.maskCommand, .maskShift]),
        "escape": (53, []),
        "space": (49, []),
        "delete": (51, []),
        "copy": (8, [.maskCommand]),
        "snap": (45, []),
        "cmd-b": (11, [.maskCommand]),
        "b": (11, []),
    ]
    guard let (code, flags) = keys[args[1]] else { exit(2) }
    app.activate(options: [])
    RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.3))
    guard NSWorkspace.shared.frontmostApplication?.processIdentifier == app.processIdentifier else { exit(2) }
    for down in [true, false] {
        if let event = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: down) {
            event.flags = flags
            event.postToPid(app.processIdentifier)
        }
        Thread.sleep(forTimeInterval: 0.04)
    }
    emit(["keySent": args[1]])
case "click":
    guard args.count >= 4, editors.count == 1, let windowID = Int(args[1]),
          let rect = editors[0][kCGWindowBounds as String] as? [String: Double],
          let ox = rect["X"], let oy = rect["Y"],
          let x = Double(args[2]), let y = Double(args[3]) else { exit(2) }
    guard windowID == editors[0][kCGWindowNumber as String] as? Int else { exit(2) }
    app.activate(options: [])
    RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.3))
    guard NSWorkspace.shared.frontmostApplication?.processIdentifier == app.processIdentifier else { exit(2) }
    let point = CGPoint(x: ox + x, y: oy + y)
    for kind in [CGEventType.leftMouseDown, .leftMouseUp] {
        if let event = CGEvent(mouseEventSource: nil, mouseType: kind, mouseCursorPosition: point, mouseButton: .left) { event.post(tap: .cghidEventTap) }
        Thread.sleep(forTimeInterval: 0.06)
    }
    emit(["clickedWindow": windowID, "at": [x, y]])
default:
    exit(2)
}