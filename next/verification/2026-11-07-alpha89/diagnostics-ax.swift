import AppKit
import ApplicationServices
import Foundation

let appPath = "/Applications/Jianku Screen Next.app"
let args = Array(CommandLine.arguments.dropFirst())
guard AXIsProcessTrusted(), let version = Bundle(path: appPath)?.infoDictionary?["CFBundleShortVersionString"] as? String,
      ["0.2.0-alpha.88", "0.2.0-alpha.89"].contains(version),
      let app = NSRunningApplication.runningApplications(withBundleIdentifier: "com.jianku.screen.next")
        .first(where: { $0.bundleURL?.path == appPath })
else { exit(2) }
let root = AXUIElementCreateApplication(app.processIdentifier)

func read(_ item: AXUIElement, _ key: String) -> CFTypeRef? {
    var result: CFTypeRef?
    return AXUIElementCopyAttributeValue(item, key as CFString, &result) == .success ? result : nil
}
func str(_ item: AXUIElement, _ key: String) -> String {
    read(item, key).map { String(describing: $0) } ?? ""
}
func element(_ value: CFTypeRef?) -> AXUIElement? {
    guard let value, CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
    return value as! AXUIElement
}
func walk(_ top: AXUIElement, depth: Int = 18) -> [AXUIElement] {
    guard depth >= 0 else { return [] }
    let children = read(top, "AXChildren") as? [AXUIElement] ?? []
    return [top] + children.flatMap { walk($0, depth: depth - 1) }
}
func report(_ output: Any) {
    let data = try! JSONSerialization.data(withJSONObject: output, options: [.sortedKeys])
    print(String(decoding: data, as: UTF8.self))
}
func hasLabel(_ item: AXUIElement, _ label: String) -> Bool {
    ["AXTitle", "AXDescription", "AXValue"].contains { str(item, $0) == label }
}
func press(_ item: AXUIElement) {
    let status = AXUIElementPerformAction(item, kAXPressAction as CFString)
    report(["status": status.rawValue])
    guard status == .success else { exit(2) }
}

let windows = read(root, "AXWindows") as? [AXUIElement] ?? []
let editor = windows.filter { str($0, "AXTitle").contains("视频编辑") }
let expectedEditorNames = version.hasSuffix(".86")
    ? ["复验（86语音）"]
    : ["复验（87诊断）"]
guard editor.count == 1,
      walk(editor[0]).contains(where: { expectedEditorNames.contains(str($0, "AXValue")) })
else { exit(2) }

let settings = windows.filter { str($0, "AXTitle") == "简库镜传 · 设置" }
let extras = element(read(root, "AXExtrasMenuBar"))
let trayNodes = extras.map { walk($0, depth: 10) } ?? []

switch args.first {
case "inspect":
    let relevant = settings.count == 1 ? walk(settings[0]).filter { item in
        let fields = ["AXTitle", "AXDescription", "AXValue"].map { str(item, $0) }
        return fields.contains(where: { $0.contains("诊断") || $0.contains("报告") || $0.contains("开始") || $0.contains("敬请期待") || $0.contains("正在") || $0.contains("失败") || $0.contains("系统信息") || $0.contains("权限") || $0.contains("录制") || $0.contains("同步") })
    } : []
    report([
        "settings": settings.count,
        "trayRoles": trayNodes.map { str($0, "AXRole") },
        "knownTrayFeedbackItems": trayNodes.filter { hasLabel($0, "本机诊断") }.count,
        "settingsActions": relevant.map { item in
            ["role":str(item,"AXRole"), "title":str(item,"AXTitle"), "description":str(item,"AXDescription"), "value":str(item,"AXValue")]
        }
    ])
case "open-tray":
    let items = trayNodes.filter { str($0, "AXRole") == "AXMenuBarItem" }
    guard items.count == 1 else { exit(2) }
    press(items[0])
case "open-feedback":
    let items = trayNodes.filter { str($0, "AXRole") == "AXMenuItem" && hasLabel($0, "本机诊断") }
    guard items.count == 1 else { exit(2) }
    press(items[0])
case "close-settings":
    guard settings.count == 1, let button = element(read(settings[0], "AXCloseButton")) else { exit(2) }
    press(button)
case "confirm-diagnostic":
    guard ((version.hasSuffix(".88") || version.hasSuffix(".89"))), settings.count == 1 else { exit(2) }
    let sheets = walk(settings[0]).filter { str($0, "AXRole") == "AXSheet" }
    let alerts = windows.filter { hasLabel($0, "开始运行诊断？") }
    let items = (sheets + alerts).flatMap { walk($0) }.filter {
        str($0, "AXRole") == "AXButton" && hasLabel($0, "开始诊断")
    }
    guard items.count == 1 else { exit(2) }
    press(items[0])
case "press":
    guard ((version.hasSuffix(".88") || version.hasSuffix(".89"))), args.count == 2, settings.count == 1,
          ["开始诊断", "运行诊断", "运行音画同步测试", "显示文件", "Show File", "仅录制模式", "20 秒"].contains(args[1])
    else { exit(2) }
    let items = walk(settings[0]).filter { ["AXButton", "AXMenuItem", "AXRadioButton"].contains(str($0, "AXRole")) && hasLabel($0,args[1]) }
    guard items.count == 1 else { exit(2) }
    press(items[0])
default: exit(2)
}
