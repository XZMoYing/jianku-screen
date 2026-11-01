import AppKit
import ApplicationServices
import CoreGraphics

let args = CommandLine.arguments
let path = "/Applications/Jianku Screen Next.app"
let matches = NSRunningApplication.runningApplications(withBundleIdentifier: "com.jianku.screen.next").filter { $0.bundleURL?.path == path }
guard (args.count == 8 || args.count == 9), matches.count == 1, let app = matches.first, AXIsProcessTrusted(),
 let version = NSDictionary(contentsOfFile: path + "/Contents/Info.plist")?["CFBundleShortVersionString"] as? String,
 version == "0.2.0-alpha.53", let windowID = Int(args[1]),
 let x1 = Double(args[2]), let y1 = Double(args[3]), let x2 = Double(args[4]), let y2 = Double(args[5]),
 let steps = Int(args[6]), steps >= 2, steps <= 120, let duration = Double(args[7]), duration >= 0.1, duration <= 5 else { exit(2) }
let application = AXUIElementCreateApplication(app.processIdentifier)
func read(_ node: AXUIElement, _ key: String) -> CFTypeRef? {
 var result: CFTypeRef?
 return AXUIElementCopyAttributeValue(node, key as CFString, &result) == .success ? result : nil
}
let editors = (read(application, kAXWindowsAttribute) as? [AXUIElement] ?? []).filter { (read($0, kAXTitleAttribute) as? String)?.contains("视频编辑") == true }
guard editors.count == 1 else { exit(2) }
var labels: [String] = []
func collect(_ node: AXUIElement, _ depth: Int) {
 guard depth < 36, labels.count < 2400 else { return }
 if let title = read(node, kAXValueAttribute) as? String { labels.append(title) }
 if let title = read(node, kAXTitleAttribute) as? String { labels.append(title) }
 for child in read(node, kAXChildrenAttribute) as? [AXUIElement] ?? [] { collect(child, depth + 1) }
}
collect(editors[0], 0)
guard labels.contains(where: { $0.contains("拖动与缩放验收") }) else { exit(2) }
func ownWindow() -> [String: Double]? {
 let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
 return windows.first(where: { ($0[kCGWindowOwnerPID as String] as? Int) == Int(app.processIdentifier) && ($0[kCGWindowNumber as String] as? Int) == windowID && ($0[kCGWindowName as String] as? String)?.contains("视频编辑") == true })?[kCGWindowBounds as String] as? [String: Double]
}
guard let bounds = ownWindow(), let ox = bounds["X"], let oy = bounds["Y"], let width = bounds["Width"], let height = bounds["Height"],
 min(x1, x2) >= 0, min(y1, y2) >= 0, max(x1, x2) < width, max(y1, y2) < height else { exit(2) }
_ = app.activate(options: [.activateAllWindows])
RunLoop.current.run(until: Date().addingTimeInterval(0.15))
guard NSWorkspace.shared.frontmostApplication?.processIdentifier == app.processIdentifier else { exit(2) }
func send(_ type: CGEventType, _ x: Double, _ y: Double) {
 if let event = CGEvent(mouseEventSource: CGEventSource(stateID: .hidSystemState), mouseType: type, mouseCursorPosition: CGPoint(x: ox + x, y: oy + y), mouseButton: .left) {
  event.setIntegerValueField(.mouseEventClickState, value: 1)
  event.post(tap: .cghidEventTap)
 }
}
let mode = args.count == 9 ? args[8] : "normal"
guard ["normal", "undo", "blur"].contains(mode) else { exit(2) }
func drag() throws {
 send(.mouseMoved, x1, y1)
 RunLoop.current.run(until: Date().addingTimeInterval(0.1))
 send(.leftMouseDown, x1, y1)
 var lastX = x1
 var lastY = y1
 defer { send(.leftMouseUp, lastX, lastY) }
 for step in 1...steps {
  guard ownWindow() == bounds, NSWorkspace.shared.frontmostApplication?.processIdentifier == app.processIdentifier else { throw NSError(domain: "Own window changed", code: 2) }
  let fraction = Double(step) / Double(steps)
  lastX = x1 + (x2 - x1) * fraction
  lastY = y1 + (y2 - y1) * fraction
  send(.leftMouseDragged, lastX, lastY)
  RunLoop.current.run(until: Date().addingTimeInterval(duration / Double(steps)))
  if step == steps / 2 && mode == "undo" {
   RunLoop.current.run(until: Date().addingTimeInterval(0.08))
   for down in [true, false] {
    guard let event = CGEvent(keyboardEventSource: nil, virtualKey: 6, keyDown: down) else { throw NSError(domain: "Cannot create own undo", code: 2) }
    event.flags = [.maskCommand]; event.postToPid(app.processIdentifier)
   }
   RunLoop.current.run(until: Date().addingTimeInterval(0.15))
  }
  if step == steps / 2 && mode == "blur" {
   RunLoop.current.run(until: Date().addingTimeInterval(0.08))
   guard AXUIElementSetAttributeValue(editors[0], kAXMinimizedAttribute as CFString, kCFBooleanTrue) == .success else { throw NSError(domain: "Cannot minimize own editor", code: 2) }
   RunLoop.current.run(until: Date().addingTimeInterval(0.2))
   guard (read(editors[0], kAXMinimizedAttribute) as? Bool) == true else { throw NSError(domain: "Minimize readback failed", code: 2) }
   guard AXUIElementSetAttributeValue(editors[0], kAXMinimizedAttribute as CFString, kCFBooleanFalse) == .success else { throw NSError(domain: "Cannot restore own editor", code: 2) }
   _ = app.activate(options: [.activateAllWindows])
   _ = AXUIElementPerformAction(editors[0], kAXRaiseAction as CFString)
   let restoreDeadline = Date().addingTimeInterval(3)
   while (ownWindow() != bounds || NSWorkspace.shared.frontmostApplication?.processIdentifier != app.processIdentifier) && Date() < restoreDeadline {
    RunLoop.current.run(until: Date().addingTimeInterval(0.05))
   }
  }
 }
}
do {
 try drag()
 RunLoop.current.run(until: Date().addingTimeInterval(0.1))
 let report: [String: Any] = ["pid": Int(app.processIdentifier), "version": version, "windowID": windowID, "start": [x1, y1], "end": [x2, y2], "steps": steps, "duration": duration, "mode": mode, "scope": "one installed app editor showing the named synthetic project"]
 print(String(data: try JSONSerialization.data(withJSONObject: report, options: [.sortedKeys]), encoding: .utf8)!)
} catch { print(error); exit(2) }
