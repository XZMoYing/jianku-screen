import AppKit
let app = NSApplication.shared
app.setActivationPolicy(.regular)
let window = NSWindow(contentRect: NSRect(x: 80, y: 80, width: 420, height: 240), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
window.title = "Jianku native fullscreen check"
window.isReleasedWhenClosed = false
window.level = .floating
if CommandLine.arguments.contains("primary") { window.collectionBehavior.insert(.fullScreenPrimary) }
window.makeKeyAndOrderFront(nil)
app.activate(ignoringOtherApps: true)
func report(_ phase: String) {
 print("\(phase) level=\(window.level.rawValue) collection=\(window.collectionBehavior.rawValue) fullscreen=\(window.styleMask.contains(.fullScreen)) greenAction=\(window.standardWindowButton(.zoomButton)?.action.map(NSStringFromSelector) ?? "nil")")
 fflush(stdout)
}
DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
 report("before")
 window.standardWindowButton(.zoomButton)?.performClick(nil)
 DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
  report("after")
  if window.styleMask.contains(.fullScreen) { window.toggleFullScreen(nil) }
  DispatchQueue.main.asyncAfter(deadline: .now() + 1) { window.close(); app.terminate(nil) }
 }
}
app.run()
