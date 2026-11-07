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
case "press-at":
    guard args.count >= 4, let windowID = Int(args[1]),
          let rect = editors[0][kCGWindowBounds as String] as? [String: Double],
          let ox = rect["X"], let oy = rect["Y"],
          let x = Double(args[2]), let y = Double(args[3]) else { exit(2) }
    let root = AXUIElementCreateApplication(app.processIdentifier)
    func readAttr(_ item: AXUIElement, _ key: String) -> CFTypeRef? {
        var result: CFTypeRef?
        return AXUIElementCopyAttributeValue(item, key as CFString, &result) == .success ? result : nil
    }
    func walkAX(_ top: AXUIElement, depth: Int) -> [AXUIElement] {
        guard depth >= 0 else { return [] }
        let children = readAttr(top, "AXChildren") as? [AXUIElement] ?? []
        return [top] + children.flatMap { walkAX($0, depth: depth - 1) }
    }
    let windows = readAttr(root, "AXWindows") as? [AXUIElement] ?? []
    var target: AXUIElement?
    for window in windows {
        let title = (readAttr(window, "AXTitle") as? String) ?? ""
        guard title.contains("视频编辑") else { continue }
        for node in walkAX(window, depth: 20) {
            guard (["AXButton", "AXPopUpButton", "AXMenuItem", "AXRadioButton"].contains((readAttr(node, "AXRole") as? String) ?? "")),
                  let posValue = readAttr(node, "AXPosition"), CFGetTypeID(posValue) == AXValueGetTypeID(),
                  let sizeValue = readAttr(node, "AXSize"), CFGetTypeID(sizeValue) == AXValueGetTypeID()
            else { continue }
            var pos = CGPoint.zero
            var size = CGSize.zero
            guard AXValueGetValue(posValue as! AXValue, .cgPoint, &pos),
                  AXValueGetValue(sizeValue as! AXValue, .cgSize, &size) else { continue }
            let left = Double(pos.x) - ox - 2
            let right = Double(pos.x) - ox + Double(size.width) + 2
            let top = Double(pos.y) - oy - 2
            let bottom = Double(pos.y) - oy + Double(size.height) + 2
            if x >= left && x <= right && y >= top && y <= bottom {
                target = node
                break
            }
        }
        if target != nil { break }
    }
    guard let target else { emit(["pressed": false]); exit(2) }
    let status = AXUIElementPerformAction(target, kAXPressAction as CFString)
    emit(["pressed": status == .success, "status": status.rawValue])
case "press-label":
    guard args.count >= 2 else { exit(2) }
    let label = args[1]
    let rootAll = AXUIElementCreateApplication(app.processIdentifier)
    func readAll(_ item: AXUIElement, _ key: String) -> CFTypeRef? {
        var result: CFTypeRef?
        return AXUIElementCopyAttributeValue(item, key as CFString, &result) == .success ? result : nil
    }
    func walkAll(_ top: AXUIElement, depth: Int) -> [AXUIElement] {
        guard depth >= 0 else { return [] }
        let children = readAll(top, "AXChildren") as? [AXUIElement] ?? []
        return [top] + children.flatMap { walkAll($0, depth: depth - 1) }
    }
    let winList = readAll(rootAll, "AXWindows") as? [AXUIElement] ?? []
    var matches: [AXUIElement] = []
    for window in winList {
        for node in walkAll(window, depth: 24) {
            let role = (readAll(node, "AXRole") as? String) ?? ""
            guard ["AXButton", "AXPopUpButton", "AXMenuItem", "AXRadioButton", "AXLink"].contains(role) else { continue }
            let title = (readAll(node, "AXTitle") as? String) ?? ""
            let desc = (readAll(node, "AXDescription") as? String) ?? ""
            let value = (readAll(node, "AXValue") as? String) ?? ""
            if title == label || desc == label || value == label { matches.append(node) }
        }
    }
    guard matches.count == 1 else { emit(["pressed": false, "matches": matches.count]); exit(2) }
    let pressStatus = AXUIElementPerformAction(matches[0], kAXPressAction as CFString)
    emit(["pressed": pressStatus == .success, "label": label, "status": pressStatus.rawValue])
case "set-sheet-filename":
    guard args.count >= 2 else { exit(2) }
    let filename = args[1]
    let rootText = AXUIElementCreateApplication(app.processIdentifier)
    func readText(_ item: AXUIElement, _ key: String) -> CFTypeRef? {
        var result: CFTypeRef?
        return AXUIElementCopyAttributeValue(item, key as CFString, &result) == .success ? result : nil
    }
    func walkText(_ top: AXUIElement, depth: Int) -> [AXUIElement] {
        guard depth >= 0 else { return [] }
        let children = readText(top, "AXChildren") as? [AXUIElement] ?? []
        return [top] + children.flatMap { walkText($0, depth: depth - 1) }
    }
    let windowsText = readText(rootText, "AXWindows") as? [AXUIElement] ?? []
    var sheetFields: [AXUIElement] = []
    for window in windowsText {
        for node in walkText(window, depth: 24) where ((readText(node, "AXRole") as? String) ?? "") == "AXSheet" {
            for child in walkText(node, depth: 24) {
                guard ((readText(child, "AXRole") as? String) ?? "") == "AXTextField" else { continue }
                var settable = DarwinBoolean(false)
                if AXUIElementIsAttributeSettable(child, "AXValue" as CFString, &settable) == .success, settable.boolValue {
                    sheetFields.append(child)
                }
            }
        }
    }
    guard let first = sheetFields.first else { emit(["set": false]); exit(2) }
    let setStatus = AXUIElementSetAttributeValue(first, "AXValue" as CFString, filename as CFString)
    emit(["set": setStatus == .success, "status": setStatus.rawValue, "fields": sheetFields.count])
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
        "save-copy": (1, [.maskCommand, .maskShift]),
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