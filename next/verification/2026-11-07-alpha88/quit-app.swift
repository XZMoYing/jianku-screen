import AppKit
import ApplicationServices
import Foundation

let appPath = "/Applications/Jianku Screen Next.app"
let args = Array(CommandLine.arguments.dropFirst())
guard args.count == 1, args[0] == "quit" else {
    print("{\"error\":\"usage: quit-app quit\"}")
    exit(2)
}
guard AXIsProcessTrusted(),
      let app = NSRunningApplication.runningApplications(withBundleIdentifier: "com.jianku.screen.next")
        .first(where: { $0.bundleURL?.path == appPath }) else {
    print("{\"found\":false}")
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

guard let menuBarValue = read(root, "AXMenuBar") else {
    print("{\"found\":true,\"menuBar\":false}")
    exit(2)
}
guard CFGetTypeID(menuBarValue) == AXUIElementGetTypeID() else {
    print("{\"found\":true,\"menuBar\":\"wrong-type\"}")
    exit(2)
}
let menuBar = menuBarValue as! AXUIElement
let items = walk(menuBar, depth: 4)
let quitItems = items.filter {
    let title = str($0, "AXTitle")
    return str($0, "AXRole") == "AXMenuItem" && ((title.hasPrefix("退出") && !title.contains("登录") && !title.contains("强制")) || title == "Quit Jianku Screen Next" || title.hasPrefix("Quit 简库"))
}
guard quitItems.count == 1 else {
    print("{\"found\":true,\"menuBar\":true,\"quitItems\":quitItems.count}")
    exit(2)
}
let status = AXUIElementPerformAction(quitItems[0], kAXPressAction as CFString)
print("{\"found\":true,\"pid\":pid,\"press\":status.rawValue}")