import AppKit
import CoreGraphics
import Foundation
let identifier = "com.jianku.screen.next"
let apps = NSWorkspace.shared.runningApplications.filter { $0.bundleIdentifier == identifier }
let windows = (CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]]) ?? []
let result = apps.map { app -> [String: Any] in
    let pid = app.processIdentifier
    let owned = windows.filter { ($0[kCGWindowOwnerPID as String] as? Int) == Int(pid) }.map { window -> [String: Any] in
        ["number": window[kCGWindowNumber as String] ?? 0, "bounds": window[kCGWindowBounds as String] ?? [:], "layer": window[kCGWindowLayer as String] ?? 0]
    }
    return ["pid": Int(pid), "bundleIdentifier": identifier, "bundlePath": app.bundleURL?.path ?? "", "name": app.localizedName ?? "", "terminated": app.isTerminated, "windows": owned]
}
let data = try JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys])
print(String(data: data, encoding: .utf8)!)
