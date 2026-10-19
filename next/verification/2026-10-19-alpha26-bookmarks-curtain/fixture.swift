import AppKit
import Foundation
setbuf(stdout, nil)
let app = NSApplication.shared
app.setActivationPolicy(.regular)
let window = NSWindow(contentRect: NSRect(x: 80, y: 120, width: 720, height: 450), styleMask: [.titled, .closable], backing: .buffered, defer: false)
window.title = "Jianku Runtime Fixture"
window.backgroundColor = NSColor(calibratedRed: 0.14, green: 0.39, blue: 0.29, alpha: 1)
let label = NSTextField(labelWithString: "简库镜传 · 功能验证")
label.font = NSFont.systemFont(ofSize: 30, weight: .medium)
label.textColor = .white
label.frame = NSRect(x: 48, y: 210, width: 620, height: 80)
window.contentView?.addSubview(label)
let timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { _ in }
window.makeKeyAndOrderFront(nil)
app.activate(ignoringOtherApps: true)
print(window.windowNumber)
app.run()
