import AppKit
import ApplicationServices
import CoreGraphics

let path = "/Applications/Jianku Screen Next.app"
let candidates = NSRunningApplication.runningApplications(withBundleIdentifier: "com.jianku.screen.next").filter { $0.bundleURL?.path == path }
guard candidates.count == 1, let app = candidates.first, AXIsProcessTrusted() else { fatalError("Expected one trusted installed app") }
let application = AXUIElementCreateApplication(app.processIdentifier)
func read(_ element: AXUIElement, _ key: String) -> CFTypeRef? {
 var value: CFTypeRef?
 guard AXUIElementCopyAttributeValue(element, key as CFString, &value) == .success else { return nil }
 return value
}
func own(_ element: AXUIElement) -> Bool {
 var pid: pid_t = 0
 return AXUIElementGetPid(element, &pid) == .success && pid == app.processIdentifier
}
func element(_ value: CFTypeRef?) -> AXUIElement? {
 guard let value, CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
 let result = value as! AXUIElement
 return own(result) ? result : nil
}
let windows = (read(application, kAXWindowsAttribute) as? [AXUIElement] ?? []).filter(own)
let mainWindows = windows.filter { (read($0, kAXTitleAttribute) as? String) == "简库镜传 Next" || (read($0, kAXTitleAttribute) as? String) == "Jianku Screen Next" }
let mode = CommandLine.arguments.dropFirst().first ?? "read"
if mainWindows.count != 1 && mode == "read" {
 print("{\"pending\":true}")
 exit(2)
}
guard mainWindows.count == 1, let main = mainWindows.first else { fatalError("Expected exact Main title") }
if mode == "restore-geometry" {
 guard (read(main, "AXFullScreen") as? Bool) == false else { fatalError("Exit fullscreen before restoring Main bounds") }
 var size = CGSize(width: 1120, height: 800)
 var point = CGPoint(x: 250, y: 98)
 guard let sizeValue = AXValueCreate(.cgSize, &size), let pointValue = AXValueCreate(.cgPoint, &point), AXUIElementSetAttributeValue(main, kAXSizeAttribute as CFString, sizeValue) == .success, AXUIElementSetAttributeValue(main, kAXPositionAttribute as CFString, pointValue) == .success else { fatalError("Cannot restore original Main geometry") }
} else if mode == "pin-click" {
 guard NSWorkspace.shared.frontmostApplication?.processIdentifier == app.processIdentifier else { fatalError("Expected own app foreground") }
 let native = (CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []).filter { ($0[kCGWindowOwnerPID as String] as? Int) == Int(app.processIdentifier) && ["简库镜传 Next", "Jianku Screen Next"].contains($0[kCGWindowName as String] as? String ?? "") }
 guard native.count == 1, let rect = native[0][kCGWindowBounds as String] as? [String: Double], let x = rect["X"], let y = rect["Y"], let width = rect["Width"] else { fatalError("Expected unique own visible Main") }
 let point = CGPoint(x: x + width - 68, y: y + 18)
 for type in [CGEventType.leftMouseDown, .leftMouseUp] {
  guard let event = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: point, mouseButton: .left) else { fatalError("Cannot create own pin click") }
  event.setIntegerValueField(.mouseEventClickState, value: 1)
  event.post(tap: .cghidEventTap)
  RunLoop.current.run(until: Date().addingTimeInterval(0.05))
 }
} else if mode == "fullscreen-on" || mode == "fullscreen-off" {
 guard AXUIElementSetAttributeValue(main, "AXFullScreen" as CFString, mode == "fullscreen-on" ? kCFBooleanTrue : kCFBooleanFalse) == .success else { fatalError("Cannot change own Main fullscreen") }
} else if mode == "inspect" || mode == "press" {
 var nodes: [AXUIElement] = []
 func collect(_ node: AXUIElement, _ depth: Int) {
  guard depth < 32, nodes.count < 2200, own(node) else { return }
  nodes.append(node)
  for child in read(node, kAXChildrenAttribute) as? [AXUIElement] ?? [] { collect(child, depth + 1) }
 }
 collect(main, 0)
 let native = (CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []).filter { ($0[kCGWindowOwnerPID as String] as? Int) == Int(app.processIdentifier) && ["简库镜传 Next", "Jianku Screen Next"].contains($0[kCGWindowName as String] as? String ?? "") }
 if native.count == 1, let rect = native[0][kCGWindowBounds as String] as? [String: Double], let x = rect["X"], let y = rect["Y"], let width = rect["Width"] {
  var hit: AXUIElement?
  if AXUIElementCopyElementAtPosition(application, Float(x + width - 68), Float(y + 18), &hit) == .success, let hit, own(hit) {
   if !nodes.contains(where: { CFEqual($0, hit) }) { collect(hit, 0) }
  }
 }
 if mode == "press" {
  guard CommandLine.arguments.count == 3 else { fatalError("Exact own button label required") }
  let label = CommandLine.arguments[2]
  guard ["置顶主窗口", "取消主窗口置顶", "Pin main window", "Unpin main window"].contains(label) else { fatalError("Only pin controls accepted") }
  let targets = nodes.filter { node in
   [kAXTitleAttribute, kAXDescriptionAttribute].contains { (read(node, $0) as? String) == label } && (read(node, kAXRoleAttribute) as? String) == kAXButtonRole
  }
  guard targets.count == 1, (read(targets[0], kAXEnabledAttribute) as? Bool) != false else { fatalError("Expected unique enabled own pin control") }
  guard AXUIElementPerformAction(targets[0], kAXPressAction as CFString) == .success else { fatalError("Cannot press own pin control") }
 } else {
  let controls = nodes.filter { (read($0, kAXRoleAttribute) as? String) == kAXButtonRole }.map { node in
   ["role": read(node, kAXRoleAttribute) as? String ?? "", "label": (read(node, kAXTitleAttribute) as? String) ?? (read(node, kAXDescriptionAttribute) as? String) ?? ""]
  }
  print(String(data: try JSONSerialization.data(withJSONObject: controls, options: [.sortedKeys]), encoding: .utf8)!)
  exit(0)
 }
} else if mode == "raise" {
 _ = app.activate(options: [.activateAllWindows])
 guard AXUIElementPerformAction(main, kAXRaiseAction as CFString) == .success else { fatalError("Cannot raise Main") }
} else if mode == "unminimize" {
 guard AXUIElementSetAttributeValue(main, kAXMinimizedAttribute as CFString, kCFBooleanFalse) == .success else { fatalError("Cannot unminimize Main") }
} else if mode != "read" {
 let attribute: String
 switch mode {
 case "minimize": attribute = kAXMinimizeButtonAttribute
 case "close": attribute = kAXCloseButtonAttribute
 case "zoom": attribute = kAXZoomButtonAttribute
 default: fatalError("Unsupported action")
 }
 guard let button = element(read(main, attribute)), (read(button, kAXEnabledAttribute) as? Bool) != false else { fatalError("Expected enabled own Main control") }
 guard AXUIElementPerformAction(button, kAXPressAction as CFString) == .success else { fatalError("Cannot press own Main control") }
}
RunLoop.current.run(until: Date().addingTimeInterval(0.25))
var result: [String: Any] = ["pid": Int(app.processIdentifier), "path": path, "mode": mode, "role": read(main, kAXRoleAttribute) as? String ?? "", "subrole": read(main, kAXSubroleAttribute) as? String ?? "", "minimized": read(main, kAXMinimizedAttribute) as? Bool ?? false, "fullscreen": read(main, "AXFullScreen") as? Bool ?? false]
for (key, attribute) in [("close", kAXCloseButtonAttribute), ("minimize", kAXMinimizeButtonAttribute), ("zoom", kAXZoomButtonAttribute)] {
 if let button = element(read(main, attribute)) {
  result[key] = ["available": true, "enabled": read(button, kAXEnabledAttribute) as? Bool ?? false, "description": read(button, kAXDescriptionAttribute) as? String ?? ""]
 } else { result[key] = ["available": false] }
}
let native = (CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []).filter { ($0[kCGWindowOwnerPID as String] as? Int) == Int(app.processIdentifier) && ["简库镜传 Next", "Jianku Screen Next"].contains($0[kCGWindowName as String] as? String ?? "") }
result["visibleMainWindows"] = native.map { ["layer": $0[kCGWindowLayer as String] ?? -1, "bounds": $0[kCGWindowBounds as String] ?? [:]] }
print(String(data: try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]), encoding: .utf8)!)
