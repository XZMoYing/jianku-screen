import AppKit
import ApplicationServices

let args = CommandLine.arguments
let apps = NSRunningApplication.runningApplications(withBundleIdentifier: "com.jianku.screen.next").filter { $0.bundleURL?.path == "/Applications/Jianku Screen Next.app" }
guard apps.count == 1 else { fatalError("Expected one installed own app") }
let app = apps[0]
let application = AXUIElementCreateApplication(app.processIdentifier)
func read(_ node: AXUIElement, _ key: String) -> CFTypeRef? { var value: CFTypeRef?; return AXUIElementCopyAttributeValue(node, key as CFString, &value) == .success ? value : nil }
func own(_ node: AXUIElement) -> Bool { var pid: pid_t = 0; return AXUIElementGetPid(node, &pid) == .success && pid == app.processIdentifier }
func actions(_ node: AXUIElement) -> [String] { var value: CFArray?; AXUIElementCopyActionNames(node, &value); return value as? [String] ?? [] }
func point(_ node: AXUIElement) -> CGPoint? { guard let value = read(node, kAXPositionAttribute), CFGetTypeID(value) == AXValueGetTypeID() else { return nil }; var result = CGPoint.zero; return AXValueGetValue(value as! AXValue, .cgPoint, &result) ? result : nil }
func size(_ node: AXUIElement) -> CGSize? { guard let value = read(node, kAXSizeAttribute), CFGetTypeID(value) == AXValueGetTypeID() else { return nil }; var result = CGSize.zero; return AXValueGetValue(value as! AXValue, .cgSize, &result) ? result : nil }
func sendOwnKey(_ code: CGKeyCode) {
 guard NSWorkspace.shared.frontmostApplication?.processIdentifier == app.processIdentifier else { fatalError("Own app must be frontmost") }
 for down in [true, false] {
  guard let event = CGEvent(keyboardEventSource: CGEventSource(stateID: .hidSystemState), virtualKey: code, keyDown: down) else { fatalError("Cannot make key") }
  event.flags = []; event.postToPid(app.processIdentifier)
  RunLoop.current.run(until: Date().addingTimeInterval(0.06))
 }
 RunLoop.current.run(until: Date().addingTimeInterval(0.15))
}
let windows = (CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []).filter { ($0[kCGWindowOwnerPID as String] as? Int) == Int(app.processIdentifier) }
if args.count == 1 || args[1] == "windows" { print(String(data: try JSONSerialization.data(withJSONObject: windows, options: [.sortedKeys]), encoding: .utf8)!); exit(0) }
guard args.count >= 3 else { fatalError("Mode and own window title required") }
if args[1] == "raise" {
 _ = app.activate(options: [.activateAllWindows, .activateIgnoringOtherApps])
 RunLoop.current.run(until: Date().addingTimeInterval(0.3))
 let candidates = (read(application, kAXWindowsAttribute) as? [AXUIElement] ?? []).filter { own($0) && (read($0, kAXTitleAttribute) as? String)?.contains(args[2]) == true && actions($0).contains(kAXRaiseAction) }
 guard candidates.count == 1 else { fatalError("Expected unique own AX window") }
 let status = AXUIElementPerformAction(candidates[0], kAXRaiseAction as CFString)
 print("AXRaise: \(status.rawValue)"); exit(status == .success ? 0 : 2)
}
if args[1] == "escape" {
 guard NSWorkspace.shared.frontmostApplication?.processIdentifier == app.processIdentifier else { fatalError("Own app must be frontmost") }
 guard let focused = read(application, kAXFocusedWindowAttribute), CFGetTypeID(focused) == AXUIElementGetTypeID(), own(focused as! AXUIElement), (read(focused as! AXUIElement, kAXTitleAttribute) as? String)?.contains(args[2]) == true else { fatalError("Focused own window mismatch") }
 sendOwnKey(53)
 print("Escape delivered to own PID"); exit(0)
}
let matches = windows.filter { ($0[kCGWindowName as String] as? String)?.contains(args[2]) == true }
guard matches.count == 1, let bounds = matches[0][kCGWindowBounds as String] as? [String: Double], let x = bounds["X"], let y = bounds["Y"], let width = bounds["Width"], let height = bounds["Height"] else { fatalError("Expected unique visible own window") }

var candidate: AXUIElement?
guard AXUIElementCopyElementAtPosition(application, Float(x + 24), Float(y + 100), &candidate) == .success, var root = candidate, own(root) else { fatalError("Own hit test failed") }
for _ in 0..<15 {
 if let position = point(root), let dimensions = size(root), abs(position.x - x) < 4, abs(position.y - y) < 40, abs(dimensions.width - width) < 8, abs(dimensions.height - height) < 40 { break }
 guard let parent = read(root, kAXParentAttribute), CFGetTypeID(parent) == AXUIElementGetTypeID(), own(parent as! AXUIElement), String(describing: read(parent as! AXUIElement, kAXRoleAttribute) ?? "" as CFString) != kAXApplicationRole else { break }
 root = parent as! AXUIElement
}
var elements: [AXUIElement] = []
var nodes: [[String: Any]] = []
func walk(_ node: AXUIElement, _ depth: Int) {
 guard depth < 36, elements.count < 2400, own(node) else { return }
 var row: [String: Any] = ["index": elements.count, "depth": depth, "actions": actions(node)]
 for key in [kAXRoleAttribute, kAXTitleAttribute, kAXDescriptionAttribute, kAXValueAttribute, kAXEnabledAttribute, kAXExpandedAttribute] { if let value = read(node, key) { row[key] = String(describing: value) } }
 if let position = point(node) { row["position"] = [position.x, position.y] }
 if let dimensions = size(node) { row["size"] = [dimensions.width, dimensions.height] }
 elements.append(node); nodes.append(row)
 if let children = read(node, kAXChildrenAttribute) as? [AXUIElement] { for child in children { walk(child, depth + 1) } }
}
walk(root, 0)
if args[1] == "option-info" {
 print("AX trusted=\(AXIsProcessTrusted()), CG posting=\(CGPreflightPostEventAccess())")
 for node in elements where (read(node, kAXRoleAttribute) as? String) == kAXStaticTextRole && ["简体中文", "英语", "跟随系统", "30 FPS", "30 帧/秒"].contains(read(node, kAXTitleAttribute) as? String ?? "") {
  var selected = DarwinBoolean(false); var focused = DarwinBoolean(false)
  let s = AXUIElementIsAttributeSettable(node, kAXSelectedAttribute as CFString, &selected)
  let f = AXUIElementIsAttributeSettable(node, kAXFocusedAttribute as CFString, &focused)
  print("\(read(node, kAXTitleAttribute) ?? "" as CFString): selected writable=\(selected.boolValue)/\(s.rawValue), focused writable=\(focused.boolValue)/\(f.rawValue)")
 }
 exit(0)
}
if args[1] == "list-info" {
 for node in elements where (read(node, kAXRoleAttribute) as? String) == kAXListRole {
  var names: CFArray?; AXUIElementCopyAttributeNames(node, &names)
  var selectedSettable = DarwinBoolean(false)
  let status = AXUIElementIsAttributeSettable(node, kAXSelectedChildrenAttribute as CFString, &selectedSettable)
  print("list attributes: \(names as? [String] ?? []); selected writable=\(selectedSettable.boolValue), status=\(status.rawValue)")
 }
 exit(0)
}
if args[1] == "press" || args[1] == "open" || args[1] == "click" || args[1] == "menu" || args[1] == "reveal" || (args[1] == "choose" || args[1] == "confirm-option") {
 guard args.count == 4 else { fatalError("Exact accessible label required") }
 let forbidden = ["删除", "清空", "Discard", "Delete", "开始录制", "Start Recording", "Stop Recording", "退出"]
 guard (!forbidden.contains(where: { args[3].contains($0) }) || args[3] == "退出全屏预览") else { fatalError("Excluded action") }
 guard let rootPosition = point(root), let rootSize = size(root), abs(rootPosition.x - x) < 4, abs(rootPosition.y - y) < 40, abs(rootSize.width - width) < 8, abs(rootSize.height - height) < 40 else { fatalError("Root geometry mismatch") }
 let targets = elements.filter { node in
  (actions(node).contains(kAXPressAction) || ((args[1] == "choose" || args[1] == "confirm-option") && (read(node, kAXRoleAttribute) as? String) == kAXStaticTextRole)) && [kAXTitleAttribute, kAXDescriptionAttribute].contains { key in (read(node, key) as? String) == args[3] }
 }
 guard targets.count == 1 else { fatalError("Expected unique target") }
 if args[1] == "reveal" {
  guard actions(targets[0]).contains("AXScrollToVisible") else { fatalError("Cannot reveal target") }
  let status = AXUIElementPerformAction(targets[0], "AXScrollToVisible" as CFString); print("AXScrollToVisible: \(status.rawValue)"); exit(status == .success ? 0 : 2)
 }
 guard let targetPosition = point(targets[0]), let targetSize = size(targets[0]), targetSize.width > 0, targetSize.height > 0, targetPosition.x >= x - 1, targetPosition.y >= y - 1, targetPosition.x < x + width, targetPosition.y < y + height else { fatalError("Expected visible target") }
 if (args[1] == "choose" || args[1] == "confirm-option") {
 guard (read(targets[0], kAXEnabledAttribute) as? Bool) != false else { fatalError("Disabled option") }
 var cursor = targets[0]; var inList = false
 for _ in 0..<6 {
  if (read(cursor, kAXRoleAttribute) as? String) == kAXListRole { inList = true; break }
  guard let parent = read(cursor, kAXParentAttribute), CFGetTypeID(parent) == AXUIElementGetTypeID(), own(parent as! AXUIElement) else { break }
  cursor = parent as! AXUIElement
 }
 guard inList else { fatalError("Choose target must be in an own list") }
}
if args[1] == "confirm-option" {
 guard NSWorkspace.shared.frontmostApplication?.processIdentifier == app.processIdentifier,
 let focusedWindow = read(application, kAXFocusedWindowAttribute), CFGetTypeID(focusedWindow) == AXUIElementGetTypeID(), own(focusedWindow as! AXUIElement),
 (read(focusedWindow as! AXUIElement, kAXTitleAttribute) as? String)?.contains(args[2]) == true else { fatalError("Own focused window required") }
 guard AXUIElementSetAttributeValue(targets[0], kAXFocusedAttribute as CFString, kCFBooleanTrue) == .success else { fatalError("Cannot focus option") }
 RunLoop.current.run(until: Date().addingTimeInterval(0.12))
 guard let focused = read(application, kAXFocusedUIElementAttribute), CFGetTypeID(focused) == AXUIElementGetTypeID(), own(focused as! AXUIElement),
 (read(focused as! AXUIElement, kAXTitleAttribute) as? String) == args[3] else { fatalError("Option focus not confirmed") }
 sendOwnKey(36)
 print("Return delivered after confirmed own option focus"); exit(0)
}
if args[1] == "click" || (args[1] == "choose" || args[1] == "confirm-option") {
 guard ((args[1] == "choose" || args[1] == "confirm-option") || (read(targets[0], kAXRoleAttribute) as? String) == kAXPopUpButtonRole), NSWorkspace.shared.frontmostApplication?.processIdentifier == app.processIdentifier else { fatalError("Own popup must be frontmost") }
 guard let focused = read(application, kAXFocusedWindowAttribute), CFGetTypeID(focused) == AXUIElementGetTypeID(), (read(focused as! AXUIElement, kAXTitleAttribute) as? String)?.contains(args[2]) == true else { fatalError("Own focused window mismatch") }
 let center = CGPoint(x: targetPosition.x + targetSize.width / 2, y: targetPosition.y + targetSize.height / 2)
 for type in [CGEventType.leftMouseDown, CGEventType.leftMouseUp] { guard let event = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: center, mouseButton: .left) else { fatalError("Cannot create own click") }; event.setIntegerValueField(.mouseEventClickState, value: 1); event.post(tap: .cghidEventTap) }
 print("Mouse click delivered to own popup"); exit(0)
}
if args[1] == "open" {
 print("Popup role=\(read(targets[0], kAXRoleAttribute) ?? "" as CFString), foreground own=\(NSWorkspace.shared.frontmostApplication?.processIdentifier == app.processIdentifier)")
 guard (read(targets[0], kAXRoleAttribute) as? String) == kAXPopUpButtonRole, NSWorkspace.shared.frontmostApplication?.processIdentifier == app.processIdentifier else { fatalError("Own popup must be frontmost") }
 let focused = AXUIElementSetAttributeValue(targets[0], kAXFocusedAttribute as CFString, kCFBooleanTrue)
 guard focused == .success, let active = read(application, kAXFocusedUIElementAttribute), CFGetTypeID(active) == AXUIElementGetTypeID(), CFEqual(active, targets[0]) else { fatalError("Popup focus was not confirmed") }
 sendOwnKey(125)
 print("Down delivered to focused own popup"); exit(0)
}
let requestedAction = args[1] == "menu" ? kAXShowMenuAction : kAXPressAction
 guard actions(targets[0]).contains(requestedAction) else { fatalError("Action unavailable") }
 let status = AXUIElementPerformAction(targets[0], requestedAction as CFString)
 print("AXPress \(args[3]): \(status.rawValue)")
 exit(status == .success ? 0 : 2)
}
print(String(data: try JSONSerialization.data(withJSONObject: ["pid": Int(app.processIdentifier), "path": app.bundleURL!.path, "bounds": bounds, "windowId": matches[0][kCGWindowNumber as String]!, "nodes": nodes], options: [.sortedKeys]), encoding: .utf8)!)
