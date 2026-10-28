import AppKit
import CoreGraphics
let apps = NSRunningApplication.runningApplications(withBundleIdentifier: "com.jianku.screen.next")
let pids = Set(apps.map { Int($0.processIdentifier) })
let windows = (CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []).filter { item in
    pids.contains(item[kCGWindowOwnerPID as String] as? Int ?? -1) && item[kCGWindowLayer as String] as? Int == 0
}.map { item in
    ["id": item[kCGWindowNumber as String] ?? 0, "pid": item[kCGWindowOwnerPID as String] ?? 0, "name": item[kCGWindowName as String] ?? "", "bounds": item[kCGWindowBounds as String] ?? [:]] as [String: Any]
}
let result: [String: Any] = ["applications": apps.map { ["pid": Int($0.processIdentifier), "path": $0.bundleURL?.path ?? ""] as [String: Any] }, "windows": windows]
let data = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
print(String(data: data, encoding: .utf8)!)
