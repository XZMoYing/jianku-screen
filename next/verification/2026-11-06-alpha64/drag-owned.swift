import AppKit
import ApplicationServices
import CoreGraphics

let args = CommandLine.arguments
let path = "/Applications/Jianku Screen Next.app"
let matches = NSRunningApplication.runningApplications(withBundleIdentifier: "com.jianku.screen.next").filter { $0.bundleURL?.path == path }
guard (8...10).contains(args.count), matches.count == 1, let app = matches.first, AXIsProcessTrusted(),
 let version = NSDictionary(contentsOfFile: path + "/Contents/Info.plist")?["CFBundleShortVersionString"] as? String,
 version == "0.2.0-alpha.64", let windowID = Int(args[1]),
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
_ = app.activate(options: [])
_ = AXUIElementPerformAction(editors[0], kAXRaiseAction as CFString)
_ = AXUIElementSetAttributeValue(editors[0], kAXMainAttribute as CFString, kCFBooleanTrue)
RunLoop.current.run(until: Date().addingTimeInterval(0.15))
func editorFocused() -> Bool {
 guard let focused = read(application, kAXFocusedWindowAttribute) else { return false }
 return CFEqual(focused, editors[0])
}
guard NSWorkspace.shared.frontmostApplication?.processIdentifier == app.processIdentifier, editorFocused() else { exit(2) }
let mode = args.count >= 9 ? args[8] : "normal"
let inputModel = args.count == 10 ? args[9] : "raw"
guard ["normal", "undo", "blur", "escape"].contains(mode), ["raw", "clean"].contains(inputModel) else { exit(2) }
let eventSource = CGEventSource(stateID: .combinedSessionState)
func send(_ type: CGEventType, _ x: Double, _ y: Double) {
 if let event = CGEvent(mouseEventSource: eventSource, mouseType: type, mouseCursorPosition: CGPoint(x: ox + x, y: oy + y), mouseButton: .left) {
  if inputModel == "clean" {
   event.flags.subtract([.maskCommand, .maskShift, .maskControl, .maskAlternate, .maskAlphaShift, .maskSecondaryFn])
   if type == .leftMouseDown || type == .leftMouseUp { event.setIntegerValueField(.mouseEventClickState, value: 1) }
  } else { event.setIntegerValueField(.mouseEventClickState, value: 1) }
  event.post(tap: .cghidEventTap)
 }
}
func drag() throws {
 send(.mouseMoved, x1, y1)
 RunLoop.current.run(until: Date().addingTimeInterval(0.1))
 send(.leftMouseDown, x1, y1)
 RunLoop.current.run(until: Date().addingTimeInterval(0.12))
 guard CGEventSource.buttonState(.combinedSessionState, button:.left) else { send(.leftMouseUp, x1, y1); throw NSError(domain:"Owned mouse-down was not held", code:2) }
 var trace: [[String:Any]] = [["phase":"down", "leftButton":CGEventSource.buttonState(.combinedSessionState, button:.left), "pointerX": CGEvent(source:nil)?.location.x ?? -1, "pointerY": CGEvent(source:nil)?.location.y ?? -1]]
 var lastX = x1
 var lastY = y1
 defer { send(.leftMouseUp, lastX, lastY) }
 for step in 1...steps {
  guard ownWindow() == bounds, NSWorkspace.shared.frontmostApplication?.processIdentifier == app.processIdentifier, editorFocused() else { throw NSError(domain: "Own window changed", code: 2) }
  let fraction = Double(step) / Double(steps)
  lastX = x1 + (x2 - x1) * fraction
  lastY = y1 + (y2 - y1) * fraction
  send(.leftMouseDragged, lastX, lastY)
  RunLoop.current.run(until: Date().addingTimeInterval(duration / Double(steps)))
  if step <= 2 || step == steps { trace.append(["phase":"step-\(step)", "leftButton":CGEventSource.buttonState(.combinedSessionState, button:.left), "pointerX": CGEvent(source:nil)?.location.x ?? -1, "pointerY": CGEvent(source:nil)?.location.y ?? -1]) }
  if mode == "normal" && !CGEventSource.buttonState(.combinedSessionState, button:.left) {
   print(String(data: try JSONSerialization.data(withJSONObject:["invalidInputTrace":trace], options:[.sortedKeys]), encoding:.utf8)!)
   throw NSError(domain:"Mouse button was released before the owned drag completed", code:2)
  }
  if step == steps / 2 && mode == "undo" {
   RunLoop.current.run(until: Date().addingTimeInterval(0.08))
   for down in [true, false] {
    guard let event = CGEvent(keyboardEventSource: nil, virtualKey: 6, keyDown: down) else { throw NSError(domain: "Cannot create own undo", code: 2) }
    event.flags = [.maskCommand]; event.postToPid(app.processIdentifier)
   }
   RunLoop.current.run(until: Date().addingTimeInterval(0.15))
  }
  if step == steps / 2 && mode == "escape" {
   for down in [true, false] {
    if let event = CGEvent(keyboardEventSource: nil, virtualKey: 53, keyDown: down) { event.flags = []; event.postToPid(app.processIdentifier) }
   }
   RunLoop.current.run(until: Date().addingTimeInterval(0.1))
  }
  if step == steps / 2 && mode == "blur" {
   RunLoop.current.run(until: Date().addingTimeInterval(0.08))
   guard AXUIElementSetAttributeValue(editors[0], kAXMinimizedAttribute as CFString, kCFBooleanTrue) == .success else { throw NSError(domain: "Cannot minimize own editor", code: 2) }
   RunLoop.current.run(until: Date().addingTimeInterval(0.2))
   guard (read(editors[0], kAXMinimizedAttribute) as? Bool) == true else { throw NSError(domain: "Minimize readback failed", code: 2) }
   guard AXUIElementSetAttributeValue(editors[0], kAXMinimizedAttribute as CFString, kCFBooleanFalse) == .success else { throw NSError(domain: "Cannot restore own editor", code: 2) }
   _ = app.activate(options: [])
   _ = AXUIElementPerformAction(editors[0], kAXRaiseAction as CFString)
   let restoreDeadline = Date().addingTimeInterval(3)
   while (ownWindow() != bounds || NSWorkspace.shared.frontmostApplication?.processIdentifier != app.processIdentifier) && Date() < restoreDeadline {
    RunLoop.current.run(until: Date().addingTimeInterval(0.05))
   }
  }
 }
 RunLoop.current.run(until: Date().addingTimeInterval(0.8))
 print(String(data: try JSONSerialization.data(withJSONObject:["trace":trace], options:[.sortedKeys]), encoding:.utf8)!)
}
do {
 try drag()
 RunLoop.current.run(until: Date().addingTimeInterval(0.1))
 let report: [String: Any] = ["pid": Int(app.processIdentifier), "version": version, "windowID": windowID, "start": [x1, y1], "end": [x2, y2], "steps": steps, "duration": duration, "mode": mode, "inputModel": inputModel, "finishedAtUnixMs": Int(Date().timeIntervalSince1970 * 1000), "scope": "one installed app editor showing the named synthetic project"]
 print(String(data: try JSONSerialization.data(withJSONObject: report, options: [.sortedKeys]), encoding: .utf8)!)
} catch { print(error); exit(2) }
