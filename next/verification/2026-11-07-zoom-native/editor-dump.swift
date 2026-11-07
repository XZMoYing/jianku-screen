import AppKit
import ApplicationServices
import Foundation

let appPath = "/Applications/Jianku Screen Next.app"
guard let app = NSRunningApplication.runningApplications(withBundleIdentifier: "com.jianku.screen.next")
    .first(where: { $0.bundleURL?.path == appPath }) else { exit(2) }
let pid = app.processIdentifier
let root = AXUIElementCreateApplication(pid)
func read(_ item: AXUIElement, _ key: String) -> CFTypeRef? {
    var result: CFTypeRef?
    return AXUIElementCopyAttributeValue(item, key as CFString, &result) == .success ? result : nil
}
func str(_ item: AXUIElement, _ key: String) -> String {
    read(item, key).map { String(describing: $0) } ?? ""
}
func point(_ item: AXUIElement, _ key: String) -> [String: Double]? {
    guard let value = read(item, key), CFGetTypeID(value) == AXValueGetTypeID() else { return nil }
    var raw = CGPoint.zero
    if AXValueGetValue(value as! AXValue, .cgPoint, &raw) { return ["x": Double(raw.x), "y": Double(raw.y)] }
    var size = CGSize.zero
    if AXValueGetValue(value as! AXValue, .cgSize, &size) { return ["width": Double(size.width), "height": Double(size.height)] }
    return nil
}
func walk(_ top: AXUIElement, depth: Int, out: inout [[String: Any]]) {
    guard depth >= 0, out.count < 4000 else { return }
    var item: [String: Any] = ["role": str(top, "AXRole"), "depth": depth]
    for key in ["AXTitle", "AXDescription", "AXValue", "AXHelp", "AXIdentifier"] {
        let value = str(top, key)
        if !value.isEmpty { item[key] = String(value.prefix(300)) }
    }
    if let p = point(top, "AXPosition") { item["position"] = p }
    if let s = point(top, "AXSize") { item["size"] = s }
    var actions: CFArray?
    if AXUIElementCopyActionNames(top, &actions) == .success, let list = actions as? [String] { item["actions"] = list }
    out.append(item)
    let children = read(top, "AXChildren") as? [AXUIElement] ?? []
    for child in children { walk(child, depth: depth + 1, out: &out) }
}
let windows = read(root, "AXWindows") as? [AXUIElement] ?? []
var output: [[String: Any]] = []
for window in windows where str(window, "AXTitle").contains("视频编辑") {
    var nodes: [[String: Any]] = []
    walk(window, depth: 0, out: &nodes)
    output.append(["title": str(window, "AXTitle"), "nodes": nodes])
}
print(String(data: try JSONSerialization.data(withJSONObject: output, options: [.sortedKeys]), encoding: .utf8)!)
