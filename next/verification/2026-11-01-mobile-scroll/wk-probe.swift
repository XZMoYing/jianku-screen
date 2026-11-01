import AppKit
import WebKit
let arguments = CommandLine.arguments
guard arguments.count == 2 else { exit(2) }
let html = try String(contentsOfFile: arguments[1], encoding: .utf8)
let application = NSApplication.shared
application.setActivationPolicy(.accessory)
let configuration = WKWebViewConfiguration()
configuration.websiteDataStore = .nonPersistent()
let web = WKWebView(frame: NSRect(x: 0, y: 0, width: 800, height: 600), configuration: configuration)
let window = NSWindow(contentRect: NSRect(x: 200, y: 100, width: 800, height: 600), styleMask: [.titled, .closable], backing: .buffered, defer: false)
window.title = "简库滚动回归（隔离合成页面）"
window.contentView = web
window.makeKeyAndOrderFront(nil)
application.activate(ignoringOtherApps: true)
web.loadHTMLString(html, baseURL: nil)
let deadline = Date().addingTimeInterval(18)
var querying = false
Timer.scheduledTimer(withTimeInterval: 0.2, repeats: true) { timer in
 if Date() > deadline { print("Timed out waiting for WK result"); window.orderOut(nil); exit(2) }
 if querying { return }
 querying = true
 web.evaluateJavaScript("window.__report ? JSON.stringify(window.__report) : null") { value, error in
  querying = false
  if let report = value as? String { print(report); timer.invalidate(); window.orderOut(nil); exit(0) }
 }
}
application.run()
