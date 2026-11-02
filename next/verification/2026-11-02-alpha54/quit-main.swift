import AppKit
import ApplicationServices

let path = "/Applications/Jianku Screen Next.app"
let apps = NSRunningApplication.runningApplications(withBundleIdentifier: "com.jianku.screen.next").filter { $0.bundleURL?.path == path }
guard apps.count == 1, let app = apps.first, AXIsProcessTrusted() else { exit(2) }
let root = AXUIElementCreateApplication(app.processIdentifier)
var value: CFTypeRef?
guard AXUIElementCopyAttributeValue(root, kAXWindowsAttribute as CFString, &value) == .success, let windows = value as? [AXUIElement] else { exit(2) }
let titles = windows.map { window -> String in
 var title: CFTypeRef?
 guard AXUIElementCopyAttributeValue(window, kAXTitleAttribute as CFString, &title) == .success else { return "unreadable" }
 return title as? String ?? "unreadable"
}
guard titles.allSatisfy({ ["简库镜传 Next", "Jianku Screen Next"].contains($0) }), app.terminate() else { exit(2) }
let deadline = Date().addingTimeInterval(15)
while !app.isTerminated && Date() < deadline { RunLoop.current.run(until: Date().addingTimeInterval(0.1)) }
guard app.isTerminated else { exit(2) }
let report: [String: Any] = ["pid": Int(app.processIdentifier), "onlyMainWindows": true, "normalQuit": true, "terminated": true]
print(String(data: try JSONSerialization.data(withJSONObject: report, options: [.sortedKeys]), encoding: .utf8)!)
