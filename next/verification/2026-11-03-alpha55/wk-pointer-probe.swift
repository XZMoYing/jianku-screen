import AppKit
import WebKit
import CoreGraphics

let args = CommandLine.arguments
guard args.count == 2 else { exit(2) }
let html = try String(contentsOfFile: args[1], encoding: .utf8)
let application = NSApplication.shared
application.setActivationPolicy(.regular)
let configuration = WKWebViewConfiguration()
configuration.websiteDataStore = .nonPersistent()
let web = WKWebView(frame: NSRect(x: 0, y: 0, width: 1100, height: 500), configuration: configuration)
let window = NSWindow(contentRect: NSRect(x: 220, y: 180, width: 1100, height: 500), styleMask: [.titled, .closable], backing: .buffered, defer: false)
window.title = "简库输入诊断（自制静态页面）"
window.contentView = web
window.makeKeyAndOrderFront(nil)
NSRunningApplication.current.activate(options: [])
web.loadHTMLString(html, baseURL: nil)
let deadline = Date().addingTimeInterval(40)
var querying = false
var started = false
Timer.scheduledTimer(withTimeInterval: 0.2, repeats: true) { timer in
 if Date() > deadline { print("Timed out waiting for owned WK pointer probe"); window.orderOut(nil); exit(2) }
 if querying { return }
 querying = true
 let query = started ? "JSON.stringify({events:window.eventTrace, start:window.pointerFixture.context.items()[1].start, end:window.pointerFixture.context.items()[1].end, states:window.pointerFixture.states, resumes:window.pointerFixture.context.counts().resumes})" : "window.overlayProbe ? (window.pointerFixture=window.overlayProbe.mount('style'), window.eventTrace=[], ['mousedown','mousemove','mouseup'].forEach(type=>window.addEventListener(type,event=>window.eventTrace.push({type, buttons:event.buttons, x:event.clientX, y:event.clientY}),true)), true) : null"
 web.evaluateJavaScript(query) { value, error in
  querying = false
  if let error { print(error); window.orderOut(nil); exit(2) }
  if started {
   if let text = value as? String { print(text); timer.invalidate(); window.orderOut(nil); exit(0) }
   return
  }
  guard value as? Bool == true else { return }
  started = true
  querying = true
  guard let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]],
   let own = windows.first(where: { ($0[kCGWindowOwnerPID as String] as? Int) == Int(getpid()) && ($0[kCGWindowNumber as String] as? Int) == window.windowNumber }),
   let bounds = own[kCGWindowBounds as String] as? [String: Double], let x = bounds["X"], let y = bounds["Y"] else { exit(2) }
  let offset = web.convert(NSPoint(x: 0, y: web.isFlipped ? 0 : web.bounds.height), to: nil)
  let ox = x + offset.x
  let oy = y + window.frame.height - offset.y
  let source = CGEventSource(stateID: .combinedSessionState)
  func send(_ type: CGEventType, _ clientX: Double) {
   guard NSWorkspace.shared.frontmostApplication?.processIdentifier == getpid() else { print("Owned probe lost focus"); window.orderOut(nil); exit(2) }
   CGEvent(mouseEventSource: source, mouseType: type, mouseCursorPosition: CGPoint(x: ox + clientX, y: oy + 22), mouseButton: .left)?.post(tap: .cghidEventTap)
  }
  func schedule(_ phase: Int) {
   DispatchQueue.main.asyncAfter(deadline: .now() + 0.08) {
    switch phase {
    case 0: send(.mouseMoved, 300)
    case 1: send(.leftMouseDown, 300)
    case 2...17: send(.leftMouseDragged, 300 + 200 * Double(phase - 1) / 16)
    case 18: send(.leftMouseUp, 500)
    default: querying = false; return
    }
    schedule(phase + 1)
   }
  }
  schedule(0)
 }
}
application.run()
