import AppKit
import ApplicationServices
import Foundation

let appPath = "/Applications/Jianku Screen Next.app"
let expected = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : ""
guard let app = NSRunningApplication.runningApplications(withBundleIdentifier: "com.jianku.screen.next")
    .first(where: { $0.bundleURL?.path == appPath }) else {
    print("{\"running\":false}")
    exit(2)
}
let pid = app.processIdentifier
let root = AXUIElementCreateApplication(pid)
func read(_ item: AXUIElement, _ key: String) -> CFTypeRef? {
    var result: CFTypeRef?
    return AXUIElementCopyAttributeValue(item, key as CFString, &result) == .success ? result : nil
}
func str(_ item: AXUIElement, _ key: String) -> String {
    read(item, key).map { String(describing: $0) } ?? ""
}
func walk(_ top: AXUIElement, depth: Int) -> [AXUIElement] {
    guard depth >= 0 else { return [] }
    let children = read(top, "AXChildren") as? [AXUIElement] ?? []
    return [top] + children.flatMap { walk($0, depth: depth - 1) }
}

let windows = read(root, "AXWindows") as? [AXUIElement] ?? []
var windowInfo: [[String: Any]] = []
var expectedHits: [[String: String]] = []
var editorCount = 0
for window in windows {
    let title = str(window, "AXTitle")
    if title.contains("视频编辑") { editorCount += 1 }
    var nodes = walk(window, depth: 24)
    nodes = Array(nodes.prefix(2500))
    var values: [String] = []
    for node in nodes {
        for key in ["AXTitle", "AXValue", "AXDescription"] {
            let value = str(node, key)
            if !value.isEmpty && value.count < 200 { values.append(value) }
        }
    }
    if !expected.isEmpty {
        for node in nodes {
            for key in ["AXTitle", "AXValue", "AXDescription"] {
                let value = str(node, key)
                if value == expected {
                    expectedHits.append(["role": str(node, "AXRole"), "key": key, "value": value])
                }
            }
        }
    }
    windowInfo.append([
        "title": title,
        "role": str(window, "AXRole"),
        "nodeCount": nodes.count,
        "valueSample": Array(values.prefix(12)),
        "hasExpected": values.contains(expected),
    ])
}
let result: [String: Any] = [
    "running": true,
    "pid": Int(pid),
    "windowCount": windows.count,
    "editorWindowCount": editorCount,
    "expected": expected,
    "expectedHits": expectedHits,
    "windows": windowInfo,
    "frontmost": NSWorkspace.shared.frontmostApplication?.bundleIdentifier ?? "",
]
print(String(data: try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys, .prettyPrinted]), encoding: .utf8)!)
