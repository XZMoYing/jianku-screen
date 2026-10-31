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
guard mainWindows.count == 1, let main = mainWindows.first else { fatalError("Expected exact Main title") }
let mode = CommandLine.arguments.dropFirst().first ?? "read"
if mode == "raise" {
 _ = app.activate(options: [.activateAllWindows, .activateIgnoringOtherApps])
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
